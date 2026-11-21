// ============================================================================
// SERVICE: QUIZ SETS, AI GENERATION, COMMUNITY EXPLORE, LIBRARY & REVIEWS
// ============================================================================

import { invokeEdgeFunction, supabase } from "./supabaseClient.js";

/**
 * Helper to enrich quiz_sets or reviews with public creator profiles
 * without querying the RLS-protected `profiles` table directly for other users.
 */
async function fetchCreatorProfilesMap(userIds) {
  const uniqueIds = Array.from(new Set((userIds || []).filter(Boolean)));
  const map = new Map();
  if (uniqueIds.length === 0) return map;

  const { data, error } = await supabase.rpc("rpc_get_public_creator_profiles", {
    p_user_ids: uniqueIds,
  });

  if (!error && Array.isArray(data)) {
    for (const row of data) {
      map.set(row.id, {
        id: row.id,
        display_name: row.display_name || "Người dùng",
        avatar_url: row.avatar_url || null,
      });
    }
  }
  return map;
}

export const quizService = {
  /**
   * Calls the `generate-quiz` Edge Function to create a quiz set from a document's stored JSON / Question Bank
   * (0 Gemini calls by default, single atomic request up to 500 questions).
   * Only runs multi-batch Gemini generation when `forceAi: true` is explicitly passed.
   */
  async generateQuizFromDocument({
    documentId,
    title,
    description,
    subject,
    topic,
    difficulty = "medium",
    questionCount = 20,
    questionTypes = ["multiple_choice"],
    defaultExamQuestions = 60,
    defaultExamDuration = 60,
    forceAi = false,
    onProgress = () => {},
  }) {
    const total = Math.max(1, Math.min(500, Number(questionCount) || 20));
    const BATCH_SIZE = forceAi ? 20 : total;
    const batchCounts = [];
    let rem = total;
    while (rem > 0) {
      const count = Math.min(BATCH_SIZE, rem);
      batchCounts.push(count);
      rem -= count;
    }

    let quizSet = null;
    let allPreviewQuestions = [];
    let completedCount = 0;
    let activeModelId = forceAi ? "gemini-3.8-flash" : "database-bank";
    let activeModelName = forceAi
      ? "Gemini 3.8 Flash"
      : "Ngân hàng câu hỏi JSON (0 Gemini calls)";
    let lastAiMeta = null;

    try {
      for (let i = 0; i < batchCounts.length; i++) {
        const batchCount = batchCounts[i];
        const basePercent = Math.round((completedCount / total) * 90) + 5;

        const statusMessage = !forceAi
          ? `Đang tạo đề trực tiếp từ dữ liệu JSON / Ngân hàng câu hỏi (${total} câu — không gọi Gemini)...`
          : lastAiMeta?.fallback_triggered
          ? `Gemini 3.8 Flash đã hết quota. Đang chuyển sang ${activeModelName}... (${completedCount}/${total} câu)`
          : batchCounts.length > 1
          ? `Đang xử lý bằng ${activeModelName} (Đợt ${i + 1}/${batchCounts.length}: ${completedCount}/${total} câu)...`
          : `Đang xử lý bằng ${activeModelName}...`;

        onProgress({
          step: "generating",
          percent: basePercent,
          completedQuestions: completedCount,
          totalQuestions: total,
          batchIndex: i,
          totalBatches: batchCounts.length,
          modelName: activeModelName,
          message: statusMessage,
        });

        if (i > 0) {
          await new Promise((r) => setTimeout(r, 1500));
        }

        let batchResponse = null;
        for (let attempt = 0; attempt <= 2; attempt++) {
          try {
            batchResponse = await invokeEdgeFunction("generate-quiz", {
              document_id: documentId,
              quiz_set_id: quizSet?.id || null,
              chunk_index: i,
              preferred_model: forceAi && i > 0 ? activeModelId : null,
              force_ai: forceAi,
              title,
              description,
              subject,
              topic,
              difficulty,
              question_count: batchCount,
              question_types: questionTypes,
              default_exam_questions: Number(defaultExamQuestions),
              default_exam_duration: Number(defaultExamDuration),
            });
            break;
          } catch (err) {
            const msg = err?.message || "";
            const isRateLimit =
              forceAi &&
              (err?.status === 429 ||
                msg.includes("429") ||
                msg.includes("Quota") ||
                msg.includes("Rate Limit") ||
                msg.includes("quota"));

            if (isRateLimit && attempt < 2) {
              onProgress({
                step: "rate_limit_wait",
                percent: basePercent,
                completedQuestions: completedCount,
                totalQuestions: total,
                batchIndex: i,
                totalBatches: batchCounts.length,
                message: "Đang thử model dự phòng...",
              });
              await new Promise((r) => setTimeout(r, 4000));
              continue;
            }
            throw err;
          }
        }

        if (batchResponse?.ai_meta) {
          lastAiMeta = batchResponse.ai_meta;
          activeModelId = batchResponse.ai_meta.model_id || activeModelId;
          activeModelName = batchResponse.ai_meta.model_name || activeModelName;
        }
        if (batchResponse?.quiz_set) {
          quizSet = batchResponse.quiz_set;
        }
        if (Array.isArray(batchResponse?.preview_questions)) {
          allPreviewQuestions = [...allPreviewQuestions, ...batchResponse.preview_questions];
        }
        completedCount += batchResponse?.preview_questions?.length || batchCount;
      }
    } catch (err) {
      // Do not leave partial quiz records if a subsequent batch fails
      if (quizSet?.id) {
        await this.softDeleteQuiz(quizSet.id).catch(() => {});
      }
      throw err;
    }

    onProgress({
      step: "completed",
      percent: 100,
      completedQuestions: allPreviewQuestions.length || completedCount,
      totalQuestions: total,
      batchIndex: batchCounts.length,
      totalBatches: batchCounts.length,
      modelName: activeModelName,
      aiMeta: lastAiMeta,
      message: "Tạo đề thành công!",
    });

    return {
      success: true,
      quiz_set: quizSet,
      question_count: allPreviewQuestions.length || completedCount,
      preview_questions: allPreviewQuestions,
      ai_meta: lastAiMeta,
    };
  },

  /**
   * Creates a quiz set directly from structured JSON (array of questions or { title, questions })
   * WITHOUT calling Gemini AI. Splits large imports (> 100 questions) cleanly into batches with rollback on error.
   */
  async generateQuizFromJson({
    jsonPayload,
    documentId = null,
    title,
    description,
    subject,
    topic,
    difficulty = "medium",
    defaultExamQuestions = 60,
    defaultExamDuration = 60,
    onProgress = () => {},
  }) {
    const rawQuestions = Array.isArray(jsonPayload)
      ? jsonPayload
      : Array.isArray(jsonPayload?.questions)
      ? jsonPayload.questions
      : [];

    if (rawQuestions.length === 0) {
      throw new Error("JSON phải chứa mảng câu hỏi 'questions' hợp lệ (ít nhất 1 câu).");
    }
    if (rawQuestions.length > 500) {
      throw new Error("Mỗi bộ đề hỗ trợ tối đa 500 câu hỏi.");
    }

    const total = rawQuestions.length;
    const CHUNK_SIZE = 100;
    const chunks = [];
    for (let i = 0; i < total; i += CHUNK_SIZE) {
      chunks.push(rawQuestions.slice(i, i + CHUNK_SIZE));
    }

    let quizSet = null;
    let allPreviewQuestions = [];
    let lastAiMeta = null;

    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const percent = Math.round(((i * CHUNK_SIZE) / total) * 85) + 10;
        onProgress({
          step: "generating",
          percent,
          completedQuestions: allPreviewQuestions.length,
          totalQuestions: total,
          batchIndex: i,
          totalBatches: chunks.length,
          modelName: "JSON Direct Import",
          message: `Đang lưu trực tiếp ${total} câu hỏi từ JSON (không qua Gemini)...`,
        });

        const payloadObj = Array.isArray(jsonPayload)
          ? { title: title || "Bộ đề từ JSON", questions: chunk }
          : { ...jsonPayload, questions: chunk };

        const batchResponse = await invokeEdgeFunction("generate-quiz", {
          document_id: documentId || null,
          quiz_set_id: quizSet?.id || null,
          json_payload: payloadObj,
          title: title || jsonPayload?.title || "Bộ đề từ JSON",
          description: description || jsonPayload?.description || null,
          subject: subject || jsonPayload?.subject || "Tổng hợp",
          topic: topic || jsonPayload?.topic || null,
          difficulty: difficulty || jsonPayload?.difficulty || "medium",
          default_exam_questions: Number(defaultExamQuestions),
          default_exam_duration: Number(defaultExamDuration),
        });

        if (batchResponse?.ai_meta) {
          lastAiMeta = batchResponse.ai_meta;
        }
        if (batchResponse?.quiz_set) {
          quizSet = batchResponse.quiz_set;
        }
        if (Array.isArray(batchResponse?.preview_questions)) {
          allPreviewQuestions = [...allPreviewQuestions, ...batchResponse.preview_questions];
        }
      }
    } catch (err) {
      if (quizSet?.id) {
        await this.softDeleteQuiz(quizSet.id).catch(() => {});
      }
      throw err;
    }

    onProgress({
      step: "completed",
      percent: 100,
      completedQuestions: allPreviewQuestions.length || total,
      totalQuestions: total,
      batchIndex: chunks.length,
      totalBatches: chunks.length,
      modelName: "JSON Direct Import",
      aiMeta: lastAiMeta,
      message: "Tạo đề thành công!",
    });

    return {
      success: true,
      quiz_set: quizSet,
      question_count: allPreviewQuestions.length || total,
      preview_questions: allPreviewQuestions,
      source: "direct_json",
      ai_meta: lastAiMeta,
    };
  },

  /**
   * Lists public, approved, non-deleted quiz sets for Explore / Community.
   */
  async listPublicQuizzes({
    search = "",
    subject = "",
    topic = "",
    difficulty = "",
  } = {}) {
    let query = supabase
      .from("quiz_sets")
      .select(
        "*, questions(count), quiz_reviews(rating)",
      )
      .eq("visibility", "public")
      .eq("moderation_status", "approved")
      .is("deleted_at", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`title.ilike.${term},description.ilike.${term},subject.ilike.${term},topic.ilike.${term}`);
    }
    if (subject && subject.trim() && subject !== "all") {
      query = query.ilike("subject", `%${subject.trim()}%`);
    }
    if (topic && topic.trim() && topic !== "all") {
      query = query.ilike("topic", `%${topic.trim()}%`);
    }
    if (difficulty && difficulty !== "all") {
      query = query.eq("difficulty", difficulty);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    const creatorMap = await fetchCreatorProfilesMap(rows.map((r) => r.user_id));

    return rows.map((row) => {
      const questionCount = Array.isArray(row.questions)
        ? row.questions[0]?.count ?? 0
        : 0;
      const reviews = Array.isArray(row.quiz_reviews) ? row.quiz_reviews : [];
      const reviewCount = reviews.length;
      const avgRating =
        reviewCount > 0
          ? Number(
              (
                reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) /
                reviewCount
              ).toFixed(1),
            )
          : 0;

      return {
        ...row,
        question_count: questionCount,
        review_count: reviewCount,
        avg_rating: avgRating,
        creator: creatorMap.get(row.user_id) || {
          id: row.user_id,
          display_name: "Người dùng",
          avatar_url: null,
        },
      };
    });
  },

  /**
   * Fetches detailed information about a Quiz Set for QuizDetailPage.
   * Does NOT read `question_answers` or expose answer keys.
   */
  async getQuizDetail(quizSetId) {
    const { data: quiz, error } = await supabase
      .from("quiz_sets")
      .select("*")
      .eq("id", quizSetId)
      .is("deleted_at", null)
      .single();

    if (error || !quiz) {
      throw new Error("Không tìm thấy bộ đề hoặc bộ đề chưa được công khai.");
    }

    // Fetch public question list (without answer keys or explanations!)
    const { data: questions } = await supabase
      .from("questions")
      .select(
        "id, quiz_set_id, position, question_text, question_type, formula_latex, image_path, source_page, difficulty, question_options(id, option_label, option_content, position)",
      )
      .eq("quiz_set_id", quizSetId)
      .order("position", { ascending: true });

    // Fetch reviews
    const { data: reviews } = await supabase
      .from("quiz_reviews")
      .select("*")
      .eq("quiz_set_id", quizSetId)
      .order("created_at", { ascending: false });

    const allUserIds = [
      quiz.user_id,
      ...(reviews || []).map((r) => r.user_id),
    ];
    const creatorMap = await fetchCreatorProfilesMap(allUserIds);

    const enrichedReviews = (reviews || []).map((rev) => ({
      ...rev,
      author: creatorMap.get(rev.user_id) || {
        id: rev.user_id,
        display_name: "Học viên",
        avatar_url: null,
      },
    }));

    const reviewCount = enrichedReviews.length;
    const avgRating =
      reviewCount > 0
        ? Number(
            (
              enrichedReviews.reduce((acc, r) => acc + Number(r.rating || 0), 0) /
              reviewCount
            ).toFixed(1),
          )
        : 0;

    return {
      ...quiz,
      question_count: (questions || []).length,
      questions: questions || [],
      reviews: enrichedReviews,
      review_count: reviewCount,
      avg_rating: avgRating,
      creator: creatorMap.get(quiz.user_id) || {
        id: quiz.user_id,
        display_name: "Người tạo",
        avatar_url: null,
      },
    };
  },

  /**
   * Lists all non-deleted quiz sets owned by the current user for My Library.
   */
  async listMyQuizzes() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from("quiz_sets")
      .select("*, questions(count), documents(id, file_name)")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    return (data || []).map((row) => ({
      ...row,
      question_count: Array.isArray(row.questions)
        ? row.questions[0]?.count ?? 0
        : 0,
    }));
  },

  /**
   * Creates a manual quiz set (without requiring a source document) and saves its questions.
   */
  async createManualQuiz({
    title,
    description = "",
    subject = "",
    topic = "",
    difficulty = "medium",
    defaultExamQuestions = 60,
    defaultExamDuration = 60,
    visibility = "private",
    questions = [],
  }) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Vui lòng đăng nhập để tạo bộ đề.");

    const isPublicRequest = visibility === "public";

    const { data: quizSet, error: insertError } = await supabase
      .from("quiz_sets")
      .insert({
        user_id: user.id,
        document_id: null,
        title: title.trim(),
        description: description?.trim() || null,
        subject: subject?.trim() || null,
        topic: topic?.trim() || null,
        difficulty,
        visibility: isPublicRequest ? "public" : "private",
        moderation_status: isPublicRequest ? "pending" : "not_submitted",
        default_exam_questions: Math.max(1, Number(defaultExamQuestions) || 20),
        default_exam_duration: Math.max(1, Number(defaultExamDuration) || 30),
      })
      .select("*")
      .single();

    if (insertError || !quizSet) {
      throw new Error(`Không thể tạo bộ đề: ${insertError?.message || "Lỗi DB"}`);
    }

    if (Array.isArray(questions) && questions.length > 0) {
      const { error: qError } = await supabase.rpc(
        "rpc_owner_upsert_quiz_questions",
        {
          p_quiz_set_id: quizSet.id,
          p_questions: questions,
        },
      );
      if (qError) throw qError;

      if (isPublicRequest) {
        await supabase
          .from("quiz_sets")
          .update({ visibility: "public", moderation_status: "pending" })
          .eq("id", quizSet.id);
      }
    }

    return quizSet;
  },

  /**
   * Loads a quiz set and its questions for the owner or admin editor.
   */
  async getQuizForEditor(quizSetId) {
    const { data: quizSet, error: quizError } = await supabase
      .from("quiz_sets")
      .select("*, documents(id, file_name)")
      .eq("id", quizSetId)
      .is("deleted_at", null)
      .single();

    if (quizError || !quizSet) {
      throw new Error("Không tìm thấy bộ đề để chỉnh sửa.");
    }

    const { data: editorQuestions, error: rpcError } = await supabase.rpc(
      "rpc_get_quiz_editor_questions",
      {
        p_quiz_set_id: quizSetId,
      },
    );

    if (rpcError) throw rpcError;

    return {
      quizSet,
      questions: Array.isArray(editorQuestions) ? editorQuestions : [],
    };
  },

  /**
   * Updates quiz set metadata and replaces questions atomically.
   * Remember Rule 3.1: If the quiz set was approved public, editing automatically resets moderation_status to 'pending'.
   */
  async updateQuizAndQuestions(quizSetId, metadata, questions) {
    const updates = {};
    if (metadata.title !== undefined) updates.title = metadata.title.trim();
    if (metadata.description !== undefined)
      updates.description = metadata.description?.trim() || null;
    if (metadata.subject !== undefined)
      updates.subject = metadata.subject?.trim() || null;
    if (metadata.topic !== undefined)
      updates.topic = metadata.topic?.trim() || null;
    if (metadata.difficulty !== undefined)
      updates.difficulty = metadata.difficulty;
    if (metadata.default_exam_questions !== undefined) {
      updates.default_exam_questions = Math.max(
        1,
        Number(metadata.default_exam_questions) || 20,
      );
    }
    if (metadata.default_exam_duration !== undefined) {
      updates.default_exam_duration = Math.max(
        1,
        Number(metadata.default_exam_duration) || 30,
      );
    }

    if (Object.keys(updates).length > 0) {
      const { error: metaError } = await supabase
        .from("quiz_sets")
        .update(updates)
        .eq("id", quizSetId);

      if (metaError) throw metaError;
    }

    if (Array.isArray(questions) && questions.length > 0) {
      const { error: qError } = await supabase.rpc(
        "rpc_owner_upsert_quiz_questions",
        {
          p_quiz_set_id: quizSetId,
          p_questions: questions,
        },
      );
      if (qError) throw qError;
    }

    const { data: updatedQuiz, error: reloadError } = await supabase
      .from("quiz_sets")
      .select("*")
      .eq("id", quizSetId)
      .single();

    if (reloadError) throw reloadError;
    return updatedQuiz;
  },

  /**
   * Submits a quiz set for Public Community visibility -> sets visibility='public', moderation_status='pending'.
   */
  async submitForPublicApproval(quizSetId) {
    const { data, error } = await supabase
      .from("quiz_sets")
      .update({
        visibility: "public",
        moderation_status: "pending",
      })
      .eq("id", quizSetId)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Switches a quiz set back to Private -> sets visibility='private', moderation_status='not_submitted'.
   */
  async makeQuizPrivate(quizSetId) {
    const { data, error } = await supabase
      .from("quiz_sets")
      .update({
        visibility: "private",
        moderation_status: "not_submitted",
      })
      .eq("id", quizSetId)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Soft deletes a quiz set (`deleted_at = now()`) so attempt history is never lost.
   */
  async softDeleteQuiz(quizSetId) {
    const { data, error } = await supabase
      .from("quiz_sets")
      .update({
        deleted_at: new Date().toISOString(),
      })
      .eq("id", quizSetId)
      .select("id, deleted_at")
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Uploads an image for a question or option into private bucket `question-assets/<USER_UUID>/<filename>`.
   */
  async uploadQuestionImage(file) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Vui lòng đăng nhập để tải ảnh.");

    const allowedMimes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedMimes.includes(file.type)) {
      throw new Error("Ảnh minh họa chỉ hỗ trợ định dạng PNG, JPG hoặc WEBP.");
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Dung lượng ảnh minh họa không được vượt quá 5MB.");
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${user.id}/${Date.now()}_${safeName}`;

    const { error } = await supabase.storage
      .from("question-assets")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (error) throw error;
    return storagePath;
  },

  /**
   * Creates or updates the current user's review on an approved public quiz set.
   * Enforces 1 review per user per quiz_set via UNIQUE(quiz_set_id, user_id).
   */
  async upsertReview(quizSetId, { rating, comment }) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Vui lòng đăng nhập để đánh giá bộ đề.");

    const numericRating = Number(rating);
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      throw new Error("Số sao đánh giá phải từ 1 đến 5.");
    }

    const { data, error } = await supabase
      .from("quiz_reviews")
      .upsert(
        {
          quiz_set_id: quizSetId,
          user_id: user.id,
          rating: numericRating,
          comment: comment?.trim() || null,
        },
        { onConflict: "quiz_set_id,user_id" },
      )
      .select("*")
      .single();

    if (error) throw error;
    return data;
  },

  async deleteReview(reviewId) {
    const { error } = await supabase
      .from("quiz_reviews")
      .delete()
      .eq("id", reviewId);

    if (error) throw error;
    return true;
  },
};

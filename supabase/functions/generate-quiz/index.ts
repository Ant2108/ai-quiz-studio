// ============================================================================
// EDGE FUNCTION 2: generate-quiz
// Endpoint: POST /functions/v1/generate-quiz
// Request:
// {
//   "document_id": "UUID",
//   "title": "Đề thi thử",
//   "description"?: string,
//   "subject": "Java",
//   "topic"?: string,
//   "difficulty": "medium",
//   "question_count": 500,
//   "question_types": ["multiple_choice", "true_false"],
//   "default_exam_questions"?: number,
//   "default_exam_duration"?: number
// }
// ============================================================================

import { handleCorsPreflight } from "../_shared/cors.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/response.ts";
import { enforceAiRateLimit, requireAuth } from "../_shared/auth.ts";
import {
  requireUuid,
  validateDocumentFile,
  validateGeneratedQuizPayload,
} from "../_shared/validation.ts";
import { analyzeDocumentWithGemini } from "../_shared/gemini.ts";
import { generateQuizDatabaseFirst } from "../_shared/document-pipeline.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return errorResponse(
      new AppError("Method not allowed. Use POST.", 405, "METHOD_NOT_ALLOWED"),
      req,
    );
  }

  try {
    const { user, profile, adminClient } = await requireAuth(req);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new AppError("Request body phải là JSON hợp lệ.", 400, "INVALID_JSON_BODY");
    }

    const payload = body as Record<string, unknown>;
    const hasDirectJson =
      payload.json_payload !== undefined && payload.json_payload !== null;
    const documentId =
      typeof payload.document_id === "string" && payload.document_id.trim()
        ? requireUuid(payload.document_id, "document_id")
        : hasDirectJson
        ? null
        : requireUuid(payload.document_id, "document_id");
    const existingQuizSetId =
      typeof payload.quiz_set_id === "string" && payload.quiz_set_id.trim()
        ? requireUuid(payload.quiz_set_id, "quiz_set_id")
        : null;
    const startChunkIndex =
      typeof payload.chunk_index === "number" && Number.isInteger(payload.chunk_index) && payload.chunk_index >= 0
        ? payload.chunk_index
        : 0;
    const preferredModelId =
      typeof payload.preferred_model === "string" && payload.preferred_model.trim()
        ? payload.preferred_model.trim()
        : null;
    const forceAi = Boolean(payload.force_ai);

    // 1. Validate inputs
    const rawTitle = typeof payload.title === "string" ? payload.title.trim() : "";
    const subject =
      typeof payload.subject === "string" && payload.subject.trim()
        ? payload.subject.trim()
        : "Tổng hợp";
    const topic =
      typeof payload.topic === "string" && payload.topic.trim()
        ? payload.topic.trim()
        : null;
    const description =
      typeof payload.description === "string" && payload.description.trim()
        ? payload.description.trim()
        : null;

    const rawDifficulty =
      typeof payload.difficulty === "string"
        ? payload.difficulty.toLowerCase().trim()
        : "medium";
    if (!["easy", "medium", "hard"].includes(rawDifficulty)) {
      throw new AppError(
        "Độ khó (difficulty) phải là 'easy', 'medium' hoặc 'hard'.",
        400,
        "INVALID_DIFFICULTY",
      );
    }
    const difficulty = rawDifficulty as "easy" | "medium" | "hard";

    // Direct JSON Quiz Creation Fast-Path (0 Gemini calls, optional document_id)
    if (hasDirectJson) {
      if (existingQuizSetId) {
        const { data: existingQuiz, error: eqError } = await adminClient
          .from("quiz_sets")
          .select("id, user_id")
          .eq("id", existingQuizSetId)
          .is("deleted_at", null)
          .maybeSingle();

        if (eqError || !existingQuiz) {
          throw new AppError("Không tìm thấy bộ đề cần bổ sung câu hỏi.", 404, "QUIZ_NOT_FOUND");
        }
        if (existingQuiz.user_id !== user.id && profile.role !== "admin") {
          throw new AppError("Bạn không có quyền chỉnh sửa bộ đề này.", 403, "FORBIDDEN_NOT_OWNER");
        }
      }

      const validated = validateGeneratedQuizPayload(
        payload.json_payload,
        rawTitle || "Bộ đề từ JSON",
        difficulty,
      );

      if (validated.questions.length > 500) {
        throw new AppError(
          "Số lượng câu hỏi trong JSON không được vượt quá 500 câu cho mỗi bộ đề.",
          400,
          "INVALID_QUESTION_COUNT",
        );
      }

      const finalTitle = rawTitle || validated.title || "Bộ đề từ JSON";
      const defaultExamQuestions =
        typeof payload.default_exam_questions === "number" &&
          payload.default_exam_questions > 0
          ? Math.min(500, Math.round(payload.default_exam_questions))
          : Math.min(60, validated.questions.length);
      const defaultExamDuration =
        typeof payload.default_exam_duration === "number" &&
          payload.default_exam_duration > 0
          ? Math.round(payload.default_exam_duration)
          : 60;

      const { data: txResult, error: txError } = existingQuizSetId
        ? await adminClient.rpc("rpc_append_questions_to_quiz", {
            p_quiz_set_id: existingQuizSetId,
            p_user_id: user.id,
            p_document_id: documentId,
            p_difficulty: difficulty,
            p_questions: validated.questions,
          })
        : await adminClient.rpc("rpc_create_quiz_with_questions", {
            p_user_id: user.id,
            p_document_id: documentId,
            p_title: finalTitle,
            p_description:
              description ||
              `Bộ đề trắc nghiệm tạo trực tiếp từ JSON (${validated.questions.length} câu hỏi)`,
            p_subject: subject,
            p_topic: topic,
            p_difficulty: difficulty,
            p_default_exam_questions: defaultExamQuestions,
            p_default_exam_duration: defaultExamDuration,
            p_questions: validated.questions,
          });

      if (txError || !txResult) {
        throw new AppError(
          `Không thể lưu bộ đề từ JSON: ${txError?.message || "Transaction failed"}`,
          500,
          "QUIZ_CREATION_TRANSACTION_FAILED",
        );
      }

      const { data: quizSet } = await adminClient
        .from("quiz_sets")
        .select("*")
        .eq("id", txResult.quiz_set_id)
        .single();

      return jsonResponse(
        {
          success: true,
          quiz_set: quizSet,
          question_count: txResult.question_count,
          preview_questions: txResult.questions,
          source: "direct_json",
          ai_meta: {
            model_id: "direct-json",
            model_name: "JSON Direct Import (0 Gemini calls)",
            fallback_triggered: false,
            status_messages: [
              `Đã tạo đề trực tiếp từ JSON với ${txResult.question_count} câu hỏi (không qua Gemini).`,
            ],
            attempts: [],
          },
        },
        201,
        req,
      );
    }

    const questionCount = Number(payload.question_count ?? 10);
    if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 500) {
      throw new AppError(
        "Số lượng câu hỏi (question_count) phải là số nguyên từ 1 đến 500.",
        400,
        "INVALID_QUESTION_COUNT",
      );
    }

    const rawTypes = Array.isArray(payload.question_types)
      ? payload.question_types
      : ["multiple_choice"];
    const questionTypes = rawTypes
      .map((t) => String(t).toLowerCase().trim())
      .filter((t): t is "multiple_choice" | "true_false" =>
        t === "multiple_choice" || t === "true_false"
      );

    if (questionTypes.length === 0) {
      throw new AppError(
        "Phải chọn ít nhất một dạng câu hỏi hợp lệ ('multiple_choice' hoặc 'true_false').",
        400,
        "INVALID_QUESTION_TYPES",
      );
    }

    // 2. Verify document ownership
    const { data: doc, error: docError } = await adminClient
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .maybeSingle();

    if (docError || !doc) {
      throw new AppError("Không tìm thấy tài liệu nguồn.", 404, "DOCUMENT_NOT_FOUND");
    }

    if (doc.user_id !== user.id && profile.role !== "admin") {
      throw new AppError(
        "Bạn không có quyền tạo bộ đề từ tài liệu của người khác.",
        403,
        "FORBIDDEN_NOT_OWNER",
      );
    }

    // 3. Enforce per-user AI generation rate limit (only when creating a new quiz set)
    if (!existingQuizSetId) {
      await enforceAiRateLimit(adminClient, user.id, "generate_quiz");
    } else {
      const { data: existingQuiz, error: eqError } = await adminClient
        .from("quiz_sets")
        .select("id, user_id")
        .eq("id", existingQuizSetId)
        .is("deleted_at", null)
        .maybeSingle();

      if (eqError || !existingQuiz) {
        throw new AppError("Không tìm thấy bộ đề cần bổ sung câu hỏi.", 404, "QUIZ_NOT_FOUND");
      }
      if (existingQuiz.user_id !== user.id && profile.role !== "admin") {
        throw new AppError("Bạn không có quyền chỉnh sửa bộ đề này.", 403, "FORBIDDEN_NOT_OWNER");
      }
    }

    // 4. Ensure document has extracted_data / Question Bank (Gemini is ONLY called during process-document,
    //    NOT during generate-quiz, unless force_ai=true is explicitly requested)
    let workingDoc = doc;
    const hasExtractedText = Boolean((doc.extracted_text || "").trim());
    const hasBankQuestions =
      Array.isArray(doc.extracted_data?.questions) && doc.extracted_data.questions.length > 0;

    if (forceAi && !hasExtractedText && !hasBankQuestions) {
      const { normalizedExt, normalizedMime } = validateDocumentFile({
        fileName: doc.file_name,
        fileType: doc.file_type,
        mimeType: doc.mime_type,
        fileSize: doc.file_size,
      });

      const { data: fileBlob, error: storageError } = await adminClient.storage
        .from("exam-documents")
        .download(doc.file_path);

      if (storageError || !fileBlob) {
        throw new AppError(
          "Tài liệu chưa được trích xuất văn bản và không thể tải file từ Storage.",
          400,
          "DOCUMENT_NOT_PROCESSED",
        );
      }

      const fileBytes = new Uint8Array(await fileBlob.arrayBuffer());
      const analysis = await analyzeDocumentWithGemini({
        fileBytes,
        fileName: doc.file_name,
        mimeType: normalizedMime,
        ext: normalizedExt,
        deps: { preferredModelId },
      });

      const { data: updatedDoc } = await adminClient
        .from("documents")
        .update({
          status: "processed",
          extracted_text: analysis.extractedText,
          page_count: analysis.pageCount,
          ai_summary: analysis.summary,
          extracted_data: analysis.extractedData,
          question_bank_synced: false,
          processed_at: new Date().toISOString(),
        })
        .eq("id", documentId)
        .select("*")
        .single();

      if (updatedDoc) {
        workingDoc = updatedDoc;
      }
    }

    const quizTitle =
      rawTitle ||
      workingDoc.ai_summary?.title_suggestion ||
      `Bộ đề: ${workingDoc.file_name.replace(/\.[^.]+$/, "")}`;

    const defaultExamQuestions =
      typeof payload.default_exam_questions === "number" &&
        payload.default_exam_questions > 0
        ? Math.min(questionCount, Math.round(payload.default_exam_questions))
        : Math.min(60, questionCount);

    const defaultExamDuration =
      typeof payload.default_exam_duration === "number" &&
        payload.default_exam_duration > 0
        ? Math.round(payload.default_exam_duration)
        : 60;

    const quizDescription =
      description ||
      `Bộ đề trắc nghiệm được tạo từ tài liệu ${workingDoc.file_name}`;

    // 5. Database-only Quiz Generation first (falls back to Gemini AI only if bank is empty or force_ai=true)
    const generated = await generateQuizDatabaseFirst({
      doc: workingDoc,
      actorUserId: user.id,
      existingQuizSetId,
      title: quizTitle,
      description: quizDescription,
      subject,
      topic,
      difficulty,
      questionCount,
      questionTypes,
      defaultExamQuestions,
      defaultExamDuration,
      startChunkIndex,
      preferredModelId,
      forceAi,
      repo: {
        async syncFromExtractedData(sync) {
          const { error: syncErr } = await adminClient.rpc(
            "rpc_sync_document_question_bank",
            {
              p_document_id: sync.documentId,
              p_user_id: sync.userId,
              p_questions: sync.questions,
              p_replace: false,
            },
          );
          if (syncErr) {
            throw new AppError(
              `Không thể đồng bộ Ngân hàng câu hỏi: ${syncErr.message}`,
              500,
              "QUESTION_BANK_SYNC_FAILED",
            );
          }
        },
        async createQuizFromQuestionBank(qParams) {
          const { data: bankRes, error: bankErr } = await adminClient.rpc(
            "rpc_create_quiz_from_question_bank",
            {
              p_user_id: qParams.userId,
              p_document_id: qParams.documentId,
              p_quiz_set_id: qParams.quizSetId,
              p_title: qParams.title,
              p_description: qParams.description,
              p_subject: qParams.subject,
              p_topic: qParams.topic,
              p_difficulty: qParams.difficulty,
              p_question_count: qParams.questionCount,
              p_question_types: qParams.questionTypes,
              p_default_exam_questions: qParams.defaultExamQuestions,
              p_default_exam_duration: qParams.defaultExamDuration,
            },
          );
          if (bankErr) {
            throw new AppError(
              `Lỗi tạo đề từ Ngân hàng câu hỏi Database: ${bankErr.message}`,
              500,
              "DATABASE_QUIZ_GENERATION_FAILED",
            );
          }
          return bankRes as {
            quiz_set_id: string;
            question_count: number;
            questions: unknown[];
            source: string;
          };
        },
        async createOrAppendQuizFromAi(aiParams) {
          const { data: txResult, error: txError } = aiParams.quizSetId
            ? await adminClient.rpc("rpc_append_questions_to_quiz", {
                p_quiz_set_id: aiParams.quizSetId,
                p_user_id: aiParams.userId,
                p_document_id: aiParams.documentId,
                p_difficulty: aiParams.difficulty,
                p_questions: aiParams.questions,
              })
            : await adminClient.rpc("rpc_create_quiz_with_questions", {
                p_user_id: aiParams.userId,
                p_document_id: aiParams.documentId,
                p_title: aiParams.title,
                p_description: aiParams.description,
                p_subject: aiParams.subject,
                p_topic: aiParams.topic,
                p_difficulty: aiParams.difficulty,
                p_default_exam_questions: aiParams.defaultExamQuestions,
                p_default_exam_duration: aiParams.defaultExamDuration,
                p_questions: aiParams.questions,
              });

          if (txError || !txResult) {
            throw new AppError(
              `Không thể lưu bộ đề vào cơ sở dữ liệu: ${txError?.message || "Transaction failed"}`,
              500,
              "QUIZ_CREATION_TRANSACTION_FAILED",
            );
          }
          return txResult as {
            quiz_set_id: string;
            question_count: number;
            questions: unknown[];
          };
        },
      },
    });

    const { data: quizSet } = await adminClient
      .from("quiz_sets")
      .select("*")
      .eq("id", generated.quizSetId)
      .single();

    // 6. Return Preview WITHOUT answer keys
    return jsonResponse(
      {
        success: true,
        quiz_set: quizSet,
        question_count: generated.questionCount,
        preview_questions: generated.previewQuestions,
        source: generated.source,
        ai_meta: generated.aiMeta,
      },
      201,
      req,
    );
  } catch (err) {
    return errorResponse(err, req);
  }
});

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
//   "question_count": 120,
//   "question_types": ["multiple_choice", "true_false"],
//   "default_exam_questions"?: number,
//   "default_exam_duration"?: number
// }
// ============================================================================

import { handleCorsPreflight } from "../_shared/cors.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/response.ts";
import { enforceAiRateLimit, requireAuth } from "../_shared/auth.ts";
import { requireUuid, validateDocumentFile } from "../_shared/validation.ts";
import {
  analyzeDocumentWithGemini,
  generateQuizWithGemini,
} from "../_shared/gemini.ts";

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
    const documentId = requireUuid(payload.document_id, "document_id");
    const existingQuizSetId =
      typeof payload.quiz_set_id === "string" && payload.quiz_set_id.trim()
        ? requireUuid(payload.quiz_set_id, "quiz_set_id")
        : null;
    const startChunkIndex =
      typeof payload.chunk_index === "number" && Number.isInteger(payload.chunk_index) && payload.chunk_index >= 0
        ? payload.chunk_index
        : 0;

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

    const questionCount = Number(payload.question_count ?? 10);
    if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 120) {
      throw new AppError(
        "Số lượng câu hỏi (question_count) phải là số nguyên từ 1 đến 120.",
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

    // 4. Ensure document has extracted_text (auto-process if not yet extracted)
    let documentText: string = (doc.extracted_text || "").trim();
    if (!documentText) {
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
      });

      documentText = analysis.extractedText;

      await adminClient
        .from("documents")
        .update({
          status: "processed",
          extracted_text: analysis.extractedText,
          page_count: analysis.pageCount,
          ai_summary: analysis.summary,
          processed_at: new Date().toISOString(),
        })
        .eq("id", documentId);
    }

    const quizTitle =
      rawTitle ||
      doc.ai_summary?.title_suggestion ||
      `Bộ đề: ${doc.file_name.replace(/\.[^.]+$/, "")}`;

    // 5. Call Gemini AI and validate full JSON schema + options + answer keys
    const generated = await generateQuizWithGemini({
      documentText,
      title: quizTitle,
      subject,
      topic,
      difficulty,
      questionCount,
      questionTypes,
      startChunkIndex,
    });

    const defaultExamQuestions =
      typeof payload.default_exam_questions === "number" &&
        payload.default_exam_questions > 0
        ? Math.min(generated.questions.length, Math.round(payload.default_exam_questions))
        : Math.min(60, generated.questions.length);

    const defaultExamDuration =
      typeof payload.default_exam_duration === "number" &&
        payload.default_exam_duration > 0
        ? Math.round(payload.default_exam_duration)
        : 60;

    // 6. Save or append quiz_set + questions + question_options + question_answers inside a single DB transaction
    // The RPC returns the preview questions & options WITHOUT answer keys!
    const { data: txResult, error: txError } = existingQuizSetId
      ? await adminClient.rpc("rpc_append_questions_to_quiz", {
          p_quiz_set_id: existingQuizSetId,
          p_user_id: user.id,
          p_document_id: documentId,
          p_difficulty: difficulty,
          p_questions: generated.questions,
        })
      : await adminClient.rpc("rpc_create_quiz_with_questions", {
          p_user_id: user.id,
          p_document_id: documentId,
          p_title: generated.title || quizTitle,
          p_description:
            description ||
            `Bộ đề trắc nghiệm được tạo tự động từ tài liệu ${doc.file_name}`,
          p_subject: subject,
          p_topic: topic,
          p_difficulty: difficulty,
          p_default_exam_questions: defaultExamQuestions,
          p_default_exam_duration: defaultExamDuration,
          p_questions: generated.questions,
        });

    if (txError || !txResult) {
      throw new AppError(
        `Không thể lưu bộ đề vào cơ sở dữ liệu: ${txError?.message || "Transaction failed"}`,
        500,
        "QUIZ_CREATION_TRANSACTION_FAILED",
      );
    }

    const { data: quizSet } = await adminClient
      .from("quiz_sets")
      .select("*")
      .eq("id", txResult.quiz_set_id)
      .single();

    // 7. Return Preview WITHOUT answer keys
    return jsonResponse(
      {
        success: true,
        quiz_set: quizSet,
        question_count: txResult.question_count,
        preview_questions: txResult.questions,
      },
      201,
      req,
    );
  } catch (err) {
    return errorResponse(err, req);
  }
});

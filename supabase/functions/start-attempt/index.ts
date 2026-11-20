// ============================================================================
// EDGE FUNCTION 3: start-attempt
// Endpoint: POST /functions/v1/start-attempt
// Request:
// {
//   "quiz_set_id": "UUID",
//   "attempt_type": "study" | "practice" | "exam",
//   "question_count"?: number,
//   "time_limit_seconds"?: number,
//   "shuffle_questions"?: boolean,
//   "shuffle_options"?: boolean
// }
// ============================================================================

import { handleCorsPreflight } from "../_shared/cors.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/response.ts";
import { requireAuth } from "../_shared/auth.ts";
import { requireUuid } from "../_shared/validation.ts";

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
    const { user, adminClient } = await requireAuth(req);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new AppError("Request body phải là JSON hợp lệ.", 400, "INVALID_JSON_BODY");
    }

    const payload = body as Record<string, unknown>;
    const quizSetId = requireUuid(payload.quiz_set_id, "quiz_set_id");

    const rawAttemptType =
      typeof payload.attempt_type === "string"
        ? payload.attempt_type.toLowerCase().trim()
        : "";
    if (!["study", "practice", "exam"].includes(rawAttemptType)) {
      throw new AppError(
        "Loại lượt làm bài (attempt_type) phải là 'study', 'practice' hoặc 'exam'.",
        400,
        "INVALID_ATTEMPT_TYPE",
      );
    }

    const questionCount =
      payload.question_count !== undefined && payload.question_count !== null
        ? Number(payload.question_count)
        : null;

    if (
      questionCount !== null &&
      (!Number.isInteger(questionCount) || questionCount <= 0)
    ) {
      throw new AppError(
        "Số lượng câu hỏi (question_count) phải là số nguyên dương.",
        400,
        "INVALID_QUESTION_COUNT",
      );
    }

    const timeLimitSeconds =
      payload.time_limit_seconds !== undefined && payload.time_limit_seconds !== null
        ? Number(payload.time_limit_seconds)
        : null;

    if (
      timeLimitSeconds !== null &&
      (!Number.isInteger(timeLimitSeconds) || timeLimitSeconds <= 0)
    ) {
      throw new AppError(
        "Thời gian giới hạn (time_limit_seconds) phải là số nguyên dương (giây).",
        400,
        "INVALID_TIME_LIMIT",
      );
    }

    const shuffleQuestions = Boolean(payload.shuffle_questions);
    const shuffleOptions = Boolean(payload.shuffle_options);

    // Run atomic transaction via RPC:
    // - Verifies quiz_set visibility/moderation_status or ownership/admin
    // - Creates attempt record
    // - Selects and optionally shuffles questions & options
    // - Snapshots attempt_questions and attempt_answer_keys
    // - Never returns answer keys
    const { data: attemptData, error: rpcError } = await adminClient.rpc(
      "rpc_start_attempt",
      {
        p_user_id: user.id,
        p_quiz_set_id: quizSetId,
        p_attempt_type: rawAttemptType,
        p_question_count: questionCount,
        p_time_limit_seconds: timeLimitSeconds,
        p_shuffle_questions: shuffleQuestions,
        p_shuffle_options: shuffleOptions,
      },
    );

    if (rpcError || !attemptData) {
      throw new AppError(
        rpcError?.message || "Không thể khởi tạo lượt làm bài.",
        rpcError?.message?.includes("Forbidden")
          ? 403
          : rpcError?.message?.includes("not found")
          ? 404
          : 400,
        "START_ATTEMPT_FAILED",
      );
    }

    // Generate short-lived signed URLs for any question or option image_path stored in private bucket 'question-assets'
    const questions = Array.isArray(attemptData.questions)
      ? attemptData.questions
      : [];

    for (const q of questions) {
      if (q.image_path && typeof q.image_path === "string" && !q.image_path.startsWith("http")) {
        const { data: signed } = await adminClient.storage
          .from("question-assets")
          .createSignedUrl(q.image_path, 3600);
        if (signed?.signedUrl) {
          q.image_url = signed.signedUrl;
        }
      }
      if (Array.isArray(q.options)) {
        for (const opt of q.options) {
          if (
            opt.image_path &&
            typeof opt.image_path === "string" &&
            !opt.image_path.startsWith("http")
          ) {
            const { data: signedOpt } = await adminClient.storage
              .from("question-assets")
              .createSignedUrl(opt.image_path, 3600);
            if (signedOpt?.signedUrl) {
              opt.image_url = signedOpt.signedUrl;
            }
          }
        }
      }
    }

    let studyAnswerKeys: Record<
      string,
      { correct_option_id: string | null; correct_text: string | null; explanation: string | null }
    > | null = null;

    if (rawAttemptType === "study" && questions.length > 0) {
      const aqIds = questions
        .map((q: { attempt_question_id?: string }) => q.attempt_question_id)
        .filter(Boolean);

      if (aqIds.length > 0) {
        const { data: keyRows } = await adminClient
          .from("attempt_answer_keys")
          .select("attempt_question_id, correct_option_id, correct_text, explanation")
          .in("attempt_question_id", aqIds);

        if (Array.isArray(keyRows)) {
          studyAnswerKeys = {};
          for (const row of keyRows) {
            studyAnswerKeys[row.attempt_question_id] = {
              correct_option_id: row.correct_option_id,
              correct_text: row.correct_text,
              explanation: row.explanation,
            };
          }
        }
      }
    }

    return jsonResponse(
      {
        success: true,
        ...attemptData,
        questions,
        ...(studyAnswerKeys ? { study_answer_keys: studyAnswerKeys } : {}),
      },
      201,
      req,
    );
  } catch (err) {
    return errorResponse(err, req);
  }
});

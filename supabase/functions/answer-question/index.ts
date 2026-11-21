// ============================================================================
// EDGE FUNCTION 4: answer-question
// Endpoint: POST /functions/v1/answer-question
// Request:
// {
//   "attempt_id": "UUID",
//   "attempt_question_id": "UUID",
//   "selected_option_id": "UUID"
// }
// Behavior by mode:
//   - Study Mode ("immediate"): checks answer key on server, returns is_correct,
//     correct_option_id, correct_text, and explanation immediately.
//   - Practice Mode: saves response only; does NOT reveal correctness or answer key.
//   - Exam Mode: saves response only; does NOT reveal correctness or answer key.
// ============================================================================

import { handleCorsPreflight } from "../_shared/cors.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/response.ts";
import { requireAuth } from "../_shared/auth.ts";
import {
  isValidUuid,
  MULTI_SELECTED_PREFIX,
  parseMultiAnswerLabels,
  requireUuid,
} from "../_shared/validation.ts";

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
    const { user, adminClient } = await requireAuth(req, { skipProfileLookup: true });

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new AppError("Request body phải là JSON hợp lệ.", 400, "INVALID_JSON_BODY");
    }

    const payload = body as Record<string, unknown>;
    const attemptId = requireUuid(payload.attempt_id, "attempt_id");
    const attemptQuestionId = requireUuid(
      payload.attempt_question_id,
      "attempt_question_id",
    );

    const hasMultiIds = Array.isArray(payload.selected_option_ids);
    const selectedOptionIds: string[] = hasMultiIds
      ? Array.from(
          new Set(
            (payload.selected_option_ids as unknown[])
              .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
              .map((v) => requireUuid(v, "selected_option_ids[]")),
          ),
        )
      : [];

    const selectedOptionId =
      payload.selected_option_id === null ||
      payload.selected_option_id === undefined ||
      payload.selected_option_id === ""
        ? null
        : requireUuid(payload.selected_option_id, "selected_option_id");

    const answerText =
      typeof payload.answer_text === "string" ? payload.answer_text.trim() : null;

    // 1. Fetch attempt, attempt_question, and (if study) answer_key in PARALLEL for minimum latency
    const [
      { data: attempt, error: attemptError },
      { data: attemptQuestion, error: aqError },
      { data: answerKey, error: akError },
    ] = await Promise.all([
      adminClient
        .from("attempts")
        .select("id, user_id, status, attempt_type, time_limit_seconds, started_at")
        .eq("id", attemptId)
        .maybeSingle(),
      adminClient
        .from("attempt_questions")
        .select("id, attempt_id, options_snapshot")
        .eq("id", attemptQuestionId)
        .eq("attempt_id", attemptId)
        .maybeSingle(),
      adminClient
        .from("attempt_answer_keys")
        .select("correct_option_id, correct_text, explanation")
        .eq("attempt_question_id", attemptQuestionId)
        .maybeSingle(),
    ]);

    if (attemptError || !attempt) {
      throw new AppError("Không tìm thấy lượt làm bài.", 404, "ATTEMPT_NOT_FOUND");
    }

    if (attempt.user_id !== user.id) {
      throw new AppError(
        "Bạn không có quyền gửi câu trả lời cho lượt làm bài của người khác.",
        403,
        "FORBIDDEN_NOT_ATTEMPT_OWNER",
      );
    }

    if (attempt.status !== "in_progress") {
      throw new AppError(
        `Lượt làm bài đã kết thúc (trạng thái: ${attempt.status}). Không thể thay đổi câu trả lời.`,
        400,
        "ATTEMPT_ALREADY_CLOSED",
      );
    }

    // 2. Verify server time against time_limit_seconds
    if (attempt.time_limit_seconds !== null && attempt.time_limit_seconds > 0) {
      const startedAtMs = new Date(attempt.started_at).getTime();
      const elapsedSeconds = Math.floor((Date.now() - startedAtMs) / 1000);

      if (elapsedSeconds > attempt.time_limit_seconds + 5) {
        await adminClient.rpc("rpc_submit_attempt", {
          p_user_id: user.id,
          p_attempt_id: attemptId,
        });

        throw new AppError(
          "Đã hết thời gian làm bài theo giờ máy chủ. Bài thi đã được tự động thu.",
          400,
          "ATTEMPT_TIME_EXPIRED",
        );
      }
    }

    if (aqError || !attemptQuestion) {
      throw new AppError(
        "Câu hỏi không thuộc lượt làm bài này.",
        400,
        "QUESTION_NOT_IN_ATTEMPT",
      );
    }

    // 4. Verify selected option(s) belong to this attempt_question's options_snapshot
    const optionsSnapshot = Array.isArray(attemptQuestion.options_snapshot)
      ? (attemptQuestion.options_snapshot as Array<{ id?: string; option_label?: string }>)
      : [];
    const validOptionIdsSet = new Set(
      optionsSnapshot
        .map((opt) => (typeof opt?.id === "string" && isValidUuid(opt.id) ? opt.id.toLowerCase() : ""))
        .filter(Boolean),
    );

    const multiCorrectLabels = parseMultiAnswerLabels(answerKey?.correct_text);
    const isMultiSelect = Boolean(multiCorrectLabels && multiCorrectLabels.length > 1);

    const effectiveSelectedIds = hasMultiIds
      ? selectedOptionIds
      : selectedOptionId
      ? [selectedOptionId]
      : [];

    for (const optId of effectiveSelectedIds) {
      if (!validOptionIdsSet.has(optId.toLowerCase())) {
        throw new AppError(
          "Phương án lựa chọn không thuộc câu hỏi này.",
          400,
          "OPTION_NOT_IN_QUESTION",
        );
      }
    }

    // Compute canonical correct option IDs for multi-select questions
    const correctOptionIds = isMultiSelect
      ? optionsSnapshot
          .filter((opt) =>
            multiCorrectLabels!.includes(String(opt.option_label || "").trim().toUpperCase()),
          )
          .map((opt) => String(opt.id))
          .filter(Boolean)
      : answerKey?.correct_option_id
      ? [answerKey.correct_option_id]
      : [];

    const isMultiExactMatch =
      isMultiSelect &&
      effectiveSelectedIds.length === correctOptionIds.length &&
      correctOptionIds.length > 0 &&
      correctOptionIds.every((cid) =>
        effectiveSelectedIds.some((sid) => sid.toLowerCase() === cid.toLowerCase()),
      );

    // For multi-select: store exact selected UUIDs in `answer_text` with MULTI_IDS: prefix,
    // and set `selected_option_id` to `answerKey.correct_option_id` ONLY when the entire set matches
    // so `rpc_submit_attempt` grades multi-select accurately with zero schema changes!
    const dbSelectedOptionId = isMultiSelect
      ? isMultiExactMatch
        ? answerKey?.correct_option_id ?? null
        : null
      : selectedOptionId;

    const dbAnswerText = isMultiSelect
      ? effectiveSelectedIds.length > 0
        ? `${MULTI_SELECTED_PREFIX}${effectiveSelectedIds.join(",")}`
        : null
      : answerText;

    // 5. Save or update response in attempt_responses
    const answeredAt = new Date().toISOString();
    const { error: upsertError } = await adminClient
      .from("attempt_responses")
      .upsert(
        {
          attempt_id: attemptId,
          attempt_question_id: attemptQuestionId,
          selected_option_id: dbSelectedOptionId,
          answer_text: dbAnswerText,
          answered_at: answeredAt,
        },
        {
          onConflict: "attempt_id,attempt_question_id",
        },
      );

    if (upsertError) {
      throw new AppError(
        `Không thể lưu câu trả lời: ${upsertError.message}`,
        500,
        "SAVE_RESPONSE_FAILED",
      );
    }

    // 6. Mode-specific return payload
    if (attempt.attempt_type === "study") {
      // Study Mode (Rule 3.2: immediate): answerKey was already fetched in parallel above
      if (akError || !answerKey) {
        throw new AppError(
          "Không tìm thấy đáp án của câu hỏi để đối chiếu.",
          500,
          "ANSWER_KEY_MISSING",
        );
      }

      const isCorrect = isMultiSelect
        ? isMultiExactMatch
        : selectedOptionId !== null &&
          answerKey.correct_option_id !== null &&
          selectedOptionId.toLowerCase() === answerKey.correct_option_id.toLowerCase();

      return jsonResponse(
        {
          success: true,
          saved: true,
          attempt_id: attemptId,
          attempt_question_id: attemptQuestionId,
          selected_option_id: dbSelectedOptionId,
          selected_option_ids: effectiveSelectedIds,
          answered_at: answeredAt,
          feedback: {
            is_correct: isCorrect,
            is_multi_select: isMultiSelect,
            correct_option_id: answerKey.correct_option_id,
            correct_option_ids: correctOptionIds,
            correct_labels: multiCorrectLabels || [],
            correct_text: answerKey.correct_text,
            explanation: answerKey.explanation,
          },
        },
        200,
        req,
      );
    }

    // Practice & Exam Mode (Rules 3.3 & 3.4): ONLY confirm save, NEVER reveal answer key before submit
    return jsonResponse(
      {
        success: true,
        saved: true,
        attempt_id: attemptId,
        attempt_question_id: attemptQuestionId,
        selected_option_id: isMultiSelect ? null : selectedOptionId,
        selected_option_ids: effectiveSelectedIds,
        answered_at: answeredAt,
      },
      200,
      req,
    );
  } catch (err) {
    return errorResponse(err, req);
  }
});

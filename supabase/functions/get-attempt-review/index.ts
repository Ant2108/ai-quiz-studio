// ============================================================================
// EDGE FUNCTION 6: get-attempt-review
// Endpoint: POST /functions/v1/get-attempt-review
// Request:  { "attempt_id": "UUID" }
// Rules:
//   - Only the attempt owner (or Admin) can access.
//   - ONLY accessible after attempt.status is 'submitted' or 'expired'.
//   - Returns questions, options, user's selected_option_id, correct_option_id,
//     is_correct, and explanation.
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
    const { user, profile, adminClient } = await requireAuth(req);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new AppError("Request body phải là JSON hợp lệ.", 400, "INVALID_JSON_BODY");
    }

    const attemptId = requireUuid(
      (body as Record<string, unknown>).attempt_id,
      "attempt_id",
    );

    // 1. Fetch attempt + quiz_set metadata
    const { data: attempt, error: attemptError } = await adminClient
      .from("attempts")
      .select(
        "*, quiz_sets(id, title, subject, topic, difficulty, default_exam_questions, default_exam_duration)",
      )
      .eq("id", attemptId)
      .maybeSingle();

    if (attemptError || !attempt) {
      throw new AppError("Không tìm thấy lượt làm bài.", 404, "ATTEMPT_NOT_FOUND");
    }

    if (attempt.user_id !== user.id && profile.role !== "admin") {
      throw new AppError(
        "Bạn không có quyền xem kết quả bài làm của người khác.",
        403,
        "FORBIDDEN_NOT_ATTEMPT_OWNER",
      );
    }

    // 2. Strictly enforce status check: must be 'submitted' or 'expired'
    if (attempt.status !== "submitted" && attempt.status !== "expired") {
      throw new AppError(
        "Chỉ được phép xem đáp án và giải thích sau khi đã nộp bài (submitted) hoặc hết giờ (expired).",
        403,
        "ATTEMPT_NOT_SUBMITTED",
      );
    }

    // 3. Fetch snapshot questions
    const { data: questions, error: qError } = await adminClient
      .from("attempt_questions")
      .select(
        "id, attempt_id, question_id, position, question_text, question_type, explanation_snapshot, formula_latex_snapshot, image_path_snapshot, options_snapshot",
      )
      .eq("attempt_id", attemptId)
      .order("position", { ascending: true });

    if (qError || !questions) {
      throw new AppError(
        "Không thể tải danh sách câu hỏi của lượt làm bài.",
        500,
        "LOAD_QUESTIONS_FAILED",
      );
    }

    // 4. Fetch user responses
    const { data: responses } = await adminClient
      .from("attempt_responses")
      .select("attempt_question_id, selected_option_id, answer_text, answered_at")
      .eq("attempt_id", attemptId);

    const responseMap = new Map<
      string,
      {
        selected_option_id: string | null;
        answer_text: string | null;
        answered_at: string | null;
      }
    >();
    for (const r of responses || []) {
      responseMap.set(r.attempt_question_id, r);
    }

    // 5. Fetch answer keys from server-only attempt_answer_keys
    const questionIds = questions.map((q) => q.id);
    const { data: answerKeys } = await adminClient
      .from("attempt_answer_keys")
      .select("attempt_question_id, correct_option_id, correct_text, explanation")
      .in(
        "attempt_question_id",
        questionIds.length > 0
          ? questionIds
          : ["00000000-0000-0000-0000-000000000000"],
      );

    const answerKeyMap = new Map<
      string,
      {
        correct_option_id: string | null;
        correct_text: string | null;
        explanation: string | null;
      }
    >();
    for (const ak of answerKeys || []) {
      answerKeyMap.set(ak.attempt_question_id, ak);
    }

    // 6. Merge review items and sign any private asset URLs
    const reviewItems = [];
    for (const q of questions) {
      const userResp = responseMap.get(q.id);
      const ak = answerKeyMap.get(q.id);

      const selectedOptionId = userResp?.selected_option_id ?? null;
      const correctOptionId = ak?.correct_option_id ?? null;

      const isAnswered =
        selectedOptionId !== null ||
        Boolean(userResp?.answer_text && userResp.answer_text.trim() !== "");

      const isCorrect =
        isAnswered &&
        correctOptionId !== null &&
        selectedOptionId !== null &&
        selectedOptionId.toLowerCase() === correctOptionId.toLowerCase();

      let imageUrl: string | null = null;
      if (q.image_path_snapshot) {
        if (q.image_path_snapshot.startsWith("http")) {
          imageUrl = q.image_path_snapshot;
        } else {
          const { data: signed } = await adminClient.storage
            .from("question-assets")
            .createSignedUrl(q.image_path_snapshot, 3600);
          imageUrl = signed?.signedUrl ?? null;
        }
      }

      reviewItems.push({
        attempt_question_id: q.id,
        question_id: q.question_id,
        position: q.position,
        question_text: q.question_text,
        question_type: q.question_type,
        formula_latex: q.formula_latex_snapshot,
        image_path: q.image_path_snapshot,
        image_url: imageUrl,
        options: Array.isArray(q.options_snapshot) ? q.options_snapshot : [],
        selected_option_id: selectedOptionId,
        answer_text: userResp?.answer_text ?? null,
        answered_at: userResp?.answered_at ?? null,
        correct_option_id: correctOptionId,
        correct_text: ak?.correct_text ?? null,
        explanation: ak?.explanation ?? q.explanation_snapshot ?? null,
        is_answered: isAnswered,
        is_correct: isCorrect,
      });
    }

    const unansweredCount = Math.max(
      0,
      attempt.total_questions - attempt.answered_count,
    );
    const wrongCount = Math.max(
      0,
      attempt.answered_count - attempt.correct_count,
    );

    return jsonResponse(
      {
        success: true,
        attempt: {
          id: attempt.id,
          user_id: attempt.user_id,
          quiz_set_id: attempt.quiz_set_id,
          quiz_set: attempt.quiz_sets,
          attempt_type: attempt.attempt_type,
          status: attempt.status,
          total_questions: attempt.total_questions,
          answered_count: attempt.answered_count,
          correct_count: attempt.correct_count,
          wrong_count: wrongCount,
          unanswered_count: unansweredCount,
          score: Number(attempt.score),
          time_limit_seconds: attempt.time_limit_seconds,
          duration_seconds: attempt.duration_seconds,
          shuffle_questions: attempt.shuffle_questions,
          shuffle_options: attempt.shuffle_options,
          started_at: attempt.started_at,
          submitted_at: attempt.submitted_at,
        },
        questions: reviewItems,
      },
      200,
      req,
    );
  } catch (err) {
    return errorResponse(err, req);
  }
});

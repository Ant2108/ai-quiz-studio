// ============================================================================
// SERVICE: LEARNING & EXAM ATTEMPTS (Study, Practice, Exam, Results & Progress)
// Rules:
//   - All creation, answer submission, grading, and answer key review go
//     through Edge Functions (`start-attempt`, `answer-question`, `submit-attempt`, `get-attempt-review`).
//   - Never reads `question_answers` or `attempt_answer_keys` directly from client.
// ============================================================================

import { invokeEdgeFunction, supabase } from "./supabaseClient.js";

export const attemptService = {
  /**
   * Starts a new Study, Practice, or Exam attempt via Edge Function `start-attempt`.
   */
  async startAttempt({
    quizSetId,
    attemptType,
    questionCount = null,
    timeLimitSeconds = null,
    shuffleQuestions = false,
    shuffleOptions = false,
  }) {
    return await invokeEdgeFunction("start-attempt", {
      quiz_set_id: quizSetId,
      attempt_type: attemptType,
      question_count: questionCount,
      time_limit_seconds: timeLimitSeconds,
      shuffle_questions: Boolean(shuffleQuestions),
      shuffle_options: Boolean(shuffleOptions),
    });
  },

  /**
   * Sends a user's selected option for a question via Edge Function `answer-question`.
   * - In Study Mode: returns immediate feedback (`feedback: { is_correct, correct_option_id, explanation }`).
   * - In Practice / Exam Mode: only saves the answer (`saved: true`).
   */
  async answerQuestion({
    attemptId,
    attemptQuestionId,
    selectedOptionId,
    answerText = null,
  }) {
    return await invokeEdgeFunction("answer-question", {
      attempt_id: attemptId,
      attempt_question_id: attemptQuestionId,
      selected_option_id: selectedOptionId,
      answer_text: answerText,
    });
  },

  /**
   * Submits an attempt for server-side grading via Edge Function `submit-attempt`.
   * Idempotent and locked with SELECT ... FOR UPDATE on the database.
   */
  async submitAttempt(attemptId) {
    const response = await invokeEdgeFunction("submit-attempt", {
      attempt_id: attemptId,
    });
    return response.result || response;
  },

  /**
   * Retrieves the full graded review (questions, user selections, correct answers, explanations)
   * via Edge Function `get-attempt-review`. Only works after status is 'submitted' or 'expired'.
   */
  async getAttemptReview(attemptId) {
    return await invokeEdgeFunction("get-attempt-review", {
      attempt_id: attemptId,
    });
  },

  /**
   * Loads an in-progress attempt along with its snapshot questions and saved responses
   * (without answer keys!) so the user can resume if they refresh the page during an attempt.
   */
  async getActiveAttemptSession(attemptId) {
    const { data: attempt, error: attemptError } = await supabase
      .from("attempts")
      .select("*, quiz_sets(id, title, subject, difficulty)")
      .eq("id", attemptId)
      .single();

    if (attemptError || !attempt) {
      throw new Error("Không tìm thấy phiên làm bài.");
    }

    const { data: questions, error: qError } = await supabase
      .from("attempt_questions")
      .select(
        "id, attempt_id, question_id, position, question_text, question_type, formula_latex_snapshot, image_path_snapshot, options_snapshot",
      )
      .eq("attempt_id", attemptId)
      .order("position", { ascending: true });

    if (qError) throw qError;

    const { data: responses } = await supabase
      .from("attempt_responses")
      .select("attempt_question_id, selected_option_id, answer_text, answered_at")
      .eq("attempt_id", attemptId);

    const savedResponsesMap = {};
    for (const r of responses || []) {
      savedResponsesMap[r.attempt_question_id] = r.selected_option_id;
    }

    return {
      attempt,
      questions: (questions || []).map((q) => ({
        attempt_question_id: q.id,
        question_id: q.question_id,
        position: q.position,
        question_text: q.question_text,
        question_type: q.question_type,
        formula_latex: q.formula_latex_snapshot,
        image_path: q.image_path_snapshot,
        options: Array.isArray(q.options_snapshot) ? q.options_snapshot : [],
      })),
      savedResponses: savedResponsesMap,
    };
  },

  /**
   * Lists the current user's attempt history.
   */
  async listMyAttempts({ limit = 50, attemptType = "", status = "" } = {}) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    let query = supabase
      .from("attempts")
      .select("*, quiz_sets(id, title, subject, topic, difficulty)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (attemptType && attemptType !== "all") {
      query = query.eq("attempt_type", attemptType);
    }
    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Computes aggregated learning progress & statistics for Dashboard and My Progress pages.
   */
  async getMyProgressSummary() {
    const attempts = await this.listMyAttempts({ limit: 200 });
    const completed = attempts.filter(
      (a) => a.status === "submitted" || a.status === "expired",
    );

    const totalAttempts = completed.length;
    const examAttempts = completed.filter((a) => a.attempt_type === "exam");
    const practiceAttempts = completed.filter((a) => a.attempt_type === "practice");
    const studyAttempts = attempts.filter((a) => a.attempt_type === "study");

    const scores = completed.map((a) => Number(a.score || 0));
    const averageScore =
      scores.length > 0
        ? Number(
            (scores.reduce((sum, s) => sum + s, 0) / scores.length).toFixed(2),
          )
        : 0;
    const highestScore =
      scores.length > 0 ? Number(Math.max(...scores).toFixed(2)) : 0;

    const totalQuestionsAnswered = completed.reduce(
      (sum, a) => sum + Number(a.answered_count || 0),
      0,
    );
    const totalCorrectAnswers = completed.reduce(
      (sum, a) => sum + Number(a.correct_count || 0),
      0,
    );
    const totalDurationSeconds = completed.reduce(
      (sum, a) => sum + Number(a.duration_seconds || 0),
      0,
    );

    const accuracyPercent =
      totalQuestionsAnswered > 0
        ? Number(
            ((totalCorrectAnswers / totalQuestionsAnswered) * 100).toFixed(1),
          )
        : 0;

    return {
      totalAttempts,
      examCount: examAttempts.length,
      practiceCount: practiceAttempts.length,
      studyCount: studyAttempts.length,
      averageScore,
      highestScore,
      totalQuestionsAnswered,
      totalCorrectAnswers,
      totalDurationSeconds,
      accuracyPercent,
      recentAttempts: attempts.slice(0, 10),
      allAttempts: attempts,
    };
  },
};

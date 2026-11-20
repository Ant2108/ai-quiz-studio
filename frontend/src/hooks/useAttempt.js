import { useCallback, useState } from "react";
import { attemptService } from "../services/attemptService.js";

export function useAttempt() {
  const [attempt, setAttempt] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [responses, setResponses] = useState({});
  const [studyFeedback, setStudyFeedback] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const startAttempt = useCallback(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const res = await attemptService.startAttempt(params);
      setAttempt({
        id: res.attempt_id,
        quiz_set_id: res.quiz_set_id,
        quiz_title: res.quiz_title,
        attempt_type: res.attempt_type,
        status: res.status,
        total_questions: res.total_questions,
        time_limit_seconds: res.time_limit_seconds,
        started_at: res.started_at,
      });
      setQuestions(res.questions || []);
      setResponses({});
      setStudyFeedback({});
      return res;
    } catch (err) {
      setError(err.message || "Không thể bắt đầu lượt làm bài.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const answerQuestion = useCallback(
    async ({ attemptId, attemptQuestionId, selectedOptionId }) => {
      setResponses((prev) => ({
        ...prev,
        [attemptQuestionId]: selectedOptionId,
      }));

      const res = await attemptService.answerQuestion({
        attemptId,
        attemptQuestionId,
        selectedOptionId,
      });

      if (res?.feedback) {
        setStudyFeedback((prev) => ({
          ...prev,
          [attemptQuestionId]: res.feedback,
        }));
      }

      return res;
    },
    [],
  );

  const submitAttempt = useCallback(async (attemptId) => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await attemptService.submitAttempt(attemptId);
      setAttempt((prev) => (prev ? { ...prev, ...result } : result));
      return result;
    } catch (err) {
      setError(err.message || "Không thể nộp bài.");
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, []);

  return {
    attempt,
    questions,
    responses,
    studyFeedback,
    loading,
    submitting,
    error,
    startAttempt,
    answerQuestion,
    submitAttempt,
    getAttemptReview: attemptService.getAttemptReview,
    getActiveAttemptSession: attemptService.getActiveAttemptSession,
    listMyAttempts: attemptService.listMyAttempts,
    getMyProgressSummary: attemptService.getMyProgressSummary,
  };
}

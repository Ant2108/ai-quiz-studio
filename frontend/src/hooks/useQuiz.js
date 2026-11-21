import { useCallback, useState } from "react";
import { quizService } from "../services/quizService.js";

export function useQuiz() {
  const [quizzes, setQuizzes] = useState([]);
  const [currentQuiz, setCurrentQuiz] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState(null);
  const [error, setError] = useState(null);

  const fetchPublicQuizzes = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const data = await quizService.listPublicQuizzes(filters);
      setQuizzes(data);
      return data;
    } catch (err) {
      setError(err.message || "Không thể tải danh sách bộ đề công khai.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMyQuizzes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await quizService.listMyQuizzes();
      setQuizzes(data);
      return data;
    } catch (err) {
      setError(err.message || "Không thể tải thư viện bộ đề của bạn.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchQuizDetail = useCallback(async (quizSetId) => {
    setLoading(true);
    setError(null);
    try {
      const data = await quizService.getQuizDetail(quizSetId);
      setCurrentQuiz(data);
      return data;
    } catch (err) {
      setError(err.message || "Không thể tải chi tiết bộ đề.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const generateQuiz = useCallback(async (params) => {
    setGenerating(true);
    setGenerateProgress({
      step: "starting",
      percent: 5,
      message: "Đang chuẩn bị tạo bộ đề bằng AI...",
    });
    setError(null);
    try {
      return await quizService.generateQuizFromDocument({
        ...params,
        onProgress: (info) => setGenerateProgress(info),
      });
    } catch (err) {
      setError(err.message || "Lỗi sinh câu hỏi bằng Gemini AI.");
      throw err;
    } finally {
      setGenerating(false);
    }
  }, []);

  const generateQuizFromJson = useCallback(async (params) => {
    setGenerating(true);
    setGenerateProgress({
      step: "starting",
      percent: 10,
      message: "Đang kiểm định JSON & tạo đề trực tiếp (0 Gemini calls)...",
    });
    setError(null);
    try {
      return await quizService.generateQuizFromJson({
        ...params,
        onProgress: (info) => setGenerateProgress(info),
      });
    } catch (err) {
      setError(err.message || "Lỗi tạo bộ đề từ JSON.");
      throw err;
    } finally {
      setGenerating(false);
    }
  }, []);

  return {
    quizzes,
    currentQuiz,
    loading,
    generating,
    generateProgress,
    error,
    fetchPublicQuizzes,
    fetchMyQuizzes,
    fetchQuizDetail,
    generateQuiz,
    generateQuizFromJson,
    createManualQuiz: quizService.createManualQuiz,
    getQuizForEditor: quizService.getQuizForEditor,
    updateQuizAndQuestions: quizService.updateQuizAndQuestions,
    submitForPublicApproval: quizService.submitForPublicApproval,
    makeQuizPrivate: quizService.makeQuizPrivate,
    softDeleteQuiz: quizService.softDeleteQuiz,
    upsertReview: quizService.upsertReview,
    deleteReview: quizService.deleteReview,
  };
}

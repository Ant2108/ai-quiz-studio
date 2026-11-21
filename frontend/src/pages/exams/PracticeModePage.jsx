import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { quizService } from "../../services/quizService.js";
import { attemptService } from "../../services/attemptService.js";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  ArrowRight,
  Layers,
  Shuffle,
  Send,
  Loader2,
  CheckCircle2,
} from "lucide-react";

const PRACTICE_COUNT_PRESETS = [
  { value: 20, label: "20 câu" },
  { value: 30, label: "30 câu" },
  { value: 50, label: "50 câu" },
  { value: 60, label: "60 câu" },
  { value: "all", label: "Toàn bộ câu hỏi" },
];

export function PracticeModePage() {
  const { id: quizSetId } = useParams();
  const [searchParams] = useSearchParams();
  const resumeAttemptId = searchParams.get("attemptId");
  const navigate = useNavigate();

  const [quizMeta, setQuizMeta] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [selectedCountChoice, setSelectedCountChoice] = useState("all");
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(false);

  const [attempt, setAttempt] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [responses, setResponses] = useState({});
  const [savingQuestionId, setSavingQuestionId] = useState(null);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    async function init() {
      setLoadingMeta(true);
      try {
        if (resumeAttemptId) {
          const session = await attemptService.getActiveAttemptSession(resumeAttemptId);
          if (!mounted) return;
          if (session.attempt.status !== "in_progress") {
            navigate(`/results/${resumeAttemptId}`, { replace: true });
            return;
          }
          setAttempt({
            attempt_id: session.attempt.id,
            quiz_title: session.attempt.quiz_sets?.title,
            total_questions: session.attempt.total_questions,
          });
          setQuestions(session.questions);
          setResponses(session.savedResponses || {});
        } else {
          const detail = await quizService.getQuizDetail(quizSetId);
          if (!mounted) return;
          setQuizMeta(detail);
        }
      } catch (err) {
        if (mounted) setError(err.message || "Không thể tải bộ đề.");
      } finally {
        if (mounted) setLoadingMeta(false);
      }
    }
    init();
    return () => {
      mounted = false;
    };
  }, [quizSetId, resumeAttemptId, navigate]);

  const handleStartPractice = async (e) => {
    e.preventDefault();
    setError("");
    setStarting(true);
    try {
      const qCount =
        selectedCountChoice === "all" ? null : Number(selectedCountChoice);

      const res = await attemptService.startAttempt({
        quizSetId,
        attemptType: "practice",
        questionCount: qCount,
        timeLimitSeconds: null,
        shuffleQuestions,
        shuffleOptions,
      });

      setAttempt(res);
      setQuestions(res.questions || []);
      setResponses({});
      setCurrentIndex(0);
    } catch (err) {
      setError(err.message || "Không thể bắt đầu Practice Mode.");
    } finally {
      setStarting(false);
    }
  };

  const handleSelectOption = async (optionId) => {
    if (!attempt || !questions[currentIndex]) return;
    const currentQ = questions[currentIndex];
    const aqId = currentQ.attempt_question_id;

    if (currentQ.is_multi_select) {
      const prevList = Array.isArray(responses[aqId]) ? responses[aqId] : [];
      const nextList = prevList.includes(optionId)
        ? prevList.filter((id) => id !== optionId)
        : [...prevList, optionId];

      setResponses((prev) => ({
        ...prev,
        [aqId]: nextList,
      }));
      setSavingQuestionId(aqId);

      try {
        await attemptService.answerQuestion({
          attemptId: attempt.attempt_id,
          attemptQuestionId: aqId,
          selectedOptionIds: nextList,
        });
      } catch (err) {
        toast.error(err.message || "Không thể lưu câu trả lời.");
      } finally {
        setSavingQuestionId(null);
      }
      return;
    }

    setResponses((prev) => ({
      ...prev,
      [aqId]: optionId,
    }));
    setSavingQuestionId(aqId);

    try {
      await attemptService.answerQuestion({
        attemptId: attempt.attempt_id,
        attemptQuestionId: aqId,
        selectedOptionId: optionId,
      });
    } catch (err) {
      toast.error(err.message || "Không thể lưu câu trả lời.");
    } finally {
      setSavingQuestionId(null);
    }
  };

  const confirmAndSubmit = async () => {
    if (!attempt || submitting) return;
    setSubmitting(true);
    try {
      await attemptService.submitAttempt(attempt.attempt_id);
      setConfirmOpen(false);
      navigate(`/results/${attempt.attempt_id}`, { replace: true });
    } catch (err) {
      toast.error(err.message || "Không thể nộp bài.");
      setSubmitting(false);
    }
  };

  if (loadingMeta) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  if (!attempt) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Link
          to={`/quiz/${quizSetId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" />
          <span>Quay lại Bộ đề</span>
        </Link>

        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="p-6 sm:p-8">
            <form onSubmit={handleStartPractice} className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="size-11 rounded-xl bg-[#B0FDE0]/35 text-[#333836] flex items-center justify-center">
                  <Layers className="size-5" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                    Cấu hình Practice Mode
                  </h1>
                  <p className="text-xs text-slate-500">
                    {quizMeta?.title} • Hiện có {quizMeta?.question_count || 0} câu hỏi
                  </p>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm"
                >
                  {error}
                </div>
              )}

              <div className="space-y-2.5">
                <label className="block text-sm font-semibold text-slate-800">
                  Số lượng câu hỏi muốn luyện tập
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {PRACTICE_COUNT_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setSelectedCountChoice(preset.value)}
                      className={`h-10 px-4 rounded-lg border text-sm font-semibold transition-colors cursor-pointer ${
                        selectedCountChoice === preset.value
                          ? "bg-[#333836] text-[#B0FDE0] text-white border-[#333836]/20"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-slate-100">
                <label className="flex items-center justify-between p-3.5 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50/70">
                  <div className="flex items-center gap-3">
                    <Shuffle className="size-4 text-[#333836]" />
                    <div>
                      <span className="text-sm font-semibold text-slate-800 block">
                        Trộn thứ tự câu hỏi ngẫu nhiên
                      </span>
                      <span className="text-xs text-slate-500">
                        Giúp tránh học vẹt theo vị trí câu
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={shuffleQuestions}
                    onChange={(e) => setShuffleQuestions(e.target.checked)}
                    className="size-4 accent-violet-600"
                  />
                </label>

                <label className="flex items-center justify-between p-3.5 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50/70">
                  <div className="flex items-center gap-3">
                    <Shuffle className="size-4 text-[#333836]" />
                    <div>
                      <span className="text-sm font-semibold text-slate-800 block">
                        Trộn thứ tự các phương án trả lời
                      </span>
                      <span className="text-xs text-slate-500">
                        Hoán đổi vị trí hiển thị các lựa chọn
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={shuffleOptions}
                    onChange={(e) => setShuffleOptions(e.target.checked)}
                    className="size-4 accent-violet-600"
                  />
                </label>
              </div>

              <Button
                type="submit"
                disabled={starting}
                className="w-full h-10 bg-[#333836] text-[#B0FDE0] hover:bg-[#262a28] text-white font-semibold"
              >
                {starting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Đang tạo đề luyện tập...</span>
                  </>
                ) : (
                  <span>Bắt đầu Luyện tập ngay</span>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const isResponseAnswered = (val) =>
    Array.isArray(val) ? val.length > 0 : Boolean(val);
  const answeredCount = Object.values(responses).filter(isResponseAnswered).length;
  const unansweredCount = questions.length - answeredCount;
  const progressPercent = Math.round((answeredCount / questions.length) * 100);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-8 space-y-5">
        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold uppercase text-[#333836]">
                  Practice Mode • Luyện tập
                </span>
                <h1 className="text-base sm:text-lg font-bold text-slate-900">
                  {attempt.quiz_title}
                </h1>
              </div>
              <span className="text-xs font-semibold text-slate-600 shrink-0">
                Đã làm: {answeredCount}/{questions.length}
              </span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </CardContent>
        </Card>

        {currentQuestion && (
          <Card className="border-slate-200/80 shadow-xs">
            <CardContent className="p-6 sm:p-8 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase text-[#333836]">
                    Câu hỏi {currentIndex + 1} / {questions.length}
                  </span>
                  {currentQuestion.is_multi_select && (
                    <span className="px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-semibold">
                      Chọn nhiều đáp án ({currentQuestion.required_answer_count || 2} đáp án)
                    </span>
                  )}
                </div>
                {savingQuestionId === currentQuestion.attempt_question_id && (
                  <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" />
                    Đang lưu...
                  </span>
                )}
              </div>

              <h2 className="text-lg sm:text-xl font-bold text-slate-900 leading-relaxed">
                {currentQuestion.question_text}
              </h2>

              {currentQuestion.formula_latex && (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 font-mono text-sm">
                  {currentQuestion.formula_latex}
                </div>
              )}

              {currentQuestion.image_url && (
                <img
                  src={currentQuestion.image_url}
                  alt="Minh họa"
                  className="max-h-64 rounded-lg border border-slate-200 object-contain"
                />
              )}

              <div className="space-y-2.5">
                {(currentQuestion.options || []).map((opt) => {
                  const currentVal = responses[currentQuestion.attempt_question_id];
                  const isSelected = Array.isArray(currentVal)
                    ? currentVal.includes(opt.id)
                    : currentVal === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectOption(opt.id)}
                      className={`w-full p-4 rounded-xl border-2 text-left transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                        isSelected
                          ? "border-[#333836]/20 bg-[#B0FDE0]/35 text-[#333836]"
                          : "border-slate-200 hover:border-[#333836]/20 bg-white"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`size-7 rounded-md text-xs font-bold flex items-center justify-center shrink-0 ${
                            isSelected
                              ? "bg-[#333836] text-[#B0FDE0] text-white"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {opt.option_label}
                        </span>
                        <span className="text-sm sm:text-base font-medium">
                          {opt.option_content}
                        </span>
                      </div>
                      {isSelected && (
                        <CheckCircle2 className="size-5 text-[#333836] shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                >
                  <ArrowLeft className="size-4" />
                  <span>Câu trước</span>
                </Button>

                {currentIndex < questions.length - 1 ? (
                  <Button
                    type="button"
                    onClick={() =>
                      setCurrentIndex((i) =>
                        Math.min(questions.length - 1, i + 1),
                      )
                    }
                    className="bg-[#333836] text-[#B0FDE0] hover:bg-[#262a28] text-white"
                  >
                    <span>Câu tiếp theo</span>
                    <ArrowRight className="size-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={submitting}
                    onClick={() => setConfirmOpen(true)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <Send className="size-4" />
                    <span>Nộp bài & Chấm điểm</span>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Navigation Palette */}
      <div className="lg:col-span-4">
        <Card className="border-slate-200/80 shadow-xs sticky top-20">
          <CardContent className="p-5 space-y-5">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Bảng điều hướng câu hỏi
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Đã chọn: {answeredCount} / {questions.length} câu
              </p>
            </div>

            <div className="grid grid-cols-5 sm:grid-cols-8 lg:grid-cols-5 gap-2 max-h-80 overflow-y-auto pr-1">
              {questions.map((q, idx) => {
                const isAnswered = isResponseAnswered(responses[q.attempt_question_id]);
                const isCurrent = idx === currentIndex;
                return (
                  <button
                    key={q.attempt_question_id}
                    type="button"
                    onClick={() => setCurrentIndex(idx)}
                    className={`h-9 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                      isCurrent
                        ? "ring-2 ring-[#333836] border-[#333836]/20 bg-[#B0FDE0]/35 text-[#333836]"
                        : isAnswered
                        ? "bg-[#333836] text-[#B0FDE0] text-white border-[#333836]/20"
                        : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <Button
              type="button"
              disabled={submitting}
              onClick={() => setConfirmOpen(true)}
              className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              <Send className="size-4" />
              <span>Nộp bài luyện tập</span>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Submit Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xác nhận nộp bài luyện tập</DialogTitle>
            <DialogDescription>
              {unansweredCount > 0
                ? `Bạn còn ${unansweredCount} câu chưa chọn đáp án. Bạn có chắc muốn nộp bài để máy chủ chấm điểm?`
                : "Bạn đã hoàn thành tất cả câu hỏi. Nhấn Xác nhận để chấm điểm ngay."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={submitting}
              onClick={() => setConfirmOpen(false)}
            >
              Làm tiếp
            </Button>
            <Button
              disabled={submitting}
              onClick={confirmAndSubmit}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              <span>Xác nhận nộp bài</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

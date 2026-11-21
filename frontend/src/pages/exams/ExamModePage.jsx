import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { quizService } from "../../services/quizService.js";
import { attemptService } from "../../services/attemptService.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Timer,
  Flag,
  Shuffle,
  Send,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

function formatCountdown(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function ExamModePage() {
  const { id: quizSetId } = useParams();
  const [searchParams] = useSearchParams();
  const resumeAttemptId = searchParams.get("attemptId");
  const navigate = useNavigate();

  const [quizMeta, setQuizMeta] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [useDefaultConfig, setUseDefaultConfig] = useState(true);
  const [customQuestionCount, setCustomQuestionCount] = useState(60);
  const [customDurationMinutes, setCustomDurationMinutes] = useState(60);
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);

  const [attempt, setAttempt] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [responses, setResponses] = useState({});
  const [flaggedIds, setFlaggedIds] = useState(() => new Set());
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");

  const autoSubmitTriggeredRef = useRef(false);

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
            time_limit_seconds: session.attempt.time_limit_seconds,
            started_at: session.attempt.started_at,
          });
          setQuestions(session.questions);
          setResponses(session.savedResponses || {});
        } else {
          const detail = await quizService.getQuizDetail(quizSetId);
          if (!mounted) return;
          setQuizMeta(detail);
          setCustomQuestionCount(
            Math.min(
              detail.default_exam_questions || 60,
              detail.question_count || 60,
            ),
          );
          setCustomDurationMinutes(detail.default_exam_duration || 60);
        }
      } catch (err) {
        if (mounted) setError(err.message || "Không thể tải thông tin đề thi.");
      } finally {
        if (mounted) setLoadingMeta(false);
      }
    }
    init();
    return () => {
      mounted = false;
    };
  }, [quizSetId, resumeAttemptId, navigate]);

  const executeSubmit = useCallback(
    async (isAutoExpired = false) => {
      if (!attempt || autoSubmitTriggeredRef.current) return;
      autoSubmitTriggeredRef.current = true;
      setSubmitting(true);
      try {
        await attemptService.submitAttempt(attempt.attempt_id);
        setConfirmOpen(false);
        navigate(`/results/${attempt.attempt_id}`, { replace: true });
      } catch (err) {
        autoSubmitTriggeredRef.current = false;
        setSubmitting(false);
        if (!isAutoExpired) {
          toast.error(err.message || "Không thể nộp bài thi.");
        }
      }
    },
    [attempt, navigate],
  );

  useEffect(() => {
    if (!attempt || !attempt.time_limit_seconds || !attempt.started_at) return;

    const startedMs = new Date(attempt.started_at).getTime();
    const limitSec = Number(attempt.time_limit_seconds);

    const updateTick = () => {
      const elapsedSec = Math.floor((Date.now() - startedMs) / 1000);
      const left = Math.max(0, limitSec - elapsedSec);
      setRemainingSeconds(left);

      if (left <= 0 && !autoSubmitTriggeredRef.current) {
        executeSubmit(true);
      }
    };

    updateTick();
    const intervalId = setInterval(updateTick, 1000);
    return () => clearInterval(intervalId);
  }, [attempt, executeSubmit]);

  const handleStartExam = async (e) => {
    e.preventDefault();
    setError("");
    setStarting(true);

    const totalAvail = quizMeta?.question_count || 60;
    const defaultQ = Math.min(quizMeta?.default_exam_questions || 60, totalAvail);
    const defaultDurMin = quizMeta?.default_exam_duration || 60;

    const finalQuestionCount = useDefaultConfig
      ? defaultQ
      : Math.min(Math.max(1, Number(customQuestionCount) || defaultQ), totalAvail);
    const finalTimeLimitSeconds =
      (useDefaultConfig
        ? defaultDurMin
        : Math.max(1, Number(customDurationMinutes) || defaultDurMin)) * 60;

    try {
      const res = await attemptService.startAttempt({
        quizSetId,
        attemptType: "exam",
        questionCount: finalQuestionCount,
        timeLimitSeconds: finalTimeLimitSeconds,
        shuffleQuestions,
        shuffleOptions,
      });

      autoSubmitTriggeredRef.current = false;
      setAttempt(res);
      setQuestions(res.questions || []);
      setResponses({});
      setFlaggedIds(new Set());
      setCurrentIndex(0);
    } catch (err) {
      setError(err.message || "Không thể bắt đầu bài thi.");
    } finally {
      setStarting(false);
    }
  };

  const handleSelectOption = async (optionId) => {
    if (!attempt || !questions[currentIndex] || submitting) return;
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

      try {
        await attemptService.answerQuestion({
          attemptId: attempt.attempt_id,
          attemptQuestionId: aqId,
          selectedOptionIds: nextList,
        });
      } catch (err) {
        if (err.code === "ATTEMPT_TIME_EXPIRED") {
          navigate(`/results/${attempt.attempt_id}`, { replace: true });
        }
      }
      return;
    }

    const nextOptionId = responses[aqId] === optionId ? null : optionId;

    setResponses((prev) => ({
      ...prev,
      [aqId]: nextOptionId,
    }));

    try {
      await attemptService.answerQuestion({
        attemptId: attempt.attempt_id,
        attemptQuestionId: aqId,
        selectedOptionId: nextOptionId,
      });
    } catch (err) {
      if (err.code === "ATTEMPT_TIME_EXPIRED") {
        navigate(`/results/${attempt.attempt_id}`, { replace: true });
      }
    }
  };

  const toggleFlagQuestion = (aqId) => {
    setFlaggedIds((prev) => {
      const next = new Set(prev);
      if (next.has(aqId)) next.delete(aqId);
      else next.add(aqId);
      return next;
    });
  };

  if (loadingMeta) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (!attempt) {
    const maxAvail = quizMeta?.question_count || 60;
    const defQ = Math.min(quizMeta?.default_exam_questions || 60, maxAvail);
    const defMin = quizMeta?.default_exam_duration || 60;

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
            <form onSubmit={handleStartExam} className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="size-11 rounded-xl bg-[#B0FDE0]/35 text-primary flex items-center justify-center">
                  <Timer className="size-5" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                    Thiết lập Phòng Thi thử (Exam Mode)
                  </h1>
                  <p className="text-xs text-slate-500">
                    {quizMeta?.title} • Ngân hàng đề có {maxAvail} câu
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setUseDefaultConfig(true)}
                  className={`p-4 rounded-xl border-2 text-left transition-colors cursor-pointer ${
                    useDefaultConfig
                      ? "border-primary bg-[#B0FDE0]/35"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <span className="text-xs font-bold uppercase text-primary block">
                    Cấu hình mặc định
                  </span>
                  <span className="text-base font-bold text-slate-900 mt-1 block">
                    {defQ} câu / {defMin} phút
                  </span>
                  <span className="text-xs text-slate-500 mt-0.5 block">
                    Theo thiết lập chuẩn của bộ đề
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setUseDefaultConfig(false)}
                  className={`p-4 rounded-xl border-2 text-left transition-colors cursor-pointer ${
                    !useDefaultConfig
                      ? "border-primary bg-[#B0FDE0]/35"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <span className="text-xs font-bold uppercase text-primary block">
                    Tùy chỉnh
                  </span>
                  <span className="text-base font-bold text-slate-900 mt-1 block">
                    Tự chọn số câu & thời gian
                  </span>
                  <span className="text-xs text-slate-500 mt-0.5 block">
                    Linh hoạt theo quỹ thời gian của bạn
                  </span>
                </button>
              </div>

              {!useDefaultConfig && (
                <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="space-y-1.5">
                    <Label htmlFor="ex-count" className="text-xs">
                      Số câu hỏi (Tối đa {maxAvail})
                    </Label>
                    <Input
                      id="ex-count"
                      type="number"
                      min={1}
                      max={maxAvail}
                      value={customQuestionCount}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") {
                          setCustomQuestionCount("");
                          return;
                        }
                        const parsed = parseInt(raw, 10);
                        if (!Number.isNaN(parsed)) setCustomQuestionCount(parsed);
                      }}
                      onBlur={() => {
                        if (customQuestionCount === "" || Number(customQuestionCount) < 1) {
                          setCustomQuestionCount(Math.min(60, maxAvail || 1));
                        }
                      }}
                      className="bg-white h-9 font-semibold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ex-dur" className="text-xs">
                      Thời gian làm bài (Phút)
                    </Label>
                    <Input
                      id="ex-dur"
                      type="number"
                      min={1}
                      max={300}
                      value={customDurationMinutes}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") {
                          setCustomDurationMinutes("");
                          return;
                        }
                        const parsed = parseInt(raw, 10);
                        if (!Number.isNaN(parsed)) setCustomDurationMinutes(parsed);
                      }}
                      onBlur={() => {
                        if (customDurationMinutes === "" || Number(customDurationMinutes) < 1) {
                          setCustomDurationMinutes(60);
                        }
                      }}
                      className="bg-white h-9 font-semibold"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2.5">
                <label className="flex items-center justify-between p-3.5 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50/70">
                  <div className="flex items-center gap-3">
                    <Shuffle className="size-4 text-primary" />
                    <div>
                      <span className="text-sm font-semibold text-slate-800 block">
                        Trộn thứ tự câu hỏi
                      </span>
                      <span className="text-xs text-slate-500">
                        Chọn và sắp xếp ngẫu nhiên từ ngân hàng câu hỏi
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={shuffleQuestions}
                    onChange={(e) => setShuffleQuestions(e.target.checked)}
                    className="size-4 accent-primary"
                  />
                </label>

                <label className="flex items-center justify-between p-3.5 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50/70">
                  <div className="flex items-center gap-3">
                    <Shuffle className="size-4 text-primary" />
                    <div>
                      <span className="text-sm font-semibold text-slate-800 block">
                        Trộn thứ tự đáp án
                      </span>
                      <span className="text-xs text-slate-500">
                        Đảo vị trí các lựa chọn trong mỗi câu hỏi
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={shuffleOptions}
                    onChange={(e) => setShuffleOptions(e.target.checked)}
                    className="size-4 accent-primary"
                  />
                </label>
              </div>

              <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="size-4 text-amber-600" />
                  <span>Quy chế tính điểm Exam Mode:</span>
                </p>
                <p>
                  • Điểm = <strong>(Số câu đúng / Tổng số câu) × 10</strong> (làm tròn tối đa 2 chữ số thập phân).
                </p>
                <p>
                  • Câu sai và bỏ trống tính 0 điểm. Tự động nộp bài khi hết thời gian.
                </p>
              </div>

              <Button
                type="submit"
                disabled={starting}
                className="w-full h-10 bg-[#333836] hover:bg-[#262a28] text-[#B0FDE0] font-semibold"
              >
                {starting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Đang khởi tạo đề thi...</span>
                  </>
                ) : (
                  <span>Bắt đầu tính giờ làm bài</span>
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
  const isCurrentFlagged =
    currentQuestion && flaggedIds.has(currentQuestion.attempt_question_id);
  const isLowTime = remainingSeconds !== null && remainingSeconds <= 60;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-8 space-y-5">
        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold uppercase text-primary">
                  Exam Mode • Phòng thi trực tuyến
                </span>
                <h1 className="text-base sm:text-lg font-bold text-slate-900">
                  {attempt.quiz_title}
                </h1>
              </div>

              <div
                className={`px-3.5 py-1.5 rounded-lg border font-mono text-base sm:text-lg font-bold inline-flex items-center gap-2 ${
                  isLowTime
                    ? "bg-rose-50 border-rose-300 text-rose-600 animate-pulse"
                    : "bg-[#B0FDE0]/35 border-[#333836]/20 text-[#333836]"
                }`}
              >
                <Timer className="size-4.5" />
                <span>
                  {remainingSeconds !== null
                    ? formatCountdown(remainingSeconds)
                    : "--:--"}
                </span>
              </div>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </CardContent>
        </Card>

        {currentQuestion && (
          <Card className="border-slate-200/80 shadow-xs">
            <CardContent className="p-6 sm:p-8 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase text-primary">
                    Câu hỏi {currentIndex + 1} / {questions.length}
                  </span>
                  {currentQuestion.is_multi_select && (
                    <span className="px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-semibold">
                      Chọn nhiều đáp án ({currentQuestion.required_answer_count || 2} đáp án)
                    </span>
                  )}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    toggleFlagQuestion(currentQuestion.attempt_question_id)
                  }
                  className={
                    isCurrentFlagged
                      ? "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100"
                      : ""
                  }
                >
                  <Flag
                    className={`size-3.5 ${
                      isCurrentFlagged ? "fill-amber-500 text-amber-500" : ""
                    }`}
                  />
                  <span>
                    {isCurrentFlagged ? "Đã đánh dấu" : "Đánh dấu xem lại"}
                  </span>
                </Button>
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
                          ? "border-primary bg-[#B0FDE0]/35 text-slate-950"
                          : "border-slate-200 hover:border-[#333836]/20 bg-white"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`size-7 rounded-md text-xs font-bold flex items-center justify-center shrink-0 ${
                            isSelected
                              ? "bg-[#333836] text-[#B0FDE0]"
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
                        <CheckCircle2 className="size-5 text-primary shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>

              <p className="text-xs text-slate-400">
                Mẹo: Nhấn lại vào phương án đã chọn nếu bạn muốn bỏ chọn câu hỏi này.
              </p>

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
                    <span>Nộp bài thi</span>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Exam Question Palette */}
      <div className="lg:col-span-4">
        <Card className="border-slate-200/80 shadow-xs sticky top-20">
          <CardContent className="p-5 space-y-5">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-900">
                Phiếu trả lời trắc nghiệm
              </h3>
              <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-500">
                <span>Đã làm: {answeredCount}/{questions.length}</span>
                <span>•</span>
                <span>Bỏ trống: {unansweredCount}</span>
                <span>•</span>
                <span className="text-amber-600 font-semibold">
                  Đánh dấu: {flaggedIds.size}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-5 sm:grid-cols-8 lg:grid-cols-5 gap-2 max-h-80 overflow-y-auto pr-1">
              {questions.map((q, idx) => {
                const isAnswered = isResponseAnswered(responses[q.attempt_question_id]);
                const isFlagged = flaggedIds.has(q.attempt_question_id);
                const isCurrent = idx === currentIndex;

                let cellCls =
                  "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100";
                if (isAnswered) {
                  cellCls = "bg-[#333836] text-[#B0FDE0] border-primary";
                }
                if (isFlagged) {
                  cellCls += " ring-2 ring-amber-400";
                }
                if (isCurrent) {
                  cellCls += " outline-2 outline-offset-1 outline-slate-900";
                }

                return (
                  <button
                    key={q.attempt_question_id}
                    type="button"
                    onClick={() => setCurrentIndex(idx)}
                    className={`relative h-9 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${cellCls}`}
                  >
                    {idx + 1}
                    {isFlagged && (
                      <span className="size-2 rounded-full bg-amber-400 absolute -top-0.5 -right-0.5" />
                    )}
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
              <span>Nộp bài thi (Submit Exam)</span>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Submit Exam Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xác nhận nộp bài thi</DialogTitle>
            <DialogDescription>
              {unansweredCount > 0
                ? `Bạn còn ${unansweredCount} câu bỏ trống. Sau khi nộp bài sẽ không thể thay đổi kết quả.`
                : "Sau khi nộp bài sẽ không thể thay đổi kết quả. Bạn có chắc chắn muốn nộp bài?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={submitting}
              onClick={() => setConfirmOpen(false)}
            >
              Quay lại làm tiếp
            </Button>
            <Button
              disabled={submitting}
              onClick={() => executeSubmit(false)}
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

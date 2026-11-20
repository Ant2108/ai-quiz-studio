import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { attemptService } from "../../services/attemptService.js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Zap,
  Loader2,
  HelpCircle,
  CheckCheck,
  Bookmark,
  BookmarkCheck,
} from "lucide-react";

export function StudyModePage() {
  const { id: quizSetId } = useParams();
  const navigate = useNavigate();

  const [attempt, setAttempt] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOptions, setSelectedOptions] = useState({});
  const [feedbackMap, setFeedbackMap] = useState({});
  const [knownKeysMap, setKnownKeysMap] = useState({});
  const [unlearnedIds, setUnlearnedIds] = useState([]);
  const [filterMode, setFilterMode] = useState("all"); // "all" | "unlearned"
  const [checkingOption, setCheckingOption] = useState(false);
  const [loading, setLoading] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");

  const startNewStudySession = useCallback(async () => {
    setLoading(true);
    setError("");
    setCurrentIndex(0);
    setSelectedOptions({});
    setFeedbackMap({});
    setKnownKeysMap({});
    setUnlearnedIds([]);
    setFilterMode("all");
    try {
      const res = await attemptService.startAttempt({
        quizSetId,
        attemptType: "study",
        questionCount: null,
        timeLimitSeconds: null,
        shuffleQuestions: false,
        shuffleOptions: false,
      });
      setAttempt(res);
      setQuestions(res.questions || []);
      if (res?.study_answer_keys) {
        setKnownKeysMap(res.study_answer_keys);
      }
    } catch (err) {
      setError(err.message || "Không thể khởi tạo phiên Ôn tập (Study Mode).");
    } finally {
      setLoading(false);
    }
  }, [quizSetId]);

  useEffect(() => {
    let active = true;
    async function initStudy() {
      try {
        const res = await attemptService.startAttempt({
          quizSetId,
          attemptType: "study",
          questionCount: null,
          timeLimitSeconds: null,
          shuffleQuestions: false,
          shuffleOptions: false,
        });
        if (!active) return;
        setAttempt(res);
        setQuestions(res.questions || []);
        if (res?.study_answer_keys) {
          setKnownKeysMap(res.study_answer_keys);
        }
      } catch (err) {
        if (active) {
          setError(err.message || "Không thể khởi tạo phiên Ôn tập (Study Mode).");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    initStudy();
    return () => {
      active = false;
    };
  }, [quizSetId]);

  const displayedQuestions =
    filterMode === "unlearned"
      ? questions.filter((q) => unlearnedIds.includes(q.attempt_question_id))
      : questions;

  const safeIndex = Math.min(currentIndex, Math.max(0, displayedQuestions.length - 1));
  const currentQuestion = displayedQuestions[safeIndex] || null;
  const currentFeedback = currentQuestion
    ? feedbackMap[currentQuestion.attempt_question_id]
    : null;
  const currentSelected = currentQuestion
    ? selectedOptions[currentQuestion.attempt_question_id]
    : null;
  const isCurrentUnlearned = currentQuestion
    ? unlearnedIds.includes(currentQuestion.attempt_question_id)
    : false;

  const applyFeedbackResult = (aqId, feedback) => {
    setFeedbackMap((prev) => ({ ...prev, [aqId]: feedback }));
    setKnownKeysMap((prev) => ({ ...prev, [aqId]: feedback }));
    if (feedback.is_correct) {
      setUnlearnedIds((prev) => prev.filter((id) => id !== aqId));
    } else {
      setUnlearnedIds((prev) => (prev.includes(aqId) ? prev : [...prev, aqId]));
    }
  };

  const handleSelectOption = async (optionId) => {
    if (!attempt || !currentQuestion || checkingOption) return;
    const aqId = currentQuestion.attempt_question_id;

    setSelectedOptions((prev) => ({
      ...prev,
      [aqId]: optionId,
    }));

    // Instant 0ms local verification if this question's answer key was already retrieved in this session (e.g. retrying)
    const knownKey = knownKeysMap[aqId];
    if (knownKey && knownKey.correct_option_id) {
      const isCorrect =
        optionId.toLowerCase() === knownKey.correct_option_id.toLowerCase();
      applyFeedbackResult(aqId, {
        ...knownKey,
        is_correct: isCorrect,
      });
      // Sync final selection to server in background
      attemptService
        .answerQuestion({
          attemptId: attempt.attempt_id,
          attemptQuestionId: aqId,
          selectedOptionId: optionId,
        })
        .catch(() => {});
      return;
    }

    setCheckingOption(true);
    try {
      const res = await attemptService.answerQuestion({
        attemptId: attempt.attempt_id,
        attemptQuestionId: aqId,
        selectedOptionId: optionId,
      });

      if (res?.feedback) {
        applyFeedbackResult(aqId, res.feedback);
      }
    } catch (err) {
      toast.error(err.message || "Không thể kiểm tra đáp án.");
    } finally {
      setCheckingOption(false);
    }
  };

  const handleRetryCurrentQuestion = () => {
    if (!currentQuestion) return;
    const aqId = currentQuestion.attempt_question_id;
    setSelectedOptions((prev) => {
      const next = { ...prev };
      delete next[aqId];
      return next;
    });
    setFeedbackMap((prev) => {
      const next = { ...prev };
      delete next[aqId];
      return next;
    });
  };

  const handleToggleUnlearned = (aqId) => {
    setUnlearnedIds((prev) =>
      prev.includes(aqId) ? prev.filter((id) => id !== aqId) : [...prev, aqId],
    );
  };

  const handleSwitchToUnlearnedMode = () => {
    if (unlearnedIds.length === 0) return;
    // Clear previous wrong selections/feedback for unlearned questions so user can re-answer cleanly
    setSelectedOptions((prev) => {
      const next = { ...prev };
      unlearnedIds.forEach((id) => delete next[id]);
      return next;
    });
    setFeedbackMap((prev) => {
      const next = { ...prev };
      unlearnedIds.forEach((id) => delete next[id]);
      return next;
    });
    setFilterMode("unlearned");
    setCurrentIndex(0);
  };

  const handleFinishSession = async () => {
    if (!attempt) return;
    setFinishing(true);
    try {
      await attemptService.submitAttempt(attempt.attempt_id);
      navigate(`/results/${attempt.attempt_id}`);
    } catch (err) {
      toast.error(err.message || "Không thể kết thúc phiên ôn tập.");
      setFinishing(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (error || questions.length === 0) {
    return (
      <Card className="max-w-xl mx-auto border-slate-200 p-10 text-center space-y-4">
        <p className="text-base font-semibold text-rose-600">
          {error || "Bộ đề chưa có câu hỏi nào để ôn tập."}
        </p>
        <div>
          <Link
            to={`/quiz/${quizSetId}`}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#333836] text-[#B0FDE0] text-sm font-semibold"
          >
            <ArrowLeft className="size-4" />
            <span>Quay lại Bộ đề</span>
          </Link>
        </div>
      </Card>
    );
  }

  const answeredCount = Object.keys(feedbackMap).length;
  const correctSoFar = Object.values(feedbackMap).filter(
    (f) => f?.is_correct,
  ).length;
  const progressPercent =
    displayedQuestions.length > 0
      ? Math.round(((safeIndex + 1) / displayedQuestions.length) * 100)
      : 100;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Focused Header */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardContent className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <Link
              to={`/quiz/${quizSetId}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 mb-1"
            >
              <ArrowLeft className="size-3.5" />
              <span>Thoát ôn tập</span>
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="bg-[#B0FDE0]/35 text-[#333836] border-[#333836]/20 rounded-md"
              >
                <Zap className="size-3 mr-1" />
                Study Mode
              </Badge>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate max-w-md">
                {attempt?.quiz_title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startNewStudySession}
            >
              <RotateCcw className="size-3.5" />
              <span>Làm lại</span>
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={finishing}
              onClick={handleFinishSession}
              className="bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836]"
            >
              {finishing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CheckCheck className="size-3.5" />
              )}
              <span>Hoàn tất & Lưu</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Progress & Filter Strip */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 p-1 rounded-lg bg-slate-100">
              <button
                type="button"
                onClick={() => {
                  setFilterMode("all");
                  setCurrentIndex(0);
                }}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  filterMode === "all"
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Tất cả ({questions.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  if (unlearnedIds.length > 0) {
                    handleSwitchToUnlearnedMode();
                  } else {
                    setFilterMode("unlearned");
                  }
                }}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
                  filterMode === "unlearned"
                    ? "bg-amber-500 text-white shadow-2xs"
                    : unlearnedIds.length > 0
                    ? "text-amber-700 hover:bg-amber-100/70"
                    : "text-slate-500"
                }`}
              >
                <Bookmark className="size-3" />
                <span>Chưa thuộc ({unlearnedIds.length})</span>
              </button>
            </div>

            <div className="text-xs font-semibold text-slate-600">
              Đã làm: {answeredCount}/{questions.length} • Đúng: {correctSoFar}
            </div>
          </div>

          {displayedQuestions.length > 0 && (
            <>
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>
                  {filterMode === "unlearned" ? "Đang ôn câu chưa thuộc: " : "Câu hỏi "}
                  {safeIndex + 1} / {displayedQuestions.length}
                </span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-2" />

              <div className="flex flex-wrap gap-1.5 pt-1">
                {displayedQuestions.map((q, idx) => {
                  const fb = feedbackMap[q.attempt_question_id];
                  const isUnlearned = unlearnedIds.includes(q.attempt_question_id);
                  const isCurrent = idx === safeIndex;
                  let btnCls = "bg-slate-100 text-slate-600 border-transparent";
                  if (fb) {
                    btnCls = fb.is_correct
                      ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                      : "bg-rose-100 text-rose-800 border-rose-300";
                  } else if (isUnlearned) {
                    btnCls = "bg-amber-100 text-amber-800 border-amber-300";
                  }
                  if (isCurrent) {
                    btnCls += " ring-2 ring-primary font-bold";
                  }
                  return (
                    <button
                      key={q.attempt_question_id}
                      type="button"
                      onClick={() => setCurrentIndex(idx)}
                      className={`size-8 rounded-md text-xs border transition-colors cursor-pointer ${btnCls}`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {filterMode === "unlearned" && displayedQuestions.length === 0 ? (
        <Card className="border-emerald-200 bg-emerald-50/50 shadow-xs p-8 text-center space-y-4">
          <CheckCircle2 className="size-10 text-emerald-600 mx-auto" />
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900">
              Bạn đã hoàn thành hết các câu chưa thuộc!
            </h2>
            <p className="text-sm text-slate-600">
              Không còn câu nào trong danh sách chưa thuộc. Bạn có thể quay lại xem toàn bộ bộ đề hoặc lưu kết quả.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFilterMode("all");
                setCurrentIndex(0);
              }}
            >
              Xem tất cả câu ({questions.length})
            </Button>
            <Button
              type="button"
              disabled={finishing}
              onClick={handleFinishSession}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCheck className="size-4" />
              <span>Hoàn tất & Lưu</span>
            </Button>
          </div>
        </Card>
      ) : currentQuestion ? (
        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="p-6 sm:p-8 space-y-6">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#333836]">
                  Câu hỏi #{safeIndex + 1}
                </span>
                <Button
                  type="button"
                  variant={isCurrentUnlearned ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => handleToggleUnlearned(currentQuestion.attempt_question_id)}
                  className={
                    isCurrentUnlearned
                      ? "bg-amber-100 text-amber-800 hover:bg-amber-200 h-7 text-xs"
                      : "text-slate-500 hover:text-amber-700 h-7 text-xs"
                  }
                >
                  {isCurrentUnlearned ? (
                    <>
                      <BookmarkCheck className="size-3.5" />
                      <span>Đang ở mục Chưa thuộc</span>
                    </>
                  ) : (
                    <>
                      <Bookmark className="size-3.5" />
                      <span>Đánh dấu chưa thuộc</span>
                    </>
                  )}
                </Button>
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 leading-relaxed">
                {currentQuestion.question_text}
              </h2>

            {currentQuestion.formula_latex && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 font-mono text-sm text-slate-800">
                {currentQuestion.formula_latex}
              </div>
            )}

            {currentQuestion.image_url && (
              <img
                src={currentQuestion.image_url}
                alt="Minh họa câu hỏi"
                className="max-h-64 rounded-lg border border-slate-200 object-contain"
              />
            )}
          </div>

          <div className="space-y-2.5">
            {(currentQuestion.options || []).map((opt) => {
              const isSelected = currentSelected === opt.id;
              const isCorrectOption =
                currentFeedback &&
                currentFeedback.correct_option_id &&
                currentFeedback.correct_option_id.toLowerCase() ===
                  opt.id.toLowerCase();
              const isWrongSelected =
                currentFeedback && isSelected && !currentFeedback.is_correct;

              let optionStyle =
                "border-slate-200 hover:border-[#333836]/20 hover:bg-[#B0FDE0]/35 bg-white";
              if (currentFeedback) {
                if (isCorrectOption) {
                  optionStyle =
                    "border-emerald-500 bg-emerald-50/70 text-emerald-950";
                } else if (isWrongSelected) {
                  optionStyle = "border-rose-500 bg-rose-50/70 text-rose-950";
                } else {
                  optionStyle = "border-slate-200 bg-slate-50/40 opacity-75";
                }
              } else if (isSelected) {
                optionStyle = "border-primary bg-[#B0FDE0]/35";
              }

              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={checkingOption}
                  onClick={() => handleSelectOption(opt.id)}
                  className={`w-full p-4 rounded-xl border-2 text-left transition-colors flex items-start justify-between gap-3 cursor-pointer ${optionStyle}`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`size-7 rounded-md text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 ${
                        isCorrectOption
                          ? "bg-emerald-600 text-white"
                          : isWrongSelected
                          ? "bg-rose-600 text-white"
                          : isSelected
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

                  {currentFeedback && isCorrectOption && (
                    <CheckCircle2 className="size-5 text-emerald-600 shrink-0 mt-0.5" />
                  )}
                  {currentFeedback && isWrongSelected && (
                    <XCircle className="size-5 text-rose-600 shrink-0 mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>

          {checkingOption && (
            <div className="flex items-center gap-2 text-xs font-medium text-primary">
              <Loader2 className="size-4 animate-spin" />
              <span>Máy chủ đang kiểm tra đáp án...</span>
            </div>
          )}

          {currentFeedback && (
            <div
              className={`p-4 rounded-xl border space-y-2 ${
                currentFeedback.is_correct
                  ? "bg-emerald-50/80 border-emerald-200 text-emerald-950"
                  : "bg-rose-50/80 border-rose-200 text-rose-950"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-sm">
                  {currentFeedback.is_correct ? (
                    <>
                      <CheckCircle2 className="size-5 text-emerald-600" />
                      <span>Chính xác! Bạn đã chọn đúng đáp án.</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="size-5 text-rose-600" />
                      <span>Chưa chính xác! Câu này đã được thêm vào mục Chưa thuộc.</span>
                    </>
                  )}
                </div>

                {!currentFeedback.is_correct && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleRetryCurrentQuestion}
                    className="h-7 px-2.5 text-xs bg-white border-rose-300 text-rose-700 hover:bg-rose-100"
                  >
                    <RotateCcw className="size-3" />
                    <span>Làm lại câu này ngay</span>
                  </Button>
                )}
              </div>

              {currentFeedback.explanation && (
                <div className="pt-2 border-t border-black/10 text-sm leading-relaxed flex items-start gap-2">
                  <HelpCircle className="size-4 shrink-0 mt-1 opacity-75" />
                  <div>
                    <span className="font-semibold">Giải thích: </span>
                    <span>{currentFeedback.explanation}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={safeIndex === 0}
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            >
              <ArrowLeft className="size-4" />
              <span>Câu trước</span>
            </Button>

            <div className="flex flex-wrap items-center gap-2">
              {safeIndex >= displayedQuestions.length - 1 &&
                filterMode === "all" &&
                unlearnedIds.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSwitchToUnlearnedMode}
                    className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                  >
                    <Bookmark className="size-4" />
                    <span>Ôn ngay {unlearnedIds.length} câu chưa thuộc</span>
                  </Button>
                )}

              {safeIndex < displayedQuestions.length - 1 ? (
                <Button
                  type="button"
                  onClick={() =>
                    setCurrentIndex((i) =>
                      Math.min(displayedQuestions.length - 1, i + 1),
                    )
                  }
                >
                  <span>Câu tiếp theo</span>
                  <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={finishing}
                  onClick={handleFinishSession}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <CheckCheck className="size-4" />
                  <span>Hoàn thành ôn tập</span>
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      ) : null}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useParams } from "react-router-dom";
import { attemptService } from "../../services/attemptService.js";
import { AttemptTypeBadge } from "../../components/ui/StatusBadge.jsx";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Trophy,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Clock,
  RotateCcw,
  ArrowLeft,
  HelpCircle,
  LayoutDashboard,
} from "lucide-react";

function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  if (mins === 0) return `${secs} giây`;
  return `${mins} phút ${secs} giây`;
}

export function ResultPage() {
  const { attemptId } = useParams();
  const [reviewData, setReviewData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let mounted = true;
    async function loadReview() {
      setLoading(true);
      setError("");
      try {
        const res = await attemptService.getAttemptReview(attemptId);
        if (!mounted) return;
        setReviewData(res);
      } catch (err) {
        if (mounted) {
          setError(
            err.message ||
              "Không thể tải kết quả bài làm. Đảm bảo bài làm đã được nộp.",
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadReview();
    return () => {
      mounted = false;
    };
  }, [attemptId]);

  const filteredQuestions = useMemo(() => {
    const list = reviewData?.questions || [];
    if (filter === "correct") return list.filter((q) => q.is_correct);
    if (filter === "wrong")
      return list.filter((q) => q.is_answered && !q.is_correct);
    if (filter === "unanswered") return list.filter((q) => !q.is_answered);
    return list;
  }, [reviewData, filter]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error || !reviewData?.attempt) {
    return (
      <Card className="max-w-xl mx-auto border-slate-200 p-10 text-center space-y-4">
        <p className="text-base font-semibold text-rose-600">
          {error || "Không tìm thấy kết quả."}
        </p>
        <div>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#333836] text-[#B0FDE0] text-sm font-semibold"
          >
            <ArrowLeft className="size-4" />
            <span>Về Dashboard</span>
          </Link>
        </div>
      </Card>
    );
  }

  const { attempt, questions } = reviewData;
  const formattedScore = Number(attempt.score || 0).toFixed(2);
  const accuracyPercent =
    attempt.total_questions > 0
      ? Math.round((attempt.correct_count / attempt.total_questions) * 100)
      : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <LayoutDashboard className="size-4" />
          <span>Back to Dashboard</span>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/quiz/${attempt.quiz_set_id}/${attempt.attempt_type}`}
            className="h-8 px-3.5 rounded-lg bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="size-3.5" />
            <span>Làm lại (Retry)</span>
          </Link>
          <Link
            to={`/quiz/${attempt.quiz_set_id}`}
            className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold inline-flex items-center"
          >
            Chi tiết bộ đề
          </Link>
          <Link
            to="/progress"
            className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold inline-flex items-center"
          >
            Lịch sử & Tiến độ
          </Link>
        </div>
      </div>

      {/* Score Summary Card */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardContent className="p-6 sm:p-8 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <AttemptTypeBadge type={attempt.attempt_type} />
                <Badge
                  variant="outline"
                  className={
                    attempt.status === "expired"
                      ? "bg-amber-50 text-amber-700 border-amber-200 rounded-md"
                      : "bg-emerald-50 text-emerald-700 border-emerald-200 rounded-md"
                  }
                >
                  {attempt.status === "expired"
                    ? "Hết giờ • Tự động thu bài"
                    : "Đã nộp bài"}
                </Badge>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                {attempt.quiz_set?.title || "Kết quả bài làm"}
              </h1>
              <p className="text-xs text-slate-500">
                Hoàn thành lúc:{" "}
                {attempt.submitted_at
                  ? new Date(attempt.submitted_at).toLocaleString("vi-VN")
                  : "—"}
              </p>
            </div>

            {/* Score & Accuracy Box */}
            <div className="flex items-center gap-4 p-5 rounded-xl bg-[#333836] text-white shrink-0">
              <Trophy className="size-9 text-amber-400" />
              <div>
                <span className="text-[11px] uppercase tracking-wider text-slate-300 block">
                  Điểm số • Độ chính xác {accuracyPercent}%
                </span>
                <span className="text-3xl sm:text-4xl font-extrabold">
                  {formattedScore}
                </span>
                <span className="text-xs text-slate-400 ml-1">/ 10.00</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-4 border-t border-slate-100">
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/70">
              <span className="text-xs text-slate-500 block">Tổng số câu</span>
              <span className="text-lg font-bold text-slate-900">
                {attempt.total_questions}
              </span>
            </div>

            <div className="p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-200/70">
              <span className="text-xs text-emerald-700 block">Câu đúng</span>
              <span className="text-lg font-bold text-emerald-700">
                {attempt.correct_count}
              </span>
            </div>

            <div className="p-3.5 rounded-lg bg-rose-50/70 border border-rose-200/70">
              <span className="text-xs text-rose-700 block">Câu sai</span>
              <span className="text-lg font-bold text-rose-700">
                {attempt.wrong_count}
              </span>
            </div>

            <div className="p-3.5 rounded-lg bg-amber-50/70 border border-amber-200/70">
              <span className="text-xs text-amber-700 block">Bỏ trống</span>
              <span className="text-lg font-bold text-amber-700">
                {attempt.unanswered_count}
              </span>
            </div>

            <div className="col-span-2 sm:col-span-1 p-3.5 rounded-lg bg-[#B0FDE0]/35 border border-[#333836]/20">
              <span className="text-xs text-[#333836] flex items-center gap-1">
                <Clock className="size-3.5" />
                Thời gian
              </span>
              <span className="text-sm font-bold text-[#333836] mt-0.5 block">
                {formatDuration(attempt.duration_seconds)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Review Filter Tabs */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">
            Chi tiết đáp án & Giải thích từng câu
          </h2>

          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList className="h-auto p-1 bg-slate-100 flex-wrap">
              <TabsTrigger value="all">Tất cả ({questions.length})</TabsTrigger>
              <TabsTrigger value="correct">
                Đúng ({attempt.correct_count})
              </TabsTrigger>
              <TabsTrigger value="wrong">Sai ({attempt.wrong_count})</TabsTrigger>
              <TabsTrigger value="unanswered">
                Bỏ trống ({attempt.unanswered_count})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="space-y-4">
          {filteredQuestions.map((q) => (
            <Card key={q.attempt_question_id} className="border-slate-200/80 shadow-xs">
              <CardContent className="p-5 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase text-primary">
                    Câu {q.position}
                  </span>

                  {q.is_correct ? (
                    <Badge
                      variant="outline"
                      className="bg-emerald-50 text-emerald-700 border-emerald-200 rounded-md"
                    >
                      <CheckCircle2 className="size-3.5 mr-1" />
                      Trả lời đúng
                    </Badge>
                  ) : q.is_answered ? (
                    <Badge
                      variant="outline"
                      className="bg-rose-50 text-rose-700 border-rose-200 rounded-md"
                    >
                      <XCircle className="size-3.5 mr-1" />
                      Trả lời sai
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="bg-amber-50 text-amber-700 border-amber-200 rounded-md"
                    >
                      <MinusCircle className="size-3.5 mr-1" />
                      Bỏ trống
                    </Badge>
                  )}
                </div>

                <p className="text-base font-bold text-slate-900 leading-relaxed">
                  {q.question_text}
                </p>

                {q.formula_latex && (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 font-mono text-xs">
                    {q.formula_latex}
                  </div>
                )}

                {q.image_url && (
                  <img
                    src={q.image_url}
                    alt="Minh họa"
                    className="max-h-60 rounded-lg border border-slate-200 object-contain"
                  />
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(q.options || []).map((opt) => {
                    const isUserPick =
                      q.selected_option_id &&
                      opt.id &&
                      q.selected_option_id.toLowerCase() === opt.id.toLowerCase();
                    const isCorrectOpt =
                      q.correct_option_id &&
                      opt.id &&
                      q.correct_option_id.toLowerCase() === opt.id.toLowerCase();

                    let boxCls = "border-slate-200 bg-slate-50/40 text-slate-700";
                    if (isCorrectOpt) {
                      boxCls =
                        "border-emerald-500 bg-emerald-50/80 text-emerald-950 font-semibold";
                    } else if (isUserPick && !isCorrectOpt) {
                      boxCls =
                        "border-rose-500 bg-rose-50/80 text-rose-950 font-semibold";
                    }

                    return (
                      <div
                        key={opt.id || opt.option_label}
                        className={`p-3.5 rounded-lg border-2 text-sm flex items-start justify-between gap-2 ${boxCls}`}
                      >
                        <div>
                          <strong className="mr-1.5">{opt.option_label}.</strong>
                          <span>{opt.option_content}</span>
                        </div>

                        <div className="shrink-0 flex items-center gap-1 text-xs">
                          {isCorrectOpt && (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                              <CheckCircle2 className="size-4" />
                              Đáp án đúng
                            </span>
                          )}
                          {isUserPick && !isCorrectOpt && (
                            <span className="inline-flex items-center gap-1 text-rose-700 font-bold">
                              <XCircle className="size-4" />
                              Bạn chọn
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {q.explanation && (
                  <div className="p-4 rounded-lg bg-[#B0FDE0]/35 border border-[#333836]/20 text-xs sm:text-sm text-slate-800 flex items-start gap-2.5">
                    <HelpCircle className="size-4.5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-[#333836]">Giải thích: </strong>
                      <span>{q.explanation}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

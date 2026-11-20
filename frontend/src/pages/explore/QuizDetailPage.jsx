import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../../hooks/useAuth.js";
import { useQuiz } from "../../hooks/useQuiz.js";
import {
  DifficultyBadge,
  ModerationBadge,
} from "../../components/ui/StatusBadge.jsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  BookOpen,
  Clock,
  Star,
  User,
  Zap,
  Layers,
  Timer,
  Edit3,
  Trash2,
  ArrowLeft,
  MessageSquare,
} from "lucide-react";

export function QuizDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const {
    currentQuiz,
    loading,
    error,
    fetchQuizDetail,
    upsertReview,
    deleteReview,
  } = useQuiz();

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      if (!id) return;
      const detail = await fetchQuizDetail(id);
      if (!active || !detail?.reviews || !user) return;
      const myReview = detail.reviews.find((r) => r.user_id === user.id);
      if (myReview) {
        setRating(myReview.rating);
        setComment(myReview.comment || "");
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [id, fetchQuizDetail, user]);

  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    setReviewError("");
    setSubmittingReview(true);
    try {
      await upsertReview(id, { rating, comment });
      toast.success("Đã lưu đánh giá của bạn.");
      await fetchQuizDetail(id);
    } catch (err) {
      setReviewError(err.message || "Không thể gửi đánh giá.");
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleDeleteMyReview = async (reviewId) => {
    if (!window.confirm("Bạn có chắc muốn xóa đánh giá này?")) return;
    try {
      await deleteReview(reviewId);
      setComment("");
      setRating(5);
      toast.success("Đã xóa đánh giá.");
      await fetchQuizDetail(id);
    } catch (err) {
      toast.error(err.message || "Không thể xóa đánh giá.");
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-44 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !currentQuiz) {
    return (
      <Card className="border-slate-200 p-10 text-center space-y-4">
        <p className="text-base font-semibold text-rose-600">
          {error || "Không tìm thấy bộ đề."}
        </p>
        <div>
          <Link
            to="/explore"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#333836] text-[#B0FDE0] text-sm font-semibold"
          >
            <ArrowLeft className="size-4" />
            <span>Quay lại Khám phá</span>
          </Link>
        </div>
      </Card>
    );
  }

  const isOwner = user && currentQuiz.user_id === user.id;
  const isPublicApproved =
    currentQuiz.visibility === "public" &&
    currentQuiz.moderation_status === "approved";

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/explore"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" />
          <span>Quay lại Khám phá</span>
        </Link>

        {isOwner && (
          <Link
            to={`/library/${currentQuiz.id}/edit`}
            className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Edit3 className="size-3.5" />
            <span>Chỉnh sửa bộ đề</span>
          </Link>
        )}
      </div>

      {/* Hero Info Card */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardContent className="p-6 sm:p-8 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {currentQuiz.subject && (
                <Badge
                  variant="secondary"
                  className="bg-[#B0FDE0]/35 text-[#333836] border-[#333836]/20 rounded-md font-semibold"
                >
                  {currentQuiz.subject}
                </Badge>
              )}
              {currentQuiz.topic && (
                <Badge variant="outline" className="rounded-md text-slate-600">
                  {currentQuiz.topic}
                </Badge>
              )}
              <DifficultyBadge difficulty={currentQuiz.difficulty} />
              <ModerationBadge
                visibility={currentQuiz.visibility}
                moderationStatus={currentQuiz.moderation_status}
              />
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-50 border border-amber-200/80 text-amber-800 text-xs font-semibold">
              <Star className="size-3.5 fill-amber-400 text-amber-400" />
              <span>
                {currentQuiz.avg_rating > 0
                  ? `${currentQuiz.avg_rating} / 5.0`
                  : "Chưa có đánh giá"}
              </span>
              <span className="text-amber-700/80">
                ({currentQuiz.review_count})
              </span>
            </div>
          </div>

          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              {currentQuiz.title}
            </h1>
            <p className="text-slate-600 text-sm sm:text-base mt-2 leading-relaxed">
              {currentQuiz.description || "Bộ đề luyện tập và thi thử trắc nghiệm."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-4 border-t border-slate-100 text-xs sm:text-sm text-slate-600">
            <div className="inline-flex items-center gap-2">
              <User className="size-4 text-primary" />
              <span>
                Người tạo:{" "}
                <strong className="text-slate-900">
                  {currentQuiz.creator?.display_name || "Người dùng"}
                </strong>
              </span>
            </div>
            <div className="inline-flex items-center gap-2">
              <BookOpen className="size-4 text-primary" />
              <span>
                Tổng số câu:{" "}
                <strong className="text-slate-900">
                  {currentQuiz.question_count} câu
                </strong>
              </span>
            </div>
            <div className="inline-flex items-center gap-2">
              <Clock className="size-4 text-primary" />
              <span>
                Thi chuẩn:{" "}
                <strong className="text-slate-900">
                  {Math.min(
                    currentQuiz.default_exam_questions,
                    currentQuiz.question_count || currentQuiz.default_exam_questions,
                  )}{" "}
                  câu / {currentQuiz.default_exam_duration} phút
                </strong>
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3 Learning & Exam Modes */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900">
          Chọn chế độ học và luyện thi
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Card className="border-slate-200/80 shadow-xs hover:border-[#333836]/20 transition-colors flex flex-col justify-between">
            <CardContent className="p-6 space-y-3">
              <div className="size-10 rounded-lg bg-[#B0FDE0]/35 text-[#333836] flex items-center justify-center">
                <Zap className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Study Mode — Ôn tập từng câu
                </h3>
                <p className="text-xs text-[#333836] font-semibold mt-0.5">
                  Phản hồi đáp án tức thời
                </p>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Hiển thị từng câu hỏi. Ngay sau khi chọn đáp án, server kiểm tra đúng/sai và hiện lời giải thích chi tiết.
              </p>
              <Link
                to={`/quiz/${currentQuiz.id}/study`}
                className="mt-4 w-full h-9 rounded-lg bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836] text-xs font-semibold flex items-center justify-center transition-colors"
              >
                Bắt đầu Study Mode
              </Link>
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 shadow-xs hover:border-[#333836]/20 transition-colors flex flex-col justify-between">
            <CardContent className="p-6 space-y-3">
              <div className="size-10 rounded-lg bg-[#B0FDE0]/35 text-[#333836] flex items-center justify-center">
                <Layers className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Practice Mode — Luyện tập
                </h3>
                <p className="text-xs text-[#333836] font-semibold mt-0.5">
                  20, 30, 50, 60 hoặc toàn bộ câu
                </p>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Làm nhiều câu với tùy chọn trộn thứ tự. Đáp án được bảo mật đến khi nhấn Submit để chấm điểm.
              </p>
              <Link
                to={`/quiz/${currentQuiz.id}/practice`}
                className="mt-4 w-full h-9 rounded-lg bg-[#333836] text-[#B0FDE0] hover:bg-[#262a28] text-white text-xs font-semibold flex items-center justify-center transition-colors"
              >
                Bắt đầu Practice Mode
              </Link>
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 shadow-xs hover:border-[#333836]/20 transition-colors flex flex-col justify-between">
            <CardContent className="p-6 space-y-3">
              <div className="size-10 rounded-lg bg-[#B0FDE0]/35 text-primary flex items-center justify-center">
                <Timer className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Exam Mode — Thi thử
                </h3>
                <p className="text-xs text-primary font-semibold mt-0.5">
                  Đếm ngược & Thang điểm 10
                </p>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Mô phỏng phòng thi thực tế với đồng hồ đếm ngược, đánh dấu câu hỏi và tự động thu bài khi hết giờ.
              </p>
              <Link
                to={`/quiz/${currentQuiz.id}/exam`}
                className="mt-4 w-full h-9 rounded-lg bg-[#333836] hover:bg-[#262a28] text-[#B0FDE0] text-xs font-semibold flex items-center justify-center transition-colors"
              >
                Bắt đầu Thi thử (Exam)
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Preview Questions List (Read-only without answer keys) */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardHeader className="border-b border-slate-100 pb-4">
          <CardTitle className="text-base font-bold">
            Xem trước câu hỏi ({currentQuiz.questions?.length || 0} câu)
          </CardTitle>
          <CardDescription className="text-xs">
            Đáp án đúng và lời giải thích được bảo mật trên máy chủ.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {(currentQuiz.questions || []).slice(0, 15).map((q, idx) => (
              <div
                key={q.id}
                className="p-4 rounded-lg border border-slate-200/80 bg-slate-50/50 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-primary">
                    Câu {idx + 1}
                  </span>
                  <DifficultyBadge difficulty={q.difficulty} />
                </div>
                <p className="text-sm font-medium text-slate-900">
                  {q.question_text}
                </p>
                {q.formula_latex && (
                  <code className="block text-xs bg-white p-2 rounded border border-slate-200 text-slate-800">
                    {q.formula_latex}
                  </code>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(q.question_options || []).map((opt) => (
                    <div
                      key={opt.id}
                      className="px-3 py-2 rounded-lg bg-white border border-slate-200/80 text-xs text-slate-700"
                    >
                      <strong className="text-slate-900 mr-1.5">
                        {opt.option_label}.
                      </strong>
                      {opt.option_content}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {(currentQuiz.questions?.length || 0) > 15 && (
              <p className="text-center text-xs text-slate-500 py-2">
                ... và {currentQuiz.questions.length - 15} câu hỏi khác trong bộ đề.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Community Reviews */}
      {isPublicApproved && (
        <Card className="border-slate-200/80 shadow-xs">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle className="text-base font-bold inline-flex items-center gap-2">
              <MessageSquare className="size-4 text-primary" />
              <span>Đánh giá từ cộng đồng ({currentQuiz.review_count || 0})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {isAuthenticated ? (
              <form
                onSubmit={handleReviewSubmit}
                className="p-4 rounded-lg bg-slate-50 border border-slate-200/80 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">
                    Đánh giá của bạn
                  </span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        aria-label={`Đánh giá ${star} sao`}
                        className="p-1 cursor-pointer"
                      >
                        <Star
                          className={`size-5 ${
                            star <= rating
                              ? "fill-amber-400 text-amber-400"
                              : "text-slate-300"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                {reviewError && (
                  <p className="text-xs text-rose-600">{reviewError}</p>
                )}

                <Textarea
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Chia sẻ nhận xét của bạn về chất lượng bộ đề..."
                  className="bg-white"
                />

                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={submittingReview}>
                    {submittingReview ? "Đang lưu..." : "Gửi đánh giá"}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="p-4 rounded-lg bg-slate-50 text-center text-sm text-slate-600">
                Vui lòng{" "}
                <Link to="/login" className="text-primary font-semibold underline">
                  đăng nhập
                </Link>{" "}
                để gửi đánh giá cho bộ đề này.
              </div>
            )}

            <div className="space-y-3">
              {(currentQuiz.reviews || []).length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">
                  Chưa có đánh giá nào. Hãy là người đầu tiên đánh giá bộ đề này!
                </p>
              ) : (
                currentQuiz.reviews.map((rev) => (
                  <div
                    key={rev.id}
                    className="p-4 rounded-lg border border-slate-200/80 flex items-start justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">
                          {rev.author?.display_name || "Học viên"}
                        </span>
                        <div className="flex items-center">
                          {Array.from({ length: rev.rating }).map((_, i) => (
                            <Star
                              key={i}
                              className="size-3.5 fill-amber-400 text-amber-400"
                            />
                          ))}
                        </div>
                        <span className="text-xs text-slate-400">
                          {new Date(rev.created_at).toLocaleDateString("vi-VN")}
                        </span>
                      </div>
                      {rev.comment && (
                        <p className="text-sm text-slate-600">{rev.comment}</p>
                      )}
                    </div>

                    {user && rev.user_id === user.id && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDeleteMyReview(rev.id)}
                        className="text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        title="Xóa đánh giá của tôi"
                        aria-label="Xóa đánh giá của tôi"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

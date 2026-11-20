import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useQuiz } from "../../hooks/useQuiz.js";
import { PageHeader } from "../../components/common/PageHeader.jsx";
import { EmptyState } from "../../components/common/EmptyState.jsx";
import {
  DifficultyBadge,
  ModerationBadge,
} from "../../components/ui/StatusBadge.jsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import {
  Plus,
  Sparkles,
  Edit3,
  Trash2,
  Globe,
  Lock,
  BookOpen,
  AlertCircle,
  Play,
  Library,
} from "lucide-react";

export function MyLibraryPage() {
  const {
    quizzes,
    loading,
    error,
    fetchMyQuizzes,
    submitForPublicApproval,
    makeQuizPrivate,
    softDeleteQuiz,
  } = useQuiz();

  const [statusFilter, setStatusFilter] = useState("all");
  const [actionLoadingId, setActionLoadingId] = useState(null);

  useEffect(() => {
    fetchMyQuizzes();
  }, [fetchMyQuizzes]);

  const filteredQuizzes = useMemo(() => {
    if (statusFilter === "all") return quizzes;
    if (statusFilter === "private") {
      return quizzes.filter((q) => q.visibility === "private");
    }
    return quizzes.filter((q) => q.moderation_status === statusFilter);
  }, [quizzes, statusFilter]);

  const handleTogglePublic = async (quiz) => {
    setActionLoadingId(quiz.id);
    try {
      if (quiz.visibility === "private" || quiz.moderation_status === "rejected") {
        await submitForPublicApproval(quiz.id);
        toast.success("Đã gửi bộ đề chờ Admin duyệt Public.");
      } else {
        await makeQuizPrivate(quiz.id);
        toast.success("Đã chuyển bộ đề về Riêng tư (Private).");
      }
      await fetchMyQuizzes();
    } catch (err) {
      toast.error(err.message || "Không thể thay đổi trạng thái bộ đề.");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleSoftDelete = async (quiz) => {
    if (
      !window.confirm(
        `Bạn có chắc muốn xóa bộ đề "${quiz.title}"? (Lịch sử thi trước đây vẫn được bảo toàn)`,
      )
    ) {
      return;
    }
    setActionLoadingId(quiz.id);
    try {
      await softDeleteQuiz(quiz.id);
      toast.success("Đã xóa bộ đề khỏi thư viện.");
      await fetchMyQuizzes();
    } catch (err) {
      toast.error(err.message || "Không thể xóa bộ đề.");
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <Library className="size-3.5" />
            <span>My Library</span>
          </>
        }
        title="Thư viện Bộ đề của tôi"
        description="Quản lý bộ đề cá nhân, chỉnh sửa câu hỏi và gửi đăng Public có kiểm duyệt."
        actions={
          <>
            <Link
              to="/library/new"
              className="h-9 px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 transition-colors"
            >
              <Plus className="size-3.5" />
              <span>Tạo bộ đề thủ công</span>
            </Link>
            <Link
              to="/generate"
              className="h-9 px-4 rounded-lg bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836] text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs transition-colors"
            >
              <Sparkles className="size-3.5" />
              <span>Tạo đề từ Tài liệu AI</span>
            </Link>
          </>
        }
      />

      {/* Filter Tabs using shadcn Tabs */}
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList className="flex-wrap h-auto p-1 bg-slate-100">
          <TabsTrigger value="all">Tất cả ({quizzes.length})</TabsTrigger>
          <TabsTrigger value="private">Riêng tư</TabsTrigger>
          <TabsTrigger value="pending">Chờ duyệt</TabsTrigger>
          <TabsTrigger value="approved">Đã duyệt Public</TabsTrigger>
          <TabsTrigger value="rejected">Từ chối</TabsTrigger>
          <TabsTrigger value="removed">Đã gỡ</TabsTrigger>
        </TabsList>
      </Tabs>

      {error && (
        <div
          role="alert"
          className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : filteredQuizzes.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Chưa có bộ đề nào trong mục này"
          description="Bạn có thể tạo bộ đề thủ công hoặc dùng Gemini AI để sinh câu hỏi tự động từ tài liệu."
          action={
            <Link
              to="/generate"
              className="h-9 px-4 rounded-lg bg-[#333836] text-[#B0FDE0] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#262a28] transition-colors"
            >
              <Sparkles className="size-3.5" />
              <span>Tạo bộ đề bằng AI</span>
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filteredQuizzes.map((quiz) => (
            <Card
              key={quiz.id}
              className="border-slate-200/80 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-colors"
            >
              <CardContent className="p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {quiz.subject && (
                      <Badge
                        variant="secondary"
                        className="bg-[#B0FDE0]/35 text-[#333836] border-[#333836]/20 rounded-md font-semibold"
                      >
                        {quiz.subject}
                      </Badge>
                    )}
                    <DifficultyBadge difficulty={quiz.difficulty} />
                  </div>
                  <ModerationBadge
                    visibility={quiz.visibility}
                    moderationStatus={quiz.moderation_status}
                  />
                </div>

                <Link
                  to={`/quiz/${quiz.id}`}
                  className="text-base font-bold text-slate-900 hover:text-primary block transition-colors"
                >
                  {quiz.title}
                </Link>

                {quiz.description && (
                  <p className="text-xs sm:text-sm text-slate-600 line-clamp-2">
                    {quiz.description}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 pt-1">
                  <span className="font-medium text-slate-700">
                    {quiz.question_count} câu hỏi
                  </span>
                  <span>•</span>
                  <span>
                    Thi chuẩn: {quiz.default_exam_questions} câu /{" "}
                    {quiz.default_exam_duration} phút
                  </span>
                  {quiz.documents?.file_name && (
                    <>
                      <span>•</span>
                      <span className="truncate max-w-[180px]">
                        Nguồn: {quiz.documents.file_name}
                      </span>
                    </>
                  )}
                </div>

                {quiz.moderation_note && (
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                    <AlertCircle className="size-4 shrink-0 mt-0.5 text-amber-600" />
                    <div>
                      <span className="font-semibold">Ghi chú Admin: </span>
                      <span>{quiz.moderation_note}</span>
                    </div>
                  </div>
                )}
              </CardContent>

              <CardFooter className="px-5 pb-5 pt-3 border-t border-slate-100 flex-wrap justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Link
                    to={`/quiz/${quiz.id}/study`}
                    className="h-7 px-2.5 rounded-md bg-[#B0FDE0]/35 text-[#333836] hover:bg-[#B0FDE0]/45 text-xs font-semibold inline-flex items-center gap-1"
                  >
                    <Play className="size-3" />
                    <span>Study</span>
                  </Link>
                  <Link
                    to={`/quiz/${quiz.id}/practice`}
                    className="h-7 px-2.5 rounded-md bg-[#B0FDE0]/35 text-[#333836] hover:bg-[#B0FDE0]/45 text-xs font-semibold inline-flex items-center"
                  >
                    Practice
                  </Link>
                  <Link
                    to={`/quiz/${quiz.id}/exam`}
                    className="h-7 px-2.5 rounded-md bg-[#333836] text-[#B0FDE0] hover:bg-[#262a28] text-xs font-semibold inline-flex items-center"
                  >
                    Exam
                  </Link>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={actionLoadingId === quiz.id}
                    onClick={() => handleTogglePublic(quiz)}
                  >
                    {quiz.visibility === "private" ||
                    quiz.moderation_status === "rejected" ? (
                      <>
                        <Globe className="size-3.5 text-primary" />
                        <span>Gửi Public</span>
                      </>
                    ) : (
                      <>
                        <Lock className="size-3.5 text-slate-500" />
                        <span>Đặt Private</span>
                      </>
                    )}
                  </Button>

                  <Link
                    to={`/library/${quiz.id}/edit`}
                    className="h-7 w-7 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-primary inline-flex items-center justify-center"
                    title="Chỉnh sửa bộ đề"
                    aria-label="Chỉnh sửa bộ đề"
                  >
                    <Edit3 className="size-3.5" />
                  </Link>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={actionLoadingId === quiz.id}
                    onClick={() => handleSoftDelete(quiz)}
                    className="text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                    title="Xóa mềm bộ đề"
                    aria-label="Xóa mềm bộ đề"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../../hooks/useAuth.js";
import { quizService } from "../../services/quizService.js";
import { attemptService } from "../../services/attemptService.js";
import { documentService } from "../../services/documentService.js";
import { PageHeader } from "../../components/common/PageHeader.jsx";
import { StatCard } from "../../components/common/StatCard.jsx";
import { EmptyState } from "../../components/common/EmptyState.jsx";
import {
  AttemptTypeBadge,
  DifficultyBadge,
  DocumentStatusBadge,
  ModerationBadge,
} from "../../components/ui/StatusBadge.jsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BookOpen,
  FileText,
  Sparkles,
  Trophy,
  Clock,
  ArrowRight,
  Plus,
  CheckCircle2,
  UserCheck,
  FileUp,
  Loader2,
} from "lucide-react";

export function DashboardPage() {
  const { user, profile, updateProfile } = useAuth();
  const [myQuizzes, setMyQuizzes] = useState([]);
  const [myDocs, setMyDocs] = useState([]);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);

  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const handleOpenProfileDialog = () => {
    setDisplayNameInput(profile?.display_name || user?.email?.split("@")[0] || "");
    setProfileDialogOpen(true);
  };

  useEffect(() => {
    let mounted = true;
    async function loadDashboardData() {
      setLoading(true);
      try {
        const [quizzes, docs, prog] = await Promise.all([
          quizService.listMyQuizzes(),
          documentService.listMyDocuments(),
          attemptService.getMyProgressSummary(),
        ]);
        if (!mounted) return;
        setMyQuizzes(quizzes);
        setMyDocs(docs);
        setProgress(prog);
      } catch (err) {
        console.error("[DashboardPage] Load error:", err);
        toast.error("Không thể tải dữ liệu tổng quan.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadDashboardData();
    return () => {
      mounted = false;
    };
  }, []);

  const totalQuestionsCreated = myQuizzes.reduce(
    (sum, q) => sum + Number(q.question_count || 0),
    0,
  );

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!displayNameInput.trim()) return;
    setSavingProfile(true);
    try {
      await updateProfile({ display_name: displayNameInput.trim() });
      setProfileDialogOpen(false);
      toast.success("Đã cập nhật tên hiển thị.");
    } catch (err) {
      toast.error(err.message || "Không thể cập nhật hồ sơ.");
    } finally {
      setSavingProfile(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Skeleton key={idx} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  const displayName = profile?.display_name || user?.email?.split("@")[0] || "Bạn";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace Overview"
        title={`Xin chào, ${displayName}`}
        description="Quản lý tài liệu học tập, tạo bộ đề trắc nghiệm với AI và theo dõi kết quả luyện thi."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleOpenProfileDialog}>
              <UserCheck className="size-4" />
              <span>Hồ sơ</span>
            </Button>
            <Link
              to="/documents"
              className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 transition-colors"
            >
              <FileUp className="size-3.5" />
              <span>Tải tài liệu</span>
            </Link>
            <Link
              to="/generate"
              className="h-8 px-3.5 rounded-lg bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836] text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs transition-colors"
            >
              <Sparkles className="size-3.5" />
              <span>Sinh đề AI</span>
            </Link>
          </>
        }
      />

      {/* 4 Key Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Tổng số bộ đề"
          value={myQuizzes.length}
          subtext={`Từ ${myDocs.length} tài liệu đã tải lên`}
          icon={BookOpen}
          tone="blue"
        />
        <StatCard
          label="Tổng số câu hỏi"
          value={totalQuestionsCreated}
          subtext="Trong thư viện cá nhân"
          icon={CheckCircle2}
          tone="violet"
        />
        <StatCard
          label="Lượt thi & luyện tập"
          value={progress?.totalAttempts ?? 0}
          subtext={`Độ chính xác: ${progress?.accuracyPercent ?? 0}%`}
          icon={Clock}
          tone="emerald"
        />
        <StatCard
          label="Điểm trung bình"
          value={Number(progress?.averageScore ?? 0).toFixed(2)}
          subtext={`Cao nhất: ${Number(progress?.highestScore ?? 0).toFixed(2)} / 10`}
          icon={Trophy}
          tone="amber"
        />
      </div>

      {/* Main Content Grid: Recent Quizzes + Recent Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Quiz Sets */}
        <Card className="border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4 border-b border-slate-100">
              <div>
                <CardTitle className="text-base font-bold text-slate-900">
                  Bộ đề gần đây
                </CardTitle>
                <CardDescription className="text-xs">
                  Ôn tập nhanh hoặc thi thử trực tiếp
                </CardDescription>
              </div>
              <Link
                to="/library/new"
                className="h-7 px-2.5 rounded-md bg-[#B0FDE0]/35 text-[#333836] hover:bg-[#B0FDE0]/45 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
              >
                <Plus className="size-3.5" />
                <span>Tạo thủ công</span>
              </Link>
            </CardHeader>

            <CardContent className="pt-4">
              {myQuizzes.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title="Chưa có bộ đề nào"
                  description="Tải tài liệu lên để Gemini AI tạo câu hỏi hoặc tự biên soạn bộ đề mới."
                  action={
                    <Link
                      to="/generate"
                      className="h-8 px-3.5 rounded-lg bg-[#333836] text-[#B0FDE0] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#262a28] transition-colors"
                    >
                      <Sparkles className="size-3.5" />
                      <span>Tạo bộ đề đầu tiên</span>
                    </Link>
                  }
                />
              ) : (
                <div className="space-y-2.5">
                  {myQuizzes.slice(0, 5).map((quiz) => (
                    <div
                      key={quiz.id}
                      className="p-3.5 rounded-lg border border-slate-200/80 hover:border-[#333836]/20 hover:bg-slate-50/70 transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <Link
                          to={`/quiz/${quiz.id}`}
                          className="text-sm font-semibold text-slate-900 hover:text-primary truncate block"
                        >
                          {quiz.title}
                        </Link>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <span className="text-xs text-slate-500">
                            {quiz.question_count} câu
                          </span>
                          <DifficultyBadge difficulty={quiz.difficulty} />
                          <ModerationBadge
                            visibility={quiz.visibility}
                            moderationStatus={quiz.moderation_status}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Link
                          to={`/quiz/${quiz.id}/study`}
                          className="h-7 px-2.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center"
                        >
                          Ôn tập
                        </Link>
                        <Link
                          to={`/quiz/${quiz.id}/exam`}
                          className="h-7 px-2.5 rounded-md bg-[#333836] hover:bg-[#262a28] text-[#B0FDE0] text-xs font-semibold inline-flex items-center"
                        >
                          Thi thử
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </div>

          <CardFooter className="border-t border-slate-100 pt-3 justify-end">
            <Link
              to="/library"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              <span>Xem toàn bộ Thư viện</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </CardFooter>
        </Card>

        {/* Recent Attempts */}
        <Card className="border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <CardHeader className="pb-4 border-b border-slate-100">
              <CardTitle className="text-base font-bold text-slate-900">
                Kết quả làm bài gần đây
              </CardTitle>
              <CardDescription className="text-xs">
                Lịch sử Study, Practice và Exam Mode
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-4">
              {!progress?.recentAttempts || progress.recentAttempts.length === 0 ? (
                <EmptyState
                  icon={Trophy}
                  title="Chưa có lịch sử làm bài"
                  description="Khám phá các bộ đề cộng đồng hoặc bộ đề cá nhân để bắt đầu luyện tập."
                  action={
                    <Link
                      to="/explore"
                      className="h-8 px-3.5 rounded-lg bg-[#333836] text-[#B0FDE0] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#262a28] transition-colors"
                    >
                      <span>Khám phá bộ đề</span>
                      <ArrowRight className="size-3.5" />
                    </Link>
                  }
                />
              ) : (
                <div className="space-y-2.5">
                  {progress.recentAttempts.slice(0, 5).map((att) => (
                    <div
                      key={att.id}
                      className="p-3.5 rounded-lg border border-slate-200/80 hover:border-slate-300 transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {att.quiz_sets?.title || "Bộ đề trắc nghiệm"}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <AttemptTypeBadge type={att.attempt_type} />
                          <span className="text-xs text-slate-500">
                            Đúng {att.correct_count}/{att.total_questions} câu
                          </span>
                          <span className="text-xs text-slate-400">
                            {new Date(att.created_at).toLocaleDateString("vi-VN")}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {att.status === "in_progress" ? (
                          <Link
                            to={`/quiz/${att.quiz_set_id}/${att.attempt_type}?attemptId=${att.id}`}
                            className="h-7 px-2.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold inline-flex items-center"
                          >
                            Làm tiếp
                          </Link>
                        ) : (
                          <>
                            <div className="text-right">
                              <span className="text-base font-bold text-primary">
                                {Number(att.score).toFixed(2)}
                              </span>
                              <span className="text-[11px] text-slate-400 block">
                                điểm
                              </span>
                            </div>
                            <Link
                              to={`/results/${att.id}`}
                              className="h-7 px-2.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold inline-flex items-center"
                            >
                              Chi tiết
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </div>

          <CardFooter className="border-t border-slate-100 pt-3 justify-end">
            <Link
              to="/progress"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              <span>Xem thống kê tiến độ</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </CardFooter>
        </Card>
      </div>

      {/* Recent Documents Strip */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4 border-b border-slate-100">
          <div>
            <CardTitle className="text-base font-bold text-slate-900">
              Tài liệu nguồn gần đây
            </CardTitle>
            <CardDescription className="text-xs">
              Các file PDF, DOCX, TXT và hình ảnh đã tải lên hệ thống
            </CardDescription>
          </div>
          <Link
            to="/documents"
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            <span>Quản lý tài liệu</span>
            <ArrowRight className="size-3.5" />
          </Link>
        </CardHeader>
        <CardContent className="pt-4">
          {myDocs.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Chưa có tài liệu nào"
              description="Tải lên giáo trình PDF hoặc ảnh chụp bài giảng để Gemini AI trích xuất nội dung."
              action={
                <Link
                  to="/documents"
                  className="h-8 px-3.5 rounded-lg bg-[#333836] text-[#B0FDE0] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#262a28] transition-colors"
                >
                  <FileUp className="size-3.5" />
                  <span>Tải tài liệu ngay</span>
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {myDocs.slice(0, 3).map((doc) => (
                <div
                  key={doc.id}
                  className="p-3.5 rounded-lg border border-slate-200/80 bg-slate-50/50 flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {doc.file_name}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {doc.file_type?.toUpperCase()} •{" "}
                        {new Date(doc.created_at).toLocaleDateString("vi-VN")}
                      </p>
                    </div>
                    <DocumentStatusBadge status={doc.status} />
                  </div>
                  <Link
                    to={`/generate?documentId=${doc.id}`}
                    className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <Sparkles className="size-3" />
                    <span>Sinh bộ đề từ file này</span>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Display Name Dialog */}
      <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cập nhật hồ sơ cá nhân</DialogTitle>
            <DialogDescription>
              Thay đổi tên hiển thị của bạn trên các bộ đề cộng đồng và bảng điểm.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-display-name">Tên hiển thị</Label>
              <Input
                id="profile-display-name"
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                placeholder="Nhập tên hiển thị..."
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setProfileDialogOpen(false)}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={savingProfile}>
                {savingProfile && <Loader2 className="size-4 animate-spin" />}
                <span>Lưu thay đổi</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

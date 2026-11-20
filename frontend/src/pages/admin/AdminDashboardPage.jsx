import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../../hooks/useAdmin.js";
import { PageHeader } from "../../components/common/PageHeader.jsx";
import { EmptyState } from "../../components/common/EmptyState.jsx";
import {
  DifficultyBadge,
  ModerationBadge,
} from "../../components/ui/StatusBadge.jsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Ban,
  Eye,
  Users,
  BookOpen,
  Search,
  Loader2,
  Trash2,
} from "lucide-react";

export function AdminDashboardPage() {
  const {
    quizzes,
    users,
    loading,
    error,
    fetchModerationQuizzes,
    moderateQuiz,
    getQuizPreviewForAdmin,
    fetchUsers,
    updateUserRole,
  } = useAdmin();

  const [activeTab, setActiveTab] = useState("moderation");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  const [previewData, setPreviewData] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [moderationReason, setModerationReason] = useState("");
  const [actingQuizId, setActingQuizId] = useState(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState(null);

  useEffect(() => {
    if (activeTab === "moderation") {
      fetchModerationQuizzes({ status: statusFilter, search: appliedSearch });
    } else {
      fetchUsers({ search: appliedSearch });
    }
  }, [activeTab, statusFilter, appliedSearch, fetchModerationQuizzes, fetchUsers]);

  const handleSearch = (e) => {
    e.preventDefault();
    setAppliedSearch(searchQuery);
  };

  const handleOpenPreview = async (quizId) => {
    setLoadingPreview(true);
    setModerationReason("");
    try {
      const data = await getQuizPreviewForAdmin(quizId);
      setPreviewData(data);
    } catch (err) {
      toast.error(err.message || "Không thể tải bản xem trước của bộ đề.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleModerationAction = async (quizSetId, action) => {
    let reason = moderationReason.trim();
    if ((action === "reject" || action === "remove") && !reason) {
      const promptReason = window.prompt(
        `Vui lòng nhập lý do ${action === "reject" ? "từ chối" : "gỡ"} bộ đề này:`,
      );
      if (!promptReason || !promptReason.trim()) return;
      reason = promptReason.trim();
    }
    if (action === "approve" && !reason) {
      reason = "Nội dung hợp lệ, đã được Admin phê duyệt.";
    }

    setActingQuizId(quizSetId);
    try {
      await moderateQuiz({ quizSetId, action, reason });
      setPreviewData(null);
      toast.success(
        action === "approve"
          ? "Đã phê duyệt Public bộ đề!"
          : action === "reject"
          ? "Đã từ chối bộ đề."
          : action === "hard_delete"
          ? "Đã xóa vĩnh viễn bộ đề và giải phóng dung lượng database!"
          : "Đã gỡ bộ đề khỏi Public.",
      );
      setHardDeleteTarget(null);
      await fetchModerationQuizzes({ status: statusFilter, search: appliedSearch });
    } catch (err) {
      toast.error(err.message || "Không thể thực hiện kiểm duyệt.");
    } finally {
      setActingQuizId(null);
    }
  };

  const handleRoleChange = async (userItem, newRole) => {
    if (
      !window.confirm(
        `Bạn có chắc chắn muốn đổi vai trò của "${userItem.display_name || userItem.id}" thành "${newRole.toUpperCase()}"?`,
      )
    ) {
      return;
    }
    try {
      await updateUserRole(userItem.id, newRole);
      toast.success("Đã cập nhật vai trò người dùng.");
    } catch (err) {
      toast.error(err.message || "Không thể cập nhật vai trò người dùng.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <ShieldCheck className="size-3.5" />
            <span>Admin Control Center</span>
          </>
        }
        title="Quản trị & Kiểm duyệt Hệ thống"
        description="Kiểm duyệt bộ đề Public (quy tắc both_admin) và quản lý phân quyền người dùng."
        actions={
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-slate-100 p-1">
              <TabsTrigger value="moderation" className="gap-1.5">
                <BookOpen className="size-3.5" />
                <span>Kiểm duyệt Bộ đề</span>
              </TabsTrigger>
              <TabsTrigger value="users" className="gap-1.5">
                <Users className="size-3.5" />
                <span>Người dùng & Role</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {/* Search & Status Filter */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[240px] relative">
              <Search className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  activeTab === "moderation"
                    ? "Tìm kiếm theo tên bộ đề, môn học..."
                    : "Tìm kiếm người dùng theo tên hiển thị..."
                }
                className="pl-9 h-9"
              />
            </div>
            <Button type="submit" size="sm" className="h-9 px-4">
              Tìm kiếm
            </Button>
          </form>

          {activeTab === "moderation" && (
            <Tabs value={statusFilter} onValueChange={setStatusFilter}>
              <TabsList className="h-auto p-1 bg-slate-100 flex-wrap">
                <TabsTrigger value="pending">Chờ duyệt</TabsTrigger>
                <TabsTrigger value="approved">Đã duyệt</TabsTrigger>
                <TabsTrigger value="rejected">Từ chối</TabsTrigger>
                <TabsTrigger value="removed">Đã gỡ</TabsTrigger>
                <TabsTrigger value="all">Tất cả</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </CardContent>
      </Card>

      {error && (
        <div
          role="alert"
          className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm"
        >
          {error}
        </div>
      )}

      {/* TAB 1: MODERATION */}
      {activeTab === "moderation" && (
        <div className="space-y-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : quizzes.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={`Không có bộ đề nào ở trạng thái "${statusFilter}"`}
              description="Các bộ đề người dùng gửi duyệt Public sẽ xuất hiện tại đây."
            />
          ) : (
            <div className="space-y-3">
              {quizzes.map((quiz) => (
                <Card key={quiz.id} className="border-slate-200/80 shadow-xs">
                  <CardContent className="p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <ModerationBadge
                          visibility={quiz.visibility}
                          moderationStatus={quiz.moderation_status}
                        />
                        {quiz.subject && (
                          <Badge
                            variant="secondary"
                            className="bg-[#B0FDE0]/35 text-[#333836] rounded-md"
                          >
                            {quiz.subject}
                          </Badge>
                        )}
                        <DifficultyBadge difficulty={quiz.difficulty} />
                        <span className="text-xs text-slate-500">
                          {quiz.question_count} câu hỏi
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-slate-900">
                        {quiz.title}
                      </h3>

                      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                        <span>
                          Người tạo:{" "}
                          <strong className="text-slate-700">
                            {quiz.creator?.display_name || quiz.user_id}
                          </strong>
                        </span>
                        <span>
                          Cập nhật:{" "}
                          {new Date(quiz.updated_at).toLocaleString("vi-VN")}
                        </span>
                        {quiz.moderated_at && (
                          <span>
                            Kiểm duyệt:{" "}
                            {new Date(quiz.moderated_at).toLocaleString("vi-VN")}
                            {quiz.moderator?.display_name
                              ? ` bởi ${quiz.moderator.display_name}`
                              : ""}
                          </span>
                        )}
                      </div>

                      {quiz.moderation_note && (
                        <p className="text-xs text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                          <strong>Ghi chú:</strong> {quiz.moderation_note}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenPreview(quiz.id)}
                      >
                        <Eye className="size-3.5" />
                        <span>Preview</span>
                      </Button>

                      {quiz.moderation_status !== "approved" && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={actingQuizId === quiz.id}
                          onClick={() => handleModerationAction(quiz.id, "approve")}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          <CheckCircle2 className="size-3.5" />
                          <span>Approve</span>
                        </Button>
                      )}

                      {quiz.moderation_status === "pending" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={actingQuizId === quiz.id}
                          onClick={() => handleModerationAction(quiz.id, "reject")}
                        >
                          <XCircle className="size-3.5" />
                          <span>Reject</span>
                        </Button>
                      )}

                      {quiz.moderation_status === "approved" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={actingQuizId === quiz.id}
                          onClick={() => handleModerationAction(quiz.id, "remove")}
                        >
                          <Ban className="size-3.5" />
                          <span>Remove</span>
                        </Button>
                      )}

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={actingQuizId === quiz.id}
                        onClick={() => setHardDeleteTarget(quiz)}
                        className="border-rose-300 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                      >
                        <Trash2 className="size-3.5" />
                        <span>Xóa vĩnh viễn</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: USERS */}
      {activeTab === "users" && (
        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-3">
                <Skeleton className="h-10 rounded-lg" />
                <Skeleton className="h-10 rounded-lg" />
                <Skeleton className="h-10 rounded-lg" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/70">
                      <TableHead>Người dùng</TableHead>
                      <TableHead>UUID</TableHead>
                      <TableHead>Vai trò</TableHead>
                      <TableHead>Ngày tham gia</TableHead>
                      <TableHead className="text-right">Phân quyền</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-semibold text-slate-900">
                          {u.display_name || "Người dùng"}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-400">
                          {u.id}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              u.role === "admin"
                                ? "bg-[#B0FDE0]/35 text-[#333836] border-[#333836]/20 rounded-md"
                                : "bg-slate-100 text-slate-700 border-slate-200 rounded-md"
                            }
                          >
                            {u.role.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {new Date(u.created_at).toLocaleDateString("vi-VN")}
                        </TableCell>
                        <TableCell className="text-right">
                          {u.role === "user" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => handleRoleChange(u, "admin")}
                            >
                              Cấp quyền Admin
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => handleRoleChange(u, "user")}
                            >
                              Hạ về User
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Admin Preview Modal (shadcn Dialog) */}
      <Dialog
        open={Boolean(loadingPreview || previewData)}
        onOpenChange={(open) => !open && setPreviewData(null)}
      >
        <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
          {loadingPreview ? (
            <div className="p-12 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-sm">Đang tải nội dung câu hỏi & đáp án...</p>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  Kiểm duyệt: {previewData?.quizSet?.title}
                </DialogTitle>
                <DialogDescription>
                  Tổng cộng {previewData?.questions?.length || 0} câu hỏi (bao gồm đáp án đúng để kiểm tra)
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto space-y-4 pr-1 py-2">
                {(previewData?.questions || []).map((q, idx) => (
                  <div
                    key={q.id || idx}
                    className="p-4 rounded-lg border border-slate-200 space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-primary">
                        Câu #{idx + 1} • Đáp án đúng: {q.correct_option_label}
                      </span>
                      <DifficultyBadge difficulty={q.difficulty} />
                    </div>
                    <p className="text-sm font-semibold text-slate-900">
                      {q.question_text}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(q.options || []).map((opt) => {
                        const isCorrect =
                          opt.option_label === q.correct_option_label;
                        return (
                          <div
                            key={opt.id || opt.option_label}
                            className={`px-3 py-2 rounded-lg border text-xs ${
                              isCorrect
                                ? "border-emerald-500 bg-emerald-50 text-emerald-950 font-semibold"
                                : "border-slate-200 bg-white text-slate-700"
                            }`}
                          >
                            <strong>{opt.option_label}. </strong>
                            {opt.option_content}
                          </div>
                        );
                      })}
                    </div>
                    {q.explanation && (
                      <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg">
                        <strong>Giải thích:</strong> {q.explanation}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-3">
                <Input
                  type="text"
                  value={moderationReason}
                  onChange={(e) => setModerationReason(e.target.value)}
                  placeholder="Nhập ghi chú hoặc lý do kiểm duyệt (bắt buộc khi Reject hoặc Remove)..."
                />

                <DialogFooter className="gap-2 sm:justify-end">
                  <Button
                    type="button"
                    onClick={() =>
                      handleModerationAction(previewData.quizSet.id, "approve")
                    }
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <CheckCircle2 className="size-4" />
                    <span>Approve Public</span>
                  </Button>

                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() =>
                      handleModerationAction(previewData.quizSet.id, "reject")
                    }
                  >
                    <XCircle className="size-4" />
                    <span>Reject</span>
                  </Button>

                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() =>
                      handleModerationAction(previewData.quizSet.id, "remove")
                    }
                  >
                    <Ban className="size-4" />
                    <span>Remove Public</span>
                  </Button>
                </DialogFooter>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Hard Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(hardDeleteTarget)}
        onOpenChange={(open) => {
          if (!open) setHardDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-rose-700 flex items-center gap-2">
              <Trash2 className="size-5" />
              <span>Xóa vĩnh viễn bộ đề?</span>
            </DialogTitle>
            <DialogDescription>
              Hành động này sẽ xóa vĩnh viễn bộ đề{" "}
              <strong className="text-slate-900">
                "{hardDeleteTarget?.title}"
              </strong>{" "}
              cùng toàn bộ câu hỏi, đáp án và lịch sử làm bài liên quan khỏi cơ sở dữ liệu để giải phóng dung lượng. Không thể hoàn tác!
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setHardDeleteTarget(null)}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={actingQuizId === hardDeleteTarget?.id}
              onClick={() =>
                hardDeleteTarget &&
                handleModerationAction(hardDeleteTarget.id, "hard_delete")
              }
            >
              {actingQuizId === hardDeleteTarget?.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              <span>Xác nhận xóa vĩnh viễn</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

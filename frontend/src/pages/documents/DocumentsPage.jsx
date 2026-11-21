import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useDocuments } from "../../hooks/useDocuments.js";
import { validateFileBeforeUpload } from "../../services/documentService.js";
import { PageHeader } from "../../components/common/PageHeader.jsx";
import { EmptyState } from "../../components/common/EmptyState.jsx";
import { AiProgressCard } from "../../components/common/AiProgressCard.jsx";
import { DocumentStatusBadge } from "../../components/ui/StatusBadge.jsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  FileUp,
  FileText,
  Sparkles,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  Eye,
  Image as ImageIcon,
} from "lucide-react";

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function DocumentsPage() {
  const {
    documents,
    loading,
    uploading,
    progress,
    error,
    fetchDocuments,
    uploadDocument,
    reprocessDocument,
    deleteDocument,
  } = useDocuments();

  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [localError, setLocalError] = useState("");
  const [successDoc, setSuccessDoc] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [reprocessingId, setReprocessingId] = useState(null);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleFileSelect = (file) => {
    setLocalError("");
    setSuccessDoc(null);
    if (!file) return;
    try {
      validateFileBeforeUpload(file);
      setSelectedFile(file);
    } catch (err) {
      setLocalError(err.message);
      setSelectedFile(null);
    }
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    setLocalError("");
    setSuccessDoc(null);

    if (!selectedFile) {
      setLocalError("Vui lòng chọn một file tài liệu trước khi tải lên.");
      return;
    }

    try {
      const doc = await uploadDocument(selectedFile);
      setSuccessDoc(doc);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (doc?.ai_meta?.fallback_triggered) {
        toast.success(
          `Đã phân tích xong "${doc.file_name}" bằng ${doc.ai_meta.model_name} (dự phòng)`,
        );
      } else {
        toast.success(`Đã phân tích xong "${doc.file_name}"`);
      }
    } catch (err) {
      const msg = err.message || "Tải lên hoặc xử lý AI thất bại.";
      setLocalError(msg);
      toast.error(msg);
    }
  };

  const handleReprocess = async (doc) => {
    setReprocessingId(doc.id);
    try {
      const res = await reprocessDocument(doc.id);
      if (res?.ai_meta?.fallback_triggered) {
        toast.success(
          `Đã phân tích lại "${doc.file_name}" bằng ${res.ai_meta.model_name} (dự phòng)`,
        );
      } else {
        toast.success(`Đã phân tích lại tài liệu "${doc.file_name}"`);
      }
    } catch (err) {
      toast.error(err.message || "Không thể phân tích lại tài liệu.");
    } finally {
      setReprocessingId(null);
    }
  };

  const handleDelete = async (doc) => {
    if (
      !window.confirm(
        `Bạn có chắc muốn xóa tài liệu "${doc.file_name}"? Các bộ đề đã tạo từ tài liệu này vẫn sẽ được giữ lại.`,
      )
    ) {
      return;
    }
    try {
      await deleteDocument(doc.id);
      toast.success("Đã xóa tài liệu.");
    } catch (err) {
      toast.error(err.message || "Không thể xóa tài liệu.");
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={
          <>
            <FileUp className="size-3.5" />
            <span>Document Management & AI OCR</span>
          </>
        }
        title="Quản lý & Tải lên Tài liệu"
        description="Hỗ trợ PDF, DOCX, TXT và hình ảnh (PNG, JPG, WEBP — tối đa 20MB). Tài liệu gốc được lưu riêng tư tuyệt đối."
      />

      {/* Upload Zone Card */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardContent className="p-6">
          <form onSubmit={handleUploadSubmit} className="space-y-5">
            <div
              role="button"
              tabIndex={0}
              onClick={() => !uploading && fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !uploading) {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!uploading && e.dataTransfer.files?.[0]) {
                  handleFileSelect(e.dataTransfer.files[0]);
                }
              }}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                selectedFile
                  ? "border-primary bg-[#B0FDE0]/35"
                  : "border-slate-200 hover:border-[#333836]/20 bg-slate-50/60"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files?.[0])}
              />

              <div className="size-12 rounded-xl bg-[#B0FDE0]/35 text-primary flex items-center justify-center mx-auto mb-3">
                <FileUp className="size-6" />
              </div>

              {selectedFile ? (
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-900">
                    Đã chọn: {selectedFile.name}
                  </p>
                  <p className="text-xs text-primary font-medium">
                    Dung lượng: {formatFileSize(selectedFile.size)} • Nhấn để chọn file khác
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-800">
                    Kéo thả tài liệu vào đây hoặc nhấn để chọn file
                  </p>
                  <p className="text-xs text-slate-500">
                    Định dạng: PDF, DOCX, TXT, PNG, JPG, WEBP (Tối đa 20MB)
                  </p>
                </div>
              )}
            </div>

            {/* Processing & AI OCR Progress */}
            {(() => {
              const reprocessingDoc = reprocessingId
                ? documents.find((d) => d.id === reprocessingId)
                : null;
              const isTracking = (uploading && Boolean(progress)) || Boolean(reprocessingId);
              if (!isTracking) return null;

              const sizeBytes =
                selectedFile?.size || reprocessingDoc?.file_size || 1_000_000;
              const estimatedSeconds =
                sizeBytes > 5 * 1024 * 1024
                  ? 35
                  : sizeBytes > 1.5 * 1024 * 1024
                  ? 22
                  : 12;

              const stepMap = {
                validating: 0,
                uploading: 1,
                saving_record: 2,
                processing_ai: 3,
                completed: 4,
              };
              const currentStepIndex = reprocessingId
                ? 3
                : stepMap[progress?.step] ?? 0;

              return (
                <AiProgressCard
                  active={isTracking}
                  title={
                    reprocessingDoc
                      ? `Đang phân tích lại "${reprocessingDoc.file_name}"`
                      : `Đang tải & phân tích "${selectedFile?.name || "tài liệu"}"`
                  }
                  currentMessage={
                    reprocessingId
                      ? "Đang xử lý bằng Gemini 3.8 Flash..."
                      : progress?.message
                  }
                  basePercent={reprocessingId ? 35 : progress?.percent ?? 10}
                  currentStepIndex={currentStepIndex}
                  estimatedSeconds={estimatedSeconds}
                  steps={[
                    { id: "validating", label: "Kiểm tra file" },
                    { id: "uploading", label: "Upload Storage" },
                    { id: "saving_record", label: "Lưu bản ghi" },
                    { id: "processing_ai", label: "Gemini AI OCR" },
                  ]}
                />
              );
            })()}

            {(localError || error) && (
              <div
                role="alert"
                className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-2.5"
              >
                <AlertCircle className="size-4.5 shrink-0 mt-0.5" />
                <span>{localError || error}</span>
              </div>
            )}

            {successDoc && (
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="size-5 shrink-0 text-emerald-600 mt-0.5" />
                  <div>
                    <p className="font-semibold">
                      Tài liệu "{successDoc.file_name}" đã sẵn sàng tạo đề!
                    </p>
                    {successDoc.ai_summary?.summary && (
                      <p className="text-xs text-emerald-800 mt-0.5 line-clamp-2">
                        {successDoc.ai_summary.summary}
                      </p>
                    )}
                  </div>
                </div>
                <Link
                  to={`/generate?documentId=${successDoc.id}`}
                  className="h-8 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                >
                  <Sparkles className="size-3.5" />
                  <span>Tạo bộ đề ngay</span>
                </Link>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Lock className="size-3.5 text-slate-400" />
                <span>
                  Lưu trữ riêng tư tại bucket <code>exam-documents</code>
                </span>
              </div>

              <Button
                type="submit"
                disabled={!selectedFile || uploading}
                className="bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836] font-semibold"
              >
                {uploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Đang tải lên & phân tích AI...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    <span>Tải lên & Phân tích AI</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Documents List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">
            Danh sách tài liệu ({documents.length})
          </h2>
        </div>

        {loading && documents.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Bạn chưa tải lên tài liệu nào"
            description="Tải lên giáo trình, đề cương hoặc ảnh chụp tài liệu để Gemini AI tự động trích xuất nội dung và tạo câu hỏi."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {documents.map((doc) => {
              const isImage = ["png", "jpg", "jpeg", "webp"].includes(
                (doc.file_type || "").toLowerCase(),
              );
              const isRetrying = reprocessingId === doc.id;

              return (
                <Card
                  key={doc.id}
                  className="border-slate-200/80 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-colors"
                >
                  <CardContent className="p-5 space-y-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="size-10 rounded-lg bg-[#B0FDE0]/35 text-primary flex items-center justify-center shrink-0">
                          {isImage ? (
                            <ImageIcon className="size-5" />
                          ) : (
                            <FileText className="size-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-slate-900 truncate">
                            {doc.file_name}
                          </h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {doc.file_type?.toUpperCase()} •{" "}
                            {formatFileSize(doc.file_size)}
                            {doc.page_count ? ` • ${doc.page_count} trang` : ""}
                            {" • "}
                            {new Date(doc.created_at).toLocaleDateString("vi-VN")}
                          </p>
                        </div>
                      </div>
                      <DocumentStatusBadge status={doc.status} />
                    </div>

                    {doc.ai_summary && (
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/70 text-xs space-y-1.5">
                        {doc.ai_summary.subject_suggestion && (
                          <p className="font-semibold text-primary">
                            Môn học: {doc.ai_summary.subject_suggestion}
                          </p>
                        )}
                        {doc.ai_summary.summary && (
                          <p className="text-slate-600 line-clamp-2 leading-relaxed">
                            {doc.ai_summary.summary}
                          </p>
                        )}
                        {Array.isArray(doc.ai_summary.topics) &&
                          doc.ai_summary.topics.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {doc.ai_summary.topics.slice(0, 4).map((t, i) => (
                                <Badge
                                  key={i}
                                  variant="secondary"
                                  className="text-[11px] font-medium bg-white border border-slate-200 text-slate-700 rounded-md"
                                >
                                  {t}
                                </Badge>
                              ))}
                            </div>
                          )}
                      </div>
                    )}

                    {doc.processing_error && (
                      <div className="text-xs text-rose-700 bg-rose-50 p-2.5 rounded-lg border border-rose-200">
                        Lỗi: {doc.processing_error}
                      </div>
                    )}

                    <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                      <Link
                        to={`/generate?documentId=${doc.id}`}
                        className="h-8 px-3 rounded-lg bg-[#333836] hover:bg-[#262a28] text-[#B0FDE0] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Sparkles className="size-3.5" />
                        <span>Tạo bộ đề</span>
                      </Link>

                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setPreviewDoc(doc)}
                          title="Xem chi tiết & nội dung trích xuất"
                        >
                          <Eye className="size-3.5" />
                          <span>Xem</span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isRetrying}
                          onClick={() => handleReprocess(doc)}
                          title="Phân tích lại bằng AI"
                        >
                          <RefreshCw
                            className={`size-3.5 ${isRetrying ? "animate-spin" : ""}`}
                          />
                          <span className="hidden sm:inline">Thử lại</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleDelete(doc)}
                          className="text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                          title="Xóa tài liệu"
                          aria-label="Xóa tài liệu"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Document Preview Dialog */}
      <Dialog
        open={Boolean(previewDoc)}
        onOpenChange={(open) => !open && setPreviewDoc(null)}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">
              {previewDoc?.file_name}
            </DialogTitle>
            <DialogDescription>
              {previewDoc?.file_type?.toUpperCase()} •{" "}
              {formatFileSize(previewDoc?.file_size)}
              {previewDoc?.page_count ? ` • ${previewDoc.page_count} trang` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1 py-2">
            {previewDoc?.ai_summary && (
              <div className="p-4 rounded-lg bg-[#B0FDE0]/35 border border-[#333836]/20 space-y-2 text-xs">
                <p className="font-bold text-slate-900">
                  Tóm tắt nội dung bởi Gemini AI
                </p>
                <p className="text-slate-700 leading-relaxed">
                  {previewDoc.ai_summary.summary}
                </p>
                {Array.isArray(previewDoc.ai_summary.key_concepts) &&
                  previewDoc.ai_summary.key_concepts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {previewDoc.ai_summary.key_concepts.map((c, idx) => (
                        <Badge
                          key={idx}
                          variant="secondary"
                          className="bg-white border border-[#333836]/20 text-[#333836] rounded-md"
                        >
                          {c}
                        </Badge>
                      ))}
                    </div>
                  )}
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-700">
                Văn bản trích xuất (dùng để AI sinh câu hỏi):
              </p>
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto font-mono">
                {previewDoc?.extracted_text
                  ? previewDoc.extracted_text
                  : "Tài liệu chưa có văn bản trích xuất. Nhấn 'Thử lại' để AI phân tích."}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDoc(null)}>
              Đóng
            </Button>
            {previewDoc && (
              <Link
                to={`/generate?documentId=${previewDoc.id}`}
                className="h-8 px-4 rounded-lg bg-[#333836] hover:bg-[#262a28] text-[#B0FDE0] text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Sparkles className="size-3.5" />
                <span>Tạo bộ đề từ tài liệu này</span>
              </Link>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

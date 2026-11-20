import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { quizService } from "../../services/quizService.js";
import { ModerationBadge } from "../../components/ui/StatusBadge.jsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Globe,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
} from "lucide-react";

function createDefaultQuestion(position = 1) {
  return {
    position,
    question_text: "",
    question_type: "multiple_choice",
    difficulty: "medium",
    correct_option_label: "A",
    explanation: "",
    formula_latex: "",
    image_path: "",
    source_page: "",
    options: [
      { option_label: "A", option_content: "" },
      { option_label: "B", option_content: "" },
      { option_label: "C", option_content: "" },
      { option_label: "D", option_content: "" },
    ],
  };
}

export function QuizEditorPage() {
  const { id } = useParams();
  const isEditMode = Boolean(id);
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [defaultExamQuestions, setDefaultExamQuestions] = useState(20);
  const [defaultExamDuration, setDefaultExamDuration] = useState(30);
  const [visibility, setVisibility] = useState("private");
  const [moderationStatus, setModerationStatus] = useState("not_submitted");

  const [questions, setQuestions] = useState([createDefaultQuestion(1)]);
  const [loading, setLoading] = useState(isEditMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    if (!isEditMode) return;
    let mounted = true;

    async function loadQuiz() {
      setLoading(true);
      setError("");
      try {
        const { quizSet, questions: loadedQuestions } =
          await quizService.getQuizForEditor(id);
        if (!mounted) return;

        setTitle(quizSet.title || "");
        setDescription(quizSet.description || "");
        setSubject(quizSet.subject || "");
        setTopic(quizSet.topic || "");
        setDifficulty(quizSet.difficulty || "medium");
        setDefaultExamQuestions(quizSet.default_exam_questions || 20);
        setDefaultExamDuration(quizSet.default_exam_duration || 30);
        setVisibility(quizSet.visibility || "private");
        setModerationStatus(quizSet.moderation_status || "not_submitted");

        if (loadedQuestions.length > 0) {
          setQuestions(
            loadedQuestions.map((q, idx) => ({
              id: q.id,
              position: idx + 1,
              question_text: q.question_text || "",
              question_type: q.question_type || "multiple_choice",
              difficulty: q.difficulty || "medium",
              correct_option_label: q.correct_option_label || "A",
              explanation: q.explanation || "",
              formula_latex: q.formula_latex || "",
              image_path: q.image_path || "",
              source_page: q.source_page || "",
              options:
                Array.isArray(q.options) && q.options.length >= 2
                  ? q.options
                  : createDefaultQuestion(idx + 1).options,
            })),
          );
        }
      } catch (err) {
        if (mounted) setError(err.message || "Không thể tải bộ đề để chỉnh sửa.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadQuiz();
    return () => {
      mounted = false;
    };
  }, [id, isEditMode]);

  const handleAddQuestion = () => {
    setQuestions((prev) => [...prev, createDefaultQuestion(prev.length + 1)]);
  };

  const handleRemoveQuestion = (index) => {
    if (questions.length <= 1) {
      toast.error("Bộ đề phải có ít nhất 1 câu hỏi.");
      return;
    }
    setQuestions((prev) =>
      prev
        .filter((_, idx) => idx !== index)
        .map((q, idx) => ({ ...q, position: idx + 1 })),
    );
  };

  const handleQuestionChange = (index, field, value) => {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== index) return q;
        const updated = { ...q, [field]: value };

        if (field === "question_type") {
          if (value === "true_false") {
            updated.options = [
              { option_label: "A", option_content: "Đúng" },
              { option_label: "B", option_content: "Sai" },
            ];
            if (!["A", "B"].includes(updated.correct_option_label)) {
              updated.correct_option_label = "A";
            }
          } else if (updated.options.length < 4) {
            updated.options = [
              { option_label: "A", option_content: updated.options[0]?.option_content || "" },
              { option_label: "B", option_content: updated.options[1]?.option_content || "" },
              { option_label: "C", option_content: "" },
              { option_label: "D", option_content: "" },
            ];
          }
        }
        return updated;
      }),
    );
  };

  const handleOptionChange = (qIndex, optIndex, content) => {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qIndex) return q;
        const newOpts = q.options.map((o, oIdx) =>
          oIdx === optIndex ? { ...o, option_content: content } : o,
        );
        return { ...q, options: newOpts };
      }),
    );
  };

  const handleUploadImage = async (qIndex, file) => {
    if (!file) return;
    try {
      const storagePath = await quizService.uploadQuestionImage(file);
      handleQuestionChange(qIndex, "image_path", storagePath);
      toast.success("Đã tải ảnh minh họa lên.");
    } catch (err) {
      toast.error(err.message || "Không thể tải ảnh minh họa lên.");
    }
  };

  const validateBeforeSave = () => {
    if (!title.trim()) throw new Error("Vui lòng nhập tiêu đề bộ đề.");
    if (questions.length === 0) throw new Error("Bộ đề phải có ít nhất 1 câu hỏi.");
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question_text.trim()) {
        throw new Error(`Câu hỏi số ${i + 1} chưa có nội dung câu hỏi.`);
      }
      for (const opt of q.options) {
        if (!opt.option_content.trim()) {
          throw new Error(
            `Phương án ${opt.option_label} của câu hỏi số ${i + 1} đang để trống.`,
          );
        }
      }
      const hasMatchingCorrect = q.options.some(
        (o) => o.option_label === q.correct_option_label,
      );
      if (!hasMatchingCorrect) {
        throw new Error(`Câu hỏi số ${i + 1} chưa chọn đáp án đúng hợp lệ.`);
      }
    }
  };

  const handleSave = async (submitPublic = false) => {
    setError("");
    setSuccessMsg("");
    try {
      validateBeforeSave();
    } catch (validationErr) {
      setError(validationErr.message);
      return;
    }

    setSaving(true);
    try {
      if (isEditMode) {
        await quizService.updateQuizAndQuestions(
          id,
          {
            title,
            description,
            subject,
            topic,
            difficulty,
            default_exam_questions: defaultExamQuestions,
            default_exam_duration: defaultExamDuration,
          },
          questions,
        );

        if (submitPublic) {
          await quizService.submitForPublicApproval(id);
          setVisibility("public");
          setModerationStatus("pending");
          setSuccessMsg("Đã lưu thay đổi và gửi bộ đề chờ Admin kiểm duyệt Public!");
          toast.success("Đã gửi duyệt Public!");
        } else {
          const msg =
            moderationStatus === "approved"
              ? "Đã lưu thay đổi! Trạng thái đã chuyển về Chờ duyệt lại (Pending) theo quy định."
              : "Đã lưu thay đổi bộ đề thành công!";
          setSuccessMsg(msg);
          toast.success("Đã lưu thay đổi!");
          if (visibility === "public" && moderationStatus === "approved") {
            setModerationStatus("pending");
          }
        }
      } else {
        const created = await quizService.createManualQuiz({
          title,
          description,
          subject,
          topic,
          difficulty,
          defaultExamQuestions,
          defaultExamDuration,
          visibility: submitPublic ? "public" : "private",
          questions,
        });
        toast.success("Đã tạo bộ đề mới!");
        navigate(`/library/${created.id}/edit`, { replace: true });
      }
    } catch (err) {
      setError(err.message || "Không thể lưu bộ đề.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Link
            to="/library"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 mb-1"
          >
            <ArrowLeft className="size-3.5" />
            <span>Quay lại Thư viện</span>
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {isEditMode ? "Chỉnh sửa Bộ đề" : "Tạo Bộ đề Thủ công"}
            </h1>
            {isEditMode && (
              <ModerationBadge
                visibility={visibility}
                moderationStatus={moderationStatus}
              />
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => handleSave(false)}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            <span>Lưu bộ đề</span>
          </Button>

          <Button
            type="button"
            disabled={saving}
            onClick={() => handleSave(true)}
            className="bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836]"
          >
            <Globe className="size-4" />
            <span>Lưu & Gửi Public</span>
          </Button>
        </div>
      </div>

      {isEditMode && visibility === "public" && moderationStatus === "approved" && (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
          <AlertCircle className="size-4 shrink-0 mt-0.5 text-amber-600" />
          <span>
            <strong>Quy tắc kiểm duyệt:</strong> Bộ đề này đang Public. Nếu bạn chỉnh sửa nội dung, hệ thống sẽ tự động chuyển trạng thái về <strong>Chờ duyệt (Pending)</strong> để Admin kiểm duyệt lại.
          </span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-2.5"
        >
          <AlertCircle className="size-4.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-start gap-2.5">
          <CheckCircle2 className="size-4.5 shrink-0 mt-0.5 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Quiz Metadata */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardHeader className="border-b border-slate-100 pb-4">
          <CardTitle className="text-base font-bold">
            1. Thông tin chung của bộ đề
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2 space-y-1.5">
              <Label htmlFor="ed-title">Tiêu đề bộ đề *</Label>
              <Input
                id="ed-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ví dụ: Đề cương Ôn tập Lập trình Java"
                className="h-10"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ed-subject">Môn học</Label>
              <Input
                id="ed-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ví dụ: Java, Giải tích, Tiếng Anh..."
                className="h-10"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ed-topic">Chủ đề / Chương</Label>
              <Input
                id="ed-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Ví dụ: JVM, Đa hình, Collections..."
                className="h-10"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ed-diff">Độ khó mặc định</Label>
              <select
                id="ed-diff"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm bg-white outline-none focus:border-primary"
              >
                <option value="easy">Dễ (Easy)</option>
                <option value="medium">Trung bình (Medium)</option>
                <option value="hard">Khó (Hard)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ed-def-q">Số câu thi mặc định</Label>
                <Input
                  id="ed-def-q"
                  type="number"
                  min={1}
                  max={200}
                  value={defaultExamQuestions}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "") {
                      setDefaultExamQuestions("");
                      return;
                    }
                    const parsed = parseInt(raw, 10);
                    if (!Number.isNaN(parsed)) setDefaultExamQuestions(parsed);
                  }}
                  onBlur={() => {
                    if (defaultExamQuestions === "" || Number(defaultExamQuestions) < 1) {
                      setDefaultExamQuestions(60);
                    }
                  }}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ed-def-dur">Thời gian (phút)</Label>
                <Input
                  id="ed-def-dur"
                  type="number"
                  min={1}
                  max={300}
                  value={defaultExamDuration}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "") {
                      setDefaultExamDuration("");
                      return;
                    }
                    const parsed = parseInt(raw, 10);
                    if (!Number.isNaN(parsed)) setDefaultExamDuration(parsed);
                  }}
                  onBlur={() => {
                    if (defaultExamDuration === "" || Number(defaultExamDuration) < 1) {
                      setDefaultExamDuration(60);
                    }
                  }}
                  className="h-10"
                />
              </div>
            </div>

            <div className="md:col-span-2 space-y-1.5">
              <Label htmlFor="ed-desc">Mô tả bộ đề</Label>
              <Textarea
                id="ed-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Mô tả mục tiêu ôn tập, phạm vi kiến thức..."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Questions Editor */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">
            2. Danh sách câu hỏi ({questions.length} câu)
          </h2>
          <Button type="button" variant="outline" size="sm" onClick={handleAddQuestion}>
            <Plus className="size-4" />
            <span>Thêm câu hỏi</span>
          </Button>
        </div>

        {questions.map((q, qIndex) => (
          <Card key={qIndex} className="border-slate-200/80 shadow-xs">
            <CardContent className="p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <span className="text-sm font-bold text-primary">
                  Câu hỏi #{qIndex + 1}
                </span>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={q.question_type}
                    onChange={(e) =>
                      handleQuestionChange(qIndex, "question_type", e.target.value)
                    }
                    aria-label="Loại câu hỏi"
                    className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs bg-white"
                  >
                    <option value="multiple_choice">Trắc nghiệm 4 lựa chọn</option>
                    <option value="true_false">Đúng / Sai</option>
                  </select>

                  <select
                    value={q.difficulty}
                    onChange={(e) =>
                      handleQuestionChange(qIndex, "difficulty", e.target.value)
                    }
                    aria-label="Độ khó câu hỏi"
                    className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs bg-white"
                  >
                    <option value="easy">Dễ</option>
                    <option value="medium">Trung bình</option>
                    <option value="hard">Khó</option>
                  </select>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRemoveQuestion(qIndex)}
                    className="text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                    title="Xóa câu hỏi này"
                    aria-label="Xóa câu hỏi này"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Nội dung câu hỏi *</Label>
                <Textarea
                  rows={2}
                  value={q.question_text}
                  onChange={(e) =>
                    handleQuestionChange(qIndex, "question_text", e.target.value)
                  }
                  placeholder="Nhập nội dung câu hỏi..."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">
                    Công thức LaTeX (tùy chọn)
                  </Label>
                  <Input
                    value={q.formula_latex || ""}
                    onChange={(e) =>
                      handleQuestionChange(qIndex, "formula_latex", e.target.value)
                    }
                    placeholder="Ví dụ: E = mc^2"
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">
                    Ảnh minh họa (question-assets)
                  </Label>
                  <div className="flex items-center gap-2">
                    <label className="h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer shrink-0">
                      <ImageIcon className="size-3.5" />
                      <span>Chọn ảnh</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) =>
                          handleUploadImage(qIndex, e.target.files?.[0])
                        }
                      />
                    </label>
                    <Input
                      value={q.image_path || ""}
                      onChange={(e) =>
                        handleQuestionChange(qIndex, "image_path", e.target.value)
                      }
                      placeholder="Đường dẫn ảnh..."
                      className="h-9 text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Các phương án trả lời (Tích chọn đáp án ĐÚNG) *</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {q.options.map((opt, optIndex) => {
                    const isCorrect = q.correct_option_label === opt.option_label;
                    return (
                      <div
                        key={opt.option_label}
                        className={`p-3 rounded-lg border flex items-center gap-2.5 transition-colors ${
                          isCorrect
                            ? "border-emerald-500 bg-emerald-50/40"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`correct_opt_${qIndex}`}
                          checked={isCorrect}
                          onChange={() =>
                            handleQuestionChange(
                              qIndex,
                              "correct_option_label",
                              opt.option_label,
                            )
                          }
                          aria-label={`Chọn đáp án ${opt.option_label} là đáp án đúng`}
                          className="size-4 accent-emerald-600 cursor-pointer"
                        />
                        <span
                          className={`size-6 rounded-md text-xs font-bold flex items-center justify-center shrink-0 ${
                            isCorrect
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {opt.option_label}
                        </span>
                        <input
                          type="text"
                          value={opt.option_content}
                          onChange={(e) =>
                            handleOptionChange(qIndex, optIndex, e.target.value)
                          }
                          placeholder={`Nội dung đáp án ${opt.option_label}...`}
                          className="w-full bg-transparent text-sm outline-none"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Giải thích đáp án đúng</Label>
                <Textarea
                  rows={2}
                  value={q.explanation || ""}
                  onChange={(e) =>
                    handleQuestionChange(qIndex, "explanation", e.target.value)
                  }
                  placeholder="Giải thích lý do vì sao đáp án trên là chính xác..."
                />
              </div>
            </CardContent>
          </Card>
        ))}

        <Button
          type="button"
          variant="outline"
          onClick={handleAddQuestion}
          className="w-full h-11 border-dashed border-2 text-slate-600 hover:text-primary"
        >
          <Plus className="size-4" />
          <span>Thêm câu hỏi tiếp theo</span>
        </Button>
      </div>
    </div>
  );
}

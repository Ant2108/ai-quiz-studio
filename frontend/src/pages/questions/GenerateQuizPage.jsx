import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useDocuments } from "../../hooks/useDocuments.js";
import { useQuiz } from "../../hooks/useQuiz.js";
import { PageHeader } from "../../components/common/PageHeader.jsx";
import { AiProgressCard } from "../../components/common/AiProgressCard.jsx";
import { DifficultyBadge } from "../../components/ui/StatusBadge.jsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Edit3,
  Globe,
  Play,
  FileText,
  FileJson,
  Upload,
} from "lucide-react";

export function GenerateQuizPage() {
  const [searchParams] = useSearchParams();
  const initialDocId = searchParams.get("documentId") || "";
  const navigate = useNavigate();

  const { documents, loading: loadingDocs, fetchDocuments } = useDocuments();
  const {
    generating,
    generateProgress,
    error: quizError,
    generateQuiz,
    generateQuizFromJson,
    submitForPublicApproval,
  } = useQuiz();

  const [inputMode, setInputMode] = useState("document"); // "document" | "json"
  const [jsonText, setJsonText] = useState("");
  const [jsonFileName, setJsonFileName] = useState("");
  const [documentId, setDocumentId] = useState(initialDocId);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [questionCount, setQuestionCount] = useState(20);
  const [includeMultipleChoice, setIncludeMultipleChoice] = useState(true);
  const [includeTrueFalse, setIncludeTrueFalse] = useState(false);
  const [defaultExamQuestions, setDefaultExamQuestions] = useState(20);
  const [defaultExamDuration, setDefaultExamDuration] = useState(30);

  const [localError, setLocalError] = useState("");
  const [generatedResult, setGeneratedResult] = useState(null);
  const [publishing, setPublishing] = useState(false);

  const applyDocSuggestions = (doc) => {
    if (!doc?.ai_summary) return;
    setTitle((prev) =>
      prev ||
      doc.ai_summary.title_suggestion ||
      `Bộ đề: ${doc.file_name.replace(/\.[^.]+$/, "")}`,
    );
    if (doc.ai_summary.subject_suggestion) {
      setSubject((prev) => prev || doc.ai_summary.subject_suggestion);
    }
    if (Array.isArray(doc.ai_summary.topics) && doc.ai_summary.topics.length > 0) {
      setTopic((prev) => prev || doc.ai_summary.topics.slice(0, 3).join(", "));
    }
    if (doc.ai_summary.summary) {
      setDescription((prev) => prev || doc.ai_summary.summary);
    }
  };

  useEffect(() => {
    let active = true;
    async function loadDocs() {
      const loaded = await fetchDocuments();
      if (!active || !Array.isArray(loaded) || loaded.length === 0) return;
      const chosenId = initialDocId || loaded[0].id;
      setDocumentId(chosenId);
      const selectedDoc = loaded.find((d) => d.id === chosenId);
      applyDocSuggestions(selectedDoc);
    }
    loadDocs();
    return () => {
      active = false;
    };
  }, [fetchDocuments, initialDocId]);

  const handleSelectDocument = (newDocId) => {
    setDocumentId(newDocId);
    const selectedDoc = documents.find((d) => d.id === newDocId);
    applyDocSuggestions(selectedDoc);
  };

  const handleJsonFileUpload = async (file) => {
    if (!file) return;
    try {
      const content = await file.text();
      setJsonText(content);
      setJsonFileName(file.name);
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (parsed.title && !title) setTitle(String(parsed.title));
        if (parsed.subject && !subject) setSubject(String(parsed.subject));
        if (parsed.description && !description) setDescription(String(parsed.description));
        if (Array.isArray(parsed.questions)) {
          setDefaultExamQuestions(Math.min(60, parsed.questions.length));
        }
      } else if (Array.isArray(parsed)) {
        setDefaultExamQuestions(Math.min(60, parsed.length));
      }
      setLocalError("");
    } catch {
      setLocalError("File JSON không hợp lệ. Vui lòng kiểm tra cú pháp JSON.");
    }
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    setLocalError("");
    setGeneratedResult(null);

    if (inputMode === "json") {
      if (!jsonText.trim()) {
        setLocalError("Vui lòng dán nội dung JSON hoặc tải lên file .json.");
        return;
      }
      let parsedJson;
      try {
        parsedJson = JSON.parse(jsonText);
      } catch {
        setLocalError("Nội dung JSON không hợp lệ. Vui lòng kiểm tra dấu ngoặc và dấu phẩy.");
        return;
      }

      try {
        const result = await generateQuizFromJson({
          jsonPayload: parsedJson,
          title: title.trim() || parsedJson?.title || "Bộ đề từ JSON",
          description: description.trim() || parsedJson?.description || null,
          subject: subject.trim() || parsedJson?.subject || "Tổng hợp",
          topic: topic.trim() || parsedJson?.topic || null,
          difficulty,
          defaultExamQuestions: Number(defaultExamQuestions) || 60,
          defaultExamDuration: Number(defaultExamDuration) || 60,
        });
        setGeneratedResult(result);
        toast.success(
          `Tạo đề thành công từ JSON (${result.question_count} câu hỏi — không qua Gemini)!`,
        );
      } catch (err) {
        const msg = err.message || "Không thể tạo bộ đề từ JSON.";
        setLocalError(msg);
        toast.error(msg);
      }
      return;
    }

    if (!documentId) {
      setLocalError("Vui lòng chọn một tài liệu nguồn để sinh câu hỏi.");
      return;
    }

    const questionTypes = [];
    if (includeMultipleChoice) questionTypes.push("multiple_choice");
    if (includeTrueFalse) questionTypes.push("true_false");

    if (questionTypes.length === 0) {
      setLocalError("Vui lòng chọn ít nhất một dạng câu hỏi.");
      return;
    }

    if (questionCount < 1 || questionCount > 500) {
      setLocalError("Số lượng câu hỏi phải từ 1 đến 500 câu.");
      return;
    }

    try {
      const result = await generateQuiz({
        documentId,
        title: title.trim() || "Bộ đề trắc nghiệm AI",
        description: description.trim() || null,
        subject: subject.trim() || "Tổng hợp",
        topic: topic.trim() || null,
        difficulty,
        questionCount: Number(questionCount),
        questionTypes,
        defaultExamQuestions: Math.min(
          Number(defaultExamQuestions) || Number(questionCount),
          Number(questionCount),
        ),
        defaultExamDuration: Number(defaultExamDuration) || 30,
      });

      setGeneratedResult(result);
      if (result?.ai_meta?.model_id === "database-bank") {
        toast.success(
          `Tạo đề thành công từ Ngân hàng câu hỏi Database! (${result.question_count} câu hỏi)`,
        );
      } else if (result?.ai_meta?.fallback_triggered) {
        toast.success(
          `Tạo đề thành công bằng ${result.ai_meta.model_name} (tự động chuyển dự phòng) — ${result.question_count} câu hỏi!`,
        );
      } else {
        toast.success(`Tạo đề thành công! (${result.question_count} câu hỏi)`);
      }
    } catch (err) {
      const msg = err.message || "Không thể sinh bộ đề từ tài liệu này.";
      setLocalError(msg);
      toast.error(msg);
    }
  };

  const handleSubmitPublic = async () => {
    if (!generatedResult?.quiz_set?.id) return;
    setPublishing(true);
    try {
      await submitForPublicApproval(generatedResult.quiz_set.id);
      toast.success("Đã gửi bộ đề chờ Admin duyệt Public!");
      navigate(`/library`);
    } catch (err) {
      toast.error(err.message || "Không thể gửi duyệt Public.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={
          <>
            <Sparkles className="size-3.5" />
            <span>AI Quiz Generation</span>
          </>
        }
        title="Sinh Bộ đề Trắc nghiệm bằng Gemini AI"
        description="Chọn tài liệu nguồn, tùy chỉnh số câu hỏi, độ khó và dạng câu hỏi. Một tài liệu có thể sinh nhiều bộ đề khác nhau."
        actions={
          <Link
            to="/documents"
            className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
          >
            <FileText className="size-3.5" />
            <span>Tải thêm tài liệu</span>
          </Link>
        }
      />

      <Card className="border-slate-200/80 shadow-xs">
        <CardHeader className="border-b border-slate-100 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold">
                {inputMode === "json" ? "Tạo đề trực tiếp từ JSON" : "Cấu hình sinh đề AI"}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {inputMode === "json"
                  ? "Nhập trực tiếp JSON câu hỏi để tạo bộ đề ngay lập tức mà không cần gọi Gemini AI."
                  : "Hệ thống tự động chia nhỏ tài liệu lớn và kiểm định JSON đáp án trước khi lưu vào database."}
              </CardDescription>
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
              <button
                type="button"
                onClick={() => {
                  setInputMode("document");
                  setLocalError("");
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors inline-flex items-center gap-1.5 ${
                  inputMode === "document"
                    ? "bg-[#333836] text-[#B0FDE0]"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Sparkles className="size-3.5" />
                <span>Từ tài liệu</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setInputMode("json");
                  setLocalError("");
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors inline-flex items-center gap-1.5 ${
                  inputMode === "json"
                    ? "bg-[#333836] text-[#B0FDE0]"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <FileJson className="size-3.5" />
                <span>Gửi bằng JSON</span>
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          <form onSubmit={handleGenerate} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {inputMode === "json" ? (
                <div className="md:col-span-2 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="gen-json-input">Dữ liệu JSON câu hỏi (tối đa 500 câu) *</Label>
                    <label className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer">
                      <Upload className="size-3.5" />
                      <span>{jsonFileName ? `Đã chọn: ${jsonFileName}` : "Chọn file .json"}</span>
                      <input
                        type="file"
                        accept=".json,application/json"
                        className="hidden"
                        onChange={(e) => handleJsonFileUpload(e.target.files?.[0])}
                      />
                    </label>
                  </div>
                  <Textarea
                    id="gen-json-input"
                    rows={8}
                    value={jsonText}
                    onChange={(e) => setJsonText(e.target.value)}
                    placeholder={`{\n  "title": "Đề thi mẫu",\n  "questions": [\n    {\n      "question_text": "1 + 1 = ?",\n      "question_type": "multiple_choice",\n      "difficulty": "easy",\n      "options": [\n        { "option_label": "A", "option_content": "1" },\n        { "option_label": "B", "option_content": "2" }\n      ],\n      "correct_option_label": "B",\n      "explanation": "1 + 1 = 2"\n    }\n  ]\n}`}
                    className="font-mono text-xs"
                  />
                </div>
              ) : (
                <div className="md:col-span-2 space-y-1.5">
                  <Label htmlFor="gen-doc">Tài liệu nguồn *</Label>
                  {loadingDocs ? (
                    <div className="h-10 px-3 rounded-lg border border-slate-200 text-xs text-slate-500 flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin text-primary" />
                      <span>Đang tải danh sách tài liệu...</span>
                    </div>
                  ) : documents.length === 0 ? (
                    <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex flex-wrap items-center justify-between gap-2">
                      <span>Bạn chưa có tài liệu nào. Hãy tải lên PDF, DOCX, TXT, JSON hoặc ảnh trước.</span>
                      <Link
                        to="/documents"
                        className="h-7 px-3 rounded-md bg-amber-600 text-white font-semibold inline-flex items-center"
                      >
                        Tải tài liệu ngay
                      </Link>
                    </div>
                  ) : (
                    <select
                      id="gen-doc"
                      value={documentId}
                      onChange={(e) => handleSelectDocument(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm bg-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    >
                      {documents.map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.file_name} ({doc.file_type?.toUpperCase()} •{" "}
                          {doc.status === "processed" ? "Đã phân tích AI" : doc.status})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div className="md:col-span-2 space-y-1.5">
                <Label htmlFor="gen-title">Tiêu đề bộ đề *</Label>
                <Input
                  id="gen-title"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ví dụ: Đề thi thử Lập trình Java - Chương 1 & 2"
                  className="h-10"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="gen-subject">Môn học</Label>
                <Input
                  id="gen-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Ví dụ: Java, Giải tích, Tiếng Anh..."
                  className="h-10"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="gen-topic">Chủ đề trọng tâm (tùy chọn)</Label>
                <Input
                  id="gen-topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Để trống nếu muốn tạo toàn bộ tài liệu"
                  className="h-10"
                />
              </div>

              <div className="md:col-span-2 space-y-1.5">
                <Label htmlFor="gen-desc">Mô tả bộ đề (tùy chọn)</Label>
                <Input
                  id="gen-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Mô tả ngắn gọn mục tiêu ôn tập của bộ đề..."
                  className="h-10"
                />
              </div>

              {/* Question Count */}
              <div className="space-y-2">
                <Label htmlFor="gen-count">Số lượng câu hỏi (1 – 500)</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="gen-count"
                    type="number"
                    min={1}
                    max={500}
                    value={questionCount}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") {
                        setQuestionCount("");
                        return;
                      }
                      const parsed = parseInt(raw, 10);
                      if (!Number.isNaN(parsed)) setQuestionCount(parsed);
                    }}
                    onBlur={() => {
                      if (questionCount === "" || Number(questionCount) < 1) {
                        setQuestionCount(20);
                      }
                    }}
                    className="w-24 h-9 font-semibold"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {[10, 20, 30, 50, 120, 300, 500].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setQuestionCount(preset);
                          setDefaultExamQuestions(Math.min(60, preset));
                        }}
                        className={`h-9 px-3 rounded-lg text-xs font-semibold border transition-colors ${
                          questionCount === preset
                            ? "bg-[#333836] text-[#B0FDE0] border-primary"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Difficulty */}
              <div className="space-y-2">
                <Label>Độ khó mục tiêu</Label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "easy", label: "Dễ" },
                    { key: "medium", label: "Trung bình" },
                    { key: "hard", label: "Khó" },
                  ].map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => setDifficulty(d.key)}
                      className={`h-9 px-3 rounded-lg text-xs font-semibold border transition-colors ${
                        difficulty === d.key
                          ? "bg-[#333836] text-[#B0FDE0] border-primary"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Question Types */}
              <div className="space-y-2">
                <Label>Dạng câu hỏi</Label>
                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeMultipleChoice}
                      onChange={(e) => setIncludeMultipleChoice(e.target.checked)}
                      className="size-4 accent-primary rounded"
                    />
                    <span>Trắc nghiệm 4 lựa chọn</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeTrueFalse}
                      onChange={(e) => setIncludeTrueFalse(e.target.checked)}
                      className="size-4 accent-primary rounded"
                    />
                    <span>Đúng / Sai</span>
                  </label>
                </div>
              </div>

              {/* Default Exam Config */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="gen-def-q">Số câu thi mặc định</Label>
                  <Input
                    id="gen-def-q"
                    type="number"
                    min={1}
                    max={500}
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
                        setDefaultExamQuestions(Number(questionCount) || 20);
                      }
                    }}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gen-def-dur">Thời gian thi (phút)</Label>
                  <Input
                    id="gen-def-dur"
                    type="number"
                    min={5}
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
                        setDefaultExamDuration(30);
                      }
                    }}
                    className="h-9"
                  />
                </div>
              </div>
            </div>

            {(localError || quizError) && (
              <div
                role="alert"
                className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-2.5"
              >
                <AlertCircle className="size-4.5 shrink-0 mt-0.5" />
                <span>{localError || quizError}</span>
              </div>
            )}

            {generating && (
              <AiProgressCard
                active={generating}
                title={`Gemini AI đang tạo ${questionCount} câu hỏi`}
                currentMessage={
                  generateProgress?.message ||
                  "Đang đọc ngữ cảnh tài liệu, biên soạn câu hỏi, đáp án & giải thích chi tiết..."
                }
                basePercent={generateProgress?.percent ?? 10}
                currentStepIndex={generateProgress?.step === "completed" ? 4 : 1}
                estimatedSeconds={Math.max(12, Math.round(Number(questionCount) * 0.7 + 6))}
                steps={[
                  { id: "context", label: "Đọc tài liệu" },
                  {
                    id: "generate",
                    label: generateProgress?.totalBatches > 1
                      ? `Đợt ${Math.min((generateProgress.batchIndex ?? 0) + 1, generateProgress.totalBatches)}/${generateProgress.totalBatches}`
                      : `Sinh ${questionCount} câu AI`,
                  },
                  { id: "validate", label: "Kiểm tra JSON" },
                  { id: "save", label: "Lưu ngân hàng đề" },
                ]}
              />
            )}

            <div className="flex justify-end pt-4 border-t border-slate-100">
              <Button
                type="submit"
                disabled={
                  generating ||
                  (inputMode === "document" && documents.length === 0) ||
                  (inputMode === "json" && !jsonText.trim())
                }
                className="h-10 px-6 bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836] font-semibold"
              >
                {generating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>
                      {inputMode === "json"
                        ? "Đang lưu bộ đề từ JSON..."
                        : `Gemini AI đang biên soạn ${questionCount} câu...`}
                    </span>
                  </>
                ) : (
                  <>
                    {inputMode === "json" ? (
                      <FileJson className="size-4" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    <span>{inputMode === "json" ? "Tạo đề ngay từ JSON" : "Generate Quiz"}</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Preview Result */}
      {generatedResult && (
        <Card className="border-emerald-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 pb-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-emerald-700 text-xs font-bold uppercase">
                  <CheckCircle2 className="size-4" />
                  <span>Tạo đề thành công! Đã lưu bản nháp Private</span>
                </div>
                <CardTitle className="text-xl font-bold text-slate-900">
                  {generatedResult.quiz_set?.title} ({generatedResult.question_count} câu hỏi)
                </CardTitle>
                <CardDescription className="text-xs">
                  Đáp án đúng đã được lưu bảo mật trên máy chủ. Bạn có thể ôn tập ngay, mở trình biên tập hoặc gửi duyệt Public.
                </CardDescription>
                {generatedResult.ai_meta && (
                  <p className="text-xs text-slate-600 pt-1">
                    {generatedResult.ai_meta.fallback_triggered
                      ? `Gemini 3.8 Flash đã hết quota — Đã tự động tạo thành công bằng ${generatedResult.ai_meta.model_name}.`
                      : `Xử lý bằng ${generatedResult.ai_meta.model_name}.`}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Link
                  to={`/library/${generatedResult.quiz_set.id}/edit`}
                  className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
                >
                  <Edit3 className="size-3.5" />
                  <span>Chỉnh sửa</span>
                </Link>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={publishing}
                  onClick={handleSubmitPublic}
                >
                  <Globe className="size-3.5 text-primary" />
                  <span>{publishing ? "Đang gửi..." : "Gửi duyệt Public"}</span>
                </Button>

                <Link
                  to={`/quiz/${generatedResult.quiz_set.id}/study`}
                  className="h-8 px-3.5 rounded-lg bg-[#333836] hover:bg-[#262a28] text-[#B0FDE0] text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Play className="size-3.5" />
                  <span>Ôn tập ngay</span>
                </Link>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-6">
            <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
              {(generatedResult.preview_questions || []).map((q, idx) => (
                <div
                  key={q.id || idx}
                  className="p-4 rounded-lg border border-slate-200/80 bg-slate-50/50 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-primary">
                      Câu {q.position || idx + 1}
                    </span>
                    <DifficultyBadge difficulty={q.difficulty} />
                  </div>
                  <p className="text-sm font-medium text-slate-900">
                    {q.question_text}
                  </p>
                  {q.formula_latex && (
                    <code className="block text-xs bg-white p-2 rounded border border-slate-200">
                      {q.formula_latex}
                    </code>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(q.options || []).map((opt) => (
                      <div
                        key={opt.id || opt.option_label}
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
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

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
  Copy,
  Code2,
} from "lucide-react";

const SAMPLE_JSON_ARRAY = JSON.stringify(
  [
    {
      id: 1,
      question: "Which programming language is used to build Flutter apps?",
      options: {
        A: "Java",
        B: "Dart",
        C: "Kotlin",
        D: "Swift",
      },
      answer: "B",
      explanation: "Flutter sử dụng ngôn ngữ lập trình Dart do Google phát triển.",
    },
    {
      id: 2,
      question: "In Flutter, everything on the screen is a:",
      options: {
        A: "Activity",
        B: "Fragment",
        C: "Widget",
        D: "ViewController",
      },
      answer: "C",
      explanation: "Trong Flutter, mọi thành phần giao diện đều là Widget.",
    },
  ],
  null,
  2,
);

const SAMPLE_JSON_OBJECT = JSON.stringify(
  {
    title: "Flutter Fundamentals",
    subject: "Flutter",
    questions: [
      {
        question_text: "Which command creates a new Flutter project?",
        options: [
          { option_label: "A", option_content: "flutter init" },
          { option_label: "B", option_content: "flutter create" },
          { option_label: "C", option_content: "flutter new" },
          { option_label: "D", option_content: "flutter start" },
        ],
        correct_option_label: "B",
        explanation: "Lệnh flutter create <tên_dự_án> dùng để khởi tạo project Flutter mới.",
      },
    ],
  },
  null,
  2,
);

function inspectJsonDraft(rawText) {
  if (!rawText || !rawText.trim()) return null;
  try {
    const parsed = JSON.parse(rawText);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.questions)
      ? parsed.questions
      : null;
    if (!list) {
      return {
        valid: false,
        count: 0,
        message: "JSON cần là mảng câu hỏi [...] hoặc object chứa mảng \"questions\".",
      };
    }
    if (list.length === 0) {
      return { valid: false, count: 0, message: "Danh sách câu hỏi đang trống." };
    }
    if (list.length > 500) {
      return {
        valid: false,
        count: list.length,
        message: `Phát hiện ${list.length} câu hỏi — vượt giới hạn tối đa 500 câu/bộ đề.`,
      };
    }
    return {
      valid: true,
      count: list.length,
      message: `Đã nhận diện ${list.length} câu hỏi hợp lệ — sẽ tạo thẳng bộ đề không qua Gemini.`,
    };
  } catch {
    return {
      valid: false,
      count: 0,
      message: "Cú pháp JSON chưa hợp lệ (kiểm tra dấu ngoặc hoặc dấu phẩy).",
    };
  }
}

export function GenerateQuizPage() {
  const [searchParams] = useSearchParams();
  const initialDocId = searchParams.get("documentId") || "";
  const initialMode = searchParams.get("mode") === "json" ? "json" : "document";
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

  const [inputMode, setInputMode] = useState(initialMode); // "document" | "json"
  const [jsonText, setJsonText] = useState("");
  const [jsonFileName, setJsonFileName] = useState("");
  const [showJsonExample, setShowJsonExample] = useState(true);
  const [sampleTab, setSampleTab] = useState("array"); // "array" | "object"
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

  const getDocBankCount = (doc) =>
    Array.isArray(doc?.extracted_data?.questions)
      ? doc.extracted_data.questions.length
      : 0;

  const selectedDocument = documents.find((d) => d.id === documentId) || null;
  const selectedDocBankCount = getDocBankCount(selectedDocument);

  const applyDocSuggestions = (doc) => {
    if (!doc) return;
    const bankCount = getDocBankCount(doc);
    if (bankCount > 0) {
      const targetCount = Math.min(500, bankCount);
      setQuestionCount(targetCount);
      setDefaultExamQuestions(Math.min(60, targetCount));
    }
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

  const jsonDraftInfo = inputMode === "json" ? inspectJsonDraft(jsonText) : null;

  const handleCopySample = async () => {
    const sample = sampleTab === "array" ? SAMPLE_JSON_ARRAY : SAMPLE_JSON_OBJECT;
    try {
      await navigator.clipboard.writeText(sample);
      toast.success("Đã sao chép JSON mẫu!");
    } catch {
      toast.error("Không thể sao chép tự động, bạn có thể bôi đen để copy.");
    }
  };

  const handleUseSample = () => {
    const sample = sampleTab === "array" ? SAMPLE_JSON_ARRAY : SAMPLE_JSON_OBJECT;
    setJsonText(sample);
    setJsonFileName("");
    if (!title) setTitle("Flutter Sample Quiz");
    if (!subject) setSubject("Flutter");
    setDefaultExamQuestions(2);
    setLocalError("");
    toast.success("Đã điền JSON mẫu vào ô nhập.");
  };

  const handleJsonFileUpload = async (file) => {
    if (!file) return;
    try {
      const content = await file.text();
      setJsonText(content);
      setJsonFileName(file.name);
      const parsed = JSON.parse(content);
      const baseName = file.name.replace(/\.json$/i, "").replace(/[_-]+/g, " ").trim();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (parsed.title && !title) setTitle(String(parsed.title));
        else if (baseName && !title) setTitle(baseName);
        if (parsed.subject && !subject) setSubject(String(parsed.subject));
        if (parsed.description && !description) setDescription(String(parsed.description));
        if (Array.isArray(parsed.questions)) {
          setDefaultExamQuestions(Math.min(60, parsed.questions.length));
        }
      } else if (Array.isArray(parsed)) {
        if (baseName && !title) setTitle(baseName);
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
                  : "Tạo đề trực tiếp từ dữ liệu JSON / Ngân hàng câu hỏi đã trích xuất của tài liệu (0 lượt gọi Gemini, tiết kiệm token)."}
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
                    placeholder={SAMPLE_JSON_ARRAY}
                    className="font-mono text-xs"
                  />

                  {jsonDraftInfo && (
                    <div
                      className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 border ${
                        jsonDraftInfo.valid
                          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                          : "bg-amber-50 border-amber-200 text-amber-800"
                      }`}
                    >
                      {jsonDraftInfo.valid ? (
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                      ) : (
                        <AlertCircle className="size-4 shrink-0 text-amber-600" />
                      )}
                      <span>{jsonDraftInfo.message}</span>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setShowJsonExample((prev) => !prev)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800 hover:text-primary"
                      >
                        <Code2 className="size-3.5 text-primary" />
                        <span>
                          Định dạng JSON được hỗ trợ ({showJsonExample ? "Ẩn ví dụ" : "Xem ví dụ"})
                        </span>
                      </button>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSampleTab("array")}
                          className={`px-2 py-1 rounded text-[11px] font-semibold border transition-colors ${
                            sampleTab === "array"
                              ? "bg-[#333836] text-[#B0FDE0] border-[#333836]"
                              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          Kiểu mảng (question / options A-D / answer)
                        </button>
                        <button
                          type="button"
                          onClick={() => setSampleTab("object")}
                          className={`px-2 py-1 rounded text-[11px] font-semibold border transition-colors ${
                            sampleTab === "object"
                              ? "bg-[#333836] text-[#B0FDE0] border-[#333836]"
                              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          Kiểu Object (title + questions)
                        </button>
                        <button
                          type="button"
                          onClick={handleCopySample}
                          className="px-2 py-1 rounded text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1"
                        >
                          <Copy className="size-3" />
                          <span>Copy mẫu</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleUseSample}
                          className="px-2 py-1 rounded text-[11px] font-semibold bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836]"
                        >
                          Dùng mẫu này
                        </button>
                      </div>
                    </div>

                    {showJsonExample && (
                      <div className="space-y-2">
                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          Hỗ trợ cả 2 kiểu JSON: mảng câu hỏi trực tiếp <code>[...]</code> hoặc object{" "}
                          <code>{"{ title, questions: [...] }"}</code>. Các trường linh hoạt:{" "}
                          <code>question</code> / <code>question_text</code>,{" "}
                          <code>options</code> dạng object <code>{"{ A, B, C, D }"}</code> hoặc mảng,{" "}
                          <code>answer</code> / <code>correct_option_label</code>, và{" "}
                          <code>explanation</code> (tùy chọn).
                        </p>
                        <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 text-[11px] font-mono overflow-x-auto max-h-52 leading-relaxed">
                          {sampleTab === "array" ? SAMPLE_JSON_ARRAY : SAMPLE_JSON_OBJECT}
                        </pre>
                      </div>
                    )}
                  </div>
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
                      {documents.map((doc) => {
                        const bankCount = getDocBankCount(doc);
                        return (
                          <option key={doc.id} value={doc.id}>
                            {doc.file_name} ({doc.file_type?.toUpperCase()} •{" "}
                            {bankCount > 0
                              ? `${bankCount} câu JSON`
                              : doc.status === "processed"
                              ? "Chưa có câu hỏi JSON"
                              : doc.status}
                            )
                          </option>
                        );
                      })}
                    </select>
                  )}
                  {selectedDocument && (
                    <div
                      className={`mt-2 px-3 py-2 rounded-lg text-xs border flex flex-wrap items-center justify-between gap-2 ${
                        selectedDocBankCount > 0
                          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                          : "bg-amber-50 border-amber-200 text-amber-900"
                      }`}
                    >
                      <span>
                        {selectedDocBankCount > 0 ? (
                          <>
                            Ngân hàng JSON của tài liệu hiện có{" "}
                            <strong>{selectedDocBankCount} câu hỏi</strong> (tạo đề trực tiếp không gọi Gemini).
                            {Number(questionCount) > selectedDocBankCount && (
                              <>
                                {" "}
                                Đang yêu cầu {questionCount} câu → bộ đề sẽ lấy tối đa{" "}
                                <strong>{selectedDocBankCount} câu</strong> hiện có.
                              </>
                            )}
                          </>
                        ) : (
                          <>
                            Tài liệu này chưa có câu hỏi JSON trong Ngân hàng câu hỏi. Hãy vào mục{" "}
                            <Link to="/documents" className="underline font-semibold">
                              Tài liệu
                            </Link>{" "}
                            nhấn <strong>Thử lại</strong> để AI chuyển sang JSON trước.
                          </>
                        )}
                      </span>
                    </div>
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
                title={
                  inputMode === "json"
                    ? "Đang lưu bộ đề trực tiếp từ JSON (0 Gemini calls)"
                    : `Đang tạo bộ đề ${questionCount} câu từ Ngân hàng JSON`
                }
                currentMessage={
                  generateProgress?.message ||
                  "Đang lấy câu hỏi từ dữ liệu JSON đã lưu và tạo bộ đề (không gọi Gemini)..."
                }
                basePercent={generateProgress?.percent ?? 10}
                currentStepIndex={generateProgress?.step === "completed" ? 4 : 1}
                estimatedSeconds={inputMode === "json" ? 4 : 5}
                steps={[
                  { id: "context", label: "Đọc JSON" },
                  { id: "generate", label: "Kiểm định cấu trúc" },
                  { id: "validate", label: "Chuẩn hóa đáp án" },
                  { id: "save", label: "Lưu bộ đề" },
                ]}
              />
            )}

            <div className="flex justify-end pt-4 border-t border-slate-100">
              <Button
                type="submit"
                disabled={
                  generating ||
                  (inputMode === "document" && documents.length === 0) ||
                  (inputMode === "json" && (!jsonText.trim() || jsonDraftInfo?.valid === false))
                }
                className="h-10 px-6 bg-[#B0FDE0] hover:bg-[#93f5d0] text-[#333836] font-semibold"
              >
                {generating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>
                      {inputMode === "json"
                        ? "Đang lưu bộ đề từ JSON..."
                        : `Đang tạo bộ đề ${questionCount} câu...`}
                    </span>
                  </>
                ) : (
                  <>
                    {inputMode === "json" ? (
                      <FileJson className="size-4" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    <span>{inputMode === "json" ? "Tạo đề ngay từ JSON" : "Tạo đề từ dữ liệu JSON"}</span>
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

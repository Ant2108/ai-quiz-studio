// ============================================================================
// SHARED HELPER: GOOGLE GEMINI AI SERVICE
// Features:
//   - Uses GEMINI_API_KEY exclusively from Edge Function Secrets (Deno.env)
//   - Supports current Free Tier model gemini-2.5-flash (with fallback to gemini-2.0-flash)
//   - Timeout (AbortController), bounded exponential backoff retry, and 429 Quota handling
//   - Native DOCX XML extraction, TXT reading, and Multimodal PDF / Image OCR
//   - Document chunking & batched quiz generation for large question counts (up to 120)
//   - Strict JSON schema validation via validateGeneratedQuizPayload
// ============================================================================

import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { AppError } from "./response.ts";
import {
  ValidatedGeneratedQuestion,
  ValidatedGeneratedQuiz,
  validateGeneratedQuizPayload,
} from "./validation.ts";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_UPLOAD_API = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_FILES_API = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3.8-flash",
  "gemini-3.8-flash-lite-preview",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
];
const REQUEST_TIMEOUT_MS = 50_000;
const MAX_RETRIES = 2;
const MAX_CHUNK_CHARS = 16_000;
const MAX_QUESTIONS_PER_BATCH = 20;
const QUIZ_BATCH_CONCURRENCY = 1; // Sequential per Edge Function call to respect Gemini Free Tier RPM limits
const INLINE_DATA_THRESHOLD_BYTES = 1_500_000; // 1.5 MB: use Gemini Files API above this to avoid Edge Function OOM/CPU 546

function getGeminiApiKey(): string {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey || apiKey.trim() === "") {
    throw new AppError(
      "Chưa cấu hình GEMINI_API_KEY trong Supabase Edge Function Secrets.",
      500,
      "MISSING_GEMINI_API_KEY",
    );
  }
  return apiKey.trim();
}

function getCandidateModels(): string[] {
  const configured = Deno.env.get("GEMINI_MODEL")?.trim();
  if (configured) {
    return [configured, ...DEFAULT_MODELS.filter((m) => m !== configured)];
  }
  return DEFAULT_MODELS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Splits a long document text into balanced chunks so context limits are never exceeded.
 */
export function chunkDocumentText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const paragraphs = cleaned.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length <= maxChars) {
      current = current ? `${current}\n\n${para}` : para;
    } else if (para.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < para.length; i += maxChars) {
        chunks.push(para.slice(i, i + maxChars));
      }
    } else {
      if (current) chunks.push(current);
      current = para;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Extracts plain text from a .docx buffer by reading word/document.xml inside the ZIP archive
 * using standard Web DecompressionStream("deflate-raw").
 */
export async function extractTextFromDocxBytes(bytes: Uint8Array): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) {
      break; // Reached central directory or non-local file header
    }

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraFieldLength = view.getUint16(offset + 28, true);

    const nameStart = offset + 30;
    const nameBytes = bytes.subarray(nameStart, nameStart + fileNameLength);
    const entryName = new TextDecoder().decode(nameBytes);

    const dataStart = nameStart + fileNameLength + extraFieldLength;
    const dataEnd = dataStart + compressedSize;

    if (entryName === "word/document.xml" && dataEnd <= bytes.length) {
      const entryData = bytes.subarray(dataStart, dataEnd);
      let xmlText = "";

      if (compressionMethod === 0) {
        xmlText = new TextDecoder("utf-8").decode(entryData);
      } else if (compressionMethod === 8) {
        const ds = new DecompressionStream("deflate-raw");
        const writer = ds.writable.getWriter();
        writer.write(entryData);
        writer.close();
        const decompressedBuffer = await new Response(ds.readable).arrayBuffer();
        xmlText = new TextDecoder("utf-8").decode(decompressedBuffer);
      }

      if (xmlText) {
        return xmlText
          .replace(/<\/w:p>/g, "\n")
          .replace(/<w:tab\/>/g, "\t")
          .replace(/<w:br[^/>]*\/>/g, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }
    }

    offset = dataEnd;
  }

  // Fallback: extract printable UTF-8 segments if non-standard ZIP streaming header is used
  const fallbackRaw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const xmlMatches = fallbackRaw.match(/<w:t[^>]*>([^<]+)<\/w:t>/g);
  if (xmlMatches && xmlMatches.length > 0) {
    return xmlMatches
      .map((m) => m.replace(/<[^>]+>/g, ""))
      .join(" ")
      .trim();
  }

  return "";
}

/**
 * Low-level Gemini API call with timeout, model fallback, and bounded exponential backoff retry.
 */
async function callGeminiGenerateContent(params: {
  parts: Array<Record<string, unknown>>;
  systemInstruction?: string;
  responseMimeType?: string;
  temperature?: number;
  disableThinking?: boolean;
}): Promise<string> {
  const apiKey = getGeminiApiKey();
  const models = getCandidateModels();
  let lastError: unknown = null;

  for (const model of models) {
    let useThinkingConfig = Boolean(params.disableThinking);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const endpoint = `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const generationConfig: Record<string, unknown> = {
          temperature: params.temperature ?? 0.2,
          ...(params.responseMimeType
            ? { responseMimeType: params.responseMimeType }
            : {}),
        };

        if (useThinkingConfig) {
          generationConfig.thinkingConfig = { thinkingBudget: 0 };
        }

        const body: Record<string, unknown> = {
          contents: [
            {
              role: "user",
              parts: params.parts,
            },
          ],
          generationConfig,
        };

        if (params.systemInstruction) {
          body.systemInstruction = {
            parts: [{ text: params.systemInstruction }],
          };
        }

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (res.status === 400 && useThinkingConfig) {
          const errBody = await res.text().catch(() => "");
          if (errBody.toLowerCase().includes("thinking")) {
            useThinkingConfig = false;
            continue;
          }
          throw new AppError(
            `Gemini API trả về lỗi (400). ${errBody.slice(0, 200)}`,
            502,
            "GEMINI_API_ERROR",
          );
        }

        if (res.status === 429) {
          const hasNextModel = models.indexOf(model) < models.length - 1;
          if (hasNextModel) {
            // Quota of this model exhausted (RPM/RPD) -> switch to next model immediately
            lastError = new AppError(
              `Model ${model} đã hết quota (429).`,
              429,
              "GEMINI_QUOTA_EXCEEDED",
            );
            break;
          }
          if (attempt < MAX_RETRIES) {
            await sleep(2000 * Math.pow(2, attempt));
            continue;
          }
          throw new AppError(
            "Tất cả model Gemini đều đang vượt giới hạn Free Tier (429). Vui lòng đợi 1 phút và thử lại.",
            429,
            "GEMINI_QUOTA_EXCEEDED",
          );
        }

        if (res.status === 404) {
          // Model unavailable for this key/region -> try next model
          if (!lastError) {
            lastError = new AppError(`Model ${model} không khả dụng (404).`, 502, "GEMINI_MODEL_NOT_FOUND");
          }
          break;
        }

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          if (res.status >= 500 && attempt < MAX_RETRIES) {
            await sleep(1000 * Math.pow(2, attempt));
            continue;
          }
          throw new AppError(
            `Gemini API trả về lỗi (${res.status}). ${errBody.slice(0, 200)}`,
            502,
            "GEMINI_API_ERROR",
          );
        }

        const data = await res.json();
        const candidateText =
          data?.candidates?.[0]?.content?.parts
            ?.map((p: { text?: string }) => p.text || "")
            .join("") || "";

        if (!candidateText.trim()) {
          throw new AppError(
            "Gemini API trả về kết quả rỗng hoặc tài liệu không thể đọc được.",
            422,
            "GEMINI_EMPTY_RESPONSE",
          );
        }

        return candidateText.trim();
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;

        if (err instanceof DOMException && err.name === "AbortError") {
          // Do not retry full 50s timeouts multiple times to avoid hitting Supabase Edge Function wall-clock limit (546)
          throw new AppError(
            "Yêu cầu xử lý AI quá thời gian chờ (Timeout 50s). Vui lòng thử lại hoặc giảm số câu hỏi mỗi lần tạo.",
            504,
            "GEMINI_TIMEOUT",
          );
        }

        if (err instanceof AppError && err.statusCode === 429) {
          if (models.indexOf(model) < models.length - 1) break;
          throw err;
        }

        if (attempt < MAX_RETRIES) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
      }
    }
  }

  if (lastError instanceof AppError) throw lastError;
  throw new AppError(
    lastError instanceof Error ? lastError.message : "Không thể kết nối tới dịch vụ Gemini AI.",
    502,
    "GEMINI_UNAVAILABLE",
  );
}

/**
 * Safely parses JSON from Gemini text output (strips markdown code fences if present).
 */
export function parseGeminiJson(rawText: string): unknown {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Attempt to locate outer JSON object or array
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new AppError(
      "Không thể phân tích cấu trúc JSON từ phản hồi của Gemini AI.",
      422,
      "GEMINI_INVALID_JSON",
    );
  }
}

export interface DocumentAnalysisResult {
  extractedText: string;
  pageCount: number;
  summary: {
    title_suggestion: string;
    subject_suggestion: string;
    topics: string[];
    summary: string;
    key_concepts: string[];
    recommended_question_count: number;
  };
}

/**
 * Uploads binary bytes directly to Google Gemini Files API (avoids base64 memory/CPU spikes on Edge Runtime).
 */
async function uploadBytesToGeminiFilesApi(params: {
  fileBytes: Uint8Array;
  mimeType: string;
  displayName: string;
}): Promise<{ fileUri: string; fileResourceName: string }> {
  const apiKey = getGeminiApiKey();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // Step 1: Initiate resumable upload
    const startRes = await fetch(`${GEMINI_UPLOAD_API}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(params.fileBytes.byteLength),
        "X-Goog-Upload-Header-Content-Type": params.mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: params.displayName } }),
      signal: controller.signal,
    });

    if (!startRes.ok) {
      const errText = await startRes.text().catch(() => "");
      throw new AppError(
        `Không thể khởi tạo upload tài liệu lên Gemini Files API (${startRes.status}): ${errText.slice(0, 150)}`,
        502,
        "GEMINI_FILE_UPLOAD_INIT_FAILED",
      );
    }

    const uploadUrl = startRes.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      throw new AppError(
        "Gemini Files API không trả về upload URL.",
        502,
        "GEMINI_FILE_UPLOAD_URL_MISSING",
      );
    }

    // Step 2: Upload raw binary bytes without base64 encoding
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(params.fileBytes.byteLength),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: new Blob([params.fileBytes], { type: params.mimeType }),
      signal: controller.signal,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => "");
      throw new AppError(
        `Không thể tải tài liệu lên Gemini Files API (${uploadRes.status}): ${errText.slice(0, 150)}`,
        502,
        "GEMINI_FILE_UPLOAD_FAILED",
      );
    }

    const payload = await uploadRes.json();
    const fileUri = payload?.file?.uri;
    const fileResourceName = payload?.file?.name;
    let fileState = payload?.file?.state;

    if (!fileUri || !fileResourceName) {
      throw new AppError(
        "Gemini Files API không trả về file URI hợp lệ.",
        502,
        "GEMINI_FILE_URI_MISSING",
      );
    }

    // Wait briefly if Gemini is still indexing the uploaded file
    for (let i = 0; i < 6 && fileState === "PROCESSING"; i++) {
      await sleep(1500);
      const checkRes = await fetch(
        `${GEMINI_FILES_API}/${fileResourceName}?key=${encodeURIComponent(apiKey)}`,
        { signal: controller.signal },
      );
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        fileState = checkData?.state;
        if (fileState === "FAILED") {
          throw new AppError(
            "Gemini không thể đọc định dạng tài liệu này.",
            422,
            "GEMINI_FILE_PROCESSING_FAILED",
          );
        }
      }
    }

    return { fileUri, fileResourceName };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new AppError(
        "Quá thời gian tải tài liệu lên Gemini AI (Timeout). Vui lòng thử lại.",
        504,
        "GEMINI_UPLOAD_TIMEOUT",
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function deleteGeminiFileBestEffort(fileResourceName: string): Promise<void> {
  try {
    const apiKey = getGeminiApiKey();
    await fetch(`${GEMINI_FILES_API}/${fileResourceName}?key=${encodeURIComponent(apiKey)}`, {
      method: "DELETE",
    });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Analyzes an uploaded document (PDF, DOCX, TXT, or Image) with Gemini AI.
 * Performs OCR on images/scanned PDFs and extracts structured metadata + full text.
 */
export async function analyzeDocumentWithGemini(params: {
  fileBytes: Uint8Array;
  fileName: string;
  mimeType: string;
  ext: string;
  clientExtractedText?: string | null;
  clientPageCount?: number | null;
}): Promise<DocumentAnalysisResult> {
  const { fileBytes, fileName, mimeType, ext, clientExtractedText, clientPageCount } = params;

  let rawText = (clientExtractedText || "").trim();

  if (!rawText && ext === "txt") {
    rawText = new TextDecoder("utf-8", { fatal: false }).decode(fileBytes).trim();
  } else if (!rawText && ext === "docx") {
    rawText = await extractTextFromDocxBytes(fileBytes);
  }

  const systemInstruction =
    "Bạn là chuyên gia phân tích tài liệu giáo dục và OCR chính xác. " +
    "Chỉ trích xuất và tóm tắt thông tin có thật trong tài liệu nguồn, tuyệt đối không bịa thêm kiến thức ngoài tài liệu. " +
    "Trả về duy nhất 1 JSON object hợp lệ theo đúng cấu trúc yêu cầu.";

  const analysisPrompt = `Hãy đọc tài liệu "${fileName}" và trả về JSON theo cấu trúc sau:
{
  "extracted_text": "Toàn bộ nội dung văn bản trích xuất / OCR từ tài liệu (giữ nguyên các định nghĩa, công thức LaTeX nếu có, đánh dấu [Trang X] nếu xác định được trang)",
  "estimated_pages": 1,
  "title_suggestion": "Tên bộ đề gợi ý ngắn gọn sát nội dung",
  "subject_suggestion": "Môn học hoặc lĩnh vực chính",
  "topics": ["Chủ đề 1", "Chủ đề 2"],
  "summary": "Tóm tắt ngắn gọn nội dung tài liệu trong 2-4 câu",
  "key_concepts": ["Khái niệm 1", "Khái niệm 2"],
  "recommended_question_count": 20
}`;

  const parts: Array<Record<string, unknown>> = [];
  let uploadedGeminiFileName: string | null = null;

  if (rawText.length > 0) {
    // We already have plain text from TXT, DOCX, or client-side PDF extraction
    const chunks = chunkDocumentText(rawText, MAX_CHUNK_CHARS);
    const sampleForSummary = chunks.slice(0, 2).join("\n\n---\n\n");
    parts.push({
      text: `${analysisPrompt}\n\nLưu ý: Trường "extracted_text" trong JSON chỉ cần ghi "PROVIDED_IN_TEXT" vì hệ thống đã có văn bản gốc.\n\nNỘI DUNG TÀI LIỆU:\n${sampleForSummary}`,
    });
  } else if (fileBytes.byteLength > INLINE_DATA_THRESHOLD_BYTES) {
    // Large PDF / Image: upload raw binary via Gemini Files API to prevent base64 OOM / 546 Worker Error
    const uploaded = await uploadBytesToGeminiFilesApi({
      fileBytes,
      mimeType,
      displayName: fileName,
    });
    uploadedGeminiFileName = uploaded.fileResourceName;
    parts.push({
      fileData: {
        mimeType,
        fileUri: uploaded.fileUri,
      },
    });
    parts.push({
      text: analysisPrompt,
    });
  } else {
    // Small PDF or Image (<= 1.5 MB): inlineData is fast and safe
    const base64Data = encodeBase64(fileBytes);
    parts.push({
      inlineData: {
        mimeType,
        data: base64Data,
      },
    });
    parts.push({
      text: analysisPrompt,
    });
  }

  let responseText = "";
  try {
    responseText = await callGeminiGenerateContent({
      parts,
      systemInstruction,
      responseMimeType: "application/json",
      temperature: 0.1,
    });
  } finally {
    if (uploadedGeminiFileName) {
      await deleteGeminiFileBestEffort(uploadedGeminiFileName);
    }
  }

  const parsed = parseGeminiJson(responseText) as Record<string, unknown>;

  const finalExtractedText =
    rawText.length > 0
      ? rawText
      : typeof parsed.extracted_text === "string" &&
          parsed.extracted_text !== "PROVIDED_IN_TEXT"
      ? parsed.extracted_text.trim()
      : "";

  if (!finalExtractedText || finalExtractedText.length < 20) {
    throw new AppError(
      "Không thể trích xuất được nội dung văn bản từ tài liệu. Vui lòng kiểm tra file không bị hỏng hoặc quá mờ.",
      422,
      "DOCUMENT_TEXT_EXTRACTION_FAILED",
    );
  }

  const pageCount =
    typeof clientPageCount === "number" && clientPageCount > 0
      ? clientPageCount
      : typeof parsed.estimated_pages === "number" && parsed.estimated_pages > 0
      ? Math.round(parsed.estimated_pages)
      : Math.max(1, Math.ceil(finalExtractedText.length / 2500));

  return {
    extractedText: finalExtractedText,
    pageCount,
    summary: {
      title_suggestion:
        typeof parsed.title_suggestion === "string" && parsed.title_suggestion.trim()
          ? parsed.title_suggestion.trim()
          : fileName.replace(/\.[^.]+$/, ""),
      subject_suggestion:
        typeof parsed.subject_suggestion === "string" && parsed.subject_suggestion.trim()
          ? parsed.subject_suggestion.trim()
          : "Tổng hợp",
      topics: Array.isArray(parsed.topics)
        ? parsed.topics.map((t) => String(t)).filter(Boolean).slice(0, 10)
        : [],
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : "Tài liệu đã được phân tích thành công.",
      key_concepts: Array.isArray(parsed.key_concepts)
        ? parsed.key_concepts.map((c) => String(c)).filter(Boolean).slice(0, 15)
        : [],
      recommended_question_count:
        typeof parsed.recommended_question_count === "number" &&
          parsed.recommended_question_count > 0
          ? Math.min(120, Math.max(5, Math.round(parsed.recommended_question_count)))
          : 20,
    },
  };
}

/**
 * Generates structured quiz questions from document text using Gemini AI.
 * Supports chunking and multi-batch generation for large question counts (up to 120 questions)
 * while strictly enforcing that all questions & answers come from the source content.
 */
export async function generateQuizWithGemini(params: {
  documentText: string;
  title: string;
  subject?: string | null;
  topic?: string | null;
  difficulty: "easy" | "medium" | "hard";
  questionCount: number;
  questionTypes: Array<"multiple_choice" | "true_false">;
  startChunkIndex?: number;
}): Promise<ValidatedGeneratedQuiz> {
  const {
    documentText,
    title,
    subject,
    topic,
    difficulty,
    questionCount,
    questionTypes,
    startChunkIndex = 0,
  } = params;

  const chunks = chunkDocumentText(documentText, MAX_CHUNK_CHARS);
  if (chunks.length === 0) {
    throw new AppError(
      "Tài liệu chưa có nội dung văn bản để sinh câu hỏi. Vui lòng xử lý tài liệu trước.",
      400,
      "EMPTY_DOCUMENT_CONTENT",
    );
  }

  const totalBatches = Math.max(1, Math.ceil(questionCount / MAX_QUESTIONS_PER_BATCH));
  const batchConfigs: Array<{ batchIdx: number; batchCount: number; chunkContent: string }> = [];

  let remaining = questionCount;
  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batchCount =
      batchIdx === totalBatches - 1
        ? remaining
        : Math.min(MAX_QUESTIONS_PER_BATCH, Math.ceil(remaining / (totalBatches - batchIdx)));

    if (batchCount <= 0) break;
    remaining -= batchCount;

    batchConfigs.push({
      batchIdx,
      batchCount,
      chunkContent: chunks[(startChunkIndex + batchIdx) % chunks.length],
    });
  }

  const systemInstruction =
    "Bạn là chuyên gia biên soạn đề thi trắc nghiệm học thuật chuẩn xác. " +
    "NGUYÊN TẮC BẮT BUỘC:\n" +
    "1. Chỉ tạo câu hỏi và đáp án dựa trên nội dung tài liệu nguồn được cung cấp. Tuyệt đối KHÔNG tự bịa thông tin ngoài tài liệu.\n" +
    "2. Mỗi câu hỏi multiple_choice phải có đúng 4 phương án A, B, C, D với option_content đầy đủ (tuyệt đối không để trống). Mỗi câu hỏi true_false phải có đúng 2 phương án A (Đúng) và B (Sai).\n" +
    "3. Trường correct_option_label phải khớp chính xác với một trong các option_label của câu hỏi đó.\n" +
    "4. Nếu câu hỏi có công thức toán/lý/hóa, biểu diễn trong trường formula_latex ở dạng LaTeX chuẩn.\n" +
    "5. Trả về duy nhất JSON hợp lệ theo schema yêu cầu.";

  const allValidatedQuestions: ValidatedGeneratedQuestion[] = [];

  for (let i = 0; i < batchConfigs.length; i += QUIZ_BATCH_CONCURRENCY) {
    const wave = batchConfigs.slice(i, i + QUIZ_BATCH_CONCURRENCY);
    const waveResults = await Promise.all(
      wave.map(async ({ batchIdx, batchCount, chunkContent }) => {
        const prompt = `Hãy tạo chính xác ${batchCount} câu hỏi trắc nghiệm từ nội dung tài liệu bên dưới.
Thông tin cấu hình:
- Tên bộ đề: ${title}
- Môn học: ${subject || "Theo tài liệu"}
- Chủ đề trọng tâm: ${topic || "Toàn bộ nội dung trong đoạn tài liệu"}
- Độ khó mục tiêu: ${difficulty}
- Các loại câu hỏi được phép sử dụng: ${questionTypes.join(", ")}
- Phần ${batchIdx + 1}/${totalBatches}: tập trung tạo các câu hỏi khác biệt, không trùng lặp với phần khác.

Cấu trúc JSON bắt buộc:
{
  "title": "${title.replace(/"/g, '\\"')}",
  "questions": [
    {
      "question_text": "Nội dung câu hỏi rõ ràng, đầy đủ?",
      "question_type": "multiple_choice",
      "difficulty": "${difficulty}",
      "options": [
        { "option_label": "A", "option_content": "Nội dung lựa chọn A" },
        { "option_label": "B", "option_content": "Nội dung lựa chọn B" },
        { "option_label": "C", "option_content": "Nội dung lựa chọn C" },
        { "option_label": "D", "option_content": "Nội dung lựa chọn D" }
      ],
      "correct_option_label": "A",
      "explanation": "Giải thích ngắn gọn 1-2 câu vì sao đáp án đúng theo tài liệu nguồn.",
      "formula_latex": null,
      "source_page": 1
    }
  ]
}

NỘI DUNG TÀI LIỆU NGUỒN:
"""
${chunkContent}
"""`;

        const rawResponse = await callGeminiGenerateContent({
          parts: [{ text: prompt }],
          systemInstruction,
          responseMimeType: "application/json",
          temperature: 0.25,
          disableThinking: true,
        });

        const parsedJson = parseGeminiJson(rawResponse);
        return validateGeneratedQuizPayload(parsedJson, title, difficulty);
      }),
    );

    for (const validatedBatch of waveResults) {
      allValidatedQuestions.push(...validatedBatch.questions);
    }
  }

  return {
    title,
    questions: allValidatedQuestions.slice(0, questionCount),
  };
}

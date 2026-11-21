// ============================================================================
// SHARED HELPER: GOOGLE GEMINI AI SERVICE WITH AUTOMATIC FALLBACK
// Features:
//   - Uses GEMINI_API_KEY exclusively from Edge Function Secrets (Deno.env)
//   - Centralized configurable model fallback chain:
//       1. gemini-3.8-flash (Gemini 3.8 Flash - Primary)
//       2. gemini-3-flash-preview (Gemini 3 Flash - Secondary)
//       3. gemini-flash-lite-latest (Gemini Flash-Lite - Fallback)
//   - Intelligent error classification (RPD vs RPM vs TPM vs 503 vs 401/403 vs 400)
//   - Reuses single Storage/Gemini uploaded PDF across fallback models
//   - Zero-external-dependency chunked Base64 + DecompressionStream DOCX extraction
//   - Strict JSON schema validation via validateGeneratedQuizPayload
// ============================================================================

import { AppError } from "./response.ts";
import {
  type GeminiInputType,
  type GeminiModelConfig,
  getActiveGeminiModels,
} from "./gemini-models.ts";
import { classifyGeminiApiError } from "./gemini-errors.ts";
import {
  type ValidatedGeneratedQuestion,
  type ValidatedGeneratedQuiz,
  validateGeneratedQuizPayload,
} from "./validation.ts";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_UPLOAD_API = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_FILES_API = "https://generativelanguage.googleapis.com/v1beta";

const DEFAULT_REQUEST_TIMEOUT_MS = 50_000;
const MAX_TRANSIENT_RETRIES = 2; // Bounded retry count for RPM / TPM / 503
const MAX_RETRY_WAIT_MS = 8_000;
const MAX_CHUNK_CHARS = 16_000;
const MAX_QUESTIONS_PER_BATCH = 20;
const INLINE_DATA_THRESHOLD_BYTES = 1_500_000; // 1.5 MB threshold for Gemini Files API

export interface GeminiAttemptTrace {
  modelId: string;
  displayName: string;
  status: "succeeded" | "switched" | "failed";
  category?: string;
  retries: number;
  message: string;
}

export interface GeminiExecutionMeta {
  model_id: string;
  model_name: string;
  fallback_triggered: boolean;
  status_messages: string[];
  attempts: GeminiAttemptTrace[];
}

export interface GeminiRuntimeDeps {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  apiKeyOverride?: string;
  modelRegistry?: GeminiModelConfig[];
  preferredModelId?: string | null;
  requestTimeoutMs?: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(""));
}

function getGeminiApiKey(override?: string): string {
  if (override !== undefined) {
    if (!override.trim()) {
      throw new AppError(
        "Chưa cấu hình GEMINI_API_KEY trong Supabase Edge Function Secrets.",
        500,
        "MISSING_GEMINI_API_KEY",
      );
    }
    return override.trim();
  }
  const apiKey = typeof Deno !== "undefined" ? Deno.env?.get?.("GEMINI_API_KEY") : undefined;
  if (!apiKey || apiKey.trim() === "") {
    throw new AppError(
      "Chưa cấu hình GEMINI_API_KEY trong Supabase Edge Function Secrets.",
      500,
      "MISSING_GEMINI_API_KEY",
    );
  }
  return apiKey.trim();
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
      break;
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
 * Core Gemini generateContent executor with:
 *   - Configurable priority fallback chain
 *   - Intelligent error classification (RPD -> immediate switch, RPM/TPM -> RetryInfo delay then switch,
 *     503 -> exponential backoff then switch, 401/403/400 -> fail cleanly)
 *   - Traceable status messages for frontend UI
 */
export async function callGeminiGenerateContent(params: {
  parts: Array<Record<string, unknown>>;
  systemInstruction?: string;
  responseMimeType?: string;
  temperature?: number;
  disableThinking?: boolean;
  requiredInput?: GeminiInputType;
  deps?: GeminiRuntimeDeps;
}): Promise<{ text: string; meta: GeminiExecutionMeta }> {
  const deps = params.deps ?? {};
  const fetchFn = deps.fetchImpl ?? fetch;
  const sleepFn = deps.sleepImpl ?? defaultSleep;
  const timeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const apiKey = getGeminiApiKey(deps.apiKeyOverride);

  const models = getActiveGeminiModels({
    requiredInput: params.requiredInput,
    preferredModelId: deps.preferredModelId,
    registry: deps.modelRegistry,
  });

  if (models.length === 0) {
    throw new AppError(
      "Không có model Gemini AI nào được kích hoạt cho định dạng tài liệu này.",
      500,
      "NO_ENABLED_GEMINI_MODELS",
    );
  }

  const attempts: GeminiAttemptTrace[] = [];
  const statusMessages: string[] = [];
  let lastError: AppError | null = null;
  let lastWasQuota = false;

  for (let mIdx = 0; mIdx < models.length; mIdx++) {
    const modelCfg = models[mIdx];
    const hasNextModel = mIdx < models.length - 1;
    const nextModelCfg = hasNextModel ? models[mIdx + 1] : null;
    let useThinkingConfig = Boolean(params.disableThinking && modelCfg.supportsThinkingConfig);
    let retriesOnCurrentModel = 0;

    if (mIdx === 0) {
      statusMessages.push(`Đang xử lý bằng ${modelCfg.displayName}...`);
    }

    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const endpoint = `${GEMINI_API_BASE}/${modelCfg.id}:generateContent?key=${encodeURIComponent(apiKey)}`;
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

        const res = await fetchFn(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");

          // Graceful fallback if this model rejects thinkingConfig
          if (
            res.status === 400 &&
            useThinkingConfig &&
            errBody.toLowerCase().includes("thinking")
          ) {
            useThinkingConfig = false;
            continue;
          }

          const classified = classifyGeminiApiError(res.status, errBody, modelCfg.displayName);

          if (classified.category === "AUTH_ERROR") {
            attempts.push({
              modelId: modelCfg.id,
              displayName: modelCfg.displayName,
              status: "failed",
              category: classified.category,
              retries: retriesOnCurrentModel,
              message: classified.userMessage,
            });
            throw new AppError(classified.userMessage, 401, "GEMINI_AUTH_ERROR");
          }

          if (classified.category === "BAD_REQUEST_400") {
            attempts.push({
              modelId: modelCfg.id,
              displayName: modelCfg.displayName,
              status: "failed",
              category: classified.category,
              retries: retriesOnCurrentModel,
              message: classified.userMessage,
            });
            throw new AppError(classified.userMessage, 400, "GEMINI_INVALID_REQUEST");
          }

          if (classified.category === "RPD_EXCEEDED" || classified.category === "MODEL_NOT_FOUND_404" || classified.action === "switch_model") {
            lastWasQuota = classified.httpStatus === 429;
            lastError = new AppError(
              classified.userMessage,
              classified.httpStatus === 429 ? 429 : 502,
              classified.category,
            );
            attempts.push({
              modelId: modelCfg.id,
              displayName: modelCfg.displayName,
              status: hasNextModel ? "switched" : "failed",
              category: classified.category,
              retries: retriesOnCurrentModel,
              message: classified.userMessage,
            });
            if (nextModelCfg) {
              statusMessages.push(
                `${modelCfg.displayName} đã hết quota. Đang chuyển sang ${nextModelCfg.displayName}...`,
              );
            }
            break; // Immediately switch to next model
          }

          // retry_then_switch: RPM_EXCEEDED, TPM_EXCEEDED, OVERLOADED_503, SERVER_ERROR_5XX
          if (attempt < MAX_TRANSIENT_RETRIES) {
            retriesOnCurrentModel++;
            const fallbackDelayMs =
              classified.category === "OVERLOADED_503"
                ? 1000 * Math.pow(2, attempt)
                : 1500 * Math.pow(2, attempt);
            const waitMs = Math.min(
              classified.retryDelayMs ?? fallbackDelayMs,
              MAX_RETRY_WAIT_MS,
            );
            if (classified.category === "RPM_EXCEEDED" || classified.category === "TPM_EXCEEDED") {
              statusMessages.push(
                `${modelCfg.displayName} chạm giới hạn tốc độ, đang thử lại (${retriesOnCurrentModel}/${MAX_TRANSIENT_RETRIES})...`,
              );
            }
            await sleepFn(waitMs);
            continue;
          }

          lastWasQuota = classified.httpStatus === 429;
          lastError = new AppError(
            classified.userMessage,
            classified.httpStatus === 429 ? 429 : classified.httpStatus >= 500 ? 503 : 502,
            classified.category,
          );
          attempts.push({
            modelId: modelCfg.id,
            displayName: modelCfg.displayName,
            status: hasNextModel ? "switched" : "failed",
            category: classified.category,
            retries: retriesOnCurrentModel,
            message: classified.userMessage,
          });
          if (nextModelCfg) {
            statusMessages.push(
              `${modelCfg.displayName} gặp sự cố. Đang thử model dự phòng (${nextModelCfg.displayName})...`,
            );
          }
          break;
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

        attempts.push({
          modelId: modelCfg.id,
          displayName: modelCfg.displayName,
          status: "succeeded",
          retries: retriesOnCurrentModel,
          message: `Hoàn tất bằng ${modelCfg.displayName}`,
        });

        return {
          text: candidateText.trim(),
          meta: {
            model_id: modelCfg.id,
            model_name: modelCfg.displayName,
            fallback_triggered: mIdx > 0,
            status_messages: statusMessages,
            attempts,
          },
        };
      } catch (err) {
        clearTimeout(timeoutId);

        if (err instanceof AppError) {
          // Do not fall back on fatal auth/client validation/empty response errors
          if (
            err.code === "GEMINI_AUTH_ERROR" ||
            err.code === "GEMINI_INVALID_REQUEST" ||
            err.code === "GEMINI_EMPTY_RESPONSE"
          ) {
            throw err;
          }
          lastError = err;
          break;
        }

        const isAbort =
          (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError");

        if (isAbort) {
          lastError = new AppError(
            `Yêu cầu tới ${modelCfg.displayName} quá thời gian chờ (Timeout).`,
            504,
            "GEMINI_TIMEOUT",
          );
          attempts.push({
            modelId: modelCfg.id,
            displayName: modelCfg.displayName,
            status: hasNextModel ? "switched" : "failed",
            category: "NETWORK_TIMEOUT",
            retries: retriesOnCurrentModel,
            message: `${modelCfg.displayName} quá thời gian chờ.`,
          });
          if (nextModelCfg) {
            statusMessages.push(`Đang thử model dự phòng (${nextModelCfg.displayName})...`);
          }
          break; // Switch to faster fallback model without looping timeouts
        }

        // Transient network error
        if (attempt < MAX_TRANSIENT_RETRIES) {
          retriesOnCurrentModel++;
          await sleepFn(1000 * Math.pow(2, attempt));
          continue;
        }

        lastError = new AppError(
          err instanceof Error ? err.message : "Không thể kết nối tới dịch vụ Gemini AI.",
          502,
          "GEMINI_NETWORK_ERROR",
        );
        attempts.push({
          modelId: modelCfg.id,
          displayName: modelCfg.displayName,
          status: hasNextModel ? "switched" : "failed",
          category: "NETWORK_ERROR",
          retries: retriesOnCurrentModel,
          message: lastError.message,
        });
        if (nextModelCfg) {
          statusMessages.push(`Đang thử model dự phòng (${nextModelCfg.displayName})...`);
        }
        break;
      }
    }
  }

  if (lastWasQuota) {
    throw new AppError(
      "Tất cả model Gemini (3.8 Flash, 3 Flash, Flash-Lite) đều đang vượt giới hạn quota Free Tier. Vui lòng đợi ít phút rồi thử lại.",
      429,
      "GEMINI_ALL_MODELS_QUOTA_EXCEEDED",
      { attempts },
    );
  }

  if (lastError) {
    throw new AppError(
      lastError.message,
      lastError.statusCode,
      lastError.code,
      { attempts },
    );
  }

  throw new AppError(
    "Không thể kết nối tới dịch vụ Gemini AI trên tất cả các model khả dụng.",
    502,
    "GEMINI_UNAVAILABLE",
    { attempts },
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
  aiMeta: GeminiExecutionMeta;
}

/**
 * Uploads binary bytes ONCE to Google Gemini Files API so fallback models reuse the same fileUri.
 */
async function uploadBytesToGeminiFilesApi(params: {
  fileBytes: Uint8Array;
  mimeType: string;
  displayName: string;
  deps?: GeminiRuntimeDeps;
}): Promise<{ fileUri: string; fileResourceName: string }> {
  const deps = params.deps ?? {};
  const fetchFn = deps.fetchImpl ?? fetch;
  const sleepFn = deps.sleepImpl ?? defaultSleep;
  const timeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const apiKey = getGeminiApiKey(deps.apiKeyOverride);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const startRes = await fetchFn(`${GEMINI_UPLOAD_API}?key=${encodeURIComponent(apiKey)}`, {
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
      const classified = classifyGeminiApiError(startRes.status, errText, "Gemini Files API");
      throw new AppError(
        classified.category === "AUTH_ERROR"
          ? classified.userMessage
          : `Không thể khởi tạo upload tài liệu lên Gemini Files API (${startRes.status}).`,
        classified.httpStatus === 401 || classified.httpStatus === 403 ? 401 : 502,
        classified.category === "AUTH_ERROR" ? "GEMINI_AUTH_ERROR" : "GEMINI_FILE_UPLOAD_INIT_FAILED",
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

    const uploadRes = await fetchFn(uploadUrl, {
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

    for (let i = 0; i < 6 && fileState === "PROCESSING"; i++) {
      await sleepFn(1500);
      const checkRes = await fetchFn(
        `${GEMINI_FILES_API}/${fileResourceName}?key=${encodeURIComponent(apiKey)}`,
        { signal: controller.signal },
      );
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        fileState = checkData?.state;
        if (fileState === "FAILED") {
          throw new AppError(
            "Tài liệu PDF không hợp lệ hoặc Gemini không thể đọc định dạng này.",
            400,
            "GEMINI_FILE_PROCESSING_FAILED",
          );
        }
      }
    }

    return { fileUri, fileResourceName };
  } catch (err) {
    const isAbort =
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError");
    if (isAbort) {
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

async function deleteGeminiFileBestEffort(
  fileResourceName: string,
  deps?: GeminiRuntimeDeps,
): Promise<void> {
  try {
    const fetchFn = deps?.fetchImpl ?? fetch;
    const apiKey = getGeminiApiKey(deps?.apiKeyOverride);
    await fetchFn(`${GEMINI_FILES_API}/${fileResourceName}?key=${encodeURIComponent(apiKey)}`, {
      method: "DELETE",
    });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Analyzes an uploaded document (PDF, DOCX, TXT, or Image) with automatic Gemini model fallback.
 * Reuses the same uploaded file/bytes when switching between fallback models.
 */
export async function analyzeDocumentWithGemini(params: {
  fileBytes: Uint8Array;
  fileName: string;
  mimeType: string;
  ext: string;
  clientExtractedText?: string | null;
  clientPageCount?: number | null;
  deps?: GeminiRuntimeDeps;
}): Promise<DocumentAnalysisResult> {
  const {
    fileBytes,
    fileName,
    mimeType,
    ext,
    clientExtractedText,
    clientPageCount,
    deps,
  } = params;

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
  let requiredInput: GeminiInputType = "text";

  if (rawText.length > 0) {
    const chunks = chunkDocumentText(rawText, MAX_CHUNK_CHARS);
    const sampleForSummary = chunks.slice(0, 2).join("\n\n---\n\n");
    parts.push({
      text: `${analysisPrompt}\n\nLưu ý: Trường "extracted_text" trong JSON chỉ cần ghi "PROVIDED_IN_TEXT" vì hệ thống đã có văn bản gốc.\n\nNỘI DUNG TÀI LIỆU:\n${sampleForSummary}`,
    });
  } else {
    requiredInput = ext === "pdf" ? "pdf" : "image";
    if (fileBytes.byteLength > INLINE_DATA_THRESHOLD_BYTES) {
      // Uploaded ONCE and reused across all fallback attempts
      const uploaded = await uploadBytesToGeminiFilesApi({
        fileBytes,
        mimeType,
        displayName: fileName,
        deps,
      });
      uploadedGeminiFileName = uploaded.fileResourceName;
      parts.push({
        fileData: {
          mimeType,
          fileUri: uploaded.fileUri,
        },
      });
      parts.push({ text: analysisPrompt });
    } else {
      const base64Data = uint8ArrayToBase64(fileBytes);
      parts.push({
        inlineData: {
          mimeType,
          data: base64Data,
        },
      });
      parts.push({ text: analysisPrompt });
    }
  }

  let responseText = "";
  let aiMeta: GeminiExecutionMeta;

  try {
    const res = await callGeminiGenerateContent({
      parts,
      systemInstruction,
      responseMimeType: "application/json",
      temperature: 0.1,
      disableThinking: false,
      requiredInput,
      deps,
    });
    responseText = res.text;
    aiMeta = res.meta;
  } finally {
    if (uploadedGeminiFileName) {
      await deleteGeminiFileBestEffort(uploadedGeminiFileName, deps);
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
    aiMeta,
  };
}

export interface GeneratedQuizWithMeta extends ValidatedGeneratedQuiz {
  aiMeta: GeminiExecutionMeta;
}

/**
 * Generates structured quiz questions from document text using automatic Gemini model fallback.
 * Propagates the winning model to subsequent chunks so exhausted models aren't re-attempted.
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
  deps?: GeminiRuntimeDeps;
}): Promise<GeneratedQuizWithMeta> {
  const {
    documentText,
    title,
    subject,
    topic,
    difficulty,
    questionCount,
    questionTypes,
    startChunkIndex = 0,
    deps = {},
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
  const systemInstruction =
    "Bạn là chuyên gia biên soạn đề thi trắc nghiệm học thuật chuẩn xác. " +
    "NGUYÊN TẮC BẮT BUỘC:\n" +
    "1. Chỉ tạo câu hỏi và đáp án dựa trên nội dung tài liệu nguồn được cung cấp. Tuyệt đối KHÔNG tự bịa thông tin ngoài tài liệu.\n" +
    "2. Mỗi câu hỏi multiple_choice phải có đúng 4 phương án A, B, C, D với option_content đầy đủ (tuyệt đối không để trống). Mỗi câu hỏi true_false phải có đúng 2 phương án A (Đúng) và B (Sai).\n" +
    "3. Trường correct_option_label phải khớp chính xác với một trong các option_label của câu hỏi đó.\n" +
    "4. Nếu câu hỏi có công thức toán/lý/hóa, biểu diễn trong trường formula_latex ở dạng LaTeX chuẩn.\n" +
    "5. Trả về duy nhất JSON hợp lệ theo schema yêu cầu.";

  const allValidatedQuestions: ValidatedGeneratedQuestion[] = [];
  let remaining = questionCount;
  let activePreferredModel = deps.preferredModelId ?? null;
  let combinedMeta: GeminiExecutionMeta | null = null;

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batchCount =
      batchIdx === totalBatches - 1
        ? remaining
        : Math.min(MAX_QUESTIONS_PER_BATCH, Math.ceil(remaining / (totalBatches - batchIdx)));
    if (batchCount <= 0) break;
    remaining -= batchCount;

    const chunkContent = chunks[(startChunkIndex + batchIdx) % chunks.length];

    const prompt = `Hãy tạo chính xác ${batchCount} câu hỏi trắc nghiệm từ nội dung tài liệu bên dưới.
Thông tin cấu hình:
- Tên bộ đề: ${title}
- Môn học: ${subject || "Theo tài liệu"}
- Chủ đề trọng tâm: ${topic || "Toàn bộ nội dung trong đoạn tài liệu"}
- Độ khó mục tiêu: ${difficulty}
- Các loại câu hỏi được phép sử dụng: ${questionTypes.join(", ")}
- Phần ${startChunkIndex + batchIdx + 1}: tập trung tạo các câu hỏi khác biệt, không trùng lặp với phần khác.

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

    const { text: rawResponse, meta } = await callGeminiGenerateContent({
      parts: [{ text: prompt }],
      systemInstruction,
      responseMimeType: "application/json",
      temperature: 0.25,
      disableThinking: true,
      requiredInput: "json_output",
      deps: {
        ...deps,
        preferredModelId: activePreferredModel,
      },
    });

    // If a fallback model succeeded, keep using it for any subsequent batch in this request
    activePreferredModel = meta.model_id;
    combinedMeta = meta;

    const parsedJson = parseGeminiJson(rawResponse);
    const validatedBatch = validateGeneratedQuizPayload(parsedJson, title, difficulty);
    allValidatedQuestions.push(...validatedBatch.questions);
  }

  return {
    title,
    questions: allValidatedQuestions.slice(0, questionCount),
    aiMeta: combinedMeta ?? {
      model_id: activePreferredModel || "gemini-3.8-flash",
      model_name: "Gemini 3.8 Flash",
      fallback_triggered: false,
      status_messages: [],
      attempts: [],
    },
  };
}

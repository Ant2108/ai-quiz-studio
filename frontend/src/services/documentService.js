// ============================================================================
// SERVICE: DOCUMENT UPLOAD, VALIDATION & AI PROCESSING
// Storage Bucket: exam-documents (private)
// Path format:    exam-documents/<USER_UUID>/<filename>
// ============================================================================

import { invokeEdgeFunction, supabase } from "./supabaseClient.js";

export const ALLOWED_EXTENSIONS = [
  "pdf",
  "docx",
  "txt",
  "json",
  "png",
  "jpg",
  "jpeg",
  "webp",
];

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
];

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const EXT_TO_MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function validateFileBeforeUpload(file) {
  if (!file) {
    throw new Error("Vui lòng chọn một file để tải lên.");
  }

  const ext = (file.name.split(".").pop() || "").toLowerCase().trim();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(
      `Định dạng .${ext || "unknown"} không được hỗ trợ. Chỉ chấp nhận PDF, DOCX, TXT, JSON, PNG, JPG, WEBP.`,
    );
  }

  const resolvedMime =
    file.type && ALLOWED_MIME_TYPES.includes(file.type)
      ? file.type
      : EXT_TO_MIME[ext];

  if (!resolvedMime || !ALLOWED_MIME_TYPES.includes(resolvedMime)) {
    throw new Error("Kiểu MIME của file không hợp lệ.");
  }

  if (file.size <= 0) {
    throw new Error("File rỗng (0 bytes). Vui lòng chọn file hợp lệ.");
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("Dung lượng file vượt quá giới hạn tối đa 20MB.");
  }

  return { ext, mimeType: resolvedMime };
}

function sanitizeStorageFileName(fileName) {
  return fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_");
}

/**
 * Best-effort client-side text extraction for .txt and .pdf using pdfjs-dist.
 * Scanned PDFs, DOCX, and Images are processed server-side in `process-document`.
 */
async function tryExtractClientText(file, ext) {
  try {
    if (ext === "txt" || ext === "json") {
      const text = await file.text();
      return {
        extractedText: text.trim(),
        pageCount: ext === "json" ? 1 : Math.max(1, Math.ceil(text.length / 2500)),
      };
    }

    if (ext === "pdf") {
      const pdfjsLib = await import("pdfjs-dist");
      if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
      }

      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;
      const pageTexts = [];

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const strings = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .trim();
        if (strings) {
          pageTexts.push(`[Trang ${pageNum}]\n${strings}`);
        }
      }

      const fullText = pageTexts.join("\n\n").trim();
      return {
        extractedText: fullText.length >= 40 ? fullText : null,
        pageCount: numPages,
      };
    }
  } catch (err) {
    console.warn("[documentService.tryExtractClientText] Fallback to server OCR:", err);
  }

  return { extractedText: null, pageCount: null };
}

export const documentService = {
  /**
   * Uploads a document to private bucket `exam-documents/<USER_UUID>/<filename>`,
   * inserts a record in `public.documents`, and optionally triggers `process-document`.
   */
  async uploadAndProcessDocument(file, onProgress = () => {}) {
    const { ext, mimeType } = validateFileBeforeUpload(file);

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error("Vui lòng đăng nhập để tải lên tài liệu.");
    }

    onProgress({ step: "validating", percent: 10, message: "Đang kiểm tra định dạng file..." });

    const clientExtraction = await tryExtractClientText(file, ext);

    onProgress({ step: "uploading", percent: 35, message: "Đang tải tài liệu lên kho lưu trữ bảo mật..." });

    const safeName = sanitizeStorageFileName(file.name);
    const storagePath = `${user.id}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("exam-documents")
      .upload(storagePath, file, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Không thể tải file lên Storage: ${uploadError.message}`);
    }

    onProgress({ step: "saving_record", percent: 60, message: "Đang lưu thông tin tài liệu..." });

    const insertPayload = {
      user_id: user.id,
      file_name: file.name,
      file_path: storagePath,
      file_type: ext,
      mime_type: mimeType,
      file_size: file.size,
      status: "uploaded",
      visibility: "private",
    };

    const { data: docRecord, error: dbError } = await supabase
      .from("documents")
      .insert(insertPayload)
      .select("*")
      .single();

    if (dbError || !docRecord) {
      // Cleanup uploaded storage object if DB insert fails
      await supabase.storage.from("exam-documents").remove([storagePath]);
      throw new Error(`Không thể lưu bản ghi tài liệu: ${dbError?.message || "DB error"}`);
    }

    onProgress({
      step: "processing_ai",
      percent: 80,
      message:
        ext === "json"
          ? "Đang kiểm định & lưu bộ câu hỏi JSON (không qua Gemini)..."
          : "Đang xử lý bằng Gemini 3.8 Flash...",
    });

    const processedResult = await this.processDocument(docRecord.id, clientExtraction);

    onProgress({
      step: "completed",
      percent: 100,
      aiMeta: processedResult?.ai_meta || null,
      message: "Hoàn tất phân tích tài liệu!",
    });

    const finalDoc = processedResult.document || docRecord;
    return processedResult?.ai_meta
      ? { ...finalDoc, ai_meta: processedResult.ai_meta }
      : finalDoc;
  },

  /**
   * Invokes the `process-document` Edge Function to run AI analysis / OCR.
   */
  async processDocument(documentId, clientExtraction = {}) {
    return await invokeEdgeFunction("process-document", {
      document_id: documentId,
      extracted_text: clientExtraction?.extractedText || null,
      page_count: clientExtraction?.pageCount || null,
    });
  },

  /**
   * Lists all documents belonging to the currently logged-in user.
   */
  async listMyDocuments() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async getDocumentById(documentId) {
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Deletes a document from both `exam-documents` Storage and `public.documents`.
   */
  async deleteDocument(documentId) {
    const doc = await this.getDocumentById(documentId);
    if (doc?.file_path) {
      await supabase.storage.from("exam-documents").remove([doc.file_path]);
    }

    const { error } = await supabase
      .from("documents")
      .delete()
      .eq("id", documentId);

    if (error) throw error;
    return true;
  },
};

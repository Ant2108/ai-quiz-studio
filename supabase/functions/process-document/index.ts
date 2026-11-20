// ============================================================================
// EDGE FUNCTION 1: process-document
// Endpoint: POST /functions/v1/process-document
// Request:  { "document_id": "UUID", "extracted_text"?: string, "page_count"?: number }
// ============================================================================

import { handleCorsPreflight } from "../_shared/cors.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/response.ts";
import { enforceAiRateLimit, requireAuth } from "../_shared/auth.ts";
import { requireUuid, validateDocumentFile } from "../_shared/validation.ts";
import { analyzeDocumentWithGemini } from "../_shared/gemini.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return errorResponse(
      new AppError("Method not allowed. Use POST.", 405, "METHOD_NOT_ALLOWED"),
      req,
    );
  }

  let documentIdForCleanup: string | null = null;
  let adminClientForCleanup: ReturnType<typeof Object> | null = null;

  try {
    const { user, profile, adminClient } = await requireAuth(req);
    adminClientForCleanup = adminClient;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new AppError("Request body phải là JSON hợp lệ.", 400, "INVALID_JSON_BODY");
    }

    const documentId = requireUuid(
      (body as Record<string, unknown>).document_id,
      "document_id",
    );
    documentIdForCleanup = documentId;

    const clientExtractedText =
      typeof (body as Record<string, unknown>).extracted_text === "string"
        ? ((body as Record<string, unknown>).extracted_text as string)
        : null;
    const clientPageCount =
      typeof (body as Record<string, unknown>).page_count === "number"
        ? ((body as Record<string, unknown>).page_count as number)
        : null;

    // 1. Fetch document and verify ownership
    const { data: doc, error: docError } = await adminClient
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .maybeSingle();

    if (docError || !doc) {
      throw new AppError("Không tìm thấy tài liệu.", 404, "DOCUMENT_NOT_FOUND");
    }

    if (doc.user_id !== user.id && profile.role !== "admin") {
      throw new AppError(
        "Bạn không có quyền xử lý tài liệu của người dùng khác.",
        403,
        "FORBIDDEN_NOT_OWNER",
      );
    }

    // 2. Check AI Rate Limit
    await enforceAiRateLimit(adminClient, user.id, "process_document");

    // 3. Validate file format, MIME type, and size
    const { normalizedExt, normalizedMime } = validateDocumentFile({
      fileName: doc.file_name,
      fileType: doc.file_type,
      mimeType: doc.mime_type,
      fileSize: doc.file_size,
    });

    // 4. Mark document status as processing
    await adminClient
      .from("documents")
      .update({
        status: "processing",
        processing_error: null,
        mime_type: normalizedMime,
      })
      .eq("id", documentId);

    const hasClientText = Boolean(clientExtractedText && clientExtractedText.trim().length >= 40);
    let fileBytes = new Uint8Array(0);
    let actualFileSize = Number(doc.file_size || 0);

    if (!hasClientText) {
      // 5. Download file from Supabase Storage private bucket 'exam-documents'
      const { data: fileBlob, error: storageError } = await adminClient.storage
        .from("exam-documents")
        .download(doc.file_path);

      if (storageError || !fileBlob) {
        throw new AppError(
          `Không thể tải file từ Storage (${storageError?.message || "File not found"}).`,
          404,
          "STORAGE_DOWNLOAD_FAILED",
        );
      }

      const fileBuffer = await fileBlob.arrayBuffer();
      fileBytes = new Uint8Array(fileBuffer);
      actualFileSize = fileBytes.byteLength;

      validateDocumentFile({
        fileName: doc.file_name,
        fileType: normalizedExt,
        mimeType: fileBlob.type || normalizedMime,
        fileSize: actualFileSize,
      });
    }

    // 6. Analyze document & perform OCR / text extraction with Gemini
    const analysis = await analyzeDocumentWithGemini({
      fileBytes,
      fileName: doc.file_name,
      mimeType: normalizedMime,
      ext: normalizedExt,
      clientExtractedText,
      clientPageCount,
    });

    const processedAt = new Date().toISOString();

    // 7. Save extracted text, AI summary, and status='processed'
    const { data: updatedDoc, error: updateError } = await adminClient
      .from("documents")
      .update({
        status: "processed",
        mime_type: normalizedMime,
        file_size: actualFileSize,
        page_count: analysis.pageCount,
        extracted_text: analysis.extractedText,
        ai_summary: analysis.summary,
        processing_error: null,
        processed_at: processedAt,
      })
      .eq("id", documentId)
      .select(
        "id, user_id, file_name, file_path, file_type, mime_type, file_size, page_count, status, visibility, ai_summary, processed_at, created_at",
      )
      .single();

    if (updateError) {
      throw new AppError(
        `Không thể cập nhật trạng thái tài liệu: ${updateError.message}`,
        500,
        "DOCUMENT_UPDATE_FAILED",
      );
    }

    return jsonResponse(
      {
        success: true,
        document: updatedDoc,
        extracted_length: analysis.extractedText.length,
        ai_summary: analysis.summary,
      },
      200,
      req,
    );
  } catch (err) {
    if (documentIdForCleanup && adminClientForCleanup) {
      const errMsg = err instanceof Error ? err.message : "Lỗi xử lý tài liệu";
      // Best-effort status update to 'failed' (PostgrestFilterBuilder is a thenable, not a full Promise with .catch)
      try {
        await (adminClientForCleanup as { from: (t: string) => any })
          .from("documents")
          .update({
            status: "failed",
            processing_error: errMsg.slice(0, 500),
          })
          .eq("id", documentIdForCleanup);
      } catch {
        // Ignore cleanup errors
      }
    }
    return errorResponse(err, req);
  }
});

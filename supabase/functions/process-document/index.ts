// ============================================================================
// EDGE FUNCTION 1: process-document
// Endpoint: POST /functions/v1/process-document
// Request:  { "document_id": "UUID", "extracted_text"?: string, "page_count"?: number }
// ============================================================================

import { handleCorsPreflight } from "../_shared/cors.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/response.ts";
import { enforceAiRateLimit, requireAuth } from "../_shared/auth.ts";
import { requireUuid, validateDocumentFile } from "../_shared/validation.ts";
import { processOrRecoverDocument } from "../_shared/document-pipeline.ts";

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
    const preferredModelId =
      typeof (body as Record<string, unknown>).preferred_model === "string"
        ? ((body as Record<string, unknown>).preferred_model as string).trim() || null
        : null;
    const recoverPersistence = Boolean((body as Record<string, unknown>).recover_persistence);
    const forceReanalyze = Boolean((body as Record<string, unknown>).force_reanalyze);

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

    // 2. Check AI Rate Limit only if Gemini extraction is needed (skip on DB-only recovery)
    const hasRecoverableJsonb =
      !forceReanalyze &&
      Array.isArray(doc.extracted_data?.questions) &&
      doc.extracted_data.questions.length > 0 &&
      (!doc.question_bank_synced || recoverPersistence);

    if (!hasRecoverableJsonb) {
      await enforceAiRateLimit(adminClient, user.id, "process_document");
    }

    // 3. Validate file format, MIME type, and size
    const { normalizedMime } = validateDocumentFile({
      fileName: doc.file_name,
      fileType: doc.file_type,
      mimeType: doc.mime_type,
      fileSize: doc.file_size,
    });

    // 4. Mark document status as processing (preserving any existing extracted_data!)
    await adminClient
      .from("documents")
      .update({
        status: "processing",
        processing_error: null,
        mime_type: normalizedMime,
      })
      .eq("id", documentId);

    // 5. Execute Checkpointed Processing or Zero-Gemini Recovery
    const result = await processOrRecoverDocument({
      doc,
      actorUserId: user.id,
      clientExtractedText,
      clientPageCount,
      preferredModelId,
      recoverPersistence,
      forceReanalyze,
      repo: {
        async downloadStorageFile(filePath: string) {
          const { data: fileBlob, error: storageError } = await adminClient.storage
            .from("exam-documents")
            .download(filePath);
          if (storageError || !fileBlob) {
            throw new AppError(
              `Không thể tải file từ Storage (${storageError?.message || "File not found"}).`,
              404,
              "STORAGE_DOWNLOAD_FAILED",
            );
          }
          const fileBuffer = await fileBlob.arrayBuffer();
          return { bytes: new Uint8Array(fileBuffer), mimeType: fileBlob.type || null };
        },
        async saveExtractedCheckpoint(cp) {
          const { error: cpError } = await adminClient
            .from("documents")
            .update({
              mime_type: cp.mimeType,
              file_size: cp.fileSize,
              page_count: cp.pageCount,
              extracted_text: cp.extractedText,
              ai_summary: cp.summary,
              extracted_data: cp.extractedData,
              question_bank_synced: false,
            })
            .eq("id", cp.documentId);
          if (cpError) {
            throw new AppError(
              `Không thể lưu dữ liệu extracted_data: ${cpError.message}`,
              500,
              "DOCUMENT_CHECKPOINT_FAILED",
            );
          }
        },
        async syncQuestionBank(sync) {
          const { data: syncRes, error: syncErr } = await adminClient.rpc(
            "rpc_sync_document_question_bank",
            {
              p_document_id: sync.documentId,
              p_user_id: sync.userId,
              p_questions: sync.questions,
              p_replace: sync.replace,
            },
          );
          if (syncErr || !syncRes) {
            throw new AppError(
              `Không thể đồng bộ Ngân hàng câu hỏi: ${syncErr?.message || "Sync failed"}`,
              500,
              "QUESTION_BANK_SYNC_FAILED",
            );
          }
          return syncRes as { synced_count: number; already_synced: boolean };
        },
        async markDocumentProcessed(docId: string) {
          const { data: updatedDoc, error: updateError } = await adminClient
            .from("documents")
            .update({
              status: "processed",
              processing_error: null,
              processed_at: new Date().toISOString(),
            })
            .eq("id", docId)
            .select(
              "id, user_id, file_name, file_path, file_type, mime_type, file_size, page_count, status, visibility, ai_summary, question_bank_synced, processed_at, created_at",
            )
            .single();
          if (updateError || !updatedDoc) {
            throw new AppError(
              `Không thể cập nhật trạng thái tài liệu: ${updateError?.message || "Update failed"}`,
              500,
              "DOCUMENT_UPDATE_FAILED",
            );
          }
          return updatedDoc;
        },
        async markDocumentFailed(docId: string, errorMessage: string) {
          await adminClient
            .from("documents")
            .update({ status: "failed", processing_error: errorMessage.slice(0, 500) })
            .eq("id", docId);
        },
      },
    });

    return jsonResponse(
      {
        success: true,
        document: result.document,
        extracted_length: result.extractedLength,
        ai_summary: result.summary,
        synced_questions: result.syncedQuestions,
        recovered_without_gemini: result.recoveredWithoutGemini,
        ai_meta: result.aiMeta,
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

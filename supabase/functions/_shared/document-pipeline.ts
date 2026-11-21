// ============================================================================
// SHARED PIPELINE: CHECKPOINTED DOCUMENT PROCESSING, PERSISTENCE RECOVERY,
// AND DATABASE-FIRST QUIZ GENERATION
// ============================================================================

import { AppError } from "./response.ts";
import { validateDocumentFile, validateGeneratedQuizPayload, type ValidatedGeneratedQuestion } from "./validation.ts";
import {
  analyzeDocumentWithGemini,
  generateQuizWithGemini,
  type GeminiExecutionMeta,
  type GeminiRuntimeDeps,
} from "./gemini.ts";

export interface DocumentRepoAdapter {
  downloadStorageFile(filePath: string): Promise<{ bytes: Uint8Array; mimeType: string | null }>;
  saveExtractedCheckpoint(params: {
    documentId: string;
    mimeType: string;
    fileSize: number;
    pageCount: number;
    extractedText: string;
    summary: Record<string, unknown>;
    extractedData: Record<string, unknown>;
  }): Promise<void>;
  syncQuestionBank(params: {
    documentId: string;
    userId: string;
    questions: ValidatedGeneratedQuestion[];
    replace: boolean;
  }): Promise<{ synced_count: number; already_synced: boolean }>;
  markDocumentProcessed(documentId: string): Promise<Record<string, unknown>>;
  markDocumentFailed(documentId: string, errorMessage: string): Promise<void>;
}

export interface DocumentRecord {
  id: string;
  user_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  mime_type?: string | null;
  file_size?: number | null;
  extracted_text?: string | null;
  ai_summary?: Record<string, unknown> | null;
  extracted_data?: {
    schema_version?: number;
    title_suggestion?: string;
    subject_suggestion?: string;
    topics?: string[];
    summary?: string;
    key_concepts?: string[];
    recommended_question_count?: number;
    extracted_text?: string;
    questions?: unknown[];
  } | null;
  question_bank_synced?: boolean | null;
}

/**
 * Executes:
 *   1. Recovery fast-path: if `doc.extracted_data.questions` already exists and `question_bank_synced` is false
 *      (or `recoverPersistence` is requested without `forceReanalyze`), sync Question Bank WITHOUT calling Gemini.
 *   2. Fresh extraction: download file once (if no client text), call Gemini with automatic fallback,
 *      save Checkpoint A (`documents.extracted_data`), then run Checkpoint B (`rpc_sync_document_question_bank`).
 */
export async function processOrRecoverDocument(params: {
  doc: DocumentRecord;
  actorUserId: string;
  clientExtractedText?: string | null;
  clientPageCount?: number | null;
  preferredModelId?: string | null;
  recoverPersistence?: boolean;
  forceReanalyze?: boolean;
  repo: DocumentRepoAdapter;
  geminiDeps?: GeminiRuntimeDeps;
}): Promise<{
  document: Record<string, unknown>;
  extractedLength: number;
  summary: Record<string, unknown>;
  syncedQuestions: number;
  recoveredWithoutGemini: boolean;
  aiMeta: GeminiExecutionMeta;
}> {
  const {
    doc,
    actorUserId,
    clientExtractedText,
    clientPageCount,
    preferredModelId,
    recoverPersistence = false,
    forceReanalyze = false,
    repo,
    geminiDeps,
  } = params;

  // Recovery Fast-Path: Checkpoint A succeeded previously, Checkpoint B failed -> 0 Gemini calls
  const existingQuestionsRaw = Array.isArray(doc.extracted_data?.questions)
    ? doc.extracted_data.questions
    : [];

  if (
    !forceReanalyze &&
    existingQuestionsRaw.length > 0 &&
    (!doc.question_bank_synced || recoverPersistence)
  ) {
    const fallbackTitle =
      doc.extracted_data?.title_suggestion ||
      doc.file_name.replace(/\.[^.]+$/, "");
    const validated = validateGeneratedQuizPayload(
      { title: fallbackTitle, questions: existingQuestionsRaw },
      fallbackTitle,
      "medium",
    );

    const syncResult = await repo.syncQuestionBank({
      documentId: doc.id,
      userId: actorUserId,
      questions: validated.questions,
      replace: recoverPersistence,
    });

    const updatedDoc = await repo.markDocumentProcessed(doc.id);

    return {
      document: updatedDoc,
      extractedLength: (doc.extracted_text || doc.extracted_data?.extracted_text || "").length,
      summary: (doc.ai_summary || doc.extracted_data || {}) as Record<string, unknown>,
      syncedQuestions: syncResult.synced_count,
      recoveredWithoutGemini: true,
      aiMeta: {
        model_id: "database-recovery",
        model_name: "Database Recovery (0 Gemini calls)",
        fallback_triggered: false,
        status_messages: [
          "Đã tìm thấy dữ liệu JSONB đã lưu. Đang khôi phục Ngân hàng câu hỏi không cần gọi lại Gemini...",
        ],
        attempts: [],
      },
    };
  }

  // Fresh AI Extraction Path
  const { normalizedExt, normalizedMime } = validateDocumentFile({
    fileName: doc.file_name,
    fileType: doc.file_type,
    mimeType: doc.mime_type,
    fileSize: doc.file_size,
  });

  const hasClientText = Boolean(clientExtractedText && clientExtractedText.trim().length >= 40);
  let fileBytes = new Uint8Array(0);
  let actualFileSize = Number(doc.file_size || 0);

  if (!hasClientText) {
    const downloaded = await repo.downloadStorageFile(doc.file_path);
    fileBytes = downloaded.bytes;
    actualFileSize = fileBytes.byteLength;

    validateDocumentFile({
      fileName: doc.file_name,
      fileType: normalizedExt,
      mimeType: downloaded.mimeType || normalizedMime,
      fileSize: actualFileSize,
    });
  }

  // Direct JSON Import Fast-Path: bypass Gemini AI completely when uploading a .json file
  if (normalizedExt === "json") {
    const rawJsonText = hasClientText
      ? clientExtractedText!.trim()
      : new TextDecoder("utf-8", { fatal: false }).decode(fileBytes).trim();

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawJsonText);
    } catch {
      throw new AppError(
        "File JSON không hợp lệ. Vui lòng kiểm tra lại cú pháp JSON.",
        400,
        "INVALID_JSON_FILE",
      );
    }

    const fallbackTitle = doc.file_name.replace(/\.[^.]+$/, "");
    const validated = validateGeneratedQuizPayload(parsedJson, fallbackTitle, "medium");
    const obj =
      parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)
        ? (parsedJson as Record<string, unknown>)
        : {};

    const jsonSummary = {
      title_suggestion: validated.title || fallbackTitle,
      subject_suggestion:
        typeof obj.subject === "string" && obj.subject.trim()
          ? obj.subject.trim()
          : typeof obj.subject_suggestion === "string" && obj.subject_suggestion.trim()
          ? obj.subject_suggestion.trim()
          : "Tổng hợp",
      topics: Array.isArray(obj.topics) ? obj.topics.map(String).slice(0, 10) : [],
      summary:
        typeof obj.description === "string" && obj.description.trim()
          ? obj.description.trim()
          : `Nhập trực tiếp ${validated.questions.length} câu hỏi từ file JSON (không qua Gemini).`,
      key_concepts: [],
      recommended_question_count: Math.min(500, Math.max(1, validated.questions.length)),
    };

    const jsonExtractedData = {
      schema_version: 1,
      ...jsonSummary,
      extracted_text: rawJsonText,
      questions: validated.questions,
    };

    await repo.saveExtractedCheckpoint({
      documentId: doc.id,
      mimeType: normalizedMime,
      fileSize: actualFileSize || rawJsonText.length,
      pageCount: 1,
      extractedText: rawJsonText,
      summary: jsonSummary,
      extractedData: jsonExtractedData,
    });

    const syncRes = await repo.syncQuestionBank({
      documentId: doc.id,
      userId: actorUserId,
      questions: validated.questions,
      replace: true,
    });

    const updatedDoc = await repo.markDocumentProcessed(doc.id);

    return {
      document: updatedDoc,
      extractedLength: rawJsonText.length,
      summary: jsonSummary,
      syncedQuestions: syncRes.synced_count,
      recoveredWithoutGemini: false,
      aiMeta: {
        model_id: "direct-json",
        model_name: "JSON Direct Import (0 Gemini calls)",
        fallback_triggered: false,
        status_messages: [
          `Đã nhập trực tiếp ${syncRes.synced_count} câu hỏi từ JSON (không qua Gemini).`,
        ],
        attempts: [],
      },
    };
  }

  const analysis = await analyzeDocumentWithGemini({
    fileBytes,
    fileName: doc.file_name,
    mimeType: normalizedMime,
    ext: normalizedExt,
    clientExtractedText,
    clientPageCount,
    deps: {
      ...geminiDeps,
      preferredModelId: preferredModelId ?? geminiDeps?.preferredModelId,
    },
  });

  // Checkpoint A: Persist Structured JSONB BEFORE attempting Question Bank normalization
  await repo.saveExtractedCheckpoint({
    documentId: doc.id,
    mimeType: normalizedMime,
    fileSize: actualFileSize,
    pageCount: analysis.pageCount,
    extractedText: analysis.extractedText,
    summary: analysis.summary,
    extractedData: analysis.extractedData,
  });

  // Checkpoint B: Normalize validated questions into questions / question_options / question_answers
  // Always replace stale bank rows on a fresh extraction so newly extracted questions (e.g. 50 vs old 20) take effect
  let syncedQuestions = 0;
  if (analysis.extractedData.questions.length > 0) {
    const syncRes = await repo.syncQuestionBank({
      documentId: doc.id,
      userId: actorUserId,
      questions: analysis.extractedData.questions,
      replace: true,
    });
    syncedQuestions = syncRes.synced_count;
  }

  const updatedDoc = await repo.markDocumentProcessed(doc.id);

  return {
    document: updatedDoc,
    extractedLength: analysis.extractedText.length,
    summary: analysis.summary,
    syncedQuestions,
    recoveredWithoutGemini: false,
    aiMeta: analysis.aiMeta,
  };
}

export interface QuizRepoAdapter {
  syncFromExtractedData(params: {
    documentId: string;
    userId: string;
    questions: ValidatedGeneratedQuestion[];
  }): Promise<void>;
  createQuizFromQuestionBank(params: {
    userId: string;
    documentId: string;
    quizSetId: string | null;
    title: string;
    description: string;
    subject: string;
    topic: string | null;
    difficulty: "easy" | "medium" | "hard";
    questionCount: number;
    questionTypes: Array<"multiple_choice" | "true_false">;
    defaultExamQuestions: number;
    defaultExamDuration: number;
  }): Promise<{
    quiz_set_id: string;
    question_count: number;
    questions: unknown[];
    source: string;
  }>;
  createOrAppendQuizFromAi(params: {
    userId: string;
    documentId: string;
    quizSetId: string | null;
    title: string;
    description: string;
    subject: string;
    topic: string | null;
    difficulty: "easy" | "medium" | "hard";
    defaultExamQuestions: number;
    defaultExamDuration: number;
    questions: ValidatedGeneratedQuestion[];
  }): Promise<{
    quiz_set_id: string;
    question_count: number;
    questions: unknown[];
  }>;
}

/**
 * Generates a quiz set Database-only by default (0 Gemini calls):
 *   1. If `doc.extracted_data.questions` exists and `question_bank_synced` is false, syncs it first (0 Gemini calls).
 *   2. Calls `rpc_create_quiz_from_question_bank` directly from stored JSON / Normalized Question Bank (0 Gemini calls).
 *   3. NEVER calls Gemini silently during quiz generation. If the bank is empty and `forceAi` is false,
 *      throws DOCUMENT_QUESTION_BANK_EMPTY so Gemini is only invoked during document conversion (`process-document`).
 *   4. Only calls `generateQuizWithGemini` when `forceAi === true` is explicitly requested.
 */
export async function generateQuizDatabaseFirst(params: {
  doc: DocumentRecord;
  actorUserId: string;
  existingQuizSetId: string | null;
  title: string;
  description: string;
  subject: string;
  topic: string | null;
  difficulty: "easy" | "medium" | "hard";
  questionCount: number;
  questionTypes: Array<"multiple_choice" | "true_false">;
  defaultExamQuestions: number;
  defaultExamDuration: number;
  startChunkIndex?: number;
  preferredModelId?: string | null;
  forceAi?: boolean;
  repo: QuizRepoAdapter;
  geminiDeps?: GeminiRuntimeDeps;
}): Promise<{
  quizSetId: string;
  questionCount: number;
  previewQuestions: unknown[];
  source: "database_bank" | "gemini_ai";
  aiMeta: GeminiExecutionMeta;
}> {
  const {
    doc,
    actorUserId,
    existingQuizSetId,
    title,
    description,
    subject,
    topic,
    difficulty,
    questionCount,
    questionTypes,
    defaultExamQuestions,
    defaultExamDuration,
    startChunkIndex = 0,
    preferredModelId,
    forceAi = false,
    repo,
    geminiDeps,
  } = params;

  if (!forceAi) {
    // Self-heal Checkpoint B if extracted_data exists in JSONB but hasn't synced to Question Bank
    if (
      !doc.question_bank_synced &&
      Array.isArray(doc.extracted_data?.questions) &&
      doc.extracted_data.questions.length > 0
    ) {
      const validated = validateGeneratedQuizPayload(
        { title, questions: doc.extracted_data.questions },
        title,
        difficulty,
      );
      await repo.syncFromExtractedData({
        documentId: doc.id,
        userId: actorUserId,
        questions: validated.questions,
      });
    }

    const dbResult = await repo.createQuizFromQuestionBank({
      userId: actorUserId,
      documentId: doc.id,
      quizSetId: existingQuizSetId,
      title,
      description,
      subject,
      topic,
      difficulty,
      questionCount,
      questionTypes,
      defaultExamQuestions,
      defaultExamDuration,
    });

    if (dbResult && dbResult.source === "database_bank" && dbResult.question_count > 0 && dbResult.quiz_set_id) {
      return {
        quizSetId: dbResult.quiz_set_id,
        questionCount: dbResult.question_count,
        previewQuestions: dbResult.questions,
        source: "database_bank",
        aiMeta: {
          model_id: "database-bank",
          model_name: "Normalized Question Bank (Database - 0 Gemini calls)",
          fallback_triggered: false,
          status_messages: [
            "Đang tạo đề trực tiếp từ dữ liệu JSON / Ngân hàng câu hỏi Database (không gọi Gemini)...",
          ],
          attempts: [],
        },
      };
    }

    // Strict Database-only quiz generation: never burn Gemini tokens/quota during generate-quiz
    throw new AppError(
      "Tài liệu này chưa có dữ liệu câu hỏi JSON trong Ngân hàng câu hỏi. Vui lòng vào mục Tài liệu và nhấn 'Thử lại' để chuyển file sang JSON 1 lần duy nhất, sau đó tạo đề trực tiếp không tốn token Gemini.",
      400,
      "DOCUMENT_QUESTION_BANK_EMPTY",
    );
  }

  // Explicit AI generation path (only reached when forceAi === true)
  const documentText = (doc.extracted_text || doc.extracted_data?.extracted_text || "").trim();
  if (!documentText) {
    throw new AppError(
      "Tài liệu chưa có dữ liệu văn bản hoặc câu hỏi trong Ngân hàng câu hỏi. Vui lòng xử lý tài liệu trước.",
      400,
      "DOCUMENT_NOT_PROCESSED",
    );
  }

  const generated = await generateQuizWithGemini({
    documentText,
    title,
    subject,
    topic,
    difficulty,
    questionCount,
    questionTypes,
    startChunkIndex,
    deps: {
      ...geminiDeps,
      preferredModelId: preferredModelId ?? geminiDeps?.preferredModelId,
    },
  });

  const txResult = await repo.createOrAppendQuizFromAi({
    userId: actorUserId,
    documentId: doc.id,
    quizSetId: existingQuizSetId,
    title: generated.title || title,
    description,
    subject,
    topic,
    difficulty,
    defaultExamQuestions,
    defaultExamDuration,
    questions: generated.questions,
  });

  return {
    quizSetId: txResult.quiz_set_id,
    questionCount: txResult.question_count,
    previewQuestions: txResult.questions,
    source: "gemini_ai",
    aiMeta: generated.aiMeta,
  };
}

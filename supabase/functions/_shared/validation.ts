// ============================================================================
// SHARED HELPER: INPUT & GEMINI JSON SCHEMA VALIDATION
// ============================================================================

import { AppError } from "./response.ts";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

export function requireUuid(value: unknown, fieldName: string): string {
  if (!isValidUuid(value)) {
    throw new AppError(
      `Trường '${fieldName}' không phải là UUID hợp lệ.`,
      400,
      "INVALID_UUID",
    );
  }
  return value.trim();
}

export const ALLOWED_DOCUMENT_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "txt",
  "png",
  "jpg",
  "jpeg",
  "webp",
]);

export const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export function validateDocumentFile(params: {
  fileName: string;
  fileType?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}): { normalizedExt: string; normalizedMime: string } {
  const { fileName, fileType, mimeType, fileSize } = params;

  if (!fileName || typeof fileName !== "string") {
    throw new AppError("Tên file tài liệu không hợp lệ.", 400, "INVALID_FILE_NAME");
  }

  const extFromFile = fileName.includes(".")
    ? fileName.split(".").pop()!.toLowerCase().trim()
    : "";
  const rawType = (fileType || "").toLowerCase().trim();

  const normalizedExt = ALLOWED_DOCUMENT_EXTENSIONS.has(extFromFile)
    ? extFromFile
    : ALLOWED_DOCUMENT_EXTENSIONS.has(rawType)
    ? rawType
    : "";

  if (!normalizedExt) {
    throw new AppError(
      "Định dạng file không được hỗ trợ. Chỉ chấp nhận PDF, DOCX, TXT, PNG, JPG, WEBP.",
      400,
      "UNSUPPORTED_FILE_FORMAT",
    );
  }

  const extToMime: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };

  const normalizedMime =
    mimeType && ALLOWED_DOCUMENT_MIMES.has(mimeType)
      ? mimeType
      : rawType && ALLOWED_DOCUMENT_MIMES.has(rawType)
      ? rawType
      : extToMime[normalizedExt];

  if (!ALLOWED_DOCUMENT_MIMES.has(normalizedMime)) {
    throw new AppError(
      `MIME type '${mimeType || rawType}' không hợp lệ.`,
      400,
      "INVALID_MIME_TYPE",
    );
  }

  if (typeof fileSize === "number") {
    if (fileSize <= 0) {
      throw new AppError("File tải lên rỗng (0 bytes).", 400, "EMPTY_FILE");
    }
    if (fileSize > MAX_DOCUMENT_SIZE_BYTES) {
      throw new AppError(
        "Dung lượng file vượt quá giới hạn 20MB.",
        400,
        "FILE_TOO_LARGE",
      );
    }
  }

  return { normalizedExt, normalizedMime };
}

export interface ValidatedGeneratedOption {
  option_label: string;
  option_content: string;
  image_path: string | null;
}

export interface ValidatedGeneratedQuestion {
  question_text: string;
  question_type: "multiple_choice" | "true_false";
  difficulty: "easy" | "medium" | "hard";
  options: ValidatedGeneratedOption[];
  correct_option_label: string;
  correct_text: string | null;
  explanation: string;
  formula_latex: string | null;
  image_path: string | null;
  source_page: number | null;
}

export interface ValidatedGeneratedQuiz {
  title: string;
  questions: ValidatedGeneratedQuestion[];
}

/**
 * Strictly validates the JSON structure produced by Gemini before touching the database.
 * Rejects malformed questions, duplicate option labels, or mismatched correct_option_label.
 */
export function validateGeneratedQuizPayload(
  raw: unknown,
  fallbackTitle: string,
  fallbackDifficulty: "easy" | "medium" | "hard" = "medium",
): ValidatedGeneratedQuiz {
  if (!raw || typeof raw !== "object") {
    throw new AppError(
      "Dữ liệu AI trả về không đúng định dạng JSON object.",
      422,
      "AI_INVALID_JSON_ROOT",
    );
  }

  const obj = raw as Record<string, unknown>;
  const rawQuestions = Array.isArray(obj.questions)
    ? obj.questions
    : Array.isArray(raw)
    ? (raw as unknown[])
    : null;

  if (!rawQuestions || rawQuestions.length === 0) {
    throw new AppError(
      "AI không sinh được danh sách câu hỏi hợp lệ từ tài liệu này.",
      422,
      "AI_EMPTY_QUESTIONS",
    );
  }

  const title =
    typeof obj.title === "string" && obj.title.trim().length > 0
      ? obj.title.trim()
      : fallbackTitle.trim() || "Bộ đề trắc nghiệm AI";

  const validatedQuestions: ValidatedGeneratedQuestion[] = [];

  for (let i = 0; i < rawQuestions.length; i++) {
    const q = rawQuestions[i] as Record<string, unknown>;
    if (!q || typeof q !== "object") {
      throw new AppError(
        `Câu hỏi thứ ${i + 1} từ AI không hợp lệ.`,
        422,
        "AI_INVALID_QUESTION_ITEM",
      );
    }

    const questionText =
      typeof q.question_text === "string" ? q.question_text.trim() : "";
    if (!questionText) {
      throw new AppError(
        `Câu hỏi thứ ${i + 1} bị thiếu nội dung question_text.`,
        422,
        "AI_MISSING_QUESTION_TEXT",
      );
    }

    const rawType =
      typeof q.question_type === "string"
        ? q.question_type.toLowerCase().trim()
        : "multiple_choice";
    const questionType: "multiple_choice" | "true_false" =
      rawType === "true_false" ? "true_false" : "multiple_choice";

    const rawDiff =
      typeof q.difficulty === "string"
        ? q.difficulty.toLowerCase().trim()
        : fallbackDifficulty;
    const difficulty: "easy" | "medium" | "hard" =
      rawDiff === "easy" || rawDiff === "medium" || rawDiff === "hard"
        ? rawDiff
        : fallbackDifficulty;

    const rawOptions = Array.isArray(q.options) ? q.options : [];
    if (rawOptions.length < 2) {
      throw new AppError(
        `Câu hỏi thứ ${i + 1} phải có ít nhất 2 phương án lựa chọn.`,
        422,
        "AI_INSUFFICIENT_OPTIONS",
      );
    }

    const seenLabels = new Set<string>();
    const validatedOptions: ValidatedGeneratedOption[] = [];
    const defaultLabels = ["A", "B", "C", "D", "E", "F"];

    for (let j = 0; j < rawOptions.length; j++) {
      const opt = rawOptions[j] as Record<string, unknown>;
      if (!opt || typeof opt !== "object") {
        throw new AppError(
          `Phương án thứ ${j + 1} của câu hỏi ${i + 1} không hợp lệ.`,
          422,
          "AI_INVALID_OPTION",
        );
      }

      const rawLabel =
        typeof opt.option_label === "string" && opt.option_label.trim()
          ? opt.option_label.trim().toUpperCase()
          : defaultLabels[j] || String.fromCharCode(65 + j);

      // Normalize labels like "A." or "A)" to "A"
      const cleanLabel = rawLabel.replace(/[^A-Z0-9]/g, "") || defaultLabels[j];

      const optionContent =
        typeof opt.option_content === "string"
          ? opt.option_content.trim()
          : typeof opt.text === "string"
          ? opt.text.trim()
          : "";

      if (!optionContent) {
        if (rawQuestions.length === 1) {
          throw new AppError(
            `Phương án ${cleanLabel} của câu hỏi thứ ${i + 1} bị trống nội dung.`,
            422,
            "AI_EMPTY_OPTION_CONTENT",
          );
        }
        // Skip empty option in multi-question batch; question stays valid if >= 2 options remain
        continue;
      }

      if (seenLabels.has(cleanLabel)) {
        throw new AppError(
          `Câu hỏi thứ ${i + 1} bị trùng nhãn đáp án '${cleanLabel}'.`,
          422,
          "AI_DUPLICATE_OPTION_LABEL",
        );
      }
      seenLabels.add(cleanLabel);

      validatedOptions.push({
        option_label: cleanLabel,
        option_content: optionContent,
        image_path:
          typeof opt.image_path === "string" && opt.image_path.trim()
            ? opt.image_path.trim()
            : null,
      });
    }

    if (validatedOptions.length < 2) {
      if (rawQuestions.length === 1) {
        throw new AppError(
          `Câu hỏi thứ ${i + 1} phải có ít nhất 2 phương án có nội dung hợp lệ.`,
          422,
          "AI_INSUFFICIENT_OPTIONS",
        );
      }
      continue;
    }

    const rawCorrectLabel =
      typeof q.correct_option_label === "string"
        ? q.correct_option_label.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
        : "";

    if (!rawCorrectLabel || !seenLabels.has(rawCorrectLabel)) {
      if (rawQuestions.length === 1) {
        throw new AppError(
          `Câu hỏi thứ ${i + 1} có đáp án đúng '${rawCorrectLabel}' không khớp với bất kỳ lựa chọn nào (${Array.from(seenLabels).join(", ")}).`,
          422,
          "AI_MISMATCHED_CORRECT_ANSWER",
        );
      }
      // Skip single malformed question rather than failing the entire batch
      continue;
    }

    const matchingOption = validatedOptions.find(
      (o) => o.option_label === rawCorrectLabel,
    )!;

    const explanation =
      typeof q.explanation === "string" && q.explanation.trim().length > 0
        ? q.explanation.trim()
        : `Đáp án đúng là ${rawCorrectLabel}: ${matchingOption.option_content}`;

    const formulaLatex =
      typeof q.formula_latex === "string" && q.formula_latex.trim().length > 0
        ? q.formula_latex.trim()
        : null;

    const imagePath =
      typeof q.image_path === "string" && q.image_path.trim().length > 0
        ? q.image_path.trim()
        : null;

    let sourcePage: number | null = null;
    if (typeof q.source_page === "number" && Number.isInteger(q.source_page) && q.source_page > 0) {
      sourcePage = q.source_page;
    } else if (typeof q.source_page === "string" && /^\d+$/.test(q.source_page.trim())) {
      const parsed = parseInt(q.source_page.trim(), 10);
      if (parsed > 0) sourcePage = parsed;
    }

    validatedQuestions.push({
      question_text: questionText,
      question_type: questionType,
      difficulty,
      options: validatedOptions,
      correct_option_label: rawCorrectLabel,
      correct_text: matchingOption.option_content,
      explanation,
      formula_latex: formulaLatex,
      image_path: imagePath,
      source_page: sourcePage,
    });
  }

  if (validatedQuestions.length === 0) {
    throw new AppError(
      "AI không sinh được danh sách câu hỏi hợp lệ từ tài liệu này.",
      422,
      "AI_EMPTY_QUESTIONS",
    );
  }

  return {
    title,
    questions: validatedQuestions,
  };
}

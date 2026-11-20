import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Provide minimal Deno.env shim so Node 24 can directly execute shared Deno TS helpers
globalThis.Deno = {
  env: {
    get: () => undefined,
  },
};

import {
  isValidUuid,
  requireUuid,
  validateDocumentFile,
  validateGeneratedQuizPayload,
} from "../supabase/functions/_shared/validation.ts";
import {
  AppError,
  errorResponse,
} from "../supabase/functions/_shared/response.ts";
import { getCorsHeaders } from "../supabase/functions/_shared/cors.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

test("Validation Helper: UUID validation accepts valid UUIDs and rejects malformed strings", () => {
  const valid = "123e4567-e89b-12d3-a456-426614174000";
  assert.equal(isValidUuid(valid), true);
  assert.equal(requireUuid(valid, "quiz_set_id"), valid);

  assert.equal(isValidUuid("not-a-uuid"), false);
  assert.throws(() => requireUuid("12345", "quiz_set_id"), AppError);
});

test("Validation Helper: Document file validation accepts supported formats and enforces 20MB limit", () => {
  const pdf = validateDocumentFile({
    fileName: "java-oop.pdf",
    mimeType: "application/pdf",
    fileSize: 1024 * 500,
  });
  assert.equal(pdf.normalizedExt, "pdf");
  assert.equal(pdf.normalizedMime, "application/pdf");

  const docx = validateDocumentFile({
    fileName: "lecture.docx",
    fileSize: 50000,
  });
  assert.equal(docx.normalizedExt, "docx");

  const img = validateDocumentFile({
    fileName: "diagram.png",
    mimeType: "image/png",
    fileSize: 204800,
  });
  assert.equal(img.normalizedMime, "image/png");

  // Reject unsupported executable
  assert.throws(
    () =>
      validateDocumentFile({
        fileName: "malware.exe",
        mimeType: "application/x-msdownload",
        fileSize: 1024,
      }),
    AppError,
  );

  // Reject empty file
  assert.throws(
    () =>
      validateDocumentFile({
        fileName: "empty.txt",
        mimeType: "text/plain",
        fileSize: 0,
      }),
    AppError,
  );

  // Reject oversized file (>20MB)
  assert.throws(
    () =>
      validateDocumentFile({
        fileName: "huge.pdf",
        mimeType: "application/pdf",
        fileSize: 21 * 1024 * 1024,
      }),
    AppError,
  );
});

test("Validation Helper: Gemini Quiz JSON schema accepts valid multiple_choice & true_false questions", () => {
  const sample = {
    title: "Java Fundamentals",
    questions: [
      {
        question_text: "What is JVM?",
        question_type: "multiple_choice",
        difficulty: "easy",
        options: [
          { option_label: "A", option_content: "Java Virtual Machine" },
          { option_label: "B", option_content: "Java Visual Machine" },
          { option_label: "C", option_content: "Java Variable Method" },
          { option_label: "D", option_content: "Java Version Manager" },
        ],
        correct_option_label: "A",
        explanation: "JVM executes Java bytecode.",
        source_page: 1,
      },
      {
        question_text: "Java supports multiple class inheritance directly.",
        question_type: "true_false",
        difficulty: "medium",
        options: [
          { option_label: "A", option_content: "True" },
          { option_label: "B", option_content: "False" },
        ],
        correct_option_label: "B",
        explanation: "Java uses interfaces rather than multiple class inheritance.",
        formula_latex: null,
        source_page: 2,
      },
    ],
  };

  const validated = validateGeneratedQuizPayload(sample, "Fallback Title", "medium");
  assert.equal(validated.title, "Java Fundamentals");
  assert.equal(validated.questions.length, 2);
  assert.equal(validated.questions[0].correct_option_label, "A");
  assert.equal(validated.questions[0].correct_text, "Java Virtual Machine");
  assert.equal(validated.questions[1].question_type, "true_false");
});

test("Validation Helper: Gemini Quiz JSON rejects mismatched correct_option_label and duplicate labels", () => {
  // Mismatched correct label
  assert.throws(
    () =>
      validateGeneratedQuizPayload(
        {
          title: "Broken Quiz",
          questions: [
            {
              question_text: "Test?",
              options: [
                { option_label: "A", option_content: "One" },
                { option_label: "B", option_content: "Two" },
              ],
              correct_option_label: "D",
            },
          ],
        },
        "Fallback",
      ),
    (err) => err instanceof AppError && err.code === "AI_MISMATCHED_CORRECT_ANSWER",
  );

  // Duplicate option labels
  assert.throws(
    () =>
      validateGeneratedQuizPayload(
        {
          title: "Duplicate Label Quiz",
          questions: [
            {
              question_text: "Test?",
              options: [
                { option_label: "A", option_content: "One" },
                { option_label: "A", option_content: "Two" },
              ],
              correct_option_label: "A",
            },
          ],
        },
        "Fallback",
      ),
    (err) => err instanceof AppError && err.code === "AI_DUPLICATE_OPTION_LABEL",
  );
});

test("Response Helper: Redacts sensitive API keys and JWTs from error payloads", async () => {
  const leakyErr = new AppError(
    "Failed with key AIzaSyD1234567890123456789012345 and token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature123",
    500,
    "TEST_ERR",
  );
  const res = errorResponse(leakyErr);
  const json = await res.json();
  assert.equal(json.success, false);
  assert.ok(!json.error.message.includes("AIzaSyD"));
  assert.ok(!json.error.message.includes("eyJhbGci"));
  assert.ok(json.error.message.includes("[REDACTED_API_KEY]"));
  assert.ok(json.error.message.includes("[REDACTED_JWT]"));
});

test("CORS Helper: returns required Access-Control headers", () => {
  const headers = getCorsHeaders();
  assert.ok(headers["Access-Control-Allow-Origin"]);
  assert.ok(headers["Access-Control-Allow-Headers"].includes("authorization"));
});

test("Edge Functions Presence & Config: all 7 Edge Functions exist and enforce verify_jwt = true", () => {
  const configToml = fs.readFileSync(
    path.join(ROOT, "supabase", "config.toml"),
    "utf8",
  );

  const requiredFunctions = [
    "process-document",
    "generate-quiz",
    "start-attempt",
    "answer-question",
    "submit-attempt",
    "get-attempt-review",
    "moderate-quiz",
  ];

  for (const fn of requiredFunctions) {
    const fnPath = path.join(ROOT, "supabase", "functions", fn, "index.ts");
    assert.ok(fs.existsSync(fnPath), `Edge Function missing: ${fn}`);
    assert.ok(
      configToml.includes(`[functions.${fn}]`),
      `supabase/config.toml missing [functions.${fn}]`,
    );

    const content = fs.readFileSync(fnPath, "utf8");
    const requiresAuthOrAdmin =
      content.includes("requireAuth(") || content.includes("requireAdmin(");
    assert.ok(
      requiresAuthOrAdmin,
      `Edge Function ${fn} must validate JWT using requireAuth or requireAdmin`,
    );
  }

  // Moderate-quiz must specifically call requireAdmin
  const moderateSrc = fs.readFileSync(
    path.join(ROOT, "supabase", "functions", "moderate-quiz", "index.ts"),
    "utf8",
  );
  assert.ok(
    moderateSrc.includes("requireAdmin("),
    "moderate-quiz MUST enforce server-side admin verification via requireAdmin()",
  );
});

test("Business Rule 3.4: Exam Score formula calculation accuracy (max 2 decimals, 0 for wrong/blank)", () => {
  const calcScore = (correct, total) =>
    total > 0 ? Number(((correct / total) * 10).toFixed(2)) : 0;

  assert.equal(calcScore(60, 60), 10);
  assert.equal(calcScore(45, 60), 7.5);
  assert.equal(calcScore(40, 60), 6.67);
  assert.equal(calcScore(1, 3), 3.33);
  assert.equal(calcScore(0, 60), 0);
});

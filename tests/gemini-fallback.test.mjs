import test from "node:test";
import assert from "node:assert/strict";

globalThis.Deno = {
  env: {
    get: () => undefined,
  },
};

import {
  GEMINI_MODEL_REGISTRY,
  getActiveGeminiModels,
} from "../supabase/functions/_shared/gemini-models.ts";
import {
  classifyGeminiApiError,
  parseRetryDelayMs,
} from "../supabase/functions/_shared/gemini-errors.ts";
import {
  analyzeDocumentWithGemini,
  generateQuizWithGemini,
} from "../supabase/functions/_shared/gemini.ts";
import {
  processOrRecoverDocument,
  generateQuizDatabaseFirst,
} from "../supabase/functions/_shared/document-pipeline.ts";
import { AppError } from "../supabase/functions/_shared/response.ts";

function makeJsonResponse(status, bodyObj, headers = {}) {
  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function makeGeminiSuccessPayload(textObj) {
  return makeJsonResponse(200, {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(textObj) }],
        },
      },
    ],
  });
}

function makeSampleQuizJson(questionText = "What is TCP?") {
  return {
    title: "Networking Test",
    questions: [
      {
        question_text: questionText,
        question_type: "multiple_choice",
        difficulty: "medium",
        options: [
          { option_label: "A", option_content: "Transmission Control Protocol" },
          { option_label: "B", option_content: "User Datagram Protocol" },
          { option_label: "C", option_content: "Internet Protocol" },
          { option_label: "D", option_content: "File Transfer Protocol" },
        ],
        correct_option_label: "A",
        explanation: "TCP stands for Transmission Control Protocol.",
      },
    ],
  };
}

test("Model Configuration: Centralized registry filters disabled models & sorts by priority", () => {
  assert.equal(GEMINI_MODEL_REGISTRY[0].id, "gemini-3.8-flash");
  assert.equal(GEMINI_MODEL_REGISTRY[1].id, "gemini-3-flash-preview");
  assert.equal(GEMINI_MODEL_REGISTRY[2].id, "gemini-flash-lite-latest");

  const customRegistry = [
    { ...GEMINI_MODEL_REGISTRY[0], enabled: false },
    GEMINI_MODEL_REGISTRY[2],
    GEMINI_MODEL_REGISTRY[1],
  ];
  const active = getActiveGeminiModels({
    requiredInput: "pdf",
    registry: customRegistry,
  });
  assert.deepEqual(
    active.map((m) => m.id),
    ["gemini-3-flash-preview", "gemini-flash-lite-latest"],
  );
});

test("Error Classification: Distinguishes RPD, RPM + RetryInfo, TPM, 503, 401/403, and 400", () => {
  assert.equal(parseRetryDelayMs("12s"), 12000);
  assert.equal(parseRetryDelayMs("1.5s"), 1500);
  assert.equal(parseRetryDelayMs("500ms"), 500);

  const rpd = classifyGeminiApiError(
    429,
    JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded for quota metric GenerateRequestsPerDay",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [
              {
                quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
              },
            ],
          },
        ],
      },
    }),
    "Gemini 3.8 Flash",
  );
  assert.equal(rpd.category, "RPD_EXCEEDED");
  assert.equal(rpd.action, "switch_model");

  const rpm = classifyGeminiApiError(
    429,
    JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel" }],
          },
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "3s",
          },
        ],
      },
    }),
  );
  assert.equal(rpm.category, "RPM_EXCEEDED");
  assert.equal(rpm.action, "retry_then_switch");
  assert.equal(rpm.retryDelayMs, 3000);

  const tpm = classifyGeminiApiError(
    429,
    JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ quotaId: "InputTokenCountPerMinute" }],
          },
        ],
      },
    }),
  );
  assert.equal(tpm.category, "TPM_EXCEEDED");
  assert.equal(tpm.shouldOptimizePayload, true);

  const overloaded = classifyGeminiApiError(
    503,
    JSON.stringify({ error: { code: 503, status: "UNAVAILABLE" } }),
  );
  assert.equal(overloaded.category, "OVERLOADED_503");
  assert.equal(overloaded.action, "retry_then_switch");

  const authErr = classifyGeminiApiError(403, JSON.stringify({ error: { status: "PERMISSION_DENIED" } }));
  assert.equal(authErr.category, "AUTH_ERROR");
  assert.equal(authErr.action, "fail_immediately");

  const badReq = classifyGeminiApiError(400, JSON.stringify({ error: { status: "INVALID_ARGUMENT" } }));
  assert.equal(badReq.category, "BAD_REQUEST_400");
  assert.equal(badReq.action, "fail_immediately");
});

test("Scenario 1: Primary model (Gemini 3.8 Flash) works normally", async () => {
  const calledUrls = [];
  const res = await generateQuizWithGemini({
    documentText: "TCP is Transmission Control Protocol. UDP is connectionless.",
    title: "Net",
    difficulty: "medium",
    questionCount: 1,
    questionTypes: ["multiple_choice"],
    deps: {
      apiKeyOverride: "fake-key",
      sleepImpl: async () => {},
      fetchImpl: async (url) => {
        calledUrls.push(String(url));
        return makeGeminiSuccessPayload(makeSampleQuizJson());
      },
    },
  });

  assert.equal(calledUrls.length, 1);
  assert.ok(calledUrls[0].includes("/models/gemini-3.8-flash:generateContent"));
  assert.equal(res.aiMeta.model_id, "gemini-3.8-flash");
  assert.equal(res.aiMeta.fallback_triggered, false);
  assert.equal(res.questions.length, 1);
});

test("Scenario 2: Primary reaches RPD limit -> immediately switches to Secondary (Gemini 3 Flash)", async () => {
  const calledModels = [];
  const res = await generateQuizWithGemini({
    documentText: "TCP is reliable.",
    title: "Net",
    difficulty: "medium",
    questionCount: 1,
    questionTypes: ["multiple_choice"],
    deps: {
      apiKeyOverride: "fake-key",
      sleepImpl: async () => {
        throw new Error("Should NOT sleep on RPD_EXCEEDED; must switch immediately!");
      },
      fetchImpl: async (url) => {
        const u = String(url);
        calledModels.push(u);
        if (u.includes("gemini-3.8-flash")) {
          return makeJsonResponse(429, {
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                  violations: [{ quotaId: "RequestsPerDayPerProjectPerModel" }],
                },
              ],
            },
          });
        }
        return makeGeminiSuccessPayload(makeSampleQuizJson());
      },
    },
  });

  assert.equal(calledModels.length, 2);
  assert.ok(calledModels[0].includes("gemini-3.8-flash"));
  assert.ok(calledModels[1].includes("gemini-3-flash-preview"));
  assert.equal(res.aiMeta.model_id, "gemini-3-flash-preview");
  assert.equal(res.aiMeta.fallback_triggered, true);
  assert.ok(
    res.aiMeta.status_messages.some((m) =>
      m.includes("Gemini 3.8 Flash đã hết quota. Đang chuyển sang Gemini 3 Flash")
    ),
  );
});

test("Scenario 3: Primary reaches RPM limit -> waits retryDelay and retries on Primary", async () => {
  const sleepDurations = [];
  let attemptCount = 0;

  const res = await generateQuizWithGemini({
    documentText: "UDP is fast.",
    title: "Net",
    difficulty: "easy",
    questionCount: 1,
    questionTypes: ["multiple_choice"],
    deps: {
      apiKeyOverride: "fake-key",
      sleepImpl: async (ms) => {
        sleepDurations.push(ms);
      },
      fetchImpl: async () => {
        attemptCount++;
        if (attemptCount === 1) {
          return makeJsonResponse(429, {
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                  violations: [{ quotaId: "GenerateRequestsPerMinutePerProject" }],
                },
                {
                  "@type": "type.googleapis.com/google.rpc.RetryInfo",
                  retryDelay: "2s",
                },
              ],
            },
          });
        }
        return makeGeminiSuccessPayload(makeSampleQuizJson());
      },
    },
  });

  assert.equal(attemptCount, 2);
  assert.deepEqual(sleepDurations, [2000]);
  assert.equal(res.aiMeta.model_id, "gemini-3.8-flash");
  assert.equal(res.aiMeta.fallback_triggered, false);
});

test("Scenario 4: Primary & Secondary both reach RPD limits -> Fallback (Gemini Flash-Lite) succeeds", async () => {
  const calledModels = [];
  const res = await generateQuizWithGemini({
    documentText: "HTTP runs on application layer.",
    title: "Net",
    difficulty: "medium",
    questionCount: 1,
    questionTypes: ["multiple_choice"],
    deps: {
      apiKeyOverride: "fake-key",
      sleepImpl: async () => {},
      fetchImpl: async (url) => {
        const u = String(url);
        calledModels.push(u);
        if (u.includes("gemini-3.8-flash") || u.includes("gemini-3-flash-preview")) {
          return makeJsonResponse(429, {
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                  violations: [{ quotaId: "GenerateRequestsPerDay" }],
                },
              ],
            },
          });
        }
        return makeGeminiSuccessPayload(makeSampleQuizJson());
      },
    },
  });

  assert.equal(calledModels.length, 3);
  assert.ok(calledModels[2].includes("gemini-flash-lite-latest"));
  assert.equal(res.aiMeta.model_id, "gemini-flash-lite-latest");
  assert.equal(res.aiMeta.fallback_triggered, true);
});

test("Scenario 5: All models fail (exhausted) -> returns clean 429 AppError without infinite retry", async () => {
  let callCount = 0;
  await assert.rejects(
    () =>
      generateQuizWithGemini({
        documentText: "Sample text",
        title: "Net",
        difficulty: "medium",
        questionCount: 1,
        questionTypes: ["multiple_choice"],
        deps: {
          apiKeyOverride: "fake-key",
          sleepImpl: async () => {},
          fetchImpl: async () => {
            callCount++;
            return makeJsonResponse(429, {
              error: {
                code: 429,
                status: "RESOURCE_EXHAUSTED",
                message: "Daily quota exceeded",
              },
            });
          },
        },
      }),
    (err) => err instanceof AppError && err.statusCode === 429,
  );
  // Strictly 3 calls (1 per model on RPD), never infinite loop
  assert.equal(callCount, 3);
});

test("Scenario 6: Invalid API Key (401/403) -> fails immediately without retrying other models", async () => {
  let callCount = 0;
  await assert.rejects(
    () =>
      generateQuizWithGemini({
        documentText: "Sample text",
        title: "Net",
        difficulty: "medium",
        questionCount: 1,
        questionTypes: ["multiple_choice"],
        deps: {
          apiKeyOverride: "bad-key",
          sleepImpl: async () => {},
          fetchImpl: async () => {
            callCount++;
            return makeJsonResponse(403, {
              error: { code: 403, status: "PERMISSION_DENIED", message: "API key not valid" },
            });
          },
        },
      }),
    (err) => err instanceof AppError && err.statusCode === 401 && err.code === "GEMINI_AUTH_ERROR",
  );
  assert.equal(callCount, 1);
});

test("Scenario 7: Invalid PDF (400 INVALID_ARGUMENT) & Single Upload Reuse across Fallback", async () => {
  // 7a. Invalid PDF returns 400 immediately
  await assert.rejects(
    () =>
      analyzeDocumentWithGemini({
        fileBytes: new Uint8Array([1, 2, 3]),
        fileName: "broken.pdf",
        mimeType: "application/pdf",
        ext: "pdf",
        deps: {
          apiKeyOverride: "fake-key",
          sleepImpl: async () => {},
          fetchImpl: async () =>
            makeJsonResponse(400, {
              error: { code: 400, status: "INVALID_ARGUMENT", message: "Unable to process input image/pdf" },
            }),
        },
      }),
    (err) => err instanceof AppError && err.statusCode === 400 && err.code === "GEMINI_INVALID_REQUEST",
  );

  // 7b. Large PDF (> 1.5 MB) uploads ONCE to Gemini Files API and reuses same fileUri on fallback
  const bigPdfBytes = new Uint8Array(1_600_000);
  let uploadInitCount = 0;
  let uploadFinalizeCount = 0;
  const generatePayloads = [];

  const analysis = await analyzeDocumentWithGemini({
    fileBytes: bigPdfBytes,
    fileName: "large-exam.pdf",
    mimeType: "application/pdf",
    ext: "pdf",
    deps: {
      apiKeyOverride: "fake-key",
      sleepImpl: async () => {},
      fetchImpl: async (url, init) => {
        const u = String(url);
        if (u.includes("/upload/v1beta/files")) {
          uploadInitCount++;
          return new Response("{}", {
            status: 200,
            headers: { "x-goog-upload-url": "https://upload.example.com/session-1" },
          });
        }
        if (u === "https://upload.example.com/session-1") {
          uploadFinalizeCount++;
          return makeJsonResponse(200, {
            file: {
              name: "files/abc123",
              uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
              state: "ACTIVE",
            },
          });
        }
        if (init?.method === "DELETE") {
          return makeJsonResponse(200, {});
        }
        generatePayloads.push({ url: u, body: JSON.parse(String(init?.body || "{}")) });
        if (u.includes("gemini-3.8-flash")) {
          return makeJsonResponse(503, { error: { code: 503, status: "UNAVAILABLE" } });
        }
        return makeGeminiSuccessPayload({
          extracted_text: "Extracted content from PDF page 1 with sufficient text length.",
          estimated_pages: 5,
          title_suggestion: "Exam Title",
          subject_suggestion: "CS",
          topics: ["Topic 1"],
          summary: "Summary",
          key_concepts: ["Concept 1"],
          recommended_question_count: 20,
        });
      },
    },
  });

  assert.equal(uploadInitCount, 1);
  assert.equal(uploadFinalizeCount, 1);
  assert.equal(analysis.aiMeta.model_id, "gemini-3-flash-preview");
  // Every generateContent attempt (including 503 retries + fallback) reused the exact same fileUri
  for (const call of generatePayloads) {
    assert.equal(
      call.body.contents[0].parts[0].fileData.fileUri,
      "https://generativelanguage.googleapis.com/v1beta/files/abc123",
    );
  }
});

test("Scenario 8: Network Timeout switches to fallback model, or fails cleanly if all time out", async () => {
  await assert.rejects(
    () =>
      generateQuizWithGemini({
        documentText: "Sample network content",
        title: "Net",
        difficulty: "medium",
        questionCount: 1,
        questionTypes: ["multiple_choice"],
        deps: {
          apiKeyOverride: "fake-key",
          sleepImpl: async () => {},
          fetchImpl: async () => {
            const abortErr = new Error("Aborted");
            abortErr.name = "AbortError";
            throw abortErr;
          },
        },
      }),
    (err) => err instanceof AppError && err.statusCode === 504 && err.code === "GEMINI_TIMEOUT",
  );
});

test("Scenario 9: Ensures only one final quiz record is saved and rolls back partial multi-batch failures", async () => {
  // 9a. Backend multi-batch (25 questions -> 2 batches) falls back once and propagates winning model
  const requestedModels = [];
  let batchSeq = 0;
  const backendQuiz = await generateQuizWithGemini({
    documentText: "TCP/IP networking layer principles and congestion control mechanisms.\n\n".repeat(40),
    title: "Single Record Quiz",
    difficulty: "medium",
    questionCount: 25,
    questionTypes: ["multiple_choice"],
    deps: {
      apiKeyOverride: "fake-key",
      sleepImpl: async () => {},
      fetchImpl: async (url) => {
        const u = String(url);
        requestedModels.push(u.includes("gemini-3.8-flash") ? "gemini-3.8-flash" : "gemini-3-flash-preview");
        if (u.includes("gemini-3.8-flash")) {
          return makeJsonResponse(429, {
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              message: "GenerateRequestsPerDay limit reached",
            },
          });
        }
        batchSeq++;
        const questions = Array.from({ length: batchSeq === 1 ? 13 : 12 }, (_, idx) => ({
          ...makeSampleQuizJson(`Question B${batchSeq}-${idx + 1}`).questions[0],
        }));
        return makeGeminiSuccessPayload({ title: "Single Record Quiz", questions });
      },
    },
  });

  assert.equal(backendQuiz.questions.length, 25);
  assert.equal(backendQuiz.aiMeta.model_id, "gemini-3-flash-preview");
  // Batch 1 tries 3.8 -> 3-flash; Batch 2 goes straight to 3-flash without retrying exhausted 3.8
  assert.deepEqual(requestedModels, [
    "gemini-3.8-flash",
    "gemini-3-flash-preview",
    "gemini-3-flash-preview",
  ]);

  // 9b. Frontend multi-batch orchestration (40 questions -> 2 batches) reuses one quiz_set_id
  // and rolls back partial quiz_sets via softDeleteQuiz if a later batch fails.
  const originalFetch = globalThis.fetch;
  let activeFetchImpl = originalFetch;
  globalThis.fetch = (...args) => activeFetchImpl(...args);

  const { supabase } = await import("../frontend/src/services/supabaseClient.js");
  const { quizService } = await import("../frontend/src/services/quizService.js");
  const originalGetSession = supabase.auth.getSession.bind(supabase.auth);
  supabase.auth.getSession = async () => ({
    data: { session: { access_token: "test-jwt-token" } },
    error: null,
  });

  try {
    // Subcase 1: Both batches succeed -> only 1 quiz_set_id created, batch 2 appends to same quiz_set_id
    const edgeCallsSuccess = [];
    const progressSuccess = [];
    let softDeletedIds = [];

    activeFetchImpl = async (url, init = {}) => {
      const u = String(url);
      if (u.includes("/functions/v1/generate-quiz")) {
        const body = JSON.parse(String(init.body || "{}"));
        edgeCallsSuccess.push(body);
        const batchQuestions = Array.from({ length: body.question_count }, (_, idx) => ({
          id: `q-${edgeCallsSuccess.length}-${idx}`,
          question_text: `Q ${edgeCallsSuccess.length}.${idx + 1}`,
        }));
        return makeJsonResponse(200, {
          success: true,
          quiz_set: { id: "quiz-single-001", title: body.title },
          question_count: batchQuestions.length,
          preview_questions: batchQuestions,
          ai_meta: {
            model_id: "gemini-3-flash-preview",
            model_name: "Gemini 3 Flash",
            fallback_triggered: edgeCallsSuccess.length === 1,
            status_messages:
              edgeCallsSuccess.length === 1
                ? ["Gemini 3.8 Flash đã hết quota. Đang chuyển sang Gemini 3 Flash..."]
                : [],
          },
        });
      }
      if (u.includes("/rest/v1/quiz_sets") && (init.method === "PATCH" || init.method === "DELETE")) {
        softDeletedIds.push(u);
        return makeJsonResponse(200, { id: "quiz-single-001", deleted_at: new Date().toISOString() });
      }
      throw new Error(`Unexpected fetch URL in Scenario 9: ${u}`);
    };

    const result = await quizService.generateQuizFromDocument({
      documentId: "doc-uuid-1",
      title: "Multi Batch Quiz",
      questionCount: 40,
      forceAi: true,
      onProgress: (p) => progressSuccess.push(p),
    });

    assert.equal(edgeCallsSuccess.length, 2);
    assert.equal(edgeCallsSuccess[0].quiz_set_id, null);
    assert.equal(edgeCallsSuccess[1].quiz_set_id, "quiz-single-001");
    assert.equal(edgeCallsSuccess[1].preferred_model, "gemini-3-flash-preview");
    assert.equal(result.quiz_set.id, "quiz-single-001");
    assert.equal(result.question_count, 40);
    assert.equal(softDeletedIds.length, 0);
    assert.equal(progressSuccess[progressSuccess.length - 1].message, "Tạo đề thành công!");

    // Subcase 2: Batch 1 creates quiz-partial-999, Batch 2 fails -> rolls back partial record via softDeleteQuiz
    const edgeCallsFailure = [];
    softDeletedIds = [];
    let rollbackPatchPayload = null;

    activeFetchImpl = async (url, init = {}) => {
      const u = String(url);
      if (u.includes("/functions/v1/generate-quiz")) {
        const body = JSON.parse(String(init.body || "{}"));
        edgeCallsFailure.push(body);
        if (edgeCallsFailure.length === 1) {
          return makeJsonResponse(200, {
            success: true,
            quiz_set: { id: "quiz-partial-999", title: body.title },
            question_count: 20,
            preview_questions: Array.from({ length: 20 }, (_, i) => ({
              id: `qp-${i}`,
              question_text: `Partial Q ${i + 1}`,
            })),
            ai_meta: {
              model_id: "gemini-3.8-flash",
              model_name: "Gemini 3.8 Flash",
              fallback_triggered: false,
              status_messages: [],
            },
          });
        }
        return makeJsonResponse(429, {
          success: false,
          error: {
            code: "GEMINI_ALL_MODELS_QUOTA_EXCEEDED",
            message: "All Gemini models exhausted",
          },
        });
      }
      if (u.includes("/rest/v1/quiz_sets") && String(init.method).toUpperCase() === "PATCH") {
        softDeletedIds.push(u);
        rollbackPatchPayload = JSON.parse(String(init.body || "{}"));
        return makeJsonResponse(200, { id: "quiz-partial-999", deleted_at: rollbackPatchPayload.deleted_at });
      }
      throw new Error(`Unexpected fetch URL in Scenario 9 rollback: ${u}`);
    };

    await assert.rejects(
      () =>
        quizService.generateQuizFromDocument({
          documentId: "doc-uuid-2",
          title: "Partial Fail Quiz",
          questionCount: 40,
          forceAi: true,
        }),
      /All Gemini models exhausted/,
    );

    assert.ok(edgeCallsFailure.length >= 2 && edgeCallsFailure.length <= 4);
    assert.equal(softDeletedIds.length, 1);
    assert.ok(softDeletedIds[0].includes("id=eq.quiz-partial-999"));
    assert.ok(typeof rollbackPatchPayload?.deleted_at === "string" && rollbackPatchPayload.deleted_at.length > 0);
  } finally {
    supabase.auth.getSession = originalGetSession;
    globalThis.fetch = originalFetch;
  }
});

test("Multi-Format Routing: Supports TXT, DOCX, PNG/JPG/WEBP, and PDF inputs cleanly", async () => {
  // 1. TXT format uses text path without Files API upload
  let txtRequestBody = null;
  const txtRes = await analyzeDocumentWithGemini({
    fileBytes: new TextEncoder().encode("HTTP is stateless. TCP provides reliable byte stream delivery."),
    fileName: "notes.txt",
    mimeType: "text/plain",
    ext: "txt",
    deps: {
      apiKeyOverride: "fake-key",
      sleepImpl: async () => {},
      fetchImpl: async (_url, init) => {
        txtRequestBody = JSON.parse(String(init?.body || "{}"));
        return makeGeminiSuccessPayload({
          extracted_text: "PROVIDED_IN_TEXT",
          estimated_pages: 1,
          title_suggestion: "Networking Notes",
          subject_suggestion: "CN",
          topics: ["HTTP", "TCP"],
          summary: "Summary of HTTP and TCP.",
          key_concepts: ["Stateless"],
          recommended_question_count: 10,
          questions: makeSampleQuizJson("What is HTTP?").questions,
        });
      },
    },
  });
  assert.ok(txtRequestBody.contents[0].parts[0].text.includes("PROVIDED_IN_TEXT"));
  assert.equal(txtRes.extractedData.questions.length, 1);

  // 2. Image format (PNG) uses inlineData multimodal OCR path
  let imgRequestBody = null;
  const imgRes = await analyzeDocumentWithGemini({
    fileBytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    fileName: "slide.png",
    mimeType: "image/png",
    ext: "png",
    deps: {
      apiKeyOverride: "fake-key",
      sleepImpl: async () => {},
      fetchImpl: async (_url, init) => {
        imgRequestBody = JSON.parse(String(init?.body || "{}"));
        return makeGeminiSuccessPayload({
          extracted_text: "OCR extracted slide content about OSI 7 layers.",
          estimated_pages: 1,
          title_suggestion: "OSI Slide",
          subject_suggestion: "Networks",
          topics: ["OSI"],
          summary: "OSI model overview.",
          key_concepts: ["Physical", "Transport"],
          recommended_question_count: 5,
          questions: makeSampleQuizJson("How many layers are in OSI?").questions,
        });
      },
    },
  });
  assert.equal(imgRequestBody.contents[0].parts[0].inlineData.mimeType, "image/png");
  assert.equal(imgRes.extractedData.questions.length, 1);
});

test("Persistence Recovery: Checkpoint A preserves extracted_data on DB failure and recovers with 0 Gemini calls", async () => {
  let geminiCalls = 0;
  let checkpointSaved = null;
  let bankSyncedCount = 0;
  let syncAttempts = 0;

  const baseDoc = {
    id: "doc-rec-1",
    user_id: "user-1",
    file_name: "lecture.txt",
    file_path: "user-1/lecture.txt",
    file_type: "txt",
    mime_type: "text/plain",
    file_size: 120,
    extracted_data: null,
    question_bank_synced: false,
  };

  const repoWithDbFailure = {
    async downloadStorageFile() {
      return {
        bytes: new TextEncoder().encode("Database ACID properties: Atomicity, Consistency, Isolation, Durability."),
        mimeType: "text/plain",
      };
    },
    async saveExtractedCheckpoint(cp) {
      checkpointSaved = cp.extractedData;
      baseDoc.extracted_text = cp.extractedText;
      baseDoc.ai_summary = cp.summary;
      baseDoc.extracted_data = cp.extractedData;
      baseDoc.question_bank_synced = false;
    },
    async syncQuestionBank(sync) {
      syncAttempts++;
      if (syncAttempts === 1) {
        throw new Error("Simulated transient Postgres deadlock on Checkpoint B");
      }
      bankSyncedCount = sync.questions.length;
      baseDoc.question_bank_synced = true;
      return { synced_count: bankSyncedCount, already_synced: false };
    },
    async markDocumentProcessed() {
      return { ...baseDoc, status: "processed" };
    },
    async markDocumentFailed() {},
  };

  // Run 1: Gemini succeeds -> Checkpoint A saved -> Checkpoint B fails
  await assert.rejects(
    () =>
      processOrRecoverDocument({
        doc: baseDoc,
        actorUserId: "user-1",
        repo: repoWithDbFailure,
        geminiDeps: {
          apiKeyOverride: "fake-key",
          sleepImpl: async () => {},
          fetchImpl: async () => {
            geminiCalls++;
            return makeGeminiSuccessPayload({
              extracted_text: "PROVIDED_IN_TEXT",
              estimated_pages: 1,
              title_suggestion: "ACID Lecture",
              subject_suggestion: "Databases",
              topics: ["ACID"],
              summary: "ACID properties.",
              key_concepts: ["Atomicity"],
              recommended_question_count: 5,
              questions: makeSampleQuizJson("What does A in ACID stand for?").questions,
            });
          },
        },
      }),
    /Simulated transient Postgres deadlock/,
  );

  assert.equal(geminiCalls, 1);
  assert.ok(checkpointSaved && checkpointSaved.questions.length === 1);
  assert.equal(baseDoc.question_bank_synced, false);

  // Run 2 (Recovery): extracted_data exists -> 0 Gemini calls, syncs Question Bank cleanly
  const recovered = await processOrRecoverDocument({
    doc: baseDoc,
    actorUserId: "user-1",
    repo: repoWithDbFailure,
    geminiDeps: {
      apiKeyOverride: "fake-key",
      fetchImpl: async () => {
        geminiCalls++;
        throw new Error("Gemini MUST NOT be called during persistence recovery!");
      },
    },
  });

  assert.equal(geminiCalls, 1); // Still 1 from Run 1 -> 0 new calls!
  assert.equal(recovered.recoveredWithoutGemini, true);
  assert.equal(recovered.syncedQuestions, 1);
  assert.equal(recovered.aiMeta.model_id, "database-recovery");
  assert.equal(baseDoc.question_bank_synced, true);
});

test("Database-only Quiz Generation: Creates quiz from Normalized Question Bank with 0 Gemini calls", async () => {
  let geminiCalls = 0;
  let bankSyncedDuringQuiz = false;

  const docWithJsonb = {
    id: "doc-db-1",
    user_id: "user-1",
    file_name: "db.pdf",
    file_path: "user-1/db.pdf",
    file_type: "pdf",
    extracted_text: "Normalized database content.",
    question_bank_synced: false,
    extracted_data: {
      title_suggestion: "DB Quiz",
      questions: makeSampleQuizJson("Which normal form removes transitive dependency?").questions,
    },
  };

  const result = await generateQuizDatabaseFirst({
    doc: docWithJsonb,
    actorUserId: "user-1",
    existingQuizSetId: null,
    title: "DB Quiz",
    description: "Generated from bank",
    subject: "Databases",
    topic: "Normalization",
    difficulty: "medium",
    questionCount: 1,
    questionTypes: ["multiple_choice"],
    defaultExamQuestions: 1,
    defaultExamDuration: 15,
    repo: {
      async syncFromExtractedData(sync) {
        bankSyncedDuringQuiz = sync.questions.length === 1;
      },
      async createQuizFromQuestionBank(q) {
        return {
          quiz_set_id: "quiz-from-bank-1",
          question_count: 1,
          questions: [{ id: "q-1", question_text: "Which normal form removes transitive dependency?", options: [] }],
          source: "database_bank",
        };
      },
      async createOrAppendQuizFromAi() {
        throw new Error("Should not invoke AI save path when DB bank succeeded");
      },
    },
    geminiDeps: {
      apiKeyOverride: "fake-key",
      fetchImpl: async () => {
        geminiCalls++;
        throw new Error("Gemini MUST NOT be called during Database-only quiz generation!");
      },
    },
  });

  assert.equal(geminiCalls, 0);
  assert.equal(bankSyncedDuringQuiz, true);
  assert.equal(result.source, "database_bank");
  assert.equal(result.quizSetId, "quiz-from-bank-1");
  assert.equal(result.aiMeta.model_id, "database-bank");
});

test("Direct JSON Import: Bypasses Gemini completely in both processOrRecoverDocument and quizService.generateQuizFromJson", async () => {
  let geminiCalls = 0;
  let savedExtracted = null;
  let syncedCount = 0;

  const jsonPayload = {
    title: "Direct JSON Quiz",
    subject: "Software Engineering",
    questions: makeSampleQuizJson("What is idempotency?").questions,
  };

  // 1. Upload .json via processOrRecoverDocument -> 0 Gemini calls
  const docRes = await processOrRecoverDocument({
    doc: {
      id: "doc-json-1",
      user_id: "user-1",
      file_name: "questions.json",
      file_path: "user-1/questions.json",
      file_type: "json",
      mime_type: "application/json",
      file_size: 256,
    },
    actorUserId: "user-1",
    repo: {
      async downloadStorageFile() {
        return {
          bytes: new TextEncoder().encode(JSON.stringify(jsonPayload)),
          mimeType: "application/json",
        };
      },
      async saveExtractedCheckpoint(cp) {
        savedExtracted = cp.extractedData;
      },
      async syncQuestionBank(sync) {
        syncedCount = sync.questions.length;
        return { synced_count: syncedCount, already_synced: false };
      },
      async markDocumentProcessed(docId) {
        return { id: docId, status: "processed", question_bank_synced: true };
      },
      async markDocumentFailed() {},
    },
    geminiDeps: {
      apiKeyOverride: "fake-key",
      fetchImpl: async () => {
        geminiCalls++;
        throw new Error("Gemini MUST NOT be called for .json files!");
      },
    },
  });

  assert.equal(geminiCalls, 0);
  assert.equal(syncedCount, 1);
  assert.equal(savedExtracted.questions.length, 1);
  assert.equal(docRes.aiMeta.model_id, "direct-json");

  // 2. quizService.generateQuizFromJson -> calls generate-quiz with json_payload (0 Gemini)
  const originalFetch = globalThis.fetch;
  let activeFetchImpl = originalFetch;
  globalThis.fetch = (...args) => activeFetchImpl(...args);

  const { supabase } = await import("../frontend/src/services/supabaseClient.js");
  const { quizService } = await import("../frontend/src/services/quizService.js");
  const originalGetSession = supabase.auth.getSession.bind(supabase.auth);
  supabase.auth.getSession = async () => ({
    data: { session: { access_token: "test-jwt-token" } },
    error: null,
  });

  try {
    const sentBodies = [];
    activeFetchImpl = async (url, init = {}) => {
      if (String(url).includes("/functions/v1/generate-quiz")) {
        const body = JSON.parse(String(init.body || "{}"));
        sentBodies.push(body);
        return makeJsonResponse(201, {
          success: true,
          quiz_set: { id: "quiz-direct-json-1", title: body.title },
          question_count: body.json_payload.questions.length,
          preview_questions: body.json_payload.questions,
          source: "direct_json",
          ai_meta: {
            model_id: "direct-json",
            model_name: "JSON Direct Import (0 Gemini calls)",
            fallback_triggered: false,
            status_messages: [],
          },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const res = await quizService.generateQuizFromJson({
      jsonPayload,
      title: "Direct JSON Quiz",
      subject: "SE",
      difficulty: "medium",
    });

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0].document_id, null);
    assert.equal(sentBodies[0].json_payload.questions.length, 1);
    assert.equal(res.source, "direct_json");
    assert.equal(res.quiz_set.id, "quiz-direct-json-1");
  } finally {
    supabase.auth.getSession = originalGetSession;
    globalThis.fetch = originalFetch;
  }
});

test("Flexible JSON Schema: Supports { id, question, options: { A, B, C, D }, answer, explanation } including 2/3/4 options", async () => {
  const { validateGeneratedQuizPayload } = await import("../supabase/functions/_shared/validation.ts");

  const flexibleArray = [
    {
      id: 1,
      question: "Which language does Flutter use?",
      options: { A: "Java", B: "Dart", C: "Kotlin", D: "Swift" },
      answer: "B",
      explanation: "Flutter sử dụng Dart.",
    },
    {
      id: 2,
      question: "Pick the 3-option item:",
      options: { A: "First", B: "Second", C: "Third" },
      answer: "C",
      explanation: "Đáp án là C.",
    },
    {
      id: 3,
      question: "StatelessWidget is immutable.",
      options: { A: "True", B: "False" },
      answer: "A",
      explanation: "StatelessWidget không thay đổi trạng thái nội bộ.",
    },
  ];

  const validated = validateGeneratedQuizPayload(flexibleArray, "Flutter Questions", "medium");
  assert.equal(validated.title, "Flutter Questions");
  assert.equal(validated.questions.length, 3);
  assert.equal(validated.questions[0].question_text, "Which language does Flutter use?");
  assert.equal(validated.questions[0].options.length, 4);
  assert.equal(validated.questions[0].correct_option_label, "B");
  assert.equal(validated.questions[1].options.length, 3);
  assert.equal(validated.questions[2].question_type, "multiple_choice");
  assert.equal(validated.questions[2].options.length, 2);
});

test("Strict Zero-Gemini Quiz Generation: Never calls Gemini in generateQuizDatabaseFirst unless forceAi=true", async () => {
  let geminiCalls = 0;

  await assert.rejects(
    () =>
      generateQuizDatabaseFirst({
        doc: {
          id: "doc-empty-bank",
          user_id: "user-1",
          file_name: "legacy.pdf",
          file_path: "user-1/legacy.pdf",
          file_type: "pdf",
          extracted_text: "Some legacy extracted text.",
          question_bank_synced: false,
          extracted_data: null,
        },
        actorUserId: "user-1",
        existingQuizSetId: null,
        title: "Legacy Quiz",
        description: "Test",
        subject: "CS",
        topic: null,
        difficulty: "medium",
        questionCount: 20,
        questionTypes: ["multiple_choice"],
        defaultExamQuestions: 20,
        defaultExamDuration: 30,
        forceAi: false,
        repo: {
          async syncFromExtractedData() {},
          async createQuizFromQuestionBank() {
            return { quiz_set_id: "", question_count: 0, questions: [], source: "database_empty" };
          },
          async createOrAppendQuizFromAi() {
            throw new Error("MUST NOT call AI save path when forceAi is false");
          },
        },
        geminiDeps: {
          apiKeyOverride: "fake-key",
          fetchImpl: async () => {
            geminiCalls++;
            throw new Error("MUST NOT call Gemini during generate-quiz when forceAi is false");
          },
        },
      }),
    (err) => err instanceof AppError && err.code === "DOCUMENT_QUESTION_BANK_EMPTY" && err.statusCode === 400,
  );

  assert.equal(geminiCalls, 0);
});

test("Language Preservation: Gemini prompts instruct keeping source language for questions/options and Vietnamese for explanations", async () => {
  let capturedAnalyzeBody = null;
  await analyzeDocumentWithGemini({
    fileBytes: new TextEncoder().encode("Flutter is an open-source UI toolkit created by Google using Dart."),
    fileName: "flutter_slides.txt",
    mimeType: "text/plain",
    ext: "txt",
    deps: {
      apiKeyOverride: "fake-key",
      sleepImpl: async () => {},
      fetchImpl: async (_url, init) => {
        capturedAnalyzeBody = JSON.parse(String(init?.body || "{}"));
        return makeGeminiSuccessPayload({
          extracted_text: "PROVIDED_IN_TEXT",
          estimated_pages: 1,
          title_suggestion: "Flutter Slides",
          subject_suggestion: "Flutter",
          topics: ["Widgets"],
          summary: "Flutter overview",
          key_concepts: ["Dart"],
          recommended_question_count: 5,
          questions: makeSampleQuizJson("What language does Flutter use?").questions,
        });
      },
    },
  });

  const sysText = capturedAnalyzeBody?.systemInstruction?.parts?.[0]?.text || "";
  assert.ok(sysText.includes("GIỮ NGUYÊN NGÔN NGỮ GỐC"));
  assert.ok(sysText.includes("TUYỆT ĐỐI KHÔNG tự động dịch"));
  assert.ok(sysText.includes("explanation"));
});

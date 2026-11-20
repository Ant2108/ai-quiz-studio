// ============================================================================
// EDGE FUNCTION 5: submit-attempt
// Endpoint: POST /functions/v1/submit-attempt
// Request:  { "attempt_id": "UUID" }
// Features:
//   - Verifies attempt owner
//   - Runs inside an ACID transaction with SELECT ... FOR UPDATE row locking
//   - Checks server time vs time_limit_seconds (transitions to 'submitted' or 'expired')
//   - Grades responses against server-only attempt_answer_keys
//   - Calculates correct_count, answered_count, wrong_count, unanswered_count
//   - Score formula: Score = round((Correct Count / Total Questions) * 10, 2)
//   - Idempotent: repeated submit requests return the existing result without re-grading
// ============================================================================

import { handleCorsPreflight } from "../_shared/cors.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/response.ts";
import { requireAuth } from "../_shared/auth.ts";
import { requireUuid } from "../_shared/validation.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return errorResponse(
      new AppError("Method not allowed. Use POST.", 405, "METHOD_NOT_ALLOWED"),
      req,
    );
  }

  try {
    const { user, adminClient } = await requireAuth(req);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new AppError("Request body phải là JSON hợp lệ.", 400, "INVALID_JSON_BODY");
    }

    const attemptId = requireUuid(
      (body as Record<string, unknown>).attempt_id,
      "attempt_id",
    );

    const { data: result, error: rpcError } = await adminClient.rpc(
      "rpc_submit_attempt",
      {
        p_user_id: user.id,
        p_attempt_id: attemptId,
      },
    );

    if (rpcError || !result) {
      throw new AppError(
        rpcError?.message || "Không thể chấm điểm và nộp bài.",
        rpcError?.message?.includes("Forbidden")
          ? 403
          : rpcError?.message?.includes("not found")
          ? 404
          : 400,
        "SUBMIT_ATTEMPT_FAILED",
      );
    }

    return jsonResponse(
      {
        success: true,
        result,
      },
      200,
      req,
    );
  } catch (err) {
    return errorResponse(err, req);
  }
});

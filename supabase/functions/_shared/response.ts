// ============================================================================
// SHARED HELPER: HTTP RESPONSES & SAFE ERROR HANDLING
// Never logs or exposes JWTs, API keys, or service role secrets.
// ============================================================================

import { getCorsHeaders } from "./cors.ts";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode = 400,
    code = "BAD_REQUEST",
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function jsonResponse(
  data: unknown,
  status = 200,
  req?: Request,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...getCorsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function sanitizeMessage(msg: string): string {
  // Mask any accidental key/token strings in error messages
  return msg
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/eyJ[0-9A-Za-z\-_]+\.[0-9A-Za-z\-_]+\.[0-9A-Za-z\-_]+/g, "[REDACTED_JWT]")
    .replace(/sb_secret_[0-9A-Za-z\-_]+/g, "[REDACTED_SECRET]");
}

export function errorResponse(error: unknown, req?: Request): Response {
  if (error instanceof AppError) {
    return jsonResponse(
      {
        success: false,
        error: {
          code: error.code,
          message: sanitizeMessage(error.message),
          details: error.details ?? null,
        },
      },
      error.statusCode,
      req,
    );
  }

  const rawMessage = error instanceof Error ? error.message : "Internal server error";
  const safeMessage = sanitizeMessage(rawMessage);

  // Map common database constraint / business rule exceptions to appropriate HTTP status codes
  let statusCode = 500;
  let code = "INTERNAL_ERROR";

  if (safeMessage.includes("Unauthorized")) {
    statusCode = 401;
    code = "UNAUTHORIZED";
  } else if (safeMessage.includes("Forbidden")) {
    statusCode = 403;
    code = "FORBIDDEN";
  } else if (safeMessage.includes("not found") || safeMessage.includes("Not found")) {
    statusCode = 404;
    code = "NOT_FOUND";
  } else if (
    safeMessage.includes("Invalid") ||
    safeMessage.includes("does not have") ||
    safeMessage.includes("must contain") ||
    safeMessage.includes("violates")
  ) {
    statusCode = 400;
    code = "VALIDATION_ERROR";
  }

  console.error(`[EdgeFunctionError] code=${code} status=${statusCode} message=${safeMessage}`);

  return jsonResponse(
    {
      success: false,
      error: {
        code,
        message: safeMessage,
      },
    },
    statusCode,
    req,
  );
}

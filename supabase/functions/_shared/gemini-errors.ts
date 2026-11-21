// ============================================================================
// INTELLIGENT GEMINI ERROR PARSER & CLASSIFIER
// Parses HTTP status, Google RPC status (RESOURCE_EXHAUSTED, UNAVAILABLE, etc.),
// QuotaFailure violations (quotaMetric, quotaId), and RetryInfo (retryDelay).
// ============================================================================

export type GeminiErrorCategory =
  | "RPD_EXCEEDED"
  | "RPM_EXCEEDED"
  | "TPM_EXCEEDED"
  | "RESOURCE_EXHAUSTED_GENERIC"
  | "OVERLOADED_503"
  | "AUTH_ERROR"
  | "BAD_REQUEST_400"
  | "MODEL_NOT_FOUND_404"
  | "SERVER_ERROR_5XX"
  | "NETWORK_TIMEOUT";

export type GeminiRecoveryAction =
  | "switch_model"
  | "retry_then_switch"
  | "fail_immediately";

export interface ClassifiedGeminiError {
  httpStatus: number;
  rpcStatus: string;
  category: GeminiErrorCategory;
  action: GeminiRecoveryAction;
  message: string;
  userMessage: string;
  quotaMetrics: string[];
  quotaIds: string[];
  retryDelayMs: number | null;
  shouldOptimizePayload: boolean;
}

/**
 * Parses Google Protobuf duration strings like "12s", "1.5s", "500ms" into milliseconds.
 */
export function parseRetryDelayMs(delayRaw: unknown): number | null {
  if (typeof delayRaw !== "string") return null;
  const trimmed = delayRaw.trim().toLowerCase();
  const msMatch = trimmed.match(/^(\d+(?:\.\d+)?)ms$/);
  if (msMatch) {
    return Math.max(0, Math.round(parseFloat(msMatch[1])));
  }
  const secMatch = trimmed.match(/^(\d+(?:\.\d+)?)s$/);
  if (secMatch) {
    return Math.max(0, Math.round(parseFloat(secMatch[1]) * 1000));
  }
  return null;
}

export function classifyGeminiApiError(
  httpStatus: number,
  rawBody: string,
  modelDisplayName = "Gemini",
): ClassifiedGeminiError {
  let parsed: Record<string, unknown> | null = null;
  try {
    const json = JSON.parse(rawBody);
    parsed = (json?.error && typeof json.error === "object" ? json.error : json) as Record<
      string,
      unknown
    >;
  } catch {
    parsed = null;
  }

  const rpcStatus =
    typeof parsed?.status === "string" ? parsed.status.toUpperCase().trim() : "";
  const message =
    typeof parsed?.message === "string"
      ? parsed.message.trim()
      : rawBody.slice(0, 300).trim() || `HTTP ${httpStatus}`;
  const details = Array.isArray(parsed?.details) ? parsed.details : [];

  const quotaMetrics: string[] = [];
  const quotaIds: string[] = [];
  let retryDelayMs: number | null = null;

  for (const d of details) {
    if (!d || typeof d !== "object") continue;
    const detail = d as Record<string, unknown>;
    const typeStr = typeof detail["@type"] === "string" ? detail["@type"] : "";

    if (typeStr.includes("QuotaFailure") && Array.isArray(detail.violations)) {
      for (const v of detail.violations) {
        if (!v || typeof v !== "object") continue;
        const violation = v as Record<string, unknown>;
        if (typeof violation.quotaMetric === "string") {
          quotaMetrics.push(violation.quotaMetric);
        }
        if (typeof violation.quotaId === "string") {
          quotaIds.push(violation.quotaId);
        }
      }
    }

    if (typeStr.includes("RetryInfo") && detail.retryDelay !== undefined) {
      const parsedDelay = parseRetryDelayMs(detail.retryDelay);
      if (parsedDelay !== null) {
        retryDelayMs = parsedDelay;
      }
    }
  }

  // Also inspect ErrorInfo or inline message if retryDelay was mentioned in prose
  if (retryDelayMs === null) {
    const proseDelay = message.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i);
    if (proseDelay) {
      retryDelayMs = Math.round(parseFloat(proseDelay[1]) * 1000);
    }
  }

  const combinedQuotaText = `${quotaIds.join(" ")} ${quotaMetrics.join(" ")} ${message}`.toLowerCase();

  // 1. 401 / 403 Authentication & Permission Errors (check message too for API_KEY_INVALID on 400)
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    rpcStatus === "UNAUTHENTICATED" ||
    rpcStatus === "PERMISSION_DENIED" ||
    combinedQuotaText.includes("api_key_invalid") ||
    combinedQuotaText.includes("api key not valid")
  ) {
    return {
      httpStatus,
      rpcStatus: rpcStatus || "UNAUTHENTICATED",
      category: "AUTH_ERROR",
      action: "fail_immediately",
      message,
      userMessage:
        "Xác thực Gemini API thất bại (API key không hợp lệ hoặc thiếu quyền truy cập). Vui lòng kiểm tra cấu hình Secrets trên máy chủ.",
      quotaMetrics,
      quotaIds,
      retryDelayMs: null,
      shouldOptimizePayload: false,
    };
  }

  // 2. 429 / RESOURCE_EXHAUSTED: Distinguish RPD vs TPM vs RPM
  if (httpStatus === 429 || rpcStatus === "RESOURCE_EXHAUSTED") {
    const isRpd =
      combinedQuotaText.includes("perday") ||
      combinedQuotaText.includes("requestsperday") ||
      combinedQuotaText.includes("rpd") ||
      combinedQuotaText.includes("daily");

    if (isRpd) {
      return {
        httpStatus,
        rpcStatus: rpcStatus || "RESOURCE_EXHAUSTED",
        category: "RPD_EXCEEDED",
        action: "switch_model",
        message,
        userMessage: `${modelDisplayName} đã hết hạn mức sử dụng trong ngày (RPD).`,
        quotaMetrics,
        quotaIds,
        retryDelayMs,
        shouldOptimizePayload: false,
      };
    }

    const isTpm =
      combinedQuotaText.includes("token") &&
      (combinedQuotaText.includes("perminute") || combinedQuotaText.includes("tpm"));

    if (isTpm) {
      return {
        httpStatus,
        rpcStatus: rpcStatus || "RESOURCE_EXHAUSTED",
        category: "TPM_EXCEEDED",
        action: "retry_then_switch",
        message,
        userMessage: `${modelDisplayName} đang vượt giới hạn token/phút (TPM).`,
        quotaMetrics,
        quotaIds,
        retryDelayMs,
        shouldOptimizePayload: true,
      };
    }

    const isRpm =
      combinedQuotaText.includes("perminute") ||
      combinedQuotaText.includes("requestsperminute") ||
      combinedQuotaText.includes("rpm");

    return {
      httpStatus,
      rpcStatus: rpcStatus || "RESOURCE_EXHAUSTED",
      category: isRpm ? "RPM_EXCEEDED" : "RESOURCE_EXHAUSTED_GENERIC",
      action: isRpm ? "retry_then_switch" : "switch_model",
      message,
      userMessage: isRpm
        ? `${modelDisplayName} đang chạm giới hạn số lượt gọi/phút (RPM).`
        : `${modelDisplayName} đã hết quota.`,
      quotaMetrics,
      quotaIds,
      retryDelayMs,
      shouldOptimizePayload: false,
    };
  }

  // 3. 503 Overloaded / Service Unavailable
  if (httpStatus === 503 || rpcStatus === "UNAVAILABLE") {
    return {
      httpStatus,
      rpcStatus: rpcStatus || "UNAVAILABLE",
      category: "OVERLOADED_503",
      action: "retry_then_switch",
      message,
      userMessage: `${modelDisplayName} đang quá tải tạm thời (503).`,
      quotaMetrics,
      quotaIds,
      retryDelayMs,
      shouldOptimizePayload: false,
    };
  }

  // 4. 404 Model Not Found
  if (httpStatus === 404 || rpcStatus === "NOT_FOUND") {
    return {
      httpStatus,
      rpcStatus: rpcStatus || "NOT_FOUND",
      category: "MODEL_NOT_FOUND_404",
      action: "switch_model",
      message,
      userMessage: `Model ${modelDisplayName} không khả dụng (404).`,
      quotaMetrics,
      quotaIds,
      retryDelayMs: null,
      shouldOptimizePayload: false,
    };
  }

  // 5. 400 Invalid Request / Unsupported PDF or Input
  if (httpStatus === 400 || rpcStatus === "INVALID_ARGUMENT") {
    return {
      httpStatus,
      rpcStatus: rpcStatus || "INVALID_ARGUMENT",
      category: "BAD_REQUEST_400",
      action: "fail_immediately",
      message,
      userMessage:
        "Yêu cầu hoặc định dạng tài liệu PDF không hợp lệ. Vui lòng kiểm tra file không bị hỏng hay mã hóa mật khẩu.",
      quotaMetrics,
      quotaIds,
      retryDelayMs: null,
      shouldOptimizePayload: false,
    };
  }

  // 6. Other 5xx Server Errors
  return {
    httpStatus,
    rpcStatus: rpcStatus || "INTERNAL",
    category: "SERVER_ERROR_5XX",
    action: "retry_then_switch",
    message,
    userMessage: `${modelDisplayName} gặp lỗi máy chủ (${httpStatus}).`,
    quotaMetrics,
    quotaIds,
    retryDelayMs,
    shouldOptimizePayload: false,
  };
}

// ============================================================================
// SHARED HELPER: CORS CONFIGURATION
// ============================================================================

const DEFAULT_ALLOWED_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-requested-with";
const DEFAULT_ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

export function getCorsHeaders(req?: Request): Record<string, string> {
  const configuredOrigins = Deno.env.get("ALLOWED_ORIGINS");
  const requestOrigin = req?.headers.get("origin") ?? "*";

  let allowOrigin = "*";
  if (configuredOrigins && configuredOrigins.trim() !== "" && configuredOrigins.trim() !== "*") {
    const allowedList = configuredOrigins
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (requestOrigin && allowedList.includes(requestOrigin)) {
      allowOrigin = requestOrigin;
    } else if (allowedList.length > 0) {
      allowOrigin = allowedList[0];
    }
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": DEFAULT_ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": DEFAULT_ALLOWED_METHODS,
    "Vary": "Origin",
  };
}

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: getCorsHeaders(req),
    });
  }
  return null;
}

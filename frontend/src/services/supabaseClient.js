// ============================================================================
// SERVICE: SUPABASE CLIENT & EDGE FUNCTION INVOKER
// Rules:
//   - Only uses public URL and Anon/Publishable Key.
//   - Never embeds Service Role Key or Gemini API Key.
//   - Every Edge Function call automatically attaches the user's access token.
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const env = import.meta.env || {};
const supabaseUrl = (env.VITE_SUPABASE_URL || "").trim();
const supabaseKey = (
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.VITE_SUPABASE_ANON_KEY ||
  ""
).trim();

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "[AI Quiz Studio] Thiếu biến môi trường VITE_SUPABASE_URL hoặc VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY.",
  );
}

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseKey || "public-anon-placeholder-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

/**
 * Invokes a Supabase Edge Function with the currently authenticated user's Bearer access token.
 */
export async function invokeEdgeFunction(functionName, payload = {}) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  }

  const response = await fetch(
    `${supabaseUrl}/functions/v1/${functionName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabaseKey,
      },
      body: JSON.stringify(payload),
    },
  );

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || (data && data.success === false)) {
    const errMsg =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      `Lỗi gọi Edge Function '${functionName}' (HTTP ${response.status})`;
    const err = new Error(typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg));
    err.status = response.status;
    err.code = data?.error?.code || "EDGE_FUNCTION_ERROR";
    throw err;
  }

  return data;
}

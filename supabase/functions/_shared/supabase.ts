// ============================================================================
// SHARED HELPER: SUPABASE ADMIN & USER CLIENTS
// ============================================================================

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.1";
import { AppError } from "./response.ts";

export function getSupabaseConfig() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new AppError(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function environment.",
      500,
      "SERVER_MISCONFIGURED",
    );
  }

  return {
    supabaseUrl,
    supabaseAnonKey: supabaseAnonKey || supabaseServiceRoleKey,
    supabaseServiceRoleKey,
  };
}

/**
 * Service Role client — bypasses RLS.
 * MUST ONLY be used AFTER validating user JWT and verifying resource ownership/role!
 */
export function createAdminClient(): SupabaseClient {
  const { supabaseUrl, supabaseServiceRoleKey } = getSupabaseConfig();
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * User-scoped client — forwards the caller's Authorization Bearer token.
 */
export function createUserClient(authHeader: string): SupabaseClient {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

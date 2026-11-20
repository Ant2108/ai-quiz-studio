// ============================================================================
// SHARED HELPER: JWT AUTHENTICATION, ROLE AUTHORIZATION & RATE LIMITING
// ============================================================================

import { SupabaseClient, User } from "npm:@supabase/supabase-js@2.49.1";
import { AppError } from "./response.ts";
import { createAdminClient, createUserClient } from "./supabase.ts";

export interface AuthenticatedContext {
  user: User;
  profile: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    role: "user" | "admin";
  };
  adminClient: SupabaseClient;
  userClient: SupabaseClient;
}

/**
 * Validates the caller's Bearer JWT against Supabase Auth and fetches their profile.
 */
export async function requireAuth(
  req: Request,
  options?: { skipProfileLookup?: boolean },
): Promise<AuthenticatedContext> {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    throw new AppError(
      "Missing or invalid Authorization Bearer token.",
      401,
      "UNAUTHORIZED",
    );
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new AppError("Empty Bearer token.", 401, "UNAUTHORIZED");
  }

  const adminClient = createAdminClient();
  const userClient = createUserClient(authHeader);

  const {
    data: { user },
    error: authError,
  } = await adminClient.auth.getUser(token);

  if (authError || !user) {
    throw new AppError(
      "Invalid or expired session token. Please sign in again.",
      401,
      "UNAUTHORIZED",
    );
  }

  if (options?.skipProfileLookup) {
    return {
      user,
      profile: {
        id: user.id,
        display_name: null,
        avatar_url: null,
        role: "user",
      },
      adminClient,
      userClient,
    };
  }

  // Ensure profile exists and retrieve role
  const { data: existingProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, display_name, avatar_url, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new AppError(
      "Failed to verify user profile.",
      500,
      "PROFILE_LOOKUP_FAILED",
    );
  }

  let profile = existingProfile;
  if (!profile) {
    const defaultName =
      user.user_metadata?.display_name ||
      user.user_metadata?.full_name ||
      (user.email ? user.email.split("@")[0] : "Người dùng");

    const { data: createdProfile, error: insertError } = await adminClient
      .from("profiles")
      .insert({
        id: user.id,
        display_name: defaultName,
        avatar_url: user.user_metadata?.avatar_url ?? null,
        role: "user",
      })
      .select("id, display_name, avatar_url, role")
      .single();

    if (insertError || !createdProfile) {
      throw new AppError(
        "Could not initialize user profile.",
        500,
        "PROFILE_INIT_FAILED",
      );
    }
    profile = createdProfile;
  }

  return {
    user,
    profile: {
      id: profile.id,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      role: profile.role === "admin" ? "admin" : "user",
    },
    adminClient,
    userClient,
  };
}

/**
 * Ensures the authenticated user has role === 'admin'.
 */
export async function requireAdmin(req: Request): Promise<AuthenticatedContext> {
  const ctx = await requireAuth(req);
  if (ctx.profile.role !== "admin") {
    throw new AppError(
      "Forbidden: Administrator privileges are required for this action.",
      403,
      "FORBIDDEN_ADMIN_ONLY",
    );
  }
  return ctx;
}

/**
 * Rate limit check for AI document processing and quiz generation (Security Requirement #13).
 * Uses database timestamps on `documents` and `quiz_sets` so rate limiting persists across serverless invocations.
 */
export async function enforceAiRateLimit(
  adminClient: SupabaseClient,
  userId: string,
  action: "process_document" | "generate_quiz",
): Promise<void> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  if (action === "process_document") {
    const maxDocsPerHour = Number(Deno.env.get("RATE_LIMIT_DOCS_PER_HOUR") || "20");
    const { count, error } = await adminClient
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", oneHourAgo);

    if (!error && count !== null && count >= maxDocsPerHour) {
      throw new AppError(
        `Bạn đã đạt giới hạn xử lý tối đa ${maxDocsPerHour} tài liệu trong 1 giờ. Vui lòng thử lại sau.`,
        429,
        "RATE_LIMIT_EXCEEDED",
      );
    }
  } else if (action === "generate_quiz") {
    const maxQuizzesPerHour = Number(Deno.env.get("RATE_LIMIT_QUIZZES_PER_HOUR") || "15");
    const { count, error } = await adminClient
      .from("quiz_sets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", oneHourAgo);

    if (!error && count !== null && count >= maxQuizzesPerHour) {
      throw new AppError(
        `Bạn đã đạt giới hạn tạo tối đa ${maxQuizzesPerHour} bộ đề bằng AI trong 1 giờ. Vui lòng thử lại sau.`,
        429,
        "RATE_LIMIT_EXCEEDED",
      );
    }
  }
}

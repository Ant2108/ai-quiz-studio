// ============================================================================
// SERVICE: AUTHENTICATION & PROFILE MANAGEMENT
// ============================================================================

import { supabase } from "./supabaseClient.js";

export const authService = {
  async signUp({ email, password, displayName }) {
    const trimmedEmail = email.trim();
    const trimmedName = (displayName || trimmedEmail.split("@")[0]).trim();

    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        data: {
          display_name: trimmedName,
          full_name: trimmedName,
        },
      },
    });

    if (error) throw error;

    // Best-effort profile initialization if session is active immediately
    if (data?.user && data?.session) {
      await supabase
        .from("profiles")
        .upsert(
          {
            id: data.user.id,
            display_name: trimmedName,
            role: "user",
          },
          { onConflict: "id", ignoreDuplicates: true },
        )
        .select()
        .maybeSingle();
    }

    return data;
  },

  async signIn({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
    return data;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async resetPassword(email) {
    const redirectUrl = `${window.location.origin}${import.meta.env.BASE_URL || "/"}`;
    const { data, error } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      {
        redirectTo: redirectUrl,
      },
    );
    if (error) throw error;
    return data;
  },

  async updatePassword(newPassword) {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) throw error;
    return data;
  },

  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  async getProfile(userId) {
    if (!userId) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url, role, created_at, updated_at")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      // If profile row has not been created yet, create default user profile
      console.warn("[authService.getProfile]", error.message);
      return null;
    }

    if (!data) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user && user.id === userId) {
        const fallbackName =
          user.user_metadata?.display_name ||
          user.user_metadata?.full_name ||
          (user.email ? user.email.split("@")[0] : "Người dùng");

        const { data: inserted } = await supabase
          .from("profiles")
          .insert({
            id: user.id,
            display_name: fallbackName,
            avatar_url: user.user_metadata?.avatar_url || null,
            role: "user",
          })
          .select("id, display_name, avatar_url, role, created_at, updated_at")
          .maybeSingle();

        return inserted || {
          id: user.id,
          display_name: fallbackName,
          avatar_url: null,
          role: "user",
        };
      }
    }

    return data;
  },

  async updateProfile(userId, { display_name, avatar_url }) {
    const updates = {};
    if (typeof display_name === "string") {
      updates.display_name = display_name.trim();
    }
    if (avatar_url !== undefined) {
      updates.avatar_url = avatar_url;
    }

    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .select("id, display_name, avatar_url, role, created_at, updated_at")
      .single();

    if (error) throw error;
    return data;
  },
};

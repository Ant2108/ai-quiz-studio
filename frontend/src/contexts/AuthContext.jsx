// ============================================================================
// CONTEXT: AUTHENTICATION & USER PROFILE PROVIDER
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../services/supabaseClient.js";
import { authService } from "../services/authService.js";
import { AuthContext } from "./authContextObject.js";

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUserProfile = useCallback(async (currentUser) => {
    if (!currentUser) {
      setProfile(null);
      return null;
    }
    try {
      const p = await authService.getProfile(currentUser.id);
      setProfile(p);
      return p;
    } catch (err) {
      console.warn("[AuthContext] Failed to load profile:", err);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
        const currentSession = await authService.getSession();
        if (!mounted) return;
        setSession(currentSession);
        const currentUser = currentSession?.user ?? null;
        setUser(currentUser);
        if (currentUser) {
          await loadUserProfile(currentUser);
        }
      } catch (err) {
        console.warn("[AuthContext] Initial session check failed:", err);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      const newUser = newSession?.user ?? null;
      setUser(newUser);
      if (newUser) {
        await loadUserProfile(newUser);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [loadUserProfile]);

  const signIn = useCallback(async ({ email, password }) => {
    const data = await authService.signIn({ email, password });
    if (data?.user) {
      await loadUserProfile(data.user);
    }
    return data;
  }, [loadUserProfile]);

  const signUp = useCallback(async ({ email, password, displayName }) => {
    const data = await authService.signUp({ email, password, displayName });
    if (data?.user && data?.session) {
      await loadUserProfile(data.user);
    }
    return data;
  }, [loadUserProfile]);

  const signOut = useCallback(async () => {
    await authService.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return null;
    return await loadUserProfile(user);
  }, [user, loadUserProfile]);

  const updateProfile = useCallback(
    async (updates) => {
      if (!user) throw new Error("Chưa đăng nhập.");
      const updated = await authService.updateProfile(user.id, updates);
      setProfile(updated);
      return updated;
    },
    [user],
  );

  const value = useMemo(
    () => ({
      session,
      user,
      profile,
      loading,
      isAuthenticated: Boolean(user),
      isAdmin: profile?.role === "admin",
      signIn,
      signUp,
      signOut,
      resetPassword: authService.resetPassword,
      updatePassword: authService.updatePassword,
      refreshProfile,
      updateProfile,
    }),
    [session, user, profile, loading, signIn, signUp, signOut, refreshProfile, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

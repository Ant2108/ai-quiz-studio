// ============================================================================
// SERVICE: ADMIN DASHBOARD, QUIZ MODERATION & USER ROLE MANAGEMENT
// ============================================================================

import { invokeEdgeFunction, supabase } from "./supabaseClient.js";

export const adminService = {
  /**
   * Lists quiz sets for Admin moderation and management.
   */
  async listModerationQuizzes({ status = "pending", search = "" } = {}) {
    let query = supabase
      .from("quiz_sets")
      .select("*, questions(count), documents(id, file_name)")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });

    if (status && status !== "all") {
      query = query.eq("moderation_status", status);
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`title.ilike.${term},subject.ilike.${term},topic.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    const userIds = Array.from(
      new Set(
        rows
          .flatMap((r) => [r.user_id, r.moderated_by])
          .filter(Boolean),
      ),
    );

    const profilesMap = new Map();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, role")
        .in("id", userIds);

      for (const p of profiles || []) {
        profilesMap.set(p.id, p);
      }
    }

    return rows.map((row) => ({
      ...row,
      question_count: Array.isArray(row.questions)
        ? row.questions[0]?.count ?? 0
        : 0,
      creator: profilesMap.get(row.user_id) || {
        id: row.user_id,
        display_name: "Người dùng",
      },
      moderator: row.moderated_by
        ? profilesMap.get(row.moderated_by) || {
            id: row.moderated_by,
            display_name: "Admin",
          }
        : null,
    }));
  },

  /**
   * Previews a quiz set's full questions, options, correct answers, and explanations for Admin inspection.
   */
  async getQuizPreviewForAdmin(quizSetId) {
    const { data: quizSet, error: quizError } = await supabase
      .from("quiz_sets")
      .select("*, documents(id, file_name, file_type, page_count)")
      .eq("id", quizSetId)
      .single();

    if (quizError) throw quizError;

    const { data: questions, error: qError } = await supabase.rpc(
      "rpc_get_quiz_editor_questions",
      {
        p_quiz_set_id: quizSetId,
      },
    );

    if (qError) throw qError;

    return {
      quizSet,
      questions: Array.isArray(questions) ? questions : [],
    };
  },

  /**
   * Approves, rejects, or removes a quiz set via the `moderate-quiz` Edge Function.
   * Actions: 'approve' | 'reject' | 'remove'
   */
  async moderateQuiz({ quizSetId, action, reason }) {
    return await invokeEdgeFunction("moderate-quiz", {
      quiz_set_id: quizSetId,
      action,
      reason,
    });
  },

  /**
   * Lists all user profiles for Admin management.
   */
  async listUsers({ search = "", role = "all" } = {}) {
    let query = supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (role && role !== "all") {
      query = query.eq("role", role);
    }

    if (search && search.trim()) {
      query = query.ilike("display_name", `%${search.trim()}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Updates a user's role ('user' | 'admin'). Protected by Admin RLS and DB Trigger.
   */
  async updateUserRole(userId, newRole) {
    if (!["user", "admin"].includes(newRole)) {
      throw new Error("Vai trò không hợp lệ. Chỉ chấp nhận 'user' hoặc 'admin'.");
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({ role: newRole })
      .eq("id", userId)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  },
};

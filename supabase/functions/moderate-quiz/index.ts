// ============================================================================
// EDGE FUNCTION 7: moderate-quiz
// Endpoint: POST /functions/v1/moderate-quiz
// Request:
// {
//   "quiz_set_id": "UUID",
//   "action": "approve" | "reject" | "remove",
//   "reason": "Nội dung hợp lệ"
// }
// Rules (Section 3.1 & 7.7):
//   - Strictly requires Admin role (verified server-side via profiles.role === 'admin').
//   - Records moderated_by, moderated_at, moderation_note, moderation_status.
//   - Sets published_at when approved; clears published_at when removed/rejected.
// ============================================================================

import { handleCorsPreflight } from "../_shared/cors.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/response.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { requireUuid } from "../_shared/validation.ts";

type ModerationAction = "approve" | "reject" | "remove" | "hard_delete";

const ACTION_TO_STATUS: Record<
  Exclude<ModerationAction, "hard_delete">,
  "approved" | "rejected" | "removed"
> = {
  approve: "approved",
  reject: "rejected",
  remove: "removed",
};

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
    const { user, adminClient } = await requireAdmin(req);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new AppError("Request body phải là JSON hợp lệ.", 400, "INVALID_JSON_BODY");
    }

    const payload = body as Record<string, unknown>;
    const quizSetId = requireUuid(payload.quiz_set_id, "quiz_set_id");

    const rawAction =
      typeof payload.action === "string"
        ? payload.action.toLowerCase().trim()
        : "";
    if (!["approve", "reject", "remove", "hard_delete"].includes(rawAction)) {
      throw new AppError(
        "Hành động kiểm duyệt (action) phải là 'approve', 'reject', 'remove' hoặc 'hard_delete'.",
        400,
        "INVALID_MODERATION_ACTION",
      );
    }

    const action = rawAction as ModerationAction;
    const reason =
      typeof payload.reason === "string" && payload.reason.trim().length > 0
        ? payload.reason.trim()
        : action === "approve"
        ? "Nội dung hợp lệ, đã được phê duyệt."
        : null;

    if ((action === "reject" || action === "remove") && !reason) {
      throw new AppError(
        "Vui lòng nhập lý do khi từ chối (reject) hoặc gỡ (remove) bộ đề.",
        400,
        "MODERATION_REASON_REQUIRED",
      );
    }

    // 1. Verify quiz_set exists
    const { data: existingQuiz, error: fetchError } = await adminClient
      .from("quiz_sets")
      .select("id, title, visibility, moderation_status, deleted_at")
      .eq("id", quizSetId)
      .maybeSingle();

    if (fetchError || !existingQuiz) {
      throw new AppError("Không tìm thấy bộ đề.", 404, "QUIZ_SET_NOT_FOUND");
    }

    if (action === "hard_delete") {
      // Permanently delete all dependent records & the quiz_set to free database storage
      const [{ data: attemptRows }, { data: questionRows }] = await Promise.all([
        adminClient.from("attempts").select("id").eq("quiz_set_id", quizSetId),
        adminClient.from("questions").select("id").eq("quiz_set_id", quizSetId),
      ]);

      const attemptIds = (attemptRows || []).map((r: { id: string }) => r.id);
      const questionIds = (questionRows || []).map((r: { id: string }) => r.id);

      if (attemptIds.length > 0) {
        const { data: aqRows } = await adminClient
          .from("attempt_questions")
          .select("id")
          .in("attempt_id", attemptIds);
        const aqIds = (aqRows || []).map((r: { id: string }) => r.id);

        await adminClient.from("attempt_responses").delete().in("attempt_id", attemptIds);
        if (aqIds.length > 0) {
          await adminClient.from("attempt_answer_keys").delete().in("attempt_question_id", aqIds);
        }
        await adminClient.from("attempt_questions").delete().in("attempt_id", attemptIds);
        await adminClient.from("attempts").delete().in("id", attemptIds);
      }

      if (questionIds.length > 0) {
        await adminClient.from("question_answers").delete().in("question_id", questionIds);
        await adminClient.from("question_options").delete().in("question_id", questionIds);
        await adminClient.from("questions").delete().in("id", questionIds);
      }

      await adminClient.from("quiz_reviews").delete().eq("quiz_set_id", quizSetId);
      const { error: deleteErr } = await adminClient
        .from("quiz_sets")
        .delete()
        .eq("id", quizSetId);

      if (deleteErr) {
        throw new AppError(
          `Không thể xóa vĩnh viễn bộ đề: ${deleteErr.message}`,
          500,
          "HARD_DELETE_FAILED",
        );
      }

      return jsonResponse(
        {
          success: true,
          action: "hard_delete",
          deleted_quiz_set_id: quizSetId,
          deleted_questions: questionIds.length,
          deleted_attempts: attemptIds.length,
        },
        200,
        req,
      );
    }

    if (existingQuiz.deleted_at !== null) {
      throw new AppError(
        "Bộ đề này đã bị xóa mềm, không thể thực hiện kiểm duyệt.",
        400,
        "QUIZ_SET_DELETED",
      );
    }

    const targetStatus = ACTION_TO_STATUS[action];
    const nowIso = new Date().toISOString();

    const updatePayload: Record<string, unknown> = {
      moderation_status: targetStatus,
      moderation_note: reason,
      moderated_by: user.id,
      moderated_at: nowIso,
      updated_at: nowIso,
    };

    if (action === "approve") {
      updatePayload.visibility = "public";
      updatePayload.published_at = nowIso;
    } else if (action === "remove") {
      updatePayload.published_at = null;
    } else if (action === "reject") {
      updatePayload.published_at = null;
    }

    const { data: updatedQuiz, error: updateError } = await adminClient
      .from("quiz_sets")
      .update(updatePayload)
      .eq("id", quizSetId)
      .select("*")
      .single();

    if (updateError || !updatedQuiz) {
      throw new AppError(
        `Không thể cập nhật trạng thái kiểm duyệt: ${updateError?.message || "Unknown error"}`,
        500,
        "MODERATION_UPDATE_FAILED",
      );
    }

    return jsonResponse(
      {
        success: true,
        action,
        quiz_set: updatedQuiz,
      },
      200,
      req,
    );
  } catch (err) {
    return errorResponse(err, req);
  }
});

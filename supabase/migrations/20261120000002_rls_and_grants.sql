-- ============================================================================
-- MIGRATION 02: ROW LEVEL SECURITY (RLS) & SQL GRANTS
-- Project: AI Quiz Studio
-- Security Design:
--   1. Drop all legacy/existing policies on the 11 tables so no overly-broad
--      policy from the initial 4-table setup remains active.
--   2. Enable RLS on all 11 tables.
--   3. Configure strict SQL GRANT / REVOKE rules (defense-in-depth):
--      - Completely revoke SELECT/INSERT/UPDATE/DELETE on question_answers
--        and attempt_answer_keys from PUBLIC, anon, and authenticated.
--      - Revoke direct INSERT/UPDATE/DELETE on attempts, attempt_questions,
--        and attempt_responses from anon and authenticated (mutations only
--        via Edge Functions).
--   4. Create least-privilege RLS policies for every table.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: DROP ANY EXISTING / LEGACY POLICIES ON ALL 11 TABLES
-- ============================================================================
DO $$
DECLARE
  v_pol RECORD;
BEGIN
  FOR v_pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles',
        'documents',
        'quiz_sets',
        'questions',
        'question_options',
        'question_answers',
        'attempts',
        'attempt_questions',
        'attempt_answer_keys',
        'attempt_responses',
        'quiz_reviews'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_pol.policyname, v_pol.tablename);
  END LOOP;
END $$;

-- ============================================================================
-- STEP 2: ENABLE ROW LEVEL SECURITY ON ALL 11 TABLES
-- ============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_reviews ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 3: STRICT SQL GRANTS & REVOKES (LAYER 1 DEFENSE)
-- ============================================================================

-- 3.1 Server-only answer key tables: ZERO access for anon and authenticated
REVOKE ALL ON TABLE public.question_answers FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.question_answers TO service_role;

REVOKE ALL ON TABLE public.attempt_answer_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.attempt_answer_keys TO service_role;

-- 3.2 Attempt tables: read-only for authenticated owners; mutations via Edge Functions only
REVOKE ALL ON TABLE public.attempts FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.attempts FROM authenticated;
GRANT SELECT ON TABLE public.attempts TO authenticated;
GRANT ALL ON TABLE public.attempts TO service_role;

REVOKE ALL ON TABLE public.attempt_questions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.attempt_questions FROM authenticated;
GRANT SELECT ON TABLE public.attempt_questions TO authenticated;
GRANT ALL ON TABLE public.attempt_questions TO service_role;

REVOKE ALL ON TABLE public.attempt_responses FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.attempt_responses FROM authenticated;
GRANT SELECT ON TABLE public.attempt_responses TO authenticated;
GRANT ALL ON TABLE public.attempt_responses TO service_role;

-- 3.3 Standard application tables
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

REVOKE ALL ON TABLE public.documents FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.documents TO authenticated;
GRANT ALL ON TABLE public.documents TO service_role;

GRANT SELECT ON TABLE public.quiz_sets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz_sets TO authenticated;
GRANT ALL ON TABLE public.quiz_sets TO service_role;

-- Explanations live strictly in server-only question_answers.explanation;
-- questions table holds public prompt metadata and supports PostgREST count(*) queries.
GRANT SELECT ON TABLE public.questions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.questions TO authenticated;
GRANT ALL ON TABLE public.questions TO service_role;

GRANT SELECT ON TABLE public.question_options TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.question_options TO authenticated;
GRANT ALL ON TABLE public.question_options TO service_role;

GRANT SELECT ON TABLE public.quiz_reviews TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quiz_reviews TO authenticated;
GRANT ALL ON TABLE public.quiz_reviews TO service_role;

-- 3.4 Function Execution Grants
REVOKE EXECUTE ON FUNCTION public.rpc_create_quiz_with_questions(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_quiz_with_questions(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_start_attempt(UUID, UUID, TEXT, INTEGER, INTEGER, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_start_attempt(UUID, UUID, TEXT, INTEGER, INTEGER, BOOLEAN, BOOLEAN) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_attempt(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_submit_attempt(UUID, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_owner_upsert_quiz_questions(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_owner_upsert_quiz_questions(UUID, JSONB) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_get_quiz_editor_questions(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_quiz_editor_questions(UUID) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.rpc_get_public_creator_profiles(UUID[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- ============================================================================
-- STEP 4: RLS POLICIES FOR ALL 11 TABLES (LAYER 2 DEFENSE)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 4.1 PROFILES
-- - User can only view their own profile.
-- - User can update their own display_name and avatar_url, NOT role.
-- - Admin has full management access.
-- ----------------------------------------------------------------------------
CREATE POLICY profiles_select_own_or_admin
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_admin());

CREATE POLICY profiles_insert_own
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid() AND role = 'user');

CREATE POLICY profiles_update_own_or_admin
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (
    (id = auth.uid() AND role = 'user')
    OR public.is_admin()
  );

-- ----------------------------------------------------------------------------
-- 4.2 DOCUMENTS
-- - Only owner and Admin can read documents.
-- - Owner can upload, update, and delete their own documents.
-- - Original document is never made public even if a derived quiz_set is public.
-- ----------------------------------------------------------------------------
CREATE POLICY documents_select_owner_or_admin
  ON public.documents
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY documents_insert_owner
  ON public.documents
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND visibility = 'private');

CREATE POLICY documents_update_owner_or_admin
  ON public.documents
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (
    (user_id = auth.uid() AND visibility = 'private')
    OR public.is_admin()
  );

CREATE POLICY documents_delete_owner_or_admin
  ON public.documents
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- ----------------------------------------------------------------------------
-- 4.3 QUIZ_SETS
-- - Anonymous & authenticated users can view public + approved + non-deleted quiz sets.
-- - Owner can view and manage their own quiz sets.
-- - Admin can view and manage all quiz sets.
-- - User cannot self-approve or tamper with moderation fields (also enforced by trigger).
-- ----------------------------------------------------------------------------
CREATE POLICY quiz_sets_select_public_approved
  ON public.quiz_sets
  FOR SELECT
  TO anon, authenticated
  USING (
    visibility = 'public'
    AND moderation_status = 'approved'
    AND deleted_at IS NULL
  );

CREATE POLICY quiz_sets_select_owner_or_admin
  ON public.quiz_sets
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  );

CREATE POLICY quiz_sets_insert_owner
  ON public.quiz_sets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      (visibility = 'private' AND moderation_status = 'not_submitted')
      OR (visibility = 'public' AND moderation_status = 'pending')
    )
  );

CREATE POLICY quiz_sets_update_owner
  ON public.quiz_sets
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (
    user_id = auth.uid()
    AND (
      deleted_at IS NOT NULL
      OR moderation_status IN ('not_submitted', 'pending', 'rejected')
    )
  );

CREATE POLICY quiz_sets_update_admin
  ON public.quiz_sets
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY quiz_sets_delete_admin
  ON public.quiz_sets
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 4.4 QUESTIONS
-- - Legacy questions.visibility and questions.review_status are NOT used for access control.
-- - Access is determined strictly by parent quiz_sets (public + approved + not deleted),
--   or ownership, or admin role.
-- ----------------------------------------------------------------------------
CREATE POLICY questions_select_accessible
  ON public.questions
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.quiz_sets qs
      WHERE qs.id = questions.quiz_set_id
        AND qs.deleted_at IS NULL
        AND (
          (qs.visibility = 'public' AND qs.moderation_status = 'approved')
          OR qs.user_id = auth.uid()
          OR public.is_admin()
        )
    )
  );

CREATE POLICY questions_insert_owner
  ON public.questions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.quiz_sets qs
      WHERE qs.id = questions.quiz_set_id
        AND qs.user_id = auth.uid()
        AND qs.deleted_at IS NULL
    )
  );

CREATE POLICY questions_update_owner_or_admin
  ON public.questions
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE POLICY questions_delete_owner_or_admin
  ON public.questions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- ----------------------------------------------------------------------------
-- 4.5 QUESTION_OPTIONS
-- - Accessible only if the parent question's quiz_set is public+approved, owned by user, or admin.
-- ----------------------------------------------------------------------------
CREATE POLICY question_options_select_accessible
  ON public.question_options
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.questions q
      JOIN public.quiz_sets qs ON qs.id = q.quiz_set_id
      WHERE q.id = question_options.question_id
        AND qs.deleted_at IS NULL
        AND (
          (qs.visibility = 'public' AND qs.moderation_status = 'approved')
          OR qs.user_id = auth.uid()
          OR public.is_admin()
        )
    )
  );

CREATE POLICY question_options_insert_owner
  ON public.question_options
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.questions q
      JOIN public.quiz_sets qs ON qs.id = q.quiz_set_id
      WHERE q.id = question_options.question_id
        AND qs.user_id = auth.uid()
        AND qs.deleted_at IS NULL
    )
  );

CREATE POLICY question_options_update_owner_or_admin
  ON public.question_options
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.questions q
      WHERE q.id = question_options.question_id
        AND (q.user_id = auth.uid() OR public.is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.questions q
      WHERE q.id = question_options.question_id
        AND (q.user_id = auth.uid() OR public.is_admin())
    )
  );

CREATE POLICY question_options_delete_owner_or_admin
  ON public.question_options
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.questions q
      WHERE q.id = question_options.question_id
        AND (q.user_id = auth.uid() OR public.is_admin())
    )
  );

-- ----------------------------------------------------------------------------
-- 4.6 QUESTION_ANSWERS (SERVER ONLY)
-- - No policies created for anon or authenticated.
-- - SQL GRANTs also revoked above. Only service_role can read/write.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 4.7 ATTEMPTS
-- - User can only view their own attempts (or Admin).
-- - No direct client INSERT/UPDATE/DELETE policies.
-- ----------------------------------------------------------------------------
CREATE POLICY attempts_select_own_or_admin
  ON public.attempts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- ----------------------------------------------------------------------------
-- 4.8 ATTEMPT_QUESTIONS
-- - User can only view snapshot questions belonging to their own attempts.
-- ----------------------------------------------------------------------------
CREATE POLICY attempt_questions_select_own_or_admin
  ON public.attempt_questions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.attempts a
      WHERE a.id = attempt_questions.attempt_id
        AND (a.user_id = auth.uid() OR public.is_admin())
    )
  );

-- ----------------------------------------------------------------------------
-- 4.9 ATTEMPT_ANSWER_KEYS (SERVER ONLY)
-- - No policies created for anon or authenticated.
-- - SQL GRANTs also revoked above. Only service_role can read/write.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 4.10 ATTEMPT_RESPONSES
-- - User can only view their own responses.
-- - Saving answers is performed exclusively via the answer-question Edge Function.
-- ----------------------------------------------------------------------------
CREATE POLICY attempt_responses_select_own_or_admin
  ON public.attempt_responses
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.attempts a
      WHERE a.id = attempt_responses.attempt_id
        AND (a.user_id = auth.uid() OR public.is_admin())
    )
  );

-- ----------------------------------------------------------------------------
-- 4.11 QUIZ_REVIEWS
-- - Anyone can read reviews on approved public quiz sets (or owner/admin).
-- - Authenticated users can create 1 review per approved public quiz set.
-- - Users can only update/delete their own review (Admin can also delete).
-- ----------------------------------------------------------------------------
CREATE POLICY quiz_reviews_select_accessible
  ON public.quiz_reviews
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.quiz_sets qs
      WHERE qs.id = quiz_reviews.quiz_set_id
        AND qs.deleted_at IS NULL
        AND (
          (qs.visibility = 'public' AND qs.moderation_status = 'approved')
          OR qs.user_id = auth.uid()
          OR public.is_admin()
        )
    )
  );

CREATE POLICY quiz_reviews_insert_authenticated
  ON public.quiz_reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.quiz_sets qs
      WHERE qs.id = quiz_reviews.quiz_set_id
        AND qs.visibility = 'public'
        AND qs.moderation_status = 'approved'
        AND qs.deleted_at IS NULL
    )
  );

CREATE POLICY quiz_reviews_update_own
  ON public.quiz_reviews
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY quiz_reviews_delete_own_or_admin
  ON public.quiz_reviews
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

COMMIT;

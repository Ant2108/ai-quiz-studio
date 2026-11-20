-- ============================================================================
-- MIGRATION 01: SCHEMA UPGRADE & TARGET 11-TABLE ARCHITECTURE
-- Project: AI Quiz Studio
-- Rules:
--   1. DO NOT DROP existing tables (documents, questions, question_options, question_answers).
--   2. Upgrade existing tables via explicit ALTER TABLE statements.
--   3. Create new tables (profiles, quiz_sets, attempts, attempt_questions,
--      attempt_answer_keys, attempt_responses, quiz_reviews).
--   4. Add strict Foreign Keys, Composite Keys, CHECK constraints, Indexes,
--      Triggers, and ACID Transactional RPC functions.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- STEP 0: SAFE BOOTSTRAP FOR FRESH LOCAL ENVIRONMENTS ONLY
-- On production Supabase, these 4 tables already exist and are untouched here.
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.documents') IS NULL THEN
    CREATE TABLE public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      status TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      visibility TEXT NOT NULL DEFAULT 'private',
      CONSTRAINT documents_visibility_check CHECK (visibility IN ('private', 'public'))
    );
  END IF;

  IF to_regclass('public.questions') IS NULL THEN
    CREATE TABLE public.questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      document_id UUID NULL REFERENCES public.documents(id) ON DELETE NO ACTION,
      question_text TEXT NOT NULL,
      question_type TEXT,
      explanation TEXT,
      formula_latex TEXT,
      image_path TEXT,
      source_page INTEGER,
      difficulty TEXT,
      review_status TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      visibility TEXT NOT NULL DEFAULT 'private',
      CONSTRAINT questions_visibility_check CHECK (visibility IN ('private', 'public'))
    );
  END IF;

  IF to_regclass('public.question_options') IS NULL THEN
    CREATE TABLE public.question_options (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
      option_label TEXT NOT NULL,
      option_content TEXT NOT NULL,
      image_path TEXT
    );
  END IF;

  IF to_regclass('public.question_answers') IS NULL THEN
    CREATE TABLE public.question_answers (
      question_id UUID PRIMARY KEY REFERENCES public.questions(id) ON DELETE CASCADE,
      correct_option_id UUID NULL,
      correct_text TEXT,
      explanation TEXT
    );
  END IF;
END $$;

-- ============================================================================
-- STEP 1: TABLE 1 — profiles
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT profiles_role_check CHECK (role IN ('user', 'admin'))
);

-- Backfill profiles for any existing auth.users
INSERT INTO public.profiles (id, display_name, avatar_url, role)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'display_name', u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  u.raw_user_meta_data->>'avatar_url',
  'user'
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- STEP 2: TABLE 2 — UPGRADE documents (via ALTER TABLE)
-- ============================================================================
ALTER TABLE public.documents
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN visibility SET DEFAULT 'private',
  ALTER COLUMN status SET DEFAULT 'uploaded';

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size BIGINT,
  ADD COLUMN IF NOT EXISTS page_count INTEGER,
  ADD COLUMN IF NOT EXISTS extracted_text TEXT,
  ADD COLUMN IF NOT EXISTS ai_summary JSONB,
  ADD COLUMN IF NOT EXISTS processing_error TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_user_id_fkey' AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_status_check' AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_status_check
      CHECK (status IS NULL OR status IN ('uploaded', 'processing', 'processed', 'completed', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_file_size_check' AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_file_size_check
      CHECK (file_size IS NULL OR file_size > 0);
  END IF;
END $$;

-- ============================================================================
-- STEP 3: TABLE 3 — quiz_sets
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.quiz_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NULL REFERENCES public.documents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  subject TEXT,
  topic TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  visibility TEXT NOT NULL DEFAULT 'private',
  moderation_status TEXT NOT NULL DEFAULT 'not_submitted',
  moderation_note TEXT,
  moderated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  moderated_at TIMESTAMPTZ NULL,
  default_exam_questions INTEGER NOT NULL DEFAULT 60,
  default_exam_duration INTEGER NOT NULL DEFAULT 60,
  published_at TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quiz_sets_title_not_empty CHECK (char_length(trim(title)) > 0),
  CONSTRAINT quiz_sets_difficulty_check CHECK (difficulty IN ('easy', 'medium', 'hard')),
  CONSTRAINT quiz_sets_visibility_check CHECK (visibility IN ('private', 'public')),
  CONSTRAINT quiz_sets_moderation_status_check CHECK (
    moderation_status IN ('not_submitted', 'pending', 'approved', 'rejected', 'removed')
  ),
  CONSTRAINT quiz_sets_default_exam_questions_check CHECK (default_exam_questions > 0),
  CONSTRAINT quiz_sets_default_exam_duration_check CHECK (default_exam_duration > 0)
);

-- ============================================================================
-- STEP 4: TABLE 4 — UPGRADE questions (via ALTER TABLE)
-- ============================================================================
ALTER TABLE public.questions
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN visibility SET DEFAULT 'private',
  ALTER COLUMN question_type SET DEFAULT 'multiple_choice',
  ALTER COLUMN difficulty SET DEFAULT 'medium';

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS quiz_set_id UUID NULL,
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Replace old ON DELETE NO ACTION FK on questions.document_id with ON DELETE SET NULL
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  FOR v_conname IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
    WHERE c.conrelid = 'public.questions'::regclass
      AND c.contype = 'f'
      AND a.attname = 'document_id'
  LOOP
    EXECUTE format('ALTER TABLE public.questions DROP CONSTRAINT %I', v_conname);
  END LOOP;

  ALTER TABLE public.questions
    ADD CONSTRAINT questions_document_id_fkey
    FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'questions_quiz_set_id_fkey' AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_quiz_set_id_fkey
      FOREIGN KEY (quiz_set_id) REFERENCES public.quiz_sets(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'questions_user_id_fkey' AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'questions_question_type_check' AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_question_type_check
      CHECK (question_type IS NULL OR question_type IN ('multiple_choice', 'true_false'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'questions_difficulty_check' AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_difficulty_check
      CHECK (difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard'));
  END IF;
END $$;

-- ============================================================================
-- STEP 5: TABLE 5 — UPGRADE question_options (via ALTER TABLE)
-- ============================================================================
ALTER TABLE public.question_options
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.question_options
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  -- Composite unique constraint (id, question_id) required so question_answers
  -- can enforce that correct_option_id belongs to the exact same question_id.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_question_options_id_question_id'
      AND conrelid = 'public.question_options'::regclass
  ) THEN
    ALTER TABLE public.question_options
      ADD CONSTRAINT uq_question_options_id_question_id UNIQUE (id, question_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_question_options_question_label'
      AND conrelid = 'public.question_options'::regclass
  ) THEN
    ALTER TABLE public.question_options
      ADD CONSTRAINT uq_question_options_question_label UNIQUE (question_id, option_label);
  END IF;
END $$;

-- ============================================================================
-- STEP 6: TABLE 6 — UPGRADE question_answers (via ALTER TABLE)
-- ============================================================================
ALTER TABLE public.question_answers
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  -- Ensure correct_option_id belongs to the exact same question_id
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_question_answers_correct_option_same_question'
      AND conrelid = 'public.question_answers'::regclass
  ) THEN
    ALTER TABLE public.question_answers
      ADD CONSTRAINT fk_question_answers_correct_option_same_question
      FOREIGN KEY (correct_option_id, question_id)
      REFERENCES public.question_options(id, question_id)
      ON DELETE RESTRICT
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- ============================================================================
-- STEP 7: TABLE 7 — attempts
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quiz_set_id UUID NOT NULL REFERENCES public.quiz_sets(id) ON DELETE RESTRICT,
  attempt_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  total_questions INTEGER NOT NULL,
  answered_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  score NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  time_limit_seconds INTEGER NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  shuffle_questions BOOLEAN NOT NULL DEFAULT false,
  shuffle_options BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attempts_attempt_type_check CHECK (attempt_type IN ('study', 'practice', 'exam')),
  CONSTRAINT attempts_status_check CHECK (status IN ('in_progress', 'submitted', 'expired')),
  CONSTRAINT attempts_total_questions_check CHECK (total_questions > 0),
  CONSTRAINT attempts_answered_count_check CHECK (answered_count >= 0 AND answered_count <= total_questions),
  CONSTRAINT attempts_correct_count_check CHECK (correct_count >= 0 AND correct_count <= total_questions),
  CONSTRAINT attempts_score_check CHECK (score >= 0 AND score <= 10),
  CONSTRAINT attempts_time_limit_check CHECK (time_limit_seconds IS NULL OR time_limit_seconds > 0),
  CONSTRAINT attempts_duration_check CHECK (duration_seconds >= 0)
);

-- ============================================================================
-- STEP 8: TABLE 8 — attempt_questions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.attempt_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  question_id UUID NULL REFERENCES public.questions(id) ON DELETE SET NULL,
  position INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'multiple_choice',
  explanation_snapshot TEXT,
  formula_latex_snapshot TEXT,
  image_path_snapshot TEXT,
  options_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT attempt_questions_position_check CHECK (position > 0),
  CONSTRAINT uq_attempt_questions_attempt_position UNIQUE (attempt_id, position),
  CONSTRAINT uq_attempt_questions_id_attempt_id UNIQUE (id, attempt_id)
);

-- ============================================================================
-- STEP 9: TABLE 9 — attempt_answer_keys (SERVER ONLY)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.attempt_answer_keys (
  attempt_question_id UUID PRIMARY KEY REFERENCES public.attempt_questions(id) ON DELETE CASCADE,
  correct_option_id UUID NULL,
  correct_text TEXT,
  explanation TEXT
);

-- ============================================================================
-- STEP 10: TABLE 10 — attempt_responses
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.attempt_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  attempt_question_id UUID NOT NULL,
  selected_option_id UUID NULL,
  answer_text TEXT NULL,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_attempt_responses_attempt_question UNIQUE (attempt_id, attempt_question_id),
  CONSTRAINT fk_attempt_responses_question_same_attempt
    FOREIGN KEY (attempt_question_id, attempt_id)
    REFERENCES public.attempt_questions(id, attempt_id)
    ON DELETE CASCADE
);

-- ============================================================================
-- STEP 11: TABLE 11 — quiz_reviews
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.quiz_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_set_id UUID NOT NULL REFERENCES public.quiz_sets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quiz_reviews_rating_check CHECK (rating >= 1 AND rating <= 5),
  CONSTRAINT uq_quiz_reviews_quiz_user UNIQUE (quiz_set_id, user_id)
);

-- ============================================================================
-- STEP 12: PERFORMANCE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON public.documents(status);

CREATE INDEX IF NOT EXISTS idx_quiz_sets_user_id ON public.quiz_sets(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_sets_document_id ON public.quiz_sets(document_id);
CREATE INDEX IF NOT EXISTS idx_quiz_sets_explore
  ON public.quiz_sets(visibility, moderation_status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quiz_sets_subject_difficulty
  ON public.quiz_sets(subject, difficulty)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_questions_quiz_set_id ON public.questions(quiz_set_id, position);
CREATE INDEX IF NOT EXISTS idx_questions_document_id ON public.questions(document_id);
CREATE INDEX IF NOT EXISTS idx_questions_user_id ON public.questions(user_id);

CREATE INDEX IF NOT EXISTS idx_question_options_question_id ON public.question_options(question_id, position);

CREATE INDEX IF NOT EXISTS idx_attempts_user_id_created ON public.attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_quiz_set_id ON public.attempts(quiz_set_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON public.attempts(status);

CREATE INDEX IF NOT EXISTS idx_attempt_questions_attempt_id ON public.attempt_questions(attempt_id, position);
CREATE INDEX IF NOT EXISTS idx_attempt_responses_attempt_id ON public.attempt_responses(attempt_id);
CREATE INDEX IF NOT EXISTS idx_quiz_reviews_quiz_set_id ON public.quiz_reviews(quiz_set_id, created_at DESC);

-- ============================================================================
-- STEP 13: HELPER FUNCTIONS & BUSINESS RULE TRIGGERS
-- ============================================================================

-- 13.1 Generic updated_at timestamp trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_documents_updated_at ON public.documents;
CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_quiz_sets_updated_at ON public.quiz_sets;
CREATE TRIGGER trg_quiz_sets_updated_at
  BEFORE UPDATE ON public.quiz_sets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_questions_updated_at ON public.questions;
CREATE TRIGGER trg_questions_updated_at
  BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_question_answers_updated_at ON public.question_answers;
CREATE TRIGGER trg_question_answers_updated_at
  BEFORE UPDATE ON public.question_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_quiz_reviews_updated_at ON public.quiz_reviews;
CREATE TRIGGER trg_quiz_reviews_updated_at
  BEFORE UPDATE ON public.quiz_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 13.2 Check if current user is admin (SECURITY DEFINER to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

-- 13.3 Auto-create profile when a new user signs up in auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url, role)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url',
    'user'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 13.4 Prevent non-admin users from escalating their own role
CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  -- Service role or superuser/postgres can manage roles freely
  IF v_jwt_role = 'service_role' OR current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.role := 'user';
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Forbidden: Users are not allowed to change their role.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_fields
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields();

-- 13.5 Enforce quiz_sets moderation & visibility business rules (Rule 3.1: both_admin)
CREATE OR REPLACE FUNCTION public.enforce_quiz_set_moderation_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_is_privileged BOOLEAN;
BEGIN
  v_is_privileged := (v_jwt_role = 'service_role' OR current_user IN ('postgres', 'supabase_admin') OR public.is_admin());

  IF TG_OP = 'INSERT' THEN
    IF NOT v_is_privileged THEN
      NEW.moderated_by := NULL;
      NEW.moderated_at := NULL;
      NEW.moderation_note := NULL;
      NEW.published_at := NULL;
      IF NEW.visibility = 'public' THEN
        NEW.moderation_status := 'pending';
      ELSE
        NEW.visibility := 'private';
        NEW.moderation_status := 'not_submitted';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NOT v_is_privileged THEN
      -- Prevent non-admin from tampering with moderation metadata
      IF NEW.moderated_by IS DISTINCT FROM OLD.moderated_by
         OR NEW.moderated_at IS DISTINCT FROM OLD.moderated_at
         OR NEW.moderation_note IS DISTINCT FROM OLD.moderation_note THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can modify moderation metadata.';
      END IF;

      -- Prevent non-admin from setting moderation_status to approved/rejected/removed
      IF NEW.moderation_status IS DISTINCT FROM OLD.moderation_status
         AND NEW.moderation_status IN ('approved', 'rejected', 'removed') THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can approve, reject, or remove a quiz set.';
      END IF;

      -- When user switches visibility to public, or requests public submission -> force pending
      IF NEW.visibility = 'public' AND OLD.visibility = 'private' THEN
        NEW.moderation_status := 'pending';
      ELSIF NEW.visibility = 'private' AND OLD.visibility = 'public' THEN
        NEW.moderation_status := 'not_submitted';
        NEW.published_at := NULL;
      END IF;

      -- Rule 3.1 & Security #17: If an approved public quiz set has its content edited by the owner,
      -- automatically revert moderation_status to 'pending' so unreviewed edits are never shown publicly!
      IF OLD.visibility = 'public' AND OLD.moderation_status = 'approved' AND NEW.visibility = 'public' AND NEW.deleted_at IS NULL THEN
        IF NEW.title IS DISTINCT FROM OLD.title
           OR NEW.description IS DISTINCT FROM OLD.description
           OR NEW.subject IS DISTINCT FROM OLD.subject
           OR NEW.topic IS DISTINCT FROM OLD.topic
           OR NEW.difficulty IS DISTINCT FROM OLD.difficulty
           OR NEW.default_exam_questions IS DISTINCT FROM OLD.default_exam_questions
           OR NEW.default_exam_duration IS DISTINCT FROM OLD.default_exam_duration THEN
          NEW.moderation_status := 'pending';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_quiz_set_moderation_rules ON public.quiz_sets;
CREATE TRIGGER trg_enforce_quiz_set_moderation_rules
  BEFORE INSERT OR UPDATE ON public.quiz_sets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_quiz_set_moderation_rules();

-- 13.6 Automatically reset moderation_status to 'pending' when questions/options/answers
-- of an approved public quiz set are modified (Rule 3.1 & Security Requirement #17)
CREATE OR REPLACE FUNCTION public.invalidate_approved_quiz_on_child_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz_set_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'questions' THEN
    v_quiz_set_id := COALESCE(NEW.quiz_set_id, OLD.quiz_set_id);
  ELSIF TG_TABLE_NAME = 'question_options' THEN
    SELECT q.quiz_set_id INTO v_quiz_set_id
    FROM public.questions q
    WHERE q.id = COALESCE(NEW.question_id, OLD.question_id);
  ELSIF TG_TABLE_NAME = 'question_answers' THEN
    SELECT q.quiz_set_id INTO v_quiz_set_id
    FROM public.questions q
    WHERE q.id = COALESCE(NEW.question_id, OLD.question_id);
  END IF;

  IF v_quiz_set_id IS NOT NULL THEN
    UPDATE public.quiz_sets
    SET
      moderation_status = CASE
        WHEN visibility = 'public' AND moderation_status = 'approved' THEN 'pending'
        ELSE moderation_status
      END,
      updated_at = now()
    WHERE id = v_quiz_set_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_questions_invalidate_approval ON public.questions;
CREATE TRIGGER trg_questions_invalidate_approval
  AFTER INSERT OR UPDATE OR DELETE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_approved_quiz_on_child_change();

DROP TRIGGER IF EXISTS trg_question_options_invalidate_approval ON public.question_options;
CREATE TRIGGER trg_question_options_invalidate_approval
  AFTER INSERT OR UPDATE OR DELETE ON public.question_options
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_approved_quiz_on_child_change();

DROP TRIGGER IF EXISTS trg_question_answers_invalidate_approval ON public.question_answers;
CREATE TRIGGER trg_question_answers_invalidate_approval
  AFTER INSERT OR UPDATE OR DELETE ON public.question_answers
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_approved_quiz_on_child_change();

-- ============================================================================
-- STEP 14: ACID TRANSACTIONAL RPC FUNCTIONS FOR EDGE FUNCTIONS & OWNER EDITOR
-- ============================================================================

-- 14.1 Transactional creation of quiz_set + questions + options + answers (for generate-quiz)
-- Returns the created quiz_set and questions+options preview WITHOUT exposing answer keys.
CREATE OR REPLACE FUNCTION public.rpc_create_quiz_with_questions(
  p_user_id UUID,
  p_document_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_subject TEXT,
  p_topic TEXT,
  p_difficulty TEXT,
  p_default_exam_questions INTEGER,
  p_default_exam_duration INTEGER,
  p_questions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz_set_id UUID;
  v_q JSONB;
  v_opt JSONB;
  v_question_id UUID;
  v_option_id UUID;
  v_correct_option_id UUID;
  v_correct_label TEXT;
  v_q_idx INTEGER := 0;
  v_opt_idx INTEGER := 0;
  v_preview_questions JSONB := '[]'::jsonb;
  v_preview_options JSONB;
BEGIN
  IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) = 0 THEN
    RAISE EXCEPTION 'Invalid questions payload: must be a non-empty JSON array.';
  END IF;

  INSERT INTO public.quiz_sets (
    user_id,
    document_id,
    title,
    description,
    subject,
    topic,
    difficulty,
    visibility,
    moderation_status,
    default_exam_questions,
    default_exam_duration
  )
  VALUES (
    p_user_id,
    p_document_id,
    trim(p_title),
    p_description,
    p_subject,
    p_topic,
    COALESCE(p_difficulty, 'medium'),
    'private',
    'not_submitted',
    GREATEST(1, COALESCE(p_default_exam_questions, LEAST(60, jsonb_array_length(p_questions)))),
    GREATEST(1, COALESCE(p_default_exam_duration, 60))
  )
  RETURNING id INTO v_quiz_set_id;

  FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    v_q_idx := v_q_idx + 1;
    v_correct_option_id := NULL;
    v_correct_label := upper(trim(COALESCE(v_q->>'correct_option_label', '')));
    v_preview_options := '[]'::jsonb;

    INSERT INTO public.questions (
      user_id,
      document_id,
      quiz_set_id,
      position,
      question_text,
      question_type,
      explanation,
      formula_latex,
      image_path,
      source_page,
      difficulty,
      review_status,
      visibility
    )
    VALUES (
      p_user_id,
      p_document_id,
      v_quiz_set_id,
      v_q_idx,
      trim(v_q->>'question_text'),
      COALESCE(v_q->>'question_type', 'multiple_choice'),
      NULL, -- Explanation stored strictly in server-only question_answers.explanation
      v_q->>'formula_latex',
      v_q->>'image_path',
      NULLIF(v_q->>'source_page', '')::INTEGER,
      COALESCE(v_q->>'difficulty', COALESCE(p_difficulty, 'medium')),
      'draft',
      'private'
    )
    RETURNING id INTO v_question_id;

    v_opt_idx := 0;
    FOR v_opt IN SELECT * FROM jsonb_array_elements(v_q->'options')
    LOOP
      v_opt_idx := v_opt_idx + 1;

      INSERT INTO public.question_options (
        question_id,
        position,
        option_label,
        option_content,
        image_path
      )
      VALUES (
        v_question_id,
        v_opt_idx,
        upper(trim(v_opt->>'option_label')),
        trim(v_opt->>'option_content'),
        v_opt->>'image_path'
      )
      RETURNING id INTO v_option_id;

      IF upper(trim(v_opt->>'option_label')) = v_correct_label THEN
        v_correct_option_id := v_option_id;
      END IF;

      v_preview_options := v_preview_options || jsonb_build_array(
        jsonb_build_object(
          'id', v_option_id,
          'question_id', v_question_id,
          'position', v_opt_idx,
          'option_label', upper(trim(v_opt->>'option_label')),
          'option_content', trim(v_opt->>'option_content'),
          'image_path', v_opt->>'image_path'
        )
      );
    END LOOP;

    IF v_correct_option_id IS NULL THEN
      RAISE EXCEPTION 'Question #% ("%") does not have a valid matching correct_option_label (%). Transaction rolled back.',
        v_q_idx, left(v_q->>'question_text', 50), v_correct_label;
    END IF;

    INSERT INTO public.question_answers (
      question_id,
      correct_option_id,
      correct_text,
      explanation
    )
    VALUES (
      v_question_id,
      v_correct_option_id,
      v_q->>'correct_text',
      v_q->>'explanation'
    );

    v_preview_questions := v_preview_questions || jsonb_build_array(
      jsonb_build_object(
        'id', v_question_id,
        'quiz_set_id', v_quiz_set_id,
        'position', v_q_idx,
        'question_text', trim(v_q->>'question_text'),
        'question_type', COALESCE(v_q->>'question_type', 'multiple_choice'),
        'formula_latex', v_q->>'formula_latex',
        'image_path', v_q->>'image_path',
        'source_page', NULLIF(v_q->>'source_page', '')::INTEGER,
        'difficulty', COALESCE(v_q->>'difficulty', COALESCE(p_difficulty, 'medium')),
        'options', v_preview_options
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'quiz_set_id', v_quiz_set_id,
    'question_count', v_q_idx,
    'questions', v_preview_questions
  );
END;
$$;

-- 14.2 Transactional Start Attempt with Question, Option & Answer Key Snapshotting
CREATE OR REPLACE FUNCTION public.rpc_start_attempt(
  p_user_id UUID,
  p_quiz_set_id UUID,
  p_attempt_type TEXT,
  p_question_count INTEGER,
  p_time_limit_seconds INTEGER,
  p_shuffle_questions BOOLEAN,
  p_shuffle_options BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz RECORD;
  v_available_count INTEGER;
  v_final_count INTEGER;
  v_final_time_limit INTEGER;
  v_attempt_id UUID;
  v_started_at TIMESTAMPTZ := now();
  v_q RECORD;
  v_pos INTEGER := 0;
  v_attempt_question_id UUID;
  v_options_snapshot JSONB;
  v_questions_payload JSONB := '[]'::jsonb;
BEGIN
  -- 1. Fetch & verify quiz_set access
  SELECT * INTO v_quiz
  FROM public.quiz_sets
  WHERE id = p_quiz_set_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quiz set not found or has been deleted.';
  END IF;

  -- Verify access: owner, admin, or public+approved
  IF v_quiz.user_id <> p_user_id THEN
    IF NOT (v_quiz.visibility = 'public' AND v_quiz.moderation_status = 'approved') THEN
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to access this quiz set.';
      END IF;
    END IF;
  END IF;

  -- 2. Count valid questions in quiz_set that have answer keys
  SELECT COUNT(*) INTO v_available_count
  FROM public.questions q
  JOIN public.question_answers qa ON qa.question_id = q.id
  WHERE q.quiz_set_id = p_quiz_set_id;

  IF v_available_count = 0 THEN
    RAISE EXCEPTION 'This quiz set contains no valid questions with answer keys.';
  END IF;

  IF p_question_count IS NULL OR p_question_count <= 0 THEN
    IF p_attempt_type = 'exam' THEN
      v_final_count := LEAST(COALESCE(v_quiz.default_exam_questions, v_available_count), v_available_count);
    ELSE
      v_final_count := v_available_count;
    END IF;
  ELSE
    v_final_count := LEAST(p_question_count, v_available_count);
  END IF;

  IF p_attempt_type = 'study' THEN
    v_final_time_limit := NULL;
  ELSIF p_attempt_type = 'exam' THEN
    v_final_time_limit := COALESCE(p_time_limit_seconds, COALESCE(v_quiz.default_exam_duration, 60) * 60);
  ELSE
    v_final_time_limit := p_time_limit_seconds;
  END IF;

  -- 3. Insert attempt
  INSERT INTO public.attempts (
    user_id,
    quiz_set_id,
    attempt_type,
    status,
    total_questions,
    answered_count,
    correct_count,
    score,
    time_limit_seconds,
    duration_seconds,
    shuffle_questions,
    shuffle_options,
    started_at
  )
  VALUES (
    p_user_id,
    p_quiz_set_id,
    p_attempt_type,
    'in_progress',
    v_final_count,
    0,
    0,
    0.00,
    v_final_time_limit,
    0,
    COALESCE(p_shuffle_questions, false),
    COALESCE(p_shuffle_options, false),
    v_started_at
  )
  RETURNING id INTO v_attempt_id;

  -- 4. Select questions (shuffled or ordered), snapshot options and answer keys
  FOR v_q IN
    SELECT
      q.id AS question_id,
      q.question_text,
      COALESCE(q.question_type, 'multiple_choice') AS question_type,
      q.explanation AS q_explanation,
      q.formula_latex,
      q.image_path,
      qa.correct_option_id,
      qa.correct_text,
      COALESCE(qa.explanation, q.explanation) AS answer_explanation
    FROM public.questions q
    JOIN public.question_answers qa ON qa.question_id = q.id
    WHERE q.quiz_set_id = p_quiz_set_id
    ORDER BY
      CASE WHEN COALESCE(p_shuffle_questions, false) THEN random() ELSE q.position::FLOAT END,
      q.created_at ASC
    LIMIT v_final_count
  LOOP
    v_pos := v_pos + 1;

    -- Build options_snapshot (shuffled or ordered) without any is_correct flag!
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', opt.id,
          'option_label', opt.option_label,
          'option_content', opt.option_content,
          'image_path', opt.image_path,
          'display_order', opt.rn
        )
        ORDER BY opt.rn
      ),
      '[]'::jsonb
    )
    INTO v_options_snapshot
    FROM (
      SELECT
        o.id,
        o.option_label,
        o.option_content,
        o.image_path,
        ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN COALESCE(p_shuffle_options, false) THEN random() ELSE o.position::FLOAT END,
            o.option_label ASC
        ) AS rn
      FROM public.question_options o
      WHERE o.question_id = v_q.question_id
    ) opt;

    INSERT INTO public.attempt_questions (
      attempt_id,
      question_id,
      position,
      question_text,
      question_type,
      explanation_snapshot,
      formula_latex_snapshot,
      image_path_snapshot,
      options_snapshot
    )
    VALUES (
      v_attempt_id,
      v_q.question_id,
      v_pos,
      v_q.question_text,
      v_q.question_type,
      NULL, -- Kept NULL while in_progress to prevent explanation leak; populated on submit
      v_q.formula_latex,
      v_q.image_path,
      v_options_snapshot
    )
    RETURNING id INTO v_attempt_question_id;

    -- Snapshot answer key into server-only attempt_answer_keys table
    INSERT INTO public.attempt_answer_keys (
      attempt_question_id,
      correct_option_id,
      correct_text,
      explanation
    )
    VALUES (
      v_attempt_question_id,
      v_q.correct_option_id,
      v_q.correct_text,
      v_q.answer_explanation
    );

    -- Add question to response payload (STRICTLY WITHOUT answer key or explanation!)
    v_questions_payload := v_questions_payload || jsonb_build_array(
      jsonb_build_object(
        'attempt_question_id', v_attempt_question_id,
        'question_id', v_q.question_id,
        'position', v_pos,
        'question_text', v_q.question_text,
        'question_type', v_q.question_type,
        'formula_latex', v_q.formula_latex,
        'image_path', v_q.image_path,
        'options', v_options_snapshot
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'quiz_set_id', p_quiz_set_id,
    'quiz_title', v_quiz.title,
    'attempt_type', p_attempt_type,
    'status', 'in_progress',
    'total_questions', v_final_count,
    'time_limit_seconds', v_final_time_limit,
    'shuffle_questions', COALESCE(p_shuffle_questions, false),
    'shuffle_options', COALESCE(p_shuffle_options, false),
    'started_at', v_started_at,
    'questions', v_questions_payload
  );
END;
$$;

-- 14.3 Transactional Submit Attempt with SELECT FOR UPDATE row lock & Idempotency
-- Score formula: Score = round((Correct Count / Total Questions) * 10, 2)
CREATE OR REPLACE FUNCTION public.rpc_submit_attempt(
  p_user_id UUID,
  p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt RECORD;
  v_now TIMESTAMPTZ := now();
  v_elapsed_seconds INTEGER;
  v_final_duration INTEGER;
  v_final_status TEXT;
  v_answered_count INTEGER := 0;
  v_correct_count INTEGER := 0;
  v_unanswered_count INTEGER := 0;
  v_wrong_count INTEGER := 0;
  v_score NUMERIC(5,2) := 0.00;
BEGIN
  -- 1. Lock the attempt row with SELECT FOR UPDATE to prevent concurrent double submissions
  SELECT * INTO v_attempt
  FROM public.attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attempt not found.';
  END IF;

  IF v_attempt.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: You do not own this attempt.';
  END IF;

  -- 2. Idempotency: if already submitted or expired, return the stored result without recalculating
  IF v_attempt.status IN ('submitted', 'expired') THEN
    v_unanswered_count := GREATEST(0, v_attempt.total_questions - v_attempt.answered_count);
    v_wrong_count := GREATEST(0, v_attempt.answered_count - v_attempt.correct_count);

    RETURN jsonb_build_object(
      'attempt_id', v_attempt.id,
      'quiz_set_id', v_attempt.quiz_set_id,
      'attempt_type', v_attempt.attempt_type,
      'status', v_attempt.status,
      'total_questions', v_attempt.total_questions,
      'answered_count', v_attempt.answered_count,
      'correct_count', v_attempt.correct_count,
      'wrong_count', v_wrong_count,
      'unanswered_count', v_unanswered_count,
      'score', v_attempt.score,
      'time_limit_seconds', v_attempt.time_limit_seconds,
      'duration_seconds', v_attempt.duration_seconds,
      'started_at', v_attempt.started_at,
      'submitted_at', v_attempt.submitted_at,
      'idempotent', true
    );
  END IF;

  -- 3. Check server time vs time_limit_seconds (allow 5-second network grace window for status label, cap duration)
  v_elapsed_seconds := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_attempt.started_at))::INTEGER);

  IF v_attempt.time_limit_seconds IS NOT NULL AND v_elapsed_seconds > (v_attempt.time_limit_seconds + 5) THEN
    v_final_status := 'expired';
    v_final_duration := v_attempt.time_limit_seconds;
  ELSE
    v_final_status := 'submitted';
    IF v_attempt.time_limit_seconds IS NOT NULL THEN
      v_final_duration := LEAST(v_elapsed_seconds, v_attempt.time_limit_seconds);
    ELSE
      v_final_duration := v_elapsed_seconds;
    END IF;
  END IF;

  -- 4. Grade using server-only attempt_answer_keys
  -- Only responses answered within time limit (if time_limit_seconds is set) are counted
  SELECT
    COUNT(ar.id) FILTER (
      WHERE (ar.selected_option_id IS NOT NULL OR NULLIF(trim(COALESCE(ar.answer_text, '')), '') IS NOT NULL)
        AND (
          v_attempt.time_limit_seconds IS NULL
          OR ar.answered_at <= v_attempt.started_at + ((v_attempt.time_limit_seconds + 5) * interval '1 second')
        )
    ),
    COUNT(ar.id) FILTER (
      WHERE (
        v_attempt.time_limit_seconds IS NULL
        OR ar.answered_at <= v_attempt.started_at + ((v_attempt.time_limit_seconds + 5) * interval '1 second')
      )
      AND (
        (ak.correct_option_id IS NOT NULL AND ar.selected_option_id = ak.correct_option_id)
        OR (
          ak.correct_option_id IS NULL
          AND ak.correct_text IS NOT NULL
          AND lower(trim(COALESCE(ar.answer_text, ''))) = lower(trim(ak.correct_text))
        )
      )
    )
  INTO v_answered_count, v_correct_count
  FROM public.attempt_questions aq
  JOIN public.attempt_answer_keys ak ON ak.attempt_question_id = aq.id
  LEFT JOIN public.attempt_responses ar
    ON ar.attempt_id = aq.attempt_id AND ar.attempt_question_id = aq.id
  WHERE aq.attempt_id = p_attempt_id;

  v_answered_count := COALESCE(v_answered_count, 0);
  v_correct_count := COALESCE(v_correct_count, 0);
  v_unanswered_count := GREATEST(0, v_attempt.total_questions - v_answered_count);
  v_wrong_count := GREATEST(0, v_answered_count - v_correct_count);

  -- Formula: Score = Correct Count / Total Questions * 10 (rounded to 2 decimal places)
  IF v_attempt.total_questions > 0 THEN
    v_score := ROUND((v_correct_count::NUMERIC / v_attempt.total_questions::NUMERIC) * 10.0, 2);
  ELSE
    v_score := 0.00;
  END IF;

  -- 5. Update attempt permanently and unlock explanation_snapshot on attempt_questions
  UPDATE public.attempts
  SET
    status = v_final_status,
    answered_count = v_answered_count,
    correct_count = v_correct_count,
    score = v_score,
    duration_seconds = v_final_duration,
    submitted_at = v_now
  WHERE id = p_attempt_id;

  UPDATE public.attempt_questions aq
  SET explanation_snapshot = ak.explanation
  FROM public.attempt_answer_keys ak
  WHERE aq.attempt_id = p_attempt_id
    AND ak.attempt_question_id = aq.id;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id,
    'quiz_set_id', v_attempt.quiz_set_id,
    'attempt_type', v_attempt.attempt_type,
    'status', v_final_status,
    'total_questions', v_attempt.total_questions,
    'answered_count', v_answered_count,
    'correct_count', v_correct_count,
    'wrong_count', v_wrong_count,
    'unanswered_count', v_unanswered_count,
    'score', v_score,
    'time_limit_seconds', v_attempt.time_limit_seconds,
    'duration_seconds', v_final_duration,
    'started_at', v_attempt.started_at,
    'submitted_at', v_now,
    'idempotent', false
  );
END;
$$;

-- 14.4 Owner/Admin Quiz Question Save & Editor Loader (Authenticated via auth.uid())
-- Allows a quiz owner to save or update questions + options + correct_option_label
-- for their own quiz set in an atomic transaction without exposing question_answers table via direct SELECT.
CREATE OR REPLACE FUNCTION public.rpc_owner_upsert_quiz_questions(
  p_quiz_set_id UUID,
  p_questions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz RECORD;
  v_uid UUID := auth.uid();
  v_q JSONB;
  v_opt JSONB;
  v_question_id UUID;
  v_option_id UUID;
  v_correct_option_id UUID;
  v_correct_label TEXT;
  v_q_idx INTEGER := 0;
  v_opt_idx INTEGER := 0;
  v_kept_question_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.';
  END IF;

  SELECT * INTO v_quiz
  FROM public.quiz_sets
  WHERE id = p_quiz_set_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quiz set not found.';
  END IF;

  IF v_quiz.user_id <> v_uid AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: Only the owner or an admin can edit this quiz set.';
  END IF;

  IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) = 0 THEN
    RAISE EXCEPTION 'Quiz must contain at least one question.';
  END IF;

  -- Replace questions for this quiz_set cleanly within the transaction
  -- Note: attempt_questions has ON DELETE SET NULL on question_id so past attempts are 100% preserved!
  DELETE FROM public.questions WHERE quiz_set_id = p_quiz_set_id;

  FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    v_q_idx := v_q_idx + 1;
    v_correct_option_id := NULL;
    v_correct_label := upper(trim(COALESCE(v_q->>'correct_option_label', 'A')));

    INSERT INTO public.questions (
      user_id,
      document_id,
      quiz_set_id,
      position,
      question_text,
      question_type,
      explanation,
      formula_latex,
      image_path,
      source_page,
      difficulty,
      review_status,
      visibility
    )
    VALUES (
      v_quiz.user_id,
      v_quiz.document_id,
      p_quiz_set_id,
      v_q_idx,
      trim(v_q->>'question_text'),
      COALESCE(v_q->>'question_type', 'multiple_choice'),
      NULL, -- Explanation stored strictly in server-only question_answers.explanation
      v_q->>'formula_latex',
      v_q->>'image_path',
      NULLIF(v_q->>'source_page', '')::INTEGER,
      COALESCE(v_q->>'difficulty', v_quiz.difficulty),
      'reviewed',
      'private'
    )
    RETURNING id INTO v_question_id;

    v_kept_question_ids := array_append(v_kept_question_ids, v_question_id);

    v_opt_idx := 0;
    FOR v_opt IN SELECT * FROM jsonb_array_elements(v_q->'options')
    LOOP
      v_opt_idx := v_opt_idx + 1;

      INSERT INTO public.question_options (
        question_id,
        position,
        option_label,
        option_content,
        image_path
      )
      VALUES (
        v_question_id,
        v_opt_idx,
        upper(trim(v_opt->>'option_label')),
        trim(v_opt->>'option_content'),
        v_opt->>'image_path'
      )
      RETURNING id INTO v_option_id;

      IF upper(trim(v_opt->>'option_label')) = v_correct_label THEN
        v_correct_option_id := v_option_id;
      END IF;
    END LOOP;

    IF v_correct_option_id IS NULL THEN
      RAISE EXCEPTION 'Question #% does not have a matching option for correct_option_label "%".',
        v_q_idx, v_correct_label;
    END IF;

    INSERT INTO public.question_answers (
      question_id,
      correct_option_id,
      correct_text,
      explanation
    )
    VALUES (
      v_question_id,
      v_correct_option_id,
      v_q->>'correct_text',
      v_q->>'explanation'
    );
  END LOOP;

  -- If the quiz set was previously approved and public, editing questions reverts it to pending
  UPDATE public.quiz_sets
  SET
    moderation_status = CASE
      WHEN visibility = 'public' AND moderation_status = 'approved' THEN 'pending'
      ELSE moderation_status
    END,
    updated_at = now()
  WHERE id = p_quiz_set_id;

  RETURN jsonb_build_object(
    'quiz_set_id', p_quiz_set_id,
    'question_count', v_q_idx,
    'updated', true
  );
END;
$$;

-- 14.5 Owner/Admin Load Quiz Questions for Editor / Admin Moderation Preview
-- Strictly checks that the caller is either the quiz_set owner OR an admin.
-- Never returns data to ordinary learners or anonymous users.
CREATE OR REPLACE FUNCTION public.rpc_get_quiz_editor_questions(
  p_quiz_set_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz RECORD;
  v_uid UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.';
  END IF;

  SELECT * INTO v_quiz
  FROM public.quiz_sets
  WHERE id = p_quiz_set_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quiz set not found.';
  END IF;

  IF v_quiz.user_id <> v_uid AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: Only the quiz owner or an administrator can view editor details.';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'quiz_set_id', q.quiz_set_id,
        'position', q.position,
        'question_text', q.question_text,
        'question_type', q.question_type,
        'explanation', COALESCE(qa.explanation, q.explanation),
        'formula_latex', q.formula_latex,
        'image_path', q.image_path,
        'source_page', q.source_page,
        'difficulty', q.difficulty,
        'correct_option_id', qa.correct_option_id,
        'correct_option_label', (
          SELECT o2.option_label
          FROM public.question_options o2
          WHERE o2.id = qa.correct_option_id
        ),
        'options', (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'question_id', o.question_id,
                'position', o.position,
                'option_label', o.option_label,
                'option_content', o.option_content,
                'image_path', o.image_path
              )
              ORDER BY o.position ASC, o.option_label ASC
            ),
            '[]'::jsonb
          )
          FROM public.question_options o
          WHERE o.question_id = q.id
        )
      )
      ORDER BY q.position ASC, q.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.questions q
  LEFT JOIN public.question_answers qa ON qa.question_id = q.id
  WHERE q.quiz_set_id = p_quiz_set_id;

  RETURN v_result;
END;
$$;

-- 14.6 Safe Public Creator Info Lookup (returns ONLY id, display_name, avatar_url — never role)
CREATE OR REPLACE FUNCTION public.rpc_get_public_creator_profiles(
  p_user_ids UUID[]
)
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  avatar_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    COALESCE(p.display_name, 'Người dùng') AS display_name,
    p.avatar_url
  FROM public.profiles p
  WHERE p.id = ANY(p_user_ids);
$$;

COMMIT;

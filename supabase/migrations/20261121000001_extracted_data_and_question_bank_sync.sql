-- ============================================================================
-- MIGRATION: STRUCTURED JSONB (documents.extracted_data) & NORMALIZED QUESTION BANK SYNC
-- Additive only: preserves all existing tables, data, auth, and RLS policies.
-- ============================================================================

-- 1. Extend public.documents with extracted_data JSONB and sync flag
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS extracted_data JSONB,
  ADD COLUMN IF NOT EXISTS question_bank_synced BOOLEAN NOT NULL DEFAULT false;

-- 2. Partial index for fast Database-only Question Bank lookup per document
CREATE INDEX IF NOT EXISTS idx_questions_doc_bank
  ON public.questions (document_id, difficulty, question_type, position)
  WHERE quiz_set_id IS NULL;

-- 3. Idempotent atomic RPC: syncs validated questions from documents.extracted_data
-- into normalized tables (questions, question_options, question_answers) with quiz_set_id = NULL.
CREATE OR REPLACE FUNCTION public.rpc_sync_document_question_bank(
  p_document_id UUID,
  p_user_id UUID,
  p_questions JSONB,
  p_replace BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc RECORD;
  v_is_admin BOOLEAN := false;
  v_existing_count INTEGER := 0;
  v_q JSONB;
  v_opt JSONB;
  v_question_id UUID;
  v_option_id UUID;
  v_correct_option_id UUID;
  v_correct_label TEXT;
  v_q_idx INTEGER := 0;
  v_opt_idx INTEGER := 0;
BEGIN
  IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) = 0 THEN
    RAISE EXCEPTION 'Invalid questions payload: must be a non-empty JSON array.';
  END IF;

  SELECT id, user_id
  INTO v_doc
  FROM public.documents
  WHERE id = p_document_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found: %', p_document_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'admin'
  ) INTO v_is_admin;

  IF v_doc.user_id <> p_user_id AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: caller does not own document %', p_document_id;
  END IF;

  SELECT COUNT(*)
  INTO v_existing_count
  FROM public.questions
  WHERE document_id = p_document_id
    AND quiz_set_id IS NULL;

  IF v_existing_count > 0 AND NOT COALESCE(p_replace, false) THEN
    UPDATE public.documents
    SET question_bank_synced = true,
        processing_error = NULL
    WHERE id = p_document_id;

    RETURN jsonb_build_object(
      'synced_count', v_existing_count,
      'already_synced', true
    );
  END IF;

  IF v_existing_count > 0 AND COALESCE(p_replace, false) THEN
    -- Delete question_answers first to satisfy fk_question_answers_correct_option_same_question ON DELETE RESTRICT
    DELETE FROM public.question_answers
    WHERE question_id IN (
      SELECT id FROM public.questions
      WHERE document_id = p_document_id AND quiz_set_id IS NULL
    );

    DELETE FROM public.questions
    WHERE document_id = p_document_id
      AND quiz_set_id IS NULL;
  END IF;

  FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    v_q_idx := v_q_idx + 1;
    v_correct_option_id := NULL;
    v_correct_label := upper(trim(COALESCE(v_q->>'correct_option_label', '')));

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
      v_doc.user_id,
      p_document_id,
      NULL,
      v_q_idx,
      trim(v_q->>'question_text'),
      COALESCE(v_q->>'question_type', 'multiple_choice'),
      NULL,
      v_q->>'formula_latex',
      v_q->>'image_path',
      NULLIF(v_q->>'source_page', '')::INTEGER,
      COALESCE(v_q->>'difficulty', 'medium'),
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
    END LOOP;

    IF v_correct_option_id IS NULL THEN
      RAISE EXCEPTION 'Bank question #% does not have a matching correct_option_label (%).', v_q_idx, v_correct_label;
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

  UPDATE public.documents
  SET question_bank_synced = true,
      status = 'processed',
      processing_error = NULL
  WHERE id = p_document_id;

  RETURN jsonb_build_object(
    'synced_count', v_q_idx,
    'already_synced', false
  );
END;
$$;

-- 4. Database-only Quiz Generation RPC: creates or appends a quiz_set from normalized bank questions
-- WITHOUT calling Gemini AI. Returns preview questions & options WITHOUT answer keys.
CREATE OR REPLACE FUNCTION public.rpc_create_quiz_from_question_bank(
  p_user_id UUID,
  p_document_id UUID,
  p_quiz_set_id UUID DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_subject TEXT DEFAULT 'Tổng hợp',
  p_topic TEXT DEFAULT NULL,
  p_difficulty TEXT DEFAULT 'medium',
  p_question_count INTEGER DEFAULT 20,
  p_question_types TEXT[] DEFAULT ARRAY['multiple_choice', 'true_false'],
  p_default_exam_questions INTEGER DEFAULT 60,
  p_default_exam_duration INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz_set_id UUID := p_quiz_set_id;
  v_quiz_owner UUID;
  v_is_admin BOOLEAN := false;
  v_base_pos INTEGER := 0;
  v_q_idx INTEGER := 0;
  v_bank_q RECORD;
  v_bank_opt RECORD;
  v_bank_ans RECORD;
  v_new_question_id UUID;
  v_new_option_id UUID;
  v_new_correct_option_id UUID;
  v_preview_questions JSONB := '[]'::jsonb;
  v_preview_options JSONB;
  v_selected_count INTEGER := 0;
  v_types TEXT[] := COALESCE(p_question_types, ARRAY['multiple_choice', 'true_false']);
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'admin'
  ) INTO v_is_admin;

  -- Check how many eligible normalized bank questions exist (excluding duplicates already in p_quiz_set_id)
  SELECT COUNT(*)
  INTO v_selected_count
  FROM public.questions q
  WHERE q.document_id = p_document_id
    AND q.quiz_set_id IS NULL
    AND q.question_type = ANY(v_types)
    AND (
      v_quiz_set_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.questions existing_q
        WHERE existing_q.quiz_set_id = v_quiz_set_id
          AND lower(trim(existing_q.question_text)) = lower(trim(q.question_text))
      )
    );

  IF v_selected_count = 0 THEN
    RETURN jsonb_build_object(
      'quiz_set_id', v_quiz_set_id,
      'question_count', 0,
      'questions', '[]'::jsonb,
      'source', 'database_empty'
    );
  END IF;

  IF v_quiz_set_id IS NULL THEN
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
      COALESCE(NULLIF(trim(p_title), ''), 'Bộ đề trắc nghiệm'),
      p_description,
      COALESCE(NULLIF(trim(p_subject), ''), 'Tổng hợp'),
      p_topic,
      COALESCE(p_difficulty, 'medium'),
      'private',
      'not_submitted',
      GREATEST(1, COALESCE(p_default_exam_questions, LEAST(60, p_question_count))),
      GREATEST(1, COALESCE(p_default_exam_duration, 60))
    )
    RETURNING id INTO v_quiz_set_id;
  ELSE
    SELECT user_id
    INTO v_quiz_owner
    FROM public.quiz_sets
    WHERE id = v_quiz_set_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Quiz set not found or deleted: %', v_quiz_set_id;
    END IF;

    IF v_quiz_owner <> p_user_id AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Forbidden: caller does not own quiz set %', v_quiz_set_id;
    END IF;

    SELECT COALESCE(MAX(position), 0)
    INTO v_base_pos
    FROM public.questions
    WHERE quiz_set_id = v_quiz_set_id;
  END IF;

  FOR v_bank_q IN
    SELECT q.*
    FROM public.questions q
    WHERE q.document_id = p_document_id
      AND q.quiz_set_id IS NULL
      AND q.question_type = ANY(v_types)
      AND (
        p_quiz_set_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.questions existing_q
          WHERE existing_q.quiz_set_id = v_quiz_set_id
            AND lower(trim(existing_q.question_text)) = lower(trim(q.question_text))
        )
      )
    ORDER BY (q.difficulty = COALESCE(p_difficulty, 'medium')) DESC, q.position ASC, q.created_at ASC
    LIMIT GREATEST(1, COALESCE(p_question_count, 20))
  LOOP
    v_q_idx := v_q_idx + 1;
    v_new_correct_option_id := NULL;
    v_preview_options := '[]'::jsonb;

    SELECT qa.correct_option_id, qa.correct_text, qa.explanation
    INTO v_bank_ans
    FROM public.question_answers qa
    WHERE qa.question_id = v_bank_q.id;

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
      v_base_pos + v_q_idx,
      v_bank_q.question_text,
      v_bank_q.question_type,
      NULL,
      v_bank_q.formula_latex,
      v_bank_q.image_path,
      v_bank_q.source_page,
      v_bank_q.difficulty,
      'draft',
      'private'
    )
    RETURNING id INTO v_new_question_id;

    FOR v_bank_opt IN
      SELECT o.*
      FROM public.question_options o
      WHERE o.question_id = v_bank_q.id
      ORDER BY o.position ASC, o.option_label ASC
    LOOP
      INSERT INTO public.question_options (
        question_id,
        position,
        option_label,
        option_content,
        image_path
      )
      VALUES (
        v_new_question_id,
        v_bank_opt.position,
        v_bank_opt.option_label,
        v_bank_opt.option_content,
        v_bank_opt.image_path
      )
      RETURNING id INTO v_new_option_id;

      IF v_bank_ans.correct_option_id IS NOT NULL AND v_bank_opt.id = v_bank_ans.correct_option_id THEN
        v_new_correct_option_id := v_new_option_id;
      END IF;

      v_preview_options := v_preview_options || jsonb_build_array(
        jsonb_build_object(
          'id', v_new_option_id,
          'question_id', v_new_question_id,
          'position', v_bank_opt.position,
          'option_label', v_bank_opt.option_label,
          'option_content', v_bank_opt.option_content,
          'image_path', v_bank_opt.image_path
        )
      );
    END LOOP;

    IF v_new_correct_option_id IS NULL THEN
      RAISE EXCEPTION 'Bank question % is missing matching correct option.', v_bank_q.id;
    END IF;

    INSERT INTO public.question_answers (
      question_id,
      correct_option_id,
      correct_text,
      explanation
    )
    VALUES (
      v_new_question_id,
      v_new_correct_option_id,
      v_bank_ans.correct_text,
      v_bank_ans.explanation
    );

    v_preview_questions := v_preview_questions || jsonb_build_array(
      jsonb_build_object(
        'id', v_new_question_id,
        'quiz_set_id', v_quiz_set_id,
        'position', v_base_pos + v_q_idx,
        'question_text', v_bank_q.question_text,
        'question_type', v_bank_q.question_type,
        'formula_latex', v_bank_q.formula_latex,
        'image_path', v_bank_q.image_path,
        'source_page', v_bank_q.source_page,
        'difficulty', v_bank_q.difficulty,
        'options', v_preview_options
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'quiz_set_id', v_quiz_set_id,
    'question_count', v_q_idx,
    'questions', v_preview_questions,
    'source', 'database_bank'
  );
END;
$$;

-- 5. Strict Execution Grants (service_role only)
REVOKE EXECUTE ON FUNCTION public.rpc_sync_document_question_bank(UUID, UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_sync_document_question_bank(UUID, UUID, JSONB, BOOLEAN) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_create_quiz_from_question_bank(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT[], INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_quiz_from_question_bank(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT[], INTEGER, INTEGER) TO service_role;

-- ============================================================================
-- MIGRATION 03: SUPABASE STORAGE BUCKETS & RLS POLICIES
-- Project: AI Quiz Studio
-- Buckets:
--   1. exam-documents  (public = false, max 20MB, PDF/DOCX/TXT/Images)
--   2. question-assets (public = false, max 5MB, PNG/JPEG/WEBP)
-- Folder Convention:
--   <bucket_id>/<USER_UUID>/<filename>
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: CREATE OR UPDATE PRIVATE BUCKETS
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'exam-documents',
  'exam-documents',
  false,
  20971520, -- 20 MB limit
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'question-assets',
  'question-assets',
  false,
  5242880, -- 5 MB limit
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================================
-- STEP 2: CLEAN UP EXISTING STORAGE POLICIES FOR THESE TWO BUCKETS
-- ============================================================================
DROP POLICY IF EXISTS exam_documents_select_owner_or_admin ON storage.objects;
DROP POLICY IF EXISTS exam_documents_insert_owner ON storage.objects;
DROP POLICY IF EXISTS exam_documents_update_owner ON storage.objects;
DROP POLICY IF EXISTS exam_documents_delete_owner_or_admin ON storage.objects;

DROP POLICY IF EXISTS question_assets_select_owner_or_admin ON storage.objects;
DROP POLICY IF EXISTS question_assets_insert_owner ON storage.objects;
DROP POLICY IF EXISTS question_assets_update_owner ON storage.objects;
DROP POLICY IF EXISTS question_assets_delete_owner_or_admin ON storage.objects;

-- ============================================================================
-- STEP 3: STORAGE RLS POLICIES FOR exam-documents
-- Path structure: exam-documents/<USER_UUID>/<filename>
-- ============================================================================
CREATE POLICY exam_documents_select_owner_or_admin
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'exam-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

CREATE POLICY exam_documents_insert_owner
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'exam-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY exam_documents_update_owner
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'exam-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'exam-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY exam_documents_delete_owner_or_admin
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'exam-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

-- ============================================================================
-- STEP 4: STORAGE RLS POLICIES FOR question-assets
-- Path structure: question-assets/<USER_UUID>/<filename>
-- ============================================================================
CREATE POLICY question_assets_select_owner_or_admin
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'question-assets'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

CREATE POLICY question_assets_insert_owner
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'question-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY question_assets_update_owner
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'question-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'question-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY question_assets_delete_owner_or_admin
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'question-assets'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

COMMIT;

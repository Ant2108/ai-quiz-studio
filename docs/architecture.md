# System Architecture

## Overview
**AI-Quiz-Studio** is a web application for uploading study documents, generating quiz questions with AI, managing exams, and tracking results.

## Tech Stack
- **Frontend**: React, Vite, React Router, Zod, Lucide Icons, PDF.js (`pdfjs-dist`)
- **Backend / BaaS**: Supabase (Auth, PostgreSQL, Storage, Edge Functions)

## High-Level Flow
1. **Authentication**: Users sign in/sign up via Supabase Auth (`pages/auth/`).
2. **Document Upload & Processing**: Users upload documents (`pages/documents/`). Uploaded files are stored in Supabase Storage and processed via the `process-document` Edge Function (`supabase/functions/process-document/index.ts`).
3. **Question Bank & Exam Creation**: Generated or manual questions are managed in `pages/questions/` and assembled into exams in `pages/exams/`.
4. **Exam Taking & Results**: Users take exams and review scores/analytics in `pages/results/` and `pages/dashboard/`.

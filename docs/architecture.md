# System Architecture — AI Quiz Studio

Xem đầy đủ kiến trúc chi tiết tại:
- [docs/PROJECT_AUDIT.md](PROJECT_AUDIT.md)
- [docs/DATABASE_DESIGN.md](DATABASE_DESIGN.md)
- [docs/SECURITY.md](SECURITY.md)
- [docs/API_DOCUMENTATION.md](API_DOCUMENTATION.md)

## Luồng kiến trúc tổng thể

```text
React SPA (GitHub Pages)
   │  (Supabase Auth JWT Bearer Token)
   ├──► Supabase PostgREST (RLS-protected public/owner reads & metadata writes)
   ├──► Supabase Storage (Private buckets: exam-documents, question-assets)
   └──► Supabase Edge Functions (Deno + Service Role + ACID RPCs)
           ├── process-document   ──► Google Gemini API (OCR & Analysis)
           ├── generate-quiz      ──► Google Gemini API + rpc_create_quiz_with_questions
           ├── start-attempt      ──► rpc_start_attempt (Snapshots & Signed URLs)
           ├── answer-question    ──► Server-time check & Study immediate feedback
           ├── submit-attempt     ──► rpc_submit_attempt (SELECT FOR UPDATE & Grading)
           ├── get-attempt-review ──► Full review after submitted/expired
           └── moderate-quiz      ──► Server-side Admin verification (approve/reject/remove)
```

# Database Schema

Database migrations are managed under `supabase/migrations/`.

## Planned Core Tables
- `profiles`: User profile metadata linked to `auth.users`.
- `documents`: Uploaded source files and extraction/processing status.
- `questions`: Question bank items (prompt, options, correct answer, explanation, source document).
- `exams`: Quiz/exam configurations (title, duration, question set).
- `exam_attempts` / `results`: User submissions, answers, scores, and timestamps.

## Row Level Security (RLS)
All user-owned tables should enforce RLS policies scoped to `auth.uid()`.

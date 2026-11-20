# Database Schema Overview — AI Quiz Studio

Tài liệu thiết kế đầy đủ 11 bảng, sơ đồ ERD, ràng buộc toàn vẹn, triggers và stored procedures nằm tại [docs/DATABASE_DESIGN.md](DATABASE_DESIGN.md).

## Thứ tự SQL Migrations (`supabase/migrations/`)

1. `20261120000001_schema_upgrade.sql` — Nâng cấp 4 bảng cũ (`documents`, `questions`, `question_options`, `question_answers`) bằng `ALTER TABLE` + tạo 7 bảng mới (`profiles`, `quiz_sets`, `attempts`, `attempt_questions`, `attempt_answer_keys`, `attempt_responses`, `quiz_reviews`) + triggers + RPC transactions.
2. `20261120000002_rls_and_grants.sql` — Dọn dẹp policy cũ, thu hồi quyền truy cập trực tiếp `question_answers` & `attempt_answer_keys`, bật và áp dụng RLS cho cả 11 bảng.
3. `20261120000003_storage_buckets_and_policies.sql` — Khởi tạo 2 private buckets (`exam-documents`, `question-assets`) và Storage RLS policies.

# KẾ HOẠCH & BÁO CÁO KIỂM THỬ (TESTING) — AI QUIZ STUDIO

## 1. Kết quả Kiểm thử Tự động (Automated Test Suite)

Bộ kiểm thử tự động sử dụng **Node.js Built-in Test Runner (`node --test`)** nằm trong thư mục `tests/`:

- `tests/database-migrations.test.mjs` — Kiểm tra cú pháp, tính an toàn migration (không `DROP TABLE`), nâng cấp 4 bảng cũ bằng `ALTER TABLE`, 11 bảng mục tiêu, RLS, SQL Grants (`REVOKE ALL` trên `question_answers` & `attempt_answer_keys`), composite FKs, triggers nghiệp vụ, `SELECT ... FOR UPDATE`, và 2 private Storage buckets.
- `tests/edge-functions.test.mjs` — Thực thi trực tiếp các helper TypeScript (`validation.ts`, `response.ts`, `cors.ts`), kiểm thử validate UUID, validate file upload (MIME/size), validate JSON schema từ Gemini AI, kiểm tra ẩn lộ secret trong log/error, kiểm tra đủ 7 Edge Functions + `verify_jwt = true`, và kiểm thử công thức chấm điểm hệ 10.
- `tests/frontend-and-security.test.mjs` — Quét toàn bộ mã nguồn `frontend/src/` và production bundle `frontend/dist/` để xác minh **không rò rỉ** `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, không có truy vấn trực tiếp tới `question_answers`/`attempt_answer_keys`/`attempts` write; kiểm thử `validateFileBeforeUpload` và cấu hình GitHub Pages (`404.html`, workflow, `.env.example`).

### Cách chạy kiểm thử

```bash
cd frontend
npm run lint
npm run build
npm test
```

### Kết quả thực tế ghi nhận (20/20 PASSED)

| # | Nhóm kiểm thử | Bài kiểm thử | Kết quả |
| :---: | :--- | :--- | :---: |
| 1 | Database | Không chứa lệnh `DROP TABLE` trong toàn bộ migrations | PASS |
| 2 | Database | Nâng cấp 4 bảng hiện có (`documents`, `questions`, `question_options`, `question_answers`) qua `ALTER TABLE` | PASS |
| 3 | Database | Khởi tạo & bật RLS trên đầy đủ 11 bảng mục tiêu | PASS |
| 4 | Database | Composite FKs, Soft Delete (`ON DELETE RESTRICT`), `SELECT ... FOR UPDATE`, công thức chấm điểm | PASS |
| 5 | Database | Triggers bảo vệ `profiles.role`, `quiz_sets` moderation và tự động reset `approved -> pending` khi sửa nội dung | PASS |
| 6 | Security | `REVOKE ALL` trên `question_answers`, `attempt_answer_keys`; thu hồi quyền ghi trực tiếp `attempts` | PASS |
| 7 | Storage | Tạo 2 private buckets (`exam-documents`, `question-assets`) với `public = false` & Storage RLS | PASS |
| 8 | Edge Functions | Validate UUID hợp lệ / từ chối chuỗi sai | PASS |
| 9 | Edge Functions | Validate định dạng file (PDF/DOCX/TXT/PNG/JPG/WEBP), từ chối `.exe`, rỗng, > 20MB | PASS |
| 10 | Edge Functions | Validate Gemini JSON schema cho `multiple_choice` và `true_false` | PASS |
| 11 | Edge Functions | Từ chối Gemini JSON bị lệch `correct_option_label` hoặc trùng nhãn đáp án | PASS |
| 12 | Edge Functions | Redact tự động `AIza...` API key và JWT trong error response | PASS |
| 13 | Edge Functions | CORS headers đầy đủ | PASS |
| 14 | Edge Functions | Đủ 7 Edge Functions với `verify_jwt = true`, `requireAuth`/`requireAdmin` | PASS |
| 15 | Business Rules | Công thức tính điểm `Score = Correct / Total × 10` làm tròn tối đa 2 chữ số thập phân | PASS |
| 16 | Frontend Security | Quét 0 secrets (`GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) trong `src/` & `dist/` | PASS |
| 17 | Frontend Security | Frontend không bao giờ gọi `.from('question_answers')`, `.from('attempt_answer_keys')`, hoặc ghi trực tiếp `attempts` | PASS |
| 18 | Frontend Arch | Đủ 6 services và 5 custom hooks | PASS |
| 19 | Deployment | Đủ `404.html`, `.github/workflows/deploy.yml`, `.env.example`, `.gitignore` | PASS |
| 20 | Frontend Logic | `documentService.validateFileBeforeUpload` kiểm tra MIME và giới hạn 20MB | PASS |

---

## 2. Kịch bản Kiểm thử Tích hợp End-to-End (E2E Acceptance Checklist)

Sau khi người dùng áp dụng 3 file SQL migrations và deploy 7 Edge Functions lên dự án Supabase thực tế, cần chạy nghiệm thu theo danh sách sau:

### 2.1. Authentication & Authorization
- [ ] **TC-AUTH-01**: Đăng ký tài khoản mới -> kiểm tra bảng `profiles` tự động tạo bản ghi với `role = 'user'`.
- [ ] **TC-AUTH-02**: Thử gọi `supabase.from('profiles').update({ role: 'admin' }).eq('id', uid)` bằng token của user thường -> bị từ chối bởi RLS & Trigger `trg_protect_profile_fields`.
- [ ] **TC-AUTH-03**: Truy cập `/admin` bằng user thường -> hiển thị màn hình chặn truy cập `Admin Guard`.
- [ ] **TC-AUTH-04**: Nâng quyền Admin trong SQL Editor (`UPDATE public.profiles SET role = 'admin' WHERE id = '<UUID>';`) -> truy cập `/admin` thành công.

### 2.2. Upload Document & AI Generation
- [ ] **TC-DOC-01**: Tải lên file PDF / DOCX / TXT / PNG -> file nằm trong `exam-documents/<USER_UUID>/...`, bản ghi `documents` có `visibility = 'private'` và `status = 'processed'`.
- [ ] **TC-DOC-02**: Dùng User B cố gắng tải đường dẫn `exam-documents/<USER_A_UUID>/...` -> bị Supabase Storage RLS từ chối.
- [ ] **TC-GEN-01**: Tạo bộ đề 20 câu từ tài liệu đã xử lý -> trả về bản preview câu hỏi không chứa `correct_option_id`.
- [ ] **TC-GEN-02**: Tạo bộ đề thứ 2 từ cùng 1 tài liệu (chủ đề khác, độ khó khác) -> cả 2 bộ đề đều lưu riêng biệt trong `quiz_sets`.

### 2.3. Quy trình kiểm duyệt Public (`both_admin`)
- [ ] **TC-MOD-01**: Bộ đề mới tạo mặc định `visibility = 'private'`, `moderation_status = 'not_submitted'` -> không xuất hiện ở `/explore`.
- [ ] **TC-MOD-02**: User nhấn "Gửi duyệt Public" -> chuyển thành `visibility = 'public'`, `moderation_status = 'pending'` -> vẫn chưa xuất hiện ở `/explore`.
- [ ] **TC-MOD-03**: User thường thử gửi `POST /functions/v1/moderate-quiz` -> nhận HTTP `403 FORBIDDEN_ADMIN_ONLY`.
- [ ] **TC-MOD-04**: Admin đăng nhập `/admin`, xem preview câu hỏi & đáp án, nhấn **Approve** -> `moderation_status = 'approved'` -> xuất hiện ngay trên `/explore`.
- [ ] **TC-MOD-05**: Owner chỉnh sửa nội dung bộ đề đã `approved` -> trigger tự động chuyển về `moderation_status = 'pending'` và ẩn khỏi `/explore` cho đến khi Admin duyệt lại.

### 2.4. Study / Practice / Exam Mode & Chống Gian Lận
- [ ] **TC-STUDY-01**: Vào Study Mode -> chọn 1 phương án -> server trả `is_correct`, `correct_option_id`, `explanation` ngay lập tức.
- [ ] **TC-PRAC-01**: Vào Practice Mode -> chọn 20 câu + trộn thứ tự -> chọn đáp án -> kiểm tra Network tab `answer-question` chỉ trả `{ saved: true }`, không có đáp án đúng -> nhấn Submit -> chuyển sang `/results/:id` xem điểm & giải thích.
- [ ] **TC-EXAM-01**: Vào Exam Mode -> kiểm tra đồng hồ đếm ngược, đánh dấu cờ (Flag), bỏ trống 1 số câu -> để hết giờ hoặc nhấn Submit -> kiểm tra điểm đúng bằng `round(correct / total * 10, 2)`.
- [ ] **TC-SEC-01**: Khi attempt đang `in_progress`, gọi `POST /functions/v1/get-attempt-review` -> bị từ chối `403 ATTEMPT_NOT_SUBMITTED`.
- [ ] **TC-SEC-02**: Gửi `POST /functions/v1/submit-attempt` 2 lần liên tiếp -> lần 2 trả về `idempotent: true` với nguyên kết quả lần 1, không thay đổi điểm.
- [ ] **TC-SEC-03**: Thử chạy `supabase.from('question_answers').select('*')` hoặc `supabase.from('attempt_answer_keys').select('*')` từ DevTools -> bị PostgreSQL từ chối `permission denied`.

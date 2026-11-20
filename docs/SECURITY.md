# KIẾN TRÚC BẢO MẬT & PHÂN QUYỀN (SECURITY & RLS) — AI QUIZ STUDIO

## 1. Mô hình Bảo mật Đa lớp (Defense-in-Depth)

Hệ thống **AI Quiz Studio** triển khai 4 lớp bảo mật độc lập để bảo vệ dữ liệu người dùng, tài liệu riêng tư, đáp án đề thi và tính toàn vẹn của kết quả chấm điểm:

1. **Lớp 1 — SQL Grants & Column-Level Privileges**:
   - Thu hồi hoàn toàn (`REVOKE ALL`) quyền truy cập của `PUBLIC`, `anon`, `authenticated` trên 2 bảng chứa đáp án đúng: `public.question_answers` và `public.attempt_answer_keys`.
   - Thu hồi quyền ghi (`REVOKE INSERT, UPDATE, DELETE`) của `anon` và `authenticated` trên các bảng `attempts`, `attempt_questions`, `attempt_responses`. Người dùng chỉ có quyền `SELECT` lịch sử của chính mình; mọi thao tác khởi tạo bài thi, lưu câu trả lời và chấm điểm bắt buộc phải đi qua Supabase Edge Functions.
   - Thu hồi quyền đọc cột `explanation` trên bảng `questions` đối với truy vấn trực tiếp từ client.
2. **Lớp 2 — PostgreSQL Row Level Security (RLS)**:
   - Bật RLS (`ENABLE ROW LEVEL SECURITY`) trên toàn bộ 11 bảng trong schema `public` và bảng `storage.objects`.
   - Tách biệt rõ ràng quyền của 3 nhóm đối tượng: **Anonymous (`anon`)**, **Authenticated User (`authenticated`)**, và **Administrator (`public.is_admin()`)**.
3. **Lớp 3 — Database Triggers chống leo thang đặc quyền & lách kiểm duyệt**:
   - Trigger `trg_protect_profile_fields` chặn mọi nỗ lực tự nâng quyền `role = 'admin'`.
   - Trigger `trg_enforce_quiz_set_moderation_rules` và `trg_questions_invalidate_approval` chặn người dùng tự duyệt bộ đề (`moderation_status = 'approved'`) và tự động đưa bộ đề đã duyệt về trạng thái `pending` ngay khi phát hiện nội dung bộ đề hoặc câu hỏi bị chỉnh sửa.
4. **Lớp 4 — Supabase Edge Functions & JWT Validation**:
   - Mọi Edge Function đều kiểm tra JWT hợp lệ qua `supabaseUserClient.auth.getUser(token)` trước khi thực hiện bất kỳ thao tác nào bằng `service_role`.
   - Tuyệt đối không lưu `SUPABASE_SERVICE_ROLE_KEY` hoặc `GEMINI_API_KEY` ở phía Frontend hoặc GitHub repository.

---

## 2. Ma trận Phân quyền (SQL Grants & RLS) theo Vai trò

| Bảng / Tài nguyên | Anonymous (`anon`) | Authenticated User (`authenticated`) | Admin (`role = 'admin'`) | Edge Functions (`service_role`) |
| :--- | :--- | :--- | :--- | :--- |
| **`profiles`** | Không có quyền | Xem & sửa `display_name`, `avatar_url` của chính mình (`id = auth.uid()`). Không được sửa `role`. | Xem và quản lý toàn bộ profiles & roles. | Toàn quyền (qua xác thực JWT). |
| **`documents`** | Không có quyền | Chỉ Owner đọc, tải lên, sửa, xóa tài liệu của mình (`visibility = 'private'`). | Xem và quản lý để hỗ trợ kiểm duyệt. | Đọc & cập nhật trạng thái xử lý AI. |
| **`quiz_sets`** | Chỉ `SELECT` bộ đề có `visibility = 'public'`, `moderation_status = 'approved'`, `deleted_at IS NULL`. | Xem bộ đề Public đã duyệt; toàn quyền tạo, sửa, xóa mềm bộ đề của chính mình. Khi gửi Public tự chuyển sang `pending`. | Xem mọi bộ đề; thực hiện `approve`, `reject`, `remove`. | Tạo bộ đề từ AI & cập nhật kiểm duyệt. |
| **`questions`** | Chỉ `SELECT` các cột câu hỏi (trừ `explanation`) của `quiz_sets` Public đã `approved`. | Xem câu hỏi của bộ đề Public đã duyệt; thêm/sửa/xóa câu hỏi trong `quiz_sets` của chính mình. | Toàn quyền xem và quản lý. | Tạo câu hỏi từ AI trong transaction. |
| **`question_options`** | Chỉ `SELECT` lựa chọn của câu hỏi thuộc `quiz_sets` Public đã `approved`. | Xem lựa chọn của bộ đề Public đã duyệt; thêm/sửa/xóa lựa chọn trong câu hỏi của mình. | Toàn quyền xem và quản lý. | Tạo lựa chọn từ AI trong transaction. |
| **`question_answers`** | **BỊ CHẶN 100%** (`REVOKE ALL`) | **BỊ CHẶN 100%** (`REVOKE ALL` — không có quyền `SELECT` trực tiếp) | Chỉ xem qua Editor/Moderation RPC có kiểm tra quyền. | Toàn quyền đọc/ghi phía server. |
| **`attempts`** | Không có quyền | Chỉ `SELECT` lượt làm bài của chính mình (`user_id = auth.uid()`). Không được `INSERT/UPDATE/DELETE` trực tiếp. | Xem thống kê & kiểm tra hệ thống. | Tạo attempt, khóa row (`FOR UPDATE`), chấm điểm. |
| **`attempt_questions`** | Không có quyền | Chỉ `SELECT` câu hỏi snapshot thuộc attempt của chính mình (`explanation_snapshot = NULL` khi đang làm bài). | Xem khi cần kiểm tra. | Tạo snapshot câu hỏi & mở khóa giải thích khi nộp bài. |
| **`attempt_answer_keys`** | **BỊ CHẶN 100%** (`REVOKE ALL`) | **BỊ CHẶN 100%** (`REVOKE ALL`) | **BỊ CHẶN TRỰC TIẾP** | Chỉ Edge Functions đọc để chấm điểm. |
| **`attempt_responses`** | Không có quyền | Chỉ `SELECT` câu trả lời của chính mình. Không được `INSERT/UPDATE` trực tiếp từ client. | Xem khi cần kiểm tra. | Ghi nhận câu trả lời sau khi kiểm tra thời gian server. |
| **`quiz_reviews`** | `SELECT` đánh giá của các bộ đề Public đã `approved`. | Xem đánh giá; tạo tối đa 1 đánh giá/bộ đề Public đã duyệt; sửa/xóa đánh giá của chính mình. | Xem và xóa đánh giá vi phạm. | Toàn quyền. |

---

## 3. Bảo mật Supabase Storage

Hai bucket lưu trữ được cấu hình ở chế độ riêng tư (`public = false`):

1. **`exam-documents`**:
   - Đường dẫn bắt buộc: `exam-documents/<USER_UUID>/<filename>`
   - Dung lượng tối đa: **20 MB**.
   - Định dạng MIME cho phép: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/plain`, `image/png`, `image/jpeg`, `image/webp`.
   - Chính sách RLS: Chỉ chủ sở hữu (`(storage.foldername(name))[1] = auth.uid()::text`) mới được tải lên, đọc, sửa, xóa file trong thư mục của mình. Admin được quyền đọc để phục vụ kiểm duyệt. Tài liệu gốc **không bao giờ** bị chuyển thành Public kể cả khi bộ đề sinh ra từ tài liệu đó được duyệt Public.

2. **`question-assets`**:
   - Đường dẫn bắt buộc: `question-assets/<USER_UUID>/<filename>`
   - Dung lượng tối đa: **5 MB**.
   - Định dạng MIME cho phép: `image/png`, `image/jpeg`, `image/webp`.
   - Chính sách RLS: Chỉ chủ sở hữu được tải lên/sửa/xóa trong thư mục UUID của mình. Khi hiển thị hình ảnh minh họa trong câu hỏi của bộ đề Public đã duyệt, hệ thống cấp **Signed URL có thời hạn ngắn** sau khi đã xác minh quyền truy cập bộ đề.

---

## 4. Kiểm soát Gian lận Thi cử & Bảo vệ Đáp án

1. **Chống lộ đáp án trên Network / DevTools**:
   - Trong `start-attempt`, hệ thống chỉ trả về danh sách câu hỏi và các phương án lựa chọn (`id`, `option_label`, `option_content`, `image_path`, `display_order`). Không có bất kỳ trường `is_correct`, `correct_option_id` hay `explanation` nào được gửi xuống trình duyệt.
   - Trong chế độ **Study Mode** (`immediate`), đáp án đúng và giải thích của câu nào chỉ được Edge Function `answer-question` trả về **sau khi** người học đã gửi lựa chọn cho câu hỏi đó.
   - Trong chế độ **Practice Mode** và **Exam Mode**, `answer-question` chỉ xác nhận đã lưu lựa chọn (`saved: true`), tuyệt đối không trả kết quả đúng/sai cho đến khi người học gọi `submit-attempt`.
   - `get-attempt-review` chỉ trả về đáp án đúng và lời giải chi tiết khi và chỉ khi `attempts.status IN ('submitted', 'expired')`.
2. **Xác thực thời gian bằng Server Time**:
   - Thời gian làm bài được tính hoàn toàn dựa trên `now() - attempts.started_at` tại PostgreSQL server.
   - Mọi request `answer-question` gửi đến sau khi đã quá `time_limit_seconds` sẽ bị từ chối ghi nhận và hệ thống tự động khóa bài thi.
3. **Chống nộp bài trùng lặp (Idempotency & Row Locking)**:
   - Hàm `rpc_submit_attempt` sử dụng `SELECT * FROM public.attempts WHERE id = p_attempt_id FOR UPDATE` để khóa dòng dữ liệu trong suốt quá trình chấm điểm.
   - Nếu người dùng gửi nhiều request nộp bài liên tiếp (double-click hoặc retry mạng), các request sau sẽ nhận lại đúng kết quả đã chấm lần đầu (`idempotent: true`) mà không thể ghi đè hay chấm lại điểm.
4. **Giới hạn tần suất (Rate Limiting)**:
   - `process-document` và `generate-quiz` kiểm tra số lượng yêu cầu xử lý tài liệu / sinh đề bằng AI của user trong cửa sổ thời gian (ví dụ tối đa 15 lần sinh đề/giờ cho mỗi user) nhằm bảo vệ hạn mức Gemini API Free Tier.

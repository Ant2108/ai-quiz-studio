# BÁO CÁO KIỂM TOÁN MÃ NGUỒN (PROJECT AUDIT) — AI QUIZ STUDIO

## 1. Tổng quan cấu trúc dự án hiện tại

Dự án **AI Quiz Studio** được tổ chức theo cấu trúc monorepo gồm 3 thành phần chính:

```text
AI-Quiz-Studio/
├── docs/
│   ├── api.md                  # Tài liệu sơ lược về process-document
│   ├── architecture.md         # Mô tả kiến trúc tổng quan ban đầu
│   └── database.md             # Ghi chú sơ bộ 5 bảng dự kiến ban đầu
├── frontend/
│   ├── public/
│   │   ├── favicon.svg
│   │   └── icons.svg
│   ├── src/
│   │   ├── assets/             # Hình ảnh mặc định của Vite template
│   │   ├── components/
│   │   │   └── ui/
│   │   │       └── button.jsx  # Component Button (shadcn + @base-ui/react)
│   │   ├── contexts/           # (Trống)
│   │   ├── hooks/              # (Trống)
│   │   ├── layouts/            # (Trống)
│   │   ├── lib/
│   │   │   ├── supabase.js     # Khởi tạo Supabase client cơ bản
│   │   │   └── utils.js        # Re-export hàm cn
│   │   ├── pages/
│   │   │   ├── auth/           # (Trống)
│   │   │   ├── dashboard/      # (Trống)
│   │   │   ├── documents/      # (Trống)
│   │   │   ├── exams/          # (Trống)
│   │   │   ├── questions/      # (Trống)
│   │   │   └── results/        # (Trống)
│   │   ├── services/           # (Trống)
│   │   ├── utils/              # (Trống)
│   │   ├── App.css             # CSS mặc định của Vite starter
│   │   ├── App.jsx             # Trang counter mặc định của Vite starter
│   │   ├── index.css           # Tailwind CSS v4 + shadcn theme + CSS Vite starter
│   │   └── main.jsx            # Entry point React 19
│   ├── .env                    # Biến môi trường local (đã được ignore trong .gitignore)
│   ├── .gitignore
│   ├── .oxlintrc.json
│   ├── components.json         # Cấu hình shadcn/ui (style: base-nova, Tailwind v4)
│   ├── index.html
│   ├── jsconfig.json           # Cấu hình alias @/* -> ./src/*
│   ├── package.json
│   └── vite.config.js
├── supabase/
│   ├── functions/
│   │   └── process-document/
│   │       └── index.ts        # Edge Function stub (chưa có logic thực tế)
│   ├── migrations/             # (Trống trên repo, DB thực tế đang có 4 bảng)
│   └── config.toml             # Cấu hình Supabase local & function process-document
└── README.md
```

---

## 2. Những hạng mục đã hoàn thành

1. **Khởi tạo khung Frontend (React 19 + Vite 8 + Tailwind CSS v4)**:
   - Đã cài đặt đầy đủ các thư viện cốt lõi: `react`, `react-dom`, `react-router-dom` (v7), `@supabase/supabase-js` (v2), `zod` (v4), `lucide-react`, `pdfjs-dist`, `class-variance-authority`, `cn`, `@base-ui/react`, `shadcn`.
   - Đã cấu hình path alias `@/` trỏ về `./src/` trong `vite.config.js` và `jsconfig.json`.
   - Đã có component `src/components/ui/button.jsx` và tiện ích `src/lib/utils.js`.
2. **Kết nối Supabase cơ bản**:
   - Đã có `src/lib/supabase.js` khởi tạo client từ biến môi trường.
   - Đã có `supabase/config.toml` định nghĩa cấu hình cơ bản cho project `ai-quiz-studio`.
3. **Database hiện có trên Supabase (4 bảng)**:
   - `documents`, `questions`, `question_options`, `question_answers` đã tồn tại trên hệ thống (hiện có 0 bản ghi) cùng các Foreign Keys và CHECK constraints cơ bản.

---

## 3. Những hạng mục còn thiếu

### 3.1. Database & Migrations (`supabase/migrations/`)
- Thư mục `supabase/migrations/` hiện đang trống hoàn toàn.
- Thiếu **7 bảng mới** theo thiết kế mục tiêu 11 bảng:
  1. `profiles` (quản lý thông tin người dùng và phân quyền `user`/`admin`, trigger tự động tạo khi đăng ký `auth.users`).
  2. `quiz_sets` (quản lý bộ đề, trạng thái `visibility`, quy trình kiểm duyệt `moderation_status`, cấu hình thi mặc định, soft delete `deleted_at`).
  3. `attempts` (quản lý lượt làm bài `study`/`practice`/`exam`, trạng thái, thời gian, điểm số).
  4. `attempt_questions` (snapshot câu hỏi và lựa chọn tại thời điểm bắt đầu làm bài).
  5. `attempt_answer_keys` (snapshot đáp án đúng tại thời điểm thi — chỉ Server/Service Role được đọc).
  6. `attempt_responses` (lưu câu trả lời của người học theo từng câu trong attempt).
  7. `quiz_reviews` (đánh giá sao và nhận xét cho bộ đề Public đã duyệt).
- Các bảng hiện tại (`documents`, `questions`, `question_options`, `question_answers`) chưa được nâng cấp (`ALTER TABLE`) để bổ sung:
  - `documents`: các cột phục vụ trạng thái xử lý AI, trích xuất văn bản (`extracted_text`, `page_count`, `file_size`, `mime_type`, `processing_error`, `processed_at`, `updated_at`).
  - `questions`: khóa ngoại `quiz_set_id`, thứ tự câu hỏi `position`, `updated_at`, điều chỉnh FK `document_id` thành `ON DELETE SET NULL`.
  - `question_options`: `position`, constraint `UNIQUE (id, question_id)` phục vụ composite foreign key bảo toàn toàn vẹn đáp án.
  - `question_answers`: composite foreign key `(correct_option_id, question_id) REFERENCES question_options(id, question_id)` để đảm bảo `correct_option_id` bắt buộc thuộc đúng `question_id`.
- Thiếu Trigger bảo vệ Business Rules:
  - Chặn user tự nâng quyền `role = 'admin'` trên `profiles`.
  - Chặn user tự sửa `moderation_status = 'approved'` hoặc các cột `moderated_by`, `moderated_at`, `moderation_note` trên `quiz_sets`.
  - Tự động chuyển `moderation_status` về `pending` (nếu bộ đề đang là `public` + `approved`) khi chủ sở hữu chỉnh sửa nội dung bộ đề, câu hỏi, lựa chọn hoặc đáp án.

### 3.2. Bảo mật RLS, SQL Grants & Storage Policies
- Chưa có migration thu hồi quyền đọc (`REVOKE SELECT`) đối với `anon` và `authenticated` trên 2 bảng nhạy cảm `question_answers` và `attempt_answer_keys`.
- Chưa có hệ thống RLS policies đồng bộ cho 11 bảng (bao gồm việc dọn dẹp các policy cũ trên 4 bảng hiện có).
- Chưa có cấu hình khởi tạo 2 private storage buckets (`exam-documents` và `question-assets` với `public = false`, giới hạn MIME type và kích thước file) cùng Storage RLS policies cho Owner và Admin.

### 3.3. Supabase Edge Functions (`supabase/functions/`)
- `process-document`: Mới chỉ là khung mẫu trả về JSON tĩnh, chưa xác thực JWT/ownership, chưa tải file từ Storage, chưa trích xuất nội dung/gọi Gemini phân tích tài liệu và cập nhật trạng thái.
- Chưa có 6 Edge Functions bắt buộc còn lại:
  - `generate-quiz`
  - `start-attempt`
  - `answer-question`
  - `submit-attempt`
  - `get-attempt-review`
  - `moderate-quiz`
- Chưa có thư mục `_shared/` chứa các module dùng chung (CORS, JWT auth & role verification, Supabase Admin/User clients, Gemini AI client với retry/timeout/rate-limit/schema validation, response/error helpers).
- `supabase/config.toml` mới khai báo `[functions.process-document]`, thiếu khai báo cho 6 functions còn lại.

### 3.4. Frontend Service Layer, Contexts, Hooks & Pages
- **Service Layer (`frontend/src/services/`)**: Đang trống. Thiếu `supabaseClient.js`, `authService.js`, `documentService.js`, `quizService.js`, `attemptService.js`, `adminService.js`.
- **Contexts & Hooks (`frontend/src/contexts/`, `frontend/src/hooks/`)**: Đang trống. Thiếu `AuthContext.jsx`, `useAuth.js`, `useDocuments.js`, `useQuiz.js`, `useAttempt.js`, `useAdmin.js`.
- **Routing & Guards**: Chưa có cấu hình React Router trong `App.jsx`, chưa có `ProtectedRoute` và `AdminRoute` (Admin Guard).
- **UI Pages (`frontend/src/pages/`)**: Tất cả thư mục con đều đang trống. Cần triển khai đầy đủ 12 nhóm chức năng:
  1. Authentication (`Login`, `Register`, `ForgotPassword`)
  2. Dashboard (Tổng quan bộ đề, câu hỏi, lịch sử học tập, kết quả gần đây)
  3. Explore / Community (Danh sách bộ đề Public đã approved, tìm kiếm, bộ lọc môn/chủ đề/độ khó, trang chi tiết bộ đề, đánh giá & bình luận)
  4. My Library (Danh sách bộ đề cá nhân, trạng thái Private/Public & Moderation, tạo thủ công, chỉnh sửa câu hỏi/đáp án, xóa mềm, gửi duyệt Public)
  5. Upload Document (Tải lên PDF/DOCX/TXT/Ảnh, kiểm tra định dạng & dung lượng, trích xuất & theo dõi trạng thái xử lý AI)
  6. Generate Quiz (Cấu hình số câu, loại câu hỏi, độ khó, môn học/chủ đề, gọi AI sinh đề, preview & chỉnh sửa trực tiếp, lưu Private hoặc gửi duyệt Public)
  7. Study Mode (Ôn tập từng câu, kiểm tra đáp án tức thời từ server, hiển thị giải thích ngay, điều hướng câu)
  8. Practice Mode (Chọn số câu 20/30/50/60/toàn bộ, trộn câu, làm nhiều câu, nộp bài chấm điểm trên server, xem giải thích)
  9. Exam Mode (Cấu hình số câu/thời gian hoặc mặc định, trộn câu & đáp án, đồng hồ đếm ngược, đánh dấu câu hỏi, tự động nộp khi hết giờ)
  10. Result Page (Điểm hệ 10 làm tròn 2 chữ số thập phân, thống kê đúng/sai/bỏ trống, thời gian làm bài, xem lại chi tiết từng câu kèm đáp án đúng & giải thích)
  11. My Progress (Thống kê tổng số lượt làm bài, điểm trung bình, điểm cao nhất, biểu đồ/bảng lịch sử thi)
  12. Admin Dashboard (Danh sách bộ đề chờ duyệt `pending` và tất cả bộ đề, xem trước câu hỏi + đáp án, Approve/Reject/Remove kèm lý do, lịch sử kiểm duyệt, quản lý người dùng & phân quyền)

### 3.5. Cấu hình Deployment (GitHub Pages)
- Chưa có workflow `.github/workflows/deploy.yml` để tự động build và deploy lên GitHub Pages.
- Chưa xử lý SPA fallback (`404.html`) hoặc cấu hình base path linh hoạt trong `vite.config.js` để tránh lỗi 404 khi reload trang trên GitHub Pages.

---

## 4. Các lỗi và điểm không đồng bộ phát hiện được

1. **Không đồng bộ tên biến môi trường Supabase Key**:
   - `README.md` ghi `VITE_SUPABASE_ANON_KEY`.
   - `frontend/.env` và `frontend/src/lib/supabase.js` lại sử dụng `VITE_SUPABASE_PUBLISHABLE_KEY`.
   - File `frontend/.env.example` đã bị xóa trong working directory.
   - **Hướng khắc phục**: Hỗ trợ đọc cả `VITE_SUPABASE_PUBLISHABLE_KEY` lẫn `VITE_SUPABASE_ANON_KEY` trong `supabaseClient.js`, đồng thời khôi phục file `frontend/.env.example` chuẩn.
2. **Xung đột CSS toàn cục trong `frontend/src/index.css`**:
   - Dòng 123–133 của `frontend/src/index.css` giữ lại CSS mẫu của Vite (`#root { width: 1126px; text-align: center; border-inline: 1px solid var(--border); }` và `h1 { font-size: 56px; }`). Quy tắc này làm hỏng bố cục ứng dụng web toàn màn hình (Sidebar/Navbar/Dashboard).
   - **Hướng khắc phục**: Giữ nguyên hệ thống biến màu/theme của Tailwind v4 & shadcn trong `index.css`, loại bỏ các style cố định `#root` và typography mẫu của Vite boilerplate.
3. **Cảnh báo cấu hình Vite 8 trong `frontend/vite.config.js`**:
   - Khi chạy `npm run build`, Vite 8 cảnh báo việc dùng `__dirname` tại `vite.config.js:13:25` không tương thích với `configLoader: 'native'`.
   - **Hướng khắc phục**: Chuyển sang sử dụng `import.meta.dirname` và cấu hình `base` hỗ trợ GitHub Pages.
4. **Ràng buộc Foreign Key và bảo mật đáp án trên schema 4 bảng cũ**:
   - `questions.document_id` hiện có `ON DELETE NO ACTION`, gây lỗi nếu người dùng xóa tài liệu gốc. Cần chuyển thành `ON DELETE SET NULL`.
   - `question_answers.correct_option_id` chưa có ràng buộc composite FK `(correct_option_id, question_id) -> question_options(id, question_id)`, dẫn đến nguy cơ `correct_option_id` trỏ nhầm sang option của câu hỏi khác.
   - `questions.visibility` và `questions.review_status` trên bảng `questions` cũ không đủ để quản lý cấp độ bộ đề (`quiz_sets`). Quyền hiển thị Public mới phải được kiểm soát tập trung qua `quiz_sets.visibility = 'public'`, `quiz_sets.moderation_status = 'approved'` và `quiz_sets.deleted_at IS NULL`.

---

## 5. Danh sách các file cần tạo mới hoặc chỉnh sửa

### 5.1. Tài liệu (`docs/`)
- `docs/PROJECT_AUDIT.md` (Tạo mới)
- `docs/DATABASE_DESIGN.md` (Tạo mới)
- `docs/SECURITY.md` (Tạo mới)
- `docs/API_DOCUMENTATION.md` (Tạo mới)
- `docs/TESTING.md` (Tạo mới)
- `docs/DEPLOYMENT.md` (Tạo mới)
- Cập nhật `docs/architecture.md`, `docs/database.md`, `docs/api.md`, `README.md`.

### 5.2. Database & Supabase (`supabase/`)
- `supabase/config.toml` (Cập nhật khai báo 7 Edge Functions)
- `supabase/migrations/20261120000001_schema_upgrade.sql` (Nâng cấp 4 bảng cũ + tạo 7 bảng mới + constraints + indexes + triggers nghiệp vụ + RPC transactional functions)
- `supabase/migrations/20261120000002_rls_and_grants.sql` (Dọn dẹp policy cũ, thiết lập SQL Grants bảo vệ answer keys, bật và cấu hình RLS cho toàn bộ 11 bảng)
- `supabase/migrations/20261120000003_storage_buckets_and_policies.sql` (Tạo 2 private buckets `exam-documents`, `question-assets` và Storage RLS policies)

### 5.3. Supabase Edge Functions (`supabase/functions/`)
- `supabase/functions/_shared/cors.ts`
- `supabase/functions/_shared/response.ts`
- `supabase/functions/_shared/supabase.ts`
- `supabase/functions/_shared/auth.ts`
- `supabase/functions/_shared/gemini.ts`
- `supabase/functions/_shared/validation.ts`
- `supabase/functions/process-document/index.ts` (Viết hoàn chỉnh)
- `supabase/functions/generate-quiz/index.ts` (Tạo mới)
- `supabase/functions/start-attempt/index.ts` (Tạo mới)
- `supabase/functions/answer-question/index.ts` (Tạo mới)
- `supabase/functions/submit-attempt/index.ts` (Tạo mới)
- `supabase/functions/get-attempt-review/index.ts` (Tạo mới)
- `supabase/functions/moderate-quiz/index.ts` (Tạo mới)

### 5.4. Frontend (`frontend/`)
- `frontend/vite.config.js`, `frontend/.env.example`, `frontend/index.html`, `frontend/public/404.html`, `frontend/src/index.css`
- **Services**:
  - `frontend/src/services/supabaseClient.js` (và giữ `frontend/src/lib/supabase.js` tương thích ngược)
  - `frontend/src/services/authService.js`
  - `frontend/src/services/documentService.js`
  - `frontend/src/services/quizService.js`
  - `frontend/src/services/attemptService.js`
  - `frontend/src/services/adminService.js`
- **Contexts & Hooks**:
  - `frontend/src/contexts/AuthContext.jsx`
  - `frontend/src/hooks/useAuth.js`
  - `frontend/src/hooks/useDocuments.js`
  - `frontend/src/hooks/useQuiz.js`
  - `frontend/src/hooks/useAttempt.js`
  - `frontend/src/hooks/useAdmin.js`
- **Components & Layouts**:
  - `frontend/src/layouts/AppLayout.jsx`, `frontend/src/layouts/AuthLayout.jsx`
  - `frontend/src/components/ProtectedRoute.jsx`, `frontend/src/components/AdminRoute.jsx`
  - Các UI components bổ trợ trong `frontend/src/components/ui/` và `frontend/src/components/quiz/`
- **Pages**:
  - `frontend/src/pages/auth/LoginPage.jsx`
  - `frontend/src/pages/auth/RegisterPage.jsx`
  - `frontend/src/pages/auth/ForgotPasswordPage.jsx`
  - `frontend/src/pages/dashboard/DashboardPage.jsx`
  - `frontend/src/pages/explore/ExplorePage.jsx`
  - `frontend/src/pages/explore/QuizDetailPage.jsx`
  - `frontend/src/pages/library/MyLibraryPage.jsx`
  - `frontend/src/pages/library/QuizEditorPage.jsx`
  - `frontend/src/pages/documents/DocumentsPage.jsx`
  - `frontend/src/pages/questions/GenerateQuizPage.jsx`
  - `frontend/src/pages/exams/StudyModePage.jsx`
  - `frontend/src/pages/exams/PracticeModePage.jsx`
  - `frontend/src/pages/exams/ExamModePage.jsx`
  - `frontend/src/pages/results/ResultPage.jsx`
  - `frontend/src/pages/results/MyProgressPage.jsx`
  - `frontend/src/pages/admin/AdminDashboardPage.jsx`
- **CI/CD**:
  - `.github/workflows/deploy.yml`

---

## 6. Kế hoạch triển khai chi tiết

1. **Phase 1 — Audit source code**: Hoàn thành báo cáo `docs/PROJECT_AUDIT.md`.
2. **Phase 2 — Database Architecture & Migrations**:
   - Xây dựng SQL migration nâng cấp 4 bảng hiện có bằng `ALTER TABLE` (tuyệt đối không `DROP TABLE`) và tạo 7 bảng mới.
   - Thiết lập stored procedures (PostgreSQL RPC functions chạy với `SECURITY DEFINER` cho các thao tác nhiều bước như tạo bộ đề + câu hỏi + đáp án, khởi tạo attempt + snapshot, và chấm điểm với `SELECT ... FOR UPDATE`) để đảm bảo tính toàn vẹn giao dịch (ACID Transaction) khi gọi từ Edge Functions.
   - Viết tài liệu `docs/DATABASE_DESIGN.md`.
3. **Phase 3 — Security, RLS & Storage**:
   - Xóa các RLS policies cũ không còn phù hợp trên 4 bảng ban đầu.
   - Thu hồi quyền `SELECT` trực tiếp từ `anon` và `authenticated` trên `question_answers` và `attempt_answer_keys`.
   - Thiết lập RLS chặt chẽ cho 11 bảng và 2 private buckets (`exam-documents`, `question-assets`).
   - Viết tài liệu `docs/SECURITY.md`.
4. **Phase 4 — Supabase Edge Functions & Gemini AI**:
   - Xây dựng bộ helper dùng chung trong `supabase/functions/_shared/`.
   - Triển khai đầy đủ 7 Edge Functions (`process-document`, `generate-quiz`, `start-attempt`, `answer-question`, `submit-attempt`, `get-attempt-review`, `moderate-quiz`).
5. **Phase 5 — Frontend React & Service Layer**:
   - Hoàn thiện tầng `services/` và `hooks/`.
   - Xây dựng giao diện và luồng nghiệp vụ đầy đủ cho tất cả 12 phân hệ, responsive trên Desktop/Tablet/Mobile.
   - Cấu hình GitHub Pages deployment.
6. **Phase 6 — Testing & Documentation**:
   - Viết và chạy bộ kiểm thử tự động kiểm tra logic chấm điểm, validation schema, quyền truy cập, build production.
   - Hoàn thiện `docs/TESTING.md`, `docs/API_DOCUMENTATION.md`, `docs/DEPLOYMENT.md`.
7. **Phase 7 — Final Review**:
   - Rà soát đồng bộ tên trường giữa Database — Edge Functions — Frontend, kiểm tra bảo mật secrets và build sạch lỗi.

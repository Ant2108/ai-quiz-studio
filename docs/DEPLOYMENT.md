# HƯỚNG DẪN CÀI ĐẶT & TRIỂN KHAI (DEPLOYMENT) — AI QUIZ STUDIO

## 1. Cấu hình Biến môi trường & Secrets

### 1.1. Frontend (An toàn công khai — lưu tại `frontend/.env` local và GitHub Repository Secrets/Variables)
- `VITE_SUPABASE_URL`: URL dự án Supabase (ví dụ `https://<project-ref>.supabase.co`)
- `VITE_SUPABASE_PUBLISHABLE_KEY` (hoặc `VITE_SUPABASE_ANON_KEY`): Khóa Publishable / Anon công khai của Supabase.

> **CẢNH BÁO BẢO MẬT**: Tuyệt đối **KHÔNG** đưa `GEMINI_API_KEY` hay `SUPABASE_SERVICE_ROLE_KEY` vào `frontend/.env` hoặc mã nguồn frontend.

### 1.2. Supabase Edge Function Secrets (Chỉ lưu phía server trên Supabase)
Chạy lệnh Supabase CLI (hoặc cấu hình trong **Supabase Dashboard → Edge Functions → Secrets**):

```bash
supabase secrets set GEMINI_API_KEY="your-google-gemini-api-key"
# Tùy chọn (mặc định là gemini-2.5-flash):
supabase secrets set GEMINI_MODEL="gemini-2.5-flash"
# Tùy chọn giới hạn nguồn CORS trên production:
supabase secrets set ALLOWED_ORIGINS="https://ant2108.github.io,http://localhost:5173"
```

Lưu ý: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, và `SUPABASE_SERVICE_ROLE_KEY` được Supabase tự động cung cấp sẵn cho Edge Functions.

---

## 2. Chạy Database Migrations lên Supabase

Các file migration được đánh số thứ tự trong `supabase/migrations/`:
1. `20261120000001_schema_upgrade.sql`
2. `20261120000002_rls_and_grants.sql`
3. `20261120000003_storage_buckets_and_policies.sql`

### Cách A: Dùng Supabase CLI (Khuyên dùng)
```bash
# Cài Supabase CLI nếu chưa có: npm install -g supabase
supabase login
supabase link --project-ref pyvidedtuvncsiqabrpp
supabase db push
```

### Cách B: Chạy trực tiếp trên Supabase Dashboard SQL Editor
Nếu chưa cài CLI, mở **Supabase Dashboard → SQL Editor**, sao chép và chạy lần lượt nội dung từng file theo đúng thứ tự `01 -> 02 -> 03`.

### Tạo tài khoản Admin đầu tiên
Sau khi đăng ký tài khoản đầu tiên trên website, chạy câu lệnh SQL sau trong **Supabase SQL Editor** để cấp quyền Admin:

```sql
UPDATE public.profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@example.com');
```

---

## 3. Deploy 7 Supabase Edge Functions

```bash
supabase functions deploy process-document
supabase functions deploy generate-quiz
supabase functions deploy start-attempt
supabase functions deploy answer-question
supabase functions deploy submit-attempt
supabase functions deploy get-attempt-review
supabase functions deploy moderate-quiz
```

Hoặc deploy toàn bộ cùng lúc:
```bash
supabase functions deploy
```

Mọi function đều đã bật `verify_jwt = true` trong `supabase/config.toml`.

---

## 4. Chạy Dự án Local (Development)

```bash
cd frontend
npm install
cp .env.example .env
# Cập nhật VITE_SUPABASE_URL và VITE_SUPABASE_PUBLISHABLE_KEY trong frontend/.env
npm run dev
```

Mở trình duyệt tại `http://localhost:5173`.

---

## 5. Deploy Frontend lên GitHub Pages

Dự án đã tích hợp sẵn:
- Cấu hình `base` tự động theo tên repository (`/ai-quiz-studio/`) trong `frontend/vite.config.js`.
- `BrowserRouter` sử dụng `basename={import.meta.env.BASE_URL}` trong `frontend/src/App.jsx`.
- SPA fallback chống lỗi 404 khi reload trang qua `frontend/public/404.html` và script khôi phục URL trong `frontend/index.html`.
- GitHub Actions Workflow tại `.github/workflows/deploy.yml`.

### Các bước kích hoạt trên GitHub:
1. Vào repository trên GitHub → **Settings → Secrets and variables → Actions**.
2. Thêm 2 secrets (hoặc variables):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Vào **Settings → Pages**:
   - Mục **Build and deployment → Source**: Chọn **GitHub Actions**.
4. Vào **Supabase Dashboard → Authentication → URL Configuration**:
   - Thêm `https://<github-username>.github.io/ai-quiz-studio` vào **Site URL** và **Redirect URLs** để tính năng xác nhận email / Quên mật khẩu hoạt động chuẩn.
5. Push mã nguồn lên nhánh `main` (hoặc chạy tay workflow **Deploy Frontend to GitHub Pages** trong tab **Actions**).

# AI Quiz Studio

Nền tảng học tập và luyện thi trắc nghiệm trực tuyến tích hợp **Google Gemini AI** và **Supabase** (PostgreSQL + Auth + Private Storage + Edge Functions).

## Tính năng chính

1. **Tài khoản & Phân quyền**: Đăng ký, đăng nhập, quên mật khẩu, quản lý hồ sơ cá nhân, bảo vệ route và phân quyền `user`/`admin` (`Admin Guard`).
2. **Tải lên & Phân tích Tài liệu AI**: Hỗ trợ PDF, DOCX, TXT và hình ảnh (PNG, JPG, WEBP — tối đa 20MB), lưu trữ riêng tư trong bucket `exam-documents`, trích xuất văn bản & OCR bằng Gemini AI.
3. **Sinh Bộ đề Tự động bằng AI**: Tạo tới 120 câu hỏi (`multiple_choice`, `true_false`) từ 1 tài liệu (một tài liệu có thể tạo nhiều bộ đề), kiểm định JSON schema chặt chẽ, lưu trong transaction, xem trước & chỉnh sửa.
4. **Chia sẻ Cộng đồng có Kiểm duyệt (`both_admin`)**: Bộ đề mặc định Private; gửi Public chuyển trạng thái `pending`; Admin duyệt (`approve`), từ chối (`reject`) hoặc gỡ (`remove`); tự động đưa về `pending` nếu nội dung đã duyệt bị chỉnh sửa.
5. **3 Chế độ Học & Thi**:
   - **Study Mode (`immediate`)**: Ôn tập từng câu, kiểm tra đáp án & giải thích tức thời từ server.
   - **Practice Mode**: Chọn 20, 30, 50, 60 hoặc toàn bộ câu, trộn thứ tự, chấm điểm khi nộp bài.
   - **Exam Mode**: Cấu hình mặc định hoặc tùy chỉnh số câu & thời gian, đồng hồ đếm ngược đồng bộ giờ server, đánh dấu câu hỏi, tự động thu bài khi hết giờ, tính điểm hệ 10 làm tròn 2 chữ số thập phân.
6. **Bảo mật Đáp án Đa lớp**: Thu hồi quyền `SELECT` trực tiếp trên `question_answers` và `attempt_answer_keys`; RLS toàn bộ 11 bảng; chấm điểm bằng `SELECT ... FOR UPDATE` chống nộp trùng lặp.

## Công nghệ sử dụng

- **Frontend**: React 19, Vite 8, Tailwind CSS v4, React Router v7, Lucide React, PDF.js (`pdfjs-dist`), Zod
- **Backend**: Supabase (PostgreSQL 15+, Auth, Private Storage, Edge Functions Deno/TypeScript)
- **AI**: Google Gemini API (`gemini-2.5-flash` / `gemini-2.0-flash`)
- **CI/CD**: GitHub Actions → GitHub Pages

## Chạy nhanh Local

```bash
cd frontend
npm install
cp .env.example .env
# Cấu hình VITE_SUPABASE_URL và VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev
```

## Kiểm thử & Build

```bash
cd frontend
npm run lint
npm run build
npm test
```

## Tài liệu chi tiết

- [Kiểm toán Mã nguồn (Audit)](docs/PROJECT_AUDIT.md)
- [Thiết kế Cơ sở dữ liệu (11 bảng)](docs/DATABASE_DESIGN.md)
- [Bảo mật, RLS & Storage](docs/SECURITY.md)
- [Tài liệu API & 7 Edge Functions](docs/API_DOCUMENTATION.md)
- [Kiểm thử & Acceptance Checklist](docs/TESTING.md)
- [Hướng dẫn Deploy (Supabase & GitHub Pages)](docs/DEPLOYMENT.md)

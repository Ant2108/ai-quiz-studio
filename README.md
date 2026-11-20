# AI-Quiz-Studio

Ứng dụng web hỗ trợ tải tài liệu học tập, tạo câu hỏi trắc nghiệm bằng AI, quản lý đề thi và theo dõi kết quả làm bài.

## Cấu trúc thư mục

```text
AI-Quiz-Studio/
│
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── layouts/
│   │   ├── pages/
│   │   │   ├── auth/
│   │   │   ├── dashboard/
│   │   │   ├── documents/
│   │   │   ├── questions/
│   │   │   ├── exams/
│   │   │   └── results/
│   │   ├── services/
│   │   ├── hooks/
│   │   ├── contexts/
│   │   ├── lib/
│   │   ├── utils/
│   │   ├── App.jsx
│   │   └── main.jsx
│   │
│   ├── .env.example
│   ├── .gitignore
│   ├── package.json
│   └── vite.config.js
│
├── supabase/
│   ├── functions/
│   │   └── process-document/
│   │       └── index.ts
│   ├── migrations/
│   └── config.toml
│
├── docs/
│   ├── architecture.md
│   ├── database.md
│   └── api.md
│
└── README.md
```

## Công nghệ sử dụng

- **Frontend**: React, Vite, React Router, Zod, Lucide React, PDF.js (`pdfjs-dist`)
- **Backend / BaaS**: Supabase (Auth, PostgreSQL, Storage, Edge Functions)

## Cài đặt & Chạy dự án

### 1. Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Cập nhật các biến môi trường trong `frontend/.env`:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### 2. Supabase (Local)

```bash
supabase start
supabase functions serve process-document
```

## Tài liệu tham khảo

- [Architecture](docs/architecture.md)
- [Database](docs/database.md)
- [API & Edge Functions](docs/api.md)

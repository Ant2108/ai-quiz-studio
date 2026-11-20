# API & Edge Functions Index — AI Quiz Studio

Xem đặc tả đầy đủ Request / Response và mã lỗi của cả 7 Edge Functions tại [docs/API_DOCUMENTATION.md](API_DOCUMENTATION.md).

## Danh sách 7 Supabase Edge Functions (`verify_jwt = true`)

1. `POST /functions/v1/process-document` (`supabase/functions/process-document/index.ts`)
2. `POST /functions/v1/generate-quiz` (`supabase/functions/generate-quiz/index.ts`)
3. `POST /functions/v1/start-attempt` (`supabase/functions/start-attempt/index.ts`)
4. `POST /functions/v1/answer-question` (`supabase/functions/answer-question/index.ts`)
5. `POST /functions/v1/submit-attempt` (`supabase/functions/submit-attempt/index.ts`)
6. `POST /functions/v1/get-attempt-review` (`supabase/functions/get-attempt-review/index.ts`)
7. `POST /functions/v1/moderate-quiz` (`supabase/functions/moderate-quiz/index.ts`)

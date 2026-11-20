# API & Edge Functions

## Supabase Edge Functions
### `POST /functions/v1/process-document`
- **Source**: `supabase/functions/process-document/index.ts`
- **Auth**: JWT required (`verify_jwt = true` in `supabase/config.toml`)
- **Purpose**: Extracts text/content from uploaded documents and triggers AI question generation.

## Frontend Services
Client-side Supabase queries and RPC/Edge Function invocations are organized under `frontend/src/services/`.

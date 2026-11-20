# TÀI LIỆU API & SUPABASE EDGE FUNCTIONS — AI QUIZ STUDIO

Tất cả 7 Edge Functions đều nằm dưới tiền tố:
`https://<PROJECT_REF>.supabase.co/functions/v1/<function-name>`

**Headers bắt buộc cho mọi request:**
```http
Authorization: Bearer <USER_ACCESS_TOKEN>
apikey: <VITE_SUPABASE_PUBLISHABLE_KEY_OR_ANON_KEY>
Content-Type: application/json
```

---

## 1. `POST /functions/v1/process-document`

Phân tích tài liệu PDF, DOCX, TXT hoặc Hình ảnh (OCR qua Gemini AI), lưu văn bản trích xuất và bản tóm tắt cấu trúc.

- **Auth**: JWT bắt buộc + kiểm tra quyền sở hữu tài liệu (Owner hoặc Admin) + Rate limit.
- **Request Body**:
```json
{
  "document_id": "550e8400-e29b-41d4-a716-446655440000",
  "extracted_text": "(Tùy chọn) văn bản trích xuất sẵn từ PDF.js phía client",
  "page_count": 12
}
```
- **Response `200 OK`**:
```json
{
  "success": true,
  "document": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "file_name": "Java_OOP.pdf",
    "status": "processed",
    "page_count": 12,
    "visibility": "private",
    "ai_summary": {
      "title_suggestion": "Ôn tập Lập trình Hướng đối tượng Java",
      "subject_suggestion": "Lập trình Java",
      "topics": ["JVM", "Class & Object", "Inheritance"],
      "summary": "...",
      "recommended_question_count": 30
    }
  },
  "extracted_length": 18450
}
```

---

## 2. `POST /functions/v1/generate-quiz`

Sinh tự động bộ đề trắc nghiệm từ tài liệu nguồn qua Google Gemini AI, validate toàn bộ JSON schema, lưu `quiz_sets`, `questions`, `question_options`, `question_answers` trong một ACID transaction duy nhất và trả về bản Preview **không chứa answer key**.

- **Auth**: JWT bắt buộc + kiểm tra sở hữu `document_id` + Rate limit.
- **Request Body**:
```json
{
  "document_id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Đề thi thử Java OOP",
  "description": "Bộ câu hỏi tổng hợp chương 1-4",
  "subject": "Java",
  "topic": "JVM & OOP",
  "difficulty": "medium",
  "question_count": 60,
  "question_types": ["multiple_choice", "true_false"],
  "default_exam_questions": 60,
  "default_exam_duration": 60
}
```
- **Response `201 Created`** (Tuyệt đối không trả `correct_option_id`):
```json
{
  "success": true,
  "quiz_set": {
    "id": "...",
    "title": "Đề thi thử Java OOP",
    "visibility": "private",
    "moderation_status": "not_submitted"
  },
  "question_count": 60,
  "preview_questions": [
    {
      "id": "...",
      "position": 1,
      "question_text": "What is JVM?",
      "question_type": "multiple_choice",
      "difficulty": "medium",
      "options": [
        { "id": "...", "option_label": "A", "option_content": "Java Virtual Machine" }
      ]
    }
  ]
}
```

---

## 3. `POST /functions/v1/start-attempt`

Khởi tạo phiên học/thi (`study`, `practice`, `exam`), chọn & trộn câu hỏi/đáp án, chụp snapshot vào `attempt_questions` và `attempt_answer_keys` trong một transaction.

- **Auth**: JWT bắt buộc + kiểm tra quyền truy cập bộ đề (Owner, Admin, hoặc Public + Approved).
- **Request Body**:
```json
{
  "quiz_set_id": "UUID",
  "attempt_type": "exam",
  "question_count": 60,
  "time_limit_seconds": 3600,
  "shuffle_questions": true,
  "shuffle_options": true
}
```
- **Response `201 Created`**: Trả về `attempt_id`, `started_at`, `time_limit_seconds`, và danh sách `questions` + `options` (không chứa đáp án đúng hay giải thích).

---

## 4. `POST /functions/v1/answer-question`

Lưu câu trả lời của người học sau khi xác thực chủ sở hữu attempt, trạng thái `in_progress`, thời gian server, câu hỏi thuộc attempt và phương án thuộc câu hỏi.

- **Request Body**:
```json
{
  "attempt_id": "UUID",
  "attempt_question_id": "UUID",
  "selected_option_id": "UUID"
}
```
- **Response `200 OK` (Study Mode — `immediate`)**:
```json
{
  "success": true,
  "saved": true,
  "attempt_id": "UUID",
  "attempt_question_id": "UUID",
  "selected_option_id": "UUID",
  "feedback": {
    "is_correct": true,
    "correct_option_id": "UUID",
    "correct_text": "Java Virtual Machine",
    "explanation": "JVM executes Java bytecode."
  }
}
```
- **Response `200 OK` (Practice & Exam Mode)**:
```json
{
  "success": true,
  "saved": true,
  "attempt_id": "UUID",
  "attempt_question_id": "UUID",
  "selected_option_id": "UUID"
}
```

---

## 5. `POST /functions/v1/submit-attempt`

Khóa dòng `attempts` bằng `SELECT ... FOR UPDATE`, đối chiếu `attempt_answer_keys`, chấm điểm theo công thức `Score = round((correct / total) * 10, 2)` và cập nhật trạng thái `submitted` hoặc `expired`. Xử lý **idempotent** khi gửi lặp lại.

- **Request Body**:
```json
{
  "attempt_id": "UUID"
}
```
- **Response `200 OK`**:
```json
{
  "success": true,
  "result": {
    "attempt_id": "UUID",
    "status": "submitted",
    "total_questions": 60,
    "answered_count": 58,
    "correct_count": 50,
    "wrong_count": 8,
    "unanswered_count": 2,
    "score": 8.33,
    "duration_seconds": 2145,
    "idempotent": false
  }
}
```

---

## 6. `POST /functions/v1/get-attempt-review`

Trả về chi tiết từng câu hỏi, lựa chọn của người học, đáp án đúng và giải thích. Chỉ cho phép chủ sở hữu (hoặc Admin) truy cập **sau khi** attempt đã ở trạng thái `submitted` hoặc `expired`.

- **Request Body**:
```json
{
  "attempt_id": "UUID"
}
```
- **Response `200 OK`**: Trả về object `attempt` kèm mảng `questions` đầy đủ thông tin đối chiếu.

---

## 7. `POST /functions/v1/moderate-quiz`

Kiểm duyệt bộ đề Public (Quy tắc `both_admin`). Chỉ chấp nhận người dùng có `profiles.role = 'admin'`.

- **Request Body**:
```json
{
  "quiz_set_id": "UUID",
  "action": "approve",
  "reason": "Nội dung chính xác, đầy đủ giải thích"
}
```
- **Actions hợp lệ**:
  - `approve`: Chuyển `moderation_status = 'approved'`, `visibility = 'public'`, ghi `published_at`.
  - `reject`: Chuyển `moderation_status = 'rejected'`, yêu cầu nhập `reason`.
  - `remove`: Gỡ bộ đề đang Public (`moderation_status = 'removed'`, xóa `published_at`), yêu cầu nhập `reason`.

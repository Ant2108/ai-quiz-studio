import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

const migration01 = fs.readFileSync(
  path.join(MIGRATIONS_DIR, "20261120000001_schema_upgrade.sql"),
  "utf8",
);
const migration02 = fs.readFileSync(
  path.join(MIGRATIONS_DIR, "20261120000002_rls_and_grants.sql"),
  "utf8",
);
const migration03 = fs.readFileSync(
  path.join(MIGRATIONS_DIR, "20261120000003_storage_buckets_and_policies.sql"),
  "utf8",
);
const allSql = `${migration01}\n${migration02}\n${migration03}`;

test("Database Migrations: zero DROP TABLE statements", () => {
  assert.equal(
    /\bDROP\s+TABLE\b/i.test(allSql),
    false,
    "Migrations must NEVER execute DROP TABLE",
  );
});

test("Database Migrations: upgrades all 4 existing tables explicitly via ALTER TABLE", () => {
  for (const table of [
    "documents",
    "questions",
    "question_options",
    "question_answers",
  ]) {
    const regex = new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\b`, "i");
    assert.ok(
      regex.test(migration01),
      `Expected explicit ALTER TABLE public.${table} upgrade statement`,
    );
  }
});

test("Database Migrations: defines all 11 target tables", () => {
  const expectedTables = [
    "profiles",
    "documents",
    "quiz_sets",
    "questions",
    "question_options",
    "question_answers",
    "attempts",
    "attempt_questions",
    "attempt_answer_keys",
    "attempt_responses",
    "quiz_reviews",
  ];

  for (const table of expectedTables) {
    assert.ok(
      migration01.includes(`public.${table}`),
      `Missing table definition or upgrade for public.${table}`,
    );
    const rlsRegex = new RegExp(
      `ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      "i",
    );
    assert.ok(
      rlsRegex.test(migration02),
      `RLS must be enabled on public.${table}`,
    );
  }
});

test("Database Integrity: composite foreign keys & soft delete & row locking", () => {
  assert.ok(
    migration01.includes("uq_question_options_id_question_id UNIQUE (id, question_id)"),
    "question_options must have UNIQUE (id, question_id)",
  );
  assert.ok(
    migration01.includes("fk_question_answers_correct_option_same_question"),
    "question_answers must enforce composite FK to question_options(id, question_id)",
  );
  assert.ok(
    migration01.includes("fk_attempt_responses_question_same_attempt"),
    "attempt_responses must enforce composite FK to attempt_questions(id, attempt_id)",
  );
  assert.ok(
    migration01.includes("REFERENCES public.quiz_sets(id) ON DELETE RESTRICT"),
    "attempts.quiz_set_id must use ON DELETE RESTRICT so history is preserved",
  );
  assert.ok(
    migration01.includes("FOR UPDATE"),
    "rpc_submit_attempt must lock attempt row using SELECT ... FOR UPDATE",
  );
  assert.ok(
    migration01.includes("ROUND((v_correct_count::NUMERIC / v_attempt.total_questions::NUMERIC) * 10.0, 2)"),
    "Score formula must be Correct Count / Total Questions * 10 rounded to 2 decimal places",
  );
});

test("Database Business Rules: triggers protect admin role & moderation workflow", () => {
  assert.ok(migration01.includes("trg_protect_profile_fields"));
  assert.ok(migration01.includes("trg_enforce_quiz_set_moderation_rules"));
  assert.ok(migration01.includes("trg_questions_invalidate_approval"));
  assert.ok(migration01.includes("trg_question_options_invalidate_approval"));
  assert.ok(migration01.includes("trg_question_answers_invalidate_approval"));
});

test("Security Grants: revokes direct SELECT/ALL on answer keys and direct writes on attempts", () => {
  assert.ok(
    migration02.includes(
      "REVOKE ALL ON TABLE public.question_answers FROM PUBLIC, anon, authenticated;",
    ),
    "question_answers must revoke ALL from anon & authenticated",
  );
  assert.ok(
    migration02.includes(
      "REVOKE ALL ON TABLE public.attempt_answer_keys FROM PUBLIC, anon, authenticated;",
    ),
    "attempt_answer_keys must revoke ALL from anon & authenticated",
  );
  assert.ok(
    migration02.includes(
      "REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.attempts FROM authenticated;",
    ),
    "authenticated users must not directly mutate attempts",
  );
});

test("Storage Migration: creates private buckets exam-documents and question-assets with public = false", () => {
  assert.ok(migration03.includes("'exam-documents'"));
  assert.ok(migration03.includes("'question-assets'"));
  assert.equal(
    /public\s*=\s*true/i.test(migration03),
    false,
    "Storage buckets must NOT have public = true",
  );
  assert.ok(migration03.includes("exam_documents_select_owner_or_admin"));
  assert.ok(migration03.includes("question_assets_select_owner_or_admin"));
});

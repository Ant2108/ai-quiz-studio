import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const FRONTEND_SRC = path.join(ROOT, "frontend", "src");
const FRONTEND_DIST = path.join(ROOT, "frontend", "dist");

function walkFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, result);
    } else {
      result.push(full);
    }
  }
  return result;
}

test("Frontend Security: ZERO secrets, Service Role keys, or Gemini API keys in src/ and dist/", () => {
  const srcFiles = walkFiles(FRONTEND_SRC);
  const distFiles = walkFiles(FRONTEND_DIST).filter((f) =>
    f.endsWith(".js") || f.endsWith(".html") || f.endsWith(".css"),
  );

  assert.ok(srcFiles.length > 20, "Frontend src files should exist");
  assert.ok(distFiles.length > 0, "Frontend dist build artifacts should exist");

  const forbiddenPatterns = [
    /GEMINI_API_KEY/i,
    /SUPABASE_SERVICE_ROLE_KEY/i,
    /AIza[0-9A-Za-z\-_]{25,}/,
    /sb_secret_[0-9A-Za-z\-_]+/,
    /generativelanguage\.googleapis\.com/i,
  ];

  for (const file of [...srcFiles, ...distFiles]) {
    const content = fs.readFileSync(file, "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.equal(
        pattern.test(content),
        false,
        `Forbidden secret or direct Gemini API call matched ${pattern} in ${path.relative(ROOT, file)}`,
      );
    }
  }
});

test("Frontend Security: Frontend NEVER queries question_answers or attempt_answer_keys directly", () => {
  const srcFiles = walkFiles(FRONTEND_SRC);
  for (const file of srcFiles) {
    const content = fs.readFileSync(file, "utf8");
    assert.equal(
      /\.from\(\s*['"`]question_answers['"`]\s*\)/.test(content),
      false,
      `Frontend must NEVER query question_answers directly (${path.relative(ROOT, file)})`,
    );
    assert.equal(
      /\.from\(\s*['"`]attempt_answer_keys['"`]\s*\)/.test(content),
      false,
      `Frontend must NEVER query attempt_answer_keys directly (${path.relative(ROOT, file)})`,
    );
    assert.equal(
      /\.from\(\s*['"`]attempts['"`]\s*\)\s*\.\s*(insert|update|delete)\(/.test(content),
      false,
      `Frontend must NEVER directly mutate attempts table (${path.relative(ROOT, file)})`,
    );
  }
});

test("Frontend Architecture: Required Service Layer and Hooks exist", () => {
  const requiredServices = [
    "supabaseClient.js",
    "authService.js",
    "documentService.js",
    "quizService.js",
    "attemptService.js",
    "adminService.js",
  ];
  for (const s of requiredServices) {
    assert.ok(
      fs.existsSync(path.join(FRONTEND_SRC, "services", s)),
      `Missing service: frontend/src/services/${s}`,
    );
  }

  const requiredHooks = [
    "useAuth.js",
    "useDocuments.js",
    "useQuiz.js",
    "useAttempt.js",
    "useAdmin.js",
  ];
  for (const h of requiredHooks) {
    assert.ok(
      fs.existsSync(path.join(FRONTEND_SRC, "hooks", h)),
      `Missing hook: frontend/src/hooks/${h}`,
    );
  }
});

test("GitHub Pages Deployment Configuration: 404 SPA fallback, workflow, and .env.example exist", () => {
  assert.ok(fs.existsSync(path.join(ROOT, ".github", "workflows", "deploy.yml")));
  assert.ok(fs.existsSync(path.join(ROOT, "frontend", "public", "404.html")));
  assert.ok(fs.existsSync(path.join(ROOT, "frontend", "dist", "404.html")));
  assert.ok(fs.existsSync(path.join(ROOT, "frontend", ".env.example")));

  const gitignore = fs.readFileSync(
    path.join(ROOT, "frontend", ".gitignore"),
    "utf8",
  );
  assert.ok(gitignore.includes(".env"), "frontend/.gitignore must ignore .env");
});

test("Frontend Validation: documentService.validateFileBeforeUpload validates formats and 20MB limit", async () => {
  const { validateFileBeforeUpload } = await import(
    "../frontend/src/services/documentService.js"
  );

  const okPdf = validateFileBeforeUpload({
    name: "tai-lieu-java.pdf",
    type: "application/pdf",
    size: 1024 * 1024,
  });
  assert.equal(okPdf.ext, "pdf");
  assert.equal(okPdf.mimeType, "application/pdf");

  const okDocx = validateFileBeforeUpload({
    name: "de-cuong.docx",
    type: "",
    size: 2048,
  });
  assert.equal(okDocx.ext, "docx");

  assert.throws(
    () =>
      validateFileBeforeUpload({
        name: "script.sh",
        type: "application/x-sh",
        size: 100,
      }),
    /không được hỗ trợ/,
  );

  assert.throws(
    () =>
      validateFileBeforeUpload({
        name: "big.pdf",
        type: "application/pdf",
        size: 25 * 1024 * 1024,
      }),
    /vượt quá giới hạn/,
  );
});

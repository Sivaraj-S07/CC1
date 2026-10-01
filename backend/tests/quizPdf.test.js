const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const bcrypt = require("bcryptjs");
const PDFDocument = require("pdfkit");
const { FakeDb } = require("./helpers/fakeSupabase");
const { startApp, seedRichQuiz, canonicalQuiz } = require("./helpers/harness");

async function exportClipboardJson(app, quizId) {
  const res = await fetch(`http://127.0.0.1:${app.port}/api/admin/quizzes/${quizId}/export`, {
    headers: { Authorization: `Bearer ${app.token}` },
  });
  const body = await res.json();
  return body.clipboard;
}

// Rebuilds a PDF in the *old* (pre-attachment) marker-text format, so we can
// verify import-pdf still accepts backups exported by the previous version.
function buildLegacyMarkerPdf(clipboard) {
  const BEGIN = "%%CODINGCLUB-QUIZ-BACKUP-BEGIN%%";
  const END = "%%CODINGCLUB-QUIZ-BACKUP-END%%";
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(14).text("Legacy-format quiz backup (for compatibility testing)");
    doc.addPage();
    doc.font("Courier").fontSize(7);
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(clipboard), "utf8"));
    const b64 = gz.toString("base64");
    const lines = [];
    for (let i = 0; i < b64.length; i += 90) lines.push(b64.slice(i, i + 90));
    doc.text(BEGIN);
    doc.text(lines.join("\n"));
    doc.text(END);
    doc.end();
  });
}

async function exportPdf(app, quizId) {
  const res = await fetch(`http://127.0.0.1:${app.port}/api/admin/quizzes/${quizId}/export-pdf`, {
    headers: { Authorization: `Bearer ${app.token}` },
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buffer };
}

async function importPdf(app, buffer, fields = {}, { filename = "backup.pdf", auth = app.token } = {}) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "application/pdf" }), filename);
  Object.entries(fields).forEach(([k, v]) => form.append(k, String(v)));
  const res = await fetch(`http://127.0.0.1:${app.port}/api/admin/quizzes/import-pdf`, {
    method: "POST",
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    body: form,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// A syntactically valid PDF with no Coding Club backup markers in it.
function plainPdfBuffer() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.text("Just an ordinary PDF, not a Coding Club backup.");
    doc.end();
  });
}

test("Export as PDF -> Import Quiz from PDF", async (t) => {
  const db = new FakeDb();
  const app = await startApp(db);
  t.after(() => app.close());
  const seed = await seedRichQuiz(db);

  await t.test("export-pdf returns a real PDF containing the embedded backup data", async () => {
    const { status, headers, buffer } = await exportPdf(app, seed.quiz.id);
    assert.equal(status, 200);
    assert.equal(headers.get("content-type"), "application/pdf");
    assert.ok(headers.get("content-disposition").includes("attachment"));
    assert.ok(headers.get("content-disposition").includes(".pdf"));
    assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.ok(buffer.length > 100);
  });

  await t.test("export-pdf on an unknown quiz is a 404", async () => {
    const { status } = await exportPdf(app, "00000000-0000-4000-8000-000000000000");
    assert.equal(status, 404);
  });

  await t.test("export-pdf requires admin auth", async () => {
    const res = await fetch(`http://127.0.0.1:${app.port}/api/admin/quizzes/${seed.quiz.id}/export-pdf`);
    assert.equal(res.status, 401);
  });

  await t.test("import-pdf recreates an identical but separate quiz", async () => {
    const before = db.tables.quizzes.length;
    const { buffer } = await exportPdf(app, seed.quiz.id);
    const { status, body } = await importPdf(app, buffer);
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(db.tables.quizzes.length, before + 1);
    assert.deepEqual(body.counts, { rounds: 3, questions: 5, options: 8 });
    assert.deepEqual(body.warnings, []);

    const copy = body.quiz;
    assert.notEqual(copy.id, seed.quiz.id);
    assert.equal(copy.title, "Data Structures Contest (Copy)");
    assert.equal(copy.status, "draft");
    assert.equal(copy.participantCount, 0);
    assert.equal(copy.questionCount, 5);

    // Structurally identical to the source (ignoring title/status, which
    // Import Quiz from PDF intentionally changes by default — same as Paste Quiz).
    const original = canonicalQuiz(db, seed.quiz.id, { ignoreQuizKeys: ["title", "status"] });
    const importedCanon = canonicalQuiz(db, copy.id, { ignoreQuizKeys: ["title", "status"] });
    assert.deepEqual(importedCanon, original);
  });

  await t.test("import-pdf keeps the original password by default, or takes a new one", async () => {
    const { buffer } = await exportPdf(app, seed.quiz.id);

    const same = await importPdf(app, buffer);
    const sameRow = db.tables.quizzes.find((q) => q.id === same.body.quiz.id);
    assert.ok(bcrypt.compareSync(seed.password, sameRow.password_hash));

    const changed = await importPdf(app, buffer, { password: "brand-new-1" });
    const changedRow = db.tables.quizzes.find((q) => q.id === changed.body.quiz.id);
    assert.ok(bcrypt.compareSync("brand-new-1", changedRow.password_hash));
    assert.ok(!bcrypt.compareSync(seed.password, changedRow.password_hash));

    // The password/hash never appears in the API response.
    assert.equal(JSON.stringify(same.body).toLowerCase().includes("password"), false);
  });

  await t.test("import-pdf honours a custom title and keepStatus", async () => {
    const { buffer } = await exportPdf(app, seed.quiz.id);
    const { status, body } = await importPdf(app, buffer, { title: "  Evening batch  ", keepStatus: true });
    assert.equal(status, 201);
    assert.equal(body.quiz.title, "Evening batch");
    assert.equal(body.quiz.status, "live");
  });

  await t.test("hidden test cases and coding-question details survive the PDF round trip", async () => {
    const { buffer } = await exportPdf(app, seed.quiz.id);
    const { body } = await importPdf(app, buffer);
    const coding = db.tables.questions.find(
      (q) => q.quiz_id === body.quiz.id && q.question_text === "Sum two numbers"
    );
    assert.equal(coding.question_type, "coding");
    assert.equal(coding.time_limit_ms, 5000);
    assert.deepEqual(coding.allowed_languages, ["python", "cpp"]);
    assert.equal(coding.test_cases.length, 2);
    assert.equal(coding.test_cases[1].hidden, true);
    assert.equal(coding.reference_solution, "print(sum(map(int,input().split())))");
  });

  await t.test("import-pdf requires admin auth", async () => {
    const { buffer } = await exportPdf(app, seed.quiz.id);
    const { status } = await importPdf(app, buffer, {}, { auth: null });
    assert.equal(status, 401);
  });

  await t.test("export-pdf is not gzip-encoded (served as-is, immune to proxy re-encoding issues)", async () => {
    const { headers } = await exportPdf(app, seed.quiz.id);
    assert.equal(headers.get("content-encoding"), null);
  });

  await t.test("import-pdf still accepts the legacy marker-text backup format (older exported PDFs)", async () => {
    const clipboard = await exportClipboardJson(app, seed.quiz.id);
    const legacyBuffer = await buildLegacyMarkerPdf(clipboard);
    const { status, body } = await importPdf(app, legacyBuffer);
    assert.equal(status, 201, JSON.stringify(body));
    assert.deepEqual(body.counts, { rounds: 3, questions: 5, options: 8 });
    const importedCanon = canonicalQuiz(db, body.quiz.id, { ignoreQuizKeys: ["title", "status"] });
    const original = canonicalQuiz(db, seed.quiz.id, { ignoreQuizKeys: ["title", "status"] });
    assert.deepEqual(importedCanon, original);
  });

  await t.test("import-pdf rejects a non-PDF file", async () => {
    const { status, body } = await importPdf(app, Buffer.from("hello world"), {}, { filename: "notes.txt" });
    assert.equal(status, 400);
    assert.match(body.message, /pdf/i);
  });

  await t.test("import-pdf rejects a PDF with no Coding Club backup data", async () => {
    const plain = await plainPdfBuffer();
    const { status, body } = await importPdf(app, plain);
    assert.equal(status, 400);
    assert.match(body.message, /backup data|Export as PDF/i);
  });

  await t.test("import-pdf rejects a corrupted / non-PDF byte stream", async () => {
    const { status, body } = await importPdf(app, Buffer.from([1, 2, 3, 4, 5]), {}, { filename: "broken.pdf" });
    assert.equal(status, 400);
    assert.ok(body.message);
  });
});

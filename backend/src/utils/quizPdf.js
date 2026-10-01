const zlib = require("zlib");
const PDFDocument = require("pdfkit");
const { PDFDocument: PDFLibDocument, PDFName, decodePDFRawStream } = require("pdf-lib");
const pdfParse = require("pdf-parse");
const { ApiError } = require("./asyncHandler");
const { CLIPBOARD_FORMAT, CLIPBOARD_VERSION } = require("../controllers/adminQuizCloneController");

/**
 * Quiz Backup PDF
 * ---------------
 * The PDF has two parts:
 *   1. A human-readable report — quiz settings, rounds, questions, options,
 *      correct answers, test cases — for the admin to read or print.
 *   2. A genuine embedded file attachment (visible in any PDF reader's
 *      "Attachments" panel) named `coding-club-quiz-backup.json.gz`: the
 *      exact same clipboard snapshot used by Copy Quiz / Paste Quiz (see
 *      adminQuizCloneController), gzip-compressed.
 *
 * Re-importing reads that attachment directly out of the PDF's own object
 * structure (via pdf-lib) and reverses the encoding to get back the exact
 * same clipboard object — a byte-exact extraction, not a reconstruction of
 * printed text. This is deliberately NOT based on scraping the rendered
 * text layer: text extraction depends on how a particular PDF-parsing
 * library reinterprets fonts/encoding/layout and can behave differently
 * across environments, which made the previous (text-marker) approach
 * fragile. A PDF file attachment is read the same way everywhere.
 *
 * For backward compatibility, importing also still recognises the older
 * marker-based text encoding used by PDFs exported before this change (see
 * `BACKUP_MARKER_BEGIN`/`END` and `extractFromMarkerText` below).
 */

const ATTACHMENT_NAME = "coding-club-quiz-backup.json.gz";
const ATTACHMENT_MIME = "application/gzip";

// Some PDFs floating around (e.g. exported by an earlier build of this same
// feature, or by the "Demo Quizzes" seed data) embed the payload as plain
// (non-gzipped) JSON under the name "coding-club-quiz.json", using a
// different, camelCase schema: `{ format: "coding-club-quiz", version: 1,
// quiz, rounds, questions, stats }`. `convertLegacyQuizExport` below
// translates that shape into the current `quiz-clipboard` shape so those
// PDFs import correctly instead of failing with "doesn't contain Coding
// Club backup data".
const LEGACY_EXPORT_FORMAT = "coding-club-quiz";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function convertLegacyQuizExport(obj) {
  if (!isPlainObject(obj) || obj.format !== LEGACY_EXPORT_FORMAT) return null;

  const src = isPlainObject(obj.quiz) ? obj.quiz : {};
  const rounds = Array.isArray(obj.rounds) ? obj.rounds : [];
  const questions = Array.isArray(obj.questions) ? obj.questions : [];

  const quizFields = {};
  const put = (key, value) => {
    if (value !== undefined) quizFields[key] = value;
  };
  put("title", src.title);
  put("description", src.description);
  if (typeof src.passwordHash === "string" && src.passwordHash) {
    quizFields.password_hash = src.passwordHash;
  }
  put("duration_minutes", src.durationMinutes);
  put("start_time", src.startTime);
  put("end_time", src.endTime);
  put("max_marks", src.maxMarks);
  put("passing_percentage", src.passingPercentage);
  put("max_attempts", src.maxAttempts);
  put("tab_switch_limit", src.tabSwitchLimit);
  put("randomize_questions", src.randomizeQuestions);
  put("randomize_options", src.randomizeOptions);
  put("auto_submit", src.autoSubmit);
  put("allow_late_join", src.allowLateJoin);
  put("show_leaderboard", src.showLeaderboard);
  put("status", src.status);

  const roundRefs = rounds.map((_, i) => String(i));
  const clipRounds = rounds.map((r, i) => ({
    ref: roundRefs[i],
    fields: {
      name: isPlainObject(r) ? r.name : undefined,
      description: isPlainObject(r) ? r.description ?? null : null,
      order_index: i,
      qualification_percentage: isPlainObject(r) && r.qualificationPercentage != null ? r.qualificationPercentage : 0,
    },
  }));

  const orderInRound = new Map();
  const nextOrder = (roundRef) => {
    const key = roundRef ?? "__none__";
    const n = orderInRound.get(key) || 0;
    orderInRound.set(key, n + 1);
    return n;
  };

  const clipQuestions = questions.map((qq, i) => {
    const q = isPlainObject(qq) ? qq : {};
    const roundRef =
      Number.isInteger(q.roundIndex) && roundRefs[q.roundIndex] !== undefined ? roundRefs[q.roundIndex] : null;

    const fields = {
      question_text: q.text,
      question_type: q.type,
      marks: q.marks,
      negative_marks: q.negativeMarks,
      order_index: nextOrder(roundRef),
      time_limit_seconds: q.timeLimitSeconds ?? null,
    };

    if (q.type === "fill_blank") {
      fields.blank_answers = q.blankAnswers;
      fields.case_sensitive = q.caseSensitive;
    }

    if (q.type === "coding") {
      fields.language = q.language;
      fields.allowed_languages = q.allowedLanguages;
      fields.problem_statement = q.problemStatement;
      fields.input_format = q.inputFormat;
      fields.output_format = q.outputFormat;
      fields.constraints_text = q.constraintsText;
      fields.sample_io = q.sampleIo;
      fields.test_cases = q.testCases;
      fields.time_limit_ms = q.timeLimitMs;
      fields.starter_code = q.starterCode;
      fields.expected_output = q.expectedOutput;
      fields.reference_solution = q.referenceSolution;
    }

    const options = Array.isArray(q.options)
      ? q.options.map((o, oi) => ({
          option_text: isPlainObject(o) ? o.text : "",
          is_correct: isPlainObject(o) ? !!o.isCorrect : false,
          order_index: oi,
        }))
      : [];

    return { ref: String(i), roundRef, fields, options };
  });

  return {
    format: CLIPBOARD_FORMAT,
    version: CLIPBOARD_VERSION,
    copiedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : new Date().toISOString(),
    source: { title: src.title, status: src.status },
    quiz: quizFields,
    rounds: clipRounds,
    questions: clipQuestions,
  };
}

// Legacy (v1) encoding: the payload was printed as plain text between these
// markers instead of being attached. Only used as a fallback on import, for
// PDFs exported by the previous version of this feature.
const BACKUP_MARKER_BEGIN = "%%CODINGCLUB-QUIZ-BACKUP-BEGIN%%";
const BACKUP_MARKER_END = "%%CODINGCLUB-QUIZ-BACKUP-END%%";

const MAX_PDF_BYTES = 20 * 1024 * 1024;

const INK = "#1a1d29";
const MUTED = "#6b7280";
const ACCENT = "#4338ca";
const GOOD = "#15803d";
const RULE = "#d1d5db";

const QUIZ_KNOWN_KEYS = new Set([
  "title",
  "description",
  "password_hash",
  "duration_minutes",
  "start_time",
  "end_time",
  "max_marks",
  "passing_percentage",
  "max_attempts",
  "randomize_questions",
  "randomize_options",
  "auto_submit",
  "allow_late_join",
  "show_leaderboard",
  "tab_switch_limit",
  "status",
]);
const QUESTION_KNOWN_KEYS = new Set([
  "question_text",
  "question_type",
  "marks",
  "negative_marks",
  "order_index",
  "time_limit_seconds",
  "language",
  "starter_code",
  "expected_output",
  "reference_solution",
  "problem_statement",
  "input_format",
  "output_format",
  "constraints_text",
  "sample_io",
  "test_cases",
  "time_limit_ms",
  "allowed_languages",
  "blank_answers",
  "case_sensitive",
]);

function fmtBool(v) {
  return v ? "Yes" : "No";
}
function fmtDate(v) {
  if (!v) return "Not set";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
function labelize(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
function safeText(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function drawRule(doc) {
  const y = doc.y;
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor(RULE)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.6);
}

function sectionHeading(doc, text) {
  doc.moveDown(0.9);
  doc.font("Helvetica-Bold").fontSize(14).fillColor(ACCENT).text(text);
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10).fillColor(INK);
}

function kv(doc, label, value, { indent = 0 } = {}) {
  const pad = " ".repeat(indent);
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(`${pad}${label}: `, { continued: true });
  doc.font("Helvetica").fillColor(INK).text(safeText(value));
}

function renderExtraFields(doc, fields, knownKeys, skipKeys) {
  const extra = Object.entries(fields).filter(
    ([k, v]) => !knownKeys.has(k) && !skipKeys.has(k) && v !== null && v !== undefined && v !== ""
  );
  if (!extra.length) return;
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("Additional settings:");
  extra.forEach(([k, v]) => kv(doc, labelize(k), v, { indent: 2 }));
  doc.fillColor(INK);
}

function renderTitlePage(doc, clipboard, summary) {
  const q = clipboard.quiz;
  doc.font("Helvetica-Bold").fontSize(22).fillColor(INK).text(q.title || "Untitled quiz");
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text("Coding Club — Quiz Backup Report");
  doc.moveDown(0.8);
  if (q.description) {
    doc.font("Helvetica").fontSize(11).fillColor(INK).text(q.description);
    doc.moveDown(0.8);
  }
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  doc.text(`Generated: ${fmtDate(summary.generatedAt)}`);
  doc.text(`Original status: ${q.status || "draft"}`);
  doc.text(
    `${summary.rounds} round${summary.rounds === 1 ? "" : "s"} · ${summary.questions} question${
      summary.questions === 1 ? "" : "s"
    } · ${summary.options} option${summary.options === 1 ? "" : "s"}`
  );
  doc.moveDown(0.8);
  drawRule(doc);
}

function renderSettings(doc, clipboard) {
  const q = clipboard.quiz;
  sectionHeading(doc, "Quiz Settings");
  kv(doc, "Duration", q.duration_minutes != null ? `${q.duration_minutes} minutes` : "—");
  kv(doc, "Start time", fmtDate(q.start_time));
  kv(doc, "End time", fmtDate(q.end_time));
  kv(doc, "Max marks", q.max_marks ?? "—");
  kv(doc, "Passing percentage", q.passing_percentage != null ? `${q.passing_percentage}%` : "—");
  kv(doc, "Max attempts", q.max_attempts ?? "—");
  kv(doc, "Randomize questions", fmtBool(q.randomize_questions));
  kv(doc, "Randomize options", fmtBool(q.randomize_options));
  kv(doc, "Auto submit", fmtBool(q.auto_submit));
  kv(doc, "Allow late join", fmtBool(q.allow_late_join));
  kv(doc, "Show leaderboard", fmtBool(q.show_leaderboard));
  kv(doc, "Tab switch limit", q.tab_switch_limit ?? "—");
  kv(
    doc,
    "Password",
    "Protected (encrypted) — not printed here for security. It is restored automatically when this PDF is imported, so the original password keeps working."
  );
  renderExtraFields(doc, q, QUIZ_KNOWN_KEYS, new Set(["title", "description"]));
}

function groupQuestionsByRound(clipboard) {
  const byRound = new Map();
  clipboard.rounds.forEach((r) => byRound.set(r.ref, []));
  const unassigned = [];
  clipboard.questions.forEach((q) => {
    if (q.roundRef && byRound.has(q.roundRef)) byRound.get(q.roundRef).push(q);
    else unassigned.push(q);
  });
  return { byRound, unassigned };
}

function renderQuestion(doc, q, index) {
  const f = q.fields;
  const type = f.question_type || "mcq";
  const typeLabel = type === "mcq" ? "Multiple Choice" : type === "coding" ? "Programming" : "Fill in the Blank";

  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(`Q${index}. `, { continued: true });
  doc.font("Helvetica").text(safeText(f.question_text));

  const meta = [`${typeLabel}`, `${f.marks ?? 0} marks`];
  if (f.negative_marks) meta.push(`-${f.negative_marks} negative`);
  if (f.time_limit_seconds) meta.push(`${f.time_limit_seconds}s limit`);
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(`   ${meta.join(" · ")}`);
  doc.fillColor(INK);

  if (type === "mcq") {
    (q.options || []).forEach((o, i) => {
      doc.font(o.is_correct ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(o.is_correct ? GOOD : INK);
      doc.text(`   ${String.fromCharCode(65 + i)}. ${safeText(o.option_text)}${o.is_correct ? "   ✓ Correct answer" : ""}`);
    });
    if (!q.options || !q.options.length) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("   (No options)");
    }
    doc.fillColor(INK);
  } else if (type === "fill_blank") {
    const blanks = Array.isArray(f.blank_answers) ? f.blank_answers : [];
    blanks.forEach((accepted, i) => {
      const list = (Array.isArray(accepted) ? accepted : [accepted]).join(", ") || "—";
      doc.font("Helvetica").fontSize(9.5).fillColor(GOOD).text(`   Blank ${i + 1} accepted answers: ${list}`);
    });
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(`   Case sensitive: ${fmtBool(f.case_sensitive)}`);
    doc.fillColor(INK);
  } else if (type === "coding") {
    doc.font("Helvetica").fontSize(9).fillColor(INK);
    if (f.problem_statement) kv(doc, "Problem", f.problem_statement, { indent: 2 });
    if (f.input_format) kv(doc, "Input format", f.input_format, { indent: 2 });
    if (f.output_format) kv(doc, "Output format", f.output_format, { indent: 2 });
    if (f.constraints_text) kv(doc, "Constraints", f.constraints_text, { indent: 2 });
    kv(doc, "Allowed languages", (f.allowed_languages || []).join(", ") || f.language || "—", { indent: 2 });
    kv(doc, "Time limit", f.time_limit_ms ? `${f.time_limit_ms} ms` : "—", { indent: 2 });

    const sampleIo = Array.isArray(f.sample_io) ? f.sample_io : [];
    sampleIo.forEach((s, i) => {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(`   Sample ${i + 1}`);
      doc.font("Courier").fontSize(8).fillColor(MUTED);
      doc.text(`     Input:  ${safeText(s.input)}`);
      doc.text(`     Output: ${safeText(s.output)}`);
      if (s.explanation) doc.text(`     Explanation: ${safeText(s.explanation)}`);
      doc.fillColor(INK);
    });

    const testCases = Array.isArray(f.test_cases) ? f.test_cases : [];
    if (testCases.length) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(`   Test cases (${testCases.length}):`);
      doc.font("Courier").fontSize(7.5).fillColor(MUTED);
      testCases.forEach((t, i) => {
        const visibility = t.hidden === false ? "visible" : "hidden";
        doc.text(`     ${i + 1}. ${safeText(t.name || `Test ${i + 1}`)} (${visibility})`);
        doc.text(`        Input:            ${safeText(t.input)}`);
        doc.text(`        Expected output:  ${safeText(t.expectedOutput ?? t.expected_output ?? t.output)}`);
      });
      doc.fillColor(INK);
    }

    if (f.reference_solution) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text("   Reference solution:");
      doc.font("Courier").fontSize(7.5).fillColor(MUTED).text(safeText(f.reference_solution));
      doc.fillColor(INK);
    }
    if (f.expected_output) kv(doc, "Expected output", f.expected_output, { indent: 2 });
  }

  renderExtraFields(doc, f, QUESTION_KNOWN_KEYS, new Set());
}

function renderRoundsAndQuestions(doc, clipboard) {
  const { byRound, unassigned } = groupQuestionsByRound(clipboard);

  clipboard.rounds.forEach((r, ri) => {
    sectionHeading(doc, `Round ${ri + 1}: ${r.fields.name || "Untitled round"}`);
    if (r.fields.description) {
      doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(r.fields.description);
      doc.fillColor(INK);
    }
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(
        `Qualification to advance: ${
          r.fields.qualification_percentage ? `${r.fields.qualification_percentage}%` : "None"
        }`
      );
    doc.fillColor(INK);
    renderExtraFields(doc, r.fields, new Set(["name", "description", "order_index", "qualification_percentage"]), new Set());

    const qs = byRound.get(r.ref) || [];
    qs.forEach((q, qi) => renderQuestion(doc, q, qi + 1));
    if (!qs.length) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("   (No questions in this round)");
      doc.fillColor(INK);
    }
  });

  if (unassigned.length) {
    sectionHeading(doc, "Unassigned Questions");
    unassigned.forEach((q, qi) => renderQuestion(doc, q, qi + 1));
  }

  if (!clipboard.rounds.length && !unassigned.length) {
    sectionHeading(doc, "Questions");
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text("This quiz has no questions yet.");
    doc.fillColor(INK);
  }
}

function renderBackupDataNotice(doc, quizTitle) {
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Machine-Readable Backup Data");
  doc.moveDown(0.3);
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor(MUTED)
    .text(
      `A compressed, exact copy of everything above is attached to this PDF as a file named "${ATTACHMENT_NAME}" ` +
        '(visible in your PDF viewer\'s Attachments panel). This is what "Import Quiz from PDF" reads to recreate ' +
        `"${quizTitle || "this quiz"}" exactly — including the password, hidden test cases and every setting. ` +
        "Keep this PDF intact (don't remove the attachment) to use it as a full backup."
    );
  doc.fillColor(INK);
}

// Numbers every page of the human-readable report.
function addFooters(doc, quizTitle) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.height - doc.page.margins.bottom + 16;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(MUTED)
      .text(`${quizTitle || "Quiz"} · Page ${i + 1} of ${total}`, doc.page.margins.left, bottom, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
      });
  }
}

// Renders the human-readable report (pdfkit is excellent at flowing,
// paginated text — this part is unchanged from before).
function buildReportBuffer(clipboard, summary) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 48,
        bufferPages: true,
        autoFirstPage: true,
        info: { Title: `${clipboard?.quiz?.title || "Quiz"} — Backup` },
      });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      renderTitlePage(doc, clipboard, summary);
      renderSettings(doc, clipboard);
      renderRoundsAndQuestions(doc, clipboard);
      renderBackupDataNotice(doc, clipboard?.quiz?.title);

      addFooters(doc, clipboard?.quiz?.title);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Builds the full backup PDF (human-readable report + embedded attachment)
 * for a quiz clipboard snapshot.
 * @param {object} clipboard - as returned by loadQuizClipboard().clipboard
 * @param {object} [summary] - { generatedAt, rounds, questions, options }
 * @returns {Promise<Buffer>}
 */
async function buildQuizPdfBuffer(clipboard, summary = {}) {
  const reportBuffer = await buildReportBuffer(clipboard, summary);

  const json = JSON.stringify(clipboard);
  const gz = zlib.gzipSync(Buffer.from(json, "utf8"));

  // pdf-lib reliably loads any spec-conformant PDF (including pdfkit's
  // output) and gives us a standard, byte-exact file-attachment mechanism —
  // this is the part that makes import robust across environments.
  const pdfLibDoc = await PDFLibDocument.load(reportBuffer);
  await pdfLibDoc.attach(gz, ATTACHMENT_NAME, {
    mimeType: ATTACHMENT_MIME,
    description: "Coding Club machine-readable quiz backup — do not edit.",
  });
  const finalBytes = await pdfLibDoc.save();
  return Buffer.from(finalBytes);
}

// ---------------------------------------------------------------------------
// IMPORT
// ---------------------------------------------------------------------------

// Primary path: read the embedded file attachment directly out of the PDF's
// object structure. Byte-exact; does not depend on any text/font
// interpretation, so it behaves identically in every environment.
async function extractFromAttachment(buffer) {
  let pdfLibDoc;
  try {
    pdfLibDoc = await PDFLibDocument.load(buffer, { updateMetadata: false });
  } catch {
    return null;
  }

  try {
    const context = pdfLibDoc.context;
    const namesRef = pdfLibDoc.catalog.get(PDFName.of("Names"));
    if (!namesRef) return null;
    const namesDict = context.lookup(namesRef);
    if (!namesDict) return null;
    const efRef = namesDict.get(PDFName.of("EmbeddedFiles"));
    if (!efRef) return null;
    const efDict = context.lookup(efRef);
    if (!efDict) return null;

    // Collect [name, fileSpecRef] pairs from a flat Names array, or from a
    // Kids-based name tree if a differently-produced PDF used one.
    const pairs = [];
    const collectFromNamesArray = (arrRef) => {
      const arr = context.lookup(arrRef);
      if (!arr || typeof arr.size !== "function") return;
      for (let i = 0; i + 1 < arr.size(); i += 2) {
        pairs.push([arr.get(i), arr.get(i + 1)]);
      }
    };
    const namesArrRef = efDict.get(PDFName.of("Names"));
    if (namesArrRef) collectFromNamesArray(namesArrRef);
    const kidsRef = efDict.get(PDFName.of("Kids"));
    if (kidsRef) {
      const kids = context.lookup(kidsRef);
      if (kids && typeof kids.size === "function") {
        for (let i = 0; i < kids.size(); i++) {
          const kid = context.lookup(kids.get(i));
          const kidNamesRef = kid && kid.get(PDFName.of("Names"));
          if (kidNamesRef) collectFromNamesArray(kidNamesRef);
        }
      }
    }
    if (!pairs.length) return null;

    let candidate = null;
    for (const [nameObj, fileSpecRef] of pairs) {
      const name = typeof nameObj?.decodeText === "function" ? nameObj.decodeText() : String(nameObj?.asString?.() || "");
      const fileSpec = context.lookup(fileSpecRef);
      if (!fileSpec) continue;
      const efInner = context.lookup(fileSpec.get(PDFName.of("EF")));
      if (!efInner) continue;
      const fRef = efInner.get(PDFName.of("F")) || efInner.get(PDFName.of("UF"));
      const rawStream = context.lookup(fRef);
      if (!rawStream) continue;
      if (name.includes("coding-club-quiz-backup") || pairs.length === 1) {
        candidate = rawStream;
        if (name.includes("coding-club-quiz-backup")) break;
      }
    }
    if (!candidate) return null;

    // `decodePDFRawStream(...).decode()` already reverses the PDF's own
    // stream filter (e.g. /FlateDecode). The current exporter additionally
    // gzips the JSON before that, so the normal path is to gunzip once more
    // here. Some PDFs (see `LEGACY_EXPORT_FORMAT` above) only apply the PDF's
    // own compression and store plain JSON underneath, with no extra gzip
    // layer — gunzip on that data throws, so fall back to treating the
    // decoded bytes as JSON directly rather than failing the whole import.
    const decoded = Buffer.from(decodePDFRawStream(candidate).decode());
    let json;
    try {
      json = zlib.gunzipSync(decoded).toString("utf8");
    } catch {
      json = decoded.toString("utf8");
    }

    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      return null;
    }

    if (isPlainObject(parsed) && parsed.format === CLIPBOARD_FORMAT) return parsed;
    return convertLegacyQuizExport(parsed) || parsed;
  } catch {
    return null;
  }
}

// Legacy fallback: PDFs exported by the previous version of this feature
// carried the payload as plain marker-delimited text instead of a real
// attachment. Kept so those PDFs remain importable.
async function extractFromMarkerText(buffer) {
  let text;
  try {
    const data = await pdfParse(buffer);
    text = data.text || "";
  } catch {
    return null;
  }

  const beginIdx = text.indexOf(BACKUP_MARKER_BEGIN);
  const endIdx = text.indexOf(BACKUP_MARKER_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return null;

  const rawPayload = text.slice(beginIdx + BACKUP_MARKER_BEGIN.length, endIdx);
  const b64 = rawPayload.replace(/\s+/g, "");
  if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return null;

  try {
    const gz = Buffer.from(b64, "base64");
    const json = zlib.gunzipSync(gz).toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Reads a previously exported backup PDF back into a clipboard snapshot.
 * Throws a user-facing ApiError on anything that isn't a valid backup.
 * @param {Buffer} buffer
 * @returns {Promise<object>} clipboard
 */
async function parseQuizPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    throw new ApiError(400, "The uploaded file is empty or not a valid PDF.");
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw new ApiError(400, `The uploaded PDF is too large (max ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB).`);
  }
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new ApiError(400, "That file doesn't look like a PDF.");
  }

  const clipboard = (await extractFromAttachment(buffer)) || (await extractFromMarkerText(buffer));

  if (!clipboard) {
    throw new ApiError(
      400,
      'This PDF doesn\'t contain Coding Club backup data. Only a PDF from Admin → Quizzes → "Export as PDF" can be imported.'
    );
  }

  return clipboard;
}

module.exports = {
  buildQuizPdfBuffer,
  parseQuizPdfBuffer,
  ATTACHMENT_NAME,
  BACKUP_MARKER_BEGIN,
  BACKUP_MARKER_END,
  MAX_PDF_BYTES,
};

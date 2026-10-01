const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { getSupabase } = require("../config/supabaseClient");
const { asyncHandler, ApiError } = require("../utils/asyncHandler");
const { quizPublicShape } = require("./adminQuizController");
const {
  roundsSupported,
  questionTimeLimitSupported,
  codingJudgeSupported,
} = require("../utils/featureSupport");

/**
 * Copy Quiz / Paste Quiz  +  Export as PDF / Import Quiz from PDF
 * -----------------------------------------------------------------
 * GET  /api/admin/quizzes/:id/export       -> a self-contained JSON snapshot
 *                                              ("clipboard") of the quiz.
 * POST /api/admin/quizzes/paste            -> builds a brand-new, independent
 *                                              quiz from such a snapshot.
 * GET  /api/admin/quizzes/:id/export-pdf   -> the same snapshot, embedded in
 *                                              a human-readable PDF report
 *                                              (see adminQuizPdfController.js).
 * POST /api/admin/quizzes/import-pdf       -> reads that PDF back into a
 *                                              snapshot and pastes it.
 *
 * The snapshot ("clipboard") is a faithful copy of the database rows (not the
 * trimmed API shape), so every column — including ones added by later
 * migrations — is carried over untouched. Only identity/bookkeeping columns
 * (ids, foreign keys, timestamps) are dropped and regenerated on paste.
 * Student-side data (attempts, answers, attendance, timings, notifications)
 * is deliberately NOT part of a quiz copy: the pasted quiz starts with zero
 * participants.
 *
 * `loadQuizClipboard`, `validateClipboard` and `buildQuizFromClipboard` below
 * are the shared building blocks: both the JSON clipboard routes and the PDF
 * routes call the exact same code, so a quiz restored from a PDF is byte-for-
 * byte as faithful as one pasted from copied JSON.
 */

const CLIPBOARD_FORMAT = "quiz-clipboard";
const CLIPBOARD_VERSION = 1;

const MAX_ROUNDS = 200;
const MAX_QUESTIONS = 2000;
const MAX_OPTIONS_PER_QUESTION = 100;

const QUIZ_STATUSES = ["draft", "upcoming", "live", "completed"];
const QUESTION_TYPES = ["mcq", "coding", "fill_blank"];

// Columns regenerated (or re-linked) on paste, so they never travel in a snapshot.
const QUIZ_STRIP = new Set(["id", "created_at", "updated_at"]);
const ROUND_STRIP = new Set(["id", "quiz_id", "created_at", "updated_at"]);
const QUESTION_STRIP = new Set(["id", "quiz_id", "round_id", "created_at", "updated_at", "quiz_options"]);

// Question columns that only exist once the corresponding migration has run.
const JUDGE_COLUMNS = [
  "problem_statement",
  "input_format",
  "output_format",
  "constraints_text",
  "sample_io",
  "test_cases",
  "time_limit_ms",
  "allowed_languages",
];

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const SAFE_COLUMN = /^[a-z][a-z0-9_]*$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Copies an object minus the stripped keys, refusing anything that is not a
// plain snake_case column name (defends against odd keys in pasted JSON).
function pickColumns(source, stripSet) {
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (stripSet.has(key)) continue;
    if (!SAFE_COLUMN.test(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function hasContent(value) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function chunk(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
}

// PostgREST caps a single response at 1000 rows by default, so page through.
async function fetchAllRows(buildQuery) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return { data: rows, error: null };
}

// ---------------------------------------------------------------------------
// COPY / EXPORT
// ---------------------------------------------------------------------------

/**
 * Builds the clipboard snapshot for one quiz. Shared by the JSON "Copy Quiz"
 * route and the "Export as PDF" route.
 * @returns {Promise<{clipboard: object, quiz: object}>} quiz is the raw DB row
 *   (used e.g. for its title when naming a downloaded file).
 */
async function loadQuizClipboard(quizId) {
  const supabase = getSupabase();

  const { data: quiz, error: quizError } = await supabase
    .from("quizzes")
    .select("*")
    .eq("id", quizId)
    .maybeSingle();
  if (quizError) throw new ApiError(500, "Failed to load quiz", quizError.message);
  if (!quiz) throw new ApiError(404, "Quiz not found");

  let rounds = [];
  if (await roundsSupported()) {
    const { data, error } = await supabase
      .from("rounds")
      .select("*")
      .eq("quiz_id", quizId)
      .order("order_index", { ascending: true });
    if (error) throw new ApiError(500, "Failed to load rounds", error.message);
    rounds = data || [];
  }

  const { data: questions, error: questionError } = await fetchAllRows(() =>
    supabase
      .from("questions")
      .select("*, quiz_options(*)")
      .eq("quiz_id", quizId)
      .order("order_index", { ascending: true })
      .order("id", { ascending: true })
  );
  if (questionError) throw new ApiError(500, "Failed to load questions", questionError.message);

  const roundRank = new Map(rounds.map((r, i) => [r.id, i]));
  const orderedQuestions = (questions || [])
    .map((q, i) => ({ q, i }))
    .sort((a, b) => {
      const ra = a.q.round_id ? roundRank.get(a.q.round_id) ?? 9998 : 9999;
      const rb = b.q.round_id ? roundRank.get(b.q.round_id) ?? 9998 : 9999;
      if (ra !== rb) return ra - rb;
      return a.i - b.i;
    })
    .map((x) => x.q);

  const clipboard = {
    format: CLIPBOARD_FORMAT,
    version: CLIPBOARD_VERSION,
    copiedAt: new Date().toISOString(),
    source: { quizId: quiz.id, title: quiz.title, status: quiz.status },
    quiz: pickColumns(quiz, QUIZ_STRIP),
    rounds: rounds.map((r) => ({ ref: r.id, fields: pickColumns(r, ROUND_STRIP) })),
    questions: orderedQuestions.map((q) => ({
      ref: q.id,
      roundRef: q.round_id || null,
      fields: pickColumns(q, QUESTION_STRIP),
      options: (q.quiz_options || [])
        .slice()
        .sort((a, b) => a.order_index - b.order_index)
        .map((o) => ({
          option_text: o.option_text,
          is_correct: !!o.is_correct,
          order_index: o.order_index,
        })),
    })),
  };

  return { clipboard, quiz };
}

const exportQuiz = asyncHandler(async (req, res) => {
  const { clipboard } = await loadQuizClipboard(req.params.id);
  res.json({
    success: true,
    clipboard,
    summary: {
      title: clipboard.quiz.title,
      rounds: clipboard.rounds.length,
      questions: clipboard.questions.length,
    },
  });
});

// ---------------------------------------------------------------------------
// PASTE / IMPORT
// ---------------------------------------------------------------------------
function validateClipboard(clipboard) {
  const problems = [];
  if (!isPlainObject(clipboard) || clipboard.format !== CLIPBOARD_FORMAT) {
    throw new ApiError(400, "This is not copied quiz data. Copy a quiz first, then paste it.");
  }
  if (clipboard.version !== CLIPBOARD_VERSION) {
    throw new ApiError(400, `Unsupported copied-quiz version: ${clipboard.version}`);
  }
  if (!isPlainObject(clipboard.quiz)) problems.push("quiz is missing");
  if (!Array.isArray(clipboard.rounds)) problems.push("rounds must be a list");
  if (!Array.isArray(clipboard.questions)) problems.push("questions must be a list");
  if (problems.length) throw new ApiError(400, "Copied quiz data is damaged", problems);

  if (clipboard.rounds.length > MAX_ROUNDS) problems.push(`too many rounds (max ${MAX_ROUNDS})`);
  if (clipboard.questions.length > MAX_QUESTIONS) problems.push(`too many questions (max ${MAX_QUESTIONS})`);

  const roundRefs = new Set();
  clipboard.rounds.forEach((r, i) => {
    if (!isPlainObject(r) || !isPlainObject(r.fields) || !r.ref) {
      problems.push(`round ${i + 1} is malformed`);
      return;
    }
    if (typeof r.fields.name !== "string" || !r.fields.name.trim()) problems.push(`round ${i + 1} has no name`);
    roundRefs.add(r.ref);
  });

  clipboard.questions.forEach((q, i) => {
    if (!isPlainObject(q) || !isPlainObject(q.fields)) {
      problems.push(`question ${i + 1} is malformed`);
      return;
    }
    if (typeof q.fields.question_text !== "string" || !q.fields.question_text.trim())
      problems.push(`question ${i + 1} has no text`);
    if (q.fields.question_type !== undefined && !QUESTION_TYPES.includes(q.fields.question_type))
      problems.push(`question ${i + 1} has an unknown type`);
    const options = q.options === undefined ? [] : q.options;
    if (!Array.isArray(options) || options.length > MAX_OPTIONS_PER_QUESTION) {
      problems.push(`question ${i + 1} has invalid options`);
      return;
    }
    options.forEach((o, j) => {
      if (!isPlainObject(o) || typeof o.option_text !== "string")
        problems.push(`question ${i + 1}, option ${j + 1} is malformed`);
    });
  });

  if (problems.length) throw new ApiError(400, "Copied quiz data is damaged", problems.slice(0, 10));
}

async function deleteQuizQuietly(supabase, quizId) {
  try {
    // rounds / questions / options are removed by ON DELETE CASCADE.
    const { error } = await supabase.from("quizzes").delete().eq("id", quizId);
    if (error) console.error("[buildQuizFromClipboard] cleanup of partial quiz failed:", error.message);
  } catch (err) {
    console.error("[buildQuizFromClipboard] cleanup of partial quiz failed:", err);
  }
}

/**
 * Builds a brand-new, independent quiz (rounds, questions, options) from an
 * already-validated clipboard snapshot. Shared by the JSON "Paste Quiz" route
 * and the "Import Quiz from PDF" route — callers must call
 * `validateClipboard(clipboard)` first.
 *
 * @param {object} clipboard
 * @param {object} [options]
 * @param {string} [options.title] - overrides the "(Copy)" title
 * @param {string} [options.password] - overrides the copied password
 * @param {boolean} [options.keepStatus] - keep the original status instead of "draft"
 * @returns {Promise<{quiz: object, counts: object, warnings: string[]}>}
 */
async function buildQuizFromClipboard(clipboard, options = {}) {
  const supabase = getSupabase();
  const source = clipboard.quiz;

  // ---- title / password / status ------------------------------------------
  const originalTitle = typeof source.title === "string" && source.title.trim() ? source.title.trim() : "Untitled quiz";
  const requestedTitle = typeof options.title === "string" ? options.title.trim() : "";
  const title = requestedTitle || `${originalTitle} (Copy)`;

  // Passwords are only stored hashed, so the copy carries the original hash:
  // the pasted quiz keeps the same password unless the admin sets a new one.
  let passwordHash;
  if (typeof options.password === "string" && options.password.length > 0) {
    passwordHash = bcrypt.hashSync(options.password, 10);
  } else if (typeof source.password_hash === "string" && BCRYPT_HASH.test(source.password_hash)) {
    passwordHash = source.password_hash;
  } else {
    throw new ApiError(400, "The copied quiz has no usable password. Enter a password for the new quiz.");
  }

  // A pasted quiz starts as a draft (so it can never go live by accident)
  // unless the admin explicitly asks to keep the original status.
  const keepStatus = options.keepStatus === true && QUIZ_STATUSES.includes(source.status);
  const status = keepStatus ? source.status : "draft";

  const [supportsRounds, supportsTimeLimit, supportsJudge] = await Promise.all([
    roundsSupported(),
    questionTimeLimitSupported(),
    codingJudgeSupported(),
  ]);

  const warnings = [];
  const counts = { rounds: 0, questions: 0, options: 0 };

  // ---- 1. the quiz row ------------------------------------------------------
  const quizRow = {
    ...pickColumns(source, QUIZ_STRIP),
    title,
    password_hash: passwordHash,
    status,
  };
  const { data: newQuiz, error: quizError } = await supabase
    .from("quizzes")
    .insert(quizRow)
    .select("*")
    .single();
  if (quizError) {
    console.error("[buildQuizFromClipboard] insert into quizzes failed:", quizError);
    throw new ApiError(500, "Failed to create quiz", quizError.message);
  }

  try {
    // ---- 2. rounds ----------------------------------------------------------
    const roundIdByRef = new Map();
    if (clipboard.rounds.length && !supportsRounds) {
      warnings.push("Rounds are not enabled on this database, so the copied rounds were skipped.");
    }
    if (supportsRounds && clipboard.rounds.length) {
      const roundRows = clipboard.rounds.map((r) => {
        const id = crypto.randomUUID();
        roundIdByRef.set(r.ref, id);
        return { ...pickColumns(r.fields, ROUND_STRIP), id, quiz_id: newQuiz.id };
      });
      const { error } = await supabase.from("rounds").insert(roundRows);
      if (error) {
        console.error("[buildQuizFromClipboard] insert into rounds failed:", error);
        throw new ApiError(500, "Failed to create rounds", error.message);
      }
      counts.rounds = roundRows.length;
    }

    // ---- 3. questions -------------------------------------------------------
    const questionRows = [];
    const optionRows = [];
    let droppedTimers = false;
    let droppedJudgeData = false;
    for (const q of clipboard.questions) {
      const id = crypto.randomUUID();
      const fields = pickColumns(q.fields, QUESTION_STRIP);
      if (!supportsTimeLimit) {
        if (fields.time_limit_seconds) droppedTimers = true;
        delete fields.time_limit_seconds;
      }
      if (!supportsJudge) {
        if (JUDGE_COLUMNS.some((c) => hasContent(fields[c]) && !(c === "time_limit_ms" && fields[c] === 3000)))
          droppedJudgeData = true;
        JUDGE_COLUMNS.forEach((c) => delete fields[c]);
      }

      const row = { ...fields, id, quiz_id: newQuiz.id };
      if (supportsRounds) row.round_id = (q.roundRef && roundIdByRef.get(q.roundRef)) || null;
      questionRows.push(row);

      (q.options || []).forEach((o, idx) => {
        optionRows.push({
          question_id: id,
          option_text: o.option_text,
          is_correct: !!o.is_correct,
          order_index: Number.isFinite(Number(o.order_index)) ? Number(o.order_index) : idx,
        });
      });
    }

    if (droppedTimers) {
      warnings.push("Per-question time limits are not enabled on this database, so they were not copied.");
    }
    if (droppedJudgeData) {
      warnings.push(
        "Programming-judge columns are missing on this database, so test cases and problem details were not copied. Run backend/sql/migration_programming_judge.sql."
      );
    }

    for (const part of chunk(questionRows, 100)) {
      const { error } = await supabase.from("questions").insert(part);
      if (error) {
        console.error("[buildQuizFromClipboard] insert into questions failed:", error);
        throw new ApiError(500, "Failed to create questions", error.message);
      }
    }
    counts.questions = questionRows.length;

    // ---- 4. options ---------------------------------------------------------
    for (const part of chunk(optionRows, 500)) {
      const { error } = await supabase.from("quiz_options").insert(part);
      if (error) {
        console.error("[buildQuizFromClipboard] insert into quiz_options failed:", error);
        throw new ApiError(500, "Failed to create options", error.message);
      }
    }
    counts.options = optionRows.length;
  } catch (err) {
    // All-or-nothing: never leave a half-built quiz behind.
    await deleteQuizQuietly(supabase, newQuiz.id);
    throw err;
  }

  return {
    quiz: {
      ...quizPublicShape(newQuiz),
      questionCount: counts.questions,
      participantCount: 0,
    },
    counts,
    warnings,
  };
}

const pasteQuiz = asyncHandler(async (req, res) => {
  const body = req.body || {};
  validateClipboard(body.clipboard);
  const result = await buildQuizFromClipboard(body.clipboard, {
    title: body.title,
    password: body.password,
    keepStatus: body.keepStatus,
  });
  res.status(201).json({ success: true, ...result });
});

module.exports = {
  exportQuiz,
  pasteQuiz,
  loadQuizClipboard,
  validateClipboard,
  buildQuizFromClipboard,
  CLIPBOARD_FORMAT,
  CLIPBOARD_VERSION,
};

const http = require("http");
const bcrypt = require("bcryptjs");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";

/**
 * Boots the real admin router (plus the same paste-size wiring server.js uses)
 * on an ephemeral port, backed by the in-memory FakeDb.
 */
let currentDb = null;
const supPath = require.resolve("../../src/config/supabaseClient");
// Controllers capture `getSupabase` when first loaded, so the stub delegates to
// whichever FakeDb the running test file selected last.
require.cache[supPath] = { id: supPath, filename: supPath, loaded: true, exports: { getSupabase: () => currentDb } };

async function startApp(db) {
  currentDb = db;

  const express = require("express");
  const { requireAdmin } = require("../../src/middleware/auth");
  const { notFoundHandler, errorHandler } = require("../../src/middleware/errorHandler");
  const { signAdminToken, signStudentToken } = require("../../src/utils/jwt");
  const adminRoutes = require("../../src/routes/admin");

  const app = express();
  app.post("/api/admin/quizzes/paste", requireAdmin, express.json({ limit: "10mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/admin", adminRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  const token = signAdminToken({ email: "admin@gmail.com" });

  async function api(method, path, body, { auth = token } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  return {
    api,
    port: server.address().port,
    token,
    studentToken: signStudentToken({ id: "s1" }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Inserts a rich quiz that exercises every column the copy must carry over. */
async function seedRichQuiz(db, { password = "secret-pass" } = {}) {
  const passwordHash = bcrypt.hashSync(password, 8);
  const { data: quiz } = await db
    .from("quizzes")
    .insert({
      title: "Data Structures Contest",
      description: "Weekly contest — 3 rounds",
      password_hash: passwordHash,
      duration_minutes: 45,
      start_time: "2026-10-01T09:00:00.000Z",
      end_time: "2026-10-01T12:00:00.000Z",
      max_marks: 27,
      passing_percentage: 55,
      max_attempts: 2,
      randomize_questions: false,
      randomize_options: false,
      auto_submit: false,
      allow_late_join: true,
      show_leaderboard: false,
      tab_switch_limit: 5,
      status: "live",
    })
    .select("*")
    .single();

  const rounds = [];
  for (const [i, r] of [
    { name: "Round 1 — Aptitude", description: "Warm-up", qualification_percentage: 50 },
    { name: "Round 2 — Coding", description: null, qualification_percentage: 60 },
    { name: "Round 3 — Fill", description: "Finals", qualification_percentage: 0 },
  ].entries()) {
    const { data } = await db.from("rounds").insert({ quiz_id: quiz.id, order_index: i, ...r }).select("*").single();
    rounds.push(data);
  }

  const mkQ = async (fields, options = []) => {
    const { data: q } = await db.from("questions").insert({ quiz_id: quiz.id, ...fields }).select("*").single();
    if (options.length) {
      await db.from("quiz_options").insert(options.map((o, i) => ({ question_id: q.id, order_index: i, ...o })));
    }
    return q;
  };

  const questions = [];
  questions.push(
    await mkQ(
      { round_id: rounds[0].id, question_text: "Which is O(1)?", marks: 2, negative_marks: 0.5, order_index: 0, time_limit_seconds: 60 },
      [
        { option_text: "Array index", is_correct: true },
        { option_text: "Linear scan", is_correct: false },
        { option_text: "Sort", is_correct: false },
        { option_text: "Binary search", is_correct: false },
      ]
    ),
    await mkQ(
      { round_id: rounds[0].id, question_text: "Stack is…", marks: 1, order_index: 1, time_limit_seconds: null },
      [
        { option_text: "FIFO", is_correct: false },
        { option_text: "LIFO", is_correct: true },
      ]
    ),
    await mkQ({
      round_id: rounds[1].id,
      question_text: "Sum two numbers",
      question_type: "coding",
      marks: 10,
      negative_marks: 2,
      order_index: 0,
      language: "python",
      starter_code: "def solve():\n    pass\n",
      expected_output: "7",
      reference_solution: "print(sum(map(int,input().split())))",
      problem_statement: "Read two ints and print the sum.",
      input_format: "a b",
      output_format: "a+b",
      constraints_text: "|a|,|b| <= 1e9",
      sample_io: [{ input: "3 4", output: "7", explanation: "3+4" }],
      test_cases: [
        { name: "t1", input: "3 4", expectedOutput: "7", hidden: false },
        { name: "t2", input: "10 20", expectedOutput: "30", hidden: true },
      ],
      time_limit_ms: 5000,
      allowed_languages: ["python", "cpp"],
      time_limit_seconds: 600,
    }),
    await mkQ({
      round_id: rounds[2].id,
      question_text: "Capital of France is ___ and its river is ___",
      question_type: "fill_blank",
      marks: 4,
      negative_marks: 1,
      order_index: 0,
      blank_answers: [["paris"], ["seine", "la seine"]],
      case_sensitive: true,
    }),
    // A question that lives in the "Unassigned" bucket.
    await mkQ(
      { round_id: null, question_text: "Unassigned MCQ", marks: 3, order_index: 0 },
      [
        { option_text: "A", is_correct: false },
        { option_text: "B", is_correct: true },
      ]
    )
  );

  // Student-side data that must NOT be copied.
  const { data: student } = await db.from("students").insert({ name: "Asha", register_number: "R1" }).select("*").single();
  const { data: attempt } = await db
    .from("quiz_attempts")
    .insert({ quiz_id: quiz.id, student_id: student.id, status: "submitted" })
    .select("*")
    .single();
  await db.from("answers").insert({ attempt_id: attempt.id, question_id: questions[0].id });
  await db.from("attendance").insert({ quiz_id: quiz.id, student_id: student.id });

  return { quiz, rounds, questions, password };
}

/**
 * Canonical, id-free description of a quiz (settings + rounds + questions +
 * options, with round links expressed by round position). Two quizzes with an
 * identical structure produce deeply-equal canonical forms.
 */
function canonicalQuiz(db, quizId, { ignoreQuizKeys = [] } = {}) {
  const quiz = db.tables.quizzes.find((q) => q.id === quizId);
  const strip = (row, keys) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));
  const rounds = db.tables.rounds
    .filter((r) => r.quiz_id === quizId)
    .sort((a, b) => a.order_index - b.order_index);
  const roundIndex = new Map(rounds.map((r, i) => [r.id, i]));
  const questions = db.tables.questions
    .filter((q) => q.quiz_id === quizId)
    .map((q) => ({
      ...strip(q, ["id", "quiz_id", "round_id", "created_at", "updated_at"]),
      roundIndex: q.round_id ? roundIndex.get(q.round_id) : null,
      options: db.tables.quiz_options
        .filter((o) => o.question_id === q.id)
        .sort((a, b) => a.order_index - b.order_index)
        .map((o) => strip(o, ["id", "question_id"])),
    }))
    .sort((a, b) =>
      (a.roundIndex ?? 99) - (b.roundIndex ?? 99) ||
      a.order_index - b.order_index ||
      a.question_text.localeCompare(b.question_text)
    );
  return {
    quiz: strip(quiz, ["id", "created_at", "updated_at", ...ignoreQuizKeys]),
    rounds: rounds.map((r) => strip(r, ["id", "quiz_id", "created_at", "updated_at"])),
    questions,
  };
}

module.exports = { startApp, seedRichQuiz, canonicalQuiz };

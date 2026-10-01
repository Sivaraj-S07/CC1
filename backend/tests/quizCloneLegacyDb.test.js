// A database that has not had the later migrations applied (no rounds table,
// no per-question timers, no programming-judge columns) must still be able to
// copy & paste quizzes without errors.
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { FakeDb } = require("./helpers/fakeSupabase");
const { startApp } = require("./helpers/harness");

test("Copy/Paste on an un-migrated database", async (t) => {
  const db = new FakeDb({
    dropTables: ["rounds"],
    dropColumns: [
      "questions.round_id", "questions.time_limit_seconds", "questions.problem_statement", "questions.input_format",
      "questions.output_format", "questions.constraints_text", "questions.sample_io", "questions.test_cases",
      "questions.time_limit_ms", "questions.allowed_languages",
    ],
  });
  const app = await startApp(db);
  t.after(() => app.close());

  const { data: quiz } = await db
    .from("quizzes")
    .insert({ title: "Old quiz", password_hash: bcrypt.hashSync("pw", 8), duration_minutes: 20 })
    .select("*")
    .single();
  const { data: q } = await db
    .from("questions")
    .insert({ quiz_id: quiz.id, question_text: "Old Q", marks: 3 })
    .select("*")
    .single();
  await db.from("quiz_options").insert([
    { question_id: q.id, option_text: "a", is_correct: true, order_index: 0 },
    { question_id: q.id, option_text: "b", is_correct: false, order_index: 1 },
  ]);

  const copied = await app.api("GET", `/quizzes/${quiz.id}/export`);
  assert.equal(copied.status, 200);
  assert.equal(copied.body.clipboard.rounds.length, 0);

  const pasted = await app.api("POST", "/quizzes/paste", { clipboard: copied.body.clipboard });
  assert.equal(pasted.status, 201, JSON.stringify(pasted.body));
  assert.deepEqual(pasted.body.counts, { rounds: 0, questions: 1, options: 2 });
  assert.deepEqual(pasted.body.warnings, []);

  // A snapshot taken on a fully-migrated database, pasted here, degrades gracefully.
  const full = JSON.parse(JSON.stringify(copied.body.clipboard));
  full.rounds = [{ ref: "r1", fields: { name: "Round 1", order_index: 0, qualification_percentage: 0 } }];
  full.questions[0].roundRef = "r1";
  full.questions[0].fields.time_limit_seconds = 30;
  full.questions[0].fields.test_cases = [];
  const degraded = await app.api("POST", "/quizzes/paste", { clipboard: full });
  assert.equal(degraded.status, 201, JSON.stringify(degraded.body));
  assert.equal(degraded.body.warnings.length, 2);
  assert.match(degraded.body.warnings[0], /Rounds are not enabled/);
  assert.match(degraded.body.warnings[1], /time limits are not enabled/);
  assert.equal(db.tables.questions.filter((x) => x.quiz_id === degraded.body.quiz.id).length, 1);
});

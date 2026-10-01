const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { FakeDb } = require("./helpers/fakeSupabase");
const { startApp, seedRichQuiz, canonicalQuiz } = require("./helpers/harness");

async function copyThenPaste(app, sourceId, pasteBody = {}) {
  const copied = await app.api("GET", `/quizzes/${sourceId}/export`);
  assert.equal(copied.status, 200, JSON.stringify(copied.body));
  // Round-trip through JSON exactly like the browser does (localStorage / clipboard).
  const clipboard = JSON.parse(JSON.stringify(copied.body.clipboard));
  const pasted = await app.api("POST", "/quizzes/paste", { clipboard, ...pasteBody });
  return { copied, clipboard, pasted };
}

test("Copy Quiz → Paste Quiz", async (t) => {
  const db = new FakeDb();
  const app = await startApp(db);
  t.after(() => app.close());
  const seed = await seedRichQuiz(db);

  await t.test("export returns a full snapshot and never leaks source ids into fields", async () => {
    const { status, body } = await app.api("GET", `/quizzes/${seed.quiz.id}/export`);
    assert.equal(status, 200);
    const c = body.clipboard;
    assert.equal(c.format, "quiz-clipboard");
    assert.equal(c.rounds.length, 3);
    assert.equal(c.questions.length, 5);
    assert.equal(body.summary.questions, 5);
    assert.equal(c.quiz.id, undefined);
    assert.equal(c.quiz.created_at, undefined);
    c.questions.forEach((q) => {
      assert.equal(q.fields.id, undefined);
      assert.equal(q.fields.quiz_id, undefined);
      assert.equal(q.fields.round_id, undefined);
    });
    const mcq = c.questions.find((q) => q.fields.question_text === "Which is O(1)?");
    assert.deepEqual(mcq.options.map((o) => o.option_text), ["Array index", "Linear scan", "Sort", "Binary search"]);
  });

  await t.test("export of an unknown quiz is a 404", async () => {
    const res = await app.api("GET", "/quizzes/00000000-0000-4000-8000-000000000000/export");
    assert.equal(res.status, 404);
  });

  await t.test("paste creates an identical but separate quiz", async () => {
    const before = db.tables.quizzes.length;
    const { pasted } = await copyThenPaste(app, seed.quiz.id);
    assert.equal(pasted.status, 201, JSON.stringify(pasted.body));
    assert.equal(db.tables.quizzes.length, before + 1);
    assert.deepEqual(pasted.body.counts, { rounds: 3, questions: 5, options: 8 });
    assert.deepEqual(pasted.body.warnings, []);

    const copy = pasted.body.quiz;
    assert.notEqual(copy.id, seed.quiz.id);
    assert.equal(copy.title, "Data Structures Contest (Copy)");
    assert.equal(copy.status, "draft");
    assert.equal(copy.participantCount, 0);
    assert.equal(copy.questionCount, 5);

    // Everything except the title & status (draft by default) is identical.
    const original = canonicalQuiz(db, seed.quiz.id, { ignoreQuizKeys: ["title", "status"] });
    const pastedCanon = canonicalQuiz(db, copy.id, { ignoreQuizKeys: ["title", "status"] });
    assert.deepEqual(pastedCanon, original);

    // …and nothing is shared: every id is fresh.
    const ids = (table, quizId) =>
      db.tables[table].filter((r) => (table === "quiz_options" ? true : r.quiz_id === quizId)).map((r) => r.id);
    const srcQ = new Set(ids("questions", seed.quiz.id));
    ids("questions", copy.id).forEach((id) => assert.ok(!srcQ.has(id)));
    const srcR = new Set(ids("rounds", seed.quiz.id));
    ids("rounds", copy.id).forEach((id) => assert.ok(!srcR.has(id)));

    // Each pasted question points at a round of the NEW quiz, never the source's.
    const newRoundIds = new Set(ids("rounds", copy.id));
    db.tables.questions
      .filter((q) => q.quiz_id === copy.id && q.round_id)
      .forEach((q) => assert.ok(newRoundIds.has(q.round_id)));
  });

  await t.test("all quiz settings, timings, marks and question types are preserved", async () => {
    const { pasted } = await copyThenPaste(app, seed.quiz.id);
    const row = db.tables.quizzes.find((q) => q.id === pasted.body.quiz.id);
    assert.equal(row.duration_minutes, 45);
    assert.equal(row.start_time, "2026-10-01T09:00:00.000Z");
    assert.equal(row.end_time, "2026-10-01T12:00:00.000Z");
    assert.equal(row.max_marks, 27);
    assert.equal(row.passing_percentage, 55);
    assert.equal(row.max_attempts, 2);
    assert.equal(row.randomize_questions, false);
    assert.equal(row.randomize_options, false);
    assert.equal(row.auto_submit, false);
    assert.equal(row.allow_late_join, true);
    assert.equal(row.show_leaderboard, false);
    assert.equal(row.tab_switch_limit, 5);
    assert.equal(row.description, "Weekly contest — 3 rounds");

    const rounds = db.tables.rounds.filter((r) => r.quiz_id === row.id).sort((a, b) => a.order_index - b.order_index);
    assert.deepEqual(rounds.map((r) => [r.name, r.qualification_percentage]), [
      ["Round 1 — Aptitude", 50],
      ["Round 2 — Coding", 60],
      ["Round 3 — Fill", 0],
    ]);

    const q = (text) => db.tables.questions.find((x) => x.quiz_id === row.id && x.question_text === text);
    const mcq = q("Which is O(1)?");
    assert.equal(mcq.marks, 2);
    assert.equal(mcq.negative_marks, 0.5);
    assert.equal(mcq.time_limit_seconds, 60);
    const coding = q("Sum two numbers");
    assert.equal(coding.question_type, "coding");
    assert.equal(coding.time_limit_ms, 5000);
    assert.deepEqual(coding.allowed_languages, ["python", "cpp"]);
    assert.equal(coding.test_cases.length, 2);
    assert.equal(coding.test_cases[1].hidden, true);
    assert.deepEqual(coding.sample_io, [{ input: "3 4", output: "7", explanation: "3+4" }]);
    assert.equal(coding.reference_solution, "print(sum(map(int,input().split())))");
    const fill = q("Capital of France is ___ and its river is ___");
    assert.deepEqual(fill.blank_answers, [["paris"], ["seine", "la seine"]]);
    assert.equal(fill.case_sensitive, true);
    assert.equal(q("Unassigned MCQ").round_id, null);
  });

  await t.test("correct-answer flags and option order survive", async () => {
    const { pasted } = await copyThenPaste(app, seed.quiz.id);
    const newQ = db.tables.questions.find((x) => x.quiz_id === pasted.body.quiz.id && x.question_text === "Which is O(1)?");
    const opts = db.tables.quiz_options.filter((o) => o.question_id === newQ.id).sort((a, b) => a.order_index - b.order_index);
    assert.deepEqual(opts.map((o) => [o.option_text, o.is_correct]), [
      ["Array index", true],
      ["Linear scan", false],
      ["Sort", false],
      ["Binary search", false],
    ]);
  });

  await t.test("student data (attempts, answers, attendance) is not copied", async () => {
    const { pasted } = await copyThenPaste(app, seed.quiz.id);
    const id = pasted.body.quiz.id;
    assert.equal(db.tables.quiz_attempts.filter((a) => a.quiz_id === id).length, 0);
    assert.equal(db.tables.attendance.filter((a) => a.quiz_id === id).length, 0);
    // the source keeps its own participation untouched
    assert.equal(db.tables.quiz_attempts.filter((a) => a.quiz_id === seed.quiz.id).length, 1);
    assert.equal(db.tables.answers.length, 1);
  });

  await t.test("the pasted quiz keeps the original password (hash copied), or takes a new one", async () => {
    const same = await copyThenPaste(app, seed.quiz.id);
    const sameRow = db.tables.quizzes.find((q) => q.id === same.pasted.body.quiz.id);
    assert.ok(bcrypt.compareSync(seed.password, sameRow.password_hash));

    const changed = await copyThenPaste(app, seed.quiz.id, { password: "brand-new-1" });
    const changedRow = db.tables.quizzes.find((q) => q.id === changed.pasted.body.quiz.id);
    assert.ok(bcrypt.compareSync("brand-new-1", changedRow.password_hash));
    assert.ok(!bcrypt.compareSync(seed.password, changedRow.password_hash));
    // the API never returns the hash
    assert.equal(JSON.stringify(same.pasted.body).includes("password_hash"), false);
  });

  await t.test("custom title and keepStatus are honoured", async () => {
    const { pasted } = await copyThenPaste(app, seed.quiz.id, { title: "  Evening batch  ", keepStatus: true });
    assert.equal(pasted.body.quiz.title, "Evening batch");
    assert.equal(pasted.body.quiz.status, "live");
  });

  await t.test("pasting the same copy several times makes several independent quizzes", async () => {
    const { clipboard } = await copyThenPaste(app, seed.quiz.id);
    const a = await app.api("POST", "/quizzes/paste", { clipboard });
    const b = await app.api("POST", "/quizzes/paste", { clipboard });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.notEqual(a.body.quiz.id, b.body.quiz.id);
    assert.deepEqual(canonicalQuiz(db, a.body.quiz.id), canonicalQuiz(db, b.body.quiz.id));
  });

  await t.test("the pasted quiz is a separate, fully editable quiz", async () => {
    const { pasted } = await copyThenPaste(app, seed.quiz.id);
    const id = pasted.body.quiz.id;
    const before = canonicalQuiz(db, seed.quiz.id);

    // existing endpoints work on the copy
    const list = await app.api("GET", "/quizzes");
    assert.equal(list.status, 200);
    const listed = list.body.quizzes.find((q) => q.id === id);
    assert.equal(listed.questionCount, 5);

    const rounds = await app.api("GET", `/quizzes/${id}/rounds`);
    assert.equal(rounds.body.rounds.length, 3);
    assert.deepEqual(rounds.body.rounds.map((r) => r.questionCount), [2, 1, 1]);

    const qs = await app.api("GET", `/quizzes/${id}/questions`);
    assert.equal(qs.status, 200);
    assert.equal(qs.body.questions.length, 5);
    assert.equal(qs.body.questions.at(-1).text, "Unassigned MCQ"); // unassigned sorts last

    // edit / add / delete on the copy …
    const firstMcq = qs.body.questions.find((q) => q.text === "Which is O(1)?");
    const put = await app.api("PUT", `/questions/${firstMcq.id}`, {
      text: "Edited in the copy",
      marks: 9,
      options: [
        { text: "x", isCorrect: true },
        { text: "y", isCorrect: false },
      ],
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const upd = await app.api("PUT", `/quizzes/${id}`, { title: "Renamed copy", durationMinutes: 99 });
    assert.equal(upd.status, 200);
    const newQ = await app.api("POST", `/quizzes/${id}/questions`, {
      text: "New one",
      marks: 1,
      options: [{ text: "a", isCorrect: true }, { text: "b", isCorrect: false }],
      roundId: rounds.body.rounds[0].id,
    });
    assert.equal(newQ.status, 201, JSON.stringify(newQ.body));
    const delRound = await app.api("DELETE", `/rounds/${rounds.body.rounds[2].id}`);
    assert.equal(delRound.status, 200);
    const pub = await app.api("PATCH", `/quizzes/${id}/status`, { status: "live" });
    assert.equal(pub.status, 200);

    // … leaves the original completely untouched
    assert.deepEqual(canonicalQuiz(db, seed.quiz.id), before);
  });

  await t.test("deleting the original does not affect the copy (and vice versa)", async () => {
    const { pasted } = await copyThenPaste(app, seed.quiz.id);
    const id = pasted.body.quiz.id;
    const snapshot = canonicalQuiz(db, id);
    const src = await seedRichQuiz(db); // a second source so the main one stays for later tests
    const { pasted: p2 } = await copyThenPaste(app, src.quiz.id);
    await app.api("DELETE", `/quizzes/${src.quiz.id}`);
    assert.equal(db.tables.quizzes.some((q) => q.id === src.quiz.id), false);
    assert.equal(canonicalQuiz(db, p2.body.quiz.id).questions.length, 5);
    assert.deepEqual(canonicalQuiz(db, id), snapshot);
  });

  await t.test("a copy can still be pasted after the source quiz was deleted", async () => {
    const src = await seedRichQuiz(db);
    const copied = await app.api("GET", `/quizzes/${src.quiz.id}/export`);
    await app.api("DELETE", `/quizzes/${src.quiz.id}`);
    const pasted = await app.api("POST", "/quizzes/paste", { clipboard: copied.body.clipboard });
    assert.equal(pasted.status, 201);
    assert.equal(canonicalQuiz(db, pasted.body.quiz.id).questions.length, 5);
  });

  await t.test("a quiz with no rounds / questions copies fine", async () => {
    const created = await app.api("POST", "/quizzes", { title: "Empty", password: "pw-empty" });
    assert.equal(created.status, 201);
    const { pasted } = await copyThenPaste(app, created.body.quiz.id);
    assert.equal(pasted.status, 201);
    assert.deepEqual(pasted.body.counts, { rounds: 0, questions: 0, options: 0 });
  });

  await t.test("a quiz created through the normal API (default settings) copies exactly", async () => {
    const created = await app.api("POST", "/quizzes", { title: "Plain", password: "pw-plain", durationMinutes: 12 });
    await app.api("POST", `/quizzes/${created.body.quiz.id}/questions`, {
      text: "Q?",
      marks: 2,
      negativeMarks: 1,
      timeLimitSeconds: 30,
      options: [{ text: "1", isCorrect: true }, { text: "2", isCorrect: false }],
    });
    const { pasted } = await copyThenPaste(app, created.body.quiz.id);
    assert.deepEqual(
      canonicalQuiz(db, pasted.body.quiz.id, { ignoreQuizKeys: ["title"] }),
      canonicalQuiz(db, created.body.quiz.id, { ignoreQuizKeys: ["title"] })
    );
  });

  await t.test("all-or-nothing: a failure part-way leaves no half-built quiz", async () => {
    const copied = await app.api("GET", `/quizzes/${seed.quiz.id}/export`);
    for (const table of ["quiz_options", "questions", "rounds"]) {
      const snap = {
        quizzes: db.tables.quizzes.length,
        rounds: db.tables.rounds.length,
        questions: db.tables.questions.length,
        options: db.tables.quiz_options.length,
      };
      db.failOnce(table, "insert");
      const res = await app.api("POST", "/quizzes/paste", { clipboard: copied.body.clipboard });
      assert.equal(res.status, 500, table);
      assert.deepEqual(
        {
          quizzes: db.tables.quizzes.length,
          rounds: db.tables.rounds.length,
          questions: db.tables.questions.length,
          options: db.tables.quiz_options.length,
        },
        snap,
        `rollback after failing ${table}`
      );
    }
  });

  await t.test("validation & security", async () => {
    const good = (await app.api("GET", `/quizzes/${seed.quiz.id}/export`)).body.clipboard;

    assert.equal((await app.api("POST", "/quizzes/paste", {})).status, 400);
    assert.equal((await app.api("POST", "/quizzes/paste", { clipboard: { format: "nope" } })).status, 400);
    assert.equal((await app.api("POST", "/quizzes/paste", { clipboard: { ...good, version: 99 } })).status, 400);
    assert.equal((await app.api("POST", "/quizzes/paste", { clipboard: { ...good, questions: "x" } })).status, 400);

    const noText = JSON.parse(JSON.stringify(good));
    noText.questions[0].fields.question_text = "  ";
    const r1 = await app.api("POST", "/quizzes/paste", { clipboard: noText });
    assert.equal(r1.status, 400);
    assert.ok(Array.isArray(r1.body.details));

    const badType = JSON.parse(JSON.stringify(good));
    badType.questions[0].fields.question_type = "essay";
    assert.equal((await app.api("POST", "/quizzes/paste", { clipboard: badType })).status, 400);

    const noHash = JSON.parse(JSON.stringify(good));
    delete noHash.quiz.password_hash;
    assert.equal((await app.api("POST", "/quizzes/paste", { clipboard: noHash })).status, 400);
    const withPw = await app.api("POST", "/quizzes/paste", { clipboard: noHash, password: "typed-pass" });
    assert.equal(withPw.status, 201);

    const garbageHash = JSON.parse(JSON.stringify(good));
    garbageHash.quiz.password_hash = "not-a-hash";
    assert.equal((await app.api("POST", "/quizzes/paste", { clipboard: garbageHash })).status, 400);

    // pasted ids / foreign keys can never point into another quiz
    const hostile = JSON.parse(JSON.stringify(good));
    hostile.quiz.id = seed.quiz.id;
    hostile.questions[0].fields.id = seed.questions[0].id;
    hostile.questions[0].fields.quiz_id = seed.quiz.id;
    hostile.questions[0].fields["__proto__"] = { polluted: true };
    const before = db.tables.questions.filter((q) => q.quiz_id === seed.quiz.id).length;
    const h = await app.api("POST", "/quizzes/paste", { clipboard: hostile });
    assert.equal(h.status, 201);
    assert.equal(db.tables.questions.filter((q) => q.quiz_id === seed.quiz.id).length, before);
    assert.equal({}.polluted, undefined);

    // auth
    assert.equal((await app.api("POST", "/quizzes/paste", { clipboard: good }, { auth: null })).status, 401);
    assert.equal((await app.api("POST", "/quizzes/paste", { clipboard: good }, { auth: app.studentToken })).status, 403);
    assert.equal((await app.api("GET", `/quizzes/${seed.quiz.id}/export`, undefined, { auth: null })).status, 401);
    assert.equal((await app.api("GET", `/quizzes/${seed.quiz.id}/export`, undefined, { auth: app.studentToken })).status, 403);
  });

  await t.test("existing quiz endpoints are unaffected", async () => {
    const created = await app.api("POST", "/quizzes", { title: "Legacy flow", password: "pw12345" });
    assert.equal(created.status, 201);
    const id = created.body.quiz.id;
    assert.equal((await app.api("GET", `/quizzes/${id}`)).status, 200);
    assert.equal((await app.api("PUT", `/quizzes/${id}`, { title: "Legacy flow 2" })).status, 200);
    assert.equal((await app.api("GET", "/quizzes")).status, 200);
    assert.equal((await app.api("DELETE", `/quizzes/${id}`)).status, 200);
  });
});

test("large quizzes (pagination, chunking, body size)", async (t) => {
  const db = new FakeDb();
  const app = await startApp(db);
  t.after(() => app.close());

  const { data: quiz } = await db
    .from("quizzes")
    .insert({ title: "Big", password_hash: bcrypt.hashSync("pw", 8) })
    .select("*")
    .single();
  const rows = [];
  const bigText = "x".repeat(600);
  for (let i = 0; i < 1500; i++) {
    rows.push({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, quiz_id: quiz.id, question_text: `Q${i} ${bigText}`, order_index: i, marks: 1 });
  }
  await db.from("questions").insert(rows);
  await db.from("quiz_options").insert(
    rows.flatMap((q) => [
      { question_id: q.id, option_text: "yes", is_correct: true, order_index: 0 },
      { question_id: q.id, option_text: "no", is_correct: false, order_index: 1 },
    ])
  );

  const copied = await app.api("GET", `/quizzes/${quiz.id}/export`);
  assert.equal(copied.body.clipboard.questions.length, 1500, "more than PostgREST's 1000-row cap");
  const size = JSON.stringify(copied.body.clipboard).length;
  assert.ok(size > 1_000_000, `payload is ${size} bytes — bigger than the global 1 MB JSON limit`);

  const pasted = await app.api("POST", "/quizzes/paste", { clipboard: copied.body.clipboard });
  assert.equal(pasted.status, 201, JSON.stringify(pasted.body).slice(0, 300));
  assert.deepEqual(pasted.body.counts, { rounds: 0, questions: 1500, options: 3000 });
  assert.equal(db.tables.questions.filter((q) => q.quiz_id === pasted.body.quiz.id).length, 1500);
});

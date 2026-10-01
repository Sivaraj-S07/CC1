// HTTP-level test of the student Run / Submit endpoints: the quiz's own
// language must decide which toolchain executes the code.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";
process.env.CODE_EXEC_FALLBACK = "off";
process.env.CODE_EXEC_PROVIDER = "local";
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");

const QUIZ_ID = "quiz-1";
const rows = {
  quizzes: { id: QUIZ_ID, duration_minutes: 60 },
  quiz_attempts: { id: "att-1", quiz_id: QUIZ_ID, student_id: "stu-1", status: "in_progress", started_at: new Date().toISOString() },
  questions: {},
};
const saved = [];
function builder(table) {
  const b = {
    select: () => b, eq: () => b, limit: () => b,
    maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
    upsert: async (row) => { saved.push({ table, row }); return { error: null }; },
    then: (res) => res({ data: [], error: null }),
  };
  return b;
}
const supPath = require.resolve("../src/config/supabaseClient");
require.cache[supPath] = { id: supPath, filename: supPath, loaded: true, exports: { getSupabase: () => ({ from: builder }) } };

const express = require("express");
const { signStudentToken } = require("../src/utils/jwt");
const { errorHandler } = require("../src/middleware/errorHandler");

let server, base, token;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/quizzes", require("../src/routes/quizzes"));
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/api/quizzes/${QUIZ_ID}`;
  token = signStudentToken({ studentId: "stu-1", quizId: QUIZ_ID, id: "stu-1" });
});
test.after(() => new Promise((r) => server.close(r)));

const post = async (path, body) => {
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const PROGRAMS = {
  python: "n=int(input())\nprint(n*2)\n",
  c: '#include <stdio.h>\nint main(){int n;scanf("%d",&n);printf("%d\\n",n*2);}',
  cpp: "#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n*2<<\"\\n\";}",
  java: "import java.util.*;\npublic class Main{public static void main(String[] a){System.out.println(new Scanner(System.in).nextInt()*2);}}",
};

for (const lang of Object.keys(PROGRAMS)) {
  test(`${lang} quiz: Run and Submit use the ${lang} toolchain`, async () => {
    rows.questions = {
      id: "q1", quiz_id: QUIZ_ID, question_type: "coding", language: lang, allowed_languages: [lang],
      sample_io: [{ input: "21", output: "42" }],
      test_cases: [{ input: "1", expectedOutput: "2", hidden: true }, { input: "5", expectedOutput: "10", hidden: true }],
      time_limit_ms: 3000,
    };
    const run = await post("/code/run", { questionId: "q1", code: PROGRAMS[lang], language: lang });
    assert.equal(run.status, 200, JSON.stringify(run.body));
    assert.equal(run.body.language, lang);
    assert.match(run.body.terminal || "", /42|passed/i);

    const custom = await post("/code/run", { questionId: "q1", code: PROGRAMS[lang], language: lang, stdin: "8\n" });
    assert.equal(custom.status, 200, JSON.stringify(custom.body));
    assert.match(JSON.stringify(custom.body), /16/);

    const sub = await post("/code/submit", { questionId: "q1", code: PROGRAMS[lang], language: lang });
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    assert.equal(sub.body.judge.passed, 2, JSON.stringify(sub.body));
  });
}

test("a language the quiz does not allow is never executed (falls back to the quiz language)", async () => {
  rows.questions = {
    id: "q2", quiz_id: QUIZ_ID, question_type: "coding", language: "python", allowed_languages: ["python"],
    sample_io: [], test_cases: [{ input: "3", expectedOutput: "6", hidden: true }], time_limit_ms: 3000,
  };
  const sub = await post("/code/submit", { questionId: "q2", code: PROGRAMS.python, language: "c++" });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.equal(sub.body.judge.passed, 1, JSON.stringify(sub.body));
});

test("language aliases (python3 / c++) are accepted when allowed", async () => {
  rows.questions = {
    id: "q3", quiz_id: QUIZ_ID, question_type: "coding", language: "cpp", allowed_languages: ["cpp"],
    sample_io: [{ input: "4", output: "8" }], test_cases: [], time_limit_ms: 3000,
  };
  const run = await post("/code/run", { questionId: "q3", code: PROGRAMS.cpp, language: "C++" });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.language, "cpp");
});

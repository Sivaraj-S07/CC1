// End-to-end judge tests: every language runs through the same executeCode()
// entry point the quiz uses, with the real local toolchain (no network).
process.env.CODE_EXEC_FALLBACK = "off";
process.env.CODE_EXEC_PROVIDER = "local";
const test = require("node:test");
const assert = require("node:assert");
const { executeCode, runTestCases } = require("../src/utils/codeRunner");

const SUM = {
  python: "a,b=map(int,input().split())\nprint(a+b)\n",
  c: '#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}',
  cpp: "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;}",
  java: "import java.util.*;\npublic class Main{public static void main(String[] x){Scanner s=new Scanner(System.in);System.out.println(s.nextInt()+s.nextInt());}}",
};
const BAD = {
  python: "print(1/0)\n",
  c: "#include <stdio.h>\nint main(){int *p=0;*p=1;return 0;}",
  cpp: "#include <iostream>\nint main(){throw 1;}",
  java: "public class Main{public static void main(String[] a){int[] x=new int[1];x[2]=1;}}",
};
const SYNTAX = {
  python: "print(\n",
  c: "int main(){ return }",
  cpp: "int main(){ undefined_fn(); }",
  java: "public class Main{ void x( }",
};
const LOOP = {
  python: "while True: pass\n",
  c: "int main(){for(;;);}",
  cpp: "int main(){for(;;);}",
  java: "public class Main{public static void main(String[] a){while(true){}}}",
};

for (const lang of ["python", "c", "cpp", "java"]) {
  test(`${lang}: stdin -> stdout`, async () => {
    const r = await executeCode({ language: lang, source: SUM[lang], stdin: "2 40\n", timeLimitMs: 5000 });
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.equal(r.stdout.trim(), "42");
  });
  test(`${lang}: compile/syntax error`, async () => {
    const r = await executeCode({ language: lang, source: SYNTAX[lang], timeLimitMs: 5000 });
    assert.ok(["compile_error", "runtime_error"].includes(r.status), JSON.stringify(r));
    assert.ok(r.compileOutput || r.stderr, "an error message must be shown");
  });
  test(`${lang}: runtime error`, async () => {
    const r = await executeCode({ language: lang, source: BAD[lang], timeLimitMs: 5000 });
    assert.equal(r.status, "runtime_error", JSON.stringify(r));
  });
  test(`${lang}: infinite loop -> time limit`, async () => {
    const t = Date.now();
    const r = await executeCode({ language: lang, source: LOOP[lang], timeLimitMs: 1500 });
    assert.equal(r.status, "time_limit_exceeded", JSON.stringify(r));
    assert.ok(Date.now() - t < 12000);
  });
  test(`${lang}: reading input that never comes does not hang`, async () => {
    const r = await executeCode({ language: lang, source: SUM[lang], stdin: "", timeLimitMs: 5000 });
    assert.notEqual(r.status, "judge_unavailable", JSON.stringify(r));
    assert.notEqual(r.status, "time_limit_exceeded", JSON.stringify(r));
  });
  test(`${lang}: runTestCases grades hidden cases`, async () => {
    const r = await runTestCases({
      language: lang,
      source: SUM[lang],
      timeLimitMs: 5000,
      testCases: [
        { input: "1 2", expectedOutput: "3", hidden: true },
        { input: "10 5", expectedOutput: "15", hidden: true },
        { input: "7 7", expectedOutput: "99", hidden: true },
      ],
    });
    assert.equal(r.passed, 2);
    assert.equal(r.total, 3);
  });
}

test("java: non-Main public class, package, helper classes", async () => {
  const r1 = await executeCode({ language: "java", stdin: "", timeLimitMs: 5000,
    source: "public class Solution{public static void main(String[] a){System.out.println(\"sol\");}}" });
  assert.equal(r1.stdout.trim(), "sol", JSON.stringify(r1));
  const r2 = await executeCode({ language: "java", stdin: "", timeLimitMs: 5000,
    source: "package a.b;\npublic class App{public static void main(String[] a){System.out.println(\"pkg\");}}" });
  assert.equal(r2.stdout.trim(), "pkg", JSON.stringify(r2));
  const r3 = await executeCode({ language: "java", stdin: "", timeLimitMs: 5000,
    source: "class Helper{static int f(){return 5;}}\npublic class Main{public static void main(String[] a){System.out.println(Helper.f());}}" });
  assert.equal(r3.stdout.trim(), "5", JSON.stringify(r3));
});

test("languages never cross over (python source as C fails to compile)", async () => {
  const r = await executeCode({ language: "c", source: SUM.python, stdin: "1 2", timeLimitMs: 5000 });
  assert.equal(r.status, "compile_error");
});

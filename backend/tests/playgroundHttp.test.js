process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";
process.env.CODE_EXEC_FALLBACK = "off";
process.env.CODE_EXEC_PROVIDER = "local";
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const express = require("express");

let server, base;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/playground", require("../src/routes/playground"));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/api/playground`;
});
test.after(() => new Promise((r) => server.close(r)));

const run = async (body) => {
  const res = await fetch(base + "/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
};

test("GET /languages reports all four runtimes available", async () => {
  const data = await (await fetch(base + "/languages")).json();
  assert.equal(data.languages.length, 4);
  for (const l of data.languages) assert.equal(l.localToolchain, true, JSON.stringify(l));
});

const HELLO = {
  python: "print(input().upper())",
  c: '#include <stdio.h>\n#include <ctype.h>\nint main(){char s[50];scanf("%49s",s);for(char*p=s;*p;p++)putchar(toupper(*p));puts("");}',
  cpp: "#include <iostream>\n#include <algorithm>\nint main(){std::string s;std::cin>>s;for(auto&c:s)c=toupper(c);std::cout<<s<<\"\\n\";}",
  java: "import java.util.*;\npublic class Main{public static void main(String[] a){System.out.println(new Scanner(System.in).next().toUpperCase());}}",
};
for (const [language, source] of Object.entries(HELLO)) {
  test(`playground ${language}`, async () => {
    const r = await run({ language, source, stdin: "abc\n" });
    assert.equal(r.status, "ok", JSON.stringify(r));
    assert.equal(r.stdout.trim(), "ABC");
  });
}
test("playground java multi-file project", async () => {
  const r = await run({
    language: "java",
    source: "public class Main{public static void main(String[] a){System.out.println(Util.twice(4));}}",
    files: [{ name: "Util.java", content: "public class Util{static int twice(int x){return x*2;}}" }],
  });
  assert.equal(r.stdout.trim(), "8", JSON.stringify(r));
});

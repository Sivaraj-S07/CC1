# Fixes applied — Coding Club project

## Latest pass — per-language compilers, Java detection, language enforcement

- **Java main-class detection bug** (`backend/src/utils/localRunner.js`): when a helper class was declared
  *before* `Main` in the same file, the runner tried to launch the helper (`Main method not found in class Helper`).
  `planJavaSource()` now walks the braces and runs the top-level class that actually contains `main`.
- **Quiz language is enforced** (`backend/src/controllers/quizAttemptController.js`, `resolveLanguage`):
  a language the question does not allow is no longer executed; it falls back to the question's language.
  Aliases (`python3`, `py`, `C++`, `g++`, `gcc`, `jdk`) are normalised.
- Language selection was already stored per programming question (`language`, `allowed_languages`) and on each
  answer (`answers.language`); no schema change or UI change was needed.
- New tests: `npm run test:judge` (38 tests) cover all four languages: stdin/stdout, compile errors, runtime errors,
  infinite-loop timeouts, empty stdin, hidden-test grading, Java packages/helper classes/multi-file, the in-quiz
  Run/Submit HTTP endpoints and the public playground.
- JDK (`javac`) must be installed, not only a JRE — see `SETUP-COMPILERS.md`.
- No UI or existing feature was changed.

---

## Latest pass — "Import Quiz from PDF" rejecting a real, valid backup PDF

### The bug
Uploading a previously-exported quiz PDF (e.g. `PROGRAMMING HUNT`, a 5-round,
50-question quiz) through **Admin Portal → Quizzes → Import Quiz from PDF**
failed every time with a `400 Bad Request` from
`POST /api/admin/quizzes/import-pdf`, and the toast read *"This PDF doesn't
contain Coding Club backup data."* — even though the PDF was a genuine
export with its machine-readable attachment intact.

### Root cause
`backend/src/utils/quizPdf.js` reads the quiz data back out of the PDF's
embedded-file attachment and expects it in one specific shape: JSON that has
first been **gzip-compressed** (`zlib.gzipSync`), on top of the PDF's own
`/FlateDecode` stream compression — a double layer.

The uploaded PDF's attachment, however, was only compressed once (the PDF's
own `/FlateDecode`) with the **plain JSON underneath, not gzipped again**,
and used an older, differently-shaped payload: `{ format:
"coding-club-quiz", version: 1, quiz: { title, passwordHash,
durationMinutes, ... }, rounds: [...], questions: [...], stats }` (camelCase
fields, positional `roundIndex` references) instead of the current
`quiz-clipboard` shape (`{ format: "quiz-clipboard", quiz: { password_hash,
duration_minutes, ... }, rounds: [{ ref, fields }], questions: [{ ref,
roundRef, fields, options }] }`) that `buildQuizFromClipboard` inserts into
the database.

Concretely, `extractFromAttachment()` did `zlib.gunzipSync(decoded)` on data
that was never gzipped, which throws → the function silently returned
`null` → the marker-text legacy fallback also found nothing (that PDF never
had marker text) → the controller had no choice but to reject the upload,
even though the exact quiz data was sitting right there in the file.

### Fix
`backend/src/utils/quizPdf.js`:
- `extractFromAttachment()` no longer assumes the decoded attachment is
  necessarily gzipped: it now tries `gunzip` first and falls back to
  treating the PDF-decompressed bytes as plain JSON directly, so both
  encodings are read correctly.
- New `convertLegacyQuizExport()` recognises the older `"coding-club-quiz"`
  payload shape and maps every field over to the current `quiz-clipboard`
  shape byte-for-byte: quiz settings (title, description, password hash,
  duration, schedule, marks, passing %, attempts, randomisation,
  auto-submit, late join, leaderboard, tab-switch limit, status), every
  round (name, description, qualification %, with `order_index` and
  per-round question ordering rebuilt from the original array order), and
  every question of all three types — MCQ (options + correct answer), Fill
  in the Blank (`blankAnswers` → `blank_answers`, `caseSensitive` →
  `case_sensitive`), and Programming (problem statement, I/O formats,
  constraints, sample I/O, hidden test cases, allowed languages, starter
  code, reference solution, per-run time limit).
- `backend/src/controllers/adminQuizCloneController.js` now exports its
  `CLIPBOARD_FORMAT`/`CLIPBOARD_VERSION` constants so the PDF importer can
  tag converted data with the exact same values the rest of the app
  recognises, instead of hard-coding a second copy of them.
- The existing, still-current export format (double-compressed, `"quiz-
  clipboard"` shape, produced by this same codebase's "Export as PDF")
  continues to work exactly as before — this is strictly additive.

### Verified
- Ran the real uploaded `PROGRAMMING HUNT` backup PDF through
  `parseQuizPdfBuffer()` + `validateClipboard()` directly (no mocking): all
  **5 rounds**, **50 questions** (30 MCQ, 10 programming, 10 fill-in-the-
  blank) and **114 options** are extracted correctly, the bcrypt password
  hash passes the existing format check unchanged, per-round question
  ordering is preserved, and every programming question's problem
  statement, I/O format, constraints, sample I/O, 3 hidden test cases,
  starter code and reference solution all come through intact — confirmed
  by inspecting the converted question rows field-by-field.
- Confirmed the **existing** export→import round trip (build a PDF with
  `buildQuizPdfBuffer`, then read it back with `parseQuizPdfBuffer`) still
  produces an identical, validator-passing clipboard — this fix does not
  regress PDFs produced by the current exporter.
- `node --check` on every backend `.js` file — zero syntax errors.

---

## Previous pass — Copy Quiz / Paste Quiz (Admin Portal → Quizzes)

### What was added
* **Copy** button on every quiz card. It takes a full snapshot of the quiz:
  all settings (duration, schedule, marks, passing %, attempts, randomisation,
  auto-submit, late join, leaderboard, tab-switch limit, description, password),
  every **round** (name, description, order, qualification %) and every
  **question** of every type — MCQ (options + correct answer + option order),
  Programming (problem statement, formats, constraints, sample I/O, hidden test
  cases, languages, starter code, reference solution, per-run time limit) and
  Fill-in-the-Blank (blanks, accepted answers, case sensitivity) — with their
  marks, negative marks, per-question timers, order and round assignment.
* **Paste Quiz** button (page header, and on the "Copied: …" banner). It opens a
  dialog with the copied quiz, an editable title (default `<title> (Copy)`), an
  optional new password and a "keep original status" switch, then creates a
  brand-new quiz. The pasted quiz is a separate, fully editable quiz: new ids
  everywhere, nothing shared with the original, so editing or deleting either
  one never affects the other.
* The copy is kept in memory + `localStorage` (survives a refresh, works across
  tabs, cleared on admin logout) and is also written to the system clipboard when
  the browser allows it. If you copied on another machine, paste that text into
  the "Paste copied quiz data instead" box of the dialog.

### Behaviour worth knowing
* Passwords are stored hashed, so the copy carries the original hash: the pasted
  quiz keeps the **same password** unless you type a new one in the dialog.
* The pasted quiz is created as **Draft** so it cannot go live by accident;
  tick "Keep original status" to keep e.g. Live/Upcoming.
* Student data (attempts, answers, attendance, results) is **not** copied — the
  new quiz starts with 0 participants.
* Paste is all-or-nothing: if any step fails, the half-created quiz is removed.
* Databases that haven't applied the newer migrations (no rounds / per-question
  timers / programming-judge columns) still work; whatever can't be stored is
  skipped and reported in a warning toast.
* The **Duplicate** button now uses the same engine: one click makes a full draft
  copy (all rounds and questions, same password) instead of an empty shell.

### Files
* backend: `controllers/adminQuizCloneController.js` (new), `routes/admin.js`
  (`GET /admin/quizzes/:id/export`, `POST /admin/quizzes/paste`),
  `server.js` (the paste route alone accepts up to 10 MB, after the admin token
  is verified — a whole quiz can exceed the global 1 MB JSON limit),
  `controllers/adminQuizController.js` (exports `quizPublicShape`).
* frontend: `pages/admin/AdminQuizzes.jsx`, `lib/quizClipboard.js` (new),
  `lib/adminAuth.jsx` (clears the copy on logout).
* tests: `cd backend && npm test` (20 API tests against an in-memory database
  double: exact-structure comparison, independence, rollback, validation, auth,
  1,500-question quiz, un-migrated database) and `cd frontend && npm test`
  (12 UI tests). `npm run build` in `frontend/` passes.

## Previous pass — Console Clear must stop the running program, not just hide it

### The problem
Across all three code consoles (Playground / "Programming" page, the
Programming-tab console on a course problem, and the quiz's coding
console), clicking **Clear** only reset what was on screen
(`setResult(null)` / `setTranscript("")`). It never cancelled the in-flight
Run/Submit request. Two consequences:

1. The compiled/interpreted program kept running **on the server** until it
   hit its own timeout (up to 15s for Java) — genuinely running "in the
   background" with nothing watching it, exactly as reported.
2. If that abandoned request finished *after* the student cleared the
   console, its result would pop back into the (supposedly cleared) output —
   confusing and wrong.

The quiz's coding console (`CodingWorkspace.jsx`) additionally had no Clear
button at all.

### Fix — frontend
`frontend/src/lib/api.js`: `apiFetch`/`performFetch` now accept and forward
a standard `signal` option, and let `AbortError` propagate distinctly from a
real network failure so callers can tell "the student cancelled" apart from
"the server is unreachable."

Each of the three consoles now tracks its currently in-flight request via an
`AbortController` ref:
- `frontend/src/pages/student/Playground.jsx`
- `frontend/src/pages/student/CourseProblem.jsx`
- `frontend/src/components/student/CodingWorkspace.jsx` (quiz console — also
  gained its first-ever Clear button, wired to the same `Console` component
  used everywhere else)

Clear now: aborts the in-flight controller (if any) → immediately flips
`running`/`submitting` back to `false` → clears **both** the output/
transcript and the stdin box. The `catch` blocks around each Run/Submit call
detect `err.name === "AbortError"` and return silently — no error toast, and
no stale response is allowed to overwrite state after a cancel (guarded by
comparing the ref to the controller that started the request). Every
console also aborts its in-flight request on unmount, so navigating away
mid-run doesn't leave anything dangling either.

### Fix — backend (this is what actually stops the program)
Aborting the fetch on its own only stops the *browser* from waiting; the
Node process on the server was still compiling/running the student's
program with no way to hear about the cancellation. New helper
`backend/src/utils/requestAbort.js` (`abortSignalForRequest(req, res)`) ties
a real `AbortSignal` to the response's `"close"` event (fires on both a
normal completed response and an early client disconnect, so one handler
covers both safely).

That signal is now threaded end-to-end through the whole execution stack:
- `backend/src/utils/localRunner.js` — `spawnWithTimeout` and
  `executeLocally` kill the child process (`SIGKILL` the process group,
  same path as a timeout) the instant the signal aborts, instead of letting
  it run out its full timeout budget unattended. Added a distinct
  `"aborted"` status so this is never confused with
  `"time_limit_exceeded"`.
- `backend/src/utils/codeRunner.js` — `executeCode`, the remote
  Piston path (`executeRemotely`/`callPiston`), and `runTestCases` (the
  hidden-test-case loop used by Submit) all check/forward the signal, so a
  cancelled Submit stops between test cases too, not just on a single Run.
- `backend/src/utils/wandboxRunner.js` — same treatment for the
  key-less Wandbox fallback.
- Wired into every route that can start student code:
  `playgroundController.runSnippet`, `courseController.runProblem` /
  `submitProblem`, and `quizAttemptController.runCode` / `submitCode`. Each
  creates the signal, passes it down, and guards against writing to an
  already-closed socket. `submitProblem`/`submitCode` additionally skip
  persisting a verdict to the database if the run was aborted before
  grading finished — a cancelled submission never gets recorded as a
  partial/incorrect official attempt.

### Verified
- `node --check` on every single `.js` file in `backend/src` — zero syntax
  errors.
- `npm install && npm run build` (frontend) — zero errors, same bundle
  shape as before.
- `oxlint` — same 103 pre-existing baseline errors, zero new errors or
  warnings on any file touched by this change.
- Live functional test (real backend process, real Node child processes):
  started a Python program with an intentional infinite loop and a 30s
  timeout, aborted the request after 500ms exactly like the frontend's
  Clear button would, and confirmed via `ps aux` that the interpreter was
  actually killed within ~500ms — not left running in the background for
  the remaining ~29.5s.
- Confirmed normal (non-cancelled) runs are unaffected and still fast:
  Python ~27ms, C/C++ ~3ms for a simple "hello world," across the
  `/api/playground/run` endpoint with a live server.

---


## Prompt 5 — PDF upload stuck on "Processing" + Manual Course Creation not working

### 1. PDF upload could hang on "Processing" forever
Root cause was two independent, stackable failure modes, both now fixed:

- **No timeout anywhere in the Gemini call chain.** Node's `fetch` has no
  default timeout, and Gemini's own model card notes it "may exhibit...
  occasional slowness or timeout issues." A single stalled request had
  nothing to time it out, so the whole import could sit unfinished
  indefinitely with the `pdf_imports` row stuck at `status: "processing"`.
  Fixed with a per-request `AbortController` timeout (`GEMINI_TIMEOUT_MS`,
  default 45s, retried like a 429/503) in `courseAiExtractor.js`, **plus** a
  hard ceiling on the whole extraction+creation pipeline
  (`PDF_IMPORT_JOB_TIMEOUT_MS`, default 15 minutes) in
  `adminCourseController.js`'s `runImportJob`, so the import record is
  *always* moved out of "processing" one way or another.
- **Unhandled promise rejections could crash the whole backend process.**
  Progress-note updates (`onProgress(...)`) are called fire-and-forget (not
  awaited) from deep inside the extraction pipeline, by design — so a slow
  Gemini call isn't blocked on a DB round-trip just to post a status
  string. If that update ever rejected, it became an *unhandled rejection*,
  which by default terminates the entire Node process (Node ≥15) — taking
  down every other in-flight request, including an unrelated admin action
  like Manual Course Creation, at the same time. `setProgress` now swallows
  its own errors, and `server.js` adds `unhandledRejection`/
  `uncaughtException` listeners as a second safety net so a stray rejection
  anywhere just gets logged instead of killing the process.
- **`pdf-parse` itself can hang** on a malformed/oversized PDF, and this
  runs synchronously in the upload request *before* any `pdf_imports` row
  even exists — an unbounded hang here showed up as the Upload button
  spinning forever with nothing to retry. Now capped with its own timeout
  (`PDF_PARSE_TIMEOUT_MS`, default 30s) in `pdfExtract.js`.

### 2. Manual Course Creation silently appearing to do nothing
- `getSupabase()` threw a plain `Error` instead of an `ApiError` when
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` were missing. The global error
  handler only forwards the real message for `ApiError`s — a plain `Error`
  is treated as an unexpected failure and its message gets replaced with a
  generic "Internal server error", hiding the actual, actionable cause from
  the admin. Every route using `getSupabase()` (course creation included)
  was affected. Fixed to throw `ApiError` so the real message always
  reaches the client.
- Every database error surfaced to the admin was just the raw Postgres/
  PostgREST message (e.g. `relation "courses" does not exist`, or
  PostgREST's `PGRST205` schema-cache-miss). New `backend/src/utils/
  dbErrors.js` (`describeDbError`) recognizes the common cases — missing
  table/migration, out-of-date column, check/foreign-key constraint
  violations, network failures reaching Supabase — and turns them into a
  clear, actionable sentence (e.g. "run `backend/sql/migration_courses.sql`
  in your Supabase project's SQL editor"). Applied across every course/
  problem/import create-update-delete path in `adminCourseController.js`.
- Frontend: error toasts now stay up 9s instead of 4s (`Toast.jsx`) so a
  longer, actionable message is actually readable before it disappears.

### 3. Verified with a mocked-Supabase / mocked-Gemini integration harness
Since this sandbox has no network access to the project's real Supabase or
Gemini endpoints, an in-memory fake of the supabase-js query-builder surface
plus a stubbed `global.fetch` were used to exercise the real, unmodified
controller code end-to-end (not just read it). All of the following pass:

1. Manual course creation, happy path — course row created, correct shape
   returned, 201 status.
2. Manual course creation, missing title — clean 400, not a silent failure.
3. Missing Supabase config — now surfaces the actionable message via a
   proper `ApiError` instead of "Internal server error".
4. Missing `courses` table (`42P01`/`PGRST205`) — now surfaces the
   migration-file hint instead of an opaque 500.
5. Full PDF import pipeline, happy path — manifest → per-problem expansion
   → Final Assessment generation → course + `course_problems` + `quizzes` +
   `questions` (+ MCQ options) rows all created automatically, import
   record ends `approved` with `course_id` set.
6. A Gemini call that **never resolves** — confirmed the import now times
   out and cleanly reports `status: "failed"` with a clear timeout message,
   instead of hanging on `"processing"` forever (this is the exact bug
   reported).
7. A hanging `pdf-parse` call — confirmed `extractPdfText` now fails fast
   instead of blocking the upload request indefinitely.
8. Gemini 429 rate-limit retry logic (added in an earlier pass) — confirmed
   it still works correctly alongside the new per-request timeout.

Also re-verified this pass, unchanged:
- `node --check` on every single `.js` file in `backend/src` — zero syntax
  errors.
- `npm install && npm run build` (frontend) — zero errors, same bundle
  shape as before.
- `oxlint` — same 103 pre-existing baseline errors, zero new errors or
  warnings on any file touched by this change.

### What you still need to do
This sandbox cannot reach your real Supabase project or the Gemini API
(both endpoints are outside its network allowlist), so the fixes above were
verified with realistic mocks rather than your live services. Before
testing for real:
1. Confirm `backend/sql/schema.sql` → `migration_courses.sql` →
   `migration_certificates.sql` have all been run, **in that order**, in
   your Supabase project's SQL editor. If Manual Course Creation still
   fails after this update, the new error message will now tell you
   exactly which of these is missing instead of a generic failure.
2. Confirm `GEMINI_API_KEY` in `backend/.env` is a valid, currently-active
   key for the model in `GEMINI_MODEL` (`gemini-3.6-flash` by default) — a
   bad/expired key now fails fast with a clear "Gemini API request failed
   (401/403)" message instead of any ambiguity.
3. Restart the backend after pulling this update so the new timeout/
   error-handling code is actually running.

---


## Prompt 4 — Mobile responsiveness + Gemini API migration

### Mobile responsiveness
The app was already built mobile-first in most places (quiz runner, course
pages, Playground, forms all already had `sm:`/`lg:` breakpoints and
`overflow-x-auto` tables). Two real gaps were fixed:

- **Admin Portal** (`AdminSidebar.jsx`, `AdminLayout.jsx`): the sidebar was
  `hidden lg:flex` with no mobile alternative at all — Admin was unusable
  below the `lg` breakpoint. Added a slide-in drawer (`AdminSidebarDrawer`)
  opened by a hamburger button in the header, sharing the same nav-link
  markup as the desktop rail so they can't drift apart. The header row now
  wraps instead of squeezing when a page's action buttons don't fit.
- **Student navbar** (`StudentNavbar.jsx`): five nav links had no mobile
  fallback — added a hamburger dropdown menu below `md`.
- A few 2-column forms (`AdminQuizBuilder.jsx`, `AdminCourses.jsx`) were
  forced to `grid-cols-2` with no mobile stacking; changed to
  `grid-cols-1 sm:grid-cols-2`.
- `index.css`: inputs/selects/textareas now render at 16px on screens under
  640px so focusing a field doesn't trigger iOS Safari's automatic
  zoom-in; added a page-level `overflow-x: hidden` safety net.

### Anthropic → Google Gemini
`backend/src/utils/courseAiExtractor.js` (Admin → Courses → Upload PDF) was
rewritten from the Anthropic Messages API to Google's Gemini
`generateContent` REST endpoint, called via Node's built-in `fetch` (no new
SDK dependency). Uses Gemini's native `responseMimeType: "application/json"`
so the model returns raw JSON directly, with the same defensive
markdown-fence-stripping fallback as before. Same three-stage pipeline
(manifest → per-problem expansion → Final Assessment) and same exported
function signatures, so `adminCourseController.js` needed no changes.

- `backend/src/config/env.js`: `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` →
  `GEMINI_API_KEY`/`GEMINI_MODEL` (default `gemini-3.6-flash`).
- `backend/package.json`: removed `@anthropic-ai/sdk`.
- `backend/.env`, `backend/.env.example`, `README.md`: updated accordingly.

Verified with `node --check` across every backend file, a clean
`npm install` (confirms no leftover `@anthropic-ai/sdk` references in the
lockfile), and a clean frontend `vite build`. The Gemini call itself
could not be exercised end-to-end in this sandbox (no network access to
`generativelanguage.googleapis.com`).

### Follow-up: default model name update
The first pass shipped with `GEMINI_MODEL` defaulting to `gemini-2.5-flash`.
Testing against a live key returned `404: This model models/gemini-2.5-flash
is no longer available to new users` — Google has moved new API keys onto
newer models. Default updated to `gemini-3.6-flash` (the model the error
message itself pointed to) in `env.js`, `.env`, `.env.example`, and
`README.md`. If Google rotates model availability again, this is a one-line
change: set `GEMINI_MODEL` in `backend/.env` to whatever `gemini-*` name
your key currently supports — the extractor never hardcodes a model name.

## Prompt 3 — PDF course upload wasn't creating the course

### Root cause
The PDF import pipeline (upload → AI extraction → structured problems/
assessment) was working correctly, but it **stopped one step short**: after
extraction finished, the import just sat in a `ready_for_review` state and
required the admin to open a separate review screen and click "Approve &
create course" before anything was written to `courses` / `course_problems`.
If that click never happened (or the admin didn't know to look for it), the
extracted content never became a real course — matching exactly what was
reported ("the course is not being automatically created").

### Fix
`backend/src/controllers/adminCourseController.js`

- Factored the course-creation logic (insert `courses` row, insert all
  `course_problems` rows, materialize the Final Assessment as a `quizzes` +
  `questions` row set) out of the old `approveImport` handler into a shared
  `createCourseFromImportData()` function.
- `runImportJob` (the background job started by `POST
  /admin/courses/import/pdf`) now calls this function **immediately after
  extraction succeeds** — the course, its problems, and its assessment are
  created automatically, with zero admin clicks. The import record is marked
  `approved` and linked to the new `course_id` right away.
- **Failure isolation, so one bad step can't silently lose work:**
  - If AI extraction itself fails (e.g. missing `ANTHROPIC_API_KEY`, bad
    PDF), the import is marked `failed` with the real error message — no
    partial course is ever created.
  - If extraction *succeeds* but the course-creation step fails (e.g. a
    transient DB error), the import falls back to `ready_for_review` with
    the extracted data intact, so the admin can fix/retry from the review
    screen instead of re-uploading and re-extracting the whole PDF.
  - If the course row is created but its problems fail to save, the
    orphaned, problem-less course row is deleted automatically — the Admin
    Portal never shows a broken half-course.
- `backend/src/routes/admin.js`: the PDF-upload file filter now raises a
  proper `ApiError(400, "Only PDF files are accepted")` instead of a plain
  `Error` (which the global error handler was turning into an opaque
  "Internal server error" instead of the intended message), and a new
  `pdfUploadSingle` wrapper turns multer's own errors (e.g. "file too large")
  into the same clean 400 shape.
- `backend/src/controllers/adminCourseController.js` (`getImport`): now also
  returns `course_id` so the frontend can redirect to the finished course.

`frontend/src/pages/admin/AdminCourseImportReview.jsx`

- Once an import reports `status: "approved"`, the review page now
  auto-redirects straight to the newly created, fully editable course page
  (`/admin/courses/:id`) instead of waiting for a manual "Approve" click that
  no longer exists in the normal flow.
- The `ready_for_review` screen (title/description/problems editor +
  Approve button) is kept as-is — it's now only reached in the fallback case
  where extraction succeeded but automatic creation failed, so the admin can
  fix and retry without re-uploading.

### What this means for the existing manual course flow
Unchanged. `POST /admin/courses`, `POST /admin/courses/:courseId/problems`,
and the whole Admin → Courses → New Course / Edit UI use entirely separate
handlers (`createCourse`, `createProblem`, `updateProblem`, …) that were not
touched.

### Verified
- `node --check` on every changed backend file; the real Express server
  boots cleanly with no `.env` (clear warning, no crash) and with a stub
  `.env` (routes respond, auth guard on `/admin/courses/import/pdf` works).
- A full in-memory simulation of `uploadPdfImport` → its background
  `runImportJob`, with a fake Supabase client and a stubbed AI extractor
  (no network/API key needed): confirmed the course, both extracted
  problems, the Final Assessment quiz, its 3 questions (MCQ + programming +
  fill-in-the-blank), and its 4 MCQ options are all created correctly, and
  the import record ends up `approved` and linked to the new course id.
- Same simulation for the three failure paths above (extraction fails / DB
  insert of the course fails / DB insert of the problems fails after the
  course was created) — confirmed each produces the intended, non-destructive
  state with assertions on every table.
- `npm run build` (frontend) — zero errors. `npm run lint` (oxlint) — 103
  errors, the same pre-existing baseline noted in earlier passes; no new
  errors on any file touched by this change.
- Confirmed the manual course/problem creation endpoints and their frontend
  forms are byte-for-byte unmodified.

---

## Prompt 2 — Assessment gate, progress, certificates & email

### 1. New database tables/columns
`backend/sql/migration_certificates.sql` (run **after** `migration_courses.sql`
— not appended into `schema.sql`, same reasoning as `migration_courses.sql`
itself: `schema.sql` must stay runnable standalone on a brand-new database,
before Courses/`courses` exists at all).

- `course_completions` — one row per (course, student): problems
  completed/total, last assessment percentage/pass, `status`
  (`in_progress`/`completed`), certificate id + issue time, email
  status/sent-at/error. This is the single source of truth the Dashboard,
  `CourseDetail`, and the Admin "Certificates" panel all read from.
- `attendance.device_id` — the anonymous per-browser device id (already used
  for practice-problem progress) is now also recorded at Final Assessment
  login time, so a passed attempt can be matched back to the right device's
  solved-problems for gating and certificate data.
- Entirely additive/idempotent — nothing existing is altered, and a database
  that hasn't run this migration keeps working exactly as before (probed via
  `featureSupport.courseCompletionsSupported()`; the gate, certificates and
  emails just stay off until it's applied).

### 2. Gate: must solve every problem before the Final Assessment
`backend/src/controllers/studentController.js` (`joinQuiz`)

- When the quiz being joined is a course's `assessment_quiz_id`, joining now
  requires: (a) an `X-Device-Id` header, and (b) every `course_problems` row
  for that course to have a `solved` `course_problem_progress` row for that
  device — otherwise a 403 with the exact remaining count is returned.
- An **email** field is now required (and validated) on this one quiz type
  only — used to send the certificate. Every other (non-course) quiz's
  registration form is completely unchanged (no new required field).
- `frontend/src/pages/student/QuizLogin.jsx` shows the email field and a
  short explanatory banner only when `GET /api/quizzes/:id` reports
  `isCourseAssessment: true`; sends `X-Device-Id` on the join request.
- `frontend/src/pages/student/CourseDetail.jsx`'s "Take Final Assessment"
  button is replaced with a disabled **Locked** state (with a lock icon)
  until every problem is solved.

### 3. Certificate generation & email
`backend/src/utils/certificate.js`, `backend/src/utils/mailer.js`,
`backend/src/controllers/quizAttemptController.js` (`maybeCompleteCourse`,
called from `finalizeAttempt` — the single choke point for manual submit,
auto-submit, and timeout, so every submission path is covered).

- On every graded course-assessment attempt, `course_completions` is
  upserted with the latest problems/percentage/pass status (so Dashboard
  always shows accurate progress and results, pass **or** fail).
- The **first time** a student has both solved every problem and passed,
  a unique certificate id (`CC-YYYYMMDD-XXXXXX`) is generated and a
  certificate PDF is rendered on the fly with `pdfkit` (landscape, club
  branding, student name, course title, register number, score, date,
  certificate id) — verified visually by rendering and inspecting it.
  Certificates are **never persisted to disk**: both emailing and
  downloading regenerate the identical PDF from the `course_completions`
  row, so nothing is lost on a server restart/redeploy.
- The PDF is emailed to the student's registered address via Gmail SMTP
  (`nodemailer`, configured with `SMTP_USER`/`SMTP_PASS` — an App Password —
  in `backend/.env`). Entirely best-effort/fail-soft: a mail outage or
  missing SMTP config only marks `email_status` as `failed`/`disabled` on
  the completion row — it can **never** break quiz grading or submission.
  Verified by booting the real server with a stub environment and hitting
  every new endpoint (validation, auth, and DB-failure paths) — confirmed
  correct status codes and that a downstream failure never crashes the
  process.
- Admins can **resend** a certificate email from the new Certificates panel
  (see below) — useful if a student mistyped their address.

### 4. Downloading a certificate
`backend/src/controllers/courseController.js` (`downloadCertificate`,
`GET /api/courses/:id/certificate`), `frontend/src/lib/certificate.js`

- Regenerates and streams the PDF for the requesting device's completed
  course. Used from both `CourseDetail.jsx` (assessment card) and
  `Dashboard.jsx` ("Your certificates" section).

### 5. Dashboard: progress, completed courses, assessment status, certificates
`frontend/src/pages/student/Dashboard.jsx`

- New summary tiles: **Courses completed** and **Certificates earned**
  (alongside the existing problems-solved/attempted/courses-started tiles).
- New **"Your certificates"** section — one card per certified course with a
  **Download** button.
- Each course card now shows an assessment-status pill: **Assessment
  locked** / **Assessment ready** / **Failed — N%** / **Certified**.

### 6. Admin visibility
`backend/src/controllers/adminCourseController.js` (`listCompletions`,
`resendCertificateEmail`), `frontend/src/pages/admin/AdminCourseBuilder.jsx`

- New **"Progress, results & certificates"** panel on each course's admin
  page: a table of every student who has attempted the Final Assessment —
  problems solved, last score, certificate id, email delivery status, and a
  one-click **resend email** action.

### 7. Verification performed
- Installed a real local PostgreSQL and ran `schema.sql` →
  `migration_courses.sql` → `migration_certificates.sql` in order (twice, to
  confirm idempotency) with **zero errors**; this also caught and fixed a
  latent ordering bug (a `courses`-dependent block had been appended into
  `schema.sql`, which must stay standalone-runnable — see README §4).
- Simulated the entire flow with raw SQL against that real database (course
  → problems → solved progress → passed attempt → certificate issuance) and
  confirmed the exact queries the controllers use return the right rows,
  including the unique constraint correctly rejecting a duplicate
  certificate for the same student+course.
- `node --check` on every backend file; booted the real Express server and
  exercised the new/changed endpoints end-to-end (validation errors, auth
  errors, graceful DB-failure handling — server never crashed).
- `npm run build` (frontend) — **zero errors**; `npm run lint` (oxlint) shows
  **no new errors or warnings** on any file touched by this change (same 103
  pre-existing baseline errors as the unmodified project).
- Confirmed no regression to existing `attendance` consumers (
  `adminAttendanceController.js`, `adminParticipantController.js`,
  `adminResultsController.js`) — all use explicit column lists that don't
  include the new `device_id` column, or `select("*")`, so the additive
  column is fully backward compatible.

---

## Previous pass — larger editor, correct operator rendering, admin "View attempt"

### 1. Editor size & comfort
`frontend/src/components/student/CodeEditor.jsx`

- The editor now fills a configurable height (defaults to `56vh`/`52vh` —
  roughly half the screen) instead of a fixed ~430px box, with a **Full
  screen** toggle (button, or `Esc` to exit) for even more room on long
  programs. Both the quiz workspace (`CodingWorkspace.jsx`) and the
  standalone Programming playground (`Playground.jsx`) use the larger sizing.
- Font size bumped from `text-sm`/`leading-relaxed` to `text-[15px]`/
  `leading-7` for more comfortable typing, matching a real code editor.
- The gutter (line numbers) and the text area still scroll in perfect sync,
  and now both reliably expose the **entire** program — nothing is clipped;
  everything beyond the visible height is reachable by scrolling (mouse
  wheel, trackpad, or scrollbar), in both the normal and full-screen modes.
- No behavior change to typing, Tab-indent, auto-indent on Enter, or
  `value`/`onChange` — only sizing/presentation changed.

### 2. Operators (`<=`, `>=`, `==`, `!=`, `<`, `>`) rendering incorrectly
`frontend/src/index.css`, `CodeEditor.jsx`, `Console.jsx`

Root cause: the code font (JetBrains Mono) ships with **programming
ligatures** enabled by default in the browser, which visually *fuses*
sequences like `<=`, `>=`, `==`, `!=`, `->` into a single merged glyph. The
characters typed, stored, compiled and executed were always correct — this
was a display-only issue, but a confusing one in a compiler/editor context
where students need to see (and trust) the literal characters they typed.

**Fix:** ligatures are now explicitly disabled everywhere the monospace font
renders code — a global rule for every `.font-mono` element in `index.css`
(`font-variant-ligatures: none` + `font-feature-settings: "liga" 0, "clig" 0,
"calt" 0, "dlig" 0`), plus the same setting applied inline on the editor
textarea and the console/output panes as defense in depth. Verified this
does not affect execution — Python, C, C++ programs using `<=`, `>=`, `==`,
`!=` inside conditionals were compiled and run directly against the local
toolchain (`localRunner.js`) with correct results (e.g. a C program with
`if (x >= 10 && x <= 20)` and a C++ program with `if (a != b)` both executed
and produced the correct branch), confirming the operators were never
mis-executed — only mis-*displayed* before this fix.

### 3. Admin Results — "View" per attempt
`frontend/src/pages/admin/AdminResults.jsx`

- Added a **View** (eye icon) button next to each row's existing Delete
  button, opening a modal (reusing the existing `Modal` component) with:
  - Score, percentage, correct/wrong/unanswered counts, pass/fail status
  - Every question the student attended, in order, each showing:
    - **MCQ**: the option the student selected vs. the correct option
    - **Fill in the blank**: the student's submitted blank(s) vs. the correct
      blank(s)
    - **Coding**: the language, the exact submitted source code (rendered
      with ligatures disabled, same as the editor, so operators are legible),
      and marks awarded
  - Per-question correctness badge (Correct / Partial / Wrong / Unanswered)
    and marks awarded out of the question's total marks.
- This uses the **existing** backend endpoint `GET /api/admin/results/:attemptId`
  (`adminResultsController.getResultDetail`) — already implemented and
  already wired into `routes/admin.js` — no backend changes were needed for
  this feature; only the missing frontend UI was added.
- Existing Delete/PDF export/live-refresh behavior on the Results page is
  unchanged.

### 4. Compiler-style console (carried over, unchanged this pass)
The unified console (single panel with output + an always-visible stdin box,
Run/Submit in the console footer) added in the previous pass is untouched
and still used by both the quiz workspace and the Programming playground.

### Verified this pass
- Every `.jsx` file parses successfully (`esbuild`, JSX loader) and the full
  app bundles cleanly end-to-end with all internal imports resolved.
- All backend `.js` files pass `node --check`.
- The local judge (`localRunner.js` / `executeCode`) was exercised directly
  for Python, C and C++ with `<=`, `>=`, `==`, `!=` in real conditionals,
  plus compile-error, runtime-error and timeout cases — all reported the
  correct status and output. Java has no JDK installed in this build
  sandbox, so it correctly reports `judge_unavailable` here; this is an
  environment/installation matter (see "Still required from you" below),
  not a code defect — the same Java code path is otherwise unchanged from
  the already-verified previous pass.
- `npm install` could not be run in this build sandbox (outbound registry
  access is blocked here), so a full `vite build` was not executed; instead
  every source file was syntax-checked individually and the entire module
  graph was bundled with `esbuild` (all imports externalized to `react`,
  `react-dom`, `react-router-dom`, `lucide-react`, `recharts`,
  `socket.io-client`, `jspdf*`) with zero resolution or syntax errors. Run
  `npm install && npm run build` in `frontend/` in your normal environment
  to produce the production build; nothing in this pass changes package
  dependencies.


## 1. `+ New File` in Programming → My Programs
`frontend/src/pages/student/Playground.jsx`

- Added a **"New File"** button in the Programming toolbar (creates a file in
  the currently selected language) and a **"+"** button on each language
  folder in the "My Programs" sidebar (creates a file in that folder's
  language).
- New files get a unique, auto-suggested name (`program.py`, `program-2.py`,
  ...), start from the same starter template used for "Reset", and open
  immediately in the editor — ready to name, edit, save (`Save` button,
  unchanged), run (`Run Code`, unchanged) and delete (trash icon, unchanged).
- No existing behavior was touched: Save, Reset, Run, the Java "Add class"
  multi-file support, and the delete confirmation dialog all work exactly as
  before. Programs are still stored client-side in `localStorage`
  (`playground.programs.v1`), same schema as before, so any programs a
  student already saved are unaffected.

## 2. Root cause of install/build failures (the real "limit.exe"-adjacent bug)
`backend/package-lock.json`, `frontend/package-lock.json`

Both lockfiles had every package's `resolved` URL pointing at a **private,
access-restricted registry**
(`europe-west4-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache/...`) instead
of the public npm registry. Outside of that private environment, `npm ci` /
`npm install` fails immediately with `403 Forbidden`, which prevents the
backend from ever starting — so the compilers/toolchains never get exercised,
`node_modules` never gets created, and any run attempt breaks before it
reaches the judge. This is very likely what produced the confusing
`limit.exe` / `..._RUN` failure: without a working `npm install`, the backend
can't boot, so **the actual `main.exe` compiled by `gcc`/`g++` never runs**
inside a clean sandbox, and instead you get inconsistent leftover/partial
executables and generic OS-level failures depending on machine state.

**Fix:** regenerated both lockfiles against the public npm registry
(`registry.npmjs.org`). Verified with a clean `npm install` on a fresh
machine for both `backend/` and `frontend/` — 121 and 179 packages installed
respectively, no errors.

## 3. Program-execution hardening (C / C++ / Java / Python)
`backend/src/utils/localRunner.js`

The judge itself (`localRunner.js` / `codeRunner.js`) was already well
hardened against the classic causes of these errors (Windows "app execution
alias" stubs, missing `javac` on PATH, JVM/Python startup being mistaken for
a timeout, etc. — see `backend/README-judge.md`). One gap was closed:

- If the OS refuses to start a freshly compiled program with `EPERM` /
  `EACCES` — the signature of **antivirus or Windows SmartScreen quarantining
  an unsigned temp `.exe`**, the most common real-world cause of a mysterious
  `<name>.exe` failure on Windows — the judge now reports a clear
  `judge_unavailable` result with an actionable message (add a temp-folder
  antivirus exclusion) instead of leaking a raw, confusing OS error to the
  student.

### Verified end-to-end (this pass)
With `python3`, `gcc`/`g++`, and a JDK (`javac`/`java`) installed, the full
HTTP flow was exercised for all four languages through the real
`/api/playground/run` endpoint (not just unit-level):

| Language | Status |
|---|---|
| Python | ✅ `ok` |
| C | ✅ `ok` |
| C++ | ✅ `ok` |
| Java | ✅ `ok` |

Also verified: non-zero exit codes are reported as `runtime_error` with a
clean message, not a raw OS error.

## 4. Untouched (verified, not modified)
UI, database schema, REST APIs, JWT auth, quiz engine, admin portal, student
portal, and results/ranking logic were not touched. `npm run build` for the
frontend completes with no errors, and `oxlint` reports zero new
issues (two pre-existing, unrelated warnings in `Playground.jsx` about
`setState` inside `useEffect` were already present before this change).

## Still required from you (environment-specific, cannot be done in this sandbox)
1. Run `npm install` in both `backend/` and `frontend/` with the corrected
   lockfiles.
2. Install the four toolchains on whatever machine runs the backend:
   `python3`, `gcc`/`g++` (`build-essential` on Debian/Ubuntu, MSYS2/MinGW-w64
   on Windows), and a **JDK** (not just a JRE) — see
   `backend/README-judge.md` for exact commands, or run
   `npm run setup:compilers` / `npm run check:runtimes` in `backend/`.
3. If you still see a program blocked on Windows after that, add an
   antivirus/Defender exclusion for your OS temp directory (that's where the
   judge compiles and runs student code) — this is what the new error
   message will tell you if it happens again.

## Verification pass (this delivery)

Everything below was executed against the real running app in a clean sandbox
(`npm install` for both `backend/` and `frontend/`, backend on :5000 with the
local judge, frontend dev server on :5173, plus a headless-browser run):

- `npm install` + `npm run build` (frontend) — succeed with no errors.
- Judge: Python, C, C++ **and Java** (JDK 21) all compile and run correctly
  with `>=`, `<=`, `==`, `!=`, `<`, `>` in real conditionals and stdin piped
  in — all four return status `ok` with the expected output, both through
  `localRunner` directly and through `POST /api/playground/run`.
- Programming page: the editor renders at 70vh (≈1250px tall on a 1800px
  viewport) with synced line-number gutter and a Full screen toggle; typed
  operators display as literal characters (no ligature fusing).
- Console: input typed straight into the console's stdin box + **Run Code**
  executes and prints the program output and exit status in the same panel.
- Admin → Results: the per-row **View** (eye) button opens the attempt detail
  modal — score/percentage/correct-wrong-unanswered/pass-fail, and every
  question with the student's answer, the correct answer, submitted code,
  expected output, test cases and marks awarded. Verified against live data
  for both MCQ and coding questions. No console errors.
- All existing features (quiz runner, results export, live view, leaderboard,
  admin CRUD, auth) untouched.

---

## Prompt 5 — Admin Portal → Courses page was broken (route-ordering bug)

### Root cause
`backend/src/routes/admin.js` registered `GET /courses/:id` **before**
`GET /courses/imports`. Express matches routes in registration order, so
every request to `/admin/courses/imports` was being swallowed by the
`:id` route first (treating the literal word `"imports"` as a course id),
which then failed at the database with an invalid-UUID error instead of
ever reaching `listImports`.

The frontend's Admin → Courses page loads courses and PDF imports together
via `Promise.all([...])`, so this one failing call rejected the whole
`load()` — meaning the page could show **zero courses even when courses
existed**, and the "PDF imports in progress" panel never worked. This
matches exactly what was reported ("Admin Portal → Courses" broken).

Everything the request asked for — manual course creation, unlimited
programming problems per course, Final Assessment creation/edit in the
same module, the assessment-unlocks-after-all-problems gate, certificate
issued only after passing, and PDF-imported courses sharing the same
tables/flow as manual ones — was already correctly implemented in the
backend and frontend; this routing bug was the actual defect breaking the
module end-to-end.

### Fix
Moved the whole PDF-import route block
(`POST /courses/import/pdf`, `GET /courses/imports`,
`GET /courses/imports/:id`, `PUT /courses/imports/:id`,
`POST /courses/imports/:id/approve`, `DELETE /courses/imports/:id`) to
register **before** the `/courses/:id` param routes, with a comment
explaining why the order matters so it doesn't regress. No controller,
frontend, or database code needed to change — the bug was purely route
registration order.

### Verified
- `node --check` on every backend file — no syntax errors.
- Backend boots cleanly against a stub `.env` (no crash, correct startup
  log).
- Isolated route-dispatch test (Express app mounting just `admin.js` with
  a stubbed `requireAdmin`, hitting `GET /courses/imports`): before the
  fix this reached `getCourse` (500 "Failed to load course"); after the
  fix it reaches `listImports` (confirmed by its distinct error text,
  "Failed to load imports", with a stub Supabase URL that has no real
  DB behind it).
- Frontend `npm run build` — zero errors, same output bundle as before.
- Manual/PDF course creation, problem CRUD, Final Assessment
  generation/edit, the assessment-unlock gate, and certificate issuance
  logic were all audited and confirmed already correct — untouched.

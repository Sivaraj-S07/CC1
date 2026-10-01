-- ============================================================================
-- College Quiz & Assessment Management System — Supabase schema
-- Run this whole file once in the Supabase SQL Editor (Project > SQL Editor).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- admins
-- The app currently authenticates a single admin via backend/.env
-- (ADMIN_EMAIL / ADMIN_PASSWORD_HASH). This table exists so the schema is
-- ready to support multiple admin accounts later without a migration.
-- ----------------------------------------------------------------------------
create table if not exists admins (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  name text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- students (participants)
-- One row per person; the same student can attempt many quizzes.
-- ----------------------------------------------------------------------------
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  register_number text not null unique,
  email text,
  mobile_number text,
  department text,
  year text,
  section text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_students_register_number on students (register_number);

-- ----------------------------------------------------------------------------
-- quizzes
-- ----------------------------------------------------------------------------
create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  password_hash text not null,
  duration_minutes integer not null default 30,
  start_time timestamptz,
  end_time timestamptz,
  max_marks numeric not null default 0,
  passing_percentage numeric not null default 40,
  max_attempts integer not null default 1,
  randomize_questions boolean not null default true,
  randomize_options boolean not null default true,
  auto_submit boolean not null default true,
  allow_late_join boolean not null default false,
  show_leaderboard boolean not null default true,
  tab_switch_limit integer not null default 3,
  status text not null default 'draft'
    check (status in ('draft', 'upcoming', 'live', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_quizzes_status on quizzes (status);

-- ----------------------------------------------------------------------------
-- questions (MCQ or programming/coding — see question_type below)
-- ----------------------------------------------------------------------------
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes (id) on delete cascade,
  question_text text not null,
  marks numeric not null default 1,
  negative_marks numeric not null default 0,
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_questions_quiz_id on questions (quiz_id);

-- ----------------------------------------------------------------------------
-- quiz_options
-- ----------------------------------------------------------------------------
create table if not exists quiz_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions (id) on delete cascade,
  option_text text not null,
  is_correct boolean not null default false,
  order_index integer not null default 0
);

create index if not exists idx_quiz_options_question_id on quiz_options (question_id);

-- ----------------------------------------------------------------------------
-- quiz_attempts
-- ----------------------------------------------------------------------------
create table if not exists quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  attempt_number integer not null default 1,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'submitted', 'auto_submitted')),
  question_order jsonb,           -- ordered array of question ids shown to this student
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  violations_count integer not null default 0,
  total_marks numeric,
  obtained_marks numeric,
  correct_count integer,
  wrong_count integer,
  unanswered_count integer,
  percentage numeric,
  passed boolean,
  created_at timestamptz not null default now(),
  unique (quiz_id, student_id, attempt_number)
);

create index if not exists idx_quiz_attempts_quiz_id on quiz_attempts (quiz_id);
create index if not exists idx_quiz_attempts_student_id on quiz_attempts (student_id);
create index if not exists idx_quiz_attempts_status on quiz_attempts (status);

-- ----------------------------------------------------------------------------
-- answers
-- ----------------------------------------------------------------------------
create table if not exists answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references quiz_attempts (id) on delete cascade,
  question_id uuid not null references questions (id) on delete cascade,
  selected_option_id uuid references quiz_options (id) on delete set null,
  answered_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create index if not exists idx_answers_attempt_id on answers (attempt_id);

-- ----------------------------------------------------------------------------
-- Programming / coding questions support, plus Fill-in-the-Blank questions.
-- Safe to re-run on an already-created database — every statement below is
-- idempotent (add-if-missing / drop-then-recreate), so existing question
-- data and rows are always untouched.
-- ----------------------------------------------------------------------------
alter table questions add column if not exists question_type text not null default 'mcq';
alter table questions add column if not exists language text;
alter table questions add column if not exists starter_code text;
alter table questions add column if not exists expected_output text;
alter table questions add column if not exists reference_solution text;

-- Fill-in-the-Blank support: one row's worth of blanks, each blank holding
-- its list of accepted answers, e.g. [["paris"], ["france", "french republic"]].
alter table questions add column if not exists blank_answers jsonb;
alter table questions add column if not exists case_sensitive boolean not null default false;

-- IMPORTANT: constraints are dropped and recreated unconditionally on every
-- run (not merely "create if missing"). A previous version of this schema
-- guarded these with `if not exists (select ... from pg_constraint)`, which
-- meant that once the constraint existed with the OLD, narrower definition
-- (question_type in ('mcq', 'coding')), re-running the file could never
-- widen it — every attempt to add a 'fill_blank' question kept failing the
-- stale check constraint even after the application code and this file were
-- updated to support it. Dropping and recreating avoids that trap for any
-- future question-type additions too.
alter table questions drop constraint if exists questions_question_type_check;
alter table questions add constraint questions_question_type_check
  check (question_type in ('mcq', 'coding', 'fill_blank'));

alter table questions drop constraint if exists questions_language_check;
alter table questions add constraint questions_language_check
  check (language is null or language in ('c', 'cpp', 'java', 'python'));

-- A student's submitted source code for a programming question, plus the
-- marks this specific answer was awarded (populated at grading time).
alter table answers add column if not exists code_answer text;
alter table answers add column if not exists marks_awarded numeric;

-- A student's submitted fill-in-the-blank answers, stored as a JSON array of
-- strings (one per blank, in order) so multi-blank questions grade cleanly.
alter table answers add column if not exists blank_answer jsonb;

-- The original `answers.selected_option_id` FK is only meaningful for MCQ
-- questions; it stays nullable and simply unused for coding answers.

-- ----------------------------------------------------------------------------
-- rounds
-- A quiz can be split into multiple rounds (e.g. "Round 1 — Aptitude",
-- "Round 2 — Coding"). Every question optionally belongs to one round; a
-- question with round_id = null simply lives in the quiz's "Unassigned" bucket
-- so existing quizzes created before rounds existed keep working untouched.
-- ----------------------------------------------------------------------------
create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes (id) on delete cascade,
  name text not null,
  description text,
  order_index integer not null default 0,
  qualification_percentage numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Existing databases created before these columns existed:
alter table rounds add column if not exists qualification_percentage numeric not null default 0;
alter table rounds add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_rounds_quiz_id on rounds (quiz_id);

-- Deleting a round keeps its questions (they fall back to "Unassigned").
alter table questions add column if not exists round_id uuid references rounds (id) on delete set null;
create index if not exists idx_questions_round_id on questions (round_id);

-- ----------------------------------------------------------------------------
-- attendance
-- ----------------------------------------------------------------------------
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  attempt_id uuid references quiz_attempts (id) on delete set null,
  join_time timestamptz not null default now(),
  quiz_start_time timestamptz,
  submission_time timestamptz,
  status text not null default 'present' check (status in ('present', 'absent')),
  completed boolean not null default false,
  unique (quiz_id, student_id)
);

create index if not exists idx_attendance_quiz_id on attendance (quiz_id);
create index if not exists idx_attendance_student_id on attendance (student_id);

-- ============================================================================
-- Row Level Security — deny-by-default.
--
-- This backend's Express API is the ONLY thing that talks to Supabase, and it
-- always uses the SERVICE ROLE key, which bypasses RLS entirely. The frontend
-- never receives the service-role key and never queries Supabase directly.
-- So: enable RLS everywhere, add NO policies for anon/authenticated. This
-- means even if the anon/publishable key ever leaked, it could read or write
-- nothing.
-- ============================================================================
alter table admins enable row level security;
alter table students enable row level security;
alter table quizzes enable row level security;
alter table questions enable row level security;
alter table quiz_options enable row level security;
alter table quiz_attempts enable row level security;
alter table answers enable row level security;
alter table attendance enable row level security;
alter table rounds enable row level security;

-- Seed the default admin (email: admin@gmail.com / password: admin123).
-- Change the password later with: cd backend && npm run hash-password -- "newPassword"
-- then update this row (or just rely on backend/.env, which the API checks first).
insert into admins (email, password_hash, name)
values (
  'admin@gmail.com',
  '$2a$10$Bf.2j0TfLkAgf9hgRohNPeEGvz1LYHvvMl65mvjbetZtt2GdafV9u',
  'Administrator'
)
on conflict (email) do nothing;

-- Per-question time limit (in seconds). NULL / 0 means "no limit for this
-- question" — the student is then only bound by the overall quiz duration.
-- Admins set this per question in the Admin Portal (seconds or minutes).
alter table questions add column if not exists time_limit_seconds integer;

-- ----------------------------------------------------------------------------
-- Server-authoritative per-question timing (v12 quiz-system fix)
--
-- One row per (attempt, question). The row is created the first time the
-- question becomes active for that attempt and is NEVER reset — refreshing the
-- page, reopening the tab or replaying the API simply reads the same
-- started_at / expires_at, so the countdown cannot be restarted from the
-- browser. The backend rejects answers for questions whose expires_at passed.
-- ----------------------------------------------------------------------------
create table if not exists question_timings (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references quiz_attempts (id) on delete cascade,
  question_id uuid not null references questions (id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  expired boolean not null default false,
  unique (attempt_id, question_id)
);

create index if not exists idx_question_timings_attempt_id on question_timings (attempt_id);

-- Last question the student was on — restored after a refresh.
alter table quiz_attempts add column if not exists current_question_index integer not null default 0;

-- ============================================================================
-- v22 — Round qualification, per-notification read state
-- ============================================================================

-- Minimum percentage of a round a student must score to unlock the next round.
-- 0 (default) means "no qualification gate" — every existing quiz keeps working.
alter table rounds add column if not exists qualification_percentage numeric not null default 0;

-- Per-admin read state for the notification feed. The feed itself is derived
-- from recent activity (submissions / quizzes), so only the read marker needs
-- to be persisted — that is what makes the red unread dot disappear for good
-- once the admin has actually seen a notification.
create table if not exists admin_notification_reads (
  id uuid primary key default gen_random_uuid(),
  admin_key text not null default 'admin',
  notification_id text not null,
  read_at timestamptz not null default now(),
  unique (admin_key, notification_id)
);

create index if not exists idx_admin_notification_reads_key on admin_notification_reads (admin_key);

alter table admin_notification_reads enable row level security;

-- ============================================================================
-- Programming questions (LeetCode / HackerRank style) + negative marking for
-- every question type.
--
-- Safe to run on an existing database — every statement is idempotent and no
-- existing column or row is modified or dropped.
-- Run this in the Supabase SQL Editor (it is also appended to schema.sql).
-- ============================================================================

-- Rich problem definition for coding questions -------------------------------
alter table questions add column if not exists problem_statement text;
alter table questions add column if not exists input_format text;
alter table questions add column if not exists output_format text;
alter table questions add column if not exists constraints_text text;

-- Sample (visible) I/O shown to the student:
--   [{ "input": "3 4", "output": "7", "explanation": "3 + 4" }]
alter table questions add column if not exists sample_io jsonb not null default '[]'::jsonb;

-- Hidden test cases used for grading. NEVER sent to the client:
--   [{ "input": "3 4", "expectedOutput": "7", "hidden": true }]
alter table questions add column if not exists test_cases jsonb not null default '[]'::jsonb;

-- Per-execution CPU/wall time limit in milliseconds.
alter table questions add column if not exists time_limit_ms integer not null default 3000;

-- Languages the student may choose from, e.g. ["python","cpp"].
-- Empty array = fall back to the single `language` column.
alter table questions add column if not exists allowed_languages jsonb not null default '[]'::jsonb;

-- Judge verdict for a submitted coding answer:
--   { "status": "ok", "passed": 8, "total": 10, "ratio": 0.8, "language": "python" }
alter table answers add column if not exists judge_result jsonb;

-- The language the student actually submitted in.
alter table answers add column if not exists language text;

-- Negative marking now applies to coding and fill-in-the-blank questions too.
-- The column already exists for MCQ; this only guarantees it is present.
alter table questions add column if not exists negative_marks numeric not null default 0;


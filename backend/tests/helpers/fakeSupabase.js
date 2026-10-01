/**
 * Minimal in-memory stand-in for the parts of @supabase/supabase-js the admin
 * controllers use. It enforces the same things the real database would that
 * matter for Copy/Paste Quiz: known columns, NOT NULL / CHECK constraints,
 * foreign keys with ON DELETE CASCADE / SET NULL, and PostgREST's 1000-row
 * response cap. Used only by `npm test`.
 */
const crypto = require("crypto");

const FULL_SCHEMA = {
  quizzes: {
    cols: [
      "id", "title", "description", "password_hash", "duration_minutes", "start_time", "end_time",
      "max_marks", "passing_percentage", "max_attempts", "randomize_questions", "randomize_options",
      "auto_submit", "allow_late_join", "show_leaderboard", "tab_switch_limit", "status",
      "created_at", "updated_at",
    ],
    defaults: () => ({
      description: null, start_time: null, end_time: null, duration_minutes: 30, max_marks: 0,
      passing_percentage: 40, max_attempts: 1, randomize_questions: true, randomize_options: true,
      auto_submit: true, allow_late_join: false, show_leaderboard: true, tab_switch_limit: 3,
      status: "draft",
    }),
    notNull: ["title", "password_hash"],
    checks: [(r) => ["draft", "upcoming", "live", "completed"].includes(r.status) || "quizzes_status_check"],
  },
  rounds: {
    cols: ["id", "quiz_id", "name", "description", "order_index", "qualification_percentage", "created_at", "updated_at"],
    defaults: () => ({ description: null, order_index: 0, qualification_percentage: 0 }),
    notNull: ["quiz_id", "name"],
    fks: [{ col: "quiz_id", table: "quizzes", onDelete: "cascade" }],
  },
  questions: {
    cols: [
      "id", "quiz_id", "question_text", "marks", "negative_marks", "order_index", "created_at", "updated_at",
      "question_type", "language", "starter_code", "expected_output", "reference_solution", "blank_answers",
      "case_sensitive", "round_id", "time_limit_seconds", "problem_statement", "input_format",
      "output_format", "constraints_text", "sample_io", "test_cases", "time_limit_ms", "allowed_languages",
    ],
    defaults: () => ({
      marks: 1, negative_marks: 0, order_index: 0, question_type: "mcq", language: null, starter_code: null,
      expected_output: null, reference_solution: null, blank_answers: null, case_sensitive: false,
      round_id: null, time_limit_seconds: null, problem_statement: null, input_format: null,
      output_format: null, constraints_text: null, sample_io: [], test_cases: [], time_limit_ms: 3000,
      allowed_languages: [],
    }),
    notNull: ["quiz_id", "question_text"],
    checks: [
      (r) => ["mcq", "coding", "fill_blank"].includes(r.question_type) || "questions_question_type_check",
      (r) => r.language == null || ["c", "cpp", "java", "python"].includes(r.language) || "questions_language_check",
    ],
    fks: [
      { col: "quiz_id", table: "quizzes", onDelete: "cascade" },
      { col: "round_id", table: "rounds", onDelete: "setnull" },
    ],
  },
  quiz_options: {
    cols: ["id", "question_id", "option_text", "is_correct", "order_index"],
    defaults: () => ({ is_correct: false, order_index: 0 }),
    notNull: ["question_id", "option_text"],
    fks: [{ col: "question_id", table: "questions", onDelete: "cascade" }],
  },
  quiz_attempts: {
    cols: ["id", "quiz_id", "student_id", "status", "created_at"],
    defaults: () => ({ status: "in_progress" }),
    notNull: ["quiz_id"],
    fks: [{ col: "quiz_id", table: "quizzes", onDelete: "cascade" }],
  },
  attendance: {
    cols: ["id", "quiz_id", "student_id", "status", "created_at"],
    defaults: () => ({ status: "present" }),
    notNull: ["quiz_id"],
    fks: [{ col: "quiz_id", table: "quizzes", onDelete: "cascade" }],
  },
  answers: {
    cols: ["id", "attempt_id", "question_id", "judge_result", "language", "code_answer", "marks_awarded"],
    defaults: () => ({}),
    notNull: [],
    fks: [],
  },
  students: { cols: ["id", "name", "register_number", "created_at"], defaults: () => ({}), notNull: [], fks: [] },
  question_timings: { cols: ["id", "attempt_id", "question_id"], defaults: () => ({}), notNull: [], fks: [] },
};

const MAX_ROWS = 1000; // PostgREST default response cap

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

class FakeDb {
  /**
   * @param {object} [opts]
   * @param {string[]} [opts.dropColumns] e.g. ["questions.round_id"] to emulate an un-migrated database
   * @param {string[]} [opts.dropTables]
   */
  constructor(opts = {}) {
    this.schema = {};
    for (const [name, def] of Object.entries(FULL_SCHEMA)) {
      if ((opts.dropTables || []).includes(name)) continue;
      this.schema[name] = { ...def, cols: def.cols.filter((c) => !(opts.dropColumns || []).includes(`${name}.${c}`)) };
    }
    this.tables = Object.fromEntries(Object.keys(this.schema).map((n) => [n, []]));
    this.failNext = new Map(); // "table.op" -> error message
    this.log = [];
  }

  /** Make the next insert/update/delete on a table fail (to test rollback). */
  failOnce(table, op, message = "simulated failure") {
    this.failNext.set(`${table}.${op}`, message);
  }

  from(name) {
    return new Query(this, name);
  }

  // ---- constraint helpers ---------------------------------------------------
  cascadeDelete(table, ids) {
    if (!ids.length) return;
    for (const [childName, def] of Object.entries(this.schema)) {
      for (const fk of def.fks || []) {
        if (fk.table !== table) continue;
        const affected = this.tables[childName].filter((r) => ids.includes(r[fk.col]));
        if (!affected.length) continue;
        if (fk.onDelete === "cascade") {
          const childIds = affected.map((r) => r.id);
          this.tables[childName] = this.tables[childName].filter((r) => !ids.includes(r[fk.col]));
          this.cascadeDelete(childName, childIds);
        } else if (fk.onDelete === "setnull") {
          affected.forEach((r) => (r[fk.col] = null));
        }
      }
    }
  }
}

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.op = "select";
    this.filters = [];
    this.orders = [];
    this.rangeFrom = null;
    this.rangeTo = null;
    this.limitN = null;
    this.cols = "*";
    this.countMode = null;
    this.head = false;
    this.returning = false;
    this.mode = "many"; // many | single | maybeSingle
  }

  select(cols = "*", opts = {}) {
    if (this.op === "select") this.cols = cols;
    else this.returning = true;
    if (opts.count) this.countMode = opts.count;
    if (opts.head) this.head = true;
    return this;
  }
  insert(rows) { this.op = "insert"; this.payload = rows; return this; }
  update(fields) { this.op = "update"; this.payload = fields; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); this.filterCols = [...(this.filterCols || []), col]; return this; }
  is(col, val) { this.filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return this; }
  in(col, vals) { this.filters.push((r) => vals.includes(r[col])); return this; }
  order(col, { ascending = true } = {}) { this.orders.push({ col, ascending }); return this; }
  range(from, to) { this.rangeFrom = from; this.rangeTo = to; return this; }
  limit(n) { this.limitN = n; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybeSingle"; return this; }

  then(resolve, reject) {
    return Promise.resolve().then(() => this.exec()).then(resolve, reject);
  }

  fail(message, code = "XX000") {
    return { data: null, error: { message, code }, count: null };
  }

  exec() {
    const { db, table } = this;
    const def = db.schema[table];
    if (!def) return this.fail(`relation "public.${table}" does not exist`, "42P01");

    const forced = db.failNext.get(`${table}.${this.op}`);
    if (forced) {
      db.failNext.delete(`${table}.${this.op}`);
      return this.fail(forced);
    }

    if (this.op === "select") return this.execSelect(def);
    if (this.op === "insert") return this.execInsert(def);
    if (this.op === "update") return this.execUpdate(def);
    return this.execDelete();
  }

  matching() {
    return db_rows(this.db, this.table).filter((r) => this.filters.every((f) => f(r)));
  }

  execSelect(def) {
    const embedOptions = /quiz_options\(/.test(this.cols);
    const plain = this.cols
      .replace(/quiz_options\([^)]*\)/g, "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    for (const c of plain) {
      if (c !== "*" && !def.cols.includes(c)) return this.fail(`column ${this.table}.${c} does not exist`, "42703");
    }
    let rows = this.matching().map((r) => clone(r));
    for (const { col, ascending } of [...this.orders].reverse()) {
      rows.sort((a, b) => {
        const x = a[col], y = b[col];
        if (x === y) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    const total = rows.length;
    if (this.rangeFrom !== null) rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    rows = rows.slice(0, MAX_ROWS);

    if (!plain.includes("*") && plain.length) {
      rows = rows.map((r) => Object.fromEntries(plain.map((c) => [c, r[c]])));
    }
    if (embedOptions) {
      const opts = this.db.tables.quiz_options;
      rows = rows.map((r) => ({ ...r, quiz_options: opts.filter((o) => o.question_id === r.id).map(clone) }));
    }
    const count = this.countMode ? total : null;
    if (this.head) return { data: null, error: null, count };
    return this.shape(rows, count);
  }

  shape(rows, count = null) {
    if (this.mode === "many") return { data: rows, error: null, count };
    if (rows.length > 1) return this.fail("multiple rows returned", "PGRST116");
    if (this.mode === "single" && rows.length === 0) return this.fail("no rows returned", "PGRST116");
    return { data: rows[0] || null, error: null, count };
  }

  checkRow(def, row) {
    for (const k of Object.keys(row)) {
      if (!def.cols.includes(k)) {
        return this.fail(`Could not find the '${k}' column of '${this.table}' in the schema cache`, "PGRST204");
      }
    }
    for (const c of def.notNull || []) {
      if (row[c] === null || row[c] === undefined) return this.fail(`null value in column "${c}" violates not-null constraint`, "23502");
    }
    for (const check of def.checks || []) {
      const res = check(row);
      if (res !== true) return this.fail(`violates check constraint "${res}"`, "23514");
    }
    for (const fk of def.fks || []) {
      const v = row[fk.col];
      if (v != null && !this.db.tables[fk.table].some((r) => r.id === v)) {
        return this.fail(`insert violates foreign key constraint on ${fk.col}`, "23503");
      }
    }
    return null;
  }

  execInsert(def) {
    const list = Array.isArray(this.payload) ? this.payload : [this.payload];
    const staged = [];
    const now = new Date().toISOString();
    for (const input of list) {
      const defaults = Object.fromEntries(Object.entries(def.defaults()).filter(([k]) => def.cols.includes(k)));
      const row = { id: crypto.randomUUID(), ...defaults, ...clone(input) };
      if (def.cols.includes("created_at") && !row.created_at) row.created_at = now;
      if (def.cols.includes("updated_at") && !row.updated_at) row.updated_at = now;
      const err = this.checkRow(def, row);
      if (err) return err;
      if (this.db.tables[this.table].some((r) => r.id === row.id) || staged.some((r) => r.id === row.id))
        return this.fail("duplicate key value violates unique constraint", "23505");
      staged.push(row);
      // FK targets inside the same batch are not needed by our controllers.
    }
    this.db.tables[this.table].push(...staged);
    this.db.log.push(`insert ${this.table} x${staged.length}`);
    if (!this.returning) return { data: null, error: null, count: null };
    return this.shape(staged.map(clone));
  }

  execUpdate(def) {
    const rows = this.matching();
    for (const k of Object.keys(this.payload)) {
      if (!def.cols.includes(k)) return this.fail(`column "${k}" of relation "${this.table}" does not exist`, "42703");
    }
    rows.forEach((r) => Object.assign(r, clone(this.payload)));
    if (!this.returning) return { data: null, error: null, count: null };
    return this.shape(rows.map(clone));
  }

  execDelete() {
    const doomed = this.matching();
    const ids = doomed.map((r) => r.id);
    this.db.tables[this.table] = this.db.tables[this.table].filter((r) => !ids.includes(r.id));
    this.db.cascadeDelete(this.table, ids);
    return { data: null, error: null, count: null };
  }
}

function db_rows(db, table) {
  return db.tables[table];
}

module.exports = { FakeDb };

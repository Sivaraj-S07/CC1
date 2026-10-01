require("dotenv").config();

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    // Don't crash import-time in scripts that only need a subset of vars;
    // routes that actually need Supabase will fail loudly at request time instead.
    return undefined;
  }
  return value;
}

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT) || 5000,

  SUPABASE_URL: required("SUPABASE_URL"),
  SUPABASE_ANON_KEY: required("SUPABASE_ANON_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),

  JWT_SECRET: required("JWT_SECRET", "change-this-secret-in-production"),
  JWT_ADMIN_EXPIRES_IN: process.env.JWT_ADMIN_EXPIRES_IN || "8h",
  JWT_STUDENT_EXPIRES_IN: process.env.JWT_STUDENT_EXPIRES_IN || "12h",

  ADMIN_EMAIL: (process.env.ADMIN_EMAIL || "admin@gmail.com").toLowerCase(),
  // bcrypt hash of the admin password. Default hash below corresponds to "admin123"
  // (see backend/README section "Admin login" / scripts/hash-password.js to change it).
  ADMIN_PASSWORD_HASH:
    process.env.ADMIN_PASSWORD_HASH ||
    "$2a$10$Bf.2j0TfLkAgf9hgRohNPeEGvz1LYHvvMl65mvjbetZtt2GdafV9u",

  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5173",

  // Sandboxed code execution for programming questions.
  // Default provider is the LOCAL toolchain installed on this server
  // (gcc / g++ / python3 / JDK). A remote Piston-compatible sandbox is used
  // only when CODE_EXEC_URL is set — the PUBLIC Piston endpoint
  // (emkc.org) is whitelist-only since 2026-02-15 and answers 401, so it is
  // no longer used as a default. Self-host with docker-compose.judge.yml.
  CODE_EXEC_ENABLED: process.env.CODE_EXEC_ENABLED || "true",
  // "auto" (local first, remote fallback when configured) | "remote" | "local"
  CODE_EXEC_PROVIDER: process.env.CODE_EXEC_PROVIDER || "auto",
  // Comma-separated list of Piston-compatible /execute endpoints. Empty = none.
  CODE_EXEC_URL: process.env.CODE_EXEC_URL || "",
  CODE_EXEC_TOKEN: process.env.CODE_EXEC_TOKEN || "",
  CODE_EXEC_TIMEOUT: Number(process.env.CODE_EXEC_TIMEOUT) || 15000,
  // Key-less public fallback sandbox (Wandbox) used only when neither a local
  // toolchain nor CODE_EXEC_URL can run a language. Set to "off" to disable.
  CODE_EXEC_FALLBACK: process.env.CODE_EXEC_FALLBACK || "wandbox",
  WANDBOX_URL: process.env.WANDBOX_URL || "https://wandbox.org/api/compile.json",
  // Optional pinning, e.g. "c=gcc-12.3.0-c,cpp=gcc-12.3.0"
  WANDBOX_COMPILERS: process.env.WANDBOX_COMPILERS || "",
};

module.exports = env;

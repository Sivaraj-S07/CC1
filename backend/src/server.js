const http = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const env = require("./config/env");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");
const { requireAdmin } = require("./middleware/auth");
const compression = require("./middleware/compression");
const { initRealtime } = require("./realtime");

const adminRoutes = require("./routes/admin");
const studentRoutes = require("./routes/students");
const quizRoutes = require("./routes/quizzes");
const playgroundRoutes = require("./routes/playground");
const studentResultsRoutes = require("./routes/studentResults");

// Defense-in-depth: by default Node (>=15) terminates the *entire* process
// on any unhandled rejection, which would otherwise take down every
// in-flight admin request (quizzes, everything) over a single background
// hiccup. Log loudly instead of crashing.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandled rejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaught exception]", err);
});

const app = express();

// Render (and most reverse proxies) forwards X-Forwarded-For. Trust the
// first proxy so express-rate-limit can accurately identify clients.
app.set("trust proxy", 1);

app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
    credentials: true,
  })
);
// Paste Quiz receives an entire quiz (rounds, questions, hidden test cases…) in
// one request, which can exceed the default 1 MB. The larger limit applies to
// that single admin-only route, and only after the admin token is verified.
// body-parser skips a request that is already parsed, so the global parser
// below leaves it alone.
app.post("/api/admin/quizzes/paste", requireAdmin, express.json({ limit: "10mb" }));
app.use(express.json({ limit: "1mb" }));
if (env.NODE_ENV !== "test") {
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
}

// Basic rate limiting — generous defaults, tighter on auth endpoints.
const generalLimiter = rateLimit({ windowMs: 60 * 1000, max: 300 });
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });
app.use("/api", generalLimiter);
app.use("/api/admin/login", authLimiter);
app.use("/api/students/login", authLimiter);

app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "Quiz Assessment API is running" });
});

app.use("/api/admin", adminRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/student/results", studentResultsRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/playground", playgroundRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const httpServer = http.createServer(app);

// Socket.IO — admin-only realtime channel (new registrations, submissions,
// result updates). Admins authenticate with the same JWT used by the REST API.
initRealtime(
  httpServer,
  env.CORS_ORIGIN.split(",").map((o) => o.trim())
);

httpServer.listen(env.PORT, () => {
  console.log(`Quiz Assessment API listening on port ${env.PORT}`);
  // Discover the pre-installed language runtimes once, at boot. Nothing is
  // ever installed or downloaded while a student presses Run / Submit.
  require("./utils/localRunner")
    .warmupRuntimes()
    .catch((err) => console.warn("[judge] runtime warmup failed:", err.message));

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      "⚠️  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — database routes will fail until backend/.env is configured."
    );
  }
});

module.exports = app;

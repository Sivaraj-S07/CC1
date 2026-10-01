const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireStudent } = require("../middleware/auth");
const studentController = require("../controllers/studentController");
const quizAttemptController = require("../controllers/quizAttemptController");

const router = express.Router();

// Public
router.get("/", studentController.listPublicQuizzes);
router.get("/:id", studentController.getPublicQuiz);
router.get("/:id/leaderboard", quizAttemptController.leaderboard);

// Requires an active student session (issued by POST /api/students/login)
router.post("/:id/start", requireStudent, quizAttemptController.startAttempt);
router.post("/:id/question/start", requireStudent, quizAttemptController.activateQuestion);
router.post("/:id/answer", requireStudent, quizAttemptController.saveAnswer);
// Sandboxed execution is the most expensive endpoint in the app — cap it per
// client so a single student cannot flood the judge.
const codeExecLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

// Programming questions: Run against sample I/O, Submit against hidden tests.
router.post("/:id/code/run", requireStudent, codeExecLimiter, quizAttemptController.runCode);
router.post("/:id/code/submit", requireStudent, codeExecLimiter, quizAttemptController.submitCode);
router.post("/:id/violation", requireStudent, quizAttemptController.logViolation);
router.post("/:id/round/complete", requireStudent, quizAttemptController.completeRound);
router.post("/:id/submit", requireStudent, quizAttemptController.submitAttempt);
router.get("/:id/result", requireStudent, quizAttemptController.myResult);

module.exports = router;

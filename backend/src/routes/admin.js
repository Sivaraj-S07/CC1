const express = require("express");
const { requireAdmin } = require("../middleware/auth");
const adminAuthController = require("../controllers/adminAuthController");
const adminQuizController = require("../controllers/adminQuizController");
const adminQuizCloneController = require("../controllers/adminQuizCloneController");
const adminQuizPdfController = require("../controllers/adminQuizPdfController");
const adminQuestionController = require("../controllers/adminQuestionController");
const adminRoundController = require("../controllers/adminRoundController");
const adminParticipantController = require("../controllers/adminParticipantController");
const adminAttendanceController = require("../controllers/adminAttendanceController");
const adminResultsController = require("../controllers/adminResultsController");
const adminLiveController = require("../controllers/adminLiveController");
const adminNotificationController = require("../controllers/adminNotificationController");

const router = express.Router();

// Auth
router.post("/login", adminAuthController.login);

// Everything below requires a valid admin session
router.use(requireAdmin);

// Dashboard
router.get("/dashboard", adminQuizController.dashboardStats);

// Notifications
router.get("/notifications", adminNotificationController.listNotifications);
router.post("/notifications/read", adminNotificationController.markRead);
router.post("/notifications/read-all", adminNotificationController.markAllRead);

// Quizzes
router.get("/quizzes", adminQuizController.listQuizzes);
router.post("/quizzes", adminQuizController.createQuiz);
router.get("/quizzes/:id", adminQuizController.getQuiz);
router.put("/quizzes/:id", adminQuizController.updateQuiz);
router.delete("/quizzes/:id", adminQuizController.deleteQuiz);
router.patch("/quizzes/:id/status", adminQuizController.setPublishStatus);
// Copy Quiz / Paste Quiz
router.get("/quizzes/:id/export", adminQuizCloneController.exportQuiz);
router.post("/quizzes/paste", adminQuizCloneController.pasteQuiz);
// Export as PDF / Import Quiz from PDF
router.get("/quizzes/:id/export-pdf", adminQuizPdfController.exportQuizPdf);
router.post("/quizzes/import-pdf", adminQuizPdfController.uploadMiddleware, adminQuizPdfController.importQuizPdf);

// Rounds
router.get("/quizzes/:quizId/rounds", adminRoundController.listRounds);
router.post("/quizzes/:quizId/rounds", adminRoundController.createRound);
router.put("/quizzes/:quizId/rounds/reorder", adminRoundController.reorderRounds);
router.put("/rounds/:id", adminRoundController.updateRound);
router.delete("/rounds/:id", adminRoundController.deleteRound);

// Questions
router.get("/quizzes/:quizId/questions", adminQuestionController.listQuestions);
router.post("/quizzes/:quizId/questions", adminQuestionController.createQuestion);
router.put("/quizzes/:quizId/questions/reorder", adminQuestionController.reorderQuestions);
router.put("/questions/:id", adminQuestionController.updateQuestion);
router.delete("/questions/:id", adminQuestionController.deleteQuestion);

// Participants
router.get("/participants", adminParticipantController.listParticipants);
router.get("/quizzes/:quizId/participants", adminParticipantController.listQuizParticipation);
router.delete("/quizzes/:quizId/participants/:id", adminParticipantController.deleteQuizParticipation);

// Attendance
router.get("/attendance", adminAttendanceController.listAttendance);

// Results
router.get("/results", adminResultsController.listResults);
router.get("/results/:attemptId", adminResultsController.getResultDetail);
router.delete("/results/:attemptId", adminResultsController.deleteResult);


// Live monitor
router.get("/live/:quizId", adminLiveController.liveSnapshot);

module.exports = router;

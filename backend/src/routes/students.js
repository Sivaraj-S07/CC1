const express = require("express");
const { requireStudent } = require("../middleware/auth");
const studentController = require("../controllers/studentController");

const router = express.Router();

router.post("/login", studentController.joinQuiz);
router.get("/profile", requireStudent, studentController.getProfile);
router.get("/quizzes", studentController.listPublicQuizzes);

module.exports = router;

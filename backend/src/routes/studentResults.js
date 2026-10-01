const express = require("express");
const { requireStudent } = require("../middleware/auth");
const { getSupabase } = require("../config/supabaseClient");
const { asyncHandler, ApiError } = require("../utils/asyncHandler");

const router = express.Router();

// GET /api/student/results — all of the current student's submitted results
router.get(
  "/",
  requireStudent,
  asyncHandler(async (req, res) => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("quiz_attempts")
      .select("*, quizzes(title, max_marks)")
      .eq("student_id", req.student.studentId)
      .in("status", ["submitted", "auto_submitted"])
      .order("submitted_at", { ascending: false });
    if (error) throw new ApiError(500, "Failed to load results", error.message);

    res.json({
      success: true,
      results: (data || []).map((a) => ({
        attemptId: a.id,
        quizTitle: a.quizzes?.title,
        totalMarks: a.total_marks,
        obtainedMarks: a.obtained_marks,
        percentage: a.percentage,
        passed: a.passed,
        submittedAt: a.submitted_at,
      })),
    });
  })
);

module.exports = router;

const bcrypt = require("bcryptjs");
const { getSupabase } = require("../config/supabaseClient");
const { signStudentToken } = require("../utils/jwt");
const { emitAdmin } = require("../realtime");
const { asyncHandler, ApiError } = require("../utils/asyncHandler");
const {
  DEPARTMENTS,
  YEARS,
  SECTIONS,
  normalizeDepartment,
  normalizeYear,
  normalizeSection,
  normalizeMobileNumber,
} = require("../utils/enums");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Older databases may not have students.mobile_number yet. Detect that error
// once and fall back to writing the row without the column so joining a quiz
// never breaks before the migration is applied.
const isMissingMobileColumn = (error) =>
  Boolean(error) && /mobile_number/i.test(`${error.message || ""} ${error.details || ""}`);

// GET /api/quizzes — public list (no password/questions), excludes drafts
const listPublicQuizzes = asyncHandler(async (req, res) => {
  const supabase = getSupabase();
  const { data: quizzes, error } = await supabase
    .from("quizzes")
    .select("id, title, description, duration_minutes, start_time, end_time, max_marks, status")
    .neq("status", "draft")
    .order("created_at", { ascending: false });
  if (error) throw new ApiError(500, "Failed to load quizzes", error.message);

  const quizIds = (quizzes || []).map((q) => q.id);
  const { data: questionCounts } = quizIds.length
    ? await supabase.from("questions").select("quiz_id").in("quiz_id", quizIds)
    : { data: [] };
  const { data: attendanceRows } = quizIds.length
    ? await supabase.from("attendance").select("quiz_id").in("quiz_id", quizIds)
    : { data: [] };

  const qCount = {};
  (questionCounts || []).forEach((r) => (qCount[r.quiz_id] = (qCount[r.quiz_id] || 0) + 1));
  const pCount = {};
  (attendanceRows || []).forEach((r) => (pCount[r.quiz_id] = (pCount[r.quiz_id] || 0) + 1));

  res.json({
    success: true,
    quizzes: quizzes.map((q) => ({
      id: q.id,
      title: q.title,
      description: q.description,
      durationMinutes: q.duration_minutes,
      startTime: q.start_time,
      endTime: q.end_time,
      maxMarks: q.max_marks,
      status: q.status,
      questionCount: qCount[q.id] || 0,
      participantCount: pCount[q.id] || 0,
    })),
  });
});

// GET /api/quizzes/:id — public metadata for the login/entry page
const getPublicQuiz = asyncHandler(async (req, res) => {
  const supabase = getSupabase();
  const { data: quiz, error } = await supabase
    .from("quizzes")
    .select("id, title, description, duration_minutes, start_time, end_time, max_marks, status")
    .eq("id", req.params.id)
    .neq("status", "draft")
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load quiz", error.message);
  if (!quiz) throw new ApiError(404, "Quiz not found");

  const { count } = await supabase
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("quiz_id", quiz.id);

  res.json({
    success: true,
    quiz: {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      durationMinutes: quiz.duration_minutes,
      startTime: quiz.start_time,
      endTime: quiz.end_time,
      maxMarks: quiz.max_marks,
      status: quiz.status,
      questionCount: count || 0,
    },
  });
});

// POST /api/students/login — participant entry: verify quiz password, upsert
// the student profile, record attendance (join), and issue a session token.
const joinQuiz = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const { quizId, name, registerNumber, department, year, section, mobileNumber, quizPassword } =
    body;
  // `email` is optional and ignored unless provided.
  const emailClean = String(body.email ?? "").trim();

  const clean = (v) => String(v ?? "").trim();
  const errors = [];
  if (!quizId) errors.push("quizId is required");
  if (!clean(name)) errors.push("name is required");
  const registerNumberClean = clean(registerNumber);
  if (!registerNumberClean) {
    errors.push("Registration number is required");
  } else if (!/^[0-9]{12}$/.test(registerNumberClean)) {
    errors.push("Registration number must be exactly 12 digits (numbers only)");
  }
  const departmentClean = normalizeDepartment(department);
  if (!clean(department)) {
    errors.push("department is required");
  } else if (!departmentClean) {
    errors.push(`department must be one of: ${DEPARTMENTS.join(", ")}`);
  }
  const yearClean = normalizeYear(year);
  if (!clean(year)) {
    errors.push("year is required");
  } else if (!yearClean) {
    errors.push(`year must be one of: ${YEARS.join(", ")}`);
  }
  const sectionClean = normalizeSection(section);
  if (!clean(section)) {
    errors.push("section is required");
  } else if (!sectionClean) {
    errors.push(`section must be one of: ${SECTIONS.join(", ")}`);
  }
  const mobileNumberClean = normalizeMobileNumber(mobileNumber);
  if (!clean(mobileNumber)) {
    errors.push("Mobile number is required");
  } else if (!mobileNumberClean) {
    errors.push("Mobile number must be exactly 10 digits (numbers only)");
  }
  if (!quizPassword) errors.push("password is required");
  if (clean(name).length > 120) errors.push("name is too long");
  if (emailClean && !EMAIL_RE.test(emailClean)) errors.push("email must be a valid email address");
  if (errors.length) throw new ApiError(400, "Validation failed", errors);

  const supabase = getSupabase();

  const { data: quiz, error: quizError } = await supabase
    .from("quizzes")
    .select("*")
    .eq("id", quizId)
    .maybeSingle();
  if (quizError) throw new ApiError(500, "Failed to load quiz", quizError.message);
  if (!quiz) throw new ApiError(404, "Quiz not found");
  if (quiz.status === "draft") throw new ApiError(403, "This quiz is not published yet");
  if (quiz.status === "completed") throw new ApiError(403, "This quiz has already ended");

  const passwordOk = bcrypt.compareSync(String(quizPassword), quiz.password_hash);
  if (!passwordOk) throw new ApiError(401, "Incorrect quiz password");

  const now = new Date();
  if (quiz.start_time && now < new Date(quiz.start_time)) {
    throw new ApiError(403, "This quiz has not started yet");
  }
  if (quiz.end_time && now > new Date(quiz.end_time) && !quiz.allow_late_join) {
    throw new ApiError(403, "This quiz has ended and late joining is not allowed");
  }

  // Upsert student by register number
  const registerNumberTrimmed = String(registerNumber).trim();
  const { data: existingStudent } = await supabase
    .from("students")
    .select("*")
    .eq("register_number", registerNumberTrimmed)
    .maybeSingle();

  let student = existingStudent;
  if (!student) {
    const baseInsert = {
      name: String(name).trim(),
      register_number: registerNumberTrimmed,
      email: emailClean || null,
      department: departmentClean,
      year: yearClean,
      section: sectionClean,
    };
    let { data: created, error: createError } = await supabase
      .from("students")
      .insert({ ...baseInsert, mobile_number: mobileNumberClean })
      .select("*")
      .single();
    if (createError && isMissingMobileColumn(createError)) {
      ({ data: created, error: createError } = await supabase
        .from("students")
        .insert(baseInsert)
        .select("*")
        .single());
    }
    if (createError) throw new ApiError(500, "Failed to register student", createError.message);
    student = created;
  } else {
    // Keep the latest submitted details in sync (name spelling, dept changes,
    // a newly-supplied email for the certificate, etc.). An email already on
    // file is never overwritten with a blank one.
    const baseUpdate = {
      name: String(name).trim(),
      email: emailClean || student.email,
      department: departmentClean || student.department,
      year: yearClean || student.year,
      section: sectionClean || student.section,
      updated_at: new Date().toISOString(),
    };
    const { error: updateError } = await supabase
      .from("students")
      .update({ ...baseUpdate, mobile_number: mobileNumberClean || student.mobile_number || null })
      .eq("id", student.id);
    if (updateError && isMissingMobileColumn(updateError)) {
      await supabase.from("students").update(baseUpdate).eq("id", student.id);
    }
  }

  // Check attempt limit before allowing (re)join
  const { data: pastAttempts, error: pastAttemptsError } = await supabase
    .from("quiz_attempts")
    .select("id, status")
    .eq("quiz_id", quiz.id)
    .eq("student_id", student.id);
  if (pastAttemptsError) {
    throw new ApiError(500, "Failed to verify attempt history", pastAttemptsError.message);
  }

  const submittedCount = (pastAttempts || []).filter(
    (a) => a.status === "submitted" || a.status === "auto_submitted"
  ).length;
  const hasInProgress = (pastAttempts || []).some((a) => a.status === "in_progress");

  if (!hasInProgress && submittedCount >= quiz.max_attempts) {
    throw new ApiError(403, "You have already used all allowed attempts for this quiz");
  }

  // Record / update attendance (join).
  const attendanceRow = {
    quiz_id: quiz.id,
    student_id: student.id,
    join_time: new Date().toISOString(),
    status: "present",
  };
  const { data: attendance, error: attendanceError } = await supabase
    .from("attendance")
    .upsert(attendanceRow, { onConflict: "quiz_id,student_id" })
    .select("*")
    .single();
  if (attendanceError) throw new ApiError(500, "Failed to record attendance", attendanceError.message);

  const token = signStudentToken({
    studentId: student.id,
    quizId: quiz.id,
    registerNumber: student.register_number,
  });

  emitAdmin("registration:new", {
    quizId: quiz.id,
    student: {
      id: student.id,
      name: student.name,
      registerNumber: student.register_number,
      department: student.department,
      year: student.year,
      section: student.section,
    },
    joinedAt: new Date().toISOString(),
  });

  res.json({
    success: true,
    token,
    student: {
      id: student.id,
      name: student.name,
      registerNumber: student.register_number,
    },
    quiz: {
      id: quiz.id,
      title: quiz.title,
      durationMinutes: quiz.duration_minutes,
      tabSwitchLimit: quiz.tab_switch_limit,
    },
    attendanceId: attendance.id,
  });
});

// GET /api/students/profile — resolve the current session
const getProfile = asyncHandler(async (req, res) => {
  const supabase = getSupabase();
  const { data: student, error } = await supabase
    .from("students")
    .select("id, name, register_number, email, department, year, section")
    .eq("id", req.student.studentId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load profile", error.message);
  if (!student) throw new ApiError(404, "Student not found");
  res.json({ success: true, student });
});

module.exports = { listPublicQuizzes, getPublicQuiz, joinQuiz, getProfile };

const { gradeQuestion } = require("./scoring");

/**
 * Builds the post-submission answer review: for every question the student did
 * NOT get right, report the question number, the question text, what the
 * student submitted and what the correct answer is.
 *
 * `questions` must be ordered exactly as they are numbered for the student
 * (order_index ascending) and include quiz_options / answer-key fields.
 */
function textForOption(question, optionId) {
  if (!optionId) return null;
  const option = (question.quiz_options || []).find((o) => o.id === optionId);
  return option ? option.option_text : null;
}

function correctAnswerText(question) {
  const type = question.question_type || "mcq";
  if (type === "fill_blank") {
    const answers = Array.isArray(question.blank_answers) ? question.blank_answers : [];
    return answers
      .map((a) => (Array.isArray(a) ? a[0] : a))
      .filter((a) => a !== null && a !== undefined && String(a).trim() !== "")
      .join(", ");
  }
  if (type === "coding") {
    return question.expected_output ? String(question.expected_output) : "";
  }
  const correct = (question.quiz_options || []).find((o) => o.is_correct);
  return correct ? correct.option_text : "";
}

function submittedAnswerText(question, answer) {
  const type = question.question_type || "mcq";
  if (!answer) return "";
  if (type === "fill_blank") {
    const blanks = Array.isArray(answer.blanks) ? answer.blanks : [];
    return blanks.filter((b) => String(b || "").trim() !== "").join(", ");
  }
  if (type === "coding") {
    return answer.code ? String(answer.code) : "";
  }
  return textForOption(question, answer.optionId) || "";
}

function buildAnswerReview(questions, answersByQuestionId) {
  const review = [];
  (questions || []).forEach((q, index) => {
    const answer = answersByQuestionId.has(q.id) ? answersByQuestionId.get(q.id) : null;
    const { outcome, marksAwarded } = gradeQuestion(q, answer);
    if (outcome === "correct") return;

    const yourAnswer = submittedAnswerText(q, answer);
    review.push({
      questionId: q.id,
      questionNumber: index + 1,
      type: q.question_type || "mcq",
      question: q.question_text,
      yourAnswer: yourAnswer || null,
      correctAnswer: correctAnswerText(q) || null,
      answered: outcome !== "unanswered",
      outcome,
      marksAwarded,
      // Judge summary for programming questions (how many hidden tests passed).
      testsPassed: answer && answer.judge ? Number(answer.judge.passed || 0) : null,
      testsTotal: answer && answer.judge ? Number(answer.judge.total || 0) : null,
      judgeStatus: answer && answer.judge ? answer.judge.status || null : null,
    });
  });
  return review;
}

module.exports = { buildAnswerReview };

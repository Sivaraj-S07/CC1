import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, Send, Loader2, SkipForward, Maximize } from "lucide-react";
import Timer from "../../components/Timer";
import QuestionTimer from "../../components/QuestionTimer";
import QuestionPalette from "../../components/QuestionPalette";
import Button from "../../components/ui/Button";
import Skeleton from "../../components/ui/Skeleton";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { useToast } from "../../components/ui/Toast";
import QuizInstructions from "../../components/QuizInstructions";
import { apiFetch, ApiError } from "../../lib/api";
import { getStudentSession, clearStudentSession } from "../../lib/studentAuth";
import useProctoring from "../../hooks/useProctoring";
import CodingWorkspace from "../../components/student/CodingWorkspace";

const LANGUAGE_LABELS = { c: "C", cpp: "C++", java: "Java", python: "Python" };
const CODE_SAVE_DEBOUNCE_MS = 700;

// Per-question time limit comes from the question itself (set by the admin in
// the Admin Portal). null / 0 means this question has no individual limit.
function questionLimitSeconds(question) {
  const limit = Number(question?.timeLimitSeconds || 0);
  return Number.isFinite(limit) && limit > 0 ? limit : null;
}

export default function QuizRunner() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const session = getStudentSession(quizId);

  // Mandatory first-time instruction slider (static frontend content).
  // Once acknowledged, it is not shown again for this attempt/tab.
  const instructionsKey = `quizapp_instructions_${quizId}`;
  const [instructionsDone, setInstructionsDone] = useState(() => {
    try {
      return sessionStorage.getItem(instructionsKey) === "1";
    } catch {
      return false;
    }
  });


  const [loading, setLoading] = useState(true);
  const [quiz, setQuiz] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [roundBanner, setRoundBanner] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [violationsCount, setViolationsCount] = useState(0);
  const [tabSwitchLimit, setTabSwitchLimit] = useState(3);

  const [current, setCurrent] = useState(0);
  const [selections, setSelections] = useState({}); // questionId -> optionId (mcq) | code string (coding) | string[] (fill_blank)
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [violationBanner, setViolationBanner] = useState(null);
  const [fullscreenPrompt, setFullscreenPrompt] = useState(false);

  // Height of the sticky quiz header (title + timer), measured live so the
  // code editor's own full-screen overlay can start right below it instead
  // of covering it — otherwise the countdown timer disappears (and the
  // editor's Exit full screen control lands underneath the header,
  // unreachable) whenever a student expands a coding question to full
  // screen. Re-measured on resize/orientation change since the header's
  // height differs a little between mobile and desktop layouts.
  const quizHeaderRef = useRef(null);
  const [quizHeaderHeight, setQuizHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    const el = quizHeaderRef.current;
    if (!el) return undefined;
    const measure = () => setQuizHeaderHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Per-question timer state.
  // The deadline for every question is issued and owned by the SERVER
  // (question_timings). The browser only renders the countdown, so refreshing,
  // reopening the tab or editing values in dev tools cannot buy extra time —
  // the backend rejects answers once its own deadline has passed.
  const [questionSecondsLeft, setQuestionSecondsLeft] = useState(0);
  const [expiredQuestionIds, setExpiredQuestionIds] = useState(() => new Set());
  const [questionDeadlines, setQuestionDeadlines] = useState({}); // questionId -> epoch ms
  const serverOffsetRef = useRef(0); // serverNow - clientNow
  const serverNow = useCallback(() => Date.now() + serverOffsetRef.current, []);
  const activatingRef = useRef({});

  const markExpired = useCallback((qid) => {
    setExpiredQuestionIds((prev) => {
      if (prev.has(qid)) return prev;
      const next = new Set(prev);
      next.add(qid);
      return next;
    });
  }, []);

  const submittedRef = useRef(false);
  const codeSaveTimers = useRef({});
  const flushPendingCodeRef = useRef(async () => {});

  const handleSubmit = useCallback(
    async (silent = false) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        await flushPendingCodeRef.current();
        const data = await apiFetch(`/quizzes/${quizId}/submit`, { method: "POST", token: session.token });
        clearStudentSession(quizId);
        if (!silent) push("Quiz submitted!", "success");
        // Hand the freshly graded result to the result page so the score is
        // visible immediately, with no second round-trip or refresh.
        navigate(`/result/${quizId}`, { replace: true, state: { result: data?.result || null } });
      } catch (err) {
        push(err instanceof ApiError ? err.message : "Failed to submit quiz", "error");
        submittedRef.current = false;
        setSubmitting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quizId, session?.token]
  );

  useEffect(() => {
    if (!session?.token) {
      navigate(`/login/${quizId}`, { replace: true });
      return;
    }
    // Hold the attempt (and its timer) until the instructions are acknowledged.
    if (!instructionsDone) return;
    let cancelled = false;
    async function start() {
      try {
        const data = await apiFetch(`/quizzes/${quizId}/start`, { method: "POST", token: session.token });
        if (cancelled) return;
        setQuiz(data.quiz);
        // Attach the last judge verdict so the workspace shows it after a refresh.
        const codeAnswers = data.codeAnswers || {};
        setQuestions(
          (data.questions || []).map((q) =>
            q.type === "coding" && codeAnswers[q.id] ? { ...q, judge: codeAnswers[q.id].judge } : q
          )
        );
        const restoredCode = {};
        Object.entries(codeAnswers).forEach(([qid, entry]) => {
          if (entry && typeof entry.code === "string") restoredCode[qid] = entry.code;
        });
        if (Object.keys(restoredCode).length) {
          setSelections((sel) => ({ ...restoredCode, ...sel }));
        }
        setRounds(data.rounds || []);
        setRemainingSeconds(data.remainingSeconds);
        setViolationsCount(data.violationsCount);
        setTabSwitchLimit(data.quiz.tabSwitchLimit);
        if (data.serverTime) {
          serverOffsetRef.current = new Date(data.serverTime).getTime() - Date.now();
        }
        // Restore timers + position exactly as the server remembers them, so a
        // refresh continues the attempt instead of restarting anything.
        const deadlines = {};
        const expired = new Set();
        (data.questionTimers || []).forEach((t) => {
          if (t.expiresAt) deadlines[t.questionId] = new Date(t.expiresAt).getTime();
          if (t.expired) expired.add(t.questionId);
        });
        setQuestionDeadlines(deadlines);
        setExpiredQuestionIds(expired);
        const restored = Number(data.currentIndex || 0);
        setCurrent(
          Number.isFinite(restored)
            ? Math.min(Math.max(0, restored), Math.max(0, (data.questions || []).length - 1))
            : 0
        );
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 410) {
          push("Time was already up for this attempt — showing your result.", "warning");
          navigate(`/result/${quizId}`, { replace: true });
          return;
        }
        push(err instanceof ApiError ? err.message : "Failed to start quiz", "error");
        navigate("/", { replace: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    start();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId, instructionsDone]);


  const answeredIds = useMemo(
    () =>
      new Set(
        Object.entries(selections)
          .filter(([, value]) => {
            if (Array.isArray(value)) return value.some((v) => String(v || "").trim().length > 0);
            if (typeof value === "string") return value.trim().length > 0;
            return Boolean(value);
          })
          .map(([key]) => key)
      ),
    [selections]
  );

  const persistAnswer = useCallback(
    async (questionId, optionId, code, blanks) => {
      try {
        const body = { questionId };
        if (optionId !== undefined) body.optionId = optionId;
        if (code !== undefined) body.code = code;
        if (blanks !== undefined) body.blanks = blanks;
        await apiFetch(`/quizzes/${quizId}/answer`, {
          method: "POST",
          token: session.token,
          body,
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 410) {
          push("Time is up — submitting your quiz now.", "warning");
          handleSubmit(true);
        } else if (err instanceof ApiError && err.status === 403) {
          // The server's clock says this question is already over.
          markExpired(questionId);
          push("Time for this question is over.", "warning");
        }
        // Non-fatal for other errors — the answer will be retried on the next selection/submit.
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quizId, session?.token, handleSubmit, markExpired]
  );

  const selectOption = (questionId, optionId) => {
    if (expiredQuestionIds.has(questionId)) return;
    setSelections((s) => ({ ...s, [questionId]: optionId }));
    persistAnswer(questionId, optionId);
  };

  const updateCode = (questionId, code) => {
    if (expiredQuestionIds.has(questionId)) return;
    setSelections((s) => ({ ...s, [questionId]: code }));
    clearTimeout(codeSaveTimers.current[questionId]);
    codeSaveTimers.current[questionId] = setTimeout(() => {
      persistAnswer(questionId, undefined, code);
    }, CODE_SAVE_DEBOUNCE_MS);
  };

  const updateBlank = (questionId, blankIdx, value, blanksCount) => {
    if (expiredQuestionIds.has(questionId)) return;
    setSelections((s) => {
      const prev = Array.isArray(s[questionId]) ? s[questionId] : Array(blanksCount).fill("");
      const next = [...prev];
      next[blankIdx] = value;
      return { ...s, [questionId]: next };
    });
    clearTimeout(codeSaveTimers.current[questionId]);
    codeSaveTimers.current[questionId] = setTimeout(() => {
      setSelections((s) => {
        persistAnswer(questionId, undefined, undefined, s[questionId]);
        return s;
      });
    }, CODE_SAVE_DEBOUNCE_MS);
  };

  // Ensures the very latest keystrokes are saved even if the debounce timer
  // hasn't fired yet — called right before submitting the quiz.
  const flushPendingCode = useCallback(async () => {
    const debouncedQuestions = questions.filter((q) => q.type === "coding" || q.type === "fill_blank");
    await Promise.all(
      debouncedQuestions.map((q) => {
        const timerId = codeSaveTimers.current[q.id];
        if (timerId) clearTimeout(timerId);
        const value = selections[q.id];
        if (value === undefined) return null;
        return q.type === "fill_blank"
          ? persistAnswer(q.id, undefined, undefined, value)
          : persistAnswer(q.id, undefined, value);
      })
    );
  }, [questions, selections, persistAnswer]);
  flushPendingCodeRef.current = flushPendingCode;

  // Activate the current question on the server the moment it becomes visible.
  // The call is idempotent: the server returns the SAME deadline it issued the
  // first time, so refreshing the page never restarts the countdown.
  useEffect(() => {
    if (loading || submitting || submittedRef.current) return;
    const currentQuestion = questions[current];
    if (!currentQuestion) return;
    const qid = currentQuestion.id;
    if (!questionLimitSeconds(currentQuestion)) return;
    if (questionDeadlines[qid] || expiredQuestionIds.has(qid)) return;
    if (activatingRef.current[qid]) return;
    activatingRef.current[qid] = true;

    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch(`/quizzes/${quizId}/question/start`, {
          method: "POST",
          token: session.token,
          body: { questionId: qid },
        });
        if (cancelled) return;
        if (data.serverTime) {
          serverOffsetRef.current = new Date(data.serverTime).getTime() - Date.now();
        }
        const timing = data.timing || {};
        if (timing.expiresAt) {
          setQuestionDeadlines((prev) => ({ ...prev, [qid]: new Date(timing.expiresAt).getTime() }));
        }
        if (timing.expired) markExpired(qid);
        if (typeof data.quizRemainingSeconds === "number") {
          setRemainingSeconds(data.quizRemainingSeconds);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 410) {
          push("Time is up — submitting your quiz now.", "warning");
          handleSubmit(true);
        }
      } finally {
        activatingRef.current[qid] = false;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, loading, submitting, questions, questionDeadlines, expiredQuestionIds]);

  // Render the countdown from the server-issued deadline. When it hits zero the
  // question is locked and the quiz moves on automatically — no refresh needed.
  useEffect(() => {
    if (loading || submitting || submittedRef.current) return;
    const currentQuestion = questions[current];
    if (!currentQuestion) return;
    const qid = currentQuestion.id;
    const limit = questionLimitSeconds(currentQuestion);

    if (!limit) {
      setQuestionSecondsLeft(0);
      return;
    }
    if (expiredQuestionIds.has(qid)) {
      setQuestionSecondsLeft(0);
      return;
    }
    const deadline = questionDeadlines[qid];
    if (!deadline) {
      setQuestionSecondsLeft(limit);
      return;
    }

    const tick = () => {
      const left = Math.ceil((deadline - serverNow()) / 1000);
      if (left > 0) {
        setQuestionSecondsLeft(Math.min(limit, left));
        return;
      }
      setQuestionSecondsLeft(0);
      markExpired(qid);
      if (isRoundBoundary(current) && roundIsGated(questions[current]?.roundId)) {
        completeRoundAndContinue(current);
        return;
      }
      setCurrent((c) => (c < questions.length - 1 ? c + 1 : c));
    };
    tick();
    const intervalId = setInterval(tick, 250);
    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, loading, submitting, questions, questionDeadlines, expiredQuestionIds]);

  // Keep the quiz inside this page: warn on refresh/close and neutralise the
  // browser Back button while an attempt is running.
  useEffect(() => {
    if (loading || submittedRef.current) return;
    const onBeforeUnload = (e) => {
      if (submittedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    const onPopState = () => {
      if (submittedRef.current) return;
      window.history.pushState({ quizLock: true }, "", window.location.href);
      push("Finish and submit the quiz before leaving this page.", "warning");
    };
    window.history.pushState({ quizLock: true }, "", window.location.href);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ---------------------------------------------------------------------
  // Rounds & qualification
  //
  // Questions are delivered round by round. When the last question of a round
  // that has a qualification percentage is finished, the server grades that
  // round: clearing it unlocks the next round, falling short ends the attempt
  // and shows the final scoreboard.
  // ---------------------------------------------------------------------
  const roundById = useMemo(() => {
    const map = {};
    (rounds || []).forEach((r) => {
      map[r.id] = r;
    });
    return map;
  }, [rounds]);

  const roundIdAt = useCallback((index) => questions[index]?.roundId || null, [questions]);

  // Questions are grouped by the rounds/levels the admin created, in the order
  // they are delivered. Each group becomes "Level N — <round name>" so the
  // student sees each level's questions separately.
  const levelGroups = useMemo(() => {
    const groups = [];
    questions.forEach((q, index) => {
      const roundId = q.roundId || null;
      const last = groups[groups.length - 1];
      if (last && last.roundId === roundId) {
        last.indices.push(index);
        return;
      }
      groups.push({ roundId, indices: [index] });
    });
    let levelNumber = 0;
    return groups.map((g, i) => {
      const round = g.roundId ? roundById[g.roundId] : null;
      if (g.roundId) levelNumber += 1;
      const name = round?.name || (g.roundId ? `Round ${levelNumber}` : "Other questions");
      return {
        ...g,
        key: g.roundId || `unassigned-${i}`,
        level: g.roundId ? levelNumber : null,
        name,
        label: g.roundId ? `Level ${levelNumber} — ${name}` : name,
      };
    });
  }, [questions, roundById]);

  const currentLevel = useMemo(
    () => levelGroups.find((g) => g.indices.includes(current)) || null,
    [levelGroups, current]
  );
  const currentLevelPosition = currentLevel ? currentLevel.indices.indexOf(current) + 1 : 0;

  // Index is the last question of its round (and a next round follows).
  const isRoundBoundary = useCallback(
    (index) => {
      const roundId = roundIdAt(index);
      if (!roundId) return false;
      if (index >= questions.length - 1) return false;
      return roundIdAt(index + 1) !== roundId;
    },
    [questions.length, roundIdAt]
  );

  const roundIsGated = useCallback(
    (roundId) => Number(roundById[roundId]?.qualificationPercentage || 0) > 0,
    [roundById]
  );

  const finishingRound = useRef(false);

  // Moves past a round boundary, asking the server whether the student
  // qualified for the next round.
  const completeRoundAndContinue = useCallback(
    async (index) => {
      const roundId = roundIdAt(index);
      if (!roundId || finishingRound.current) return;
      finishingRound.current = true;
      try {
        await flushPendingCodeRef.current();
        const data = await apiFetch(`/quizzes/${quizId}/round/complete`, {
          method: "POST",
          token: session.token,
          body: { roundId },
        });
        const outcome = data.roundOutcome || {};
        if (data.finished) {
          submittedRef.current = true;
          clearStudentSession(quizId);
          navigate(`/result/${quizId}`, {
            replace: true,
            state: {
              result: data.result || null,
              finishedEarly: true,
              roundOutcome: outcome,
              message: data.message || "You have finished.",
            },
          });
          return;
        }
        setRoundBanner(
          `${outcome.roundName || "Round"} cleared — ${outcome.correct}/${outcome.totalQuestions} correct` +
            (outcome.requiredPercentage ? ` (needed ${outcome.requiredPercentage}%)` : "") +
            ". Moving to the next round."
        );
        setCurrent((c) => Math.min(questions.length - 1, Math.max(c, index) + 1));
      } catch (err) {
        if (err instanceof ApiError && err.status === 410) {
          push("Time is up — submitting your quiz now.", "warning");
          handleSubmit(true);
        } else {
          push(err instanceof ApiError ? err.message : "Failed to finish this round", "error");
        }
      } finally {
        finishingRound.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quizId, session?.token, questions.length, roundIdAt, handleSubmit, navigate]
  );

  // Rounds are sequential: the palette can only move within the active round,
  // so a student can't skip ahead past a qualification gate.
  const jumpToQuestion = useCallback(
    (index) => {
      const target = roundIdAt(index);
      const active = roundIdAt(current);
      if (target && active && target !== active) {
        push("Finish the current round first.", "warning");
        return;
      }
      setCurrent(index);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, roundIdAt]
  );

  // Moves to the next question after flushing any pending answer for the
  // current one. Used by both Next and Skip so they behave identically.
  const goToNextQuestion = useCallback(async () => {
    if (isRoundBoundary(current) && roundIsGated(roundIdAt(current))) {
      await completeRoundAndContinue(current);
      return;
    }
    setCurrent((c) => Math.min(questions.length - 1, c + 1));
    try {
      await flushPendingCodeRef.current();
    } catch {
      // non-fatal — the answer is retried on the next save/submit
    }
  }, [questions.length, current, isRoundBoundary, roundIsGated, roundIdAt, completeRoundAndContinue]);

  // ---------------------------------------------------------------------
  // Proctoring: every suspicious browser event is reported to the server so it
  // is recorded against this attempt. Tab switches / focus loss count towards
  // the tab-switch limit; softer signals are logged only.
  // ---------------------------------------------------------------------
  const PROCTOR_MESSAGES = useRef({
    fullscreen_exit: "You left fullscreen. Return to fullscreen to continue safely.",
    context_menu: "Right-click is disabled during the quiz.",
    blocked_shortcut: "That keyboard shortcut is disabled during the quiz.",
    new_tab_blocked: "Opening new tabs is disabled during the quiz.",
    clipboard_copy: "Copying is disabled during the quiz.",
    clipboard_cut: "Copying is disabled during the quiz.",
    clipboard_paste: "Pasting is disabled during the quiz.",
    alt_tab_attempt: "Stay on the quiz window.",
  }).current;

  const lastReportRef = useRef({});
  const reportProctorEvent = useCallback(
    async (reason) => {
      if (submittedRef.current || !session?.token) return;
      // Throttle noisy events (blur fires repeatedly on some platforms).
      const now = Date.now();
      if (now - (lastReportRef.current[reason] || 0) < 1200) return;
      lastReportRef.current[reason] = now;

      const message = PROCTOR_MESSAGES[reason];
      if (message) setViolationBanner(message);

      try {
        const data = await apiFetch(`/quizzes/${quizId}/violation`, {
          method: "POST",
          token: session.token,
          body: { reason },
        });
        if (typeof data.violationsCount === "number") setViolationsCount(data.violationsCount);
        if (data.autoSubmitted) {
          setViolationBanner("Tab-switch limit reached — quiz auto-submitted.");
          submittedRef.current = true;
          clearStudentSession(quizId);
          navigate(`/result/${quizId}`, { replace: true });
        } else if (data.counted) {
          setViolationBanner(
            data.limitReached
              ? `Warning ${data.violationsCount}/${data.limit}: leaving the quiz again may auto-submit it.`
              : `Leaving the quiz was detected (${data.violationsCount}/${data.limit}). Stay on this page.`
          );
        }
      } catch {
        // best-effort proctoring signal — never block the quiz
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quizId, session?.token]
  );

  const proctorActive = !loading && Boolean(quiz) && !submitting;
  const { isFullscreen, fullscreenSupported, enterFullscreen, exitFullscreen } = useProctoring({
    active: proctorActive,
    onEvent: reportProctorEvent,
  });

  // Ask again for fullscreen if the student dropped out of it mid-quiz.
  useEffect(() => {
    if (!proctorActive || !fullscreenSupported) return;
    setFullscreenPrompt(!isFullscreen);
  }, [proctorActive, isFullscreen, fullscreenSupported]);

  // Page Visibility API — tab switching / minimising.
  useEffect(() => {
    if (!proctorActive) return undefined;
    const onVisibilityChange = () => {
      if (document.hidden) reportProctorEvent("tab_switch");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [proctorActive, reportProctorEvent]);

  // Leave fullscreen once the attempt is finished.
  useEffect(() => {
    return () => {
      exitFullscreen();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!instructionsDone) {
    return (
      <QuizInstructions
        quizTitle={session?.quizTitle || ""}
        onStart={() => {
          // Must be triggered by this user gesture — browsers reject
          // programmatic fullscreen requests made any other way.
          enterFullscreen();
          try {
            sessionStorage.setItem(instructionsKey, "1");
          } catch {
            // storage unavailable — continue anyway
          }
          setInstructionsDone(true);
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-10">
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  if (!quiz || questions.length === 0) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center text-sm text-ink-500">
        This quiz has no questions available right now.
      </div>
    );
  }

  const q = questions[current];
  const currentLimit = questionLimitSeconds(q);
  const questionLocked = currentLimit ? expiredQuestionIds.has(q.id) : false;

  return (
    <div className="min-h-screen">
      <div ref={quizHeaderRef} className="sticky top-0 z-30 border-b hairline bg-void/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-100">{quiz.title}</p>
            <p className="text-xs text-ink-500">
              {currentLevel && levelGroups.length > 1 ? (
                <>
                  <span className="text-ink-300">{currentLevel.label}</span>
                  {" · "}
                  Question {currentLevelPosition} of {currentLevel.indices.length}
                </>
              ) : (
                <>
                  Question {current + 1} of {questions.length}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {currentLimit && (
              <div className="hidden sm:block">
                <QuestionTimer
                  secondsLeft={questionSecondsLeft}
                  totalSeconds={currentLimit}
                  expired={questionLocked}
                />
              </div>
            )}
            <Timer totalSeconds={remainingSeconds} onExpire={() => handleSubmit(true)} />
          </div>
        </div>
      </div>

      {fullscreenPrompt && (
        <div className="mx-auto mt-4 flex max-w-5xl flex-wrap items-center justify-between gap-3 rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Secure mode is off. Please return to fullscreen to continue the quiz.
          </span>
          <Button size="sm" onClick={() => enterFullscreen()}>
            <Maximize className="h-4 w-4" /> Enter fullscreen
          </Button>
        </div>
      )}

      {violationBanner && (
        <div className="mx-auto mt-4 flex max-w-5xl items-center gap-2 rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {violationBanner}
        </div>
      )}

      {roundBanner && (
        <div className="mx-auto mt-4 flex max-w-5xl items-start gap-2 rounded-xl border border-mint/30 bg-mint/10 px-4 py-3 text-sm text-mint">
          <span className="flex-1">{roundBanner}</span>
          <button type="button" onClick={() => setRoundBanner(null)} className="text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 px-5 py-6 lg:grid-cols-[1fr_260px]">
        <div className="glass-card p-6">
          {currentLimit && (
            <div className="mb-4 sm:hidden">
              <QuestionTimer
                secondsLeft={questionSecondsLeft}
                totalSeconds={currentLimit}
                expired={questionLocked}
              />
            </div>
          )}
          {questionLocked && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-coral/30 bg-coral/10 px-4 py-3 text-sm text-coral">
              <AlertTriangle className="h-4 w-4 shrink-0" /> The time limit for this question is over — it can no longer
              be answered.
            </div>
          )}
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            {q.marks} mark{q.marks === 1 ? "" : "s"}
            {q.negativeMarks > 0 ? ` • -${q.negativeMarks} if wrong` : ""}
            {q.type === "coding" ? ` • ${LANGUAGE_LABELS[q.language] || q.language}` : ""}
          </p>
          <h2 className="mt-2 text-lg text-ink-100 whitespace-pre-wrap">{q.text}</h2>

          {q.type === "coding" ? (
            <CodingWorkspace
              question={q}
              quizId={quizId}
              token={session.token}
              value={selections[q.id] ?? q.starterCode ?? ""}
              onChange={(next) => updateCode(q.id, next)}
              disabled={questionLocked}
              push={push}
              onSubmitted={(code) => setSelections((sel) => ({ ...sel, [q.id]: code }))}
              fullscreenTopOffset={quizHeaderHeight}
            />
          ) : q.type === "fill_blank" ? (
            <div className="mt-5 space-y-3">
              {Array.from({ length: q.blanksCount || 1 }).map((_, idx) => (
                <input
                  key={idx}
                  value={(selections[q.id] || [])[idx] ?? ""}
                  onChange={(e) => updateBlank(q.id, idx, e.target.value, q.blanksCount || 1)}
                  disabled={questionLocked}
                  placeholder={(q.blanksCount || 1) > 1 ? `Blank ${idx + 1}` : "Your answer"}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-ink-100 outline-none focus:border-electric/40"
                />
              ))}
              <p className="text-[11px] text-ink-700">
                Your answer is saved automatically as you type.
              </p>
            </div>
          ) : (
            <div className="mt-5 space-y-2.5">
              {q.options.map((opt) => {
                const selected = selections[q.id] === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => selectOption(q.id, opt.id)}
                    disabled={questionLocked}
                    className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all duration-150 ${
                      questionLocked ? "cursor-not-allowed opacity-60" : ""
                    } ${
                      selected
                        ? "border-electric/50 bg-electric/10 text-ink-100"
                        : "border-white/10 bg-white/[0.02] text-ink-300 hover:border-white/20 hover:bg-white/[0.04]"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        selected ? "border-electric bg-electric" : "border-white/20"
                      }`}
                    >
                      {selected && <span className="h-1.5 w-1.5 rounded-full bg-void" />}
                    </span>
                    {opt.text}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <Button
              variant="secondary"
              size="sm"
              icon={ChevronLeft}
              disabled={current === 0}
              onClick={() => setCurrent((c) => Math.max(0, c - 1))}
            >
              Previous
            </Button>
            {current === questions.length - 1 ? (
              <Button size="sm" icon={Send} onClick={() => setConfirmSubmit(true)} disabled={submitting}>
                Submit quiz
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                {/* Skip behaves exactly like Next: it saves the current answer
                    state and immediately moves to the next question. */}
                <Button variant="secondary" size="sm" icon={SkipForward} onClick={goToNextQuestion}>
                  Skip
                </Button>
                <Button size="sm" onClick={goToNextQuestion}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <QuestionPalette
            questions={questions}
            current={current}
            answered={answeredIds}
            onJump={jumpToQuestion}
            groups={levelGroups}
          />
          <Button variant="secondary" className="w-full" icon={Send} onClick={() => setConfirmSubmit(true)} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit quiz"}
          </Button>
          {violationsCount > 0 && (
            <p className="text-center text-xs text-amber">
              Tab-switch violations: {violationsCount}/{tabSwitchLimit}
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmSubmit}
        title="Submit your quiz?"
        description={`You've answered ${answeredIds.size} of ${questions.length} questions. This cannot be undone.`}
        confirmLabel="Submit"
        onConfirm={() => {
          setConfirmSubmit(false);
          handleSubmit();
        }}
        onCancel={() => setConfirmSubmit(false)}
      />
    </div>
  );
}

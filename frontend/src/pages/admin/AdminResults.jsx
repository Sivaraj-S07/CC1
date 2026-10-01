import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Trophy, TrendingUp, CheckCircle2, XCircle, Trash2, Eye } from "lucide-react";
import AdminLayout from "../../components/AdminLayout";
import Button from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Skeleton from "../../components/ui/Skeleton";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { useAdminAuth } from "../../lib/adminAuth";
import { apiFetch, ApiError } from "../../lib/api";
import { connectAdminSocket } from "../../lib/socket";
import { exportResultsPdf } from "../../lib/exportResultsPdf";

/** One question's breakdown inside the "View attempt" modal. */
function QuestionDetailCard({ q, index }) {
  const stateTone = q.isCorrect ? "live" : q.isPartial ? "draft" : "danger";
  const stateLabel = q.isCorrect ? "Correct" : q.isPartial ? "Partial" : q.answered ? "Wrong" : "Unanswered";

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-ink-100">
          <span className="mr-2 text-ink-600">Q{index + 1}.</span>
          {q.text}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={stateTone}>{stateLabel}</Badge>
          <span className="whitespace-nowrap text-xs text-ink-500">
            {q.marksAwarded ?? (q.isCorrect ? q.marks : 0)} / {q.marks} marks
          </span>
        </div>
      </div>

      {q.type === "mcq" && (
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-ink-600">Student's answer</p>
            <p className="mt-1 text-ink-200">{q.selectedOption || "— not answered —"}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-ink-600">Correct answer</p>
            <p className="mt-1 text-ink-200">{q.correctOption || "—"}</p>
          </div>
        </div>
      )}

      {q.type === "fill_blank" && (
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-ink-600">Student's answer</p>
            <p className="mt-1 whitespace-pre-wrap text-ink-200">
              {Array.isArray(q.submittedBlanks) && q.submittedBlanks.some((b) => String(b || "").trim())
                ? q.submittedBlanks.map((b, i) => `${i + 1}. ${b || "—"}`).join("\n")
                : "— not answered —"}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-ink-600">Correct answer</p>
            <p className="mt-1 whitespace-pre-wrap text-ink-200">
              {Array.isArray(q.correctBlanks) ? q.correctBlanks.map((b, i) => `${i + 1}. ${b}`).join("\n") : "—"}
            </p>
          </div>
        </div>
      )}

      {q.type === "coding" && (
        <div className="mt-3 space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {q.language && (
              <span className="inline-block rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-500">
                {q.language}
              </span>
            )}
            {q.judge?.status && (
              <span className="inline-block rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-500">
                Verdict: {q.judge.status}
                {q.judge.total ? ` — ${q.judge.passed ?? 0}/${q.judge.total} tests passed` : ""}
              </span>
            )}
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wide text-ink-600">Submitted code</p>
            <pre
              style={{ fontVariantLigatures: "none", fontFeatureSettings: '"liga" 0, "calt" 0' }}
              className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-ink-200"
            >
              {q.submittedCode || "— no code submitted —"}
            </pre>
          </div>

          {q.expectedOutput ? (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-600">Expected output (correct answer)</p>
              <pre
                style={{ fontVariantLigatures: "none", fontFeatureSettings: '"liga" 0, "calt" 0' }}
                className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/20 p-3 font-mono text-[11px] leading-relaxed text-ink-200"
              >
                {q.expectedOutput}
              </pre>
            </div>
          ) : null}

          {Array.isArray(q.testCases) && q.testCases.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wide text-ink-600">Test cases (input → expected output)</p>
              {q.testCases.map((t, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-white/10 bg-black/20 p-2.5 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] text-ink-600">{t.name || `Test ${i + 1}`} — input</p>
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-ink-200">{t.input || "(none)"}</pre>
                  </div>
                  <div>
                    <p className="text-[10px] text-ink-600">Expected output</p>
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-ink-200">
                      {t.expectedOutput || "(none)"}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {q.referenceSolution ? (
            <details className="rounded-lg border border-white/10 bg-black/20 p-2.5">
              <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-ink-600">
                Reference solution
              </summary>
              <pre
                style={{ fontVariantLigatures: "none", fontFeatureSettings: '"liga" 0, "calt" 0' }}
                className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-200"
              >
                {q.referenceSolution}
              </pre>
            </details>
          ) : null}
        </div>
      )}

    </div>
  );
}

function AttemptDetailModal({ attemptId, onClose, token, push }) {
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    if (!attemptId) return;
    let alive = true;
    setLoading(true);
    setDetail(null);
    apiFetch(`/admin/results/${attemptId}`, { token })
      .then((data) => {
        if (alive) setDetail(data);
      })
      .catch((err) => {
        if (alive) push(err instanceof ApiError ? err.message : "Failed to load attempt detail", "error");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [attemptId, token, push]);

  const result = detail?.result;
  const questions = detail?.questionBreakdown || [];

  return (
    <Modal
      open={Boolean(attemptId)}
      onClose={onClose}
      maxWidth="max-w-3xl"
      title={result ? `${result.student?.name || "Student"} — attempt detail` : "Attempt detail"}
    >
      {loading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !detail ? (
        <p className="text-sm text-ink-500">Could not load this attempt.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-wide text-ink-600">Score</p>
              <p className="mt-1 font-display text-lg font-semibold text-ink-100">
                {result.obtainedMarks} / {result.totalMarks}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-wide text-ink-600">Percentage</p>
              <p className="mt-1 font-display text-lg font-semibold text-electric-light">{result.percentage}%</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-wide text-ink-600">Correct / Wrong / Unanswered</p>
              <p className="mt-1 text-sm text-ink-200">
                {result.correct} / {result.wrong} / {result.unanswered}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-wide text-ink-600">Status</p>
              <p className="mt-1">
                <Badge tone={result.passed ? "live" : "danger"}>{result.passed ? "Pass" : "Fail"}</Badge>
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              Questions ({questions.length})
            </p>
            {questions.length === 0 ? (
              <p className="text-sm text-ink-500">No question breakdown available for this attempt.</p>
            ) : (
              questions.map((q, i) => <QuestionDetailCard key={q.questionId} q={q} index={i} />)
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export default function AdminResults() {
  const { token } = useAdminAuth();
  const { push } = useToast();

  const [quizzes, setQuizzes] = useState([]);
  const [selectedQuizId, setSelectedQuizId] = useState("");
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [viewingAttemptId, setViewingAttemptId] = useState(null);
  const deleteLock = useRef(false);

  useEffect(() => {
    apiFetch("/admin/quizzes", { token })
      .then((data) => {
        setQuizzes(data.quizzes);
        if (data.quizzes.length > 0) setSelectedQuizId(data.quizzes[0].id);
        else setLoading(false);
      })
      .catch((err) => push(err instanceof ApiError ? err.message : "Failed to load quizzes", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadResults = useCallback(
    async ({ silent = false } = {}) => {
      if (!selectedQuizId) return;
      if (!silent) setLoading(true);
      try {
        const data = await apiFetch(`/admin/results?quizId=${selectedQuizId}`, { token });
        setResults(data.results);
        setSummary(data.summary);
      } catch (err) {
        if (!silent) push(err instanceof ApiError ? err.message : "Failed to load results", "error");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedQuizId, token]
  );

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  // Live updates — a student finishing a quiz pushes the new result straight
  // into this table, no refresh needed. Polling is the fallback if the socket
  // cannot connect.
  useEffect(() => {
    if (!token || !selectedQuizId) return;
    const disconnect = connectAdminSocket(token, {
      "result:new": () => loadResults({ silent: true }),
      "registration:new": () => loadResults({ silent: true }),
    });
    const poll = setInterval(() => {
      // Background tabs stop polling; refocusing triggers an immediate refresh.
      if (typeof document !== "undefined" && document.hidden) return;
      loadResults({ silent: true });
    }, 20000);
    const onVisible = () => {
      if (!document.hidden) loadResults({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disconnect();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, selectedQuizId, loadResults]);

  const handleDeleteParticipant = async () => {
    const target = confirmTarget;
    if (!target || deleteLock.current) return;
    deleteLock.current = true;
    setDeletingId(target.attemptId);
    setConfirmTarget(null);
    try {
      await apiFetch(`/admin/results/${target.attemptId}`, { method: "DELETE", token });
      setResults((prev) => prev.filter((r) => r.attemptId !== target.attemptId));
      push(`Removed ${target.student?.name || "participant"} from the results.`, "success");
      loadResults({ silent: true });
    } catch (err) {
      push(err instanceof ApiError ? err.message : "Failed to delete participant", "error");
    } finally {
      deleteLock.current = false;
      setDeletingId(null);
    }
  };

  const handleExportPdf = () => {
    try {
      const quiz = quizzes.find((q) => String(q.id) === String(selectedQuizId));
      exportResultsPdf({ quizTitle: quiz?.title, results, summary });
    } catch {
      push("Failed to generate PDF.", "error");
    }
  };

  return (
    <AdminLayout
      title="Results"
      subtitle="Student-wise and quiz-wise performance"
      actions={
        <Button size="sm" icon={Download} onClick={handleExportPdf} disabled={!selectedQuizId || results.length === 0}>
          Download PDF
        </Button>
      }
    >
      <div className="mb-5">
        <select
          value={selectedQuizId}
          onChange={(e) => setSelectedQuizId(e.target.value)}
          className="glass rounded-xl px-3.5 py-2.5 text-sm text-ink-100 outline-none focus:border-electric/40"
        >
          {quizzes.map((q) => (
            <option key={q.id} value={q.id}>
              {q.title}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : quizzes.length === 0 ? (
        <div className="glass-card p-10 text-center text-sm text-ink-500">Create a quiz first to see results here.</div>
      ) : (
        <>
          {summary && (
            <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="glass-card p-4">
                <p className="flex items-center gap-1.5 text-xs text-ink-500"><Trophy className="h-3.5 w-3.5" /> Highest</p>
                <p className="mt-1 font-display text-xl font-semibold text-amber">{summary.highestScore}%</p>
              </div>
              <div className="glass-card p-4">
                <p className="flex items-center gap-1.5 text-xs text-ink-500"><TrendingUp className="h-3.5 w-3.5" /> Average</p>
                <p className="mt-1 font-display text-xl font-semibold text-electric-light">{summary.averageScore}%</p>
              </div>
              <div className="glass-card p-4">
                <p className="flex items-center gap-1.5 text-xs text-ink-500"><CheckCircle2 className="h-3.5 w-3.5" /> Passed</p>
                <p className="mt-1 font-display text-xl font-semibold text-mint">{summary.passCount}</p>
              </div>
              <div className="glass-card p-4">
                <p className="flex items-center gap-1.5 text-xs text-ink-500"><XCircle className="h-3.5 w-3.5" /> Failed</p>
                <p className="mt-1 font-display text-xl font-semibold text-coral">{summary.failCount}</p>
              </div>
            </div>
          )}

          <div className="glass-card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Register No.</th>
                  <th className="px-4 py-3">Mobile</th>
                  <th className="px-4 py-3">Dept / Year / Sec</th>
                  <th className="px-4 py-3">Quiz status</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Questions</th>
                  <th className="px-4 py-3">Percentage</th>
                  <th className="px-4 py-3">Correct / Wrong / Unanswered</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Time taken</th>
                  <th className="sticky right-0 z-20 bg-[#0d1017] px-4 py-3 text-right shadow-[-12px_0_16px_-12px_rgba(0,0,0,0.9)]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="px-4 py-8 text-center text-ink-500">No submissions yet.</td>
                  </tr>
                ) : (
                  results.map((r) => (
                    <tr key={r.attemptId} className="border-b border-white/[0.04] last:border-0">
                      <td className="px-4 py-3 font-tabular text-ink-100">{r.rank ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-100">{r.student?.name}</td>
                      <td className="px-4 py-3 text-ink-500">{r.student?.register_number}</td>
                      <td className="px-4 py-3 font-tabular text-ink-500">{r.student?.mobile_number || "—"}</td>
                      <td className="px-4 py-3 text-ink-500">
                        {[r.student?.department, r.student?.year, r.student?.section]
                          .filter(Boolean)
                          .join(" / ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-500">
                        {r.status === "auto_submitted" ? "Auto submitted" : "Submitted"}
                      </td>
                      <td className="px-4 py-3 font-tabular text-ink-100">{r.obtainedMarks} / {r.totalMarks}</td>
                      <td className="px-4 py-3 text-ink-500">{r.totalQuestions}</td>
                      <td className="px-4 py-3 font-tabular text-ink-100">{r.percentage}%</td>
                      <td className="px-4 py-3 text-ink-500">{r.correct} / {r.wrong} / {r.unanswered}</td>
                      <td className="px-4 py-3">
                        <Badge tone={r.passed ? "live" : "danger"}>{r.passed ? "Pass" : "Fail"}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-700">
                        {r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-700">
                        {r.submittedAt ? new Date(r.submittedAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-700">{formatDuration(r.timeTakenSeconds)}</td>
                      <td className="sticky right-0 z-10 bg-[#0d1017] px-4 py-3 text-right shadow-[-12px_0_16px_-12px_rgba(0,0,0,0.9)]">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setViewingAttemptId(r.attemptId)}
                            aria-label={`View ${r.student?.name || "participant"}'s attempt`}
                            title="View attempt"
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-electric/30 bg-electric/10 px-2.5 py-1.5 text-xs font-semibold text-electric-light transition hover:border-electric/60 hover:bg-electric/20"
                          >
                            <Eye className="h-4 w-4" />
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmTarget(r)}
                            disabled={deletingId === r.attemptId}
                            aria-label={`Delete ${r.student?.name || "participant"} from results`}
                            title="Delete participant"
                            className="inline-flex items-center justify-center rounded-lg border border-white/[0.08] p-2 text-ink-500 transition hover:border-coral/40 hover:text-coral disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        title="Delete participant?"
        description={
          confirmTarget
            ? `This permanently removes ${confirmTarget.student?.name || "this participant"}'s result from this quiz. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDeleteParticipant}
        onCancel={() => setConfirmTarget(null)}
      />

      <AttemptDetailModal
        attemptId={viewingAttemptId}
        onClose={() => setViewingAttemptId(null)}
        token={token}
        push={push}
      />
    </AdminLayout>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  Copy,
  Trash2,
  Radio,
  Eye,
  ClipboardCopy,
  ClipboardPaste,
  ClipboardCheck,
  X,
  FileDown,
  FileUp,
} from "lucide-react";
import AdminLayout from "../../components/AdminLayout";
import Button from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Skeleton from "../../components/ui/Skeleton";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { useAdminAuth } from "../../lib/adminAuth";
import { apiFetch, ApiError } from "../../lib/api";
import {
  clearQuizClipboard,
  loadQuizClipboard,
  parseQuizClipboard,
  saveQuizClipboard,
  summarizeQuizClipboard,
} from "../../lib/quizClipboard";

const statusTone = { draft: "draft", upcoming: "upcoming", live: "live", completed: "completed" };

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function errorMessage(err, fallback) {
  if (!(err instanceof ApiError)) return fallback;
  const details = Array.isArray(err.details) ? err.details.filter((d) => typeof d === "string") : [];
  return details.length ? `${err.message}: ${details.slice(0, 3).join("; ")}` : err.message;
}

/**
 * Paste Quiz dialog. Creates a brand-new quiz (with its own rounds, questions
 * and options) from the copied snapshot. The parent only mounts it while open,
 * so its form state resets every time.
 */
function PasteQuizModal({ initialClipboard, token, onClose, onPasted }) {
  const { push } = useToast();
  const [titleDraft, setTitleDraft] = useState(null);
  const [password, setPassword] = useState("");
  const [keepStatus, setKeepStatus] = useState(false);
  const [rawText, setRawText] = useState("");
  const [pasting, setPasting] = useState(false);

  // Pasted text (if any) takes priority over the in-app copy. An invalid paste
  // never silently falls back to older copied data.
  const parsed = useMemo(() => (rawText.trim() ? parseQuizClipboard(rawText) : null), [rawText]);
  const source = parsed ? parsed.clipboard || null : initialClipboard;
  const summary = source ? summarizeQuizClipboard(source) : null;
  const title = titleDraft ?? (summary ? `${summary.title} (Copy)` : "");

  const handleClose = () => {
    if (!pasting) onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!source || pasting) return;
    setPasting(true);
    try {
      const data = await apiFetch("/admin/quizzes/paste", {
        method: "POST",
        token,
        body: {
          clipboard: source,
          title: title.trim() || undefined,
          password: password || undefined,
          keepStatus,
        },
      });
      (data.warnings || []).forEach((w) => push(w, "warning"));
      push(
        `Pasted as "${data.quiz.title}" (${data.quiz.status}) — ${plural(data.counts.rounds, "round")}, ${plural(
          data.counts.questions,
          "question"
        )}.`,
        "success"
      );
      onPasted(data.quiz);
    } catch (err) {
      push(errorMessage(err, "Failed to paste quiz"), "error");
      setPasting(false);
    }
  };

  return (
    <Modal open title="Paste Quiz" onClose={handleClose} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {summary ? (
          <div className="glass rounded-xl p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">Copied quiz</p>
            <p className="mt-1 font-display text-base font-semibold text-ink-100">{summary.title}</p>
            <p className="mt-1 text-xs text-ink-500">
              {plural(summary.rounds, "round")} · {plural(summary.questions, "question")} · originally {summary.status}
              {summary.copiedAt ? ` · copied ${new Date(summary.copiedAt).toLocaleString()}` : ""}
            </p>
          </div>
        ) : (
          <div className="glass rounded-xl p-4 text-sm text-ink-300">
            {parsed?.error
              ? parsed.error
              : "Nothing is copied yet. Click Copy on a quiz first, or paste copied quiz data below."}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-500" htmlFor="paste-title">
            New quiz title
          </label>
          <input
            id="paste-title"
            value={title}
            onChange={(e) => setTitleDraft(e.target.value)}
            disabled={!source}
            className="glass w-full rounded-xl px-3.5 py-2.5 text-sm text-ink-100 outline-none focus:border-electric/40 disabled:opacity-50"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-500" htmlFor="paste-password">
            Password <span className="normal-case text-ink-700">(optional)</span>
          </label>
          <input
            id="paste-password"
            type="text"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!source}
            placeholder="Leave blank to keep the original quiz password"
            className="glass w-full rounded-xl px-3.5 py-2.5 text-sm text-ink-100 placeholder:text-ink-700 outline-none focus:border-electric/40 disabled:opacity-50"
          />
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl glass p-3.5">
          <input
            type="checkbox"
            checked={keepStatus}
            onChange={(e) => setKeepStatus(e.target.checked)}
            disabled={!source}
            className="mt-0.5 h-4 w-4 accent-electric"
          />
          <div>
            <p className="text-sm font-medium text-ink-100">
              Keep original status{summary ? ` (${summary.status})` : ""}
            </p>
            <p className="text-xs text-ink-500">
              Off (recommended): the new quiz is created as a draft so students can&apos;t see it until you publish it.
            </p>
          </div>
        </label>

        <details className="glass rounded-xl p-3.5" open={!!rawText || !summary}>
          <summary className="cursor-pointer text-sm text-ink-300">Paste copied quiz data instead</summary>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={4}
            placeholder="Paste the copied quiz data here (from another browser or machine)"
            className="mt-3 w-full rounded-xl bg-black/30 px-3 py-2 font-mono text-xs text-ink-100 placeholder:text-ink-700 outline-none focus:border-electric/40"
          />
        </details>

        <div className="flex justify-end gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={pasting}>
            Cancel
          </Button>
          <Button type="submit" icon={ClipboardPaste} disabled={!source || pasting}>
            {pasting ? "Pasting..." : "Paste Quiz"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Import Quiz from PDF dialog. Uploads a backup PDF (produced by "Export as
 * PDF") and recreates the quiz from the machine-readable data embedded in it
 * — same rounds/questions/options/answers/settings/password as Paste Quiz.
 */
function ImportPdfModal({ token, onClose, onImported }) {
  const { push } = useToast();
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [keepStatus, setKeepStatus] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleClose = () => {
    if (!importing) onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || importing) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (title.trim()) formData.append("title", title.trim());
      if (password) formData.append("password", password);
      formData.append("keepStatus", keepStatus ? "true" : "false");

      const data = await apiFetch("/admin/quizzes/import-pdf", {
        method: "POST",
        token,
        body: formData,
      });
      (data.warnings || []).forEach((w) => push(w, "warning"));
      push(
        `Imported as "${data.quiz.title}" (${data.quiz.status}) — ${plural(data.counts.rounds, "round")}, ${plural(
          data.counts.questions,
          "question"
        )}.`,
        "success"
      );
      onImported(data.quiz);
    } catch (err) {
      push(errorMessage(err, "Failed to import quiz from PDF"), "error");
      setImporting(false);
    }
  };

  return (
    <Modal open title="Import Quiz from PDF" onClose={handleClose} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-500" htmlFor="import-pdf-file">
            Backup PDF
          </label>
          <input
            id="import-pdf-file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            disabled={importing}
            className="glass w-full rounded-xl px-3.5 py-2.5 text-sm text-ink-100 outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-electric/20 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-electric-soft disabled:opacity-50"
          />
          <p className="mt-1.5 text-xs text-ink-500">
            Only a PDF from Admin → Quizzes → &quot;Export as PDF&quot; can be imported.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-500" htmlFor="import-pdf-title">
            New quiz title <span className="normal-case text-ink-700">(optional)</span>
          </label>
          <input
            id="import-pdf-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!file || importing}
            placeholder="Leave blank to use the original title + (Copy)"
            className="glass w-full rounded-xl px-3.5 py-2.5 text-sm text-ink-100 placeholder:text-ink-700 outline-none focus:border-electric/40 disabled:opacity-50"
          />
        </div>

        <div>
          <label
            className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-500"
            htmlFor="import-pdf-password"
          >
            Password <span className="normal-case text-ink-700">(optional)</span>
          </label>
          <input
            id="import-pdf-password"
            type="text"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!file || importing}
            placeholder="Leave blank to keep the original quiz password"
            className="glass w-full rounded-xl px-3.5 py-2.5 text-sm text-ink-100 placeholder:text-ink-700 outline-none focus:border-electric/40 disabled:opacity-50"
          />
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl glass p-3.5">
          <input
            type="checkbox"
            checked={keepStatus}
            onChange={(e) => setKeepStatus(e.target.checked)}
            disabled={!file || importing}
            className="mt-0.5 h-4 w-4 accent-electric"
          />
          <div>
            <p className="text-sm font-medium text-ink-100">Keep original status</p>
            <p className="text-xs text-ink-500">
              Off (recommended): the new quiz is created as a draft so students can&apos;t see it until you publish it.
            </p>
          </div>
        </label>

        <div className="flex justify-end gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={importing}>
            Cancel
          </Button>
          <Button type="submit" icon={FileUp} disabled={!file || importing}>
            {importing ? "Importing..." : "Import Quiz"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function AdminQuizzes() {
  const { token } = useAdminAuth();
  const { push } = useToast();
  const navigate = useNavigate();

  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [clipboard, setClipboard] = useState(() => loadQuizClipboard());
  const [copyingId, setCopyingId] = useState(null);
  const [duplicatingId, setDuplicatingId] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [exportingPdfId, setExportingPdfId] = useState(null);
  const [importPdfOpen, setImportPdfOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/admin/quizzes", { token });
      setQuizzes(data.quizzes);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to load quizzes";
      setError(message);
      push(message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const filtered = quizzes.filter((q) => q.title.toLowerCase().includes(search.toLowerCase()));

  // Duplicate = Copy + Paste in one click: a full, independent draft copy
  // (rounds, questions, options, timings, marks, settings, same password).
  const handleDuplicate = async (quiz) => {
    if (duplicatingId) return;
    setDuplicatingId(quiz.id);
    try {
      const exported = await apiFetch(`/admin/quizzes/${quiz.id}/export`, { token });
      const data = await apiFetch("/admin/quizzes/paste", {
        method: "POST",
        token,
        body: { clipboard: exported.clipboard },
      });
      (data.warnings || []).forEach((w) => push(w, "warning"));
      push(
        `Quiz duplicated as draft — ${plural(data.counts.rounds, "round")}, ${plural(data.counts.questions, "question")}. It keeps the original password.`,
        "success"
      );
      load();
    } catch (err) {
      push(errorMessage(err, "Failed to duplicate quiz"), "error");
    } finally {
      setDuplicatingId(null);
    }
  };

  // Copy Quiz: fetches a full snapshot (settings, rounds, questions, options)
  // and keeps it ready for Paste Quiz.
  const handleCopy = async (quiz) => {
    if (copyingId) return;
    setCopyingId(quiz.id);
    try {
      const data = await apiFetch(`/admin/quizzes/${quiz.id}/export`, { token });
      const snapshot = data.clipboard;
      const { persisted } = saveQuizClipboard(snapshot);
      setClipboard(snapshot);

      // Best effort: also place the data on the system clipboard so it can be
      // pasted into another browser or machine. Browsers may refuse — that's fine.
      let onSystemClipboard = false;
      try {
        await navigator.clipboard.writeText(JSON.stringify(snapshot));
        onSystemClipboard = true;
      } catch {
        /* permission denied / unsupported */
      }

      const info = summarizeQuizClipboard(snapshot);
      push(
        `Copied "${info.title}" — ${plural(info.rounds, "round")}, ${plural(info.questions, "question")}. Click Paste Quiz to create a new quiz from it.`,
        "success"
      );
      if (!persisted && !onSystemClipboard) {
        push("This quiz is too large to keep across page reloads — paste it before refreshing.", "warning");
      }
    } catch (err) {
      push(errorMessage(err, "Failed to copy quiz"), "error");
    } finally {
      setCopyingId(null);
    }
  };

  const handleExportPdf = async (quiz) => {
    if (exportingPdfId) return;
    setExportingPdfId(quiz.id);
    try {
      const response = await apiFetch(`/admin/quizzes/${quiz.id}/export-pdf`, { token, raw: true });
      if (!response.ok) {
        let message = `Request failed with status ${response.status}`;
        try {
          const data = await response.json();
          if (data?.message) message = data.message;
        } catch {
          /* non-JSON error body */
        }
        throw new ApiError(message, response.status);
      }
      const blob = await response.blob();
      const safeName = (quiz.title || "quiz").replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "-") || "quiz";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}-backup.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      push(`Exported "${quiz.title}" as a backup PDF.`, "success");
    } catch (err) {
      push(errorMessage(err, "Failed to export quiz as PDF"), "error");
    } finally {
      setExportingPdfId(null);
    }
  };

  const handleClearClipboard = () => {
    clearQuizClipboard();
    setClipboard(null);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await apiFetch(`/admin/quizzes/${confirmDelete.id}`, { method: "DELETE", token });
      push("Quiz deleted.", "success");
      setConfirmDelete(null);
      load();
    } catch (err) {
      push(err instanceof ApiError ? err.message : "Failed to delete quiz", "error");
    }
  };

  const handlePublishToggle = async (quiz) => {
    const nextStatus = quiz.status === "draft" ? "live" : quiz.status === "live" ? "completed" : "live";
    try {
      await apiFetch(`/admin/quizzes/${quiz.id}/status`, { method: "PATCH", token, body: { status: nextStatus } });
      push(`Quiz marked as ${nextStatus}.`, "success");
      load();
    } catch (err) {
      push(err instanceof ApiError ? err.message : "Failed to update status", "error");
    }
  };

  return (
    <AdminLayout
      title="Quizzes"
      subtitle="Create and manage assessments"
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={ClipboardPaste} onClick={() => setPasteOpen(true)}>
            Paste Quiz
          </Button>
          <Button size="sm" variant="secondary" icon={FileUp} onClick={() => setImportPdfOpen(true)}>
            Import from PDF
          </Button>
          <Button size="sm" icon={Plus} onClick={() => navigate("/admin/quizzes/new")}>
            New Quiz
          </Button>
        </div>
      }
    >
      {clipboard && (
        <div className="glass-card mb-5 flex flex-wrap items-center gap-3 px-4 py-3">
          <ClipboardCheck className="h-4 w-4 shrink-0 text-mint" />
          <p className="min-w-0 flex-1 text-sm text-ink-300">
            Copied: <span className="font-medium text-ink-100">{summarizeQuizClipboard(clipboard).title}</span>
            <span className="text-ink-500">
              {" "}
              · {plural(clipboard.rounds.length, "round")} · {plural(clipboard.questions.length, "question")}
            </span>
          </p>
          <Button size="sm" icon={ClipboardPaste} onClick={() => setPasteOpen(true)}>
            Paste
          </Button>
          <button
            type="button"
            aria-label="Clear copied quiz"
            onClick={handleClearClipboard}
            className="rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-white/10 hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mb-5 relative max-w-sm">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search quizzes..."
          className="glass w-full rounded-xl py-2.5 pl-10 pr-4 text-sm text-ink-100 placeholder:text-ink-700 outline-none focus:border-electric/40"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="glass-card p-6 text-sm text-coral">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-10 text-center text-sm text-ink-500">
          No quizzes yet. Click "New Quiz" to create your first assessment.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((quiz) => (
            <div key={quiz.id} className="glass-card group relative p-5">
              <div className="flex items-start justify-between gap-2">
                <Badge tone={statusTone[quiz.status]} dot={quiz.status === "live"}>
                  {quiz.status}
                </Badge>
                <div className="flex flex-wrap items-start justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Eye}
                    onClick={() => navigate(`/admin/quizzes/${quiz.id}`)}
                  >
                    Open
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Radio}
                    onClick={() => handlePublishToggle(quiz)}
                  >
                    {quiz.status === "draft" ? "Publish" : quiz.status === "live" ? "Mark completed" : "Reopen"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={clipboard?.source?.quizId === quiz.id ? ClipboardCheck : ClipboardCopy}
                    disabled={copyingId === quiz.id}
                    onClick={() => handleCopy(quiz)}
                    title="Copy this whole quiz (rounds, questions, options, timings, marks and settings)"
                  >
                    {copyingId === quiz.id ? "Copying..." : clipboard?.source?.quizId === quiz.id ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Copy}
                    disabled={duplicatingId === quiz.id}
                    onClick={() => handleDuplicate(quiz)}
                  >
                    {duplicatingId === quiz.id ? "Duplicating..." : "Duplicate"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={FileDown}
                    disabled={exportingPdfId === quiz.id}
                    onClick={() => handleExportPdf(quiz)}
                    title="Download a backup PDF (rounds, questions, options, answers, timing, password, settings)"
                  >
                    {exportingPdfId === quiz.id ? "Exporting..." : "Export PDF"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    className="text-coral hover:bg-coral/10"
                    onClick={() => setConfirmDelete(quiz)}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              <button
                onClick={() => navigate(`/admin/quizzes/${quiz.id}`)}
                className="mt-3 block text-left"
              >
                <h3 className="font-display text-base font-semibold text-ink-100 hover:text-electric-soft transition-colors">
                  {quiz.title}
                </h3>
              </button>
              <p className="mt-1 line-clamp-2 text-sm text-ink-500">{quiz.description || "No description"}</p>

              <div className="mt-4 flex items-center justify-between text-xs text-ink-500">
                <span>{quiz.questionCount} questions</span>
                <span>{quiz.durationMinutes} min</span>
                <span>{quiz.participantCount} participants</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {pasteOpen && (
        <PasteQuizModal
          initialClipboard={clipboard}
          token={token}
          onClose={() => setPasteOpen(false)}
          onPasted={() => {
            setPasteOpen(false);
            load();
          }}
        />
      )}

      {importPdfOpen && (
        <ImportPdfModal
          token={token}
          onClose={() => setImportPdfOpen(false)}
          onImported={() => {
            setImportPdfOpen(false);
            load();
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete quiz?"
        description={`This permanently deletes "${confirmDelete?.title}" along with its questions, attempts and results.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </AdminLayout>
  );
}

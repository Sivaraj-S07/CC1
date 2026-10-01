/**
 * "Clipboard" for Copy Quiz / Paste Quiz in the Admin Portal.
 *
 * A copied quiz is a JSON snapshot returned by GET /admin/quizzes/:id/export.
 * It is kept in memory and mirrored to localStorage so it survives a page
 * refresh and can be pasted from another tab. If localStorage is unavailable
 * or full (very large quiz) the in-memory copy still works for this session.
 */
const STORAGE_KEY = "quizapp_admin_quiz_clipboard";
export const CLIPBOARD_FORMAT = "quiz-clipboard";
export const CLIPBOARD_VERSION = 1;

let memoryCopy = null;

export function isQuizClipboard(value) {
  return (
    !!value &&
    typeof value === "object" &&
    value.format === CLIPBOARD_FORMAT &&
    value.version === CLIPBOARD_VERSION &&
    !!value.quiz &&
    typeof value.quiz === "object" &&
    Array.isArray(value.rounds) &&
    Array.isArray(value.questions)
  );
}

/** Parses text a person pasted (e.g. from the system clipboard). */
export function parseQuizClipboard(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "That text is not valid copied-quiz data." };
  }
  if (!isQuizClipboard(value)) {
    return { error: "That text is not copied-quiz data. Use the Copy button on a quiz first." };
  }
  return { clipboard: value };
}

export function summarizeQuizClipboard(clipboard) {
  return {
    title: String(clipboard?.quiz?.title || clipboard?.source?.title || "Untitled quiz"),
    status: clipboard?.quiz?.status || "draft",
    rounds: clipboard?.rounds?.length || 0,
    questions: clipboard?.questions?.length || 0,
    copiedAt: clipboard?.copiedAt || null,
    sourceQuizId: clipboard?.source?.quizId || null,
  };
}

/** Returns `{ persisted }` — false when only the in-memory copy could be kept. */
export function saveQuizClipboard(clipboard) {
  memoryCopy = clipboard;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clipboard));
    return { persisted: true };
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
    return { persisted: false };
  }
}

export function loadQuizClipboard() {
  if (memoryCopy && isQuizClipboard(memoryCopy)) return memoryCopy;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (isQuizClipboard(value)) {
      memoryCopy = value;
      return value;
    }
  } catch {
    /* corrupted or unavailable — treat as empty */
  }
  return null;
}

export function clearQuizClipboard() {
  memoryCopy = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

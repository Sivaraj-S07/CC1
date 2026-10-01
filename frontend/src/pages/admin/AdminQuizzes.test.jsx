import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// The real layout pulls in sockets / notifications that are irrelevant here.
vi.mock("../../components/AdminLayout", () => ({
  default: ({ title, actions, children }) => (
    <div>
      <h1>{title}</h1>
      <div data-testid="header-actions">{actions}</div>
      {children}
    </div>
  ),
}));
vi.mock("../../lib/adminAuth", () => ({ useAdminAuth: () => ({ token: "test-token" }) }));

import { ToastProvider } from "../../components/ui/Toast";
import { loadQuizClipboard } from "../../lib/quizClipboard";
import AdminQuizzes from "./AdminQuizzes";

const QUIZ_A = {
  id: "quiz-a",
  title: "Data Structures Contest",
  description: "Weekly",
  status: "live",
  durationMinutes: 45,
  questionCount: 5,
  participantCount: 3,
};
const QUIZ_B = { ...QUIZ_A, id: "quiz-b", title: "Networks Quiz", status: "draft", questionCount: 2, participantCount: 0 };

const snapshotFor = (quiz) => ({
  format: "quiz-clipboard",
  version: 1,
  copiedAt: "2026-09-20T10:00:00.000Z",
  source: { quizId: quiz.id, title: quiz.title, status: quiz.status },
  quiz: { title: quiz.title, status: quiz.status, password_hash: "$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345" },
  rounds: [{ ref: "r1", fields: { name: "Round 1", order_index: 0 } }],
  questions: [
    { ref: "q1", roundRef: "r1", fields: { question_text: "Q1" }, options: [] },
    { ref: "q2", roundRef: null, fields: { question_text: "Q2" }, options: [] },
  ],
});

let calls;
let handlers;

function json(status, body) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  );
}

beforeEach(() => {
  calls = [];
  handlers = {
    "GET /admin/quizzes": () => json(200, { success: true, quizzes: [QUIZ_A, QUIZ_B] }),
    "GET /admin/quizzes/quiz-a/export": () => json(200, { success: true, clipboard: snapshotFor(QUIZ_A) }),
    "GET /admin/quizzes/quiz-b/export": () => json(200, { success: true, clipboard: snapshotFor(QUIZ_B) }),
    "POST /admin/quizzes/paste": () =>
      json(201, {
        success: true,
        quiz: { id: "new-1", title: "Data Structures Contest (Copy)", status: "draft" },
        counts: { rounds: 1, questions: 2, options: 0 },
        warnings: [],
      }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url, init = {}) => {
      const path = String(url).replace(/^https?:\/\/[^/]+\/api/, "");
      const key = `${init.method || "GET"} ${path}`;
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ key, body, headers: init.headers });
      const handler = handlers[key];
      if (!handler) return json(404, { success: false, message: `no handler for ${key}` });
      return handler(body);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const callsTo = (key) => calls.filter((c) => c.key === key);

async function renderPage() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ToastProvider>
        <AdminQuizzes />
      </ToastProvider>
    </MemoryRouter>
  );
  await screen.findByRole("heading", { name: "Data Structures Contest" });
  return user;
}

const cardFor = (title) => screen.getByRole("heading", { name: title }).closest(".glass-card");

describe("Admin Quizzes — Copy Quiz / Paste Quiz", () => {
  it("shows Copy on every quiz and a Paste Quiz button in the header", async () => {
    await renderPage();
    expect(within(cardFor("Data Structures Contest")).getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
    expect(within(cardFor("Networks Quiz")).getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
    expect(within(screen.getByTestId("header-actions")).getByRole("button", { name: /paste quiz/i })).toBeInTheDocument();
    expect(screen.queryByText(/^Copied:/)).not.toBeInTheDocument();
  });

  it("Copy fetches the full snapshot, keeps it, and shows what was copied", async () => {
    const user = await renderPage();
    await user.click(within(cardFor("Data Structures Contest")).getByRole("button", { name: /^copy$/i }));

    await waitFor(() => expect(callsTo("GET /admin/quizzes/quiz-a/export")).toHaveLength(1));
    expect(callsTo("GET /admin/quizzes/quiz-a/export")[0].headers.Authorization).toBe("Bearer test-token");
    expect(await screen.findByText(/Copied "Data Structures Contest" — 1 round, 2 questions/)).toBeInTheDocument();
    // banner + the card's button flips to "Copied"
    expect(screen.getByText(/^Copied:/)).toBeInTheDocument();
    expect(within(cardFor("Data Structures Contest")).getByRole("button", { name: /^copied$/i })).toBeInTheDocument();
    expect(within(cardFor("Networks Quiz")).getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
    expect(loadQuizClipboard().source.quizId).toBe("quiz-a");
  });

  it("also places the data on the system clipboard when the browser allows it", async () => {
    const user = await renderPage();
    // (userEvent.setup() installs its own clipboard stub, so override it afterwards.)
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(within(cardFor("Networks Quiz")).getByRole("button", { name: /^copy$/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(JSON.parse(writeText.mock.calls[0][0]).source.quizId).toBe("quiz-b");
  });

  it("a failed copy shows an error and copies nothing", async () => {
    handlers["GET /admin/quizzes/quiz-a/export"] = () => json(500, { success: false, message: "Failed to load questions" });
    const user = await renderPage();
    await user.click(within(cardFor("Data Structures Contest")).getByRole("button", { name: /^copy$/i }));
    expect(await screen.findByText("Failed to load questions")).toBeInTheDocument();
    expect(screen.queryByText(/^Copied:/)).not.toBeInTheDocument();
    expect(loadQuizClipboard()).toBeNull();
    // the button is usable again
    expect(within(cardFor("Data Structures Contest")).getByRole("button", { name: /^copy$/i })).toBeEnabled();
  });

  it("Paste Quiz creates a new quiz from the copied data and refreshes the list", async () => {
    const user = await renderPage();
    await user.click(within(cardFor("Data Structures Contest")).getByRole("button", { name: /^copy$/i }));
    await screen.findByText(/^Copied:/);

    await user.click(within(screen.getByTestId("header-actions")).getByRole("button", { name: /paste quiz/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Copied quiz")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/new quiz title/i)).toHaveValue("Data Structures Contest (Copy)");

    const listCallsBefore = callsTo("GET /admin/quizzes").length;
    await user.click(within(dialog).getByRole("button", { name: /^paste quiz$/i }));

    await waitFor(() => expect(callsTo("POST /admin/quizzes/paste")).toHaveLength(1));
    const sent = callsTo("POST /admin/quizzes/paste")[0].body;
    expect(sent.clipboard.source.quizId).toBe("quiz-a");
    expect(sent.clipboard.questions).toHaveLength(2);
    expect(sent.title).toBe("Data Structures Contest (Copy)");
    expect(sent.keepStatus).toBe(false);
    expect(sent.password).toBeUndefined();

    expect(await screen.findByText(/Pasted as "Data Structures Contest \(Copy\)" \(draft\) — 1 round, 2 questions\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(callsTo("GET /admin/quizzes").length).toBe(listCallsBefore + 1));
    // the copy stays available so it can be pasted again
    expect(loadQuizClipboard()).not.toBeNull();
  });

  it("lets the admin set a new title, a new password, and keep the original status", async () => {
    const user = await renderPage();
    await user.click(within(cardFor("Data Structures Contest")).getByRole("button", { name: /^copy$/i }));
    await screen.findByText(/^Copied:/);
    await user.click(within(screen.getByTestId("header-actions")).getByRole("button", { name: /paste quiz/i }));
    const dialog = await screen.findByRole("dialog");

    const title = within(dialog).getByLabelText(/new quiz title/i);
    await user.clear(title);
    await user.type(title, "Evening batch");
    await user.type(within(dialog).getByLabelText(/password/i), "new-pass-1");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: /^paste quiz$/i }));

    await waitFor(() => expect(callsTo("POST /admin/quizzes/paste")).toHaveLength(1));
    const sent = callsTo("POST /admin/quizzes/paste")[0].body;
    expect(sent.title).toBe("Evening batch");
    expect(sent.password).toBe("new-pass-1");
    expect(sent.keepStatus).toBe(true);
  });

  it("submits only once even if the button is clicked repeatedly", async () => {
    let release;
    handlers["POST /admin/quizzes/paste"] = () =>
      new Promise((resolve) => {
        release = () =>
          resolve(
            new Response(
              JSON.stringify({ success: true, quiz: { id: "n", title: "T", status: "draft" }, counts: { rounds: 0, questions: 0, options: 0 }, warnings: [] }),
              { status: 201, headers: { "Content-Type": "application/json" } }
            )
          );
      });
    const user = await renderPage();
    await user.click(within(cardFor("Data Structures Contest")).getByRole("button", { name: /^copy$/i }));
    await screen.findByText(/^Copied:/);
    await user.click(within(screen.getByTestId("header-actions")).getByRole("button", { name: /paste quiz/i }));
    const dialog = await screen.findByRole("dialog");

    const submit = within(dialog).getByRole("button", { name: /^paste quiz$/i });
    await user.click(submit);
    await user.click(within(dialog).getByRole("button", { name: /pasting/i }));
    await user.click(within(dialog).getByRole("button", { name: /pasting/i }));
    expect(callsTo("POST /admin/quizzes/paste")).toHaveLength(1);
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the server's error, keeps the dialog open and allows a retry", async () => {
    handlers["POST /admin/quizzes/paste"] = () =>
      json(400, { success: false, message: "Copied quiz data is damaged", details: ["question 1 has no text"] });
    const user = await renderPage();
    await user.click(within(cardFor("Data Structures Contest")).getByRole("button", { name: /^copy$/i }));
    await screen.findByText(/^Copied:/);
    await user.click(within(screen.getByTestId("header-actions")).getByRole("button", { name: /paste quiz/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^paste quiz$/i }));

    expect(await screen.findByText(/Copied quiz data is damaged: question 1 has no text/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: /^paste quiz$/i })).toBeEnabled();
  });

  it("with nothing copied, Paste is disabled until valid copied data is pasted in", async () => {
    const user = await renderPage();
    await user.click(within(screen.getByTestId("header-actions")).getByRole("button", { name: /paste quiz/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Nothing is copied yet/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^paste quiz$/i })).toBeDisabled();

    const box = within(dialog).getByPlaceholderText(/paste the copied quiz data here/i);
    await user.click(box);
    await user.paste("not json at all");
    expect(within(dialog).getByText(/not valid copied-quiz data/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^paste quiz$/i })).toBeDisabled();

    await user.clear(box);
    await user.click(box);
    await user.paste(JSON.stringify({ hello: "world" }));
    expect(within(dialog).getByText(/not copied-quiz data/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^paste quiz$/i })).toBeDisabled();

    await user.clear(box);
    await user.click(box);
    await user.paste(JSON.stringify(snapshotFor(QUIZ_B)));
    expect(within(dialog).getByText("Networks Quiz")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/new quiz title/i)).toHaveValue("Networks Quiz (Copy)");
    await user.click(within(dialog).getByRole("button", { name: /^paste quiz$/i }));
    await waitFor(() => expect(callsTo("POST /admin/quizzes/paste")).toHaveLength(1));
    expect(callsTo("POST /admin/quizzes/paste")[0].body.clipboard.source.quizId).toBe("quiz-b");
  });

  it("the copy survives a page reload and can be cleared", async () => {
    let user = await renderPage();
    await user.click(within(cardFor("Data Structures Contest")).getByRole("button", { name: /^copy$/i }));
    await screen.findByText(/^Copied:/);
    document.body.innerHTML = "";

    user = await renderPage(); // fresh mount, same localStorage
    expect(await screen.findByText(/^Copied:/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /clear copied quiz/i }));
    expect(screen.queryByText(/^Copied:/)).not.toBeInTheDocument();
    expect(loadQuizClipboard()).toBeNull();
  });

  it("Cancel closes the dialog without creating anything", async () => {
    const user = await renderPage();
    await user.click(within(screen.getByTestId("header-actions")).getByRole("button", { name: /paste quiz/i }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(callsTo("POST /admin/quizzes/paste")).toHaveLength(0);
  });
});

describe("Admin Quizzes — existing actions are unchanged", () => {
  it("search, Publish, Duplicate (now a full copy) and Delete still work", async () => {
    handlers["PATCH /admin/quizzes/quiz-b/status"] = () => json(200, { success: true, quiz: { ...QUIZ_B, status: "live" } });
    handlers["DELETE /admin/quizzes/quiz-b"] = () => json(200, { success: true });
    const user = await renderPage();

    await user.type(screen.getByPlaceholderText(/search quizzes/i), "networks");
    expect(screen.queryByRole("heading", { name: "Data Structures Contest" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Networks Quiz" })).toBeInTheDocument();

    const card = cardFor("Networks Quiz");
    await user.click(within(card).getByRole("button", { name: /publish/i }));
    await waitFor(() => expect(callsTo("PATCH /admin/quizzes/quiz-b/status")[0].body).toEqual({ status: "live" }));

    await user.click(within(card).getByRole("button", { name: /duplicate/i }));
    await waitFor(() => expect(callsTo("POST /admin/quizzes/paste")).toHaveLength(1));
    expect(callsTo("GET /admin/quizzes/quiz-b/export")).toHaveLength(1);
    const dup = callsTo("POST /admin/quizzes/paste")[0].body;
    expect(dup.clipboard.source.quizId).toBe("quiz-b");
    expect(dup.title).toBeUndefined(); // server default: "<title> (Copy)", draft, same password
    expect(dup.password).toBeUndefined();
    expect(await screen.findByText(/Quiz duplicated as draft — 1 round, 2 questions/)).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: /^delete$/i }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(callsTo("DELETE /admin/quizzes/quiz-b")).toHaveLength(1));
  });
});

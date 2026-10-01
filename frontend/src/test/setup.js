import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { clearQuizClipboard } from "../lib/quizClipboard";

afterEach(() => {
  cleanup();
  clearQuizClipboard();
  localStorage.clear();
});

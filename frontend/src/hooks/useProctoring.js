import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser-level proctoring for an active quiz attempt.
 *
 * What browsers genuinely allow a website to do — and all this hook does:
 *  - request fullscreen (only from a user gesture) and detect when it is left
 *  - detect tab switching / window focus loss (Page Visibility + blur)
 *  - block the context menu, text selection, copy/cut/paste and a set of
 *    keyboard shortcuts inside the quiz surface
 *  - warn before the page is closed or navigated away from
 *  - report each event so it can be logged server-side
 *
 * What NO website can do (and this hook deliberately does not pretend to do):
 * block screenshots, phone cameras, Google Lens, other apps, OS-level controls
 * or browser extensions. Nothing here touches the user's device or system.
 *
 * @param {object} opts
 * @param {boolean} opts.active - proctoring runs only while true
 * @param {(reason: string) => void} opts.onEvent - called for every suspicious event
 */
export default function useProctoring({ active, onEvent }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(true);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const report = useCallback((reason) => {
    try {
      onEventRef.current?.(reason);
    } catch {
      // reporting must never break the quiz
    }
  }, []);

  const enterFullscreen = useCallback(async () => {
    const el = document.documentElement;
    const request =
      el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!request) {
      setFullscreenSupported(false);
      return false;
    }
    try {
      await request.call(el, { navigationUI: "hide" });
      return true;
    } catch {
      // Denied (no user gesture / iframe policy) — the quiz still runs.
      return false;
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {
      // ignore
    }
  }, []);

  // Fullscreen change tracking
  useEffect(() => {
    if (!active) return undefined;
    const onChange = () => {
      const on = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(on);
      if (!on) report("fullscreen_exit");
    };
    setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, [active, report]);

  // Window focus loss (covers switching to another app/window, which does not
  // always fire visibilitychange).
  useEffect(() => {
    if (!active) return undefined;
    const onBlur = () => report("window_blur");
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [active, report]);

  // Context menu, selection, clipboard, drag and blocked shortcuts.
  useEffect(() => {
    if (!active) return undefined;

    const isTypingTarget = (target) => {
      const tag = target?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
    };

    const onContextMenu = (e) => {
      e.preventDefault();
      report("context_menu");
    };
    const onSelectStart = (e) => {
      if (!isTypingTarget(e.target)) e.preventDefault();
    };
    const onClipboard = (e) => {
      if (isTypingTarget(e.target)) return; // code/fill-in answers stay usable
      e.preventDefault();
      report(`clipboard_${e.type}`);
    };
    const onDragStart = (e) => e.preventDefault();

    const onKeyDown = (e) => {
      const key = String(e.key || "").toLowerCase();
      const typing = isTypingTarget(e.target);

      // New tab / new window / print / save / find / dev tools / view source
      const blockedWithCtrl = ["t", "n", "w", "p", "s", "u", "f", "j"];
      if ((e.ctrlKey || e.metaKey) && blockedWithCtrl.includes(key) && !(typing && key === "f")) {
        e.preventDefault();
        report("blocked_shortcut");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !typing && ["c", "x", "v", "a"].includes(key)) {
        e.preventDefault();
        report("blocked_shortcut");
        return;
      }
      if (key === "f12" || (e.ctrlKey && e.shiftKey && ["i", "j", "c"].includes(key))) {
        e.preventDefault();
        report("blocked_shortcut");
        return;
      }
      if (e.altKey && key === "tab") {
        // The OS owns Alt+Tab; we can only note the attempt.
        report("alt_tab_attempt");
      }
    };

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("selectstart", onSelectStart);
    document.addEventListener("copy", onClipboard);
    document.addEventListener("cut", onClipboard);
    document.addEventListener("paste", onClipboard);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("keydown", onKeyDown, true);
    document.body.classList.add("quiz-locked");

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("selectstart", onSelectStart);
      document.removeEventListener("copy", onClipboard);
      document.removeEventListener("cut", onClipboard);
      document.removeEventListener("paste", onClipboard);
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.classList.remove("quiz-locked");
    };
  }, [active, report]);

  // Block in-app attempts to open new tabs/windows from the quiz surface.
  useEffect(() => {
    if (!active) return undefined;
    const onClick = (e) => {
      const anchor = e.target?.closest?.("a[target='_blank'], a[href^='http']");
      if (anchor) {
        e.preventDefault();
        report("new_tab_blocked");
      }
    };
    document.addEventListener("click", onClick, true);
    const originalOpen = window.open;
    window.open = function blockedOpen() {
      report("new_tab_blocked");
      return null;
    };
    return () => {
      document.removeEventListener("click", onClick, true);
      window.open = originalOpen;
    };
  }, [active, report]);

  return { isFullscreen, fullscreenSupported, enterFullscreen, exitFullscreen };
}

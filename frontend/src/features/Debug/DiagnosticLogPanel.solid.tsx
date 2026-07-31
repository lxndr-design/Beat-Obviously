import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { send } from "../../ipc/bridge";
import { Button, HoverInfo, Icon } from "../../solid-ui";
import styles from "./DiagnosticLogPanel.module.css";

const REFRESH_INTERVAL_MS = 1000;
const MAXIMUM_LINES = 500;

export function DiagnosticLogPanel() {
  const [collapsed, setCollapsed] = createSignal(true);
  const [text, setText] = createSignal("");
  const [path, setPath] = createSignal("");
  const [lineCount, setLineCount] = createSignal(0);
  const [truncated, setTruncated] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [clearing, setClearing] = createSignal(false);
  const [savedPath, setSavedPath] = createSignal("");
  const [hasTextSelection, setHasTextSelection] = createSignal(false);
  let logView: HTMLPreElement | undefined;
  let activeRead: Promise<void> | undefined;
  let savedResetTimer: number | undefined;

  onCleanup(() => {
    if (savedResetTimer !== undefined) window.clearTimeout(savedResetTimer);
  });

  function refresh() {
    if (activeRead || clearing()) return activeRead ?? Promise.resolve();
    activeRead = readLog();
    return activeRead;
  }

  async function readLog() {
    setLoading(true);
    try {
      const response = await send({ kind: "diagnostics.readLog", maxLines: MAXIMUM_LINES });
      const pinnedToEnd = !logView || logView.scrollHeight - logView.scrollTop - logView.clientHeight < 24;
      setText(response.text);
      setPath(response.path);
      setLineCount(response.lineCount);
      setTruncated(response.truncated);
      setError("");
      if (pinnedToEnd) window.requestAnimationFrame(() => logView?.scrollTo({ top: logView.scrollHeight }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the diagnostic log.");
    } finally {
      setLoading(false);
      activeRead = undefined;
    }
  }

  async function copyLog() {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setError("Could not copy the diagnostic log.");
    }
  }

  async function clearLog() {
    if (!text() || clearing()) return;
    setClearing(true);
    if (activeRead) await activeRead;
    setLoading(true);
    try {
      const response = await send({ kind: "diagnostics.clearLog" });
      if (!response.ok || response.error) throw new Error(response.error || "Could not clear the diagnostic log.");
      window.getSelection()?.removeAllRanges();
      setText("");
      setLineCount(0);
      setTruncated(false);
      setHasTextSelection(false);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not clear the diagnostic log.");
    } finally {
      setLoading(false);
      setClearing(false);
    }
  }

  async function saveLog() {
    const snapshot = text();
    if (!snapshot || saving()) return;
    setSaving(true);
    try {
      const response = await send({ kind: "diagnostics.saveLog", text: snapshot });
      if (response.error) throw new Error(response.error);
      if (response.path) {
        setSavedPath(response.path);
        if (savedResetTimer !== undefined) window.clearTimeout(savedResetTimer);
        savedResetTimer = window.setTimeout(() => setSavedPath(""), 1800);
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the diagnostic log snapshot.");
    } finally {
      setSaving(false);
    }
  }

  createEffect(() => {
    if (collapsed()) return;
    void refresh();
    const updateSelection = () => {
      const selection = window.getSelection();
      const selectionTouchesLog = Boolean(selection && !selection.isCollapsed && logView
        && ((selection.anchorNode && logView.contains(selection.anchorNode))
          || (selection.focusNode && logView.contains(selection.focusNode))));
      setHasTextSelection(selectionTouchesLog);
    };
    document.addEventListener("selectionchange", updateSelection);
    const interval = window.setInterval(() => {
      if (!hasTextSelection()) void refresh();
    }, REFRESH_INTERVAL_MS);
    onCleanup(() => {
      document.removeEventListener("selectionchange", updateSelection);
      window.clearInterval(interval);
    });
  });

  return (
    <Portal mount={document.body}>
      <Show
        when={!collapsed()}
        fallback={(
          <aside class={`${styles.panel} ${styles.collapsed}`} aria-label="Diagnostic log">
            <HoverInfo content="Show diagnostic log" placement="left">
              <Button iconOnly size="md" onClick={() => setCollapsed(false)} aria-label="Show diagnostic log">
                <Icon name="ph:clipboard-text" size={18} decorative />
              </Button>
            </HoverInfo>
          </aside>
        )}
      >
        <aside class={styles.panel} aria-label="Diagnostic log">
          <div class={styles.ribbon}>
            <span class={styles.title}>Debug Log</span>
            <span class={styles.metric}>{savedPath() ? "Snapshot saved" : loading() ? "Reading…" : `${lineCount()} lines${truncated() ? " · tail" : ""}`}</span>
            <HoverInfo content="Refresh log">
              <Button iconOnly size="xs" onClick={() => void refresh()} aria-label="Refresh diagnostic log" disabled={loading()}>
                <Icon name="ph:arrows-clockwise" size={18} decorative />
              </Button>
            </HoverInfo>
            <HoverInfo content={copied() ? "Copied" : "Copy log"}>
              <Button iconOnly size="xs" onClick={() => void copyLog()} aria-label="Copy diagnostic log" disabled={!text()}>
                <Icon name="ph:copy" size={18} decorative />
              </Button>
            </HoverInfo>
            <HoverInfo content={savedPath() ? "Snapshot saved" : "Save log snapshot"}>
              <Button iconOnly size="xs" onClick={() => void saveLog()} aria-label="Save diagnostic log snapshot" disabled={!text() || saving()}>
                <Icon name="ph:floppy-disk" size={18} decorative />
              </Button>
            </HoverInfo>
            <HoverInfo content="Clear session log">
              <Button iconOnly size="xs" onClick={() => void clearLog()} aria-label="Clear diagnostic log" disabled={!text() || clearing()}>
                <Icon name="ph:trash" size={18} decorative />
              </Button>
            </HoverInfo>
            <HoverInfo content="Hide diagnostic log">
              <Button iconOnly size="xs" onClick={() => setCollapsed(true)} aria-label="Hide diagnostic log">
                <Icon name="ph:x" size={18} decorative />
              </Button>
            </HoverInfo>
          </div>
          <div class={styles.body}>
            <Show when={error()}><div class={styles.error} role="alert">{error()}</div></Show>
            <pre class={styles.log} ref={logView} tabindex="0" aria-label="Beat diagnostic log entries">
              {text() || "No diagnostic entries yet."}
            </pre>
            <div class={styles.path} title={path()}>{path() ? `Session log · ${path()}` : "Beat session log"}</div>
          </div>
        </aside>
      </Show>
    </Portal>
  );
}

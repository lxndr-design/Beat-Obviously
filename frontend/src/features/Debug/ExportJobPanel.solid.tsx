import { createEffect, onCleanup, Show } from "solid-js";
import { send } from "../../ipc/bridge";
import { createStoreSelector } from "../../solid-utils/store";
import { Button, HoverInfo, Icon } from "../../solid-ui";
import { useExportStore } from "../../state/exportStore";
import styles from "./ExportJobPanel.module.css";

export function ExportJobPanel() {
  const job = createStoreSelector(useExportStore, (state) => state.job);
  const label = () => {
    const current = job();
    if (!current) return "";
    if (current.finished && current.cancelled) return "Export Cancelled";
    if (current.finished) return current.ok ? "Export Complete" : "Export Failed";
    return `Exporting ${current.type ?? "project"}`;
  };
  const pathLabel = () => {
    const current = job();
    if (!current) return "";
    return current.path ? current.path.split("/").pop() ?? current.path : "Choosing file...";
  };

  createEffect(() => {
    const current = job();
    if (!current?.finished) return;
    const timer = window.setTimeout(useExportStore.getState().clear, current.ok ? 4000 : 8000);
    onCleanup(() => window.clearTimeout(timer));
  });

  return (
    <Show when={job()}>
      {(current) => (
        <aside class={styles.panel} aria-label="Project export status">
          <div class={styles.ribbon}>
            <span class={styles.title}>{label()}</span>
            <Show when={current().active}>
              <HoverInfo content="Cancel export" placement="left">
                <Button
                  iconOnly
                  size="xs"
                  onClick={() => void send({ kind: "project.exportCancel" }).then(useExportStore.getState().setJob)}
                  aria-label="Cancel export"
                >
                  <Icon name="ph:x" size={18} decorative />
                </Button>
              </HoverInfo>
            </Show>
            <Show when={current().finished}>
              <HoverInfo content="Dismiss export status" placement="left">
                <Button iconOnly size="xs" onClick={useExportStore.getState().clear} aria-label="Dismiss export status">
                  <Icon name="ph:x" size={18} decorative />
                </Button>
              </HoverInfo>
            </Show>
          </div>
          <div class={styles.body}>
            <span class={styles.track} aria-hidden="true">
              <span class={styles.fill} style={{ "--fill": `${Math.round((current().progress ?? 0) * 100)}%` }} />
            </span>
            <span class={styles.meta}>{current().error || pathLabel()}</span>
          </div>
        </aside>
      )}
    </Show>
  );
}

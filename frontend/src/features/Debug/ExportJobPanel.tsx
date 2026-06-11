import { useEffect } from "react";
import type { CSSProperties } from "react";
import { Button, HoverInfo, Icon } from "../../components";
import { send } from "../../ipc/bridge";
import { useExportStore } from "../../state/exportStore";
import styles from "./ExportJobPanel.module.css";

export function ExportJobPanel() {
  const job = useExportStore((state) => state.job);
  const clear = useExportStore((state) => state.clear);

  useEffect(() => {
    if (!job?.finished) return;
    const timer = window.setTimeout(clear, job.ok ? 4000 : 8000);
    return () => window.clearTimeout(timer);
  }, [clear, job?.finished, job?.jobId, job?.ok]);

  if (!job) return null;

  const label = job.finished
    ? job.ok ? "Export Complete" : "Export Failed"
    : `Exporting ${job.type ?? "project"}`;
  const pathLabel = job.path ? job.path.split("/").pop() ?? job.path : "Choosing file...";

  return (
    <aside className={styles.panel} aria-label="Project export status">
      <div className={styles.ribbon}>
        <span className={styles.title}>{label}</span>
        {job.active && (
          <HoverInfo content="Cancel export" placement="left">
            <Button
              iconOnly
              size="xs"
              onClick={() => void send({ kind: "project.exportCancel" }).then(useExportStore.getState().setJob)}
              aria-label="Cancel export"
            >
              <Icon name="ph:x" size={14} decorative />
            </Button>
          </HoverInfo>
        )}
        {job.finished && (
          <HoverInfo content="Dismiss export status" placement="left">
            <Button iconOnly size="xs" onClick={clear} aria-label="Dismiss export status">
              <Icon name="ph:x" size={14} decorative />
            </Button>
          </HoverInfo>
        )}
      </div>
      <div className={styles.body}>
        <span className={styles.track} aria-hidden="true">
          <span className={styles.fill} style={{ "--fill": `${Math.round((job.progress ?? 0) * 100)}%` } as CSSProperties} />
        </span>
        <span className={styles.meta}>{job.error || pathLabel}</span>
      </div>
    </aside>
  );
}

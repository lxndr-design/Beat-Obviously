import styles from "./TimepointLane.module.css";

export interface TimepointHandleProps {
  left: number;
  top: number;
  title: string;
  displayValue?: string;
  selectionKey?: string;
  selected?: boolean;
  dragging?: boolean;
  ghost?: boolean;
  pinned?: boolean;
  onSelect?: (additive: boolean) => void;
  onStartDrag?: (pointerId: number, clientX: number) => void;
  onOpenEditor?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
}

export function TimepointHandle(props: TimepointHandleProps) {
  const interactive = () => !props.ghost && Boolean(props.selectionKey);
  return (
    <span
      class={`${styles.handle} ${props.selected ? styles.selected : ""} ${props.dragging ? styles.dragging : ""} ${props.ghost ? styles.ghost : ""}`}
      title={props.title}
      style={{ left: `${props.left}px`, top: `${props.top}px` }}
      role={interactive() ? "button" : undefined}
      tabIndex={interactive() ? 0 : undefined}
      aria-pressed={interactive() ? Boolean(props.selected) : undefined}
      aria-label={interactive() ? props.title : undefined}
      aria-hidden={props.ghost ? "true" : undefined}
      data-track-timepoint-selection-key={props.selectionKey}
      data-track-effect-automation-point-key={props.selectionKey}
      data-pinned-single-point={props.pinned ? "true" : undefined}
      onContextMenu={(event) => {
        if (!interactive()) return;
        event.stopPropagation();
        props.onContextMenu?.(event);
      }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (!interactive() || event.button !== 0 || event.ctrlKey) return;
        event.stopPropagation();
        props.onSelect?.(event.shiftKey);
        props.onStartDrag?.(event.pointerId, event.clientX);
      }}
      onDblClick={(event) => {
        if (!interactive()) return;
        event.stopPropagation();
        props.onOpenEditor?.();
      }}
      onKeyDown={(event) => {
        if (!interactive()) return;
        if (event.key === " ") {
          event.preventDefault();
          props.onSelect?.(event.shiftKey);
        }
        if (event.key === "Enter") {
          event.preventDefault();
          props.onOpenEditor?.();
        }
      }}
    >
      {props.displayValue ? <span class={styles.tooltip}>{props.displayValue}</span> : null}
    </span>
  );
}

export function TimepointValuePopover(props: {
  left: number;
  top: number;
  label: string;
  value: string;
  unit: string;
  onInput: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      class={styles.popover}
      style={{ left: `${props.left}px`, top: `${props.top}px` }}
      role="dialog"
      aria-label={props.label}
      data-floating-layer
      onDblClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <input
        class={styles.input}
        value={props.value}
        autofocus
        aria-label={`${props.label} value`}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onBlur={props.onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") props.onCommit();
          if (event.key === "Escape") props.onCancel();
        }}
      />
      <span class={styles.unit}>{props.unit}</span>
    </div>
  );
}

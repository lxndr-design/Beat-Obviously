/** @jsxImportSource solid-js */
import { createEffect, createSignal, onCleanup, Show, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { pauseTransport, playTransport, restartTransport, stopTransport } from "../../audio/transportActions";
import { send } from "../../ipc/bridge";
import { createStoreSelector } from "../../solid-utils/store";
import { Button, HoverInfo, Icon } from "../../solid-ui";
import { useProjectStore, useTransportStore } from "../../state/store";
import { TimeSignatureControlSolid } from "../Transport/TimeSignatureControl.solid";
import { AppMenuButtonSolid } from "./AppMenuButton.solid";
import { InlineNumberSolid } from "./InlineNumber.solid";
import marqueeStyles from "../../components/MarqueeText/MarqueeText.module.css";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  onHome: () => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onExportRange: () => void;
  onExportTrack: () => void;
  onRecover: () => void;
  onHealth: () => void;
  onSettings: () => void;
}

export interface MountedTopBarSolid {
  setProps: (props: TopBarProps) => void;
  dispose: () => void;
}

export function mountTopBarSolid(host: HTMLElement, initialProps: TopBarProps): MountedTopBarSolid {
  const [props, setProps] = createSignal(initialProps, { equals: false });
  const dispose = render(() => <TopBarSolid props={props} />, host);
  return { setProps, dispose };
}

export function TopBarSolid(props: { props: Accessor<TopBarProps> }) {
  let projectNameInput: HTMLInputElement | undefined;
  const playing = createStoreSelector(useTransportStore, (state) => state.playing);
  const positionBeat = createStoreSelector(useTransportStore, (state) => state.positionBeat);
  const loopEnabled = createStoreSelector(useTransportStore, (state) => state.loopEnabled);
  const loopRange = createStoreSelector(useTransportStore, (state) => state.loopRange);
  const repeatTrackEnabled = createStoreSelector(useTransportStore, (state) => state.repeatTrackEnabled);
  const bpm = createStoreSelector(useProjectStore, (state) => state.project.bpm);
  const timeSignature = createStoreSelector(useProjectStore, (state) => state.project.timeSignature);
  const lengthBeats = createStoreSelector(useProjectStore, (state) => state.project.lengthBeats);
  const projectName = createStoreSelector(useProjectStore, (state) => state.project.name);
  const [editingProjectName, setEditingProjectName] = createSignal(false);
  const [projectNameDraft, setProjectNameDraft] = createSignal(projectName() || "Untitled");

  createEffect(() => {
    if (!editingProjectName()) setProjectNameDraft(projectName() || "Untitled");
  });

  createEffect(() => {
    if (!editingProjectName()) return;
    queueMicrotask(() => {
      projectNameInput?.focus();
      projectNameInput?.select();
    });
  });

  function onToggleLoop() {
    const nextEnabled = !loopEnabled();
    useTransportStore.getState().setLoopEnabled(nextEnabled);
    const range = loopRange();
    const activeRange = nextEnabled && range.endBeat > range.startBeat ? range : null;
    void send({ kind: "transport.setLoop", range: activeRange });
  }

  function commitProjectName() {
    const nextName = projectNameDraft().trim() || "Untitled";
    if (nextName !== projectName()) useProjectStore.getState().rename(nextName);
    setEditingProjectName(false);
  }

  return (
    <header class={styles.bar}>
      <div class={styles.brand}>
        <AppMenuButtonSolid props={props.props} />
        <h1 class={styles.breadcrumb}>
          <span>Editor</span>
          <span class={styles.breadcrumbSlash}>/</span>
          <Show
            when={editingProjectName()}
            fallback={(
              <button
                type="button"
                class={styles.projectName}
                onDblClick={() => setEditingProjectName(true)}
                title="Double-click to rename project"
              >
                <MarqueeTextSolid text={projectName() || "Untitled"} className={styles.projectNameText} />
              </button>
            )}
          >
            <input
              ref={projectNameInput}
              class={styles.projectNameInput}
              value={projectNameDraft()}
              onInput={(event) => setProjectNameDraft(event.currentTarget.value)}
              onBlur={commitProjectName}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitProjectName();
                if (event.key === "Escape") {
                  setProjectNameDraft(projectName() || "Untitled");
                  setEditingProjectName(false);
                }
              }}
              aria-label="Project name"
            />
          </Show>
        </h1>
      </div>

      <div class={styles.transport}>
        <HoverInfo content="Restart">
          <Button iconOnly size="md" onClick={restartTransport} aria-label="Restart">
            <Icon name="ph:skip-back-fill" size={16} decorative />
          </Button>
        </HoverInfo>
        <HoverInfo content={playing() ? "Pause (Space)" : "Play (Space)"}>
          <Button
            iconOnly
            size="md"
            variant={playing() ? "primary" : "default"}
            onClick={playing() ? pauseTransport : playTransport}
            aria-label={playing() ? "Pause" : "Play"}
          >
            <Icon name={playing() ? "ph:pause-fill" : "ph:play-fill"} size={16} decorative />
          </Button>
        </HoverInfo>
        <HoverInfo content={loopEnabled() ? "Disable review loop" : "Enable review loop"}>
          <Button
            iconOnly
            size="md"
            variant={loopEnabled() ? "primary" : "default"}
            onClick={onToggleLoop}
            aria-label={loopEnabled() ? "Disable review loop" : "Enable review loop"}
          >
            <Icon name="ph:arrows-in-line-horizontal" size={16} decorative />
          </Button>
        </HoverInfo>
        <HoverInfo content={repeatTrackEnabled() ? "Disable track repeat" : "Repeat track at end"}>
          <Button
            iconOnly
            size="md"
            variant={repeatTrackEnabled() ? "primary" : "default"}
            onClick={() => useTransportStore.getState().setRepeatTrackEnabled(!repeatTrackEnabled())}
            aria-label={repeatTrackEnabled() ? "Disable track repeat" : "Enable track repeat"}
          >
            <Icon name="ph:repeat" size={16} decorative />
          </Button>
        </HoverInfo>
        <HoverInfo content="Stop (.)">
          <Button iconOnly size="md" onClick={stopTransport} aria-label="Stop">
            <Icon name="ph:stop-fill" size={16} decorative />
          </Button>
        </HoverInfo>
        <span class={`${styles.field} ${styles.timeField}`}>
          {formatClock(positionBeat(), bpm())} / {formatClock(lengthBeats(), bpm())}
        </span>
      </div>

      <div class={styles.projectControls}>
        <InlineNumberSolid
          label="Length"
          value={lengthBeats()}
          min={4}
          max={4096}
          step={4}
          onChange={(value) => useProjectStore.getState().setLengthBeats(value)}
        />
        <TimeSignatureControlSolid
          value={timeSignature()}
          onChange={(value) => useProjectStore.getState().setTimeSignature(value)}
        />
        <InlineNumberSolid
          label="BPM"
          value={bpm()}
          min={20}
          max={999}
          step={1}
          onChange={(value) => useProjectStore.getState().setBpm(value)}
        />
      </div>
    </header>
  );
}

function MarqueeTextSolid(props: { text: string; className?: string; title?: string }) {
  let rootElement: HTMLSpanElement | undefined;
  let innerElement: HTMLSpanElement | undefined;
  let frame = 0;
  const [metrics, setMetrics] = createSignal({ overflow: false, offset: 0, duration: 1.4 }, { equals: false });

  createEffect(() => {
    props.text;
    const root = rootElement;
    const inner = innerElement;
    if (!root || !inner) return;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const offset = Math.ceil(inner.scrollWidth - root.clientWidth);
        setMetrics({
          overflow: offset > 1,
          offset: Math.max(0, offset),
          duration: Math.max(1.2, Math.min(8, offset / 34)),
        });
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(inner);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    });
  });

  return (
    <span
      ref={rootElement}
      class={`${marqueeStyles.root} ${props.className ?? ""}`}
      data-overflow={metrics().overflow ? "true" : "false"}
      style={{
        "--marquee-offset": `${-metrics().offset}px`,
        "--marquee-duration": `${metrics().duration}s`,
      }}
      title={props.title ?? props.text}
    >
      <span ref={innerElement} class={marqueeStyles.inner}>{props.text}</span>
    </span>
  );
}

function formatClock(beat: number, bpm: number): string {
  const seconds = (beat * 60) / bpm;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${m}:${String(s).padStart(2, "0")}:${String(cs).padStart(2, "0")}`;
}

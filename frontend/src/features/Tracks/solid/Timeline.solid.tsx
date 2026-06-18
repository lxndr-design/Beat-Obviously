import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { send } from "../../../ipc/bridge";
import { createStoreSelector } from "../../../solid-utils/store";
import { useProjectStore, useTransportStore, useViewStore } from "../../../state/store";
import styles from "../Timeline.module.css";

type LoopClamp = "start" | "end";

export function TimelineSolid() {
  let stripElement: HTMLDivElement | undefined;
  const lengthBeats = createStoreSelector(useProjectStore, (state) => state.project.lengthBeats);
  const timeSignature = createStoreSelector(useProjectStore, (state) => state.project.timeSignature);
  const bpm = createStoreSelector(useProjectStore, (state) => state.project.bpm);
  const beatsToPx = createStoreSelector(useViewStore, (state) => state.beatsToPx);
  const loopEnabled = createStoreSelector(useTransportStore, (state) => state.loopEnabled);
  const loopRange = createStoreSelector(useTransportStore, (state) => state.loopRange);
  const [viewportWidth, setViewportWidth] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);
  const [loopDragging, setLoopDragging] = createSignal<LoopClamp | null>(null);

  createEffect(() => {
    const parent = stripElement?.parentElement;
    if (!parent) return;
    const update = () => setViewportWidth(parent.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    window.addEventListener("resize", update);
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    });
  });

  const displayWidthPx = createMemo(() => Math.max(lengthBeats() * beatsToPx(), viewportWidth()));
  const displayBeats = createMemo(() => Math.max(lengthBeats(), Math.ceil(displayWidthPx() / beatsToPx())));
  const ticks = createMemo(() => Array.from({ length: displayBeats() + 1 }, (_, beat) => beat));
  const totalSeconds = createMemo(() => Math.ceil((displayBeats() * 60) / bpm()));
  const secondTicks = createMemo(() => Array.from({ length: totalSeconds() + 1 }, (_, seconds) => ({
    seconds,
    beat: (seconds * bpm()) / 60,
  })).filter((tick) => tick.beat <= displayBeats()));
  const showSecondLabels = createMemo(() => ((bpm() / 60) * beatsToPx()) >= MIN_SECOND_LABEL_SPACING_PX);
  const measureBeats = createMemo(() => Math.max(1, timeSignature().num));
  const boldMeasureStep = createMemo(() => adaptiveBoldMeasureStep(beatsToPx(), measureBeats()));
  const loopStartPx = createMemo(() => loopRange().startBeat * beatsToPx());
  const loopEndPx = createMemo(() => loopRange().endBeat * beatsToPx());
  const showLoopRegion = createMemo(() => loopRange().endBeat > loopRange().startBeat);

  function isBold(beatIdx: number): boolean {
    if (beatIdx % measureBeats() !== 0) return false;
    const measureIndex = beatIdx / measureBeats();
    return measureIndex % boldMeasureStep() === 0;
  }

  function beatAt(clientX: number): number {
    const rect = stripElement?.getBoundingClientRect();
    if (!rect) return 0;
    const beat = (clientX - rect.left) / beatsToPx();
    return Math.max(0, Math.min(lengthBeats(), beat));
  }

  function commit(clientX: number) {
    const beat = beatAt(clientX);
    useTransportStore.getState().setPosition(beat);
    void send({ kind: "transport.seek", positionBeat: beat });
  }

  function commitLoopClamp(clamp: LoopClamp, clientX: number) {
    const beat = beatAt(clientX);
    const currentRange = loopRange();
    const next = clamp === "start"
      ? { startBeat: Math.min(beat, currentRange.endBeat), endBeat: currentRange.endBeat }
      : { startBeat: currentRange.startBeat, endBeat: Math.max(beat, currentRange.startBeat) };
    useTransportStore.getState().setLoopRange(next);
    if (loopEnabled()) {
      void send({ kind: "transport.setLoop", range: next.endBeat > next.startBeat ? next : null });
    }
  }

  createEffect(() => {
    if (!dragging()) return;
    const onMove = (event: PointerEvent) => commit(event.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    onCleanup(() => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    });
  });

  createEffect(() => {
    const activeClamp = loopDragging();
    if (!activeClamp) return;
    const onMove = (event: PointerEvent) => commitLoopClamp(activeClamp, event.clientX);
    const onUp = () => setLoopDragging(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    onCleanup(() => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    });
  });

  return (
    <div
      ref={stripElement}
      class={styles.timeline}
      data-timeline-ruler
      style={{ width: `${displayWidthPx()}px` }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        commit(event.clientX);
      }}
    >
      <For each={ticks()}>
        {(beat) => {
          const major = () => beat % measureBeats() === 0;
          const bold = () => isBold(beat);
          return (
            <div
              class={`${styles.tick} ${major() ? styles.major : ""} ${bold() ? styles.bold : ""}`}
              style={{ left: `${beat * beatsToPx()}px` }}
            >
              <Show when={bold() && !showSecondLabels()}>
                <span class={styles.label}>{formatTime(beat, bpm())}</span>
              </Show>
            </div>
          );
        }}
      </For>
      <For each={secondTicks()}>
        {({ seconds, beat }) => (
          <div class={styles.timeLabelTick} style={{ left: `${beat * beatsToPx()}px` }}>
            <Show when={showSecondLabels()}>
              <span class={styles.label}>{formatSeconds(seconds)}</span>
            </Show>
          </div>
        )}
      </For>
      <Show when={showLoopRegion()}>
        <div
          class={`${styles.loopRegion} ${loopEnabled() ? styles.loopRegionEnabled : ""}`}
          style={{ left: `${loopStartPx()}px`, width: `${loopEndPx() - loopStartPx()}px` }}
          aria-hidden="true"
        />
      </Show>
      <button
        type="button"
        class={`${styles.loopClamp} ${styles.loopClampStart} ${loopEnabled() || loopDragging() === "start" ? styles.loopClampActive : ""}`}
        style={{ left: `${loopStartPx()}px` }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setLoopDragging("start");
          commitLoopClamp("start", event.clientX);
        }}
        aria-label="Drag loop start"
      />
      <button
        type="button"
        class={`${styles.loopClamp} ${styles.loopClampEnd} ${loopEnabled() || loopDragging() === "end" ? styles.loopClampActive : ""}`}
        style={{ left: `${loopEndPx()}px` }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setLoopDragging("end");
          commitLoopClamp("end", event.clientX);
        }}
        aria-label="Drag loop end"
      />
    </div>
  );
}

function formatTime(beat: number, bpm: number): string {
  const seconds = (beat * 60) / bpm;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

const MIN_SECOND_LABEL_SPACING_PX = 36;
const MIN_BOLD_TICK_SPACING_PX = 72;

function adaptiveBoldMeasureStep(beatsToPx: number, measureBeats: number): number {
  const measurePx = Math.max(1, beatsToPx * measureBeats);
  let step = 1;
  while (measurePx * step < MIN_BOLD_TICK_SPACING_PX) step *= 2;
  return step;
}

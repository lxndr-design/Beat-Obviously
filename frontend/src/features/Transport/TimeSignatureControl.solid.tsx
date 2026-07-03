import { createMemo, createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Button, HoverInfo, Icon, NumberInput, Select } from "../../solid-ui";
import type { TimeSignature } from "../../state/types";
import styles from "./TimeSignatureControl.module.css";
import modalFrameStyles from "../../solid-ui/Modal/Modal.module.css";
import timeSignatureModalStyles from "./TimeSignatureModal.module.css";

export interface TimeSignatureControlProps {
  value: TimeSignature;
  onChange: (value: TimeSignature) => void;
  ariaLabel?: string;
  direction?: "down" | "up";
}

const TS_PRESETS = ["4/4", "3/4", "6/8", "5/4", "7/8", "12/8"] as const;
const DENOMS = [2, 4, 8, 16];

export function TimeSignatureControl(props: TimeSignatureControlProps) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [modalOpen, setModalOpen] = createSignal(false);
  const ariaLabel = () => props.ariaLabel ?? "Time signature";

  return (
    <div class={styles.wrap}>
      <HoverInfo content={ariaLabel()}>
        <Button
          variant="ghost"
          className={styles.button}
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={ariaLabel()}
          aria-expanded={menuOpen()}
        >
          {props.value.num}/{props.value.denom}
          <Icon name={props.direction === "up" ? "ph:caret-up" : "ph:caret-down"} size={16} decorative />
        </Button>
      </HoverInfo>
      <Show when={menuOpen()}>
        <div class={`${styles.dropdown} ${props.direction === "up" ? styles.dropUp : ""}`} role="menu">
          <For each={TS_PRESETS}>
            {(preset) => (
              <Button
                variant="ghost"
                className={styles.dropItem}
                onClick={() => {
                  const [num, denom] = preset.split("/").map(Number);
                  props.onChange({ num, denom, boldBeats: [1] });
                  setMenuOpen(false);
                }}
              >
                {preset}
              </Button>
            )}
          </For>
          <div class={styles.dropSep} />
          <Button
            variant="ghost"
            className={styles.dropItem}
            onClick={() => {
              setMenuOpen(false);
              setModalOpen(true);
            }}
          >
            Custom...
          </Button>
        </div>
      </Show>
      <Show when={modalOpen()}>
        <TimeSignatureModal
          value={props.value}
          onChange={props.onChange}
          onClose={() => setModalOpen(false)}
        />
      </Show>
    </div>
  );
}

function TimeSignatureModal(props: {
  value: TimeSignature;
  onChange: (value: TimeSignature) => void;
  onClose: () => void;
}) {
  const [num, setNum] = createSignal(props.value.num);
  const [denom, setDenom] = createSignal(props.value.denom);
  const [bold, setBold] = createSignal<number[]>(props.value.boldBeats, { equals: false });
  const dirty = createMemo(() =>
    num() !== props.value.num
    || denom() !== props.value.denom
    || bold().length !== props.value.boldBeats.length
    || bold().some((beat, index) => beat !== props.value.boldBeats[index]),
  );

  function toggleBold(beat: number) {
    setBold((current) =>
      current.includes(beat)
        ? current.filter((candidate) => candidate !== beat)
        : [...current, beat].sort((a, b) => a - b),
    );
  }

  function save() {
    props.onChange({ num: num(), denom: denom(), boldBeats: bold().filter((beat) => beat <= num()) });
    props.onClose();
  }

  return (
    <Portal mount={document.body}>
      <div
        class={modalFrameStyles.scrim}
        style={{ "z-index": 3000 }}
        role="presentation"
        data-floating-layer
        onPointerDown={props.onClose}
      >
        <section
          class={`${modalFrameStyles.modal} ${modalFrameStyles["width-sm"]} animate-slide-in-bottom`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="time-signature-title"
          data-floating-layer
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header class={modalFrameStyles.header}>
            <div class={modalFrameStyles.titleGroup}>
              <h2 id="time-signature-title" class={modalFrameStyles.title}>Time signature</h2>
            </div>
            <div class={modalFrameStyles.headerRight}>
              <button type="button" class={modalFrameStyles.closeBtn} onClick={props.onClose} aria-label="Close">
                <Icon name="ph:x" size={16} decorative />
              </button>
            </div>
          </header>
          <div class={modalFrameStyles.body}>
            <div class={timeSignatureModalStyles.row}>
              <NumberInput
                label="Beats per bar"
                value={num()}
                min={1}
                max={32}
                step={1}
                onChange={setNum}
              />
              <Select
                className={timeSignatureModalStyles.field}
                selectClassName={timeSignatureModalStyles.select}
                label="Note value"
                value={String(denom())}
                onChange={(event) => setDenom(Number(event.currentTarget.value))}
              >
                  <For each={DENOMS}>
                    {(value) => <option value={String(value)}>1/{value}</option>}
                  </For>
              </Select>
            </div>
            <div class={timeSignatureModalStyles.boldSection}>
              <span class={timeSignatureModalStyles.label}>Bold ticks (per bar)</span>
              <div class={timeSignatureModalStyles.beatGrid}>
                <For each={Array.from({ length: num() }, (_, index) => index + 1)}>
                  {(beat) => (
                    <Button
                      iconOnly
                      size="md"
                      variant="ghost"
                      selected={bold().includes(beat)}
                      className={timeSignatureModalStyles.beatCell}
                      onClick={() => toggleBold(beat)}
                      aria-pressed={bold().includes(beat)}
                      aria-label={`Beat ${beat}`}
                    >
                      {beat}
                    </Button>
                  )}
                </For>
              </div>
            </div>
          </div>
          <footer class={modalFrameStyles.footer}>
            <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" disabled={!dirty()} onClick={save}>Save</Button>
          </footer>
        </section>
      </div>
    </Portal>
  );
}

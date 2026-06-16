/** @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show } from "solid-js";
import { render } from "solid-js/web";
import { appPrompt } from "../../components";
import { send } from "../../ipc/bridge";
import { createStoreSelector } from "../../solid-utils/store";
import { Button, HoverInfo, Icon } from "../../solid-ui";
import { useProjectStore, useTransportStore, useUiStore } from "../../state/store";
import { EQ_BAND_COUNT, type EqAutomationPoint } from "../../state/types";
import { EqGraphSolid } from "./EqGraph.solid";
import styles from "./MasterEqPanel.module.css";

export interface MountedMasterEqPanelSolid {
  dispose: () => void;
}

export function mountMasterEqPanelSolid(host: HTMLElement): MountedMasterEqPanelSolid {
  const dispose = render(() => <MasterEqPanelSolid />, host);
  return { dispose };
}

export function MasterEqPanelSolid() {
  const automation = createStoreSelector(useProjectStore, (state) => state.project.masterEqAutomation);
  const project = createStoreSelector(useProjectStore, (state) => state.project);
  const position = createStoreSelector(useTransportStore, (state) => state.positionBeat);
  const [presetOpen, setPresetOpen] = createSignal(false);
  const [userPresets, setUserPresets] = createSignal<EqPreset[]>(readUserPresets(), { equals: false });
  const current = createMemo(() => interpolateEq(automation(), position()));
  const presets = createMemo(() => [...FACTORY_PRESETS, ...userPresets()]);

  function setBand(index: number, db: number) {
    let next = [...automation()];
    if (next.length === 0) {
      next = [{ atBeat: 0, bandsDb: new Array(EQ_BAND_COUNT).fill(0) }];
    }
    const first = next[0];
    next[0] = {
      ...first,
      bandsDb: first.bandsDb.map((value, bandIndex) => bandIndex === index ? db : value),
    };
    useProjectStore.getState().loadProject({ ...project(), masterEqAutomation: next });
    void send({ kind: "eq.setAutomation", points: next });
  }

  function setBandsDb(bandsDb: number[]) {
    const next = [{ atBeat: 0, bandsDb: normalizeBands(bandsDb) }];
    useProjectStore.getState().loadProject({ ...project(), masterEqAutomation: next });
    void send({ kind: "eq.setAutomation", points: next });
  }

  async function savePreset() {
    const name = await appPrompt("Preset name");
    if (!name?.trim()) return;
    const next = [
      ...userPresets().filter((preset) => preset.name !== name.trim()),
      {
        id: crypto.randomUUID(),
        name: name.trim(),
        bandsDb: normalizeBands(current()),
        user: true,
      },
    ];
    setUserPresets(next);
    writeUserPresets(next);
  }

  function deletePreset(id: string) {
    const next = userPresets().filter((preset) => preset.id !== id);
    setUserPresets(next);
    writeUserPresets(next);
  }

  return (
    <section class={styles.panel} aria-label="Global Mastering">
      <header class={styles.ribbon}>
        <span class={styles.title}>Global Mastering</span>
        <div class={styles.ribbonActions}>
          <div class={styles.presetWrap}>
            <Button class={styles.presetButton} size="xs" onClick={() => setPresetOpen((open) => !open)}>
              Presets
              <Icon name="ph:caret-down" size={12} decorative />
            </Button>
            <Show when={presetOpen()}>
              <div class={styles.presetMenu} role="menu">
                <For each={presets()}>
                  {(preset) => (
                    <div class={styles.presetItem}>
                      <button
                        type="button"
                        class={styles.presetName}
                        onClick={() => {
                          setBandsDb(preset.bandsDb);
                          setPresetOpen(false);
                        }}
                      >
                        {preset.name}
                      </button>
                      <Show when={preset.user}>
                        <button
                          type="button"
                          class={styles.presetDelete}
                          onClick={() => deletePreset(preset.id)}
                          aria-label={`Delete ${preset.name}`}
                        >
                          <Icon name="ph:trash" size={12} decorative />
                        </button>
                      </Show>
                    </div>
                  )}
                </For>
                <button type="button" class={styles.savePreset} onClick={() => void savePreset()}>
                  Save as preset
                </button>
              </div>
            </Show>
          </div>
          <HoverInfo content="Open EQ automation editor">
            <Button
              class={styles.editButton}
              iconOnly
              size="xs"
              onClick={() => useUiStore.getState().openEditor({ kind: "eq" })}
              aria-label="Edit automation"
            >
              <Icon name="ph:pencil-simple" size={16} decorative />
            </Button>
          </HoverInfo>
        </div>
      </header>
      <div class={styles.graphHost}>
        <EqGraphSolid bandsDb={current()} onChange={setBand} />
      </div>
    </section>
  );
}

interface EqPreset {
  id: string;
  name: string;
  bandsDb: number[];
  user?: boolean;
}

const USER_PRESET_KEY = "beat.masterEq.presets.v1";

const FACTORY_PRESETS: EqPreset[] = [
  { id: "flat", name: "Flat", bandsDb: [0, 0, 0, 0, 0, 0, 0] },
  { id: "warm", name: "Warm", bandsDb: [7, 5, 2, 0, -1.5, -3, -4] },
  { id: "bright", name: "Bright", bandsDb: [-4, -2.5, -1, 1, 3.5, 5.5, 7] },
  { id: "club", name: "Club", bandsDb: [8, 4, -3, -5, 2, 5, 3] },
  { id: "vocal", name: "Vocal", bandsDb: [-5, -3, -1, 4, 7, 3, -1] },
];

function normalizeBands(bandsDb: number[]): number[] {
  return Array.from({ length: EQ_BAND_COUNT }, (_, index) => (
    Math.max(-24, Math.min(24, bandsDb[index] ?? 0))
  ));
}

function readUserPresets(): EqPreset[] {
  try {
    const raw = localStorage.getItem(USER_PRESET_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as EqPreset[];
    return parsed
      .filter((preset) => preset.user && preset.name && Array.isArray(preset.bandsDb))
      .map((preset) => ({ ...preset, bandsDb: normalizeBands(preset.bandsDb), user: true }));
  } catch {
    return [];
  }
}

function writeUserPresets(presets: EqPreset[]) {
  localStorage.setItem(USER_PRESET_KEY, JSON.stringify(presets));
}

function interpolateEq(points: EqAutomationPoint[], beat: number): number[] {
  if (points.length === 0) return new Array(EQ_BAND_COUNT).fill(0);
  const sorted = [...points].sort((a, b) => a.atBeat - b.atBeat);
  if (beat <= sorted[0].atBeat) return [...sorted[0].bandsDb];
  if (beat >= sorted[sorted.length - 1].atBeat) return [...sorted[sorted.length - 1].bandsDb];
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const next = sorted[index];
    if (beat >= previous.atBeat && beat <= next.atBeat) {
      const t = (beat - previous.atBeat) / (next.atBeat - previous.atBeat);
      return previous.bandsDb.map((value, bandIndex) => value + ((next.bandsDb[bandIndex] ?? 0) - value) * t);
    }
  }
  return [...sorted[0].bandsDb];
}

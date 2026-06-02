import { useState } from "react";
import { Button, Icon, HoverInfo } from "../../components";
import { useProjectStore, useTransportStore, useUiStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import { EQ_BAND_COUNT, type EqAutomationPoint } from "../../state/types";
import { EqGraph } from "./EqGraph";
import styles from "./MasterEqPanel.module.css";

/**
 * MasterEqPanel — bottom-of-app 7-band EQ as a graph.
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ MASTER EQ                                              [edit]  │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │  ●─●─●─●─●─●─●                       (drag dots vertically)    │
 *   │  ───── 0 dB reference ─────                                    │
 *   │  80  200  500  1.3k  3k  6k  16k    (micro freq labels)        │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Editing a dot updates the *first* automation point (creates it at beat 0
 * if none exist). The full timeline-automation editor is reachable via the
 * pencil icon in the ribbon.
 */
export function MasterEqPanel() {
  const automation = useProjectStore((s) => s.project.masterEqAutomation);
  const loadProject = useProjectStore((s) => s.loadProject);
  const project = useProjectStore((s) => s.project);
  const position = useTransportStore((s) => s.positionBeat);
  const openEditor = useUiStore((s) => s.openEditor);
  const [presetOpen, setPresetOpen] = useState(false);
  const [userPresets, setUserPresets] = useState<EqPreset[]>(readUserPresets);

  const current = interpolateEq(automation, position);

  function setBand(idx: number, db: number) {
    let next = [...automation];
    if (next.length === 0) {
      next = [{ atBeat: 0, bandsDb: new Array(EQ_BAND_COUNT).fill(0) }];
    }
    const first = next[0];
    next[0] = {
      ...first,
      bandsDb: first.bandsDb.map((d, i) => (i === idx ? db : d)),
    };
    loadProject({ ...project, masterEqAutomation: next });
    void send({ kind: "eq.setAutomation", points: next });
  }

  function setBandsDb(bandsDb: number[]) {
    const next = [{ atBeat: 0, bandsDb: normalizeBands(bandsDb) }];
    loadProject({ ...project, masterEqAutomation: next });
    void send({ kind: "eq.setAutomation", points: next });
  }

  function savePreset() {
    const name = window.prompt("Preset name");
    if (!name?.trim()) return;
    const next = [...userPresets.filter((preset) => preset.name !== name.trim()), {
      id: crypto.randomUUID(),
      name: name.trim(),
      bandsDb: normalizeBands(current),
      user: true,
    }];
    setUserPresets(next);
    writeUserPresets(next);
  }

  function deletePreset(id: string) {
    const next = userPresets.filter((preset) => preset.id !== id);
    setUserPresets(next);
    writeUserPresets(next);
  }

  return (
    <section className={styles.panel} aria-label="Mastering">
      <header className={styles.ribbon}>
        <span className={styles.title}>Mastering</span>
        <div className={styles.ribbonActions}>
          <div className={styles.presetWrap}>
            <Button size="xs" onClick={() => setPresetOpen((open) => !open)}>
              Presets
              <Icon name="ph:caret-down" size={12} decorative />
            </Button>
            {presetOpen && (
              <div className={styles.presetMenu} role="menu">
                {[...FACTORY_PRESETS, ...userPresets].map((preset) => (
                  <div key={preset.id} className={styles.presetItem}>
                    <button
                      type="button"
                      className={styles.presetName}
                      onClick={() => {
                        setBandsDb(preset.bandsDb);
                        setPresetOpen(false);
                      }}
                    >
                      {preset.name}
                    </button>
                    {preset.user && (
                      <button
                        type="button"
                        className={styles.presetDelete}
                        onClick={() => deletePreset(preset.id)}
                        aria-label={`Delete ${preset.name}`}
                      >
                        <Icon name="ph:trash" size={12} decorative />
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className={styles.savePreset} onClick={savePreset}>
                  Save as preset
                </button>
              </div>
            )}
          </div>
          <HoverInfo content="Open EQ automation editor">
            <Button
              iconOnly
              size="xs"
              onClick={() => openEditor({ kind: "eq" })}
              aria-label="Edit automation"
            >
              <Icon name="ph:pencil-simple" size={16} decorative />
            </Button>
          </HoverInfo>
        </div>
      </header>
      <div className={styles.graphHost}>
        <EqGraph bandsDb={current} onChange={setBand} />
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
  { id: "warm", name: "Warm", bandsDb: [3, 2, 0.5, 0, -0.5, -1, -1.5] },
  { id: "bright", name: "Bright", bandsDb: [-1, -0.5, 0, 0.5, 1.5, 2, 3] },
  { id: "club", name: "Club", bandsDb: [3, 1.5, -1, -1.5, 0.5, 2, 1] },
  { id: "vocal", name: "Vocal", bandsDb: [-2, -1, 0, 2, 3, 1, 0] },
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

function interpolateEq(pts: EqAutomationPoint[], beat: number): number[] {
  if (pts.length === 0) return new Array(EQ_BAND_COUNT).fill(0);
  const sorted = [...pts].sort((a, b) => a.atBeat - b.atBeat);
  if (beat <= sorted[0].atBeat) return [...sorted[0].bandsDb];
  if (beat >= sorted[sorted.length - 1].atBeat)
    return [...sorted[sorted.length - 1].bandsDb];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (beat >= a.atBeat && beat <= b.atBeat) {
      const t = (beat - a.atBeat) / (b.atBeat - a.atBeat);
      return a.bandsDb.map((av, k) => av + ((b.bandsDb[k] ?? 0) - av) * t);
    }
  }
  return [...sorted[0].bandsDb];
}

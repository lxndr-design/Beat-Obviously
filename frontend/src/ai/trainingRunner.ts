import { send } from "../ipc/bridge";
import {
  exportDrumBeatFineTuneJsonl,
  exportInstrumentFineTuneJsonl,
  exportMidiSongFineTuneJsonl,
  getTrainingSignalStats,
  type TrainingSignalStats,
} from "../persistence/dexie";

export type TrainingKind = keyof TrainingSignalStats;

export interface TrainingStatus {
  status: "idle" | "queued" | "running" | "finished" | "failed" | "skipped";
  signalCount: number;
  message?: string;
  updatedAt: number;
}

export const TRAINING_BREAKPOINT = 20;

const TRAINING_CHECKPOINT_KEY = "beat.training.trainedAt";
const TRAINING_ATTEMPT_KEY = "beat.training.attemptedAt";
const TRAINING_RUNNING_KEY = "beat.training.runningAt";
const TRAINING_STATUS_KEY = "beat.training.status";

const EMPTY_COUNTS: TrainingSignalStats = { drums: 0, instruments: 0, midi: 0 };

export function readTrainingCheckpoints(): TrainingSignalStats {
  return readCounts(TRAINING_CHECKPOINT_KEY);
}

export function writeTrainingCheckpoints(value: TrainingSignalStats) {
  writeCounts(TRAINING_CHECKPOINT_KEY, value);
}

export function readTrainingStatuses(): Partial<Record<TrainingKind, TrainingStatus>> {
  try {
    return JSON.parse(localStorage.getItem(TRAINING_STATUS_KEY) ?? "{}") as Partial<Record<TrainingKind, TrainingStatus>>;
  } catch {
    return {};
  }
}

export function writeTrainingStatus(kind: TrainingKind, status: Omit<TrainingStatus, "updatedAt">) {
  const statuses = readTrainingStatuses();
  statuses[kind] = { ...status, updatedAt: Date.now() };
  localStorage.setItem(TRAINING_STATUS_KEY, JSON.stringify(statuses));
}

export function markTrainingComplete(kind: TrainingKind, signalCount: number) {
  const checkpoints = readTrainingCheckpoints();
  writeTrainingCheckpoints({ ...checkpoints, [kind]: signalCount });
  const running = readCounts(TRAINING_RUNNING_KEY);
  writeCounts(TRAINING_RUNNING_KEY, { ...running, [kind]: 0 });
  writeTrainingStatus(kind, { status: "finished", signalCount, message: "Training complete." });
}

export function markTrainingFailed(kind: TrainingKind, signalCount: number, message: string) {
  const running = readCounts(TRAINING_RUNNING_KEY);
  writeCounts(TRAINING_RUNNING_KEY, { ...running, [kind]: 0 });
  writeTrainingStatus(kind, { status: "failed", signalCount, message });
}

export async function maybeRunDueTraining(kind?: TrainingKind, options: { force?: boolean } = {}) {
  const stats = await getTrainingSignalStats();
  const checkpoints = readTrainingCheckpoints();
  const attempted = readCounts(TRAINING_ATTEMPT_KEY);
  const running = readCounts(TRAINING_RUNNING_KEY);
  const kinds = kind ? [kind] : (["drums", "instruments", "midi"] satisfies TrainingKind[]);

  for (const task of kinds) {
    const signalCount = stats[task];
    const sinceLast = Math.max(0, signalCount - (checkpoints[task] ?? 0));
    if (!options.force && sinceLast < TRAINING_BREAKPOINT) continue;
    if (!options.force && (attempted[task] === signalCount || running[task] === signalCount)) continue;
    if (signalCount <= 0) {
      writeTrainingStatus(task, { status: "skipped", signalCount, message: "No training signals yet." });
      continue;
    }

    const jsonl = await exportJsonl(task);
    if (!jsonl.trim()) {
      writeTrainingStatus(task, { status: "skipped", signalCount, message: "No exportable training rows yet." });
      continue;
    }

    writeCounts(TRAINING_ATTEMPT_KEY, { ...readCounts(TRAINING_ATTEMPT_KEY), [task]: signalCount });
    writeTrainingStatus(task, { status: "queued", signalCount, message: "Queued local training." });

    try {
      const response = await send({ kind: "training.run", task, jsonl, signalCount });
      if (response.started) {
        writeCounts(TRAINING_RUNNING_KEY, { ...readCounts(TRAINING_RUNNING_KEY), [task]: signalCount });
        writeTrainingStatus(task, { status: "running", signalCount, message: "Local training is running." });
      } else {
        writeTrainingStatus(task, {
          status: "failed",
          signalCount,
          message: response.reason ?? "Training runner did not start.",
        });
      }
    } catch (error) {
      writeTrainingStatus(task, {
        status: "failed",
        signalCount,
        message: error instanceof Error ? error.message : "Training runner failed to start.",
      });
    }
  }

  return {
    stats,
    trainedAt: readTrainingCheckpoints(),
    statuses: readTrainingStatuses(),
  };
}

export function makeTrainingCheckpoints(stats: TrainingSignalStats, trainedAt: TrainingSignalStats) {
  return ([
    { kind: "drums", label: "Drums" },
    { kind: "instruments", label: "Instruments" },
    { kind: "midi", label: "MIDI/song" },
  ] as Array<{ kind: TrainingKind; label: string }>).map((item) => {
    const sinceLast = Math.max(0, stats[item.kind] - (trainedAt[item.kind] ?? 0));
    const remaining = Math.max(0, TRAINING_BREAKPOINT - sinceLast);
    return {
      ...item,
      sinceLast,
      remaining,
      ready: sinceLast >= TRAINING_BREAKPOINT,
    };
  });
}

async function exportJsonl(kind: TrainingKind): Promise<string> {
  if (kind === "drums") return exportDrumBeatFineTuneJsonl();
  if (kind === "instruments") return exportInstrumentFineTuneJsonl();
  return exportMidiSongFineTuneJsonl();
}

function readCounts(key: string): TrainingSignalStats {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<TrainingSignalStats>;
    return {
      drums: parsed.drums ?? 0,
      instruments: parsed.instruments ?? 0,
      midi: parsed.midi ?? 0,
    };
  } catch {
    return { ...EMPTY_COUNTS };
  }
}

function writeCounts(key: string, value: TrainingSignalStats) {
  localStorage.setItem(key, JSON.stringify(value));
}

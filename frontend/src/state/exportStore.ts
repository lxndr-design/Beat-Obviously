import { createStore as create } from "zustand/vanilla";
import type { BeatProjectAsset, BeatProjectIntegrityReport, ProjectExportJobStatus, ProjectExportOptions } from "../ipc/schema";

export type ExportPresetTarget = "project" | "range" | "track" | "stems";
export type ExportValidationState = "idle" | "checking" | "passed" | "warning" | "blocked" | "failed";

export interface ExportValidationStatus {
  state: ExportValidationState;
  message: string;
  errorCount: number;
  warningCount: number;
  missingAssetCount: number;
  checkedAt: number;
}

export interface ExportPreset {
  id: string;
  name: string;
  description: string;
  target: ExportPresetTarget;
  options: Required<ProjectExportOptions>;
  includeTail: boolean;
  userCreated?: boolean;
  updatedAt?: number;
}

interface ExportPresetOverride {
  options?: Required<ProjectExportOptions>;
  includeTail?: boolean;
}

const USER_EXPORT_PRESETS_KEY = "beat:user-export-presets:v1";
const EXPORT_PREFERENCES_KEY = "beat:export-preferences:v1";

export const FACTORY_EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "full-mix-review",
    name: "Full Mix Review",
    description: "Stereo WAV for normal mix review.",
    target: "project",
    options: { sampleRate: 48000, bitDepth: 24, channels: 2, blockSize: 512, quality: "standard" },
    includeTail: true,
  },
  {
    id: "review-range",
    name: "Review Range",
    description: "Loop/range export with effect tails.",
    target: "range",
    options: { sampleRate: 48000, bitDepth: 24, channels: 2, blockSize: 512, quality: "standard" },
    includeTail: true,
  },
  {
    id: "selected-stem",
    name: "Selected Stem",
    description: "Selected track stem at mix-session quality.",
    target: "track",
    options: { sampleRate: 48000, bitDepth: 24, channels: 2, blockSize: 512, quality: "standard" },
    includeTail: true,
  },
  {
    id: "all-stems",
    name: "All Stems",
    description: "One stem per renderable track.",
    target: "stems",
    options: { sampleRate: 48000, bitDepth: 24, channels: 2, blockSize: 512, quality: "standard" },
    includeTail: true,
  },
  {
    id: "web-draft",
    name: "Web Draft",
    description: "Compact PCM16 draft for quick sharing.",
    target: "project",
    options: { sampleRate: 44100, bitDepth: 16, channels: 2, blockSize: 512, quality: "standard" },
    includeTail: true,
  },
  {
    id: "mono-reference",
    name: "Mono Reference",
    description: "Mono compatibility reference render.",
    target: "project",
    options: { sampleRate: 48000, bitDepth: 24, channels: 1, blockSize: 512, quality: "standard" },
    includeTail: true,
  },
];

interface ExportState {
  job: ProjectExportJobStatus | null;
  selectedPresetId: string;
  userPresets: ExportPreset[];
  presetOverrides: Record<string, ExportPresetOverride>;
  recentDestinations: string[];
  exportDestinationFolder: string;
  validateBeforeExport: boolean;
  validation: ExportValidationStatus;
  updatedAt: number;
  setJob: (job: ProjectExportJobStatus) => void;
  setSelectedPresetId: (presetId: string) => void;
  saveUserPreset: (name: string, preset: ExportPreset) => string;
  updateUserPreset: (presetId: string, patch: Partial<Pick<ExportPreset, "options" | "includeTail" | "name" | "description">>) => void;
  updatePresetRenderSettings: (presetId: string, patch: Partial<Pick<ExportPreset, "options" | "includeTail">>) => void;
  deleteUserPreset: (presetId: string) => void;
  setExportDestinationFolder: (path: string) => void;
  setValidateBeforeExport: (enabled: boolean) => void;
  setValidation: (validation: ExportValidationStatus) => void;
  clearValidation: () => void;
  addRecentDestination: (path: string) => void;
  removeRecentDestination: (path: string) => void;
  clearRecentDestinations: () => void;
  clear: () => void;
}

export const IDLE_EXPORT_VALIDATION: ExportValidationStatus = {
  state: "idle",
  message: "Project has not been validated for export yet.",
  errorCount: 0,
  warningCount: 0,
  missingAssetCount: 0,
  checkedAt: 0,
};

interface ExportPreferencesRecord {
  presetOverrides: Record<string, ExportPresetOverride>;
  recentDestinations: string[];
  exportDestinationFolder: string;
  validateBeforeExport: boolean;
}

let cachedExportPreferences: ExportPreferencesRecord | null = null;

export const useExportStore = create<ExportState>((set) => ({
  job: null,
  selectedPresetId: "full-mix-review",
  userPresets: loadUserExportPresets(),
  presetOverrides: loadExportPreferences().presetOverrides,
  recentDestinations: loadExportPreferences().recentDestinations,
  exportDestinationFolder: loadExportPreferences().exportDestinationFolder,
  validateBeforeExport: loadExportPreferences().validateBeforeExport,
  validation: IDLE_EXPORT_VALIDATION,
  updatedAt: 0,
  setJob: (job) =>
    set((state) => {
      const recentDestinations = job.path
        ? normalizeRecentDestinations([job.path, ...state.recentDestinations])
        : state.recentDestinations;
      persistExportPreferences({
        presetOverrides: state.presetOverrides,
        recentDestinations,
        exportDestinationFolder: state.exportDestinationFolder,
        validateBeforeExport: state.validateBeforeExport,
      });
      return {
        job,
        recentDestinations,
        updatedAt: Date.now(),
      };
    }),
  setSelectedPresetId: (presetId) =>
    set((state) => ({
      selectedPresetId: exportPresetExists(presetId, state.userPresets) ? presetId : "full-mix-review",
      updatedAt: Date.now(),
    })),
  saveUserPreset: (name, preset) => {
    const cleanName = name.trim() || "Custom Export";
    const now = Date.now();
    const id = createUserExportPresetId(cleanName);
    set((state) => {
      const userPreset: ExportPreset = {
        id,
        name: cleanName,
        description: `${targetLabelForDescription(preset.target)} custom export preset.`,
        target: preset.target,
        options: normalizeExportOptions(preset.options),
        includeTail: Boolean(preset.includeTail),
        userCreated: true,
        updatedAt: now,
      };
      const userPresets = [userPreset, ...state.userPresets].slice(0, 24);
      persistUserExportPresets(userPresets);
      return {
        userPresets,
        selectedPresetId: id,
        updatedAt: now,
      };
    });
    return id;
  },
  updateUserPreset: (presetId, patch) =>
    set((state) => {
      const now = Date.now();
      const userPresets = state.userPresets.map((preset) => {
        if (preset.id !== presetId) return preset;
        return {
          ...preset,
          ...patch,
          options: patch.options ? normalizeExportOptions(patch.options) : preset.options,
          includeTail: patch.includeTail ?? preset.includeTail,
          updatedAt: now,
        };
      });
      persistUserExportPresets(userPresets);
      return { userPresets, updatedAt: now };
    }),
  updatePresetRenderSettings: (presetId, patch) =>
    set((state) => {
      const now = Date.now();
      const factoryPreset = FACTORY_EXPORT_PRESETS.find((preset) => preset.id === presetId);
      if (!factoryPreset) {
        const userPresets = state.userPresets.map((preset) => {
          if (preset.id !== presetId) return preset;
          return {
            ...preset,
            options: patch.options ? normalizeExportOptions(patch.options) : preset.options,
            includeTail: patch.includeTail ?? preset.includeTail,
            updatedAt: now,
          };
        });
        persistUserExportPresets(userPresets);
        return { userPresets, updatedAt: now };
      }

      const current = state.presetOverrides[presetId] ?? {};
      const nextOverrides = {
        ...state.presetOverrides,
        [presetId]: {
          options: patch.options ? normalizeExportOptions(patch.options) : current.options,
          includeTail: patch.includeTail ?? current.includeTail,
        },
      };
      persistExportPreferences({
        presetOverrides: nextOverrides,
        recentDestinations: state.recentDestinations,
        exportDestinationFolder: state.exportDestinationFolder,
        validateBeforeExport: state.validateBeforeExport,
      });
      return { presetOverrides: nextOverrides, updatedAt: now };
    }),
  deleteUserPreset: (presetId) =>
    set((state) => {
      const userPresets = state.userPresets.filter((preset) => preset.id !== presetId);
      persistUserExportPresets(userPresets);
      return {
        userPresets,
        selectedPresetId: state.selectedPresetId === presetId ? "full-mix-review" : state.selectedPresetId,
        updatedAt: Date.now(),
      };
    }),
  setValidateBeforeExport: (enabled) =>
    set((state) => {
      persistExportPreferences({
        presetOverrides: state.presetOverrides,
        recentDestinations: state.recentDestinations,
        exportDestinationFolder: state.exportDestinationFolder,
        validateBeforeExport: enabled,
      });
      return { validateBeforeExport: enabled, updatedAt: Date.now() };
    }),
  setExportDestinationFolder: (path) =>
    set((state) => {
      const exportDestinationFolder = path.trim();
      persistExportPreferences({
        presetOverrides: state.presetOverrides,
        recentDestinations: state.recentDestinations,
        exportDestinationFolder,
        validateBeforeExport: state.validateBeforeExport,
      });
      return { exportDestinationFolder, updatedAt: Date.now() };
    }),
  setValidation: (validation) => set({ validation, updatedAt: Date.now() }),
  clearValidation: () => set({ validation: IDLE_EXPORT_VALIDATION, updatedAt: Date.now() }),
  addRecentDestination: (path) =>
    set((state) => {
      const recentDestinations = normalizeRecentDestinations([path, ...state.recentDestinations]);
      if (recentDestinations.length === state.recentDestinations.length
        && recentDestinations.every((candidate, index) => candidate === state.recentDestinations[index])) {
        return { updatedAt: Date.now() };
      }
      persistExportPreferences({
        presetOverrides: state.presetOverrides,
        recentDestinations,
        exportDestinationFolder: state.exportDestinationFolder,
        validateBeforeExport: state.validateBeforeExport,
      });
      return {
        recentDestinations,
        updatedAt: Date.now(),
      };
    }),
  removeRecentDestination: (path) =>
    set((state) => {
      const recentDestinations = state.recentDestinations.filter((candidate) => candidate !== path);
      persistExportPreferences({
        presetOverrides: state.presetOverrides,
        recentDestinations,
        exportDestinationFolder: state.exportDestinationFolder,
        validateBeforeExport: state.validateBeforeExport,
      });
      return {
        recentDestinations,
        updatedAt: Date.now(),
      };
    }),
  clearRecentDestinations: () =>
    set((state) => {
      persistExportPreferences({
        presetOverrides: state.presetOverrides,
        recentDestinations: [],
        exportDestinationFolder: state.exportDestinationFolder,
        validateBeforeExport: state.validateBeforeExport,
      });
      return { recentDestinations: [], updatedAt: Date.now() };
    }),
  clear: () => set({ job: null, validation: IDLE_EXPORT_VALIDATION, updatedAt: Date.now() }),
}));

export function defaultExportPresetForTarget(target: ExportPresetTarget): ExportPreset {
  return FACTORY_EXPORT_PRESETS.find((preset) => preset.target === target) ?? FACTORY_EXPORT_PRESETS[0];
}

export function allExportPresets(userPresets = useExportStore.getState().userPresets): ExportPreset[] {
  return [...FACTORY_EXPORT_PRESETS, ...userPresets];
}

export function exportPresetById(id: string | undefined, fallbackTarget: ExportPresetTarget = "project"): ExportPreset {
  const state = useExportStore.getState();
  const preset = allExportPresets(state.userPresets).find((candidate) => candidate.id === id);
  return applyExportPresetOverride(preset?.target === fallbackTarget ? preset : defaultExportPresetForTarget(fallbackTarget), state.presetOverrides);
}

export function applyExportPresetOverride(preset: ExportPreset, overrides = useExportStore.getState().presetOverrides): ExportPreset {
  const override = overrides[preset.id];
  if (!override) return preset;
  return {
    ...preset,
    options: override.options ? normalizeExportOptions(override.options) : preset.options,
    includeTail: override.includeTail ?? preset.includeTail,
  };
}

export function normalizeExportOptions(options: ProjectExportOptions | undefined): Required<ProjectExportOptions> {
  const sampleRate = typeof options?.sampleRate === "number" && Number.isFinite(options.sampleRate)
    ? Math.round(options.sampleRate)
    : 48000;
  const blockSize = typeof options?.blockSize === "number" && Number.isFinite(options.blockSize)
    ? Math.round(options.blockSize)
    : 512;
  return {
    sampleRate: clampToSet(sampleRate, [44100, 48000, 88200, 96000, 192000], 48000),
    bitDepth: clampToSet(options?.bitDepth, [16, 24, 32], 24),
    channels: clampToSet(options?.channels, [1, 2], 2),
    blockSize: clampToSet(blockSize, [128, 256, 512, 1024, 2048], 512),
    quality: options?.quality === "high" ? "high" : "standard",
  };
}

export function recentExportFolder(paths: string[]): string | null {
  const path = paths.find((candidate) => candidate.trim());
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return null;
  return normalized.slice(0, lastSlash);
}

function clampToSet<T extends number>(value: number | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function exportPresetExists(presetId: string, userPresets: ExportPreset[]): boolean {
  return FACTORY_EXPORT_PRESETS.some((preset) => preset.id === presetId)
    || userPresets.some((preset) => preset.id === presetId);
}

function createUserExportPresetId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "custom";
  return `user-export:${slug}:${Date.now().toString(36)}`;
}

function targetLabelForDescription(target: ExportPresetTarget): string {
  if (target === "range") return "review range";
  if (target === "track") return "selected stem";
  if (target === "stems") return "all stems";
  return "full mix";
}

function loadUserExportPresets(): ExportPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(USER_EXPORT_PRESETS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeUserExportPreset)
      .filter((preset): preset is ExportPreset => Boolean(preset))
      .slice(0, 24);
  } catch {
    return [];
  }
}

function persistUserExportPresets(presets: ExportPreset[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(USER_EXPORT_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // Local preset storage is best-effort; export itself should not fail because storage is unavailable.
  }
}

function loadExportPreferences(): ExportPreferencesRecord {
  if (cachedExportPreferences) return cachedExportPreferences;
  const fallback: ExportPreferencesRecord = {
    presetOverrides: {},
    recentDestinations: [],
    exportDestinationFolder: "",
    validateBeforeExport: true,
  };
  if (typeof window === "undefined") {
    cachedExportPreferences = fallback;
    return fallback;
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(EXPORT_PREFERENCES_KEY) ?? "{}") as Partial<ExportPreferencesRecord>;
    cachedExportPreferences = {
      presetOverrides: normalizePresetOverrides(parsed.presetOverrides),
      recentDestinations: normalizeRecentDestinations(Array.isArray(parsed.recentDestinations) ? parsed.recentDestinations : []),
      exportDestinationFolder: typeof parsed.exportDestinationFolder === "string" ? parsed.exportDestinationFolder.trim() : "",
      validateBeforeExport: parsed.validateBeforeExport !== false,
    };
    return cachedExportPreferences;
  } catch {
    cachedExportPreferences = fallback;
    return fallback;
  }
}

function persistExportPreferences(preferences: ExportPreferencesRecord) {
  const normalized: ExportPreferencesRecord = {
    presetOverrides: normalizePresetOverrides(preferences.presetOverrides),
    recentDestinations: normalizeRecentDestinations(preferences.recentDestinations),
    exportDestinationFolder: preferences.exportDestinationFolder.trim(),
    validateBeforeExport: preferences.validateBeforeExport,
  };
  cachedExportPreferences = normalized;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EXPORT_PREFERENCES_KEY, JSON.stringify(normalized));
  } catch {
    // Export preference persistence is best-effort.
  }
}

function normalizePresetOverrides(value: unknown): Record<string, ExportPresetOverride> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, ExportPresetOverride> = {};
  for (const [presetId, override] of Object.entries(value as Record<string, unknown>)) {
    if (!presetId.trim() || !override || typeof override !== "object") continue;
    const record = override as Partial<ExportPresetOverride>;
    result[presetId] = {
      options: record.options ? normalizeExportOptions(record.options) : undefined,
      includeTail: typeof record.includeTail === "boolean" ? record.includeTail : undefined,
    };
  }
  return result;
}

function normalizeRecentDestinations(paths: readonly string[]): string[] {
  const result: string[] = [];
  for (const path of paths) {
    if (typeof path !== "string") continue;
    const cleanPath = path.trim();
    if (!cleanPath || result.includes(cleanPath)) continue;
    result.push(cleanPath);
    if (result.length >= 8) break;
  }
  return result;
}

function normalizeUserExportPreset(value: unknown): ExportPreset | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ExportPreset>;
  const target = record.target;
  if (target !== "project" && target !== "range" && target !== "track" && target !== "stems") return null;
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : "Custom Export";
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : createUserExportPresetId(name);
  return {
    id,
    name,
    description: typeof record.description === "string" && record.description.trim()
      ? record.description.trim()
      : `${targetLabelForDescription(target)} custom export preset.`,
    target,
    options: normalizeExportOptions(record.options),
    includeTail: Boolean(record.includeTail ?? true),
    userCreated: true,
    updatedAt: typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
  };
}

export function exportValidationStatusFromReport(
  report: BeatProjectIntegrityReport | null | undefined,
  missingAssets: BeatProjectAsset[] = [],
  now = Date.now(),
): ExportValidationStatus {
  const errorCount = Math.max(0, report?.errorCount ?? 0);
  const warningCount = Math.max(0, report?.warningCount ?? 0);
  const missingAssetCount = missingAssets.length;
  if (errorCount > 0 || missingAssetCount > 0) {
    return {
      state: "blocked",
      message: exportValidationMessage(errorCount, warningCount, missingAssetCount),
      errorCount,
      warningCount,
      missingAssetCount,
      checkedAt: now,
    };
  }
  if (warningCount > 0) {
    return {
      state: "warning",
      message: exportValidationMessage(errorCount, warningCount, missingAssetCount),
      errorCount,
      warningCount,
      missingAssetCount,
      checkedAt: now,
    };
  }
  return {
    state: "passed",
    message: "Project Health passed. Export can proceed.",
    errorCount,
    warningCount,
    missingAssetCount,
    checkedAt: now,
  };
}

export function failedExportValidationStatus(message: string, now = Date.now()): ExportValidationStatus {
  return {
    state: "failed",
    message,
    errorCount: 0,
    warningCount: 0,
    missingAssetCount: 0,
    checkedAt: now,
  };
}

export function exportValidationBlocksExport(status: ExportValidationStatus): boolean {
  return status.state === "blocked" || status.state === "failed";
}

function exportValidationMessage(errorCount: number, warningCount: number, missingAssetCount: number): string {
  const parts: string[] = [];
  if (errorCount > 0) parts.push(`${errorCount} integrity ${errorCount === 1 ? "error" : "errors"}`);
  if (missingAssetCount > 0) parts.push(`${missingAssetCount} missing ${missingAssetCount === 1 ? "asset" : "assets"}`);
  if (warningCount > 0) parts.push(`${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`);
  if (errorCount > 0 || missingAssetCount > 0) return `Project Health blocked export: ${parts.join(", ")}.`;
  return `Project Health found ${parts.join(", ")}. Export can proceed.`;
}

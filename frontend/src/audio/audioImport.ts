import { isNative, send } from "../ipc/bridge";
import type { AudioFile } from "../state/types";
import {
  isSupportedAudioFileName,
  SUPPORTED_AUDIO_IMPORT_EXTENSIONS,
  SUPPORTED_AUDIO_IMPORT_LABEL,
} from "./audioFormats";

export async function importAudioFile(pathHint?: string): Promise<AudioFile | null> {
  const resp = await send({ kind: "audio.import", pathHint });
  if (resp.file) return resp.file;
  if (isNative()) return null;
  const files = await importAudioFilesInBrowser(false);
  return files[0] ?? null;
}

export async function importAudioFiles(pathHint?: string): Promise<AudioFile[]> {
  if (isNative()) {
    const resp = await send({ kind: "audio.importMany", pathHint });
    return resp.files ?? [];
  }
  return importAudioFilesInBrowser(true);
}

function importAudioFilesInBrowser(multiple: boolean): Promise<AudioFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept = SUPPORTED_AUDIO_IMPORT_EXTENSIONS.join(",");
    input.style.display = "none";
    document.body.append(input);

    input.addEventListener("change", async () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      if (files.length === 0) {
        resolve([]);
        return;
      }
      const unsupported = files.find((file) => !isSupportedAudioFileName(file.name));
      if (unsupported) {
        window.alert(`Unsupported audio file. Supported formats: ${SUPPORTED_AUDIO_IMPORT_LABEL}.`);
        resolve([]);
        return;
      }

      resolve(await Promise.all(files.map(browserFileToAudioFile)));
    }, { once: true });

    input.click();
  });
}

export async function browserBlobToAudioFile(blob: Blob, name: string): Promise<AudioFile> {
  return browserFileToAudioFile(new File([blob], name, { type: blob.type || "audio/webm" }));
}

export async function browserFileToAudioFile(file: File): Promise<AudioFile> {
  const metadata = await readBrowserAudioMetadata(file);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    path: await fileToDataUrl(file),
    durationSeconds: metadata.durationSeconds,
    sampleRate: metadata.sampleRate,
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read audio file"));
    reader.readAsDataURL(file);
  });
}

async function readBrowserAudioMetadata(file: File) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new Ctor();
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    await ctx.close();
    return {
      durationSeconds: buffer.duration,
      sampleRate: buffer.sampleRate,
    };
  } catch {
    return {
      durationSeconds: 0,
      sampleRate: 0,
    };
  }
}

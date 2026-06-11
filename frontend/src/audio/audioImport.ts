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
    bitDepth: metadata.bitDepth,
    sizeBytes: file.size,
    importedAt: Date.now(),
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
    const arrayBuffer = await file.arrayBuffer();
    const bitDepth = parseWavBitDepth(arrayBuffer);
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    await ctx.close();
    return {
      durationSeconds: buffer.duration,
      sampleRate: buffer.sampleRate,
      bitDepth,
    };
  } catch {
    return {
      durationSeconds: 0,
      sampleRate: 0,
      bitDepth: undefined,
    };
  }
}

function parseWavBitDepth(buffer: ArrayBuffer) {
  if (buffer.byteLength < 44) return undefined;
  const view = new DataView(buffer);
  if (ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") return undefined;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = ascii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === "fmt " && offset + 16 <= view.byteLength) {
      const bits = view.getUint16(offset + 8 + 14, true);
      return bits > 0 ? bits : undefined;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return undefined;
}

function ascii(view: DataView, offset: number, length: number) {
  let value = "";
  for (let i = 0; i < length; i += 1) value += String.fromCharCode(view.getUint8(offset + i));
  return value;
}

import type { Instrument } from "../../state/types";
import { isLegacyAetherInstrument } from "../../state/instrumentAccess";

export type InstrumentEditorRequest =
  | { kind: "samplerInstrument"; instrumentId: string }
  | { kind: "synthInstrument"; instrumentId: string };

export function editorRequestForInstrument(instrument: Instrument): InstrumentEditorRequest | null {
  if (isLegacyAetherInstrument(instrument)) return null;
  if (instrument.kind === "synth" || instrument.kind === "wavetable") {
    return { kind: "synthInstrument", instrumentId: instrument.id };
  }
  return { kind: "samplerInstrument", instrumentId: instrument.id };
}

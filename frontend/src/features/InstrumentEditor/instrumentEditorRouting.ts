import type { Instrument } from "../../state/types";

export type InstrumentEditorRequest =
  | { kind: "samplerInstrument"; instrumentId: string }
  | { kind: "synthInstrument"; instrumentId: string };

export function editorRequestForInstrument(instrument: Instrument): InstrumentEditorRequest {
  if (instrument.kind === "synth" || instrument.kind === "wavetable") {
    return { kind: "synthInstrument", instrumentId: instrument.id };
  }
  return { kind: "samplerInstrument", instrumentId: instrument.id };
}

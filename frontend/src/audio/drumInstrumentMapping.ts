import type { Instrument } from "../state/types";

export function drumLaneDescription(pitch: number) {
  if (pitch === 35 || pitch === 36) return { name: "Kick", terms: ["kick", "bass drum"] };
  if (pitch === 37) return { name: "Rim", terms: ["rim", "side stick"] };
  if (pitch === 38 || pitch === 40) return { name: "Snare", terms: ["snare"] };
  if (pitch === 39) return { name: "Clap", terms: ["clap"] };
  if (pitch === 42 || pitch === 44) return { name: "Closed Hat", terms: ["closed hat", "hihat closed"] };
  if (pitch === 46) return { name: "Open Hat", terms: ["open hat", "hihat open"] };
  if (pitch === 49 || pitch === 55 || pitch === 57) return { name: "Crash", terms: ["crash"] };
  if (pitch === 51 || pitch === 53 || pitch === 59) return { name: "Ride", terms: ["ride"] };
  if (pitch >= 41 && pitch <= 50) return { name: "Tom", terms: ["tom"] };
  return { name: `Percussion ${pitch}`, terms: ["perc", "triangle"] };
}

export function findDrumInstrument(pitch: number, instruments: Instrument[]) {
  const descriptor = drumLaneDescription(pitch);
  return instruments.find((instrument) => {
    const haystack = [instrument.name, ...(instrument.descriptors ?? [])].join(" ").toLowerCase();
    return descriptor.terms.some((term) => haystack.includes(term));
  });
}

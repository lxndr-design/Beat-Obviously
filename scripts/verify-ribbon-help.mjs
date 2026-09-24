import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const failures = [];

function requireText(relativePath, snippets) {
  const source = read(relativePath);
  for (const snippet of snippets) {
    if (!source.includes(snippet)) failures.push(`${relativePath} is missing ${JSON.stringify(snippet)}`);
  }
}

requireText("frontend/src/solid-ui/RibbonHelp/RibbonHelp.solid.tsx", [
  'aria-haspopup="dialog"',
  "aria-expanded={open()}",
  'event.key === "Escape"',
  "Next",
  "Back",
  "window.addEventListener(\"mousedown\"",
  "window.addEventListener(\"scroll\", updatePosition, true)",
]);

requireText("frontend/src/solid-ui/SectionRibbon/SectionRibbon.solid.tsx", [
  "help?: RibbonHelpPage[]",
  "<RibbonHelp",
  "<span class={styles.labelText}>{local.title}</span>",
]);

const integrations = new Map([
  ["frontend/src/App.solid.tsx", "RIBBON_HELP.tracks"],
  ["frontend/src/features/HomeHub/HomeHub.solid.tsx", "RIBBON_HELP.projects"],
  ["frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.solid.tsx", "RIBBON_HELP.instruments"],
  ["frontend/src/features/AudioFiles/AudioFileLibraryPanel.solid.tsx", "RIBBON_HELP.audioFiles"],
  ["frontend/src/features/Mixer/MixerPanel.solid.tsx", "RIBBON_HELP.mixer"],
  ["frontend/src/features/AudioBusPanel/AudioBusPanel.solid.tsx", "RIBBON_HELP.busInserts"],
  ["frontend/src/features/TrackEffects/TrackEffectsPanel.solid.tsx", "RIBBON_HELP.trackEffects"],
  ["frontend/src/features/Eq/MasterEqPanel.solid.tsx", "RIBBON_HELP.mastering"],
  ["frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx", "RIBBON_HELP.arpeggiator"],
]);

for (const [relativePath, snippet] of integrations) requireText(relativePath, [snippet]);

if (failures.length > 0) {
  console.error(`Ribbon help verification failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Ribbon help verification passed.");

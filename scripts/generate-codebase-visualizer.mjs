#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const outputHtml = path.join(root, "docs/codebase-visualizer.html");
const outputJson = path.join(root, "docs/codebase-visualizer-data.json");
const outputMd = path.join(root, "docs/codebase-visualizer.md");
const connectorImageName = "codebase-connectors-current.png";

const scanRoots = [
  "frontend/src",
  "backend/Source",
  "scripts",
];

const sourceExtensions = new Set([".ts", ".tsx", ".cpp", ".h", ".mjs"]);
const tsExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const cppExtensions = [".h", ".cpp"];

const componentOrder = [
  "Native App Shell",
  "Solid App Shell",
  "Navigation + Top Bar",
  "Editor Host",
  "Design System",
  "Home + Project Health",
  "Arrangement Surface",
  "MIDI + Drum Editing",
  "Synth / Aether Editor",
  "Nodemap Editor",
  "Mixer / Export / Visualizer",
  "Asset Libraries + Plugins",
  "AI + Training Generation",
  "Browser Audio Runtime",
  "Frontend State Stores",
  "Frontend Persistence",
  "Frontend IPC",
  "Native IPC",
  "Backend Audio Engine",
  "Aether / Wavetable DSP",
  "Audio FX + Mastering",
  "Sampler + DecentSampler",
  "Recording",
  "Rendering + Bounce",
  "Audio Analysis",
  "Project Persistence + SQLite",
  "Verification Scripts",
  "Utilities + Test Hooks",
];

const runtimeEdges = [
  ["Native App Shell", "Solid App Shell", "runtime host", "JUCE MainComponent hosts the web UI."],
  ["Solid App Shell", "Navigation + Top Bar", "runtime render", "App shell renders navigation and command surfaces."],
  ["Solid App Shell", "Editor Host", "runtime render", "App shell routes the active editor surface."],
  ["Solid App Shell", "Home + Project Health", "runtime render", "Startup/home/project health surfaces attach to the shell."],
  ["Editor Host", "Arrangement Surface", "runtime route", "Arrangement is one of the primary editor surfaces."],
  ["Editor Host", "MIDI + Drum Editing", "runtime route", "MIDI and drum editing are editor surfaces."],
  ["Editor Host", "Synth / Aether Editor", "runtime route", "Aether synth editing is an editor surface."],
  ["Editor Host", "Nodemap Editor", "runtime route", "Nodemap is an editor surface."],
  ["Editor Host", "Mixer / Export / Visualizer", "runtime route", "Mixer, export, and visualizer are editor/modal surfaces."],
  ["Navigation + Top Bar", "Asset Libraries + Plugins", "runtime route", "Rail and menu actions expose library panes."],
  ["Arrangement Surface", "Frontend State Stores", "state", "Tracks, lanes, segments, transport, and selection use project state."],
  ["MIDI + Drum Editing", "Frontend State Stores", "state", "MIDI/drum edits update the project/component state."],
  ["Synth / Aether Editor", "Frontend State Stores", "state", "Synth controls update instrument and synth stores."],
  ["Nodemap Editor", "Frontend State Stores", "state", "Nodemap graphs are stored with instrument state."],
  ["Asset Libraries + Plugins", "Frontend State Stores", "state", "Libraries mutate instruments, audio assets, components, and plugins."],
  ["Frontend State Stores", "Frontend Persistence", "serialize", "Project and asset state serialize through the Beat document layer."],
  ["Frontend Persistence", "Frontend IPC", "native request", "Document actions and native-backed persistence cross the bridge."],
  ["Browser Audio Runtime", "Frontend IPC", "native request", "Browser preview and analysis call native-backed services when available."],
  ["Frontend IPC", "Native IPC", "IPC boundary", "TypeScript bridge sends requests into MessageBridge."],
  ["Native IPC", "Backend Audio Engine", "command", "MessageBridge forwards audio/session commands to AudioEngine."],
  ["Native IPC", "Project Persistence + SQLite", "command", "MessageBridge forwards project and repository commands."],
  ["Native IPC", "Sampler + DecentSampler", "command", "MessageBridge exposes DS import/parse flows."],
  ["Native IPC", "Recording", "command", "MessageBridge exposes recording device/session commands."],
  ["Native IPC", "Rendering + Bounce", "command", "MessageBridge exposes render/export commands."],
  ["Native IPC", "Audio Analysis", "command", "MessageBridge exposes waveform/FFT analysis."],
  ["Backend Audio Engine", "Aether / Wavetable DSP", "audio render", "Instrument voices render Aether/wavetable oscillators."],
  ["Backend Audio Engine", "Audio FX + Mastering", "audio render", "Track effects, master EQ, and limiter sit on the render path."],
  ["Backend Audio Engine", "Sampler + DecentSampler", "audio render", "Sampler instruments play parsed DecentSampler/sample zones."],
  ["Rendering + Bounce", "Backend Audio Engine", "offline render", "Bounce/export renders through the engine path."],
  ["Recording", "Backend Audio Engine", "capture", "Recording capture and planner coordinate with audio device timing."],
  ["Project Persistence + SQLite", "Frontend Persistence", "roundtrip", "Native project rows preserve frontend Beat documents."],
  ["Verification Scripts", "Design System", "verify", "Design-system verifier checks shared UI primitives and tokens."],
  ["Verification Scripts", "Frontend Persistence", "verify", "Document verifier checks save/open roundtrips."],
  ["Verification Scripts", "Nodemap Editor", "verify", "Nodemap verifier checks graph editor behavior."],
  ["Verification Scripts", "Arrangement Surface", "verify", "Track interaction verifier covers drag, resize, drops, and selection."],
  ["Verification Scripts", "Backend Audio Engine", "verify", "Native stress exercises audio/backend behavior."],
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "build" || entry.name === "build-native") {
        continue;
      }
      files.push(...walk(fullPath));
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function rel(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function componentFor(relativeFile) {
  if (relativeFile.startsWith("scripts/")) return "Verification Scripts";
  if (relativeFile.startsWith("backend/Source/Ipc/")) return "Native IPC";
  if (relativeFile === "backend/Source/Main.cpp" || relativeFile.startsWith("backend/Source/MainComponent")) return "Native App Shell";
  if (relativeFile.startsWith("backend/Source/Persistence/")) return "Project Persistence + SQLite";
  if (relativeFile.startsWith("backend/Source/Audio/Analysis/")) return "Audio Analysis";
  if (relativeFile.startsWith("backend/Source/Audio/Recording/")) return "Recording";
  if (relativeFile.startsWith("backend/Source/Audio/Rendering/")) return "Rendering + Bounce";
  if (relativeFile.startsWith("backend/Source/Audio/Sampler/")) return "Sampler + DecentSampler";
  if (relativeFile.startsWith("backend/Source/Audio/Effects/")) return "Audio FX + Mastering";
  if (
    relativeFile.startsWith("backend/Source/Audio/Wavetable/") ||
    relativeFile.startsWith("backend/Source/Audio/Oscillator/") ||
    relativeFile.startsWith("backend/Source/Audio/Envelope/") ||
    relativeFile.startsWith("backend/Source/Audio/Filter/") ||
    relativeFile.startsWith("backend/Source/Audio/Modulation/") ||
    relativeFile.startsWith("backend/Source/Audio/Parameters/") ||
    relativeFile.startsWith("backend/Source/Audio/Realtime/")
  ) {
    return "Aether / Wavetable DSP";
  }
  if (relativeFile.startsWith("backend/Source/Audio/")) return "Backend Audio Engine";

  if (relativeFile === "frontend/src/main.solid.tsx" || relativeFile === "frontend/src/App.solid.tsx") return "Solid App Shell";
  if (relativeFile.startsWith("frontend/src/solid-ui/") || relativeFile.startsWith("frontend/src/design/")) return "Design System";
  if (relativeFile.startsWith("frontend/src/features/EditorHost/")) return "Editor Host";
  if (relativeFile.startsWith("frontend/src/features/Sidebar/") || relativeFile.startsWith("frontend/src/features/TopBar/")) return "Navigation + Top Bar";
  if (
    relativeFile.startsWith("frontend/src/features/HomeHub/") ||
    relativeFile.startsWith("frontend/src/features/ProjectHealth/") ||
    relativeFile.startsWith("frontend/src/features/Startup/") ||
    relativeFile.startsWith("frontend/src/features/Preferences/")
  ) {
    return "Home + Project Health";
  }
  if (
    relativeFile.startsWith("frontend/src/features/Tracks/") ||
    relativeFile.startsWith("frontend/src/features/TrackDetails/") ||
    relativeFile.startsWith("frontend/src/features/SegmentEditor/") ||
    relativeFile.startsWith("frontend/src/features/TrackEffects/") ||
    relativeFile.startsWith("frontend/src/features/Transport/")
  ) {
    return "Arrangement Surface";
  }
  if (
    relativeFile.startsWith("frontend/src/features/MidiEditor/") ||
    relativeFile.startsWith("frontend/src/features/DrumEditor/") ||
    relativeFile.startsWith("frontend/src/features/ComponentLibrary/")
  ) {
    return "MIDI + Drum Editing";
  }
  if (
    relativeFile.startsWith("frontend/src/features/Synth/") ||
    relativeFile.startsWith("frontend/src/features/InstrumentEditor/") ||
    relativeFile.startsWith("frontend/src/features/Eq/") ||
    relativeFile.startsWith("frontend/src/features/EqAutomation/") ||
    relativeFile.startsWith("frontend/src/automation/")
  ) {
    return "Synth / Aether Editor";
  }
  if (relativeFile.startsWith("frontend/src/features/NodeInstrumentEditor/")) return "Nodemap Editor";
  if (
    relativeFile.startsWith("frontend/src/features/Mixer/") ||
    relativeFile.startsWith("frontend/src/features/ExportReview/") ||
    relativeFile.startsWith("frontend/src/features/Visualizer/") ||
    relativeFile.startsWith("frontend/src/features/Debug/")
  ) {
    return "Mixer / Export / Visualizer";
  }
  if (
    relativeFile.startsWith("frontend/src/features/AudioFiles/") ||
    relativeFile.startsWith("frontend/src/features/InstrumentLibrary/") ||
    relativeFile.startsWith("frontend/src/features/PluginLibrary/")
  ) {
    return "Asset Libraries + Plugins";
  }
  if (relativeFile.startsWith("frontend/src/ai/") || relativeFile.startsWith("frontend/src/features/Training/")) return "AI + Training Generation";
  if (relativeFile.startsWith("frontend/src/audio/")) return "Browser Audio Runtime";
  if (relativeFile.startsWith("frontend/src/state/")) return "Frontend State Stores";
  if (relativeFile.startsWith("frontend/src/persistence/")) return "Frontend Persistence";
  if (relativeFile.startsWith("frontend/src/ipc/")) return "Frontend IPC";
  return "Utilities + Test Hooks";
}

function layerFor(component) {
  if (component === "Native App Shell") return "1. Native shell";
  if (["Solid App Shell", "Navigation + Top Bar", "Editor Host", "Design System", "Home + Project Health"].includes(component)) {
    return "2. Solid shell";
  }
  if ([
    "Arrangement Surface",
    "MIDI + Drum Editing",
    "Synth / Aether Editor",
    "Nodemap Editor",
    "Mixer / Export / Visualizer",
    "Asset Libraries + Plugins",
    "AI + Training Generation",
    "Browser Audio Runtime",
  ].includes(component)) {
    return "3. Feature surfaces";
  }
  if (["Frontend State Stores", "Frontend Persistence", "Frontend IPC"].includes(component)) return "4. Frontend data + IPC";
  if ([
    "Native IPC",
    "Backend Audio Engine",
    "Aether / Wavetable DSP",
    "Audio FX + Mastering",
    "Sampler + DecentSampler",
    "Recording",
    "Rendering + Bounce",
    "Audio Analysis",
    "Project Persistence + SQLite",
  ].includes(component)) {
    return "5. Native backend";
  }
  return "6. Verification + utilities";
}

function resolveLocalImport(fromFile, specifier, extensions) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [];
  if (sourceExtensions.has(path.extname(base))) {
    candidates.push(base);
  } else {
    for (const ext of extensions) candidates.push(`${base}${ext}`);
    for (const ext of extensions) candidates.push(path.join(base, `index${ext}`));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function importsFor(file) {
  const text = fs.readFileSync(file, "utf8");
  const ext = path.extname(file);
  const imports = [];
  if (ext === ".ts" || ext === ".tsx" || ext === ".mjs") {
    const patterns = [
      /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
      /import\(\s*["']([^"']+)["']\s*\)/g,
    ];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const resolved = resolveLocalImport(file, match[1], tsExtensions);
        if (resolved) imports.push(resolved);
      }
    }
  } else if (ext === ".cpp" || ext === ".h") {
    const includePattern = /^\s*#include\s+"([^"]+)"/gm;
    for (const match of text.matchAll(includePattern)) {
      const resolved = resolveLocalImport(file, match[1], cppExtensions);
      if (resolved) imports.push(resolved);
    }
  }
  return imports;
}

function edgeKey(from, to, kind) {
  return `${from}-->${to}::${kind}`;
}

const files = scanRoots.flatMap((dir) => walk(path.join(root, dir))).sort();
const knownFiles = new Set(files.map((file) => path.resolve(file)));
const components = new Map();
const edges = new Map();

for (const file of files) {
  const relativeFile = rel(file);
  const component = componentFor(relativeFile);
  if (!components.has(component)) {
    components.set(component, {
      id: component,
      label: component,
      layer: layerFor(component),
      files: [],
      importsOut: 0,
      importsIn: 0,
    });
  }
  components.get(component).files.push(relativeFile);

  for (const imported of importsFor(file)) {
    if (!knownFiles.has(path.resolve(imported))) continue;
    const targetRelative = rel(imported);
    const targetComponent = componentFor(targetRelative);
    if (targetComponent === component) continue;
    const kind = file.endsWith(".cpp") || file.endsWith(".h") ? "static include" : "static import";
    const key = edgeKey(component, targetComponent, kind);
    if (!edges.has(key)) {
      edges.set(key, {
        from: component,
        to: targetComponent,
        kind,
        count: 0,
        examples: [],
      });
    }
    const edge = edges.get(key);
    edge.count += 1;
    if (edge.examples.length < 8) edge.examples.push(`${relativeFile} -> ${targetRelative}`);
  }
}

for (const [from, to, kind, description] of runtimeEdges) {
  if (!components.has(from)) {
    components.set(from, { id: from, label: from, layer: layerFor(from), files: [], importsOut: 0, importsIn: 0 });
  }
  if (!components.has(to)) {
    components.set(to, { id: to, label: to, layer: layerFor(to), files: [], importsOut: 0, importsIn: 0 });
  }
  const key = edgeKey(from, to, kind);
  if (!edges.has(key)) {
    edges.set(key, { from, to, kind, count: 1, examples: [description] });
  }
}

for (const edge of edges.values()) {
  components.get(edge.from).importsOut += edge.count;
  components.get(edge.to).importsIn += edge.count;
}

const orderedComponents = [...components.values()].sort((a, b) => {
  const layerCompare = a.layer.localeCompare(b.layer);
  if (layerCompare !== 0) return layerCompare;
  return componentOrder.indexOf(a.id) - componentOrder.indexOf(b.id);
});

const orderedEdges = [...edges.values()].sort((a, b) => {
  const aOrder = componentOrder.indexOf(a.from) * 100 + componentOrder.indexOf(a.to);
  const bOrder = componentOrder.indexOf(b.from) * 100 + componentOrder.indexOf(b.to);
  return aOrder - bOrder || b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to);
});

const data = {
  generatedAt: new Date().toISOString(),
  root: path.basename(root),
  sourceRoots: scanRoots,
  totals: {
    files: files.length,
    components: orderedComponents.length,
    edges: orderedEdges.length,
    staticEdges: orderedEdges.filter((edge) => edge.kind.startsWith("static")).length,
    runtimeEdges: orderedEdges.filter((edge) => !edge.kind.startsWith("static")).length,
  },
  components: orderedComponents,
  edges: orderedEdges,
};

fs.mkdirSync(path.dirname(outputHtml), { recursive: true });
fs.writeFileSync(outputJson, `${JSON.stringify(data, null, 2)}\n`);
fs.writeFileSync(outputHtml, renderHtml(data));
fs.writeFileSync(outputMd, renderMarkdown(data));

console.log(`Wrote ${rel(outputHtml)}`);
console.log(`Wrote ${rel(outputJson)}`);
console.log(`Wrote ${rel(outputMd)}`);

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function mermaidId(value) {
  return `n_${slug(value).replace(/-/g, "_")}`;
}

function renderMarkdown(model) {
  const lines = [
    "# Beat Codebase Visualizer",
    "",
    "This file is generated by `scripts/generate-codebase-visualizer.mjs` from current TypeScript imports, C++ includes, and a small set of named runtime-boundary edges. Regenerate it after major structure changes.",
    "",
    "- Interactive visualizer: [codebase-visualizer.html](./codebase-visualizer.html)",
    "- Machine-readable data: [codebase-visualizer-data.json](./codebase-visualizer-data.json)",
    `- Generated overview image: [${connectorImageName}](./${connectorImageName})`,
    "",
    `![Beat Codebase Connectors - Current Build](./${connectorImageName})`,
    "",
    "```mermaid",
    "flowchart TB",
  ];
  for (const layer of [...new Set(model.components.map((node) => node.layer))]) {
    lines.push(`  subgraph ${mermaidId(layer)}["${layer}"]`);
    for (const node of model.components.filter((candidate) => candidate.layer === layer)) {
      lines.push(`    ${mermaidId(node.id)}["${node.label}<br/>${node.files.length} files"]`);
    }
    lines.push("  end");
    lines.push("");
  }
  for (const edge of model.edges.filter((item) => item.kind !== "static include" || item.count > 1)) {
    const label = edge.kind.startsWith("static") ? `${edge.kind}: ${edge.count}` : edge.kind;
    lines.push(`  ${mermaidId(edge.from)} -->|"${label}"| ${mermaidId(edge.to)}`);
  }
  lines.push("```", "");
  lines.push("## Component Summary", "");
  lines.push("| Component | Layer | Files | Incoming | Outgoing |");
  lines.push("| --- | --- | ---: | ---: | ---: |");
  for (const node of model.components) {
    lines.push(`| ${node.label} | ${node.layer} | ${node.files.length} | ${node.importsIn} | ${node.importsOut} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderHtml(model) {
  const dataJson = JSON.stringify(model).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Beat Codebase Visualizer</title>
  <style>
    :root {
      --bg: #000;
      --fg: #f4f4f4;
      --muted: #a8a8a8;
      --soft: rgba(255, 255, 255, 0.28);
      --softer: rgba(255, 255, 255, 0.14);
      --panel: #080808;
      --hover: rgba(255, 255, 255, 0.08);
      font-family: Akzidenz, "Akzidenz Grotesk Next", Helvetica, Arial, sans-serif;
      color: var(--fg);
      background: var(--bg);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: var(--bg); }
    body { display: grid; grid-template-rows: auto 1fr; }
    header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: end;
      padding: 18px 20px 14px;
      border-bottom: 1px solid var(--soft);
      background: #000;
    }
    h1 { margin: 0; font-size: 22px; line-height: 1; letter-spacing: 0; }
    .subtitle { margin-top: 7px; color: var(--muted); font-size: 12px; }
    .stats { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .tag { padding: 3px 6px; border-radius: 3px; background: rgba(255,255,255,0.34); color: #050505; font-size: 11px; line-height: 1; }
    main { display: grid; grid-template-columns: 300px minmax(680px, 1fr) 360px; min-height: 0; }
    aside, .detail {
      min-height: calc(100vh - 67px);
      border-right: 1px solid var(--soft);
      background: var(--panel);
      overflow: auto;
    }
    .detail { border-right: 0; border-left: 1px solid var(--soft); }
    .panel { padding: 14px; border-bottom: 1px solid var(--softer); }
    .panel h2 { margin: 0 0 10px; font-size: 12px; line-height: 1; }
    input, select {
      width: 100%;
      appearance: none;
      border: 1px solid var(--soft);
      background: #000;
      color: var(--fg);
      padding: 8px;
      font: inherit;
      font-size: 12px;
      border-radius: 0;
    }
    label { display: block; color: var(--muted); font-size: 11px; margin-bottom: 6px; }
    .checks { display: grid; gap: 8px; }
    .checks label { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--fg); }
    .checks input { width: auto; }
    .nodeList { display: grid; }
    .nodeRow {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--softer);
      cursor: pointer;
      background: #000;
    }
    .nodeRow:hover, .nodeRow.active { background: var(--hover); }
    .nodeRow strong { font-size: 12px; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .nodeRow span { color: var(--muted); font-size: 11px; }
    .canvasWrap { position: relative; overflow: auto; background: #000; }
    .canvas {
      position: relative;
      min-width: 1280px;
      min-height: 980px;
      background-image:
        linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px);
      background-size: 36px 36px;
    }
    svg.edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    .layerLabel {
      position: absolute;
      left: 20px;
      width: 150px;
      padding: 9px 10px;
      border: 1px solid var(--soft);
      color: var(--muted);
      font-size: 12px;
      background: rgba(0,0,0,0.82);
    }
    .node {
      position: absolute;
      width: 190px;
      min-height: 78px;
      border: 1px solid var(--soft);
      background: rgba(0,0,0,0.9);
      padding: 10px;
      cursor: pointer;
    }
    .node:hover, .node.active { background: var(--hover); border-color: rgba(255,255,255,0.58); }
    .node h3 { margin: 0 0 8px; font-size: 12px; line-height: 1.16; }
    .nodeMeta { display: flex; gap: 5px; flex-wrap: wrap; }
    .miniTag { padding: 2px 4px; border-radius: 3px; color: #050505; background: rgba(255,255,255,0.42); font-size: 10px; line-height: 1; }
    .detail h2 { margin: 0; font-size: 13px; }
    .detail .muted { color: var(--muted); font-size: 12px; margin-top: 5px; }
    .list { margin: 10px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
    .list li { color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
    .edgeTable { width: 100%; border-collapse: collapse; font-size: 11px; }
    .edgeTable td { padding: 6px 0; border-bottom: 1px solid var(--softer); vertical-align: top; }
    .edgeTable td:first-child { color: var(--fg); width: 58%; }
    .edgeTable td:last-child { color: var(--muted); text-align: right; }
    .empty { color: var(--muted); font-size: 12px; padding: 14px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Beat Codebase Visualizer</h1>
      <div class="subtitle">Generated from current TS imports, C++ includes, and named runtime-boundary edges. Generated ${model.generatedAt}</div>
    </div>
    <div class="stats">
      <span class="tag">${model.totals.files} files</span>
      <span class="tag">${model.totals.components} components</span>
      <span class="tag">${model.totals.staticEdges} static connectors</span>
      <span class="tag">${model.totals.runtimeEdges} runtime connectors</span>
    </div>
  </header>
  <main>
    <aside>
      <div class="panel">
        <label for="search">Filter components</label>
        <input id="search" type="search" placeholder="tracks, nodemap, ipc..." />
      </div>
      <div class="panel">
        <h2>Connectors</h2>
        <div class="checks">
          <label><input id="showStatic" type="checkbox" checked /> Static imports/includes</label>
          <label><input id="showRuntime" type="checkbox" checked /> Runtime/data-flow edges</label>
        </div>
      </div>
      <div class="nodeList" id="nodeList"></div>
    </aside>
    <section class="canvasWrap">
      <div class="canvas" id="canvas">
        <svg class="edges" id="edges"></svg>
      </div>
    </section>
    <section class="detail">
      <div class="panel" id="detailPanel">
        <h2>Select a component</h2>
        <div class="muted">Click a box or row to inspect files and connectors.</div>
      </div>
      <div class="panel">
        <h2>Connector Evidence</h2>
        <table class="edgeTable" id="edgeTable"></table>
      </div>
    </section>
  </main>
  <script id="codebase-data" type="application/json">${dataJson}</script>
  <script>
    const model = JSON.parse(document.getElementById("codebase-data").textContent);
    const canvas = document.getElementById("canvas");
    const svg = document.getElementById("edges");
    const nodeList = document.getElementById("nodeList");
    const detailPanel = document.getElementById("detailPanel");
    const edgeTable = document.getElementById("edgeTable");
    const search = document.getElementById("search");
    const showStatic = document.getElementById("showStatic");
    const showRuntime = document.getElementById("showRuntime");
    let selected = model.components[0]?.id ?? null;

    const layers = [...new Set(model.components.map((node) => node.layer))];
    const byLayer = new Map(layers.map((layer) => [layer, model.components.filter((node) => node.layer === layer)]));

    function idFor(value) {
      return "node-" + value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }

    function filteredNodes() {
      const query = search.value.trim().toLowerCase();
      if (!query) return model.components;
      return model.components.filter((node) => {
        return node.label.toLowerCase().includes(query) || node.layer.toLowerCase().includes(query) || node.files.some((file) => file.toLowerCase().includes(query));
      });
    }

    function visibleEdges() {
      const visibleIds = new Set(filteredNodes().map((node) => node.id));
      return model.edges.filter((edge) => {
        if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) return false;
        const isStatic = edge.kind.startsWith("static");
        return (isStatic && showStatic.checked) || (!isStatic && showRuntime.checked);
      });
    }

    function renderGraph() {
      canvas.querySelectorAll(".node,.layerLabel").forEach((item) => item.remove());
      const visible = new Set(filteredNodes().map((node) => node.id));
      const rowHeight = 150;
      const xStart = 205;
      const xGap = 215;
      let maxWidth = 1280;
      layers.forEach((layer, layerIndex) => {
        const y = 32 + layerIndex * rowHeight;
        const label = document.createElement("div");
        label.className = "layerLabel";
        label.style.top = y + "px";
        label.textContent = layer;
        canvas.appendChild(label);

        const nodes = (byLayer.get(layer) ?? []).filter((node) => visible.has(node.id));
        nodes.forEach((node, nodeIndex) => {
          const element = document.createElement("button");
          element.className = "node" + (selected === node.id ? " active" : "");
          element.id = idFor(node.id);
          element.style.left = (xStart + nodeIndex * xGap) + "px";
          element.style.top = y + "px";
          element.innerHTML = \`<h3>\${escapeHtml(node.label)}</h3><div class="nodeMeta"><span class="miniTag">\${node.files.length} files</span><span class="miniTag">\${node.importsIn} in</span><span class="miniTag">\${node.importsOut} out</span></div>\`;
          element.addEventListener("click", () => selectNode(node.id));
          canvas.appendChild(element);
          maxWidth = Math.max(maxWidth, xStart + nodeIndex * xGap + 240);
        });
      });
      canvas.style.minWidth = maxWidth + "px";
      canvas.style.minHeight = (layers.length * rowHeight + 90) + "px";
      requestAnimationFrame(renderEdges);
    }

    function renderEdges() {
      svg.setAttribute("viewBox", \`0 0 \${canvas.scrollWidth} \${canvas.scrollHeight}\`);
      svg.innerHTML = "";
      for (const edge of visibleEdges()) {
        const from = document.getElementById(idFor(edge.from));
        const to = document.getElementById(idFor(edge.to));
        if (!from || !to) continue;
        const a = center(from);
        const b = center(to);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const midY = (a.y + b.y) / 2;
        path.setAttribute("d", \`M \${a.x} \${a.y} C \${a.x} \${midY}, \${b.x} \${midY}, \${b.x} \${b.y}\`);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", edge.kind.startsWith("static") ? "rgba(255,255,255,0.30)" : "rgba(255,255,255,0.62)");
        path.setAttribute("stroke-width", selected && (edge.from === selected || edge.to === selected) ? "2.25" : "1");
        path.setAttribute("stroke-dasharray", edge.kind.startsWith("static") ? "0" : "7 7");
        svg.appendChild(path);
      }
    }

    function center(element) {
      return {
        x: element.offsetLeft + element.offsetWidth / 2,
        y: element.offsetTop + element.offsetHeight / 2,
      };
    }

    function renderList() {
      const nodes = filteredNodes();
      nodeList.innerHTML = nodes.length ? "" : '<div class="empty">No matching components.</div>';
      for (const node of nodes) {
        const row = document.createElement("button");
        row.className = "nodeRow" + (selected === node.id ? " active" : "");
        row.innerHTML = \`<strong>\${escapeHtml(node.label)}</strong><span>\${node.files.length}</span><span>\${escapeHtml(node.layer)}</span><span>\${node.importsIn} in / \${node.importsOut} out</span>\`;
        row.addEventListener("click", () => selectNode(node.id));
        nodeList.appendChild(row);
      }
    }

    function renderDetail() {
      const node = model.components.find((candidate) => candidate.id === selected);
      if (!node) return;
      const connected = model.edges.filter((edge) => edge.from === node.id || edge.to === node.id);
      detailPanel.innerHTML = \`
        <h2>\${escapeHtml(node.label)}</h2>
        <div class="muted">\${escapeHtml(node.layer)} · \${node.files.length} files · \${node.importsIn} incoming · \${node.importsOut} outgoing</div>
        <ul class="list">\${node.files.slice(0, 28).map((file) => \`<li>\${escapeHtml(file)}</li>\`).join("")}\${node.files.length > 28 ? \`<li>+\${node.files.length - 28} more</li>\` : ""}</ul>
      \`;
      edgeTable.innerHTML = connected.length ? "" : '<tr><td>No connectors</td><td></td></tr>';
      for (const edge of connected) {
        const row = document.createElement("tr");
        const direction = edge.from === node.id ? "to " + edge.to : "from " + edge.from;
        row.innerHTML = \`<td>\${escapeHtml(direction)}<br><span class="muted">\${escapeHtml(edge.examples[0] ?? "")}</span></td><td>\${escapeHtml(edge.kind)}<br>\${edge.count}</td>\`;
        edgeTable.appendChild(row);
      }
    }

    function selectNode(id) {
      selected = id;
      renderList();
      renderGraph();
      renderDetail();
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }

    search.addEventListener("input", () => { renderList(); renderGraph(); renderDetail(); });
    showStatic.addEventListener("change", renderGraph);
    showRuntime.addEventListener("change", renderGraph);
    window.addEventListener("resize", renderEdges);

    renderList();
    renderGraph();
    renderDetail();
  </script>
</body>
</html>`;
}

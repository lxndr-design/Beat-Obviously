#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const frontendSrc = join(repoRoot, "frontend", "src");
const componentsDir = join(frontendSrc, "components");
const reactBridgeDir = join(frontendSrc, "react-bridge");
const solidUiDir = join(frontendSrc, "solid-ui");
const featuresDir = join(frontendSrc, "features");
const solidCatalogPath = join(frontendSrc, "design", "SolidUiKitCatalog.solid.tsx");
const tokensPath = join(frontendSrc, "design", "tokens.css");
const packageJsonPath = join(repoRoot, "frontend", "package.json");
const tsconfigPath = join(repoRoot, "frontend", "tsconfig.json");
const viteConfigPath = join(repoRoot, "frontend", "vite.config.ts");
const appDialogPath = join(frontendSrc, "solid-ui", "AppDialog", "AppDialog.solid.tsx");
const iconPath = join(frontendSrc, "solid-ui", "Icon", "Icon.solid.tsx");
const buttonCssPath = join(frontendSrc, "solid-ui", "Button", "Button.module.css");
const phIconSubsetPath = join(frontendSrc, "solid-ui", "Icon", "phIconSubset.ts");
const nodeInstrumentEditorPath = join(frontendSrc, "features", "NodeInstrumentEditor", "NodeInstrumentEditor.solid.tsx");
const nodeCanvasPath = join(frontendSrc, "features", "NodeInstrumentEditor", "NodeCanvas.solid.tsx");
const synthEditorPath = join(frontendSrc, "features", "Synth", "SynthEditor", "SynthEditor.solid.tsx");
const synthEditorCssPath = join(frontendSrc, "features", "Synth", "SynthEditor", "SynthEditor.module.css");
const instrumentEditorPath = join(frontendSrc, "features", "InstrumentEditor", "InstrumentEditorModal.solid.tsx");
const instrumentEditorCssPath = join(frontendSrc, "features", "InstrumentEditor", "InstrumentEditorModal.module.css");
const waveformPickerPath = join(frontendSrc, "features", "InstrumentEditor", "WaveformPicker.solid.tsx");
const waveformPickerCssPath = join(frontendSrc, "features", "InstrumentEditor", "WaveformPicker.module.css");
const knobPath = join(frontendSrc, "solid-ui", "Knob", "Knob.solid.tsx");
const sliderPath = join(frontendSrc, "solid-ui", "Slider", "Slider.solid.tsx");
const sliderCssPath = join(frontendSrc, "solid-ui", "Slider", "Slider.module.css");
const preferencesPath = join(frontendSrc, "features", "Preferences", "PreferencesModal.solid.tsx");
const preferencesCssPath = join(frontendSrc, "features", "Preferences", "PreferencesModal.module.css");
const oscillatorPanelPath = join(frontendSrc, "features", "Synth", "OscillatorPanel", "OscillatorPanel.solid.tsx");
const oscillatorPanelCssPath = join(frontendSrc, "features", "Synth", "OscillatorPanel", "OscillatorPanel.module.css");
const modulationMatrixPath = join(frontendSrc, "features", "Synth", "ModulationMatrix", "ModulationMatrix.solid.tsx");
const modulationMatrixCssPath = join(frontendSrc, "features", "Synth", "ModulationMatrix", "ModulationMatrix.module.css");
const timeSignatureControlPath = join(frontendSrc, "features", "Transport", "TimeSignatureControl.solid.tsx");
const timeSignatureControlCssPath = join(frontendSrc, "features", "Transport", "TimeSignatureControl.module.css");
const timeSignatureModalCssPath = join(frontendSrc, "features", "Transport", "TimeSignatureModal.module.css");
const assetPageShellCssPath = join(frontendSrc, "features", "HomeHub", "AssetPageShell.module.css");
const audioFilesPageCssPath = join(frontendSrc, "features", "HomeHub", "AudioFilesPage.module.css");

const failures = [];
const usedPhIconNames = new Map();

function fail(message) {
  failures.push(message);
}

function rel(path) {
  return relative(repoRoot, path);
}

function location(file, lineNumber) {
  return `${rel(file)}:${lineNumber}`;
}

function walk(dir, predicate = () => true) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full, predicate));
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function walkDirs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (!stat.isDirectory()) continue;
    out.push(full, ...walkDirs(full));
  }
  return out;
}

function lineEntries(source) {
  return source.split(/\r?\n/).map((line, index) => ({
    line,
    lineNumber: index + 1,
  }));
}

const threePixelGridPropertyPattern = /^(?:gap|row-gap|column-gap|padding(?:-(?:top|right|bottom|left|inline|inline-start|inline-end|block|block-start|block-end))?|margin(?:-(?:top|right|bottom|left|inline|inline-start|inline-end|block|block-start|block-end))?|width|height|min-width|max-width|min-height|max-height|flex|flex-basis|top|right|bottom|left|inset(?:-(?:inline|inline-start|inline-end|block|block-start|block-end))?|grid-template-(?:columns|rows)|grid-auto-(?:columns|rows)|outline-offset|transform)$/;
const threePixelGridCustomPropertyPattern = /(?:space|gap|padding|margin|width|height|size|inset|offset|row|column|track|node|cell)/;

function checkThreePixelGrid(file, source) {
  for (const { line, lineNumber } of lineEntries(source)) {
    const declaration = line.match(/^\s*([\w-]+)\s*:\s*(.+)$/);
    if (!declaration) continue;

    const property = declaration[1];
    const isGridProperty = threePixelGridPropertyPattern.test(property);
    const isGridCustomProperty =
      property.startsWith("--") &&
      threePixelGridCustomPropertyPattern.test(property) &&
      !/(?:font|border|duration|radius|blur|stroke)/.test(property);
    if (!isGridProperty && !isGridCustomProperty) continue;

    for (const match of declaration[2].matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
      const value = Number(match[1]);
      const absoluteValue = Math.abs(value);
      const isStrokeOrOpticalOffset = absoluteValue === 0.5 || absoluteValue === 1;
      const isDerivedHalfGridValue = property.includes("half") && absoluteValue * 2 % 3 === 0;
      if (value !== 0 && absoluteValue % 3 !== 0 && !isStrokeOrOpticalOffset && !isDerivedHalfGridValue) {
        fail(`Spacing and block geometry must use the 3px grid ${location(file, lineNumber)}: ${line.trim()}`);
      }
    }
  }
}

function isAllowed(allowlist, file, line, value) {
  const relativeFile = rel(file);
  return allowlist.some((entry) => {
    if (entry.file !== relativeFile) return false;
    if (entry.value && entry.value !== value) return false;
    if (entry.line && !entry.line.test(line)) return false;
    return true;
  });
}

function parseHexColor(value) {
  const hex = value.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b] = hex.slice(0, 3).split("").map((char) => parseInt(`${char}${char}`, 16));
    return { r, g, b };
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return null;
}

function isGrayscaleRgb(r, g, b) {
  return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && r === g && g === b;
}

function isAllowedMonochromeLiteral(value) {
  const trimmed = value.trim();
  if (trimmed === "transparent") return true;
  if (trimmed.startsWith("#")) {
    const color = parseHexColor(trimmed);
    return Boolean(color && isGrayscaleRgb(color.r, color.g, color.b));
  }
  const rgb = trimmed.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*(?:[0-9.]+|var\([^)]*\)))?\s*\)$/i);
  if (rgb) return isGrayscaleRgb(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  const hsl = trimmed.match(/^hsla?\(\s*([0-9.]+)(?:deg)?\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%(?:\s*,\s*(?:[0-9.]+|var\([^)]*\)))?\s*\)$/i);
  if (hsl) return Number(hsl[2]) === 0;
  return false;
}

function checkInteractionTokens(file, source) {
  for (const { line, lineNumber } of lineEntries(source)) {
    if (line.includes("--transition-invert")) {
      fail(`Use --interaction-transition instead of removed invert motion ${location(file, lineNumber)}: ${line.trim()}`);
    }
    if (/background:\s*var\(--surface-(?:hover|selected|selected-strong)\)/.test(line)) {
      fail(`Use --interaction-* background tokens for UI state feedback ${location(file, lineNumber)}: ${line.trim()}`);
    }
  }
}

const solidComponentNames = existsSync(solidUiDir)
  ? readdirSync(solidUiDir)
    .filter((name) => statSync(join(solidUiDir, name)).isDirectory())
    .sort()
  : [];
const solidCatalog = existsSync(solidCatalogPath) ? readFileSync(solidCatalogPath, "utf8") : "";
if (existsSync(componentsDir)) {
  fail("Legacy frontend/src/components namespace should stay removed; shared UI belongs in frontend/src/solid-ui.");
}
if (existsSync(reactBridgeDir)) {
  fail("Legacy frontend/src/react-bridge namespace should stay removed; Solid is mounted directly from frontend/src/main.solid.tsx.");
}
if (existsSync(featuresDir)) {
  for (const dir of walkDirs(featuresDir)) {
    if (dir.endsWith("/solid")) {
      fail(`Migration-only feature solid/ folder should be flattened now that the app is Solid-owned: ${rel(dir)}`);
    }
  }
}
if (solidComponentNames.length > 0 && !solidCatalog) {
  fail("Missing frontend/src/design/SolidUiKitCatalog.solid.tsx");
}

for (const name of solidComponentNames) {
  const demoPath = join(solidUiDir, name, `${name}.demo.solid.tsx`);
  if (!existsSync(demoPath)) {
    fail(`Missing Solid component demo: ${rel(demoPath)}`);
    continue;
  }

  const expectedImport = `../solid-ui/${name}/${name}.demo.solid`;
  if (!solidCatalog.includes(expectedImport)) {
    fail(`SolidUiKitCatalog does not import ${expectedImport}`);
  }
}

const sourceFiles = walk(frontendSrc, (path) => /\.(ts|tsx)$/.test(path));
for (const file of sourceFiles) {
  const source = readFileSync(file, "utf8");
  const relativeFile = rel(file);
  if (source.includes("@jsxImportSource solid-js")) {
    fail(`Per-file Solid JSX pragma should be replaced by frontend/tsconfig.json jsxImportSource: ${rel(file)}`);
  }
  if (source.includes("@iconify/react")) {
    fail(`Deprecated @iconify/react import in ${rel(file)}`);
  }
  if (source.includes("@iconify/core/lib/api") || source.includes("fetchAPIModule") || source.includes("loadIcon(")) {
    fail(`Runtime Iconify API loading is not allowed; bundle icon collections locally in ${rel(file)}`);
  }
  checkInteractionTokens(file, source);
  const solidMigrationIdentifier = source.match(/\b(?!SolidUiKitCatalog\b)[A-Za-z_$][A-Za-z0-9_$]*Solid[A-Za-z0-9_$]*\b/);
  if (solidMigrationIdentifier) {
    fail(`Migration-era Solid identifier should be removed in ${rel(file)}: ${solidMigrationIdentifier[0]}`);
  }
  if (/export\s+(?:function\s+mount[A-Za-z0-9]+Solid|interface\s+Mounted[A-Za-z0-9]+Solid)\b/.test(source)) {
    fail(`Deprecated Solid bridge mount API in ${rel(file)}`);
  }

  if (!relativeFile.endsWith("scripts/verify-design-system.mjs")) {
    for (const { line, lineNumber } of lineEntries(source)) {
      if (/\bwindow\.(?:alert|confirm|prompt)\s*\(/.test(line)) {
        fail(`Native browser dialog bypasses UI kit ${location(file, lineNumber)}: ${line.trim()}`);
      }
      if (
        /<Button\b/.test(line) &&
        /\biconOnly\b/.test(line) &&
        !/\baria-label=/.test(line) &&
        !/\baria-labelledby=/.test(line) &&
        !/\baria-hidden=/.test(line)
      ) {
        fail(`Icon-only Button needs an accessible label ${location(file, lineNumber)}: ${line.trim()}`);
      }
    }
  }

  const iconLiteralPattern = /\b(?:name|icon)\s*(?:=|:)\s*["']([^"']+:[^"']+)["']/g;
  for (const match of source.matchAll(iconLiteralPattern)) {
    const iconName = match[1];
    if (!iconName.startsWith("ph:")) {
      fail(`Non-Phosphor icon literal "${iconName}" in ${rel(file)}`);
    }
  }
  for (const match of source.matchAll(/["'](ph:[a-z0-9-]+)["']/g)) {
    const iconName = match[1];
    if (file !== phIconSubsetPath && !usedPhIconNames.has(iconName)) {
      usedPhIconNames.set(iconName, rel(file));
    }
  }
  for (const match of source.matchAll(/<Icon\b[^>]*>/gs)) {
    const literalSize = match[0].match(/\bsize=\{(\d+)\}/)?.[1];
    if (literalSize && literalSize !== "18") {
      fail(`Icons must use the standard 18px glyph size in ${rel(file)}: ${match[0].replace(/\s+/g, " ").trim()}`);
    }
  }
}

const phIconSubsetSource = existsSync(phIconSubsetPath) ? readFileSync(phIconSubsetPath, "utf8") : "";
if (!phIconSubsetSource) {
  fail("Missing generated Phosphor icon subset at frontend/src/solid-ui/Icon/phIconSubset.ts");
}
for (const [iconName, firstSeenFile] of usedPhIconNames) {
  const subsetKey = `"${iconName.replace(/^ph:/, "")}"`;
  if (!phIconSubsetSource.includes(subsetKey)) {
    fail(`Icon ${iconName} used in ${firstSeenFile} is missing from generated offline icon subset. Run npm run generate:icons.`);
  }
}

const iconSource = existsSync(iconPath) ? readFileSync(iconPath, "utf8") : "";
const buttonCssSource = existsSync(buttonCssPath) ? readFileSync(buttonCssPath, "utf8") : "";
if (!iconSource.includes("size?: 18;") || !iconSource.includes("local.size ?? 18")) {
  fail("Shared Icon must keep 18px as its only public and default glyph size.");
}
if (!/\.iconOnly\s*\{[^}]*padding:\s*6px;/s.test(buttonCssSource)) {
  fail("Icon-only Button must keep 6px padding around the standard 18px glyph.");
}

const sharedCssFiles = [
  ...(existsSync(componentsDir) ? walk(componentsDir, (path) => /\.css$/.test(path)) : []),
  ...walk(solidUiDir, (path) => /\.css$/.test(path)),
];
const hexPattern = /#[0-9a-fA-F]{3,8}\b/g;
for (const file of sharedCssFiles) {
  const source = readFileSync(file, "utf8");
  checkInteractionTokens(file, source);
  const matches = source.match(hexPattern);
  if (matches) {
    fail(`Raw hex color in shared UI CSS ${rel(file)}: ${[...new Set(matches)].join(", ")}`);
  }
}

const tokenSource = existsSync(tokensPath) ? readFileSync(tokensPath, "utf8") : "";
const designTokens = new Set([...tokenSource.matchAll(/--[A-Za-z0-9_-]+(?=\s*:)/g)].map((match) => match[0]));
const tokenRawColorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
if (!tokenSource) {
  fail("Missing frontend/src/design/tokens.css");
}
if (tokenSource.includes("--transition-invert")) {
  fail("frontend/src/design/tokens.css must not restore the removed --transition-invert token.");
}
if (tokenSource.includes("--font-size-7") || tokenSource.includes("--font-size-8")) {
  fail("Unused display font sizes 7 and 8 must stay removed from frontend/src/design/tokens.css.");
}
const themeBlock = (selector) => tokenSource.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
const lightThemeBlock = themeBlock('html[data-theme="light"]');
const mellowThemeBlock = themeBlock('html[data-theme="mellow"]');
const lowContrastBlock = themeBlock('html[data-theme-contrast="low"]');
const highContrastBlock = themeBlock('html[data-theme-contrast="high"]');
if (!tokenSource.includes("--theme-core-bg: #000000;")) {
  fail("Dark theme must retain an immutable black core background.");
}
if (!lightThemeBlock.includes("--theme-core-bg: #f5f5f5;")) {
  fail("Light theme must retain its immutable off-white core background.");
}
if (!mellowThemeBlock.includes("--theme-core-bg: #4a4a4a;")) {
  fail("Mellow theme must retain its immutable graphite core background.");
}
for (const [name, block] of [["low", lowContrastBlock], ["high", highContrastBlock]]) {
  if (/--(?:theme-core-bg|color-bg)\s*:/.test(block)) {
    fail(`${name} contrast must not change a theme's core background.`);
  }
}
if (!lowContrastBlock.includes("--contrast-fg-strength: 66%;") || !highContrastBlock.includes("--contrast-fg-strength: 100%;")) {
  fail("Theme contrast must increase foreground separation monotonically from low to high.");
}
const assetPageShellCss = readFileSync(assetPageShellCssPath, "utf8");
const audioFilesPageCss = readFileSync(audioFilesPageCssPath, "utf8");
if (!assetPageShellCss.includes("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);")
    || !assetPageShellCss.includes("@media (max-width: 660px)")) {
  fail("Asset pages must retain both panes at normal Mac window widths and stack only on compact windows.");
}
if (!assetPageShellCss.includes("width: 100%;") || !assetPageShellCss.includes("max-width: 100%;") || !assetPageShellCss.includes("overflow: hidden;")) {
  fail("Asset page shells must contain intrinsic browser width instead of pushing previews off-screen.");
}
if (!audioFilesPageCss.includes("grid-template-rows: repeat(2, 33px);") || !audioFilesPageCss.includes("grid-template-rows: 66px minmax(0, 1fr);")) {
  fail("Audio library controls must remain a compact two-row toolbar inside the browser pane.");
}
for (const token of ["xs", "sm", "md", "lg"]) {
  if (!tokenSource.includes(`--button-square-${token}: 30px;`)) {
    fail(`Icon-only Button ${token} footprint must stay 30px for an 18px glyph with 6px padding.`);
  }
}
for (const { line, lineNumber } of lineEntries(tokenSource)) {
  for (const match of line.matchAll(tokenRawColorPattern)) {
    const value = match[0];
    if (!isAllowedMonochromeLiteral(value)) {
      fail(`Non-monochrome color literal in design tokens ${location(tokensPath, lineNumber)}: ${value}`);
    }
  }
}

const tsconfigSource = existsSync(tsconfigPath) ? readFileSync(tsconfigPath, "utf8") : "";
if (!tsconfigSource.includes('"jsx": "preserve"')) {
  fail("frontend/tsconfig.json must keep JSX preserved for the Solid Vite transform.");
}
if (!tsconfigSource.includes('"jsxImportSource": "solid-js"')) {
  fail("frontend/tsconfig.json must define Solid as the global JSX import source.");
}
if (tsconfigSource.includes('"jsx": "react-jsx"')) {
  fail("frontend/tsconfig.json must not use the old JSX transform mode.");
}

if (existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const dependencyGroups = [
    ["dependencies", packageJson.dependencies ?? {}],
    ["devDependencies", packageJson.devDependencies ?? {}],
  ];
  const forbiddenPackages = ["react", "react-dom", "@vitejs/plugin-react", "zundo"];
  for (const [groupName, dependencies] of dependencyGroups) {
    for (const packageName of forbiddenPackages) {
      if (dependencies[packageName]) {
        fail(`Removed React-era package must not return in frontend/package.json ${groupName}: ${packageName}`);
      }
    }
  }
  if (!packageJson.dependencies?.["@iconify/core"]) {
    fail("frontend/package.json must include @iconify/core for local icon rendering.");
  }
  if (!packageJson.devDependencies?.["@iconify-json/ph"] && !packageJson.dependencies?.["@iconify-json/ph"]) {
    fail("frontend/package.json must include @iconify-json/ph so the offline Phosphor subset can be regenerated.");
  }
}

const viteConfigSource = existsSync(viteConfigPath) ? readFileSync(viteConfigPath, "utf8") : "";
if (viteConfigSource.includes("@vitejs/plugin-react") || viteConfigSource.includes("plugin-react")) {
  fail("frontend/vite.config.ts must not use the removed React Vite plugin.");
}

const appDialogSource = existsSync(appDialogPath) ? readFileSync(appDialogPath, "utf8") : "";
if (appDialogSource.includes('layout="bare"')) {
  fail("AppDialog prompts must use a framed TextInput; bare prompt fields collapse inside stacked modals.");
}

const nodeInstrumentEditorSource = existsSync(nodeInstrumentEditorPath) ? readFileSync(nodeInstrumentEditorPath, "utf8") : "";
if (nodeInstrumentEditorSource.includes("<select")) {
  fail("Nodemap editor parameter selects must use the shared Select primitive.");
}
if (nodeInstrumentEditorSource.includes("<button")) {
  fail("Nodemap editor shell/browser actions must use the shared Button primitive.");
}

const nodeCanvasSource = existsSync(nodeCanvasPath) ? readFileSync(nodeCanvasPath, "utf8") : "";
if (!nodeCanvasSource.includes("className={styles.removeNode}")) {
  fail("Nodemap delete affordance should stay on the shared Button primitive with the removeNode class.");
}
for (const match of nodeCanvasSource.matchAll(/<button\b[\s\S]*?>/g)) {
  const tag = match[0];
  if (!tag.includes("data-node-port") && !tag.includes("styles.port")) {
    fail(`Nodemap canvas raw buttons are only allowed for geometric port hit-targets in ${rel(nodeCanvasPath)}.`);
  }
}

const synthEditorSource = existsSync(synthEditorPath) ? readFileSync(synthEditorPath, "utf8") : "";
if (synthEditorSource.includes("styles.iconOptionSelected") || synthEditorSource.includes("styles.shapeButtonActive")) {
  fail("Aether icon and shape picker active states must use shared Button selected state.");
}
if (!synthEditorSource.includes("function EffectParamControl") || !synthEditorSource.includes("<Slider")) {
  fail("Aether Instrument FX continuous parameters should use the shared Slider primitive.");
}
const synthEditorCssSource = existsSync(synthEditorCssPath) ? readFileSync(synthEditorCssPath, "utf8") : "";
if (/\.iconOptionSelected\b|\.shapeButtonActive\b/.test(synthEditorCssSource)) {
  fail("Aether icon and shape picker active CSS must not fork shared Button selected styling.");
}
if (!synthEditorCssSource.includes("repeat(3, minmax(0, 1fr))")) {
  fail("Aether Instrument FX cards should cap at three columns on wide layouts.");
}

const instrumentEditorSource = existsSync(instrumentEditorPath) ? readFileSync(instrumentEditorPath, "utf8") : "";
if (
  instrumentEditorSource.includes("styles.iconOptionSelected") ||
  instrumentEditorSource.includes("styles.lfoShapeButtonActive")
) {
  fail("Instrument editor icon and LFO picker active states must use shared Button selected state.");
}
if (instrumentEditorSource.includes('type="range"')) {
  fail("Instrument editor sliders must use the shared Slider primitive.");
}
const instrumentEditorCssSource = existsSync(instrumentEditorCssPath) ? readFileSync(instrumentEditorCssPath, "utf8") : "";
if (/\.iconOptionSelected\b|\.lfoShapeButtonActive\b/.test(instrumentEditorCssSource)) {
  fail("Instrument editor icon and LFO picker active CSS must not fork shared Button selected styling.");
}

const waveformPickerSource = existsSync(waveformPickerPath) ? readFileSync(waveformPickerPath, "utf8") : "";
if (waveformPickerSource.includes("styles.active")) {
  fail("Waveform picker active state must use shared Button selected state.");
}
const waveformPickerCssSource = existsSync(waveformPickerCssPath) ? readFileSync(waveformPickerCssPath, "utf8") : "";
if (/\.active\b/.test(waveformPickerCssSource)) {
  fail("Waveform picker active CSS must not fork shared Button selected styling.");
}

const knobSource = existsSync(knobPath) ? readFileSync(knobPath, "utf8") : "";
if (!knobSource.includes("onDialKeyDown") || !knobSource.includes("aria-valuetext")) {
  fail("Shared Knob must keep keyboard slider support and aria-valuetext.");
}

const sliderSource = existsSync(sliderPath) ? readFileSync(sliderPath, "utf8") : "";
const sliderCssSource = existsSync(sliderCssPath) ? readFileSync(sliderCssPath, "utf8") : "";
if (!sliderSource.includes('type="range"') || !sliderSource.includes("onInput")) {
  fail("Shared Slider must keep the native range input and continuous input events.");
}
if (sliderSource.includes("setPointerCapture") || sliderCssSource.includes("pointer-events: none")) {
  fail("Shared Slider must not replace native human drag behavior with wrapper pointer capture.");
}
if (!sliderSource.includes("onPointerDown={beginPointerDrag}")
  || !sliderSource.includes('window.addEventListener("pointermove", continuePointerDrag, true)')) {
  fail("Shared Slider must retain its native-compatible pointer drag fallback.");
}
if (!sliderCssSource.includes("font-size: var(--font-size-field-label)")) {
  fail("Shared Slider labels must use the compact field-label typography token.");
}
if (sliderSource.includes('styles.label} ds-field-label')) {
  fail("Shared Slider labels must not inherit the oversized editorial field-label class.");
}
if (!knobSource.includes('data-dragging={dragging() ? "true" : "false"}')
  || !knobSource.includes('data-editing={editing() !== null ? "true" : "false"}')) {
  fail("Shared Knob must expose its active interaction states for consistent tint feedback.");
}
if (!knobSource.includes('window.addEventListener("pointermove", handlePointerMove, true)')
  || !knobSource.includes('window.addEventListener("pointercancel", handlePointerEnd, true)')
  || knobSource.includes("setPointerCapture")) {
  fail("Shared Knob must retain capture-phase drag handling without relying on element pointer capture.");
}

const preferencesSource = existsSync(preferencesPath) ? readFileSync(preferencesPath, "utf8") : "";
const preferencesCssSource = existsSync(preferencesCssPath) ? readFileSync(preferencesCssPath, "utf8") : "";
if (preferencesSource.includes("tabButtonActive") || /\.tabButtonActive\b/.test(preferencesCssSource)) {
  fail("Preferences tabs must use shared Button selected state.");
}

const oscillatorPanelSource = existsSync(oscillatorPanelPath) ? readFileSync(oscillatorPanelPath, "utf8") : "";
const oscillatorPanelCssSource = existsSync(oscillatorPanelCssPath) ? readFileSync(oscillatorPanelCssPath, "utf8") : "";
if (oscillatorPanelSource.includes("wavetableButtonActive") || /\.wavetableButtonActive\b/.test(oscillatorPanelCssSource)) {
  fail("Aether oscillator wavetable/warp buttons must use shared Button selected state.");
}

const modulationMatrixSource = existsSync(modulationMatrixPath) ? readFileSync(modulationMatrixPath, "utf8") : "";
const modulationMatrixCssSource = existsSync(modulationMatrixCssPath) ? readFileSync(modulationMatrixCssPath, "utf8") : "";
if (
  modulationMatrixSource.includes("modeButtonActive") ||
  modulationMatrixSource.includes("targetOptionSelected") ||
  /\.modeButtonActive\b|\.targetOptionSelected\b/.test(modulationMatrixCssSource)
) {
  fail("Modulation Matrix mode/target active states must use shared Button selected state.");
}

const timeSignatureControlSource = existsSync(timeSignatureControlPath) ? readFileSync(timeSignatureControlPath, "utf8") : "";
const timeSignatureControlCssSource = existsSync(timeSignatureControlCssPath) ? readFileSync(timeSignatureControlCssPath, "utf8") : "";
const timeSignatureModalCssSource = existsSync(timeSignatureModalCssPath) ? readFileSync(timeSignatureModalCssPath, "utf8") : "";
if (timeSignatureControlSource.includes("<select")) {
  fail("Time signature controls must use shared Select.");
}
if (timeSignatureControlSource.includes("beatActive") || /\.beatActive\b/.test(timeSignatureModalCssSource)) {
  fail("Time signature beat cells must use shared Button selected state.");
}
if (/\.dropItem:hover\b|\.button:hover\b/.test(timeSignatureControlCssSource)) {
  fail("Time signature dropdown/trigger hover should come from shared Button.");
}

// Existing feature-local exceptions are narrow: canvas/SVG fallbacks, mask alpha,
// and piano-roll internals that are domain geometry rather than standalone UI.
const featureRawColorAllowlist = [
  {
    file: "frontend/src/features/SegmentEditor/segmentColors.ts",
    line: /#[0-9a-fA-F]{6}/,
  },
  {
    file: "frontend/src/features/InstrumentEditor/InstrumentWaveformPreview.solid.tsx",
    value: "#fff",
    line: /getPropertyValue\("--color-fg"\).*"#fff"/,
  },
  {
    file: "frontend/src/features/InstrumentEditor/InstrumentWaveformPreview.solid.tsx",
    value: "rgba(255,255,255,0.12)",
    line: /getPropertyValue\("--grid-line-faint"\).*"rgba\(255,255,255,0\.12\)"/,
  },
  {
    file: "frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.module.css",
    value: "#000",
    line: /mask: radial-gradient/,
  },
  {
    file: "frontend/src/features/MidiEditor/PianoRoll.module.css",
    value: "#000",
    line: /background: #000;/,
  },
];

// Legacy feature animations that need token migration later. New feature motion
// should use the transition/duration/easing vocabulary from tokens.css.
const featureMotionAllowlist = [
  {
    file: "frontend/src/features/HomeHub/AudioFilesPage.module.css",
    line: /animation: audioPreviewSpin 1s linear infinite;/,
  },
  {
    file: "frontend/src/features/HomeHub/AssetPageShell.module.css",
    line: /animation: assetStateSpin 1s linear infinite;/,
  },
  {
    file: "frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.module.css",
    line: /animation: beat-instrument-loading 1s linear infinite;/,
  },
  {
    file: "frontend/src/features/Sidebar/Sidebar.module.css",
    line: /animation: beat-dirty-pulse 1\.6s ease-in-out infinite;/,
  },
  {
    file: "frontend/src/features/Synth/ModulationMatrix/ModulationMatrix.module.css",
    line: /animation: synth-pick-marching-ants 0\.55s linear infinite;/,
  },
  {
    file: "frontend/src/features/TopBar/TopBar.module.css",
    line: /animation: beat-dirty-pulse 1\.6s ease-in-out infinite;/,
  },
  {
    file: "frontend/src/features/Tracks/Timeline.module.css",
    line: /transition: background 120ms var\(--ease-out\);/,
  },
];

// Existing references to missing or not-yet-promoted tokens. Keeping these
// explicit lets the verifier catch new token typos in feature CSS.
const featureUnknownTokenAllowlist = [
  {
    file: "frontend/src/features/Debug/ExportJobPanel.module.css",
    value: "--color-muted",
  },
  {
    file: "frontend/src/features/Debug/RenderTimingPanel.module.css",
    value: "--border-muted",
  },
  {
    file: "frontend/src/features/Debug/RenderTimingPanel.module.css",
    value: "--color-muted",
  },
  {
    file: "frontend/src/features/Tracks/TrackEffectRows.module.css",
    value: "--height-track-effect-row",
  },
  {
    file: "frontend/src/features/Tracks/TimepointLane.module.css",
    value: "--transition-fast",
  },
];

// Raw controls are reserved for direct-manipulation geometry and inline editing
// whose behavior is not represented by a shared UI primitive.
const rawFeatureButtonAllowlist = new Map([
  ["frontend/src/features/DrumEditor/DrumSequencer.solid.tsx", ["styles.stepCell"]],
  ["frontend/src/features/InstrumentEditor/TimelineJumpingSamplerEditor.solid.tsx", ["styles.waveform"]],
  ["frontend/src/features/SegmentEditor/AudioSegmentTransport.solid.tsx", ["styles.waveform"]],
  ["frontend/src/features/DrumpadEditor/DrumpadEditorModal.solid.tsx", ["styles.key", "styles.lanePlug"]],
  ["frontend/src/features/MidiEditor/PianoRoll.solid.tsx", ["styles.automationPointHandle", "styles.curveHandle"]],
  ["frontend/src/features/NodeInstrumentEditor/NodeCanvas.solid.tsx", ["data-node-port"]],
  ["frontend/src/features/PluginLibrary/PluginHostModal.solid.tsx", ["styles.decentSkinHotspot"]],
  ["frontend/src/features/SegmentEditor/SegmentEditorModal.solid.tsx", ["data-aether-segment-automation-handle", "styles.segmentColorButton", "styles.segmentColorChoice"]],
  ["frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx", ["styles.fxDragHandle", "styles.envelopeHandle"]],
  ["frontend/src/features/TrackDetails/TrackDetailsModal.solid.tsx", ["data-aether-track-automation-handle"]],
  ["frontend/src/features/Tracks/Segment.solid.tsx", ["data-segment-fade-handle"]],
  ["frontend/src/features/Tracks/TrackAutomationRows.solid.tsx", ["styles.disclosure", "styles.groupTitle", "styles.valueHeaderTitle", "styles.point"]],
  ["frontend/src/features/Tracks/Timeline.solid.tsx", ["styles.loopClamp"]],
  ["frontend/src/features/Tracks/TrackHeader.solid.tsx", ["styles.name"]],
]);

const rawFeatureInputAllowlist = new Map([
  ["frontend/src/features/HomeHub/InstrumentsPage.solid.tsx", ["styles.sampleValueInput"]],
  ["frontend/src/features/InstrumentLibrary/ImportInstrumentModal.solid.tsx", ["instrument-import-types"]],
  ["frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.solid.tsx", ["styles.setNameInput"]],
  ["frontend/src/features/PluginLibrary/PluginImportModal.solid.tsx", ["type=\"file\""]],
  ["frontend/src/features/TopBar/TopBar.solid.tsx", ["styles.projectNameInput"]],
  ["frontend/src/features/Tracks/Segment.solid.tsx", ["styles.nameInput"]],
  ["frontend/src/features/Tracks/TimepointLane.solid.tsx", ["styles.input"]],
  ["frontend/src/features/Tracks/TrackHeader.solid.tsx", ["styles.nameInput"]],
]);

function isAllowlistedRawControl(allowlist, file, tag) {
  const markers = allowlist.get(rel(file)) ?? [];
  return markers.some((marker) => tag.includes(marker));
}

const featureFiles = existsSync(featuresDir)
  ? walk(featuresDir, (path) => /\.(css|ts|tsx)$/.test(path))
  : [];
const cssFiles = walk(frontendSrc, (path) => path.endsWith(".css"));
for (const file of cssFiles) {
  checkThreePixelGrid(file, readFileSync(file, "utf8"));
}

for (const file of sourceFiles) {
  if (file.endsWith(".tsx") && !file.endsWith(".solid.tsx")) {
    fail(`Legacy JSX file must be Solid-suffixed or removed: ${rel(file)}`);
  }
}

const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const namedHuePattern =
  /\b(?:color|background|background-color|border-color|border-top-color|border-right-color|border-bottom-color|border-left-color|fill|stroke)\s*:[^;]*\b(?:red|green|blue|yellow|purple|orange|pink|cyan|magenta|brown|teal|lime|navy|maroon|gold)\b/i;
const fontSizePattern = /\bfont-size\s*:\s*([^;]+)/i;
const fontFamilyPattern = /\bfont-family\s*:\s*([^;]+)/i;
const letterSpacingPattern = /\bletter-spacing\s*:\s*([^;]+)/i;
const motionDeclarationPattern = /\b(?:transition|transition-duration|animation|animation-duration)\s*:/i;
const rawMotionValuePattern = /\b\d+(?:\.\d+)?m?s\b|\b(?:ease|ease-in|ease-out|ease-in-out|linear)\b|cubic-bezier\(/i;
const varReferencePattern = /var\(\s*(--[A-Za-z0-9_-]+)/g;
const localTokenDefinitionPattern = /--[A-Za-z0-9_-]+(?=\s*:)/g;
const designTokenNamespacePattern =
  /^--(?:border|button|color|duration|ease|font|grid|height|interaction|knob|layout|letter-spacing|line-height|modal|segment|sidebar|space|surface|transition|width|z)-/;

for (const file of featureFiles) {
  const source = readFileSync(file, "utf8");
  const isCss = file.endsWith(".css");
  if (isCss) {
    checkInteractionTokens(file, source);
  }

  if (file.endsWith(".tsx")) {
    for (const match of source.matchAll(/<button\b[^>]*>/gs)) {
      const tag = match[0].replace(/\s+/g, " ");
      if (!isAllowlistedRawControl(rawFeatureButtonAllowlist, file, tag)) {
        fail(`Common feature command must use a shared UI primitive in ${rel(file)}: ${tag}`);
      }
    }
    for (const match of source.matchAll(/<input\b[^>]*>/gs)) {
      const tag = match[0].replace(/\s+/g, " ");
      if (!isAllowlistedRawControl(rawFeatureInputAllowlist, file, tag)) {
        fail(`Common feature input must use TextInput, NumberInput, Slider, Checkbox, or Toggle in ${rel(file)}: ${tag}`);
      }
    }
    if (/<select\b/.test(source)) {
      fail(`Feature dropdown must use FloatingSelect in ${rel(file)}.`);
    }
  }

  for (const { line, lineNumber } of lineEntries(source)) {
    for (const match of line.matchAll(rawColorPattern)) {
      const value = match[0];
      if (!isAllowed(featureRawColorAllowlist, file, line, value)) {
        fail(`Raw color literal in feature file ${location(file, lineNumber)}: ${value}`);
      }
    }

    if (isCss && namedHuePattern.test(line)) {
      fail(`Named hue color in feature CSS ${location(file, lineNumber)}: ${line.trim()}`);
    }

    const fontSize = isCss ? line.match(fontSizePattern)?.[1].trim() : null;
    if (fontSize && !fontSize.startsWith("var(")) {
      fail(`Raw font-size in feature CSS ${location(file, lineNumber)}: ${line.trim()}`);
    }

    const fontFamily = isCss ? line.match(fontFamilyPattern)?.[1].trim() : null;
    if (fontFamily && !fontFamily.startsWith("var(")) {
      fail(`Raw font-family in feature CSS ${location(file, lineNumber)}: ${line.trim()}`);
    }

    if (isCss) {
      const letterSpacing = line.match(letterSpacingPattern)?.[1].trim();
      if (letterSpacing && letterSpacing !== "0" && !letterSpacing.startsWith("var(")) {
        fail(`Non-token letter-spacing in feature CSS ${location(file, lineNumber)}: ${line.trim()}`);
      }
    }

    if (
      isCss &&
      motionDeclarationPattern.test(line) &&
      rawMotionValuePattern.test(line.replace(/var\([^)]*\)/g, "")) &&
      !isAllowed(featureMotionAllowlist, file, line)
    ) {
      fail(`Raw motion timing/easing in feature CSS ${location(file, lineNumber)}: ${line.trim()}`);
    }
  }

  if (isCss) {
    const localTokens = new Set([...source.matchAll(localTokenDefinitionPattern)].map((match) => match[0]));
    for (const { line, lineNumber } of lineEntries(source)) {
      for (const match of line.matchAll(varReferencePattern)) {
        const token = match[1];
        if (
          designTokenNamespacePattern.test(token) &&
          !designTokens.has(token) &&
          !localTokens.has(token) &&
          !isAllowed(featureUnknownTokenAllowlist, file, line, token)
        ) {
          fail(`Unknown design token reference in feature CSS ${location(file, lineNumber)}: ${token}`);
        }
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Design system verification failed:");
  for (const message of failures) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log(`Design system verifier passed for ${solidComponentNames.length} Solid components and ${featureFiles.length} feature files.`);

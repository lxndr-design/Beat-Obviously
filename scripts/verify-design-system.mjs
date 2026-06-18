#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const frontendSrc = join(repoRoot, "frontend", "src");
const componentsDir = join(frontendSrc, "components");
const solidUiDir = join(frontendSrc, "solid-ui");
const featuresDir = join(frontendSrc, "features");
const solidCatalogPath = join(frontendSrc, "design", "SolidUiKitCatalog.solid.tsx");
const tokensPath = join(frontendSrc, "design", "tokens.css");
const tsconfigPath = join(repoRoot, "frontend", "tsconfig.json");

const failures = [];

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

function lineEntries(source) {
  return source.split(/\r?\n/).map((line, index) => ({
    line,
    lineNumber: index + 1,
  }));
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

const solidComponentNames = existsSync(solidUiDir)
  ? readdirSync(solidUiDir)
    .filter((name) => statSync(join(solidUiDir, name)).isDirectory())
    .sort()
  : [];
const solidCatalog = existsSync(solidCatalogPath) ? readFileSync(solidCatalogPath, "utf8") : "";
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
    fail(`Deprecated Iconify React import in ${rel(file)}`);
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
}

const sharedCssFiles = [
  ...(existsSync(componentsDir) ? walk(componentsDir, (path) => /\.css$/.test(path)) : []),
  ...walk(solidUiDir, (path) => /\.css$/.test(path)),
];
const hexPattern = /#[0-9a-fA-F]{3,8}\b/g;
for (const file of sharedCssFiles) {
  const source = readFileSync(file, "utf8");
  const matches = source.match(hexPattern);
  if (matches) {
    fail(`Raw hex color in shared UI CSS ${rel(file)}: ${[...new Set(matches)].join(", ")}`);
  }
}

const tokenSource = existsSync(tokensPath) ? readFileSync(tokensPath, "utf8") : "";
const designTokens = new Set([...tokenSource.matchAll(/--[A-Za-z0-9_-]+(?=\s*:)/g)].map((match) => match[0]));
if (!tokenSource) {
  fail("Missing frontend/src/design/tokens.css");
}

const tsconfigSource = existsSync(tsconfigPath) ? readFileSync(tsconfigPath, "utf8") : "";
if (!tsconfigSource.includes('"jsx": "preserve"')) {
  fail("frontend/tsconfig.json must keep JSX preserved for the Solid Vite transform.");
}
if (!tsconfigSource.includes('"jsxImportSource": "solid-js"')) {
  fail("frontend/tsconfig.json must define Solid as the global JSX import source.");
}
if (tsconfigSource.includes('"jsx": "react-jsx"')) {
  fail("frontend/tsconfig.json must not use React JSX mode.");
}

// Existing feature-local exceptions are narrow: canvas/SVG fallbacks, mask alpha,
// and piano-roll internals that are domain geometry rather than standalone UI.
const featureRawColorAllowlist = [
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
    file: "frontend/src/features/Tracks/TrackEffectRows.module.css",
    value: "--transition-fast",
  },
];

const featureFiles = existsSync(featuresDir)
  ? walk(featuresDir, (path) => /\.(css|ts|tsx)$/.test(path))
  : [];

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
  /^--(?:border|button|color|duration|ease|font|grid|height|knob|layout|letter-spacing|line-height|modal|segment|sidebar|space|surface|transition|width|z)-/;

for (const file of featureFiles) {
  const source = readFileSync(file, "utf8");
  const isCss = file.endsWith(".css");

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

#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const frontendSrc = join(repoRoot, "frontend", "src");
const componentsDir = join(frontendSrc, "components");
const catalogPath = join(frontendSrc, "design", "UiKitCatalog.tsx");

const failures = [];

function fail(message) {
  failures.push(message);
}

function rel(path) {
  return relative(repoRoot, path);
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

const componentNames = readdirSync(componentsDir)
  .filter((name) => statSync(join(componentsDir, name)).isDirectory())
  .sort();

const catalog = existsSync(catalogPath) ? readFileSync(catalogPath, "utf8") : "";
if (!catalog) {
  fail("Missing frontend/src/design/UiKitCatalog.tsx");
}

for (const name of componentNames) {
  const demoPath = join(componentsDir, name, `${name}.demo.tsx`);
  if (!existsSync(demoPath)) {
    fail(`Missing component demo: ${rel(demoPath)}`);
    continue;
  }

  const expectedImport = `../components/${name}/${name}.demo`;
  if (!catalog.includes(expectedImport)) {
    fail(`UiKitCatalog does not import ${expectedImport}`);
  }
}

const sourceFiles = walk(frontendSrc, (path) => /\.(ts|tsx)$/.test(path));
for (const file of sourceFiles) {
  const source = readFileSync(file, "utf8");
  const isIconWrapper = file.endsWith(join("components", "Icon", "Icon.tsx"));
  if (!isIconWrapper && source.includes("@iconify/react")) {
    fail(`Raw Iconify import outside Icon wrapper: ${rel(file)}`);
  }

  const iconLiteralPattern = /\b(?:name|icon)\s*(?:=|:)\s*["']([^"']+:[^"']+)["']/g;
  for (const match of source.matchAll(iconLiteralPattern)) {
    const iconName = match[1];
    if (!iconName.startsWith("ph:")) {
      fail(`Non-Phosphor icon literal "${iconName}" in ${rel(file)}`);
    }
  }
}

const componentCssFiles = walk(componentsDir, (path) => /\.css$/.test(path));
const hexPattern = /#[0-9a-fA-F]{3,8}\b/g;
for (const file of componentCssFiles) {
  const source = readFileSync(file, "utf8");
  const matches = source.match(hexPattern);
  if (matches) {
    fail(`Raw hex color in shared component CSS ${rel(file)}: ${[...new Set(matches)].join(", ")}`);
  }
}

if (failures.length > 0) {
  console.error("Design system verification failed:");
  for (const message of failures) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log(`Design system verifier passed for ${componentNames.length} components.`);

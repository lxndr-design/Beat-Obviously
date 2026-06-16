#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);
const requireDefaultHandler = args.includes("--require-default-handler");
const appArg = args.find((arg) => !arg.startsWith("--"));
const appPath = resolve(appArg ?? join(repoRoot, "Beat.app"));
const infoPlistPath = join(appPath, "Contents", "Info.plist");
const executablePath = join(appPath, "Contents", "MacOS", "Beat");
const iconPath = join(appPath, "Contents", "Resources", "Icon.icns");
const pngIconPath = join(appPath, "Contents", "Resources", "BeatIcon.png");

assert.equal(existsSync(appPath), true, `Beat app bundle does not exist: ${appPath}`);
assert.equal(existsSync(infoPlistPath), true, `Info.plist does not exist: ${infoPlistPath}`);
assert.equal(existsSync(executablePath), true, `Beat executable does not exist: ${executablePath}`);
assert.equal(statSync(executablePath).mode & 0o111, 0o111, "Beat executable is not marked executable");
assert.equal(existsSync(iconPath), true, `Document icon does not exist: ${iconPath}`);
assert.equal(existsSync(pngIconPath), true, `Bundled app PNG icon does not exist: ${pngIconPath}`);

const plist = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", infoPlistPath], { encoding: "utf8" }));

assert.equal(plist.CFBundleIdentifier, "com.beat.app", "Beat bundle identifier changed");
assert.equal(plist.CFBundleExecutable, "Beat", "Beat executable name changed");
assert.equal(plist.CFBundleIconFile, "Icon.icns", "Beat app icon file must be Icon.icns");

const documentTypes = Array.isArray(plist.CFBundleDocumentTypes) ? plist.CFBundleDocumentTypes : [];
const beatDocumentType = documentTypes.find((type) => {
  const extensions = Array.isArray(type.CFBundleTypeExtensions) ? type.CFBundleTypeExtensions : [];
  const contentTypes = Array.isArray(type.LSItemContentTypes) ? type.LSItemContentTypes : [];
  return extensions.includes("beat") && contentTypes.includes("com.beat.project");
});

assert.ok(beatDocumentType, "Info.plist is missing the .beat document type");
assert.equal(beatDocumentType.CFBundleTypeRole, "Editor", ".beat document role must be Editor");
assert.equal(beatDocumentType.LSHandlerRank, "Owner", ".beat document handler rank must be Owner");
assert.equal(beatDocumentType.CFBundleTypeIconFile, "Icon.icns", ".beat document icon must be Icon.icns");

const exportedTypes = Array.isArray(plist.UTExportedTypeDeclarations) ? plist.UTExportedTypeDeclarations : [];
const beatUti = exportedTypes.find((type) => type.UTTypeIdentifier === "com.beat.project");
assert.ok(beatUti, "Info.plist is missing exported UTI com.beat.project");
assert.equal(beatUti.UTTypeIconFile, "Icon.icns", ".beat exported UTI icon must be Icon.icns");
assert.ok(
  Array.isArray(beatUti.UTTypeConformsTo) && beatUti.UTTypeConformsTo.includes("public.json"),
  ".beat exported UTI should conform to public.json",
);

const tags = beatUti.UTTypeTagSpecification ?? {};
assert.deepEqual(tags["public.filename-extension"], ["beat"], ".beat exported UTI extension tag changed");
assert.equal(tags["public.mime-type"], "application/x-beat-project", ".beat exported UTI MIME type changed");

if (requireDefaultHandler) {
  const handler = execFileSync(
    "/usr/bin/env",
    ["python3", join(repoRoot, "scripts", "set-beat-default-project-handler.py"), "--verify-only", "com.beat.app"],
    { encoding: "utf8" },
  );
  assert.match(
    handler,
    /(?:com\.beat\.project|\.beat \([^)]+\)) -> com\.beat\.app/,
    "macOS default .beat handler was not com.beat.app",
  );
}

console.log(`Native document registration verifier passed for ${basename(appPath)}.`);

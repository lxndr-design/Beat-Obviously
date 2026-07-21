#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-aurum-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(esbuild, [
    join(repoRoot, "frontend/src/state/aurum.ts"),
    join(repoRoot, "frontend/src/state/aurumTestBank.ts"),
    join(repoRoot, "frontend/src/audio/synthPreview.ts"),
    join(repoRoot, "frontend/src/features/Aurum/aurumEditorInteraction.ts"),
    join(repoRoot, "frontend/src/features/Aurum/aurumEditing.ts"),
    join(repoRoot, "frontend/src/features/Aurum/aurumSignalDiagnostics.ts"),
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outdir=${outDir}`,
  ], { stdio: "inherit" });

  const aurum = await import(pathToFileURL(join(outDir, "state/aurum.js")));
  const testBank = await import(pathToFileURL(join(outDir, "state/aurumTestBank.js")));
  const preview = await import(pathToFileURL(join(outDir, "audio/synthPreview.js")));
  const interaction = await import(pathToFileURL(join(outDir, "features/Aurum/aurumEditorInteraction.js")));
  const editing = await import(pathToFileURL(join(outDir, "features/Aurum/aurumEditing.js")));
  const diagnostics = await import(pathToFileURL(join(outDir, "features/Aurum/aurumSignalDiagnostics.js")));
  const instrument = aurum.createAurumInstrument("aurum-verifier", "Aurum Verifier");

  assert.equal(instrument.aurum.operators.length, 6, "Aurum must expose six operators");
  assert.deepEqual(instrument.aurum.matrix.map((row) => row.length), [7, 7, 7, 7, 7, 7], "Aurum matrix must expose six destinations plus output");
  assert.equal(instrument.aurum.matrix[1][0], 0.42, "Default patch must route OP 2 into OP 1");
  assert.equal(instrument.aurum.matrix[0][6], 0.86, "Default patch must route OP 1 to output");
  assert.equal(instrument.aurum.version, 10, "Aurum operator-pan patches must use schema version 10");
  assert.equal(instrument.aurum.oversampling, 2, "New Aurum patches must default to 2x operator quality");
  assert.equal(instrument.aurum.filters.length, 2, "Aurum must expose two output filters");
  assert.equal(instrument.aurum.filters[0].enabled, true, "Filter A must preserve the prior output-filter path by default");
  assert.equal(instrument.aurum.filters[1].enabled, false, "Filter B must default to bypassed");
  assert.equal(instrument.aurum.filterRouting, "serial", "Aurum filters must default to serial routing");
  assert.deepEqual(instrument.aurum.outputSends[0], [0.86, 0, 0], "The default carrier must feed Filter A through the output-routing matrix");
  assert.ok(instrument.aurum.outputSends.every((row) => row.length === 3), "Every operator must expose Filter A, Filter B, and Direct sends");
  assert.deepEqual(instrument.aurum.rmMatrix.map((row) => row.length), [6, 6, 6, 6, 6, 6], "Aurum RM matrix must expose six operator destinations");
  assert.ok(instrument.aurum.operators.every((operator) => operator.harmonics.length === 16), "Every Aurum operator must expose 16 additive harmonics");
  assert.ok(instrument.aurum.operators.every((operator) => operator.wavefold === 0), "Wavefold must default to exact identity");
  assert.ok(instrument.aurum.operators.every((operator) => operator.pitchEnvelopeSemitones === 0), "Pitch envelopes must migrate and default to neutral depth");
  assert.ok(instrument.aurum.operators.every((operator) => operator.phaseEnvelopeDegrees === 0), "Phase envelopes must migrate and default to neutral depth");
  assert.ok(instrument.aurum.operators.every((operator) => operator.velocityCurve.every((value) => value === 1)), "Velocity curves must default to neutral gain");
  assert.ok(instrument.aurum.operators.every((operator) => operator.keytrackCurve.every((value) => value === 1)), "Keyboard curves must default to neutral gain");
  assert.ok(instrument.aurum.operators.every((operator) => operator.pan === 0), "Aurum operators must default to centered pan");
  assert.equal(aurum.evaluateAurumResponseCurve([0, 0.25, 0.5, 0.75, 1], 0.375), 0.375, "Response curves must interpolate between fixed points");

  const testInstruments = testBank.createAurumTestInstruments("factory-synths");
  assert.deepEqual(testInstruments.map((candidate) => candidate.name), [...testBank.AURUM_TEST_INSTRUMENT_NAMES], "The Aurum MVP test bank must expose its canonical archetype names in order");
  assert.equal(new Set(testInstruments.map((candidate) => candidate.id)).size, testInstruments.length, "Aurum test instruments must have unique stable ids");
  assert.ok(testInstruments.every((candidate) => candidate.userCreated === false && candidate.setId === "factory-synths"), "Aurum test instruments must seed into the factory Synths set");

  const byName = Object.fromEntries(testInstruments.map((candidate) => [candidate.name, candidate]));
  assert.equal(byName.Aurum_Bass_01.aurum.operators[0].ratio, 0.5, "Bass archetype must include a sub-ratio carrier");
  assert.ok(byName.Aurum_Bell_01.aurum.operators.some((operator) => !Number.isInteger(operator.ratio)), "Bell archetype must include inharmonic ratios");
  assert.ok(byName.Aurum_Keys_01.aurum.operators.some((operator) => operator.pan < 0) && byName.Aurum_Keys_01.aurum.operators.some((operator) => operator.pan > 0), "Keys archetype must exercise opposing operator pan");
  assert.ok(byName.Aurum_Pad_01.aurum.operators.some((operator) => operator.waveform === "additive") && byName.Aurum_Pad_01.aurum.unison >= 5, "Pad archetype must exercise additive high-unison rendering");
  assert.ok(byName.Aurum_Lead_01.aurum.operators.some((operator) => operator.wavefold > 0) && byName.Aurum_Lead_01.aurum.matrix.some((row, index) => row[index] > 0), "Lead archetype must exercise wavefold and feedback");
  assert.ok(byName.Aurum_Percussion_01.aurum.operators.some((operator) => operator.pitchEnvelopeSemitones !== 0), "Percussion archetype must exercise pitch-envelope transients");
  assert.ok(byName.Aurum_Organ_01.aurum.operators.every((operator) => operator.enabled) && byName.Aurum_Organ_01.aurum.outputSends.every((row) => row.some((value) => value !== 0)), "Organ archetype must exercise six parallel carriers");
  assert.ok(byName.Aurum_FX_01.aurum.rmMatrix.flat().some((value) => value !== 0) && byName.Aurum_FX_01.aurum.outputSends.flat().some((value) => value < 0), "FX archetype must exercise RM and bipolar output routing");

  const renderedArchetypes = new Map();
  for (const candidate of testInstruments) {
    for (const sampleRate of [44100, 48000, 96000]) {
      const left = new Float32Array(16384);
      const right = new Float32Array(16384);
      preview.renderInstrumentStereoSamples(candidate, left, right, sampleRate, 110, "visual", true);
      const peak = Math.max(
        left.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0),
        right.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0),
      );
      assert.ok([...left, ...right].every(Number.isFinite), `${candidate.name} must remain finite at ${sampleRate} Hz`);
      assert.ok(peak > 0.001 && peak <= 1, `${candidate.name} must remain audible and bounded at ${sampleRate} Hz, got peak ${peak}`);
      if (sampleRate === 48000) renderedArchetypes.set(candidate.name, { left, right });
    }
  }
  const bassReference = renderedArchetypes.get("Aurum_Bass_01").left;
  for (const candidate of testInstruments.slice(1)) {
    const rendered = renderedArchetypes.get(candidate.name).left;
    const meanDifference = rendered.reduce((sum, sample, index) => sum + Math.abs(sample - bassReference[index]), 0) / rendered.length;
    assert.ok(meanDifference > 0.001, `${candidate.name} must render a distinct archetype fingerprint, got ${meanDifference}`);
  }
  for (const name of ["Aurum_Keys_01", "Aurum_Pad_01", "Aurum_Organ_01", "Aurum_FX_01"]) {
    const rendered = renderedArchetypes.get(name);
    const stereoDifference = rendered.left.reduce((sum, sample, index) => sum + Math.abs(sample - rendered.right[index]), 0) / rendered.left.length;
    assert.ok(stereoDifference > 0.0005, `${name} must exercise audible stereo separation, got ${stereoDifference}`);
  }

  const copiedOperator = editing.copyAurumOperator(instrument.aurum.operators[0]);
  copiedOperator.harmonics[0] = 0.25;
  copiedOperator.envelope.attackMs = 77;
  assert.equal(instrument.aurum.operators[0].harmonics[0], 1, "Copied operator harmonics must not alias the source");
  assert.equal(instrument.aurum.operators[0].envelope.attackMs, 5, "Copied operator envelopes must not alias the source");
  const pastedConfig = editing.pasteAurumOperator(instrument.aurum, 2, copiedOperator);
  assert.equal(pastedConfig.operators[2].id, "op-3", "Paste must preserve the destination operator id");
  assert.equal(pastedConfig.operators[2].name, "OP 3", "Paste must preserve the destination operator name");
  assert.equal(pastedConfig.operators[2].harmonics[0], 0.25, "Paste must copy operator parameters");

  const editedForInit = structuredClone(instrument.aurum);
  editedForInit.operators[2].waveform = "square";
  editedForInit.matrix[2][1] = 0.37;
  const initializedConfig = editing.initializeAurumOperator(editedForInit, 2);
  assert.equal(initializedConfig.operators[2].waveform, "sine", "Initialize must restore default operator parameters");
  assert.equal(initializedConfig.matrix[2][1], 0.37, "Initialize must preserve routing");
  editedForInit.matrix[1][2] = -0.22;
  editedForInit.rmMatrix[2][4] = 0.51;
  editedForInit.outputSends[2][2] = 0.8;
  const resetConfig = editing.resetAurumOperator(editedForInit, 2);
  assert.ok(resetConfig.matrix[2].every((value) => value === 0), "Reset must clear the operator FM source row");
  assert.ok(resetConfig.matrix.every((row) => row[2] === 0), "Reset must clear inbound FM routes");
  assert.ok(resetConfig.rmMatrix[2].every((value) => value === 0) && resetConfig.rmMatrix.every((row) => row[2] === 0), "Reset must clear inbound and outbound RM routes");
  assert.deepEqual(resetConfig.outputSends[2], [0, 0, 0], "Reset must clear output sends");

  const swapSource = structuredClone(instrument.aurum);
  swapSource.operators[0].waveform = "saw";
  swapSource.operators[1].waveform = "square";
  swapSource.matrix[1][0] = 0.63;
  swapSource.rmMatrix[0][1] = -0.31;
  swapSource.outputSends[0] = [0.73, 0.12, 0];
  const swappedConfig = editing.swapAurumOperators(swapSource, 0, 1);
  assert.equal(swappedConfig.operators[0].waveform, "square", "Swap must move operator parameters into the other slot");
  assert.equal(swappedConfig.operators[0].id, "op-1", "Swap must preserve fixed slot identity");
  assert.equal(swappedConfig.operators[1].waveform, "saw", "Swap must exchange both operator parameter sets");
  assert.equal(swappedConfig.matrix[0][1], 0.63, "Swap must exchange FM source rows and target columns");
  assert.equal(swappedConfig.rmMatrix[1][0], -0.31, "Swap must exchange RM source rows and target columns");
  assert.deepEqual(swappedConfig.outputSends[1], [0.73, 0.12, 0], "Swap must move output routing with the operator sound");

  const stackTemplate = editing.applyAurumAlgorithmTemplate(instrument.aurum, "stack-3");
  assert.deepEqual(stackTemplate.operators.map((operator) => operator.enabled), [true, true, true, false, false, false], "3-op stack must activate only its required operators");
  assert.equal(stackTemplate.matrix[2][1], 0.42, "3-op stack must route OP 3 into OP 2");
  assert.equal(stackTemplate.matrix[1][0], 0.42, "3-op stack must route OP 2 into OP 1");
  assert.deepEqual(stackTemplate.outputSends[0], [0.86, 0, 0], "3-op stack must route its carrier to Filter A");
  assert.ok(stackTemplate.rmMatrix.flat().every((value) => value === 0), "FM templates must clear stale RM routing");
  const feedbackTemplate = editing.applyAurumAlgorithmTemplate(instrument.aurum, "feedback-2");
  assert.equal(feedbackTemplate.matrix[1][1], 0.18, "Feedback template must set bounded OP 2 feedback");
  assert.equal(editing.AURUM_ALGORITHM_TEMPLATES.length, 7, "Aurum must expose the complete initial algorithm-template set");

  const defaultSignalFlow = diagnostics.analyzeAurumSignalFlow(instrument.aurum);
  assert.equal(defaultSignalFlow.silent, false, "The default Aurum patch must report a connected output");
  assert.equal(defaultSignalFlow.operators[0].state, "carrier", "The default output operator must be identified as a carrier");
  assert.equal(defaultSignalFlow.operators[1].state, "modulator", "An operator feeding a connected carrier must be identified as a modulator");
  assert.deepEqual(defaultSignalFlow.activeBuses, [true, false, false], "Default signal diagnostics must identify Filter A as the active output bus");

  const silentDiagnosticsPatch = structuredClone(instrument.aurum);
  silentDiagnosticsPatch.outputSends = Array.from({ length: 6 }, () => [0, 0, 0]);
  const silentSignalFlow = diagnostics.analyzeAurumSignalFlow(silentDiagnosticsPatch);
  assert.equal(silentSignalFlow.silent, true, "Aurum diagnostics must identify a patch with no output sends as silent");
  assert.equal(silentSignalFlow.operators[0].state, "disconnected", "An enabled carrier without an output path must be identified as disconnected");
  assert.equal(silentSignalFlow.operators[1].state, "disconnected", "A modulator in a disconnected graph must also be identified as disconnected");

  const zeroLevelDiagnosticsPatch = structuredClone(instrument.aurum);
  zeroLevelDiagnosticsPatch.operators[0].level = 0;
  const zeroLevelSignalFlow = diagnostics.analyzeAurumSignalFlow(zeroLevelDiagnosticsPatch);
  assert.equal(zeroLevelSignalFlow.silent, true, "A zero-level carrier must not activate its assigned output bus");
  assert.equal(zeroLevelSignalFlow.operators[0].state, "silent", "A zero-level enabled operator must expose its silent state");

  const baseline = new Float32Array(4096);
  preview.renderInstrumentSamples(instrument, baseline, 48000, 220, "visual", true);
  const peak = baseline.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
  assert.ok(peak > 0.01 && peak <= 1, `Aurum preview must be audible and bounded, got peak ${peak}`);

  const releasePatch = structuredClone(instrument);
  releasePatch.aurum.matrix = Array.from({ length: 6 }, () => Array(7).fill(0));
  releasePatch.aurum.operators.forEach((operator) => { operator.enabled = false; });
  releasePatch.aurum.operators[0].enabled = true;
  releasePatch.aurum.operators[0].level = 0.8;
  releasePatch.aurum.operators[0].envelope = { attackMs: 0, decayMs: 0, sustain: 1, releaseMs: 20 };
  releasePatch.aurum.operators[1].enabled = true;
  releasePatch.aurum.operators[1].level = 0;
  releasePatch.aurum.operators[1].envelope = { attackMs: 0, decayMs: 0, sustain: 1, releaseMs: 200 };
  releasePatch.aurum.matrix[0][6] = 1;
  releasePatch.aurum.outputSends[0][0] = 1;
  const shortRelease = new Float32Array(24000);
  preview.renderInstrumentSamples(releasePatch, shortRelease, 48000, 220, "visual", true);
  releasePatch.aurum.operators[0].envelope.releaseMs = 200;
  const longRelease = new Float32Array(24000);
  preview.renderInstrumentSamples(releasePatch, longRelease, 48000, 220, "visual", true);
  const tailStart = 18000;
  const tailEnd = 21000;
  const shortTailEnergy = shortRelease.slice(tailStart, tailEnd).reduce((sum, sample) => sum + sample * sample, 0);
  const longTailEnergy = longRelease.slice(tailStart, tailEnd).reduce((sum, sample) => sum + sample * sample, 0);
  assert.ok(shortTailEnergy < 0.0001, `Short operator release must finish before the late tail, got energy ${shortTailEnergy}`);
  assert.ok(longTailEnergy > 0.01, `Long operator release must remain audible in the late tail, got energy ${longTailEnergy}`);

  const carrierOnly = structuredClone(instrument);
  carrierOnly.aurum.matrix[1][0] = 0;
  const dry = new Float32Array(4096);
  preview.renderInstrumentSamples(carrierOnly, dry, 48000, 220, "visual", true);
  const difference = baseline.reduce((sum, sample, index) => sum + Math.abs(sample - dry[index]), 0) / baseline.length;
  assert.ok(difference > 0.005, `FM routing must alter the rendered waveform, got mean difference ${difference}`);

  const negativeFm = structuredClone(instrument);
  negativeFm.aurum.matrix[1][0] = -instrument.aurum.matrix[1][0];
  const negativeFmSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(negativeFm, negativeFmSamples, 48000, 220, "visual", true);
  const bipolarFmDifference = baseline.reduce((sum, sample, index) => sum + Math.abs(sample - negativeFmSamples[index]), 0) / baseline.length;
  assert.ok(bipolarFmDifference > 0.005, `Negative FM must invert modulation phase, got mean difference ${bipolarFmDifference}`);

  const invertedOutput = structuredClone(instrument);
  invertedOutput.aurum.matrix[0][6] = -instrument.aurum.matrix[0][6];
  invertedOutput.aurum.outputSends[0][0] = -instrument.aurum.outputSends[0][0];
  const invertedOutputSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(invertedOutput, invertedOutputSamples, 48000, 220, "visual", true);
  const inversionResidual = baseline.reduce((sum, sample, index) => sum + Math.abs(sample + invertedOutputSamples[index]), 0) / baseline.length;
  assert.ok(inversionResidual < 0.0001, `Negative output sends must phase-invert the rendered carrier, got residual ${inversionResidual}`);

  const dryRm = structuredClone(instrument);
  dryRm.aurum.matrix[1][0] = 0;
  const dryRmSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(dryRm, dryRmSamples, 48000, 220, "visual", false);
  const positiveRm = structuredClone(dryRm);
  positiveRm.aurum.rmMatrix[1][0] = 1;
  const positiveRmSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(positiveRm, positiveRmSamples, 48000, 220, "visual", false);
  const rmDifference = dryRmSamples.reduce((sum, sample, index) => sum + Math.abs(sample - positiveRmSamples[index]), 0) / dryRmSamples.length;
  assert.ok(rmDifference > 0.005, `Ring modulation routing must alter the carrier, got mean difference ${rmDifference}`);
  const negativeRm = structuredClone(dryRm);
  negativeRm.aurum.rmMatrix[1][0] = -1;
  const negativeRmSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(negativeRm, negativeRmSamples, 48000, 220, "visual", false);
  const rmInversionResidual = positiveRmSamples.reduce((sum, sample, index) => sum + Math.abs(sample + negativeRmSamples[index]), 0) / positiveRmSamples.length;
  assert.ok(rmInversionResidual < 0.0001, `Negative full-depth RM must invert the ring-modulated carrier, got residual ${rmInversionResidual}`);

  const additive = structuredClone(dryRm);
  additive.aurum.operators[0].waveform = "additive";
  additive.aurum.operators[0].harmonics = Array.from({ length: 16 }, (_, index) => index === 0 ? 1 : 0);
  const additiveFundamental = new Float32Array(4096);
  preview.renderInstrumentSamples(additive, additiveFundamental, 48000, 220, "visual", false);
  additive.aurum.operators[0].harmonics = Array.from({ length: 16 }, (_, index) => index === 2 ? 1 : 0);
  const additiveThird = new Float32Array(4096);
  preview.renderInstrumentSamples(additive, additiveThird, 48000, 220, "visual", false);
  const additiveDifference = additiveFundamental.reduce((sum, sample, index) => sum + Math.abs(sample - additiveThird[index]), 0) / additiveFundamental.length;
  const additivePeak = additiveThird.reduce((peakValue, sample) => Math.max(peakValue, Math.abs(sample)), 0);
  assert.ok(additiveDifference > 0.005, `Changing additive harmonics must alter the operator waveform, got mean difference ${additiveDifference}`);
  assert.ok(additivePeak > 0.01 && additivePeak <= 1, `Additive rendering must remain audible and bounded, got peak ${additivePeak}`);
  additive.aurum.operators[0].harmonics = Array.from({ length: 16 }, (_, index) => index === 15 ? 1 : 0);
  const suppressedAboveNyquist = new Float32Array(1024);
  preview.renderInstrumentSamples(additive, suppressedAboveNyquist, 48000, 4000, "visual", false);
  const nyquistPeak = suppressedAboveNyquist.reduce((peakValue, sample) => Math.max(peakValue, Math.abs(sample)), 0);
  assert.ok(nyquistPeak < 0.000001, `Additive harmonics above Nyquist must be suppressed, got peak ${nyquistPeak}`);

  const folded = structuredClone(dryRm);
  folded.aurum.operators[0].wavefold = 0.72;
  const foldedSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(folded, foldedSamples, 48000, 220, "visual", false);
  const foldDifference = dryRmSamples.reduce((sum, sample, index) => sum + Math.abs(sample - foldedSamples[index]), 0) / dryRmSamples.length;
  const foldPeak = foldedSamples.reduce((peakValue, sample) => Math.max(peakValue, Math.abs(sample)), 0);
  assert.ok(foldDifference > 0.005, `Wavefold must alter the rendered operator waveform, got mean difference ${foldDifference}`);
  assert.ok(foldPeak > 0.01 && foldPeak <= 1, `Wavefold rendering must remain audible and bounded, got peak ${foldPeak}`);
  const sampledDry = preview.sampleAurumOperatorWaveform(dryRm.aurum.operators[0], 0.125, 1 / 144);
  const sampledFolded = preview.sampleAurumOperatorWaveform(folded.aurum.operators[0], 0.125, 1 / 144);
  assert.ok(Math.abs(sampledDry - sampledFolded) > 0.05, "The exported engine sampler must expose the folded waveform used by the editor scope");

  const articulated = structuredClone(instrument);
  articulated.aurum.matrix = Array.from({ length: 6 }, () => Array(7).fill(0));
  articulated.aurum.operators.forEach((operator) => { operator.enabled = false; });
  articulated.aurum.operators[0].enabled = true;
  articulated.aurum.operators[0].level = 0.8;
  articulated.aurum.operators[0].envelope = { attackMs: 0, decayMs: 0, sustain: 1, releaseMs: 100 };
  articulated.aurum.operators[0].pitchEnvelope = { attackMs: 0, decayMs: 0, sustain: 1, releaseMs: 100 };
  articulated.aurum.operators[0].phaseEnvelope = { attackMs: 0, decayMs: 0, sustain: 1, releaseMs: 100 };
  articulated.aurum.matrix[0][6] = 1;
  articulated.aurum.outputSends[0][0] = 1;
  const articulationDry = new Float32Array(4096);
  preview.renderInstrumentSamples(articulated, articulationDry, 48000, 220, "visual", false);
  const pitched = structuredClone(articulated);
  pitched.aurum.operators[0].pitchEnvelopeSemitones = 12;
  const pitchedSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(pitched, pitchedSamples, 48000, 220, "visual", false);
  const pitchDifference = articulationDry.reduce((sum, sample, index) => sum + Math.abs(sample - pitchedSamples[index]), 0) / articulationDry.length;
  assert.ok(pitchDifference > 0.05, `Pitch articulation must alter operator frequency, got mean difference ${pitchDifference}`);
  const phased = structuredClone(articulated);
  phased.aurum.operators[0].phaseEnvelopeDegrees = 90;
  const phasedSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(phased, phasedSamples, 48000, 220, "visual", false);
  const phaseDifference = articulationDry.reduce((sum, sample, index) => sum + Math.abs(sample - phasedSamples[index]), 0) / articulationDry.length;
  assert.ok(phaseDifference > 0.05, `Phase articulation must offset operator phase, got mean difference ${phaseDifference}`);
  assert.ok([...pitchedSamples, ...phasedSamples].every(Number.isFinite), "Pitch and phase articulation must remain finite");

  const qualityPatch = structuredClone(articulated);
  qualityPatch.aurum.operators[0].waveform = "saw";
  qualityPatch.aurum.operators[0].wavefold = 0.82;
  const renderQuality = (oversampling) => {
    qualityPatch.aurum.oversampling = oversampling;
    const samples = new Float32Array(4096);
    preview.renderInstrumentSamples(qualityPatch, samples, 48000, 6200, "visual", false);
    return samples;
  };
  const quality1x = renderQuality(1);
  const quality2x = renderQuality(2);
  const quality4x = renderQuality(4);
  const qualityDistance = (a, b) => a.reduce((sum, sample, index) => sum + Math.abs(sample - b[index]), 0) / a.length;
  const oneToFour = qualityDistance(quality1x, quality4x);
  const twoToFour = qualityDistance(quality2x, quality4x);
  assert.ok(oneToFour > 0.005, `Oversampling must alter nonlinear high-frequency output, got ${oneToFour}`);
  assert.ok(twoToFour < oneToFour, `2x output must converge toward the 4x reference (${twoToFour} vs ${oneToFour})`);
  assert.ok([...quality1x, ...quality2x, ...quality4x].every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1), "All Aurum quality modes must remain finite and bounded");

  const mutedByVelocity = structuredClone(articulated);
  mutedByVelocity.aurum.operators[0].velocityCurve = Array(5).fill(0);
  const velocityMutedSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(mutedByVelocity, velocityMutedSamples, 48000, 220, "visual", false, undefined, undefined, undefined, 120, 127);
  assert.ok(velocityMutedSamples.every((sample) => Math.abs(sample) < 0.000001), "A zero velocity response curve must silence its operator");
  const mutedByKey = structuredClone(articulated);
  mutedByKey.aurum.operators[0].keytrackCurve = Array(5).fill(0);
  const keyMutedSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(mutedByKey, keyMutedSamples, 48000, 220, "visual", false);
  assert.ok(keyMutedSamples.every((sample) => Math.abs(sample) < 0.000001), "A zero keyboard response curve must silence its operator");

  const stereoPatch = structuredClone(instrument);
  stereoPatch.aurum.unison = 3;
  stereoPatch.aurum.detuneCents = 14;
  stereoPatch.aurum.stereoSpread = 0.8;
  const left = new Float32Array(4096);
  const right = new Float32Array(4096);
  preview.renderInstrumentStereoSamples(stereoPatch, left, right, 48000, 220, "visual", true);
  const stereoDifference = left.reduce((sum, sample, index) => sum + Math.abs(sample - right[index]), 0) / left.length;
  assert.ok(stereoDifference > 0.005, `Aurum spread must create stereo separation, got mean difference ${stereoDifference}`);

  const operatorPanPatch = structuredClone(instrument);
  operatorPanPatch.aurum.unison = 1;
  operatorPanPatch.aurum.stereoSpread = 0;
  operatorPanPatch.aurum.outputSends = Array.from({ length: 6 }, () => [0, 0, 0]);
  operatorPanPatch.aurum.outputSends[0][2] = 1;
  operatorPanPatch.aurum.operators[0].pan = -1;
  const panLeft = new Float32Array(4096);
  const panLeftOpposite = new Float32Array(4096);
  preview.renderInstrumentStereoSamples(operatorPanPatch, panLeft, panLeftOpposite, 48000, 220, "visual", false);
  operatorPanPatch.aurum.operators[0].pan = 1;
  const panRightOpposite = new Float32Array(4096);
  const panRight = new Float32Array(4096);
  preview.renderInstrumentStereoSamples(operatorPanPatch, panRightOpposite, panRight, 48000, 220, "visual", false);
  const channelEnergy = (samples) => samples.reduce((sum, sample) => sum + sample * sample, 0);
  assert.ok(channelEnergy(panLeft) > 0.01 && channelEnergy(panLeftOpposite) < 0.000001, "Hard-left Aurum operator pan must isolate the left channel");
  assert.ok(channelEnergy(panRight) > 0.01 && channelEnergy(panRightOpposite) < 0.000001, "Hard-right Aurum operator pan must isolate the right channel");

  const renderFilterPatch = (patch) => {
    const samples = new Float32Array(4096);
    preview.renderInstrumentSamples(patch, samples, 48000, 220, "visual", false);
    return samples;
  };
  const filterAOnlyPatch = structuredClone(instrument);
  filterAOnlyPatch.aurum.filters[0] = { enabled: true, type: "lowpass", cutoff: 0.32, resonance: 0.18, drive: 0.12 };
  filterAOnlyPatch.aurum.filters[1].enabled = false;
  const filterAOnly = renderFilterPatch(filterAOnlyPatch);
  const filterSerialPatch = structuredClone(filterAOnlyPatch);
  filterSerialPatch.aurum.filters[1] = { enabled: true, type: "highpass", cutoff: 0.16, resonance: 0.22, drive: 0.08 };
  filterSerialPatch.aurum.outputSends[0][1] = 0.54;
  filterSerialPatch.aurum.filterRouting = "serial";
  const filterSerial = renderFilterPatch(filterSerialPatch);
  const filterParallelPatch = structuredClone(filterSerialPatch);
  filterParallelPatch.aurum.filterRouting = "parallel";
  const filterParallel = renderFilterPatch(filterParallelPatch);
  const filterDifference = (a, b) => a.reduce((sum, sample, index) => sum + Math.abs(sample - b[index]), 0) / a.length;
  assert.ok(filterDifference(filterAOnly, filterSerial) > 0.005, "Enabling Filter B in series must alter Aurum output");
  assert.ok(filterDifference(filterSerial, filterParallel) > 0.005, "Serial and Parallel routing must produce distinct output");
  assert.ok([...filterSerial, ...filterParallel].every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1), "Dual-filter routing must remain finite and bounded");

  const directPatch = structuredClone(instrument);
  directPatch.aurum.outputSends = Array.from({ length: 6 }, () => [0, 0, 0]);
  directPatch.aurum.outputSends[0][2] = 1;
  const directPositive = renderFilterPatch(directPatch);
  directPatch.aurum.outputSends[0][2] = -1;
  const directNegative = renderFilterPatch(directPatch);
  const directInversionResidual = directPositive.reduce((sum, sample, index) => sum + Math.abs(sample + directNegative[index]), 0) / directPositive.length;
  assert.ok(directInversionResidual < 0.0001, `Negative Direct sends must phase-invert the bypassed operator signal, got ${directInversionResidual}`);
  directPatch.aurum.outputSends[0][2] = 0;
  const disconnectedOutput = renderFilterPatch(directPatch);
  assert.ok(disconnectedOutput.every((sample) => Math.abs(sample) < 0.000001), "A patch with no output sends must remain silent");

  const malformedOperator = { ...instrument.aurum.operators[0], pan: 4, wavefold: 4, harmonics: [4, -4], pitchEnvelopeSemitones: 400, phaseEnvelopeDegrees: -400, velocityCurve: [4, -4], keytrackCurve: [-4, 4] };
  const malformed = aurum.normalizedAurumConfig({ ...instrument.aurum, oversampling: 9, filterRouting: "sideways", filters: [{ enabled: true, type: "not-a-filter", cutoff: 4, resonance: -4, drive: 4 }], outputSends: [[4, -4]], operators: [malformedOperator], matrix: [[4, -4]], rmMatrix: [[4, -4]] });
  assert.equal(malformed.operators.length, 6, "Normalization must restore missing operators");
  assert.equal(malformed.matrix[0][0], 1, "Normalization must clamp matrix values");
  assert.equal(malformed.matrix[0][1], -1, "Normalization must preserve and clamp negative matrix values");
  assert.equal(malformed.matrix[5].length, 7, "Normalization must restore matrix geometry");
  assert.equal(malformed.rmMatrix[0][0], 1, "Normalization must clamp positive RM values");
  assert.equal(malformed.rmMatrix[0][1], -1, "Normalization must preserve and clamp negative RM values");
  assert.equal(malformed.rmMatrix[5].length, 6, "Normalization must restore RM matrix geometry");
  assert.equal(malformed.operators[0].harmonics[0], 1, "Normalization must clamp positive harmonic amplitudes");
  assert.equal(malformed.operators[0].harmonics[1], 0, "Normalization must clamp negative harmonic amplitudes");
  assert.equal(malformed.operators[0].harmonics.length, 16, "Normalization must restore harmonic geometry");
  assert.equal(malformed.operators[0].wavefold, 1, "Normalization must clamp operator wavefold");
  assert.equal(malformed.operators[0].pan, 1, "Normalization must clamp operator pan");
  assert.equal(malformed.operators[0].pitchEnvelopeSemitones, 48, "Normalization must clamp positive pitch envelope depth");
  assert.equal(malformed.operators[0].phaseEnvelopeDegrees, -180, "Normalization must clamp negative phase envelope depth");
  assert.deepEqual(malformed.operators[0].velocityCurve, [1, 0, 1, 1, 1], "Normalization must clamp and restore velocity curve geometry");
  assert.deepEqual(malformed.operators[0].keytrackCurve, [0, 1, 1, 1, 1], "Normalization must clamp and restore keyboard curve geometry");
  assert.equal(malformed.oversampling, 4, "Normalization must clamp operator quality to a supported mode");
  assert.deepEqual(malformed.filters[0], { enabled: true, type: "lowpass", cutoff: 1, resonance: 0, drive: 1 }, "Normalization must clamp malformed Filter A values");
  assert.equal(malformed.filters[1].enabled, false, "Normalization must restore missing Filter B");
  assert.equal(malformed.filterRouting, "serial", "Normalization must restore malformed routing");
  assert.deepEqual(malformed.outputSends[0], [1, -1, 0], "Normalization must clamp and restore output-routing geometry");

  const versionSixConfig = structuredClone(instrument.aurum);
  versionSixConfig.version = 6;
  delete versionSixConfig.oversampling;
  const legacyFilter = { type: "bandpass", cutoff: 0.43, resonance: 0.27, drive: 0.19 };
  const versionSixMigrated = aurum.normalizedAurumConfig(versionSixConfig, legacyFilter);
  assert.equal(versionSixMigrated.version, 10, "Version 6 Aurum patches must migrate to schema version 10");
  assert.equal(versionSixMigrated.oversampling, 1, "Version 6 Aurum patches must retain their 1x operator network sound");
  assert.deepEqual(versionSixMigrated.filters[0], { enabled: true, ...legacyFilter }, "Legacy Aurum patches must migrate their shared output filter into Filter A");
  assert.equal(versionSixMigrated.filters[1].enabled, false, "Legacy Aurum patches must migrate with Filter B bypassed");
  assert.deepEqual(versionSixMigrated.outputSends[0], [versionSixConfig.matrix[0][6], 0, 0], "Serial legacy patches must migrate their OUT column into Filter A");

  const versionEightParallel = structuredClone(instrument.aurum);
  versionEightParallel.version = 8;
  versionEightParallel.filterRouting = "parallel";
  delete versionEightParallel.outputSends;
  const versionEightParallelMigrated = aurum.normalizedAurumConfig(versionEightParallel, legacyFilter);
  assert.deepEqual(versionEightParallelMigrated.outputSends[0], [versionEightParallel.matrix[0][6], versionEightParallel.matrix[0][6], 0], "Parallel v8 patches must preserve their shared input to both filters");

  const versionNineConfig = structuredClone(instrument.aurum);
  versionNineConfig.version = 9;
  versionNineConfig.operators.forEach((operator) => delete operator.pan);
  const versionNineMigrated = aurum.normalizedAurumConfig(versionNineConfig);
  assert.ok(versionNineMigrated.operators.every((operator) => operator.pan === 0), "Version 9 operators must migrate to centered pan");

  const versionFiveConfig = structuredClone(versionSixConfig);
  versionFiveConfig.version = 5;
  versionFiveConfig.operators.forEach((operator) => {
    delete operator.velocityCurve;
    delete operator.keytrackCurve;
  });
  const versionFiveMigrated = aurum.normalizedAurumConfig(versionFiveConfig);
  assert.equal(versionFiveMigrated.version, 10, "Version 5 Aurum patches must migrate to schema version 10");
  assert.ok(versionFiveMigrated.operators.every((operator) => operator.velocityCurve.every((value) => value === 1) && operator.keytrackCurve.every((value) => value === 1)), "Version 5 response curves must migrate at neutral gain");

  const versionFourConfig = structuredClone(versionFiveConfig);
  versionFourConfig.version = 4;
  versionFourConfig.operators.forEach((operator) => {
    delete operator.pitchEnvelope;
    delete operator.pitchEnvelopeSemitones;
    delete operator.phaseEnvelope;
    delete operator.phaseEnvelopeDegrees;
  });
  const versionFourMigrated = aurum.normalizedAurumConfig(versionFourConfig);
  assert.equal(versionFourMigrated.version, 10, "Version 4 Aurum patches must migrate to schema version 10");
  assert.ok(versionFourMigrated.operators.every((operator) => operator.pitchEnvelopeSemitones === 0 && operator.phaseEnvelopeDegrees === 0), "Version 4 articulation must migrate at neutral depth");

  const versionThreeConfig = structuredClone(versionFourConfig);
  versionThreeConfig.version = 3;
  versionThreeConfig.operators.forEach((operator) => delete operator.wavefold);
  const versionThreeMigrated = aurum.normalizedAurumConfig(versionThreeConfig);
  assert.equal(versionThreeMigrated.version, 10, "Version 3 Aurum patches must migrate to schema version 10");
  assert.ok(versionThreeMigrated.operators.every((operator) => operator.wavefold === 0), "Version 3 operators must migrate with identity waveshaping");
  const legacyConfig = structuredClone(versionThreeConfig);
  legacyConfig.version = 2;
  legacyConfig.operators.forEach((operator) => delete operator.harmonics);
  const migrated = aurum.normalizedAurumConfig(legacyConfig);
  assert.equal(migrated.version, 10, "Version 2 Aurum patches must migrate through additive support to schema version 10");
  assert.ok(migrated.operators.every((operator) => operator.harmonics[0] === 1 && operator.harmonics.slice(1).every((value) => value === 0)), "Migrated operators must add a fundamental-only spectrum without changing sound");
  const versionOneConfig = structuredClone(legacyConfig);
  versionOneConfig.version = 1;
  delete versionOneConfig.rmMatrix;
  const versionOneMigrated = aurum.normalizedAurumConfig(versionOneConfig);
  assert.ok(versionOneMigrated.rmMatrix.every((row) => row.length === 6 && row.every((value) => value === 0)), "Version 1 patches must retain an inactive RM matrix during migration");
  assert.deepEqual(aurum.drawAurumHarmonicLine(Array(16).fill(0), 0, 1, 3, 0.25).slice(0, 4), [1, 0.75, 0.5, 0.25], "Harmonic drawing must interpolate crossed bins");

  assert.equal(interaction.aurumTabIndexAfterKey(0, "ArrowRight"), 1, "Right arrow must advance from Main to OP 1");
  assert.equal(interaction.aurumTabIndexAfterKey(6, "ArrowRight"), 0, "Right arrow must wrap from OP 6 to Main");
  assert.equal(interaction.aurumTabIndexAfterKey(0, "ArrowLeft"), 6, "Left arrow must wrap from Main to OP 6");
  assert.equal(interaction.aurumTabIndexAfterKey(3, "Home"), 0, "Home must select Main");
  assert.equal(interaction.aurumTabIndexAfterKey(3, "End"), 6, "End must select OP 6");

  console.log("Aurum verifier passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

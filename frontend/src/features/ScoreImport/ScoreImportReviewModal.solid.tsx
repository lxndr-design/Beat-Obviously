import { For, Show } from "solid-js";
import {
  closeScoreImportReview,
  installScoreImport,
  openScoreOcrReview,
  revealScoreOcrArtifacts,
  scoreImportReview,
  updateScoreImportReview,
} from "../../scoreImport/scoreImportAction";
import { appAlert, Button, Icon, Modal, Toggle } from "../../solid-ui";
import styles from "./ScoreImportReviewModal.module.css";

export function ScoreImportReviewModal() {
  const review = scoreImportReview;

  function togglePart(id: string, enabled: boolean) {
    const current = review();
    if (!current) return;
    const selected = new Set(current.selectedPartIds);
    if (enabled) selected.add(id);
    else selected.delete(id);
    updateScoreImportReview({ selectedPartIds: [...selected] });
  }

  async function install() {
    try {
      await installScoreImport();
    } catch (error) {
      await appAlert(error instanceof Error ? error.message : "Score import failed.", "Import Sheet Music");
    }
  }

  async function runReviewAction(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      await appAlert(error instanceof Error ? error.message : "Score OCR review action failed.", "Import Sheet Music");
    }
  }

  return (
    <Modal
      open={Boolean(review())}
      scopeId="score-import-review"
      title={<><Icon name="ph:music-notes" size={18} decorative />Import Sheet Music</>}
      subtitle="Review parts and mapping before adding editable tracks. PDF/image sources are converted locally by the best available score-recognition engine."
      width="lg"
      closeOnEscape
      onClose={closeScoreImportReview}
      footer={(
        <>
          <Button variant="ghost" onClick={closeScoreImportReview}>Cancel</Button>
          <Button variant="primary" onClick={() => void install()}>Add Selected Tracks</Button>
        </>
      )}
    >
      <Show when={review()} keyed>{(state) => (
        <div class={styles.body}>
          <div class={styles.summary}>
            <div>
              <strong>{state.plan.title}</strong>
              <span>{state.plan.composer || "Composer not specified"}</span>
            </div>
            <div class={styles.badges}>
              <span>{scoreSourceLabel(state.sourceMethod)}</span>
              <Show when={state.adaptiveRecovery}><span>Page recovery</span></Show>
              <span>{state.plan.quality.status === "ready" ? "Timing ready" : "Review timing"}</span>
              <span>{state.plan.quality.verifiedMeasureCount} verified · {state.plan.quality.repairedMeasureCount} repaired · {state.plan.quality.reviewMeasureCount} unresolved</span>
              <span>{Math.round(state.plan.quality.repeatCoverageRatio * 100)}% repeated material looped</span>
            </div>
          </div>

          <Show when={state.ocrArtifacts} keyed>{(artifacts) => (
            <div class={styles.ocrArtifacts}>
              <div>
                <strong>Retained OCR review files</strong>
                <span>
                  OCR log: {artifacts.warningCount} warnings, {artifacts.errorCount} errors, {artifacts.exceptionCount} exceptions.
                  {state.adaptiveRecovery
                    ? " The folder contains every recovered page range and its exported MusicXML."
                    : " The recognition artifacts and exported MusicXML remain outside the song project."}
                </span>
              </div>
              <div class={styles.artifactActions}>
                <Button variant="ghost" onClick={() => void runReviewAction(revealScoreOcrArtifacts)}>Show Files</Button>
                <Show when={artifacts.omrPath}>
                  <Button variant="default" onClick={() => void runReviewAction(openScoreOcrReview)}>
                    {state.adaptiveRecovery ? "Open First Audiveris Range" : "Open in Audiveris"}
                  </Button>
                </Show>
              </div>
            </div>
          )}</Show>

          <Show when={state.plan.bpm}>
            <label class={styles.tempoRow}>
              <Toggle
                checked={state.applyScoreTempo}
                onChange={(checked) => updateScoreImportReview({ applyScoreTempo: checked })}
                aria-label="Use score tempo"
              />
              <span>Use score tempo ({Math.round(state.plan.bpm!)} BPM)</span>
            </label>
          </Show>
          <label class={styles.tempoRow}>
            <Toggle
              checked={state.addToGenerationLibrary}
              onChange={(checked) => updateScoreImportReview({ addToGenerationLibrary: checked })}
              aria-label="Learn this score's structure locally"
            />
            <span>Use its form, harmonic rhythm, and phrase shapes as a local jazz-generation reference</span>
          </label>
          <Show when={state.plan.quality.reviewMeasureCount > 0}>
            <label class={styles.tempoRow}>
              <Toggle
                checked={state.includeReviewMeasures}
                onChange={(checked) => updateScoreImportReview({ includeReviewMeasures: checked })}
                aria-label="Include unresolved measures"
              />
              <span>Include unresolved measures (off keeps their timeline positions but does not import their notes)</span>
            </label>
          </Show>

          <div class={styles.parts}>
            <For each={state.plan.parts}>{(part) => {
              const usable = part.pitchRange != null;
              const reviewCount = part.measures.filter((measure) => measure.timingStatus === "review").length;
              const repairedCount = part.measures.filter((measure) => measure.timingStatus === "repaired").length;
              return (
                <label class={`${styles.part} ${!usable ? styles.disabled : ""}`}>
                  <Toggle
                    checked={usable && state.selectedPartIds.includes(part.id)}
                    disabled={!usable}
                    onChange={(checked) => togglePart(part.id, checked)}
                    aria-label={`Import ${part.name}`}
                  />
                  <div>
                    <strong>{part.name}</strong>
                    <span>
                      {usable
                        ? `${part.percussion ? "Drumpad mapping" : `Playable range ${pitchName(part.pitchRange![0])}–${pitchName(part.pitchRange![1])}`} · ${part.segments.some((segment) => segment.repeats > 0) ? "repeats preserved as loops" : "through-composed"}`
                        : "No playable notation found"}
                      {usable && (reviewCount > 0 || repairedCount > 0) ? ` · ${reviewCount} unresolved, ${repairedCount} repaired` : ""}
                    </span>
                  </div>
                </label>
              );
            }}</For>
          </div>

          <Show when={state.plan.quality.reviewMeasureCount > 0}>
            <div class={styles.measureReview}>
              <strong>Unresolved measures</strong>
              <span>These require symbol or voice correction; Beat has not generated replacement notes.</span>
              <div class={styles.measureIssues}>
                <For each={reviewRows(state.plan.parts).slice(0, 60)}>{(row) => (
                  <div>
                    <b>{row.partName} · page {row.pageNumber} · measure {row.measureNumber}</b>
                    <span>{row.messages.join(" ")}</span>
                  </div>
                )}</For>
              </div>
              <Show when={state.plan.quality.reviewMeasureCount > 60}>
                <span>Showing the first 60 unresolved measures. Use the retained OCR files for complete correction.</span>
              </Show>
            </div>
          </Show>

          <Show when={state.plan.warnings.length > 0}>
            <div class={styles.warnings}>
              <strong>Needs review</strong>
              <For each={state.plan.warnings}>{(warning) => <span>{warning}</span>}</For>
            </div>
          </Show>
        </div>
      )}</Show>
    </Modal>
  );
}

function reviewRows(parts: NonNullable<ReturnType<typeof scoreImportReview>>["plan"]["parts"]) {
  return parts.flatMap((part) => part.measures
    .filter((measure) => measure.timingStatus === "review")
    .map((measure) => ({
      partName: part.name,
      pageNumber: measure.pageNumber,
      measureNumber: measure.number,
      messages: measure.issues.filter((issue) => issue.severity === "review").map((issue) => issue.message),
    })));
}

function pitchName(pitch: number) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

function scoreSourceLabel(source: NonNullable<ReturnType<typeof scoreImportReview>>["sourceMethod"]) {
  if (source === "audiveris") return "Audiveris OCR";
  if (source === "homr") return "homr OCR";
  if (source === "hybrid") return "Audiveris + homr OCR";
  return "MusicXML";
}

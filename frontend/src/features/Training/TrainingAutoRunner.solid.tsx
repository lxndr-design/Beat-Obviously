/** @jsxImportSource solid-js */
import { onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { maybeRunDueTraining, markTrainingComplete, markTrainingFailed } from "../../ai/trainingRunner";
import { onEvent } from "../../ipc/bridge";

export interface MountedTrainingAutoRunnerSolid {
  dispose: () => void;
}

export function mountTrainingAutoRunnerSolid(host: HTMLElement): MountedTrainingAutoRunnerSolid {
  const dispose = render(() => <TrainingAutoRunnerSolid />, host);
  return { dispose };
}

export function TrainingAutoRunnerSolid() {
  onMount(() => {
    void maybeRunDueTraining();
    const unsubscribe = onEvent((event) => {
      if (event.kind !== "training.status") return;
      if (event.status === "finished") {
        markTrainingComplete(event.task, event.signalCount);
      } else if (event.status === "failed") {
        markTrainingFailed(event.task, event.signalCount, event.message ?? "Training failed.");
      }
    });
    onCleanup(unsubscribe);
  });

  return null;
}

import { onCleanup, onMount } from "solid-js";
import { maybeRunDueTraining, markTrainingComplete, markTrainingFailed } from "../../ai/trainingRunner";
import { onEvent } from "../../ipc/bridge";

export function TrainingAutoRunner() {
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

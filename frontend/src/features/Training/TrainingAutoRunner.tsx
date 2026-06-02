import { useEffect } from "react";
import { maybeRunDueTraining, markTrainingComplete, markTrainingFailed } from "../../ai/trainingRunner";
import { onEvent } from "../../ipc/bridge";

export function TrainingAutoRunner() {
  useEffect(() => {
    void maybeRunDueTraining();
    return onEvent((event) => {
      if (event.kind !== "training.status") return;
      if (event.status === "finished") {
        markTrainingComplete(event.task, event.signalCount);
      } else if (event.status === "failed") {
        markTrainingFailed(event.task, event.signalCount, event.message ?? "Training failed.");
      }
    });
  }, []);

  return null;
}

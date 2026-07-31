import { isNative, send } from "../ipc/bridge";
import { useTransportStore } from "../state/store";
import { primeTimelineAudio, stopTimelineAudio } from "./timelineAudio";
import { stopAllBrowserAudio } from "./globalAudioSafety";

const TRANSPORT_ACK_TIMEOUT_MS = 1500;

function sendTransport(message: Parameters<typeof send>[0], onFailure?: () => void) {
  const startedAt = performance.now();
  let timeoutId = 0;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new Error(`${message.kind} was not acknowledged within ${TRANSPORT_ACK_TIMEOUT_MS} ms`)),
      TRANSPORT_ACK_TIMEOUT_MS,
    );
  });
  void Promise.race([send(message), timeout])
    .then(() => {
      window.clearTimeout(timeoutId);
      console.debug(`[Beat transport] ${message.kind} acknowledged in ${(performance.now() - startedAt).toFixed(1)} ms`);
    })
    .catch((error) => {
      window.clearTimeout(timeoutId);
      console.error(`[Beat transport] ${message.kind} failed`, error);
      onFailure?.();
    });
}

export function playTransport() {
  stopAllBrowserAudio();
  if (!isNative()) primeTimelineAudio();
  useTransportStore.getState().play();
  sendTransport({ kind: "transport.play" }, () => useTransportStore.getState().pause());
}

export function pauseTransport() {
  useTransportStore.getState().pause();
  stopTimelineAudio();
  stopAllBrowserAudio();
  sendTransport({ kind: "transport.pause" });
}

export function stopTransport() {
  const transport = useTransportStore.getState();
  transport.pause();
  transport.stop();
  stopTimelineAudio();
  stopAllBrowserAudio();
  sendTransport({ kind: "transport.stop" });
  sendTransport({ kind: "transport.seek", positionBeat: 0 });
}

export function restartTransport() {
  stopAllBrowserAudio();
  if (!isNative()) primeTimelineAudio();
  const transport = useTransportStore.getState();
  transport.setPosition(0);
  transport.play();
  sendTransport({ kind: "transport.restart" }, () => useTransportStore.getState().pause());
}

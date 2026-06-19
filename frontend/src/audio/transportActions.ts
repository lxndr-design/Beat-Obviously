import { isNative, send } from "../ipc/bridge";
import { useTransportStore } from "../state/store";
import { primeTimelineAudio, stopTimelineAudio } from "./timelineAudio";

function sendTransport(message: Parameters<typeof send>[0]) {
  void send(message).catch(() => undefined);
}

export function playTransport() {
  if (!isNative()) primeTimelineAudio();
  useTransportStore.getState().play();
  sendTransport({ kind: "transport.play" });
}

export function pauseTransport() {
  useTransportStore.getState().pause();
  stopTimelineAudio();
  sendTransport({ kind: "transport.pause" });
}

export function stopTransport() {
  const transport = useTransportStore.getState();
  transport.pause();
  transport.stop();
  stopTimelineAudio();
  sendTransport({ kind: "transport.stop" });
  sendTransport({ kind: "transport.seek", positionBeat: 0 });
}

export function restartTransport() {
  if (!isNative()) primeTimelineAudio();
  const transport = useTransportStore.getState();
  transport.setPosition(0);
  transport.play();
  sendTransport({ kind: "transport.restart" });
}

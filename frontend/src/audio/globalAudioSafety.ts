type GlobalAudioStopHandler = () => void;

const stopHandlers = new Set<GlobalAudioStopHandler>();

export function registerGlobalAudioStop(handler: GlobalAudioStopHandler): () => void {
  stopHandlers.add(handler);
  return () => stopHandlers.delete(handler);
}

export function stopAllBrowserAudio(): void {
  for (const handler of Array.from(stopHandlers)) {
    try {
      handler();
    } catch (error) {
      console.error("[Beat audio safety] Browser playback owner failed to stop", error);
    }
  }
}

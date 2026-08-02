import { createSignal } from "solid-js";
import type { Id } from "../../state/types";

export interface SegmentLandingGhost {
  segmentId: Id;
  targetTrackId: Id;
  startBeat: number;
  lengthBeats: number;
  name: string;
  color?: string;
}

const [landingGhosts, setLandingGhosts] = createSignal<SegmentLandingGhost[]>([], { equals: false });

export { landingGhosts as segmentLandingGhosts, setLandingGhosts as setSegmentLandingGhosts };

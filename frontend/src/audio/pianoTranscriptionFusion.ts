import type { AudioTranscriptionNote } from "../ipc/schema";

export interface PianoTranscriptionFusion {
  notes: AudioTranscriptionNote[];
  primaryCount: number;
  recoveryCandidateCount: number;
  recoveredCount: number;
}

const SAME_PITCH_ONSET_TOLERANCE_SECONDS = 0.12;
const CHORD_ONSET_TOLERANCE_SECONDS = 0.085;
const MINIMUM_RECOVERY_DURATION_SECONDS = 0.09;
const MINIMUM_RECOVERY_VELOCITY = 48;
const ISOLATED_RECOVERY_VELOCITY = 90;
const ISOLATED_RECOVERY_DURATION_SECONDS = 0.18;

/**
 * Keeps Transkun's interval-decoded piano performance as the source of truth,
 * then admits only high-confidence Basic Pitch events that look like a missed
 * strike. Same-pitch activity inside an existing interval is resonance, not a
 * new note. Chord-aligned candidates are safer than isolated candidates.
 */
export function fusePianoTranscriptions(
  primaryNotes: AudioTranscriptionNote[],
  recoveryNotes: AudioTranscriptionNote[],
): PianoTranscriptionFusion {
  const primary = primaryNotes.filter(validNote).map(cloneNote).sort(compareNotes);
  const candidates = recoveryNotes.filter(validNote).map(cloneNote).sort(compareNotes);
  const recovered: AudioTranscriptionNote[] = [];

  for (const candidate of candidates) {
    const duration = candidate.endSeconds - candidate.startSeconds;
    if (duration < MINIMUM_RECOVERY_DURATION_SECONDS || candidate.velocity < MINIMUM_RECOVERY_VELOCITY) continue;

    const accepted = primary.concat(recovered);
    const samePitchOnset = accepted.some((note) =>
      note.pitch === candidate.pitch
      && Math.abs(note.startSeconds - candidate.startSeconds) <= SAME_PITCH_ONSET_TOLERANCE_SECONDS,
    );
    if (samePitchOnset) continue;

    const samePitchIsRinging = accepted.some((note) =>
      note.pitch === candidate.pitch
      && note.startSeconds < candidate.startSeconds
      && note.endSeconds >= candidate.startSeconds - 0.04,
    );
    if (samePitchIsRinging) continue;

    const chordAligned = primary.some((note) =>
      Math.abs(note.startSeconds - candidate.startSeconds) <= CHORD_ONSET_TOLERANCE_SECONDS,
    );
    const isolatedStrongStrike = candidate.velocity >= ISOLATED_RECOVERY_VELOCITY
      && duration >= ISOLATED_RECOVERY_DURATION_SECONDS;
    if (!chordAligned && !isolatedStrongStrike) continue;

    const nextSamePitch = accepted
      .filter((note) => note.pitch === candidate.pitch && note.startSeconds > candidate.startSeconds)
      .sort(compareNotes)[0];
    if (nextSamePitch) {
      candidate.endSeconds = Math.min(candidate.endSeconds, Math.max(candidate.startSeconds + 0.03, nextSamePitch.startSeconds));
    }
    recovered.push(candidate);
  }

  const notes = primary.concat(recovered).sort(compareNotes);
  return {
    notes,
    primaryCount: primary.length,
    recoveryCandidateCount: candidates.length,
    recoveredCount: recovered.length,
  };
}

function validNote(note: AudioTranscriptionNote) {
  return Number.isFinite(note.startSeconds)
    && Number.isFinite(note.endSeconds)
    && note.startSeconds >= 0
    && note.endSeconds > note.startSeconds
    && Number.isFinite(note.pitch)
    && note.pitch >= 0
    && note.pitch <= 127
    && Number.isFinite(note.velocity);
}

function cloneNote(note: AudioTranscriptionNote): AudioTranscriptionNote {
  return { ...note, pitchBends: [...note.pitchBends] };
}

function compareNotes(a: AudioTranscriptionNote, b: AudioTranscriptionNote) {
  return a.startSeconds - b.startSeconds || a.pitch - b.pitch || a.endSeconds - b.endSeconds;
}

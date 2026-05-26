/**
 * Domain types for Beat.
 *
 * Mirror these (in spirit) on the C++ side in backend/Source/Ipc/Schema.h.
 * IDs are short stable string identifiers (nanoid). Beat-positions are
 * floats measured in beats from project start (1 beat = 1/4 note).
 */
/**
 * Master EQ automation point — 7-band graphic EQ.
 *
 * Standard graphic-EQ band centers used here:
 *   80 Hz | 200 Hz | 500 Hz | 1.25 kHz | 3 kHz | 6 kHz | 16 kHz
 *
 * `bandsDb` indexes match `EQ_BAND_CENTERS_HZ`. Per-band range ±24 dB.
 */
export const EQ_BAND_CENTERS_HZ = [80, 200, 500, 1250, 3000, 6000, 16000];
export const EQ_BAND_LABELS = ["Low", "Lo-Mid", "Mid", "Up-Mid", "Hi-Mid", "High", "Air"];
export const EQ_BAND_COUNT = 7;

#!/usr/bin/env python3
"""Emit classified MIDI-style drum events from an isolated drum stem."""

from __future__ import annotations

import argparse
import json

import librosa
import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--sample-rate", type=int, default=22050)
    parser.add_argument("--hop-length", type=int, default=256)
    parser.add_argument("--delta", type=float, default=0.05)
    args = parser.parse_args()

    audio, sample_rate = librosa.load(args.audio_path, sr=args.sample_rate, mono=True)
    onset_envelope = librosa.onset.onset_strength(
        y=audio,
        sr=sample_rate,
        hop_length=args.hop_length,
        aggregate=np.median,
    )
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset_envelope,
        sr=sample_rate,
        hop_length=args.hop_length,
        units="frames",
        backtrack=False,
        delta=args.delta,
        wait=1,
    )

    spectrum = np.abs(librosa.stft(audio, n_fft=2048, hop_length=args.hop_length))
    frequencies = librosa.fft_frequencies(sr=sample_rate, n_fft=2048)
    low_mask = frequencies < 180
    mid_mask = (frequencies >= 180) & (frequencies < 2500)
    high_mask = frequencies >= 2500
    positive_strengths = onset_envelope[onset_frames]
    strength_scale = float(np.percentile(positive_strengths, 95)) if positive_strengths.size else 1.0
    strength_scale = max(strength_scale, 1e-6)

    events: list[dict[str, float | int | str]] = []
    for frame in onset_frames:
        frame_index = min(int(frame), spectrum.shape[1] - 1)
        start = max(0, frame_index - 1)
        stop = min(spectrum.shape[1], frame_index + 3)
        local = np.square(spectrum[:, start:stop]).mean(axis=1)
        low = float(local[low_mask].sum())
        mid = float(local[mid_mask].sum())
        high = float(local[high_mask].sum())
        total = max(low + mid + high, 1e-12)
        low_ratio, mid_ratio, high_ratio = low / total, mid / total, high / total
        centroid = float((local * frequencies).sum() / max(local.sum(), 1e-12))
        strength = float(onset_envelope[min(frame_index, len(onset_envelope) - 1)])
        velocity = int(round(45 + 82 * min(1.0, strength / strength_scale)))
        start_seconds = float(librosa.frames_to_time(frame_index, sr=sample_rate, hop_length=args.hop_length))

        candidates: list[tuple[str, int, float, float]] = []
        if low_ratio >= 0.22 or centroid < 520:
            candidates.append(("kick", 36, 0.11, low_ratio))
        if mid_ratio >= 0.31 and (centroid >= 360 or low_ratio < 0.42):
            candidates.append(("snare", 38, 0.085, mid_ratio))
        if high_ratio >= 0.18 or centroid > 2600:
            candidates.append(("hat", 42, 0.045, high_ratio))

        if not candidates:
            strongest = max(
                [(low_ratio, "kick", 36, 0.11), (mid_ratio, "snare", 38, 0.085), (high_ratio, "hat", 42, 0.045)],
                key=lambda item: item[0],
            )
            candidates.append((strongest[1], strongest[2], strongest[3], strongest[0]))

        for kind, pitch, duration, band_ratio in candidates:
            layer_velocity = max(35, min(127, round(velocity * (0.72 + min(0.28, band_ratio)))))
            events.append(
                {
                    "kind": kind,
                    "pitch": pitch,
                    "startSeconds": start_seconds,
                    "endSeconds": start_seconds + duration,
                    "velocity": layer_velocity,
                }
            )

    events.sort(key=lambda event: (event["startSeconds"], event["pitch"]))
    counts = {kind: sum(event["kind"] == kind for event in events) for kind in ("kick", "snare", "hat")}
    print(json.dumps({"events": events, "counts": counts}, separators=(",", ":")))


if __name__ == "__main__":
    main()

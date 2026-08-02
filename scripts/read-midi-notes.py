#!/usr/bin/env python3
"""Emit note events from a MIDI file as compact JSON on stdout."""

from __future__ import annotations

import argparse
import json

import pretty_midi


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("midi_path")
    args = parser.parse_args()

    midi = pretty_midi.PrettyMIDI(args.midi_path)
    events = [
        {
            "startSeconds": note.start,
            "endSeconds": note.end,
            "pitch": note.pitch,
            "velocity": note.velocity,
            "pitchBends": [],
        }
        for instrument in midi.instruments
        if not instrument.is_drum
        for note in instrument.notes
    ]
    events.sort(key=lambda event: (event["startSeconds"], event["pitch"], event["endSeconds"]))
    print(json.dumps(events, separators=(",", ":")))


if __name__ == "__main__":
    main()

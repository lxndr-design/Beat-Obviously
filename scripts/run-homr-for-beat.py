#!/usr/bin/env python3
"""Run an installed homr while keeping orchestral MusicXML MIDI channels valid."""

from __future__ import annotations

from typing import Any

from musicxml.xmlelement import xmlelement as mxl


_original_midi_channel = mxl.XMLMidiChannel


def _beat_midi_channel(*args: Any, **kwargs: Any) -> Any:
    """MusicXML channels are 1-16; notation parts may legitimately exceed 16."""
    value = kwargs.get("value_")
    if isinstance(value, int) and value > 16:
        kwargs["value_"] = ((value - 1) % 16) + 1
    return _original_midi_channel(*args, **kwargs)


mxl.XMLMidiChannel = _beat_midi_channel

from homr.main import main  # noqa: E402  imported after the compatibility patch


if __name__ == "__main__":
    main()

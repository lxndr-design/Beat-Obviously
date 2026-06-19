---
name: feedback-design-system
description: Strict design constraints for the Beat app UI. Deviations break the visual language the user explicitly designed.
metadata:
  type: feedback
---

The Beat app UI follows a strict, deliberately constrained visual language. Treat these as hard rules, not suggestions.

**The rules:**
- Colors: **only** `#000` and `#fff`. No grays except for one specific exception: very-low-opacity gridlines *inside* objects (tracks, segments, timeline). Never on buttons, borders, text.
- Font: Akzidenz Grotesk Next base. Compact UI starts at 11px, with display sizes up to 90px. Do not scale type with viewport width.
- Grid: 8px base unit. Every layout dimension is a multiple of 8.
- Outlines: buttons get **no** outline by default. Outlines are reserved for *delineating grid structure* (page sections, window borders, column dividers).
- Transitions: use shared `--interaction-*` and approved motion tokens. Hover is a light tint, never full color inversion. No decorative fades except approved playback or loading states.
- Columns: fill the entire column width — grid selectors don't fit-to-content, they enforce structure.
- Icons: Iconify only, single icon set (never mix sets).
- Images: B&W bitmap with pre-applied dither. Only render the final dithered version.
- Track/segment playback animation: flash white, fade to black. MIDI elements: white outline, black fill.
- Modals: custom-built, match the same aesthetic. Save confirmation = `[Save, Don't Save, Cancel]`. Warnings = `[OK, Cancel]`. Editing anything opens a modal with unsaved-state tracking. Multiple modals can be open; the unsaved-check overlay shadows the whole window.

**Why:** The user designed this language deliberately and called it out at length. Deviations (e.g. a gray hover state, a non-Iconify icon, a button outline, a non-8px gap) immediately break the visual coherence and feel like sloppy work.

**How to apply:** Before adding any new component, check the design tokens at `frontend/src/design/tokens.css` and use the Solid primitives in `frontend/src/solid-ui/`. If a new pattern is genuinely needed, add it to the token system first and add a colocated `*.demo.solid.tsx`. See also [[project-beat]].

# Beat design system

Strict, deliberately narrow visual language. Read this before adding any UI.

## Hard rules

1. **Colors**: only `#000` and `#fff`. Three narrow exceptions:
   - **Text selection** (`::selection`) uses `--color-highlight` (light green `#a8ff8c`).
   - **Inside-object gridlines**: very-low-opacity white (`rgba(255,255,255,0.08–0.45)`) for subdivision lines.
   - **Hover on already-white surfaces** uses `--color-fg-hover` (off-white `rgba(255,255,255,0.78)`). Only valid when the surface is already in its "active/white" state (e.g. selected Solo button, MIDI segment body). Hover on black-bodied things still uses pure color-invert.

   None of these appear on standalone or default-state surfaces.
2. **Font**: Helvetica Neue (system fallback chain in `tokens.css`). Sizes are an 8-step ramp: `16, 20, 24, 32, 40, 56, 72, 90`. No 14, no 18, no 100.
3. **Spacing**: 8px base unit. Every gap, padding, margin, width, height is a multiple of 8. Half-units (4px) are banned except for 1px borders.
4. **Outlines**: buttons get **none**. Outlines/borders exist only to delineate grid structure — page sections, window borders, column dividers, modal frames. Always 1px solid `#fff` or `#000`.
5. **Transitions**:
   - Hover-info reveal: `0.1s` ease-out.
   - Color invert: `0.1s` linear (button hover, toggle states).
   - Sliding: `0.2s cubic-bezier(0.4, 0, 0.2, 1)` (modal enter, panel slide).
   - Track/segment playback flash: `0.05s` flash to white, `0.4s` fade to black.
   - That's the entire transition vocabulary. Do not invent more.
6. **Columns fill width**: grid selectors, list items, etc. always stretch to the column's full width. Never fit-to-content.
7. **Icons**: Iconify only. Single set: **`ph`** (Phosphor) by default. Do not mix in `mdi`, `lucide`, etc. on the same screen.
8. **Images**: all raster images render as B&W bitmaps with a pre-applied dither (see `<DitheredImage>`). Display only the dithered result.
9. **MIDI elements**: white outline on black fill (e.g., the white-outlined boxes in piano roll views).
10. **Modal behavior**:
    - Save confirmation: `[Save] [Don't Save] [Cancel]`.
    - Warning / notification: `[OK] [Cancel]`.
    - Editing anything opens a new modal; modal tracks its own dirty state.
    - Multiple modals may be open. The unsaved-check overlay shadows the *whole window* (`rgba(0,0,0,0.6)` over everything including other modals).

## Files

- [`tokens.css`](./tokens.css) — every CSS custom property
- [`reset.css`](./reset.css) — element reset
- [`typography.css`](./typography.css) — font face, sizes, line-heights
- [`layout.css`](./layout.css) — shared app/editor layout primitives
- [`surfaces.css`](./surfaces.css) — shared panel, section, row, and frame primitives
- [`forms.css`](./forms.css) — shared field/control primitives
- [`animations.css`](./animations.css) — keyframes + transition shorthand classes
- [`global.css`](./global.css) — entry point; imports the others

## How to add a new component

1. Open `tokens.css` and check if existing tokens cover what you need.
2. If not, add the token first (and justify it here in this README).
3. Check `layout.css`, `surfaces.css`, and `forms.css` before creating repeated panel, grid, or field styles.
4. Build reusable primitives in `components/<Name>/` consuming tokens via `var(--token)`.
5. Keep feature-only layout in that feature's CSS module.
6. Never hardcode `#000`, `#fff`, `16px`, etc. — always go through tokens.
7. Add a story/demo entry in `components/<Name>/<Name>.demo.tsx` so the component is exercisable.

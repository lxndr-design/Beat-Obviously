# Beat UI kit

Beat uses a narrow, monochrome DAW interface system. This document is the source
of truth for visual rules, component usage, accessibility expectations, and how
to extend the kit without drifting.

## Status

The kit is implemented in three layers:

1. **Foundations** in `frontend/src/design/*.css`.
2. **Shared Solid primitives** in `frontend/src/solid-ui`.
3. **Feature composition** in `frontend/src/features`.

Every shared Solid component must have a colocated `*.demo.solid.tsx` file, and
every demo must be included by `frontend/src/design/SolidUiKitCatalog.solid.tsx`.

## Foundations

### Color

Default UI is black and white:

- `--color-bg`: black
- `--color-fg`: white
- `--color-bg-inverse`: white
- `--color-fg-inverse`: black

Allowed exceptions:

- `--color-highlight` for text selection only.
- `--color-scrim` for modal and unsaved-state overlays.
- `--color-fg-hover` for hover on surfaces that are already foreground-filled.
- `--grid-line-*` and `--surface-*` for dense editor internals, browser rows,
  waveform grids, timeline subdivisions, and secondary data marks.

Do not introduce hue. If a feature needs status, use copy, iconography, position,
or monochrome emphasis before adding a token.

### Typography

Use `--font-family-base` for UI and `--font-family-mono` for technical readouts.
The base UI face is Akzidenz Grotesk Next, bundled from `public/assets/fonts/`
with light, regular, italic, medium, and bold faces.

Compact DAW UI tokens:

- `--font-size-hint`: 10px, non-interactive hints and ticks only.
- `--font-size-ui`: 11px, dense controls and compact rows.
- `--font-size-ui-lg`: 14px, larger dense controls.
- `--font-size-section`: 16px, section labels and standard readable text.
- `--font-size-title`: 18px, compact modal and panel titles.

Editorial/display ramp:

- `--font-size-1` through `--font-size-8`: 16, 20, 24, 32, 40, 56, 72, 90px.

Do not scale type with viewport width. Use `letter-spacing: var(--letter-spacing-*)`.

### Spacing

The base unit is 8px. Use `--space-*` tokens for gaps, padding, margins, fixed
control dimensions, and layout rhythm.

Allowed non-8px values:

- `1px` borders and gridlines.
- Tokenized compact control sizes that already exist in `tokens.css`.
- Geometry that is derived from audio/time data, SVG paths, or rendered waveforms.

### Borders

Borders delineate structure. Use `--border-fg` and `--border-bg`.

Buttons do not get resting outlines. Inputs, panels, modal frames, timeline grids,
and section dividers may use 1px structural borders.

### Motion

Use only the transition vocabulary in `tokens.css`:

- `--transition-invert` for color inversion.
- `--transition-slide-x` and `--transition-slide-y` for panels and modals.
- `--transition-opacity` for hover info.
- Playback flash uses `--duration-flash` then `--duration-fade`.

Do not add decorative fades, bounces, spring motion, or arbitrary easing.

### Icons

Use `<Icon>` from `solid-ui/Icon`. Icon names must use the `ph:` Iconify set.
Do not mix icon sets in product UI.

Decorative icons must pass `decorative`. Informational icons need a `title` or
an accessible label from the surrounding control.

### Images

Raster imagery must render as dithered black-and-white output through
`<DitheredImage>`. Do not display the original color image in product UI.

## CSS Files

- `tokens.css`: tokens and theme inversion.
- `reset.css`: element reset and baseline focus behavior.
- `typography.css`: font sizing utilities.
- `layout.css`: app shells, rows, stacks, grids, scrolling, and toolbars.
- `surfaces.css`: frames, panels, sections, row items, and empty states.
- `forms.css`: field, label, input, textarea, select, and range primitives.
- `animations.css`: approved keyframes and transition utility classes.
- `global.css`: import entry point; import order matters.

## Shared Components

Use shared Solid components before styling feature-local controls.

| Component | Use For | Required States |
| --- | --- | --- |
| `ActionFooter` | Modal/action button rows | start/end alignment |
| `AppDialog` | App-wide alert, confirm, and prompt flows | alert, confirm, prompt |
| `Block` | Section frames and structured panels | framed/unframed, title, actions, padding |
| `Button` | Commands, icon buttons, selected toggles | default, primary, ghost, danger, disabled, icon-only |
| `ContextMenu` | Pointer and keyboard-invoked menus | disabled item, submenu, separators |
| `DitheredImage` | Raster preview imagery | loading, success, failure fallback |
| `FloatingLayer` | Portaled popovers | positioned layer with role |
| `FloatingSelect` | Compact selects in constrained panels | open, selected, long labels |
| `HoverInfo` | Tooltips and compact hover detail | hover/focus, viewport clamping |
| `Icon` | All product icons | decorative and labelled |
| `Knob` | Continuous synth/audio parameters | small/medium/large, bipolar, edited, modulation |
| `MarqueeText` | Single-line overflowing labels | short and overflow text |
| `Modal` | Editors and confirmations | stacked, dirty, footer, close controls |
| `NumberInput` | Numeric fields | clamping, unit, arrow-key stepping |
| `RadioGroup` | Mutually exclusive modes | selected, disabled |
| `RowItem` | Library/browser list rows | compact/media density, drag/icon/meta/action slots |
| `SectionRibbon` | Sidebar/panel headers | expanded/collapsed, count, actions |
| `Tag` | Compact tinted metadata labels and counters | numeric/text content, inherited context |
| `TextInput` | Text fields | stacked, inline, bare, unit |
| `Toggle` | Binary settings | on, off, disabled |

## Accessibility

Baseline expectations:

- Native controls stay native where possible.
- Icon-only controls require `aria-label`.
- Modal roots use `role="dialog"` and `aria-modal="true"`.
- Sliders expose `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and label.
- Menus use `role="menu"` / `role="menuitem"`; listbox selects use
  `role="listbox"` / `role="option"`.
- Disabled controls use native `disabled` where possible.
- Keyboard behavior must be documented in the component comment or demo when it
  differs from browser defaults.
- Focus should remain visible for inputs and complex controls. Buttons may avoid
  resting outlines, but keyboard-only operation must still be possible.

## Component Demo Requirements

Each shared Solid component folder must include `<Component>.demo.solid.tsx`.

A demo should show:

- Default state.
- Primary variants or sizes.
- Disabled/empty/error states when applicable.
- Keyboard or accessibility-specific behavior when non-obvious.
- Realistic copy from the DAW domain, not lorem ipsum.

The demo is not a marketing page. It is a compact inspection surface for
engineers and designers.

## Adding Or Changing UI

1. Check `tokens.css` first.
2. Check `layout.css`, `surfaces.css`, and `forms.css` before adding CSS.
3. Prefer an existing shared component.
4. If a new shared primitive is needed, add it under `solid-ui/<Name>/`.
5. Add `<Name>.demo.solid.tsx`.
6. Add the demo to `design/SolidUiKitCatalog.solid.tsx`.
7. Run `npm run verify:design-system`.
8. Run `npm run typecheck` and `npm run build`.

## Enforcement

`npm run verify:design-system` checks that:

- Every shared component has a demo.
- Every demo is included in `SolidUiKitCatalog.solid.tsx`.
- Source files do not import deprecated `@iconify/react` bindings.
- The removed `frontend/src/components` compatibility namespace does not reappear.
- The removed `frontend/src/react-bridge` compatibility namespace does not reappear.
- Legacy `mount*Solid` / `Mounted*Solid` bridge APIs do not reappear.
- Non-Phosphor icon names are not used in source.
- Shared component CSS does not introduce new hex colors outside design files.
- Legacy JSX files under `frontend/src` are either Solid-suffixed or removed.

The verifier is intentionally conservative. If it flags a legitimate new pattern,
add a token and update this document in the same change.

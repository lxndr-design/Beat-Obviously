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

The product palette is monochrome only: black, white, and grayscale values
derived from black or white. Do not introduce hue in product UI.

- `--color-bg`: black
- `--color-fg`: white
- `--color-bg-inverse`: white
- `--color-fg-inverse`: black

Allowed grayscale-only supporting tokens:

- `--color-highlight` for text selection only. It must remain white/black.
- `--color-scrim` for modal and unsaved-state overlays. It must remain black
  with alpha.
- `--color-fg-hover` for hover on surfaces that are already foreground-filled.
  It must remain grayscale.
- `--grid-line-*` and `--surface-*` for dense editor internals, browser rows,
  waveform grids, timeline subdivisions, and secondary data marks. They must be
  grayscale values derived from `--color-bg` / `--color-fg`.

If a feature needs status, use copy, iconography, position, shape, opacity,
weight, or monochrome emphasis. Playback feedback, warning states, previews,
plugin marks, node cables, and generated assets must also stay grayscale.

### Typography

Use `--font-family-base` for every text surface, including technical readouts
and dense numeric/editor controls. Beat has no separate technical typeface
path. The locally bundled Almarai family provides Light, Regular, Bold, and
ExtraBold faces from `public/assets/fonts/`.

Compact DAW UI tokens:

- `--font-size-hint`: 10px, non-interactive hints and ticks only.
- `--font-size-ui`: 11px, dense controls and compact rows.
- `--font-size-field-label`: 12px, untruncated input and dropdown labels.
- `--field-label-inset`: 6px, left inset for inline labeled fields.
- `--structural-muted-opacity`: 54%, shared opacity for non-interactive block titles and borders.

`LibrarySearch` is the full-width filtering row placed directly below library section ribbons.

App themes are selected with `html[data-theme="dark|light|mellow"]`. Dark is the default token set; Light reverses the monochrome palette, and Mellow uses a softer graphite-gray base. Theme variants override palette and interaction tokens without changing component CSS.
- `--font-size-ui-lg`: 14px, larger dense controls.
- `--font-size-section`: 16px, section labels and standard readable text.
- `--font-size-title`: 18px, compact modal and panel titles.

Editorial/display ramp:

- `--font-size-1` through `--font-size-6`: 16, 20, 24, 32, 40, 56px.

Do not scale type with viewport width. Use `letter-spacing: var(--letter-spacing-*)`.

### Spacing

The base unit is 3px. Use `--space-*` tokens for gaps, padding, margins, fixed
control dimensions, and layout rhythm.

Allowed non-3px values:

- `1px` borders and gridlines.
- `0.5px` and `1px` optical offsets used to align those strokes.
- Geometry that is derived from audio/time data, SVG paths, or rendered waveforms.

### Borders

Borders delineate structure. Use `--border-fg` and `--border-bg`.

Buttons do not get resting outlines. Inputs, panels, modal frames, timeline grids,
and section dividers may use 1px structural borders.

### Motion

Use only the transition vocabulary in `tokens.css`:

- `--interaction-transition` for hover, press, selected, and focus feedback.
- `--transition-slide-x` and `--transition-slide-y` for panels and modals.
- `--transition-opacity` for hover info.
- Playback flash uses `--duration-flash` then `--duration-fade`.

Do not add decorative fades, bounces, spring motion, or arbitrary easing.

### Interaction States

Hover is a light tint, never a full color inversion. Pressed states use
`--interaction-pressed-bg` plus the shared press transform. Selected or active
states use `--interaction-active-*` tokens and only dim on hover. New controls
should consume these tokens through the Solid UI kit primitives when possible.

Low-opacity tints use the mesh presets in `tokens.css`, not flat white fills.
Shared primitives assign stable seeded variants via `data-mesh-variant` so dense
lists, context menus, and clips do not repeat the same wash on every item.

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
| `FloatingSelect` | All dropdown fields and constrained-panel selects | stacked, inline, bare, disabled, searchable, open, selected, long labels |
| `HoverInfo` | Tooltips and compact hover detail | hover/focus, viewport clamping |
| `Icon` | All product icons | decorative and labelled |
| `Knob` | Continuous synth/audio parameters | small/medium/large, bipolar, edited, modulation |
| `MarqueeText` | Single-line overflowing labels | short and overflow text |
| `Modal` | Editors and confirmations | stacked, dirty, footer, close controls |
| `NumberInput` | Numeric fields | stacked, inline, editor, and bare layouts; clamping, unit, arrow-key stepping |
| `RowActionButton` | Row actions | standard and compact icon actions for `RowItem` |
| `LibraryFolder` | Asset grouping | shared expandable, renamable, droppable folder for library panels |
| `RadioGroup` | Mutually exclusive modes | selected, disabled |
| `RowItem` | Library/browser list rows | compact/media density, drag/icon/meta/action slots |
| `SectionRibbon` | Sidebar/panel headers | expanded/collapsed, count, actions |
| `Slider` | Native range controls | stacked, inline, bare, readout, disabled |
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
- `frontend/package.json` and Vite config do not reintroduce removed React-era
  packages or plugins.
- The removed `frontend/src/components` compatibility namespace does not reappear.
- The removed `frontend/src/react-bridge` compatibility namespace does not reappear.
- Migration-only feature `solid/` subfolders do not reappear.
- Migration-era `Solid` suffix identifiers do not reappear now that `.solid.tsx`
  is the framework marker.
- Legacy `mount*Solid` / `Mounted*Solid` bridge APIs do not reappear.
- Hover/click feedback uses `--interaction-*` tokens instead of direct surface
  hover/selected backgrounds.
- Non-Phosphor icon names are not used in source.
- Design tokens and component/feature CSS do not introduce hue; raw color
  literals must be black, white, or grayscale only.
- Legacy JSX files under `frontend/src` are either Solid-suffixed or removed.

The verifier is intentionally conservative. If it flags a legitimate new pattern,
add a token and update this document in the same change.

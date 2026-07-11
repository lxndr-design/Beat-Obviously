import { createSignal, For, Show, type JSX } from "solid-js";
import {
  Block,
  Button,
  createContextMenu,
  HoverInfo,
  Icon,
  Knob,
  FloatingSelect,
  Modal,
  NumberInput,
  RadioGroup,
  RowActionButton,
  RowItem,
  SectionRibbon,
  SectionRibbonActionButton,
  Slider,
  Tag,
  TextInput,
  Toggle,
} from "../solid-ui";
import styles from "./UiElementsSpecimen.module.css";

const typographyRows = [
  { name: "Hint", token: "--font-size-hint", sample: "10px timing ticks and passive hints" },
  { name: "UI", token: "--font-size-ui", sample: "11px dense controls, rows, compact labels" },
  { name: "Field label", token: "--font-size-field-label", sample: "12px input and dropdown titles" },
  { name: "UI large", token: "--font-size-ui-lg", sample: "14px larger dense controls" },
  { name: "Section", token: "--font-size-section", sample: "16px section labels and readable text" },
  { name: "Title", token: "--font-size-title", sample: "18px modal and panel titles" },
  { name: "Display 1", token: "--font-size-1", sample: "16px route and page content" },
  { name: "Display 2", token: "--font-size-2", sample: "20px compact hero text" },
  { name: "Display 3", token: "--font-size-3", sample: "24px major surfaces" },
];

const paletteRows = [
  ["Foreground", "--color-fg", "Primary text, selected fills, active icon fill"],
  ["Muted", "--color-muted", "Secondary text and passive metadata"],
  ["Border", "--border-fg", "Structural dividers and frames"],
  ["Inverse", "--color-bg-inverse", "Active button or selected control background"],
];

export function UiElementsSpecimen() {
  const [modalOpen, setModalOpen] = createSignal(false);
  const [ribbonOpen, setRibbonOpen] = createSignal(true);
  const [sectionOpen, setSectionOpen] = createSignal(false);
  const [toggleOn, setToggleOn] = createSignal(true);
  const [radioValue, setRadioValue] = createSignal<"mono" | "stereo">("stereo");
  const [sliderValue, setSliderValue] = createSignal(42);
  const [numberValue, setNumberValue] = createSignal(128);
  const [knobValue, setKnobValue] = createSignal(37);
  const [selectValue, setSelectValue] = createSignal("wavetable");
  const rowMenu = createContextMenu(() => [
    { label: "Edit item", icon: "ph:sliders-horizontal" },
    { label: "Duplicate", icon: "ph:plus" },
    { label: "Delete", icon: "ph:trash", separatorBefore: true },
  ]);

  return (
    <main class={styles.page}>
      {rowMenu.menu()}
      <header class={styles.hero}>
        <div>
          <p class={styles.eyebrow}>Beat design system</p>
          <h1>UI elements specimen</h1>
          <p class={styles.intro}>
            Compact reference page for primitives, state variants, composed DAW rows, modal surfaces, drag affordances, and typography scale.
          </p>
        </div>
        <div class={styles.heroActions}>
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            <Icon name="ph:plus" size={18} decorative />
            Open modal
          </Button>
          <HoverInfo content="Tooltips use HoverInfo and stay within the current dialog boundary." placement="left" delay={300}>
            <Button iconOnly aria-label="Show hover info">
              <Icon name="ph:gear" size={18} decorative />
            </Button>
          </HoverInfo>
        </div>
      </header>

      <SpecimenSection title="Typography And Tokens" note="Use the base UI family for interface copy and mono only for technical readouts.">
        <div class={styles.typographyGrid}>
          <For each={typographyRows}>
            {(row) => (
              <div class={styles.typeSample}>
                <span class={styles.typeName}>{row.name}</span>
                <span class={styles.typeToken}>{row.token}</span>
                <span class={styles.typeText} style={{ "font-size": `var(${row.token})` }}>{row.sample}</span>
              </div>
            )}
          </For>
        </div>
        <div class={styles.tokenGrid}>
          <For each={paletteRows}>
            {(row) => (
              <div class={styles.tokenSample}>
                <span class={styles.tokenSwatch} style={tokenStyle(row[1])} />
                <span>
                  <span class={styles.tokenName}>{row[0]}</span>
                  <span class={styles.tokenDesc}>{row[2]}</span>
                </span>
              </div>
            )}
          </For>
        </div>
      </SpecimenSection>

      <SpecimenSection title="Buttons And States" note="Buttons stay square or compact; icons precede text when the command benefits from a symbol.">
        <div class={styles.row}>
          <Button size="xs">Extra small</Button>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button variant="primary">Primary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button selected>Selected</Button>
          <Button disabled>Disabled</Button>
          <Button iconOnly aria-label="Icon only"><Icon name="ph:play-fill" size={18} decorative /></Button>
        </div>
        <div class={styles.ribbonDemo}>
          <Button iconOnly selected aria-label="Active rail icon"><Icon name="ph:piano-keys-fill" size={18} decorative /></Button>
          <Button iconOnly aria-label="Inactive rail icon"><Icon name="ph:music-note" size={18} decorative /></Button>
          <Button iconOnly aria-label="Layers"><Icon name="ph:stack" size={18} decorative /></Button>
          <Button iconOnly aria-label="Connections"><Icon name="ph:share-network" size={18} decorative /></Button>
          <span class={styles.ribbonTitle}>Ribbon header</span>
          <Button size="sm"><Icon name="ph:floppy-disk" size={18} decorative />Save</Button>
        </div>
      </SpecimenSection>

      <SpecimenSection title="Inputs And Controls" note="Use shared controls so hit zones, drag behavior, focus, and disabled state are consistent.">
        <div class={styles.controlGrid}>
          <TextInput label="Name" value="Aether Patch 1" />
          <NumberInput label="Buffer" value={numberValue()} min={32} max={2048} step={32} unit="samples" onChange={setNumberValue} />
          <FloatingSelect
            label="Engine"
            value={selectValue()}
            options={[
              { value: "wavetable", label: "Aether" },
              { value: "nodemap", label: "Nodemap" },
              { value: "sampler", label: "Sampler" },
            ]}
            onChange={setSelectValue}
          />
          <RadioGroup
            label="Monitor"
            ariaLabel="Monitor mode"
            value={radioValue()}
            options={[{ value: "mono", label: "Mono" }, { value: "stereo", label: "Stereo" }]}
            onChange={setRadioValue}
          />
          <Toggle checked={toggleOn()} label="Input monitor" onChange={setToggleOn} />
          <Slider label="Strength" value={sliderValue()} min={0} max={100} step={1} readout={`${sliderValue()}%`} onChange={setSliderValue} />
          <div class={styles.knobCluster}>
            <Knob label="Cutoff" value={knobValue()} min={0} max={100} step={1} onChange={setKnobValue} />
            <Knob label="Pan" value={0} min={-50} max={50} step={1} bipolar onChange={() => undefined} />
            <Knob label="Disabled" value={20} min={0} max={100} disabled onChange={() => undefined} />
          </div>
        </div>
      </SpecimenSection>

      <SpecimenSection title="Tags, Rows, Drag, And Ribbons" note="Rows use icon-before-name, drag handle on hover, tint hover, and compact right-side actions.">
        <div class={styles.tagRow}>
          <Tag>26</Tag>
          <Tag tone="zero">0</Tag>
          <Tag>Library</Tag>
          <Tag>Sampler</Tag>
        </div>
        <div class={styles.splitGrid}>
          <Block framed padding="none" title="Instrument browser">
            <SectionRibbon
              title="Factory Synths"
              expanded={ribbonOpen()}
              count={4}
              onToggle={() => setRibbonOpen(!ribbonOpen())}
              actions={<SectionRibbonActionButton aria-label="Add"><Icon name="ph:plus" size={18} decorative /></SectionRibbonActionButton>}
            />
            <Show when={ribbonOpen()}>
              <ul class={styles.rowList}>
                <RowItem
                  name="Wavetable Synth"
                  icon={<Icon name="ph:waveform" size={18} decorative />}
                  hoverIcon={<Icon name="ph:dots-six-vertical" size={18} decorative />}
                  detail="Aether · Synth / Electronic"
                  action={<RowActionButton aria-label="Preview Wavetable Synth"><Icon name="ph:play-fill" size={18} decorative /></RowActionButton>}
                  onContextMenu={rowMenu.onContextMenu}
                />
                <RowItem
                  name="Nodemap Patch 1"
                  icon={<Icon name="ph:share-network" size={18} decorative />}
                  hoverIcon={<Icon name="ph:dots-six-vertical" size={18} decorative />}
                  detail="Nodemap · Modular synth"
                  action={<RowActionButton aria-label="Preview Nodemap Patch"><Icon name="ph:play-fill" size={18} decorative /></RowActionButton>}
                />
                <RowItem
                  density="compact"
                  name="Pearl Snare"
                  icon={<Icon name="ph:piano-keys" size={18} decorative />}
                  detail="Sampler · Percussion / Snare"
                  action={<RowActionButton size="compact" aria-label="Preview Pearl Snare"><Icon name="ph:play-fill" size={18} decorative /></RowActionButton>}
                />
              </ul>
            </Show>
            <SectionRibbon title="Instanced Instruments" expanded={false} count={0} showToggle={false} onToggle={() => undefined} />
          </Block>

          <Block framed padding="none" title="Drag and drop states">
            <div class={styles.dropDemo}>
              <div class={styles.dragCard}>
                <Icon name="ph:dots-six-vertical" size={18} decorative />
                <span>Dragged instrument</span>
              </div>
              <div class={styles.dropLine} aria-hidden="true" />
              <div class={styles.dropTarget}>
                <Icon name="ph:plug" size={18} decorative />
                <span>Drop target</span>
              </div>
            </div>
            <div class={styles.segmentDemo}>
              <span class={styles.segmentHandle} />
              <span class={styles.segmentBody}>Midi 1</span>
              <span class={styles.segmentHandle} />
            </div>
          </Block>
        </div>
      </SpecimenSection>

      <SpecimenSection title="Blocks, Modal, And Editor Panels" note="High-level panels use shared Block, Modal, button rows, and fixed action footer treatment.">
        <div class={styles.splitGrid}>
          <Block framed padding="none" title="Section block" actions={<Button size="sm"><Icon name="ph:plus" size={18} decorative />Add</Button>}>
            <div class={styles.editorPanel}>
              <div class={styles.panelRibbon}>
                <Button iconOnly selected aria-label="Enable oscillator"><Icon name="ph:power" size={18} decorative /></Button>
                <strong>Oscillator A</strong>
                <div class={styles.squareButtonRow}>
                  <Button iconOnly selected aria-label="Sine"><Icon name="ph:wave-sine" size={18} decorative /></Button>
                  <Button iconOnly aria-label="Saw"><Icon name="ph:wave-sawtooth" size={18} decorative /></Button>
                  <Button iconOnly aria-label="Square"><Icon name="ph:wave-square" size={18} decorative /></Button>
                </div>
                <span class={styles.muted}>Custom</span>
              </div>
              <div class={styles.wavePreview} aria-label="Waveform preview">
                <svg viewBox="0 0 240 72" preserveAspectRatio="none">
                  <path d="M0 36 C20 32 32 40 48 36 C70 28 78 50 96 36 C124 14 132 58 152 36 C178 22 188 44 208 36 C222 30 232 34 240 32" />
                </svg>
              </div>
              <div class={styles.knobGrid}>
                <Knob label="Position" value={42} min={0} max={100} onChange={() => undefined} />
                <Knob label="Warp" value={24} min={0} max={100} onChange={() => undefined} />
                <Knob label="Level" value={80} min={0} max={100} onChange={() => undefined} />
              </div>
            </div>
          </Block>

          <Block framed padding="none" title="Modal anatomy">
            <div class={styles.modalShell}>
              <div class={styles.modalHeader}>
                <Icon name="ph:waveform" size={18} decorative />
                <strong>Instrument - Aether Engine</strong>
                <Button iconOnly aria-label="Close mock modal"><Icon name="ph:x" size={18} decorative /></Button>
              </div>
              <div class={styles.modalBody}>
                <TextInput label="Name" value="Aether Patch 1" />
                <FloatingSelect
                  label="Category"
                  value="synth"
                  options={[{ value: "synth", label: "Synth / Electronic" }]}
                  onChange={() => undefined}
                />
              </div>
              <div class={styles.modalFooter}>
                <Button><Icon name="ph:play-fill" size={18} decorative />Audition</Button>
                <span />
                <Button>Cancel</Button>
                <Button variant="primary">Save</Button>
              </div>
            </div>
          </Block>
        </div>
      </SpecimenSection>

      <Modal
        open={modalOpen()}
        title={<><Icon name="ph:sliders-horizontal" size={18} decorative />Specimen modal</>}
        subtitle="Example of the shared modal wrapper, body spacing, header actions, and footer actions."
        width="md"
        closeOnEscape
        onClose={() => setModalOpen(false)}
        footer={(
          <>
            <Button onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setModalOpen(false)}>Save</Button>
          </>
        )}
      >
        <div class={styles.modalContent}>
          <SectionRibbon title="Modal section" expanded={sectionOpen()} count={3} onToggle={() => setSectionOpen(!sectionOpen())} />
          <Show when={sectionOpen()} fallback={<p class={styles.helpText}>Open the ribbon to inspect a compact modal row stack.</p>}>
            <ul class={styles.rowList}>
              <RowItem name="Route source" icon={<Icon name="ph:plug" size={18} decorative />} detail="Amp Env / Filter Cutoff" />
              <RowItem name="Render target" icon={<Icon name="ph:waveform" size={18} decorative />} detail="Stereo · 48 kHz / 24-bit" />
            </ul>
          </Show>
        </div>
      </Modal>
    </main>
  );
}

function SpecimenSection(props: { title: string; note?: string; children: JSX.Element }) {
  return (
    <section class={styles.section}>
      <header class={styles.sectionHeader}>
        <h2>{props.title}</h2>
        <Show when={props.note}><p>{props.note}</p></Show>
      </header>
      <div class={styles.sectionBody}>{props.children}</div>
    </section>
  );
}

function tokenStyle(token: string) {
  if (token.startsWith("--border")) return { border: `var(${token})` };
  return { background: `var(${token})` };
}

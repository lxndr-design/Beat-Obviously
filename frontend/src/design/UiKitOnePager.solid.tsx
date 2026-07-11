import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { TrackHeader } from "../features/Tracks/TrackHeader.solid";
import { useProjectStore } from "../state/store";
import { PH_ICON_USAGE_SIZES } from "../solid-ui/Icon/phIconSubset";
import {
  ActionFooter,
  AppLogo,
  Block,
  Button,
  Checkbox,
  createContextMenu,
  DitheredImage,
  FieldActionButton,
  FloatingSelect,
  HoverInfo,
  Icon,
  Knob,
  LibraryFolder,
  LibrarySearch,
  MarqueeText,
  MicroButton,
  NumberInput,
  RadioGroup,
  RailButton,
  RowActionButton,
  RowItem,
  SectionRibbon,
  SectionRibbonActionButton,
  Slider,
  StatusChip,
  Tag,
  TextInput,
  Toggle,
  TrackControlButton,
} from "../solid-ui";
import styles from "./UiKitOnePager.module.css";

const demoImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAGElEQVR4nGNkYGD4z8DAwMgABYwMjAACCgEABpMAf5S4JikAAAAASUVORK5CYII=";

interface KitItem {
  name: string;
  note: string;
  width?: "sm" | "md" | "lg";
  render: () => JSX.Element;
}

type IconSize = 18;

const typographySpecimens = [
  { name: "Hint", token: "--font-size-hint", pixels: "10px", use: "Ticks and passive hints" },
  { name: "UI", token: "--font-size-ui", pixels: "11px", use: "Dense controls and labels" },
  { name: "Field label", token: "--font-size-field-label", pixels: "12px", use: "Input and dropdown titles" },
  { name: "UI large", token: "--font-size-ui-lg", pixels: "14px", use: "Larger compact controls" },
  { name: "Section", token: "--font-size-section", pixels: "16px", use: "Section labels" },
  { name: "Title", token: "--font-size-title", pixels: "18px", use: "Modal and panel titles" },
  { name: "Display 1", token: "--font-size-1", pixels: "16px", use: "Body and editorial text" },
  { name: "Display 2", token: "--font-size-2", pixels: "20px", use: "Secondary headings" },
  { name: "Display 3", token: "--font-size-3", pixels: "24px", use: "Major surface headings" },
  { name: "Display 4", token: "--font-size-4", pixels: "32px", use: "Section display" },
  { name: "Display 5", token: "--font-size-5", pixels: "40px", use: "Large display" },
  { name: "Display 6", token: "--font-size-6", pixels: "56px", use: "Feature display" },
] as const;

const colorSpecimens = [
  { name: "Background", token: "--color-bg", value: "#000000" },
  { name: "Foreground", token: "--color-fg", value: "#ffffff" },
  { name: "Subtle", token: "--surface-subtle", value: "8% foreground" },
  { name: "Hover", token: "--surface-hover", value: "14% foreground" },
  { name: "Selected", token: "--surface-selected", value: "34% foreground" },
  { name: "Selected strong", token: "--surface-selected-strong", value: "48% foreground" },
  { name: "Border", token: "--border-fg-color", value: "72% foreground" },
  { name: "Grid faint", token: "--grid-line-faint", value: "8% white" },
  { name: "Grid soft", token: "--grid-line-soft", value: "12% white" },
  { name: "Grid mid", token: "--grid-line-mid", value: "16% white" },
  { name: "Grid bold", token: "--grid-line-bold", value: "45% white" },
] as const;

const iconUsageEntries = Object.entries(PH_ICON_USAGE_SIZES) as Array<[string, readonly IconSize[]]>;

export function UiKitOnePager() {
  const [lightMode, setLightMode] = createSignal(true);
  const [sliderValue, setSliderValue] = createSignal(42);
  const [numberValue, setNumberValue] = createSignal(128);
  const [lengthValue, setLengthValue] = createSignal(64);
  const [knobValue, setKnobValue] = createSignal(61);
  const [toggleOn, setToggleOn] = createSignal(true);
  const [checkboxOn, setCheckboxOn] = createSignal(true);
  const [trackControlOn, setTrackControlOn] = createSignal(false);
  const [radioValue, setRadioValue] = createSignal<"off" | "on">("on");
  const [floatingOpen, setFloatingOpen] = createSignal(false);
  const [floatingValue, setFloatingValue] = createSignal("factory");
  const [ribbonOpen, setRibbonOpen] = createSignal(true);
  const [libraryFolderOpen, setLibraryFolderOpen] = createSignal(true);
  const specimenTrackId = useProjectStore.getState().project.tracks[0]?.id;
  const menu = createContextMenu(() => [
    { label: "Audition", icon: "ph:play-fill" },
    { label: "Duplicate", icon: "ph:copy" },
    { label: "Delete", icon: "ph:trash", separatorBefore: true },
  ]);

  const items: KitItem[] = [
    {
      name: "Button / default",
      note: "Text command",
      render: () => <Button>Open</Button>,
    },
    {
      name: "Button / primary",
      note: "Committed action",
      render: () => <Button variant="primary">Save</Button>,
    },
    {
      name: "Button / selected",
      note: "Latched toggle",
      render: () => <Button selected>Loop</Button>,
    },
    {
      name: "Button / ghost",
      note: "Secondary command",
      render: () => <Button variant="ghost">Cancel</Button>,
    },
    {
      name: "Button / disabled",
      note: "Inactive command",
      render: () => <Button disabled>Disabled</Button>,
    },
    {
      name: "Button / icon",
      note: "Square tool",
      render: () => <Button iconOnly size="xs" aria-label="Add"><Icon name="ph:plus" size={18} decorative /></Button>,
    },
    {
      name: "Button / icon active",
      note: "Active transport",
      render: () => <Button iconOnly variant="primary" aria-label="Pause"><Icon name="ph:pause-fill" size={18} decorative /></Button>,
    },
    {
      name: "AppLogo",
      note: "Project mark",
      render: () => <AppLogo class={styles.logoSample} />,
    },
    {
      name: "Icon",
      note: "Phosphor set",
      render: () => <Icon name="ph:waveform" size={18} title="Waveform" />,
    },
    {
      name: "Tag / default",
      note: "Metadata chip",
      render: () => <Tag>Aether</Tag>,
    },
    {
      name: "Tag / zero",
      note: "Empty count",
      render: () => <Tag tone="zero">0</Tag>,
    },
    {
      name: "StatusChip",
      note: "Track state",
      render: () => (
        <div class={styles.sampleRow}>
          <StatusChip>REC</StatusChip>
          <StatusChip>IN</StatusChip>
          <StatusChip tone="muted">+3</StatusChip>
        </div>
      ),
    },
    {
      name: "RailButton",
      note: "Navigation rail action",
      render: () => (
        <div class={styles.sampleRow}>
          <RailButton selected aria-label="Instruments"><Icon name="ph:piano-keys-fill" size={18} decorative /></RailButton>
          <RailButton aria-label="Beat menu"><AppLogo /></RailButton>
        </div>
      ),
    },
    {
      name: "MicroButton",
      note: "Compact track action",
      render: () => (
        <div class={styles.sampleRow}>
          <MicroButton active={trackControlOn()} onClick={() => setTrackControlOn(!trackControlOn())} aria-label="Solo">S</MicroButton>
          <MicroButton active aria-label="Input monitor"><Icon name="ph:speaker-high-fill" size={18} decorative /></MicroButton>
          <MicroButton aria-label="Record"><Icon name="ph:microphone" size={18} decorative /></MicroButton>
        </div>
      ),
    },
    {
      name: "FieldActionButton",
      note: "33px input-adjacent action",
      width: "md",
      render: () => (
        <div class={styles.sampleRow}>
          <TextInput label="Name" layout="inline" value="Pearl Closed Hat" />
          <FieldActionButton aria-label="Choose icon"><Icon name="ph:music-notes" size={18} decorative /></FieldActionButton>
        </div>
      ),
    },
    {
      name: "TrackControlButton",
      note: "Track state action",
      render: () => (
        <div class={styles.sampleRow}>
          <TrackControlButton active={trackControlOn()} onClick={() => setTrackControlOn(!trackControlOn())} aria-label="Solo">S</TrackControlButton>
          <TrackControlButton active aria-label="Input monitor"><Icon name="ph:speaker-high-fill" decorative /></TrackControlButton>
        </div>
      ),
    },
    {
      name: "TextInput",
      note: "Stacked field",
      width: "md",
      render: () => <TextInput label="Name" value="Wavetable Synth" />,
    },
    {
      name: "TextInput / labeled",
      note: "Inline label, 6px inset",
      width: "md",
      render: () => <TextInput label="Name" layout="inline" value="Pearl Closed Hat" />,
    },
    {
      name: "NumberInput",
      note: "Clamped value",
      width: "md",
      render: () => <NumberInput label="BPM" value={numberValue()} min={20} max={999} step={1} onChange={setNumberValue} />,
    },
    {
      name: "NumberInput / editor",
      note: "TopBar project values",
      render: () => (
        <div class={styles.sampleRow}>
          <NumberInput layout="editor" label="Length" value={lengthValue()} min={4} max={4096} step={4} onChange={setLengthValue} />
          <NumberInput layout="editor" label="BPM" value={numberValue()} min={20} max={999} step={1} onChange={setNumberValue} />
        </div>
      ),
    },
    {
      name: "NumberInput / labeled",
      note: "Inline label, 6px inset",
      width: "md",
      render: () => <NumberInput label="Velocity" layout="inline" value={numberValue()} min={0} max={127} step={1} onChange={setNumberValue} />,
    },
    {
      name: "FloatingSelect / labeled",
      note: "Inline label, 6px inset",
      width: "md",
      render: () => (
        <FloatingSelect
          label="Library"
          layout="inline"
          value={floatingValue()}
          open={floatingOpen()}
          options={[
            { value: "factory", label: "Factory" },
            { value: "user", label: "User" },
            { value: "project", label: "Project" },
          ]}
          onOpenChange={setFloatingOpen}
          onChange={setFloatingValue}
        />
      ),
    },
    {
      name: "Slider",
      note: "Range drag",
      width: "lg",
      render: () => <Slider label="Drive" value={sliderValue()} min={0} max={100} readout={`${sliderValue()}%`} onChange={setSliderValue} />,
    },
    {
      name: "Toggle",
      note: "Binary setting",
      width: "md",
      render: () => <Toggle label="Monitor" checked={toggleOn()} onChange={setToggleOn} />,
    },
    {
      name: "Checkbox",
      note: "Selection control",
      width: "md",
      render: () => <Checkbox label="Selected" checked={checkboxOn()} onChange={setCheckboxOn} />,
    },
    {
      name: "RadioGroup",
      note: "Mode set",
      width: "md",
      render: () => (
        <RadioGroup
          ariaLabel="Audition mode"
          label="Audition"
          value={radioValue()}
          options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]}
          onChange={setRadioValue}
        />
      ),
    },
    {
      name: "Knob / md",
      note: "Continuous param",
      render: () => <Knob label="Cutoff" value={knobValue()} min={0} max={100} step={1} onChange={setKnobValue} />,
    },
    {
      name: "Knob / bipolar",
      note: "Centered param",
      render: () => <Knob label="Pan" value={0} min={-50} max={50} step={1} bipolar onChange={() => undefined} />,
    },
    {
      name: "HoverInfo",
      note: "Tooltip wrapper",
      render: () => (
        <HoverInfo content="Tooltip label" placement="top">
          <Button iconOnly aria-label="Info"><Icon name="ph:info" size={18} decorative /></Button>
        </HoverInfo>
      ),
    },
    {
      name: "MarqueeText",
      note: "Overflow label",
      width: "md",
      render: () => <MarqueeText text="Very long instrument name that scrolls inside a compact row" className={styles.marqueeBox} />,
    },
    {
      name: "DitheredImage",
      note: "Raster preview",
      render: () => <DitheredImage src={demoImage} alt="Dithered preview" width={64} height={64} fallback={<span>Missing</span>} />,
    },
    {
      name: "ActionFooter",
      note: "Modal actions",
      width: "lg",
      render: () => (
        <ActionFooter>
          <Button variant="ghost">Cancel</Button>
          <Button variant="primary">Apply</Button>
        </ActionFooter>
      ),
    },
    {
      name: "SectionRibbon",
      note: "Panel header",
      width: "lg",
      render: () => (
        <div class={styles.framedFill}>
          <SectionRibbon
            title="Factory Synths"
            expanded={ribbonOpen()}
            count={4}
            onToggle={() => setRibbonOpen(!ribbonOpen())}
            actions={<SectionRibbonActionButton aria-label="Add synth"><Icon name="ph:plus" size={18} decorative /></SectionRibbonActionButton>}
          />
        </div>
      ),
    },
    {
      name: "LibraryFolder",
      note: "Shared asset folder",
      width: "lg",
      render: () => (
        <LibraryFolder
          name="User Patterns"
          count={1}
          open={libraryFolderOpen()}
          dragMime="application/x-beat-component"
          onToggle={() => setLibraryFolderOpen(!libraryFolderOpen())}
          onDropItem={() => undefined}
          onStartRename={() => undefined}
          onRename={() => undefined}
          onCancelRename={() => undefined}
          onUngroup={() => undefined}
        >
          <RowItem
            density="compact"
            name="Verse Pattern"
            icon={<Icon name="ph:grid-four" size={18} decorative />}
            action={<RowActionButton size="compact" aria-label="Preview"><Icon name="ph:play-fill" size={18} decorative /></RowActionButton>}
          />
        </LibraryFolder>
      ),
    },
    {
      name: "LibrarySearch",
      note: "Full-width tab filtering",
      width: "lg",
      render: () => <LibrarySearch placeholder="Search..." aria-label="Search library" />,
    },
    {
      name: "RowActionButton",
      note: "Row action sizes",
      render: () => (
        <div class={styles.sampleRow}>
          <RowActionButton aria-label="Preview"><Icon name="ph:play-fill" size={18} decorative /></RowActionButton>
          <RowActionButton size="compact" aria-label="Compact preview"><Icon name="ph:play-fill" size={18} decorative /></RowActionButton>
        </div>
      ),
    },
    {
      name: "RowItem",
      note: "Compact library row",
      width: "lg",
      render: () => (
        <ul class={styles.rowList}>
          <RowItem
            density="compact"
            name="Aether Keys"
            icon={<Icon name="ph:piano-keys" size={18} decorative />}
            hoverIcon={<Icon name="ph:dots-six-vertical" size={18} decorative />}
            detail="Synth / Keys"
            action={<RowActionButton size="compact" aria-label="Preview"><Icon name="ph:play-fill" size={18} decorative /></RowActionButton>}
            onContextMenu={menu.onContextMenu}
          />
        </ul>
      ),
    },
    {
      name: "Track head",
      note: "Arrangement row header",
      width: "lg",
      render: () => (
        <div class={styles.trackHeadSample}>
          <Show when={specimenTrackId} fallback={<span>Track unavailable</span>}>
            {(trackId) => <TrackHeader trackId={trackId()} index={0} selected />}
          </Show>
        </div>
      ),
    },
    {
      name: "ContextMenu",
      note: "Right-click RowItem",
      width: "lg",
      render: () => (
        <div class={styles.contextTarget} onContextMenu={menu.onContextMenu}>
          <Icon name="ph:cursor" size={18} decorative />
          Right-click for menu
        </div>
      ),
    },
    {
      name: "Block",
      note: "Panel frame",
      width: "lg",
      render: () => (
        <Block framed padding="sm" title="Mixer lane" actions={<Button size="sm">Arm</Button>}>
          <div class={styles.blockBody}>Gain / Pan / Sends</div>
        </Block>
      ),
    },
    {
      name: "Modal chrome",
      note: "Static anatomy",
      width: "lg",
      render: () => (
        <div class={styles.modalMock}>
          <div class={styles.modalHeader}>
            <Icon name="ph:sliders-horizontal" size={18} decorative />
            <strong>Preferences</strong>
            <Button iconOnly variant="ghost" aria-label="Close"><Icon name="ph:x" size={18} decorative /></Button>
          </div>
          <div class={styles.modalBody}>Audio / Interface / Project defaults</div>
          <ActionFooter>
            <Button size="sm" variant="ghost">Cancel</Button>
            <Button size="sm" variant="primary">Save</Button>
          </ActionFooter>
        </div>
      ),
    },
  ];

  return (
    <main class={`${styles.page} ${lightMode() ? styles.lightMode : styles.darkMode}`}>
      {menu.menu()}
      <header class={styles.header}>
        <div>
          <p class={styles.eyebrow}>Beat UI kit</p>
          <h1>Live One Pager</h1>
        </div>
        <div class={styles.headerMeta}>
          <span>All tiles show measured rendered pixels.</span>
          <span>Fixture: beatDevFixture=ui-one-pager</span>
          <Toggle
            label="Light mode"
            checked={lightMode()}
            onChange={setLightMode}
            class={styles.themeToggle}
            labelClassName={styles.themeToggleLabel}
          />
        </div>
      </header>

      <div class={styles.foundationGrid}>
        <ReferencePanel title="Typography" note="Current font-size tokens rendered at 1:1 CSS pixels.">
          <div class={styles.typeList}>
            <For each={typographySpecimens}>
              {(specimen) => (
                <div class={styles.typeRow}>
                  <div class={styles.referenceMeta}>
                    <strong>{specimen.name}</strong>
                    <span>{specimen.token}</span>
                    <span>{specimen.pixels} / {specimen.use}</span>
                  </div>
                  <span class={styles.typeSample} style={{ "font-size": `var(${specimen.token})` }}>Aa</span>
                </div>
              )}
            </For>
          </div>
        </ReferencePanel>

        <ReferencePanel title="Black, white, and tints" note="The active monochrome surface and structural tint tokens.">
          <div class={styles.colorGrid}>
            <For each={colorSpecimens}>
              {(specimen) => (
                <div class={styles.colorItem}>
                  <span
                    class={styles.swatch}
                    style={{ background: `linear-gradient(var(${specimen.token}), var(${specimen.token})), var(--color-bg)` }}
                  />
                  <div class={styles.referenceMeta}>
                    <strong>{specimen.name}</strong>
                    <span>{specimen.token}</span>
                    <span>{specimen.value}</span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </ReferencePanel>
      </div>

      <section class={styles.board} aria-label="UI kit components">
        <For each={items}>
          {(item) => (
            <MeasuredTile name={item.name} note={item.note} width={item.width}>
              {item.render()}
            </MeasuredTile>
          )}
        </For>
      </section>

      <ReferencePanel
        title={`Current icon registry (${iconUsageEntries.length})`}
        note="Every locally bundled Phosphor icon, rendered at the standard 18px size. Icon-only buttons add 6px padding."
      >
        <div class={styles.iconStage}>
          <For each={iconUsageEntries}>
            {([name, sizes]) => (
              <div class={styles.iconItem}>
                <div class={styles.iconGlyphs}>
                  <For each={sizes}>{(size) => <Icon name={name} size={size} decorative />}</For>
                </div>
                <strong>{name.replace("ph:", "")}</strong>
                <span>{sizes.map((size) => `${size}px`).join(" / ")}</span>
              </div>
            )}
          </For>
        </div>
      </ReferencePanel>
    </main>
  );
}

function ReferencePanel(props: { title: string; note: string; children: JSX.Element }) {
  return (
    <section class={styles.referencePanel}>
      <header class={styles.referenceHeader}>
        <h2>{props.title}</h2>
        <p>{props.note}</p>
      </header>
      {props.children}
    </section>
  );
}

function MeasuredTile(props: {
  name: string;
  note: string;
  width?: "sm" | "md" | "lg";
  children: JSX.Element;
}) {
  let sampleElement: HTMLDivElement | undefined;
  const [size, setSize] = createSignal({ width: 0, height: 0 });

  onMount(() => {
    if (!sampleElement) return;
    const measuredElement = sampleElement.firstElementChild ?? sampleElement;
    const update = () => {
      const rect = measuredElement.getBoundingClientRect();
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(measuredElement);
    onCleanup(() => observer.disconnect());
  });

  return (
    <article class={`${styles.tile} ${props.width ? styles[`tile-${props.width}`] : ""}`}>
      <header class={styles.tileHeader}>
        <div>
          <h2>{props.name}</h2>
          <p>{props.note}</p>
        </div>
        <Show when={size().width > 0}>
          <span class={styles.dimensions}>{size().width} x {size().height}px</span>
        </Show>
      </header>
      <div ref={sampleElement} class={styles.sample}>
        {props.children}
      </div>
    </article>
  );
}

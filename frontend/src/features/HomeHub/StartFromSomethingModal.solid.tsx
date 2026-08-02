import { createSignal, type JSX } from "solid-js";
import {
  SONG_GENRES,
  SONG_RANDOMNESS_LEVELS,
  SONG_SPEEDS,
  type GenerateSongOptions,
  type SongGenre,
  type SongRandomness,
  type SongSpeed,
} from "../../ai/songGenerator";
import { Button, Icon, Modal, RadioGroup } from "../../solid-ui";
import styles from "./StartFromSomethingModal.module.css";

export interface StartFromSomethingModalProps {
  open: boolean;
  onClose: () => void;
  onStart: (options: GenerateSongOptions) => void;
}

const SPEED_LABELS: Record<SongSpeed, string> = {
  passive: "Passive",
  slow: "Slow",
  medium: "Medium",
  fast: "Fast",
  hyper: "Hyper",
};

const SPEED_DESCRIPTIONS: Record<SongSpeed, string> = {
  passive: "Ambient pacing: sustained voices, slow change, and normally no percussion.",
  slow: "Long phrases, sparse bass movement, and restrained percussion.",
  medium: "Pop-centered pacing with a readable groove and normal note density.",
  fast: "More subdivisions, active bass motion, and denser rhythmic layers.",
  hyper: "Breakcore-scale density: rapid chopped attacks, gaps, accents, and rhythm changes.",
};

const GENRE_DESCRIPTIONS: Record<SongGenre, string> = {
  pop: "Hook-forward verse/chorus writing, clear builds, broad dynamics, and layered keys or guitars.",
  rap: "Sparse melodic space, 808-focused low end, strong drum anchors, and sectional vocal room.",
  dnb: "Fast break motion, Reese-style bass, atmospheric contrast, and high-energy drops.",
  jazz: "AABA tendency, extended instrumental colors, conversational voices, and wider dynamics.",
  reggae: "Deep bass, skank or organ offbeats, one-drop emphasis, and relaxed sectional release.",
  classical: "Motivic development, acoustic orchestral roles, longer arcs, and the widest dynamic range.",
  electronic: "Synth-designed instrumentation, layered automation potential, repeating cells, and breakdown/drop contrast.",
};

const RANDOMNESS_DESCRIPTIONS: Record<SongRandomness, string> = {
  low: "One primary motif, close variations, repeated sections, and a highly consistent groove.",
  medium: "Two related motifs, normal development, and one measured rhythmic change.",
  high: "Three motifs, freer transformations, two rhythm shifts, and temporary key movement.",
};

export function StartFromSomethingModal(props: StartFromSomethingModalProps) {
  const [speed, setSpeed] = createSignal<SongSpeed>("medium");
  const [genre, setGenre] = createSignal<SongGenre>("pop");
  const [randomness, setRandomness] = createSignal<SongRandomness>("medium");

  function start() {
    props.onStart({
      speed: speed(),
      genre: genre(),
      randomness: randomness(),
      style: `${speed()} ${genre()} with ${randomness()} variation`,
    });
    props.onClose();
  }

  return (
    <Modal
      open={props.open}
      scopeId="start-from-something"
      title={<><Icon name="ph:sparkle" size={18} decorative />Start from Something</>}
      subtitle="Build an editable arrangement and a new generated instrument set. Nothing is written to a project file until you save."
      width="lg"
      closeOnEscape
      closeOnScrimClick
      onClose={props.onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" onClick={start}>Create Unsaved Project</Button>
        </>
      )}
    >
      <div class={styles.body}>
        <SettingBlock title="Speed" description={SPEED_DESCRIPTIONS[speed()]}>
          <RadioGroup
            class={styles.choices}
            ariaLabel="Song speed"
            value={speed()}
            options={SONG_SPEEDS.map((value) => ({ value, label: SPEED_LABELS[value] }))}
            onChange={setSpeed}
          />
        </SettingBlock>

        <SettingBlock title="Genre" description={GENRE_DESCRIPTIONS[genre()]}>
          <RadioGroup
            class={styles.choices}
            ariaLabel="Song genre"
            value={genre()}
            options={SONG_GENRES.map((value) => ({ value, label: value === "dnb" ? "DnB" : value[0].toUpperCase() + value.slice(1) }))}
            onChange={setGenre}
          />
        </SettingBlock>

        <SettingBlock title="Randomness" description={RANDOMNESS_DESCRIPTIONS[randomness()]}>
          <RadioGroup
            class={styles.choices}
            ariaLabel="Song randomness"
            value={randomness()}
            options={SONG_RANDOMNESS_LEVELS.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
            onChange={setRandomness}
          />
        </SettingBlock>

        <div class={styles.summary} aria-live="polite">
          <strong>{SPEED_LABELS[speed()]} {genre() === "dnb" ? "DnB" : genre()} · {randomness()} randomness</strong>
          <span>Tempo, note density, form, dynamics, motifs, pitch niches, and five new instruments will be generated together.</span>
        </div>
      </div>
    </Modal>
  );
}

function SettingBlock(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <section class={styles.setting}>
      <div class={styles.heading}>
        <h3>{props.title}</h3>
        <p>{props.description}</p>
      </div>
      {props.children}
    </section>
  );
}

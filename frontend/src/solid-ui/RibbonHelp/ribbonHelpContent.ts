import type { RibbonHelpPage } from "./RibbonHelp.solid";

export const RIBBON_HELP = {
  projects: [
    {
      title: "Start or open a song",
      body: "New Project opens an empty arrangement. Start from Something builds an editable song from speed, genre, and variation choices, while Open Project loads an existing Beat document.",
    },
    {
      title: "Saving is explicit",
      body: "Generated and new projects stay unsaved until you choose Save. Beat will offer Save, Don’t Save, and Cancel before leaving a project with changes.",
    },
  ],
  recent: [
    {
      title: "Return to recent work",
      body: "Recent projects are ordered by the last time they were opened. Open a row to continue, or use its context menu to reveal, duplicate, or remove the shortcut without deleting the original project.",
    },
  ],
  assets: [
    {
      title: "Your reusable library",
      body: "Audio Files, Instruments, and Patterns are shared creative building blocks. Open a library to search, preview, organize, and inspect its metadata before using an item in a song.",
    },
    {
      title: "From library to arrangement",
      body: "Drag or choose library items in the editor to create tracks and segments. User-created instruments and saved patterns remain available for later projects.",
    },
  ],
  tracks: [
    {
      title: "Arrange the song",
      body: "Each row is a track and each block is a playable segment. Drag segments through time or between compatible tracks, resize their ends to trim them, and double-click a segment to edit its contents.",
    },
    {
      title: "Control and automate",
      body: "Track headers provide solo, mute, recording, monitoring, level, and automation access. Right-click tracks or segments for editing, conversion, grouping, export, and routing actions.",
    },
  ],
  instruments: [
    {
      title: "Choose a sound",
      body: "Search by instrument name, song, engine, or metadata. Double-click an instrument row to audition it, then drag it into the arrangement or right-click it and choose New Track to create a bound MIDI or drum segment.",
    },
    {
      title: "Create and organize",
      body: "Use the plus button to create or import an instrument. User instruments can be renamed, grouped, edited, duplicated, and reused across projects.",
    },
    {
      title: "Instrument engines",
      body: "Beat supports samples, multisamples, drums, Aurum, Lumen, Nodemap, and timeline-jumping instruments. Select an instrument to inspect its engine, taxonomy, samples, source, and usage details.",
    },
  ],
  audioFiles: [
    {
      title: "Import source audio",
      body: "Use the plus button to add supported WAV, MP3, AIFF, FLAC, or OGG files. Imported audio becomes searchable and can be previewed before it is placed in the arrangement.",
    },
    {
      title: "Use audio in a song",
      body: "Drag audio into a track lane to create an audio segment. Segment tools can trim, loop, tune, reverse, or convert supported material without changing the original library file.",
    },
    {
      title: "Separate or transcribe",
      body: "Audio segments can be split into linked stems, and supported stems can be converted into MIDI or drum material. Results remain editable as normal Beat tracks and segments.",
    },
  ],
  components: [
    {
      title: "Reusable musical patterns",
      body: "Components are saved MIDI or drum ideas that can be reused without copying an entire track. Right-click a segment to save it as a component, then preview it here.",
    },
    {
      title: "Build with components",
      body: "Drag a component into the arrangement to create a new editable segment. Organize related patterns into folders so loops, motifs, and variations stay easy to find.",
    },
  ],
  plugins: [
    {
      title: "External instrument formats",
      body: "Plugins expose supported external instrument adapters inside Beat. Open an installed adapter to inspect it or use the plus button to import a compatible package.",
    },
    {
      title: "Project portability",
      body: "A project can reference an external instrument package, so keep that package installed when moving the project to another Mac. Beat reports missing dependencies instead of silently substituting a sound.",
    },
  ],
  decentSampler: [
    {
      title: "DecentSampler packages",
      body: "This library contains imported DecentSampler instruments. Use the plus button to install a compatible package, then open it to inspect its controls and sample mapping.",
    },
    {
      title: "Use in the arrangement",
      body: "A DecentSampler instrument behaves like another instrument source in Beat. Add it to a MIDI track, then edit the notes and mix the rendered audio normally.",
    },
  ],
  patterns: [
    {
      title: "Browse patterns",
      body: "Patterns are reusable MIDI and drum components. Search or filter the library, select a row to inspect its notes and timing, and use preview controls to hear it at the project tempo.",
    },
    {
      title: "Adapt, don’t flatten",
      body: "Place a pattern into the arrangement as an editable segment. You can change its instrument, notes, loop count, timing, or remix settings without altering the saved source pattern.",
    },
  ],
  mixer: [
    {
      title: "Balance the project",
      body: "The mixer shows one channel strip per track, return bus, and the master output. Use faders, pan, solo, mute, record, and monitoring controls while watching the stereo meters.",
    },
    {
      title: "Route and process",
      body: "Add inserts directly to a channel or send signal to a return bus for shared processing. Bounce can render a demanding track in place while preserving the option to unfreeze it later.",
    },
  ],
  busInputs: [
    {
      title: "Signals entering this channel",
      body: "Inputs lists tracks, buses, and sends routed into the selected bus or master channel. Add routes a new source here, Remove disconnects that route, and the knob on each row adjusts its source level.",
    },
  ],
  busParameters: [
    {
      title: "Channel-wide controls",
      body: "Input Trim changes level before inserts, Pan places the channel in the stereo field, and Fader controls the final channel level. Solo, Mute, and Safe change how the channel participates in playback.",
    },
  ],
  busInserts: [
    {
      title: "Process the channel",
      body: "Inserts run in order from top to bottom and affect the full signal passing through this channel. Add an effect, edit its parameters, bypass it for comparison, or reorder the chain.",
    },
    {
      title: "Shared versus track effects",
      body: "Use track inserts for one sound and bus inserts when several tracks should share the same processing. Shared reverb or delay on a return bus usually gives clearer control and uses less processing.",
    },
  ],
  busOutput: [
    {
      title: "Choose the destination",
      body: "Bus To selects the next bus or the Master output. Mode chooses mono or stereo operation, and the meter shows the signal leaving this channel after inserts and fader control.",
    },
  ],
  busSends: [
    {
      title: "Send a parallel copy",
      body: "A send routes an adjustable copy of this channel to another bus while the original continues to its main output. Use sends for shared spaces, parallel compression, or layered effects.",
    },
  ],
  trackEffects: [
    {
      title: "Track insert chain",
      body: "Effects run from left to right in the order shown. Add a filter or effect, adjust its controls, bypass it to compare, or remove it without changing the source segment.",
    },
    {
      title: "Automation and performance",
      body: "Automatable effect parameters can change over the timeline. For expensive chains, use the mixer’s bounce control to render the track while keeping a recoverable source state.",
    },
  ],
  mastering: [
    {
      title: "Shape the final output",
      body: "Global Mastering applies to the complete project mix. Drag an EQ band to correct broad tonal balance, then use the master chain for final dynamics and level control.",
    },
    {
      title: "Automate deliberately",
      body: "The pencil opens time-based EQ automation. Small changes are usually easier to mix and export reliably than abrupt full-range moves across many bands.",
    },
  ],
  arpeggiator: [
    {
      title: "Repeat held notes as a pattern",
      body: "The arpeggiator turns held notes into a timed sequence. Choose its order and rate, then adjust the gate and octave behavior while the underlying MIDI remains unchanged.",
    },
  ],
  clipSource: [
    {
      title: "Map a source clip",
      body: "Clip instruments play selected regions of imported audio from MIDI notes. Set the source and playback region first, then shape looping, tuning, and envelope behavior.",
    },
  ],
  samplerAudio: [
    {
      title: "Build a multisample map",
      body: "Select or import several recordings, then drag each source onto the keyboard range it should play. Using multiple zones keeps an instrument natural across pitch instead of stretching one recording over the whole keyboard.",
    },
    {
      title: "Review every assignment",
      body: "Assigned counts show how many keyboard zones use each source. Select a zone to refine its pitch, velocity range, start and end points, looping, and playback response.",
    },
  ],
  drumTrack: [
    {
      title: "Audition the complete pattern",
      body: "The track controls play, record, and navigate the drum segment as a whole. Use them to check timing and instrument balance after assigning pads and editing individual hits.",
    },
  ],
  ampFilter: [
    {
      title: "Shape level and tone",
      body: "The amp envelope controls how the sound starts, sustains, and ends. The filter removes or emphasizes frequency ranges, and its envelope can make the tone evolve over each note.",
    },
  ],
} satisfies Record<string, RibbonHelpPage[]>;

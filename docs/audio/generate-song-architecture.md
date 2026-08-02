# Start from Something architecture

Status: phase 1 is implemented as an editable, deterministic planning path. It is not yet a claim that Beat can autonomously compose a release-ready song in every genre.

## Implemented pathway

Home → **Start from Something** asks for speed, genre, and randomness, then creates an unsaved, editable arrangement:

1. Writes a 16-beat seed made from two related phrases.
2. Derives editable statement, harmony, extrapolation, melodic inversion, simplification, and complication variants.
3. Selects one of several architectures rather than treating one form as universal:
   - verse/chorus: Intro–Verse–Pre–Chorus–Verse′–Chorus–Bridge–Final Chorus–Outro;
   - AABA, currently preferred for jazz/standards;
   - sectional: A–A′–B–C–A″, currently preferred for instrumental/ambient prompts.
4. Plans lead, harmony, bass, countermelody, and rhythm voices.
5. Assigns a pitch niche and texture to each voice. Every MIDI pitch may belong to at most two planned instruments; a two-voice overlap is valid only when the texture labels differ.
6. Creates a new playable instrument for every voice. A jazz selection therefore still creates a sax/reed role even without a sax sample. A reviewed sample-library replacement may be suggested, but is never downloaded silently.
7. Writes ordinary Beat MIDI segments. Consecutive identical material is represented as one source segment plus `repeats`, so it remains compact and editable.

Voice roles use separate generation grammars rather than uniformly copying the seed melody:

- **Lead:** highest pitch and duration variance, with phrase transformations, expressive length/velocity changes, passing notes, and speed-dependent subdivisions.
- **Harmony/accompaniment:** derives chord identity from the phrase, then repeats the same low-variance articulation cell at each harmonic change. The pitches move with the chord progression while the accompaniment rhythm remains recognizable.
- **Bass:** first coalesces adjacent equal chord roots into a stable harmonic pitch span. It then applies a separate speed-dependent articulation pattern, allowing one underlying pitch to be rhythmically retriggered without treating every attack as a new melodic pitch decision.
- **Countermelody:** simplified medium-variance material that appears only in sufficiently energetic sections and is removed where it overlaps the lead, leaving conversational gaps.
- **Rhythm:** controls pulse, accents, density, gaps, and fills independently of melodic contour.

The current generator is deterministic for the same prompt/seed. Model-assisted reharmonization and stylistic critique can be layered on later without making the project format dependent on a model response.

The generated project exists in Beat's in-memory document and recovery state. Its document path is explicitly `null`; Beat does not create a `.beat` project file, project folder, or sidecars until the user invokes Save and chooses a destination.

## Prompt controls

Speed controls tempo and event density together rather than merely multiplying the BPM:

| Setting | Intended behavior |
| --- | --- |
| Passive | 62 BPM, ambient pacing, sustained notes, sparse bass, and normally no percussion. |
| Slow | Long phrases, fewer subdivisions, restrained drums, and slower bass movement. |
| Medium | Genre-default pacing; pop uses 114 BPM, within the common 100–130 BPM pop range. |
| Fast | Higher subdivision and onset density with more active bass and drums. |
| Hyper | At least 184 BPM with chopped attacks, gaps, accents, stutters, and rhythm changes inspired by breakcore production density. |

The passive definition follows ambient music's emphasis on atmosphere, texture, drones, and sustained tone, often without a conventional beat (<https://www.masterclass.com/articles/ambient-music-guide>, <https://en.wikipedia.org/wiki/Ambient_music>). Hyper uses breakcore's fast, complex, highly edited breakbeats as a density reference (<https://en.wikipedia.org/wiki/Breakcore>); it does not copy a recording or a break sequence. For calibration, mainstream pop commonly sits around 100–130 BPM (<https://bpmcalc.com/genres/pop/>). Coldplay spans both ends of the product vocabulary: *The Scientist* is commonly felt around 73–75 BPM while published *Clocks* material marks approximately 130 BPM (<https://lasolsheet.com/piano-sheet-music/the-scientist/>, <https://www.musicnotes.com/sheetmusic/coldplay/clocks/MN0042978>).

Genre selects form, default tempo, tonal center, target loudness metadata, instrument roles, dynamic range, and melodic/rhythmic rules:

| Genre | Current starting architecture | Generated instrument character |
| --- | --- | --- |
| Pop | Verse/chorus with pre-chorus, bridge, and final lift | Bass, wide keys, bright lead, hook pluck, layered kit |
| Rap | Spacious verse/chorus with strong low-end anchors | 808 bass, dark keys, sparse lead, bell countermotif, punch kit |
| DnB | Sectional build, contrast, and return | Reese bass, air pad, signal lead, rapid arp, chopped-break engine |
| Jazz | AABA with conversational voices and wider dynamics | Upright bass, jazz keys, tenor sax, vibraphone, brush/ride kit |
| Reggae | Relaxed verse/chorus with offbeat emphasis | Deep bass, bubble organ, horn lead, skank guitar, one-drop kit |
| Classical | Longer sectional arc and motivic development | Cello, strings, solo violin, pizzicato countervoice, concert percussion |
| Electronic | Repeating cells with breakdown/drop contrast | Sub bass, motion pad, synth lead, sequenced pluck, electronic kit |

Randomness is a bounded structure control:

- **Low:** one motif, close transformations, repeated sections, no planned rhythm or key shifts.
- **Medium:** two related motifs, normal phrase development, and one measured rhythm change.
- **High:** three motifs, freer transformation, at least two temporary rhythm shifts, and temporary key movement while preserving recognizable anchors.

## Reference standards

These recordings are used only as high-level analytical references for form, density, texture, instrumentation, dynamics, and contrast. Beat must not reproduce their protected melodies, lyrics, signature note sequences, or recordings. The standards are deliberately multi-source and multi-genre:

| Reference | Abstract dimension used |
| --- | --- |
| Coldplay — *Clocks* | Repeating arpeggiated-hook role and cumulative layer build |
| Coldplay — *The Scientist* | Slow piano-ballad pacing and incremental voice entrances |
| Coldplay — *Viva la Vida* | Orchestral-pop ostinato role and sectional lift |
| Nas — *N.Y. State of Mind* | Sparse loop continuity and room for a lead vocal |
| Kendrick Lamar — *HUMBLE.* | Motif economy, low-end focus, and abrupt contrast |
| Goldie — *Inner City Life* | Fast-break energy against atmospheric and vocal release |
| Pendulum — *Slam* | DnB build/drop energy architecture |
| Miles Davis — *So What* | Modal space, call-and-response, and register separation |
| Duke Ellington — *Take the A Train* | AABA organization and ensemble-role contrast |
| Bob Marley and the Wailers — *Exodus* | Bass-led reggae identity and offbeat layer persistence |
| Beethoven — Symphony No. 5, opening movement | Motif economy, recurrence, and development |
| Debussy — *Clair de lune* | Sustained pacing, color, and long dynamic arc |
| Daft Punk — *Around the World* | Loop persistence and gradual timbral/layer change |
| Aphex Twin — *Xtal* | Atmospheric electronic texture with restrained rhythmic detail |
| Venetian Snares — *Hajnal* | Hyper-density contrast and highly articulated break editing |

This corpus is a product-test vocabulary, not a transcription or imitation dataset. Generated outputs should be tested for diversity and for excessive melodic similarity before any future model-assisted version ships.

## Theory model

The rules are intentionally assembled from multiple ideas instead of copied from one source.

- Open Music Theory's sentence model describes a presentation built from repeated basic ideas and a continuation that gains momentum. It also identifies fragmentation, sequential repetition, and faster surface/harmonic rhythm as continuation techniques: <https://openmusictheory.github.io/sentence.html>.
- Its thematic-function reference distinguishes statement, continuation, and cadence and provides operational meanings for fragmentation, liquidation, and sequence: <https://openmusictheory.github.io/themeFunctions>.
- Its development discussion treats form models as heuristics and emphasizes sequence and fragmentation in unstable central sections: <https://openmusictheory.github.io/sonataDevelopment.html>.
- Its harmonic syntax overview gives the broad tonic → optional predominant → dominant → tonic directional model used as a guardrail, not a mandatory progression: <https://openmusictheory.github.io/harmonicSyntax1.html>.
- The form layer combines those phrase-level ideas with common sectional alternatives (AABA, sectional return, and verse/chorus). No one template is selected for every style.

Transformation semantics in Beat:

- **Inversion:** reverse each melodic interval around an axis pitch; this is melodic inversion, not merely a chord voicing inversion.
- **Extrapolation:** continue the contour/rhythmic behavior of a motive beyond its original phrase.
- **Simplification:** retain structural attacks, lengthen values, and remove some subdivisions/ornaments.
- **Complication:** add lower-velocity passing tones and subdivisions while retaining the original anchors.
- **Chords:** create diatonic triads that try to contain the phrase's local anchor pitch.
- **Fragmentation/sequence:** reserved for development/continuation sections; fragmentation shortens the size of the reused unit, while sequence repeats it at another pitch level.

## Texture and pitch ownership

“Texture” is not a synonym for pitch range. Open Music Theory defines it through the density and interaction of voices, distinguishing monophony, heterophony, homophony, and polyphony: <https://viva.pressbooks.pub/openmusictheory/chapter/texture/>. Beat's phase-1 validator uses a narrower production proxy—reed, sustained pad, rounded bass, plucked, and percussive—to make overlapping ranges audibly distinguishable. A later validator should also measure rhythmic independence, spectral centroid, onset shape, masking, and register occupancy from the rendered result.

## Instrument acquisition

Acquisition order is:

1. Create a new local Aether/Lumen/Aurum-compatible instrument for every planned voice so generation never drops a required role.
2. Keep that instrument editable and tag its genre, speed, role, texture, and generated provenance.
3. Offer an optional reviewed external replacement with explicit format, source, and license.

The first reviewed catalog is VSCO 2 Community Edition: it publishes an SFZ release and the repository is CC0-1.0 (<https://github.com/sgossner/VSCO-2-CE>). Beat records the suggestion but does not silently download a large sample pack. A later acquisition UI should show download size, license, destination, attribution requirements, and a user confirmation before installing.

## Transcription recovery and repeat representation

Spotify Basic Pitch exposes onset threshold, frame threshold, and minimum note length in addition to frequency bounds. Beat now supplies bounded stem-specific values to recover more quiet/short events while leaving the model's Melodia cleanup enabled: <https://github.com/spotify/basic-pitch>.

After note conversion, Beat compares complete symbolic cycles using pitch, relative onset, duration, and a tolerant velocity term. Only a strong end-to-end match (default minimum confidence 0.90) becomes one MIDI source segment with additional repeats. This handles a fully repeated drum/melodic/arpeggio/chord loop without baking every copy into the note list.

This first pass deliberately does **not** collapse a chorus that merely resembles an earlier chorus, or a repeated subsection followed by unique material. Partial structure requires boundary discovery and multiple segments. A later phase can use self-similarity/recurrence methods as candidates, then confirm the boundaries symbolically. Librosa documents recurrence matrices as a representation of repeated frames (<https://librosa.org/doc/main/generated/librosa.segment.recurrence_matrix.html>), while music-structure research uses self-similarity and repeated-pattern boundaries at larger scales (<https://www.microsoft.com/en-us/research/publication/repeating-pattern-discovery-and-structure-analysis-from-acoustic-music-data/>).

## Next phases

1. Add confidence controls and an A/B audition for transcription recovery to prevent false-note inflation.
2. Add phrase/section boundary detection so repeated regions inside a longer transcription become separate looped segments with a unique tail preserved.
3. Expand the Start from Something review flow with editable seed phrase, transformation choices, form, energy curve, orchestration, and asset acquisition approvals before arrangement creation.
4. Render a masking analysis pass and revise octave/voicing when more than two timbres materially occupy the same spectral band.
5. Add genre packs as versioned rule bundles with citations, tests, and diversity benchmarks rather than hard-coded stereotypes.

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useRef, useState } from "react";
import { useContextMenu } from "../../components";
import { send } from "../../ipc/bridge";
import { useAudioFileStore, useProjectStore, useUiStore, useViewStore, useInstrumentStore, } from "../../state/store";
import { useComponentStore } from "../../state/components";
import { expandTrackSegments } from "../../state/selectors";
import { Segment } from "./Segment";
import styles from "./TrackLane.module.css";
/**
 * nextSegmentName — auto-numbers default segment names like "Midi 1",
 * "Audio 2", etc., based on existing segments of that kind on the track.
 * Skips numbers already in use so renamed gaps don't collide.
 */
function nextSegmentName(tracks, kind) {
    const stem = kind === "midi" ? "Midi" : kind === "audio" ? "Audio" : "Drums";
    const used = new Set();
    for (const track of tracks) {
        for (const s of track.segments) {
            if (s.payload.kind !== kind && (kind === "drum" || s.payload.kind !== "mixed"))
                continue;
            const m = (s.name ?? "").match(new RegExp(`^${stem}\\s+(\\d+)$`));
            if (m)
                used.add(parseInt(m[1], 10));
        }
    }
    let n = 1;
    while (used.has(n))
        n++;
    return `${stem} ${n}`;
}
/**
 * TrackLane — the right column for one track.
 *
 * Handles:
 *   - Beat gridlines
 *   - Segment rendering (incl. repeats)
 *   - Context menu (Add Audio / MIDI / Mute / Solo / Duplicate / Delete)
 *   - Drag-drop instrument from the Library list → creates a segment
 */
export function TrackLane({ trackId }) {
    const track = useProjectStore((s) => s.project.tracks.find((t) => t.id === trackId));
    const tracks = useProjectStore((s) => s.project.tracks);
    const lengthBeats = useProjectStore((s) => s.project.lengthBeats);
    const bpm = useProjectStore((s) => s.project.bpm);
    const beatsToPx = useViewStore((s) => s.beatsToPx);
    const lastLen = useViewStore((s) => s.lastSegmentLength);
    const setLastLen = useViewStore((s) => s.setLastSegmentLength);
    const addSegment = useProjectStore((s) => s.addSegment);
    const setTrackMute = useProjectStore((s) => s.setTrackMute);
    const setTrackSolo = useProjectStore((s) => s.setTrackSolo);
    const removeTrack = useProjectStore((s) => s.removeTrack);
    const openEditor = useUiStore((s) => s.openEditor);
    const instruments = useInstrumentStore((s) => s.instruments);
    const audioFiles = useAudioFileStore((s) => s.files);
    const addAudioFile = useAudioFileStore((s) => s.addFile);
    const laneRef = useRef(null);
    const lastClickBeatRef = useRef(0);
    const [dragOver, setDragOver] = useState(false);
    const expanded = useMemo(() => (track ? expandTrackSegments(track, lengthBeats) : []), [track, lengthBeats]);
    const { onContextMenu, menu } = useContextMenu(() => {
        if (!track)
            return [];
        return [
            {
                label: "Add MIDI",
                icon: "ph:piano-keys",
                onSelect: () => {
                    addSegment(trackId, {
                        name: nextSegmentName(tracks, "midi"),
                        startBeat: lastClickBeatRef.current,
                        lengthBeats: lastLen,
                        instrumentId: instruments.find((i) => i.name.toLowerCase() === "lead saw")?.id,
                        payload: { kind: "midi", notes: [] },
                    });
                },
            },
            {
                label: "Add Drums",
                icon: "ph:squares-four",
                onSelect: () => {
                    addSegment(trackId, {
                        name: nextSegmentName(tracks, "drum"),
                        startBeat: lastClickBeatRef.current,
                        lengthBeats: 16,
                        payload: {
                            kind: "drum",
                            stepCount: 16,
                            speed: 1,
                            defaultPitchHz: 261.63,
                            rows: makeDefaultDrumRows(instruments),
                        },
                    });
                },
            },
            {
                label: "Record sound",
                icon: "ph:record-fill",
                onSelect: () => {
                    addSegment(trackId, {
                        name: nextSegmentName(tracks, "audio"),
                        startBeat: lastClickBeatRef.current,
                        lengthBeats: lastLen,
                        payload: { kind: "audio", audioFileId: "", gainDb: 0 },
                    });
                },
            },
            {
                label: "Import Audio…",
                icon: "ph:upload",
                onSelect: async () => {
                    const resp = await send({ kind: "audio.import" });
                    if (resp.file)
                        addAudioFile(resp.file);
                    addSegment(trackId, {
                        name: nextSegmentName(tracks, "audio"),
                        startBeat: lastClickBeatRef.current,
                        lengthBeats: lastLen,
                        payload: {
                            kind: "audio",
                            audioFileId: resp.file?.id ?? "",
                            gainDb: 0,
                        },
                    });
                },
            },
            {
                label: track.mute ? "Unmute" : "Mute",
                icon: track.mute ? "ph:speaker-high" : "ph:speaker-x",
                onSelect: () => setTrackMute(trackId, !track.mute),
                disabled: track.solo,
                separatorBefore: true,
            },
            {
                label: track.solo ? "Unsolo" : "Solo",
                icon: "ph:headphones",
                onSelect: () => setTrackSolo(trackId, !track.solo),
            },
            {
                label: "Duplicate track",
                icon: "ph:copy",
                onSelect: () => duplicateTrackInline(trackId),
                separatorBefore: true,
            },
            {
                label: "Delete track",
                icon: "ph:trash",
                onSelect: () => removeTrack(trackId),
            },
        ];
    });
    function beatAtX(clientX) {
        const r = laneRef.current?.getBoundingClientRect();
        if (!r)
            return 0;
        return Math.max(0, Math.round((clientX - r.left) / beatsToPx));
    }
    function handleContextMenu(e) {
        lastClickBeatRef.current = beatAtX(e.clientX);
        onContextMenu(e);
    }
    // ----- Drag-and-drop --------------------------------------------------
    // Two accepted mimes:
    //   "application/x-beat-instrument" → empty MIDI segment bound to it
    //   "application/x-beat-component"  → MIDI segment cloned from the saved
    //                                     component's notes / length / instrument
    function handleDragOver(e) {
        const types = e.dataTransfer.types;
        if (types.includes("application/x-beat-instrument") ||
            types.includes("application/x-beat-component") ||
            types.includes("application/x-beat-audio-file")) {
            e.preventDefault();
            setDragOver(true);
        }
    }
    function handleDragLeave() {
        setDragOver(false);
    }
    function handleDrop(e) {
        setDragOver(false);
        const startBeat = beatAtX(e.clientX);
        const audioFileId = e.dataTransfer.getData("application/x-beat-audio-file");
        if (audioFileId) {
            const file = audioFiles.find((f) => f.id === audioFileId);
            if (!file || !track)
                return;
            const length = Math.max(0.25, file.durationSeconds * (bpm / 60));
            addSegment(trackId, {
                name: file.name || nextSegmentName(tracks, "audio"),
                startBeat,
                lengthBeats: length,
                payload: { kind: "audio", audioFileId: file.id, gainDb: 0 },
            });
            setLastLen(length);
            return;
        }
        const componentId = e.dataTransfer.getData("application/x-beat-component");
        if (componentId) {
            const comp = useComponentStore
                .getState()
                .components.find((c) => c.id === componentId);
            if (!comp || !track)
                return;
            if (comp.kind === "drum") {
                addSegment(trackId, {
                    name: comp.name || nextSegmentName(tracks, "drum"),
                    startBeat,
                    lengthBeats: comp.lengthBeats,
                    payload: {
                        kind: "drum",
                        rows: structuredClone(comp.rows),
                        stepCount: comp.stepCount,
                        speed: comp.speed,
                        defaultPitchHz: comp.defaultPitchHz,
                    },
                });
            }
            else {
                addSegment(trackId, {
                    name: comp.name || nextSegmentName(tracks, "midi"),
                    startBeat,
                    lengthBeats: comp.lengthBeats,
                    instrumentId: comp.instrumentId,
                    payload: { kind: "midi", notes: structuredClone(comp.notes) },
                });
            }
            setLastLen(comp.lengthBeats);
            return;
        }
        const instrumentId = e.dataTransfer.getData("application/x-beat-instrument");
        if (instrumentId) {
            const inst = instruments.find((i) => i.id === instrumentId);
            if (!inst || !track)
                return;
            addSegment(trackId, {
                name: nextSegmentName(tracks, "midi"),
                startBeat,
                lengthBeats: lastLen,
                instrumentId: inst.id,
                payload: { kind: "midi", notes: [] },
            });
            setLastLen(lastLen);
        }
    }
    if (!track)
        return null;
    const segById = new Map(track.segments.map((s) => [s.id, s]));
    return (_jsxs("div", { ref: laneRef, className: `${styles.lane} ${dragOver ? styles.dragOver : ""}`, style: { width: lengthBeats * beatsToPx, height: "var(--height-track-row)" }, onContextMenu: handleContextMenu, onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDrop: handleDrop, children: [Array.from({ length: lengthBeats + 1 }, (_, b) => (_jsx("div", { className: `${styles.gridLine} ${b % 4 === 0 ? styles.gridLineMajor : ""}`, style: { left: b * beatsToPx } }, b))), expanded.map((occ, idx) => {
                const original = segById.get(occ.segmentId);
                return (_jsx(Segment, { segmentId: occ.segmentId, startBeat: occ.startBeat, lengthBeats: occ.lengthBeats, repetition: occ.repetition, layer: original.layer, payloadKind: original.payload.kind, onEdit: () => openEditor({ kind: "segment", segmentId: occ.segmentId }) }, `${occ.segmentId}:${occ.repetition}:${idx}`));
            }), menu] }));
}
/**
 * Duplicate-track helper. Inlined here so TrackLane doesn't need to import
 * the same hook from TrackHeader (would cause circular imports).
 */
function duplicateTrackInline(trackId) {
    const { project, loadProject } = useProjectStore.getState();
    const idx = project.tracks.findIndex((t) => t.id === trackId);
    if (idx < 0)
        return;
    const src = project.tracks[idx];
    const newId = nano();
    const copy = {
        ...structuredClone(src),
        id: newId,
        name: `${src.name} copy`,
        segments: src.segments.map((s) => ({
            ...structuredClone(s),
            id: nano(),
            trackId: newId,
        })),
    };
    const tracks = [...project.tracks];
    tracks.splice(idx + 1, 0, copy);
    loadProject({ ...project, tracks });
}
import { nanoid as nano } from "nanoid";
function makeDefaultDrumRows(instruments) {
    const pick = (name) => instruments.find((i) => i.name.toLowerCase() === name.toLowerCase());
    const kick = pick("Basic Kick") ?? instruments[0];
    const snare = pick("Snap Snare") ?? instruments[1] ?? instruments[0];
    const hat = pick("Closed Hat") ?? pick("Lead Saw") ?? instruments[2] ?? instruments[0];
    return [
        {
            id: nano(),
            instrumentId: kick?.id,
            name: kick?.name ?? "Kick",
            steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
        },
        {
            id: nano(),
            instrumentId: snare?.id,
            name: snare?.name ?? "Snare",
            steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        },
        {
            id: nano(),
            instrumentId: hat?.id,
            name: hat?.name ?? "Hat",
            steps: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
        },
    ];
}

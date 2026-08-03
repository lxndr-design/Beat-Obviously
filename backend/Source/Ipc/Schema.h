#pragma once

#include <juce_core/juce_core.h>

namespace beat::ipc
{
    /**
     * IPC kind identifiers. KEEP IN SYNC with frontend/src/ipc/schema.ts.
     */
    namespace kind
    {
        // App lifecycle
        constexpr const char* APP_SHELL_READY     = "app.shellReady";
        constexpr const char* APP_STARTUP_STAGE   = "app.startupStage";
        constexpr const char* APP_READY           = "app.ready";

        // Transport
        constexpr const char* TRANSPORT_PLAY      = "transport.play";
        constexpr const char* TRANSPORT_PAUSE     = "transport.pause";
        constexpr const char* TRANSPORT_STOP      = "transport.stop";
        constexpr const char* TRANSPORT_RESTART   = "transport.restart";
        constexpr const char* TRANSPORT_SEEK      = "transport.seek";
        constexpr const char* TRANSPORT_SET_SPEED = "transport.setSpeed";
        constexpr const char* TRANSPORT_SET_LOOP  = "transport.setLoop";

        // Project / engine
        constexpr const char* PROJECT_SAVE        = "project.save";
        constexpr const char* PROJECT_LOAD        = "project.load";
        constexpr const char* PROJECT_LIST        = "project.list";
        constexpr const char* PROJECT_SAVE_FILE   = "project.saveFile";
        constexpr const char* PROJECT_OPEN_FILE   = "project.openFile";
        constexpr const char* PROJECT_RECENT_LIST = "project.recentList";
        constexpr const char* PROJECT_RECENT_REMOVE = "project.recentRemove";
        constexpr const char* PROJECT_REVEAL_FILE = "project.revealFile";
        constexpr const char* PROJECT_DUPLICATE_FILE = "project.duplicateFile";
        constexpr const char* PROJECT_CHOOSE_EXPORT_FOLDER = "project.chooseExportFolder";
        constexpr const char* PROJECT_INSPECT_DOCUMENT = "project.inspectDocument";
        constexpr const char* PROJECT_REPAIR_DOCUMENT = "project.repairDocument";
        constexpr const char* PROJECT_LIST_BACKUPS = "project.listBackups";
        constexpr const char* PROJECT_RESTORE_BACKUP = "project.restoreBackup";
        constexpr const char* PROJECT_RELINK_ASSET = "project.relinkAsset";
        constexpr const char* PROJECT_CLEANUP_ASSETS = "project.cleanupAssets";
        constexpr const char* PROJECT_EXPORT_WAV  = "project.exportWav";
        constexpr const char* PROJECT_EXPORT_TRACK_WAV = "project.exportTrackWav";
        constexpr const char* PROJECT_EXPORT_RANGE_WAV = "project.exportRangeWav";
        constexpr const char* PROJECT_BOUNCE_TRACK_WAV = "project.bounceTrackWav";
        constexpr const char* PROJECT_EXPORT_WAV_ASYNC = "project.exportWavAsync";
        constexpr const char* PROJECT_EXPORT_TRACK_WAV_ASYNC = "project.exportTrackWavAsync";
        constexpr const char* PROJECT_EXPORT_RANGE_WAV_ASYNC = "project.exportRangeWavAsync";
        constexpr const char* PROJECT_EXPORT_ALL_TRACK_WAVS_ASYNC = "project.exportAllTrackWavsAsync";
        constexpr const char* PROJECT_EXPORT_CANCEL = "project.exportCancel";
        constexpr const char* PROJECT_EXPORT_STATUS = "project.exportStatus";
        constexpr const char* ENGINE_APPLY_PROJECT = "engine.applyProject";
        constexpr const char* ENGINE_UPDATE_SEG   = "engine.updateSegment";
        constexpr const char* ENGINE_SET_PARAMETER = "engine.setParameter";
        constexpr const char* ENGINE_PREVIEW_MIDI_NOTE = "engine.previewMidiNote";
        constexpr const char* ENGINE_STOP_MIDI_PREVIEW = "engine.stopMidiPreview";
        constexpr const char* ENGINE_PREVIEW_AUDIO_SEGMENT = "engine.previewAudioSegment";
        constexpr const char* ENGINE_STOP_AUDIO_PREVIEW = "engine.stopAudioPreview";

        // Instruments
        constexpr const char* INSTRUMENT_SAVE     = "instrument.save";
        constexpr const char* INSTRUMENT_DELETE   = "instrument.delete";
        constexpr const char* INSTRUMENT_LIST     = "instrument.list";
        constexpr const char* INSTRUMENT_IMPORT_DECENT = "instrument.importDecent";
        constexpr const char* INSTRUMENT_IMPORT_SFZ = "instrument.importSfz";
        constexpr const char* INSTRUMENT_IMPORT_GRANULAR = "instrument.importGranular";
        constexpr const char* INSTRUMENT_RENDER_PREVIEW = "instrument.renderPreview";
        constexpr const char* INSTRUMENT_RESYNTHESIZE_WAVEMAP = "instrument.resynthesizeWavemap";

        // Audio files
        constexpr const char* AUDIO_IMPORT        = "audio.import";
        constexpr const char* AUDIO_IMPORT_MANY   = "audio.importMany";
        constexpr const char* AUDIO_LIST          = "audio.list";
        constexpr const char* AUDIO_DELETE        = "audio.delete";
        constexpr const char* AUDIO_REVEAL        = "audio.reveal";
        constexpr const char* AUDIO_WAVEFORM      = "audio.waveform";
        constexpr const char* AUDIO_PREVIEW_DATA  = "audio.previewData";
        constexpr const char* AUDIO_STEMS_START   = "audio.stemsStart";
        constexpr const char* AUDIO_STEMS_STATUS  = "audio.stemsStatus";
        constexpr const char* AUDIO_STEMS_CANCEL  = "audio.stemsCancel";
        constexpr const char* AUDIO_TRANSCRIPTION_START  = "audio.transcriptionStart";
        constexpr const char* AUDIO_TRANSCRIPTION_STATUS = "audio.transcriptionStatus";
        constexpr const char* AUDIO_TRANSCRIPTION_CANCEL = "audio.transcriptionCancel";
        constexpr const char* AUDIO_LIST_DEVICES  = "audio.listDevices";
        constexpr const char* AUDIO_SELECT_INPUT_DEVICE = "audio.selectInputDevice";
        constexpr const char* AUDIO_SELECT_OUTPUT_DEVICE = "audio.selectOutputDevice";

        // Notated scores
        constexpr const char* SCORE_IMPORT = "score.import";
        constexpr const char* SCORE_IMPORT_LIBRARY = "score.importLibrary";
        constexpr const char* SCORE_REVEAL_ARTIFACTS = "score.revealArtifacts";
        constexpr const char* SCORE_OPEN_OCR_REVIEW = "score.openOcrReview";

        // Recording
        constexpr const char* RECORDING_PLAN      = "recording.plan";
        constexpr const char* RECORDING_PREPARE   = "recording.prepare";
        constexpr const char* RECORDING_START     = "recording.start";
        constexpr const char* RECORDING_STOP      = "recording.stop";
        constexpr const char* RECORDING_CANCEL    = "recording.cancel";
        constexpr const char* RECORDING_STATUS    = "recording.status";
        constexpr const char* RECORDING_WRITE_WAV = "recording.writeWav";
        constexpr const char* RECORDING_COMMIT_TAKE = "recording.commitTake";

        // EQ
        constexpr const char* EQ_SET_AUTOMATION   = "eq.setAutomation";

        // Misc
        constexpr const char* DIAGNOSTICS_READ_LOG = "diagnostics.readLog";
        constexpr const char* DIAGNOSTICS_CLEAR_LOG = "diagnostics.clearLog";
        constexpr const char* DIAGNOSTICS_SAVE_LOG = "diagnostics.saveLog";
        constexpr const char* DIAGNOSTICS_WRITE = "diagnostics.write";
        constexpr const char* PING                = "ping";

        // Inbound events (C++ → JS)
        constexpr const char* EV_POSITION_CHANGED = "transport.positionChanged";
        constexpr const char* EV_PLAYBACK_ENDED   = "transport.playbackEnded";
        constexpr const char* EV_SAFETY_MUTED     = "transport.safetyMuted";
        constexpr const char* EV_SEGMENT_TRIGGER  = "engine.segmentTrigger";
        constexpr const char* EV_LEVEL_METERS     = "engine.levelMeters";
        constexpr const char* EV_ANALYZER_SPECTRUM = "analyzer.spectrum";
        constexpr const char* EV_RENDER_TIMING    = "engine.renderTiming";
        constexpr const char* EV_DEVICE_CHANGED   = "audio.deviceChanged";
        constexpr const char* EV_SYNTH_EXPRESSION_ACTIVITY = "synth.expressionActivity";
        constexpr const char* EV_EXPORT_PROGRESS  = "project.exportProgress";
        constexpr const char* EV_LOG              = "log";
    }
}

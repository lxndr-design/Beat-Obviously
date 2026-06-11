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
        constexpr const char* PROJECT_EXPORT_CANCEL = "project.exportCancel";
        constexpr const char* PROJECT_EXPORT_STATUS = "project.exportStatus";
        constexpr const char* ENGINE_APPLY_PROJECT = "engine.applyProject";
        constexpr const char* ENGINE_UPDATE_SEG   = "engine.updateSegment";
        constexpr const char* ENGINE_SET_PARAMETER = "engine.setParameter";

        // Instruments
        constexpr const char* INSTRUMENT_SAVE     = "instrument.save";
        constexpr const char* INSTRUMENT_DELETE   = "instrument.delete";
        constexpr const char* INSTRUMENT_LIST     = "instrument.list";
        constexpr const char* INSTRUMENT_IMPORT_DECENT = "instrument.importDecent";
        constexpr const char* INSTRUMENT_RENDER_PREVIEW = "instrument.renderPreview";

        // Audio files
        constexpr const char* AUDIO_IMPORT        = "audio.import";
        constexpr const char* AUDIO_IMPORT_MANY   = "audio.importMany";
        constexpr const char* AUDIO_LIST          = "audio.list";
        constexpr const char* AUDIO_DELETE        = "audio.delete";
        constexpr const char* AUDIO_REVEAL        = "audio.reveal";
        constexpr const char* AUDIO_WAVEFORM      = "audio.waveform";
        constexpr const char* AUDIO_LIST_DEVICES  = "audio.listDevices";
        constexpr const char* AUDIO_SELECT_INPUT_DEVICE = "audio.selectInputDevice";

        // EQ
        constexpr const char* EQ_SET_AUTOMATION   = "eq.setAutomation";

        // Local AI training
        constexpr const char* TRAINING_RUN        = "training.run";

        // Misc
        constexpr const char* PING                = "ping";

        // Inbound events (C++ → JS)
        constexpr const char* EV_POSITION_CHANGED = "transport.positionChanged";
        constexpr const char* EV_PLAYBACK_ENDED   = "transport.playbackEnded";
        constexpr const char* EV_SEGMENT_TRIGGER  = "engine.segmentTrigger";
        constexpr const char* EV_LEVEL_METERS     = "engine.levelMeters";
        constexpr const char* EV_ANALYZER_SPECTRUM = "analyzer.spectrum";
        constexpr const char* EV_RENDER_TIMING    = "engine.renderTiming";
        constexpr const char* EV_DEVICE_CHANGED   = "audio.deviceChanged";
        constexpr const char* EV_TRAINING_STATUS  = "training.status";
        constexpr const char* EV_EXPORT_PROGRESS  = "project.exportProgress";
        constexpr const char* EV_LOG              = "log";
    }
}

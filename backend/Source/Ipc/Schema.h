#pragma once

#include <juce_core/juce_core.h>

namespace beat::ipc
{
    /**
     * IPC kind identifiers. KEEP IN SYNC with frontend/src/ipc/schema.ts.
     */
    namespace kind
    {
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
        constexpr const char* PROJECT_EXPORT_WAV  = "project.exportWav";
        constexpr const char* ENGINE_APPLY_PROJECT = "engine.applyProject";
        constexpr const char* ENGINE_UPDATE_SEG   = "engine.updateSegment";
        constexpr const char* ENGINE_SET_PARAMETER = "engine.setParameter";

        // Instruments
        constexpr const char* INSTRUMENT_SAVE     = "instrument.save";
        constexpr const char* INSTRUMENT_DELETE   = "instrument.delete";
        constexpr const char* INSTRUMENT_LIST     = "instrument.list";
        constexpr const char* INSTRUMENT_IMPORT_DECENT = "instrument.importDecent";

        // Audio files
        constexpr const char* AUDIO_IMPORT        = "audio.import";
        constexpr const char* AUDIO_IMPORT_MANY   = "audio.importMany";
        constexpr const char* AUDIO_LIST          = "audio.list";

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
        constexpr const char* EV_LOG              = "log";
    }
}

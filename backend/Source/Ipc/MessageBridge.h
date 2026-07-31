#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include "../Audio/AudioEngine.h"
#include "../Audio/Analysis/AudioToMidiService.h"
#include "../Audio/Analysis/StemSeparationService.h"
#include "../Persistence/Database.h"
#include "../Persistence/ProjectRepository.h"
#include "../Persistence/InstrumentRepository.h"

#include <atomic>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

namespace beat
{
    /**
     * MessageBridge — wires the web frontend to the C++ engine + database.
     *
     * On install():
     *   - registers a JS-callable native function "request" on the
     *     WebBrowserComponent. JS calls `window.__BEAT_NATIVE__.request(kind,
     *     payload)` and receives a Promise<response>.
     *   - exposes a `subscribe(listener)` JS-callable that returns an
     *     unsubscribe function. The bridge dispatches events to all
     *     subscribers via WebBrowserComponent::evaluateJavascript().
     *
     * On audio events, the engine calls back into this bridge which marshals
     * to the message thread and pushes JSON over the JS bridge.
     */
    class MessageBridge : private juce::Timer
    {
    public:
        MessageBridge(AudioEngine& engine, Database& db, juce::WebBrowserComponent& browser);
        ~MessageBridge();

        /** Hook the bridge into the WebBrowserComponent. Idempotent. */
        void install();

        /** Push an inbound event to all JS subscribers. Safe to call from
         *  any thread — marshals to the message thread. */
        void emit(const juce::String& kind, const juce::var& payload);

        /** Dispatch a JS/native request. Called by MainComponent's JUCE
         *  WebBrowser native function bridge. */
        juce::var handleRequest(const juce::String& kind, const juce::var& payload);

        std::function<void()> onAppShellReady;
        std::function<void()> onAppReady;

    private:
        void timerCallback() override;

        struct ExportJob
        {
            juce::String id;
            juce::String type;
            juce::String path;
            mutable std::mutex statusLock;
            std::atomic<bool> cancel { false };
            std::atomic<bool> finished { false };
            std::atomic<bool> ok { false };
            std::atomic<double> progress { 0.0 };
            std::atomic<juce::int64> samplesWritten { 0 };
            std::atomic<juce::int64> totalSamples { 0 };
            juce::String error;
            juce::var analysis;
        };

        void joinFinishedExportThreadIfNeeded();
        juce::var exportJobStatusVar(const std::shared_ptr<ExportJob>& job) const;
        juce::var audioToMidiStatusVar(const AudioToMidiService::Status& status) const;
        juce::var stemSeparationStatusVar(const StemSeparationService::Status& status);

        struct WaveformCacheEntry
        {
            juce::String path;
            juce::int64 modifiedMs { 0 };
            juce::int64 sizeBytes { 0 };
            int bucketCount { 0 };
            juce::var waveform;
        };

        AudioEngine&             engine;
        Database&                database;
        juce::WebBrowserComponent& browser;
        ProjectRepository        projectRepo { database };
        InstrumentRepository     instrumentRepo { database };

        // JS subscriber callbacks — the JS side passes a function reference
        // which we keep here so we can invoke it from C++ on inbound events.
        juce::Array<juce::var> subscribers;
        juce::CriticalSection  subscribersLock;
        mutable std::mutex exportJobLock;
        std::shared_ptr<ExportJob> activeExportJob;
        std::thread exportThread;
        AudioToMidiService audioToMidi;
        StemSeparationService stemSeparation;
        juce::String finalizedStemJobId;
        juce::String finalizedStemError;
        juce::var finalizedStemResults;
        std::vector<WaveformCacheEntry> waveformCache;
        uint64_t lastAnalyzerSequence { 0 };
        uint64_t lastRenderTimingSequence { 0 };
        uint64_t lastTrackMeterSequence { 0 };
        double bridgeStartedMs { 0.0 };
        double lastTimerCallbackMs { 0.0 };
        double lastLoadLogMs { 0.0 };
        int64_t lastLoggedDeadlineOverruns { 0 };
        int64_t lastLoggedNoteOffOverflows { 0 };
        int64_t lastLoggedOverloadSafetyMutes { 0 };
        int64_t lastLoggedLockMisses { 0 };
        bool overloadWasActive { false };
        juce::String activeProjectId;
    };
}

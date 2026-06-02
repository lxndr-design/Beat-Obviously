#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include "../Audio/AudioEngine.h"
#include "../Persistence/Database.h"
#include "../Persistence/ProjectRepository.h"
#include "../Persistence/InstrumentRepository.h"

namespace beat
{
    /**
     * MessageBridge — wires the React frontend to the C++ engine + database.
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

    private:
        void timerCallback() override;

        AudioEngine&             engine;
        Database&                database;
        juce::WebBrowserComponent& browser;
        ProjectRepository        projectRepo { database };
        InstrumentRepository     instrumentRepo { database };

        // JS subscriber callbacks — the JS side passes a function reference
        // which we keep here so we can invoke it from C++ on inbound events.
        juce::Array<juce::var> subscribers;
        juce::CriticalSection  subscribersLock;
        uint64_t lastAnalyzerSequence { 0 };
        uint64_t lastRenderTimingSequence { 0 };
    };
}

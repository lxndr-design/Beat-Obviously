#pragma once

#include <juce_audio_utils/juce_audio_utils.h>
#include "Sequencer.h"
#include "InstrumentVoice.h"
#include "Analysis/FftAnalyzer.h"
#include "Effects/Bitcrush.h"
#include "Effects/MasterEq.h"
#include "Realtime/RealtimeParameterQueue.h"
#include <array>
#include <functional>
#include <map>
#include <memory>
#include <string_view>
#include <vector>

namespace beat
{
    /**
     * AudioEngine — owns the device, the synth, the sequencer, and the
     * master FX chain.
     *
     * Threading model:
     *   - prepare(), shutdown(), apply*() are called from the message thread
     *   - audio rendering happens in audioDeviceIOCallback on the audio thread
     *   - state shared between threads is std::atomic or guarded by
     *     ScopedLock with a tiny critical section
     */
    class AudioEngine : public juce::AudioIODeviceCallback
    {
    public:
        AudioEngine();
        ~AudioEngine() override;

        void prepare();
        void prepareForOffline(double sampleRate, int blockSize, int numOutputChannels);
        void shutdown();

        Sequencer& sequencer() { return seq; }

        // --- IPC-facing mutators ----------------------------------------
        void applyProject(Project p);
        void setEqAutomation(std::vector<EqAutomationPoint> pts);
        void stopAllNotes(bool allowTailOff);
        void requestPlay();
        void requestPause();
        void requestStop();
        void requestRestart();
        void requestSeek(Beats positionBeat);
        void requestSpeed(double speed);
        void requestLoop(Beats start, Beats end);
        void requestClearLoop();
        bool queueRealtimeParameterChange(Id instrumentId,
                                          juce::String parameterId,
                                          float value,
                                          int sampleOffset = 0,
                                          int rampSamples = 0) noexcept;
        bool pullMasterAnalyzerSnapshot(FftAnalyzer::Snapshot& out) const noexcept;

        struct RenderTimingSnapshot
        {
            uint64_t sequence { 0 };
            int blockSamples { 0 };
            double sampleRate { 44100.0 };
            double scheduleMs { 0.0 };
            double synthMs { 0.0 };
            double samplesMs { 0.0 };
            double fxMs { 0.0 };
            double analyzerMs { 0.0 };
            double copyMs { 0.0 };
            double totalMs { 0.0 };
            double loadPercent { 0.0 };
        };

        bool pullRenderTimingSnapshot(RenderTimingSnapshot& out) const noexcept;

        // --- Listeners (notify the MessageBridge to push events to JS) --
        std::function<void(Beats)> onPositionChanged;
        std::function<void(const Sequencer::TriggerEvent&)> onSegmentTriggered;

        // AudioIODeviceCallback
        void audioDeviceIOCallbackWithContext(const float* const* /*inputChannelData*/,
                                              int /*numInputChannels*/,
                                              float* const* outputChannelData,
                                              int numOutputChannels,
                                              int numSamples,
                                              const juce::AudioIODeviceCallbackContext&) override;
        void audioDeviceAboutToStart(juce::AudioIODevice* device) override;
        void audioDeviceStopped() override;

    private:
        juce::AudioDeviceManager device;
        juce::Synthesiser        synth;
        Sequencer                seq;
        Bitcrush                 bitcrush;
        MasterEq                 masterEq;
        FftAnalyzer              masterAnalyzer;

        juce::AudioBuffer<float> mixBuf;
        double sampleRate { 44100.0 };

        struct SampleBuffer
        {
            juce::AudioBuffer<float> audio;
            double sourceSampleRate { 44100.0 };
        };

        struct SampleInstrument
        {
            struct Zone
            {
                std::shared_ptr<SampleBuffer> buffer;
                int rootNote { 60 };
                int loNote { 0 };
                int hiNote { 127 };
                int loVel { 0 };
                int hiVel { 127 };
                float volumeDb { 0.0f };
                float pan { 0.0f };
                float tuningCents { 0.0f };
                int seqPosition { 0 };
            };

            std::vector<Zone> zones;
            int nextIndex { 0 };
        };

        struct ActiveSampleVoice
        {
            std::shared_ptr<SampleBuffer> sample;
            double position { 0.0 };
            double rate { 1.0 };
            float gain { 0.5f };
            float pan { 0.0f };
            int startOffset { 0 };
        };

        struct ScheduledNoteOff
        {
            Id trackId;
            Id instrumentId;
            int pitch { 60 };
            int samplesUntilOff { 0 };
        };

        struct PendingParameterAutomation
        {
            RealtimeParameterChange change;
            int samplesUntilEvent { 0 };
        };

        struct InstrumentRenderState
        {
            Id trackId;
            Id instrumentId;
            std::unique_ptr<juce::Synthesiser> synth;
            juce::MidiBuffer midi;
            float gainDb { 0.0f };
            float pan { 0.0f };
            std::array<InstrumentVoice::NoteAutomationContext, InstrumentVoice::maxPendingNoteAutomationContexts> noteAutomationContexts {};
            int noteAutomationContextCount { 0 };
        };

        std::vector<ScheduledNoteOff> pendingNoteOffs;
        std::vector<PendingParameterAutomation> pendingParameterAutomation;
        std::vector<RealtimeParameterChange> blockRealtimeParameterEvents;
        std::array<InstrumentVoice::NoteAutomationContext, InstrumentVoice::maxPendingNoteAutomationContexts> defaultNoteAutomationContexts {};
        int defaultNoteAutomationContextCount { 0 };
        std::vector<ActiveSampleVoice> activeSampleVoices;
        std::vector<InstrumentRenderState> instrumentRenderStates;
        std::map<juce::String, SampleInstrument> sampleInstruments;
        juce::AudioFormatManager formatManager;
        juce::AudioBuffer<float> routeBuf;
        juce::CriticalSection sampleLock;
        RealtimeParameterQueue<1024> realtimeParameterChanges;

        std::unique_ptr<juce::Synthesiser> createInstrumentSynth(const InstrumentDefinition& instrument);
        void rebuildSampleInstruments(const Project& project);
        InstrumentRenderState* findInstrumentRenderState(const Id& instrumentId);
        InstrumentRenderState* findTrackRenderState(const Id& trackId, const Id& instrumentId);
        bool startSampleVoiceLocked(const Sequencer::TriggerEvent& ev);
        void renderSampleVoicesLocked(int numSamples);
        void addRouteToMixLocked(juce::AudioBuffer<float>& route, int numSamples, float gainDb, float pan) noexcept;
        void drainRealtimeParameterChangesLocked(int numSamples) noexcept;
        void advancePendingParameterAutomationLocked(int numSamples) noexcept;
        void scheduleNoteAutomationLocked(const Sequencer::TriggerEvent& ev) noexcept;
        void renderSynthWithRealtimeParametersLocked(juce::Synthesiser& targetSynth,
                                                     juce::AudioBuffer<float>& output,
                                                     juce::MidiBuffer& midi,
                                                     std::string_view instrumentId,
                                                     int numSamples) noexcept;
        bool applyRealtimeParameterToSynth(juce::Synthesiser& targetSynth,
                                           std::string_view parameterId,
                                           float value,
                                           int rampSamples) noexcept;
        void publishRenderTiming(int numSamples,
                                 int64_t scheduleTicks,
                                 int64_t synthTicks,
                                 int64_t samplesTicks,
                                 int64_t fxTicks,
                                 int64_t analyzerTicks,
                                 int64_t copyTicks,
                                 int64_t totalTicks) noexcept;

        // Used to throttle position-change notifications to ~60Hz so we
        // don't flood the JS bridge.
        std::atomic<int64_t> lastPositionPushSamples { 0 };

        std::atomic<uint64_t> renderTimingSequence { 0 };
        std::atomic<int> renderTimingBlockSamples { 0 };
        std::atomic<int64_t> renderTimingScheduleTicks { 0 };
        std::atomic<int64_t> renderTimingSynthTicks { 0 };
        std::atomic<int64_t> renderTimingSamplesTicks { 0 };
        std::atomic<int64_t> renderTimingFxTicks { 0 };
        std::atomic<int64_t> renderTimingAnalyzerTicks { 0 };
        std::atomic<int64_t> renderTimingCopyTicks { 0 };
        std::atomic<int64_t> renderTimingTotalTicks { 0 };
    };
}

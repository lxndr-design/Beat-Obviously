#pragma once

#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_dsp/juce_dsp.h>
#include "Sequencer.h"
#include "InstrumentVoice.h"
#include "Analysis/FftAnalyzer.h"
#include "Effects/Bitcrush.h"
#include "Effects/MasterEq.h"
#include "Effects/MasterLimiter.h"
#include "Recording/RecordingCapture.h"
#include "Realtime/RealtimeParameterQueue.h"
#include "Realtime/VoiceNoteAutomation.h"
#include <array>
#include <atomic>
#include <functional>
#include <limits>
#include <map>
#include <memory>
#include <string_view>
#include <vector>

namespace beat
{
    struct TransportCommand
    {
        enum class Type
        {
            Play,
            Pause,
            Stop,
            Restart,
            Seek,
            Speed,
            SetLoop,
            ClearLoop,
        };

        Type type { Type::Play };
        Beats valueA { 0.0 };
        Beats valueB { 0.0 };
    };

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
        using RenderProgressCallback = std::function<bool(double progress,
                                                          juce::int64 samplesWritten,
                                                          juce::int64 totalSamples)>;

        AudioEngine();
        ~AudioEngine() override;

        void prepare();
        bool prepareWithDefaultDevices(int inputChannels,
                                       int outputChannels = 2,
                                       juce::String* error = nullptr);
        struct AudioDeviceInfo
        {
            juce::String typeName;
            juce::String name;
            bool input { false };
            bool output { false };
            bool currentInput { false };
            bool currentOutput { false };
        };

        struct AudioDeviceSnapshot
        {
            juce::String currentTypeName;
            juce::String currentInputName;
            juce::String currentOutputName;
            double sampleRate { 0.0 };
            int bufferSize { 0 };
            int inputLatencySamples { 0 };
            int outputLatencySamples { 0 };
            juce::StringArray inputChannelNames;
            juce::StringArray outputChannelNames;
            std::vector<AudioDeviceInfo> devices;
        };

        AudioDeviceSnapshot listAudioDevices(bool scanAvailableDevices = true);
        bool selectInputDevice(const juce::String& typeName,
                               const juce::String& inputDeviceName,
                               int inputChannelCount,
                               juce::String* error = nullptr);
        void prepareForOffline(double sampleRate, int blockSize, int numOutputChannels);
        static bool renderProjectToWav(Project project,
                                       const juce::File& outputFile,
                                       double sampleRate = 44100.0,
                                       int blockSize = 512,
                                       int numOutputChannels = 2,
                                       juce::String* error = nullptr,
                                       RenderProgressCallback progress = {},
                                       int bitDepth = 16);
        static bool renderProjectRangeToWav(Project project,
                                            Beats startBeat,
                                            Beats endBeat,
                                            const juce::File& outputFile,
                                            bool includeTail = false,
                                            double sampleRate = 44100.0,
                                            int blockSize = 512,
                                            int numOutputChannels = 2,
                                            juce::String* error = nullptr,
                                            RenderProgressCallback progress = {},
                                            int bitDepth = 16);
        static bool renderTrackToWav(Project project,
                                     const Id& trackId,
                                     const juce::File& outputFile,
                                     double sampleRate = 44100.0,
                                     int blockSize = 512,
                                     int numOutputChannels = 2,
                                     juce::String* error = nullptr,
                                     RenderProgressCallback progress = {},
                                     int bitDepth = 16);
        static int estimateProjectLatencySamples(const Project& project) noexcept;
        int getProjectLatencySamples() const noexcept { return projectLatencySamples; }
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

        struct TrackMeterSnapshot
        {
            Id trackId;
            float rms { 0.0f };
            float peak { 0.0f };
            float leftRms { 0.0f };
            float rightRms { 0.0f };
            float leftPeak { 0.0f };
            float rightPeak { 0.0f };
            float rmsDbFS { -std::numeric_limits<float>::infinity() };
            float peakDbFS { -std::numeric_limits<float>::infinity() };
            float truePeakDbTP { -std::numeric_limits<float>::infinity() };
            float momentaryLufs { -std::numeric_limits<float>::infinity() };
            uint64_t sequence { 0 };
        };

        bool pullTrackMeterSnapshots(std::vector<TrackMeterSnapshot>& out);

        struct RenderTimingSnapshot
        {
            uint64_t sequence { 0 };
            int blockSamples { 0 };
            double sampleRate { 44100.0 };
            double scheduleMs { 0.0 };
            double synthMs { 0.0 };
            double voiceMs { 0.0 };
            double modulationMs { 0.0 };
            double samplesMs { 0.0 };
            double fxMs { 0.0 };
            double filterFxMs { 0.0 };
            double analyzerMs { 0.0 };
            double copyMs { 0.0 };
            double totalMs { 0.0 };
            double loadPercent { 0.0 };
            int activeSynthVoices { 0 };
            int activeSampleVoices { 0 };
            int activeAudioClipVoices { 0 };
            int routeCount { 0 };
            int automationEventCount { 0 };
            int64_t wavetableCacheHits { 0 };
            int64_t wavetableCacheMisses { 0 };
            int wavetableCacheSize { 0 };
            int64_t voiceRenderBlocks { 0 };
            int64_t voiceRenderSamples { 0 };
            int64_t oscillatorSamples { 0 };
            int64_t wavetableVoiceSamples { 0 };
            int64_t aetherOscASamples { 0 };
            int64_t aetherOscBSamples { 0 };
            int64_t aetherSubSamples { 0 };
            int64_t aetherNoiseSamples { 0 };
            int64_t filterSamples { 0 };
            int64_t filterDriveSamples { 0 };
            int64_t filterCoefficientUpdates { 0 };
            int64_t filterCutoffUpdates { 0 };
            int64_t filterResonanceUpdates { 0 };
            int64_t modulationSamples { 0 };
            int64_t realtimeRampSamples { 0 };
            int64_t oscillatorRateCalculations { 0 };
            int64_t wavetableFrequencyUpdates { 0 };
            int64_t wavetablePositionUpdates { 0 };
            int64_t routeEffectSamples { 0 };
            int64_t routeFilterEffectSamples { 0 };
            int64_t routeNonlinearEffectSamples { 0 };
            int64_t routeDelayEffectSamples { 0 };
        };

        bool pullRenderTimingSnapshot(RenderTimingSnapshot& out) const noexcept;
        bool prepareInputRecording(double maxDurationSeconds,
                                   int channels = 2,
                                   juce::String* error = nullptr);
        void startInputRecording() noexcept;
        RecordingCaptureStats stopInputRecording() noexcept;
        void cancelInputRecording() noexcept;
        RecordingCaptureStats inputRecordingStats() const noexcept;
        const RecordingCapture& inputRecordingCapture() const noexcept { return inputRecording; }
        bool writeInputRecordingToWav(const juce::File& outputFile,
                                      juce::String* error = nullptr,
                                      int bitDepth = 24) const;
        void setInputMonitoringEnabled(bool enabled, float gainDb = 0.0f) noexcept;
        bool isInputMonitoringEnabled() const noexcept;

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
        std::unique_ptr<juce::AudioDeviceManager> device;
        juce::Synthesiser        synth;
        Sequencer                seq;
        Bitcrush                 bitcrush;
        MasterEq                 masterEq;
        MasterLimiter            masterLimiter;
        FftAnalyzer              masterAnalyzer;
        MasterChainSettings      masterChainSettings;
        float                    masterCompressorEnvelope { 0.0f };

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
                bool loopEnabled { false };
                int loopStart { 0 };
                int loopEnd { 0 };
                bool oneShot { false };
                double durationSeconds { 0.0 };
                double loLengthSeconds { 0.0 };
                double hiLengthSeconds { 0.0 };
                int chokeGroup { 0 };
                int startSample { 0 };
                int endSample { 0 };
            };

            std::vector<Zone> zones;
            int nextIndex { 0 };
            float attackMs { 1.0f };
            float releaseMs { 60.0f };
        };

        struct ActiveSampleVoice
        {
            Id trackId;
            Id instrumentId;
            std::shared_ptr<SampleBuffer> sample;
            double position { 0.0 };
            double rate { 1.0 };
            float gain { 0.5f };
            float pan { 0.0f };
            int startOffset { 0 };
            int remainingSamples { 0 };
            int elapsedSamples { 0 };
            int attackSamples { 0 };
            int releaseSamples { 0 };
            int releaseRemainingSamples { -1 };
            int endFadeSamples { 64 };
            bool loopEnabled { false };
            int loopStart { 0 };
            int loopEnd { 0 };
            bool oneShot { false };
            int chokeGroup { 0 };
            int sampleEnd { 0 };
        };

        struct ActiveAudioClipVoice
        {
            Id trackId;
            std::shared_ptr<SampleBuffer> sample;
            double position { 0.0 };
            double rate { 1.0 };
            float gain { 1.0f };
            int startOffset { 0 };
            int remainingSamples { 0 };
            int elapsedSamples { 0 };
            int totalSamples { 0 };
            int fadeInSamples { 0 };
            int fadeOutSamples { 0 };
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

        struct RouteParameterAutomationEvent
        {
            Id trackId;
            juce::String parameterId;
            float value { 0.0f };
            int sampleOffset { 0 };
            int rampSamples { 0 };
        };

        struct InstrumentRenderState
        {
            struct DelayEffectState
            {
                juce::AudioBuffer<float> buffer;
                int writePosition { 0 };
            };

            struct CompressorEffectState
            {
                float envelope { 0.0f };
            };

            struct BitcrushEffectState
            {
                std::vector<float> heldSamples;
                int holdCounter { 0 };
            };

            struct NonlinearEffectState
            {
                std::vector<float> previousInput;
                std::vector<float> lowpass;
            };

            struct ChorusEffectState
            {
                juce::AudioBuffer<float> buffer;
                int writePosition { 0 };
                float phase { 0.0f };
            };

            struct PhaserEffectState
            {
                static constexpr int stageCount = 4;
                std::vector<std::array<float, stageCount>> x1;
                std::vector<std::array<float, stageCount>> y1;
                std::vector<float> feedback;
                float phase { 0.0f };
            };

            Id trackId;
            Id instrumentId;
            Id parentTrackId;
            std::unique_ptr<juce::Synthesiser> synth;
            juce::MidiBuffer midi;
            float gainDb { 0.0f };
            float pan { 0.0f };
            std::vector<TrackEffect> effects;
            std::vector<TrackSend> sends;
            float baseGainDb { 0.0f };
            float basePan { 0.0f };
            std::vector<TrackEffect> baseEffects;
            std::vector<std::unique_ptr<juce::dsp::StateVariableTPTFilter<float>>> filterStates;
            std::vector<std::unique_ptr<juce::Reverb>> reverbStates;
            std::vector<std::unique_ptr<DelayEffectState>> delayStates;
            std::vector<std::unique_ptr<DelayEffectState>> pluginLatencyStates;
            std::vector<BitcrushEffectState> bitcrushStates;
            std::vector<NonlinearEffectState> nonlinearStates;
            std::vector<std::unique_ptr<ChorusEffectState>> chorusStates;
            std::vector<std::unique_ptr<PhaserEffectState>> phaserStates;
            std::unique_ptr<DelayEffectState> compensationDelayState;
            std::vector<CompressorEffectState> compressorStates;
            std::array<VoiceNoteAutomation::Context, VoiceNoteAutomation::maxPendingContexts> noteAutomationContexts {};
            int noteAutomationContextCount { 0 };
            int routeLatencySamples { 0 };
            int routeCompensationSamples { 0 };
            bool returnBus { false };
            bool groupBus { false };
            juce::AudioBuffer<float> returnBuffer;
            juce::AudioBuffer<float> groupBuffer;
        };

        struct RouteEffectWorkStats
        {
            int64_t totalSamples { 0 };
            int64_t filterSamples { 0 };
            int64_t nonlinearSamples { 0 };
            int64_t delaySamples { 0 };
        };

        struct TrackMeterState
        {
            Id trackId;
            double sumSquares { 0.0 };
            std::array<double, 2> channelSumSquares { 0.0, 0.0 };
            int sampleCount { 0 };
            std::array<int, 2> channelSampleCounts { 0, 0 };
            float blockPeak { 0.0f };
            std::array<float, 2> channelBlockPeaks { 0.0f, 0.0f };
            std::atomic<float> publishedRms { 0.0f };
            std::atomic<float> publishedPeak { 0.0f };
            std::array<std::atomic<float>, 2> publishedChannelRms { 0.0f, 0.0f };
            std::array<std::atomic<float>, 2> publishedChannelPeak { 0.0f, 0.0f };
            std::atomic<uint64_t> sequence { 0 };

            TrackMeterState() = default;
            explicit TrackMeterState(Id id) : trackId(std::move(id)) {}
            TrackMeterState(TrackMeterState&& other) noexcept
                : trackId(std::move(other.trackId)),
                  sumSquares(other.sumSquares),
                  channelSumSquares(other.channelSumSquares),
                  sampleCount(other.sampleCount),
                  channelSampleCounts(other.channelSampleCounts),
                  blockPeak(other.blockPeak),
                  channelBlockPeaks(other.channelBlockPeaks),
                  publishedRms(other.publishedRms.load(std::memory_order_relaxed)),
                  publishedPeak(other.publishedPeak.load(std::memory_order_relaxed)),
                  sequence(other.sequence.load(std::memory_order_relaxed))
            {
                for (size_t channel = 0; channel < publishedChannelRms.size(); ++channel)
                {
                    publishedChannelRms[channel].store(other.publishedChannelRms[channel].load(std::memory_order_relaxed), std::memory_order_relaxed);
                    publishedChannelPeak[channel].store(other.publishedChannelPeak[channel].load(std::memory_order_relaxed), std::memory_order_relaxed);
                }
            }
            TrackMeterState& operator=(TrackMeterState&& other) noexcept
            {
                if (this == &other) return *this;
                trackId = std::move(other.trackId);
                sumSquares = other.sumSquares;
                channelSumSquares = other.channelSumSquares;
                sampleCount = other.sampleCount;
                channelSampleCounts = other.channelSampleCounts;
                blockPeak = other.blockPeak;
                channelBlockPeaks = other.channelBlockPeaks;
                publishedRms.store(other.publishedRms.load(std::memory_order_relaxed), std::memory_order_relaxed);
                publishedPeak.store(other.publishedPeak.load(std::memory_order_relaxed), std::memory_order_relaxed);
                for (size_t channel = 0; channel < publishedChannelRms.size(); ++channel)
                {
                    publishedChannelRms[channel].store(other.publishedChannelRms[channel].load(std::memory_order_relaxed), std::memory_order_relaxed);
                    publishedChannelPeak[channel].store(other.publishedChannelPeak[channel].load(std::memory_order_relaxed), std::memory_order_relaxed);
                }
                sequence.store(other.sequence.load(std::memory_order_relaxed), std::memory_order_relaxed);
                return *this;
            }
            TrackMeterState(const TrackMeterState&) = delete;
            TrackMeterState& operator=(const TrackMeterState&) = delete;
        };

        struct LiveMeterBiquadState
        {
            double b0 { 1.0 };
            double b1 { 0.0 };
            double b2 { 0.0 };
            double a1 { 0.0 };
            double a2 { 0.0 };
            double x1 { 0.0 };
            double x2 { 0.0 };
            double y1 { 0.0 };
            double y2 { 0.0 };
        };

        struct MasterLoudnessMeterState
        {
            int channelCount { 0 };
            int momentaryWritePosition { 0 };
            int momentaryFilledSamples { 0 };
            double momentaryPowerSum { 0.0 };
            std::vector<double> momentaryPowerRing;
            std::array<LiveMeterBiquadState, 2> shelfFilters;
            std::array<LiveMeterBiquadState, 2> highpassFilters;
            std::array<std::array<float, 4>, 2> truePeakWindow {};
            std::array<int, 2> truePeakWindowSize {};
            std::atomic<float> publishedRmsDbFS { -std::numeric_limits<float>::infinity() };
            std::atomic<float> publishedPeakDbFS { -std::numeric_limits<float>::infinity() };
            std::atomic<float> publishedTruePeakDbTP { -std::numeric_limits<float>::infinity() };
            std::atomic<float> publishedMomentaryLufs { -std::numeric_limits<float>::infinity() };
        };

        std::vector<ScheduledNoteOff> pendingNoteOffs;
        std::vector<PendingParameterAutomation> pendingParameterAutomation;
        std::vector<RealtimeParameterChange> blockRealtimeParameterEvents;
        std::vector<RouteParameterAutomationEvent> blockRouteParameterEvents;
        std::array<VoiceNoteAutomation::Context, VoiceNoteAutomation::maxPendingContexts> defaultNoteAutomationContexts {};
        int defaultNoteAutomationContextCount { 0 };
        std::vector<ActiveSampleVoice> activeSampleVoices;
        std::vector<ActiveAudioClipVoice> activeAudioClipVoices;
        std::vector<InstrumentRenderState> instrumentRenderStates;
        std::vector<InstrumentRenderState> groupRenderStates;
        std::vector<InstrumentRenderState> returnRenderStates;
        std::vector<TrackMeterState> trackMeterStates;
        TrackMeterState masterMeterState { "master" };
        MasterLoudnessMeterState masterLoudnessMeterState;
        std::map<juce::String, SampleInstrument> sampleInstruments;
        std::map<juce::String, std::shared_ptr<SampleBuffer>> audioFileBuffers;
        juce::AudioFormatManager formatManager;
        juce::AudioBuffer<float> routeBuf;
        RecordingCapture inputRecording;
        std::atomic<bool> inputMonitoringEnabled { false };
        std::atomic<float> inputMonitoringGain { 1.0f };
        int projectLatencySamples { 0 };
        juce::CriticalSection sampleLock;
        SpscRingBuffer<TransportCommand, 512> transportCommands;
        RealtimeParameterQueue<1024> realtimeParameterChanges;

        std::unique_ptr<juce::Synthesiser> createInstrumentSynth(const InstrumentDefinition& instrument);
        void rebuildSampleInstruments(const Project& project);
        InstrumentRenderState* findInstrumentRenderState(const Id& instrumentId);
        InstrumentRenderState* findTrackRenderState(const Id& trackId, const Id& instrumentId);
        InstrumentRenderState* findTrackRouteState(const Id& trackId);
        InstrumentRenderState* findGroupRenderState(const Id& trackId);
        TrackMeterState* findTrackMeterState(const Id& trackId) noexcept;
        bool startSampleVoiceLocked(const Sequencer::TriggerEvent& ev);
        bool startAudioClipVoiceLocked(const Sequencer::AudioClipEvent& ev);
        void renderSampleVoicesForRouteLocked(const Id& trackId,
                                               juce::AudioBuffer<float>& route,
                                               int numSamples);
        void renderAudioClipVoicesForRouteLocked(const Id& trackId,
                                                 juce::AudioBuffer<float>& route,
                                                 int numSamples);
        void resetRouteRuntimeLocked(InstrumentRenderState& route, bool allowTailOff) noexcept;
        void resetRuntimeStateLocked(bool allowTailOff) noexcept;
        bool queueTransportCommand(TransportCommand command) noexcept;
        bool tryApplyUrgentTransportCommand(TransportCommand command) noexcept;
        void applyTransportCommandLocked(const TransportCommand& command) noexcept;
        void drainTransportCommandsLocked() noexcept;
        void addRouteToMixLocked(InstrumentRenderState& routeState,
                                 juce::AudioBuffer<float>& route,
                                 int startSample,
                                 int numSamples) noexcept;
        void addRouteToGroupLocked(InstrumentRenderState& routeState,
                                   juce::AudioBuffer<float>& route,
                                   int startSample,
                                   int numSamples) noexcept;
        void addRouteSendsLocked(InstrumentRenderState& routeState,
                                 juce::AudioBuffer<float>& route,
                                 int startSample,
                                 int numSamples) noexcept;
        void processGroupBusesLocked(int numSamples,
                                     int64_t* routeEffectTicks,
                                     RouteEffectWorkStats* routeEffectWork) noexcept;
        void processReturnBusesLocked(int numSamples,
                                      int64_t* routeEffectTicks,
                                      RouteEffectWorkStats* routeEffectWork) noexcept;
        void prepareRouteEffects(InstrumentRenderState& route);
        void processDelayLineLocked(InstrumentRenderState::DelayEffectState& delay,
                                    juce::AudioBuffer<float>& buffer,
                                    int startSample,
                                    int numSamples,
                                    int delaySamples) noexcept;
        void processRouteEffectsLocked(InstrumentRenderState& route,
                                       juce::AudioBuffer<float>& buffer,
                                       int startSample,
                                       int numSamples,
                                       RouteEffectWorkStats* workStats = nullptr) noexcept;
        void processMasterChain(juce::AudioBuffer<float>& buffer, int numSamples) noexcept;
        void processRouteAutomationLocked(InstrumentRenderState& route,
                                          juce::AudioBuffer<float>& buffer,
                                          int numSamples,
                                          int64_t* routeEffectTicks,
                                          RouteEffectWorkStats* routeEffectWork) noexcept;
        bool applyRouteParameterLocked(InstrumentRenderState& route,
                                       const RouteParameterAutomationEvent& event) noexcept;
        void resetTrackMetersLocked() noexcept;
        void prepareMasterLoudnessMeter(int channels);
        void resetMasterLoudnessMeter() noexcept;
        void accumulateTrackMeterLocked(const Id& trackId,
                                        juce::AudioBuffer<float>& buffer,
                                        int startSample,
                                        int numSamples,
                                        float gainDb,
                                        float pan) noexcept;
        void accumulateTrackMeterSampleLocked(const Id& trackId, float sample) noexcept;
        void publishTrackMetersLocked() noexcept;
        void publishMasterMeter(int numSamples) noexcept;
        void drainRealtimeParameterChangesLocked(int numSamples) noexcept;
        void advancePendingParameterAutomationLocked(int numSamples) noexcept;
        void scheduleNoteAutomationLocked(const Sequencer::TriggerEvent& ev) noexcept;
        void renderSynthWithRealtimeParametersLocked(juce::Synthesiser& targetSynth,
                                                     juce::AudioBuffer<float>& output,
                                                     juce::MidiBuffer& midi,
                                                     std::string_view instrumentId,
                                                     int numSamples) noexcept;
        static int countActiveSynthVoices(juce::Synthesiser& targetSynth) noexcept;
        bool applyRealtimeParameterToSynth(juce::Synthesiser& targetSynth,
                                           std::string_view parameterId,
                                           float value,
                                           int rampSamples) noexcept;
        void publishRenderTiming(int numSamples,
                                 int64_t scheduleTicks,
                                 int64_t synthTicks,
                                 int64_t voiceTicks,
                                 int64_t modulationTicks,
                                 int64_t samplesTicks,
                                 int64_t fxTicks,
                                 int64_t filterFxTicks,
                                 int64_t analyzerTicks,
                                 int64_t copyTicks,
                                 int64_t totalTicks,
                                 int activeSynthVoiceCount,
                                 int activeSampleVoiceCount,
                                 int activeAudioClipVoiceCount,
                                 int routeCount,
                                 int automationEventCount,
                                 RouteEffectWorkStats routeEffectWork) noexcept;

        // Used to throttle position-change notifications to ~60Hz so we
        // don't flood the JS bridge.
        std::atomic<int64_t> lastPositionPushSamples { 0 };

        std::atomic<uint64_t> renderTimingSequence { 0 };
        std::atomic<int> renderTimingBlockSamples { 0 };
        std::atomic<int64_t> renderTimingScheduleTicks { 0 };
        std::atomic<int64_t> renderTimingSynthTicks { 0 };
        std::atomic<int64_t> renderTimingVoiceTicks { 0 };
        std::atomic<int64_t> renderTimingModulationTicks { 0 };
        std::atomic<int64_t> renderTimingSamplesTicks { 0 };
        std::atomic<int64_t> renderTimingFxTicks { 0 };
        std::atomic<int64_t> renderTimingFilterFxTicks { 0 };
        std::atomic<int64_t> renderTimingAnalyzerTicks { 0 };
        std::atomic<int64_t> renderTimingCopyTicks { 0 };
        std::atomic<int64_t> renderTimingTotalTicks { 0 };
        std::atomic<int> renderTimingActiveSynthVoices { 0 };
        std::atomic<int> renderTimingActiveSampleVoices { 0 };
        std::atomic<int> renderTimingActiveAudioClipVoices { 0 };
        std::atomic<int> renderTimingRouteCount { 0 };
        std::atomic<int> renderTimingAutomationEventCount { 0 };
        std::atomic<int64_t> renderTimingVoiceRenderBlocks { 0 };
        std::atomic<int64_t> renderTimingVoiceRenderSamples { 0 };
        std::atomic<int64_t> renderTimingOscillatorSamples { 0 };
        std::atomic<int64_t> renderTimingWavetableVoiceSamples { 0 };
        std::atomic<int64_t> renderTimingAetherOscASamples { 0 };
        std::atomic<int64_t> renderTimingAetherOscBSamples { 0 };
        std::atomic<int64_t> renderTimingAetherSubSamples { 0 };
        std::atomic<int64_t> renderTimingAetherNoiseSamples { 0 };
        std::atomic<int64_t> renderTimingFilterSamples { 0 };
        std::atomic<int64_t> renderTimingFilterDriveSamples { 0 };
        std::atomic<int64_t> renderTimingFilterCoefficientUpdates { 0 };
        std::atomic<int64_t> renderTimingFilterCutoffUpdates { 0 };
        std::atomic<int64_t> renderTimingFilterResonanceUpdates { 0 };
        std::atomic<int64_t> renderTimingModulationSamples { 0 };
        std::atomic<int64_t> renderTimingRealtimeRampSamples { 0 };
        std::atomic<int64_t> renderTimingOscillatorRateCalculations { 0 };
        std::atomic<int64_t> renderTimingWavetableFrequencyUpdates { 0 };
        std::atomic<int64_t> renderTimingWavetablePositionUpdates { 0 };
        std::atomic<int64_t> renderTimingRouteEffectSamples { 0 };
        std::atomic<int64_t> renderTimingRouteFilterEffectSamples { 0 };
        std::atomic<int64_t> renderTimingRouteNonlinearEffectSamples { 0 };
        std::atomic<int64_t> renderTimingRouteDelayEffectSamples { 0 };
    };
}

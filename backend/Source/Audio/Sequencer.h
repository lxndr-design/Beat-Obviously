#pragma once

#include <juce_core/juce_core.h>
#include "TrackModel.h"
#include <atomic>
#include <functional>
#include <memory>
#include <type_traits>
#include <utility>

namespace beat
{
    template <typename Signature>
    class CallbackRef;

    /** Non-owning, allocation-free callback view. The referenced callable only
     *  needs to remain alive for the duration of the receiving function call. */
    template <typename Result, typename... Args>
    class CallbackRef<Result(Args...)>
    {
    public:
        CallbackRef() noexcept = default;

        template <typename Callable,
                  typename = std::enable_if_t<!std::is_same_v<std::decay_t<Callable>, CallbackRef>>>
        CallbackRef(Callable&& callable) noexcept
            : context(const_cast<void*>(static_cast<const void*>(std::addressof(callable))))
            , invokeCallback([](void* target, Args... args) -> Result {
                return (*static_cast<std::remove_reference_t<Callable>*>(target))(std::forward<Args>(args)...);
            })
        {
        }

        explicit operator bool() const noexcept { return invokeCallback != nullptr; }

        Result operator()(Args... args) const
        {
            return invokeCallback(context, std::forward<Args>(args)...);
        }

    private:
        void* context { nullptr };
        Result (*invokeCallback)(void*, Args...) { nullptr };
    };

    /**
     * Sequencer — sample-accurate beat timeline.
     *
     * Advanced by AudioEngine::processBlock() each render. Holds the current
     * project (copy of the model the UI sent over IPC) and emits per-block
     * note-on / note-off events through the supplied callback.
     */
    class Sequencer
    {
    public:
        struct TriggerEvent {
            Id     trackId;
            Id     segmentId;
            Id     instrumentId;
            int    pitch;
            int    velocity;
            Beats  lengthBeats;
            int    lengthSamples;
            int    sampleOffset;      // offset within the current block
            int    repetition;        // 0 = original, >0 = repeated copy
            Beats  segmentStartBeat;  // absolute beat of this occurrence
            float  trackGainDb { 0.0f };
            float  trackPan { 0.0f };
            float  segmentGainDb { 0.0f };
            const MidiNote* sourceNote { nullptr };
            int    noteIndex { -1 };
            int    glideTargetPitch { -1 };
            float  instrumentGlideMs { 0.0f };
        };
        using TriggerHandler = CallbackRef<void(const TriggerEvent&)>;

        struct ParameterAutomationEvent {
            Id     trackId;
            Id     segmentId;
            Id     instrumentId;
            juce::String parameterId;
            float  value { 0.0f };
            int    sampleOffset { 0 };
            int    rampSamples { 0 };
            int    repetition { 0 };
        };
        using ParameterAutomationHandler = CallbackRef<void(const ParameterAutomationEvent&)>;

        struct AudioClipEvent {
            Id     trackId;
            Id     segmentId;
            Id     audioFileId;
            int    sampleOffset { 0 };
            int    lengthSamples { 0 };
            Beats  sourceOffsetBeats { 0.0 };
            Beats  clipOffsetBeats { 0.0 };
            Beats  clipLengthBeats { 0.0 };
            Beats  fadeInBeats { 0.0 };
            Beats  fadeOutBeats { 0.0 };
            int    repetition { 0 };
            Beats  segmentStartBeat { 0.0 };
            float  trackGainDb { 0.0f };
            float  trackPan { 0.0f };
            float  segmentGainDb { 0.0f };
        };
        using AudioClipHandler = CallbackRef<void(const AudioClipEvent&)>;

        void setProject(Project p);
        void setTempo(double newBpm)     { bpm.store(newBpm); }
        void setSampleRate(double sr)    { sampleRate.store(sr); }
        void setSpeed(double speed)      { playbackSpeed.store(juce::jlimit(0.1, 4.0, speed)); }
        void play()                      { playing.store(true); }
        void pause()                     { playing.store(false); }
        void stop()                      { playing.store(false); positionBeat.store(0.0); }
        void seek(Beats b)               { positionBeat.store(juce::jmax(0.0, (double) b)); }
        void setLoop(Beats start, Beats end)
        {
            loopStart.store(start);
            loopEnd.store(end);
            loopEnabled.store(end > start);
        }
        void clearLoop()                 { loopEnabled.store(false); }

        bool   isPlaying() const         { return playing.load(); }
        Beats  getPosition() const       { return positionBeat.load(); }
        double getTempo() const          { return bpm.load(); }
        double getSpeed() const          { return playbackSpeed.load(); }

        /** Advance position by `numSamples` frames at the current sample
         *  rate / tempo, emitting any segment triggers that fall within the
         *  block via `onTrigger`. */
        void render(int numSamples,
                    TriggerHandler onTrigger,
                    ParameterAutomationHandler onAutomation = {},
                    AudioClipHandler onAudioClip = {});

    private:
        std::shared_ptr<const Project> projectSnapshot { std::make_shared<Project>() };

        std::atomic<double> bpm           { 120.0 };
        std::atomic<double> sampleRate    { 44100.0 };
        std::atomic<double> playbackSpeed { 1.0 };
        std::atomic<bool>   playing       { false };
        std::atomic<double> positionBeat  { 0.0 };
        std::atomic<double> loopStart     { 0.0 };
        std::atomic<double> loopEnd       { 0.0 };
        std::atomic<bool>   loopEnabled   { false };
    };
}

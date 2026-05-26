#pragma once

#include <juce_core/juce_core.h>
#include "TrackModel.h"
#include <atomic>
#include <functional>

namespace beat
{
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
            int    pitch;
            int    velocity;
            Beats  lengthBeats;
            int    sampleOffset;      // offset within the current block
            int    repetition;        // 0 = original, >0 = repeated copy
        };
        using TriggerHandler = std::function<void(const TriggerEvent&)>;

        void setProject(Project p);
        void setTempo(double bpm)        { bpm.store(bpm); }
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

        /** Advance position by `numSamples` frames at the current sample
         *  rate / tempo, emitting any segment triggers that fall within the
         *  block via `onTrigger`. */
        void render(int numSamples, TriggerHandler onTrigger);

    private:
        Project project;
        juce::CriticalSection projectLock;

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

#pragma once

#include <juce_audio_utils/juce_audio_utils.h>
#include "Sequencer.h"
#include "InstrumentVoice.h"
#include "Effects/Bitcrush.h"
#include "Effects/MasterEq.h"
#include <functional>

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
        void shutdown();

        Sequencer& sequencer() { return seq; }

        // --- IPC-facing mutators ----------------------------------------
        void applyProject(Project p);
        void setEqAutomation(std::vector<EqAutomationPoint> pts);

        // --- Listeners (notify the MessageBridge to push events to JS) --
        std::function<void(Beats)> onPositionChanged;
        std::function<void(const Sequencer::TriggerEvent&)> onSegmentTriggered;

        // AudioIODeviceCallback
        void audioDeviceIOCallback(const float** /*inputChannelData*/,
                                   int /*numInputChannels*/,
                                   float** outputChannelData,
                                   int numOutputChannels,
                                   int numSamples) override;
        void audioDeviceAboutToStart(juce::AudioIODevice* device) override;
        void audioDeviceStopped() override;

    private:
        juce::AudioDeviceManager device;
        juce::Synthesiser        synth;
        Sequencer                seq;
        Bitcrush                 bitcrush;
        MasterEq                 masterEq;

        juce::AudioBuffer<float> mixBuf;
        double sampleRate { 44100.0 };

        // Used to throttle position-change notifications to ~60Hz so we
        // don't flood the JS bridge.
        std::atomic<int64_t> lastPositionPushSamples { 0 };
    };
}

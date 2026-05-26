#include "AudioEngine.h"

namespace beat
{
    namespace
    {
        // Sound that matches any note — InstrumentVoice handles the actual sound.
        struct PassSound : public juce::SynthesiserSound
        {
            bool appliesToNote(int) override    { return true; }
            bool appliesToChannel(int) override { return true; }
        };
    }

    AudioEngine::AudioEngine()
    {
        synth.addSound(new PassSound());
        for (int i = 0; i < 16; ++i)
        {
            auto* v = new InstrumentVoice();
            synth.addVoice(v);
        }
    }

    AudioEngine::~AudioEngine() = default;

    void AudioEngine::prepare()
    {
        const auto err = device.initialiseWithDefaultDevices(0, 2);
        if (err.isNotEmpty())
            DBG("AudioEngine init error: " << err);
        device.addAudioCallback(this);
    }

    void AudioEngine::shutdown()
    {
        device.removeAudioCallback(this);
        device.closeAudioDevice();
    }

    void AudioEngine::applyProject(Project p)
    {
        seq.setTempo(p.bpm);
        masterEq.setAutomation(p.eqAutomation);
        seq.setProject(std::move(p));
    }

    void AudioEngine::setEqAutomation(std::vector<EqAutomationPoint> pts)
    {
        masterEq.setAutomation(std::move(pts));
    }

    void AudioEngine::audioDeviceAboutToStart(juce::AudioIODevice* dev)
    {
        sampleRate = dev->getCurrentSampleRate();
        const int block = dev->getCurrentBufferSizeSamples();
        const int channels = dev->getActiveOutputChannels().countNumberOfSetBits();

        seq.setSampleRate(sampleRate);
        synth.setCurrentPlaybackSampleRate(sampleRate);
        for (int i = 0; i < synth.getNumVoices(); ++i)
            if (auto* v = dynamic_cast<InstrumentVoice*>(synth.getVoice(i)))
                v->prepare(sampleRate, block);

        bitcrush.prepare(sampleRate, block);
        masterEq.prepare(sampleRate, block, channels);
        mixBuf.setSize(juce::jmax(2, channels), block, false, false, true);
    }

    void AudioEngine::audioDeviceStopped() {}

    void AudioEngine::audioDeviceIOCallback(const float**, int,
                                            float** outputChannels, int numOutChannels,
                                            int numSamples)
    {
        mixBuf.setSize(juce::jmax(2, numOutChannels), numSamples, false, false, true);
        mixBuf.clear();

        // 1. Advance the sequencer; collect MIDI events for this block.
        juce::MidiBuffer midi;
        seq.render(numSamples, [&](const Sequencer::TriggerEvent& ev) {
            midi.addEvent(juce::MidiMessage::noteOn(1, ev.pitch, (juce::uint8) ev.velocity),
                          ev.sampleOffset);
            // Schedule a matching note-off at the end of the note's length —
            // approximate within block; a more robust impl would queue cross-block.
            const int offSample = ev.sampleOffset
                + (int) std::round(ev.lengthBeats * (60.0 / 120.0) * sampleRate);
            if (offSample < numSamples)
                midi.addEvent(juce::MidiMessage::noteOff(1, ev.pitch), offSample);

            if (onSegmentTriggered) onSegmentTriggered(ev);
        });

        // 2. Synth renders into mixBuf.
        synth.renderNextBlock(mixBuf, midi, 0, numSamples);

        // 3. Master FX chain — for v1, bitcrush is per-engine; per-track
        //    routing is a follow-up.
        bitcrush.process(mixBuf);
        masterEq.setCurrentBeat(seq.getPosition());
        masterEq.process(mixBuf);

        // 4. Copy mixBuf → device output.
        for (int ch = 0; ch < numOutChannels; ++ch)
        {
            const float* src = mixBuf.getReadPointer(juce::jmin(ch, mixBuf.getNumChannels() - 1));
            std::memcpy(outputChannels[ch], src, sizeof(float) * (size_t) numSamples);
        }

        // 5. Notify UI of position changes ~60Hz.
        const int64_t now = juce::Time::getHighResolutionTicks();
        const double  hz  = juce::Time::getHighResolutionTicksPerSecond();
        const int64_t lastTicks = lastPositionPushSamples.load();
        if ((now - lastTicks) / hz > 1.0 / 60.0)
        {
            lastPositionPushSamples.store(now);
            if (onPositionChanged) onPositionChanged(seq.getPosition());
        }
    }
}

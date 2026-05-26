#include "InstrumentVoice.h"

namespace beat
{
    void InstrumentVoice::prepare(double sr, int blockSize)
    {
        sampleRate = sr;
        adsr.setSampleRate(sr);
        filter.prepare({ sr, (juce::uint32) blockSize, 1u });
        filter.setType(juce::dsp::StateVariableTPTFilterType::lowpass);
    }

    void InstrumentVoice::setParams(const Params& p)
    {
        params = p;
        adsrParams.attack  = juce::jmax(0.001f, p.attackMs  * 0.001f);
        adsrParams.decay   = juce::jmax(0.001f, p.decayMs   * 0.001f);
        adsrParams.sustain = juce::jlimit(0.0f, 1.0f, p.sustain);
        adsrParams.release = juce::jmax(0.001f, p.releaseMs * 0.001f);
        adsr.setParameters(adsrParams);

        // Map cutoff 0..1 → 20Hz..20kHz exp curve
        const float minF = 20.0f;
        const float maxF = 20000.0f;
        filter.setCutoffFrequency(minF * std::pow(maxF / minF, p.cutoff01));
        filter.setResonance(0.5f + p.resonance01 * 4.0f);
    }

    void InstrumentVoice::startNote(int midiNoteNumber, float velocity,
                                    juce::SynthesiserSound*, int)
    {
        level     = velocity;
        phase     = 0.0;
        phaseDelta = juce::MidiMessage::getMidiNoteInHertz(midiNoteNumber) / sampleRate;
        adsr.noteOn();
    }

    void InstrumentVoice::stopNote(float, bool allowTailOff)
    {
        if (allowTailOff)
        {
            adsr.noteOff();
        }
        else
        {
            adsr.reset();
            clearCurrentNote();
        }
    }

    void InstrumentVoice::renderNextBlock(juce::AudioBuffer<float>& out,
                                          int startSample, int numSamples)
    {
        if (!adsr.isActive()) return;

        for (int i = 0; i < numSamples; ++i)
        {
            // Oscillator
            float s = 0.f;
            const float p = (float) phase;
            switch (params.waveform)
            {
                case 0:  s = std::sin(p * juce::MathConstants<float>::twoPi); break;
                case 1:  s = 2.f * p - 1.f; break;                       // saw
                case 2:  s = p < 0.5f ? 1.f : -1.f; break;               // square
                case 3:  s = 4.f * std::abs(p - 0.5f) - 1.f; break;      // triangle
                default: s = juce::Random::getSystemRandom().nextFloat() * 2.f - 1.f;
            }

            // Drive (soft clipping)
            s = std::tanh(s * (1.0f + params.drive01 * 6.0f));

            // ADSR
            const float env = adsr.getNextSample();

            // Filter (per-sample for now; per-block would be faster)
            s = filter.processSample(0, s);

            const float v = s * env * level * 0.4f;

            for (int ch = 0; ch < out.getNumChannels(); ++ch)
                out.addSample(ch, startSample + i, v);

            phase += phaseDelta;
            if (phase >= 1.0) phase -= 1.0;
        }

        if (!adsr.isActive())
            clearCurrentNote();
    }
}

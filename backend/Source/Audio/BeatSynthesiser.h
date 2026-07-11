#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

namespace beat
{
    class BeatSynthesiser final : public juce::Synthesiser
    {
    protected:
        juce::SynthesiserVoice* findVoiceToSteal(juce::SynthesiserSound* soundToPlay,
                                                  int midiChannel,
                                                  int midiNoteNumber) const override;
    };
}

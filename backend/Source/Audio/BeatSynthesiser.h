#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <atomic>

namespace beat
{
    class BeatSynthesiser final : public juce::Synthesiser
    {
    public:
        BeatSynthesiser();
        void noteOn(int midiChannel, int midiNoteNumber, float velocity) override;
        void handleController(int midiChannel, int controllerNumber, int controllerValue) override;
        void handleChannelPressure(int midiChannel, int channelPressureValue) override;

    protected:
        juce::SynthesiserVoice* findVoiceToSteal(juce::SynthesiserSound* soundToPlay,
                                                  int midiChannel,
                                                  int midiNoteNumber) const override;

    private:
        void applyMemberPitchBendRange(int midiChannel, float semitones) noexcept;

        std::array<std::atomic<float>, 16> memberPressure {};
        std::array<std::atomic<float>, 16> memberTimbre {};
        std::array<std::atomic<int>, 16> memberRpnMsb {};
        std::array<std::atomic<int>, 16> memberRpnLsb {};
        std::array<std::atomic<int>, 16> memberPitchBendSemitones {};
        std::array<std::atomic<int>, 16> memberPitchBendCents {};
        std::array<std::atomic<float>, 16> memberPitchBendRange {};
    };
}

#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <atomic>

namespace beat
{
    class BeatSynthesiser final : public juce::Synthesiser
    {
    public:
        struct MemberExpressionZone
        {
            bool enabled { false };
            int masterChannel { 1 };
            int firstMemberChannel { 2 };
            int lastMemberChannel { 16 };
        };

        BeatSynthesiser();
        bool configureMemberExpressionZone(MemberExpressionZone zone) noexcept;
        MemberExpressionZone memberExpressionZone() const noexcept { return expressionZone; }
        void noteOn(int midiChannel, int midiNoteNumber, float velocity) override;
        void handlePitchWheel(int midiChannel, int wheelValue) override;
        void handleController(int midiChannel, int controllerNumber, int controllerValue) override;
        void handleChannelPressure(int midiChannel, int channelPressureValue) override;

    protected:
        juce::SynthesiserVoice* findVoiceToSteal(juce::SynthesiserSound* soundToPlay,
                                                  int midiChannel,
                                                  int midiNoteNumber) const override;

    private:
        bool applyLegacyMpeConfiguration(int managerChannel, int memberCount) noexcept;
        void applyMemberPitchBendRange(int midiChannel, float semitones) noexcept;
        bool isExpressionMasterChannel(int midiChannel) const noexcept;
        bool isExpressionMemberChannel(int midiChannel) const noexcept;

        MemberExpressionZone expressionZone;
        std::array<std::atomic<float>, 16> memberModWheel {};
        std::array<std::atomic<float>, 16> memberPressure {};
        std::array<std::atomic<float>, 16> memberTimbre {};
        std::array<std::atomic<int>, 16> memberRpnMsb {};
        std::array<std::atomic<int>, 16> memberRpnLsb {};
        std::array<std::atomic<int>, 16> memberPitchBendSemitones {};
        std::array<std::atomic<int>, 16> memberPitchBendCents {};
        std::array<std::atomic<float>, 16> memberPitchBendRange {};
    };
}

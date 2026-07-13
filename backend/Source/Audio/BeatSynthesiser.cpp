#include "BeatSynthesiser.h"

#include "InstrumentVoice.h"
#include "VoiceAllocation.h"

namespace beat
{
    BeatSynthesiser::BeatSynthesiser()
    {
        for (size_t channel = 0; channel < memberRpnMsb.size(); ++channel)
        {
            memberRpnMsb[channel].store(127, std::memory_order_relaxed);
            memberRpnLsb[channel].store(127, std::memory_order_relaxed);
            memberPitchBendSemitones[channel].store(-1, std::memory_order_relaxed);
            memberPitchBendCents[channel].store(0, std::memory_order_relaxed);
            memberPitchBendRange[channel].store(-1.0f, std::memory_order_relaxed);
        }
    }

    void BeatSynthesiser::noteOn(int midiChannel, int midiNoteNumber, float velocity)
    {
        juce::Synthesiser::noteOn(midiChannel, midiNoteNumber, velocity);

        const int channelIndex = juce::jlimit(1, 16, midiChannel) - 1;
        const juce::ScopedLock scopedLock(lock);
        for (auto* voice : voices)
        {
            if (!voice->isVoiceActive()
                || voice->getCurrentlyPlayingNote() != midiNoteNumber
                || !voice->isPlayingChannel(midiChannel))
                continue;
            if (auto* instrument = dynamic_cast<InstrumentVoice*>(voice))
            {
                instrument->setMemberExpression(memberPressure[(size_t) channelIndex].load(std::memory_order_relaxed),
                                                memberTimbre[(size_t) channelIndex].load(std::memory_order_relaxed));
                const float bendRange = memberPitchBendRange[(size_t) channelIndex].load(std::memory_order_relaxed);
                instrument->setMemberPitchBendRange(bendRange);
            }
        }
    }

    void BeatSynthesiser::handleController(int midiChannel, int controllerNumber, int controllerValue)
    {
        const int channelIndex = juce::jlimit(1, 16, midiChannel) - 1;
        if (controllerNumber == 74)
        {
            memberTimbre[(size_t) channelIndex].store(
                juce::jlimit(0.0f, 1.0f, (float) controllerValue / 127.0f),
                std::memory_order_relaxed);
        }
        else if (controllerNumber == 101)
        {
            memberRpnMsb[(size_t) channelIndex].store(juce::jlimit(0, 127, controllerValue), std::memory_order_relaxed);
        }
        else if (controllerNumber == 100)
        {
            memberRpnLsb[(size_t) channelIndex].store(juce::jlimit(0, 127, controllerValue), std::memory_order_relaxed);
        }
        else if ((controllerNumber == 6 || controllerNumber == 38)
            && memberRpnMsb[(size_t) channelIndex].load(std::memory_order_relaxed) == 0
            && memberRpnLsb[(size_t) channelIndex].load(std::memory_order_relaxed) == 0)
        {
            if (controllerNumber == 6)
                memberPitchBendSemitones[(size_t) channelIndex].store(juce::jlimit(0, 96, controllerValue), std::memory_order_relaxed);
            else
                memberPitchBendCents[(size_t) channelIndex].store(juce::jlimit(0, 99, controllerValue), std::memory_order_relaxed);

            const int semitones = memberPitchBendSemitones[(size_t) channelIndex].load(std::memory_order_relaxed);
            if (semitones >= 0)
            {
                const float range = (float) semitones
                    + (float) memberPitchBendCents[(size_t) channelIndex].load(std::memory_order_relaxed) / 100.0f;
                memberPitchBendRange[(size_t) channelIndex].store(range, std::memory_order_relaxed);
                applyMemberPitchBendRange(midiChannel, range);
            }
        }
        juce::Synthesiser::handleController(midiChannel, controllerNumber, controllerValue);
    }

    void BeatSynthesiser::handleChannelPressure(int midiChannel, int channelPressureValue)
    {
        const int channelIndex = juce::jlimit(1, 16, midiChannel) - 1;
        memberPressure[(size_t) channelIndex].store(
            juce::jlimit(0.0f, 1.0f, (float) channelPressureValue / 127.0f),
            std::memory_order_relaxed);
        juce::Synthesiser::handleChannelPressure(midiChannel, channelPressureValue);
    }

    void BeatSynthesiser::applyMemberPitchBendRange(int midiChannel, float semitones) noexcept
    {
        const juce::ScopedLock scopedLock(lock);
        for (auto* voice : voices)
        {
            if (!voice->isVoiceActive() || !voice->isPlayingChannel(midiChannel))
                continue;
            if (auto* instrument = dynamic_cast<InstrumentVoice*>(voice))
                instrument->setMemberPitchBendRange(semitones);
        }
    }

    juce::SynthesiserVoice* BeatSynthesiser::findVoiceToSteal(juce::SynthesiserSound* soundToPlay,
                                                               int,
                                                               int) const
    {
        juce::SynthesiserVoice* selected = nullptr;
        int selectedIndex = -1;
        for (int index = 0; index < voices.size(); ++index)
        {
            auto* voice = voices[index];
            if (!voice->isVoiceActive() || !voice->canPlaySound(soundToPlay))
                continue;

            const auto instrumentState = dynamic_cast<InstrumentVoice*>(voice);
            const auto state = instrumentState != nullptr ? instrumentState->allocationState() : InstrumentVoice::AllocationState {
                true,
                voice->isPlayingButReleased(),
                1.0f,
                index
            };
            if (selected == nullptr)
            {
                selected = voice;
                selectedIndex = index;
                continue;
            }

            const auto selectedInstrument = dynamic_cast<InstrumentVoice*>(selected);
            const auto selectedState = selectedInstrument != nullptr ? selectedInstrument->allocationState() : InstrumentVoice::AllocationState {
                true,
                selected->isPlayingButReleased(),
                1.0f,
                selectedIndex
            };
            const bool candidateOlder = voice->wasStartedBefore(*selected);
            const VoiceAllocation::VictimState candidate {
                state.released,
                state.currentLevel,
                candidateOlder ? 0u : 1u,
                state.stableVoiceId
            };
            const VoiceAllocation::VictimState current {
                selectedState.released,
                selectedState.currentLevel,
                candidateOlder ? 1u : 0u,
                selectedState.stableVoiceId
            };
            if (VoiceAllocation::preferVictim(candidate, current))
            {
                selected = voice;
                selectedIndex = index;
            }
        }

        if (auto* instrument = dynamic_cast<InstrumentVoice*>(selected))
            instrument->prepareForSteal();
        return selected;
    }
}

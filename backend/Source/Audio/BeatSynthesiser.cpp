#include "BeatSynthesiser.h"

#include "InstrumentVoice.h"
#include "VoiceAllocation.h"

#include <utility>

namespace beat
{
    BeatSynthesiser::BeatSynthesiser()
    {
        for (size_t channel = 0; channel < memberRpnMsb.size(); ++channel)
        {
            memberModWheel[channel].store(-1.0f, std::memory_order_relaxed);
            memberRpnMsb[channel].store(127, std::memory_order_relaxed);
            memberRpnLsb[channel].store(127, std::memory_order_relaxed);
            memberPitchBendSemitones[channel].store(-1, std::memory_order_relaxed);
            memberPitchBendCents[channel].store(0, std::memory_order_relaxed);
            memberPitchBendRange[channel].store(-1.0f, std::memory_order_relaxed);
        }
    }

    bool BeatSynthesiser::configureMemberExpressionZone(MemberExpressionZone zone) noexcept
    {
        zone.masterChannel = juce::jlimit(1, 16, zone.masterChannel);
        zone.firstMemberChannel = juce::jlimit(1, 16, zone.firstMemberChannel);
        zone.lastMemberChannel = juce::jlimit(1, 16, zone.lastMemberChannel);
        if (zone.firstMemberChannel > zone.lastMemberChannel)
            std::swap(zone.firstMemberChannel, zone.lastMemberChannel);
        if (zone.enabled
            && zone.masterChannel >= zone.firstMemberChannel
            && zone.masterChannel <= zone.lastMemberChannel)
        {
            expressionZone = {};
            return false;
        }
        expressionZone = zone;
        return true;
    }

    bool BeatSynthesiser::isExpressionMasterChannel(int midiChannel) const noexcept
    {
        return expressionZone.enabled && midiChannel == expressionZone.masterChannel;
    }

    bool BeatSynthesiser::isExpressionMemberChannel(int midiChannel) const noexcept
    {
        return expressionZone.enabled
            && midiChannel >= expressionZone.firstMemberChannel
            && midiChannel <= expressionZone.lastMemberChannel;
    }

    bool BeatSynthesiser::applyLegacyMpeConfiguration(int managerChannel, int memberCount) noexcept
    {
        if ((managerChannel != 1 && managerChannel != 16)
            || memberCount < 0
            || memberCount > 15)
            return false;

        if (memberCount == 0)
        {
            if (expressionZone.enabled && expressionZone.masterChannel == managerChannel)
                expressionZone.enabled = false;
            return true;
        }

        if (managerChannel == 1)
            expressionZone = { true, 1, 2, 1 + memberCount };
        else
            expressionZone = { true, 16, 16 - memberCount, 15 };
        return true;
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
                const float modWheel = memberModWheel[(size_t) channelIndex].load(std::memory_order_relaxed);
                if (modWheel >= 0.0f)
                    instrument->setMemberModWheel(modWheel);
                instrument->setMemberExpression(memberPressure[(size_t) channelIndex].load(std::memory_order_relaxed),
                                                memberTimbre[(size_t) channelIndex].load(std::memory_order_relaxed));
                const float bendRange = memberPitchBendRange[(size_t) channelIndex].load(std::memory_order_relaxed);
                instrument->setMemberPitchBendRange(bendRange);
            }
        }
    }

    void BeatSynthesiser::handlePitchWheel(int midiChannel, int wheelValue)
    {
        const juce::ScopedLock scopedLock(lock);
        juce::Synthesiser::handlePitchWheel(midiChannel, wheelValue);
        if (!isExpressionMasterChannel(midiChannel))
            return;
        for (int member = expressionZone.firstMemberChannel; member <= expressionZone.lastMemberChannel; ++member)
        {
            lastPitchWheelValues[member - 1] = juce::jlimit(0, 16383, wheelValue);
            juce::Synthesiser::handlePitchWheel(member, wheelValue);
        }
    }

    void BeatSynthesiser::handleController(int midiChannel, int controllerNumber, int controllerValue)
    {
        const int channelIndex = juce::jlimit(1, 16, midiChannel) - 1;
        if (controllerNumber == 1)
        {
            memberModWheel[(size_t) channelIndex].store(
                juce::jlimit(0.0f, 1.0f, (float) controllerValue / 127.0f),
                std::memory_order_relaxed);
        }
        else if (controllerNumber == 74)
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
        else if (controllerNumber == 6
            && memberRpnMsb[(size_t) channelIndex].load(std::memory_order_relaxed) == 0
            && memberRpnLsb[(size_t) channelIndex].load(std::memory_order_relaxed) == 6)
        {
            applyLegacyMpeConfiguration(midiChannel, controllerValue);
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
        if (isExpressionMasterChannel(midiChannel) && (controllerNumber == 1 || controllerNumber == 74))
        {
            const float normalized = juce::jlimit(0.0f, 1.0f, (float) controllerValue / 127.0f);
            for (int member = expressionZone.firstMemberChannel; member <= expressionZone.lastMemberChannel; ++member)
            {
                if (controllerNumber == 1)
                    memberModWheel[(size_t) (member - 1)].store(normalized, std::memory_order_relaxed);
                else
                    memberTimbre[(size_t) (member - 1)].store(normalized, std::memory_order_relaxed);
                juce::Synthesiser::handleController(member, controllerNumber, controllerValue);
            }
        }
    }

    void BeatSynthesiser::handleChannelPressure(int midiChannel, int channelPressureValue)
    {
        const int channelIndex = juce::jlimit(1, 16, midiChannel) - 1;
        memberPressure[(size_t) channelIndex].store(
            juce::jlimit(0.0f, 1.0f, (float) channelPressureValue / 127.0f),
            std::memory_order_relaxed);
        juce::Synthesiser::handleChannelPressure(midiChannel, channelPressureValue);
        if (isExpressionMasterChannel(midiChannel))
        {
            const float normalized = juce::jlimit(0.0f, 1.0f, (float) channelPressureValue / 127.0f);
            for (int member = expressionZone.firstMemberChannel; member <= expressionZone.lastMemberChannel; ++member)
            {
                memberPressure[(size_t) (member - 1)].store(normalized, std::memory_order_relaxed);
                juce::Synthesiser::handleChannelPressure(member, channelPressureValue);
            }
        }
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

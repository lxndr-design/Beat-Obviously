#include "BeatSynthesiser.h"

#include "InstrumentVoice.h"
#include "VoiceAllocation.h"

namespace beat
{
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

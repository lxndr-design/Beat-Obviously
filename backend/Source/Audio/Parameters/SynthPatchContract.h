#pragma once

#include "../TrackModel.h"

namespace beat
{
    int parseSynthFilterType(const juce::var& value);
    int parseSynthLfoWaveform(const juce::var& value);
    int synthWavetableBankForId(const juce::String& id);

    bool applySynthPatchContract(const juce::var& patch, InstrumentDefinition& instrument);
    juce::var normalizeAurumModulationContract(const juce::var& modulation, int aurumVersion);
    bool applyAurumModulationContract(const juce::var& aurum, InstrumentDefinition& instrument);
}

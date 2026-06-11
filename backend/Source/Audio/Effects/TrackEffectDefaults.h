#pragma once

#include "../TrackModel.h"

namespace beat
{
    inline constexpr int kCurrentTrackEffectSchemaVersion = 1;
    inline constexpr int kMaxTrackEffectLatencySamples = 192000;

    bool hasTrackEffectParam(const TrackEffect& effect, const juce::String& key);
    void addMissingTrackEffectParam(TrackEffect& effect, const char* key, float value);
    void normalizeTrackEffect(TrackEffect& effect);
}

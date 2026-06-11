#include "TrackEffectDefaults.h"

namespace beat
{
    bool hasTrackEffectParam(const TrackEffect& effect, const juce::String& key)
    {
        for (const auto& param : effect.params)
            if (param.key == key)
                return true;
        return false;
    }

    void addMissingTrackEffectParam(TrackEffect& effect, const char* key, float value)
    {
        if (!hasTrackEffectParam(effect, key))
            effect.params.push_back({ key, value });
    }

    void normalizeTrackEffect(TrackEffect& effect)
    {
        effect.schemaVersion = kCurrentTrackEffectSchemaVersion;
        effect.latencySamples = juce::jlimit(0, kMaxTrackEffectLatencySamples, effect.latencySamples);

        switch (effect.kind)
        {
            case TrackEffectKind::Lowpass:
                addMissingTrackEffectParam(effect, "cutoffHz", 8000.0f);
                addMissingTrackEffectParam(effect, "resonance", 0.0f);
                break;
            case TrackEffectKind::Highpass:
                addMissingTrackEffectParam(effect, "cutoffHz", 80.0f);
                addMissingTrackEffectParam(effect, "resonance", 0.0f);
                break;
            case TrackEffectKind::Saturator:
                addMissingTrackEffectParam(effect, "drive", 20.0f);
                addMissingTrackEffectParam(effect, "mix", 100.0f);
                break;
            case TrackEffectKind::Distortion:
                addMissingTrackEffectParam(effect, "drive", 55.0f);
                addMissingTrackEffectParam(effect, "shape", 35.0f);
                addMissingTrackEffectParam(effect, "trimDb", 6.0f);
                addMissingTrackEffectParam(effect, "mix", 45.0f);
                break;
            case TrackEffectKind::Bitcrush:
                addMissingTrackEffectParam(effect, "bits", 8.0f);
                addMissingTrackEffectParam(effect, "rate", 50.0f);
                addMissingTrackEffectParam(effect, "mix", 35.0f);
                break;
            case TrackEffectKind::Reverb:
                addMissingTrackEffectParam(effect, "roomSize", 40.0f);
                addMissingTrackEffectParam(effect, "damping", 35.0f);
                addMissingTrackEffectParam(effect, "mix", 20.0f);
                break;
            case TrackEffectKind::Delay:
                addMissingTrackEffectParam(effect, "timeMs", 250.0f);
                addMissingTrackEffectParam(effect, "feedback", 25.0f);
                addMissingTrackEffectParam(effect, "mix", 18.0f);
                break;
            case TrackEffectKind::Compressor:
                addMissingTrackEffectParam(effect, "thresholdDb", -18.0f);
                addMissingTrackEffectParam(effect, "ratio", 4.0f);
                addMissingTrackEffectParam(effect, "attackMs", 10.0f);
                addMissingTrackEffectParam(effect, "releaseMs", 120.0f);
                addMissingTrackEffectParam(effect, "makeupDb", 0.0f);
                addMissingTrackEffectParam(effect, "mix", 100.0f);
                break;
            case TrackEffectKind::Chorus:
                addMissingTrackEffectParam(effect, "rateHz", 0.8f);
                addMissingTrackEffectParam(effect, "depthMs", 8.0f);
                addMissingTrackEffectParam(effect, "delayMs", 12.0f);
                addMissingTrackEffectParam(effect, "feedback", 8.0f);
                addMissingTrackEffectParam(effect, "mix", 35.0f);
                break;
            case TrackEffectKind::Flanger:
                addMissingTrackEffectParam(effect, "rateHz", 0.28f);
                addMissingTrackEffectParam(effect, "depthMs", 2.0f);
                addMissingTrackEffectParam(effect, "delayMs", 2.5f);
                addMissingTrackEffectParam(effect, "feedback", 45.0f);
                addMissingTrackEffectParam(effect, "mix", 50.0f);
                break;
            case TrackEffectKind::Phaser:
                addMissingTrackEffectParam(effect, "rateHz", 0.45f);
                addMissingTrackEffectParam(effect, "centerHz", 900.0f);
                addMissingTrackEffectParam(effect, "depthOct", 1.8f);
                addMissingTrackEffectParam(effect, "feedback", 35.0f);
                addMissingTrackEffectParam(effect, "mix", 45.0f);
                break;
            case TrackEffectKind::Plugin:
            case TrackEffectKind::Unknown:
                break;
        }
    }
}

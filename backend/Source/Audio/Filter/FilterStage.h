#pragma once

#include "FilterMath.h"

#include <juce_dsp/juce_dsp.h>

#include <cmath>

namespace beat::FilterStage
{
    struct StereoFrame
    {
        float left { 0.0f };
        float right { 0.0f };
    };

    struct State
    {
        void prepare(double sampleRate, int blockSize, int type)
        {
            left.prepare({ sampleRate, (juce::uint32) blockSize, 1u });
            right.prepare({ sampleRate, (juce::uint32) blockSize, 1u });
            setType(type);
        }

        void configure(int type, float cutoff01, float resonance01, double sampleRate, float keytrack, double baseFrequencyHz)
        {
            setType(type);
            cachedCutoffHz = FilterMath::keytrackedCutoffHz(cutoff01, sampleRate, keytrack, baseFrequencyHz);
            cachedResonance = FilterMath::resonanceFromNormalized(resonance01);
            left.setCutoffFrequency(cachedCutoffHz);
            right.setCutoffFrequency(cachedCutoffHz);
            left.setResonance(cachedResonance);
            right.setResonance(cachedResonance);
        }

        int updateCutoffIfChanged(float cutoff01, double sampleRate, float keytrack, double baseFrequencyHz, float thresholdHz)
        {
            const float nextCutoffHz = FilterMath::keytrackedCutoffHz(cutoff01, sampleRate, keytrack, baseFrequencyHz);
            if (std::abs(nextCutoffHz - cachedCutoffHz) <= thresholdHz)
                return 0;

            left.setCutoffFrequency(nextCutoffHz);
            right.setCutoffFrequency(nextCutoffHz);
            cachedCutoffHz = nextCutoffHz;
            return 2;
        }

        int updateResonanceIfChanged(float resonance01, float threshold)
        {
            const float nextResonance = FilterMath::resonanceFromNormalized(resonance01);
            if (std::abs(nextResonance - cachedResonance) <= threshold)
                return 0;

            left.setResonance(nextResonance);
            right.setResonance(nextResonance);
            cachedResonance = nextResonance;
            return 2;
        }

        StereoFrame process(float leftIn, float rightIn)
        {
            return {
                left.processSample(0, leftIn),
                right.processSample(0, rightIn),
            };
        }

        float currentCutoffHz() const noexcept { return cachedCutoffHz; }
        float currentResonance() const noexcept { return cachedResonance; }

    private:
        void setType(int type)
        {
            left.setType(FilterMath::typeForParam(type));
            right.setType(FilterMath::typeForParam(type));
        }

        juce::dsp::StateVariableTPTFilter<float> left;
        juce::dsp::StateVariableTPTFilter<float> right;
        float cachedCutoffHz { -1.0f };
        float cachedResonance { -1.0f };
    };
}

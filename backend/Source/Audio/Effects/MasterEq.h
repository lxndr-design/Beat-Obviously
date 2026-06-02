#pragma once

#include <juce_dsp/juce_dsp.h>
#include "../TrackModel.h"
#include <vector>

namespace beat
{
    /**
     * MasterEq — 4-band IIR EQ (low shelf, mid bell, high bell, air shelf).
     *
     * Reads from the EqAutomationPoint timeline and interpolates linearly
     * between adjacent points by project-time beat. The sequencer pushes the
     * current beat in each block; the EQ updates coefficients smoothly.
     */
    class MasterEq
    {
    public:
        void prepare(double sampleRate, int blockSize, int numChannels);
        void setAutomation(std::vector<EqAutomationPoint> points);
        void setCurrentBeat(Beats b) { currentBeat = b; }
        void process(juce::AudioBuffer<float>& buf);

    private:
        struct BandGains { float lowDb{0}, midDb{0}, highDb{0}, airDb{0}; };
        BandGains gainsAtBeat(Beats b) const;
        static bool differs(const BandGains& a, const BandGains& b, float epsilonDb);
        static BandGains blend(const BandGains& from, const BandGains& to, float t);
        void updateCoefficients(const BandGains& gainsDb);

        double sampleRate { 44100.0 };
        Beats  currentBeat { 0.0 };
        std::vector<EqAutomationPoint> automation;
        BandGains smoothedGains;
        BandGains appliedGains;
        bool hasAppliedGains { false };
        double smoothingTimeSeconds { 0.015 };

        using Filter = juce::dsp::ProcessorDuplicator<
            juce::dsp::IIR::Filter<float>,
            juce::dsp::IIR::Coefficients<float>>;
        Filter low, mid, high, air;
    };
}

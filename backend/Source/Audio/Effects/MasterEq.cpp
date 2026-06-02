#include "MasterEq.h"

#include <cmath>

namespace beat
{
    bool MasterEq::differs(const BandGains& a, const BandGains& b, float epsilonDb)
    {
        return std::abs(a.lowDb - b.lowDb) > epsilonDb
            || std::abs(a.midDb - b.midDb) > epsilonDb
            || std::abs(a.highDb - b.highDb) > epsilonDb
            || std::abs(a.airDb - b.airDb) > epsilonDb;
    }

    MasterEq::BandGains MasterEq::blend(const BandGains& from, const BandGains& to, float t)
    {
        return {
            juce::jmap(t, from.lowDb, to.lowDb),
            juce::jmap(t, from.midDb, to.midDb),
            juce::jmap(t, from.highDb, to.highDb),
            juce::jmap(t, from.airDb, to.airDb),
        };
    }

    void MasterEq::prepare(double sr, int blockSize, int channels)
    {
        sampleRate = sr;
        juce::dsp::ProcessSpec spec { sr, (juce::uint32) blockSize, (juce::uint32) channels };
        low.prepare(spec);
        mid.prepare(spec);
        high.prepare(spec);
        air.prepare(spec);

        smoothedGains = {};
        appliedGains = {};
        hasAppliedGains = false;
        updateCoefficients(smoothedGains);
        hasAppliedGains = true;
    }

    void MasterEq::setAutomation(std::vector<EqAutomationPoint> p)
    {
        automation = std::move(p);
        std::sort(automation.begin(), automation.end(),
                  [](const auto& a, const auto& b) { return a.atBeat < b.atBeat; });
    }

    MasterEq::BandGains MasterEq::gainsAtBeat(Beats b) const
    {
        if (automation.empty())
            return {};
        if (b <= automation.front().atBeat)
            return { automation.front().lowDb, automation.front().midDb,
                     automation.front().highDb, automation.front().airDb };
        if (b >= automation.back().atBeat)
            return { automation.back().lowDb, automation.back().midDb,
                     automation.back().highDb, automation.back().airDb };

        for (size_t i = 1; i < automation.size(); ++i)
        {
            const auto& A = automation[i - 1];
            const auto& B = automation[i];
            if (b >= A.atBeat && b <= B.atBeat)
            {
                const float t = (float) ((b - A.atBeat) / (B.atBeat - A.atBeat));
                return { juce::jmap(t, A.lowDb,  B.lowDb),
                         juce::jmap(t, A.midDb,  B.midDb),
                         juce::jmap(t, A.highDb, B.highDb),
                         juce::jmap(t, A.airDb,  B.airDb) };
            }
        }
        return {};
    }

    void MasterEq::updateCoefficients(const BandGains& gainsDb)
    {
        const auto dbToGain = [](float db) { return juce::Decibels::decibelsToGain(db); };
        using ArrayCoeffs = juce::dsp::IIR::ArrayCoefficients<float>;

        *low.state  = ArrayCoeffs::makeLowShelf(sampleRate,    120.0,  0.707f, dbToGain(gainsDb.lowDb));
        *mid.state  = ArrayCoeffs::makePeakFilter(sampleRate, 1000.0, 0.8f,    dbToGain(gainsDb.midDb));
        *high.state = ArrayCoeffs::makePeakFilter(sampleRate, 5000.0, 0.8f,    dbToGain(gainsDb.highDb));
        *air.state  = ArrayCoeffs::makeHighShelf(sampleRate, 12000.0, 0.707f,  dbToGain(gainsDb.airDb));
    }

    void MasterEq::process(juce::AudioBuffer<float>& buf)
    {
        const auto target = gainsAtBeat(currentBeat);
        const auto blockSamples = juce::jmax(1, buf.getNumSamples());
        const auto tauSamples = juce::jmax(1.0, smoothingTimeSeconds * sampleRate);
        const float alpha = (float) (1.0 - std::exp(-blockSamples / tauSamples));
        smoothedGains = blend(smoothedGains, target, juce::jlimit(0.0f, 1.0f, alpha));

        if (!hasAppliedGains || differs(smoothedGains, appliedGains, 0.01f))
        {
            updateCoefficients(smoothedGains);
            appliedGains = smoothedGains;
            hasAppliedGains = true;
        }

        juce::dsp::AudioBlock<float> block(buf);
        juce::dsp::ProcessContextReplacing<float> ctx(block);
        low.process(ctx);
        mid.process(ctx);
        high.process(ctx);
        air.process(ctx);
    }
}

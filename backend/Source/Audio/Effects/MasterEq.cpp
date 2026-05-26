#include "MasterEq.h"

namespace beat
{
    void MasterEq::prepare(double sr, int blockSize, int channels)
    {
        sampleRate = sr;
        juce::dsp::ProcessSpec spec { sr, (juce::uint32) blockSize, (juce::uint32) channels };
        low.prepare(spec);
        mid.prepare(spec);
        high.prepare(spec);
        air.prepare(spec);
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

    void MasterEq::process(juce::AudioBuffer<float>& buf)
    {
        const auto g = gainsAtBeat(currentBeat);
        const auto dbToGain = [](float db) { return juce::Decibels::decibelsToGain(db); };

        *low.state  = *juce::dsp::IIR::Coefficients<float>::makeLowShelf (sampleRate,    120.0,  0.707f, dbToGain(g.lowDb));
        *mid.state  = *juce::dsp::IIR::Coefficients<float>::makePeakFilter(sampleRate,   1000.0, 0.8f,   dbToGain(g.midDb));
        *high.state = *juce::dsp::IIR::Coefficients<float>::makePeakFilter(sampleRate,   5000.0, 0.8f,   dbToGain(g.highDb));
        *air.state  = *juce::dsp::IIR::Coefficients<float>::makeHighShelf (sampleRate,  12000.0, 0.707f, dbToGain(g.airDb));

        juce::dsp::AudioBlock<float> block(buf);
        juce::dsp::ProcessContextReplacing<float> ctx(block);
        low.process(ctx);
        mid.process(ctx);
        high.process(ctx);
        air.process(ctx);
    }
}

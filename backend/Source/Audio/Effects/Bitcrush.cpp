#include "Bitcrush.h"

namespace beat
{
    void Bitcrush::process(juce::AudioBuffer<float>& buf)
    {
        const int channels  = buf.getNumChannels();
        const int n         = buf.getNumSamples();
        const float steps   = std::pow(2.f, juce::jlimit(1.f, 16.f, params.bitDepth));
        const float ds      = juce::jmax(1.f, params.downsample);
        const float wet     = juce::jlimit(0.f, 1.f, params.dryWet01);
        const float dry     = 1.f - wet;

        for (int i = 0; i < n; ++i)
        {
            for (int ch = 0; ch < channels; ++ch)
            {
                float in = buf.getSample(ch, i);
                if (counter == 0)
                {
                    // quantize
                    hold = std::round(in * steps) / steps;
                }
                buf.setSample(ch, i, in * dry + hold * wet);
            }
            if (++counter >= (int) ds) counter = 0;
        }
    }
}

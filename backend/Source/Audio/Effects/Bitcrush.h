#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

namespace beat
{
    /**
     * Bitcrush — sample-rate decimation + bit depth reduction.
     * Cheap to compute, defines the "filter layer" effect in the spec.
     */
    class Bitcrush
    {
    public:
        struct Params {
            float bitDepth  { 16.0f }; // 1..16
            float downsample{ 1.0f };  // 1 = none, N = hold N samples
            float dryWet01  { 1.0f };
        };

        void setParams(const Params& p) { params = p; }
        void prepare(double sr, int /*blockSize*/) { sampleRate = sr; }

        void process(juce::AudioBuffer<float>& buf);

    private:
        Params params;
        double sampleRate { 44100.0 };
        float  hold       { 0.0f };
        int    counter    { 0 };
    };
}

#include "WavetableFactory.h"
#include "../Parameters/ParameterIds.h"

#include <cmath>
#include <vector>

namespace beat
{
    namespace
    {
        constexpr double twoPi = juce::MathConstants<double>::twoPi;

        juce::String shapeId(BasicWavetableShape shape)
        {
            switch (shape)
            {
                case BasicWavetableShape::Sine: return juce::String(params::wavetable::basicSine.data());
                case BasicWavetableShape::Saw: return juce::String(params::wavetable::basicSaw.data());
                case BasicWavetableShape::Square: return juce::String(params::wavetable::basicSquare.data());
                case BasicWavetableShape::Triangle: return juce::String(params::wavetable::basicTriangle.data());
                case BasicWavetableShape::Pulse: return juce::String(params::wavetable::basicPulse.data());
            }

            return "basic.unknown";
        }

        juce::String shapeName(BasicWavetableShape shape)
        {
            switch (shape)
            {
                case BasicWavetableShape::Sine: return "Sine";
                case BasicWavetableShape::Saw: return "Saw";
                case BasicWavetableShape::Square: return "Square";
                case BasicWavetableShape::Triangle: return "Triangle";
                case BasicWavetableShape::Pulse: return "Pulse";
            }

            return "Unknown";
        }

        float harmonicAmplitude(BasicWavetableShape shape, int harmonic)
        {
            switch (shape)
            {
                case BasicWavetableShape::Sine:
                    return harmonic == 1 ? 1.0f : 0.0f;

                case BasicWavetableShape::Saw:
                    return 1.0f / (float) harmonic;

                case BasicWavetableShape::Square:
                    return (harmonic % 2) == 1 ? 1.0f / (float) harmonic : 0.0f;

                case BasicWavetableShape::Pulse:
                {
                    constexpr float duty = 0.25f;
                    return (2.0f / (float) harmonic)
                        * std::sin(juce::MathConstants<float>::pi * (float) harmonic * duty);
                }

                case BasicWavetableShape::Triangle:
                    if ((harmonic % 2) == 0)
                        return 0.0f;

                    return (((harmonic - 1) / 2) % 2 == 0 ? 1.0f : -1.0f)
                        / ((float) harmonic * (float) harmonic);
            }

            return 0.0f;
        }

        void normalizeFrame(std::vector<float>& samples, int frameStart, int frameSize)
        {
            float peak = 0.0f;
            for (int i = 0; i < frameSize; ++i)
                peak = juce::jmax(peak, std::abs(samples[(size_t) frameStart + (size_t) i]));

            if (peak <= 0.000001f)
                return;

            const float gain = 0.95f / peak;
            for (int i = 0; i < frameSize; ++i)
                samples[(size_t) frameStart + (size_t) i] *= gain;
        }
    }

    Wavetable WavetableFactory::createBasic(BasicWavetableShape shape, int frameCount, int frameSize)
    {
        frameCount = juce::jlimit(1, 64, frameCount);
        frameSize = juce::jlimit(32, 32768, frameSize);

        std::vector<float> samples((size_t) frameCount * (size_t) frameSize, 0.0f);
        const int maxTableHarmonic = juce::jmax(1, frameSize / 2 - 1);

        for (int frame = 0; frame < frameCount; ++frame)
        {
            const float frameNorm = frameCount <= 1 ? 1.0f : (float) frame / (float) (frameCount - 1);
            const int harmonicLimit = shape == BasicWavetableShape::Sine
                ? 1
                : juce::jlimit(1, maxTableHarmonic, 1 + (int) std::round(frameNorm * (float) (maxTableHarmonic - 1)));
            const int frameStart = frame * frameSize;

            for (int i = 0; i < frameSize; ++i)
            {
                const double phase = (double) i / (double) frameSize;
                double value = 0.0;

                for (int harmonic = 1; harmonic <= harmonicLimit; ++harmonic)
                {
                    const float amp = harmonicAmplitude(shape, harmonic);
                    if (amp != 0.0f)
                        value += std::sin(twoPi * phase * (double) harmonic) * (double) amp;
                }

                samples[(size_t) frameStart + (size_t) i] = (float) value;
            }

            normalizeFrame(samples, frameStart, frameSize);
        }

        return Wavetable(
            Wavetable::Metadata {
                shapeId(shape),
                shapeName(shape),
                "generated.basic"
            },
            frameCount,
            frameSize,
            std::move(samples));
    }
}

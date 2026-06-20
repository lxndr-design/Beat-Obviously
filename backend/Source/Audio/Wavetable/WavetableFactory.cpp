#include "WavetableFactory.h"
#include "../Parameters/ParameterIds.h"

#include <cmath>
#include <vector>

namespace beat
{
    namespace
    {
        constexpr double twoPi = juce::MathConstants<double>::twoPi;
        constexpr int generatedMaxHarmonics = 64;

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

        float warpModeIntensity(float warp, WavetableWarpMode mode)
        {
            const float clamped = juce::jlimit(0.0f, 1.0f, warp);
            switch (mode)
            {
                case WavetableWarpMode::Fold: return clamped * 1.35f;
                case WavetableWarpMode::Pinch: return std::pow(clamped, 0.72f);
                case WavetableWarpMode::Shape:
                default: return clamped;
            }
        }

        float warpAmplitudeOffset(WavetableWarpMode mode, int harmonic, float frame, float warp)
        {
            const float shapedWarp = warpModeIntensity(warp, mode);
            if (mode == WavetableWarpMode::Fold)
                return std::abs(std::sin((float) harmonic * 0.58f + frame * 4.0f)) * shapedWarp * 0.22f / std::sqrt((float) harmonic);
            if (mode == WavetableWarpMode::Pinch)
            {
                const float width = 1.8f + shapedWarp * 3.0f;
                return std::exp(-std::pow(((float) harmonic - (2.0f + frame * 10.0f)) / width, 2.0f)) * shapedWarp * 0.34f;
            }
            return 0.0f;
        }

        float warpPhaseOffset(WavetableWarpMode mode, int harmonic, float frame, float warp)
        {
            const float shapedWarp = warpModeIntensity(warp, mode);
            if (mode == WavetableWarpMode::Fold)
                return std::sin((float) harmonic * 0.47f + frame * juce::MathConstants<float>::pi) * shapedWarp * 0.55f;
            if (mode == WavetableWarpMode::Pinch)
                return std::cos((float) harmonic * 0.33f + frame) * shapedWarp * 0.3f;
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

        float customAmplitude(const WavetableFactory::CustomFrame& frame, int harmonic, float warp, WavetableWarpMode warpMode)
        {
            const float brightness = juce::jlimit(0.0f, 1.0f, frame.brightness);
            const float even = juce::jlimit(0.0f, 1.0f, frame.even);
            const float skew = juce::jlimit(-1.0f, 1.0f, frame.skew);
            const float tilt = juce::jlimit(-1.0f, 1.0f, frame.tilt);
            const float formant = juce::jlimit(0.0f, 1.0f, frame.formant);
            const float notch = juce::jlimit(0.0f, 1.0f, frame.notch);
            const float shapedWarp = warpModeIntensity(warp, warpMode);
            const float fold = juce::jlimit(0.0f, 1.0f, frame.fold + shapedWarp * 0.35f);
            const float parity = (harmonic % 2) == 1 ? 1.0f : even;
            const float rolloff = std::exp(-(float) harmonic * (0.016f + (1.0f - brightness) * 0.085f));
            const float skewBias = juce::jmax(0.18f, 1.0f + skew * (((float) harmonic - 8.0f) / 18.0f));
            const float tiltBias = juce::jmax(0.12f, std::exp(tilt * (((float) harmonic - 8.0f) / 9.0f)));
            const float center = 3.0f + brightness * 20.0f;
            const float width = 1.6f + fold * 8.0f;
            const float foldPeak = std::exp(-std::pow(((float) harmonic - center) / width, 2.0f));
            const float formantCenter = 4.0f + brightness * 24.0f + skew * 4.0f;
            const float formantWidth = 1.1f + fold * 4.4f;
            const float formantPeak = std::exp(-std::pow(((float) harmonic - formantCenter) / formantWidth, 2.0f));
            const float notchCenter = 6.0f + (1.0f - brightness) * 18.0f - skew * 4.0f;
            const float notchWidth = 1.2f + fold * 4.8f + formant * 1.8f;
            const float notchPeak = std::exp(-std::pow(((float) harmonic - notchCenter) / notchWidth, 2.0f));
            const float notchCut = juce::jmax(0.08f, 1.0f - notchPeak * notch * 0.72f);
            const float drawnPartial = harmonic > 0 && harmonic <= (int) frame.partials.size()
                ? juce::jlimit(0.0f, 1.0f, frame.partials[(size_t) harmonic - 1])
                : 0.0f;
            const float motion = 1.0f + std::sin((float) harmonic * 1.7f + frame.phase * juce::MathConstants<float>::pi) * fold * 0.28f;
            return juce::jmax(
                0.0f,
                (parity * rolloff * motion * skewBias * tiltBias / std::sqrt((float) harmonic)
                    + foldPeak * fold * 0.35f
                    + formantPeak * formant * 0.55f
                    + drawnPartial * (0.08f + brightness * 0.34f)) * notchCut
                    + warpAmplitudeOffset(warpMode, harmonic, brightness, warp));
        }

        float customPhase(const WavetableFactory::CustomFrame& frame, int harmonic, float warp, WavetableWarpMode warpMode)
        {
            const float shapedWarp = warpModeIntensity(warp, warpMode);
            const float fold = juce::jlimit(0.0f, 1.0f, frame.fold + shapedWarp * 0.25f);
            const float formant = juce::jlimit(0.0f, 1.0f, frame.formant);
            const float notch = juce::jlimit(0.0f, 1.0f, frame.notch);
            const float phase = juce::jlimit(-1.0f, 1.0f, frame.phase);
            const float skew = juce::jlimit(-1.0f, 1.0f, frame.skew);
            return phase * (float) harmonic * 0.28f
                + std::sin((float) harmonic * 0.41f + skew * 0.55f) * fold * 0.55f
                + skew * std::log2((float) harmonic + 1.0f) * 0.09f
                + std::sin((float) harmonic * 0.23f + phase) * formant * 0.12f
                + std::cos((float) harmonic * 0.31f + skew) * notch * 0.08f
                + warpPhaseOffset(warpMode, harmonic, phase, warp);
        }

        float smoothInterpolate(float p0, float p1, float p2, float p3, float mix) noexcept
        {
            const float t = juce::jlimit(0.0f, 1.0f, mix);
            const float t2 = t * t;
            const float t3 = t2 * t;
            return 0.5f * (
                (2.0f * p1)
                + (-p0 + p2) * t
                + (2.0f * p0 - 5.0f * p1 + 4.0f * p2 - p3) * t2
                + (-p0 + 3.0f * p1 - 3.0f * p2 + p3) * t3);
        }

        WavetableFactory::CustomFrame interpolateCustomFrame(
            const std::array<WavetableFactory::CustomFrame, 4>& frames,
            float normalizedFrame,
            bool smoothInterpolation)
        {
            const float scaled = juce::jlimit(0.0f, 1.0f, normalizedFrame) * 3.0f;
            const int base = juce::jlimit(0, 2, (int) std::floor(scaled));
            const float mix = scaled - (float) base;
            const auto& a = frames[(size_t) base];
            const auto& b = frames[(size_t) base + 1];
            if (smoothInterpolation)
            {
                const auto& p0 = frames[(size_t) juce::jlimit(0, 3, base - 1)];
                const auto& p3 = frames[(size_t) juce::jlimit(0, 3, base + 2)];
                auto result = WavetableFactory::CustomFrame {
                    juce::jlimit(0.0f, 1.0f, smoothInterpolate(p0.brightness, a.brightness, b.brightness, p3.brightness, mix)),
                    juce::jlimit(0.0f, 1.0f, smoothInterpolate(p0.even, a.even, b.even, p3.even, mix)),
                    juce::jlimit(0.0f, 1.0f, smoothInterpolate(p0.fold, a.fold, b.fold, p3.fold, mix)),
                    juce::jlimit(0.0f, 1.0f, smoothInterpolate(p0.formant, a.formant, b.formant, p3.formant, mix)),
                    juce::jlimit(0.0f, 1.0f, smoothInterpolate(p0.notch, a.notch, b.notch, p3.notch, mix)),
                    juce::jlimit(-1.0f, 1.0f, smoothInterpolate(p0.skew, a.skew, b.skew, p3.skew, mix)),
                    juce::jlimit(-1.0f, 1.0f, smoothInterpolate(p0.tilt, a.tilt, b.tilt, p3.tilt, mix)),
                    juce::jlimit(-1.0f, 1.0f, smoothInterpolate(p0.phase, a.phase, b.phase, p3.phase, mix)),
                };
                for (size_t i = 0; i < result.partials.size(); ++i)
                    result.partials[i] = juce::jlimit(0.0f, 1.0f, smoothInterpolate(p0.partials[i], a.partials[i], b.partials[i], p3.partials[i], mix));
                return result;
            }
            auto result = WavetableFactory::CustomFrame {
                a.brightness + (b.brightness - a.brightness) * mix,
                a.even + (b.even - a.even) * mix,
                a.fold + (b.fold - a.fold) * mix,
                a.formant + (b.formant - a.formant) * mix,
                a.notch + (b.notch - a.notch) * mix,
                a.skew + (b.skew - a.skew) * mix,
                a.tilt + (b.tilt - a.tilt) * mix,
                a.phase + (b.phase - a.phase) * mix,
            };
            for (size_t i = 0; i < result.partials.size(); ++i)
                result.partials[i] = a.partials[i] + (b.partials[i] - a.partials[i]) * mix;
            return result;
        }
    }

    Wavetable WavetableFactory::createBasic(BasicWavetableShape shape, int frameCount, int frameSize)
    {
        return createBasic(shape, 0.0f, WavetableWarpMode::Shape, frameCount, frameSize);
    }

    Wavetable WavetableFactory::createBasic(BasicWavetableShape shape, float warp, WavetableWarpMode warpMode, int frameCount, int frameSize)
    {
        frameCount = juce::jlimit(1, 64, frameCount);
        frameSize = juce::jlimit(32, 32768, frameSize);

        std::vector<float> samples((size_t) frameCount * (size_t) frameSize, 0.0f);
        const int maxTableHarmonic = juce::jmax(1, juce::jmin(generatedMaxHarmonics, frameSize / 2 - 1));

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
                    {
                        const float harmonicWarp = warpAmplitudeOffset(warpMode, harmonic, frameNorm, warp);
                        const float shapedAmp = amp + harmonicWarp;
                        value += std::sin(twoPi * phase * (double) harmonic + (double) warpPhaseOffset(warpMode, harmonic, frameNorm, warp)) * (double) shapedAmp;
                    }
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

    Wavetable WavetableFactory::createCustom(const std::array<CustomFrame, 4>& frames, int frameCount, int frameSize)
    {
        return createCustom(frames, 0.0f, WavetableWarpMode::Shape, false, frameCount, frameSize);
    }

    Wavetable WavetableFactory::createCustom(const std::array<CustomFrame, 4>& frames, bool smoothInterpolation, int frameCount, int frameSize)
    {
        return createCustom(frames, 0.0f, WavetableWarpMode::Shape, smoothInterpolation, frameCount, frameSize);
    }

    Wavetable WavetableFactory::createCustom(const std::array<CustomFrame, 4>& frames, float warp, WavetableWarpMode warpMode, bool smoothInterpolation, int frameCount, int frameSize)
    {
        frameCount = juce::jlimit(1, 64, frameCount);
        frameSize = juce::jlimit(32, 32768, frameSize);

        std::vector<float> samples((size_t) frameCount * (size_t) frameSize, 0.0f);
        const int maxTableHarmonic = juce::jmax(1, juce::jmin(generatedMaxHarmonics, frameSize / 2 - 1));

        for (int frame = 0; frame < frameCount; ++frame)
        {
            const float frameNorm = frameCount <= 1 ? 0.0f : (float) frame / (float) (frameCount - 1);
            const auto customFrame = interpolateCustomFrame(frames, frameNorm, smoothInterpolation);
            const int frameStart = frame * frameSize;

            for (int i = 0; i < frameSize; ++i)
            {
                const double phase = (double) i / (double) frameSize;
                double value = 0.0;

                for (int harmonic = 1; harmonic <= maxTableHarmonic; ++harmonic)
                {
                    const float amp = customAmplitude(customFrame, harmonic, warp, warpMode);
                    if (amp <= 0.0001f) continue;
                    value += std::sin(twoPi * phase * (double) harmonic + (double) customPhase(customFrame, harmonic, warp, warpMode)) * (double) amp;
                }

                samples[(size_t) frameStart + (size_t) i] = (float) value;
            }

            normalizeFrame(samples, frameStart, frameSize);
        }

        return Wavetable(
            Wavetable::Metadata {
                "user.custom",
                "Custom",
                "generated.custom"
            },
            frameCount,
            frameSize,
            std::move(samples));
    }
}

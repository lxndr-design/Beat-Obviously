#include "AetherRuntimeWarpCorpus.h"

#include <juce_core/juce_core.h>
#include <juce_cryptography/juce_cryptography.h>
#include <juce_dsp/juce_dsp.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstring>
#include <iostream>
#include <limits>
#include <vector>

namespace beat::test
{
    namespace
    {
        constexpr int sampleCount = 4096;
        constexpr int analysisStart = 256;
        constexpr int analysisEnd = sampleCount - 256;
        constexpr int referenceFactor = 16;
        constexpr int firTaps = 127;

        struct Scenario
        {
            double sampleRate {};
            double frequencyHz {};
            int mode1 {};
            float amount1 {};
            int mode2 { -1 };
            float amount2 {};
        };

        struct Render
        {
            std::vector<float> samples;
            double elapsedUs {};
            int64_t nonlinearEvaluations {};
        };

        float warp(float input, float amount, int mode) noexcept
        {
            const float drive = juce::jlimit(0.0f, 1.0f, amount);
            if (drive <= 0.0001f)
                return input;

            const float x = juce::jlimit(-1.0f, 1.0f, input);
            if (mode == 1)
            {
                const float gain = 1.0f + drive * 5.5f;
                const float folded = std::asin(std::sin(x * gain)) / juce::MathConstants<float>::halfPi;
                return juce::jlimit(-1.0f, 1.0f, x + (folded - x) * (0.35f + drive * 0.65f));
            }
            if (mode == 2)
            {
                const float shaped = (x < 0.0f ? -1.0f : 1.0f)
                    * std::pow(std::abs(x), 1.0f + drive * 3.2f);
                return juce::jlimit(-1.0f, 1.0f, x + (shaped - x) * (0.4f + drive * 0.6f));
            }
            if (mode == 3)
            {
                const float mirrored = std::sin(x * juce::MathConstants<float>::pi * (1.0f + drive * 2.2f))
                    * (1.0f - std::abs(x) * drive * 0.35f);
                return juce::jlimit(-1.0f, 1.0f, x + (mirrored - x) * (0.32f + drive * 0.68f));
            }

            const float gain = 1.0f + drive * 8.0f;
            return juce::jlimit(-1.0f, 1.0f, std::tanh(x * gain) / std::tanh(gain));
        }

        float applyScenario(float input, const Scenario& scenario) noexcept
        {
            float output = warp(input, scenario.amount1, scenario.mode1);
            if (scenario.mode2 >= 0)
                output = warp(output, scenario.amount2, scenario.mode2);
            return output;
        }

        const char* modeName(int mode) noexcept
        {
            constexpr std::array names { "shape", "fold", "pinch", "mirror" };
            return names[(size_t) juce::jlimit(0, 3, mode)];
        }

        std::vector<double> makeKernel(int factor)
        {
            std::vector<double> kernel((size_t) firTaps);
            const int half = firTaps / 2;
            const double cutoff = 0.47 / (double) factor;
            double sum = 0.0;
            for (int tap = -half; tap <= half; ++tap)
            {
                const double argument = 2.0 * cutoff * (double) tap;
                const double sinc = tap == 0
                    ? 1.0
                    : std::sin(juce::MathConstants<double>::pi * argument)
                        / (juce::MathConstants<double>::pi * argument);
                const double phase = (double) (tap + half) / (double) (firTaps - 1);
                const double window = 0.42
                    - 0.5 * std::cos(juce::MathConstants<double>::twoPi * phase)
                    + 0.08 * std::cos(2.0 * juce::MathConstants<double>::twoPi * phase);
                kernel[(size_t) (tap + half)] = 2.0 * cutoff * sinc * window;
                sum += kernel[(size_t) (tap + half)];
            }
            for (auto& coefficient : kernel)
                coefficient /= sum;
            return kernel;
        }

        Render renderIdeal(const Scenario& scenario, int factor)
        {
            const auto started = std::chrono::steady_clock::now();
            const int half = firTaps / 2;
            const int padding = half + factor;
            const int highCount = sampleCount * factor + padding * 2;
            std::vector<float> high((size_t) highCount);
            const int stages = scenario.mode2 >= 0 ? 2 : 1;
            for (int index = 0; index < highCount; ++index)
            {
                const double time = (double) (index - padding)
                    / (scenario.sampleRate * (double) factor);
                const float input = 0.82f * (float) std::sin(
                    juce::MathConstants<double>::twoPi * scenario.frequencyHz * time + 0.37);
                high[(size_t) index] = applyScenario(input, scenario);
            }

            std::vector<float> output((size_t) sampleCount);
            if (factor == 1)
            {
                std::copy_n(high.begin() + padding, sampleCount, output.begin());
            }
            else
            {
                const auto kernel = makeKernel(factor);
                for (int sample = 0; sample < sampleCount; ++sample)
                {
                    const int center = padding + sample * factor;
                    double value = 0.0;
                    for (int tap = -half; tap <= half; ++tap)
                        value += (double) high[(size_t) (center + tap)] * kernel[(size_t) (tap + half)];
                    output[(size_t) sample] = (float) value;
                }
            }

            const auto stopped = std::chrono::steady_clock::now();
            return {
                std::move(output),
                std::chrono::duration<double, std::micro>(stopped - started).count(),
                (int64_t) highCount * stages,
            };
        }

        Render renderCurrent2x(const Scenario& scenario)
        {
            struct StageState
            {
                float previous {};
                float downsample {};
            };

            const auto started = std::chrono::steady_clock::now();
            std::array<StageState, 2> states {};
            std::vector<float> output((size_t) sampleCount);
            const int stages = scenario.mode2 >= 0 ? 2 : 1;
            // Settle the current state before the measured FFT so the spectral
            // comparison does not misclassify note-start filter history as
            // steady-state alias energy.
            for (int sample = -analysisStart; sample < sampleCount; ++sample)
            {
                const double time = (double) sample / scenario.sampleRate;
                float value = 0.82f * (float) std::sin(
                    juce::MathConstants<double>::twoPi * scenario.frequencyHz * time + 0.37);
                for (int stage = 0; stage < stages; ++stage)
                {
                    auto& state = states[(size_t) stage];
                    const float amount = stage == 0 ? scenario.amount1 : scenario.amount2;
                    const int mode = stage == 0 ? scenario.mode1 : scenario.mode2;
                    const float midpoint = 0.5f * (state.previous + value);
                    const float downsampled = 0.5f * (warp(midpoint, amount, mode) + warp(value, amount, mode));
                    state.downsample += 0.72f * (downsampled - state.downsample);
                    state.previous = value;
                    value = state.downsample;
                }
                if (sample >= 0)
                    output[(size_t) sample] = value;
            }
            const auto stopped = std::chrono::steady_clock::now();
            return {
                std::move(output),
                std::chrono::duration<double, std::micro>(stopped - started).count(),
                (int64_t) (sampleCount + analysisStart) * stages * 2,
            };
        }

        std::vector<double> magnitudeSpectrum(const std::vector<float>& input)
        {
            constexpr int fftOrder = 12;
            constexpr int fftSize = 1 << fftOrder;
            std::array<float, fftSize * 2> data {};
            std::copy_n(input.begin(), fftSize, data.begin());
            juce::dsp::WindowingFunction<float> window(
                fftSize, juce::dsp::WindowingFunction<float>::hann, false);
            window.multiplyWithWindowingTable(data.data(), fftSize);
            juce::dsp::FFT fft(fftOrder);
            fft.performFrequencyOnlyForwardTransform(data.data(), true);
            std::vector<double> result((size_t) fftSize / 2);
            for (int bin = 1; bin < fftSize / 2; ++bin)
                result[(size_t) bin] = data[(size_t) bin];
            return result;
        }

        double spectralResidualRatio(const std::vector<float>& candidate,
                                     const std::vector<float>& reference)
        {
            const auto candidateMagnitude = magnitudeSpectrum(candidate);
            const auto referenceMagnitude = magnitudeSpectrum(reference);
            double residual = 0.0;
            double referenceEnergy = 0.0;
            for (size_t bin = 1; bin < referenceMagnitude.size(); ++bin)
            {
                const double difference = candidateMagnitude[bin] - referenceMagnitude[bin];
                residual += difference * difference;
                referenceEnergy += referenceMagnitude[bin] * referenceMagnitude[bin];
            }
            return referenceEnergy > 0.0 ? residual / referenceEnergy
                                         : std::numeric_limits<double>::infinity();
        }

        double dcMean(const std::vector<float>& samples)
        {
            double sum = 0.0;
            for (int sample = analysisStart; sample < analysisEnd; ++sample)
                sum += samples[(size_t) sample];
            return sum / (double) (analysisEnd - analysisStart);
        }

        double maximumStep(const std::vector<float>& samples)
        {
            double maximum = 0.0;
            for (int sample = analysisStart + 1; sample < analysisEnd; ++sample)
                maximum = std::max(maximum, std::abs(
                    (double) samples[(size_t) sample] - samples[(size_t) (sample - 1)]));
            return maximum;
        }

        juce::String hashSamples(const std::vector<float>& samples)
        {
            return juce::SHA256(samples.data(), samples.size() * sizeof(float)).toHexString();
        }

        bool finiteRender(const Render& render)
        {
            return std::isfinite(render.elapsedUs)
                && render.elapsedUs >= 0.0
                && std::all_of(render.samples.begin(), render.samples.end(), [](float value)
                {
                    return std::isfinite(value);
                });
        }

        void addMetric(juce::Array<juce::var>& rows,
                       const Scenario& scenario,
                       const char* candidateName,
                       const Render& candidate,
                       const Render& reference)
        {
            auto* row = new juce::DynamicObject();
            row->setProperty("sampleRate", scenario.sampleRate);
            row->setProperty("frequencyHz", scenario.frequencyHz);
            row->setProperty("mode1", modeName(scenario.mode1));
            row->setProperty("amount1", scenario.amount1);
            row->setProperty("mode2", scenario.mode2 >= 0 ? juce::String(modeName(scenario.mode2)) : juce::String());
            row->setProperty("amount2", scenario.amount2);
            row->setProperty("candidate", candidateName);
            row->setProperty("spectralResidualRatio", spectralResidualRatio(candidate.samples, reference.samples));
            row->setProperty("spectralResidualDb", juce::Decibels::gainToDecibels(
                std::sqrt(spectralResidualRatio(candidate.samples, reference.samples)), -300.0));
            row->setProperty("dcMean", dcMean(candidate.samples));
            row->setProperty("maximumStep", maximumStep(candidate.samples));
            row->setProperty("elapsedUs", candidate.elapsedUs);
            row->setProperty("nonlinearEvaluations", (juce::int64) candidate.nonlinearEvaluations);
            row->setProperty("sha256", hashSamples(candidate.samples));
            rows.add(juce::var(row));
        }
    }

    bool runAetherRuntimeWarpCorpus(const char* reportPath)
    {
        juce::Array<juce::var> rows;
        bool ok = true;
        int scenarioCount = 0;
        int fourXBetterThanCurrent = 0;
        int twoXIdealBetterThanCurrent = 0;
        double worstCurrent = 0.0;
        double worstIdeal4x = 0.0;

        const auto measure = [&](const Scenario& scenario)
        {
            ++scenarioCount;
            const auto reference = renderIdeal(scenario, referenceFactor);
            const auto ideal1x = renderIdeal(scenario, 1);
            const auto current2x = renderCurrent2x(scenario);
            const auto ideal2x = renderIdeal(scenario, 2);
            const auto ideal4x = renderIdeal(scenario, 4);
            const auto repeated4x = renderIdeal(scenario, 4);

            const double currentResidual = spectralResidualRatio(current2x.samples, reference.samples);
            const double ideal2xResidual = spectralResidualRatio(ideal2x.samples, reference.samples);
            const double ideal4xResidual = spectralResidualRatio(ideal4x.samples, reference.samples);
            worstCurrent = std::max(worstCurrent, currentResidual);
            worstIdeal4x = std::max(worstIdeal4x, ideal4xResidual);
            fourXBetterThanCurrent += ideal4xResidual < currentResidual ? 1 : 0;
            twoXIdealBetterThanCurrent += ideal2xResidual < currentResidual ? 1 : 0;

            ok &= finiteRender(reference) && finiteRender(ideal1x) && finiteRender(current2x)
                && finiteRender(ideal2x) && finiteRender(ideal4x)
                && ideal4x.samples == repeated4x.samples
                && std::isfinite(currentResidual) && std::isfinite(ideal2xResidual)
                && std::isfinite(ideal4xResidual)
                && currentResidual >= 0.0 && ideal2xResidual >= 0.0 && ideal4xResidual >= 0.0;

            addMetric(rows, scenario, "ideal1x", ideal1x, reference);
            addMetric(rows, scenario, "current2x", current2x, reference);
            addMetric(rows, scenario, "ideal2x", ideal2x, reference);
            addMetric(rows, scenario, "ideal4x", ideal4x, reference);
        };

        for (const double rate : { 44100.0, 48000.0, 88200.0, 96000.0, 192000.0 })
        {
            const std::array frequencies {
                1760.0,
                7040.0,
                std::min(16000.0, rate * 0.185),
            };
            for (int mode = 0; mode < 4; ++mode)
                for (const float amount : { 0.5f, 1.0f })
                    for (const double frequency : frequencies)
                        measure({ rate, frequency, mode, amount });

            measure({ rate, frequencies[1], 0, 0.78f, 1, 0.63f });
            measure({ rate, frequencies[1], 1, 0.78f, 3, 0.63f });
            measure({ rate, frequencies[2], 2, 0.78f, 3, 0.63f });
        }

        auto* summary = new juce::DynamicObject();
        summary->setProperty("schema", "beat.aether.runtime-warp-corpus.v1");
        summary->setProperty("reference", "16x test-only continuous-sine render with 127-tap Blackman-windowed sinc decimation");
        summary->setProperty("metric", "phase-insensitive magnitude-spectrum residual energy relative to the 16x reference");
        summary->setProperty("productionDspChanged", false);
        summary->setProperty("scenarioCount", scenarioCount);
        summary->setProperty("rowCount", rows.size());
        summary->setProperty("ideal4xBetterThanCurrentCount", fourXBetterThanCurrent);
        summary->setProperty("ideal2xBetterThanCurrentCount", twoXIdealBetterThanCurrent);
        summary->setProperty("worstCurrent2xResidualRatio", worstCurrent);
        summary->setProperty("worstIdeal4xResidualRatio", worstIdeal4x);
        summary->setProperty("rows", juce::var(rows));

        const juce::String json = juce::JSON::toString(juce::var(summary), true);
        if (reportPath != nullptr && *reportPath != '\0')
        {
            const juce::File output(reportPath);
            ok &= output.getParentDirectory().createDirectory().wasOk();
            ok &= output.replaceWithText(json, false, false, "\n");
        }

        std::cerr << "Aether runtime-warp D1A corpus scenarios=" << scenarioCount
                  << " rows=" << rows.size()
                  << " ideal2xBetter=" << twoXIdealBetterThanCurrent << "/" << scenarioCount
                  << " ideal4xBetter=" << fourXBetterThanCurrent << "/" << scenarioCount
                  << " worstCurrent=" << worstCurrent
                  << " worstIdeal4x=" << worstIdeal4x
                  << " deterministic=" << (ok ? 1 : 0) << "\n";
        return ok;
    }
}

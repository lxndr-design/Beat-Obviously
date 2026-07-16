#include "SpectralAnalyzer.h"

#include <juce_cryptography/juce_cryptography.h>
#include <juce_dsp/juce_dsp.h>
#include <algorithm>
#include <cmath>
#include <complex>
#include <limits>

namespace beat
{
    namespace
    {
        constexpr int order = 10;
        constexpr float transientFluxThreshold = 0.35f;
        constexpr int transientRefractoryFrames = 4;

        float wrapPhase(float phase)
        {
            constexpr float pi = juce::MathConstants<float>::pi;
            constexpr float twoPi = juce::MathConstants<float>::twoPi;
            phase = std::fmod(phase + pi, twoPi);
            if (phase < 0.0f) phase += twoPi;
            return phase - pi;
        }

        std::vector<float> makeWindow()
        {
            std::vector<float> window(SpectralArtifact::fftSize);
            for (int n = 0; n < SpectralArtifact::fftSize; ++n)
            {
                const auto angle = juce::MathConstants<double>::twoPi * (double) n
                    / (double) SpectralArtifact::fftSize;
                window[(size_t) n] = (float) std::sqrt(0.5 - 0.5 * std::cos(angle));
            }
            return window;
        }

        std::string hashPcm(const juce::AudioBuffer<float>& pcm)
        {
            juce::MemoryOutputStream stream;
            for (int channel = 0; channel < pcm.getNumChannels(); ++channel)
                stream.write(pcm.getReadPointer(channel), (size_t) pcm.getNumSamples() * sizeof(float));
            return juce::SHA256(stream.getData(), stream.getDataSize()).toHexString().toStdString();
        }

        size_t spectralIndex(int channel, int frame, int bin, int frames)
        {
            return ((size_t) channel * (size_t) frames + (size_t) frame)
                * (size_t) SpectralArtifact::binCount + (size_t) bin;
        }
    }

    SpectralAnalyzer::Result SpectralAnalyzer::analyze(const juce::AudioBuffer<float>& pcm,
                                                        int rootNote,
                                                        uint32_t seed,
                                                        const std::atomic<bool>* cancel)
    {
        if (pcm.getNumChannels() < 1 || pcm.getNumChannels() > 2
            || pcm.getNumSamples() <= 0 || pcm.getNumSamples() > SpectralArtifact::maxInputSamples)
            return { {}, "spectral.input", "canonical PCM must contain one or two bounded channels" };
        for (int channel = 0; channel < pcm.getNumChannels(); ++channel)
            for (int sample = 0; sample < pcm.getNumSamples(); ++sample)
                if (!std::isfinite(pcm.getSample(channel, sample)))
                    return { {}, "spectral.input-finite", "canonical PCM contains a non-finite sample" };

        constexpr int prefix = SpectralArtifact::fftSize - SpectralArtifact::hopSize;
        const int frames = (pcm.getNumSamples() + SpectralArtifact::hopSize - 1)
            / SpectralArtifact::hopSize + 3;
        if (frames > SpectralArtifact::maxFrames)
            return { {}, "spectral.frame-cap", "analysis would exceed the frame cap" };

        const size_t plane = (size_t) frames * SpectralArtifact::binCount;
        const uint64_t fixedBytes = (uint64_t) plane * (sizeof(float) * 4u + sizeof(uint8_t))
            + (uint64_t) frames * sizeof(uint8_t)
            + (uint64_t) (frames + 1) * sizeof(uint32_t);
        if (fixedBytes > SpectralArtifact::maxPayloadBytes)
            return { {}, "spectral.payload-cap", "fixed spectral planes exceed 48 MiB" };

        SpectralArtifact artifact;
        artifact.sourceSamples = pcm.getNumSamples();
        artifact.frames = frames;
        artifact.rootNote = juce::jlimit(0, 127, rootNote);
        artifact.deterministicSeed = seed;
        artifact.sourcePcmSha256 = hashPcm(pcm);
        artifact.magnitudes.resize(plane * 2u);
        artifact.phaseResiduals.resize(plane * 2u);
        artifact.peakAssignments.resize(plane);
        artifact.transientFrames.resize((size_t) frames);
        artifact.peakOffsets.reserve((size_t) frames + 1u);

        const auto window = makeWindow();
        juce::dsp::FFT fft(order);
        std::vector<float> fftData((size_t) SpectralArtifact::fftSize * 2u);
        std::vector<float> previousPhase((size_t) SpectralArtifact::binCount * 2u, 0.0f);
        std::vector<float> previousReference(SpectralArtifact::binCount, 0.0f);
        std::vector<float> reference(SpectralArtifact::binCount);
        int lastTransient = -transientRefractoryFrames;

        for (int frame = 0; frame < frames; ++frame)
        {
            if (cancel != nullptr && cancel->load(std::memory_order_relaxed))
                return { {}, "spectral.cancelled", "spectral analysis was cancelled before publication" };
            for (int channel = 0; channel < 2; ++channel)
            {
                std::fill(fftData.begin(), fftData.end(), 0.0f);
                const int sourceChannel = std::min(channel, pcm.getNumChannels() - 1);
                const int start = frame * SpectralArtifact::hopSize - prefix;
                for (int n = 0; n < SpectralArtifact::fftSize; ++n)
                {
                    const int sourceIndex = start + n;
                    if (sourceIndex >= 0 && sourceIndex < pcm.getNumSamples())
                    {
                        fftData[(size_t) n] = pcm.getSample(sourceChannel, sourceIndex) * window[(size_t) n];
                        artifact.windowedPcmEnergy += (double) fftData[(size_t) n] * fftData[(size_t) n];
                    }
                }
                fft.performRealOnlyForwardTransform(fftData.data(), true);
                double frameSpectralEnergy = 0.0;
                for (int bin = 0; bin < SpectralArtifact::binCount; ++bin)
                {
                    const float real = fftData[(size_t) bin * 2u];
                    const float imag = (bin == 0 || bin == SpectralArtifact::binCount - 1)
                        ? 0.0f : fftData[(size_t) bin * 2u + 1u];
                    const float phase = std::atan2(imag, real);
                    const float expected = juce::MathConstants<float>::twoPi * (float) bin
                        * (float) SpectralArtifact::hopSize / (float) SpectralArtifact::fftSize;
                    const auto index = spectralIndex(channel, frame, bin, frames);
                    artifact.magnitudes[index] = std::hypot(real, imag);
                    artifact.phaseResiduals[index] = frame == 0
                        ? wrapPhase(phase)
                        : wrapPhase(phase - previousPhase[(size_t) channel * SpectralArtifact::binCount + bin] - expected);
                    previousPhase[(size_t) channel * SpectralArtifact::binCount + bin] = phase;
                    const double binEnergy = (double) real * real + (double) imag * imag;
                    frameSpectralEnergy += (bin == 0 || bin == SpectralArtifact::binCount - 1)
                        ? binEnergy : 2.0 * binEnergy;
                }
                artifact.spectralEnergy += frameSpectralEnergy / SpectralArtifact::fftSize;
            }

            float positiveFlux = 0.0f;
            float referenceSum = 0.0f;
            for (int bin = 0; bin < SpectralArtifact::binCount; ++bin)
            {
                const auto left = artifact.magnitudes[spectralIndex(0, frame, bin, frames)];
                const auto right = artifact.magnitudes[spectralIndex(1, frame, bin, frames)];
                reference[(size_t) bin] = std::sqrt((left * left + right * right) * 0.5f);
                positiveFlux += std::max(0.0f, reference[(size_t) bin] - previousReference[(size_t) bin]);
                referenceSum += reference[(size_t) bin];
            }
            const float normalizedFlux = positiveFlux / std::max(referenceSum, 1.0e-12f);
            const bool transient = frame > 0 && normalizedFlux > transientFluxThreshold
                && frame - lastTransient >= transientRefractoryFrames;
            artifact.transientFrames[(size_t) frame] = transient ? 1u : 0u;
            if (transient) lastTransient = frame;
            previousReference = reference;

            artifact.peakOffsets.push_back((uint32_t) artifact.peakBins.size());
            std::vector<uint16_t> peaks;
            for (int bin = 1; bin + 1 < SpectralArtifact::binCount; ++bin)
                if (reference[(size_t) bin] > reference[(size_t) bin - 1u]
                    && reference[(size_t) bin] >= reference[(size_t) bin + 1u])
                    peaks.push_back((uint16_t) bin);
            if (peaks.empty())
                peaks.push_back((uint16_t) std::distance(reference.begin(),
                    std::max_element(reference.begin(), reference.end())));
            if (peaks.size() > 255u)
                return { {}, "spectral.peak-cap", "a frame exceeds the 255 shared-peak cap" };
            artifact.peakBins.insert(artifact.peakBins.end(), peaks.begin(), peaks.end());
            for (int bin = 0; bin < SpectralArtifact::binCount; ++bin)
            {
                size_t nearest = 0;
                int distance = std::abs(bin - (int) peaks[0]);
                for (size_t peak = 1; peak < peaks.size(); ++peak)
                {
                    const int candidate = std::abs(bin - (int) peaks[peak]);
                    if (candidate < distance) { nearest = peak; distance = candidate; }
                }
                artifact.peakAssignments[(size_t) frame * SpectralArtifact::binCount + bin] = (uint8_t) nearest;
            }
        }
        artifact.peakOffsets.push_back((uint32_t) artifact.peakBins.size());
        if (artifact.payloadBytes() > SpectralArtifact::maxPayloadBytes)
            return { {}, "spectral.payload-cap", "complete spectral artifact exceeds 48 MiB" };
        artifact.payloadSha256 = computeSpectralPayloadSha256(artifact);
        const auto validation = validateSpectralArtifact(artifact);
        if (!validation.ok) return { {}, validation.code, validation.message };
        return { std::move(artifact), {}, {} };
    }

    std::optional<juce::AudioBuffer<float>> SpectralAnalyzer::reconstructForTesting(
        const SpectralArtifact& artifact)
    {
        if (!validateSpectralArtifact(artifact).ok) return std::nullopt;
        constexpr int prefix = SpectralArtifact::fftSize - SpectralArtifact::hopSize;
        const int paddedSamples = artifact.frames * SpectralArtifact::hopSize + SpectralArtifact::fftSize;
        juce::AudioBuffer<float> padded(2, paddedSamples);
        padded.clear();
        const auto window = makeWindow();
        juce::dsp::FFT fft(order);
        std::vector<float> fftData((size_t) SpectralArtifact::fftSize * 2u);
        std::vector<double> phase((size_t) SpectralArtifact::binCount * 2u, 0.0);

        for (int frame = 0; frame < artifact.frames; ++frame)
            for (int channel = 0; channel < 2; ++channel)
            {
                std::fill(fftData.begin(), fftData.end(), 0.0f);
                for (int bin = 0; bin < SpectralArtifact::binCount; ++bin)
                {
                    const auto index = spectralIndex(channel, frame, bin, artifact.frames);
                    const double expected = juce::MathConstants<double>::twoPi * (double) bin
                        * (double) SpectralArtifact::hopSize / (double) SpectralArtifact::fftSize;
                    auto& theta = phase[(size_t) channel * SpectralArtifact::binCount + bin];
                    theta = frame == 0 ? artifact.phaseResiduals[index]
                                       : theta + expected + artifact.phaseResiduals[index];
                    fftData[(size_t) bin * 2u] = artifact.magnitudes[index] * (float) std::cos(theta);
                    if (bin != 0 && bin != SpectralArtifact::binCount - 1)
                        fftData[(size_t) bin * 2u + 1u] = artifact.magnitudes[index] * (float) std::sin(theta);
                }
                fft.performRealOnlyInverseTransform(fftData.data());
                const int outputStart = frame * SpectralArtifact::hopSize;
                for (int n = 0; n < SpectralArtifact::fftSize; ++n)
                    padded.addSample(channel, outputStart + n, fftData[(size_t) n] * window[(size_t) n] * 0.5f);
            }

        juce::AudioBuffer<float> output(2, artifact.sourceSamples);
        for (int channel = 0; channel < 2; ++channel)
            output.copyFrom(channel, 0, padded, channel, prefix, artifact.sourceSamples);
        return output;
    }

    double SpectralAnalyzer::measureRawWolaErrorDbForTesting(const juce::AudioBuffer<float>& pcm)
    {
        if (pcm.getNumChannels() < 1 || pcm.getNumChannels() > 2 || pcm.getNumSamples() <= 0)
            return std::numeric_limits<double>::infinity();
        constexpr int prefix = SpectralArtifact::fftSize - SpectralArtifact::hopSize;
        const int frames = (pcm.getNumSamples() + SpectralArtifact::hopSize - 1)
            / SpectralArtifact::hopSize + 3;
        const int paddedSamples = frames * SpectralArtifact::hopSize + SpectralArtifact::fftSize;
        juce::AudioBuffer<float> reconstructed(2, paddedSamples);
        reconstructed.clear();
        const auto window = makeWindow();
        juce::dsp::FFT fft(order);
        std::vector<float> fftData((size_t) SpectralArtifact::fftSize * 2u);

        for (int frame = 0; frame < frames; ++frame)
            for (int channel = 0; channel < 2; ++channel)
            {
                std::fill(fftData.begin(), fftData.end(), 0.0f);
                const int sourceChannel = std::min(channel, pcm.getNumChannels() - 1);
                const int start = frame * SpectralArtifact::hopSize - prefix;
                for (int n = 0; n < SpectralArtifact::fftSize; ++n)
                {
                    const int sourceIndex = start + n;
                    if (sourceIndex >= 0 && sourceIndex < pcm.getNumSamples())
                        fftData[(size_t) n] = pcm.getSample(sourceChannel, sourceIndex) * window[(size_t) n];
                }
                fft.performRealOnlyForwardTransform(fftData.data(), true);
                fft.performRealOnlyInverseTransform(fftData.data());
                const int outputStart = frame * SpectralArtifact::hopSize;
                for (int n = 0; n < SpectralArtifact::fftSize; ++n)
                    reconstructed.addSample(channel, outputStart + n,
                        fftData[(size_t) n] * window[(size_t) n] * 0.5f);
            }

        double error = 0.0;
        double energy = 0.0;
        for (int channel = 0; channel < 2; ++channel)
        {
            const int sourceChannel = std::min(channel, pcm.getNumChannels() - 1);
            for (int i = 0; i < pcm.getNumSamples(); ++i)
            {
                const double original = pcm.getSample(sourceChannel, i);
                const double delta = original - reconstructed.getSample(channel, prefix + i);
                error += delta * delta;
                energy += original * original;
            }
        }
        return 10.0 * std::log10(error / std::max(energy, 1.0e-30));
    }
}

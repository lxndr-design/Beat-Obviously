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

        double wrapPhase(double phase)
        {
            constexpr double pi = juce::MathConstants<double>::pi;
            constexpr double twoPi = juce::MathConstants<double>::twoPi;
            phase = std::fmod(phase + pi, twoPi);
            if (phase < 0.0) phase += twoPi;
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

        std::vector<uint16_t> detectPeaks(const std::vector<float>& reference)
        {
            std::vector<uint16_t> peaks;
            for (int bin = 1; bin + 1 < (int) reference.size(); ++bin)
                if (reference[(size_t) bin] > reference[(size_t) bin - 1u]
                    && reference[(size_t) bin] >= reference[(size_t) bin + 1u])
                    peaks.push_back((uint16_t) bin);
            if (peaks.empty() && !reference.empty())
                peaks.push_back((uint16_t) std::distance(reference.begin(),
                    std::max_element(reference.begin(), reference.end())));
            return peaks;
        }

        uint8_t assignPeak(int bin, const std::vector<uint16_t>& peaks)
        {
            if (peaks.empty()) return 0;
            size_t nearest = 0;
            int distance = std::abs(bin - (int) peaks[0]);
            for (size_t peak = 1; peak < peaks.size(); ++peak)
            {
                const int candidate = std::abs(bin - (int) peaks[peak]);
                if (candidate < distance) { nearest = peak; distance = candidate; }
            }
            return (uint8_t) nearest;
        }

        std::vector<uint16_t> matchPeaks(const std::vector<uint16_t>& previous,
                                         const std::vector<uint16_t>& current)
        {
            std::vector<uint8_t> previousUsed(previous.size(), 0u);
            std::vector<uint16_t> predecessors(current.size(), SpectralArtifact::noPreviousPeak);
            for (size_t currentIndex = 0; currentIndex < current.size(); ++currentIndex)
            {
                int bestDistance = 5;
                uint16_t best = SpectralArtifact::noPreviousPeak;
                for (size_t prior = 0; prior < previous.size(); ++prior)
                {
                    if (previousUsed[prior] != 0u) continue;
                    const int distance = std::abs((int) current[currentIndex] - (int) previous[prior]);
                    if (distance < bestDistance)
                    {
                        bestDistance = distance;
                        best = (uint16_t) prior;
                    }
                }
                if (best != SpectralArtifact::noPreviousPeak)
                {
                    predecessors[currentIndex] = best;
                    previousUsed[best] = 1u;
                }
            }
            return predecessors;
        }
    }

    std::vector<uint16_t> SpectralAnalyzer::detectSharedPeaksForTesting(
        const std::vector<float>& reference) { return detectPeaks(reference); }

    uint8_t SpectralAnalyzer::assignPeakForTesting(int bin, const std::vector<uint16_t>& peaks)
    { return assignPeak(bin, peaks); }

    std::vector<uint16_t> SpectralAnalyzer::matchPeakPredecessorsForTesting(
        const std::vector<uint16_t>& previous, const std::vector<uint16_t>& current)
    { return matchPeaks(previous, current); }

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
        artifact.relativePhases.resize(plane * 2u);
        artifact.peakAssignments.resize(plane);
        artifact.transientFrames.resize((size_t) frames);
        artifact.peakOffsets.reserve((size_t) frames + 1u);

        const auto window = makeWindow();
        juce::dsp::FFT fft(order);
        std::vector<float> fftData((size_t) SpectralArtifact::fftSize * 2u);
        std::vector<float> rawPhases(plane * 2u, 0.0f);
        std::vector<float> previousReference(SpectralArtifact::binCount, 0.0f);
        std::vector<float> reference(SpectralArtifact::binCount);
        std::vector<double> peakAbsoluteL;
        std::vector<double> peakAbsoluteR;
        std::vector<double> peakEvolutionL;
        std::vector<double> peakEvolutionR;
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
                    const auto index = spectralIndex(channel, frame, bin, frames);
                    artifact.magnitudes[index] = std::hypot(real, imag);
                    rawPhases[index] = phase;
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
            std::vector<uint16_t> peaks = detectPeaks(reference);
            if (peaks.size() > 255u)
                return { {}, "spectral.peak-cap", "a frame exceeds the 255 shared-peak cap" };
            const uint32_t previousBegin = frame == 0 ? 0u : artifact.peakOffsets[(size_t) frame - 1u];
            const uint32_t previousEnd = frame == 0 ? 0u : artifact.peakOffsets[(size_t) frame];
            std::vector<uint16_t> priorPeaks;
            priorPeaks.insert(priorPeaks.end(), artifact.peakBins.begin() + previousBegin,
                artifact.peakBins.begin() + previousEnd);
            std::vector<uint16_t> predecessors = matchPeaks(priorPeaks, peaks);
            const uint32_t currentBegin = (uint32_t) artifact.peakBins.size();
            artifact.peakBins.insert(artifact.peakBins.end(), peaks.begin(), peaks.end());
            artifact.peakPreviousIndices.insert(artifact.peakPreviousIndices.end(),
                predecessors.begin(), predecessors.end());
            for (size_t peak = 0; peak < peaks.size(); ++peak)
            {
                for (int channel = 0; channel < 2; ++channel)
                {
                    const double absolute = rawPhases[spectralIndex(channel, frame, peaks[peak], frames)];
                    double evolution = wrapPhase(absolute);
                    if (predecessors[peak] != SpectralArtifact::noPreviousPeak)
                    {
                        const size_t priorGlobal = (size_t) previousBegin + predecessors[peak];
                        const double priorAbsolute = channel == 0
                            ? peakAbsoluteL[priorGlobal] : peakAbsoluteR[priorGlobal];
                        const double expected = juce::MathConstants<double>::twoPi * (double) peaks[peak]
                            * (double) SpectralArtifact::hopSize / (double) SpectralArtifact::fftSize;
                        evolution = wrapPhase(absolute - priorAbsolute - expected);
                    }
                    if (channel == 0)
                    {
                        peakAbsoluteL.push_back(absolute);
                        peakEvolutionL.push_back(evolution);
                    }
                    else
                    {
                        peakAbsoluteR.push_back(absolute);
                        peakEvolutionR.push_back(evolution);
                    }
                }
            }
            for (int bin = 0; bin < SpectralArtifact::binCount; ++bin)
            {
                const size_t nearest = assignPeak(bin, peaks);
                artifact.peakAssignments[(size_t) frame * SpectralArtifact::binCount + bin] = (uint8_t) nearest;
                for (int channel = 0; channel < 2; ++channel)
                {
                    const double binPhase = rawPhases[spectralIndex(channel, frame, bin, frames)];
                    const size_t peakGlobal = (size_t) currentBegin + nearest;
                    const double peakPhase = channel == 0
                        ? peakAbsoluteL[peakGlobal] : peakAbsoluteR[peakGlobal];
                    artifact.relativePhases[spectralIndex(channel, frame, bin, frames)]
                        = (float) wrapPhase(binPhase - peakPhase);
                }
            }
        }
        artifact.peakOffsets.push_back((uint32_t) artifact.peakBins.size());
        artifact.peakPhaseEvolution = peakEvolutionL;
        artifact.peakPhaseEvolution.insert(artifact.peakPhaseEvolution.end(),
            peakEvolutionR.begin(), peakEvolutionR.end());
        if (artifact.serializedBytes() > SpectralArtifact::maxPayloadBytes)
            return { {}, "spectral.payload-cap", "complete spectral artifact exceeds 48 MiB" };
        artifact.payloadSha256 = computeSpectralPayloadSha256(artifact);
        const auto validation = validateSpectralArtifact(artifact);
        if (!validation.ok) return { {}, validation.code, validation.message };
        return { std::move(artifact), {}, {} };
    }

    std::optional<juce::AudioBuffer<float>> SpectralAnalyzer::reconstructForTesting(
        const SpectralArtifact& artifact,
        ReconstructionRepresentation representation)
    {
        if (!validateSpectralArtifact(artifact).ok) return std::nullopt;
        constexpr int prefix = SpectralArtifact::fftSize - SpectralArtifact::hopSize;
        const int paddedSamples = artifact.frames * SpectralArtifact::hopSize + SpectralArtifact::fftSize;
        juce::AudioBuffer<float> padded(2, paddedSamples);
        padded.clear();
        const auto window = makeWindow();
        juce::dsp::FFT fft(order);
        std::vector<float> fftData((size_t) SpectralArtifact::fftSize * 2u);
        const size_t plane = (size_t) artifact.frames * artifact.bins;
        std::vector<double> targetPhase(plane * 2u, 0.0);
        std::vector<double> peakAbsolute(artifact.peakBins.size() * 2u, 0.0);
        for (int frame = 0; frame < artifact.frames; ++frame)
        {
            const uint32_t begin = artifact.peakOffsets[(size_t) frame];
            const uint32_t end = artifact.peakOffsets[(size_t) frame + 1u];
            const uint32_t previousBegin = frame == 0 ? 0u : artifact.peakOffsets[(size_t) frame - 1u];
            for (uint32_t peak = begin; peak < end; ++peak)
                for (int channel = 0; channel < 2; ++channel)
                {
                    const double evolution = artifact.peakPhaseEvolution[
                        (size_t) channel * artifact.peakBins.size() + peak];
                    double absolute = evolution;
                    const auto predecessor = artifact.peakPreviousIndices[peak];
                    if (predecessor != SpectralArtifact::noPreviousPeak)
                    {
                        const size_t priorGlobal = (size_t) previousBegin + predecessor;
                        const double expected = juce::MathConstants<double>::twoPi
                            * (double) artifact.peakBins[peak] * (double) SpectralArtifact::hopSize
                            / (double) SpectralArtifact::fftSize;
                        absolute = peakAbsolute[(size_t) channel * artifact.peakBins.size() + priorGlobal]
                            + expected + evolution;
                    }
                    peakAbsolute[(size_t) channel * artifact.peakBins.size() + peak] = absolute;
                }
            for (int bin = 0; bin < artifact.bins; ++bin)
            {
                const size_t peak = (size_t) begin
                    + artifact.peakAssignments[(size_t) frame * artifact.bins + bin];
                for (int channel = 0; channel < 2; ++channel)
                    targetPhase[spectralIndex(channel, frame, bin, artifact.frames)]
                        = peakAbsolute[(size_t) channel * artifact.peakBins.size() + peak]
                        + artifact.relativePhases[spectralIndex(channel, frame, bin, artifact.frames)];
            }
        }

        std::vector<double> synthesizedPhase(targetPhase.size(), 0.0);
        if (representation == ReconstructionRepresentation::peakPhaseV2)
        {
            synthesizedPhase = targetPhase;
        }
        else
        {
            for (int channel = 0; channel < 2; ++channel)
                for (int bin = 0; bin < artifact.bins; ++bin)
                {
                    double theta = 0.0;
                    double previousTarget = 0.0;
                    for (int frame = 0; frame < artifact.frames; ++frame)
                    {
                        const size_t index = spectralIndex(channel, frame, bin, artifact.frames);
                        const double target = targetPhase[index];
                        if (frame == 0)
                        {
                            theta = representation == ReconstructionRepresentation::float32AllBinResiduals
                                ? (double) (float) wrapPhase(target) : wrapPhase(target);
                        }
                        else
                        {
                            const double expected = juce::MathConstants<double>::twoPi * (double) bin
                                * (double) SpectralArtifact::hopSize / (double) SpectralArtifact::fftSize;
                            double residual = wrapPhase(target - previousTarget - expected);
                            if (representation == ReconstructionRepresentation::float32AllBinResiduals)
                                residual = (double) (float) residual;
                            theta += expected + residual;
                        }
                        synthesizedPhase[index] = theta;
                        previousTarget = target;
                    }
                }
        }

        for (int frame = 0; frame < artifact.frames; ++frame)
            for (int channel = 0; channel < 2; ++channel)
            {
                std::fill(fftData.begin(), fftData.end(), 0.0f);
                for (int bin = 0; bin < SpectralArtifact::binCount; ++bin)
                {
                    const auto index = spectralIndex(channel, frame, bin, artifact.frames);
                    const double theta = synthesizedPhase[index];
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

    SpectralAnalyzer::ReconstructionMetrics SpectralAnalyzer::measureReconstructionForTesting(
        const juce::AudioBuffer<float>& original,
        const juce::AudioBuffer<float>& reconstructed)
    {
        ReconstructionMetrics metrics;
        if (original.getNumSamples() != reconstructed.getNumSamples()
            || original.getNumChannels() < 1 || reconstructed.getNumChannels() < 1)
        {
            metrics.rmsError = metrics.peakError = metrics.errorDb
                = std::numeric_limits<double>::infinity();
            return metrics;
        }
        double squaredError = 0.0;
        double energy = 0.0;
        uint64_t count = 0;
        for (int channel = 0; channel < 2; ++channel)
        {
            const int originalChannel = std::min(channel, original.getNumChannels() - 1);
            const int reconstructedChannel = std::min(channel, reconstructed.getNumChannels() - 1);
            for (int sample = 0; sample < original.getNumSamples(); ++sample)
            {
                const double value = original.getSample(originalChannel, sample);
                const double error = value - reconstructed.getSample(reconstructedChannel, sample);
                squaredError += error * error;
                energy += value * value;
                metrics.peakError = std::max(metrics.peakError, std::abs(error));
                ++count;
            }
        }
        metrics.rmsError = std::sqrt(squaredError / std::max<uint64_t>(count, 1u));
        metrics.errorDb = 10.0 * std::log10(squaredError / std::max(energy, 1.0e-30));
        return metrics;
    }

    std::optional<SpectralAnalyzer::RepresentationComparison>
    SpectralAnalyzer::compareRepresentationsForTesting(const juce::AudioBuffer<float>& pcm)
    {
        const auto analysis = analyze(pcm);
        if (!analysis.artifact) return std::nullopt;
        RepresentationComparison result;
        const auto v2 = reconstructForTesting(*analysis.artifact,
            ReconstructionRepresentation::peakPhaseV2);
        if (!v2) return std::nullopt;
        result.peakPhaseV2 = measureReconstructionForTesting(pcm, *v2);

        const auto& artifact = *analysis.artifact;
        constexpr int prefix = SpectralArtifact::fftSize - SpectralArtifact::hopSize;
        const auto window = makeWindow();
        juce::dsp::FFT fft(order);
        std::vector<float> fftData((size_t) SpectralArtifact::fftSize * 2u);
        const size_t plane = (size_t) artifact.frames * artifact.bins;
        std::vector<double> rawPhase(plane * 2u, 0.0);
        for (int frame = 0; frame < artifact.frames; ++frame)
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
                for (int bin = 0; bin < artifact.bins; ++bin)
                {
                    const float real = fftData[(size_t) bin * 2u];
                    const float imag = (bin == 0 || bin == artifact.bins - 1)
                        ? 0.0f : fftData[(size_t) bin * 2u + 1u];
                    rawPhase[spectralIndex(channel, frame, bin, artifact.frames)] = std::atan2(imag, real);
                }
            }

        auto reconstructAllBin = [&](bool float32Residuals)
        {
            std::vector<double> phase(rawPhase.size(), 0.0);
            for (int channel = 0; channel < 2; ++channel)
                for (int bin = 0; bin < artifact.bins; ++bin)
                {
                    double theta = 0.0;
                    double previousRaw = 0.0;
                    for (int frame = 0; frame < artifact.frames; ++frame)
                    {
                        const size_t index = spectralIndex(channel, frame, bin, artifact.frames);
                        const double raw = rawPhase[index];
                        if (frame == 0)
                            theta = float32Residuals ? (double) (float) wrapPhase(raw) : wrapPhase(raw);
                        else
                        {
                            const double expected = juce::MathConstants<double>::twoPi * (double) bin
                                * (double) SpectralArtifact::hopSize / (double) SpectralArtifact::fftSize;
                            double residual = wrapPhase(raw - previousRaw - expected);
                            if (float32Residuals) residual = (double) (float) residual;
                            theta += expected + residual;
                        }
                        phase[index] = theta;
                        previousRaw = raw;
                    }
                }
            const int paddedSamples = artifact.frames * SpectralArtifact::hopSize + SpectralArtifact::fftSize;
            juce::AudioBuffer<float> padded(2, paddedSamples);
            padded.clear();
            for (int frame = 0; frame < artifact.frames; ++frame)
                for (int channel = 0; channel < 2; ++channel)
                {
                    std::fill(fftData.begin(), fftData.end(), 0.0f);
                    for (int bin = 0; bin < artifact.bins; ++bin)
                    {
                        const size_t index = spectralIndex(channel, frame, bin, artifact.frames);
                        fftData[(size_t) bin * 2u] = artifact.magnitudes[index] * (float) std::cos(phase[index]);
                        if (bin != 0 && bin != artifact.bins - 1)
                            fftData[(size_t) bin * 2u + 1u] = artifact.magnitudes[index] * (float) std::sin(phase[index]);
                    }
                    fft.performRealOnlyInverseTransform(fftData.data());
                    for (int n = 0; n < SpectralArtifact::fftSize; ++n)
                        padded.addSample(channel, frame * SpectralArtifact::hopSize + n,
                            fftData[(size_t) n] * window[(size_t) n] * 0.5f);
                }
            juce::AudioBuffer<float> output(2, artifact.sourceSamples);
            for (int channel = 0; channel < 2; ++channel)
                output.copyFrom(channel, 0, padded, channel, prefix, artifact.sourceSamples);
            return output;
        };
        const auto float32Output = reconstructAllBin(true);
        const auto float64Output = reconstructAllBin(false);
        result.float32AllBinResiduals = measureReconstructionForTesting(pcm, float32Output);
        result.float64AllBinResiduals = measureReconstructionForTesting(pcm, float64Output);
        return result;
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

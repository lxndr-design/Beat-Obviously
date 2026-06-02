#include "FftAnalyzer.h"

#include <algorithm>
#include <cmath>

namespace beat
{
    namespace
    {
        float magnitudeTo01(float magnitude)
        {
            const auto db = juce::Decibels::gainToDecibels(magnitude, -90.0f);
            return juce::jlimit(0.0f, 1.0f, (db + 90.0f) / 90.0f);
        }
    }

    FftAnalyzer::FftAnalyzer()
    {
        rebuildBands();
    }

    void FftAnalyzer::prepare(double newSampleRate)
    {
        sampleRate = newSampleRate > 0.0 ? newSampleRate : 44100.0;
        rebuildBands();
        reset();
    }

    void FftAnalyzer::reset()
    {
        fifo.fill(0.0f);
        fftData.fill(0.0f);
        fifoIndex = 0;
        nextSequence = 1;

        const juce::SpinLock::ScopedLockType lock(snapshotLock);
        latestSnapshot = {};
        latestSequence.store(0, std::memory_order_release);
    }

    void FftAnalyzer::process(const juce::AudioBuffer<float>& buffer) noexcept
    {
        const int channels = buffer.getNumChannels();
        const int samples = buffer.getNumSamples();
        if (channels <= 0 || samples <= 0)
            return;

        double sumSquares = 0.0;
        float peak = 0.0f;

        for (int i = 0; i < samples; ++i)
        {
            float mono = 0.0f;
            for (int ch = 0; ch < channels; ++ch)
                mono += buffer.getSample(ch, i);

            mono /= (float) channels;
            sumSquares += (double) mono * (double) mono;
            peak = std::max(peak, std::abs(mono));
            pushSample(mono);
        }

        const auto rms = (float) std::sqrt(sumSquares / (double) samples);
        if (fifoIndex == 0)
            publishFrame(rms, peak);
    }

    bool FftAnalyzer::pullSnapshot(Snapshot& out) const noexcept
    {
        const juce::SpinLock::ScopedTryLockType lock(snapshotLock);
        if (!lock.isLocked())
            return false;

        if (latestSequence.load(std::memory_order_acquire) == 0)
            return false;

        out = latestSnapshot;
        return true;
    }

    void FftAnalyzer::pushSample(float sample) noexcept
    {
        fifo[(size_t) fifoIndex++] = sample;
        if (fifoIndex >= fftSize)
            fifoIndex = 0;
    }

    void FftAnalyzer::publishFrame(float blockRms, float blockPeak) noexcept
    {
        std::copy(fifo.begin(), fifo.end(), fftData.begin());
        std::fill(fftData.begin() + fftSize, fftData.end(), 0.0f);

        window.multiplyWithWindowingTable(fftData.data(), fftSize);
        fft.performFrequencyOnlyForwardTransform(fftData.data(), true);

        Snapshot next;
        next.rms = blockRms;
        next.peak = blockPeak;
        next.sequence = nextSequence++;

        for (int band = 0; band < bandCount; ++band)
        {
            float sum = 0.0f;
            int count = 0;
            const int start = bandStartBins[(size_t) band];
            const int end = bandEndBins[(size_t) band];
            for (int bin = start; bin <= end; ++bin)
            {
                sum += fftData[(size_t) bin] / (float) fftSize;
                ++count;
            }
            next.spectrum[(size_t) band] = magnitudeTo01(count > 0 ? sum / (float) count : 0.0f);
        }

        const juce::SpinLock::ScopedTryLockType lock(snapshotLock);
        if (!lock.isLocked())
            return;

        latestSnapshot = next;
        latestSequence.store(next.sequence, std::memory_order_release);
    }

    void FftAnalyzer::rebuildBands()
    {
        constexpr double minHz = 30.0;
        const double maxHz = std::min(20000.0, sampleRate * 0.5);
        const int nyquistBin = fftSize / 2;

        for (int band = 0; band < bandCount; ++band)
        {
            const double startNorm = (double) band / (double) bandCount;
            const double endNorm = (double) (band + 1) / (double) bandCount;
            const double startHz = minHz * std::pow(maxHz / minHz, startNorm);
            const double endHz = minHz * std::pow(maxHz / minHz, endNorm);
            const int startBin = juce::jlimit(1, nyquistBin, (int) std::floor(startHz * fftSize / sampleRate));
            const int endBin = juce::jlimit(startBin, nyquistBin, (int) std::ceil(endHz * fftSize / sampleRate));
            bandStartBins[(size_t) band] = startBin;
            bandEndBins[(size_t) band] = endBin;
        }
    }
}

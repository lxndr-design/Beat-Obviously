#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>
#include <array>
#include <atomic>

namespace beat
{
    class FftAnalyzer
    {
    public:
        static constexpr int fftOrder = 11;
        static constexpr int fftSize = 1 << fftOrder;
        static constexpr int bandCount = 32;

        struct Snapshot
        {
            float rms { 0.0f };
            float peak { 0.0f };
            std::array<float, bandCount> spectrum {};
            uint64_t sequence { 0 };
        };

        FftAnalyzer();

        void prepare(double newSampleRate);
        void reset();
        void process(const juce::AudioBuffer<float>& buffer) noexcept;
        bool pullSnapshot(Snapshot& out) const noexcept;

    private:
        void pushSample(float sample) noexcept;
        void publishFrame(float blockRms, float blockPeak) noexcept;
        void rebuildBands();

        double sampleRate { 44100.0 };
        juce::dsp::FFT fft { fftOrder };
        juce::dsp::WindowingFunction<float> window {
            fftSize,
            juce::dsp::WindowingFunction<float>::hann,
            false
        };

        std::array<float, fftSize> fifo {};
        std::array<float, fftSize * 2> fftData {};
        std::array<int, bandCount> bandStartBins {};
        std::array<int, bandCount> bandEndBins {};

        int fifoIndex { 0 };
        uint64_t nextSequence { 1 };

        mutable juce::SpinLock snapshotLock;
        Snapshot latestSnapshot;
        std::atomic<uint64_t> latestSequence { 0 };
    };
}

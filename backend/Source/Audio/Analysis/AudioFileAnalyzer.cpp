#include "AudioFileAnalyzer.h"

#include <array>
#include <cmath>
#include <vector>

namespace beat
{
    namespace
    {
        struct BiquadCoefficients
        {
            double b0 { 1.0 };
            double b1 { 0.0 };
            double b2 { 0.0 };
            double a1 { 0.0 };
            double a2 { 0.0 };
        };

        BiquadCoefficients makeBiquad(const juce::String& type,
                                      double sampleRate,
                                      double frequency,
                                      double q,
                                      double gainDb = 0.0)
        {
            const auto omega = juce::MathConstants<double>::twoPi * frequency / sampleRate;
            const auto sinOmega = std::sin(omega);
            const auto cosOmega = std::cos(omega);

            if (type == "highpass")
            {
                const auto alpha = sinOmega / (2.0 * q);
                const auto a0 = 1.0 + alpha;
                return {
                    ((1.0 + cosOmega) * 0.5) / a0,
                    (-(1.0 + cosOmega)) / a0,
                    ((1.0 + cosOmega) * 0.5) / a0,
                    (-2.0 * cosOmega) / a0,
                    (1.0 - alpha) / a0
                };
            }

            const auto a = std::pow(10.0, gainDb / 40.0);
            const auto alpha = sinOmega / (2.0 * q);
            const auto sqrtA = std::sqrt(a);
            const auto a0 = (a + 1.0) - (a - 1.0) * cosOmega + 2.0 * sqrtA * alpha;
            return {
                (a * ((a + 1.0) + (a - 1.0) * cosOmega + 2.0 * sqrtA * alpha)) / a0,
                (-2.0 * a * ((a - 1.0) + (a + 1.0) * cosOmega)) / a0,
                (a * ((a + 1.0) + (a - 1.0) * cosOmega - 2.0 * sqrtA * alpha)) / a0,
                (2.0 * ((a - 1.0) - (a + 1.0) * cosOmega)) / a0,
                ((a + 1.0) - (a - 1.0) * cosOmega - 2.0 * sqrtA * alpha) / a0
            };
        }

        std::vector<float> applyBiquad(const float* input, int sampleCount, const BiquadCoefficients& c)
        {
            std::vector<float> output((size_t) juce::jmax(0, sampleCount), 0.0f);
            double x1 = 0.0;
            double x2 = 0.0;
            double y1 = 0.0;
            double y2 = 0.0;

            for (int i = 0; i < sampleCount; ++i)
            {
                const auto x0 = static_cast<double>(input[i]);
                const auto y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
                output[(size_t) i] = static_cast<float>(y0);
                x2 = x1;
                x1 = x0;
                y2 = y1;
                y1 = y0;
            }

            return output;
        }

        double meanSquareForBlock(const std::vector<std::vector<float>>& channels, int start, int end)
        {
            const auto safeEnd = juce::jmax(start + 1, end);
            double sumSquares = 0.0;

            for (const auto& channel : channels)
            {
                for (int i = start; i < safeEnd; ++i)
                {
                    const auto value = (i < (int) channel.size()) ? (double) channel[(size_t) i] : 0.0;
                    sumSquares += value * value;
                }
            }

            return sumSquares / (double) juce::jmax(1, safeEnd - start);
        }

        float loudnessFromMeanSquare(double meanSquare) noexcept
        {
            if (!std::isfinite(meanSquare) || meanSquare <= 0.0)
                return -std::numeric_limits<float>::infinity();
            return static_cast<float>(-0.691 + 10.0 * std::log10(meanSquare));
        }

        double average(const std::vector<double>& values)
        {
            if (values.empty()) return 0.0;
            double sum = 0.0;
            for (const auto value : values)
                sum += value;
            return sum / (double) values.size();
        }

        float amplitudeToDbValue(float amplitude) noexcept
        {
            if (!std::isfinite(amplitude) || amplitude <= 0.0f)
                return -std::numeric_limits<float>::infinity();
            return juce::jmax(-120.0f, 20.0f * std::log10(amplitude));
        }

        float calculateIntegratedLufs(const juce::AudioBuffer<float>& buffer, double sampleRate)
        {
            if (sampleRate <= 0.0 || buffer.getNumSamples() <= 0)
                return -std::numeric_limits<float>::infinity();

            const auto shelf = makeBiquad("highshelf", sampleRate, 1681.9744509555319, 0.7071752369554196, 3.999843853973347);
            const auto highpass = makeBiquad("highpass", sampleRate, 38.13547087602444, 0.5003270373238773);

            std::vector<std::vector<float>> weightedChannels;
            const auto channels = juce::jmin(2, buffer.getNumChannels());
            for (int channel = 0; channel < channels; ++channel)
            {
                auto weighted = applyBiquad(buffer.getReadPointer(channel), buffer.getNumSamples(), shelf);
                weighted = applyBiquad(weighted.data(), (int) weighted.size(), highpass);
                weightedChannels.push_back(std::move(weighted));
            }

            if (weightedChannels.empty())
                return -std::numeric_limits<float>::infinity();

            const auto blockSize = juce::jmax(1, (int) std::round(sampleRate * 0.4));
            const auto hopSize = juce::jmax(1, (int) std::round(sampleRate * 0.1));
            if (buffer.getNumSamples() < blockSize)
                return loudnessFromMeanSquare(meanSquareForBlock(weightedChannels, 0, buffer.getNumSamples()));

            std::vector<double> absoluteGatedPowers;
            for (int start = 0; start + blockSize <= buffer.getNumSamples(); start += hopSize)
            {
                const auto meanSquare = meanSquareForBlock(weightedChannels, start, start + blockSize);
                if (loudnessFromMeanSquare(meanSquare) >= -70.0f)
                    absoluteGatedPowers.push_back(meanSquare);
            }

            if (absoluteGatedPowers.empty())
                return -std::numeric_limits<float>::infinity();

            const auto ungatedMean = average(absoluteGatedPowers);
            const auto relativeGate = loudnessFromMeanSquare(ungatedMean) - 10.0f;

            std::vector<double> gatedPowers;
            for (const auto power : absoluteGatedPowers)
                if (loudnessFromMeanSquare(power) >= relativeGate)
                    gatedPowers.push_back(power);

            return gatedPowers.empty()
                ? -std::numeric_limits<float>::infinity()
                : loudnessFromMeanSquare(average(gatedPowers));
        }

        float catmullRom(float y0, float y1, float y2, float y3, float t) noexcept
        {
            const auto t2 = t * t;
            const auto t3 = t2 * t;
            return 0.5f * ((2.0f * y1)
                + (-y0 + y2) * t
                + (2.0f * y0 - 5.0f * y1 + 4.0f * y2 - y3) * t2
                + (-y0 + 3.0f * y1 - 3.0f * y2 + y3) * t3);
        }

        float estimateTruePeak(const juce::AudioBuffer<float>& buffer)
        {
            float truePeak = 0.0f;
            for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
            {
                const auto* data = buffer.getReadPointer(channel);
                for (int i = 0; i < buffer.getNumSamples(); ++i)
                    truePeak = juce::jmax(truePeak, std::abs(data[i]));

                for (int i = 0; i < buffer.getNumSamples() - 1; ++i)
                {
                    const auto y0 = data[juce::jmax(0, i - 1)];
                    const auto y1 = data[i];
                    const auto y2 = data[i + 1];
                    const auto y3 = data[juce::jmin(buffer.getNumSamples() - 1, i + 2)];
                    for (int step = 1; step < 4; ++step)
                        truePeak = juce::jmax(truePeak, std::abs(catmullRom(y0, y1, y2, y3, (float) step / 4.0f)));
                }
            }
            return truePeak;
        }

        struct StreamingBiquad
        {
            BiquadCoefficients coefficients;
            double x1 { 0.0 };
            double x2 { 0.0 };
            double y1 { 0.0 };
            double y2 { 0.0 };

            float process(float input) noexcept
            {
                const auto x0 = static_cast<double>(input);
                const auto y0 = coefficients.b0 * x0
                    + coefficients.b1 * x1
                    + coefficients.b2 * x2
                    - coefficients.a1 * y1
                    - coefficients.a2 * y2;
                x2 = x1;
                x1 = x0;
                y2 = y1;
                y1 = y0;
                return static_cast<float>(y0);
            }
        };

        struct StreamingTruePeak
        {
            std::vector<float> window;
            int64_t sampleCount { 0 };
            float peak { 0.0f };

            void push(float sample)
            {
                peak = juce::jmax(peak, std::abs(sample));
                window.push_back(sample);
                ++sampleCount;

                if (sampleCount == 3 && window.size() == 3)
                    processSegment(window[0], window[0], window[1], window[2]);

                if (window.size() >= 4)
                {
                    processSegment(window[0], window[1], window[2], window[3]);
                    window.erase(window.begin());
                }
            }

            void finish()
            {
                if (window.size() < 2)
                    return;

                const auto y2 = window.back();
                const auto y1 = window[window.size() - 2];
                const auto y0 = window.size() >= 3 ? window[window.size() - 3] : y1;
                processSegment(y0, y1, y2, y2);
            }

            void processSegment(float y0, float y1, float y2, float y3)
            {
                for (int step = 1; step < 4; ++step)
                    peak = juce::jmax(peak, std::abs(catmullRom(y0, y1, y2, y3, (float) step / 4.0f)));
            }
        };

        class StreamingAnalysisAccumulator
        {
        public:
            StreamingAnalysisAccumulator(double sr, int channels, int bits)
                : sampleRate(sr),
                  channelCount(juce::jlimit(0, 2, channels)),
                  bitDepth(juce::jmax(0, bits)),
                  shelf(makeBiquad("highshelf", sampleRate, 1681.9744509555319, 0.7071752369554196, 3.999843853973347)),
                  highpass(makeBiquad("highpass", sampleRate, 38.13547087602444, 0.5003270373238773)),
                  blockSize(juce::jmax(1, (int) std::round(sampleRate * 0.4))),
                  hopSize(juce::jmax(1, (int) std::round(sampleRate * 0.1))),
                  weightedRing((size_t) juce::jmax(1, blockSize), 0.0)
            {
                for (int channel = 0; channel < channelCount; ++channel)
                {
                    shelfStates[(size_t) channel].coefficients = shelf;
                    highpassStates[(size_t) channel].coefficients = highpass;
                }
            }

            void process(const juce::AudioBuffer<float>& buffer, int numSamples)
            {
                const auto samplesToProcess = juce::jlimit(0, buffer.getNumSamples(), numSamples);
                if (channelCount <= 0 || samplesToProcess <= 0)
                    return;

                const auto channelsToRead = juce::jmin(channelCount, buffer.getNumChannels());
                for (int i = 0; i < samplesToProcess; ++i)
                {
                    double weightedPower = 0.0;
                    for (int channel = 0; channel < channelsToRead; ++channel)
                    {
                        const auto value = buffer.getSample(channel, i);
                        const auto absValue = std::abs(value);
                        sumSquares += (double) value * (double) value;
                        sum += value;
                        if (absValue >= 0.999f)
                            ++clippingCount;

                        if (channel == 0)
                            leftPeak = juce::jmax(leftPeak, absValue);
                        else
                            rightPeak = juce::jmax(rightPeak, absValue);

                        truePeaks[(size_t) channel].push(value);

                        const auto weighted = highpassStates[(size_t) channel].process(
                            shelfStates[(size_t) channel].process(value));
                        weightedPower += (double) weighted * (double) weighted;
                    }

                    if (channelsToRead == 1)
                        truePeaks[1].push(buffer.getSample(0, i));

                    if (channelsToRead >= 2)
                    {
                        const auto left = (double) buffer.getSample(0, i);
                        const auto right = (double) buffer.getSample(1, i);
                        sumLeftRight += left * right;
                        sumLeftSquare += left * left;
                        sumRightSquare += right * right;
                    }

                    pushWeightedPower(weightedPower);
                    ++lengthInSamples;
                }
            }

            AudioFileAnalysis finish()
            {
                AudioFileAnalysis analysis;
                analysis.sampleRate = sampleRate;
                analysis.lengthInSamples = lengthInSamples;
                analysis.channelCount = channelCount;
                analysis.bitDepth = bitDepth;
                analysis.durationSeconds = sampleRate > 0.0 ? (double) lengthInSamples / sampleRate : 0.0;

                for (auto& truePeak : truePeaks)
                    truePeak.finish();

                if (channelCount <= 0 || lengthInSamples <= 0)
                    return analysis;

                if (channelCount == 1)
                    rightPeak = leftPeak;

                const auto sampleCount = (double) lengthInSamples * (double) channelCount;
                const auto rms = std::sqrt(sumSquares / juce::jmax(1.0, sampleCount));
                const auto samplePeak = juce::jmax(leftPeak, rightPeak);
                analysis.leftPeakDbFS = amplitudeToDbValue(leftPeak);
                analysis.rightPeakDbFS = amplitudeToDbValue(rightPeak);
                analysis.rmsDbFS = amplitudeToDbValue((float) rms);
                analysis.truePeakDbTP = amplitudeToDbValue(juce::jmax(truePeaks[0].peak, truePeaks[1].peak));
                analysis.crestFactorDb = std::isfinite(analysis.rmsDbFS) && samplePeak > 0.0f
                    ? amplitudeToDbValue(samplePeak) - analysis.rmsDbFS
                    : -std::numeric_limits<float>::infinity();
                analysis.dcOffset = (float) std::abs(sum / juce::jmax(1.0, sampleCount));
                analysis.clippingCount = clippingCount;
                analysis.clippingRatio = (float) ((double) clippingCount / juce::jmax(1.0, sampleCount));

                const auto denominator = std::sqrt(sumLeftSquare * sumRightSquare);
                analysis.stereoCorrelation = denominator > 0.0
                    ? juce::jlimit(-1.0f, 1.0f, (float) (sumLeftRight / denominator))
                    : std::numeric_limits<float>::quiet_NaN();

                analysis.integratedLufs = finishLoudness();
                return analysis;
            }

        private:
            void pushWeightedPower(double power)
            {
                totalWeightedPower += power;

                const auto ringIndex = (size_t) (lengthInSamples % (int64_t) weightedRing.size());
                if (lengthInSamples >= blockSize)
                    windowWeightedPower -= weightedRing[ringIndex];
                weightedRing[ringIndex] = power;
                windowWeightedPower += power;

                const auto completedSamples = lengthInSamples + 1;
                if (completedSamples >= blockSize && ((completedSamples - blockSize) % hopSize) == 0)
                {
                    const auto meanSquare = windowWeightedPower / (double) blockSize;
                    if (loudnessFromMeanSquare(meanSquare) >= -70.0f)
                        absoluteGatedPowers.push_back(meanSquare);
                }
            }

            float finishLoudness() const
            {
                if (lengthInSamples <= 0 || sampleRate <= 0.0)
                    return -std::numeric_limits<float>::infinity();

                if (lengthInSamples < blockSize)
                    return loudnessFromMeanSquare(totalWeightedPower / (double) lengthInSamples);

                if (absoluteGatedPowers.empty())
                    return -std::numeric_limits<float>::infinity();

                const auto ungatedMean = average(absoluteGatedPowers);
                const auto relativeGate = loudnessFromMeanSquare(ungatedMean) - 10.0f;

                std::vector<double> gatedPowers;
                for (const auto power : absoluteGatedPowers)
                    if (loudnessFromMeanSquare(power) >= relativeGate)
                        gatedPowers.push_back(power);

                return gatedPowers.empty()
                    ? -std::numeric_limits<float>::infinity()
                    : loudnessFromMeanSquare(average(gatedPowers));
            }

            double sampleRate { 0.0 };
            int channelCount { 0 };
            int bitDepth { 0 };
            BiquadCoefficients shelf;
            BiquadCoefficients highpass;
            int blockSize { 1 };
            int hopSize { 1 };
            int64_t lengthInSamples { 0 };
            double sumSquares { 0.0 };
            double sum { 0.0 };
            int64_t clippingCount { 0 };
            float leftPeak { 0.0f };
            float rightPeak { 0.0f };
            double sumLeftRight { 0.0 };
            double sumLeftSquare { 0.0 };
            double sumRightSquare { 0.0 };
            double totalWeightedPower { 0.0 };
            double windowWeightedPower { 0.0 };
            std::vector<double> weightedRing;
            std::vector<double> absoluteGatedPowers;
            std::array<StreamingBiquad, 2> shelfStates;
            std::array<StreamingBiquad, 2> highpassStates;
            std::array<StreamingTruePeak, 2> truePeaks;
        };

        float calculateStereoCorrelation(const juce::AudioBuffer<float>& buffer)
        {
            if (buffer.getNumChannels() < 2 || buffer.getNumSamples() <= 0)
                return std::numeric_limits<float>::quiet_NaN();

            const auto* left = buffer.getReadPointer(0);
            const auto* right = buffer.getReadPointer(1);
            double sumLeftRight = 0.0;
            double sumLeftSquare = 0.0;
            double sumRightSquare = 0.0;

            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const auto l = (double) left[i];
                const auto r = (double) right[i];
                sumLeftRight += l * r;
                sumLeftSquare += l * l;
                sumRightSquare += r * r;
            }

            const auto denominator = std::sqrt(sumLeftSquare * sumRightSquare);
            if (denominator <= 0.0)
                return std::numeric_limits<float>::quiet_NaN();

            return juce::jlimit(-1.0f, 1.0f, (float) (sumLeftRight / denominator));
        }
    }

    float AudioFileAnalyzer::amplitudeToDb(float amplitude) noexcept
    {
        return amplitudeToDbValue(amplitude);
    }

    AudioFileAnalysis AudioFileAnalyzer::analyzeBuffer(const juce::AudioBuffer<float>& buffer, double sampleRate)
    {
        AudioFileAnalysis analysis;
        analysis.sampleRate = sampleRate;
        analysis.lengthInSamples = buffer.getNumSamples();
        analysis.channelCount = buffer.getNumChannels();
        analysis.bitDepth = 0;
        analysis.durationSeconds = sampleRate > 0.0 ? (double) buffer.getNumSamples() / sampleRate : 0.0;

        if (buffer.getNumChannels() <= 0 || buffer.getNumSamples() <= 0)
            return analysis;

        const auto channelCount = juce::jmin(2, buffer.getNumChannels());
        double sumSquares = 0.0;
        double sum = 0.0;
        int64_t clippingCount = 0;
        float leftPeak = 0.0f;
        float rightPeak = 0.0f;

        for (int channel = 0; channel < channelCount; ++channel)
        {
            const auto* data = buffer.getReadPointer(channel);
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const auto value = data[i];
                const auto absValue = std::abs(value);
                sumSquares += (double) value * (double) value;
                sum += value;
                if (absValue >= 0.999f)
                    ++clippingCount;

                if (channel == 0)
                    leftPeak = juce::jmax(leftPeak, absValue);
                else
                    rightPeak = juce::jmax(rightPeak, absValue);
            }
        }

        if (channelCount == 1)
            rightPeak = leftPeak;

        const auto sampleCount = (double) buffer.getNumSamples() * (double) channelCount;
        const auto rms = std::sqrt(sumSquares / juce::jmax(1.0, sampleCount));
        const auto samplePeak = juce::jmax(leftPeak, rightPeak);
        analysis.leftPeakDbFS = amplitudeToDb(leftPeak);
        analysis.rightPeakDbFS = amplitudeToDb(rightPeak);
        analysis.rmsDbFS = amplitudeToDb((float) rms);
        analysis.truePeakDbTP = amplitudeToDb(estimateTruePeak(buffer));
        analysis.crestFactorDb = std::isfinite(analysis.rmsDbFS) && samplePeak > 0.0f
            ? amplitudeToDb(samplePeak) - analysis.rmsDbFS
            : -std::numeric_limits<float>::infinity();
        analysis.dcOffset = (float) std::abs(sum / juce::jmax(1.0, sampleCount));
        analysis.clippingCount = clippingCount;
        analysis.clippingRatio = (float) ((double) clippingCount / juce::jmax(1.0, sampleCount));
        analysis.stereoCorrelation = calculateStereoCorrelation(buffer);
        analysis.integratedLufs = calculateIntegratedLufs(buffer, sampleRate);
        return analysis;
    }

    std::optional<AudioFileAnalysis> AudioFileAnalyzer::analyzeFile(const juce::File& file)
    {
        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();

        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr)
            return std::nullopt;

        if (reader->lengthInSamples <= 0)
        {
            AudioFileAnalysis empty;
            empty.sampleRate = reader->sampleRate;
            empty.durationSeconds = 0.0;
            empty.lengthInSamples = 0;
            empty.channelCount = (int) reader->numChannels;
            empty.bitDepth = (int) reader->bitsPerSample;
            return empty;
        }

        constexpr int chunkSamples = 32768;
        StreamingAnalysisAccumulator accumulator(reader->sampleRate, (int) reader->numChannels, (int) reader->bitsPerSample);
        juce::AudioBuffer<float> buffer((int) reader->numChannels, chunkSamples);

        int64_t sourcePosition = 0;
        while (sourcePosition < reader->lengthInSamples)
        {
            const auto samplesThisChunk = (int) juce::jmin<int64_t>(
                chunkSamples,
                reader->lengthInSamples - sourcePosition);
            buffer.clear();
            reader->read(&buffer, 0, samplesThisChunk, sourcePosition, true, true);
            accumulator.process(buffer, samplesThisChunk);
            sourcePosition += samplesThisChunk;
        }

        return accumulator.finish();
    }

    std::optional<AudioWaveformSummary> AudioFileAnalyzer::analyzeWaveformFile(const juce::File& file, int requestedBucketCount)
    {
        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();

        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr)
            return std::nullopt;

        AudioWaveformSummary summary;
        summary.sampleRate = reader->sampleRate;
        summary.lengthInSamples = reader->lengthInSamples;
        summary.channelCount = (int) reader->numChannels;
        summary.durationSeconds = reader->sampleRate > 0.0
            ? (double) reader->lengthInSamples / reader->sampleRate
            : 0.0;
        summary.bucketCount = juce::jlimit(1, 4096, requestedBucketCount);

        summary.left.upper.assign((size_t) summary.bucketCount, 0.0f);
        summary.left.lower.assign((size_t) summary.bucketCount, 0.0f);
        summary.right.upper.assign((size_t) summary.bucketCount, 0.0f);
        summary.right.lower.assign((size_t) summary.bucketCount, 0.0f);

        if (reader->lengthInSamples <= 0 || reader->numChannels <= 0)
            return summary;

        constexpr int chunkSamples = 32768;
        const auto channelsToRead = juce::jmin(2, (int) reader->numChannels);
        juce::AudioBuffer<float> buffer(channelsToRead, chunkSamples);

        int64_t sourcePosition = 0;
        while (sourcePosition < reader->lengthInSamples)
        {
            const auto samplesThisChunk = (int) juce::jmin<int64_t>(
                chunkSamples,
                reader->lengthInSamples - sourcePosition);
            buffer.clear();
            reader->read(&buffer, 0, samplesThisChunk, sourcePosition, true, true);

            for (int i = 0; i < samplesThisChunk; ++i)
            {
                const auto absoluteSample = sourcePosition + i;
                const auto bucket = (int) juce::jlimit<int64_t>(
                    0,
                    summary.bucketCount - 1,
                    (absoluteSample * (int64_t) summary.bucketCount) / juce::jmax<int64_t>(1, reader->lengthInSamples));

                const auto left = buffer.getSample(0, i);
                const auto right = channelsToRead > 1 ? buffer.getSample(1, i) : left;
                auto update = [bucket](AudioWaveformChannel& channel, float value)
                {
                    channel.upper[(size_t) bucket] = juce::jmax(channel.upper[(size_t) bucket], juce::jlimit(0.0f, 1.0f, value));
                    channel.lower[(size_t) bucket] = juce::jmax(channel.lower[(size_t) bucket], juce::jlimit(0.0f, 1.0f, -value));
                };
                update(summary.left, left);
                update(summary.right, right);
            }

            sourcePosition += samplesThisChunk;
        }

        return summary;
    }
}

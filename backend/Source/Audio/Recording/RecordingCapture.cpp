#include "RecordingCapture.h"

#include <algorithm>
#include <cstdint>
#include <cmath>
#include <limits>
#include <memory>

namespace beat
{
    namespace
    {
        bool writeU16(juce::FileOutputStream& stream, uint16_t value)
        {
            const unsigned char bytes[2] {
                (unsigned char) (value & 0xffu),
                (unsigned char) ((value >> 8u) & 0xffu),
            };
            return stream.write(bytes, sizeof(bytes));
        }

        bool writeU32(juce::FileOutputStream& stream, uint32_t value)
        {
            const unsigned char bytes[4] {
                (unsigned char) (value & 0xffu),
                (unsigned char) ((value >> 8u) & 0xffu),
                (unsigned char) ((value >> 16u) & 0xffu),
                (unsigned char) ((value >> 24u) & 0xffu),
            };
            return stream.write(bytes, sizeof(bytes));
        }

        bool writeS24(juce::FileOutputStream& stream, int32_t value)
        {
            const unsigned char bytes[3] {
                (unsigned char) (value & 0xff),
                (unsigned char) ((value >> 8) & 0xff),
                (unsigned char) ((value >> 16) & 0xff),
            };
            return stream.write(bytes, sizeof(bytes));
        }

        bool writeSample(juce::FileOutputStream& stream, float sample, int bitDepth)
        {
            sample = juce::jlimit(-1.0f, 1.0f, sample);
            if (bitDepth == 16)
                return writeU16(stream, (uint16_t) (int16_t) std::lrint(sample * 32767.0f));
            if (bitDepth == 24)
                return writeS24(stream, (int32_t) std::lrint(sample * 8388607.0f));
            return writeU32(stream, (uint32_t) (int32_t) std::lrint(sample * 2147483647.0f));
        }
    }

    bool RecordingCapture::prepare(double sampleRate,
                                   int channels,
                                   double maxDurationSeconds,
                                   juce::String* error)
    {
        const auto fail = [error](const juce::String& message)
        {
            if (error != nullptr)
                *error = message;
            return false;
        };

        if (!std::isfinite(sampleRate) || sampleRate <= 0.0)
            return fail("Recording sample rate is invalid.");
        if (channels <= 0 || channels > 32)
            return fail("Recording channel count is invalid.");
        if (!std::isfinite(maxDurationSeconds) || maxDurationSeconds <= 0.0)
            return fail("Recording duration is invalid.");

        const auto capacity = (int) std::ceil(sampleRate * maxDurationSeconds);
        if (capacity <= 0)
            return fail("Recording capacity is invalid.");

        active.store(false, std::memory_order_release);
        buffer.setSize(channels, capacity, false, false, true);
        buffer.clear();
        preparedSampleRate = sampleRate;
        preparedChannels = channels;
        preparedCapacitySamples = capacity;
        recordedSamples.store(0, std::memory_order_relaxed);
        overflowed.store(false, std::memory_order_relaxed);
        return true;
    }

    void RecordingCapture::start() noexcept
    {
        if (preparedSampleRate <= 0.0 || preparedChannels <= 0 || preparedCapacitySamples <= 0)
            return;

        buffer.clear();
        recordedSamples.store(0, std::memory_order_relaxed);
        overflowed.store(false, std::memory_order_relaxed);
        active.store(true, std::memory_order_release);
    }

    RecordingCaptureStats RecordingCapture::stop() noexcept
    {
        active.store(false, std::memory_order_release);
        return stats();
    }

    void RecordingCapture::cancel() noexcept
    {
        active.store(false, std::memory_order_release);
        recordedSamples.store(0, std::memory_order_relaxed);
        overflowed.store(false, std::memory_order_relaxed);
    }

    void RecordingCapture::captureBlock(const float* const* inputChannels,
                                        int numInputChannels,
                                        int numSamples) noexcept
    {
        if (!active.load(std::memory_order_acquire)
            || inputChannels == nullptr
            || numInputChannels <= 0
            || numSamples <= 0)
        {
            return;
        }

        const int start = recordedSamples.load(std::memory_order_relaxed);
        if (start >= preparedCapacitySamples)
        {
            overflowed.store(true, std::memory_order_relaxed);
            active.store(false, std::memory_order_release);
            return;
        }

        const int writable = juce::jmin(numSamples, preparedCapacitySamples - start);
        for (int ch = 0; ch < preparedChannels; ++ch)
        {
            auto* destination = buffer.getWritePointer(ch, start);
            const auto* source = inputChannels[juce::jmin(ch, numInputChannels - 1)];
            if (source == nullptr)
            {
                std::fill(destination, destination + writable, 0.0f);
                continue;
            }

            std::copy(source, source + writable, destination);
        }

        recordedSamples.store(start + writable, std::memory_order_release);
        if (writable < numSamples)
        {
            overflowed.store(true, std::memory_order_relaxed);
            active.store(false, std::memory_order_release);
        }
    }

    RecordingCaptureStats RecordingCapture::stats() const noexcept
    {
        return {
            active.load(std::memory_order_acquire),
            preparedChannels,
            recordedSamples.load(std::memory_order_acquire),
            preparedCapacitySamples,
            preparedSampleRate,
            overflowed.load(std::memory_order_relaxed),
        };
    }

    bool RecordingCapture::writeToWav(const juce::File& outputFile,
                                      juce::String* error,
                                      int bitDepth) const
    {
        const auto fail = [error](const juce::String& message)
        {
            if (error != nullptr)
                *error = message;
            return false;
        };

        if (active.load(std::memory_order_acquire))
            return fail("Recording is still active.");
        if (outputFile.getFullPathName().isEmpty())
            return fail("Recording output path is empty.");

        const int samples = recordedSamples.load(std::memory_order_acquire);
        if (preparedSampleRate <= 0.0 || preparedChannels <= 0 || samples <= 0)
            return fail("Recording is empty.");

        bitDepth = (bitDepth <= 16) ? 16 : (bitDepth <= 24 ? 24 : 32);
        const int bytesPerSample = bitDepth / 8;
        const auto dataBytes64 = (juce::int64) samples * preparedChannels * bytesPerSample;
        if (dataBytes64 > (juce::int64) std::numeric_limits<uint32_t>::max() - 36)
            return fail("Recording is too long for WAV export.");

        auto parent = outputFile.getParentDirectory();
        if (!parent.exists() && !parent.createDirectory())
            return fail("Could not create recording output directory.");

        auto tempFile = parent.getChildFile(outputFile.getFileName() + ".tmp");
        if (tempFile.existsAsFile() && !tempFile.deleteFile())
            return fail("Could not clear previous temporary recording file.");

        std::unique_ptr<juce::FileOutputStream> stream(tempFile.createOutputStream());
        if (stream == nullptr || stream->failedToOpen())
            return fail("Could not open recording output file.");

        const auto dataBytes = (uint32_t) dataBytes64;
        const auto sampleRateInt = (uint32_t) std::round(preparedSampleRate);
        const auto byteRate = sampleRateInt * (uint32_t) preparedChannels * (uint32_t) bytesPerSample;
        const auto blockAlign = (uint16_t) (preparedChannels * bytesPerSample);

        stream->write("RIFF", 4);
        writeU32(*stream, 36 + dataBytes);
        stream->write("WAVE", 4);
        stream->write("fmt ", 4);
        writeU32(*stream, 16);
        writeU16(*stream, 1);
        writeU16(*stream, (uint16_t) preparedChannels);
        writeU32(*stream, sampleRateInt);
        writeU32(*stream, byteRate);
        writeU16(*stream, blockAlign);
        writeU16(*stream, (uint16_t) bitDepth);
        stream->write("data", 4);
        writeU32(*stream, dataBytes);

        for (int i = 0; i < samples; ++i)
        {
            for (int ch = 0; ch < preparedChannels; ++ch)
            {
                if (!writeSample(*stream, buffer.getSample(ch, i), bitDepth))
                {
                    stream.reset();
                    tempFile.deleteFile();
                    return fail("Could not write recording samples.");
                }
            }
        }

        stream->flush();
        stream.reset();

        if (outputFile.existsAsFile() && !outputFile.deleteFile())
        {
            tempFile.deleteFile();
            return fail("Could not replace existing recording file.");
        }
        if (!tempFile.moveFileTo(outputFile))
        {
            tempFile.deleteFile();
            return fail("Could not finalize recording file.");
        }
        return true;
    }
}

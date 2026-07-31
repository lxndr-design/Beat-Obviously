#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <cmath>
#include <utility>
#include <tuple>

namespace beat
{
    class LumenArpeggiator
    {
    public:
        enum class Mode { up, down, upDown, random };
        enum class Scale { chromatic, major, naturalMinor, majorPentatonic, blues };
        struct Config
        {
            bool enabled { false };
            Mode mode { Mode::up };
            double stepSamples { 6000.0 };
            float gate { 0.75f };
            float swing { 0.0f };
            int octaves { 1 };
            int rootPitchClass { 0 };
            Scale scale { Scale::chromatic };
        };

        void prepare(int maximumBlockSize)
        {
            juce::ignoreUnused(maximumBlockSize);
            // Match AudioEngine's fixed callback MIDI budget so passthrough and
            // generated events remain allocation-free at every supported block size.
            output.ensureSize(65536);
            reset();
        }

        void setConfig(Config next) noexcept
        {
            next.stepSamples = std::isfinite(next.stepSamples) ? juce::jmax(1.0, next.stepSamples) : 6000.0;
            next.gate = juce::jlimit(0.05f, 1.0f, next.gate);
            next.swing = juce::jlimit(0.0f, 0.75f, next.swing);
            next.octaves = juce::jlimit(1, 4, next.octaves);
            next.rootPitchClass = juce::jlimit(0, 11, next.rootPitchClass);
            if (config.enabled && !next.enabled) reset();
            config = next;
        }

        void reset() noexcept
        {
            held.fill(false);
            velocities.fill(0.0f);
            channels.fill(1);
            heldCount = 0;
            sequenceIndex = 0;
            sequenceDirection = 1;
            nextStepUsesLongSwingInterval = true;
            samplesUntilStep = 0.0;
            samplesUntilGateOff = -1.0;
            activeNote = -1;
            activeChannel = 1;
            randomState = 0x6d2b79f5u;
            output.clear();
        }

        juce::MidiBuffer& process(const juce::MidiBuffer& input, int numSamples) noexcept
        {
            output.clear();
            if (!config.enabled)
            {
                for (const auto metadata : input) output.addEvent(metadata.getMessage(), metadata.samplePosition);
                return output;
            }

            auto iterator = input.begin();
            const auto end = input.end();
            for (int sample = 0; sample < numSamples; ++sample)
            {
                while (iterator != end && (*iterator).samplePosition <= sample)
                {
                    const auto message = (*iterator).getMessage();
                    if (message.isNoteOn()) addHeld(message.getNoteNumber(), message.getFloatVelocity(), message.getChannel());
                    else if (message.isNoteOff()) removeHeld(message.getNoteNumber());
                    else
                    {
                        if (message.isAllNotesOff() || message.isAllSoundOff())
                            clearHeldNotes(sample);
                        output.addEvent(message, sample);
                    }
                    ++iterator;
                }

                if (heldCount == 0)
                {
                    if (activeNote >= 0) emitNoteOff(sample);
                    samplesUntilStep = 0.0;
                    nextStepUsesLongSwingInterval = true;
                    continue;
                }
                if (samplesUntilGateOff == 0.0 && activeNote >= 0) emitNoteOff(sample);
                if (samplesUntilStep <= 0.0)
                {
                    if (activeNote >= 0) emitNoteOff(sample);
                    const auto [note, velocity, channel] = nextNote();
                    activeNote = note;
                    activeChannel = channel;
                    output.addEvent(juce::MidiMessage::noteOn(channel, note, velocity), sample);
                    const auto interval = nextStepDuration();
                    samplesUntilStep += interval;
                    samplesUntilGateOff = std::floor(interval * config.gate);
                }
                samplesUntilStep -= 1.0;
                if (samplesUntilGateOff > 0.0) samplesUntilGateOff -= 1.0;
            }
            return output;
        }

    private:
        void addHeld(int note, float velocity, int channel) noexcept
        {
            if (note < 0 || note >= 128) return;
            if (!held[(size_t) note]) { held[(size_t) note] = true; ++heldCount; }
            velocities[(size_t) note] = juce::jlimit(0.0f, 1.0f, velocity);
            channels[(size_t) note] = (uint8_t) juce::jlimit(1, 16, channel);
        }

        void removeHeld(int note) noexcept
        {
            if (note < 0 || note >= 128 || !held[(size_t) note]) return;
            held[(size_t) note] = false;
            velocities[(size_t) note] = 0.0f;
            --heldCount;
            sequenceIndex = 0;
            if (heldCount == 0) nextStepUsesLongSwingInterval = true;
        }

        void clearHeldNotes(int sample) noexcept
        {
            held.fill(false);
            velocities.fill(0.0f);
            channels.fill(1);
            heldCount = 0;
            sequenceIndex = 0;
            sequenceDirection = 1;
            nextStepUsesLongSwingInterval = true;
            samplesUntilStep = 0.0;
            if (activeNote >= 0) emitNoteOff(sample);
        }

        std::tuple<int, float, int> nextNote() noexcept
        {
            std::array<int, 128> sourceNotes {};
            std::array<int, 128> quantizedNotes {};
            int count = 0;
            for (int note = 0; note < 128; ++note)
            {
                if (!held[(size_t) note]) continue;
                const auto quantized = quantizeToScale(note);
                int insertAt = count;
                while (insertAt > 0
                    && (quantizedNotes[(size_t) insertAt - 1] > quantized
                        || (quantizedNotes[(size_t) insertAt - 1] == quantized
                            && sourceNotes[(size_t) insertAt - 1] > note)))
                {
                    quantizedNotes[(size_t) insertAt] = quantizedNotes[(size_t) insertAt - 1];
                    sourceNotes[(size_t) insertAt] = sourceNotes[(size_t) insertAt - 1];
                    --insertAt;
                }
                quantizedNotes[(size_t) insertAt] = quantized;
                sourceNotes[(size_t) insertAt] = note;
                ++count;
            }
            const int expandedCount = juce::jmax(1, count * config.octaves);
            int expandedIndex = 0;
            if (config.mode == Mode::random)
            {
                randomState ^= randomState << 13; randomState ^= randomState >> 17; randomState ^= randomState << 5;
                expandedIndex = (int) (randomState % (uint32_t) expandedCount);
            }
            else if (config.mode == Mode::down)
                expandedIndex = expandedCount - 1 - (sequenceIndex++ % expandedCount);
            else if (config.mode == Mode::upDown && expandedCount > 1)
            {
                expandedIndex = sequenceIndex;
                sequenceIndex += sequenceDirection;
                if (sequenceIndex >= expandedCount - 1 || sequenceIndex <= 0) sequenceDirection = -sequenceDirection;
            }
            else expandedIndex = sequenceIndex++ % expandedCount;
            const int baseIndex = expandedIndex % count;
            const int octave = expandedIndex / count;
            const int sourceNote = sourceNotes[(size_t) baseIndex];
            const int note = juce::jlimit(0, 127, quantizedNotes[(size_t) baseIndex] + octave * 12);
            return { note, velocities[(size_t) sourceNote], channels[(size_t) sourceNote] };
        }

        bool pitchClassIsInScale(int pitchClass) const noexcept
        {
            const auto relative = (pitchClass - config.rootPitchClass + 12) % 12;
            switch (config.scale)
            {
                case Scale::major: return relative == 0 || relative == 2 || relative == 4
                    || relative == 5 || relative == 7 || relative == 9 || relative == 11;
                case Scale::naturalMinor: return relative == 0 || relative == 2 || relative == 3
                    || relative == 5 || relative == 7 || relative == 8 || relative == 10;
                case Scale::majorPentatonic: return relative == 0 || relative == 2 || relative == 4
                    || relative == 7 || relative == 9;
                case Scale::blues: return relative == 0 || relative == 3 || relative == 5
                    || relative == 6 || relative == 7 || relative == 10;
                case Scale::chromatic: return true;
            }
            return true;
        }

        int quantizeToScale(int note) const noexcept
        {
            if (config.scale == Scale::chromatic) return note;
            for (int distance = 0; distance < 12; ++distance)
            {
                const int lower = note - distance;
                if (lower >= 0 && pitchClassIsInScale(lower % 12)) return lower;
                const int upper = note + distance;
                if (distance > 0 && upper <= 127 && pitchClassIsInScale(upper % 12)) return upper;
            }
            return note;
        }

        void emitNoteOff(int sample) noexcept
        {
            output.addEvent(juce::MidiMessage::noteOff(activeChannel, activeNote), sample);
            activeNote = -1;
            samplesUntilGateOff = -1.0;
        }

        double nextStepDuration() noexcept
        {
            const auto amount = (double) config.swing;
            const auto multiplier = nextStepUsesLongSwingInterval ? 1.0 + amount : 1.0 - amount;
            nextStepUsesLongSwingInterval = !nextStepUsesLongSwingInterval;
            return config.stepSamples * multiplier;
        }

        Config config;
        std::array<bool, 128> held {};
        std::array<float, 128> velocities {};
        std::array<uint8_t, 128> channels {};
        int heldCount { 0 };
        int sequenceIndex { 0 };
        int sequenceDirection { 1 };
        bool nextStepUsesLongSwingInterval { true };
        double samplesUntilStep { 0.0 };
        double samplesUntilGateOff { -1.0 };
        int activeNote { -1 };
        int activeChannel { 1 };
        uint32_t randomState { 0x6d2b79f5u };
        juce::MidiBuffer output;
    };
}

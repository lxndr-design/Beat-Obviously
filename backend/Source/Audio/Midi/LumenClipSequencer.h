#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <cmath>
#include <cstdint>

namespace beat
{
    class LumenClipSequencer
    {
    public:
        static constexpr int maxSteps = 32;
        static constexpr int maxNotes = 64;

        struct Note
        {
            int startStep { 0 };
            int pitchOffset { 0 };
            int lengthSteps { 1 };
            float velocity { 1.0f };
        };

        struct Config
        {
            bool enabled { false };
            double stepSamples { 6000.0 };
            float swing { 0.0f };
            int lengthSteps { 16 };
            int noteCount { 0 };
            std::array<Note, maxNotes> notes {};
        };

        void prepare(int maximumBlockSize)
        {
            juce::ignoreUnused(maximumBlockSize);
            output.ensureSize(65536);
            reset();
        }

        void setConfig(Config next) noexcept
        {
            next.stepSamples = std::isfinite(next.stepSamples) ? juce::jmax(1.0, next.stepSamples) : 6000.0;
            next.swing = juce::jlimit(0.0f, 0.75f, next.swing);
            next.lengthSteps = juce::jlimit(1, maxSteps, next.lengthSteps);
            next.noteCount = juce::jlimit(0, maxNotes, next.noteCount);
            for (int index = 0; index < next.noteCount; ++index)
            {
                auto& note = next.notes[(size_t) index];
                note.startStep = juce::jlimit(0, next.lengthSteps - 1, note.startStep);
                note.pitchOffset = juce::jlimit(-48, 48, note.pitchOffset);
                note.lengthSteps = juce::jlimit(1, next.lengthSteps - note.startStep, note.lengthSteps);
                note.velocity = std::isfinite(note.velocity) ? juce::jlimit(0.001f, 1.0f, note.velocity) : 1.0f;
            }
            if (config.enabled && !next.enabled) reset();
            config = next;
        }

        void reset() noexcept
        {
            held.fill(false);
            velocities.fill(0.0f);
            channels.fill(1);
            pressOrder.fill(0);
            nextPressOrder = 1;
            triggerNote = -1;
            triggerVelocity = 0.0f;
            triggerChannel = 1;
            currentStep = 0;
            nextStepUsesLongSwingInterval = true;
            samplesUntilStep = 0.0;
            activeNoteCount = 0;
            activeNotes.fill({});
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
                    if (message.isNoteOn()) addHeld(message.getNoteNumber(), message.getFloatVelocity(), message.getChannel(), sample);
                    else if (message.isNoteOff()) removeHeld(message.getNoteNumber(), sample);
                    else
                    {
                        if (message.isAllNotesOff() || message.isAllSoundOff()) clearHeldNotes(sample);
                        output.addEvent(message, sample);
                    }
                    ++iterator;
                }

                if (triggerNote < 0)
                {
                    emitAllNoteOffs(sample);
                    currentStep = 0;
                    samplesUntilStep = 0.0;
                    nextStepUsesLongSwingInterval = true;
                    continue;
                }
                if (samplesUntilStep <= 0.0)
                {
                    advanceActiveNotes(sample);
                    for (int noteIndex = 0; noteIndex < config.noteCount; ++noteIndex)
                    {
                        const auto& note = config.notes[(size_t) noteIndex];
                        if (note.startStep != currentStep) continue;
                        const int renderedNote = juce::jlimit(0, 127, triggerNote + note.pitchOffset);
                        retireMatchingActiveNote(renderedNote, triggerChannel, sample);
                        if (activeNoteCount >= maxNotes) continue;
                        auto& active = activeNotes[(size_t) activeNoteCount++];
                        active.note = renderedNote;
                        active.channel = triggerChannel;
                        active.remainingSteps = note.lengthSteps;
                        output.addEvent(juce::MidiMessage::noteOn(
                            active.channel, active.note,
                            juce::jlimit(0.0f, 1.0f, triggerVelocity * note.velocity)), sample);
                    }
                    currentStep = (currentStep + 1) % config.lengthSteps;
                    samplesUntilStep += nextStepDuration();
                }
                samplesUntilStep -= 1.0;
            }
            return output;
        }

    private:
        void addHeld(int note, float velocity, int channel, int sample) noexcept
        {
            if (note < 0 || note >= 128) return;
            held[(size_t) note] = true;
            velocities[(size_t) note] = juce::jlimit(0.0f, 1.0f, velocity);
            channels[(size_t) note] = (uint8_t) juce::jlimit(1, 16, channel);
            pressOrder[(size_t) note] = nextPressOrder++;
            emitAllNoteOffs(sample);
            selectTrigger(note);
            restartPattern();
        }

        void removeHeld(int note, int sample) noexcept
        {
            if (note < 0 || note >= 128 || !held[(size_t) note]) return;
            held[(size_t) note] = false;
            velocities[(size_t) note] = 0.0f;
            pressOrder[(size_t) note] = 0;
            if (note != triggerNote) return;
            int replacement = -1;
            uint32_t newest = 0;
            for (int candidate = 0; candidate < 128; ++candidate)
            {
                if (held[(size_t) candidate] && pressOrder[(size_t) candidate] >= newest)
                {
                    newest = pressOrder[(size_t) candidate];
                    replacement = candidate;
                }
            }
            emitAllNoteOffs(sample);
            if (replacement >= 0)
            {
                selectTrigger(replacement);
                restartPattern();
            }
            else
            {
                triggerNote = -1;
                triggerVelocity = 0.0f;
                currentStep = 0;
                samplesUntilStep = 0.0;
            }
        }

        void selectTrigger(int note) noexcept
        {
            triggerNote = note;
            triggerVelocity = velocities[(size_t) note];
            triggerChannel = channels[(size_t) note];
        }

        void restartPattern() noexcept
        {
            currentStep = 0;
            samplesUntilStep = 0.0;
            nextStepUsesLongSwingInterval = true;
        }

        void clearHeldNotes(int sample) noexcept
        {
            held.fill(false);
            velocities.fill(0.0f);
            pressOrder.fill(0);
            triggerNote = -1;
            emitAllNoteOffs(sample);
            restartPattern();
        }

        void advanceActiveNotes(int sample) noexcept
        {
            int write = 0;
            for (int read = 0; read < activeNoteCount; ++read)
            {
                auto active = activeNotes[(size_t) read];
                --active.remainingSteps;
                if (active.remainingSteps <= 0)
                {
                    output.addEvent(juce::MidiMessage::noteOff(active.channel, active.note), sample);
                    continue;
                }
                activeNotes[(size_t) write++] = active;
            }
            activeNoteCount = write;
        }

        void emitAllNoteOffs(int sample) noexcept
        {
            for (int index = 0; index < activeNoteCount; ++index)
            {
                const auto& active = activeNotes[(size_t) index];
                output.addEvent(juce::MidiMessage::noteOff(active.channel, active.note), sample);
            }
            activeNoteCount = 0;
        }

        void retireMatchingActiveNote(int note, int channel, int sample) noexcept
        {
            int write = 0;
            for (int read = 0; read < activeNoteCount; ++read)
            {
                const auto active = activeNotes[(size_t) read];
                if (active.note == note && active.channel == channel)
                {
                    output.addEvent(juce::MidiMessage::noteOff(active.channel, active.note), sample);
                    continue;
                }
                activeNotes[(size_t) write++] = active;
            }
            activeNoteCount = write;
        }

        double nextStepDuration() noexcept
        {
            const auto multiplier = nextStepUsesLongSwingInterval
                ? 1.0 + (double) config.swing
                : 1.0 - (double) config.swing;
            nextStepUsesLongSwingInterval = !nextStepUsesLongSwingInterval;
            return config.stepSamples * multiplier;
        }

        Config config;
        std::array<bool, 128> held {};
        std::array<float, 128> velocities {};
        std::array<uint8_t, 128> channels {};
        std::array<uint32_t, 128> pressOrder {};
        uint32_t nextPressOrder { 1 };
        struct ActiveNote
        {
            int note { -1 };
            int channel { 1 };
            int remainingSteps { 0 };
        };
        int triggerNote { -1 };
        float triggerVelocity { 0.0f };
        int triggerChannel { 1 };
        int currentStep { 0 };
        bool nextStepUsesLongSwingInterval { true };
        double samplesUntilStep { 0.0 };
        int activeNoteCount { 0 };
        std::array<ActiveNote, maxNotes> activeNotes {};
        juce::MidiBuffer output;
    };
}

#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <cmath>
#include <cstdint>

namespace beat
{
    class LumusClipSequencer
    {
    public:
        static constexpr int maxSteps = 32;

        struct Step
        {
            bool enabled { false };
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
            std::array<Step, maxSteps> steps {};
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
            for (int index = 0; index < next.lengthSteps; ++index)
            {
                auto& step = next.steps[(size_t) index];
                step.pitchOffset = juce::jlimit(-48, 48, step.pitchOffset);
                step.lengthSteps = juce::jlimit(1, next.lengthSteps - index, step.lengthSteps);
                step.velocity = std::isfinite(step.velocity) ? juce::jlimit(0.001f, 1.0f, step.velocity) : 1.0f;
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
            activeNote = -1;
            activeChannel = 1;
            activeLengthSteps = 0;
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
                    if (activeNote >= 0) emitNoteOff(sample);
                    currentStep = 0;
                    samplesUntilStep = 0.0;
                    nextStepUsesLongSwingInterval = true;
                    continue;
                }
                if (samplesUntilStep <= 0.0)
                {
                    advanceActiveNote(sample);
                    const auto& step = config.steps[(size_t) currentStep];
                    if (step.enabled)
                    {
                        if (activeNote >= 0) emitNoteOff(sample);
                        activeNote = juce::jlimit(0, 127, triggerNote + step.pitchOffset);
                        activeChannel = triggerChannel;
                        activeLengthSteps = step.lengthSteps;
                        output.addEvent(juce::MidiMessage::noteOn(
                            activeChannel, activeNote, juce::jlimit(0.0f, 1.0f, triggerVelocity * step.velocity)), sample);
                    }
                    currentStep = (currentStep + 1) % config.lengthSteps;
                    samplesUntilStep += nextStepDuration();
                }
                samplesUntilStep -= 1.0;
            }
            return output;
        }

    private:
        void addHeld(int note, float velocity, int channel) noexcept
        {
            if (note < 0 || note >= 128) return;
            held[(size_t) note] = true;
            velocities[(size_t) note] = juce::jlimit(0.0f, 1.0f, velocity);
            channels[(size_t) note] = (uint8_t) juce::jlimit(1, 16, channel);
            pressOrder[(size_t) note] = nextPressOrder++;
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
            if (activeNote >= 0) emitNoteOff(sample);
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
            if (activeNote >= 0) emitNoteOff(sample);
            restartPattern();
        }

        void advanceActiveNote(int sample) noexcept
        {
            if (activeNote < 0) return;
            --activeLengthSteps;
            if (activeLengthSteps <= 0) emitNoteOff(sample);
        }

        void emitNoteOff(int sample) noexcept
        {
            output.addEvent(juce::MidiMessage::noteOff(activeChannel, activeNote), sample);
            activeNote = -1;
            activeLengthSteps = 0;
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
        int triggerNote { -1 };
        float triggerVelocity { 0.0f };
        int triggerChannel { 1 };
        int currentStep { 0 };
        bool nextStepUsesLongSwingInterval { true };
        double samplesUntilStep { 0.0 };
        int activeNote { -1 };
        int activeChannel { 1 };
        int activeLengthSteps { 0 };
        juce::MidiBuffer output;
    };
}

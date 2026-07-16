#pragma once

#include "SourceSlot.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <memory>

namespace beat
{
    struct ImmutableGranularSource
    {
        static constexpr int maximumChannels = 2;
        static constexpr int maximumFrames = 11520000;
        std::shared_ptr<const juce::AudioBuffer<float>> audio;
        double sourceSampleRate { 44100.0 };
        int rootNote { 60 };
        float position { 0.5f };
        float positionSpread { 0.1f };
        float grainMilliseconds { 80.0f };
        float densityHz { 12.0f };
        float pitchSemitones { 0.0f };
        float stereoSpread { 0.5f };
        uint32_t randomSeed { 1 };

        bool isValid() const noexcept
        {
            return audio && audio->getNumChannels() > 0 && audio->getNumChannels() <= maximumChannels
                && audio->getNumSamples() > 2 && audio->getNumSamples() <= maximumFrames
                && std::isfinite(sourceSampleRate) && sourceSampleRate > 0.0
                && rootNote >= 0 && rootNote <= 127
                && std::isfinite(position) && position >= 0.0f && position <= 1.0f
                && std::isfinite(positionSpread) && positionSpread >= 0.0f && positionSpread <= 1.0f
                && std::isfinite(grainMilliseconds) && grainMilliseconds >= 2.0f && grainMilliseconds <= 1000.0f
                && std::isfinite(densityHz) && densityHz >= 0.1f && densityHz <= 200.0f
                && std::isfinite(pitchSemitones) && pitchSemitones >= -48.0f && pitchSemitones <= 48.0f
                && std::isfinite(stereoSpread) && stereoSpread >= 0.0f && stereoSpread <= 1.0f;
        }
    };

    struct GranularRenderTelemetry
    {
        uint64_t grainsStarted { 0 };
        uint64_t grainsRejected { 0 };
        uint64_t grainSamples { 0 };
        uint64_t schedulerTicks { 0 };
    };

    class GranularSourceSlot final : public SourceSlot
    {
    public:
        static constexpr int maximumEmitters = 8;
        static constexpr int maximumGrains = 32;
        struct StereoFrame { float left { 0.0f }; float right { 0.0f }; };

        bool prepare(const SourcePrepareSpec& next) noexcept override
        {
            if (!std::isfinite(next.sampleRate) || next.sampleRate <= 0.0
                || next.maximumBlockSize <= 0 || next.outputChannels <= 0)
                return false;
            const double previousSampleRate = prepared.sampleRate;
            prepared = next;
            rebuildCoefficients(previousSampleRate);
            return true;
        }

        bool publish(std::shared_ptr<const ImmutableGranularSource> next) noexcept
        {
            if (activeVoiceCount() != 0 || (next && !isFiniteSource(*next)))
                return false;
            source = std::move(next);
            rebuildCoefficients();
            version.fetch_add(1, std::memory_order_release);
            return true;
        }

        void reset() noexcept override
        {
            emitters = {};
            grains = {};
            baseTelemetry = {};
            grainTelemetry = {};
        }

        bool noteOn(const SourceNoteEvent& event) noexcept override
        {
            if (!source || !source->isValid() || event.midiNote < 0 || event.midiNote > 127)
                return rejectNote();
            auto found = std::find_if(emitters.begin(), emitters.end(), [](const Emitter& item) { return !item.active; });
            if (found == emitters.end()) return rejectNote();
            *found = { true, event.stableNoteId, event.midiNote,
                       std::clamp(event.velocity, 0.0f, 1.0f), 0,
                       source->randomSeed ^ (uint32_t) event.stableNoteId ^ (uint32_t) event.midiNote * 0x9e3779b9u };
            ++baseTelemetry.acceptedNoteEvents;
            return true;
        }

        void noteOff(uint64_t stableNoteId) noexcept override
        {
            for (auto& emitter : emitters)
                if (emitter.active && emitter.noteId == stableNoteId)
                    emitter.active = false;
        }

        void allNotesOff(bool immediate) noexcept override
        {
            emitters = {};
            if (immediate) grains = {};
        }

        void render(juce::AudioBuffer<float>& output, int startSample, int numSamples) noexcept override
        {
            if (!source || !source->isValid() || numSamples <= 0 || output.getNumChannels() <= 0) return;
            const int begin = std::clamp(startSample, 0, output.getNumSamples());
            const int end = std::clamp(begin + numSamples, begin, output.getNumSamples());
            for (int sample = begin; sample < end; ++sample)
            {
                const auto frame = renderFrame();
                output.addSample(0, sample, frame.left);
                if (output.getNumChannels() > 1) output.addSample(1, sample, frame.right);
                for (int channel = 2; channel < output.getNumChannels(); ++channel)
                    output.addSample(channel, sample, (frame.left + frame.right) * 0.5f);
            }
        }

        StereoFrame renderFrame() noexcept
        {
            if (!source || !source->isValid()) return {};
            schedule();
            StereoFrame frame;
            for (auto& grain : grains)
            {
                if (!grain.active) continue;
                const int index = std::clamp((int) grain.position, 0, source->audio->getNumSamples() - 2);
                const float fraction = (float) (grain.position - (double) index);
                const auto read = [&](int channel) {
                    const int ch = std::min(channel, source->audio->getNumChannels() - 1);
                    const float a = source->audio->getSample(ch, index);
                    const float b = source->audio->getSample(ch, index + 1);
                    return a + (b - a) * fraction;
                };
                const float phase = (float) grain.age / (float) std::max(1, grain.length - 1);
                const float window = 0.5f - 0.5f * std::cos(juce::MathConstants<float>::twoPi * phase);
                frame.left += read(0) * window * grain.gain * grain.leftPan;
                frame.right += read(1) * window * grain.gain * grain.rightPan;
                grain.position += grain.rate;
                ++grain.age;
                ++grainTelemetry.grainSamples;
                ++baseTelemetry.renderedVoiceSamples;
                if (grain.age >= grain.length || grain.position >= source->audio->getNumSamples() - 1)
                    grain = {};
            }
            ++baseTelemetry.renderedSamples;
            return frame;
        }

        SourceLifecycleState lifecycleState() const noexcept override
        {
            if (!source) return SourceLifecycleState::empty;
            const bool hasEmitter = std::any_of(emitters.begin(), emitters.end(), [](const Emitter& item) { return item.active; });
            if (hasEmitter) return SourceLifecycleState::active;
            const bool hasGrain = std::any_of(grains.begin(), grains.end(), [](const Grain& item) { return item.active; });
            return hasGrain ? SourceLifecycleState::releasing : SourceLifecycleState::ready;
        }
        SourceComplexity complexity() const noexcept override { return SourceComplexity::granular; }
        int latencySamples() const noexcept override { return 0; }
        int activeVoiceCount() const noexcept override
        {
            return (int) std::count_if(emitters.begin(), emitters.end(), [](const Emitter& item) { return item.active; })
                + (int) std::count_if(grains.begin(), grains.end(), [](const Grain& item) { return item.active; });
        }
        uint64_t stateVersion() const noexcept override { return version.load(std::memory_order_acquire); }
        SourceRenderTelemetry telemetry() const noexcept override { return baseTelemetry; }
        GranularRenderTelemetry granularTelemetry() const noexcept { return grainTelemetry; }

    private:
        struct Emitter { bool active {}; uint64_t noteId {}; int midiNote {}; float velocity {}; int countdown {}; uint32_t random {}; };
        struct Grain { bool active {}; double position {}; double rate {}; double semitones {}; int age {}; int length {}; float gain {}; float leftPan {}; float rightPan {}; };

        bool rejectNote() noexcept { ++baseTelemetry.rejectedNoteEvents; return false; }
        static bool isFiniteSource(const ImmutableGranularSource& candidate) noexcept
        {
            if (!candidate.isValid()) return false;
            for (int channel = 0; channel < candidate.audio->getNumChannels(); ++channel)
                for (int sample = 0; sample < candidate.audio->getNumSamples(); ++sample)
                    if (!std::isfinite(candidate.audio->getSample(channel, sample)))
                        return false;
            return true;
        }
        static uint32_t nextRandom(uint32_t& state) noexcept
        {
            state = state ? state : 1u;
            state ^= state << 13; state ^= state >> 17; state ^= state << 5;
            return state;
        }
        static float randomBipolar(uint32_t& state) noexcept
        {
            return ((float) (nextRandom(state) & 0x00ffffffu) / 8388607.5f) - 1.0f;
        }
        void rebuildCoefficients(double previousSampleRate = 0.0) noexcept
        {
            if (!source || !source->isValid()) return;
            if (previousSampleRate > 0.0 && previousSampleRate != prepared.sampleRate)
            {
                const double scale = prepared.sampleRate / previousSampleRate;
                for (auto& emitter : emitters)
                    if (emitter.active)
                        emitter.countdown = std::max(0, (int) std::round(emitter.countdown * scale));
                for (auto& grain : grains)
                {
                    if (!grain.active) continue;
                    const float phase = (float) grain.age / (float) std::max(1, grain.length);
                    grain.length = std::clamp((int) std::round(grain.length * scale), 8, 192000);
                    grain.age = std::clamp((int) std::round(phase * grain.length), 0, grain.length - 1);
                }
            }
            grainLength = std::clamp((int) std::round(prepared.sampleRate * source->grainMilliseconds * 0.001), 8, 192000);
            grainInterval = std::max(1, (int) std::round(prepared.sampleRate / source->densityHz));
            for (auto& grain : grains)
                if (grain.active)
                    grain.rate = pitchRate(grain.semitones);
        }
        double pitchRate(double semitones) const noexcept
        {
            return (source->sourceSampleRate / prepared.sampleRate) * std::pow(2.0, semitones / 12.0);
        }
        void schedule() noexcept
        {
            for (auto& emitter : emitters)
            {
                if (!emitter.active) continue;
                ++grainTelemetry.schedulerTicks;
                if (emitter.countdown-- > 0) continue;
                emitter.countdown = grainInterval - 1;
                auto found = std::find_if(grains.begin(), grains.end(), [](const Grain& item) { return !item.active; });
                if (found == grains.end()) { ++grainTelemetry.grainsRejected; continue; }
                const double center = source->position * (double) (source->audio->getNumSamples() - 2);
                const double spread = source->positionSpread * (double) (source->audio->getNumSamples() - 2);
                const double start = std::clamp(center + randomBipolar(emitter.random) * spread, 0.0,
                                                (double) source->audio->getNumSamples() - 2.0);
                const double semitones = (double) (emitter.midiNote - source->rootNote) + source->pitchSemitones;
                const double rate = pitchRate(semitones);
                const float pan = randomBipolar(emitter.random) * source->stereoSpread;
                *found = { true, start, rate, semitones, 0, grainLength, emitter.velocity,
                           std::sqrt(0.5f * (1.0f - pan)), std::sqrt(0.5f * (1.0f + pan)) };
                ++grainTelemetry.grainsStarted;
            }
        }

        SourcePrepareSpec prepared;
        std::shared_ptr<const ImmutableGranularSource> source;
        std::array<Emitter, maximumEmitters> emitters {};
        std::array<Grain, maximumGrains> grains {};
        int grainLength { 3528 };
        int grainInterval { 3675 };
        std::atomic<uint64_t> version { 0 };
        SourceRenderTelemetry baseTelemetry;
        GranularRenderTelemetry grainTelemetry;
    };
}

#pragma once

#include "SourceSlot.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <memory>

namespace beat
{
    struct ImmutableSampleSource
    {
        // The decoder/cache owns the samples. This alias keeps that immutable
        // cache entry alive without copying audio into every synth voice.
        std::shared_ptr<const juce::AudioBuffer<float>> audio;
        double sourceSampleRate { 44100.0 };
        int rootNote { 60 };
        float gain { 1.0f };
        float pan { 0.0f };
        float startRatio { 0.0f };
        float endRatio { 1.0f };
        bool loopEnabled { false };
        float loopStartRatio { 0.0f };
        float loopEndRatio { 1.0f };

        bool isValid() const noexcept
        {
            return audio
                && audio->getNumChannels() > 0
                && audio->getNumSamples() > 1
                && std::isfinite(sourceSampleRate)
                && sourceSampleRate > 0.0;
        }
    };

    class SampleSourceSlot final : public SourceSlot
    {
    public:
        static constexpr int maximumVoices = 16;

        bool prepare(const SourcePrepareSpec& next) noexcept override
        {
            if (!std::isfinite(next.sampleRate)
                || next.sampleRate <= 0.0
                || next.maximumBlockSize <= 0
                || next.outputChannels <= 0)
            {
                return false;
            }

            prepared = next;
            releaseSamples = std::clamp((int) std::round(next.sampleRate * 0.004), 8, 1024);
            rebuildPitchRates();
            return true;
        }

        bool publish(std::shared_ptr<const ImmutableSampleSource> next) noexcept
        {
            if (activeVoiceCount() != 0 || (next && !next->isValid()))
                return false;

            sample = std::move(next);
            rebuildPlaybackRegion();
            rebuildPitchRates();
            version.fetch_add(1, std::memory_order_release);
            return true;
        }

        void reset() noexcept override
        {
            for (auto& voice : voices)
                voice = {};
            hasReleasingVoice = false;
            renderTelemetry = {};
        }

        bool noteOn(const SourceNoteEvent& event) noexcept override
        {
            if (!sample || !sample->isValid() || event.midiNote < 0 || event.midiNote > 127)
            {
                ++renderTelemetry.rejectedNoteEvents;
                return false;
            }

            auto found = std::find_if(voices.begin(), voices.end(), [](const Voice& voice) {
                return !voice.active;
            });
            if (found == voices.end())
            {
                ++renderTelemetry.rejectedNoteEvents;
                return false;
            }

            *found = {
                true,
                false,
                event.stableNoteId,
                event.midiNote,
                (double) playbackStart,
                pitchRates[(size_t) event.midiNote],
                std::clamp(event.velocity, 0.0f, 1.0f) * sample->gain,
                0,
            };
            ++renderTelemetry.acceptedNoteEvents;
            return true;
        }

        void noteOff(uint64_t stableNoteId) noexcept override
        {
            for (auto& voice : voices)
            {
                if (!voice.active || voice.stableNoteId != stableNoteId)
                    continue;
                voice.releasing = true;
                voice.releaseRemaining = releaseSamples;
                hasReleasingVoice = true;
            }
        }

        void allNotesOff(bool immediate) noexcept override
        {
            for (auto& voice : voices)
            {
                if (!voice.active)
                    continue;
                if (immediate)
                    voice = {};
                else
                {
                    voice.releasing = true;
                    voice.releaseRemaining = releaseSamples;
                }
            }
            hasReleasingVoice = !immediate && activeVoiceCount() > 0;
        }

        void render(juce::AudioBuffer<float>& output, int startSample, int numSamples) noexcept override
        {
            if (!sample || !sample->isValid() || numSamples <= 0 || output.getNumChannels() <= 0)
                return;

            const int outputStart = std::clamp(startSample, 0, output.getNumSamples());
            const int outputEnd = std::clamp(outputStart + numSamples, outputStart, output.getNumSamples());
            for (int outputSample = outputStart; outputSample < outputEnd; ++outputSample)
            {
                const auto frame = renderFrame();
                output.addSample(0, outputSample, frame.left);
                if (output.getNumChannels() > 1)
                    output.addSample(1, outputSample, frame.right);
                for (int channel = 2; channel < output.getNumChannels(); ++channel)
                    output.addSample(channel, outputSample, (frame.left + frame.right) * 0.5f);
            }

        }

        struct StereoFrame { float left { 0.0f }; float right { 0.0f }; };

        StereoFrame renderFrame() noexcept
        {
            StereoFrame result;
            if (!sample || !sample->isValid())
                return result;

            const int sourceChannels = sample->audio->getNumChannels();
            const float pan = std::clamp(sample->pan, -1.0f, 1.0f);
            const float leftPan = std::sqrt(0.5f * (1.0f - pan));
            const float rightPan = std::sqrt(0.5f * (1.0f + pan));
            bool anyReleasing = false;
            for (auto& voice : voices)
            {
                if (!voice.active) continue;
                if (!playbackLoopEnabled && voice.position >= (double) (playbackEnd - 1))
                {
                    voice = {};
                    continue;
                }
                if (playbackLoopEnabled && voice.position >= (double) playbackLoopEnd)
                    voice.position = wrapLoopPosition(voice.position);

                const int sourceIndex = std::clamp((int) voice.position, playbackStart, playbackEnd - 1);
                const int samplesToEnd = playbackEnd - 1 - sourceIndex;
                const float endGain = !playbackLoopEnabled && samplesToEnd < endFadeSamples
                    ? std::clamp((float) samplesToEnd / (float) endFadeSamples, 0.0f, 1.0f) : 1.0f;
                const float releaseGain = voice.releasing
                    ? std::clamp((float) voice.releaseRemaining / (float) std::max(1, releaseSamples), 0.0f, 1.0f) : 1.0f;
                const float gain = voice.gain * endGain * releaseGain;
                const auto interpolateAt = [&](int channel, double position, bool wrapAtLoopEnd)
                {
                    const int sourceChannel = std::min(channel, sourceChannels - 1);
                    const int index = std::clamp((int) position, playbackStart, playbackEnd - 1);
                    int next = index + 1;
                    if (wrapAtLoopEnd && next >= playbackLoopEnd)
                        next = playbackLoopStart;
                    else
                        next = std::min(next, playbackEnd - 1);
                    const float fraction = (float) (position - (double) index);
                    const float a = sample->audio->getSample(sourceChannel, index);
                    const float b = sample->audio->getSample(sourceChannel, next);
                    return a + (b - a) * fraction;
                };
                const auto interpolate = [&](int channel)
                {
                    float value = interpolateAt(channel, voice.position, playbackLoopEnabled);
                    if (playbackLoopEnabled && loopCrossfadeSamples > 0
                        && voice.position >= (double) (playbackLoopEnd - loopCrossfadeSamples))
                    {
                        const double offset = voice.position - (double) (playbackLoopEnd - loopCrossfadeSamples);
                        const float blend = std::clamp((float) (offset / (double) loopCrossfadeSamples), 0.0f, 1.0f);
                        const double incomingPosition = (double) playbackLoopStart + offset;
                        const float incoming = interpolateAt(channel, incomingPosition, false);
                        value += (incoming - value) * blend;
                    }
                    return value * gain;
                };
                result.left += interpolate(0) * leftPan;
                result.right += interpolate(sourceChannels > 1 ? 1 : 0) * rightPan;
                voice.position += voice.rate;
                if (playbackLoopEnabled && voice.position >= (double) playbackLoopEnd)
                    voice.position = wrapLoopPosition(voice.position);
                ++renderTelemetry.renderedVoiceSamples;
                if (voice.releasing && --voice.releaseRemaining <= 0) voice = {};
                anyReleasing = anyReleasing || (voice.active && voice.releasing);
            }
            hasReleasingVoice = anyReleasing;
            ++renderTelemetry.renderedSamples;
            return result;
        }

        SourceLifecycleState lifecycleState() const noexcept override
        {
            if (!sample)
                return SourceLifecycleState::empty;
            if (activeVoiceCount() == 0)
                return SourceLifecycleState::ready;
            return hasReleasingVoice ? SourceLifecycleState::releasing : SourceLifecycleState::active;
        }

        SourceComplexity complexity() const noexcept override { return SourceComplexity::singleSample; }
        int latencySamples() const noexcept override { return 0; }

        int activeVoiceCount() const noexcept override
        {
            return (int) std::count_if(voices.begin(), voices.end(), [](const Voice& voice) {
                return voice.active;
            });
        }

        uint64_t stateVersion() const noexcept override
        {
            return version.load(std::memory_order_acquire);
        }

        SourceRenderTelemetry telemetry() const noexcept override { return renderTelemetry; }

    private:
        struct Voice
        {
            bool active { false };
            bool releasing { false };
            uint64_t stableNoteId { 0 };
            int midiNote { 60 };
            double position { 0.0 };
            double rate { 1.0 };
            float gain { 0.0f };
            int releaseRemaining { 0 };
        };

        void rebuildPitchRates() noexcept
        {
            const double engineRate = prepared.sampleRate > 0.0 ? prepared.sampleRate : 44100.0;
            const double sourceRate = sample && sample->sourceSampleRate > 0.0 ? sample->sourceSampleRate : engineRate;
            const int root = sample ? std::clamp(sample->rootNote, 0, 127) : 60;
            for (int note = 0; note < 128; ++note)
                pitchRates[(size_t) note] = (sourceRate / engineRate) * std::exp2((double) (note - root) / 12.0);
        }

        void rebuildPlaybackRegion() noexcept
        {
            playbackStart = 0;
            playbackEnd = 2;
            playbackLoopStart = 0;
            playbackLoopEnd = 2;
            playbackLoopEnabled = false;
            loopCrossfadeSamples = 0;
            if (!sample || !sample->isValid())
                return;

            const int sampleCount = sample->audio->getNumSamples();
            const auto finiteRatio = [](float ratio, float fallback)
            {
                return std::clamp(std::isfinite(ratio) ? ratio : fallback, 0.0f, 1.0f);
            };
            float startRatio = finiteRatio(sample->startRatio, 0.0f);
            float endRatio = finiteRatio(sample->endRatio, 1.0f);
            if (endRatio <= startRatio)
            {
                startRatio = 0.0f;
                endRatio = 1.0f;
            }
            const float requestedLoopStart = finiteRatio(sample->loopStartRatio, startRatio);
            const float requestedLoopEnd = finiteRatio(sample->loopEndRatio, endRatio);
            const bool requestedLoopValid = requestedLoopStart >= startRatio
                && requestedLoopEnd <= endRatio
                && requestedLoopEnd > requestedLoopStart;
            const auto ratioToSample = [sampleCount](float ratio)
            {
                return (int) std::round(ratio * (float) sampleCount);
            };
            playbackStart = std::clamp(ratioToSample(startRatio), 0, sampleCount - 2);
            playbackEnd = std::clamp(ratioToSample(endRatio), playbackStart + 2, sampleCount);
            playbackLoopStart = std::clamp(ratioToSample(requestedLoopStart), playbackStart, playbackEnd - 2);
            playbackLoopEnd = std::clamp(ratioToSample(requestedLoopEnd), playbackLoopStart + 2, playbackEnd);
            playbackLoopEnabled = sample->loopEnabled && requestedLoopValid
                && playbackLoopEnd - playbackLoopStart >= 2;
            loopCrossfadeSamples = playbackLoopEnabled
                ? std::min(endFadeSamples, (playbackLoopEnd - playbackLoopStart) / 2)
                : 0;
        }

        double wrapLoopPosition(double position) const noexcept
        {
            const double loopStartAfterCrossfade = (double) (playbackLoopStart + loopCrossfadeSamples);
            const double loopLength = (double) playbackLoopEnd - loopStartAfterCrossfade;
            if (!playbackLoopEnabled || loopLength <= 0.0)
                return position;
            return loopStartAfterCrossfade + std::fmod(position - (double) playbackLoopEnd, loopLength);
        }

        static constexpr int endFadeSamples = 64;
        SourcePrepareSpec prepared;
        std::shared_ptr<const ImmutableSampleSource> sample;
        std::array<double, 128> pitchRates {};
        std::array<Voice, maximumVoices> voices {};
        std::atomic<uint64_t> version { 0 };
        SourceRenderTelemetry renderTelemetry;
        int releaseSamples { 176 };
        int playbackStart { 0 };
        int playbackEnd { 2 };
        int playbackLoopStart { 0 };
        int playbackLoopEnd { 2 };
        int loopCrossfadeSamples { 0 };
        bool playbackLoopEnabled { false };
        bool hasReleasingVoice { false };
    };
}

#pragma once

#include "SampleStreamingSession.h"
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
        std::shared_ptr<SampleStreamingSession> streamingSession;
        size_t streamingAssetIndex { 0 };
        int64_t streamingFrameCount { 0 };
        int streamingChannelCount { 0 };
        double sourceSampleRate { 44100.0 };
        int rootNote { 60 };
        float gain { 1.0f };
        float pan { 0.0f };
        float startRatio { 0.0f };
        float endRatio { 1.0f };
        bool loopEnabled { false };
        float loopStartRatio { 0.0f };
        float loopEndRatio { 1.0f };
        int loNote { 0 };
        int hiNote { 127 };
        int loVelocity { 0 };
        int hiVelocity { 127 };

        bool isValid() const noexcept
        {
            const bool decodedValid = audio && audio->getNumChannels() > 0
                && audio->getNumSamples() > 1;
            const bool streamedValid = streamingSession && streamingFrameCount > 1
                && streamingChannelCount > 0;
            return (decodedValid || streamedValid)
                && std::isfinite(sourceSampleRate)
                && sourceSampleRate > 0.0;
        }

        int frameCount() const noexcept
        {
            return audio ? audio->getNumSamples() : (int) streamingFrameCount;
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
            rebuildReleaseSamples();
            rebuildPitchRates();
            return true;
        }

        bool configurePlayback(bool reverse, float rate, bool pingPong = false,
                               float tailMs = 4.0f) noexcept
        {
            if (activeVoiceCount() != 0)
                return false;
            playbackReverse = reverse;
            playbackRate = std::clamp(std::isfinite(rate) ? rate : 1.0f, 0.25f, 4.0f);
            pingPongLoop = pingPong;
            releaseTailMs = std::clamp(std::isfinite(tailMs) ? tailMs : 4.0f, 1.0f, 2000.0f);
            rebuildReleaseSamples();
            rebuildPitchRates();
            version.fetch_add(1, std::memory_order_release);
            return true;
        }

        bool publish(std::shared_ptr<const ImmutableSampleSource> next) noexcept
        {
            if (activeVoiceCount() != 0 || (next && !next->isValid()))
                return false;

            sample = std::move(next);
            rebuildPlaybackRegion();
            rebuildPitchRates();
            rebuildPanGains();
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
                playbackReverse ? (double) (playbackEnd - 1) : (double) playbackStart,
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

            bool anyReleasing = false;
            for (auto& voice : voices)
            {
                if (!voice.active) continue;
                const bool reverseLeg = voice.rate < 0.0;
                if (!playbackLoopEnabled
                    && ((!reverseLeg && voice.position >= (double) (playbackEnd - 1))
                        || (reverseLeg && voice.position <= (double) playbackStart)))
                {
                    voice = {};
                    continue;
                }
                if (playbackLoopEnabled)
                {
                    if (pingPongLoop)
                        reflectPingPongPosition(voice);
                    else if (!reverseLeg && voice.position >= (double) playbackLoopEnd)
                        voice.position = wrapLoopPosition(voice.position);
                    else if (reverseLeg && voice.position < (double) playbackLoopStart)
                        voice.position = wrapReverseLoopPosition(voice.position);
                }

                const int sourceIndex = std::clamp((int) voice.position, playbackStart, playbackEnd - 1);
                const bool renderingReverseLeg = voice.rate < 0.0;
                const int samplesToEnd = renderingReverseLeg
                    ? sourceIndex - playbackStart : playbackEnd - 1 - sourceIndex;
                const float endGain = !playbackLoopEnabled && samplesToEnd < endFadeSamples
                    ? std::clamp((float) samplesToEnd / (float) endFadeSamples, 0.0f, 1.0f) : 1.0f;
                const float releaseGain = voice.releasing
                    ? std::clamp((float) voice.releaseRemaining / (float) std::max(1, releaseSamples), 0.0f, 1.0f) : 1.0f;
                const float gain = voice.gain * endGain * releaseGain;
                const auto interpolateAt = [&](double position, bool wrapAtLoopEnd,
                                               StereoFrame& interpolated)
                {
                    const int index = std::clamp((int) position, playbackStart, playbackEnd - 1);
                    int next = index + 1;
                    if (wrapAtLoopEnd && next >= playbackLoopEnd)
                        next = playbackLoopStart;
                    else
                        next = std::min(next, playbackEnd - 1);
                    const float fraction = (float) (position - (double) index);
                    StereoFrame a;
                    StereoFrame b;
                    if (!readSourceFrame(index, a) || !readSourceFrame(next, b))
                        return false;
                    interpolated.left = a.left + (b.left - a.left) * fraction;
                    interpolated.right = a.right + (b.right - a.right) * fraction;
                    return true;
                };

                StereoFrame sourceFrame;
                bool sourceAvailable = interpolateAt(voice.position,
                    playbackLoopEnabled && !pingPongLoop, sourceFrame);
                if (sourceAvailable && playbackLoopEnabled && !pingPongLoop
                    && loopCrossfadeSamples > 0
                    && ((!renderingReverseLeg && voice.position >= (double) (playbackLoopEnd - loopCrossfadeSamples))
                        || (renderingReverseLeg && voice.position <= (double) (playbackLoopStart + loopCrossfadeSamples))))
                {
                    const double offset = renderingReverseLeg
                        ? (double) (playbackLoopStart + loopCrossfadeSamples) - voice.position
                        : voice.position - (double) (playbackLoopEnd - loopCrossfadeSamples);
                    const float blend = std::clamp((float) (offset / (double) loopCrossfadeSamples), 0.0f, 1.0f);
                    const double incomingPosition = renderingReverseLeg
                        ? (double) (playbackLoopEnd - 1) - offset
                        : (double) playbackLoopStart + offset;
                    StereoFrame incoming;
                    sourceAvailable = interpolateAt(incomingPosition, false, incoming);
                    if (sourceAvailable)
                    {
                        sourceFrame.left += (incoming.left - sourceFrame.left) * blend;
                        sourceFrame.right += (incoming.right - sourceFrame.right) * blend;
                    }
                }

                if (sample->streamingSession)
                    sourceFrame = applyStreamingTransition(voice, sourceFrame, sourceAvailable);
                result.left += (sourceFrame.left * gain) * panGains[0];
                result.right += (sourceFrame.right * gain) * panGains[1];
                voice.position += voice.rate;
                if (playbackLoopEnabled)
                {
                    const bool nextReverseLeg = voice.rate < 0.0;
                    if (pingPongLoop)
                        reflectPingPongPosition(voice);
                    else if (!nextReverseLeg && voice.position >= (double) playbackLoopEnd)
                        voice.position = wrapLoopPosition(voice.position);
                    else if (nextReverseLeg && voice.position < (double) playbackLoopStart)
                        voice.position = wrapReverseLoopPosition(voice.position);
                }
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
            float lastSourceLeft { 0.0f };
            float lastSourceRight { 0.0f };
            int underflowFadeRemaining { 0 };
            int recoveryFadeRemaining { 0 };
            bool waitingForStream { false };
            bool pingPongActive { false };
        };

        bool readSourceFrame(int index, StereoFrame& frame) noexcept
        {
            if (sample->audio)
            {
                const int channels = sample->audio->getNumChannels();
                frame.left = sample->audio->getSample(0, index);
                frame.right = sample->audio->getSample(channels > 1 ? 1 : 0, index);
                return true;
            }
            BoundedSamplePageCache::StereoFrame streamed;
            if (!sample->streamingSession->readStereoFrame(sample->streamingAssetIndex, index, streamed))
            {
                frame = {};
                return false;
            }
            frame = { streamed.left, streamed.right };
            return true;
        }

        static StereoFrame applyStreamingTransition(Voice& voice, StereoFrame current,
                                                     bool available) noexcept
        {
            if (!available)
            {
                if (!voice.waitingForStream)
                {
                    voice.waitingForStream = true;
                    voice.underflowFadeRemaining = streamTransitionSamples;
                    voice.recoveryFadeRemaining = 0;
                }
                if (voice.underflowFadeRemaining > 0)
                {
                    const float gain = (float) voice.underflowFadeRemaining
                        / (float) streamTransitionSamples;
                    --voice.underflowFadeRemaining;
                    return { voice.lastSourceLeft * gain, voice.lastSourceRight * gain };
                }
                return {};
            }

            if (voice.waitingForStream)
            {
                if (voice.underflowFadeRemaining > 0)
                {
                    const float gain = (float) voice.underflowFadeRemaining
                        / (float) streamTransitionSamples;
                    --voice.underflowFadeRemaining;
                    return { voice.lastSourceLeft * gain, voice.lastSourceRight * gain };
                }
                voice.waitingForStream = false;
                voice.recoveryFadeRemaining = streamTransitionSamples;
            }
            if (voice.recoveryFadeRemaining > 0)
            {
                const float gain = 1.0f - (float) voice.recoveryFadeRemaining
                    / (float) streamTransitionSamples;
                --voice.recoveryFadeRemaining;
                current.left *= gain;
                current.right *= gain;
            }
            voice.lastSourceLeft = current.left;
            voice.lastSourceRight = current.right;
            return current;
        }

        void rebuildPitchRates() noexcept
        {
            const double engineRate = prepared.sampleRate > 0.0 ? prepared.sampleRate : 44100.0;
            const double sourceRate = sample && sample->sourceSampleRate > 0.0 ? sample->sourceSampleRate : engineRate;
            const int root = sample ? std::clamp(sample->rootNote, 0, 127) : 60;
            for (int note = 0; note < 128; ++note)
                pitchRates[(size_t) note] = (playbackReverse ? -1.0 : 1.0)
                    * (double) playbackRate * (sourceRate / engineRate)
                    * std::exp2((double) (note - root) / 12.0);
        }

        void rebuildReleaseSamples() noexcept
        {
            const double engineRate = prepared.sampleRate > 0.0 ? prepared.sampleRate : 44100.0;
            releaseSamples = std::clamp((int) std::round(
                engineRate * (double) releaseTailMs * 0.001), 8, 384000);
        }

        void rebuildPanGains() noexcept
        {
            const float pan = sample ? std::clamp(sample->pan, -1.0f, 1.0f) : 0.0f;
            panGains = {
                std::sqrt(0.5f * (1.0f - pan)),
                std::sqrt(0.5f * (1.0f + pan)),
            };
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

            const int sampleCount = sample->frameCount();
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

        double wrapReverseLoopPosition(double position) const noexcept
        {
            const double loopEndBeforeCrossfade = (double) (playbackLoopEnd - 1 - loopCrossfadeSamples);
            const double loopLength = loopEndBeforeCrossfade - (double) playbackLoopStart;
            if (!playbackLoopEnabled || loopLength <= 0.0)
                return position;
            return loopEndBeforeCrossfade
                - std::fmod((double) playbackLoopStart - position, loopLength);
        }

        void reflectPingPongPosition(Voice& voice) const noexcept
        {
            const double low = (double) playbackLoopStart;
            const double high = (double) (playbackLoopEnd - 1);
            const double span = high - low;
            if (!playbackLoopEnabled || !pingPongLoop || span <= 0.0)
                return;
            if (!voice.pingPongActive)
            {
                if ((voice.rate >= 0.0 && voice.position < high)
                    || (voice.rate < 0.0 && voice.position > low))
                    return;
                voice.pingPongActive = true;
            }
            const double magnitude = std::abs(voice.rate);
            if (voice.rate >= 0.0)
            {
                if (voice.position < high)
                    return;
                const double period = span * 2.0;
                const double folded = std::fmod(
                    std::max(0.0, voice.position - high), period);
                if (folded <= span)
                {
                    voice.position = high - folded;
                    voice.rate = -magnitude;
                }
                else
                {
                    voice.position = low + (folded - span);
                    voice.rate = magnitude;
                }
            }
            else
            {
                if (voice.position > low)
                    return;
                const double period = span * 2.0;
                const double folded = std::fmod(
                    std::max(0.0, low - voice.position), period);
                if (folded <= span)
                {
                    voice.position = low + folded;
                    voice.rate = magnitude;
                }
                else
                {
                    voice.position = high - (folded - span);
                    voice.rate = -magnitude;
                }
            }
        }

        static constexpr int endFadeSamples = 64;
        static constexpr int streamTransitionSamples = 64;
        SourcePrepareSpec prepared;
        std::shared_ptr<const ImmutableSampleSource> sample;
        std::array<double, 128> pitchRates {};
        std::array<float, 2> panGains {{ 0.70710678f, 0.70710678f }};
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
        bool playbackReverse { false };
        bool pingPongLoop { false };
        float playbackRate { 1.0f };
        float releaseTailMs { 4.0f };
        bool hasReleasingVoice { false };
    };
}

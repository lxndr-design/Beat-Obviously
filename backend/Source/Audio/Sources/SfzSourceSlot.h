#pragma once

#include "SourceSlot.h"
#include "../Sampler/SfzSampleDecoder.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <limits>
#include <memory>

namespace beat
{
    class SfzSourceSlot final : public SourceSlot
    {
    public:
        static constexpr int maximumVoices = 16;
        static constexpr size_t maximumCandidatesPerNote =
            SfzSampleResolutionLimits::hardMaximumCandidatesPerNote;

        struct SfzTelemetry
        {
            uint64_t candidateScans { 0 };
            uint64_t voicesStarted { 0 };
            uint64_t noteCapacityRejects { 0 };
            uint64_t publicationRejects { 0 };
            uint64_t retiredPublications { 0 };
        };

        struct StereoFrame { float left { 0.0f }; float right { 0.0f }; };

        bool prepare(const SourcePrepareSpec& next) noexcept override
        {
            if (!std::isfinite(next.sampleRate) || next.sampleRate <= 0.0
                || next.maximumBlockSize <= 0 || next.outputChannels <= 0)
                return false;
            prepared = next;
            rebuildReleaseSamples();
            return true;
        }

        bool publish(std::shared_ptr<const SfzDecodedInstrument> next) noexcept
        {
            if (activeVoices.load(std::memory_order_acquire) != 0
                || (next && !validateInstrument(*next)))
            {
                publicationRejects.fetch_add(1, std::memory_order_relaxed);
                return false;
            }

            const uint8_t oldBank = publishedBank.load(std::memory_order_acquire);
            const uint8_t nextBank = (uint8_t) (1U - oldBank);
            if (bankReaders[nextBank].load(std::memory_order_acquire) != 0)
            {
                publicationRejects.fetch_add(1, std::memory_order_relaxed);
                return false;
            }

            retireBank(nextBank);
            bankOwners[nextBank] = std::move(next);
            bankPointers[nextBank].store(bankOwners[nextBank].get(), std::memory_order_release);
            publishedBank.store(nextBank, std::memory_order_release);

            if (bankReaders[oldBank].load(std::memory_order_acquire) == 0)
                retireBank(oldBank);
            version.fetch_add(1, std::memory_order_release);
            return true;
        }

        bool configurePlayback(bool reverse, float rate, bool pingPong = false,
                               float tailMs = 4.0f, float trimStart = 0.0f,
                               float trimEnd = 1.0f) noexcept
        {
            if (activeVoices.load(std::memory_order_acquire) != 0)
                return false;
            playbackReverse = reverse;
            playbackRate = std::clamp(std::isfinite(rate) ? rate : 1.0f, 0.25f, 4.0f);
            pingPongLoop = pingPong;
            releaseTailMs = std::clamp(std::isfinite(tailMs) ? tailMs : 4.0f, 1.0f, 2000.0f);
            trimStartRatio = std::clamp(std::isfinite(trimStart) ? trimStart : 0.0f, 0.0f, 1.0f);
            trimEndRatio = std::clamp(std::isfinite(trimEnd) ? trimEnd : 1.0f,
                trimStartRatio, 1.0f);
            if (trimEndRatio <= trimStartRatio)
            {
                trimStartRatio = 0.0f;
                trimEndRatio = 1.0f;
            }
            rebuildReleaseSamples();
            version.fetch_add(1, std::memory_order_release);
            return true;
        }

        std::shared_ptr<const SfzDecodedInstrument> takeRetiredInstrument() noexcept
        {
            const uint8_t current = publishedBank.load(std::memory_order_acquire);
            const uint8_t inactive = (uint8_t) (1U - current);
            if (bankReaders[inactive].load(std::memory_order_acquire) == 0)
                retireBank(inactive);
            return std::move(retiredInstrument);
        }

        void reset() noexcept override
        {
            for (auto& voice : voices)
                stopVoice(voice);
            renderTelemetry = {};
            candidateScans.store(0, std::memory_order_relaxed);
            voicesStarted.store(0, std::memory_order_relaxed);
            noteCapacityRejects.store(0, std::memory_order_relaxed);
            publicationRejects.store(0, std::memory_order_relaxed);
            retiredPublications.store(0, std::memory_order_relaxed);
        }

        bool noteOn(const SourceNoteEvent& event) noexcept override
        {
            if (event.midiNote < 0 || event.midiNote > 127)
            {
                ++renderTelemetry.rejectedNoteEvents;
                return false;
            }

            uint8_t bank = 0;
            const SfzDecodedInstrument* instrument = nullptr;
            if (!acquirePublishedBank(bank, instrument))
            {
                ++renderTelemetry.rejectedNoteEvents;
                return false;
            }

            const auto selection = selectRegions(*instrument, event);
            const int requiredVoices = selection.second >= 0 ? 2 : (selection.first >= 0 ? 1 : 0);
            std::array<int, 2> freeVoices { -1, -1 };
            int found = 0;
            for (size_t index = 0; index < voices.size() && found < requiredVoices; ++index)
                if (!voices[index].active)
                    freeVoices[(size_t) found++] = (int) index;
            if (requiredVoices == 0 || found != requiredVoices)
            {
                releaseBank(bank);
                if (requiredVoices > 0)
                    noteCapacityRejects.fetch_add(1, std::memory_order_relaxed);
                ++renderTelemetry.rejectedNoteEvents;
                return false;
            }

            if (requiredVoices == 2)
                bankReaders[bank].fetch_add(1, std::memory_order_acq_rel);
            initialiseVoice(voices[(size_t) freeVoices[0]], bank, selection.first,
                            event, selection.firstGain, *instrument);
            if (requiredVoices == 2)
                initialiseVoice(voices[(size_t) freeVoices[1]], bank, selection.second,
                                event, selection.secondGain, *instrument);
            activeVoices.fetch_add(requiredVoices, std::memory_order_release);
            voicesStarted.fetch_add((uint64_t) requiredVoices, std::memory_order_relaxed);
            ++renderTelemetry.acceptedNoteEvents;
            return true;
        }

        void noteOff(uint64_t stableNoteId) noexcept override
        {
            for (auto& voice : voices)
            {
                if (!voice.active || voice.stableNoteId != stableNoteId)
                    continue;
                if (voice.loopMode == LoopMode::oneShot)
                    continue;
                voice.releasing = true;
                voice.releaseRemaining = releaseSamples;
            }
        }

        void allNotesOff(bool immediate) noexcept override
        {
            for (auto& voice : voices)
            {
                if (!voice.active) continue;
                if (immediate)
                    stopVoice(voice);
                else if (voice.loopMode != LoopMode::oneShot)
                {
                    voice.releasing = true;
                    voice.releaseRemaining = releaseSamples;
                }
            }
        }

        void render(juce::AudioBuffer<float>& output, int startSample, int numSamples) noexcept override
        {
            if (numSamples <= 0 || output.getNumChannels() <= 0)
                return;
            const int outputStart = std::clamp(startSample, 0, output.getNumSamples());
            const int outputEnd = std::clamp(outputStart + numSamples,
                                             outputStart, output.getNumSamples());
            for (int outputSample = outputStart; outputSample < outputEnd; ++outputSample)
            {
                const auto frame = renderInternalFrame();
                output.addSample(0, outputSample, frame.left);
                if (output.getNumChannels() > 1)
                    output.addSample(1, outputSample, frame.right);
                for (int channel = 2; channel < output.getNumChannels(); ++channel)
                    output.addSample(channel, outputSample, (frame.left + frame.right) * 0.5f);
            }
        }

        StereoFrame renderFrame() noexcept
        {
            const auto frame = renderInternalFrame();
            return { frame.left, frame.right };
        }

        SourceLifecycleState lifecycleState() const noexcept override
        {
            if (currentInstrument() == nullptr) return SourceLifecycleState::empty;
            if (activeVoices.load(std::memory_order_acquire) == 0)
                return SourceLifecycleState::ready;
            for (const auto& voice : voices)
                if (voice.active && voice.releasing)
                    return SourceLifecycleState::releasing;
            return SourceLifecycleState::active;
        }

        SourceComplexity complexity() const noexcept override { return SourceComplexity::mappedSample; }
        int latencySamples() const noexcept override { return 0; }
        int activeVoiceCount() const noexcept override
        {
            return activeVoices.load(std::memory_order_acquire);
        }
        uint64_t stateVersion() const noexcept override
        {
            return version.load(std::memory_order_acquire);
        }
        SourceRenderTelemetry telemetry() const noexcept override { return renderTelemetry; }
        SfzTelemetry sfzTelemetry() const noexcept
        {
            return {
                candidateScans.load(std::memory_order_relaxed),
                voicesStarted.load(std::memory_order_relaxed),
                noteCapacityRejects.load(std::memory_order_relaxed),
                publicationRejects.load(std::memory_order_relaxed),
                retiredPublications.load(std::memory_order_relaxed),
            };
        }

    private:
        enum class LoopMode : uint8_t
        {
            none,
            continuous,
            sustain,
            oneShot,
        };

        struct Voice
        {
            bool active { false };
            bool releasing { false };
            uint8_t bank { 0 };
            uint16_t regionIndex { 0 };
            uint64_t stableNoteId { 0 };
            double position { 0.0 };
            double rate { 1.0 };
            float gain { 0.0f };
            float leftPan { 0.70710678f };
            float rightPan { 0.70710678f };
            int playbackStart { 0 };
            int playbackEnd { 2 };
            int loopStart { 0 };
            int loopEnd { 2 };
            int loopCrossfade { 0 };
            int attackRemaining { transitionSamples };
            int releaseRemaining { 0 };
            LoopMode loopMode { LoopMode::none };
            bool pingPongActive { false };
        };

        struct RegionSelection
        {
            int first { -1 };
            int second { -1 };
            float firstGain { 1.0f };
            float secondGain { 0.0f };
        };

        static bool validateInstrument(const SfzDecodedInstrument& instrument) noexcept
        {
            if (instrument.regions.empty() || instrument.regions.size() > 256
                || instrument.samples.empty() || instrument.samples.size() > 256)
                return false;
            for (const auto& sample : instrument.samples)
            {
                if (!sample.audio || sample.audio->getNumSamples() <= 1
                    || sample.audio->getNumChannels() <= 0 || sample.audio->getNumChannels() > 2
                    || !std::isfinite(sample.sourceSampleRate) || sample.sourceSampleRate <= 0.0)
                    return false;
                for (int channel = 0; channel < sample.audio->getNumChannels(); ++channel)
                    for (int frame = 0; frame < sample.audio->getNumSamples(); ++frame)
                        if (!std::isfinite(sample.audio->getSample(channel, frame)))
                            return false;
            }
            for (const auto& region : instrument.regions)
            {
                const auto& definition = region.definition;
                if (region.sampleIndex >= instrument.samples.size()
                    || definition.trigger != "attack"
                    || definition.sequenceLength != 1 || definition.sequencePosition != 1
                    || definition.group != 0 || definition.offBy != 0
                    || definition.rootNote < 0 || definition.rootNote > 127
                    || definition.loNote < 0 || definition.hiNote > 127
                    || definition.loNote > definition.hiNote
                    || definition.loVelocity < 0 || definition.hiVelocity > 127
                    || definition.loVelocity > definition.hiVelocity
                    || !std::isfinite(definition.tuneCents)
                    || definition.tuneCents < -1200.0 || definition.tuneCents > 1200.0
                    || !std::isfinite(definition.volumeDb)
                    || definition.volumeDb < -144.0 || definition.volumeDb > 24.0
                    || !std::isfinite(definition.panPercent)
                    || definition.panPercent < -100.0 || definition.panPercent > 100.0
                    || (definition.loopMode != "no_loop"
                        && definition.loopMode != "one_shot"
                        && definition.loopMode != "loop_continuous"
                        && definition.loopMode != "loop_sustain"))
                    return false;
                const int frames = instrument.samples[region.sampleIndex].audio->getNumSamples();
                if (definition.endFrame >= frames)
                    return false;
                const int64_t endExclusive = definition.endFrame > 0
                    ? definition.endFrame + 1 : frames;
                if (definition.offsetFrames < 0 || definition.offsetFrames >= frames - 1
                    || endExclusive <= definition.offsetFrames || endExclusive > frames)
                    return false;
                const bool looped = definition.loopMode == "loop_continuous"
                    || definition.loopMode == "loop_sustain";
                if (looped && (definition.loopStartFrame < definition.offsetFrames
                    || definition.loopEndFrame <= definition.loopStartFrame
                    || definition.loopEndFrame >= endExclusive))
                    return false;
            }
            for (size_t note = 0; note < instrument.noteIndex.size(); ++note)
            {
                const auto& candidates = instrument.noteIndex[note];
                if (candidates.count > maximumCandidatesPerNote) return false;
                for (size_t index = 0; index < candidates.count; ++index)
                {
                    const auto regionIndex = candidates.indices[index];
                    if (regionIndex >= instrument.regions.size()) return false;
                    const auto& definition = instrument.regions[regionIndex].definition;
                    if ((int) note < definition.loNote || (int) note > definition.hiNote)
                        return false;
                }
            }
            return true;
        }

        RegionSelection selectRegions(const SfzDecodedInstrument& instrument,
                                      const SourceNoteEvent& event) noexcept
        {
            const int velocity = std::clamp((int) std::round(
                std::clamp(event.velocity, 0.0f, 1.0f) * 127.0f), 0, 127);
            const auto& candidates = instrument.noteIndex[(size_t) event.midiNote];
            int best = -1;
            int second = -1;
            int bestSpan = std::numeric_limits<int>::max();
            int secondSpan = std::numeric_limits<int>::max();
            for (size_t candidate = 0; candidate < candidates.count; ++candidate)
            {
                candidateScans.fetch_add(1, std::memory_order_relaxed);
                const int index = candidates.indices[candidate];
                const auto& region = instrument.regions[(size_t) index].definition;
                if (velocity < region.loVelocity || velocity > region.hiVelocity)
                    continue;
                const int span = (region.hiNote - region.loNote) * 128
                    + (region.hiVelocity - region.loVelocity);
                if (span < bestSpan)
                {
                    second = best;
                    secondSpan = bestSpan;
                    best = index;
                    bestSpan = span;
                }
                else if (span < secondSpan)
                {
                    second = index;
                    secondSpan = span;
                }
            }
            if (best < 0 || second < 0)
                return { best, -1, 1.0f, 0.0f };

            const auto& first = instrument.regions[(size_t) best].definition;
            const auto& next = instrument.regions[(size_t) second].definition;
            if (first.loNote == next.loNote && first.hiNote == next.hiNote
                && first.loVelocity == next.loVelocity && first.hiVelocity == next.hiVelocity)
                return { best, -1, 1.0f, 0.0f };

            const auto overlapGains = [](int firstLow, int firstHigh,
                                         int secondLow, int secondHigh, int value)
            {
                const int firstCentre = firstLow + firstHigh;
                const int secondCentre = secondLow + secondHigh;
                if (firstCentre == secondCentre)
                    return std::array<float, 2> { 1.0f, 0.0f };
                const int overlapLow = std::max(firstLow, secondLow);
                const int overlapHigh = std::min(firstHigh, secondHigh);
                const float position = overlapHigh == overlapLow ? 0.5f
                    : std::clamp((float) (value - overlapLow)
                        / (float) (overlapHigh - overlapLow), 0.0f, 1.0f);
                const float low = std::cos(position * juce::MathConstants<float>::halfPi);
                const float high = std::sin(position * juce::MathConstants<float>::halfPi);
                return firstCentre < secondCentre
                    ? std::array<float, 2> { low, high }
                    : std::array<float, 2> { high, low };
            };
            auto gains = overlapGains(first.loNote, first.hiNote,
                                      next.loNote, next.hiNote, event.midiNote);
            if (first.loNote + first.hiNote == next.loNote + next.hiNote)
                gains = overlapGains(first.loVelocity, first.hiVelocity,
                                     next.loVelocity, next.hiVelocity, velocity);
            if (gains[1] <= 0.000001f) return { best, -1, 1.0f, 0.0f };
            if (gains[0] <= 0.000001f) return { second, -1, 1.0f, 0.0f };
            return { best, second, gains[0], gains[1] };
        }

        bool acquirePublishedBank(uint8_t& bank,
                                  const SfzDecodedInstrument*& instrument) noexcept
        {
            for (int attempt = 0; attempt < 3; ++attempt)
            {
                bank = publishedBank.load(std::memory_order_acquire);
                bankReaders[bank].fetch_add(1, std::memory_order_acq_rel);
                if (publishedBank.load(std::memory_order_acquire) == bank)
                {
                    instrument = bankPointers[bank].load(std::memory_order_acquire);
                    if (instrument != nullptr) return true;
                }
                releaseBank(bank);
            }
            instrument = nullptr;
            return false;
        }

        void initialiseVoice(Voice& voice, uint8_t bank, int regionIndex,
                             const SourceNoteEvent& event, float selectionGain,
                             const SfzDecodedInstrument& instrument) noexcept
        {
            const auto& region = instrument.regions[(size_t) regionIndex];
            const auto& definition = region.definition;
            const auto& sample = instrument.samples[region.sampleIndex];
            const int frames = sample.audio->getNumSamples();
            const int originalStart = (int) definition.offsetFrames;
            const int originalEnd = definition.endFrame > 0 ? (int) definition.endFrame + 1 : frames;
            const int originalLength = originalEnd - originalStart;
            const int start = std::clamp(originalStart
                + (int) std::round((double) originalLength * trimStartRatio),
                originalStart, originalEnd - 2);
            const int end = std::clamp(originalStart
                + (int) std::round((double) originalLength * trimEndRatio),
                start + 2, originalEnd);
            const float pan = std::clamp((float) definition.panPercent / 100.0f, -1.0f, 1.0f);
            const float velocity = std::clamp(event.velocity, 0.0f, 1.0f);
            const double semitones = (double) (event.midiNote - definition.rootNote)
                + definition.tuneCents / 100.0;
            const auto mode = definition.loopMode == "loop_continuous" ? LoopMode::continuous
                : definition.loopMode == "loop_sustain" ? LoopMode::sustain
                : definition.loopMode == "one_shot" ? LoopMode::oneShot : LoopMode::none;
            voice = {};
            voice.active = true;
            voice.bank = bank;
            voice.regionIndex = (uint16_t) regionIndex;
            voice.stableNoteId = event.stableNoteId;
            voice.position = playbackReverse ? (double) (end - 1) : (double) start;
            voice.rate = (playbackReverse ? -1.0 : 1.0) * (double) playbackRate
                * (sample.sourceSampleRate / prepared.sampleRate) * std::exp2(semitones / 12.0);
            voice.gain = velocity * selectionGain
                * std::pow(10.0f, (float) definition.volumeDb / 20.0f);
            voice.leftPan = std::sqrt(0.5f * (1.0f - pan));
            voice.rightPan = std::sqrt(0.5f * (1.0f + pan));
            voice.playbackStart = start;
            voice.playbackEnd = end;
            voice.loopStart = mode == LoopMode::continuous || mode == LoopMode::sustain
                ? std::max(start, (int) definition.loopStartFrame) : start;
            voice.loopEnd = mode == LoopMode::continuous || mode == LoopMode::sustain
                ? std::min(end, (int) definition.loopEndFrame + 1) : end;
            if (voice.loopEnd - voice.loopStart < 2)
            {
                voice.loopStart = start;
                voice.loopEnd = end;
            }
            voice.loopCrossfade = mode == LoopMode::continuous || mode == LoopMode::sustain
                ? std::min(transitionSamples, (voice.loopEnd - voice.loopStart) / 2) : 0;
            voice.attackRemaining = transitionSamples;
            voice.loopMode = mode;
        }

        StereoFrame renderInternalFrame() noexcept
        {
            StereoFrame result;
            for (auto& voice : voices)
            {
                if (!voice.active) continue;
                const auto* instrument = bankPointers[voice.bank].load(std::memory_order_acquire);
                if (instrument == nullptr || voice.regionIndex >= instrument->regions.size())
                {
                    stopVoice(voice);
                    continue;
                }
                const auto& region = instrument->regions[voice.regionIndex];
                if (region.sampleIndex >= instrument->samples.size())
                {
                    stopVoice(voice);
                    continue;
                }
                const auto& audio = *instrument->samples[region.sampleIndex].audio;
                const bool looping = voice.loopMode == LoopMode::continuous
                    || (voice.loopMode == LoopMode::sustain && !voice.releasing);
                const bool reverseLeg = voice.rate < 0.0;
                if (!looping
                    && ((!reverseLeg && voice.position >= (double) (voice.playbackEnd - 1))
                        || (reverseLeg && voice.position <= (double) voice.playbackStart)))
                {
                    stopVoice(voice);
                    continue;
                }
                if (looping)
                {
                    if (pingPongLoop)
                        reflectPingPongPosition(voice);
                    else if (!reverseLeg && voice.position >= (double) voice.loopEnd)
                        voice.position = wrapLoopPosition(voice);
                    else if (reverseLeg && voice.position < (double) voice.loopStart)
                        voice.position = wrapReverseLoopPosition(voice);
                }

                const auto interpolate = [&](double position, bool wrap,
                                             StereoFrame& output)
                {
                    const int index = std::clamp((int) position,
                                                 voice.playbackStart, voice.playbackEnd - 1);
                    int next = index + 1;
                    if (wrap && next >= voice.loopEnd) next = voice.loopStart;
                    else next = std::min(next, voice.playbackEnd - 1);
                    const float fraction = (float) (position - (double) index);
                    const int right = audio.getNumChannels() > 1 ? 1 : 0;
                    const float aLeft = audio.getSample(0, index);
                    const float bLeft = audio.getSample(0, next);
                    const float aRight = audio.getSample(right, index);
                    const float bRight = audio.getSample(right, next);
                    output.left = aLeft + (bLeft - aLeft) * fraction;
                    output.right = aRight + (bRight - aRight) * fraction;
                };

                StereoFrame source;
                interpolate(voice.position, looping && !pingPongLoop, source);
                const bool renderingReverseLeg = voice.rate < 0.0;
                if (looping && !pingPongLoop && voice.loopCrossfade > 0
                    && ((!renderingReverseLeg && voice.position >= (double) (voice.loopEnd - voice.loopCrossfade))
                        || (renderingReverseLeg && voice.position <= (double) (voice.loopStart + voice.loopCrossfade))))
                {
                    const double offset = renderingReverseLeg
                        ? (double) (voice.loopStart + voice.loopCrossfade) - voice.position
                        : voice.position - (double) (voice.loopEnd - voice.loopCrossfade);
                    const float blend = std::clamp((float) (offset / voice.loopCrossfade), 0.0f, 1.0f);
                    StereoFrame incoming;
                    interpolate(renderingReverseLeg
                        ? (double) (voice.loopEnd - 1) - offset
                        : (double) voice.loopStart + offset, false, incoming);
                    source.left += (incoming.left - source.left) * blend;
                    source.right += (incoming.right - source.right) * blend;
                }

                const int samplesToEnd = renderingReverseLeg
                    ? (int) voice.position - voice.playbackStart
                    : voice.playbackEnd - 1 - (int) voice.position;
                const float endGain = !looping && samplesToEnd < transitionSamples
                    ? std::clamp((float) samplesToEnd / transitionSamples, 0.0f, 1.0f) : 1.0f;
                const float attackGain = voice.attackRemaining > 0
                    ? 1.0f - (float) voice.attackRemaining / transitionSamples : 1.0f;
                const float releaseGain = voice.releasing
                    ? std::clamp((float) voice.releaseRemaining
                        / std::max(1, releaseSamples), 0.0f, 1.0f) : 1.0f;
                const float gain = voice.gain * endGain * attackGain * releaseGain;
                result.left += source.left * gain * voice.leftPan;
                result.right += source.right * gain * voice.rightPan;
                if (voice.attackRemaining > 0) --voice.attackRemaining;
                voice.position += voice.rate;
                if (looping)
                {
                    const bool nextReverseLeg = voice.rate < 0.0;
                    if (pingPongLoop)
                        reflectPingPongPosition(voice);
                    else if (!nextReverseLeg && voice.position >= (double) voice.loopEnd)
                        voice.position = wrapLoopPosition(voice);
                    else if (nextReverseLeg && voice.position < (double) voice.loopStart)
                        voice.position = wrapReverseLoopPosition(voice);
                }
                ++renderTelemetry.renderedVoiceSamples;
                if (voice.releasing && --voice.releaseRemaining <= 0)
                    stopVoice(voice);
            }
            ++renderTelemetry.renderedSamples;
            return result;
        }

        static double wrapLoopPosition(const Voice& voice) noexcept
        {
            const double startAfterCrossfade = (double) (voice.loopStart + voice.loopCrossfade);
            const double length = (double) voice.loopEnd - startAfterCrossfade;
            if (length <= 0.0) return (double) voice.loopStart;
            return startAfterCrossfade
                + std::fmod(voice.position - (double) voice.loopEnd, length);
        }

        static double wrapReverseLoopPosition(const Voice& voice) noexcept
        {
            const double endBeforeCrossfade = (double) (voice.loopEnd - 1 - voice.loopCrossfade);
            const double length = endBeforeCrossfade - (double) voice.loopStart;
            if (length <= 0.0) return (double) (voice.loopEnd - 1);
            return endBeforeCrossfade
                - std::fmod((double) voice.loopStart - voice.position, length);
        }

        void reflectPingPongPosition(Voice& voice) const noexcept
        {
            const double low = (double) voice.loopStart;
            const double high = (double) (voice.loopEnd - 1);
            const double span = high - low;
            if (!pingPongLoop || span <= 0.0)
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

        void rebuildReleaseSamples() noexcept
        {
            const double engineRate = prepared.sampleRate > 0.0 ? prepared.sampleRate : 44100.0;
            releaseSamples = std::clamp((int) std::round(
                engineRate * (double) releaseTailMs * 0.001), 8, 384000);
        }

        void stopVoice(Voice& voice) noexcept
        {
            if (!voice.active) return;
            const uint8_t bank = voice.bank;
            voice = {};
            activeVoices.fetch_sub(1, std::memory_order_release);
            releaseBank(bank);
        }

        void releaseBank(uint8_t bank) noexcept
        {
            bankReaders[bank].fetch_sub(1, std::memory_order_acq_rel);
        }

        void retireBank(uint8_t bank) noexcept
        {
            if (bankReaders[bank].load(std::memory_order_acquire) != 0)
                return;
            if (bankOwners[bank])
            {
                retiredInstrument = std::move(bankOwners[bank]);
                retiredPublications.fetch_add(1, std::memory_order_relaxed);
            }
            bankPointers[bank].store(nullptr, std::memory_order_release);
        }

        const SfzDecodedInstrument* currentInstrument() const noexcept
        {
            const uint8_t bank = publishedBank.load(std::memory_order_acquire);
            return bankPointers[bank].load(std::memory_order_acquire);
        }

        static constexpr int transitionSamples = 64;
        SourcePrepareSpec prepared;
        std::array<Voice, maximumVoices> voices {};
        std::array<std::shared_ptr<const SfzDecodedInstrument>, 2> bankOwners;
        std::array<std::atomic<const SfzDecodedInstrument*>, 2> bankPointers {};
        std::array<std::atomic<uint32_t>, 2> bankReaders {};
        std::shared_ptr<const SfzDecodedInstrument> retiredInstrument;
        std::atomic<uint8_t> publishedBank { 0 };
        std::atomic<int> activeVoices { 0 };
        std::atomic<uint64_t> version { 0 };
        std::atomic<uint64_t> candidateScans { 0 };
        std::atomic<uint64_t> voicesStarted { 0 };
        std::atomic<uint64_t> noteCapacityRejects { 0 };
        std::atomic<uint64_t> publicationRejects { 0 };
        std::atomic<uint64_t> retiredPublications { 0 };
        SourceRenderTelemetry renderTelemetry;
        int releaseSamples { 176 };
        bool playbackReverse { false };
        bool pingPongLoop { false };
        float playbackRate { 1.0f };
        float releaseTailMs { 4.0f };
        float trimStartRatio { 0.0f };
        float trimEndRatio { 1.0f };
    };
}

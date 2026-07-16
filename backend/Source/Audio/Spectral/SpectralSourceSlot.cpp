#include "SpectralSourceSlot.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace beat
{
    namespace
    {
        constexpr double pi = juce::MathConstants<double>::pi;
        constexpr double twoPi = juce::MathConstants<double>::twoPi;
        double wrap(double value) noexcept
        {
            value = std::fmod(value + pi, twoPi);
            if (value < 0.0) value += twoPi;
            return value - pi;
        }

        double besselI0(double value) noexcept
        {
            double sum = 1.0;
            double term = 1.0;
            const double quarterSquare = value * value * 0.25;
            for (int order = 1; order <= 32; ++order)
            {
                term *= quarterSquare / (double) (order * order);
                sum += term;
                if (term < sum * 1.0e-16) break;
            }
            return sum;
        }
    }

    bool PreparedSpectralSource::isValid() const noexcept
    {
        if (!validated || !artifact) return false;
        return absolutePeakPhases.size() == artifact->peakBins.size() * 2u
            && rootNote >= 0 && rootNote <= 127
            && std::isfinite(level) && level >= 0.0f && level <= 2.0f
            && std::isfinite(pan) && pan >= -1.0f && pan <= 1.0f
            && std::isfinite(stereoWidth) && stereoWidth >= 0.0f && stereoWidth <= 2.0f
            && std::isfinite(position) && position >= 0.0f && position <= 1.0f
            && std::isfinite(pitchSemitones)
            && std::abs(pitchSemitones) <= maximumPitchSemitones;
    }

    SpectralPrepareResult prepareSpectralSource(std::shared_ptr<const SpectralArtifact> artifact,
                                                int rootNote, float level, float pan,
                                                float width, float position,
                                                float pitch, bool freeze)
    {
        if (!artifact) return { {}, "spectral.playback-artifact", "spectral artifact is missing" };
        const auto validation = validateSpectralArtifact(*artifact);
        if (!validation.ok) return { {}, validation.code, validation.message };
        auto prepared = std::make_shared<PreparedSpectralSource>();
        prepared->artifact = std::move(artifact);
        prepared->rootNote = rootNote;
        prepared->level = level;
        prepared->pan = pan;
        prepared->stereoWidth = width;
        prepared->position = position;
        prepared->pitchSemitones = pitch;
        prepared->freeze = freeze;
        prepared->absolutePeakPhases.resize(prepared->artifact->peakBins.size() * 2u);
        for (int frame = 0; frame < prepared->artifact->frames; ++frame)
        {
            const uint32_t begin = prepared->artifact->peakOffsets[(size_t) frame];
            const uint32_t end = prepared->artifact->peakOffsets[(size_t) frame + 1u];
            const uint32_t previousBegin = frame == 0 ? 0u : prepared->artifact->peakOffsets[(size_t) frame - 1u];
            for (uint32_t peak = begin; peak < end; ++peak)
                for (int channel = 0; channel < 2; ++channel)
                {
                    const double evolution = prepared->artifact->peakPhaseEvolution[
                        (size_t) channel * prepared->artifact->peakBins.size() + peak];
                    double phase = evolution;
                    const auto predecessor = prepared->artifact->peakPreviousIndices[peak];
                    if (predecessor != SpectralArtifact::noPreviousPeak)
                    {
                        const size_t prior = (size_t) previousBegin + predecessor;
                        const double expected = twoPi * prepared->artifact->peakBins[peak]
                            * SpectralArtifact::hopSize / SpectralArtifact::fftSize;
                        phase = prepared->absolutePeakPhases[
                            (size_t) channel * prepared->artifact->peakBins.size() + prior] + expected + evolution;
                    }
                    prepared->absolutePeakPhases[(size_t) channel * prepared->artifact->peakBins.size() + peak] = phase;
                }
        }
        prepared->validated = true;
        if (!prepared->isValid())
            return { {}, "spectral.playback-parameters", "prepared spectral source parameters are invalid" };
        return { std::move(prepared), {}, {} };
    }

    SpectralSourceSlot::SpectralSourceSlot()
        : voices(std::make_unique<std::array<Voice, maximumVoices>>())
    {
        for (int n = 0; n < SpectralArtifact::fftSize; ++n)
            window[(size_t) n] = (float) std::sqrt(0.5 - 0.5 * std::cos(twoPi * n / SpectralArtifact::fftSize));
        rebuildResampler();
    }

    bool SpectralSourceSlot::prepare(const SourcePrepareSpec& spec) noexcept
    {
        if (!std::isfinite(spec.sampleRate) || spec.sampleRate <= 0.0
            || spec.maximumBlockSize <= 0 || spec.outputChannels <= 0) return false;
        const double previousRate = prepared.sampleRate;
        const int previousPositionCrossfadeSamples = positionCrossfadeSamples;
        prepared = spec;
        canonicalPerHostSample = SpectralArtifact::sampleRate / prepared.sampleRate;
        releaseSamples = std::clamp((int) std::round(prepared.sampleRate * 0.004), 8, 2048);
        positionCrossfadeSamples = std::clamp((int) std::round(prepared.sampleRate * 0.005), 8, 4096);
        if (previousRate > 0.0 && previousRate != prepared.sampleRate)
            for (auto& voice : *voices) if (voice.active && voice.positionCrossfading)
                voice.positionCrossfadeSample = std::clamp((int) std::round(
                    (double) voice.positionCrossfadeSample * positionCrossfadeSamples
                        / std::max(1, previousPositionCrossfadeSamples)),
                    0, positionCrossfadeSamples - 1);
        if (previousRate > 0.0 && previousRate != prepared.sampleRate)
            for (auto& voice : *voices) if (voice.active && voice.releasing)
                voice.releaseRemaining = std::clamp((int) std::round(
                    voice.releaseRemaining * prepared.sampleRate / previousRate), 1, releaseSamples);
        rebuildResampler();
        return true;
    }

    bool SpectralSourceSlot::requestPosition(float normalizedPosition) noexcept
    {
        if (!std::isfinite(normalizedPosition) || normalizedPosition < 0.0f
            || normalizedPosition > 1.0f)
        {
            rejectedPositionRequests.fetch_add(1, std::memory_order_relaxed);
            return false;
        }
        uint32_t bits = 0;
        static_assert(sizeof(bits) == sizeof(normalizedPosition));
        std::memcpy(&bits, &normalizedPosition, sizeof(bits));
        uint64_t prior = requestedPositionCommand.load(std::memory_order_relaxed);
        for (;;)
        {
            const uint32_t generation = (uint32_t) (prior >> 32u) + 1u;
            const uint64_t next = ((uint64_t) generation << 32u) | bits;
            if (requestedPositionCommand.compare_exchange_weak(
                    prior, next, std::memory_order_release, std::memory_order_relaxed)) break;
        }
        acceptedPositionRequests.fetch_add(1, std::memory_order_relaxed);
        return true;
    }

    SpectralRenderTelemetry SpectralSourceSlot::spectralTelemetry() const noexcept
    {
        auto snapshot = spectralStats;
        snapshot.positionRequestsAccepted = acceptedPositionRequests.load(std::memory_order_relaxed);
        snapshot.positionRequestsRejected = rejectedPositionRequests.load(std::memory_order_relaxed);
        return snapshot;
    }

    bool SpectralSourceSlot::publish(std::shared_ptr<const PreparedSpectralSource> next) noexcept
    {
        if (next && !next->isValid())
        {
            ++spectralStats.invalidPublicationRejected;
            ++spectralStats.replacementRequestsRejected;
            return false;
        }

        const uint8_t current = publishedSourceBank.load(std::memory_order_acquire);
        int target = -1;
        for (int offset = 1; offset < sourceBankCount; ++offset)
        {
            const int candidate = (current + offset) % sourceBankCount;
            if (sourceReaders[(size_t) candidate].load(std::memory_order_acquire) == 0)
            { target = candidate; break; }
        }
        if (target < 0)
        {
            ++spectralStats.replacementRequestsRejected;
            return false;
        }
        retireBank((uint8_t) target);
        sourceOwners[(size_t) target] = std::move(next);
        sourcePointers[(size_t) target].store(sourceOwners[(size_t) target].get(), std::memory_order_release);
        publishedSourceBank.store((uint8_t) target, std::memory_order_release);
        ++spectralStats.replacementRequestsAccepted;
        version.fetch_add(1, std::memory_order_release);
        return true;
    }

    std::shared_ptr<const PreparedSpectralSource> SpectralSourceSlot::takeRetiredSource() noexcept
    {
        for (uint8_t bank = 0; bank < sourceBankCount; ++bank)
            if (bank != publishedSourceBank.load(std::memory_order_acquire)
                && sourceReaders[bank].load(std::memory_order_acquire) == 0)
                retireBank(bank);
        return std::move(retiredSource);
    }

    void SpectralSourceSlot::reset() noexcept
    {
        for (auto& voice : *voices)
            for (auto& lane : voice.lanes) stopLane(lane);
        *voices = {};
        baseTelemetry = {};
        spectralStats = {};
        schedulerCursor = 0;
        acceptedPositionRequests.store(0, std::memory_order_relaxed);
        rejectedPositionRequests.store(0, std::memory_order_relaxed);
    }

    bool SpectralSourceSlot::noteOn(const SourceNoteEvent& event) noexcept
    {
        if (event.midiNote < 0 || event.midiNote > 127)
        { ++baseTelemetry.rejectedNoteEvents; return false; }
        uint8_t sourceBank = 0;
        const PreparedSpectralSource* source = nullptr;
        if (!acquirePublishedSource(sourceBank, source))
        { ++baseTelemetry.rejectedNoteEvents; return false; }
        auto found = std::find_if(voices->begin(), voices->end(), [](const Voice& voice) { return !voice.active; });
        if (found == voices->end())
        {
            releaseSource(sourceBank);
            ++baseTelemetry.rejectedNoteEvents;
            ++spectralStats.capacityRejected;
            return false;
        }
        *found = {};
        found->active = true;
        found->noteId = event.stableNoteId;
        found->midiNote = event.midiNote;
        found->velocity = std::clamp(event.velocity, 0.0f, 1.0f);
        const uint64_t positionCommand = requestedPositionCommand.load(std::memory_order_acquire);
        const uint64_t positionSerial = positionCommand >> 32u;
        float initialPosition = source->position;
        if (positionSerial != 0)
        {
            const uint32_t bits = (uint32_t) positionCommand;
            std::memcpy(&initialPosition, &bits, sizeof(initialPosition));
        }
        found->lanes[0].sourceBank = sourceBank;
        found->lanes[0].pinnedSource = source;
        found->lanes[0].framePosition = initialPosition * std::max(0, source->artifact->frames - 1);
        found->lanes[0].hostReadPosition = -schedulerPrerollSamples;
        found->appliedPositionSerial = positionSerial;
        ++baseTelemetry.acceptedNoteEvents;
        return true;
    }

    void SpectralSourceSlot::noteOff(uint64_t noteId) noexcept
    {
        for (auto& voice : *voices) if (voice.active && voice.noteId == noteId)
        { voice.releasing = true; voice.releaseRemaining = releaseSamples; }
    }

    void SpectralSourceSlot::allNotesOff(bool immediate) noexcept
    {
        for (auto& voice : *voices)
        {
            if (!voice.active) continue;
            if (immediate)
            {
                for (auto& lane : voice.lanes) stopLane(lane);
                voice = {};
            }
            else { voice.releasing = true; voice.releaseRemaining = releaseSamples; }
        }
    }

    void SpectralSourceSlot::render(juce::AudioBuffer<float>& output, int start, int count) noexcept
    {
        if (count <= 0 || output.getNumChannels() <= 0) return;
        const int begin = std::clamp(start, 0, output.getNumSamples());
        const int end = std::clamp(begin + count, begin, output.getNumSamples());
        applyReplacementRequests();
        applyPositionRequests();
        scheduleSynthesis(end - begin);
        for (int sample = begin; sample < end; ++sample)
        {
            float left = 0.0f, right = 0.0f;
            for (auto& voice : *voices) if (voice.active)
            {
                const auto sourceMix = [&](std::array<float, 2> frame,
                                           const RenderLane& lane) noexcept
                {
                    if (lane.pinnedSource == nullptr) return std::array<float, 2> {};
                    const auto& laneSource = *lane.pinnedSource;
                    const float mid = (frame[0] + frame[1]) * 0.5f;
                    const float side = (frame[0] - frame[1]) * 0.5f * laneSource.stereoWidth;
                    const float leftPan = std::sqrt(0.5f * (1.0f - laneSource.pan));
                    const float rightPan = std::sqrt(0.5f * (1.0f + laneSource.pan));
                    const float gain = laneSource.level * voice.velocity * voice.releaseGain;
                    return std::array<float, 2> {
                        (mid + side) * gain * leftPan,
                        (mid - side) * gain * rightPan
                    };
                };
                auto frame = sourceMix(renderLaneSample(voice.lanes[voice.audibleLane]),
                                       voice.lanes[voice.audibleLane]);
                if (voice.incomingPreparing || voice.positionCrossfading)
                {
                    const auto incoming = sourceMix(
                        renderLaneSample(voice.lanes[voice.incomingLane]),
                        voice.lanes[voice.incomingLane]);
                    if (voice.incomingPreparing
                        && voice.lanes[voice.incomingLane].hostReadPosition >= 0.0)
                    {
                        voice.incomingPreparing = false;
                        voice.positionCrossfading = true;
                        voice.positionCrossfadeSample = 0;
                        if (voice.replacementCrossfading)
                            ++spectralStats.replacementTransitionsStarted;
                        else
                            ++spectralStats.positionTransitionsStarted;
                    }
                    if (voice.positionCrossfading)
                    {
                        const float phase = std::clamp((float) voice.positionCrossfadeSample
                            / std::max(1, positionCrossfadeSamples - 1), 0.0f, 1.0f);
                        const float outgoingGain = std::cos(phase * juce::MathConstants<float>::halfPi);
                        const float incomingGain = std::sin(phase * juce::MathConstants<float>::halfPi);
                        frame[0] = frame[0] * outgoingGain + incoming[0] * incomingGain;
                        frame[1] = frame[1] * outgoingGain + incoming[1] * incomingGain;
                        if (++voice.positionCrossfadeSample >= positionCrossfadeSamples)
                        {
                            voice.positionCrossfading = false;
                            const bool wasReplacement = voice.replacementCrossfading;
                            voice.replacementCrossfading = false;
                            stopLane(voice.lanes[voice.audibleLane]);
                            std::swap(voice.audibleLane, voice.incomingLane);
                            voice.appliedPositionSerial = voice.incomingPositionSerial;
                            if (wasReplacement) ++spectralStats.replacementTransitionsCompleted;
                            else ++spectralStats.positionTransitionsCompleted;
                            applyReplacementRequests();
                            applyPositionRequests();
                        }
                    }
                }
                left += frame[0];
                right += frame[1];
                ++baseTelemetry.renderedVoiceSamples;
                const auto& audible = voice.lanes[voice.audibleLane];
                if (!voice.releasing && audible.hostReadPosition >= audible.sourceEndPosition)
                { voice.releasing = true; voice.releaseRemaining = releaseSamples; }
                if (voice.releasing && --voice.releaseRemaining <= 0)
                {
                    for (auto& lane : voice.lanes) stopLane(lane);
                    voice = {};
                }
                else if (voice.releasing) voice.releaseGain = (float) voice.releaseRemaining / releaseSamples;
            }
            output.addSample(0, sample, left);
            if (output.getNumChannels() > 1) output.addSample(1, sample, right);
            ++baseTelemetry.renderedSamples;
        }
    }

    SourceLifecycleState SpectralSourceSlot::lifecycleState() const noexcept
    {
        if (sourcePointers[publishedSourceBank.load(std::memory_order_acquire)].load(std::memory_order_acquire) == nullptr)
            return SourceLifecycleState::empty;
        for (const auto& voice : *voices) if (voice.active)
            return voice.releasing ? SourceLifecycleState::releasing : SourceLifecycleState::active;
        return SourceLifecycleState::ready;
    }

    int SpectralSourceSlot::latencySamples() const noexcept
    {
        const double resamplerDelay = canonicalPerHostSample == 1.0
            ? 0.0 : (activeSincTaps - 1) * 0.5;
        return (int) std::ceil((schedulerPrerollSamples
            + SpectralArtifact::fftSize - SpectralArtifact::hopSize + resamplerDelay)
            * prepared.sampleRate / SpectralArtifact::sampleRate);
    }

    int SpectralSourceSlot::activeVoiceCount() const noexcept
    {
        return (int) std::count_if(voices->begin(), voices->end(), [](const Voice& voice) { return voice.active; });
    }

    void SpectralSourceSlot::rebuildResampler() noexcept
    {
        constexpr double beta = 10.5;
        const double stopEdge = std::min(1.0, prepared.sampleRate / SpectralArtifact::sampleRate);
        const double outputRatio = prepared.sampleRate / SpectralArtifact::sampleRate;
        activeSincTaps = outputRatio >= 3.5 ? 16 : (outputRatio > 1.0
            ? std::clamp((int) std::ceil(sincTaps / outputRatio), 16, sincTaps)
            : sincTaps);
        const double cutoff = outputRatio >= 1.0 ? 1.0 : 0.88 * stopEdge;
        const double denominator = besselI0(beta);
        for (int phase = 0; phase < sincPhases; ++phase)
        {
            const double fraction = (double) phase / sincPhases;
            double sum = 0.0;
            for (int tap = 0; tap < activeSincTaps; ++tap)
            {
                const double x = (double) tap - (activeSincTaps / 2 - 1) - fraction;
                const double sinc = std::abs(x) < 1.0e-12
                    ? cutoff : std::sin(pi * cutoff * x) / (pi * x);
                const double normalized = 2.0 * tap / (activeSincTaps - 1.0) - 1.0;
                const double windowValue = besselI0(beta * std::sqrt(std::max(0.0, 1.0 - normalized * normalized)))
                    / denominator;
                const float coefficient = (float) (sinc * windowValue);
                sincTable[(size_t) phase * sincTaps + tap] = coefficient;
                sum += coefficient;
            }
            for (int tap = activeSincTaps; tap < sincTaps; ++tap)
                sincTable[(size_t) phase * sincTaps + tap] = 0.0f;
            for (int tap = 0; tap < activeSincTaps; ++tap)
                sincTable[(size_t) phase * sincTaps + tap] /= (float) sum;
        }
    }

    void SpectralSourceSlot::applyPositionRequests() noexcept
    {
        const uint64_t command = requestedPositionCommand.load(std::memory_order_acquire);
        const uint64_t serial = command >> 32u;
        if (serial == 0) return;
        const uint32_t bits = (uint32_t) command;
        float position = 0.0f;
        std::memcpy(&position, &bits, sizeof(position));
        bool superseded = false;
        for (auto& voice : *voices)
        {
            if (!voice.active || voice.positionCrossfading || voice.replacementCrossfading
                || serial == voice.appliedPositionSerial
                || serial == voice.incomingPositionSerial) continue;
            superseded = superseded || voice.incomingPreparing;
            beginPositionPreparation(voice, position, serial);
        }
        if (superseded) ++spectralStats.positionRequestsSuperseded;
    }

    void SpectralSourceSlot::beginPositionPreparation(Voice& voice, float position,
                                                       uint64_t serial) noexcept
    {
        auto& outgoing = voice.lanes[voice.audibleLane];
        auto& incoming = voice.lanes[voice.incomingLane];
        stopLane(incoming);
        sourceReaders[outgoing.sourceBank].fetch_add(1, std::memory_order_acq_rel);
        incoming.sourceBank = outgoing.sourceBank;
        incoming.pinnedSource = outgoing.pinnedSource;
        incoming.framePosition = position
            * std::max(0, incoming.pinnedSource->artifact->frames - 1);
        incoming.hostReadPosition = -schedulerPrerollSamples;
        voice.incomingPositionSerial = serial;
        voice.incomingPreparing = true;
        voice.positionCrossfading = false;
        voice.replacementCrossfading = false;
        voice.positionCrossfadeSample = 0;
    }

    void SpectralSourceSlot::applyReplacementRequests() noexcept
    {
        const uint8_t bank = publishedSourceBank.load(std::memory_order_acquire);
        for (auto& voice : *voices)
        {
            if (!voice.active || voice.positionCrossfading || voice.replacementCrossfading
                || voice.lanes[voice.audibleLane].sourceBank == bank) continue;
            beginReplacementPreparation(voice, bank);
        }
    }

    void SpectralSourceSlot::beginReplacementPreparation(Voice& voice,
                                                          uint8_t sourceBank) noexcept
    {
        const PreparedSpectralSource* replacement = nullptr;
        uint8_t acquired = sourceBank;
        sourceReaders[acquired].fetch_add(1, std::memory_order_acq_rel);
        replacement = sourcePointers[acquired].load(std::memory_order_acquire);
        if (replacement == nullptr)
        {
            releaseSource(acquired);
            return;
        }
        auto& incoming = voice.lanes[voice.incomingLane];
        stopLane(incoming);
        incoming.sourceBank = acquired;
        incoming.pinnedSource = replacement;
        incoming.framePosition = replacement->position
            * std::max(0, replacement->artifact->frames - 1);
        incoming.hostReadPosition = -schedulerPrerollSamples;
        voice.incomingPositionSerial = voice.appliedPositionSerial;
        voice.incomingPreparing = true;
        voice.positionCrossfading = false;
        voice.replacementCrossfading = true;
        voice.positionCrossfadeSample = 0;
    }

    bool SpectralSourceSlot::acquirePublishedSource(
        uint8_t& bank, const PreparedSpectralSource*& preparedSource) noexcept
    {
        for (int attempt = 0; attempt < 3; ++attempt)
        {
            bank = publishedSourceBank.load(std::memory_order_acquire);
            sourceReaders[bank].fetch_add(1, std::memory_order_acq_rel);
            if (bank == publishedSourceBank.load(std::memory_order_acquire))
            {
                preparedSource = sourcePointers[bank].load(std::memory_order_acquire);
                if (preparedSource != nullptr) return true;
            }
            releaseSource(bank);
        }
        preparedSource = nullptr;
        return false;
    }

    void SpectralSourceSlot::releaseSource(uint8_t bank) noexcept
    {
        sourceReaders[bank].fetch_sub(1, std::memory_order_acq_rel);
    }

    void SpectralSourceSlot::stopLane(RenderLane& lane) noexcept
    {
        if (lane.pinnedSource != nullptr) releaseSource(lane.sourceBank);
        lane = {};
    }

    void SpectralSourceSlot::retireBank(uint8_t bank) noexcept
    {
        if (!sourceOwners[bank]) return;
        retiredSource = std::move(sourceOwners[bank]);
        sourcePointers[bank].store(nullptr, std::memory_order_release);
        ++spectralStats.retiredPublications;
    }

    void SpectralSourceSlot::synthesizeHop(Voice& voice, RenderLane& lane) noexcept
    {
        const auto* source = lane.pinnedSource;
        if (source == nullptr) return;
        const auto& artifact = *source->artifact;
        const int frame = std::clamp((int) std::round(lane.framePosition), 0, artifact.frames - 1);
        const double ratio = std::pow(2.0, ((double) voice.midiNote - source->rootNote
            + source->pitchSemitones) / 12.0);
        const uint32_t peakBegin = artifact.peakOffsets[(size_t) frame];
        const uint32_t peakEnd = artifact.peakOffsets[(size_t) frame + 1u];
        const int peakCount = (int) (peakEnd - peakBegin);
        for (int channel = 0; channel < 2; ++channel)
        {
            lane.fftData.fill(0.0f);
            auto& synthesisPhases = channel == 0 ? lane.synthesisPhaseL : lane.synthesisPhaseR;
            auto& nextSynthesisPhases = channel == 0
                ? lane.nextSynthesisPhaseL : lane.nextSynthesisPhaseR;
            for (int localPeak = 0; localPeak < peakCount; ++localPeak)
            {
                const size_t globalPeak = (size_t) peakBegin + localPeak;
                const double inputPhase = source->absolutePeakPhases[
                    (size_t) channel * artifact.peakBins.size() + globalPeak];
                const double mappedPeak = artifact.peakBins[globalPeak] * ratio;
                const double expectedTarget = twoPi * mappedPeak * SpectralArtifact::hopSize
                    / SpectralArtifact::fftSize;
                const auto predecessor = artifact.peakPreviousIndices[globalPeak];
                const bool transientReset = artifact.transientFrames[(size_t) frame] != 0u;
                if (!lane.synthesisPhaseInitialized || transientReset)
                    nextSynthesisPhases[(size_t) localPeak] = inputPhase;
                else if (source->freeze && lane.synthesisFrame == frame)
                {
                    const double residual = predecessor == SpectralArtifact::noPreviousPeak ? 0.0
                        : artifact.peakPhaseEvolution[
                            (size_t) channel * artifact.peakBins.size() + globalPeak];
                    nextSynthesisPhases[(size_t) localPeak] = wrap(
                        synthesisPhases[(size_t) localPeak] + expectedTarget + residual * ratio);
                }
                else if (lane.synthesisFrame == frame - 1
                         && predecessor != SpectralArtifact::noPreviousPeak)
                {
                    const double residual = artifact.peakPhaseEvolution[
                        (size_t) channel * artifact.peakBins.size() + globalPeak];
                    nextSynthesisPhases[(size_t) localPeak] = wrap(
                        synthesisPhases[(size_t) predecessor] + expectedTarget + residual * ratio);
                }
                else
                    nextSynthesisPhases[(size_t) localPeak] = inputPhase;
            }
            double inputEnergy = 0.0, outputEnergy = 0.0;
            for (int bin = 0; bin < artifact.bins; ++bin)
            {
                const size_t index = ((size_t) channel * artifact.frames + frame) * artifact.bins + bin;
                const double magnitude = artifact.magnitudes[index];
                const double mapped = bin * ratio;
                const int low = (int) std::floor(mapped);
                const float fraction = (float) (mapped - low);
                const auto assignedPeak = artifact.peakAssignments[(size_t) frame * artifact.bins + bin];
                const double phase = nextSynthesisPhases[(size_t) assignedPeak]
                    + artifact.relativePhases[index];
                const float real = (float) (magnitude * std::cos(phase));
                const float imag = (float) (magnitude * std::sin(phase));
                inputEnergy += magnitude * magnitude;
                const auto deposit = [&](int target, float gain)
                {
                    if (target < 0 || target >= artifact.bins || gain <= 0.0f) return;
                    lane.fftData[(size_t) target * 2u] += real * gain;
                    if (target != 0 && target != artifact.bins - 1)
                        lane.fftData[(size_t) target * 2u + 1u] += imag * gain;
                };
                deposit(low, 1.0f - fraction);
                deposit(low + 1, fraction);
                ++spectralStats.binsProcessed;
            }
            for (int bin = 0; bin < artifact.bins; ++bin)
            {
                const double real = lane.fftData[(size_t) bin * 2u];
                const double imag = lane.fftData[(size_t) bin * 2u + 1u];
                outputEnergy += real * real + imag * imag;
            }
            const float normalize = outputEnergy > 1.0e-20
                ? (float) std::clamp(std::sqrt(inputEnergy / outputEnergy), 0.25, 4.0) : 1.0f;
            for (auto& value : lane.fftData) value *= normalize;
            inverseFft.performRealOnlyInverseTransform(lane.fftData.data());
            auto& overlap = channel == 0 ? lane.overlapL : lane.overlapR;
            for (int n = 0; n < SpectralArtifact::fftSize; ++n)
            {
                const size_t ring = (size_t) (lane.olaPosition + n) % overlapRingSize;
                overlap[ring] += lane.fftData[(size_t) n] * window[(size_t) n] * 0.5f;
                ++spectralStats.overlapSamples;
            }
            ++spectralStats.transforms;
            std::copy_n(nextSynthesisPhases.begin(), peakCount, synthesisPhases.begin());
        }
        lane.synthesisPhaseInitialized = true;
        lane.synthesisFrame = frame;
        ++spectralStats.framesSynthesized;
        if (!source->freeze)
        {
            lane.framePosition += 1.0;
            if (lane.framePosition >= artifact.frames)
            {
                lane.framePosition = artifact.frames - 1;
                lane.sourceEnded = true;
                lane.sourceEndPosition = lane.olaPosition + SpectralArtifact::fftSize;
            }
        }
    }

    void SpectralSourceSlot::generateCanonicalHop(Voice& voice, RenderLane& lane) noexcept
    {
        if (!lane.sourceEnded) synthesizeHop(voice, lane);
        for (int emitted = 0; emitted < SpectralArtifact::hopSize; ++emitted)
        {
            const size_t ola = (size_t) lane.olaPosition % overlapRingSize;
            const size_t canonical = (size_t) lane.canonicalGenerated % canonicalRingSize;
            lane.canonicalL[canonical] = lane.overlapL[ola];
            lane.canonicalR[canonical] = lane.overlapR[ola];
            lane.overlapL[ola] = lane.overlapR[ola] = 0.0f;
            ++lane.olaPosition;
            ++lane.canonicalGenerated;
        }
    }

    void SpectralSourceSlot::scheduleSynthesis(int hostSamples) noexcept
    {
        const double canonicalDemand = hostSamples * canonicalPerHostSample;
        const int hopBudget = std::max(1, (int) std::ceil(
            canonicalDemand * maximumVoices * 2 / SpectralArtifact::hopSize));
        for (int work = 0; work < hopBudget; ++work)
        {
            Voice* selectedVoice = nullptr;
            RenderLane* selectedLane = nullptr;
            int64_t selectedDeficit = 0;
            size_t selectedIndex = schedulerCursor;
            for (size_t offset = 0; offset < voices->size(); ++offset)
            {
                const size_t index = (schedulerCursor + offset) % voices->size();
                auto& voice = (*voices)[index];
                if (!voice.active) continue;
                for (int laneIndex = 0; laneIndex < 2; ++laneIndex)
                {
                    if (laneIndex != voice.audibleLane
                        && !voice.incomingPreparing && !voice.positionCrossfading) continue;
                    auto& lane = voice.lanes[(size_t) laneIndex];
                    const int64_t target = (int64_t) std::ceil(lane.hostReadPosition
                        + schedulerPrerollSamples + canonicalDemand + activeSincTaps / 2.0);
                    const int64_t deficit = target - lane.canonicalGenerated;
                    if (deficit > selectedDeficit)
                    {
                        selectedVoice = &voice;
                        selectedLane = &lane;
                        selectedDeficit = deficit;
                        selectedIndex = index;
                    }
                }
            }
            if (selectedLane == nullptr) break;
            generateCanonicalHop(*selectedVoice, *selectedLane);
            schedulerCursor = (selectedIndex + 1u) % voices->size();
        }
    }

    float SpectralSourceSlot::readCanonical(const RenderLane& lane, int channel, int64_t index) const noexcept
    {
        if (index < 0 || index >= lane.canonicalGenerated
            || lane.canonicalGenerated - index > canonicalRingSize) return 0.0f;
        return (channel == 0 ? lane.canonicalL : lane.canonicalR)[(size_t) index % canonicalRingSize];
    }

    std::array<float, 2> SpectralSourceSlot::renderLaneSample(RenderLane& lane) noexcept
    {
        const int64_t center = (int64_t) std::floor(lane.hostReadPosition);
        if (canonicalPerHostSample == 1.0)
        {
            if (center >= lane.canonicalGenerated && center >= 0) ++spectralStats.synthesisUnderflows;
            ++lane.hostReadPosition;
            return { readCanonical(lane, 0, center), readCanonical(lane, 1, center) };
        }
        const double fraction = lane.hostReadPosition - center;
        const double phasePosition = fraction * sincPhases;
        const int phase = std::clamp((int) std::floor(phasePosition), 0, sincPhases - 1);
        const float phaseFraction = (float) (phasePosition - phase);
        const int nextPhase = (phase + 1) % sincPhases;
        const bool wrapsPhase = nextPhase == 0;
        if (center + activeSincTaps / 2 + (wrapsPhase ? 2 : 1) >= lane.canonicalGenerated
            && center >= 0)
            ++spectralStats.synthesisUnderflows;
        std::array<float, 2> result {};
        for (int tap = 0; tap < activeSincTaps; ++tap)
        {
            const int64_t index = center + tap - (activeSincTaps / 2 - 1);
            const float coefficient = sincTable[(size_t) phase * sincTaps + tap];
            if (phaseFraction <= 1.0e-7f)
            {
                result[0] += readCanonical(lane, 0, index) * coefficient;
                result[1] += readCanonical(lane, 1, index) * coefficient;
            }
            else
            {
                const float nextCoefficient = sincTable[(size_t) nextPhase * sincTaps + tap];
                const int64_t nextIndex = index + (wrapsPhase ? 1 : 0);
                result[0] += readCanonical(lane, 0, index) * coefficient * (1.0f - phaseFraction)
                    + readCanonical(lane, 0, nextIndex) * nextCoefficient * phaseFraction;
                result[1] += readCanonical(lane, 1, index) * coefficient * (1.0f - phaseFraction)
                    + readCanonical(lane, 1, nextIndex) * nextCoefficient * phaseFraction;
            }
            spectralStats.resamplerTaps += 2;
        }
        lane.hostReadPosition += canonicalPerHostSample;
        return result;
    }
}

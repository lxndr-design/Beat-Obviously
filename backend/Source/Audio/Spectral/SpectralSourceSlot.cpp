#include "SpectralSourceSlot.h"

#include <algorithm>
#include <cmath>

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
        prepared = spec;
        canonicalPerHostSample = SpectralArtifact::sampleRate / prepared.sampleRate;
        releaseSamples = std::clamp((int) std::round(prepared.sampleRate * 0.004), 8, 2048);
        if (previousRate > 0.0 && previousRate != prepared.sampleRate)
            for (auto& voice : voices) if (voice.active && voice.releasing)
                voice.releaseRemaining = std::clamp((int) std::round(
                    voice.releaseRemaining * prepared.sampleRate / previousRate), 1, releaseSamples);
        rebuildResampler();
        return true;
    }

    bool SpectralSourceSlot::publish(std::shared_ptr<const PreparedSpectralSource> next) noexcept
    {
        if (activeVoiceCount() != 0 || (next && !next->isValid()))
        {
            ++spectralStats.invalidPublicationRejected;
            return false;
        }
        source = std::move(next);
        version.fetch_add(1, std::memory_order_release);
        return true;
    }

    void SpectralSourceSlot::reset() noexcept
    {
        voices = {};
        baseTelemetry = {};
        spectralStats = {};
        schedulerCursor = 0;
    }

    bool SpectralSourceSlot::noteOn(const SourceNoteEvent& event) noexcept
    {
        if (!source || !source->isValid() || event.midiNote < 0 || event.midiNote > 127)
        { ++baseTelemetry.rejectedNoteEvents; return false; }
        auto found = std::find_if(voices.begin(), voices.end(), [](const Voice& voice) { return !voice.active; });
        if (found == voices.end())
        {
            ++baseTelemetry.rejectedNoteEvents;
            ++spectralStats.capacityRejected;
            return false;
        }
        *found = {};
        found->active = true;
        found->noteId = event.stableNoteId;
        found->midiNote = event.midiNote;
        found->velocity = std::clamp(event.velocity, 0.0f, 1.0f);
        found->framePosition = source->position * std::max(0, source->artifact->frames - 1);
        found->hostReadPosition = -schedulerPrerollSamples;
        ++baseTelemetry.acceptedNoteEvents;
        return true;
    }

    void SpectralSourceSlot::noteOff(uint64_t noteId) noexcept
    {
        for (auto& voice : voices) if (voice.active && voice.noteId == noteId)
        { voice.releasing = true; voice.releaseRemaining = releaseSamples; }
    }

    void SpectralSourceSlot::allNotesOff(bool immediate) noexcept
    {
        for (auto& voice : voices)
        {
            if (!voice.active) continue;
            if (immediate) voice = {};
            else { voice.releasing = true; voice.releaseRemaining = releaseSamples; }
        }
    }

    void SpectralSourceSlot::render(juce::AudioBuffer<float>& output, int start, int count) noexcept
    {
        if (!source || count <= 0 || output.getNumChannels() <= 0) return;
        const int begin = std::clamp(start, 0, output.getNumSamples());
        const int end = std::clamp(begin + count, begin, output.getNumSamples());
        scheduleSynthesis(end - begin);
        const float leftPan = std::sqrt(0.5f * (1.0f - source->pan));
        const float rightPan = std::sqrt(0.5f * (1.0f + source->pan));
        for (int sample = begin; sample < end; ++sample)
        {
            float left = 0.0f, right = 0.0f;
            for (auto& voice : voices) if (voice.active)
            {
                const auto frame = renderVoiceSample(voice);
                const float gain = source->level * voice.velocity * voice.releaseGain;
                const float mid = (frame[0] + frame[1]) * 0.5f;
                const float side = (frame[0] - frame[1]) * 0.5f * source->stereoWidth;
                left += (mid + side) * gain * leftPan;
                right += (mid - side) * gain * rightPan;
                ++baseTelemetry.renderedVoiceSamples;
                if (!voice.releasing && voice.hostReadPosition >= voice.sourceEndPosition)
                { voice.releasing = true; voice.releaseRemaining = releaseSamples; }
                if (voice.releasing && --voice.releaseRemaining <= 0) voice = {};
                else if (voice.releasing) voice.releaseGain = (float) voice.releaseRemaining / releaseSamples;
            }
            output.addSample(0, sample, left);
            if (output.getNumChannels() > 1) output.addSample(1, sample, right);
            ++baseTelemetry.renderedSamples;
        }
    }

    SourceLifecycleState SpectralSourceSlot::lifecycleState() const noexcept
    {
        if (!source) return SourceLifecycleState::empty;
        for (const auto& voice : voices) if (voice.active)
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
        return (int) std::count_if(voices.begin(), voices.end(), [](const Voice& voice) { return voice.active; });
    }

    void SpectralSourceSlot::rebuildResampler() noexcept
    {
        constexpr double beta = 10.5;
        const double stopEdge = std::min(1.0, prepared.sampleRate / SpectralArtifact::sampleRate);
        const double outputRatio = prepared.sampleRate / SpectralArtifact::sampleRate;
        activeSincTaps = outputRatio > 1.0
            ? std::clamp((int) std::ceil(sincTaps / outputRatio), 48, sincTaps)
            : sincTaps;
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

    void SpectralSourceSlot::synthesizeHop(Voice& voice) noexcept
    {
        const auto& artifact = *source->artifact;
        const int frame = std::clamp((int) std::round(voice.framePosition), 0, artifact.frames - 1);
        const double ratio = std::pow(2.0, ((double) voice.midiNote - source->rootNote
            + source->pitchSemitones) / 12.0);
        const uint32_t peakBegin = artifact.peakOffsets[(size_t) frame];
        const uint32_t peakEnd = artifact.peakOffsets[(size_t) frame + 1u];
        const int peakCount = (int) (peakEnd - peakBegin);
        for (int channel = 0; channel < 2; ++channel)
        {
            voice.fftData.fill(0.0f);
            auto& synthesisPhases = channel == 0 ? voice.synthesisPhaseL : voice.synthesisPhaseR;
            auto& nextSynthesisPhases = channel == 0
                ? voice.nextSynthesisPhaseL : voice.nextSynthesisPhaseR;
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
                if (!voice.synthesisPhaseInitialized || transientReset)
                    nextSynthesisPhases[(size_t) localPeak] = inputPhase;
                else if (source->freeze && voice.synthesisFrame == frame)
                {
                    const double residual = predecessor == SpectralArtifact::noPreviousPeak ? 0.0
                        : artifact.peakPhaseEvolution[
                            (size_t) channel * artifact.peakBins.size() + globalPeak];
                    nextSynthesisPhases[(size_t) localPeak] = wrap(
                        synthesisPhases[(size_t) localPeak] + expectedTarget + residual * ratio);
                }
                else if (voice.synthesisFrame == frame - 1
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
                    voice.fftData[(size_t) target * 2u] += real * gain;
                    if (target != 0 && target != artifact.bins - 1)
                        voice.fftData[(size_t) target * 2u + 1u] += imag * gain;
                };
                deposit(low, 1.0f - fraction);
                deposit(low + 1, fraction);
                ++spectralStats.binsProcessed;
            }
            for (int bin = 0; bin < artifact.bins; ++bin)
            {
                const double real = voice.fftData[(size_t) bin * 2u];
                const double imag = voice.fftData[(size_t) bin * 2u + 1u];
                outputEnergy += real * real + imag * imag;
            }
            const float normalize = outputEnergy > 1.0e-20
                ? (float) std::clamp(std::sqrt(inputEnergy / outputEnergy), 0.25, 4.0) : 1.0f;
            for (auto& value : voice.fftData) value *= normalize;
            inverseFft.performRealOnlyInverseTransform(voice.fftData.data());
            auto& overlap = channel == 0 ? voice.overlapL : voice.overlapR;
            for (int n = 0; n < SpectralArtifact::fftSize; ++n)
            {
                const size_t ring = (size_t) (voice.olaPosition + n) % overlapRingSize;
                overlap[ring] += voice.fftData[(size_t) n] * window[(size_t) n] * 0.5f;
                ++spectralStats.overlapSamples;
            }
            ++spectralStats.transforms;
            std::copy_n(nextSynthesisPhases.begin(), peakCount, synthesisPhases.begin());
        }
        voice.synthesisPhaseInitialized = true;
        voice.synthesisFrame = frame;
        ++spectralStats.framesSynthesized;
        if (!source->freeze)
        {
            voice.framePosition += 1.0;
            if (voice.framePosition >= artifact.frames)
            {
                voice.framePosition = artifact.frames - 1;
                voice.sourceEnded = true;
                voice.sourceEndPosition = voice.olaPosition + SpectralArtifact::fftSize;
            }
        }
    }

    void SpectralSourceSlot::generateCanonicalHop(Voice& voice) noexcept
    {
        if (!voice.sourceEnded) synthesizeHop(voice);
        for (int emitted = 0; emitted < SpectralArtifact::hopSize; ++emitted)
        {
            const size_t ola = (size_t) voice.olaPosition % overlapRingSize;
            const size_t canonical = (size_t) voice.canonicalGenerated % canonicalRingSize;
            voice.canonicalL[canonical] = voice.overlapL[ola];
            voice.canonicalR[canonical] = voice.overlapR[ola];
            voice.overlapL[ola] = voice.overlapR[ola] = 0.0f;
            ++voice.olaPosition;
            ++voice.canonicalGenerated;
        }
    }

    void SpectralSourceSlot::scheduleSynthesis(int hostSamples) noexcept
    {
        const double canonicalDemand = hostSamples * canonicalPerHostSample;
        const int hopBudget = std::max(1, (int) std::ceil(
            canonicalDemand * maximumVoices / SpectralArtifact::hopSize));
        for (int work = 0; work < hopBudget; ++work)
        {
            Voice* selected = nullptr;
            int64_t selectedDeficit = 0;
            size_t selectedIndex = schedulerCursor;
            for (size_t offset = 0; offset < voices.size(); ++offset)
            {
                const size_t index = (schedulerCursor + offset) % voices.size();
                auto& voice = voices[index];
                if (!voice.active) continue;
                const int64_t target = (int64_t) std::ceil(voice.hostReadPosition
                    + schedulerPrerollSamples + canonicalDemand + activeSincTaps / 2.0);
                const int64_t deficit = target - voice.canonicalGenerated;
                if (deficit > selectedDeficit)
                { selected = &voice; selectedDeficit = deficit; selectedIndex = index; }
            }
            if (selected == nullptr) break;
            generateCanonicalHop(*selected);
            schedulerCursor = (selectedIndex + 1u) % voices.size();
        }
    }

    float SpectralSourceSlot::readCanonical(const Voice& voice, int channel, int64_t index) const noexcept
    {
        if (index < 0 || index >= voice.canonicalGenerated
            || voice.canonicalGenerated - index > canonicalRingSize) return 0.0f;
        return (channel == 0 ? voice.canonicalL : voice.canonicalR)[(size_t) index % canonicalRingSize];
    }

    std::array<float, 2> SpectralSourceSlot::renderVoiceSample(Voice& voice) noexcept
    {
        const int64_t center = (int64_t) std::floor(voice.hostReadPosition);
        if (canonicalPerHostSample == 1.0)
        {
            if (center >= voice.canonicalGenerated && center >= 0) ++spectralStats.synthesisUnderflows;
            ++voice.hostReadPosition;
            return { readCanonical(voice, 0, center), readCanonical(voice, 1, center) };
        }
        const double fraction = voice.hostReadPosition - center;
        const double phasePosition = fraction * sincPhases;
        const int phase = std::clamp((int) std::floor(phasePosition), 0, sincPhases - 1);
        const float phaseFraction = (float) (phasePosition - phase);
        const int nextPhase = (phase + 1) % sincPhases;
        const bool wrapsPhase = nextPhase == 0;
        if (center + activeSincTaps / 2 + (wrapsPhase ? 2 : 1) >= voice.canonicalGenerated
            && center >= 0)
            ++spectralStats.synthesisUnderflows;
        std::array<float, 2> result {};
        for (int tap = 0; tap < activeSincTaps; ++tap)
        {
            const int64_t index = center + tap - (activeSincTaps / 2 - 1);
            const float coefficient = sincTable[(size_t) phase * sincTaps + tap];
            if (phaseFraction <= 1.0e-7f)
            {
                result[0] += readCanonical(voice, 0, index) * coefficient;
                result[1] += readCanonical(voice, 1, index) * coefficient;
            }
            else
            {
                const float nextCoefficient = sincTable[(size_t) nextPhase * sincTaps + tap];
                const int64_t nextIndex = index + (wrapsPhase ? 1 : 0);
                result[0] += readCanonical(voice, 0, index) * coefficient * (1.0f - phaseFraction)
                    + readCanonical(voice, 0, nextIndex) * nextCoefficient * phaseFraction;
                result[1] += readCanonical(voice, 1, index) * coefficient * (1.0f - phaseFraction)
                    + readCanonical(voice, 1, nextIndex) * nextCoefficient * phaseFraction;
            }
            spectralStats.resamplerTaps += 2;
        }
        voice.hostReadPosition += canonicalPerHostSample;
        return result;
    }
}

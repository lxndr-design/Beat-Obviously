#pragma once

#include "SpectralArtifact.h"
#include "../Sources/SourceSlot.h"

#include <juce_dsp/juce_dsp.h>
#include <array>
#include <atomic>
#include <limits>
#include <memory>
#include <vector>

namespace beat
{
    struct PreparedSpectralSource
    {
        static constexpr float maximumPitchSemitones = 12.0f;
        std::shared_ptr<const SpectralArtifact> artifact;
        std::vector<double> absolutePeakPhases;
        int rootNote { 60 };
        float level { 1.0f };
        float pan { 0.0f };
        float stereoWidth { 1.0f };
        float position { 0.0f };
        float pitchSemitones { 0.0f };
        bool freeze { false };
        bool validated { false };

        bool isValid() const noexcept;
    };

    struct SpectralPrepareResult
    {
        std::shared_ptr<const PreparedSpectralSource> source;
        std::string code;
        std::string message;
    };

    SpectralPrepareResult prepareSpectralSource(std::shared_ptr<const SpectralArtifact> artifact,
                                                int rootNote,
                                                float level,
                                                float pan,
                                                float stereoWidth,
                                                float position,
                                                float pitchSemitones,
                                                bool freeze);

    struct SpectralRenderTelemetry
    {
        uint64_t transforms { 0 };
        uint64_t binsProcessed { 0 };
        uint64_t overlapSamples { 0 };
        uint64_t resamplerTaps { 0 };
        uint64_t framesSynthesized { 0 };
        uint64_t capacityRejected { 0 };
        uint64_t invalidPublicationRejected { 0 };
        uint64_t synthesisUnderflows { 0 };
        uint64_t positionRequestsAccepted { 0 };
        uint64_t positionRequestsRejected { 0 };
        uint64_t positionTransitionsStarted { 0 };
        uint64_t positionTransitionsCompleted { 0 };
        uint64_t positionRequestsSuperseded { 0 };
        uint64_t replacementRequestsAccepted { 0 };
        uint64_t replacementRequestsRejected { 0 };
        uint64_t replacementTransitionsStarted { 0 };
        uint64_t replacementTransitionsCompleted { 0 };
        uint64_t retiredPublications { 0 };
    };

    class SpectralSourceSlot final : public SourceSlot
    {
    public:
        static constexpr int maximumVoices = 4;
        static constexpr int maximumBins = SpectralArtifact::fftSize / 2 + 1;
        static constexpr int sincTaps = 96;
        static constexpr int sincPhases = 2048;
        static constexpr int overlapRingSize = 2048;
        static constexpr int canonicalRingSize = 8192;
        static constexpr int schedulerPrerollSamples = 1024;

        SpectralSourceSlot();
        bool prepare(const SourcePrepareSpec&) noexcept override;
        bool publish(std::shared_ptr<const PreparedSpectralSource>) noexcept;
        std::shared_ptr<const PreparedSpectralSource> takeRetiredSource() noexcept;
        bool requestPosition(float normalizedPosition) noexcept;
        void reset() noexcept override;
        bool noteOn(const SourceNoteEvent&) noexcept override;
        void noteOff(uint64_t stableNoteId) noexcept override;
        void allNotesOff(bool immediate) noexcept override;
        void render(juce::AudioBuffer<float>&, int startSample, int numSamples) noexcept override;
        SourceLifecycleState lifecycleState() const noexcept override;
        SourceComplexity complexity() const noexcept override { return SourceComplexity::spectral; }
        int latencySamples() const noexcept override;
        int activeVoiceCount() const noexcept override;
        uint64_t stateVersion() const noexcept override { return version.load(std::memory_order_acquire); }
        SourceRenderTelemetry telemetry() const noexcept override { return baseTelemetry; }
        SpectralRenderTelemetry spectralTelemetry() const noexcept;

    private:
        struct RenderLane
        {
            double framePosition { 0.0 };
            double hostReadPosition { 0.0 };
            int64_t canonicalGenerated { 0 };
            int64_t olaPosition { 0 };
            bool sourceEnded { false };
            int64_t sourceEndPosition { std::numeric_limits<int64_t>::max() };
            bool synthesisPhaseInitialized { false };
            int synthesisFrame { -1 };
            std::array<double, maximumBins> synthesisPhaseL {};
            std::array<double, maximumBins> synthesisPhaseR {};
            std::array<double, maximumBins> nextSynthesisPhaseL {};
            std::array<double, maximumBins> nextSynthesisPhaseR {};
            std::array<float, overlapRingSize> overlapL {};
            std::array<float, overlapRingSize> overlapR {};
            std::array<float, canonicalRingSize> canonicalL {};
            std::array<float, canonicalRingSize> canonicalR {};
            std::array<float, SpectralArtifact::fftSize * 2> fftData {};
            uint8_t sourceBank { 0 };
            const PreparedSpectralSource* pinnedSource { nullptr };
        };

        struct Voice
        {
            bool active { false };
            bool releasing { false };
            uint64_t noteId { 0 };
            int midiNote { 60 };
            float velocity { 1.0f };
            float releaseGain { 1.0f };
            int releaseRemaining { 0 };
            std::array<RenderLane, 2> lanes {};
            uint8_t audibleLane { 0 };
            uint8_t incomingLane { 1 };
            bool incomingPreparing { false };
            bool positionCrossfading { false };
            bool replacementCrossfading { false };
            int positionCrossfadeSample { 0 };
            uint64_t appliedPositionSerial { 0 };
            uint64_t incomingPositionSerial { 0 };
        };

        void rebuildResampler() noexcept;
        void applyPositionRequests() noexcept;
        void applyReplacementRequests() noexcept;
        void beginPositionPreparation(Voice&, float position, uint64_t serial) noexcept;
        void beginReplacementPreparation(Voice&, uint8_t sourceBank) noexcept;
        void stopLane(RenderLane&) noexcept;
        bool acquirePublishedSource(uint8_t& bank, const PreparedSpectralSource*& source) noexcept;
        void releaseSource(uint8_t bank) noexcept;
        void retireBank(uint8_t bank) noexcept;
        void synthesizeHop(Voice&, RenderLane&) noexcept;
        void generateCanonicalHop(Voice&, RenderLane&) noexcept;
        void scheduleSynthesis(int hostSamples) noexcept;
        float readCanonical(const RenderLane&, int channel, int64_t index) const noexcept;
        std::array<float, 2> renderLaneSample(RenderLane&) noexcept;
        SourcePrepareSpec prepared;
        static constexpr int sourceBankCount = 3;
        std::array<std::shared_ptr<const PreparedSpectralSource>, sourceBankCount> sourceOwners {};
        std::array<std::atomic<const PreparedSpectralSource*>, sourceBankCount> sourcePointers {};
        std::array<std::atomic<uint32_t>, sourceBankCount> sourceReaders {};
        std::atomic<uint8_t> publishedSourceBank { 0 };
        std::shared_ptr<const PreparedSpectralSource> retiredSource;
        juce::dsp::FFT inverseFft { 10 };
        std::array<float, SpectralArtifact::fftSize> window {};
        std::array<float, sincTaps * sincPhases> sincTable {};
        std::unique_ptr<std::array<Voice, maximumVoices>> voices;
        int activeSincTaps { sincTaps };
        int releaseSamples { 192 };
        int positionCrossfadeSamples { 240 };
        double canonicalPerHostSample { 48000.0 / 44100.0 };
        std::atomic<uint64_t> requestedPositionCommand { 0 };
        std::atomic<uint64_t> acceptedPositionRequests { 0 };
        std::atomic<uint64_t> rejectedPositionRequests { 0 };
        std::atomic<uint64_t> version { 0 };
        SourceRenderTelemetry baseTelemetry;
        SpectralRenderTelemetry spectralStats;
        size_t schedulerCursor { 0 };
    };
}

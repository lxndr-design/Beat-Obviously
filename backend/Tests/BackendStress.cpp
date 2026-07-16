#include "../Source/Audio/Sequencer.h"
#include "../Source/Audio/AudioEngine.h"
#include "../Source/Audio/BeatSynthesiser.h"
#include "../Source/Audio/Analysis/AudioFileAnalyzer.h"
#include "../Source/Audio/Analysis/FftAnalyzer.h"
#include "../Source/Audio/Envelope/EnvelopeShaper.h"
#include "../Source/Audio/Filter/DriveStage.h"
#include "../Source/Audio/Filter/FilterMath.h"
#include "../Source/Audio/Filter/FilterStage.h"
#include "../Source/Audio/Effects/MasterDcBlocker.h"
#include "../Source/Audio/InstrumentVoice.h"
#include "../Source/Audio/Modulation/DynamicModulation.h"
#include "../Source/Audio/Modulation/Lfo.h"
#include "../Source/Audio/Nodemap/NodemapGraph.h"
#include "../Source/Audio/Oscillator/AetherInteractionStage.h"
#include "../Source/Audio/Oscillator/AetherTableStackRenderer.h"
#include "../Source/Audio/Oscillator/BasicOscillator.h"
#include "../Source/Audio/Parameters/ParameterIds.h"
#include "../Source/Audio/Parameters/ParameterPolicy.h"
#include "../Source/Audio/Parameters/SynthPatchContract.h"
#include "../Source/Audio/Realtime/FixedObjectPool.h"
#include "../Source/Audio/Realtime/RealtimeParameterQueue.h"
#include "../Source/Audio/Realtime/SpscRingBuffer.h"
#include "../Source/Audio/Realtime/VoiceAutomationInbox.h"
#include "../Source/Audio/Realtime/VoiceNoteAutomation.h"
#include "../Source/Audio/Recording/RecordingCalibration.h"
#include "../Source/Audio/Recording/RecordingPlanner.h"
#include "../Source/Audio/Recording/RecordingSessionPlanner.h"
#include "../Source/Audio/Rendering/TrackBouncePlanner.h"
#include "../Source/Audio/Sampler/DecentSamplerImporter.h"
#include "../Source/Audio/Sampler/SfzSubsetImporter.h"
#include "../Source/Audio/Sampler/SfzSampleResolver.h"
#include "../Source/Audio/Sampler/SfzSampleDecoder.h"
#include "../Source/Audio/Sources/SampleSourceSlot.h"
#include "../Source/Audio/Sources/SfzSourceSlot.h"
#include "../Source/Audio/Sources/BoundedSamplePageCache.h"
#include "../Source/Audio/Sources/MappedSampleSourceSlot.h"
#include "../Source/Audio/Sources/SourceSlotRack.h"
#include "../Source/Audio/Transitions/VoiceTransition.h"
#include "../Source/Audio/VoiceAllocation.h"
#include "../Source/Audio/Wavetable/WavetableFactory.h"
#include "../Source/Audio/Wavetable/WavetableOscillator.h"
#include "../Source/Persistence/ProjectAssetPackage.h"
#include "../Source/Persistence/ProjectDocumentBackup.h"
#include "../Source/Persistence/ProjectIntegrityVerifier.h"
#include "../Source/Persistence/AudioFileLibraryActions.h"
#include "../Source/Persistence/Database.h"
#include "../Source/Persistence/ManagedSfzAsset.h"
#include "../Source/Persistence/ProjectRepository.h"
#include "RealtimeSafetyProbe.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <optional>
#include <set>
#include <string_view>
#include <thread>
#include <vector>
#include <dlfcn.h>
#include <fcntl.h>
#include <pthread.h>
#include <unistd.h>

namespace
{
    bool near(float actual, float expected, float tolerance = 0.0001f)
    {
        return std::abs(actual - expected) <= tolerance;
    }

    bool stressEnvelopeShaper()
    {
        if (!(beat::EnvelopeShaper::applyCurve(0.5f, 1) < beat::EnvelopeShaper::applyCurve(0.5f, 0)))
            return false;
        if (!(beat::EnvelopeShaper::applyCurve(0.5f, 2) > beat::EnvelopeShaper::applyCurve(0.5f, 0)))
            return false;

        float previous = 0.0f;
        beat::EnvelopeShaper::LoopState state;
        const beat::EnvelopeShaper::LoopConfig config {
            10.0f,
            30.0f,
            0.0f,
            20.0f,
            0,
            0,
            0,
        };

        float firstCyclePeak = 0.0f;
        float secondCyclePeak = 0.0f;
        float latest = 0.0f;
        for (int i = 0; i < 90; ++i)
        {
            latest = beat::EnvelopeShaper::renderLoop(state, config, 1000.0, previous).value;
            if (i < 40)
                firstCyclePeak = std::max(firstCyclePeak, latest);
            else if (i < 80)
                secondCyclePeak = std::max(secondCyclePeak, latest);
            if (!std::isfinite(latest))
                return false;
        }
        if (!(firstCyclePeak > 0.9f && secondCyclePeak > 0.9f))
            return false;

        state.beginRelease(latest);
        bool completed = false;
        float released = 1.0f;
        for (int i = 0; i < 30; ++i)
        {
            const auto result = beat::EnvelopeShaper::renderLoop(state, config, 1000.0, previous);
            released = result.value;
            completed = completed || result.releaseComplete;
            if (!std::isfinite(released))
                return false;
        }
        return completed && released < 0.001f;
    }

    bool stressLfoHelper()
    {
        const float sineQuarter = beat::Lfo::value(0, 0.25);
        const float triangleQuarter = beat::Lfo::value(1, 0.25);
        const float sawQuarter = beat::Lfo::value(2, 0.25);
        const float squareQuarter = beat::Lfo::value(3, 0.25);
        if (!near(sineQuarter, 1.0f, 0.0001f))
            return false;
        if (!near(triangleQuarter, 0.0f, 0.0001f))
            return false;
        if (!near(sawQuarter, -0.5f, 0.0001f))
            return false;
        if (!near(squareQuarter, 1.0f, 0.0001f))
            return false;

        const float unsmoothed = beat::Lfo::value(3, 0.125, 0.0f);
        const float smoothed = beat::Lfo::value(3, 0.125, 1.0f);
        if (!(smoothed < unsmoothed && smoothed > 0.7f))
            return false;

        const float oneShotHeld = beat::Lfo::value(2, 1.4, 0.0f, true);
        const float looped = beat::Lfo::value(2, 1.4, 0.0f, false);
        if (!near(oneShotHeld, 1.0f, 0.0001f) || !near(looped, -0.2f, 0.0001f))
            return false;

        if (!near(beat::Lfo::effectiveRateHz(7.0f, true, "1/4", 120.0), 2.0f)
            || !near(beat::Lfo::effectiveRateHz(7.0f, true, "1/4", 60.0), 1.0f)
            || !near(beat::Lfo::effectiveRateHz(7.0f, true, "1/8t", 120.0), 6.0f)
            || !near(beat::Lfo::effectiveRateHz(7.0f, false, "1/4", 60.0), 7.0f)
            || !near(beat::Lfo::effectiveRateHz(7.0f, false, "1/4", 120.0), 7.0f))
            return false;

        return near(beat::Lfo::routeValue(-0.5f, true), -0.5f)
            && near(beat::Lfo::routeValue(-0.5f, false), 0.25f);
    }

    bool stressDynamicModulationHelper()
    {
        using Target = beat::InstrumentVoice::Params::DynamicModTarget;

        Target threshold;
        threshold.lfo = 0.00001f;
        if (beat::DynamicModulation::targetActive(threshold))
            return false;
        threshold.lfo = 0.001f;
        if (!beat::DynamicModulation::targetActive(threshold))
            return false;
        threshold = {};
        threshold.macro1 = 0.001f;
        if (!beat::DynamicModulation::targetActive(threshold))
            return false;

        if (!near(beat::DynamicModulation::routeEnvValue(0.25f, false), 0.25f))
            return false;
        if (!near(beat::DynamicModulation::routeEnvValue(0.25f, true), -0.5f))
            return false;

        Target target;
        target.lfo = 0.5f;
        target.lfoBipolar = true;
        target.lfo2 = 0.25f;
        target.lfo2Bipolar = false;
        target.env = 0.2f;
        target.envBipolar = false;
        target.env2 = 0.4f;
        target.env2Bipolar = true;
        target.velocity = 0.1f;
        target.velocityBipolar = true;
        target.keytrack = -0.2f;
        target.keytrackBipolar = false;
        target.modWheel = 0.3f;
        target.modWheelBipolar = true;

        const float offset = beat::DynamicModulation::targetOffset(
            target,
            -0.5f,
            -0.5f,
            0.75f,
            0.75f,
            0.75f,
            0.5f,
            0.25f,
            std::array<float, 8> {},
            2.0f);

        if (!near(offset, -0.075f))
            return false;

        target.macro1 = 0.2f;
        const float macroOffset = beat::DynamicModulation::targetOffset(
            target,
            -0.5f,
            -0.5f,
            0.75f,
            0.75f,
            0.75f,
            0.5f,
            0.25f,
            { 0.5f, 0.0f, 0.0f, 0.0f },
            2.0f);

        if (!near(macroOffset, 0.125f))
            return false;

        decltype(target) macro8Target;
        macro8Target.macro8 = -0.3f;
        const float macro8Offset = beat::DynamicModulation::targetOffset(
            macro8Target, 0.0f, 0.0f, 0.0f, 0.5f, 0.5f, 0.0f, 0.5f,
            { 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.75f }, 2.0f);
        if (!near(macro8Offset, -0.45f))
            return false;

        decltype(target) extraEnvelopeTarget;
        extraEnvelopeTarget.env3 = 0.4f;
        extraEnvelopeTarget.env4 = -0.25f;
        const float extraEnvelopeOffset = beat::DynamicModulation::targetOffset(
            extraEnvelopeTarget, 0.0f, 0.0f, 0.0f, 0.0f, 0.75f, 0.2f,
            0.0f, 0.0f, 0.0f, std::array<float, 8> {}, 2.0f);
        if (!near(extraEnvelopeOffset, 0.5f))
            return false;

        decltype(target) extraLfoTarget;
        extraLfoTarget.extraLfo[7] = 0.4f;
        std::array<float, 8> rawExtraLfos {};
        rawExtraLfos[7] = 0.5f;
        const float extraLfoOffset = beat::DynamicModulation::targetOffset(extraLfoTarget, 0.0f, 0.0f, rawExtraLfos,
            0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, std::array<float, 8> {}, 2.0f);
        if (!near(extraLfoOffset, 0.4f))
            return false;

        decltype(target) expressionTarget;
        expressionTarget.pressure = 0.4f;
        expressionTarget.timbre = -0.2f;
        expressionTarget.timbreBipolar = true;
        const float expressionOffset = beat::DynamicModulation::targetOffset(
            expressionTarget, 0.0f, 0.0f, std::array<float, 8> {},
            0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.75f, 0.25f,
            std::array<float, 8> {}, 2.0f);
        if (!near(expressionOffset, 0.8f))
            return false;

        beat::DynamicModulation::TargetActivityFlags noFlags;
        const auto legacyPitchPlan = beat::DynamicModulation::makeRenderPlan(noFlags, false, true, 7.0f, 0.0f, 0.0f, 0.0f);
        if (!near(legacyPitchPlan.pitchMod, 7.0f)
            || legacyPitchPlan.useDynamicModulation
            || !legacyPitchPlan.hasPitchMod
            || legacyPitchPlan.hasPositionMod
            || legacyPitchPlan.hasFilterMod
            || !legacyPitchPlan.needsLfoValue
            || legacyPitchPlan.needsLfo2Value)
            return false;

        const auto legacyFilterPlan = beat::DynamicModulation::makeRenderPlan(noFlags, false, false, -2.0f, 0.0f, 0.25f, 0.0f);
        if (!near(legacyFilterPlan.pitchMod, 0.0f)
            || legacyFilterPlan.hasPitchMod
            || !legacyFilterPlan.hasFilterMod
            || !legacyFilterPlan.needsLfoValue)
            return false;

        const auto legacyEnvFilterPlan = beat::DynamicModulation::makeRenderPlan(noFlags, false, false, 0.0f, 0.0f, 0.0f, 0.4f);
        if (!legacyEnvFilterPlan.hasFilterMod
            || legacyEnvFilterPlan.needsLfoValue
            || legacyEnvFilterPlan.needsLfo2Value
            || legacyEnvFilterPlan.needsEnv2Value)
            return false;

        beat::InstrumentVoice::Params::DynamicModulation disabled;
        disabled.oscAPosition.lfo = 1.0f;
        if (beat::DynamicModulation::targetActivityFlags(disabled).any)
            return false;

        beat::InstrumentVoice::Params::DynamicModulation modulation;
        modulation.active = true;
        modulation.oscAPosition.lfo = 0.5f;
        modulation.oscBPan.env2 = 0.2f;
        modulation.oscBPan.lfo2 = 0.15f;
        modulation.filterCutoff.velocity = 0.3f;
        modulation.filterResonance.modWheel = 0.4f;
        modulation.ampLevel.keytrack = 0.2f;
        modulation.ampPan.lfo = 0.2f;
        modulation.filterDrive.pressure = 0.25f;
        modulation.oscALevel.timbre = 0.2f;
        const auto flags = beat::DynamicModulation::targetActivityFlags(modulation);
        const bool ok = flags.any
            && flags.oscAPosition
            && flags.oscBPan
            && flags.filterCutoff
            && flags.filterResonance
            && flags.ampLevel
            && flags.ampPan
            && !flags.oscAPan
            && flags.filterDrive
            && flags.lfo
            && flags.lfo2
            && flags.env2
            && flags.velocity
            && flags.keytrack
            && flags.modWheel
            && flags.pressure
            && flags.timbre
            && beat::DynamicModulation::hasFilterCoefficientMod(flags);
        if (!ok)
            return false;

        const auto dynamicPlan = beat::DynamicModulation::makeRenderPlan(flags, true, true, 0.0f, 0.0f, 0.0f, 0.0f);
        if (!dynamicPlan.useDynamicModulation
            || dynamicPlan.hasPitchMod
            || dynamicPlan.hasPositionMod
            || !dynamicPlan.hasFilterMod
            || !dynamicPlan.needsLfoValue
            || !dynamicPlan.needsLfo2Value
            || !dynamicPlan.needsEnv2Value
            || !dynamicPlan.hasAmpPanMod)
            return false;

        const auto inactiveDynamicPlan = beat::DynamicModulation::makeRenderPlan(flags, false, true, 0.0f, 0.0f, 0.0f, 0.0f);
        if (inactiveDynamicPlan.useDynamicModulation
            || inactiveDynamicPlan.hasFilterMod
            || inactiveDynamicPlan.needsLfoValue
            || inactiveDynamicPlan.needsLfo2Value
            || inactiveDynamicPlan.needsEnv2Value
            || !inactiveDynamicPlan.hasAmpPanMod)
            return false;

        beat::InstrumentVoice::Params::DynamicModulation sourceLiteModulation;
        sourceLiteModulation.active = true;
        sourceLiteModulation.ampLevel.velocity = 0.25f;
        sourceLiteModulation.filterDrive.modWheel = 0.2f;
        const auto sourceLiteFlags = beat::DynamicModulation::targetActivityFlags(sourceLiteModulation);
        const auto sourceLitePlan = beat::DynamicModulation::makeRenderPlan(sourceLiteFlags, true, true, 0.0f, 0.0f, 0.0f, 0.0f);
        if (!sourceLitePlan.useDynamicModulation
            || !sourceLiteFlags.velocity
            || !sourceLiteFlags.modWheel
            || sourceLiteFlags.lfo
            || sourceLiteFlags.lfo2
            || sourceLiteFlags.env2
            || sourceLitePlan.needsLfoValue
            || sourceLitePlan.needsLfo2Value
            || sourceLitePlan.needsEnv2Value)
            return false;

        return true;
    }

    bool stressBasicOscillatorHelper()
    {
        const double delta = 0.01;
        if (!near(beat::BasicOscillator::sample(0, 0.25, delta), 1.0f))
            return false;
        if (!near(beat::BasicOscillator::sample(3, 0.5, delta), -1.0f))
            return false;
        if (!near(beat::BasicOscillator::sample(1, 0.5, delta), 0.0f))
            return false;
        if (!near(beat::BasicOscillator::sample(2, 0.25, delta), 1.0f))
            return false;

        const float sawAtEdge = beat::BasicOscillator::sample(1, 0.001, delta);
        const float sawAwayFromEdge = beat::BasicOscillator::sample(1, 0.25, delta);
        if (!(sawAtEdge > -0.25f && sawAtEdge < 0.25f && near(sawAwayFromEdge, -0.5f)))
            return false;

        const float squareAtEdge = beat::BasicOscillator::sample(2, 0.001, delta);
        const float squareAwayFromEdge = beat::BasicOscillator::sample(2, 0.25, delta);
        if (!(squareAtEdge > 0.0f && squareAtEdge < 0.5f && squareAwayFromEdge > 0.99f))
            return false;

        for (int i = 0; i < 128; ++i)
        {
            const float noise = beat::BasicOscillator::sample(4, (double) i / 128.0, delta);
            if (!std::isfinite(noise) || noise < -1.0001f || noise > 1.0001f)
                return false;
        }

        return true;
    }

    bool stressNodemapNativeGraphContract()
    {
        using namespace beat::Nodemap;

        for (const auto kind : {
                 NodeKind::InstrumentOut, NodeKind::Oscillator, NodeKind::ExistingInstrument, NodeKind::Noise,
                 NodeKind::OscillatorMerge, NodeKind::Mixer, NodeKind::Gain, NodeKind::Filter, NodeKind::Envelope, NodeKind::Lfo,
                 NodeKind::Constant, NodeKind::CvScale, NodeKind::Velocity, NodeKind::Keytrack, NodeKind::ModWheel,
                 NodeKind::Macro, NodeKind::Random, NodeKind::Unison, NodeKind::Shaper, NodeKind::Distortion,
                 NodeKind::Delay, NodeKind::Chorus, NodeKind::Reverb, NodeKind::Phaser, NodeKind::Flanger,
                 NodeKind::Compressor, NodeKind::Bitcrush,
             })
        {
            const auto asText = nodeKindToString(kind);
            if (nodeKindFromString(asText) != kind)
                return false;
            const auto& definition = definitionFor(kind);
            if (definition.ports.empty())
                return false;
            if (kind == NodeKind::InstrumentOut && definition.category != NodeCategory::Output)
                return false;
        }

        auto graph = makeBasicOscillatorGraph();
        graph.nodes.push_back({ "node-extra-out", NodeKind::InstrumentOut, "Bad Out", 800, 240, {} });
        graph.nodes.push_back({ "node-noise", NodeKind::Noise, "Noise", 100, 300, {} });
        graph.nodes.push_back({ "node-lfo", NodeKind::Lfo, "LFO", 100, 420, {} });
        graph.cables.push_back({ "self-cable", "node-osc", "audio-out", "node-osc", "level", 1.0f });
        graph.cables.push_back({ "wrong-signal", "node-lfo", "cv-out", "node-out", "audio-in", 1.0f });
        graph.cables.push_back({ "missing-port", "node-noise", "not-real", "node-out", "audio-in", 1.0f });
        graph.cables.push_back({ "missing-node", "node-missing", "audio-out", "node-out", "audio-in", 1.0f });
        graph.cables.push_back({ "multi-input", "node-noise", "audio-out", "node-out", "audio-in", 0.25f });
        graph.cables.push_back({ "duplicate-edge", "node-noise", "audio-out", "node-out", "audio-in", 0.5f });

        const auto result = validateAndNormalize(graph);
        const auto outputCount = std::count_if(result.graph.nodes.begin(), result.graph.nodes.end(), [](const Node& node) {
            return node.kind == NodeKind::InstrumentOut;
        });
        const bool hasDuplicateOutputIssue = std::any_of(result.issues.begin(), result.issues.end(), [](const Issue& issue) {
            return issue.id == "duplicate-output";
        });
        const bool hasWrongSignalIssue = std::any_of(result.issues.begin(), result.issues.end(), [](const Issue& issue) {
            return issue.id == "wrong-signal";
        });
        const bool hasSelfCableIssue = std::any_of(result.issues.begin(), result.issues.end(), [](const Issue& issue) {
            return issue.id == "self-cable";
        });
        const auto routedAudioCables = std::count_if(result.graph.cables.begin(), result.graph.cables.end(), [](const Cable& cable) {
            return cable.toNodeId == "node-out" && cable.toPortId == "audio-in";
        });

        auto frontendGraph = makeOutputOnlyGraph();
        frontendGraph.nodes.push_back({ "frontend-osc-a", NodeKind::Oscillator, "Frontend Osc A", 100, 120, { { "level", 0.35f } } });
        frontendGraph.nodes.push_back({ "frontend-osc-b", NodeKind::Oscillator, "Frontend Osc B", 100, 300, { { "level", 0.25f } } });
        frontendGraph.nodes.push_back({ "frontend-merge", NodeKind::OscillatorMerge, "Oscillator Merge", 320, 210, { { "levelA", 1.0f }, { "levelB", 0.7f } } });
        frontendGraph.nodes.push_back({ "frontend-filter", NodeKind::Filter, "Frontend Filter", 520, 210, { { "cutoff", 8400.0f }, { "resonance", 0.18f }, { "drive", 0.04f } } });
        frontendGraph.nodes.push_back({ "frontend-gain", NodeKind::Gain, "Frontend Volume", 720, 210, { { "level", 0.65f }, { "pan", 0.0f } } });
        frontendGraph.nodes.push_back({ "frontend-env", NodeKind::Envelope, "Envelope", 320, 420, { { "attack", 0.005f }, { "decay", 0.12f }, { "sustain", 0.2f } } });
        frontendGraph.nodes.push_back({ "frontend-lfo", NodeKind::Lfo, "LFO", 520, 420, { { "rate", 3.0f }, { "amount", 0.2f } } });
        frontendGraph.cables.push_back({ "frontend-a-merge", "frontend-osc-a", "audio-out", "frontend-merge", "osc-a", 1.0f });
        frontendGraph.cables.push_back({ "frontend-b-merge", "frontend-osc-b", "audio-out", "frontend-merge", "osc-b", 1.0f });
        frontendGraph.cables.push_back({ "frontend-merge-filter", "frontend-merge", "audio-out", "frontend-filter", "audio-in", 1.0f });
        frontendGraph.cables.push_back({ "frontend-lfo-filter", "frontend-lfo", "cv-out", "frontend-filter", "cutoff-cv", 0.2f });
        frontendGraph.cables.push_back({ "frontend-filter-gain", "frontend-filter", "audio-out", "frontend-gain", "audio-in", 1.0f });
        frontendGraph.cables.push_back({ "frontend-env-gain", "frontend-env", "cv-out", "frontend-gain", "level-cv", 0.2f });
        frontendGraph.cables.push_back({ "frontend-gain-out", "frontend-gain", "audio-out", "node-out", "audio-in", 1.0f });

        const auto frontendValidation = validateAndNormalize(frontendGraph);
        const auto frontendRender = renderOneNote(frontendGraph, { 48000.0, 4096, 69, 0.8f });
        const bool keptFrontendPorts = std::any_of(frontendValidation.graph.cables.begin(), frontendValidation.graph.cables.end(), [](const Cable& cable) {
            return cable.toPortId == "cutoff-cv";
        }) && std::any_of(frontendValidation.graph.cables.begin(), frontendValidation.graph.cables.end(), [](const Cable& cable) {
            return cable.toPortId == "level-cv";
        }) && std::any_of(frontendValidation.graph.nodes.begin(), frontendValidation.graph.nodes.end(), [](const Node& node) {
            return node.kind == NodeKind::OscillatorMerge;
        });

        return result.valid
            && result.hasOutput
            && outputCount == 1
            && routedAudioCables == 2
            && hasDuplicateOutputIssue
            && hasWrongSignalIssue
            && hasSelfCableIssue
            && frontendValidation.valid
            && frontendValidation.hasAudioPathToOutput
            && keptFrontendPorts
            && !frontendRender.silent
            && frontendRender.finiteSamples == 8192;
    }

    bool stressNodemapNativeAuditionAndCycles()
    {
        using namespace beat::Nodemap;

        const auto silent = renderOneNote(makeOutputOnlyGraph(), { 48000.0, 2048, 60, 0.8f });
        if (!silent.silent || silent.peak != 0.0f || silent.finiteSamples != 0)
            return false;

        const auto audible = renderOneNote(makeBasicOscillatorGraph(), { 48000.0, 4096, 64, 0.8f });
        if (audible.silent || audible.peak <= 0.01f || audible.rms <= 0.001f || audible.finiteSamples != 8192)
            return false;

        auto cycle = makeOutputOnlyGraph();
        cycle.nodes.push_back({ "cycle-a", NodeKind::Mixer, "Cycle A", 100, 100, {} });
        cycle.nodes.push_back({ "cycle-b", NodeKind::Mixer, "Cycle B", 300, 100, {} });
        cycle.nodes.push_back({ "cycle-source", NodeKind::Oscillator, "Source", 100, 260, {} });
        cycle.cables.push_back({ "source-a", "cycle-source", "audio-out", "cycle-a", "in-1", 1.0f });
        cycle.cables.push_back({ "a-b", "cycle-a", "audio-out", "cycle-b", "in-1", 1.0f });
        cycle.cables.push_back({ "b-a", "cycle-b", "audio-out", "cycle-a", "in-2", 1.0f });
        cycle.cables.push_back({ "a-out", "cycle-a", "audio-out", "node-out", "audio-in", 1.0f });

        const auto validation = validateAndNormalize(cycle);
        if (!validation.hasCycle || !validation.valid)
            return false;
        const auto cyclicRender = renderOneNote(cycle, { 48000.0, 2048, 60, 0.75f });
        return cyclicRender.finiteSamples == 4096
            && std::isfinite(cyclicRender.rms)
            && cyclicRender.peak <= 1.0f;
    }

    bool stressNodemapNativeEffectsAndTemplates()
    {
        using namespace beat::Nodemap;

        auto graph = makeBasicOscillatorGraph();
        graph.nodes.push_back({ "env", NodeKind::Envelope, "Envelope", 120, 480, { { "attack", 0.005f }, { "decay", 0.08f }, { "sustain", 0.25f } } });
        graph.nodes.push_back({ "lfo", NodeKind::Lfo, "LFO", 250, 480, { { "rate", 4.0f }, { "depth", 0.1f } } });
        graph.nodes.push_back({ "constant", NodeKind::Constant, "Constant", 380, 480, { { "value", 0.2f } } });
        graph.nodes.push_back({ "scale", NodeKind::CvScale, "Scale", 510, 480, { { "amount", -0.5f }, { "offset", 0.05f }, { "clamp", 1.0f } } });
        graph.nodes.push_back({ "velocity", NodeKind::Velocity, "Velocity", 640, 480, {} });
        graph.nodes.push_back({ "keytrack", NodeKind::Keytrack, "Keytrack", 770, 480, {} });
        graph.nodes.push_back({ "mod", NodeKind::ModWheel, "Mod", 900, 480, {} });
        graph.nodes.push_back({ "macro", NodeKind::Macro, "Macro", 1030, 480, {} });
        graph.nodes.push_back({ "random", NodeKind::Random, "Random", 1160, 480, {} });
        graph.nodes.push_back({ "filter", NodeKind::Filter, "Filter", 480, 240, { { "cutoff", 0.7f }, { "resonance", 0.2f } } });
        graph.nodes.push_back({ "unison", NodeKind::Unison, "Unison", 620, 240, { { "voices", 6.0f } } });
        graph.nodes.push_back({ "shaper", NodeKind::Shaper, "Shaper", 760, 240, { { "drive", 0.2f } } });
        graph.nodes.push_back({ "distortion", NodeKind::Distortion, "Distortion", 900, 240, { { "drive", 0.1f } } });
        graph.nodes.push_back({ "delay", NodeKind::Delay, "Delay", 1040, 240, {} });
        graph.nodes.push_back({ "chorus", NodeKind::Chorus, "Chorus", 1180, 240, {} });
        graph.nodes.push_back({ "reverb", NodeKind::Reverb, "Reverb", 1320, 240, {} });
        graph.nodes.push_back({ "phaser", NodeKind::Phaser, "Phaser", 1460, 240, {} });
        graph.nodes.push_back({ "flanger", NodeKind::Flanger, "Flanger", 1600, 240, {} });
        graph.nodes.push_back({ "compressor", NodeKind::Compressor, "Compressor", 1740, 240, {} });
        graph.nodes.push_back({ "bitcrush", NodeKind::Bitcrush, "Bitcrush", 1880, 240, {} });
        graph.cables.clear();
        graph.cables.push_back({ "osc-filter", "node-osc", "audio-out", "filter", "audio-in", 1.0f });
        graph.cables.push_back({ "constant-scale", "constant", "cv-out", "scale", "cv-in", 1.0f });
        graph.cables.push_back({ "scale-filter", "scale", "cv-out", "filter", "cutoff", 0.25f });
        graph.cables.push_back({ "env-osc", "env", "cv-out", "node-osc", "level", 0.08f });
        graph.cables.push_back({ "lfo-filter", "lfo", "cv-out", "filter", "resonance", 0.05f });
        graph.cables.push_back({ "velocity-filter", "velocity", "cv-out", "filter", "drive", 0.05f });
        graph.cables.push_back({ "filter-unison", "filter", "audio-out", "unison", "audio-in", 1.0f });
        graph.cables.push_back({ "key-unison", "keytrack", "cv-out", "unison", "detune", 0.04f });
        graph.cables.push_back({ "mod-unison", "mod", "cv-out", "unison", "spread", 0.04f });
        graph.cables.push_back({ "macro-unison", "macro", "cv-out", "unison", "voices", 0.02f });
        graph.cables.push_back({ "unison-shaper", "unison", "audio-out", "shaper", "audio-in", 1.0f });
        graph.cables.push_back({ "random-shaper", "random", "cv-out", "shaper", "drive", 0.02f });
        graph.cables.push_back({ "shaper-dist", "shaper", "audio-out", "distortion", "audio-in", 1.0f });
        graph.cables.push_back({ "dist-delay", "distortion", "audio-out", "delay", "audio-in", 1.0f });
        graph.cables.push_back({ "delay-chorus", "delay", "audio-out", "chorus", "audio-in", 1.0f });
        graph.cables.push_back({ "chorus-reverb", "chorus", "audio-out", "reverb", "audio-in", 1.0f });
        graph.cables.push_back({ "reverb-phaser", "reverb", "audio-out", "phaser", "audio-in", 1.0f });
        graph.cables.push_back({ "phaser-flanger", "phaser", "audio-out", "flanger", "audio-in", 1.0f });
        graph.cables.push_back({ "flanger-compressor", "flanger", "audio-out", "compressor", "audio-in", 1.0f });
        graph.cables.push_back({ "compressor-bitcrush", "compressor", "audio-out", "bitcrush", "audio-in", 1.0f });
        graph.cables.push_back({ "bitcrush-out", "bitcrush", "audio-out", "node-out", "audio-in", 1.0f });

        const auto render = renderOneNote(graph, { 48000.0, 4096, 61, 0.82f, 0.48f, 0.37f, 0.63f });
        if (render.silent || render.peak <= 0.01f || render.peak > 1.0f || render.finiteSamples != 8192)
            return false;

        for (const auto templateId : { "basic-oscillator", "filtered-mono", "moving-texture", "snare-hit", "tom-hit", "crash-hit" })
        {
            const auto proof = makeProofTemplate(templateId);
            const auto proofValidation = validateAndNormalize(proof);
            const auto proofRender = renderOneNote(proof, { 48000.0, 2048, 60, 0.8f });
            if (!proofValidation.valid || !proofValidation.hasAudioPathToOutput || proofRender.silent || proofRender.finiteSamples != 4096)
                return false;
        }

        return true;
    }

    bool stressNodemapNativeLargeGraphTiming()
    {
        using namespace beat::Nodemap;

        const auto graph = makeLargeStressGraph(100, 300);
        const auto start = std::chrono::steady_clock::now();
        ValidationResult validation;
        for (int i = 0; i < 30; ++i)
            validation = validateAndNormalize(graph);
        const auto validateMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
        if (!validation.valid || !validation.hasAudioPathToOutput || graph.nodes.size() < 100 || graph.cables.size() < 300 || validateMs > 1500.0)
            return false;

        const auto renderStart = std::chrono::steady_clock::now();
        const auto render = renderOneNote(graph, { 48000.0, 4096, 60, 0.8f });
        const auto renderMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - renderStart).count();
        return !render.silent
            && render.peak > 0.0001f
            && render.peak <= 1.0f
            && render.finiteSamples == 8192
            && renderMs < 1500.0;
    }

    bool stressProjectRepositoryNodemapInstrumentRoundtrip()
    {
        using namespace beat::Nodemap;

        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-nodemap-instrument-repository-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("projects.sqlite");
        if (!root.createDirectory())
            return false;

        beat::Project project;
        project.id = "nodemap-repository-project";
        project.name = "Nodemap Repository Project";
        project.bpm = 126.0;
        project.lengthBeats = 4.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "native-nodemap";
        instrument.kind = "nodemap";
        instrument.nodeGraph = makeProofTemplate("moving-texture");
        project.instruments.push_back(instrument);

        for (int i = 0; i < 2; ++i)
        {
            beat::Track track;
            track.id = "nodemap-track-" + juce::String(i + 1);
            track.name = "Nodemap Track " + juce::String(i + 1);
            track.kind = beat::TrackKind::Midi;
            track.instrumentId = instrument.id;
            project.tracks.push_back(std::move(track));
        }

        beat::Database db(dbFile);
        beat::ProjectRepository repo(db);
        repo.save(project);
        const auto loaded = repo.load(project.id);

        bool ok = loaded.has_value()
            && loaded->instruments.size() == 1
            && loaded->instruments.front().nodeGraph.has_value()
            && loaded->tracks.size() == 2
            && loaded->tracks[0].instrumentId == instrument.id
            && loaded->tracks[1].instrumentId == instrument.id;

        float beforeRms = 0.0f;
        float afterRms = 0.0f;
        bool deterministicParity = false;
        if (ok)
        {
            const auto& loadedGraph = *loaded->instruments.front().nodeGraph;
            const auto validation = validateAndNormalize(loadedGraph);
            const auto renderA = renderOneNote(loadedGraph, { 48000.0, 4096, 62, 0.8f });
            const auto renderB = renderOneNote(loadedGraph, { 48000.0, 4096, 62, 0.8f });
            beforeRms = renderA.rms;
            deterministicParity = renderA.finiteSamples == renderB.finiteSamples
                && near(renderA.rms, renderB.rms, 0.000001f)
                && near(renderA.peak, renderB.peak, 0.000001f);

            auto edited = loadedGraph;
            for (auto& node : edited.nodes)
            {
                if (node.kind == NodeKind::Oscillator)
                    node.params["level"] = 0.18f;
            }
            afterRms = renderOneNote(edited, { 48000.0, 4096, 62, 0.8f }).rms;

            ok = validation.valid
                && validation.hasAudioPathToOutput
                && !renderA.silent
                && deterministicParity
                && std::abs(beforeRms - afterRms) > 0.0001f;
        }

        root.deleteRecursively();
        if (!ok)
        {
            std::cerr << "Nodemap repository roundtrip failed loaded=" << loaded.has_value()
                      << " beforeRms=" << beforeRms
                      << " afterRms=" << afterRms
                      << " parity=" << deterministicParity << "\n";
        }
        return ok;
    }

    bool stressVoiceRenderWorkBlock()
    {
        beat::VoiceStats::RenderWorkBlock block;
        block.begin(128, 2);
        block.addOscillatorSamples(7);
        block.addWavetableRender(16, 3, 4);
        block.addFilterDriveSamples(256);
        block.addNonlinearSamples(128);
        block.addFilterCutoffUpdates(5);
        block.addFilterResonanceUpdates(2);
        block.addModulationSamples(64);
        block.addRealtimeRampSamples(9);

        beat::VoiceStats::RenderWork delta;
        delta.aetherOscASamples = 11;
        delta.aetherOscBSamples = 12;
        delta.aetherSubSamples = 13;
        delta.aetherNoiseSamples = 14;
        delta.oscillatorRateCalculations = 6;
        delta.wavetableFrequencyUpdates = 8;
        delta.wavetablePositionUpdates = 10;
        block.add(delta);

        const auto& work = block.snapshot();
        if (work.voiceBlocks != 1
            || work.voiceSamples != 128
            || work.filterSamples != 256
            || work.oscillatorSamples != 7
            || work.wavetableVoiceSamples != 16
            || work.wavetableFrequencyUpdates != 11
            || work.wavetablePositionUpdates != 14
            || work.filterDriveSamples != 256
            || work.nonlinearSamples != 128
            || work.filterCutoffUpdates != 5
            || work.filterResonanceUpdates != 2
            || work.filterCoefficientUpdates != 7
            || work.modulationSamples != 64
            || work.realtimeRampSamples != 9
            || work.aetherOscASamples != 11
            || work.aetherOscBSamples != 12
            || work.aetherSubSamples != 13
            || work.aetherNoiseSamples != 14
            || work.oscillatorRateCalculations != 6)
            return false;

        block.begin(4, 1);
        const auto& reset = block.snapshot();
        return reset.voiceBlocks == 1
            && reset.voiceSamples == 4
            && reset.filterSamples == 4
            && reset.oscillatorSamples == 0
            && reset.nonlinearSamples == 0
            && reset.filterCoefficientUpdates == 0
            && reset.wavetableFrequencyUpdates == 0;
    }

    bool stressVoiceRenderWorkBudgets()
    {
        constexpr int64_t voiceSamples = 128;
        constexpr auto modulationCeiling = beat::RenderBudgets::voiceModulationWorkCeiling(voiceSamples);
        constexpr auto nonlinearCeiling = beat::RenderBudgets::voiceNonlinearWorkCeiling(voiceSamples);

        return modulationCeiling == voiceSamples * beat::RenderBudgets::modulationEvaluationsPerVoiceSample
            && nonlinearCeiling == voiceSamples * beat::RenderBudgets::nonlinearEvaluationsPerVoiceSample
            && !beat::RenderBudgets::exceedsVoiceModulationWorkCeiling(modulationCeiling, voiceSamples)
            && beat::RenderBudgets::exceedsVoiceModulationWorkCeiling(modulationCeiling + 1, voiceSamples)
            && beat::RenderBudgets::exceedsVoiceModulationWorkCeiling(-1, voiceSamples)
            && !beat::RenderBudgets::exceedsVoiceNonlinearWorkCeiling(nonlinearCeiling, voiceSamples)
            && beat::RenderBudgets::exceedsVoiceNonlinearWorkCeiling(nonlinearCeiling + 1, voiceSamples)
            && beat::RenderBudgets::exceedsVoiceNonlinearWorkCeiling(-1, voiceSamples)
            && beat::RenderBudgets::voiceModulationWorkCeiling(std::numeric_limits<int64_t>::max())
                == std::numeric_limits<int64_t>::max();
    }

    double measureAetherInteractionAliasRatio(int mode, beat::AudioQuality quality = beat::AudioQuality::standardLive)
    {
        constexpr double sampleRate = 44100.0;
        constexpr int fftOrder = 12;
        constexpr int fftSize = 1 << fftOrder;
        beat::InstrumentVoice::Params params;
        params.hasAether = true;
        params.attackMs = 0.0f;
        params.decayMs = 0.0f;
        params.sustain = 1.0f;
        params.aetherOscA = { true, 0.7f, 0.0f, 0, 0, 0, 0.0f };
        params.aetherOscA.routing = 1;
        params.aetherOscB = { true, 0.5f, 0.0f, 0, 0, 0, 0.0f };
        params.aetherOscB.tuningMode = 1;
        params.aetherOscB.harmonic = 3;
        params.aetherOscB.routing = 1;
        params.aetherInteractionMode = mode;
        params.aetherInteractionAmount = 1.0f;

        beat::InstrumentVoice voice;
        voice.prepare(sampleRate, 256);
        voice.setProcessingQuality(quality);
        voice.setParams(params);
        voice.startNote(117, 1.0f, nullptr, 8192); // 7040 Hz carrier; 28160 Hz sum aliases to 15940 Hz.
        juce::AudioBuffer<float> output(2, fftSize);
        output.clear();
        voice.renderNextBlock(output, 0, fftSize);

        std::array<float, fftSize * 2> spectrum {};
        std::copy(output.getReadPointer(0), output.getReadPointer(0) + fftSize, spectrum.begin());
        juce::dsp::WindowingFunction<float> window(fftSize, juce::dsp::WindowingFunction<float>::hann, false);
        window.multiplyWithWindowingTable(spectrum.data(), fftSize);
        juce::dsp::FFT fft(fftOrder);
        fft.performFrequencyOnlyForwardTransform(spectrum.data(), true);

        const int aliasBin = (int) std::round(15940.0 * fftSize / sampleRate);
        double totalEnergy = 0.0;
        double aliasEnergy = 0.0;
        for (int bin = 1; bin < fftSize / 2; ++bin)
        {
            const double energy = (double) spectrum[(size_t) bin] * spectrum[(size_t) bin];
            totalEnergy += energy;
            if (std::abs(bin - aliasBin) <= 2)
                aliasEnergy += energy;
        }
        return totalEnergy > 0.0 ? aliasEnergy / totalEnergy : 0.0;
    }

    double measureOversampledAetherInteractionAliasRatio(int mode, beat::AudioQuality quality)
    {
        constexpr double sampleRate = 44100.0;
        constexpr int fftOrder = 12;
        constexpr int fftSize = 1 << fftOrder;
        constexpr double carrierHz = 7040.0;
        constexpr double modulatorHz = 21120.0;
        beat::AetherInteractionStage::State stage;
        stage.prepare(sampleRate, quality);
        stage.reset();

        std::array<float, fftSize * 2> spectrum {};
        int64_t oversampleIndex = 0;
        for (int sample = 0; sample < fftSize; ++sample)
        {
            spectrum[(size_t) sample] = stage.process(mode, [&](int, int) noexcept
            {
                const double time = (double) oversampleIndex++ / (sampleRate * (double) stage.factor);
                return std::pair {
                    (float) std::sin(juce::MathConstants<double>::twoPi * carrierHz * time),
                    (float) std::sin(juce::MathConstants<double>::twoPi * modulatorHz * time),
                };
            });
        }

        juce::dsp::WindowingFunction<float> window(fftSize, juce::dsp::WindowingFunction<float>::hann, false);
        window.multiplyWithWindowingTable(spectrum.data(), fftSize);
        juce::dsp::FFT fft(fftOrder);
        fft.performFrequencyOnlyForwardTransform(spectrum.data(), true);

        const int aliasBin = (int) std::round(15940.0 * fftSize / sampleRate);
        double totalEnergy = 0.0;
        double aliasEnergy = 0.0;
        for (int bin = 1; bin < fftSize / 2; ++bin)
        {
            const double energy = (double) spectrum[(size_t) bin] * spectrum[(size_t) bin];
            totalEnergy += energy;
            if (std::abs(bin - aliasBin) <= 2)
                aliasEnergy += energy;
        }
        return totalEnergy > 0.0 ? aliasEnergy / totalEnergy : 0.0;
    }

    bool stressAetherInteractionSpectralBaseline()
    {
        constexpr double historicalAmAliasRatio = 0.0705697;
        constexpr double historicalRingAliasRatio = 0.24735;
        const double amAliasRatio = measureAetherInteractionAliasRatio(1);
        const double ringAliasRatio = measureAetherInteractionAliasRatio(2);
        const double offlineRingProductionAliasRatio = measureAetherInteractionAliasRatio(
            2, beat::AudioQuality::offlineHighQuality);
        const double oversampledAmAliasRatio = measureOversampledAetherInteractionAliasRatio(1, beat::AudioQuality::standardLive);
        const double oversampledRingAliasRatio = measureOversampledAetherInteractionAliasRatio(2, beat::AudioQuality::standardLive);
        const double offlineRingAliasRatio = measureOversampledAetherInteractionAliasRatio(2, beat::AudioQuality::offlineHighQuality);
        beat::AetherInteractionStage::State callbackStage;
        callbackStage.prepare(48000.0, beat::AudioQuality::standardLive);
        beat::test::beginRealtimeSafetyProbe();
        float callbackProbeOutput = 0.0f;
        for (int sample = 0; sample < 64; ++sample)
            callbackProbeOutput += callbackStage.process(2, [sample](int subsample, int factor) noexcept
            {
                const float phase = (float) (sample * factor + subsample) / (float) (64 * factor);
                return std::pair { phase * 2.0f - 1.0f, 1.0f - phase * 2.0f };
            });
        const size_t callbackViolations = beat::test::endRealtimeSafetyProbe();
        std::cerr << "Aether interaction alias historical1xAm=" << historicalAmAliasRatio
                  << " historical1xRing=" << historicalRingAliasRatio
                  << " production2xAm=" << amAliasRatio
                  << " production2xRing=" << ringAliasRatio
                  << " productionOfflineRing=" << offlineRingProductionAliasRatio
                  << " candidate2xAm=" << oversampledAmAliasRatio
                  << " candidate2xRing=" << oversampledRingAliasRatio
                  << " candidateOfflineRing=" << offlineRingAliasRatio << "\n";
        bool ratesFinite = true;
        for (const double rate : { 44100.0, 48000.0, 88200.0, 96000.0, 192000.0 })
        {
            beat::InstrumentVoice::Params params;
            params.hasAether = true;
            params.attackMs = 0.0f; params.decayMs = 0.0f; params.sustain = 1.0f;
            params.aetherOscA = { true, 0.7f, 0.0f, 0, 0, 0, 0.0f };
            params.aetherOscB = { true, 0.5f, 0.0f, 0, 0, 7, 0.0f };
            params.aetherOscA.routing = 1; params.aetherOscB.routing = 1;
            params.aetherInteractionMode = 2; params.aetherInteractionAmount = 1.0f;
            beat::InstrumentVoice voice;
            voice.prepare(rate, 256);
            voice.setParams(params);
            voice.startNote(69, 1.0f, nullptr, 8192);
            juce::AudioBuffer<float> output(2, 2048);
            output.clear();
            voice.renderNextBlock(output, 0, output.getNumSamples());
            for (int channel = 0; channel < output.getNumChannels(); ++channel)
                for (int sample = 0; sample < output.getNumSamples(); ++sample)
                    ratesFinite &= std::isfinite(output.getSample(channel, sample));
        }

        beat::InstrumentVoice::Params callbackParams;
        callbackParams.hasAether = true;
        callbackParams.attackMs = 0.0f;
        callbackParams.decayMs = 0.0f;
        callbackParams.sustain = 1.0f;
        callbackParams.aetherOscA = { true, 0.7f, 0.0f, 0, 0, 0, 0.0f };
        callbackParams.aetherOscB = { true, 0.5f, 0.0f, 0, 0, 7, 0.0f };
        callbackParams.aetherOscA.waveform = 5;
        callbackParams.aetherOscA.wavetable.unison = 3;
        callbackParams.aetherOscB.waveform = 4;
        callbackParams.aetherInteractionMode = 2;
        callbackParams.aetherInteractionAmount = 1.0f;
        beat::InstrumentVoice callbackVoice;
        callbackVoice.prepare(48000.0, 256);
        callbackVoice.setParams(callbackParams);
        callbackVoice.startNote(81, 1.0f, nullptr, 8192);
        juce::AudioBuffer<float> callbackOutput(2, 512);
        callbackOutput.clear();
        callbackVoice.renderNextBlock(callbackOutput, 0, 256);
        beat::InstrumentVoice::consumeRenderWorkStats();
        beat::test::beginRealtimeSafetyProbe();
        callbackVoice.renderNextBlock(callbackOutput, 256, 256);
        const size_t productionCallbackViolations = beat::test::endRealtimeSafetyProbe();
        const auto productionWork = beat::InstrumentVoice::consumeRenderWorkStats();
        bool productionOutputFinite = true;
        for (int channel = 0; channel < callbackOutput.getNumChannels(); ++channel)
            for (int sample = 256; sample < callbackOutput.getNumSamples(); ++sample)
                productionOutputFinite &= std::isfinite(callbackOutput.getSample(channel, sample));

        const auto renderCompatibilityPath = [](int mode, float amount)
        {
            beat::InstrumentVoice::Params pathParams;
            pathParams.hasAether = true;
            pathParams.attackMs = 0.0f;
            pathParams.decayMs = 0.0f;
            pathParams.sustain = 1.0f;
            pathParams.aetherOscA = { true, 0.7f, 0.0f, 0, 0, 0, 0.0f };
            pathParams.aetherOscB = { true, 0.5f, 0.0f, 0, 0, 7, 0.0f };
            pathParams.aetherInteractionMode = mode;
            pathParams.aetherInteractionAmount = amount;
            beat::InstrumentVoice pathVoice;
            pathVoice.prepare(48000.0, 256);
            pathVoice.setParams(pathParams);
            pathVoice.startNote(69, 1.0f, nullptr, 8192);
            juce::AudioBuffer<float> pathOutput(2, 256);
            pathOutput.clear();
            pathVoice.renderNextBlock(pathOutput, 0, pathOutput.getNumSamples());
            return pathOutput;
        };
        const auto interactionOff = renderCompatibilityPath(0, 0.0f);
        const auto zeroAmount = renderCompatibilityPath(2, 0.0f);
        bool zeroPathExact = true;
        for (int channel = 0; channel < interactionOff.getNumChannels(); ++channel)
            for (int sample = 0; sample < interactionOff.getNumSamples(); ++sample)
                zeroPathExact &= interactionOff.getSample(channel, sample) == zeroAmount.getSample(channel, sample);

        return ratesFinite && std::isfinite(amAliasRatio) && std::isfinite(ringAliasRatio)
            && std::isfinite(offlineRingProductionAliasRatio)
            && amAliasRatio > 0.0 && amAliasRatio < 1.0
            && ringAliasRatio > 0.0 && ringAliasRatio < 1.0
            && amAliasRatio < 0.005
            && ringAliasRatio < 0.005
            && offlineRingProductionAliasRatio < 0.005
            && amAliasRatio < historicalAmAliasRatio * 0.1
            && ringAliasRatio < historicalRingAliasRatio * 0.1
            && oversampledAmAliasRatio < 0.005
            && oversampledRingAliasRatio < 0.005
            && offlineRingAliasRatio < 0.005
            && oversampledAmAliasRatio < historicalAmAliasRatio * 0.1
            && oversampledRingAliasRatio < historicalRingAliasRatio * 0.1
            && std::isfinite(callbackProbeOutput)
            && callbackViolations == 0
            && productionCallbackViolations == 0
            && productionWork.voiceSamples == 256
            && productionWork.nonlinearSamples == productionWork.voiceSamples * 2
            && productionWork.aetherOscASamples == productionWork.voiceSamples * 9
            && productionWork.aetherOscBSamples == productionWork.voiceSamples * 3
            && productionOutputFinite
            && !beat::RenderBudgets::exceedsVoiceNonlinearWorkCeiling(
                productionWork.nonlinearSamples, productionWork.voiceSamples)
            && zeroPathExact;
    }

    bool stressAetherTableStackRenderer()
    {
        beat::InstrumentVoice::Params params;
        params.hasAether = true;
        params.aetherOscA.enabled = true;
        params.aetherOscA.level = 0.74f;
        params.aetherOscA.pan = -0.4f;
        params.aetherOscA.waveform = 0;
        params.aetherOscA.fineCents = 3.0f;
        params.aetherOscA.tuningMode = 1;
        params.aetherOscA.harmonic = 3;
        params.aetherOscB.enabled = true;
        params.aetherOscB.level = 0.38f;
        params.aetherOscB.pan = 0.55f;
        params.aetherOscB.waveform = 1;
        params.aetherOscB.semitone = 7;
        params.aetherOscB.tuningMode = 2;
        params.aetherOscB.ratioNumerator = 3.0f;
        params.aetherOscB.ratioDenominator = 2.0f;
        params.aetherSub.enabled = true;
        params.aetherSub.level = 0.2f;
        params.aetherSub.octave = -1;
        params.aetherSub.waveform = 2;
        params.aetherNoise.enabled = true;
        params.aetherNoise.level = 0.08f;
        params.aetherNoise.color = 0.7f;
        params.dynamicModulation.active = true;
        params.dynamicModulation.oscAFine.lfo = 0.2f;
        params.dynamicModulation.oscALevel.velocity = 0.1f;
        params.dynamicModulation.oscAPan.lfo2 = 0.25f;
        params.dynamicModulation.oscBPan.env2 = -0.15f;
        params.dynamicModulation.unisonDetune.lfo = 0.1f;
        params.dynamicModulation.unisonSpread.env = 0.1f;

        std::array<beat::WavetableOscillator, 8> oscillatorsA;
        std::array<beat::WavetableOscillator, 8> oscillatorsB;
        for (auto& oscillator : oscillatorsA)
            oscillator.prepare(48000.0);
        for (auto& oscillator : oscillatorsB)
            oscillator.prepare(48000.0);

        beat::WavetableUnison::Plan unisonPlanA;
        beat::WavetableUnison::Plan unisonPlanB;
        juce::uint32 noiseState = 0x12345678u;
        const auto panGains = beat::VoiceAetherCache::panGainsFor(params);
        const auto pitchRates = beat::VoiceAetherCache::pitchRatesFor(params);
        if (!near((float) pitchRates.oscA, 3.0f * std::exp2(3.0f / 1200.0f), 0.0001f)
            || !near((float) pitchRates.oscB, 1.5f, 0.0001f))
            return false;
        auto stepParams = params;
        stepParams.aetherOscA.tuningMode = 3;
        stepParams.aetherOscA.tuningStep = 7;
        stepParams.aetherOscA.tuningDivisions = 19;
        stepParams.aetherOscB.tuningMode = 0;
        const auto stepRates = beat::VoiceAetherCache::pitchRatesFor(stepParams);
        if (!near((float) stepRates.oscA, std::exp2(7.0f / 19.0f) * std::exp2(3.0f / 1200.0f), 0.0001f)
            || !near((float) stepRates.oscB, std::exp2(7.0f / 12.0f), 0.0001f))
            return false;
        const auto targets = beat::DynamicModulation::targetActivityFlags(params.dynamicModulation);
        const auto result = beat::AetherTableStackRenderer::render(
            params,
            targets,
            panGains,
            pitchRates,
            oscillatorsA,
            oscillatorsB,
            unisonPlanA,
            unisonPlanB,
            220.0,
            220.0,
            48000.0,
            0.125,
            0.125,
            0.125,
            0.0,
            0.25,
            0.5f,
            -0.25f,
            std::array<float, 8> {},
            0.8f,
            0.35f,
            0.0f,
            0.0f,
            0.9f,
            60.0f / 127.0f,
            0.2f,
            noiseState);

        if (!std::isfinite(result.frame.left)
            || !std::isfinite(result.frame.right)
            || std::abs(result.frame.left) > 1.0f
            || std::abs(result.frame.right) > 1.0f)
            return false;
        if (std::abs(result.frame.left) <= 0.0001f && std::abs(result.frame.right) <= 0.0001f)
            return false;
        if (result.work.aetherOscASamples != 1
            || result.work.aetherOscBSamples != 1
            || result.work.aetherSubSamples != 1
            || result.work.aetherNoiseSamples != 1
            || result.work.oscillatorSamples != 4
            || result.work.oscillatorRateCalculations != 1)
            return false;
        if (noiseState == 0x12345678u)
            return false;

        params.aetherOscB.routing = 2;
        params.aetherSub.routing = 3;
        params.aetherNoise.routing = 1;
        const auto routed = beat::AetherTableStackRenderer::render(
            params, targets, panGains, pitchRates, oscillatorsA, oscillatorsB,
            unisonPlanA, unisonPlanB, 220.0, 220.0, 48000.0, 0.125, 0.125,
            0.125, 0.0, 0.25, 0.5f, -0.25f, std::array<float, 8> {}, 0.8f, 0.35f, 0.0f, 0.0f, 0.9f,
            60.0f / 127.0f, 0.2f, noiseState);
        if ((std::abs(routed.filteredFrame.left) <= 0.0001f && std::abs(routed.filteredFrame.right) <= 0.0001f)
            || (std::abs(routed.directFrame.left) <= 0.0001f && std::abs(routed.directFrame.right) <= 0.0001f)
            || (std::abs(routed.filter1Frame.left) <= 0.0001f && std::abs(routed.filter1Frame.right) <= 0.0001f)
            || (std::abs(routed.filter2Frame.left) <= 0.0001f && std::abs(routed.filter2Frame.right) <= 0.0001f)
            || !near(routed.frame.left, juce::jlimit(-1.0f, 1.0f, routed.filteredFrame.left + routed.filter1Frame.left + routed.filter2Frame.left + routed.directFrame.left), 0.00001f)
            || !near(routed.frame.right, juce::jlimit(-1.0f, 1.0f, routed.filteredFrame.right + routed.filter1Frame.right + routed.filter2Frame.right + routed.directFrame.right), 0.00001f))
            return false;

        params.aetherSub.enabled = false;
        params.aetherNoise.enabled = false;
        params.aetherOscA.routing = 0;
        params.aetherOscB.routing = 0;
        params.aetherInteractionMode = 0;
        params.aetherInteractionAmount = 0.0f;
        const auto renderInteraction = [&](int mode, float amount) {
            params.aetherInteractionMode = mode;
            params.aetherInteractionAmount = amount;
            return beat::AetherTableStackRenderer::render(
                params, targets, beat::VoiceAetherCache::panGainsFor(params), beat::VoiceAetherCache::pitchRatesFor(params),
                oscillatorsA, oscillatorsB, unisonPlanA, unisonPlanB, 220.0, 220.0, 48000.0, 0.125, 0.125,
                0.125, 0.0, 0.25, 0.5f, -0.25f, std::array<float, 8> {}, 0.8f, 0.35f, 0.0f, 0.0f, 0.9f,
                60.0f / 127.0f, 0.2f, noiseState);
        };
        const auto interactionOff = renderInteraction(0, 0.0f);
        const auto am = renderInteraction(1, 0.8f);
        const auto ring = renderInteraction(2, 0.8f);
        if (interactionOff.work.nonlinearSamples != 0 || am.work.nonlinearSamples != 1 || ring.work.nonlinearSamples != 1
            || !std::isfinite(am.frame.left) || !std::isfinite(am.frame.right)
            || !std::isfinite(ring.frame.left) || !std::isfinite(ring.frame.right)
            || (near(interactionOff.frame.left, am.frame.left) && near(interactionOff.frame.right, am.frame.right))
            || (near(am.frame.left, ring.frame.left) && near(am.frame.right, ring.frame.right)))
            return false;

        params.aetherOscA.enabled = false;
        params.aetherOscB.enabled = false;
        params.aetherSub.enabled = false;
        params.aetherNoise.enabled = false;
        const auto silent = beat::AetherTableStackRenderer::render(
            params,
            beat::DynamicModulation::targetActivityFlags(params.dynamicModulation),
            beat::VoiceAetherCache::panGainsFor(params),
            beat::VoiceAetherCache::pitchRatesFor(params),
            oscillatorsA,
            oscillatorsB,
            unisonPlanA,
            unisonPlanB,
            220.0,
            220.0,
            48000.0,
            0.25,
            0.25,
            0.25,
            0.0,
            0.0,
            0.0f,
            0.0f,
            std::array<float, 8> {},
            0.0f,
            0.0f,
            0.0f,
            0.0f,
            0.0f,
            0.0f,
            0.0f,
            noiseState);

        return near(silent.frame.left, 0.0f)
            && near(silent.frame.right, 0.0f)
            && silent.work.oscillatorSamples == 0
            && silent.work.aetherOscASamples == 0
            && silent.work.aetherOscBSamples == 0
            && silent.work.aetherSubSamples == 0
            && silent.work.aetherNoiseSamples == 0;
    }

    bool stressFilterMathHelper()
    {
        const float low = beat::FilterMath::cutoffHz(0.0f, 48000.0);
        const float mid = beat::FilterMath::cutoffHz(0.5f, 48000.0);
        const float high = beat::FilterMath::cutoffHz(1.0f, 48000.0);
        if (!(near(low, 20.0f) && mid > low && high > mid && high <= 20000.0f))
            return false;

        const float trackedLowNote = beat::FilterMath::keytrackedCutoffHz(0.5f, 48000.0, 1.0f, 130.8127825);
        const float trackedHighNote = beat::FilterMath::keytrackedCutoffHz(0.5f, 48000.0, 1.0f, 523.25113);
        const float untrackedHighNote = beat::FilterMath::keytrackedCutoffHz(0.5f, 48000.0, 0.0f, 523.25113);
        if (!(trackedLowNote < untrackedHighNote && trackedHighNote > untrackedHighNote))
            return false;

        if (!near(beat::FilterMath::resonanceFromNormalized(-1.0f), 0.5f))
            return false;
        if (!near(beat::FilterMath::resonanceFromNormalized(0.5f), 2.5f))
            return false;
        if (!near(beat::FilterMath::resonanceFromNormalized(2.0f), 4.5f))
            return false;

        return beat::FilterMath::typeForParam(0) == juce::dsp::StateVariableTPTFilterType::lowpass
            && beat::FilterMath::typeForParam(1) == juce::dsp::StateVariableTPTFilterType::bandpass
            && beat::FilterMath::typeForParam(2) == juce::dsp::StateVariableTPTFilterType::highpass
            && beat::FilterMath::typeForParam(99) == juce::dsp::StateVariableTPTFilterType::lowpass;
    }

    bool stressDriveStageHelper()
    {
        if (beat::DriveStage::oversampleFactor != 2
            || beat::DriveStage::workSamplesForChannels(0) != 0
            || beat::DriveStage::workSamplesForChannels(1) != 2
            || beat::DriveStage::workSamplesForChannels(2) != 4)
            return false;

        beat::DriveStage::State state;
        const beat::DriveStage::StereoFrame sample { 0.5f, -0.5f };

        const auto first = beat::DriveStage::processOversampled(state, sample, 3.0f);
        if (!(first.left > 0.5f && first.left < 0.6f && near(first.left, -first.right)))
            return false;
        if (!near(state.previousInput.left, sample.left) || !near(state.previousInput.right, sample.right))
            return false;

        const auto second = beat::DriveStage::processOversampled(state, sample, 3.0f);
        if (!(second.left > first.left && second.left < 1.0f && near(second.left, -second.right)))
            return false;

        state.reset({ 0.2f, -0.3f });
        if (!near(state.previousInput.left, 0.2f) || !near(state.downsample.right, -0.3f))
            return false;

        state.reset();
        const auto mono = beat::DriveStage::processMonoOversampled(state, 0.5f, 3.0f);
        if (!(mono > 0.5f && mono < 0.6f && near(state.previousInput.left, 0.5f)))
            return false;

        state.reset();
        const auto tiny = beat::DriveStage::processOversampled(state, { 1.0e-24f, -1.0e-24f }, 1.0f);
        return near(tiny.left, 0.0f) && near(tiny.right, 0.0f);
    }

    bool stressFilterStageHelper()
    {
        beat::FilterStage::State state;
        state.prepare(48000.0, 64, 0);
        state.configure(0, 0.5f, 0.25f, 48000.0, 0.0f, 440.0);

        const float initialCutoff = state.currentCutoffHz();
        if (!(initialCutoff > 20.0f && initialCutoff < 20000.0f))
            return false;
        if (!near(state.currentResonance(), 1.5f))
            return false;
        if (state.updateCutoffIfChanged(0.5f, 48000.0, 0.0f, 440.0, 0.5f) != 0)
            return false;
        if (state.updateResonanceIfChanged(0.25f, 0.001f) != 0)
            return false;

        if (state.updateCutoffIfChanged(0.75f, 48000.0, 0.0f, 440.0, 0.5f) != 2)
            return false;
        if (!(state.currentCutoffHz() > initialCutoff))
            return false;
        if (state.updateResonanceIfChanged(0.75f, 0.001f) != 2)
            return false;
        if (!near(state.currentResonance(), 3.5f))
            return false;

        state.configure(2, 0.4f, 0.1f, 48000.0, 1.0f, 880.0);
        auto frame = state.process(0.5f, -0.25f);
        for (int i = 0; i < 64; ++i)
            frame = state.process(i == 0 ? 1.0f : 0.0f, i == 0 ? -1.0f : 0.0f);
        return std::isfinite(frame.left) && std::isfinite(frame.right);
    }

    bool stressMasterDcBlocker()
    {
        beat::MasterDcBlocker lowRate;
        beat::MasterDcBlocker highRate;
        lowRate.prepare(44100.0, 2);
        highRate.prepare(192000.0, 2);
        if (!(lowRate.getCoefficient() > 0.0f && lowRate.getCoefficient() < highRate.getCoefficient() && highRate.getCoefficient() < 1.0f))
            return false;

        juce::AudioBuffer<float> constant(2, 48000);
        for (int channel = 0; channel < constant.getNumChannels(); ++channel)
            std::fill(constant.getWritePointer(channel), constant.getWritePointer(channel) + constant.getNumSamples(), channel == 0 ? 0.75f : -0.5f);
        beat::MasterDcBlocker blocker;
        blocker.prepare(48000.0, 2);
        blocker.process(constant);
        if (std::abs(constant.getSample(0, constant.getNumSamples() - 1)) > 1.0e-5f
            || std::abs(constant.getSample(1, constant.getNumSamples() - 1)) > 1.0e-5f)
            return false;

        juce::AudioBuffer<float> whole(2, 512);
        juce::AudioBuffer<float> splitA(2, 256);
        juce::AudioBuffer<float> splitB(2, 256);
        for (int channel = 0; channel < 2; ++channel)
        {
            for (int i = 0; i < 512; ++i)
            {
                const float value = 0.2f + 0.5f * std::sin((float) i * 0.071f);
                whole.setSample(channel, i, value);
                (i < 256 ? splitA : splitB).setSample(channel, i % 256, value);
            }
        }
        beat::MasterDcBlocker wholeBlocker;
        beat::MasterDcBlocker splitBlocker;
        wholeBlocker.prepare(48000.0, 2);
        splitBlocker.prepare(48000.0, 2);
        wholeBlocker.process(whole);
        splitBlocker.process(splitA);
        splitBlocker.process(splitB);
        for (int channel = 0; channel < 2; ++channel)
            for (int i = 0; i < 512; ++i)
                if (whole.getSample(channel, i) != (i < 256 ? splitA : splitB).getSample(channel, i % 256))
                    return false;
        return true;
    }

    bool stressVoiceAllocationHelper()
    {
        const auto minPoly = beat::VoiceAllocation::policyFor(0, false, true);
        if (minPoly.voiceCount != 1 || minPoly.mono || minPoly.legato || !minPoly.noteStealing)
            return false;

        const auto maxPoly = beat::VoiceAllocation::policyFor(99, false, true);
        if (maxPoly.voiceCount != 32 || maxPoly.mono || maxPoly.legato || !maxPoly.noteStealing)
            return false;

        const auto monoLegato = beat::VoiceAllocation::policyFor(12, true, true);
        if (monoLegato.voiceCount != 1 || !monoLegato.mono || !monoLegato.legato || !monoLegato.noteStealing)
            return false;

        const auto monoNoLegato = beat::VoiceAllocation::policyFor(12, true, false);
        if (!(monoNoLegato.voiceCount == 1
            && monoNoLegato.mono
            && !monoNoLegato.legato
            && monoNoLegato.noteStealing))
            return false;

        using State = beat::VoiceAllocation::VictimState;
        if (!beat::VoiceAllocation::preferVictim({ true, 0.9f, 9, 9 }, { false, 0.01f, 0, 0 }))
            return false;
        if (!beat::VoiceAllocation::preferVictim({ false, 0.1f, 9, 9 }, { false, 0.2f, 0, 0 }))
            return false;
        if (!beat::VoiceAllocation::preferVictim({ false, 0.1f, 2, 9 }, { false, 0.1f, 3, 0 }))
            return false;
        if (!beat::VoiceAllocation::preferVictim({ false, 0.1f, 2, 1 }, { false, 0.1f, 2, 2 }))
            return false;
        return !beat::VoiceAllocation::preferVictim(State { false, 0.2f, 3, 3 }, State { true, 0.9f, 9, 9 });
    }

    bool stressVoiceStealTransition()
    {
        beat::VoiceTransition transition;
        transition.prepare(48000.0);
        transition.beginFrom({ 0.5f, -0.25f });
        const auto first = transition.process({ -0.5f, 0.25f });
        if (!near(first.left, 0.5f) || !near(first.right, -0.25f) || transition.getLengthSamples() != 72)
            return false;
        beat::VoiceTransition::Stereo last = first;
        for (int i = 0; i <= transition.getLengthSamples(); ++i)
            last = transition.process({ -0.5f, 0.25f });
        if (transition.isActive() || !near(last.left, -0.5f) || !near(last.right, 0.25f))
            return false;

        struct TestSound final : juce::SynthesiserSound
        {
            bool appliesToNote(int) override { return true; }
            bool appliesToChannel(int) override { return true; }
        };

        beat::BeatSynthesiser synth;
        auto* voice = new beat::InstrumentVoice();
        voice->setStableVoiceId(7);
        voice->prepare(48000.0, 256);
        beat::InstrumentVoice::Params params;
        params.attackMs = 1.0f;
        params.drive01 = 0.0f;
        voice->setParams(params);
        synth.addVoice(voice);
        synth.addSound(new TestSound());
        synth.setNoteStealingEnabled(true);
        synth.setCurrentPlaybackSampleRate(48000.0);

        juce::AudioBuffer<float> before(2, 1024);
        before.clear();
        synth.noteOn(1, 60, 1.0f);
        synth.renderNextBlock(before, juce::MidiBuffer {}, 0, before.getNumSamples());
        const float previousLeft = before.getSample(0, before.getNumSamples() - 1);
        const float previousRight = before.getSample(1, before.getNumSamples() - 1);
        if (std::abs(previousLeft) < 1.0e-5f && std::abs(previousRight) < 1.0e-5f)
            return false;

        juce::AudioBuffer<float> after(2, 256);
        after.clear();
        synth.noteOn(1, 67, 1.0f);
        synth.renderNextBlock(after, juce::MidiBuffer {}, 0, after.getNumSamples());
        if (std::abs(after.getSample(0, 0) - previousLeft) > 1.0e-5f
            || std::abs(after.getSample(1, 0) - previousRight) > 1.0e-5f)
            return false;
        const auto state = voice->allocationState();
        if (!(state.active && state.stableVoiceId == 7 && voice->getCurrentlyPlayingNote() == 67))
            return false;

        beat::BeatSynthesiser ordered;
        for (int id = 0; id < 2; ++id)
        {
            auto* orderedVoice = new beat::InstrumentVoice();
            orderedVoice->setStableVoiceId(10 + id);
            orderedVoice->prepare(48000.0, 64);
            orderedVoice->setParams(params);
            ordered.addVoice(orderedVoice);
        }
        ordered.addSound(new TestSound());
        ordered.setNoteStealingEnabled(true);
        ordered.setCurrentPlaybackSampleRate(48000.0);
        ordered.noteOn(1, 60, 1.0f);
        ordered.noteOn(1, 62, 1.0f);
        ordered.noteOn(1, 64, 1.0f);
        if (ordered.getVoice(0)->getCurrentlyPlayingNote() != 64
            || ordered.getVoice(1)->getCurrentlyPlayingNote() != 62)
            return false;
        ordered.noteOff(1, 62, 0.0f, true);
        ordered.noteOn(1, 65, 1.0f);
        return ordered.getVoice(0)->getCurrentlyPlayingNote() == 64
            && ordered.getVoice(1)->getCurrentlyPlayingNote() == 65;
    }

    bool stressMemberChannelExpressionOwnership()
    {
        struct TestSound final : juce::SynthesiserSound
        {
            bool appliesToNote(int) override { return true; }
            bool appliesToChannel(int) override { return true; }
        };

        const auto addVoice = [](beat::BeatSynthesiser& synth, int stableId)
        {
            auto* voice = new beat::InstrumentVoice();
            voice->setStableVoiceId(stableId);
            voice->prepare(48000.0, 64);
            beat::InstrumentVoice::Params params;
            params.attackMs = 1.0f;
            params.drive01 = 0.0f;
            voice->setParams(params);
            synth.addVoice(voice);
        };
        const auto voiceOnChannel = [](beat::BeatSynthesiser& synth, int channel)
        {
            for (int index = 0; index < synth.getNumVoices(); ++index)
            {
                auto* voice = dynamic_cast<beat::InstrumentVoice*>(synth.getVoice(index));
                if (voice != nullptr && voice->isVoiceActive() && voice->isPlayingChannel(channel))
                    return voice;
            }
            return static_cast<beat::InstrumentVoice*>(nullptr);
        };

        beat::BeatSynthesiser synth;
        addVoice(synth, 1);
        addVoice(synth, 2);
        synth.addSound(new TestSound());
        synth.setNoteStealingEnabled(true);
        synth.setCurrentPlaybackSampleRate(48000.0);

        synth.handleChannelPressure(2, 32);
        synth.handleController(2, 74, 48);
        synth.handleController(2, 101, 0);
        synth.handleController(2, 100, 0);
        synth.handleController(2, 6, 48);
        synth.handleController(2, 38, 25);
        synth.handleChannelPressure(3, 96);
        synth.handleController(3, 74, 112);
        synth.noteOn(2, 60, 1.0f);
        synth.noteOn(3, 64, 1.0f);

        auto* channel2 = voiceOnChannel(synth, 2);
        auto* channel3 = voiceOnChannel(synth, 3);
        if (channel2 == nullptr || channel3 == nullptr
            || !near(channel2->pressureForTest(), 32.0f / 127.0f)
            || !near(channel2->timbreForTest(), 48.0f / 127.0f)
            || !near(channel2->memberPitchBendRangeForTest(), 48.25f)
            || !near(channel3->memberPitchBendRangeForTest(), -1.0f)
            || !near(channel3->pressureForTest(), 96.0f / 127.0f)
            || !near(channel3->timbreForTest(), 112.0f / 127.0f))
            return false;

        synth.handlePitchWheel(2, 12288);
        synth.handlePitchWheel(3, 16383);
        if (!near(channel2->pitchWheelSemitonesForTest(), (4096.0f / 8191.0f) * 48.25f)
            || !near(channel3->pitchWheelSemitonesForTest(), 2.0f))
            return false;

        synth.handleController(2, 6, 12);
        if (!near(channel2->memberPitchBendRangeForTest(), 12.25f)
            || !near(channel2->pitchWheelSemitonesForTest(), (4096.0f / 8191.0f) * 12.25f))
            return false;
        synth.handleController(2, 101, 127);
        synth.handleController(2, 100, 127);
        synth.handleController(2, 6, 7);
        if (!near(channel2->memberPitchBendRangeForTest(), 12.25f))
            return false;

        synth.handleChannelPressure(2, 20);
        synth.handleController(2, 74, 30);
        if (!near(channel2->pressureForTest(), 20.0f / 127.0f)
            || !near(channel2->timbreForTest(), 30.0f / 127.0f)
            || !near(channel3->pressureForTest(), 96.0f / 127.0f)
            || !near(channel3->timbreForTest(), 112.0f / 127.0f))
            return false;

        synth.handleAftertouch(3, 64, 77);
        if (!near(channel3->pressureForTest(), 77.0f / 127.0f)
            || !near(channel2->pressureForTest(), 20.0f / 127.0f))
            return false;

        beat::BeatSynthesiser stealing;
        addVoice(stealing, 7);
        stealing.addSound(new TestSound());
        stealing.setNoteStealingEnabled(true);
        stealing.setCurrentPlaybackSampleRate(48000.0);
        stealing.handleChannelPressure(2, 12);
        stealing.handleController(2, 74, 24);
        stealing.handleController(2, 101, 0);
        stealing.handleController(2, 100, 0);
        stealing.handleController(2, 6, 48);
        stealing.handleChannelPressure(3, 100);
        stealing.handleController(3, 74, 110);
        stealing.noteOn(2, 60, 1.0f);
        stealing.noteOn(3, 67, 1.0f);
        auto* stolen = voiceOnChannel(stealing, 3);
        if (stolen == nullptr
            || stolen->getCurrentlyPlayingNote() != 67
            || !near(stolen->pressureForTest(), 100.0f / 127.0f)
            || !near(stolen->timbreForTest(), 110.0f / 127.0f)
            || !near(stolen->memberPitchBendRangeForTest(), -1.0f))
            return false;
        stealing.handlePitchWheel(3, 16383);
        if (!near(stolen->pitchWheelSemitonesForTest(), 2.0f))
            return false;

        stealing.noteOn(4, 69, 1.0f);
        auto* reset = voiceOnChannel(stealing, 4);
        if (reset == nullptr
            || !near(reset->pressureForTest(), 0.0f)
            || !near(reset->timbreForTest(), 0.0f))
            return false;

        beat::BeatSynthesiser zoned;
        addVoice(zoned, 20);
        addVoice(zoned, 21);
        addVoice(zoned, 22);
        zoned.addSound(new TestSound());
        zoned.setNoteStealingEnabled(true);
        zoned.setCurrentPlaybackSampleRate(48000.0);
        if (!zoned.configureMemberExpressionZone({ true, 1, 2, 3 }))
            return false;
        zoned.noteOn(2, 60, 1.0f);
        zoned.noteOn(3, 64, 1.0f);
        zoned.noteOn(4, 67, 1.0f);
        zoned.handleController(1, 1, 64);
        zoned.handleController(1, 74, 96);
        zoned.handleChannelPressure(1, 80);
        zoned.handlePitchWheel(1, 12288);
        auto* member2 = voiceOnChannel(zoned, 2);
        auto* member3 = voiceOnChannel(zoned, 3);
        auto* outside = voiceOnChannel(zoned, 4);
        const float globalBend = (4096.0f / 8191.0f) * 2.0f;
        if (member2 == nullptr || member3 == nullptr || outside == nullptr
            || !near(member2->modWheelForTest(), 64.0f / 127.0f)
            || !near(member3->modWheelForTest(), 64.0f / 127.0f)
            || !near(member2->timbreForTest(), 96.0f / 127.0f)
            || !near(member3->timbreForTest(), 96.0f / 127.0f)
            || !near(member2->pressureForTest(), 80.0f / 127.0f)
            || !near(member3->pressureForTest(), 80.0f / 127.0f)
            || !near(member2->pitchWheelSemitonesForTest(), globalBend)
            || !near(member3->pitchWheelSemitonesForTest(), globalBend)
            || !near(outside->modWheelForTest(), 0.0f)
            || !near(outside->timbreForTest(), 0.0f)
            || !near(outside->pressureForTest(), 0.0f)
            || !near(outside->pitchWheelSemitonesForTest(), 0.0f))
        {
            std::cerr << "member expression persisted-zone propagation mismatch\n";
            return false;
        }
        zoned.handleController(2, 74, 20);
        if (!near(member2->timbreForTest(), 20.0f / 127.0f)
            || !near(member3->timbreForTest(), 96.0f / 127.0f))
            return false;

        beat::BeatSynthesiser invalidZone;
        if (invalidZone.configureMemberExpressionZone({ true, 2, 2, 4 })
            || invalidZone.memberExpressionZone().enabled)
            return false;

        const auto sendLegacyMpeConfiguration = [](beat::BeatSynthesiser& target,
                                                    int managerChannel,
                                                    int memberCount)
        {
            target.handleController(managerChannel, 100, 6);
            target.handleController(managerChannel, 101, 0);
            target.handleController(managerChannel, 6, memberCount);
        };

        beat::BeatSynthesiser negotiated;
        addVoice(negotiated, 30);
        addVoice(negotiated, 31);
        addVoice(negotiated, 32);
        addVoice(negotiated, 33);
        negotiated.addSound(new TestSound());
        negotiated.setNoteStealingEnabled(true);
        negotiated.setCurrentPlaybackSampleRate(48000.0);
        if (!negotiated.configureMemberExpressionZone({ true, 16, 13, 15 }))
            return false;
        beat::test::beginRealtimeSafetyProbe();
        sendLegacyMpeConfiguration(negotiated, 1, 3);
        const size_t negotiationViolations = beat::test::endRealtimeSafetyProbe();
        if (negotiationViolations != 0)
        {
            std::cerr << "member expression MCM realtime-safety violations: "
                      << negotiationViolations << "\n";
            return false;
        }
        const auto lowerZone = negotiated.memberExpressionZone();
        if (!lowerZone.enabled
            || lowerZone.masterChannel != 1
            || lowerZone.firstMemberChannel != 2
            || lowerZone.lastMemberChannel != 4)
            return false;

        negotiated.noteOn(2, 60, 1.0f);
        negotiated.noteOn(4, 64, 1.0f);
        negotiated.noteOn(5, 67, 1.0f);
        negotiated.handleController(1, 74, 90);
        negotiated.handlePitchWheel(1, 12288);
        negotiated.noteOn(3, 69, 1.0f);
        auto* lowerFirst = voiceOnChannel(negotiated, 2);
        auto* lowerLast = voiceOnChannel(negotiated, 4);
        auto* lowerOutside = voiceOnChannel(negotiated, 5);
        auto* lowerStartedAfterMaster = voiceOnChannel(negotiated, 3);
        if (lowerFirst == nullptr || lowerLast == nullptr || lowerOutside == nullptr || lowerStartedAfterMaster == nullptr
            || !near(lowerFirst->timbreForTest(), 90.0f / 127.0f)
            || !near(lowerLast->timbreForTest(), 90.0f / 127.0f)
            || !near(lowerOutside->timbreForTest(), 0.0f)
            || !near(lowerFirst->memberPitchBendRangeForTest(), 48.0f)
            || !near(lowerLast->memberPitchBendRangeForTest(), 48.0f)
            || !near(lowerFirst->masterPitchWheelSemitonesForTest(), (4096.0f / 8191.0f) * 2.0f)
            || !near(lowerLast->pitchWheelSemitonesForTest(), (4096.0f / 8191.0f) * 2.0f)
            || !near(lowerStartedAfterMaster->pitchWheelSemitonesForTest(), (4096.0f / 8191.0f) * 2.0f)
            || !near(lowerOutside->pitchWheelSemitonesForTest(), 0.0f))
        {
            std::cerr << "member expression MCM defaults mismatch ranges="
                      << lowerFirst->memberPitchBendRangeForTest() << ","
                      << lowerLast->memberPitchBendRangeForTest() << " master="
                      << lowerFirst->masterPitchWheelSemitonesForTest() << ","
                      << lowerStartedAfterMaster->masterPitchWheelSemitonesForTest() << "\n";
            return false;
        }
        negotiated.handlePitchWheel(2, 12288);
        if (!near(lowerFirst->memberPitchWheelSemitonesForTest(), (4096.0f / 8191.0f) * 48.0f)
            || !near(lowerFirst->pitchWheelSemitonesForTest(), (4096.0f / 8191.0f) * 50.0f)
            || !near(lowerLast->pitchWheelSemitonesForTest(), (4096.0f / 8191.0f) * 2.0f))
        {
            std::cerr << "member expression additive bend mismatch member="
                      << lowerFirst->memberPitchWheelSemitonesForTest() << " total="
                      << lowerFirst->pitchWheelSemitonesForTest() << " sibling="
                      << lowerLast->pitchWheelSemitonesForTest() << "\n";
            return false;
        }
        negotiated.handleController(1, 101, 0);
        negotiated.handleController(1, 100, 0);
        negotiated.handleController(1, 6, 12);
        negotiated.handleController(1, 38, 25);
        if (!near(lowerFirst->masterPitchWheelSemitonesForTest(), (4096.0f / 8191.0f) * 12.25f)
            || !near(lowerFirst->pitchWheelSemitonesForTest(), (4096.0f / 8191.0f) * 60.25f)
            || !near(lowerStartedAfterMaster->pitchWheelSemitonesForTest(), (4096.0f / 8191.0f) * 12.25f))
        {
            std::cerr << "member expression manager-range update mismatch master="
                      << lowerFirst->masterPitchWheelSemitonesForTest() << " total="
                      << lowerFirst->pitchWheelSemitonesForTest() << " pre-note="
                      << lowerStartedAfterMaster->pitchWheelSemitonesForTest() << "\n";
            return false;
        }

        sendLegacyMpeConfiguration(negotiated, 16, 0);
        if (!negotiated.memberExpressionZone().enabled
            || negotiated.memberExpressionZone().masterChannel != 1)
            return false;
        sendLegacyMpeConfiguration(negotiated, 1, 0);
        if (negotiated.memberExpressionZone().enabled
            || !near(lowerFirst->masterPitchWheelSemitonesForTest(), 0.0f)
            || !near(lowerFirst->memberPitchWheelSemitonesForTest(), (4096.0f / 8191.0f) * 48.0f))
            return false;

        sendLegacyMpeConfiguration(negotiated, 16, 3);
        const auto upperZone = negotiated.memberExpressionZone();
        if (!upperZone.enabled
            || upperZone.masterChannel != 16
            || upperZone.firstMemberChannel != 13
            || upperZone.lastMemberChannel != 15)
            return false;

        sendLegacyMpeConfiguration(negotiated, 8, 4);
        if (negotiated.memberExpressionZone().masterChannel != 16)
            return false;
        negotiated.handleController(16, 101, 127);
        negotiated.handleController(16, 100, 127);
        negotiated.handleController(16, 6, 0);
        if (!negotiated.memberExpressionZone().enabled)
            return false;
        sendLegacyMpeConfiguration(negotiated, 16, 16);
        return negotiated.memberExpressionZone().enabled
            && negotiated.memberExpressionZone().masterChannel == 16
            && negotiated.memberExpressionZone().firstMemberChannel == 13
            && negotiated.memberExpressionZone().lastMemberChannel == 15;
    }

    beat::Project makeStressProject()
    {
        beat::Project project;
        project.id = "stress-project";
        project.name = "Backend Stress";
        project.bpm = 132.0;
        project.lengthBeats = 64.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "stress-synth";
        instrument.kind = "synth";
        instrument.waveform = 1;
        instrument.lfoDepth = 0.0f;
        project.instruments.push_back(instrument);

        beat::ProjectAutomationLane projectLane;
        projectLane.instrumentId = instrument.id;
        projectLane.target = "filter.cutoff";
        projectLane.points.push_back({ 0.0, 0.2f });
        projectLane.points.push_back({ 4.0, 0.8f });
        project.automation.push_back(std::move(projectLane));

        beat::Track track;
        track.id = "stress-track";
        track.name = "Stress Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = instrument.id;

        beat::Segment segment;
        segment.id = "stress-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = instrument.id;
        segment.startBeat = 0.0;
        segment.lengthBeats = 4.0;
        segment.repeats = 32;

        for (int i = 0; i < 8; ++i)
        {
            beat::MidiNote note;
            note.instrumentId = instrument.id;
            note.pitch = 48 + (i % 12);
            note.velocity = 80 + (i % 32);
            note.startBeat = i * 0.25;
            note.lengthBeats = 0.125;
            if (i == 0)
            {
                beat::MidiAutomationLane lane;
                lane.target = "filter.cutoff";
                lane.points.push_back({ note.startBeat, 0.25f });
                lane.points.push_back({ note.startBeat + note.lengthBeats, 0.75f });
                note.automation.push_back(std::move(lane));
            }
            segment.notes.push_back(note);
        }

        beat::MidiAutomationLane segmentLane;
        segmentLane.target = "amp.level";
        segmentLane.points.push_back({ 0.0, 0.4f });
        segmentLane.points.push_back({ 2.0, 0.9f });
        segment.automation.push_back(std::move(segmentLane));

        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeDenseAetherProject()
    {
        beat::Project project;
        project.id = "dense-aether-project";
        project.name = "Dense Aether Route";
        project.bpm = 148.0;
        project.lengthBeats = 8.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "dense-aether";
        instrument.kind = "synth";
        instrument.waveform = 5;
        instrument.hasAether = true;
        instrument.cutoff01 = 0.68f;
        instrument.resonance01 = 0.18f;
        instrument.drive01 = 0.22f;
        instrument.filterType = 1;
        instrument.attackMs = 2.0f;
        instrument.decayMs = 80.0f;
        instrument.sustain = 0.72f;
        instrument.releaseMs = 140.0f;
        instrument.ampLevel = 0.62f;
        instrument.lfoRateHz = 5.0f;
        instrument.lfoDepth = 0.35f;
        instrument.lfoToFilter = 0.22f;
        instrument.lfoToPitch = 0.08f;
        instrument.envToFilter = 0.12f;
        instrument.dynamicModulation.active = true;
        instrument.dynamicModulation.oscAPosition.lfo = 0.28f;
        instrument.dynamicModulation.oscBPosition.lfo = 0.38f;
        instrument.dynamicModulation.oscBPosition.lfoBipolar = false;
        instrument.dynamicModulation.filterCutoff.env = 0.18f;
        instrument.dynamicModulation.filterResonance.lfo = 0.16f;
        instrument.dynamicModulation.filterResonance.lfoBipolar = false;
        instrument.dynamicModulation.unisonDetune.lfo = 0.08f;
        instrument.dynamicModulation.unisonDetune.lfoBipolar = false;
        instrument.dynamicModulation.unisonSpread.lfo = 0.2f;
        instrument.dynamicModulation.unisonSpread.lfoBipolar = false;
        instrument.dynamicModulation.ampPan.macro1 = -0.4f;
        instrument.dynamicModulation.oscBLevel.macro2 = -0.28f;
        instrument.dynamicModulation.filterDrive.macro3 = 0.22f;
        instrument.macroValues = { 0.15f, 0.25f, 0.0f, 0.0f };

        instrument.aether.oscA.enabled = true;
        instrument.aether.oscA.level = 0.72f;
        instrument.aether.oscA.pan = -0.25f;
        instrument.aether.oscA.waveform = 5;
        instrument.aether.oscA.wavetable.bank = 0;
        instrument.aether.oscA.wavetable.position = 0.56f;
        instrument.aether.oscA.wavetable.unison = 8;
        instrument.aether.oscA.wavetable.detuneCents = 13.0f;
        instrument.aether.oscA.wavetable.blend = 0.68f;

        instrument.aether.oscB.enabled = true;
        instrument.aether.oscB.level = 0.46f;
        instrument.aether.oscB.pan = 0.3f;
        instrument.aether.oscB.waveform = 5;
        instrument.aether.oscB.semitone = 7;
        instrument.aether.oscB.fineCents = -5.0f;
        instrument.aether.oscB.wavetable.bank = 4;
        instrument.aether.oscB.wavetable.position = 0.42f;
        instrument.aether.oscB.wavetable.unison = 4;
        instrument.aether.oscB.wavetable.detuneCents = 8.0f;
        instrument.aether.oscB.wavetable.blend = 0.58f;

        instrument.aether.sub.enabled = true;
        instrument.aether.sub.level = 0.12f;
        instrument.aether.sub.octave = -1;
        instrument.aether.noise.enabled = true;
        instrument.aether.noise.level = 0.035f;
        instrument.aether.noise.color = 0.72f;

        beat::TrackEffect instrumentFilter;
        instrumentFilter.id = "dense-aether-instrument-filter";
        instrumentFilter.kind = beat::TrackEffectKind::Lowpass;
        instrumentFilter.params.push_back({ "cutoffHz", 6200.0f });
        instrumentFilter.params.push_back({ "resonance", 5.0f });
        instrument.effects.push_back(std::move(instrumentFilter));

        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "dense-aether-track";
        track.name = "Dense Aether";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "dense-aether";
        track.gainDb = -5.0f;
        track.pan = -0.08f;

        beat::TrackEffect filter;
        filter.id = "dense-aether-filter";
        filter.kind = beat::TrackEffectKind::Lowpass;
        filter.params.push_back({ "cutoffHz", 7200.0f });
        filter.params.push_back({ "resonance", 8.0f });
        track.effects.push_back(std::move(filter));

        beat::TrackEffect saturation;
        saturation.id = "dense-aether-saturator";
        saturation.kind = beat::TrackEffectKind::Saturator;
        saturation.params.push_back({ "drive", 16.0f });
        saturation.params.push_back({ "mix", 18.0f });
        track.effects.push_back(std::move(saturation));

        beat::Segment segment;
        segment.id = "dense-aether-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "dense-aether";
        segment.startBeat = 0.0;
        segment.lengthBeats = 8.0;

        constexpr std::array<int, 8> chord { 40, 47, 52, 55, 59, 64, 67, 71 };
        for (int step = 0; step < 32; ++step)
        {
            for (int voice = 0; voice < 4; ++voice)
            {
                beat::MidiNote note;
                note.instrumentId = "dense-aether";
                note.pitch = chord[(size_t) ((step + voice * 2) % (int) chord.size())];
                note.velocity = 72 + ((step + voice * 9) % 44);
                note.startBeat = (double) step * 0.125;
                note.lengthBeats = 0.36 + (double) (voice % 2) * 0.08;

                if ((step + voice) % 5 == 0)
                {
                    beat::MidiAutomationLane lane;
                    lane.target = "osc.a.position";
                    lane.points.push_back({ note.startBeat, 0.25f });
                    lane.points.push_back({ note.startBeat + note.lengthBeats, 0.8f });
                    note.automation.push_back(std::move(lane));
                }
                if ((step + voice) % 7 == 0)
                {
                    beat::MidiAutomationLane lane;
                    lane.target = "macro.3";
                    lane.points.push_back({ note.startBeat, 0.0f });
                    lane.points.push_back({ note.startBeat + note.lengthBeats, 0.9f, beat::AutomationCurve::Smoothstep });
                    note.automation.push_back(std::move(lane));
                }
                if ((step + voice) % 11 == 0)
                {
                    beat::MidiAutomationLane lane;
                    lane.target = "osc.a.phase";
                    lane.points.push_back({ note.startBeat, 0.08f });
                    lane.points.push_back({ note.startBeat + note.lengthBeats, 0.42f, beat::AutomationCurve::Linear });
                    note.automation.push_back(std::move(lane));
                }

                segment.notes.push_back(std::move(note));
            }
        }

        beat::MidiAutomationLane ampLane;
        ampLane.target = "amp.level";
        ampLane.points.push_back({ 0.0, 0.45f });
        ampLane.points.push_back({ 4.0, 0.85f });
        ampLane.points.push_back({ 8.0, 0.55f });
        segment.automation.push_back(std::move(ampLane));

        beat::MidiAutomationLane macroLane;
        macroLane.target = "macro.2";
        macroLane.points.push_back({ 0.0, 0.1f });
        macroLane.points.push_back({ 3.0, 0.85f, beat::AutomationCurve::Cubic });
        macroLane.points.push_back({ 8.0, 0.35f });
        segment.automation.push_back(std::move(macroLane));

        beat::MidiAutomationLane oscBPanLane;
        oscBPanLane.target = "osc.b.pan";
        oscBPanLane.points.push_back({ 0.0, -0.45f });
        oscBPanLane.points.push_back({ 2.5, 0.5f, beat::AutomationCurve::Quadratic });
        oscBPanLane.points.push_back({ 8.0, 0.1f });
        segment.automation.push_back(std::move(oscBPanLane));

        track.segments.push_back(std::move(segment));

        beat::ProjectAutomationLane macroProjectLane;
        macroProjectLane.instrumentId = "dense-aether";
        macroProjectLane.target = "macro.1";
        macroProjectLane.points.push_back({ 0.0, 0.0f });
        macroProjectLane.points.push_back({ 1.5, 0.9f, beat::AutomationCurve::EaseOut });
        macroProjectLane.points.push_back({ 7.0, 0.25f });
        project.automation.push_back(std::move(macroProjectLane));

        beat::ProjectAutomationLane filterProjectLane;
        filterProjectLane.instrumentId = "dense-aether";
        filterProjectLane.target = "filter.cutoff";
        filterProjectLane.points.push_back({ 0.0, 0.45f });
        filterProjectLane.points.push_back({ 3.5, 0.9f, beat::AutomationCurve::Smoothstep });
        filterProjectLane.points.push_back({ 8.0, 0.52f });
        project.automation.push_back(std::move(filterProjectLane));

        beat::ProjectAutomationLane instrumentEffectLane;
        instrumentEffectLane.trackId = track.id;
        instrumentEffectLane.target = "effect.dense-aether-instrument-filter.cutoffHz";
        instrumentEffectLane.points.push_back({ 0.0, 1800.0f });
        instrumentEffectLane.points.push_back({ 2.25, 12000.0f, beat::AutomationCurve::Quadratic });
        instrumentEffectLane.points.push_back({ 8.0, 3000.0f });
        project.automation.push_back(std::move(instrumentEffectLane));

        beat::ProjectAutomationLane cutoffLane;
        cutoffLane.trackId = track.id;
        cutoffLane.target = "effect.dense-aether-filter.cutoffHz";
        cutoffLane.points.push_back({ 0.0, 2400.0f });
        cutoffLane.points.push_back({ 2.0, 9800.0f });
        cutoffLane.points.push_back({ 6.0, 3600.0f });
        project.automation.push_back(std::move(cutoffLane));

        beat::ProjectAutomationLane trackScopedAmpLane;
        trackScopedAmpLane.trackId = track.id;
        trackScopedAmpLane.instrumentId = "dense-aether";
        trackScopedAmpLane.target = "amp.pan";
        trackScopedAmpLane.points.push_back({ 0.0, -0.25f });
        trackScopedAmpLane.points.push_back({ 3.0, 0.7f, beat::AutomationCurve::Smoothstep });
        trackScopedAmpLane.points.push_back({ 8.0, 0.05f });
        project.automation.push_back(std::move(trackScopedAmpLane));

        project.tracks.push_back(std::move(track));
        return project;
    }

    beat::Project makeMaxUnisonAetherProject()
    {
        auto project = makeDenseAetherProject();
        project.id = "max-unison-aether-project";
        project.name = "Max Unison Aether Polyphony";
        project.bpm = 132.0;
        project.lengthBeats = 2.0;

        auto& instrument = project.instruments.front();
        instrument.id = "max-unison-aether";
        instrument.ampLevel = 0.36f;
        instrument.drive01 = 0.12f;
        instrument.releaseMs = 90.0f;
        instrument.aether.oscA.level = 0.48f;
        instrument.aether.oscA.wavetable.unison = 8;
        instrument.aether.oscA.wavetable.detuneCents = 14.0f;
        instrument.aether.oscA.wavetable.blend = 0.76f;
        instrument.aether.oscB.level = 0.32f;
        instrument.aether.oscB.wavetable.unison = 8;
        instrument.aether.oscB.wavetable.detuneCents = 10.0f;
        instrument.aether.oscB.wavetable.blend = 0.62f;
        instrument.aether.sub.level = 0.06f;
        instrument.aether.noise.level = 0.015f;

        auto& track = project.tracks.front();
        track.instrumentId = instrument.id;
        track.gainDb = -11.0f;
        track.pan = 0.0f;

        auto& segment = track.segments.front();
        segment.id = "max-unison-aether-segment";
        segment.instrumentId = instrument.id;
        segment.lengthBeats = 2.0;
        segment.notes.clear();
        segment.automation.clear();

        constexpr std::array<int, 16> chord {
            36, 40, 43, 47, 48, 52, 55, 59,
            60, 64, 67, 71, 72, 76, 79, 83
        };
        for (size_t i = 0; i < chord.size(); ++i)
        {
            beat::MidiNote note;
            note.instrumentId = instrument.id;
            note.pitch = chord[i];
            note.velocity = 62 + (int) ((i * 5) % 48);
            note.startBeat = 0.0;
            note.lengthBeats = 1.5;
            segment.notes.push_back(std::move(note));
        }

        beat::MidiAutomationLane positionLane;
        positionLane.target = "osc.a.position";
        positionLane.points.push_back({ 0.0, 0.35f });
        positionLane.points.push_back({ 1.0, 0.72f });
        positionLane.points.push_back({ 2.0, 0.48f });
        segment.automation.push_back(std::move(positionLane));

        project.automation.clear();
        beat::ProjectAutomationLane cutoffLane;
        cutoffLane.trackId = track.id;
        cutoffLane.target = "effect.dense-aether-filter.cutoffHz";
        cutoffLane.points.push_back({ 0.0, 1800.0f });
        cutoffLane.points.push_back({ 1.0, 8400.0f });
        cutoffLane.points.push_back({ 2.0, 3200.0f });
        project.automation.push_back(std::move(cutoffLane));

        return project;
    }

    beat::Project makeMonoLegatoAetherProject()
    {
        auto project = makeMaxUnisonAetherProject();
        project.id = "mono-legato-aether-project";
        project.name = "Mono Legato Aether Expression";
        project.bpm = 126.0;
        project.lengthBeats = 2.75;

        auto& instrument = project.instruments.front();
        instrument.id = "mono-legato-aether";
        instrument.mono = true;
        instrument.legato = true;
        instrument.maxVoices = 6;
        instrument.glideMs = 185.0f;
        instrument.ampLevel = 0.5f;
        instrument.releaseMs = 120.0f;
        instrument.dynamicModulation.ampLevel.velocity = 0.18f;
        instrument.dynamicModulation.ampLevel.velocityBipolar = false;
        instrument.dynamicModulation.filterCutoff.keytrack = 0.14f;
        instrument.dynamicModulation.filterCutoff.keytrackBipolar = false;
        instrument.dynamicModulation.oscAPosition.macro1 = 0.2f;
        instrument.dynamicModulation.oscBPan.macro2 = 0.18f;
        instrument.macroValues = { 0.35f, 0.62f, 0.0f, 0.0f };
        instrument.aether.oscA.wavetable.unison = 3;
        instrument.aether.oscA.wavetable.detuneCents = 5.0f;
        instrument.aether.oscB.wavetable.unison = 2;
        instrument.aether.oscB.wavetable.detuneCents = 4.0f;
        instrument.aether.sub.level = 0.04f;
        instrument.aether.noise.enabled = false;
        instrument.aether.noise.level = 0.0f;
        instrument.aether.oscA.randomPhase = 0.0f;
        instrument.aether.oscB.randomPhase = 0.0f;

        auto& track = project.tracks.front();
        track.id = "mono-legato-aether-track";
        track.name = "Mono Legato Aether";
        track.instrumentId = instrument.id;
        track.gainDb = -8.0f;

        auto& segment = track.segments.front();
        segment.id = "mono-legato-aether-segment";
        segment.trackId = track.id;
        segment.instrumentId = instrument.id;
        segment.lengthBeats = project.lengthBeats;
        segment.notes.clear();
        segment.automation.clear();

        constexpr std::array<int, 8> pitches { 52, 59, 64, 67, 71, 69, 62, 55 };
        constexpr std::array<double, 8> starts { 0.0, 0.24, 0.52, 0.82, 1.12, 1.46, 1.78, 2.08 };
        for (size_t i = 0; i < pitches.size(); ++i)
        {
            beat::MidiNote note;
            note.instrumentId = instrument.id;
            note.pitch = pitches[i];
            note.velocity = 74 + (int) ((i * 7) % 38);
            note.startBeat = starts[i];
            note.lengthBeats = 0.46;
            note.connectToIndex = i + 1 < pitches.size() ? (int) i + 1 : -1;
            segment.notes.push_back(std::move(note));
        }

        beat::MidiAutomationLane positionLane;
        positionLane.target = "osc.a.position";
        positionLane.points.push_back({ 0.0, 0.22f });
        positionLane.points.push_back({ 1.35, 0.76f, beat::AutomationCurve::Smoothstep });
        positionLane.points.push_back({ project.lengthBeats, 0.44f });
        segment.automation.push_back(std::move(positionLane));

        beat::MidiAutomationLane ampLane;
        ampLane.target = "amp.level";
        ampLane.points.push_back({ 0.0, 0.42f });
        ampLane.points.push_back({ 1.25, 0.72f, beat::AutomationCurve::EaseIn });
        ampLane.points.push_back({ project.lengthBeats, 0.5f });
        segment.automation.push_back(std::move(ampLane));

        project.automation.clear();
        beat::ProjectAutomationLane macroLane;
        macroLane.trackId = track.id;
        macroLane.instrumentId = instrument.id;
        macroLane.target = "macro.1";
        macroLane.points.push_back({ 0.0, 0.25f });
        macroLane.points.push_back({ 1.0, 0.82f, beat::AutomationCurve::Quadratic });
        macroLane.points.push_back({ project.lengthBeats, 0.38f });
        project.automation.push_back(std::move(macroLane));

        return project;
    }

    bool stressAudioEngineNativeMidiExpressionActivity()
    {
        auto project = makeDenseAetherProject();
        project.tracks.front().recordArmed = true;
        project.tracks.front().inputMonitoring = true;
        project.tracks.front().segments.clear();

        beat::AudioEngine engine;
        std::vector<beat::AudioEngine::SynthExpressionActivity> updates;
        engine.onSynthExpressionActivity = [&](const beat::AudioEngine::SynthExpressionActivity& activity) {
            updates.push_back(activity);
        };
        engine.prepareForOffline(48000.0, 128, 2);
        engine.applyProject(project);

        if (!engine.injectMidiInputForTesting(juce::MidiMessage::noteOn(1, 64, (juce::uint8) 100)))
            return false;
        if (updates.empty())
            return false;
        const auto first = updates.back();
        if (first.instrumentId != "dense-aether"
            || !first.active
            || first.activeNotes != 1
            || !near(first.velocity, 100.0f / 127.0f, 0.0002f)
            || !near(first.keytrack, 64.0f / 127.0f, 0.0002f))
            return false;

        engine.injectMidiInputForTesting(juce::MidiMessage::noteOn(1, 76, (juce::uint8) 80));
        const auto second = updates.back();
        if (!second.active
            || second.activeNotes != 2
            || !near(second.velocity, ((100.0f / 127.0f) + (80.0f / 127.0f)) * 0.5f, 0.0002f))
            return false;

        engine.injectMidiInputForTesting(juce::MidiMessage::pitchWheel(1, 12288));
        if (!near(updates.back().pitchBendSemitones, 1.0f, 0.0002f))
            return false;

        engine.injectMidiInputForTesting(juce::MidiMessage::controllerEvent(1, 1, 96));
        if (!near(updates.back().modWheel, 96.0f / 127.0f, 0.0002f))
            return false;

        engine.injectMidiInputForTesting(juce::MidiMessage::channelPressureChange(1, 88));
        if (!near(updates.back().pressure, 88.0f / 127.0f, 0.0002f))
            return false;

        engine.injectMidiInputForTesting(juce::MidiMessage::aftertouchChange(1, 76, 72));
        if (!near(updates.back().pressure, 72.0f / 127.0f, 0.0002f))
            return false;

        engine.injectMidiInputForTesting(juce::MidiMessage::controllerEvent(1, 74, 84));
        if (!near(updates.back().timbre, 84.0f / 127.0f, 0.0002f))
            return false;

        engine.injectMidiInputForTesting(juce::MidiMessage::noteOff(1, 64));
        engine.injectMidiInputForTesting(juce::MidiMessage::noteOff(1, 76));
        if (!updates.back().active || updates.back().activeNotes != 0)
            return false;

        engine.injectMidiInputForTesting(juce::MidiMessage::pitchWheel(1, 8192));
        engine.injectMidiInputForTesting(juce::MidiMessage::controllerEvent(1, 1, 0));
        engine.injectMidiInputForTesting(juce::MidiMessage::channelPressureChange(1, 0));
        engine.injectMidiInputForTesting(juce::MidiMessage::controllerEvent(1, 74, 0));
        const auto cleared = updates.back();
        return cleared.instrumentId == "dense-aether"
            && !cleared.active
            && cleared.activeNotes == 0
            && near(cleared.pitchBendSemitones, 0.0f, 0.0002f)
            && near(cleared.modWheel, 0.0f, 0.0002f)
            && near(cleared.pressure, 0.0f, 0.0002f)
            && near(cleared.timbre, 0.0f, 0.0002f);
    }

    bool stressFftAnalyzer()
    {
        const std::array blockSizes { 127, 256, 480, 511, 960, 1000 };

        for (int blockSize : blockSizes)
        {
            beat::FftAnalyzer analyzer;
            analyzer.prepare(44100.0);

            juce::AudioBuffer<float> buffer(2, blockSize);
            double phase = 0.0;
            const double delta = 440.0 / 44100.0;
            for (int block = 0; block < 24; ++block)
            {
                for (int i = 0; i < buffer.getNumSamples(); ++i)
                {
                    const float sample = std::sin((float) (phase * juce::MathConstants<double>::twoPi)) * 0.5f;
                    buffer.setSample(0, i, sample);
                    buffer.setSample(1, i, sample);
                    phase += delta;
                    if (phase >= 1.0) phase -= 1.0;
                }
                analyzer.process(buffer);
            }

            beat::FftAnalyzer::Snapshot snapshot;
            if (!analyzer.pullSnapshot(snapshot))
                return false;

            float maxBand = 0.0f;
            for (float band : snapshot.spectrum)
                maxBand = std::max(maxBand, band);

            if (!(snapshot.sequence > 0 && snapshot.rms > 0.0f && snapshot.peak > 0.0f && maxBand > 0.0f))
                return false;
        }

        return true;
    }

    bool stressAudioFileAnalyzer()
    {
        constexpr double sampleRate = 48000.0;
        constexpr int samples = 48000;
        juce::AudioBuffer<float> buffer(2, samples);

        for (int i = 0; i < samples; ++i)
        {
            const auto phase = (float) i * 1000.0f / (float) sampleRate;
            const auto sample = std::sin(phase * juce::MathConstants<float>::twoPi);
            buffer.setSample(0, i, sample * 0.5f);
            buffer.setSample(1, i, sample * -0.25f);
        }

        const auto analysis = beat::AudioFileAnalyzer::analyzeBuffer(buffer, sampleRate);
        if (analysis.channelCount != 2 || analysis.lengthInSamples != samples)
            return false;
        if (std::abs(analysis.durationSeconds - 1.0) > 0.0001)
            return false;
        if (std::abs(analysis.leftPeakDbFS - -6.0206f) > 0.05f)
            return false;
        if (std::abs(analysis.rightPeakDbFS - -12.0412f) > 0.05f)
            return false;
        if (std::abs(analysis.rmsDbFS - -11.0721f) > 0.08f)
            return false;
        if (std::abs(analysis.crestFactorDb - 5.0515f) > 0.1f)
            return false;
        if (std::abs(analysis.dcOffset) > 0.00001f)
            return false;
        if (analysis.clippingCount != 0 || analysis.clippingRatio != 0.0f)
            return false;
        if (std::abs(analysis.stereoCorrelation - -1.0f) > 0.001f)
            return false;
        if (!std::isfinite(analysis.truePeakDbTP) || analysis.truePeakDbTP < analysis.leftPeakDbFS - 0.05f)
            return false;
        if (!std::isfinite(analysis.integratedLufs) || analysis.integratedLufs >= 0.0f)
            return false;

        auto tempFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-audio-analysis.wav");
        if (tempFile.existsAsFile())
            tempFile.deleteFile();
        juce::WavAudioFormat wavFormat;
        auto output = tempFile.createOutputStream();
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wavFormat.createWriterFor(output.get(), sampleRate, 2, 24, {}, 0));
        if (writer == nullptr)
        {
            std::cerr << "Audio file analyzer stress failed: wav writer unavailable\n";
            return false;
        }
        output.release();
        if (!writer->writeFromAudioSampleBuffer(buffer, 0, samples))
        {
            std::cerr << "Audio file analyzer stress failed: wav write failed\n";
            return false;
        }
        writer.reset();

        const auto fileAnalysis = beat::AudioFileAnalyzer::analyzeFile(tempFile);
        if (!fileAnalysis)
        {
            std::cerr << "Audio file analyzer stress failed: file analysis unavailable\n";
            tempFile.deleteFile();
            return false;
        }
        if (fileAnalysis->channelCount != 2 || fileAnalysis->lengthInSamples != samples || fileAnalysis->bitDepth != 24)
        {
            std::cerr << "Audio file analyzer stress failed: metadata channels="
                      << fileAnalysis->channelCount
                      << " samples=" << fileAnalysis->lengthInSamples
                      << " bitDepth=" << fileAnalysis->bitDepth << "\n";
            tempFile.deleteFile();
            return false;
        }
        if (std::abs(fileAnalysis->leftPeakDbFS - analysis.leftPeakDbFS) > 0.06f)
        {
            std::cerr << "Audio file analyzer stress failed: left peak buffer="
                      << analysis.leftPeakDbFS << " file=" << fileAnalysis->leftPeakDbFS << "\n";
            tempFile.deleteFile();
            return false;
        }
        if (std::abs(fileAnalysis->rightPeakDbFS - analysis.rightPeakDbFS) > 0.06f)
        {
            std::cerr << "Audio file analyzer stress failed: right peak buffer="
                      << analysis.rightPeakDbFS << " file=" << fileAnalysis->rightPeakDbFS << "\n";
            tempFile.deleteFile();
            return false;
        }
        if (std::abs(fileAnalysis->rmsDbFS - analysis.rmsDbFS) > 0.06f)
        {
            std::cerr << "Audio file analyzer stress failed: rms buffer="
                      << analysis.rmsDbFS << " file=" << fileAnalysis->rmsDbFS << "\n";
            tempFile.deleteFile();
            return false;
        }
        if (std::abs(fileAnalysis->stereoCorrelation - analysis.stereoCorrelation) > 0.001f)
        {
            std::cerr << "Audio file analyzer stress failed: correlation buffer="
                      << analysis.stereoCorrelation << " file=" << fileAnalysis->stereoCorrelation << "\n";
            tempFile.deleteFile();
            return false;
        }
        if (std::abs(fileAnalysis->integratedLufs - analysis.integratedLufs) > 0.2f)
        {
            std::cerr << "Audio file analyzer stress failed: lufs buffer="
                      << analysis.integratedLufs << " file=" << fileAnalysis->integratedLufs << "\n";
            tempFile.deleteFile();
            return false;
        }

        const auto waveform = beat::AudioFileAnalyzer::analyzeWaveformFile(tempFile, 32);
        tempFile.deleteFile();
        if (!waveform || waveform->bucketCount != 32 || waveform->left.upper.size() != 32 || waveform->right.lower.size() != 32)
        {
            std::cerr << "Audio waveform stress failed: waveform unavailable or wrong bucket count\n";
            return false;
        }
        float leftUpperPeak = 0.0f;
        float rightLowerPeak = 0.0f;
        for (size_t i = 0; i < waveform->left.upper.size(); ++i)
        {
            leftUpperPeak = std::max(leftUpperPeak, waveform->left.upper[i]);
            rightLowerPeak = std::max(rightLowerPeak, waveform->right.lower[i]);
            if (waveform->left.upper[i] < 0.0f || waveform->left.upper[i] > 1.0f
                || waveform->left.lower[i] < 0.0f || waveform->left.lower[i] > 1.0f
                || waveform->right.upper[i] < 0.0f || waveform->right.upper[i] > 1.0f
                || waveform->right.lower[i] < 0.0f || waveform->right.lower[i] > 1.0f)
            {
                std::cerr << "Audio waveform stress failed: bucket out of normalized bounds\n";
                return false;
            }
        }
        if (leftUpperPeak < 0.45f || rightLowerPeak < 0.2f)
        {
            std::cerr << "Audio waveform stress failed: expected stereo peaks left="
                      << leftUpperPeak << " rightLower=" << rightLowerPeak << "\n";
            return false;
        }

        buffer.clear();
        buffer.setSample(0, 8, 1.0f);
        buffer.setSample(1, 16, -1.0f);
        const auto clipping = beat::AudioFileAnalyzer::analyzeBuffer(buffer, sampleRate);
        return clipping.clippingCount == 2
            && clipping.clippingRatio > 0.0f
            && clipping.truePeakDbTP >= -0.01f;
    }

    bool stressRealtimeQueue()
    {
        beat::SpscRingBuffer<int, 4> queue;
        if (!queue.empty() || queue.full() || queue.capacity() != 4)
            return false;

        for (int value = 1; value <= 4; ++value)
            if (!queue.push(value))
                return false;
        if (!queue.full() || queue.size() != 4 || queue.push(5))
            return false;

        int out = 0;
        for (int expected = 1; expected <= 2; ++expected)
            if (!queue.pop(out) || out != expected)
                return false;
        if (!queue.push(5) || !queue.push(6))
            return false;

        for (int expected : { 3, 4, 5, 6 })
            if (!queue.pop(out) || out != expected)
                return false;
        if (queue.pop(out) || !queue.empty())
            return false;

        beat::SpscRingBuffer<int, 256> threaded;
        constexpr int iterations = 100000;
        std::atomic<bool> failed { false };
        std::thread producer([&] {
            for (int value = 0; value < iterations && !failed.load();)
            {
                if (threaded.push(value))
                    ++value;
                else
                    std::this_thread::yield();
            }
        });
        std::thread consumer([&] {
            for (int expected = 0; expected < iterations && !failed.load();)
            {
                int value = -1;
                if (!threaded.pop(value))
                {
                    std::this_thread::yield();
                    continue;
                }
                if (value != expected)
                {
                    failed.store(true);
                    return;
                }
                ++expected;
            }
        });
        producer.join();
        consumer.join();
        return !failed.load() && threaded.empty();
    }

    struct PoolPayload
    {
        int id { -1 };
        float value { 0.0f };
    };

    bool stressFixedObjectPool()
    {
        beat::FixedObjectPool<PoolPayload, 8> pool;
        std::array<PoolPayload*, 8> acquired {};

        for (size_t i = 0; i < acquired.size(); ++i)
        {
            acquired[i] = pool.tryAcquire();
            if (acquired[i] == nullptr || !pool.owns(acquired[i]))
                return false;
            acquired[i]->id = (int) i;
            acquired[i]->value = (float) i * 0.5f;
        }
        if (pool.tryAcquire() != nullptr || pool.used() != acquired.size())
            return false;

        pool.release(acquired[3]);
        auto* reused = pool.tryAcquire();
        if (reused == nullptr || reused->id != -1 || reused->value != 0.0f)
            return false;
        pool.release(reused);

        for (auto* payload : acquired)
            pool.release(payload);
        if (pool.used() != 0)
            return false;

        beat::FixedObjectPool<PoolPayload, 32> threadedPool;
        std::atomic<int> operations { 0 };
        std::atomic<bool> failed { false };
        std::vector<std::thread> workers;
        for (int worker = 0; worker < 4; ++worker)
        {
            workers.emplace_back([&, worker] {
                for (int i = 0; i < 2000 && !failed.load(); ++i)
                {
                    PoolPayload* payload = nullptr;
                    while (payload == nullptr && !failed.load())
                    {
                        payload = threadedPool.tryAcquire();
                        if (payload == nullptr)
                            std::this_thread::yield();
                    }
                    if (payload == nullptr)
                        return;
                    payload->id = worker;
                    payload->value = (float) i;
                    operations.fetch_add(1);
                    threadedPool.release(payload);
                }
            });
        }

        for (auto& worker : workers)
            worker.join();

        return !failed.load() && operations.load() == 8000 && threadedPool.used() == 0;
    }

    bool stressRealtimeParameterQueue()
    {
        auto change = beat::makeRealtimeParameterChange("stress-synth",
                                                        "osc.a.position",
                                                        0.42f,
                                                        12,
                                                        128);
        if (change.instrumentIdView() != "stress-synth" || change.parameterIdView() != "osc.a.position")
            return false;
        if (!near(change.value, 0.42f) || change.sampleOffset != 12 || change.rampSamples != 128)
            return false;

        const std::string longInstrument(128, 'i');
        const std::string longParameter(128, 'p');
        const auto truncated = beat::makeRealtimeParameterChange(longInstrument, longParameter, 0.25f, -4, -8);
        if (truncated.instrumentIdView().size() != beat::RealtimeParameterChange::instrumentIdCapacity - 1)
            return false;
        if (truncated.parameterIdView().size() != beat::RealtimeParameterChange::parameterIdCapacity - 1)
            return false;
        if (truncated.sampleOffset != 0 || truncated.rampSamples != 0)
            return false;

        beat::RealtimeParameterQueue<3> queue;
        if (!queue.push(beat::makeRealtimeParameterChange("a", "filter.cutoff", 0.1f)))
            return false;
        if (!queue.push(beat::makeRealtimeParameterChange("a", "filter.resonance", 0.2f)))
            return false;
        if (!queue.push(beat::makeRealtimeParameterChange("b", "amp.level", 0.3f)))
            return false;
        if (!queue.full() || queue.push(beat::makeRealtimeParameterChange("c", "amp.pan", 0.4f)))
            return false;

        beat::RealtimeParameterChange out;
        if (!queue.pop(out) || out.instrumentIdView() != "a" || out.parameterIdView() != "filter.cutoff" || !near(out.value, 0.1f))
            return false;
        if (!queue.push(beat::makeRealtimeParameterChange("c", "amp.pan", 0.4f)))
            return false;

        const std::array expectedParameters {
            std::string_view { "filter.resonance" },
            std::string_view { "amp.level" },
            std::string_view { "amp.pan" },
        };
        for (const auto expected : expectedParameters)
        {
            if (!queue.pop(out) || out.parameterIdView() != expected)
                return false;
        }
        return queue.empty();
    }

    bool stressParameterPolicy()
    {
        using namespace beat::ParameterPolicy;
        if (realtimeVoiceParameters.size() != beat::VoiceRealtimeParams::count || !hasUniqueStableIds())
            return false;

        int modulationTargets = 0;
        for (size_t index = 0; index < realtimeVoiceParameters.size(); ++index)
        {
            const auto& metadata = realtimeVoiceParameters[index];
            if (metadata.stableId.empty() || !(metadata.minimum < metadata.maximum))
                return false;
            if (indexForStableId(metadata.stableId) != (int) index || metadataFor(metadata.stableId) != &metadata)
                return false;
            if (beat::VoiceRealtimeParams::indexForParameterId(metadata.stableId) != (int) index)
                return false;
            if (beat::VoiceRealtimeParams::clampValue((beat::VoiceRealtimeParams::Id) index, metadata.minimum - 1000.0f) != metadata.minimum)
                return false;
            if (beat::VoiceRealtimeParams::clampValue((beat::VoiceRealtimeParams::Id) index, metadata.maximum + 1000.0f) != metadata.maximum)
                return false;
            if (metadata.smoothing == Smoothing::callerRamp && rampLengthFor(index, 127) != 127)
                return false;
            if (metadata.modulationEligible)
                ++modulationTargets;
        }

        if (modulationTargets != 15)
            return false;
        if (metadataFor(beat::params::oscillator::a::position)->rateClass != RateClass::sampleAccurateControl)
            return false;
        if (metadataFor(beat::params::oscillator::a::phase)->rateClass != RateClass::smoothedControl)
            return false;
        if (metadataFor("unknown.parameter") != nullptr || indexForStableId("unknown.parameter") != -1)
            return false;
        return true;
    }

    bool stressSequencerTransport()
    {
        beat::Sequencer sequencer;
        sequencer.setSampleRate(44100.0);
        sequencer.setTempo(132.0);
        sequencer.setProject(makeStressProject());

        int triggerCount = 0;
        for (int block = 0; block < 10000; ++block)
        {
            switch (block % 17)
            {
                case 0: sequencer.seek(0.0); sequencer.play(); break;
                case 1: sequencer.pause(); break;
                case 2: sequencer.play(); break;
                case 3: sequencer.seek((block % 64) * 0.25); break;
                case 4: sequencer.setSpeed(0.5 + (block % 8) * 0.25); break;
                case 5: sequencer.setLoop(0.0, 8.0); break;
                case 6: sequencer.clearLoop(); break;
                case 7: sequencer.stop(); break;
                default: break;
            }

            sequencer.render(128, [&](const beat::Sequencer::TriggerEvent& ev) {
                if (ev.sampleOffset < 0 || ev.sampleOffset >= 128 || ev.lengthSamples <= 0)
                    std::abort();
                ++triggerCount;
            });

            if (!std::isfinite(sequencer.getPosition()))
                return false;
        }

        return triggerCount > 0;
    }

    bool stressSequencerLoopCrossing()
    {
        beat::Sequencer sequencer;
        sequencer.setSampleRate(44100.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(makeStressProject());
        sequencer.setLoop(4.0, 8.0);
        sequencer.play();

        sequencer.seek(10.0);
        sequencer.render(512, [](const beat::Sequencer::TriggerEvent&) {});
        if (sequencer.getPosition() <= 4.5 || sequencer.getPosition() >= 11.0)
            return false;

        sequencer.seek(8.0);
        sequencer.render(512, [](const beat::Sequencer::TriggerEvent&) {});
        if (sequencer.getPosition() < 4.0 || sequencer.getPosition() > 4.05)
            return false;

        sequencer.seek(7.99);
        sequencer.render(1024, [](const beat::Sequencer::TriggerEvent&) {});
        return sequencer.getPosition() >= 4.0 && sequencer.getPosition() <= 4.05;
    }

    bool stressSequencerLoopBoundaryScheduling()
    {
        beat::Sequencer sequencer;
        sequencer.setSampleRate(44100.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(makeStressProject());
        sequencer.setLoop(4.0, 8.0);
        sequencer.seek(7.99);
        sequencer.play();

        bool triggeredLoopStart = false;
        bool triggeredPastLoopEnd = false;
        sequencer.render(4096, [&](const beat::Sequencer::TriggerEvent& ev) {
            if (ev.segmentStartBeat > 4.0 && ev.segmentStartBeat >= 8.0)
                triggeredPastLoopEnd = true;
            if (std::abs(ev.segmentStartBeat - 4.0) < 0.000001
                && ev.sampleOffset > 0
                && ev.sampleOffset < 4096)
            {
                triggeredLoopStart = true;
            }
        });

        return triggeredLoopStart && !triggeredPastLoopEnd;
    }

    bool stressSequencerCropsMidiNotesToSegmentLength()
    {
        beat::Project project;
        project.id = "crop-midi-segment-project";
        project.name = "Crop MIDI Segment Project";
        project.bpm = 120.0;
        project.lengthBeats = 4.0;

        beat::Track track;
        track.id = "crop-track";
        track.name = "Crop Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "crop-instrument";

        beat::Segment segment;
        segment.id = "crop-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "crop-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 1.0;
        segment.repeats = 1;

        beat::MidiNote inside;
        inside.instrumentId = "crop-instrument";
        inside.pitch = 60;
        inside.velocity = 100;
        inside.startBeat = 0.25;
        inside.lengthBeats = 0.25;
        segment.notes.push_back(inside);

        beat::MidiNote crossingTail;
        crossingTail.instrumentId = "crop-instrument";
        crossingTail.pitch = 62;
        crossingTail.velocity = 100;
        crossingTail.startBeat = 0.75;
        crossingTail.lengthBeats = 0.75;
        segment.notes.push_back(crossingTail);

        beat::MidiNote outsideCroppedTail;
        outsideCroppedTail.instrumentId = "crop-instrument";
        outsideCroppedTail.pitch = 64;
        outsideCroppedTail.velocity = 100;
        outsideCroppedTail.startBeat = 1.25;
        outsideCroppedTail.lengthBeats = 0.25;
        segment.notes.push_back(outsideCroppedTail);

        track.segments.push_back(segment);
        project.tracks.push_back(track);

        beat::Sequencer sequencer;
        sequencer.setSampleRate(44100.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(std::move(project));
        sequencer.seek(0.0);
        sequencer.play();

        int insideCount = 0;
        int clippedTailCount = 0;
        int outsideCount = 0;
        bool clippedDuration = false;

        sequencer.render(44100 * 2, [&](const beat::Sequencer::TriggerEvent& ev) {
            if (ev.pitch == 60)
                ++insideCount;
            else if (ev.pitch == 62)
            {
                ++clippedTailCount;
                clippedDuration = clippedDuration || ev.lengthBeats <= 0.251;
            }
            else if (ev.pitch == 64)
                ++outsideCount;
        });

        return insideCount == 2
            && clippedTailCount == 2
            && outsideCount == 0
            && clippedDuration;
    }

    bool stressSequencerAutomationMetadata()
    {
        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(makeStressProject());
        sequencer.seek(0.0);
        sequencer.play();

        bool foundAutomatedNote = false;
        sequencer.render(2048, [&](const beat::Sequencer::TriggerEvent& ev) {
            if (ev.sourceNote == nullptr)
                std::abort();
            if (!ev.sourceNote->automation.empty())
            {
                foundAutomatedNote = true;
                const auto& lane = ev.sourceNote->automation.front();
                if (lane.target != "filter.cutoff" || lane.points.size() != 2)
                    std::abort();
                if (ev.segmentStartBeat != 0.0)
                    std::abort();
            }
        });

        return foundAutomatedNote;
    }

    bool stressSequencerGlideMetadata()
    {
        auto project = makeStressProject();
        project.instruments.front().glideMs = 120.0f;
        auto& note = project.tracks.front().segments.front().notes.front();
        note.connectToIndex = 1;

        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(project);
        sequencer.seek(0.0);
        sequencer.play();

        bool foundGlideNote = false;
        sequencer.render(2048, [&](const beat::Sequencer::TriggerEvent& ev) {
            if (ev.noteIndex == 0)
            {
                foundGlideNote = true;
                if (ev.glideTargetPitch != project.tracks.front().segments.front().notes[1].pitch)
                    std::abort();
                if (!near(ev.instrumentGlideMs, 120.0f))
                    std::abort();
            }
        });

        return foundGlideNote;
    }

    bool stressSequencerSegmentAutomation()
    {
        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(makeStressProject());
        sequencer.seek(1.0);
        sequencer.play();

        bool foundSegmentAutomation = false;
        bool checkedSegmentAutomationStart = false;
        sequencer.render(512,
            [](const beat::Sequencer::TriggerEvent&) {},
            [&](const beat::Sequencer::ParameterAutomationEvent& ev) {
                if (ev.parameterId != "amp.level")
                    return;
                foundSegmentAutomation = true;
                if (!checkedSegmentAutomationStart && ev.sampleOffset == 0)
                {
                    checkedSegmentAutomationStart = true;
                    if (std::abs(ev.value - 0.65f) > 0.01f)
                        std::abort();
                    if (ev.rampSamples <= 0)
                        std::abort();
                }
            });

        return foundSegmentAutomation && checkedSegmentAutomationStart;
    }

    bool stressSequencerProjectAutomation()
    {
        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(makeStressProject());
        sequencer.seek(2.0);
        sequencer.play();

        bool foundProjectAutomation = false;
        bool checkedProjectAutomationStart = false;
        sequencer.render(512,
            [](const beat::Sequencer::TriggerEvent&) {},
            [&](const beat::Sequencer::ParameterAutomationEvent& ev) {
                if (ev.segmentId.isNotEmpty() || ev.parameterId != "filter.cutoff")
                    return;
                foundProjectAutomation = true;
                if (ev.instrumentId != "stress-synth")
                    std::abort();
                if (!checkedProjectAutomationStart && ev.sampleOffset == 0)
                {
                    checkedProjectAutomationStart = true;
                    if (std::abs(ev.value - 0.5f) > 0.01f)
                        std::abort();
                    if (ev.rampSamples <= 0)
                        std::abort();
                }
            });

        return foundProjectAutomation && checkedProjectAutomationStart;
    }

    bool stressSequencerAutomationConflictPrecedence()
    {
        beat::Project project;
        project.id = "automation-conflict-precedence";
        project.bpm = 120.0;
        project.lengthBeats = 4.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "conflict-aether";
        instrument.kind = "wavetable";
        project.instruments.push_back(instrument);

        beat::Track track;
        track.id = "conflict-track";
        track.name = "Conflict Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = instrument.id;

        beat::Segment segment;
        segment.id = "conflict-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = instrument.id;
        segment.startBeat = 0.0;
        segment.lengthBeats = 2.0;

        beat::MidiAutomationLane segmentLane;
        segmentLane.target = "filter.cutoff";
        segmentLane.points.push_back({ 0.0, 0.70f });
        segmentLane.points.push_back({ 1.0, 0.70f });
        segment.automation.push_back(std::move(segmentLane));

        track.segments.push_back(std::move(segment));
        project.tracks.push_back(std::move(track));

        beat::ProjectAutomationLane trackLane;
        trackLane.trackId = "conflict-track";
        trackLane.instrumentId = instrument.id;
        trackLane.target = "filter.cutoff";
        trackLane.points.push_back({ 0.0, 0.45f });
        trackLane.points.push_back({ 1.0, 0.45f });
        project.automation.push_back(std::move(trackLane));

        beat::ProjectAutomationLane projectLane;
        projectLane.instrumentId = instrument.id;
        projectLane.target = "filter.cutoff";
        projectLane.points.push_back({ 0.0, 0.20f });
        projectLane.points.push_back({ 1.0, 0.20f });
        project.automation.push_back(std::move(projectLane));

        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(project);
        sequencer.seek(0.0);
        sequencer.play();

        std::vector<beat::Sequencer::ParameterAutomationEvent> events;
        sequencer.render(512,
            [](const beat::Sequencer::TriggerEvent&) {},
            [&](const beat::Sequencer::ParameterAutomationEvent& ev) {
                if (ev.parameterId == "filter.cutoff" && ev.sampleOffset == 0)
                    events.push_back(ev);
            });

        if (events.size() < 3)
            return false;

        const auto& projectEvent = events[0];
        const auto& trackEvent = events[1];
        const auto& segmentEvent = events[2];

        return projectEvent.trackId.isEmpty()
            && projectEvent.segmentId.isEmpty()
            && projectEvent.instrumentId == instrument.id
            && near(projectEvent.value, 0.20f)
            && trackEvent.trackId == "conflict-track"
            && trackEvent.segmentId.isEmpty()
            && trackEvent.instrumentId == instrument.id
            && near(trackEvent.value, 0.45f)
            && segmentEvent.trackId == "conflict-track"
            && segmentEvent.segmentId == "conflict-segment"
            && segmentEvent.instrumentId == instrument.id
            && near(segmentEvent.value, 0.70f);
    }

    bool stressSequencerTrackEffectAutomation()
    {
        beat::Project project;
        project.id = "track-effect-automation";
        project.bpm = 120.0;
        project.lengthBeats = 8.0;

        beat::Track track;
        track.id = "effect-track";
        track.kind = beat::TrackKind::Audio;

        beat::TrackEffect effect;
        effect.id = "effect-lowpass";
        effect.kind = beat::TrackEffectKind::Lowpass;
        effect.params.push_back({ "cutoffHz", 1000.0f });
        beat::MidiAutomationLane lane;
        lane.target = "cutoffHz";
        lane.points.push_back({ 0.0, 1000.0f, beat::AutomationCurve::Quadratic });
        lane.points.push_back({ 4.0, 9000.0f });
        effect.automation.push_back(std::move(lane));
        track.effects.push_back(std::move(effect));
        project.tracks.push_back(std::move(track));

        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(project);
        sequencer.seek(2.0);
        sequencer.play();

        bool foundEffectAutomation = false;
        bool checkedEffectAutomationStart = false;
        sequencer.render(512,
            [](const beat::Sequencer::TriggerEvent&) {},
            [&](const beat::Sequencer::ParameterAutomationEvent& ev) {
                if (ev.trackId != "effect-track" || ev.parameterId != "effect.effect-lowpass.cutoffHz")
                    return;
                foundEffectAutomation = true;
                if (!checkedEffectAutomationStart && ev.sampleOffset == 0)
                {
                    checkedEffectAutomationStart = true;
                    if (std::abs(ev.value - 3000.0f) > 1.0f)
                        std::abort();
                }
            });

        return foundEffectAutomation && checkedEffectAutomationStart;
    }

    bool stressSequencerAutomationCurveCheckpoints()
    {
        beat::Project project;
        project.id = "automation-curve-checkpoints";
        project.bpm = 60.0;
        project.lengthBeats = 2.0;

        auto addLane = [&](const juce::String& target, beat::AutomationCurve curve) {
            beat::ProjectAutomationLane lane;
            lane.trackId = "automation-track";
            lane.target = target;
            lane.points.push_back({ 0.0, 0.0f, curve });
            lane.points.push_back({ 1.0, 1.0f, beat::AutomationCurve::Linear });
            project.automation.push_back(std::move(lane));
        };

        addLane("track.gainDb", beat::AutomationCurve::Linear);
        addLane("track.pan", beat::AutomationCurve::Cubic);
        addLane("track.width", beat::AutomationCurve::EaseOut);
        addLane("track.send", beat::AutomationCurve::Smoothstep);

        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(60.0);
        sequencer.setProject(project);
        sequencer.seek(0.0);
        sequencer.play();

        std::vector<beat::Sequencer::ParameterAutomationEvent> events;
        sequencer.render(48000,
            [](const beat::Sequencer::TriggerEvent&) {},
            [&](const beat::Sequencer::ParameterAutomationEvent& ev) {
                events.push_back(ev);
            });

        int linearCount = 0;
        int cubicCount = 0;
        int easeOutCount = 0;
        int smoothstepCount = 0;
        float linearMid = -1.0f;
        float cubicMid = -1.0f;
        float easeOutMid = -1.0f;
        float smoothstepMid = -1.0f;
        int linearMidDistance = std::numeric_limits<int>::max();
        int cubicMidDistance = std::numeric_limits<int>::max();
        int easeOutMidDistance = std::numeric_limits<int>::max();
        int smoothstepMidDistance = std::numeric_limits<int>::max();

        for (const auto& ev : events)
        {
            const int distance = std::abs(ev.sampleOffset - 24000);
            if (ev.parameterId == "track.gainDb")
            {
                ++linearCount;
                if (distance < linearMidDistance)
                {
                    linearMidDistance = distance;
                    linearMid = ev.value;
                }
            }
            else if (ev.parameterId == "track.pan")
            {
                ++cubicCount;
                if (distance < cubicMidDistance)
                {
                    cubicMidDistance = distance;
                    cubicMid = ev.value;
                }
            }
            else if (ev.parameterId == "track.width")
            {
                ++easeOutCount;
                if (distance < easeOutMidDistance)
                {
                    easeOutMidDistance = distance;
                    easeOutMid = ev.value;
                }
            }
            else if (ev.parameterId == "track.send")
            {
                ++smoothstepCount;
                if (distance < smoothstepMidDistance)
                {
                    smoothstepMidDistance = distance;
                    smoothstepMid = ev.value;
                }
            }
        }

        const bool ok = linearCount > 100
            && cubicCount > 100
            && easeOutCount > 100
            && smoothstepCount > 100
            && std::abs(linearMid - 0.5f) < 0.02f
            && std::abs(cubicMid - 0.125f) < 0.02f
            && std::abs(easeOutMid - 0.75f) < 0.02f
            && std::abs(smoothstepMid - 0.5f) < 0.02f;

        if (!ok)
        {
            std::cerr << "Automation curve checkpoint stress failed linearCount=" << linearCount
                      << " cubicCount=" << cubicCount
                      << " easeOutCount=" << easeOutCount
                      << " smoothstepCount=" << smoothstepCount
                      << " linearMid=" << linearMid
                      << " cubicMid=" << cubicMid
                      << " easeOutMid=" << easeOutMid
                      << " smoothstepMid=" << smoothstepMid << "\n";
        }

        return ok;
    }

    bool stressSequencerTrackMixMetadata()
    {
        auto project = makeStressProject();
        auto& track = project.tracks.front();
        auto& segment = track.segments.front();
        track.gainDb = -6.0f;
        track.pan = 0.5f;
        segment.audioGainDb = -3.0f;

        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(project);
        sequencer.seek(0.0);
        sequencer.play();

        bool foundMixMetadata = false;
        sequencer.render(4096, [&](const beat::Sequencer::TriggerEvent& ev) {
            foundMixMetadata = true;
            if (ev.trackId != "stress-track" || ev.instrumentId != "stress-synth")
                std::abort();
            if (!near(ev.trackGainDb, -6.0f) || !near(ev.trackPan, 0.5f) || !near(ev.segmentGainDb, -3.0f))
                std::abort();
        });

        return foundMixMetadata;
    }

    bool stressSequencerAudioClipEvents()
    {
        beat::Project project;
        project.id = "audio-clip-sequencer";
        project.bpm = 120.0;
        project.lengthBeats = 4.0;

        beat::Track track;
        track.id = "audio-track";
        track.kind = beat::TrackKind::Audio;
        track.gainDb = -4.0f;
        track.pan = -0.25f;

        beat::Segment segment;
        segment.id = "audio-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Audio;
        segment.audioFileId = "audio-file";
        segment.audioGainDb = -2.0f;
        segment.startBeat = 1.0;
        segment.lengthBeats = 2.0;
        segment.sourceStartBeat = 0.25;
        segment.fadeInBeats = 0.25;
        segment.fadeOutBeats = 0.5;
        track.segments.push_back(segment);
        project.tracks.push_back(track);

        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(project);
        sequencer.seek(1.5);
        sequencer.play();

        bool foundClip = false;
        sequencer.render(512,
            [](const beat::Sequencer::TriggerEvent&) {},
            {},
            [&](const beat::Sequencer::AudioClipEvent& ev) {
                foundClip = true;
                if (ev.trackId != "audio-track" || ev.segmentId != "audio-segment" || ev.audioFileId != "audio-file")
                    std::abort();
                if (ev.sampleOffset != 0 || ev.lengthSamples <= 0)
                    std::abort();
                if (std::abs(ev.sourceOffsetBeats - 0.75) > 0.0001)
                    std::abort();
                if (std::abs(ev.clipOffsetBeats - 0.5) > 0.0001 || std::abs(ev.clipLengthBeats - 2.0) > 0.0001)
                    std::abort();
                if (std::abs(ev.fadeInBeats - 0.25) > 0.0001 || std::abs(ev.fadeOutBeats - 0.5) > 0.0001)
                    std::abort();
                if (!near(ev.trackGainDb, -4.0f) || !near(ev.trackPan, -0.25f) || !near(ev.segmentGainDb, -2.0f))
                    std::abort();
            });

        return foundClip;
    }

    bool writeAudioClipFixture(const juce::File& file, int totalSamples = 44100 / 2)
    {
        if (file.existsAsFile())
            file.deleteFile();

        std::unique_ptr<juce::FileOutputStream> stream(file.createOutputStream());
        if (stream == nullptr || stream->failedToOpen())
            return false;

        constexpr int sampleRate = 44100;
        constexpr int channels = 1;
        constexpr int bitsPerSample = 16;
        constexpr int bytesPerSample = bitsPerSample / 8;
        const uint32_t dataBytes = (uint32_t) totalSamples * channels * bytesPerSample;

        const auto writeU16 = [&stream](uint16_t value)
        {
            const unsigned char bytes[2] {
                (unsigned char) (value & 0xffu),
                (unsigned char) ((value >> 8u) & 0xffu),
            };
            return stream->write(bytes, sizeof(bytes));
        };
        const auto writeU32 = [&stream](uint32_t value)
        {
            const unsigned char bytes[4] {
                (unsigned char) (value & 0xffu),
                (unsigned char) ((value >> 8u) & 0xffu),
                (unsigned char) ((value >> 16u) & 0xffu),
                (unsigned char) ((value >> 24u) & 0xffu),
            };
            return stream->write(bytes, sizeof(bytes));
        };

        stream->write("RIFF", 4);
        writeU32(36 + dataBytes);
        stream->write("WAVE", 4);
        stream->write("fmt ", 4);
        writeU32(16);
        writeU16(1);
        writeU16(channels);
        writeU32(sampleRate);
        writeU32(sampleRate * channels * bytesPerSample);
        writeU16(channels * bytesPerSample);
        writeU16(bitsPerSample);
        stream->write("data", 4);
        writeU32(dataBytes);

        for (int i = 0; i < totalSamples; ++i)
        {
            const float tone = std::sin((float) i * juce::MathConstants<float>::twoPi * 220.0f / (float) sampleRate) * 0.6f;
            writeU16((uint16_t) (int16_t) std::lrint(tone * 32767.0f));
        }

        stream->flush();
        return true;
    }

    bool writeSampleZoneOffsetFixture(const juce::File& file)
    {
        if (file.existsAsFile())
            file.deleteFile();

        std::unique_ptr<juce::FileOutputStream> stream(file.createOutputStream());
        if (stream == nullptr || stream->failedToOpen())
            return false;

        constexpr int sampleRate = 44100;
        constexpr int channels = 1;
        constexpr int totalSamples = 4096;
        constexpr int bitsPerSample = 16;
        constexpr int bytesPerSample = bitsPerSample / 8;
        constexpr uint32_t dataBytes = totalSamples * channels * bytesPerSample;

        const auto writeU16 = [&stream](uint16_t value)
        {
            const unsigned char bytes[2] {
                (unsigned char) (value & 0xffu),
                (unsigned char) ((value >> 8u) & 0xffu),
            };
            return stream->write(bytes, sizeof(bytes));
        };
        const auto writeU32 = [&stream](uint32_t value)
        {
            const unsigned char bytes[4] {
                (unsigned char) (value & 0xffu),
                (unsigned char) ((value >> 8u) & 0xffu),
                (unsigned char) ((value >> 16u) & 0xffu),
                (unsigned char) ((value >> 24u) & 0xffu),
            };
            return stream->write(bytes, sizeof(bytes));
        };

        stream->write("RIFF", 4);
        writeU32(36 + dataBytes);
        stream->write("WAVE", 4);
        stream->write("fmt ", 4);
        writeU32(16);
        writeU16(1);
        writeU16(channels);
        writeU32(sampleRate);
        writeU32(sampleRate * channels * bytesPerSample);
        writeU16(channels * bytesPerSample);
        writeU16(bitsPerSample);
        stream->write("data", 4);
        writeU32(dataBytes);

        for (int i = 0; i < totalSamples; ++i)
        {
            const float amplitude = i < totalSamples / 2 ? 0.02f : 0.75f;
            const float tone = std::sin((float) i * juce::MathConstants<float>::twoPi * 330.0f / (float) sampleRate) * amplitude;
            writeU16((uint16_t) (int16_t) std::lrint(tone * 32767.0f));
        }

        stream->flush();
        return true;
    }

    beat::Project makeDecentFixtureProject(const beat::DecentSamplerImport& source)
    {
        beat::Project project;
        project.id = "decent-fixture-project";
        project.name = "Decent Sampler Fixture";
        project.bpm = 120.0;
        project.lengthBeats = 2.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "decent-fixture-instrument";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 35.0f;
        instrument.sampleUrls = source.sampleUrls;
        for (const auto& sample : source.samples)
        {
            instrument.sampleZones.push_back({
                sample.path,
                sample.rootNote,
                sample.loNote,
                sample.hiNote,
                sample.loVel,
                sample.hiVel,
                (float) sample.volumeDb,
                (float) sample.pan,
                (float) sample.tuning,
                sample.seqPosition,
                sample.loopEnabled,
                sample.loopStart,
                sample.loopEnd,
                sample.oneShot,
                sample.durationSeconds,
                sample.loLengthSeconds,
                sample.hiLengthSeconds,
                sample.chokeGroup,
                sample.startSample,
                sample.endSample,
            });
        }
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "decent-fixture-track";
        track.name = "Decent Fixture Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "decent-fixture-instrument";

        beat::Segment segment;
        segment.id = "decent-fixture-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "decent-fixture-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 2.0;

        const auto& instrumentRef = project.instruments.front();
        const int noteCount = juce::jmin(16, (int) instrumentRef.sampleZones.size());
        for (int i = 0; i < noteCount; ++i)
        {
            const auto& zone = instrumentRef.sampleZones[(size_t) i];
            beat::MidiNote note;
            note.instrumentId = "decent-fixture-instrument";
            note.pitch = juce::jlimit(0, 127, zone.loNote <= zone.hiNote ? zone.loNote : zone.rootNote);
            note.velocity = juce::jlimit(1, 127, (zone.loVel + zone.hiVel) / 2);
            note.startBeat = (double) i * 0.125;
            note.lengthBeats = 0.08;
            segment.notes.push_back(note);
        }

        track.segments.push_back(std::move(segment));
        project.tracks.push_back(std::move(track));
        return project;
    }

    beat::Project makeAudioClipOfflineProject(const juce::File& file)
    {
        beat::Project project;
        project.id = "offline-audio-clip-project";
        project.name = "Offline Audio Clip";
        project.bpm = 120.0;
        project.lengthBeats = 1.0;

        beat::AudioFileAsset audioFile;
        audioFile.id = "clip-file";
        audioFile.name = "Clip Fixture";
        audioFile.path = file.getFullPathName();
        audioFile.durationSeconds = 0.5;
        audioFile.sampleRate = 44100.0;
        project.audioFiles.push_back(std::move(audioFile));

        beat::Track track;
        track.id = "audio-clip-track";
        track.name = "Audio Clip Track";
        track.kind = beat::TrackKind::Audio;

        beat::TrackEffect effect;
        effect.id = "clip-saturator";
        effect.kind = beat::TrackEffectKind::Saturator;
        effect.params.push_back({ "drive", 30.0f });
        effect.params.push_back({ "mix", 25.0f });
        track.effects.push_back(std::move(effect));

        beat::Segment segment;
        segment.id = "audio-clip-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Audio;
        segment.audioFileId = "clip-file";
        segment.startBeat = 0.0;
        segment.lengthBeats = 1.0;
        track.segments.push_back(std::move(segment));
        project.tracks.push_back(std::move(track));
        return project;
    }

    beat::Project makeAudioClipFadeProject(const juce::File& file, double fadeInBeats, double fadeOutBeats)
    {
        beat::Project project;
        project.id = "offline-audio-clip-fade-project";
        project.name = "Offline Audio Clip Fade";
        project.bpm = 120.0;
        project.lengthBeats = 1.0;

        beat::AudioFileAsset audioFile;
        audioFile.id = "clip-file";
        audioFile.name = "Clip Fixture";
        audioFile.path = file.getFullPathName();
        audioFile.durationSeconds = 0.5;
        audioFile.sampleRate = 44100.0;
        project.audioFiles.push_back(std::move(audioFile));

        beat::Track track;
        track.id = "audio-clip-fade-track";
        track.name = "Audio Clip Fade Track";
        track.kind = beat::TrackKind::Audio;

        beat::Segment segment;
        segment.id = "audio-clip-fade-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Audio;
        segment.audioFileId = "clip-file";
        segment.startBeat = 0.0;
        segment.lengthBeats = 1.0;
        segment.fadeInBeats = fadeInBeats;
        segment.fadeOutBeats = fadeOutBeats;
        track.segments.push_back(std::move(segment));
        project.tracks.push_back(std::move(track));
        return project;
    }

    beat::Project makeAudioClipCrossfadeProject(const juce::File& file)
    {
        beat::Project project;
        project.id = "offline-audio-clip-crossfade-project";
        project.name = "Offline Audio Clip Crossfade";
        project.bpm = 120.0;
        project.lengthBeats = 1.75;

        beat::AudioFileAsset audioFile;
        audioFile.id = "clip-file";
        audioFile.name = "Clip Fixture";
        audioFile.path = file.getFullPathName();
        audioFile.durationSeconds = 0.5;
        audioFile.sampleRate = 44100.0;
        project.audioFiles.push_back(std::move(audioFile));

        beat::Track track;
        track.id = "audio-clip-crossfade-track";
        track.name = "Audio Clip Crossfade Track";
        track.kind = beat::TrackKind::Audio;

        beat::Segment left;
        left.id = "audio-clip-crossfade-left";
        left.trackId = track.id;
        left.kind = beat::SegmentPayloadKind::Audio;
        left.audioFileId = "clip-file";
        left.startBeat = 0.0;
        left.lengthBeats = 1.0;
        left.fadeOutBeats = 0.25;
        track.segments.push_back(std::move(left));

        beat::Segment right;
        right.id = "audio-clip-crossfade-right";
        right.trackId = track.id;
        right.kind = beat::SegmentPayloadKind::Audio;
        right.audioFileId = "clip-file";
        right.startBeat = 0.75;
        right.lengthBeats = 1.0;
        right.fadeInBeats = 0.25;
        track.segments.push_back(std::move(right));

        project.tracks.push_back(std::move(track));
        return project;
    }

    beat::Project makeAudioClipTrimProject(const juce::File& file)
    {
        beat::Project project;
        project.id = "offline-audio-clip-trim-project";
        project.name = "Offline Audio Clip Trim";
        project.bpm = 120.0;
        project.lengthBeats = 0.75;

        beat::AudioFileAsset audioFile;
        audioFile.id = "clip-file";
        audioFile.name = "Clip Fixture";
        audioFile.path = file.getFullPathName();
        audioFile.durationSeconds = 0.5;
        audioFile.sampleRate = 44100.0;
        project.audioFiles.push_back(std::move(audioFile));

        beat::Track track;
        track.id = "audio-clip-trim-track";
        track.name = "Audio Clip Trim Track";
        track.kind = beat::TrackKind::Audio;

        beat::Segment segment;
        segment.id = "audio-clip-trim-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Audio;
        segment.audioFileId = "clip-file";
        segment.startBeat = 0.0;
        segment.lengthBeats = 0.75;
        segment.sourceStartBeat = 0.25;
        track.segments.push_back(std::move(segment));

        project.tracks.push_back(std::move(track));
        return project;
    }

    beat::Project makeSampleInstrumentOfflineProject(const juce::File& file)
    {
        beat::Project project;
        project.id = "offline-sample-route-project";
        project.name = "Offline Sample Route";
        project.bpm = 120.0;
        project.lengthBeats = 0.5;

        beat::InstrumentDefinition instrument;
        instrument.id = "sample-route-instrument";
        instrument.kind = "sampler";
        instrument.sampleUrls.add(file.getFullPathName());
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "sample-route-track";
        track.name = "Sample Route Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "sample-route-instrument";

        beat::Segment segment;
        segment.id = "sample-route-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "sample-route-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 0.5;

        beat::MidiNote note;
        note.instrumentId = "sample-route-instrument";
        note.pitch = 60;
        note.velocity = 120;
        note.startBeat = 0.0;
        note.lengthBeats = 0.25;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeSampleZoneOfflineProject(const juce::File& file, int velocity, float noteLengthBeats)
    {
        beat::Project project;
        project.id = "offline-sample-zone-project";
        project.name = "Offline Sample Zone";
        project.bpm = 120.0;
        project.lengthBeats = 0.75;

        beat::InstrumentDefinition instrument;
        instrument.id = "sample-zone-instrument";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 5.0f;
        instrument.sampleUrls.add(file.getFullPathName());
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            0,
            63,
            -24.0f,
            0.0f,
            0.0f,
            0,
            false,
            0,
            0,
            false,
        });
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            64,
            127,
            0.0f,
            0.0f,
            0.0f,
            1,
            false,
            0,
            0,
            false,
        });
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "sample-zone-track";
        track.name = "Sample Zone Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "sample-zone-instrument";

        beat::Segment segment;
        segment.id = "sample-zone-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "sample-zone-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 0.75;

        beat::MidiNote note;
        note.instrumentId = "sample-zone-instrument";
        note.pitch = 60;
        note.velocity = velocity;
        note.startBeat = 0.0;
        note.lengthBeats = noteLengthBeats;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeSampleZoneOffsetProject(const juce::File& file, int startSample, int endSample)
    {
        beat::Project project;
        project.id = "sample-zone-offset-project";
        project.name = "Sample Zone Offset";
        project.bpm = 120.0;
        project.lengthBeats = 0.5;

        beat::InstrumentDefinition instrument;
        instrument.id = "sample-zone-offset-instrument";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 1.0f;
        instrument.sampleUrls.add(file.getFullPathName());

        beat::InstrumentDefinition::SampleZone zone;
        zone.path = file.getFullPathName();
        zone.rootNote = 60;
        zone.loNote = 0;
        zone.hiNote = 127;
        zone.loVel = 0;
        zone.hiVel = 127;
        zone.oneShot = true;
        zone.startSample = startSample;
        zone.endSample = endSample;
        instrument.sampleZones.push_back(zone);
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "sample-zone-offset-track";
        track.name = "Sample Zone Offset Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "sample-zone-offset-instrument";

        beat::Segment segment;
        segment.id = "sample-zone-offset-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "sample-zone-offset-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 0.5;

        beat::MidiNote note;
        note.instrumentId = "sample-zone-offset-instrument";
        note.pitch = 60;
        note.velocity = 127;
        note.startBeat = 0.0;
        note.lengthBeats = 0.25;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeSampleZoneLengthProject(const juce::File& file, float noteLengthBeats)
    {
        beat::Project project;
        project.id = "offline-sample-zone-length-project";
        project.name = "Offline Sample Zone Length";
        project.bpm = 120.0;
        project.lengthBeats = 1.25;

        beat::InstrumentDefinition instrument;
        instrument.id = "sample-zone-length-instrument";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 5.0f;
        instrument.sampleUrls.add(file.getFullPathName());
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            0,
            127,
            -36.0f,
            0.0f,
            0.0f,
            0,
            false,
            0,
            0,
            false,
            0.1,
            0.0,
            0.2,
        });
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            0,
            127,
            0.0f,
            0.0f,
            0.0f,
            1,
            false,
            0,
            0,
            false,
            0.8,
            0.2,
            1.2,
        });
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "sample-zone-length-track";
        track.name = "Sample Zone Length Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "sample-zone-length-instrument";

        beat::Segment segment;
        segment.id = "sample-zone-length-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "sample-zone-length-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 1.25;

        beat::MidiNote note;
        note.instrumentId = "sample-zone-length-instrument";
        note.pitch = 60;
        note.velocity = 112;
        note.startBeat = 0.0;
        note.lengthBeats = noteLengthBeats;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeSampleZoneMultiVariableProject(const juce::File& file, int velocity, float noteLengthBeats)
    {
        beat::Project project;
        project.id = "offline-sample-zone-multi-variable-project";
        project.name = "Offline Sample Zone Multi Variable";
        project.bpm = 120.0;
        project.lengthBeats = 1.25;

        beat::InstrumentDefinition instrument;
        instrument.id = "sample-zone-multi-variable-instrument";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 5.0f;
        instrument.sampleUrls.add(file.getFullPathName());
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            0,
            63,
            -36.0f,
            0.0f,
            0.0f,
            0,
            false,
            0,
            0,
            false,
            0.08,
            0.0,
            0.2,
        });
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            64,
            127,
            -24.0f,
            0.0f,
            0.0f,
            1,
            false,
            0,
            0,
            false,
            0.08,
            0.0,
            0.2,
        });
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            0,
            63,
            -12.0f,
            0.0f,
            0.0f,
            2,
            false,
            0,
            0,
            false,
            0.8,
            0.2,
            1.2,
        });
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            64,
            127,
            0.0f,
            0.0f,
            0.0f,
            3,
            false,
            0,
            0,
            false,
            0.8,
            0.2,
            1.2,
        });
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "sample-zone-multi-variable-track";
        track.name = "Sample Zone Multi Variable Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "sample-zone-multi-variable-instrument";

        beat::Segment segment;
        segment.id = "sample-zone-multi-variable-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "sample-zone-multi-variable-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 1.25;

        beat::MidiNote note;
        note.instrumentId = "sample-zone-multi-variable-instrument";
        note.pitch = 60;
        note.velocity = velocity;
        note.startBeat = 0.0;
        note.lengthBeats = noteLengthBeats;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeSampleLoopOfflineProject(const juce::File& file, bool loopEnabled, bool oneShot)
    {
        beat::Project project;
        project.id = "offline-sample-loop-project";
        project.name = "Offline Sample Loop";
        project.bpm = 120.0;
        project.lengthBeats = 2.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "sample-loop-instrument";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 5.0f;
        instrument.sampleUrls.add(file.getFullPathName());
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            0,
            127,
            0.0f,
            0.0f,
            0.0f,
            0,
            loopEnabled,
            1200,
            3600,
            oneShot,
        });
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "sample-loop-track";
        track.name = "Sample Loop Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "sample-loop-instrument";

        beat::Segment segment;
        segment.id = "sample-loop-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "sample-loop-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 2.0;

        beat::MidiNote note;
        note.instrumentId = "sample-loop-instrument";
        note.pitch = 60;
        note.velocity = 120;
        note.startBeat = 0.0;
        note.lengthBeats = oneShot ? 0.02 : 1.5;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeSampleChokeOfflineProject(const juce::File& file, int chokeGroup)
    {
        beat::Project project;
        project.id = "offline-sample-choke-project";
        project.name = "Offline Sample Choke";
        project.bpm = 120.0;
        project.lengthBeats = 1.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "sample-choke-instrument";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 80.0f;
        instrument.sampleUrls.add(file.getFullPathName());

        beat::InstrumentDefinition::SampleZone zone;
        zone.path = file.getFullPathName();
        zone.rootNote = 60;
        zone.loNote = 0;
        zone.hiNote = 127;
        zone.loVel = 0;
        zone.hiVel = 127;
        zone.volumeDb = 0.0f;
        zone.seqPosition = 0;
        zone.oneShot = true;
        zone.chokeGroup = chokeGroup;
        instrument.sampleZones.push_back(zone);
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "sample-choke-track";
        track.name = "Sample Choke Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "sample-choke-instrument";

        beat::Segment segment;
        segment.id = "sample-choke-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "sample-choke-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 1.0;

        for (double startBeat : { 0.0, 0.1 })
        {
            beat::MidiNote note;
            note.instrumentId = "sample-choke-instrument";
            note.pitch = 60;
            note.velocity = 120;
            note.startBeat = startBeat;
            note.lengthBeats = 0.02;
            segment.notes.push_back(note);
        }

        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeTinyOfflineProject();

    beat::Project makeMixedRenderProject(const juce::File& sampleFile, const juce::File& clipFile)
    {
        auto project = makeTinyOfflineProject();
        project.id = "mixed-render-project";
        project.name = "Mixed Render Project";
        project.lengthBeats = 2.0;
        project.eqAutomation.push_back({ 0.0, 1.5f, -2.0f, 0.5f, 2.5f });

        beat::TrackEffect synthDelay;
        synthDelay.id = "mixed-synth-delay";
        synthDelay.kind = beat::TrackEffectKind::Delay;
        synthDelay.params.push_back({ "timeMs", 48.0f });
        synthDelay.params.push_back({ "feedback", 18.0f });
        synthDelay.params.push_back({ "mix", 20.0f });
        project.tracks.front().effects.push_back(std::move(synthDelay));

        beat::InstrumentDefinition sampler;
        sampler.id = "mixed-sampler";
        sampler.kind = "sampler";
        sampler.attackMs = 0.0f;
        sampler.releaseMs = 20.0f;
        sampler.sampleUrls.add(sampleFile.getFullPathName());
        sampler.sampleZones.push_back({
            sampleFile.getFullPathName(),
            60,
            0,
            127,
            0,
            127,
            -3.0f,
            0.0f,
            0.0f,
            0,
            true,
            1200,
            3600,
            false,
        });
        project.instruments.push_back(std::move(sampler));

        beat::Track samplerTrack;
        samplerTrack.id = "mixed-sampler-track";
        samplerTrack.name = "Mixed Sampler";
        samplerTrack.kind = beat::TrackKind::Midi;
        samplerTrack.instrumentId = "mixed-sampler";

        beat::TrackEffect samplerFilter;
        samplerFilter.id = "mixed-sampler-filter";
        samplerFilter.kind = beat::TrackEffectKind::Lowpass;
        samplerFilter.params.push_back({ "cutoffHz", 6000.0f });
        samplerFilter.params.push_back({ "resonance", 10.0f });
        samplerTrack.effects.push_back(std::move(samplerFilter));

        beat::Segment samplerSegment;
        samplerSegment.id = "mixed-sampler-segment";
        samplerSegment.trackId = samplerTrack.id;
        samplerSegment.kind = beat::SegmentPayloadKind::Midi;
        samplerSegment.instrumentId = "mixed-sampler";
        samplerSegment.startBeat = 0.125;
        samplerSegment.lengthBeats = 1.5;
        for (int i = 0; i < 4; ++i)
        {
            beat::MidiNote note;
            note.instrumentId = "mixed-sampler";
            note.pitch = 60;
            note.velocity = 96 + i * 6;
            note.startBeat = i * 0.25;
            note.lengthBeats = 0.2;
            samplerSegment.notes.push_back(note);
        }
        samplerTrack.segments.push_back(std::move(samplerSegment));
        project.tracks.push_back(std::move(samplerTrack));

        beat::AudioFileAsset audioFile;
        audioFile.id = "mixed-clip-file";
        audioFile.name = "Mixed Clip";
        audioFile.path = clipFile.getFullPathName();
        audioFile.durationSeconds = 0.5;
        audioFile.sampleRate = 44100.0;
        project.audioFiles.push_back(std::move(audioFile));

        beat::Track audioTrack;
        audioTrack.id = "mixed-audio-track";
        audioTrack.name = "Mixed Audio";
        audioTrack.kind = beat::TrackKind::Audio;
        audioTrack.gainDb = -6.0f;
        audioTrack.pan = -0.15f;

        beat::TrackEffect audioSaturator;
        audioSaturator.id = "mixed-audio-saturator";
        audioSaturator.kind = beat::TrackEffectKind::Saturator;
        audioSaturator.params.push_back({ "drive", 20.0f });
        audioSaturator.params.push_back({ "mix", 30.0f });
        audioTrack.effects.push_back(std::move(audioSaturator));

        beat::Segment audioSegment;
        audioSegment.id = "mixed-audio-segment";
        audioSegment.trackId = audioTrack.id;
        audioSegment.kind = beat::SegmentPayloadKind::Audio;
        audioSegment.audioFileId = "mixed-clip-file";
        audioSegment.audioGainDb = -3.0f;
        audioSegment.startBeat = 0.25;
        audioSegment.lengthBeats = 1.0;
        audioTrack.segments.push_back(std::move(audioSegment));
        project.tracks.push_back(std::move(audioTrack));

        beat::ProjectAutomationLane gainLane;
        gainLane.trackId = "mixed-sampler-track";
        gainLane.target = "track.gainDb";
        gainLane.points.push_back({ 0.0, -3.0f });
        gainLane.points.push_back({ 1.5, -9.0f });
        project.automation.push_back(std::move(gainLane));

        return project;
    }

    beat::Project makeTwoTrackOfflineProject()
    {
        beat::Project project;
        project.id = "two-track-offline-project";
        project.name = "Two Track Offline";
        project.bpm = 120.0;
        project.lengthBeats = 0.75;

        beat::InstrumentDefinition instrument;
        instrument.id = "offline-synth";
        instrument.kind = "synth";
        instrument.waveform = 0;
        instrument.cutoff01 = 1.0f;
        instrument.attackMs = 1.0f;
        instrument.releaseMs = 20.0f;
        project.instruments.push_back(instrument);

        beat::Track firstTrack;
        firstTrack.id = "offline-track";
        firstTrack.name = "Offline Track";
        firstTrack.kind = beat::TrackKind::Midi;
        firstTrack.instrumentId = instrument.id;

        beat::Segment firstSegment;
        firstSegment.id = "offline-segment";
        firstSegment.trackId = firstTrack.id;
        firstSegment.kind = beat::SegmentPayloadKind::Midi;
        firstSegment.instrumentId = instrument.id;
        firstSegment.startBeat = 0.0;
        firstSegment.lengthBeats = 0.5;

        beat::MidiNote firstNote;
        firstNote.instrumentId = instrument.id;
        firstNote.pitch = 60;
        firstNote.velocity = 110;
        firstNote.startBeat = 0.0;
        firstNote.lengthBeats = 0.25;
        firstSegment.notes.push_back(firstNote);
        firstTrack.segments.push_back(firstSegment);

        beat::Track secondTrack = firstTrack;
        secondTrack.id = "offline-track-b";
        secondTrack.name = "Offline Track B";
        secondTrack.pan = 0.8f;
        secondTrack.gainDb = -3.0f;
        secondTrack.segments.front().id = "offline-segment-b";
        secondTrack.segments.front().trackId = secondTrack.id;
        secondTrack.segments.front().startBeat = 0.25;
        secondTrack.segments.front().notes.front().pitch = 72;

        project.tracks.push_back(std::move(firstTrack));
        project.tracks.push_back(std::move(secondTrack));

        return project;
    }

    beat::Project makeTinyOfflineProject()
    {
        beat::Project project;
        project.id = "offline-export-project";
        project.name = "Offline Export";
        project.bpm = 120.0;
        project.lengthBeats = 0.5;

        beat::InstrumentDefinition instrument;
        instrument.id = "offline-synth";
        instrument.kind = "synth";
        instrument.waveform = 0;
        instrument.cutoff01 = 1.0f;
        instrument.attackMs = 1.0f;
        instrument.releaseMs = 20.0f;
        project.instruments.push_back(instrument);

        beat::Track track;
        track.id = "offline-track";
        track.name = "Offline Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = instrument.id;

        beat::Segment segment;
        segment.id = "offline-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = instrument.id;
        segment.startBeat = 0.0;
        segment.lengthBeats = 0.5;

        beat::MidiNote note;
        note.instrumentId = instrument.id;
        note.pitch = 60;
        note.velocity = 110;
        note.startBeat = 0.0;
        note.lengthBeats = 0.25;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeNodemapOfflineProject()
    {
        beat::Project project;
        project.id = "native-nodemap-offline-project";
        project.name = "Native Nodemap Offline";
        project.bpm = 124.0;
        project.lengthBeats = 1.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "native-nodemap-synth";
        instrument.kind = "nodemap";
        instrument.maxVoices = 8;
        instrument.nodeGraph = beat::Nodemap::makeProofTemplate("filtered-mono");
        project.instruments.push_back(instrument);

        auto makeTrack = [&](const juce::String& id, int pitch, double startBeat, float pan)
        {
            beat::Track track;
            track.id = id;
            track.name = "Nodemap " + id;
            track.kind = beat::TrackKind::Midi;
            track.instrumentId = instrument.id;
            track.pan = pan;

            beat::Segment segment;
            segment.id = id + "-segment";
            segment.trackId = track.id;
            segment.kind = beat::SegmentPayloadKind::Midi;
            segment.instrumentId = instrument.id;
            segment.startBeat = 0.0;
            segment.lengthBeats = 1.0;

            beat::MidiNote note;
            note.instrumentId = instrument.id;
            note.pitch = pitch;
            note.velocity = 108;
            note.startBeat = startBeat;
            note.lengthBeats = 0.35;
            segment.notes.push_back(note);
            track.segments.push_back(segment);
            return track;
        };

        project.tracks.push_back(makeTrack("native-nodemap-track-a", 60, 0.0, -0.25f));
        project.tracks.push_back(makeTrack("native-nodemap-track-b", 67, 0.25, 0.25f));
        return project;
    }

    bool stressAudioEngineTrackMeters()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 256, 2);
        engine.applyProject(makeTinyOfflineProject());
        engine.requestPlay();

        juce::AudioBuffer<float> buffer(2, 2048);
        buffer.clear();
        std::array<float*, 2> outputs {
            buffer.getWritePointer(0),
            buffer.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, buffer.getNumSamples(), context);

        std::vector<beat::AudioEngine::TrackMeterSnapshot> meters;
        if (!engine.pullTrackMeterSnapshots(meters))
            return false;

        bool foundMaster = false;
        bool foundTrack = false;
        for (const auto& meter : meters)
        {
            if (!std::isfinite(meter.rms)
                || !std::isfinite(meter.peak)
                || !std::isfinite(meter.leftRms)
                || !std::isfinite(meter.rightRms)
                || !std::isfinite(meter.leftPeak)
                || !std::isfinite(meter.rightPeak))
                return false;
            const bool hasChannelSignal = meter.leftRms > 0.0f
                || meter.rightRms > 0.0f
                || meter.leftPeak > 0.0f
                || meter.rightPeak > 0.0f;
            if (meter.trackId == "master")
            {
                foundMaster = meter.sequence > 0
                    && meter.rms > 0.0f
                    && meter.peak > 0.0f
                    && hasChannelSignal
                    && std::isfinite(meter.rmsDbFS)
                    && std::isfinite(meter.peakDbFS)
                    && std::isfinite(meter.truePeakDbTP)
                    && std::isfinite(meter.momentaryLufs)
                    && meter.truePeakDbTP >= meter.peakDbFS - 0.25f;
            }
            if (meter.trackId == "offline-track")
            {
                foundTrack = meter.sequence > 0
                    && meter.rms > 0.0f
                    && meter.peak > 0.0f
                    && hasChannelSignal;
            }
        }

        return foundMaster && foundTrack;
    }

    juce::AudioBuffer<float> renderOfflineBlock(beat::Project project, int samples);
    double bufferEnergy(const juce::AudioBuffer<float>& buffer);

    bool stressAudioEngineTrackGainPanRender()
    {
        auto dryProject = makeTinyOfflineProject();
        auto quietProject = makeTinyOfflineProject();
        auto leftProject = makeTinyOfflineProject();
        auto rightProject = makeTinyOfflineProject();

        quietProject.tracks.front().gainDb = -24.0f;
        leftProject.tracks.front().pan = -1.0f;
        rightProject.tracks.front().pan = 1.0f;

        const auto dry = renderOfflineBlock(std::move(dryProject), 8192);
        const auto quiet = renderOfflineBlock(std::move(quietProject), 8192);
        const auto left = renderOfflineBlock(std::move(leftProject), 8192);
        const auto right = renderOfflineBlock(std::move(rightProject), 8192);

        const auto channelEnergy = [] (const juce::AudioBuffer<float>& buffer, int channel)
        {
            double energy = 0.0;
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(channel, i);
                if (!std::isfinite(sample))
                    return std::numeric_limits<double>::quiet_NaN();
                energy += (double) sample * (double) sample;
            }
            return energy;
        };

        const double dryEnergy = bufferEnergy(dry);
        const double quietEnergy = bufferEnergy(quiet);
        const double leftL = channelEnergy(left, 0);
        const double leftR = channelEnergy(left, 1);
        const double rightL = channelEnergy(right, 0);
        const double rightR = channelEnergy(right, 1);

        const bool ok = std::isfinite(dryEnergy)
            && std::isfinite(quietEnergy)
            && dryEnergy > 0.0001
            && quietEnergy < dryEnergy * 0.02
            && leftL > leftR * 32.0
            && rightR > rightL * 32.0;

        if (!ok)
        {
            std::cerr << "Track gain/pan render stress failed dryEnergy=" << dryEnergy
                      << " quietEnergy=" << quietEnergy
                      << " leftL=" << leftL
                      << " leftR=" << leftR
                      << " rightL=" << rightL
                      << " rightR=" << rightR << "\n";
        }

        return ok;
    }

    juce::AudioBuffer<float> renderOfflineBlock(beat::Project project, int samples = 4096)
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 256, 2);
        engine.applyProject(std::move(project));
        engine.requestPlay();

        juce::AudioBuffer<float> buffer(2, samples);
        buffer.clear();
        std::array<float*, 2> outputs {
            buffer.getWritePointer(0),
            buffer.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, buffer.getNumSamples(), context);
        return buffer;
    }

    double bufferEnergy(const juce::AudioBuffer<float>& buffer)
    {
        double energy = 0.0;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(ch, i);
                if (!std::isfinite(sample))
                    return std::numeric_limits<double>::quiet_NaN();
                energy += (double) sample * (double) sample;
            }
        }
        return energy;
    }

    bool stressAudioEngineExtraLfoTempoSync()
    {
        auto project = makeDenseAetherProject();
        project.lengthBeats = 16.0;
        project.automation.clear();
        auto& segment = project.tracks.front().segments.front();
        segment.automation.clear();
        segment.notes.resize(1);
        segment.notes.front().startBeat = 0.0;
        segment.notes.front().lengthBeats = 16.0;
        auto& instrument = project.instruments.front();
        instrument.dynamicModulation = {};
        instrument.dynamicModulation.active = true;
        instrument.dynamicModulation.ampLevel.extraLfo[7] = 0.7f;
        instrument.ampLevel = 0.2f;
        auto& lfo = instrument.extraLfos[7];
        lfo.enabled = true;
        lfo.waveform = 0;
        lfo.rateHz = 3.25f;
        lfo.sync = true;
        lfo.syncedRate = "1/4";
        lfo.smoothing = 0.0f;
        lfo.randomPhase = 0.0f;
        lfo.phaseOffset = 0.0f;
        lfo.retrigger = true;
        lfo.oneShot = false;

        project.bpm = 60.0;
        const auto syncedSlow = renderOfflineBlock(project, 12000);
        project.bpm = 120.0;
        const auto syncedFast = renderOfflineBlock(project, 12000);

        auto absoluteDifference = [](const juce::AudioBuffer<float>& a, const juce::AudioBuffer<float>& b)
        {
            double difference = 0.0;
            for (int channel = 0; channel < a.getNumChannels(); ++channel)
                for (int sample = 0; sample < a.getNumSamples(); ++sample)
                    difference += std::abs((double) a.getSample(channel, sample) - (double) b.getSample(channel, sample));
            return difference;
        };
        const auto syncedDifference = absoluteDifference(syncedSlow, syncedFast);

        project.instruments.front().extraLfos[7].sync = false;
        project.bpm = 60.0;
        const auto freeSlow = renderOfflineBlock(project, 12000);
        project.bpm = 120.0;
        const auto freeFast = renderOfflineBlock(project, 12000);
        const auto freeDifference = absoluteDifference(freeSlow, freeFast);
        const bool ok = syncedDifference > 10.0 && syncedDifference > freeDifference * 3.5;
        if (!ok)
            std::cerr << "Extra LFO tempo sync difference synced=" << syncedDifference
                      << " free=" << freeDifference << "\n";
        return ok;
    }

    float bufferPeak(const juce::AudioBuffer<float>& buffer)
    {
        float peak = 0.0f;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(ch, i);
                if (!std::isfinite(sample))
                    return std::numeric_limits<float>::quiet_NaN();
                peak = juce::jmax(peak, std::abs(sample));
            }
        }
        return peak;
    }

    struct BufferResidualStats
    {
        bool ok { false };
        double sourceEnergy { 0.0 };
        double residualEnergy { 0.0 };
        double meanAbsDiff { std::numeric_limits<double>::infinity() };
        float maxAbsDiff { 0.0f };
        int comparedSamples { 0 };
    };

    BufferResidualStats bufferResidualStats(const juce::AudioBuffer<float>& source,
                                            const juce::AudioBuffer<float>& candidate,
                                            int samples)
    {
        BufferResidualStats stats;
        if (samples <= 0
            || source.getNumChannels() != candidate.getNumChannels()
            || source.getNumSamples() < samples
            || candidate.getNumSamples() < samples)
            return stats;

        double sumAbsDiff = 0.0;
        for (int ch = 0; ch < source.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float sourceSample = source.getSample(ch, i);
                const float candidateSample = candidate.getSample(ch, i);
                if (!std::isfinite(sourceSample) || !std::isfinite(candidateSample))
                    return {};

                const float diff = sourceSample - candidateSample;
                const float absDiff = std::abs(diff);
                stats.maxAbsDiff = std::max(stats.maxAbsDiff, absDiff);
                sumAbsDiff += absDiff;
                stats.sourceEnergy += (double) sourceSample * (double) sourceSample;
                stats.residualEnergy += (double) diff * (double) diff;
            }
        }

        stats.comparedSamples = source.getNumChannels() * samples;
        stats.meanAbsDiff = sumAbsDiff / (double) stats.comparedSamples;
        stats.ok = true;
        return stats;
    }

    double bufferWindowEnergy(const juce::AudioBuffer<float>& buffer, int startSample, int numSamples)
    {
        const int start = juce::jlimit(0, buffer.getNumSamples(), startSample);
        const int end = juce::jlimit(start, buffer.getNumSamples(), start + juce::jmax(0, numSamples));
        double energy = 0.0;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            for (int i = start; i < end; ++i)
            {
                const float sample = buffer.getSample(ch, i);
                if (!std::isfinite(sample))
                    return std::numeric_limits<double>::quiet_NaN();
                energy += (double) sample * (double) sample;
            }
        }
        return energy;
    }

    bool bufferHasSubnormalSamples(const juce::AudioBuffer<float>& buffer)
    {
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(ch, i);
                if (!std::isfinite(sample))
                    return true;
                if (std::fpclassify(sample) == FP_SUBNORMAL)
                    return true;
            }
        }
        return false;
    }

    double wavEnergy(const juce::File& file)
    {
        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr || reader->lengthInSamples <= 0 || reader->numChannels < 1)
            return std::numeric_limits<double>::quiet_NaN();

        juce::AudioBuffer<float> buffer((int) reader->numChannels,
                                        (int) juce::jmin<juce::int64>(reader->lengthInSamples, 44100));
        reader->read(&buffer, 0, buffer.getNumSamples(), 0, true, true);
        return bufferEnergy(buffer);
    }

    juce::AudioBuffer<float> renderEngineBlock(beat::AudioEngine& engine, int samples = 4096)
    {
        juce::AudioBuffer<float> buffer(2, samples);
        buffer.clear();
        std::array<float*, 2> outputs {
            buffer.getWritePointer(0),
            buffer.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, buffer.getNumSamples(), context);
        return buffer;
    }

    juce::AudioBuffer<float> renderOfflineChunks(beat::Project project, int samples, int blockSize = 256, double sampleRate = 44100.0)
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(sampleRate, blockSize, 2);
        engine.applyProject(std::move(project));
        engine.requestSeek(0.0);
        engine.requestPlay();

        juce::AudioBuffer<float> output(2, samples);
        juce::AudioBuffer<float> block(2, blockSize);
        output.clear();
        juce::AudioIODeviceCallbackContext context;

        int written = 0;
        while (written < samples)
        {
            const int samplesThisBlock = juce::jmin(blockSize, samples - written);
            block.setSize(2, samplesThisBlock, false, false, true);
            block.clear();

            std::array<float*, 2> outputs {
                block.getWritePointer(0),
                block.getWritePointer(1),
            };
            engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, samplesThisBlock, context);

            for (int ch = 0; ch < output.getNumChannels(); ++ch)
                output.copyFrom(ch, written, block, ch, 0, samplesThisBlock);

            written += samplesThisBlock;
        }

        engine.requestStop();
        return output;
    }

    juce::AudioBuffer<float> renderOfflineRangeChunks(
        beat::Project project,
        double startBeat,
        int samples,
        int blockSize = 256,
        double sampleRate = 44100.0)
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(sampleRate, blockSize, 2);
        engine.applyProject(std::move(project));
        engine.requestSeek(startBeat);
        engine.requestPlay();

        juce::AudioBuffer<float> output(2, samples);
        juce::AudioBuffer<float> block(2, blockSize);
        output.clear();
        juce::AudioIODeviceCallbackContext context;

        int written = 0;
        while (written < samples)
        {
            const int samplesThisBlock = juce::jmin(blockSize, samples - written);
            block.setSize(2, samplesThisBlock, false, false, true);
            block.clear();

            std::array<float*, 2> outputs {
                block.getWritePointer(0),
                block.getWritePointer(1),
            };
            engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, samplesThisBlock, context);

            for (int ch = 0; ch < output.getNumChannels(); ++ch)
                output.copyFrom(ch, written, block, ch, 0, samplesThisBlock);

            written += samplesThisBlock;
        }

        engine.requestStop();
        return output;
    }

    juce::AudioBuffer<float> renderOfflineLoopRangeChunks(
        beat::Project project,
        double startBeat,
        double endBeat,
        int samples,
        int blockSize = 256,
        double sampleRate = 44100.0)
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(sampleRate, blockSize, 2);
        engine.applyProject(std::move(project));
        engine.requestLoop(startBeat, endBeat);
        engine.requestSeek(startBeat);
        engine.requestPlay();

        juce::AudioBuffer<float> output(2, samples);
        juce::AudioBuffer<float> block(2, blockSize);
        output.clear();
        juce::AudioIODeviceCallbackContext context;

        int written = 0;
        while (written < samples)
        {
            const int samplesThisBlock = juce::jmin(blockSize, samples - written);
            block.setSize(2, samplesThisBlock, false, false, true);
            block.clear();

            std::array<float*, 2> outputs {
                block.getWritePointer(0),
                block.getWritePointer(1),
            };
            engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, samplesThisBlock, context);

            for (int ch = 0; ch < output.getNumChannels(); ++ch)
                output.copyFrom(ch, written, block, ch, 0, samplesThisBlock);

            written += samplesThisBlock;
        }

        engine.requestStop();
        return output;
    }

    juce::AudioBuffer<float> readWavPrefix(const juce::File& file, int samples)
    {
        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr || reader->lengthInSamples <= 0 || reader->numChannels < 1)
            return {};

        const int channels = (int) juce::jmin<unsigned int>(2u, reader->numChannels);
        const int sampleCount = (int) juce::jmin<juce::int64>(samples, reader->lengthInSamples);
        juce::AudioBuffer<float> buffer(channels, sampleCount);
        buffer.clear();
        reader->read(&buffer, 0, sampleCount, 0, true, true);
        return buffer;
    }

    bool stressAudioEngineTrackEffects()
    {
        auto dryProject = makeTinyOfflineProject();
        auto wetProject = makeTinyOfflineProject();

        beat::TrackEffect effect;
        effect.id = "stress-filter";
        effect.kind = beat::TrackEffectKind::Highpass;
        effect.bypassed = false;
        effect.params.push_back({ "cutoffHz", 5000.0f });
        effect.params.push_back({ "resonance", 0.0f });
        wetProject.tracks.front().effects.push_back(std::move(effect));

        auto dry = renderOfflineBlock(std::move(dryProject));
        auto wet = renderOfflineBlock(std::move(wetProject));

        double diff = 0.0;
        double wetEnergy = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
                wetEnergy += (double) wetSample * (double) wetSample;
            }
        }

        return diff > 0.01 && wetEnergy >= 0.0;
    }

    bool stressAudioEngineInstrumentEffects()
    {
        auto dryProject = makeTinyOfflineProject();
        auto wetProject = makeTinyOfflineProject();

        beat::TrackEffect saturator;
        saturator.id = "instrument-saturator";
        saturator.kind = beat::TrackEffectKind::Saturator;
        saturator.bypassed = false;
        saturator.params.push_back({ "drive", 70.0f });
        saturator.params.push_back({ "mix", 100.0f });
        wetProject.instruments.front().effects.push_back(std::move(saturator));

        auto dry = renderOfflineBlock(std::move(dryProject));
        auto wet = renderOfflineBlock(std::move(wetProject));

        double diff = 0.0;
        double wetEnergy = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
                wetEnergy += (double) wetSample * (double) wetSample;
            }
        }

        return diff > 0.01 && wetEnergy > 0.000001;
    }

    bool stressAudioEnginePluginEffectPlaceholder()
    {
        auto dryProject = makeTinyOfflineProject();
        auto pluginProject = makeTinyOfflineProject();

        beat::TrackEffect effect;
        effect.id = "future-plugin-effect";
        effect.kind = beat::TrackEffectKind::Plugin;
        effect.pluginId = "plugin-placeholder";
        effect.pluginName = "Unavailable Effect Plugin";
        effect.pluginFormat = "bridge";
        effect.params.push_back({ "mix", 100.0f });
        pluginProject.tracks.front().effects.push_back(std::move(effect));

        auto dry = renderOfflineBlock(std::move(dryProject));
        auto withPlaceholder = renderOfflineBlock(std::move(pluginProject));

        double diff = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float placeholderSample = withPlaceholder.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(placeholderSample))
                    return false;
                diff += std::abs((double) drySample - (double) placeholderSample);
            }
        }

        return diff < 0.000001;
    }

    bool stressAudioEngineEffectLatencyEstimate()
    {
        auto project = makeTinyOfflineProject();

        beat::TrackEffect pluginA;
        pluginA.id = "plugin-latency-a";
        pluginA.kind = beat::TrackEffectKind::Plugin;
        pluginA.pluginId = "bridge-a";
        pluginA.latencySamples = 128;

        beat::TrackEffect pluginB;
        pluginB.id = "plugin-latency-b";
        pluginB.kind = beat::TrackEffectKind::Plugin;
        pluginB.pluginId = "bridge-b";
        pluginB.latencySamples = 0;

        beat::PluginAdapterDefinition bridgeB;
        bridgeB.id = "bridge-b";
        bridgeB.name = "Latency Bridge B";
        bridgeB.kind = "effect";
        bridgeB.format = "bridge";
        bridgeB.status = "installed";
        beat::PluginCapability effectCapability;
        effectCapability.id = "bridge-b-effect";
        effectCapability.kind = "effect";
        effectCapability.label = "Latency effect";
        effectCapability.realtime = true;
        effectCapability.offline = true;
        effectCapability.latencySamples = 256;
        effectCapability.fallbackMode = "pass-through";
        bridgeB.capabilities.push_back(std::move(effectCapability));
        project.plugins.push_back(std::move(bridgeB));

        beat::TrackEffect bypassed;
        bypassed.id = "bypassed-latency";
        bypassed.kind = beat::TrackEffectKind::Plugin;
        bypassed.pluginId = "bridge-c";
        bypassed.latencySamples = 8192;
        bypassed.bypassed = true;

        project.tracks.front().effects.push_back(std::move(pluginA));
        project.tracks.front().effects.push_back(std::move(pluginB));
        project.tracks.front().effects.push_back(std::move(bypassed));

        beat::Track secondTrack;
        secondTrack.id = "latency-track-b";
        secondTrack.name = "Latency Track B";
        secondTrack.kind = beat::TrackKind::Midi;

        beat::TrackEffect pluginC;
        pluginC.id = "plugin-latency-c";
        pluginC.kind = beat::TrackEffectKind::Plugin;
        pluginC.pluginId = "bridge-d";
        pluginC.latencySamples = 64;
        secondTrack.effects.push_back(std::move(pluginC));
        project.tracks.push_back(std::move(secondTrack));

        if (beat::AudioEngine::estimateProjectLatencySamples(project) != 384)
            return false;

        beat::AudioEngine engine;
        engine.prepareForOffline(48000.0, 512, 2);
        engine.applyProject(std::move(project));
        return engine.getProjectLatencySamples() == 384;
    }

    bool stressAudioEngineTransportCommandCoalescing()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(48000.0, 256, 2);
        engine.applyProject(makeTinyOfflineProject());

        juce::AudioBuffer<float> block(2, 256);
        std::array<float*, 2> outputs {
            block.getWritePointer(0),
            block.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;

        for (int i = 0; i < 900; ++i)
        {
            if ((i % 2) == 0)
                engine.requestPlay();
            else
                engine.requestPause();
        }
        block.clear();
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, block.getNumSamples(), context);
        if (engine.sequencer().isPlaying())
            return false;

        engine.requestSeek(3.5);
        engine.requestPlay();
        block.clear();
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, block.getNumSamples(), context);
        if (!engine.sequencer().isPlaying() || std::abs(engine.sequencer().getPosition() - 3.5) > 0.05)
            return false;

        engine.requestRestart();
        engine.requestPause();
        block.clear();
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, block.getNumSamples(), context);
        return !engine.sequencer().isPlaying()
            && engine.sequencer().getPosition() >= 0.0
            && engine.sequencer().getPosition() < 0.05;
    }

    bool stressAudioEngineDeviceSnapshot()
    {
        beat::AudioEngine engine;
        const auto snapshot = engine.listAudioDevices(false);

        std::set<juce::String> seen;
        for (const auto& device : snapshot.devices)
        {
            if (device.typeName.isEmpty() || device.name.isEmpty())
            {
                std::cerr << "Audio device snapshot contains unnamed device\n";
                return false;
            }

            if (!device.input && !device.output)
            {
                std::cerr << "Audio device snapshot contains device with no IO role\n";
                return false;
            }

            const auto key = device.typeName + "\n" + device.name;
            if (seen.count(key) > 0)
            {
                std::cerr << "Audio device snapshot contains duplicate device " << key << "\n";
                return false;
            }
            seen.insert(key);
        }

        return snapshot.sampleRate >= 0.0
            && snapshot.bufferSize >= 0
            && snapshot.inputLatencySamples >= 0
            && snapshot.outputLatencySamples >= 0
            && snapshot.inputChannelNames.size() >= 0
            && snapshot.outputChannelNames.size() >= 0;
    }

    bool stressAudioEngineInputRecordingCapture()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(48000.0, 128, 2);

        juce::String error;
        if (!engine.prepareInputRecording(0.25, 2, &error))
        {
            std::cerr << "Recording prepare failed: " << error << "\n";
            return false;
        }

        juce::AudioBuffer<float> input(2, 128);
        for (int i = 0; i < input.getNumSamples(); ++i)
        {
            const float phase = (float) i / (float) input.getNumSamples();
            input.setSample(0, i, std::sin(phase * juce::MathConstants<float>::twoPi) * 0.45f);
            input.setSample(1, i, (phase * 2.0f - 1.0f) * 0.25f);
        }

        juce::AudioBuffer<float> output(2, 128);
        std::array<const float*, 2> inputs {
            input.getReadPointer(0),
            input.getReadPointer(1),
        };
        std::array<float*, 2> outputs {
            output.getWritePointer(0),
            output.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;

        engine.startInputRecording();
        output.clear();
        engine.audioDeviceIOCallbackWithContext(inputs.data(), (int) inputs.size(), outputs.data(), 2, input.getNumSamples(), context);
        const auto stats = engine.stopInputRecording();
        if (stats.active || stats.overflowed || stats.recordedSamples != input.getNumSamples()
            || stats.channels != 2 || std::abs(stats.sampleRate - 48000.0) > 0.0001)
        {
            std::cerr << "Recording stats mismatch samples=" << stats.recordedSamples
                      << " channels=" << stats.channels
                      << " overflow=" << stats.overflowed << "\n";
            return false;
        }

        auto file = juce::File("/private/tmp").getChildFile("BeatBackendStress-input-recording.wav");
        file.deleteFile();
        if (!engine.writeInputRecordingToWav(file, &error, 24))
        {
            std::cerr << "Recording write failed: " << error << "\n";
            return false;
        }

        const auto captured = readWavPrefix(file, 128);
        const double capturedEnergy = bufferEnergy(captured);
        if (captured.getNumChannels() != 2
            || captured.getNumSamples() != 128
            || !std::isfinite(capturedEnergy)
            || capturedEnergy < 0.1)
        {
            file.deleteFile();
            return false;
        }
        file.deleteFile();

        if (!engine.prepareInputRecording(64.0 / 48000.0, 1, &error))
            return false;

        std::array<const float*, 1> monoInput { input.getReadPointer(0) };
        engine.startInputRecording();
        output.clear();
        engine.audioDeviceIOCallbackWithContext(monoInput.data(), (int) monoInput.size(), outputs.data(), 2, input.getNumSamples(), context);
        const auto overflowStats = engine.stopInputRecording();
        return !overflowStats.active
            && overflowStats.overflowed
            && overflowStats.channels == 1
            && overflowStats.recordedSamples == 64;
    }

    bool stressAudioEngineInputMonitoring()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(48000.0, 128, 2);

        juce::AudioBuffer<float> input(2, 128);
        for (int i = 0; i < input.getNumSamples(); ++i)
        {
            const float phase = (float) i / (float) input.getNumSamples();
            input.setSample(0, i, std::sin(phase * juce::MathConstants<float>::twoPi) * 0.35f);
            input.setSample(1, i, std::cos(phase * juce::MathConstants<float>::twoPi) * 0.25f);
        }

        juce::AudioBuffer<float> output(2, 128);
        std::array<const float*, 2> inputs {
            input.getReadPointer(0),
            input.getReadPointer(1),
        };
        std::array<float*, 2> outputs {
            output.getWritePointer(0),
            output.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;

        output.clear();
        engine.audioDeviceIOCallbackWithContext(inputs.data(), (int) inputs.size(), outputs.data(), 2, output.getNumSamples(), context);
        const double defaultOffEnergy = bufferEnergy(output);
        if (!std::isfinite(defaultOffEnergy) || defaultOffEnergy > 0.000001)
            return false;

        engine.setInputMonitoringEnabled(true, -6.0f);
        if (!engine.isInputMonitoringEnabled())
            return false;

        output.clear();
        engine.audioDeviceIOCallbackWithContext(inputs.data(), (int) inputs.size(), outputs.data(), 2, output.getNumSamples(), context);
        const double monitorEnergy = bufferEnergy(output);

        std::vector<beat::AudioEngine::TrackMeterSnapshot> meters;
        const bool metersOk = engine.pullTrackMeterSnapshots(meters)
            && std::any_of(meters.begin(), meters.end(), [](const auto& meter) {
                return meter.trackId == "master"
                    && meter.sequence > 0
                    && meter.rms > 0.0f
                    && meter.peak > 0.0f
                    && std::isfinite(meter.leftRms)
                    && std::isfinite(meter.rightRms)
                    && std::isfinite(meter.leftPeak)
                    && std::isfinite(meter.rightPeak)
                    && (meter.leftRms > 0.0f
                        || meter.rightRms > 0.0f
                        || meter.leftPeak > 0.0f
                        || meter.rightPeak > 0.0f);
            });

        engine.setInputMonitoringEnabled(false);
        output.clear();
        engine.audioDeviceIOCallbackWithContext(inputs.data(), (int) inputs.size(), outputs.data(), 2, output.getNumSamples(), context);
        const double disabledEnergy = bufferEnergy(output);

        beat::Project monitorProject;
        monitorProject.id = "input-monitor-project";
        monitorProject.name = "Input Monitor Project";
        monitorProject.bpm = 120.0;
        beat::Track monitorTrack;
        monitorTrack.id = "input-monitor-track";
        monitorTrack.name = "Input Monitor Track";
        monitorTrack.kind = beat::TrackKind::Audio;
        monitorTrack.recordArmed = true;
        monitorTrack.inputMonitoring = true;
        monitorTrack.recordGainDb = -6.0f;
        monitorProject.tracks.push_back(monitorTrack);
        engine.applyProject(monitorProject);
        if (!engine.isInputMonitoringEnabled())
            return false;

        output.clear();
        engine.audioDeviceIOCallbackWithContext(inputs.data(), (int) inputs.size(), outputs.data(), 2, output.getNumSamples(), context);
        const double projectMonitorEnergy = bufferEnergy(output);

        monitorProject.tracks.front().inputMonitoring = false;
        engine.applyProject(std::move(monitorProject));
        if (engine.isInputMonitoringEnabled())
            return false;

        const bool ok = std::isfinite(monitorEnergy)
            && monitorEnergy > 0.0001
            && metersOk
            && std::isfinite(disabledEnergy)
            // The master DC blocker retains a bounded sub-audible decay state
            // after monitoring is disabled; it must remain negligible.
            && disabledEnergy < 0.00001
            && std::isfinite(projectMonitorEnergy)
            && projectMonitorEnergy > 0.0001;
        if (!ok)
            std::cerr << "input monitor energy monitor=" << monitorEnergy
                      << " disabled=" << disabledEnergy
                      << " project=" << projectMonitorEnergy
                      << " meters=" << metersOk << "\n";
        return ok;
    }

    beat::Project makePluginLatencyCompensationProject(const juce::File& file)
    {
        beat::Project project;
        project.id = "plugin-latency-comp-project";
        project.name = "Plugin Latency Compensation";
        project.bpm = 120.0;
        project.lengthBeats = 0.5;

        beat::InstrumentDefinition instrument;
        instrument.id = "plugin-latency-sample";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 5.0f;
        instrument.sampleUrls.add(file.getFullPathName());
        project.instruments.push_back(std::move(instrument));

        const auto addTrack = [&](const char* id, bool delayed)
        {
            beat::Track track;
            track.id = id;
            track.name = id;
            track.kind = beat::TrackKind::Midi;
            track.instrumentId = "plugin-latency-sample";

            if (delayed)
            {
                beat::TrackEffect plugin;
                plugin.id = "latency-plugin";
                plugin.kind = beat::TrackEffectKind::Plugin;
                plugin.pluginId = "latency-fixture";
                plugin.pluginName = "Latency Fixture";
                plugin.latencySamples = 512;
                track.effects.push_back(std::move(plugin));
            }

            beat::Segment segment;
            segment.id = juce::String(id) + "-segment";
            segment.trackId = track.id;
            segment.kind = beat::SegmentPayloadKind::Midi;
            segment.instrumentId = "plugin-latency-sample";
            segment.startBeat = 0.0;
            segment.lengthBeats = 0.5;

            beat::MidiNote note;
            note.instrumentId = "plugin-latency-sample";
            note.pitch = 60;
            note.velocity = 120;
            note.startBeat = 0.0;
            note.lengthBeats = 0.25;
            segment.notes.push_back(note);

            track.segments.push_back(segment);
            project.tracks.push_back(std::move(track));
        };

        addTrack("latency-dry-track", false);
        addTrack("latency-plugin-track", true);
        return project;
    }

    bool stressAudioEnginePluginLatencyCompensation()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-plugin-latency.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto rendered = renderOfflineBlock(makePluginLatencyCompensationProject(sampleFile), 4096);
        const double earlyEnergy = bufferWindowEnergy(rendered, 0, 360);
        const double lateEnergy = bufferWindowEnergy(rendered, 900, 900);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(earlyEnergy)
            && std::isfinite(lateEnergy)
            && earlyEnergy < 0.00000001
            && lateEnergy > 0.0001;
        if (!ok)
            std::cerr << "Plugin latency compensation early=" << earlyEnergy
                      << " late=" << lateEnergy << "\n";
        return ok;
    }

    bool stressAudioEngineCompressorEffect()
    {
        auto dryProject = makeTinyOfflineProject();
        auto compressedProject = makeTinyOfflineProject();

        beat::TrackEffect compressor;
        compressor.id = "stress-compressor";
        compressor.kind = beat::TrackEffectKind::Compressor;
        compressor.params.push_back({ "thresholdDb", -36.0f });
        compressor.params.push_back({ "ratio", 12.0f });
        compressor.params.push_back({ "attackMs", 1.0f });
        compressor.params.push_back({ "releaseMs", 60.0f });
        compressor.params.push_back({ "makeupDb", 0.0f });
        compressor.params.push_back({ "mix", 100.0f });
        compressedProject.tracks.front().effects.push_back(std::move(compressor));

        auto dry = renderOfflineBlock(std::move(dryProject));
        auto wet = renderOfflineBlock(std::move(compressedProject));

        double diff = 0.0;
        double wetEnergy = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
                wetEnergy += (double) wetSample * (double) wetSample;
            }
        }

        return diff > 0.01 && wetEnergy > 0.000001;
    }

    bool stressAudioEngineDistortionEffect()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-distortion-continuity.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto dryProject = makeAudioClipOfflineProject(sampleFile);
        auto distortionProject = makeAudioClipOfflineProject(sampleFile);
        dryProject.tracks.front().effects.clear();
        distortionProject.tracks.front().effects.clear();

        beat::TrackEffect distortion;
        distortion.id = "stress-distortion";
        distortion.kind = beat::TrackEffectKind::Distortion;
        distortion.params.push_back({ "drive", 75.0f });
        distortion.params.push_back({ "shape", 65.0f });
        distortion.params.push_back({ "trimDb", 8.0f });
        distortion.params.push_back({ "mix", 80.0f });
        distortionProject.tracks.front().effects.push_back(std::move(distortion));

        auto dry = renderOfflineBlock(std::move(dryProject), 8192);
        auto wet = renderOfflineBlock(distortionProject, 8192);

        double diff = 0.0;
        double wetEnergy = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
                wetEnergy += (double) wetSample * (double) wetSample;
            }
        }

        if (!(diff > 0.001 && wetEnergy > 0.000001))
        {
            sampleFile.deleteFile();
            return false;
        }

        constexpr int samples = 8192;
        auto largeBlock = renderOfflineChunks(distortionProject, samples, 4096);
        auto smallBlock = renderOfflineChunks(distortionProject, samples, 127);
        sampleFile.deleteFile();

        float maxAbsDiff = 0.0f;
        for (int ch = 0; ch < largeBlock.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float largeSample = largeBlock.getSample(ch, i);
                const float smallSample = smallBlock.getSample(ch, i);
                if (!std::isfinite(largeSample) || !std::isfinite(smallSample))
                    return false;
                maxAbsDiff = std::max(maxAbsDiff, std::abs(largeSample - smallSample));
            }
        }

        if (maxAbsDiff > 0.000001f)
        {
            std::cerr << "Distortion chunk continuity failed maxDiff=" << maxAbsDiff << "\n";
            return false;
        }

        {
            beat::AudioEngine engine;
            constexpr int blockSize = 512;
            engine.prepareForOffline(44100.0, blockSize, 2);
            engine.applyProject(distortionProject);
            engine.requestPlay();
            const auto timingBuffer = renderEngineBlock(engine, blockSize);
            if (!std::isfinite(bufferEnergy(timingBuffer)))
                return false;

            beat::AudioEngine::RenderTimingSnapshot timing;
            if (!engine.pullRenderTimingSnapshot(timing))
                return false;

            const int64_t expectedOversampledWork = (int64_t) blockSize * beat::DriveStage::workSamplesForChannels(2);
            if (timing.routeNonlinearEffectSamples < expectedOversampledWork)
            {
                std::cerr << "Distortion nonlinear oversampling counter failed samples="
                          << timing.routeNonlinearEffectSamples
                          << " expected>=" << expectedOversampledWork << "\n";
                return false;
            }
        }
        return true;
    }

    bool stressAudioEngineChorusEffect()
    {
        auto dryProject = makeTinyOfflineProject();
        auto chorusProject = makeTinyOfflineProject();

        beat::TrackEffect chorus;
        chorus.id = "stress-chorus";
        chorus.kind = beat::TrackEffectKind::Chorus;
        chorus.params.push_back({ "rateHz", 1.25f });
        chorus.params.push_back({ "depthMs", 12.0f });
        chorus.params.push_back({ "delayMs", 9.0f });
        chorus.params.push_back({ "feedback", 18.0f });
        chorus.params.push_back({ "mix", 65.0f });
        chorusProject.tracks.front().effects.push_back(std::move(chorus));

        auto dry = renderOfflineBlock(std::move(dryProject), 8192);
        auto wet = renderOfflineBlock(chorusProject, 8192);

        double diff = 0.0;
        double wetEnergy = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
                wetEnergy += (double) wetSample * (double) wetSample;
            }
        }

        if (!(diff > 0.001 && wetEnergy > 0.000001))
            return false;

        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 256, 2);
        engine.applyProject(std::move(chorusProject));
        engine.requestPlay();
        const auto playing = renderEngineBlock(engine, 4096);
        if (!(bufferEnergy(playing) > 0.0001))
            return false;

        engine.requestStop();
        const auto stopped = renderEngineBlock(engine, 4096);
        const double stoppedEnergy = bufferEnergy(stopped);
        return std::isfinite(stoppedEnergy) && stoppedEnergy <= 0.000001;
    }

    bool stressAudioEnginePhaserEffect()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-phaser-continuity.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto dryProject = makeAudioClipOfflineProject(sampleFile);
        auto phaserProject = makeAudioClipOfflineProject(sampleFile);
        dryProject.tracks.front().effects.clear();
        phaserProject.tracks.front().effects.clear();

        beat::TrackEffect phaser;
        phaser.id = "stress-phaser";
        phaser.kind = beat::TrackEffectKind::Phaser;
        phaser.params.push_back({ "rateHz", 0.7f });
        phaser.params.push_back({ "centerHz", 1100.0f });
        phaser.params.push_back({ "depthOct", 2.2f });
        phaser.params.push_back({ "feedback", 42.0f });
        phaser.params.push_back({ "mix", 70.0f });
        phaserProject.tracks.front().effects.push_back(std::move(phaser));

        auto dry = renderOfflineBlock(std::move(dryProject), 8192);
        auto wet = renderOfflineBlock(phaserProject, 8192);

        double diff = 0.0;
        double wetEnergy = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
                wetEnergy += (double) wetSample * (double) wetSample;
            }
        }

        if (!(diff > 0.001 && wetEnergy > 0.000001))
        {
            sampleFile.deleteFile();
            return false;
        }

        constexpr int samples = 8192;
        auto largeBlock = renderOfflineChunks(phaserProject, samples, 4096);
        auto smallBlock = renderOfflineChunks(phaserProject, samples, 127);
        sampleFile.deleteFile();

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        for (int ch = 0; ch < largeBlock.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float largeSample = largeBlock.getSample(ch, i);
                const float smallSample = smallBlock.getSample(ch, i);
                if (!std::isfinite(largeSample) || !std::isfinite(smallSample))
                    return false;

                const float sampleDiff = std::abs(largeSample - smallSample);
                maxAbsDiff = std::max(maxAbsDiff, sampleDiff);
                sumAbsDiff += sampleDiff;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (largeBlock.getNumChannels() * samples);
        const bool ok = maxAbsDiff <= 0.00001f && meanAbsDiff <= 0.000001;
        if (!ok)
        {
            std::cerr << "Phaser chunk continuity failed maxDiff=" << maxAbsDiff
                      << " meanDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineFlangerEffect()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-flanger-continuity.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto dryProject = makeAudioClipOfflineProject(sampleFile);
        auto flangerProject = makeAudioClipOfflineProject(sampleFile);
        dryProject.tracks.front().effects.clear();
        flangerProject.tracks.front().effects.clear();

        beat::TrackEffect flanger;
        flanger.id = "stress-flanger";
        flanger.kind = beat::TrackEffectKind::Flanger;
        flanger.params.push_back({ "rateHz", 0.42f });
        flanger.params.push_back({ "depthMs", 3.4f });
        flanger.params.push_back({ "delayMs", 2.2f });
        flanger.params.push_back({ "feedback", 55.0f });
        flanger.params.push_back({ "mix", 72.0f });
        flangerProject.tracks.front().effects.push_back(std::move(flanger));

        auto dry = renderOfflineBlock(std::move(dryProject), 8192);
        auto wet = renderOfflineBlock(flangerProject, 8192);

        double diff = 0.0;
        double wetEnergy = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
                wetEnergy += (double) wetSample * (double) wetSample;
            }
        }

        if (!(diff > 0.001 && wetEnergy > 0.000001))
        {
            sampleFile.deleteFile();
            return false;
        }

        constexpr int samples = 8192;
        auto largeBlock = renderOfflineChunks(flangerProject, samples, 4096);
        auto smallBlock = renderOfflineChunks(flangerProject, samples, 127);
        sampleFile.deleteFile();

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        for (int ch = 0; ch < largeBlock.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float largeSample = largeBlock.getSample(ch, i);
                const float smallSample = smallBlock.getSample(ch, i);
                if (!std::isfinite(largeSample) || !std::isfinite(smallSample))
                    return false;

                const float sampleDiff = std::abs(largeSample - smallSample);
                maxAbsDiff = std::max(maxAbsDiff, sampleDiff);
                sumAbsDiff += sampleDiff;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (largeBlock.getNumChannels() * samples);
        const bool ok = maxAbsDiff <= 0.00001f && meanAbsDiff <= 0.000001;
        if (!ok)
        {
            std::cerr << "Flanger chunk continuity failed maxDiff=" << maxAbsDiff
                      << " meanDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineBitcrushChunkContinuity()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-bitcrush-continuity.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto project = makeAudioClipOfflineProject(sampleFile);
        project.tracks.front().effects.clear();

        beat::TrackEffect bitcrush;
        bitcrush.id = "chunk-bitcrush";
        bitcrush.kind = beat::TrackEffectKind::Bitcrush;
        bitcrush.params.push_back({ "bits", 5.0f });
        bitcrush.params.push_back({ "rate", 20.0f });
        bitcrush.params.push_back({ "mix", 100.0f });
        project.tracks.front().effects.push_back(std::move(bitcrush));

        constexpr int samples = 8192;
        auto largeBlock = renderOfflineChunks(project, samples, 4096);
        auto smallBlock = renderOfflineChunks(project, samples, 127);
        sampleFile.deleteFile();

        double largeEnergy = 0.0;
        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        for (int ch = 0; ch < largeBlock.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float largeSample = largeBlock.getSample(ch, i);
                const float smallSample = smallBlock.getSample(ch, i);
                if (!std::isfinite(largeSample) || !std::isfinite(smallSample))
                    return false;

                const float diff = std::abs(largeSample - smallSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                largeEnergy += (double) largeSample * (double) largeSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (largeBlock.getNumChannels() * samples);
        const bool ok = largeEnergy > 0.000001
            && maxAbsDiff <= 0.000001f
            && meanAbsDiff <= 0.0000001;
        if (!ok)
        {
            std::cerr << "Bitcrush chunk continuity failed energy=" << largeEnergy
                      << " maxDiff=" << maxAbsDiff
                      << " meanDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineTransportPanicReset()
    {
        auto project = makeTinyOfflineProject();

        beat::TrackEffect delay;
        delay.id = "panic-delay";
        delay.kind = beat::TrackEffectKind::Delay;
        delay.params.push_back({ "timeMs", 180.0f });
        delay.params.push_back({ "feedback", 70.0f });
        delay.params.push_back({ "mix", 70.0f });
        project.tracks.front().effects.push_back(std::move(delay));

        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 256, 2);
        engine.applyProject(project);
        engine.requestPlay();

        const auto playing = renderEngineBlock(engine, 4096);
        const double playingEnergy = bufferEnergy(playing);
        if (!(playingEnergy > 0.0001))
            return false;

        engine.requestStop();
        const auto stopped = renderEngineBlock(engine, 4096);
        const double stoppedEnergy = bufferEnergy(stopped);
        if (!std::isfinite(stoppedEnergy) || stoppedEnergy > 0.000001)
            return false;

        engine.requestRestart();
        const auto restarted = renderEngineBlock(engine, 4096);
        const double restartedEnergy = bufferEnergy(restarted);
        if (!(restartedEnergy > 0.0001))
            return false;

        engine.requestSeek(0.25);
        const auto afterSeek = renderEngineBlock(engine, 4096);
        const double afterSeekEnergy = bufferEnergy(afterSeek);
        return std::isfinite(afterSeekEnergy);
    }

    bool stressAudioEngineApplyProjectRuntimeBoundary()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 256, 2);
        engine.applyProject(makeTinyOfflineProject());
        engine.requestPlay();

        const auto playing = renderEngineBlock(engine, 4096);
        const double playingEnergy = bufferEnergy(playing);
        if (!(std::isfinite(playingEnergy) && playingEnergy > 0.0001))
            return false;

        beat::Project empty;
        empty.id = "empty-runtime-boundary-project";
        empty.name = "Empty Runtime Boundary";
        empty.bpm = 120.0;
        empty.lengthBeats = 4.0;
        engine.applyProject(std::move(empty));

        const auto afterApply = renderEngineBlock(engine, 4096);
        const double afterApplyEnergy = bufferEnergy(afterApply);
        if (!std::isfinite(afterApplyEnergy) || afterApplyEnergy > 0.000001)
            return false;

        return engine.sequencer().isPlaying();
    }

    bool stressAudioEngineEffectGraphTransition()
    {
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 4.0;
        project.tracks.front().segments.front().lengthBeats = 4.0;
        project.tracks.front().segments.front().notes.front().lengthBeats = 3.0;

        beat::TrackEffect lowpass;
        lowpass.id = "graph-lowpass";
        lowpass.kind = beat::TrackEffectKind::Lowpass;
        lowpass.params.push_back({ "cutoffHz", 1800.0f });
        lowpass.params.push_back({ "resonance", 22.0f });
        beat::TrackEffect saturator;
        saturator.id = "graph-saturator";
        saturator.kind = beat::TrackEffectKind::Saturator;
        saturator.params.push_back({ "drive", 64.0f });
        saturator.params.push_back({ "mix", 75.0f });
        project.tracks.front().effects = { lowpass, saturator };

        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 256, 2);
        engine.applyProject(project);
        engine.requestPlay();
        const auto before = renderEngineBlock(engine, 2048);
        const float previousLeft = before.getSample(0, before.getNumSamples() - 1);
        const float previousRight = before.getSample(1, before.getNumSamples() - 1);

        project.tracks.front().effects = { saturator, lowpass };
        project.tracks.front().effects.front().bypassed = true;
        engine.applyProject(project);
        const auto after = renderEngineBlock(engine, 256);
        const float firstLeft = after.getSample(0, 0);
        const float firstRight = after.getSample(1, 0);

        bool finite = true;
        float peak = 0.0f;
        for (int channel = 0; channel < after.getNumChannels(); ++channel)
        {
            for (int sample = 0; sample < after.getNumSamples(); ++sample)
            {
                const float value = after.getSample(channel, sample);
                finite = finite && std::isfinite(value);
                peak = juce::jmax(peak, std::abs(value));
            }
        }

        const float boundaryStep = juce::jmax(std::abs(firstLeft - previousLeft),
                                               std::abs(firstRight - previousRight));
        const bool ok = finite && peak > 0.00001f && boundaryStep < 0.2f;
        if (!ok)
        {
            std::cerr << "Effect graph transition failed previous=" << previousLeft << "," << previousRight
                      << " first=" << firstLeft << "," << firstRight
                      << " boundaryStep=" << boundaryStep << " peak=" << peak << " finite=" << finite << "\n";
        }
        return ok;
    }

    bool stressAudioEngineTransportCommandBurst()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 128, 2);
        engine.applyProject(makeTinyOfflineProject());

        engine.requestPlay();
        for (int i = 0; i < 200; ++i)
        {
            engine.requestSeek((double) (i % 8) * 0.0625);
            if (i % 2 == 0)
                engine.requestPause();
            else
                engine.requestPlay();
        }
        engine.requestSeek(0.5);
        engine.requestPause();
        if (engine.sequencer().isPlaying() || std::abs(engine.sequencer().getPosition() - 0.5) > 0.0001)
            return false;

        const auto paused = renderEngineBlock(engine, 2048);
        const double pausedEnergy = bufferEnergy(paused);
        if (!std::isfinite(pausedEnergy) || pausedEnergy > 0.000001)
            return false;
        if (std::abs(engine.sequencer().getPosition() - 0.5) > 0.0001)
            return false;

        for (int i = 0; i < 200; ++i)
            engine.requestSeek((double) (i % 4) * 0.125);
        engine.requestRestart();
        if (!engine.sequencer().isPlaying() || engine.sequencer().getPosition() > 0.0001)
            return false;

        const auto restarted = renderEngineBlock(engine, 4096);
        const double restartedEnergy = bufferEnergy(restarted);
        return std::isfinite(restartedEnergy) && restartedEnergy > 0.0001 && engine.sequencer().isPlaying();
    }

    bool stressAudioEngineQueuedLoopClampTransport()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 128, 2);
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 16.0;
        engine.applyProject(std::move(project));

        engine.requestLoop(4.0, 8.0);
        engine.requestSeek(9.0);
        engine.requestPlay();
        (void) renderEngineBlock(engine, 256);
        const double beyondEndPosition = engine.sequencer().getPosition();
        if (!(beyondEndPosition > 9.0))
            return false;

        engine.requestSeek(7.99);
        engine.requestPlay();
        (void) renderEngineBlock(engine, 1024);
        const double crossedPosition = engine.sequencer().getPosition();
        if (!(crossedPosition >= 4.0 && crossedPosition < 4.2))
            return false;

        for (int i = 0; i < 160; ++i)
        {
            engine.requestSeek(i % 2 == 0 ? 7.98 : 9.25);
            engine.requestPause();
            engine.requestPlay();
            engine.requestLoop(4.0, 8.0);
        }
        engine.requestSeek(7.99);
        engine.requestPlay();
        (void) renderEngineBlock(engine, 1024);
        const double burstCrossedPosition = engine.sequencer().getPosition();
        return burstCrossedPosition >= 4.0 && burstCrossedPosition < 4.2;
    }

    bool stressAudioEngineAudioClipPlayback()
    {
        auto file = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip.wav");
        if (!writeAudioClipFixture(file))
            return false;

        auto project = makeAudioClipOfflineProject(file);
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 256, 2);
        engine.applyProject(std::move(project));
        engine.requestPlay();

        juce::AudioBuffer<float> buffer(2, 4096);
        buffer.clear();
        std::array<float*, 2> outputs {
            buffer.getWritePointer(0),
            buffer.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, buffer.getNumSamples(), context);

        double energy = 0.0;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(ch, i);
                if (!std::isfinite(sample))
                    return false;
                energy += (double) sample * (double) sample;
            }
        }

        std::vector<beat::AudioEngine::TrackMeterSnapshot> meters;
        if (!engine.pullTrackMeterSnapshots(meters))
            return false;

        bool foundTrack = false;
        for (const auto& meter : meters)
        {
            if (meter.trackId == "audio-clip-track")
            {
                foundTrack = meter.sequence > 0
                    && meter.rms > 0.0f
                    && meter.peak > 0.0f
                    && std::isfinite(meter.leftRms)
                    && std::isfinite(meter.rightRms)
                    && std::isfinite(meter.leftPeak)
                    && std::isfinite(meter.rightPeak)
                    && (meter.leftRms > 0.0f
                        || meter.rightRms > 0.0f
                        || meter.leftPeak > 0.0f
                        || meter.rightPeak > 0.0f);
            }
        }

        file.deleteFile();
        return energy > 0.0001 && foundTrack;
    }

    bool stressAudioEngineTailEffects()
    {
        auto dryProject = makeTinyOfflineProject();
        auto delayProject = makeTinyOfflineProject();
        auto reverbProject = makeTinyOfflineProject();

        beat::TrackEffect delay;
        delay.id = "stress-delay";
        delay.kind = beat::TrackEffectKind::Delay;
        delay.params.push_back({ "timeMs", 12.0f });
        delay.params.push_back({ "feedback", 35.0f });
        delay.params.push_back({ "mix", 50.0f });
        delayProject.tracks.front().effects.push_back(std::move(delay));

        beat::TrackEffect reverb;
        reverb.id = "stress-reverb";
        reverb.kind = beat::TrackEffectKind::Reverb;
        reverb.params.push_back({ "roomSize", 45.0f });
        reverb.params.push_back({ "damping", 30.0f });
        reverb.params.push_back({ "mix", 30.0f });
        reverbProject.tracks.front().effects.push_back(std::move(reverb));

        auto dry = renderOfflineBlock(std::move(dryProject), 8192);
        auto delayed = renderOfflineBlock(std::move(delayProject), 8192);
        auto reverbed = renderOfflineBlock(std::move(reverbProject), 8192);

        double delayDiff = 0.0;
        double reverbDiff = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float delaySample = delayed.getSample(ch, i);
                const float reverbSample = reverbed.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(delaySample) || !std::isfinite(reverbSample))
                    return false;
                delayDiff += std::abs((double) drySample - (double) delaySample);
                reverbDiff += std::abs((double) drySample - (double) reverbSample);
            }
        }

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-delay-tail.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        auto exportProject = makeTinyOfflineProject();
        beat::TrackEffect exportDelay;
        exportDelay.id = "stress-export-delay";
        exportDelay.kind = beat::TrackEffectKind::Delay;
        exportDelay.params.push_back({ "timeMs", 250.0f });
        exportDelay.params.push_back({ "feedback", 40.0f });
        exportDelay.params.push_back({ "mix", 60.0f });
        exportProject.tracks.front().effects.push_back(std::move(exportDelay));

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(std::move(exportProject), exportFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Delay tail export error: " << error << "\n";
            return false;
        }

        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(exportFile));
        const auto expectedDrySamples = (juce::int64) std::ceil(0.5 * 60.0 / 120.0 * 44100.0);
        const bool hasTail = reader != nullptr && reader->lengthInSamples > expectedDrySamples + 1000;
        exportFile.deleteFile();

        return delayDiff > 0.01 && reverbDiff > 0.01 && hasTail;
    }

    bool stressAudioEngineDenormalTailProtection()
    {
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 0.5;

        auto& instrument = project.instruments.front();
        instrument.releaseMs = 5.0f;

        beat::TrackEffect delay;
        delay.id = "denormal-delay";
        delay.kind = beat::TrackEffectKind::Delay;
        delay.params.push_back({ "timeMs", 2.0f });
        delay.params.push_back({ "feedback", 45.0f });
        delay.params.push_back({ "mix", 60.0f });
        project.tracks.front().effects.push_back(std::move(delay));

        const auto rendered = renderOfflineChunks(std::move(project), 196608, 257);
        if (bufferHasSubnormalSamples(rendered))
        {
            std::cerr << "Denormal tail stress found a non-finite or subnormal sample\n";
            return false;
        }

        const double earlyEnergy = bufferWindowEnergy(rendered, 0, 8192);
        const double tailEnergy = bufferWindowEnergy(rendered, rendered.getNumSamples() - 8192, 8192);
        const bool ok = std::isfinite(earlyEnergy)
            && std::isfinite(tailEnergy)
            && earlyEnergy > 0.0001;
        if (!ok)
            std::cerr << "Denormal tail energy early=" << earlyEnergy << " tail=" << tailEnergy << "\n";
        return ok;
    }

    bool stressAudioEngineRouteAutomation()
    {
        auto dryProject = makeTinyOfflineProject();
        auto quietProject = makeTinyOfflineProject();
        auto brightProject = makeTinyOfflineProject();
        auto filteredProject = makeTinyOfflineProject();

        beat::ProjectAutomationLane gainLane;
        gainLane.trackId = "offline-track";
        gainLane.target = "track.gainDb";
        gainLane.points.push_back({ 0.0, -48.0f });
        quietProject.automation.push_back(std::move(gainLane));

        beat::TrackEffect brightFilter;
        brightFilter.id = "route-auto-filter";
        brightFilter.kind = beat::TrackEffectKind::Lowpass;
        brightFilter.params.push_back({ "cutoffHz", 20000.0f });
        brightFilter.params.push_back({ "resonance", 0.0f });
        brightProject.tracks.front().effects.push_back(brightFilter);
        filteredProject.tracks.front().effects.push_back(std::move(brightFilter));

        beat::ProjectAutomationLane filterLane;
        filterLane.trackId = "offline-track";
        filterLane.target = "effect.route-auto-filter.cutoffHz";
        filterLane.points.push_back({ 0.0, 80.0f });
        filteredProject.automation.push_back(std::move(filterLane));

        auto dry = renderOfflineBlock(std::move(dryProject), 4096);
        auto quiet = renderOfflineBlock(std::move(quietProject), 4096);
        auto bright = renderOfflineBlock(std::move(brightProject), 4096);
        auto filtered = renderOfflineBlock(std::move(filteredProject), 4096);

        double dryEnergy = 0.0;
        double quietEnergy = 0.0;
        double filterDiff = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float quietSample = quiet.getSample(ch, i);
                const float brightSample = bright.getSample(ch, i);
                const float filteredSample = filtered.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(quietSample) || !std::isfinite(brightSample) || !std::isfinite(filteredSample))
                    return false;
                dryEnergy += (double) drySample * (double) drySample;
                quietEnergy += (double) quietSample * (double) quietSample;
                filterDiff += std::abs((double) brightSample - (double) filteredSample);
            }
        }

        return dryEnergy > 0.0001
            && quietEnergy < dryEnergy * 0.05
            && filterDiff > 0.01;
    }

    bool stressAudioEngineAutomationBlockSizeStability()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-automation-block-size.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto project = makeAudioClipOfflineProject(sampleFile);
        project.lengthBeats = 2.0;

        beat::ProjectAutomationLane gainLane;
        gainLane.trackId = "audio-clip-track";
        gainLane.target = "track.gainDb";
        gainLane.points.push_back({ 0.0, -18.0f, beat::AutomationCurve::Cubic });
        gainLane.points.push_back({ 1.0, 0.0f, beat::AutomationCurve::Linear });
        project.automation.push_back(std::move(gainLane));

        constexpr int samples = 44100;
        auto smallBlock = renderOfflineChunks(project, samples, 128);
        auto largeBlock = renderOfflineChunks(project, samples, 4096);
        sampleFile.deleteFile();

        double energy = 0.0;
        double absDiff = 0.0;
        float maxDiff = 0.0f;
        for (int ch = 0; ch < smallBlock.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float a = smallBlock.getSample(ch, i);
                const float b = largeBlock.getSample(ch, i);
                if (!std::isfinite(a) || !std::isfinite(b))
                    return false;
                energy += (double) a * (double) a;
                const float diff = std::abs(a - b);
                absDiff += diff;
                maxDiff = std::max(maxDiff, diff);
            }
        }

        const double meanDiff = absDiff / (double) (smallBlock.getNumChannels() * samples);
        const bool ok = energy > 0.0001
            && meanDiff < 0.00002
            && maxDiff < 0.00025f;

        if (!ok)
        {
            std::cerr << "Automation block-size stability failed energy=" << energy
                      << " meanDiff=" << meanDiff
                      << " maxDiff=" << maxDiff << "\n";
        }

        return ok;
    }

    bool stressAudioEngineSampleInstrumentRouting()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-route.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto dryProject = makeSampleInstrumentOfflineProject(sampleFile);
        auto filteredProject = makeSampleInstrumentOfflineProject(sampleFile);
        auto quietProject = makeSampleInstrumentOfflineProject(sampleFile);

        beat::TrackEffect filter;
        filter.id = "sample-route-filter";
        filter.kind = beat::TrackEffectKind::Lowpass;
        filter.params.push_back({ "cutoffHz", 80.0f });
        filter.params.push_back({ "resonance", 0.0f });
        filteredProject.tracks.front().effects.push_back(std::move(filter));

        beat::ProjectAutomationLane gainLane;
        gainLane.trackId = "sample-route-track";
        gainLane.target = "track.gainDb";
        gainLane.points.push_back({ 0.0, -48.0f });
        quietProject.automation.push_back(std::move(gainLane));

        auto dry = renderOfflineBlock(std::move(dryProject), 4096);
        auto filtered = renderOfflineBlock(std::move(filteredProject), 4096);
        auto quiet = renderOfflineBlock(std::move(quietProject), 4096);

        double dryEnergy = 0.0;
        double quietEnergy = 0.0;
        double filterDiff = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float filteredSample = filtered.getSample(ch, i);
                const float quietSample = quiet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(filteredSample) || !std::isfinite(quietSample))
                    return false;
                dryEnergy += (double) drySample * (double) drySample;
                quietEnergy += (double) quietSample * (double) quietSample;
                filterDiff += std::abs((double) drySample - (double) filteredSample);
            }
        }

        sampleFile.deleteFile();
        const bool ok = dryEnergy > 0.0001
            && quietEnergy < dryEnergy * 0.05
            && filterDiff > 0.01;
        if (!ok)
            std::cerr << "Sample route dryEnergy=" << dryEnergy
                      << " quietEnergy=" << quietEnergy
                      << " filterDiff=" << filterDiff << "\n";
        return ok;
    }

    bool stressAudioEngineSampleZonesAndRelease()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-zone.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto lowVelocity = renderOfflineBlock(makeSampleZoneOfflineProject(sampleFile, 48, 0.25f), 8192);
        auto highVelocity = renderOfflineBlock(makeSampleZoneOfflineProject(sampleFile, 112, 0.25f), 8192);
        auto shortNote = renderOfflineBlock(makeSampleZoneOfflineProject(sampleFile, 112, 0.05f), 12000);

        const double lowEnergy = bufferEnergy(lowVelocity);
        const double highEnergy = bufferEnergy(highVelocity);
        const double earlyEnergy = bufferWindowEnergy(shortNote, 0, 1400);
        const double lateEnergy = bufferWindowEnergy(shortNote, 7000, 2000);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(lowEnergy)
            && std::isfinite(highEnergy)
            && std::isfinite(earlyEnergy)
            && std::isfinite(lateEnergy)
            && lowEnergy > 0.000001
            && highEnergy > lowEnergy * 25.0
            && earlyEnergy > 0.0001
            && lateEnergy < earlyEnergy * 0.001;
        if (!ok)
            std::cerr << "Sample zone/release lowEnergy=" << lowEnergy
                      << " highEnergy=" << highEnergy
                      << " earlyEnergy=" << earlyEnergy
                      << " lateEnergy=" << lateEnergy << "\n";
        return ok;
    }

    bool stressAudioEngineSampleZoneDirectPathLoading()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-zone-direct.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto project = makeSampleZoneOfflineProject(sampleFile, 112, 0.25f);
        project.instruments.front().sampleUrls.clear();

        auto rendered = renderOfflineBlock(std::move(project), 8192);
        const double energy = bufferEnergy(rendered);
        const float peak = bufferPeak(rendered);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(energy)
            && std::isfinite(peak)
            && energy > 0.0001
            && peak > 0.001f;
        if (!ok)
            std::cerr << "Sample zone direct path loading energy=" << energy
                      << " peak=" << peak << "\n";
        return ok;
    }

    bool stressAudioEngineSampleZoneStartEndSlicing()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-zone-offset.wav");
        if (!writeSampleZoneOffsetFixture(sampleFile))
            return false;

        auto full = renderOfflineBlock(makeSampleZoneOffsetProject(sampleFile, 0, 0), 4096);
        auto sliced = renderOfflineBlock(makeSampleZoneOffsetProject(sampleFile, 2048, 3072), 4096);

        const double fullEarlyEnergy = bufferWindowEnergy(full, 0, 512);
        const double slicedEarlyEnergy = bufferWindowEnergy(sliced, 0, 512);
        const double slicedLateEnergy = bufferWindowEnergy(sliced, 1800, 512);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(fullEarlyEnergy)
            && std::isfinite(slicedEarlyEnergy)
            && std::isfinite(slicedLateEnergy)
            && fullEarlyEnergy > 0.000001
            && slicedEarlyEnergy > fullEarlyEnergy * 100.0
            && slicedLateEnergy < slicedEarlyEnergy * 0.2;
        if (!ok)
            std::cerr << "Sample zone start/end slicing fullEarly=" << fullEarlyEnergy
                      << " slicedEarly=" << slicedEarlyEnergy
                      << " slicedLate=" << slicedLateEnergy << "\n";
        return ok;
    }

    bool stressAudioEngineSampleZoneLengthSelection()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-zone-length.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto shortNote = renderOfflineBlock(makeSampleZoneLengthProject(sampleFile, 0.08f), 12000);
        auto longNote = renderOfflineBlock(makeSampleZoneLengthProject(sampleFile, 1.0f), 24000);

        const double shortEnergy = bufferEnergy(shortNote);
        const double longEnergy = bufferEnergy(longNote);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(shortEnergy)
            && std::isfinite(longEnergy)
            && shortEnergy > 0.00000001
            && longEnergy > shortEnergy * 80.0;
        if (!ok)
            std::cerr << "Sample zone length selection shortEnergy=" << shortEnergy
                      << " longEnergy=" << longEnergy << "\n";
        return ok;
    }

    bool stressAudioEngineSampleZoneMultiVariableSelection()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-zone-multi-variable.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto lowShort = renderOfflineBlock(makeSampleZoneMultiVariableProject(sampleFile, 48, 0.08f), 12000);
        auto highShort = renderOfflineBlock(makeSampleZoneMultiVariableProject(sampleFile, 112, 0.08f), 12000);
        auto lowLong = renderOfflineBlock(makeSampleZoneMultiVariableProject(sampleFile, 48, 1.0f), 24000);
        auto highLong = renderOfflineBlock(makeSampleZoneMultiVariableProject(sampleFile, 112, 1.0f), 24000);

        const double lowShortEnergy = bufferEnergy(lowShort);
        const double highShortEnergy = bufferEnergy(highShort);
        const double lowLongEnergy = bufferEnergy(lowLong);
        const double highLongEnergy = bufferEnergy(highLong);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(lowShortEnergy)
            && std::isfinite(highShortEnergy)
            && std::isfinite(lowLongEnergy)
            && std::isfinite(highLongEnergy)
            && lowShortEnergy > 0.000000001
            && highShortEnergy > lowShortEnergy * 8.0
            && lowLongEnergy > highShortEnergy * 8.0
            && highLongEnergy > lowLongEnergy * 8.0;
        if (!ok)
            std::cerr << "Sample zone multi-variable selection lowShort=" << lowShortEnergy
                      << " highShort=" << highShortEnergy
                      << " lowLong=" << lowLongEnergy
                      << " highLong=" << highLongEnergy << "\n";
        return ok;
    }

    bool stressProjectAssetSidecarPackaging()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-assets-" + juce::Uuid().toString());
        const auto sourceFolder = root.getChildFile("source");
        const auto projectFile = root.getChildFile("Portable Project.beat");
        const auto audioFile = sourceFolder.getChildFile("Loop Source.wav");
        const auto sampleFile = sourceFolder.getChildFile("Snare Hit.wav");
        const auto pluginFile = sourceFolder.getChildFile("Kit Plugin.dspreset");

        if (!root.createDirectory()
            || !sourceFolder.createDirectory()
            || !audioFile.replaceWithText("audio-fixture")
            || !sampleFile.replaceWithText("sample-fixture")
            || !pluginFile.replaceWithText("plugin-fixture"))
        {
            std::cerr << "Could not create project asset packaging fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        juce::DynamicObject::Ptr audio = new juce::DynamicObject();
        audio->setProperty("id", "audio-1");
        audio->setProperty("name", "Loop Source");
        audio->setProperty("path", audioFile.getFullPathName());

        juce::DynamicObject::Ptr zone = new juce::DynamicObject();
        zone->setProperty("path", sampleFile.getFullPathName());
        zone->setProperty("sampleUrl", sampleFile.getFullPathName());
        zone->setProperty("rootNote", 64);
        zone->setProperty("loNote", 60);
        zone->setProperty("hiNote", 67);
        zone->setProperty("loVel", 24);
        zone->setProperty("hiVel", 96);
        zone->setProperty("volumeDb", -3.5);
        zone->setProperty("pan", 0.25);
        zone->setProperty("tuning", -12.0);
        zone->setProperty("seqPosition", 2);
        zone->setProperty("durationSeconds", 0.42);
        zone->setProperty("loLengthSeconds", 0.12);
        zone->setProperty("hiLengthSeconds", 0.66);
        zone->setProperty("startSample", 128);
        zone->setProperty("endSample", 2048);

        juce::Array<juce::var> sampleUrls;
        sampleUrls.add(sampleFile.getFullPathName());
        juce::Array<juce::var> sampleMap;
        sampleMap.add(juce::var(zone.get()));

        juce::DynamicObject::Ptr instrument = new juce::DynamicObject();
        instrument->setProperty("id", "sample-inst");
        instrument->setProperty("name", "Sample Inst");
        instrument->setProperty("sampleUrl", sampleFile.getFullPathName());
        instrument->setProperty("sampleUrls", sampleUrls);
        instrument->setProperty("sampleMap", sampleMap);
        juce::Array<juce::var> sampleIds;
        sampleIds.add("audio-1");
        instrument->setProperty("sampleIds", sampleIds);

        juce::DynamicObject::Ptr plugin = new juce::DynamicObject();
        plugin->setProperty("id", "plugin-1");
        plugin->setProperty("name", "Kit Plugin");
        plugin->setProperty("format", "decent-sampler");
        plugin->setProperty("sourcePath", pluginFile.getFullPathName());
        plugin->setProperty("sourceFileName", pluginFile.getFileName());

        juce::DynamicObject::Ptr audioPayload = new juce::DynamicObject();
        audioPayload->setProperty("kind", "audio");
        audioPayload->setProperty("audioFileId", "audio-1");
        audioPayload->setProperty("gainDb", -1.0);

        juce::DynamicObject::Ptr segment = new juce::DynamicObject();
        segment->setProperty("id", "segment-audio-1");
        segment->setProperty("trackId", "track-audio-1");
        segment->setProperty("name", "Audio Clip");
        segment->setProperty("payload", juce::var(audioPayload.get()));

        juce::Array<juce::var> segments;
        segments.add(juce::var(segment.get()));

        juce::DynamicObject::Ptr track = new juce::DynamicObject();
        track->setProperty("id", "track-audio-1");
        track->setProperty("name", "Audio Track");
        track->setProperty("kind", "audio");
        track->setProperty("audioFileId", "audio-1");
        track->setProperty("segments", segments);

        juce::Array<juce::var> tracks;
        tracks.add(juce::var(track.get()));

        juce::DynamicObject::Ptr project = new juce::DynamicObject();
        project->setProperty("id", "project-asset-packaging");
        project->setProperty("name", "Asset Packaging");
        project->setProperty("tracks", tracks);

        const auto makeAsset = [](const juce::String& id,
                                  const juce::String& kind,
                                  const juce::String& path,
                                  const juce::String& policy)
        {
            juce::DynamicObject::Ptr asset = new juce::DynamicObject();
            asset->setProperty("id", id);
            asset->setProperty("kind", kind);
            asset->setProperty("path", path);
            asset->setProperty("policy", policy);
            asset->setProperty("references", juce::Array<juce::var> {});
            return juce::var(asset.get());
        };

        juce::Array<juce::var> assets;
        assets.add(makeAsset("audio-asset", "audio", audioFile.getFullPathName(), "external"));
        assets.add(makeAsset("sample-asset", "sample", sampleFile.getFullPathName(), "external"));
        assets.add(makeAsset("plugin-asset", "plugin", pluginFile.getFullPathName(), "plugin"));
        assets.add(makeAsset("factory-asset", "sample", "/samples/factory.wav", "bundled"));

        juce::Array<juce::var> audioFiles;
        audioFiles.add(juce::var(audio.get()));
        juce::Array<juce::var> instruments;
        instruments.add(juce::var(instrument.get()));
        juce::Array<juce::var> plugins;
        plugins.add(juce::var(plugin.get()));

        juce::DynamicObject::Ptr documentObject = new juce::DynamicObject();
        documentObject->setProperty("schemaVersion", 1);
        documentObject->setProperty("project", juce::var(project.get()));
        documentObject->setProperty("audioFiles", audioFiles);
        documentObject->setProperty("instruments", instruments);
        documentObject->setProperty("plugins", plugins);
        documentObject->setProperty("assets", assets);
        juce::var document(documentObject.get());

        auto repairDocument = juce::JSON::parse(juce::JSON::toString(document));
        const bool manifestChanged = beat::rebuildDocumentAssetManifest(repairDocument);
        const auto repairedAssets = repairDocument.getProperty("assets", {});
        const auto* repairedAssetArray = repairedAssets.getArray();
        bool manifestRepairOk = manifestChanged && repairedAssetArray != nullptr && repairedAssetArray->size() == 3;
        if (manifestRepairOk)
        {
            const auto audioAsset = repairedAssetArray->getReference(0);
            const auto pluginAsset = repairedAssetArray->getReference(1);
            const auto sampleAsset = repairedAssetArray->getReference(2);
            const auto* audioRefs = audioAsset.getProperty("references", {}).getArray();
            const auto* pluginRefs = pluginAsset.getProperty("references", {}).getArray();
            const auto* sampleRefs = sampleAsset.getProperty("references", {}).getArray();
            manifestRepairOk =
                audioAsset.getProperty("kind", {}).toString() == "audio"
                && audioAsset.getProperty("path", {}).toString() == audioFile.getFullPathName()
                && audioRefs != nullptr
                && audioRefs->size() == 4
                && audioRefs->contains("audioFile:audio-1")
                && audioRefs->contains("track:track-audio-1:audioFileId")
                && audioRefs->contains("track:track-audio-1:segment:segment-audio-1:audioFileId")
                && audioRefs->contains("instrument:sample-inst:sampleIds:0")
                && pluginAsset.getProperty("kind", {}).toString() == "plugin"
                && pluginAsset.getProperty("path", {}).toString() == pluginFile.getFullPathName()
                && pluginAsset.getProperty("policy", {}).toString() == "plugin"
                && pluginRefs != nullptr
                && pluginRefs->size() == 1
                && pluginRefs->contains("plugin:plugin-1:sourcePath")
                && sampleAsset.getProperty("kind", {}).toString() == "sample"
                && sampleAsset.getProperty("path", {}).toString() == sampleFile.getFullPathName()
                && sampleRefs != nullptr
                && sampleRefs->size() == 3
                && sampleRefs->contains("instrument:sample-inst:sampleUrl")
                && sampleRefs->contains("instrument:sample-inst:sampleUrls:0")
                && sampleRefs->contains("instrument:sample-inst:sampleMap:0");
        }

        const auto managedRoot = beat::projectSidecarFolderFor(projectFile)
            .getChildFile("sfz").getChildFile("sfz-packaging-fixture");
        const auto managedManifest = managedRoot.getChildFile("manifest.json");
        const auto managedSource = managedRoot.getChildFile("source.sfz");
        const auto managedSample = managedRoot.getChildFile("samples").getChildFile("tone.wav");
        if (!managedSample.getParentDirectory().createDirectory()
            || !managedManifest.replaceWithText("managed-manifest")
            || !managedSource.replaceWithText("managed-source")
            || !managedSample.replaceWithText("managed-sample"))
        {
            root.deleteRecursively();
            return false;
        }
        juce::DynamicObject::Ptr managed = new juce::DynamicObject();
        managed->setProperty("schemaVersion", 1);
        managed->setProperty("assetId", "sfz-packaging-fixture");
        managed->setProperty("displayName", "Packaging Fixture");
        managed->setProperty("manifestPath", managedManifest.getFullPathName());
        managed->setProperty("sourcePath", managedSource.getFullPathName());
        managed->setProperty("samplePaths", juce::Array<juce::var> { managedSample.getFullPathName() });
        juce::DynamicObject::Ptr slot = new juce::DynamicObject();
        slot->setProperty("managedSfz", juce::var(managed.get()));
        juce::DynamicObject::Ptr aether = new juce::DynamicObject();
        aether->setProperty("sampleSlot1", juce::var(slot.get()));
        instrument->setProperty("aether", juce::var(aether.get()));
        if (auto* documentAssets = document.getProperty("assets", {}).getArray())
        {
            documentAssets->add(makeAsset("managed-manifest", "sample",
                                          managedManifest.getFullPathName(), "bundled"));
            documentAssets->add(makeAsset("managed-source", "sample",
                                          managedSource.getFullPathName(), "bundled"));
            documentAssets->add(makeAsset("managed-sample", "sample",
                                          managedSample.getFullPathName(), "bundled"));
        }

        juce::String error;
        const bool packaged = beat::packageExternalDocumentAssets(document, projectFile, error);
        if (!packaged)
        {
            std::cerr << "Project asset packaging failed: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        const auto packagedAudioPath = document.getProperty("audioFiles", {})[0].getProperty("path", {}).toString();
        const auto packagedSamplePath = document.getProperty("instruments", {})[0].getProperty("sampleUrl", {}).toString();
        const auto packagedSampleUrl = document.getProperty("instruments", {})[0].getProperty("sampleUrls", {})[0].toString();
        const auto packagedZone = document.getProperty("instruments", {})[0].getProperty("sampleMap", {})[0];
        const auto packagedZonePath = packagedZone.getProperty("path", {}).toString();
        const auto packagedPluginPath = document.getProperty("plugins", {})[0].getProperty("sourcePath", {}).toString();
        const auto packagedPluginAssetPath = document.getProperty("assets", {})[2].getProperty("path", {}).toString();
        const auto packagedBundledAssetPath = document.getProperty("assets", {})[3].getProperty("path", {}).toString();
        const auto packagedManaged = document.getProperty("instruments", {})[0]
            .getProperty("aether", {}).getProperty("sampleSlot1", {}).getProperty("managedSfz", {});

        const bool relativePathsOk = packagedAudioPath.startsWith("./")
            && packagedSamplePath.startsWith("./")
            && packagedSampleUrl == packagedSamplePath
            && packagedZonePath == packagedSamplePath
            && packagedPluginPath == pluginFile.getFullPathName()
            && packagedPluginAssetPath == pluginFile.getFullPathName()
            && packagedBundledAssetPath == "/samples/factory.wav"
            && packagedManaged.getProperty("manifestPath", {}).toString().startsWith("./Portable Project Assets/sfz/")
            && packagedManaged.getProperty("sourcePath", {}).toString().startsWith("./Portable Project Assets/sfz/")
            && packagedManaged.getProperty("samplePaths", {})[0].toString().startsWith("./Portable Project Assets/sfz/");

        const auto copiedAudio = projectFile.getParentDirectory().getChildFile(packagedAudioPath);
        const auto copiedSample = projectFile.getParentDirectory().getChildFile(packagedSamplePath);
        const auto pluginSidecarFolder = beat::projectSidecarFolderFor(projectFile).getChildFile("plugins");
        const bool copiedOk = copiedAudio.existsAsFile()
            && copiedSample.existsAsFile()
            && copiedAudio.loadFileAsString() == "audio-fixture"
            && copiedSample.loadFileAsString() == "sample-fixture"
            && !pluginSidecarFolder.exists();

        beat::resolveDocumentAssetPaths(document, projectFile);
        const auto resolvedAudioPath = document.getProperty("audioFiles", {})[0].getProperty("path", {}).toString();
        const auto resolvedSamplePath = document.getProperty("instruments", {})[0].getProperty("sampleUrl", {}).toString();
        const auto resolvedManaged = document.getProperty("instruments", {})[0]
            .getProperty("aether", {}).getProperty("sampleSlot1", {}).getProperty("managedSfz", {});
        const bool resolvedOk = resolvedAudioPath.startsWith(root.getFullPathName())
            && resolvedSamplePath.startsWith(root.getFullPathName())
            && juce::File(resolvedAudioPath).existsAsFile()
            && juce::File(resolvedSamplePath).existsAsFile()
            && juce::File(resolvedManaged.getProperty("manifestPath", {}).toString()).existsAsFile()
            && juce::File(resolvedManaged.getProperty("sourcePath", {}).toString()).existsAsFile()
            && juce::File(resolvedManaged.getProperty("samplePaths", {})[0].toString()).existsAsFile();
        const auto resolvedZone = document.getProperty("instruments", {})[0].getProperty("sampleMap", {})[0];
        const bool zoneMetadataOk =
            (int) resolvedZone.getProperty("rootNote", -1) == 64
            && (int) resolvedZone.getProperty("loNote", -1) == 60
            && (int) resolvedZone.getProperty("hiNote", -1) == 67
            && (int) resolvedZone.getProperty("loVel", -1) == 24
            && (int) resolvedZone.getProperty("hiVel", -1) == 96
            && std::abs((double) resolvedZone.getProperty("volumeDb", 0.0) - -3.5) < 0.0001
            && std::abs((double) resolvedZone.getProperty("pan", 0.0) - 0.25) < 0.0001
            && std::abs((double) resolvedZone.getProperty("tuning", 0.0) - -12.0) < 0.0001
            && (int) resolvedZone.getProperty("seqPosition", -1) == 2
            && std::abs((double) resolvedZone.getProperty("durationSeconds", 0.0) - 0.42) < 0.0001
            && std::abs((double) resolvedZone.getProperty("loLengthSeconds", 0.0) - 0.12) < 0.0001
            && std::abs((double) resolvedZone.getProperty("hiLengthSeconds", 0.0) - 0.66) < 0.0001
            && (int) resolvedZone.getProperty("startSample", -1) == 128
            && (int) resolvedZone.getProperty("endSample", -1) == 2048;

        root.deleteRecursively();
        const bool ok = manifestRepairOk && relativePathsOk && copiedOk && resolvedOk && zoneMetadataOk;
        if (!ok)
        {
            std::cerr << "Project asset sidecar packaging manifestRepair=" << manifestRepairOk
                      << " relative=" << relativePathsOk
                      << " copied=" << copiedOk
                      << " resolved=" << resolvedOk
                      << " zoneMetadata=" << zoneMetadataOk
                      << " managedManifest=" << packagedManaged.getProperty("manifestPath", {}).toString()
                      << " managedSource=" << packagedManaged.getProperty("sourcePath", {}).toString()
                      << " managedSample=" << packagedManaged.getProperty("samplePaths", {})[0].toString()
                      << "\n";
        }
        return ok;
    }

    bool reportContainsIssueCode(const beat::ProjectIntegrityReport& report,
                                 const juce::String& code,
                                 beat::ProjectIntegritySeverity severity)
    {
        for (const auto& issue : report.issues)
            if (issue.code == code && issue.severity == severity)
                return true;
        return false;
    }

    bool stressProjectIntegrityVerifier()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-integrity-" + juce::Uuid().toString());
        const auto sourceFolder = root.getChildFile("source");
        const auto projectFile = root.getChildFile("Integrity Project.beat");
        const auto audioFile = sourceFolder.getChildFile("Loop.wav");
        const auto sampleFile = sourceFolder.getChildFile("Hit.wav");

        if (!root.createDirectory()
            || !sourceFolder.createDirectory()
            || !audioFile.replaceWithText("audio-fixture")
            || !sampleFile.replaceWithText("sample-fixture"))
        {
            std::cerr << "Could not create project integrity fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        const auto makeAsset = [](const juce::String& id,
                                  const juce::String& kind,
                                  const juce::String& path,
                                  const juce::String& policy)
        {
            juce::DynamicObject::Ptr asset = new juce::DynamicObject();
            asset->setProperty("id", id);
            asset->setProperty("kind", kind);
            asset->setProperty("path", path);
            asset->setProperty("policy", policy);
            asset->setProperty("references", juce::Array<juce::var> {});
            return juce::var(asset.get());
        };

        juce::DynamicObject::Ptr audio = new juce::DynamicObject();
        audio->setProperty("id", "audio-1");
        audio->setProperty("name", "Loop");
        audio->setProperty("path", audioFile.getFullPathName());

        juce::DynamicObject::Ptr zone = new juce::DynamicObject();
        zone->setProperty("path", sampleFile.getFullPathName());
        zone->setProperty("sampleUrl", sampleFile.getFullPathName());
        zone->setProperty("rootNote", 60);
        zone->setProperty("loNote", 0);
        zone->setProperty("hiNote", 127);
        zone->setProperty("loVel", 0);
        zone->setProperty("hiVel", 127);

        juce::Array<juce::var> sampleUrls;
        sampleUrls.add(sampleFile.getFullPathName());
        juce::Array<juce::var> sampleMap;
        sampleMap.add(juce::var(zone.get()));

        juce::DynamicObject::Ptr instrument = new juce::DynamicObject();
        instrument->setProperty("id", "sample-inst");
        instrument->setProperty("name", "Sample Inst");
        instrument->setProperty("sampleUrl", sampleFile.getFullPathName());
        instrument->setProperty("sampleUrls", sampleUrls);
        instrument->setProperty("sampleMap", sampleMap);

        juce::DynamicObject::Ptr payload = new juce::DynamicObject();
        payload->setProperty("kind", "audio");
        payload->setProperty("audioFileId", "audio-1");
        payload->setProperty("gainDb", 0.0);

        juce::DynamicObject::Ptr segment = new juce::DynamicObject();
        segment->setProperty("id", "segment-1");
        segment->setProperty("trackId", "track-1");
        segment->setProperty("instrumentId", "sample-inst");
        segment->setProperty("startBeat", 0.0);
        segment->setProperty("lengthBeats", 4.0);
        segment->setProperty("repeats", 0);
        segment->setProperty("payload", juce::var(payload.get()));

        juce::Array<juce::var> segments;
        segments.add(juce::var(segment.get()));

        juce::DynamicObject::Ptr track = new juce::DynamicObject();
        track->setProperty("id", "track-1");
        track->setProperty("name", "Track");
        track->setProperty("kind", "mixed");
        track->setProperty("instrumentId", "sample-inst");
        track->setProperty("segments", segments);

        juce::Array<juce::var> tracks;
        tracks.add(juce::var(track.get()));

        juce::DynamicObject::Ptr project = new juce::DynamicObject();
        project->setProperty("id", "project-1");
        project->setProperty("name", "Integrity Project");
        project->setProperty("bpm", 120.0);
        project->setProperty("lengthBeats", 16.0);
        project->setProperty("tracks", tracks);

        juce::Array<juce::var> assets;
        assets.add(makeAsset("audio-asset", "audio", audioFile.getFullPathName(), "external"));
        assets.add(makeAsset("sample-asset", "sample", sampleFile.getFullPathName(), "external"));

        juce::Array<juce::var> audioFiles;
        audioFiles.add(juce::var(audio.get()));
        juce::Array<juce::var> instruments;
        instruments.add(juce::var(instrument.get()));

        juce::DynamicObject::Ptr plugin = new juce::DynamicObject();
        plugin->setProperty("id", "decent-plugin");
        plugin->setProperty("name", "Decent Plugin");
        plugin->setProperty("format", "decent-sampler");
        plugin->setProperty("associatedInstrumentId", "sample-inst");
        juce::Array<juce::var> plugins;
        plugins.add(juce::var(plugin.get()));

        juce::DynamicObject::Ptr documentObject = new juce::DynamicObject();
        documentObject->setProperty("schemaVersion", 1);
        documentObject->setProperty("project", juce::var(project.get()));
        documentObject->setProperty("audioFiles", audioFiles);
        documentObject->setProperty("instruments", instruments);
        documentObject->setProperty("plugins", plugins);
        documentObject->setProperty("assets", assets);
        juce::var document(documentObject.get());

        juce::String error;
        if (!beat::packageExternalDocumentAssets(document, projectFile, error))
        {
            std::cerr << "Project asset packaging failed for integrity fixture: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        const auto cleanReport = beat::verifyProjectDocumentIntegrity(document, projectFile);
        if (!cleanReport.ok() || beat::hasFatalProjectDocumentIntegrityErrors(cleanReport))
        {
            std::cerr << "Clean project integrity fixture failed with "
                      << cleanReport.errorCount() << " errors and "
                      << cleanReport.warningCount() << " warnings\n";
            root.deleteRecursively();
            return false;
        }

        auto badPluginDocument = juce::JSON::parse(juce::JSON::toString(document));
        auto badPlugins = badPluginDocument.getProperty("plugins", {});
        if (auto* badPluginArray = badPlugins.getArray())
        {
            if (!badPluginArray->isEmpty())
            {
                if (auto* badPlugin = badPluginArray->getReference(0).getDynamicObject())
                    badPlugin->setProperty("associatedInstrumentId", "missing-sampler");
            }
        }
        const auto badPluginReport = beat::verifyProjectDocumentIntegrity(badPluginDocument, projectFile);
        if (!reportContainsIssueCode(badPluginReport,
                                     "plugin.instrument.missing",
                                     beat::ProjectIntegritySeverity::Warning)
            || beat::hasFatalProjectDocumentIntegrityErrors(badPluginReport))
        {
            std::cerr << "Missing plugin sampler instrument was not reported by integrity verifier\n";
            root.deleteRecursively();
            return false;
        }

        auto duplicateIdDocument = juce::JSON::parse(juce::JSON::toString(document));
        auto duplicateTracks = duplicateIdDocument.getProperty("project", {}).getProperty("tracks", {});
        if (auto* duplicateTrackArray = duplicateTracks.getArray())
        {
            juce::DynamicObject::Ptr duplicateTrack = new juce::DynamicObject();
            duplicateTrack->setProperty("id", "track-1");
            duplicateTrack->setProperty("name", "Duplicate Track");
            duplicateTrack->setProperty("kind", "mixed");
            duplicateTrack->setProperty("segments", juce::Array<juce::var> {});
            duplicateTrackArray->add(juce::var(duplicateTrack.get()));
        }
        const auto duplicateIdReport = beat::verifyProjectDocumentIntegrity(duplicateIdDocument, projectFile);
        if (!reportContainsIssueCode(duplicateIdReport,
                                     "track.id.duplicate",
                                     beat::ProjectIntegritySeverity::Error)
            || !beat::hasFatalProjectDocumentIntegrityErrors(duplicateIdReport))
        {
            std::cerr << "Duplicate track id was not reported by integrity verifier\n";
            root.deleteRecursively();
            return false;
        }

        auto badRecordingDocument = juce::JSON::parse(juce::JSON::toString(document));
        auto badRecordingProject = badRecordingDocument.getProperty("project", {});
        if (auto* badRecordingProjectObject = badRecordingProject.getDynamicObject())
        {
            juce::DynamicObject::Ptr recordingInput = new juce::DynamicObject();
            recordingInput->setProperty("inputChannelStart", -1);
            recordingInput->setProperty("inputChannelCount", 0);
            recordingInput->setProperty("measuredRoundTripSamples", 512);
            recordingInput->setProperty("reportedInputLatencySamples", -4);
            recordingInput->setProperty("reportedOutputLatencySamples", 128);
            badRecordingProjectObject->setProperty("recordingInput", juce::var(recordingInput.get()));

            auto recordingTracks = badRecordingProjectObject->getProperty("tracks");
            if (auto* recordingTrackArray = recordingTracks.getArray())
            {
                if (!recordingTrackArray->isEmpty())
                {
                    if (auto* recordingTrack = recordingTrackArray->getReference(0).getDynamicObject())
                    {
                        recordingTrack->setProperty("recordArmed", true);
                        recordingTrack->setProperty("inputMonitoring", true);
                        recordingTrack->setProperty("inputChannelStart", -1);
                        recordingTrack->setProperty("inputChannelCount", 0);
                    }
                }
            }
        }

        const auto badRecordingReport = beat::verifyProjectDocumentIntegrity(badRecordingDocument, projectFile);
        if (!reportContainsIssueCode(badRecordingReport,
                                     "recording.input.channels.invalid",
                                     beat::ProjectIntegritySeverity::Warning)
            || !reportContainsIssueCode(badRecordingReport,
                                        "recording.calibration.sampleRate.missing",
                                        beat::ProjectIntegritySeverity::Warning)
            || !reportContainsIssueCode(badRecordingReport,
                                        "recording.calibration.latency.invalid",
                                        beat::ProjectIntegritySeverity::Warning)
            || !reportContainsIssueCode(badRecordingReport,
                                        "track.recording.channels.invalid",
                                        beat::ProjectIntegritySeverity::Warning)
            || beat::hasFatalProjectDocumentIntegrityErrors(badRecordingReport))
        {
            std::cerr << "Bad recording metadata was not reported by integrity verifier\n";
            root.deleteRecursively();
            return false;
        }

        auto badGraphDocument = juce::JSON::parse(juce::JSON::toString(document));
        auto badTracks = badGraphDocument.getProperty("project", {}).getProperty("tracks", {});
        if (auto* badTrackArray = badTracks.getArray())
        {
            if (!badTrackArray->isEmpty())
            {
                auto badSegments = badTrackArray->getReference(0).getProperty("segments", {});
                if (auto* badSegmentArray = badSegments.getArray())
                {
                    if (!badSegmentArray->isEmpty())
                    {
                        if (auto* badSegment = badSegmentArray->getReference(0).getDynamicObject())
                        {
                            badSegment->setProperty("trackId", "missing-track");
                            badSegment->setProperty("startBeat", -0.25);
                            badSegment->setProperty("lengthBeats", -1.0);

                            auto badPayload = badSegment->getProperty("payload");
                            if (auto* badPayloadObject = badPayload.getDynamicObject())
                                badPayloadObject->setProperty("audioFileId", "missing-audio");
                        }
                    }
                }
            }
        }
        const auto badGraphReport = beat::verifyProjectDocumentIntegrity(badGraphDocument, projectFile);
        const bool badGraphOk = reportContainsIssueCode(badGraphReport,
                                                        "segment.trackId.mismatch",
                                                        beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badGraphReport,
                                       "segment.start.invalid",
                                       beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badGraphReport,
                                       "segment.length.invalid",
                                       beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badGraphReport,
                                       "segment.audioFile.missing",
                                       beat::ProjectIntegritySeverity::Error)
            && beat::hasFatalProjectDocumentIntegrityErrors(badGraphReport);
        if (!badGraphOk)
        {
            std::cerr << "Bad segment graph was not fully reported by integrity verifier errors="
                      << badGraphReport.errorCount()
                      << " warnings=" << badGraphReport.warningCount() << "\n";
            root.deleteRecursively();
            return false;
        }

        auto badGroupDocument = juce::JSON::parse(juce::JSON::toString(document));
        auto badGroupTracks = badGroupDocument.getProperty("project", {}).getProperty("tracks", {});
        if (auto* badGroupTrackArray = badGroupTracks.getArray())
        {
            if (!badGroupTrackArray->isEmpty())
            {
                if (auto* firstTrack = badGroupTrackArray->getReference(0).getDynamicObject())
                    firstTrack->setProperty("parentTrackId", "track-1");
            }

            juce::DynamicObject::Ptr childOfNonGroup = new juce::DynamicObject();
            childOfNonGroup->setProperty("id", "child-non-group");
            childOfNonGroup->setProperty("name", "Child Non Group");
            childOfNonGroup->setProperty("kind", "mixed");
            childOfNonGroup->setProperty("parentTrackId", "track-1");
            childOfNonGroup->setProperty("segments", juce::Array<juce::var> {});
            badGroupTrackArray->add(juce::var(childOfNonGroup.get()));

            juce::DynamicObject::Ptr childMissing = new juce::DynamicObject();
            childMissing->setProperty("id", "child-missing");
            childMissing->setProperty("name", "Child Missing");
            childMissing->setProperty("kind", "mixed");
            childMissing->setProperty("parentTrackId", "missing-group");
            childMissing->setProperty("segments", juce::Array<juce::var> {});
            badGroupTrackArray->add(juce::var(childMissing.get()));

            juce::DynamicObject::Ptr groupA = new juce::DynamicObject();
            groupA->setProperty("id", "group-a");
            groupA->setProperty("name", "Group A");
            groupA->setProperty("kind", "group");
            groupA->setProperty("parentTrackId", "group-b");
            groupA->setProperty("segments", juce::Array<juce::var> {});
            badGroupTrackArray->add(juce::var(groupA.get()));

            juce::DynamicObject::Ptr groupB = new juce::DynamicObject();
            groupB->setProperty("id", "group-b");
            groupB->setProperty("name", "Group B");
            groupB->setProperty("kind", "group");
            groupB->setProperty("parentTrackId", "group-a");
            groupB->setProperty("segments", juce::Array<juce::var> {});
            badGroupTrackArray->add(juce::var(groupB.get()));
        }
        const auto badGroupReport = beat::verifyProjectDocumentIntegrity(badGroupDocument, projectFile);
        const bool badGroupOk = reportContainsIssueCode(badGroupReport,
                                                        "track.parent.self",
                                                        beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badGroupReport,
                                       "track.parent.notGroup",
                                       beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badGroupReport,
                                       "track.parent.missing",
                                       beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badGroupReport,
                                       "track.parent.cycle",
                                       beat::ProjectIntegritySeverity::Error)
            && beat::hasFatalProjectDocumentIntegrityErrors(badGroupReport);
        if (!badGroupOk)
        {
            std::cerr << "Bad group routing graph was not reported by integrity verifier errors="
                      << badGroupReport.errorCount()
                      << " warnings=" << badGroupReport.warningCount() << "\n";
            root.deleteRecursively();
            return false;
        }

        auto badSendDocument = juce::JSON::parse(juce::JSON::toString(document));
        if (auto* badSendProject = badSendDocument.getProperty("project", {}).getDynamicObject())
        {
            juce::DynamicObject::Ptr returnBus = new juce::DynamicObject();
            returnBus->setProperty("id", "return-1");
            returnBus->setProperty("name", "Return 1");
            returnBus->setProperty("gainDb", 0.0);
            returnBus->setProperty("pan", 0.0);
            returnBus->setProperty("mute", false);
            juce::DynamicObject::Ptr returnEffects = new juce::DynamicObject();
            returnEffects->setProperty("filters", juce::Array<juce::var> {});
            returnBus->setProperty("effects", juce::var(returnEffects.get()));
            juce::Array<juce::var> returnBuses;
            returnBuses.add(juce::var(returnBus.get()));
            badSendProject->setProperty("returnBuses", returnBuses);

            if (auto* badSendTracks = badSendProject->getProperty("tracks").getArray())
            {
                if (!badSendTracks->isEmpty())
                {
                    auto firstTrack = badSendTracks->getReference(0);
                    if (auto* firstTrackObject = firstTrack.getDynamicObject())
                    {
                        const auto makeSend = [](const juce::String& busId, double gainDb, double pan)
                        {
                            juce::DynamicObject::Ptr send = new juce::DynamicObject();
                            send->setProperty("busId", busId);
                            send->setProperty("gainDb", gainDb);
                            send->setProperty("pan", pan);
                            send->setProperty("enabled", true);
                            return juce::var(send.get());
                        };

                        juce::Array<juce::var> sends;
                        sends.add(makeSend("missing-return", -12.0, 0.0));
                        sends.add(makeSend("return-1", -9.0, 0.0));
                        sends.add(makeSend("return-1", 48.0, 2.0));
                        firstTrackObject->setProperty("sends", sends);
                    }
                }
            }
        }
        const auto badSendReport = beat::verifyProjectDocumentIntegrity(badSendDocument, projectFile);
        const bool badSendOk = reportContainsIssueCode(badSendReport,
                                                       "track.send.bus.missing",
                                                       beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badSendReport,
                                       "track.send.bus.duplicate",
                                       beat::ProjectIntegritySeverity::Warning)
            && reportContainsIssueCode(badSendReport,
                                       "track.send.gain.invalid",
                                       beat::ProjectIntegritySeverity::Warning)
            && reportContainsIssueCode(badSendReport,
                                       "track.send.pan.invalid",
                                       beat::ProjectIntegritySeverity::Warning)
            && beat::hasFatalProjectDocumentIntegrityErrors(badSendReport);
        if (!badSendOk)
        {
            std::cerr << "Bad return-send routing was not reported by integrity verifier errors="
                      << badSendReport.errorCount()
                      << " warnings=" << badSendReport.warningCount() << "\n";
            root.deleteRecursively();
            return false;
        }

        auto invalidSendsDocument = juce::JSON::parse(juce::JSON::toString(document));
        if (auto* invalidSendsProject = invalidSendsDocument.getProperty("project", {}).getDynamicObject())
        {
            if (auto* invalidSendsTracks = invalidSendsProject->getProperty("tracks").getArray())
            {
                if (!invalidSendsTracks->isEmpty())
                {
                    auto firstTrack = invalidSendsTracks->getReference(0);
                    if (auto* firstTrackObject = firstTrack.getDynamicObject())
                        firstTrackObject->setProperty("sends", "invalid");
                }
            }
        }
        const auto invalidSendsReport = beat::verifyProjectDocumentIntegrity(invalidSendsDocument, projectFile);
        if (!reportContainsIssueCode(invalidSendsReport,
                                     "track.sends.invalid",
                                     beat::ProjectIntegritySeverity::Error))
        {
            std::cerr << "Invalid track sends were not reported by integrity verifier\n";
            root.deleteRecursively();
            return false;
        }

        auto badFreezeDocument = juce::JSON::parse(juce::JSON::toString(document));
        if (auto* badFreezeProject = badFreezeDocument.getProperty("project", {}).getDynamicObject())
        {
            if (auto* badFreezeTracks = badFreezeProject->getProperty("tracks").getArray())
            {
                if (!badFreezeTracks->isEmpty())
                {
                    auto firstTrack = badFreezeTracks->getReference(0);
                    if (auto* firstTrackObject = firstTrack.getDynamicObject())
                    {
                        firstTrackObject->setProperty("audioFileId", "missing-freeze-audio");
                        juce::DynamicObject::Ptr freezeSource = new juce::DynamicObject();
                        freezeSource->setProperty("sourceTrackId", "missing-freeze-source");
                        freezeSource->setProperty("audioFileId", "different-missing-freeze-audio");
                        freezeSource->setProperty("segmentId", "missing-freeze-segment");
                        freezeSource->setProperty("sourceMute", false);
                        freezeSource->setProperty("sourceSolo", false);
                        firstTrackObject->setProperty("freezeSource", juce::var(freezeSource.get()));
                    }

                    juce::DynamicObject::Ptr invalidFreezeTrack = new juce::DynamicObject();
                    invalidFreezeTrack->setProperty("id", "invalid-freeze-track");
                    invalidFreezeTrack->setProperty("name", "Invalid Freeze Track");
                    invalidFreezeTrack->setProperty("kind", "audio");
                    invalidFreezeTrack->setProperty("segments", juce::Array<juce::var> {});
                    invalidFreezeTrack->setProperty("freezeSource", "invalid");
                    badFreezeTracks->add(juce::var(invalidFreezeTrack.get()));
                }
            }
        }
        const auto badFreezeReport = beat::verifyProjectDocumentIntegrity(badFreezeDocument, projectFile);
        const bool badFreezeOk = reportContainsIssueCode(badFreezeReport,
                                                         "track.freezeSource.source.missing",
                                                         beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badFreezeReport,
                                       "track.freezeSource.audio.missing",
                                       beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badFreezeReport,
                                       "track.freezeSource.audio.mismatch",
                                       beat::ProjectIntegritySeverity::Warning)
            && reportContainsIssueCode(badFreezeReport,
                                       "track.freezeSource.segment.missing",
                                       beat::ProjectIntegritySeverity::Warning)
            && reportContainsIssueCode(badFreezeReport,
                                       "track.freezeSource.invalid",
                                       beat::ProjectIntegritySeverity::Error)
            && beat::hasFatalProjectDocumentIntegrityErrors(badFreezeReport);
        if (!badFreezeOk)
        {
            std::cerr << "Bad frozen bounce metadata was not reported by integrity verifier errors="
                      << badFreezeReport.errorCount()
                      << " warnings=" << badFreezeReport.warningCount() << "\n";
            root.deleteRecursively();
            return false;
        }

        auto audioTimingDocument = juce::JSON::parse(juce::JSON::toString(document));
        auto audioTimingFiles = audioTimingDocument.getProperty("audioFiles", {});
        if (auto* audioTimingFileArray = audioTimingFiles.getArray())
        {
            if (!audioTimingFileArray->isEmpty())
            {
                if (auto* audioObject = audioTimingFileArray->getReference(0).getDynamicObject())
                {
                    audioObject->setProperty("durationSeconds", 1.0);
                    audioObject->setProperty("sampleRate", 44100.0);
                }
            }
        }
        auto audioTimingTracks = audioTimingDocument.getProperty("project", {}).getProperty("tracks", {});
        if (auto* audioTimingTrackArray = audioTimingTracks.getArray())
        {
            if (!audioTimingTrackArray->isEmpty())
            {
                auto audioTimingSegments = audioTimingTrackArray->getReference(0).getProperty("segments", {});
                if (auto* audioTimingSegmentArray = audioTimingSegments.getArray())
                {
                    if (!audioTimingSegmentArray->isEmpty())
                    {
                        if (auto* audioTimingSegment = audioTimingSegmentArray->getReference(0).getDynamicObject())
                        {
                            audioTimingSegment->setProperty("sourceStartBeat", 1.5);
                            audioTimingSegment->setProperty("lengthBeats", 1.0);
                            audioTimingSegment->setProperty("fadeInBeats", 0.75);
                            audioTimingSegment->setProperty("fadeOutBeats", 0.75);
                        }
                    }
                }
            }
        }
        const auto audioTimingReport = beat::verifyProjectDocumentIntegrity(audioTimingDocument, projectFile);
        const bool audioTimingOk = audioTimingReport.ok()
            && reportContainsIssueCode(audioTimingReport,
                                       "segment.audio.trim.exceedsSource",
                                       beat::ProjectIntegritySeverity::Warning)
            && reportContainsIssueCode(audioTimingReport,
                                       "segment.fade.exceedsLength",
                                       beat::ProjectIntegritySeverity::Warning);
        if (!audioTimingOk)
        {
            std::cerr << "Audio segment timing warnings were not reported errors="
                      << audioTimingReport.errorCount()
                      << " warnings=" << audioTimingReport.warningCount() << "\n";
            root.deleteRecursively();
            return false;
        }

        auto audioSourceOutDocument = juce::JSON::parse(juce::JSON::toString(audioTimingDocument));
        auto audioSourceOutTracks = audioSourceOutDocument.getProperty("project", {}).getProperty("tracks", {});
        if (auto* audioSourceOutTrackArray = audioSourceOutTracks.getArray())
        {
            if (!audioSourceOutTrackArray->isEmpty())
            {
                auto audioSourceOutSegments = audioSourceOutTrackArray->getReference(0).getProperty("segments", {});
                if (auto* audioSourceOutSegmentArray = audioSourceOutSegments.getArray())
                {
                    if (!audioSourceOutSegmentArray->isEmpty())
                    {
                        if (auto* audioSourceOutSegment = audioSourceOutSegmentArray->getReference(0).getDynamicObject())
                        {
                            audioSourceOutSegment->setProperty("sourceStartBeat", 2.1);
                            audioSourceOutSegment->setProperty("fadeInBeats", 0.0);
                            audioSourceOutSegment->setProperty("fadeOutBeats", 0.0);
                        }
                    }
                }
            }
        }
        const auto audioSourceOutReport = beat::verifyProjectDocumentIntegrity(audioSourceOutDocument, projectFile);
        if (!reportContainsIssueCode(audioSourceOutReport,
                                     "segment.audio.sourceStart.outOfRange",
                                     beat::ProjectIntegritySeverity::Error)
            || !beat::hasFatalProjectDocumentIntegrityErrors(audioSourceOutReport))
        {
            std::cerr << "Out-of-range audio source start was not reported\n";
            root.deleteRecursively();
            return false;
        }

        auto trackIdRepairDocument = juce::JSON::parse(juce::JSON::toString(document));
        auto repairTracks = trackIdRepairDocument.getProperty("project", {}).getProperty("tracks", {});
        if (auto* repairTrackArray = repairTracks.getArray())
        {
            if (!repairTrackArray->isEmpty())
            {
                auto repairSegments = repairTrackArray->getReference(0).getProperty("segments", {});
                if (auto* repairSegmentArray = repairSegments.getArray())
                {
                    if (!repairSegmentArray->isEmpty())
                        if (auto* repairSegment = repairSegmentArray->getReference(0).getDynamicObject())
                            repairSegment->setProperty("trackId", "stale-track-id");
                }
            }
        }

        const auto trackIdRepairBefore = beat::verifyProjectDocumentIntegrity(trackIdRepairDocument, projectFile);
        const bool repairedTrackIds = beat::repairProjectDocumentSegmentTrackIds(trackIdRepairDocument);
        const auto trackIdRepairAfter = beat::verifyProjectDocumentIntegrity(trackIdRepairDocument, projectFile);
        if (!reportContainsIssueCode(trackIdRepairBefore,
                                     "segment.trackId.mismatch",
                                     beat::ProjectIntegritySeverity::Error)
            || !beat::hasFatalProjectDocumentIntegrityErrors(trackIdRepairBefore)
            || !repairedTrackIds
            || !trackIdRepairAfter.ok()
            || beat::hasFatalProjectDocumentIntegrityErrors(trackIdRepairAfter))
        {
            std::cerr << "Segment trackId repair failed beforeErrors="
                      << trackIdRepairBefore.errorCount()
                      << " afterErrors=" << trackIdRepairAfter.errorCount()
                      << " repaired=" << repairedTrackIds << "\n";
            root.deleteRecursively();
            return false;
        }

        const auto packagedSamplePath = document.getProperty("instruments", {})[0]
            .getProperty("sampleUrl", {})
            .toString();
        const auto packagedSampleFile = projectFile.getParentDirectory().getChildFile(packagedSamplePath);
        packagedSampleFile.deleteFile();

        const auto missingReport = beat::verifyProjectDocumentIntegrity(document, projectFile);
        if (missingReport.ok()
            || !reportContainsIssueCode(missingReport,
                                        "asset.missing",
                                        beat::ProjectIntegritySeverity::Error)
            || beat::hasFatalProjectDocumentIntegrityErrors(missingReport))
        {
            std::cerr << "Missing project asset was not reported by integrity verifier\n";
            root.deleteRecursively();
            return false;
        }

        if (!sampleFile.copyFileTo(packagedSampleFile))
        {
            std::cerr << "Could not restore packaged sample fixture\n";
            root.deleteRecursively();
            return false;
        }

        const auto orphan = beat::projectSidecarFolderFor(projectFile)
            .getChildFile("samples")
            .getChildFile("orphan.wav");
        if (!orphan.getParentDirectory().createDirectory()
            || !orphan.replaceWithText("orphan"))
        {
            std::cerr << "Could not create sidecar orphan fixture\n";
            root.deleteRecursively();
            return false;
        }

        const auto orphanReport = beat::verifyProjectDocumentIntegrity(document, projectFile);
        bool ok = orphanReport.ok()
            && reportContainsIssueCode(orphanReport,
                                       "asset.sidecar.orphan",
                                       beat::ProjectIntegritySeverity::Warning);

        if (ok)
        {
            const auto cleanup = beat::cleanupUnusedProjectSidecarAssets(document, projectFile);
            const auto cleanedReport = beat::verifyProjectDocumentIntegrity(document, projectFile);
            ok = cleanup.ok()
                && cleanup.deletedFiles == 1
                && !orphan.existsAsFile()
                && packagedSampleFile.existsAsFile()
                && cleanedReport.ok()
                && !reportContainsIssueCode(cleanedReport,
                                            "asset.sidecar.orphan",
                                            beat::ProjectIntegritySeverity::Warning);
            if (!ok)
            {
                std::cerr << "Sidecar cleanup failed deleted=" << cleanup.deletedFiles
                          << " failed=" << cleanup.failedFiles
                          << " orphanExists=" << orphan.existsAsFile()
                          << " sampleExists=" << packagedSampleFile.existsAsFile()
                          << " cleanedWarnings=" << cleanedReport.warningCount() << "\n";
            }
        }

        if (!ok)
        {
            std::cerr << "Sidecar orphan report failed with errors="
                      << orphanReport.errorCount()
                      << " warnings=" << orphanReport.warningCount() << "\n";
        }

        root.deleteRecursively();
        return ok;
    }

    bool stressAudioFileLibraryDeletePolicy()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-audio-delete-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("audio-delete.sqlite");
        const auto managedLibrary = root.getChildFile("Managed Audio");
        const auto externalFolder = root.getChildFile("External Audio");
        const auto managedDeleteFile = managedLibrary.getChildFile("Managed Delete.wav");
        const auto managedKeepFile = managedLibrary.getChildFile("Managed Keep.wav");
        const auto externalFile = externalFolder.getChildFile("External.wav");

        if (!managedLibrary.createDirectory()
            || !externalFolder.createDirectory()
            || !managedDeleteFile.replaceWithText("managed-delete")
            || !managedKeepFile.replaceWithText("managed-keep")
            || !externalFile.replaceWithText("external"))
        {
            std::cerr << "Could not create audio delete fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::Database db(dbFile);
        {
            beat::Statement stmt(db, R"sql(
                INSERT INTO audio_files(id, name, path, duration_s, sample_rate, bit_depth, size_bytes, imported_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)
            )sql");
            stmt.bind(1, "managed-delete");
            stmt.bind(2, "Managed Delete");
            stmt.bind(3, managedDeleteFile.getFullPathName());
            stmt.bind(4, 1.0);
            stmt.bind(5, 48000);
            stmt.bind(6, 24);
            stmt.bind(7, (double) managedDeleteFile.getSize());
            stmt.bind(8, 1000.0);
            stmt.bind(9, "external-delete");
            stmt.bind(10, "External Delete");
            stmt.bind(11, externalFile.getFullPathName());
            stmt.bind(12, 1.0);
            stmt.bind(13, 48000);
            stmt.bind(14, 24);
            stmt.bind(15, (double) externalFile.getSize());
            stmt.bind(16, 1000.0);
            stmt.bind(17, "managed-keep");
            stmt.bind(18, "Managed Keep");
            stmt.bind(19, managedKeepFile.getFullPathName());
            stmt.bind(20, 1.0);
            stmt.bind(21, 48000);
            stmt.bind(22, 24);
            stmt.bind(23, (double) managedKeepFile.getSize());
            stmt.bind(24, 1000.0);
            stmt.step();
        }

        juce::StringArray deleteIds;
        deleteIds.add("managed-delete");
        deleteIds.add("external-delete");
        deleteIds.add("missing-delete");
        const auto deleteResult = beat::deleteAudioFileLibraryEntries(db, deleteIds, true, managedLibrary);

        juce::StringArray removeOnlyIds;
        removeOnlyIds.add("managed-keep");
        const auto removeOnlyResult = beat::deleteAudioFileLibraryEntries(db, removeOnlyIds, false, managedLibrary);

        int remainingRows = -1;
        {
            beat::Statement count(db, "SELECT COUNT(*) FROM audio_files");
            if (count.step())
                remainingRows = count.columnInt(0);
        }

        const bool ok = deleteResult.deletedIds.size() == 2
            && deleteResult.deletedIds.contains("managed-delete")
            && deleteResult.deletedIds.contains("external-delete")
            && deleteResult.failedIds.size() == 1
            && deleteResult.failedIds.contains("missing-delete")
            && deleteResult.failedPaths.isEmpty()
            && removeOnlyResult.deletedIds.size() == 1
            && removeOnlyResult.deletedIds.contains("managed-keep")
            && removeOnlyResult.failedIds.isEmpty()
            && !managedDeleteFile.existsAsFile()
            && externalFile.existsAsFile()
            && managedKeepFile.existsAsFile()
            && remainingRows == 0;

        if (!ok)
        {
            std::cerr << "Audio file delete policy stress failed"
                      << " deleted=" << deleteResult.deletedIds.joinIntoString(",")
                      << " failed=" << deleteResult.failedIds.joinIntoString(",")
                      << " failedPaths=" << deleteResult.failedPaths.joinIntoString(",")
                      << " removeOnly=" << removeOnlyResult.deletedIds.joinIntoString(",")
                      << " managedDeleteExists=" << managedDeleteFile.existsAsFile()
                      << " managedKeepExists=" << managedKeepFile.existsAsFile()
                      << " externalExists=" << externalFile.existsAsFile()
                      << " rows=" << remainingRows
                      << "\n";
        }

        root.deleteRecursively();
        return ok;
    }

    bool stressRecentProjectRepository()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-recents-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("recents.sqlite");
        const auto firstFile = root.getChildFile("First.beat");
        const auto secondFile = root.getChildFile("Second.beat");
        const auto missingPath = root.getChildFile("Missing.beat").getFullPathName();

        if (!root.createDirectory()
            || !firstFile.replaceWithText("{}")
            || !secondFile.replaceWithText("{}"))
        {
            std::cerr << "Could not create recent project fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::Database db(dbFile);
        beat::ProjectRepository repo(db);

        {
            beat::Statement stmt(db, R"sql(
                INSERT INTO recent_projects(path, name, opened_at, size_bytes)
                VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)
            )sql");
            stmt.bind(1, firstFile.getFullPathName());
            stmt.bind(2, "First");
            stmt.bind(3, 100);
            stmt.bind(4, (double) firstFile.getSize());
            stmt.bind(5, missingPath);
            stmt.bind(6, "Missing");
            stmt.bind(7, 1710000001);
            stmt.bind(8, 0.0);
            stmt.bind(9, secondFile.getFullPathName());
            stmt.bind(10, "Second");
            stmt.bind(11, (double) 1710000002000LL);
            stmt.bind(12, (double) secondFile.getSize());
            stmt.step();
        }

        const auto recents = repo.listRecentProjects();
        const bool orderOk = recents.size() == 3
            && recents[0].path == secondFile.getFullPathName()
            && recents[1].path == missingPath
            && recents[2].path == firstFile.getFullPathName();
        const bool existenceOk = orderOk
            && recents[0].exists
            && !recents[1].exists
            && recents[2].exists;
        const bool legacyTimestampOk = orderOk
            && recents[0].openedAt == 1710000002000LL
            && recents[1].openedAt == 1710000001000LL
            && recents[2].openedAt == 0;

        repo.removeRecentProject(missingPath);
        const auto afterRemove = repo.listRecentProjects();
        const bool removeOk = afterRemove.size() == 2
            && afterRemove[0].path == secondFile.getFullPathName()
            && afterRemove[1].path == firstFile.getFullPathName();

        juce::DynamicObject::Ptr project = new juce::DynamicObject();
        project->setProperty("name", "Named From Document");
        juce::DynamicObject::Ptr document = new juce::DynamicObject();
        document->setProperty("project", juce::var(project.get()));
        repo.recordRecentProject(firstFile, juce::var(document.get()));
        const auto afterRecord = repo.listRecentProjects();
        const bool recordOk = !afterRecord.empty()
            && afterRecord.front().path == firstFile.getFullPathName()
            && afterRecord.front().name == "Named From Document"
            && afterRecord.front().sizeBytes == (double) firstFile.getSize()
            && afterRecord.front().openedAt > 1000000000000LL;

        root.deleteRecursively();
        const bool ok = orderOk && existenceOk && legacyTimestampOk && removeOk && recordOk;
        if (!ok)
        {
            std::cerr << "Recent project repository stress failed order=" << orderOk
                      << " existence=" << existenceOk
                      << " legacyTimestamp=" << legacyTimestampOk
                      << " remove=" << removeOk
                      << " record=" << recordOk << "\n";
        }
        return ok;
    }

    bool stressProjectRepositoryPluginCapabilities()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-plugin-capabilities-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("projects.sqlite");

        if (!root.createDirectory())
        {
            std::cerr << "Could not create plugin capability fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::Project project;
        project.id = "plugin-capability-project";
        project.name = "Plugin Capability Project";
        project.bpm = 128.0;

        beat::PluginAdapterDefinition adapter;
        adapter.id = "adapter-aether-bridge";
        adapter.name = "Aether Bridge Host";
        adapter.vendor = "Beat";
        adapter.version = "0.2.0";
        adapter.kind = "synth";
        adapter.format = "bridge";
        adapter.status = "available";
        adapter.instrumentMode = "fallback-aether";
        adapter.description = "Fallback-capable protected synth adapter.";
        adapter.sourceFileName = "Lorenzos Drums V1.dspreset";
        adapter.sourcePath = "/tmp/Lorenzos Drums V1.dspreset";
        adapter.uiImagePath = "/tmp/Resources/bg_lorenzodrums.png";
        adapter.uiImageDataUrl = "data:image/png;base64,beatdsui";
        adapter.associatedInstrumentId = "lorenzos-drums-sampler";
        adapter.uiWidth = 812;
        adapter.uiHeight = 375;
        adapter.sampleCount = 192;
        adapter.uiControlCount = 9;
        adapter.factory = true;
        adapter.installedAt = 123456.0;

        beat::PluginCapability instrumentCapability;
        instrumentCapability.id = "aether-fallback-instrument";
        instrumentCapability.kind = "instrument";
        instrumentCapability.label = "Create Aether-backed instrument";
        instrumentCapability.realtime = true;
        instrumentCapability.offline = true;
        instrumentCapability.latencySamples = 0;
        instrumentCapability.fallbackMode = "aether";
        adapter.capabilities.push_back(std::move(instrumentCapability));

        beat::PluginCapability effectCapability;
        effectCapability.id = "bridge-effect-placeholder";
        effectCapability.kind = "effect";
        effectCapability.label = "Preserve effect placeholder";
        effectCapability.realtime = false;
        effectCapability.offline = true;
        effectCapability.latencySamples = 512;
        effectCapability.fallbackMode = "pass-through";
        adapter.capabilities.push_back(std::move(effectCapability));
        project.plugins.push_back(std::move(adapter));

        beat::Database db(dbFile);
        beat::ProjectRepository repo(db);
        repo.save(project);

        const auto loaded = repo.load(project.id);
        bool ok = loaded.has_value()
            && loaded->plugins.size() == 1
            && loaded->plugins.front().id == "adapter-aether-bridge"
            && loaded->plugins.front().sourceFileName == "Lorenzos Drums V1.dspreset"
            && loaded->plugins.front().sourcePath == "/tmp/Lorenzos Drums V1.dspreset"
            && loaded->plugins.front().uiImagePath == "/tmp/Resources/bg_lorenzodrums.png"
            && loaded->plugins.front().uiImageDataUrl == "data:image/png;base64,beatdsui"
            && loaded->plugins.front().associatedInstrumentId == "lorenzos-drums-sampler"
            && loaded->plugins.front().uiWidth == 812
            && loaded->plugins.front().uiHeight == 375
            && loaded->plugins.front().sampleCount == 192
            && loaded->plugins.front().uiControlCount == 9
            && loaded->plugins.front().factory
            && loaded->plugins.front().capabilities.size() == 2
            && loaded->plugins.front().capabilities.front().kind == "instrument"
            && loaded->plugins.front().capabilities.front().realtime
            && loaded->plugins.front().capabilities.front().offline
            && loaded->plugins.front().capabilities.front().fallbackMode == "aether"
            && loaded->plugins.front().capabilities.back().kind == "effect"
            && !loaded->plugins.front().capabilities.back().realtime
            && loaded->plugins.front().capabilities.back().offline
            && loaded->plugins.front().capabilities.back().latencySamples == 512
            && loaded->plugins.front().capabilities.back().fallbackMode == "pass-through";

        root.deleteRecursively();
        if (!ok)
        {
            std::cerr << "Project repository plugin capability roundtrip failed"
                      << " loaded=" << loaded.has_value()
                      << " pluginCount=" << (loaded ? (int) loaded->plugins.size() : -1)
                      << "\n";
        }
        return ok;
    }

    bool stressProjectRepositoryEffectDefaultsMigration()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-effect-defaults-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("projects.sqlite");

        if (!root.createDirectory())
        {
            std::cerr << "Could not create effect defaults fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::Project project;
        project.id = "effect-defaults-project";
        project.name = "Effect Defaults";

        beat::TrackEffect trackReverb;
        trackReverb.id = "legacy-track-reverb";
        trackReverb.kind = beat::TrackEffectKind::Reverb;
        trackReverb.schemaVersion = 0;
        trackReverb.params.push_back({ "mix", 33.0f });

        beat::TrackEffect returnDelay;
        returnDelay.id = "legacy-return-delay";
        returnDelay.kind = beat::TrackEffectKind::Delay;
        returnDelay.schemaVersion = 0;
        returnDelay.params.push_back({ "feedback", 44.0f });

        beat::TrackEffect instrumentDistortion;
        instrumentDistortion.id = "legacy-instrument-distortion";
        instrumentDistortion.kind = beat::TrackEffectKind::Distortion;
        instrumentDistortion.schemaVersion = 0;
        instrumentDistortion.params.push_back({ "drive", 77.0f });

        beat::Track track;
        track.id = "fx-track";
        track.name = "FX Track";
        track.effects.push_back(std::move(trackReverb));
        project.tracks.push_back(std::move(track));

        beat::ReturnBus bus;
        bus.id = "fx-return";
        bus.name = "FX Return";
        bus.effects.push_back(std::move(returnDelay));
        project.returnBuses.push_back(std::move(bus));

        beat::InstrumentDefinition instrument;
        instrument.id = "fx-instrument";
        instrument.kind = "synth";
        instrument.effects.push_back(std::move(instrumentDistortion));
        project.instruments.push_back(std::move(instrument));

        beat::Database db(dbFile);
        beat::ProjectRepository repo(db);
        repo.save(project);

        const auto loaded = repo.load(project.id);
        if (!loaded.has_value())
        {
            root.deleteRecursively();
            return false;
        }

        repo.save(*loaded);
        const auto reloaded = repo.load(project.id);

        const auto paramValue = [] (const beat::TrackEffect& effect, const juce::String& key) -> std::optional<float>
        {
            for (const auto& param : effect.params)
                if (param.key == key)
                    return param.value;
            return std::nullopt;
        };

        bool ok = reloaded.has_value()
            && reloaded->tracks.size() == 1
            && reloaded->tracks.front().effects.size() == 1
            && reloaded->returnBuses.size() == 1
            && reloaded->returnBuses.front().effects.size() == 1
            && reloaded->instruments.size() == 1
            && reloaded->instruments.front().effects.size() == 1;

        if (ok)
        {
            const auto& trackEffect = reloaded->tracks.front().effects.front();
            const auto& returnEffect = reloaded->returnBuses.front().effects.front();
            const auto& instrumentEffect = reloaded->instruments.front().effects.front();

            ok = trackEffect.schemaVersion == 1
                && returnEffect.schemaVersion == 1
                && instrumentEffect.schemaVersion == 1
                && paramValue(trackEffect, "roomSize").value_or(-1.0f) == 40.0f
                && paramValue(trackEffect, "damping").value_or(-1.0f) == 35.0f
                && paramValue(trackEffect, "mix").value_or(-1.0f) == 33.0f
                && paramValue(returnEffect, "timeMs").value_or(-1.0f) == 250.0f
                && paramValue(returnEffect, "feedback").value_or(-1.0f) == 44.0f
                && paramValue(returnEffect, "mix").value_or(-1.0f) == 18.0f
                && paramValue(instrumentEffect, "drive").value_or(-1.0f) == 77.0f
                && paramValue(instrumentEffect, "shape").value_or(-1.0f) == 35.0f
                && paramValue(instrumentEffect, "trimDb").value_or(-1.0f) == 6.0f
                && paramValue(instrumentEffect, "mix").value_or(-1.0f) == 45.0f;
        }

        root.deleteRecursively();
        if (!ok)
            std::cerr << "Project repository effect defaults migration failed\n";
        return ok;
    }

    bool stressProjectRepositoryAetherInstrumentRoundtrip()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-aether-instrument-repository-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("projects.sqlite");

        if (!root.createDirectory())
        {
            std::cerr << "Could not create Aether instrument repository fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        auto project = makeDenseAetherProject();
        project.id = "aether-instrument-repository-project";
        project.name = "Aether Instrument Repository Project";
        auto& instrument = project.instruments.front();
        instrument.env2AttackMs = 18.0f;
        instrument.env2AttackCurve = 1;
        instrument.env2DecayMs = 240.0f;
        instrument.env2DecayCurve = 2;
        instrument.env2Sustain = 0.42f;
        instrument.env2ReleaseMs = 480.0f;
        instrument.env2ReleaseCurve = 3;
        instrument.env2Loop = true;
        instrument.env3AttackMs = 23.0f; instrument.env3DecayMs = 123.0f; instrument.env3Sustain = 0.31f; instrument.env3ReleaseMs = 183.0f; instrument.env3Loop = true;
        instrument.env4AttackMs = 34.0f; instrument.env4DecayMs = 144.0f; instrument.env4Sustain = 0.41f; instrument.env4ReleaseMs = 224.0f;
        instrument.macroValues = { 0.11f, 0.57f, 0.83f, 0.25f, 0.19f, 0.29f, 0.39f, 0.49f };
        instrument.dynamicModulation.oscAFine.lfo2 = 0.19f;
        instrument.dynamicModulation.oscAFine.lfo2Bipolar = false;
        instrument.dynamicModulation.filterCutoff.macro4 = -0.31f;
        instrument.dynamicModulation.filterCutoff.macro8 = 0.27f;
        instrument.dynamicModulation.filterCutoff.env3 = 0.21f;
        instrument.dynamicModulation.filterCutoff.env4 = -0.18f;
        instrument.extraLfos[7] = { true, 3, 3.25f, true, "1/8t", 0.2f, 0.15f, 0.3f, true, false };
        instrument.dynamicModulation.filterCutoff.extraLfo[7] = 0.29f;
        instrument.dynamicModulation.ampLevel.velocity = 0.27f;
        instrument.dynamicModulation.ampLevel.velocityBipolar = false;
        instrument.dynamicModulation.filterDrive.pressure = 0.38f;
        instrument.dynamicModulation.filterDrive.pressureBipolar = true;
        instrument.dynamicModulation.oscBPosition.timbre = -0.24f;
        instrument.dynamicModulation.oscBPosition.timbreBipolar = false;

        auto& oscA = instrument.aether.oscA;
        oscA.phase = 0.37f;
        oscA.randomPhase = 0.18f;
        oscA.fxSends = { 0.31f, 0.67f };
        oscA.wavetable.custom = true;
        oscA.wavetable.warpMode = 2;
        oscA.wavetable.smoothInterpolation = true;
        oscA.wavetable.morph = 0.44f;
        oscA.wavetable.customFrames[0].brightness = 0.91f;
        oscA.wavetable.customFrames[0].skew = -0.33f;
        oscA.wavetable.customFrames[0].tilt = 0.27f;
        oscA.wavetable.customFrames[0].focus = 0.66f;
        oscA.wavetable.customFrames[0].partials[0] = 0.84f;
        oscA.wavetable.customFrames[0].partials[7] = 0.46f;
        oscA.wavetable.customFrames[3].phase = 0.73f;
        oscA.wavetable.customFrames[3].partials[15] = 0.28f;

        auto& oscB = instrument.aether.oscB;
        oscB.enabled = true;
        oscB.level = 0.33f;
        oscB.pan = 0.41f;
        oscB.octave = 1;
        oscB.phase = 0.22f;
        oscB.randomPhase = 0.12f;
        oscB.fxSends = { 0.23f, 0.41f };
        oscB.wavetable.custom = true;
        oscB.wavetable.bank = 3;
        oscB.wavetable.warpMode = 1;
        oscB.wavetable.smoothInterpolation = true;
        oscB.wavetable.morph = 0.21f;
        oscB.wavetable.customFrames[1].formant = 0.77f;
        oscB.wavetable.customFrames[1].notch = 0.18f;
        oscB.wavetable.customFrames[1].partials[4] = 0.62f;

        instrument.aether.sub.enabled = true;
        instrument.aether.sub.level = 0.24f;
        instrument.aether.sub.octave = -2;
        instrument.aether.sub.waveform = 1;
        instrument.aether.sub.fxSends = { 0.17f, 0.29f };
        instrument.aether.noise.enabled = true;
        instrument.aether.noise.level = 0.06f;
        instrument.aether.noise.color = 0.81f;
        instrument.aether.noise.fxSends = { 0.13f, 0.19f };
        instrument.aether.sampleSlot1 = { 4, true, "sample-slot-asset", 57, 0.73f, -0.21f, 3,
            0.18f, 0.82f, true, 0.27f, 0.71f };
        instrument.aether.sampleSlot1.fxSends = { 0.37f, 0.53f };
        instrument.aether.sampleSlot1.zones.push_back({ "sample-slot-low", 48, 0, 63, 0, 127,
            0.71f, -0.3f, 0.1f, 0.9f, true, 0.2f, 0.7f });
        instrument.aether.sampleSlot1.zones.push_back({ "sample-slot-high", 72, 64, 127, 32, 127,
            0.62f, 0.3f, 0.0f, 1.0f, false, 0.0f, 1.0f });
        instrument.aether.sampleSlot1.managedSfz.assetId = "sfz-fixture";
        instrument.aether.sampleSlot1.managedSfz.displayName = "Managed Fixture";
        instrument.aether.sampleSlot1.managedSfz.manifestPath = "/tmp/managed/manifest.json";
        instrument.aether.sampleSlot1.managedSfz.sourcePath = "/tmp/managed/source.sfz";
        instrument.aether.sampleSlot1.managedSfz.samplePaths = { "/tmp/managed/sample.wav" };
        instrument.aether.fxBusIds = { "return-a", "return-b" };
        instrument.aether.runtimeWarp = 0.63f;
        instrument.aether.runtimeWarpMode = 1;
        instrument.aether.runtimeWarp2 = 0.37f;
        instrument.aether.runtimeWarp2Mode = 2;
        instrument.aether.interactionMode = 2;
        instrument.aether.interactionAmount = 0.46f;
        instrument.aether.memberExpressionZone = { 1, true, 1, 2, 8 };

        const auto beforeEnergy = bufferEnergy(renderOfflineBlock(project, 16000));

        beat::Database db(dbFile);
        beat::ProjectRepository repo(db);
        repo.save(project);
        const auto loaded = repo.load(project.id);

        bool metadataOk = loaded.has_value()
            && loaded->instruments.size() == 1
            && loaded->instruments.front().id == instrument.id
            && loaded->instruments.front().hasAether
            && loaded->instruments.front().effects.size() == instrument.effects.size();

        if (metadataOk)
        {
            const auto& loadedInstrument = loaded->instruments.front();
            const auto& loadedOscA = loadedInstrument.aether.oscA;
            const auto& loadedOscB = loadedInstrument.aether.oscB;

            metadataOk = near(loadedInstrument.env2AttackMs, 18.0f)
                && loadedInstrument.env2AttackCurve == 1
                && near(loadedInstrument.env2DecayMs, 240.0f)
                && loadedInstrument.env2DecayCurve == 2
                && near(loadedInstrument.env2Sustain, 0.42f)
                && near(loadedInstrument.env2ReleaseMs, 480.0f)
                && loadedInstrument.env2ReleaseCurve == 3
                && loadedInstrument.env2Loop
                && near(loadedInstrument.macroValues[0], 0.11f)
                && near(loadedInstrument.macroValues[1], 0.57f)
                && near(loadedInstrument.macroValues[2], 0.83f)
                && near(loadedInstrument.macroValues[3], 0.25f)
                && near(loadedInstrument.macroValues[4], 0.19f)
                && near(loadedInstrument.macroValues[5], 0.29f)
                && near(loadedInstrument.macroValues[6], 0.39f)
                && near(loadedInstrument.macroValues[7], 0.49f)
                && loadedInstrument.dynamicModulation.active
                && near(loadedInstrument.dynamicModulation.oscAFine.lfo2, 0.19f)
                && !loadedInstrument.dynamicModulation.oscAFine.lfo2Bipolar
                && near(loadedInstrument.dynamicModulation.filterCutoff.macro4, -0.31f)
                && near(loadedInstrument.dynamicModulation.filterCutoff.macro8, 0.27f)
                && near(loadedInstrument.dynamicModulation.filterCutoff.env3, 0.21f)
                && near(loadedInstrument.dynamicModulation.filterCutoff.env4, -0.18f)
                && near(loadedInstrument.env3AttackMs, 23.0f) && near(loadedInstrument.env3DecayMs, 123.0f)
                && near(loadedInstrument.env3Sustain, 0.31f) && near(loadedInstrument.env3ReleaseMs, 183.0f) && loadedInstrument.env3Loop
                && near(loadedInstrument.env4AttackMs, 34.0f) && near(loadedInstrument.env4DecayMs, 144.0f)
                && near(loadedInstrument.env4Sustain, 0.41f) && near(loadedInstrument.env4ReleaseMs, 224.0f)
                && loadedInstrument.extraLfos[7].enabled && loadedInstrument.extraLfos[7].waveform == 3
                && near(loadedInstrument.extraLfos[7].rateHz, 3.25f) && near(loadedInstrument.extraLfos[7].phaseOffset, 0.3f)
                && loadedInstrument.extraLfos[7].sync && loadedInstrument.extraLfos[7].syncedRate == "1/8t"
                && near(loadedInstrument.dynamicModulation.filterCutoff.extraLfo[7], 0.29f)
                && near(loadedInstrument.dynamicModulation.ampLevel.velocity, 0.27f)
                && !loadedInstrument.dynamicModulation.ampLevel.velocityBipolar
                && near(loadedInstrument.dynamicModulation.filterDrive.pressure, 0.38f)
                && loadedInstrument.dynamicModulation.filterDrive.pressureBipolar
                && near(loadedInstrument.dynamicModulation.oscBPosition.timbre, -0.24f)
                && !loadedInstrument.dynamicModulation.oscBPosition.timbreBipolar
                && loadedOscA.enabled
                && near(loadedOscA.phase, 0.37f)
                && near(loadedOscA.randomPhase, 0.18f)
                && near(loadedOscA.fxSends[0], 0.31f)
                && near(loadedOscA.fxSends[1], 0.67f)
                && loadedOscA.wavetable.custom
                && loadedOscA.wavetable.warpMode == 2
                && loadedOscA.wavetable.smoothInterpolation
                && near(loadedOscA.wavetable.morph, 0.44f)
                && near(loadedOscA.wavetable.customFrames[0].brightness, 0.91f)
                && near(loadedOscA.wavetable.customFrames[0].skew, -0.33f)
                && near(loadedOscA.wavetable.customFrames[0].tilt, 0.27f)
                && near(loadedOscA.wavetable.customFrames[0].focus, 0.66f)
                && near(loadedOscA.wavetable.customFrames[0].partials[0], 0.84f)
                && near(loadedOscA.wavetable.customFrames[0].partials[7], 0.46f)
                && near(loadedOscA.wavetable.customFrames[3].phase, 0.73f)
                && near(loadedOscA.wavetable.customFrames[3].partials[15], 0.28f)
                && loadedOscB.enabled
                && near(loadedOscB.level, 0.33f)
                && near(loadedOscB.pan, 0.41f)
                && loadedOscB.octave == 1
                && near(loadedOscB.phase, 0.22f)
                && near(loadedOscB.randomPhase, 0.12f)
                && near(loadedOscB.fxSends[0], 0.23f)
                && near(loadedOscB.fxSends[1], 0.41f)
                && loadedOscB.wavetable.custom
                && loadedOscB.wavetable.bank == 3
                && loadedOscB.wavetable.warpMode == 1
                && loadedOscB.wavetable.smoothInterpolation
                && near(loadedOscB.wavetable.morph, 0.21f)
                && near(loadedOscB.wavetable.customFrames[1].formant, 0.77f)
                && near(loadedOscB.wavetable.customFrames[1].notch, 0.18f)
                && near(loadedOscB.wavetable.customFrames[1].partials[4], 0.62f)
                && loadedInstrument.aether.sub.enabled
                && near(loadedInstrument.aether.sub.level, 0.24f)
                && loadedInstrument.aether.sub.octave == -2
                && loadedInstrument.aether.sub.waveform == 1
                && near(loadedInstrument.aether.sub.fxSends[0], 0.17f)
                && near(loadedInstrument.aether.sub.fxSends[1], 0.29f)
                && loadedInstrument.aether.noise.enabled
                && near(loadedInstrument.aether.noise.level, 0.06f)
                && near(loadedInstrument.aether.noise.color, 0.81f)
                && near(loadedInstrument.aether.noise.fxSends[0], 0.13f)
                && near(loadedInstrument.aether.noise.fxSends[1], 0.19f)
                && loadedInstrument.aether.sampleSlot1.schemaVersion == 5
                && loadedInstrument.aether.sampleSlot1.enabled
                && loadedInstrument.aether.sampleSlot1.audioFileId == "sample-slot-asset"
                && loadedInstrument.aether.sampleSlot1.rootNote == 57
                && near(loadedInstrument.aether.sampleSlot1.level, 0.73f)
                && near(loadedInstrument.aether.sampleSlot1.pan, -0.21f)
                && loadedInstrument.aether.sampleSlot1.routing == 3
                && near(loadedInstrument.aether.sampleSlot1.startRatio, 0.18f)
                && near(loadedInstrument.aether.sampleSlot1.endRatio, 0.82f)
                && loadedInstrument.aether.sampleSlot1.loopEnabled
                && near(loadedInstrument.aether.sampleSlot1.loopStartRatio, 0.27f)
                && near(loadedInstrument.aether.sampleSlot1.loopEndRatio, 0.71f)
                && near(loadedInstrument.aether.sampleSlot1.fxSends[0], 0.37f)
                && near(loadedInstrument.aether.sampleSlot1.fxSends[1], 0.53f)
                && loadedInstrument.aether.sampleSlot1.zones.size() == 2
                && loadedInstrument.aether.sampleSlot1.zones[0].audioFileId == "sample-slot-low"
                && loadedInstrument.aether.sampleSlot1.zones[0].rootNote == 48
                && loadedInstrument.aether.sampleSlot1.zones[0].hiNote == 63
                && loadedInstrument.aether.sampleSlot1.zones[0].loopEnabled
                && loadedInstrument.aether.sampleSlot1.zones[1].audioFileId == "sample-slot-high"
                && loadedInstrument.aether.sampleSlot1.zones[1].loNote == 64
                && loadedInstrument.aether.sampleSlot1.zones[1].loVelocity == 32
                && loadedInstrument.aether.sampleSlot1.managedSfz.assetId == "sfz-fixture"
                && loadedInstrument.aether.sampleSlot1.managedSfz.displayName == "Managed Fixture"
                && loadedInstrument.aether.sampleSlot1.managedSfz.manifestPath == "/tmp/managed/manifest.json"
                && loadedInstrument.aether.sampleSlot1.managedSfz.sourcePath == "/tmp/managed/source.sfz"
                && loadedInstrument.aether.sampleSlot1.managedSfz.samplePaths.size() == 1
                && loadedInstrument.aether.sampleSlot1.managedSfz.samplePaths[0] == "/tmp/managed/sample.wav"
                && loadedInstrument.aether.fxBusIds[0] == "return-a"
                && loadedInstrument.aether.fxBusIds[1] == "return-b"
                && near(loadedInstrument.aether.runtimeWarp, 0.63f)
                && loadedInstrument.aether.runtimeWarpMode == 1
                && near(loadedInstrument.aether.runtimeWarp2, 0.37f)
                && loadedInstrument.aether.runtimeWarp2Mode == 2
                && loadedInstrument.aether.interactionMode == 2
                && near(loadedInstrument.aether.interactionAmount, 0.46f)
                && loadedInstrument.aether.memberExpressionZone.schemaVersion == 1
                && loadedInstrument.aether.memberExpressionZone.enabled
                && loadedInstrument.aether.memberExpressionZone.masterChannel == 1
                && loadedInstrument.aether.memberExpressionZone.firstMemberChannel == 2
                && loadedInstrument.aether.memberExpressionZone.lastMemberChannel == 8
                && loadedInstrument.effects.front().id == instrument.effects.front().id;
        }

        double afterEnergy = 0.0;
        if (loaded.has_value())
            afterEnergy = bufferEnergy(renderOfflineBlock(*loaded, 16000));

        root.deleteRecursively();
        const bool renderOk = std::isfinite(beforeEnergy)
            && std::isfinite(afterEnergy)
            && beforeEnergy > 0.0001
            && afterEnergy > 0.0001;
        const bool ok = metadataOk && renderOk;
        if (!ok)
        {
            std::cerr << "Project repository Aether instrument roundtrip failed metadata=" << metadataOk
                      << " beforeEnergy=" << beforeEnergy
                      << " afterEnergy=" << afterEnergy
                      << " loaded=" << loaded.has_value()
                      << "\n";
        }
        return ok;
    }

    bool stressProjectRepositoryAudioFileRoundtrip()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-audio-repository-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("projects.sqlite");

        if (!root.createDirectory())
        {
            std::cerr << "Could not create audio repository fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::Project project;
        project.id = "audio-repository-project";
        project.name = "Audio Repository Project";
        project.bpm = 120.0;
        project.lengthBeats = 8.0;
        project.recordingInput.inputDeviceId = "builtin-input";
        project.recordingInput.inputDeviceName = "Built-in Microphone";
        project.recordingInput.inputChannelStart = 1;
        project.recordingInput.inputChannelCount = 2;
        project.recordingInput.calibrationSampleRate = 48000.0;
        project.recordingInput.measuredRoundTripSamples = 960;
        project.recordingInput.reportedInputLatencySamples = 128;
        project.recordingInput.reportedOutputLatencySamples = 256;
        project.recordingInput.userLatencyAdjustmentSamples = 48;

        beat::InstrumentDefinition curveInstrument;
        curveInstrument.id = "curve-synth";
        curveInstrument.kind = "synth";
        curveInstrument.glideMs = 140.0f;
        curveInstrument.maxVoices = 7;
        curveInstrument.mono = true;
        curveInstrument.legato = true;
        project.instruments.push_back(curveInstrument);

        beat::AudioFileAsset audioFile;
        audioFile.id = "recorded-take-audio";
        audioFile.name = "Recorded Take";
        audioFile.path = root.getChildFile("Recorded Take.wav").getFullPathName();
        audioFile.durationSeconds = 2.0;
        audioFile.sampleRate = 48000.0;
        project.audioFiles.push_back(audioFile);

        beat::Track track;
        track.id = "audio-track";
        track.name = "Recorded Audio";
        track.kind = beat::TrackKind::Audio;
        track.audioFileId = audioFile.id;
        track.recordArmed = true;
        track.inputMonitoring = true;
        track.inputDeviceId = "builtin-input";
        track.inputChannelStart = 1;
        track.inputChannelCount = 2;
        track.recordGainDb = -3.5f;

        beat::Segment segment;
        segment.id = "recorded-take-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Audio;
        segment.audioFileId = audioFile.id;
        segment.startBeat = 2.0;
        segment.lengthBeats = 4.0;
        segment.sourceStartBeat = 0.25;
        segment.fadeInBeats = 0.125;
        segment.fadeOutBeats = 0.25;
        segment.audioGainDb = -3.0f;
        track.segments.push_back(segment);
        project.tracks.push_back(track);

        beat::Track midiTrack;
        midiTrack.id = "curve-midi-track";
        midiTrack.name = "Curve MIDI";
        midiTrack.kind = beat::TrackKind::Midi;
        midiTrack.instrumentId = "curve-synth";

        beat::Segment midiSegment;
        midiSegment.id = "curve-midi-segment";
        midiSegment.trackId = midiTrack.id;
        midiSegment.kind = beat::SegmentPayloadKind::Midi;
        midiSegment.instrumentId = midiTrack.instrumentId;
        midiSegment.startBeat = 1.0;
        midiSegment.lengthBeats = 2.0;

        beat::MidiNote curveNote;
        curveNote.instrumentId = midiTrack.instrumentId;
        curveNote.pitch = 60;
        curveNote.velocity = 96;
        curveNote.startBeat = 0.25;
        curveNote.lengthBeats = 1.25;
        curveNote.connectToIndex = 1;
        curveNote.curve.push_back({ 0.25, 60.25 });
        curveNote.curve.push_back({ 1.50, 63.75 });
        beat::MidiAutomationLane noteLane;
        noteLane.target = "filter.cutoff";
        noteLane.points.push_back({ 0.25, 0.2f, beat::AutomationCurve::Smoothstep });
        noteLane.points.push_back({ 1.50, 0.8f, beat::AutomationCurve::Linear });
        curveNote.automation.push_back(std::move(noteLane));
        midiSegment.notes.push_back(curveNote);
        beat::MidiNote glideTargetNote;
        glideTargetNote.instrumentId = midiTrack.instrumentId;
        glideTargetNote.pitch = 67;
        glideTargetNote.velocity = 84;
        glideTargetNote.startBeat = 1.5;
        glideTargetNote.lengthBeats = 0.25;
        midiSegment.notes.push_back(glideTargetNote);
        midiTrack.segments.push_back(midiSegment);
        project.tracks.push_back(midiTrack);

        beat::Database db(dbFile);
        beat::ProjectRepository repo(db);
        repo.save(project);

        const auto loaded = repo.load(project.id);
        const bool ok = loaded.has_value()
            && loaded->audioFiles.size() == 1
            && loaded->audioFiles.front().id == audioFile.id
            && loaded->audioFiles.front().name == audioFile.name
            && loaded->audioFiles.front().path == audioFile.path
            && std::abs(loaded->audioFiles.front().durationSeconds - audioFile.durationSeconds) < 0.0001
            && std::abs(loaded->audioFiles.front().sampleRate - audioFile.sampleRate) < 0.0001
            && loaded->tracks.size() == 2
            && loaded->tracks.front().audioFileId == audioFile.id
            && loaded->tracks.front().recordArmed
            && loaded->tracks.front().inputMonitoring
            && loaded->recordingInput.inputDeviceId == "builtin-input"
            && loaded->recordingInput.inputDeviceName == "Built-in Microphone"
            && loaded->recordingInput.inputChannelStart == 1
            && loaded->recordingInput.inputChannelCount == 2
            && std::abs(loaded->recordingInput.calibrationSampleRate - 48000.0) < 0.0001
            && loaded->recordingInput.measuredRoundTripSamples == 960
            && loaded->recordingInput.reportedInputLatencySamples == 128
            && loaded->recordingInput.reportedOutputLatencySamples == 256
            && loaded->recordingInput.userLatencyAdjustmentSamples == 48
            && loaded->tracks.front().inputDeviceId == "builtin-input"
            && loaded->tracks.front().inputChannelStart == 1
            && loaded->tracks.front().inputChannelCount == 2
            && std::abs(loaded->tracks.front().recordGainDb + 3.5f) < 0.0001f
            && loaded->tracks.front().segments.size() == 1
            && loaded->tracks.front().segments.front().kind == beat::SegmentPayloadKind::Audio
            && loaded->tracks.front().segments.front().audioFileId == audioFile.id
            && std::abs(loaded->tracks.front().segments.front().sourceStartBeat - 0.25) < 0.0001
            && std::abs(loaded->tracks.front().segments.front().audioGainDb + 3.0f) < 0.0001f
            && loaded->tracks[1].segments.size() == 1
            && loaded->instruments.size() == 1
            && std::abs(loaded->instruments.front().glideMs - 140.0f) < 0.0001f
            && loaded->instruments.front().maxVoices == 7
            && loaded->instruments.front().mono
            && loaded->instruments.front().legato
            && loaded->tracks[1].segments.front().notes.size() == 2
            && loaded->tracks[1].segments.front().notes.front().connectToIndex == 1
            && loaded->tracks[1].segments.front().notes.front().curve.size() == 2
            && std::abs(loaded->tracks[1].segments.front().notes.front().curve.front().pitch - 60.25) < 0.0001
            && std::abs(loaded->tracks[1].segments.front().notes.front().curve.back().pitch - 63.75) < 0.0001
            && loaded->tracks[1].segments.front().notes.front().automation.size() == 1
            && loaded->tracks[1].segments.front().notes.front().automation.front().target == "filter.cutoff"
            && loaded->tracks[1].segments.front().notes.front().automation.front().points.size() == 2
            && loaded->tracks[1].segments.front().notes.front().automation.front().points.front().curve == beat::AutomationCurve::Smoothstep
            && std::abs(loaded->tracks[1].segments.front().notes.front().automation.front().points.back().value - 0.8f) < 0.0001f;

        root.deleteRecursively();
        if (!ok)
        {
            std::cerr << "Project repository audio file roundtrip failed"
                      << " loaded=" << loaded.has_value()
                      << " audioFileCount=" << (loaded ? (int) loaded->audioFiles.size() : -1)
                      << " trackCount=" << (loaded ? (int) loaded->tracks.size() : -1)
                      << "\n";
        }
        return ok;
    }

    bool stressRecordingPlannerAppendTake()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-recording-planner-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("projects.sqlite");
        const auto takeFile = root.getChildFile("Recorded Take.wav");

        if (!root.createDirectory() || !writeAudioClipFixture(takeFile))
        {
            std::cerr << "Could not create recording planner fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::Project project;
        project.id = "recording-planner-project";
        project.name = "Recording Planner Project";
        project.bpm = 120.0;
        project.lengthBeats = 1.0;

        beat::RecordedTakeSpec spec;
        spec.trackId = "record-track";
        spec.trackName = "Vocal Take";
        spec.audioFileId = "recorded-audio";
        spec.segmentId = "recorded-segment";
        spec.name = "Recorded Take";
        spec.path = takeFile.getFullPathName();
        spec.startBeat = 2.0;
        spec.durationSeconds = 2.0;
        spec.bpm = project.bpm;
        spec.sampleRate = 44100.0;
        spec.gainDb = -6.0f;

        juce::String error;
        const auto result = beat::appendRecordedTake(project, spec, &error);
        if (!result.has_value())
        {
            std::cerr << "Recording planner append failed: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        const bool modelOk = project.audioFiles.size() == 1
            && project.tracks.size() == 1
            && project.tracks.front().kind == beat::TrackKind::Audio
            && project.tracks.front().segments.size() == 1
            && project.tracks.front().segments.front().kind == beat::SegmentPayloadKind::Audio
            && project.tracks.front().segments.front().audioFileId == result->audioFileId
            && std::abs(result->lengthBeats - 4.0) < 0.0001
            && std::abs(project.lengthBeats - 6.0) < 0.0001;

        const auto rendered = renderOfflineBlock(project, 132300);
        const double renderedEnergy = bufferEnergy(rendered);
        const bool renderOk = std::isfinite(renderedEnergy) && renderedEnergy > 0.0001;

        beat::Database db(dbFile);
        beat::ProjectRepository repo(db);
        repo.save(project);
        const auto loaded = repo.load(project.id);
        const bool roundtripOk = loaded.has_value()
            && loaded->audioFiles.size() == 1
            && loaded->audioFiles.front().id == result->audioFileId
            && loaded->tracks.size() == 1
            && loaded->tracks.front().segments.size() == 1
            && loaded->tracks.front().segments.front().audioFileId == result->audioFileId;

        beat::RecordedTakeSpec duplicateSpec = spec;
        duplicateSpec.segmentId = "recorded-segment-b";
        const auto duplicate = beat::appendRecordedTake(project, duplicateSpec, &error);
        const bool duplicateRejected = !duplicate.has_value();

        root.deleteRecursively();
        const bool ok = modelOk && renderOk && roundtripOk && duplicateRejected;
        if (!ok)
        {
            std::cerr << "Recording planner stress failed model=" << modelOk
                      << " render=" << renderOk
                      << " energy=" << renderedEnergy
                      << " roundtrip=" << roundtripOk
                      << " duplicateRejected=" << duplicateRejected << "\n";
        }
        return ok;
    }

    bool stressRecordingPlannerLatencyCompensation()
    {
        beat::Project project;
        project.id = "recording-latency-project";
        project.name = "Recording Latency Project";
        project.bpm = 60.0;
        project.lengthBeats = 1.0;

        beat::RecordedTakeSpec spec;
        spec.trackId = "latency-track";
        spec.audioFileId = "latency-audio";
        spec.segmentId = "latency-segment";
        spec.path = "/private/tmp/BeatBackendStress-latency.wav";
        spec.startBeat = 2.0;
        spec.durationSeconds = 1.0;
        spec.bpm = project.bpm;
        spec.sampleRate = 1000.0;
        spec.inputLatencySamples = 250;
        spec.outputLatencySamples = 250;

        juce::String error;
        const auto result = beat::appendRecordedTake(project, spec, &error);
        if (!result.has_value())
        {
            std::cerr << "Recording latency append failed: " << error << "\n";
            return false;
        }

        const auto& segment = project.tracks.front().segments.front();
        const bool shiftedEarlier = std::abs(segment.startBeat - 1.5) < 0.0001
            && std::abs(segment.sourceStartBeat) < 0.0001
            && std::abs(segment.lengthBeats - 1.0) < 0.0001
            && std::abs(result->lengthBeats - 1.0) < 0.0001;

        beat::Project clampedProject;
        clampedProject.id = "recording-latency-clamped-project";
        clampedProject.name = "Recording Latency Clamped Project";
        clampedProject.bpm = 60.0;

        beat::RecordedTakeSpec clampedSpec = spec;
        clampedSpec.trackId = "latency-track-b";
        clampedSpec.audioFileId = "latency-audio-b";
        clampedSpec.segmentId = "latency-segment-b";
        clampedSpec.startBeat = 0.25;

        const auto clamped = beat::appendRecordedTake(clampedProject, clampedSpec, &error);
        if (!clamped.has_value())
        {
            std::cerr << "Recording clamped latency append failed: " << error << "\n";
            return false;
        }

        const auto& clampedSegment = clampedProject.tracks.front().segments.front();
        const bool clampedOk = std::abs(clampedSegment.startBeat) < 0.0001
            && std::abs(clampedSegment.sourceStartBeat - 0.25) < 0.0001
            && std::abs(clampedSegment.lengthBeats - 0.75) < 0.0001
            && std::abs(clamped->lengthBeats - 0.75) < 0.0001;

        if (!shiftedEarlier || !clampedOk)
        {
            std::cerr << "Recording latency compensation mismatch shifted=" << shiftedEarlier
                      << " clamped=" << clampedOk << "\n";
        }
        return shiftedEarlier && clampedOk;
    }

    bool stressRecordingLatencyCalibration()
    {
        beat::RecordingLatencyCalibrationSpec calibrationSpec;
        calibrationSpec.sampleRate = 48000.0;
        calibrationSpec.measuredRoundTripSamples = 960;
        calibrationSpec.reportedInputLatencySamples = 128;
        calibrationSpec.reportedOutputLatencySamples = 256;
        calibrationSpec.userAdjustmentSamples = 48;

        juce::String error;
        const auto calibration = beat::calculateRecordingLatencyCalibration(calibrationSpec, &error);
        if (!calibration.has_value())
        {
            std::cerr << "Recording latency calibration failed: " << error << "\n";
            return false;
        }

        const bool calibrationOk = calibration->reportedLatencySamples == 384
            && calibration->manualLatencySamples == 624
            && calibration->compensatedLatencySamples == 1008
            && std::abs(calibration->measuredRoundTripMs - 20.0) < 0.0001
            && std::abs(calibration->manualLatencyMs - 13.0) < 0.0001
            && std::abs(calibration->compensatedLatencyMs - 21.0) < 0.0001;

        beat::RecordingInputProfile profile;
        profile.calibrationSampleRate = calibrationSpec.sampleRate;
        profile.measuredRoundTripSamples = calibrationSpec.measuredRoundTripSamples;
        profile.reportedInputLatencySamples = calibrationSpec.reportedInputLatencySamples;
        profile.reportedOutputLatencySamples = calibrationSpec.reportedOutputLatencySamples;
        profile.userLatencyAdjustmentSamples = calibrationSpec.userAdjustmentSamples;
        const auto profileCalibration = beat::calculateRecordingLatencyCalibration(profile, &error);
        const bool profileCalibrationOk = profileCalibration.has_value()
            && profileCalibration->compensatedLatencySamples == calibration->compensatedLatencySamples;

        beat::RecordedTakeSpec spec;
        spec.trackId = "calibrated-track";
        spec.audioFileId = "calibrated-audio";
        spec.segmentId = "calibrated-segment";
        spec.path = "/private/tmp/BeatBackendStress-calibrated-recording.wav";
        spec.startBeat = 2.0;
        spec.durationSeconds = 1.0;
        spec.bpm = 120.0;
        spec.sampleRate = calibrationSpec.sampleRate;

        const auto calibratedSpec = beat::applyRecordingLatencyCalibration(spec, *calibration, &error);
        if (!calibratedSpec.has_value())
        {
            std::cerr << "Recording latency calibration apply failed: " << error << "\n";
            return false;
        }

        beat::Project project;
        project.id = "calibrated-recording-project";
        project.name = "Calibrated Recording Project";
        project.bpm = spec.bpm;
        const auto result = beat::appendRecordedTake(project, *calibratedSpec, &error);
        if (!result.has_value())
        {
            std::cerr << "Calibrated recording append failed: " << error << "\n";
            return false;
        }

        const auto& segment = project.tracks.front().segments.front();
        const double expectedLatencyBeats = (double) calibration->compensatedLatencySamples
            / spec.sampleRate
            * spec.bpm
            / 60.0;
        const bool placementOk = std::abs(segment.startBeat - (spec.startBeat - expectedLatencyBeats)) < 0.0001
            && std::abs(segment.sourceStartBeat) < 0.0001;

        beat::RecordingLatencyCalibrationSpec invalidSpec = calibrationSpec;
        invalidSpec.measuredRoundTripSamples = -1;
        const bool invalidRejected = !beat::calculateRecordingLatencyCalibration(invalidSpec, &error).has_value();

        const bool ok = calibrationOk && profileCalibrationOk && placementOk && invalidRejected;
        if (!ok)
        {
            std::cerr << "Recording latency calibration stress failed calibration=" << calibrationOk
                      << " profileCalibration=" << profileCalibrationOk
                      << " placement=" << placementOk
                      << " invalidRejected=" << invalidRejected
                      << " expectedLatencyBeats=" << expectedLatencyBeats << "\n";
        }
        return ok;
    }

    bool stressRecordingSessionPlanner()
    {
        beat::Project project;
        project.id = "recording-session-project";
        project.name = "Recording Session Project";
        project.bpm = 120.0;

        beat::Track vocal;
        vocal.id = "vocal-track";
        vocal.name = "Vocal";
        vocal.kind = beat::TrackKind::Audio;
        vocal.recordArmed = true;
        vocal.inputMonitoring = true;

        beat::Track guitar;
        guitar.id = "guitar-track";
        guitar.name = "Guitar";
        guitar.kind = beat::TrackKind::Audio;
        guitar.recordArmed = false;

        project.tracks.push_back(vocal);
        project.tracks.push_back(guitar);

        juce::String error;
        beat::RecordingSessionSpec spec;
        spec.trackId = "vocal-track";
        spec.requestedStartBeat = 8.0;
        spec.countInBeats = 4.0;
        spec.bpm = 120.0;
        spec.sampleRate = 48000.0;
        spec.maxDurationSeconds = 12.0;
        spec.inputChannels = 2;

        const auto planned = beat::planRecordingSession(project, spec, &error);
        const bool normalCountInOk = planned.has_value()
            && planned->trackId == "vocal-track"
            && std::abs(planned->transportStartBeat - 4.0) < 0.0001
            && std::abs(planned->captureStartBeat - 8.0) < 0.0001
            && std::abs(planned->countInBeats - 4.0) < 0.0001
            && std::abs(planned->captureDelaySeconds - 2.0) < 0.0001
            && planned->inputChannels == 2;

        beat::RecordingSessionSpec clampedSpec = spec;
        clampedSpec.trackId = {};
        clampedSpec.requestedStartBeat = 1.0;
        clampedSpec.countInBeats = 4.0;
        clampedSpec.inputChannels = 128;

        const auto clamped = beat::planRecordingSession(project, clampedSpec, &error);
        const bool clampedCountInOk = clamped.has_value()
            && clamped->trackId == "vocal-track"
            && std::abs(clamped->transportStartBeat) < 0.0001
            && std::abs(clamped->captureStartBeat - 1.0) < 0.0001
            && std::abs(clamped->countInBeats - 1.0) < 0.0001
            && std::abs(clamped->captureDelaySeconds - 0.5) < 0.0001
            && clamped->inputChannels == 32;

        beat::RecordingSessionSpec unarmedSpec = spec;
        unarmedSpec.trackId = "guitar-track";
        const bool unarmedRejected = !beat::planRecordingSession(project, unarmedSpec, &error).has_value();

        beat::Project noArmedProject = project;
        for (auto& track : noArmedProject.tracks)
            track.recordArmed = false;

        beat::RecordingSessionSpec firstArmedSpec = spec;
        firstArmedSpec.trackId = {};
        const bool missingArmedRejected = !beat::planRecordingSession(noArmedProject, firstArmedSpec, &error).has_value();

        beat::RecordingSessionSpec invalidSpec = spec;
        invalidSpec.maxDurationSeconds = 0.0;
        const bool invalidDurationRejected = !beat::planRecordingSession(project, invalidSpec, &error).has_value();

        const bool ok = normalCountInOk
            && clampedCountInOk
            && unarmedRejected
            && missingArmedRejected
            && invalidDurationRejected;

        if (!ok)
        {
            std::cerr << "Recording session planner stress failed normal=" << normalCountInOk
                      << " clamped=" << clampedCountInOk
                      << " unarmedRejected=" << unarmedRejected
                      << " missingArmedRejected=" << missingArmedRejected
                      << " invalidDurationRejected=" << invalidDurationRejected
                      << " lastError=" << error << "\n";
        }

        return ok;
    }

    bool stressRecordingPlannerCommitCapture()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-recording-commit-" + juce::Uuid().toString());
        const auto takeFile = root.getChildFile("Committed Take.wav");
        const auto duplicateFile = root.getChildFile("Duplicate Take.wav");
        const auto exportFile = root.getChildFile("Committed Take Export.wav");

        if (!root.createDirectory())
        {
            std::cerr << "Could not create recording commit fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::RecordingCapture capture;
        juce::String error;
        if (!capture.prepare(44100.0, 2, 0.1, &error))
        {
            std::cerr << "Recording capture prepare failed: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        juce::AudioBuffer<float> input(2, 512);
        for (int i = 0; i < input.getNumSamples(); ++i)
        {
            const float phase = (float) i / (float) input.getNumSamples();
            input.setSample(0, i, std::sin(phase * juce::MathConstants<float>::twoPi) * 0.55f);
            input.setSample(1, i, std::cos(phase * juce::MathConstants<float>::twoPi) * 0.35f);
        }
        std::array<const float*, 2> inputs {
            input.getReadPointer(0),
            input.getReadPointer(1),
        };

        capture.start();
        capture.captureBlock(inputs.data(), (int) inputs.size(), input.getNumSamples());
        capture.stop();

        beat::Project project;
        project.id = "recording-commit-project";
        project.name = "Recording Commit Project";
        project.bpm = 120.0;
        project.lengthBeats = 1.0;

        beat::RecordedTakeSpec spec;
        spec.trackId = "commit-track";
        spec.trackName = "Committed Takes";
        spec.audioFileId = "commit-audio";
        spec.segmentId = "commit-segment";
        spec.name = "Committed Take";
        spec.startBeat = 0.0;
        spec.bpm = project.bpm;

        const auto result = beat::commitRecordedCapture(project, capture, takeFile, spec, &error, 24);
        if (!result.has_value())
        {
            std::cerr << "Recording commit failed: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        const auto expectedDuration = (double) input.getNumSamples() / 44100.0;
        const bool modelOk = takeFile.existsAsFile()
            && project.audioFiles.size() == 1
            && std::abs(project.audioFiles.front().durationSeconds - expectedDuration) < 0.0001
            && project.tracks.size() == 1
            && project.tracks.front().segments.size() == 1
            && project.tracks.front().segments.front().audioFileId == result->audioFileId
            && std::abs(result->lengthBeats - expectedDuration * project.bpm / 60.0) < 0.0001;

        const auto rendered = renderOfflineBlock(project, 2048);
        const double renderedEnergy = bufferEnergy(rendered);
        const bool renderOk = std::isfinite(renderedEnergy) && renderedEnergy > 0.0001;

        const bool exported = beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error);
        const double exportedEnergy = exported ? wavEnergy(exportFile) : 0.0;
        const bool exportOk = exported && std::isfinite(exportedEnergy) && exportedEnergy > 0.0001;

        beat::RecordingCapture duplicateCapture;
        const bool duplicatePrepared = duplicateCapture.prepare(44100.0, 1, 0.1, &error);
        duplicateCapture.start();
        std::array<const float*, 1> monoInput { input.getReadPointer(0) };
        duplicateCapture.captureBlock(monoInput.data(), (int) monoInput.size(), 128);
        duplicateCapture.stop();

        beat::RecordedTakeSpec duplicateSpec = spec;
        duplicateSpec.segmentId = "commit-segment-b";
        const auto audioFileCountBefore = project.audioFiles.size();
        const auto duplicate = duplicatePrepared
            ? beat::commitRecordedCapture(project, duplicateCapture, duplicateFile, duplicateSpec, &error, 24)
            : std::optional<beat::RecordedTakeResult> {};
        const bool rollbackOk = duplicatePrepared
            && !duplicate.has_value()
            && !duplicateFile.existsAsFile()
            && project.audioFiles.size() == audioFileCountBefore;

        root.deleteRecursively();
        const bool ok = modelOk && renderOk && exportOk && rollbackOk;
        if (!ok)
        {
            std::cerr << "Recording commit stress failed model=" << modelOk
                      << " render=" << renderOk
                      << " energy=" << renderedEnergy
                      << " export=" << exportOk
                      << " exportEnergy=" << exportedEnergy
                      << " rollback=" << rollbackOk << "\n";
        }
        return ok;
    }

    bool stressProjectRepositorySampleInstrumentRoundtrip()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-sample-instrument-repository-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("projects.sqlite");
        const auto sampleFile = root.getChildFile("Sample Instrument.wav");

        if (!root.createDirectory() || !writeAudioClipFixture(sampleFile))
        {
            std::cerr << "Could not create sample instrument repository fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::Project project;
        project.id = "sample-instrument-repository-project";
        project.name = "Sample Instrument Repository Project";
        project.bpm = 120.0;
        project.lengthBeats = 2.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "repo-sampler";
        instrument.kind = "sampler";
        instrument.attackMs = 1.0f;
        instrument.releaseMs = 50.0f;
        instrument.ampLevel = 0.8f;
        instrument.sampleUrls.add(sampleFile.getFullPathName());

        beat::InstrumentDefinition::SampleZone zone;
        zone.path = sampleFile.getFullPathName();
        zone.rootNote = 62;
        zone.loNote = 60;
        zone.hiNote = 64;
        zone.loVel = 32;
        zone.hiVel = 127;
        zone.volumeDb = -4.0f;
        zone.pan = 0.25f;
        zone.tuningCents = 7.0f;
        zone.seqPosition = 2;
        zone.loopEnabled = true;
        zone.loopStart = 128;
        zone.loopEnd = 1024;
        zone.oneShot = false;
        zone.durationSeconds = 0.5;
        zone.loLengthSeconds = 0.125;
        zone.hiLengthSeconds = 0.75;
        zone.chokeGroup = 3;
        zone.startSample = 32;
        zone.endSample = 4096;
        instrument.sampleZones.push_back(zone);

        beat::TrackEffect instrumentEffect;
        instrumentEffect.id = "repo-instrument-filter";
        instrumentEffect.kind = beat::TrackEffectKind::Lowpass;
        instrumentEffect.params.push_back({ "cutoffHz", 3200.0f });
        instrumentEffect.params.push_back({ "resonance", 0.35f });
        instrument.effects.push_back(std::move(instrumentEffect));

        project.instruments.push_back(instrument);

        beat::Track track;
        track.id = "repo-sampler-track";
        track.name = "Repository Sampler";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = instrument.id;

        beat::Segment segment;
        segment.id = "repo-sampler-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = instrument.id;
        segment.startBeat = 0.0;
        segment.lengthBeats = 1.0;
        beat::MidiNote note;
        note.instrumentId = instrument.id;
        note.pitch = 62;
        note.velocity = 96;
        note.startBeat = 0.0;
        note.lengthBeats = 0.5;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);

        const auto before = renderOfflineBlock(project, 12000);
        const double beforeEnergy = bufferEnergy(before);

        beat::Database db(dbFile);
        beat::ProjectRepository repo(db);
        repo.save(project);
        const auto loaded = repo.load(project.id);

        bool metadataOk = loaded.has_value()
            && loaded->instruments.size() == 1
            && loaded->instruments.front().id == instrument.id
            && loaded->instruments.front().kind == "sampler"
            && loaded->instruments.front().sampleUrls.size() == 1
            && loaded->instruments.front().sampleZones.size() == 1
            && loaded->instruments.front().effects.size() == 1
            && loaded->instruments.front().effects.front().id == "repo-instrument-filter"
            && loaded->instruments.front().effects.front().kind == beat::TrackEffectKind::Lowpass
            && loaded->instruments.front().effects.front().params.size() == 2;

        if (metadataOk)
        {
            const auto& loadedZone = loaded->instruments.front().sampleZones.front();
            metadataOk = loadedZone.path == zone.path
                && loadedZone.rootNote == zone.rootNote
                && loadedZone.loNote == zone.loNote
                && loadedZone.hiNote == zone.hiNote
                && loadedZone.loVel == zone.loVel
                && loadedZone.hiVel == zone.hiVel
                && std::abs(loadedZone.volumeDb - zone.volumeDb) < 0.0001f
                && std::abs(loadedZone.pan - zone.pan) < 0.0001f
                && std::abs(loadedZone.tuningCents - zone.tuningCents) < 0.0001f
                && loadedZone.seqPosition == zone.seqPosition
                && loadedZone.loopEnabled == zone.loopEnabled
                && loadedZone.loopStart == zone.loopStart
                && loadedZone.loopEnd == zone.loopEnd
                && loadedZone.oneShot == zone.oneShot
                && std::abs(loadedZone.durationSeconds - zone.durationSeconds) < 0.0001
                && std::abs(loadedZone.loLengthSeconds - zone.loLengthSeconds) < 0.0001
                && std::abs(loadedZone.hiLengthSeconds - zone.hiLengthSeconds) < 0.0001
                && loadedZone.chokeGroup == zone.chokeGroup
                && loadedZone.startSample == zone.startSample
                && loadedZone.endSample == zone.endSample;
        }

        double afterEnergy = 0.0;
        if (loaded.has_value())
            afterEnergy = bufferEnergy(renderOfflineBlock(*loaded, 12000));

        root.deleteRecursively();
        const bool renderOk = std::isfinite(beforeEnergy)
            && std::isfinite(afterEnergy)
            && beforeEnergy > 0.0001
            && afterEnergy > 0.0001;
        const bool ok = metadataOk && renderOk;
        if (!ok)
        {
            std::cerr << "Project repository sample instrument roundtrip failed metadata=" << metadataOk
                      << " beforeEnergy=" << beforeEnergy
                      << " afterEnergy=" << afterEnergy
                      << " loaded=" << loaded.has_value()
                      << "\n";
        }
        return ok;
    }

    bool stressProjectDocumentBackup()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-backup-" + juce::Uuid().toString());
        const auto projectFile = root.getChildFile("Backup Project.beat");
        const auto makeProjectDocument = [](int version, const juce::String& name)
        {
            juce::DynamicObject::Ptr track = new juce::DynamicObject();
            track->setProperty("id", "track-" + juce::String(version));
            track->setProperty("name", "Track " + juce::String(version));
            track->setProperty("kind", "mixed");
            track->setProperty("segments", juce::Array<juce::var> {});

            juce::Array<juce::var> tracks;
            tracks.add(juce::var(track.get()));

            juce::DynamicObject::Ptr project = new juce::DynamicObject();
            project->setProperty("id", "project-" + juce::String(version));
            project->setProperty("name", name);
            project->setProperty("bpm", 120.0);
            project->setProperty("lengthBeats", 16.0);
            project->setProperty("tracks", tracks);

            juce::DynamicObject::Ptr document = new juce::DynamicObject();
            document->setProperty("schemaVersion", 1);
            document->setProperty("savedAt", static_cast<double>(version));
            document->setProperty("project", juce::var(project.get()));
            document->setProperty("instruments", juce::Array<juce::var> {});
            document->setProperty("audioFiles", juce::Array<juce::var> {});
            document->setProperty("assets", juce::Array<juce::var> {});
            return juce::JSON::toString(juce::var(document.get()), true);
        };

        if (!root.createDirectory())
        {
            std::cerr << "Could not create project backup fixture at "
                      << root.getFullPathName() << "\n";
            return false;
        }

        juce::String error;
        juce::File latest;
        if (!beat::createProjectBackupBeforeReplace(projectFile, error, &latest)
            || latest.existsAsFile()
            || beat::projectBackupFolderFor(projectFile).exists())
        {
            std::cerr << "Project backup should be a no-op for first save: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        const auto version1 = makeProjectDocument(1, "Backup V1");
        const auto version2 = makeProjectDocument(2, "Backup V2");
        const auto version3 = makeProjectDocument(3, "Backup V3");

        if (!projectFile.replaceWithText(version1))
        {
            root.deleteRecursively();
            return false;
        }

        if (!beat::createProjectBackupBeforeReplace(projectFile, error, &latest)
            || !latest.existsAsFile()
            || latest.loadFileAsString() != version1)
        {
            std::cerr << "Project backup latest file failed: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        if (!projectFile.replaceWithText(version2)
            || !beat::createProjectBackupBeforeReplace(projectFile, error, &latest)
            || !latest.existsAsFile()
            || latest.loadFileAsString() != version2)
        {
            std::cerr << "Project backup latest replacement failed: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        const auto listedBackups = beat::listProjectBackups(projectFile);
        juce::Array<juce::File> backups;
        beat::projectBackupFolderFor(projectFile).findChildFiles(backups, juce::File::findFiles, false, "*.beat");
        bool ok = backups.size() >= 3
            && !listedBackups.empty()
            && listedBackups.front().latest
            && beat::latestProjectBackupFileFor(projectFile).existsAsFile();

        if (!ok)
        {
            std::cerr << "Project backup expected latest plus timestamped snapshots, found "
                      << backups.size() << "\n";
        }

        juce::File restoreBackup;
        if (ok)
        {
            ok = projectFile.replaceWithText(version3)
                && beat::restoreProjectBackup(projectFile, listedBackups.front().file, error, &restoreBackup)
                && projectFile.loadFileAsString() == version2
                && restoreBackup.existsAsFile()
                && restoreBackup.loadFileAsString() == version3;
            if (!ok)
            {
                std::cerr << "Project backup restore failed: " << error
                          << " restored=" << projectFile.loadFileAsString()
                          << " backup=" << restoreBackup.getFullPathName() << "\n";
            }
        }

        if (ok)
        {
            const auto outsideBackup = root.getChildFile("Outside Backup.beat");
            juce::String outsideError;
            juce::File ignoredBackup;
            ok = outsideBackup.replaceWithText(version1)
                && !beat::restoreProjectBackup(projectFile, outsideBackup, outsideError, &ignoredBackup)
                && outsideError.containsIgnoreCase("outside");
            if (!ok)
            {
                std::cerr << "Project backup restore should reject outside backup: "
                          << outsideError << "\n";
            }
        }

        if (ok)
        {
            const auto corruptBackup = beat::projectBackupFolderFor(projectFile).getChildFile("Corrupt.beat");
            juce::String corruptError;
            juce::File ignoredBackup;
            ok = corruptBackup.replaceWithText("{not-json")
                && !beat::restoreProjectBackup(projectFile, corruptBackup, corruptError, &ignoredBackup)
                && corruptError.containsIgnoreCase("validation");
            if (!ok)
            {
                std::cerr << "Project backup restore should reject corrupt backup: "
                          << corruptError << "\n";
            }
        }

        root.deleteRecursively();
        return ok;
    }

    bool stressAudioEngineSampleLoopAndOneShot()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-loop.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto looped = renderOfflineBlock(makeSampleLoopOfflineProject(sampleFile, true, false), 36000);
        auto oneShot = renderOfflineBlock(makeSampleLoopOfflineProject(sampleFile, false, true), 16000);

        const double loopEarlyEnergy = bufferWindowEnergy(looped, 0, 4000);
        const double loopLateEnergy = bufferWindowEnergy(looped, 26000, 4000);
        const double oneShotEarlyEnergy = bufferWindowEnergy(oneShot, 0, 1200);
        const double oneShotLateEnergy = bufferWindowEnergy(oneShot, 7000, 2000);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(loopEarlyEnergy)
            && std::isfinite(loopLateEnergy)
            && std::isfinite(oneShotEarlyEnergy)
            && std::isfinite(oneShotLateEnergy)
            && loopEarlyEnergy > 0.0001
            && loopLateEnergy > loopEarlyEnergy * 0.05
            && oneShotEarlyEnergy > 0.0001
            && oneShotLateEnergy > oneShotEarlyEnergy * 0.01;
        if (!ok)
            std::cerr << "Sample loop/one-shot loopEarly=" << loopEarlyEnergy
                      << " loopLate=" << loopLateEnergy
                      << " oneShotEarly=" << oneShotEarlyEnergy
                      << " oneShotLate=" << oneShotLateEnergy << "\n";
        return ok;
    }

    bool stressAudioEngineSampleChokeGroups()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-choke.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto stacked = renderOfflineBlock(makeSampleChokeOfflineProject(sampleFile, 0), 14000);
        auto choked = renderOfflineBlock(makeSampleChokeOfflineProject(sampleFile, 1), 14000);

        const double stackedLateEnergy = bufferWindowEnergy(stacked, 5200, 2500);
        const double chokedLateEnergy = bufferWindowEnergy(choked, 5200, 2500);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(stackedLateEnergy)
            && std::isfinite(chokedLateEnergy)
            && stackedLateEnergy > 0.0001
            && chokedLateEnergy > 0.0001
            && chokedLateEnergy < stackedLateEnergy * 0.45;
        if (!ok)
            std::cerr << "Sample choke stackedLate=" << stackedLateEnergy
                      << " chokedLate=" << chokedLateEnergy << "\n";
        return ok;
    }

    bool stressAudioEngineOfflineExport()
    {
        auto file = juce::File("/private/tmp").getChildFile("BeatBackendStress-export.wav");
        if (file.existsAsFile())
            file.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(makeTinyOfflineProject(), file, 44100.0, 256, 2, &error))
        {
            std::cerr << "Offline export error: " << error << "\n";
            return false;
        }
        if (!file.existsAsFile() || file.getSize() <= 44)
            return false;

        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr || reader->lengthInSamples <= 0 || reader->numChannels < 1)
            return false;

        juce::AudioBuffer<float> buffer((int) reader->numChannels, (int) juce::jmin<juce::int64>(reader->lengthInSamples, 44100));
        reader->read(&buffer, 0, buffer.getNumSamples(), 0, true, true);

        double energy = 0.0;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(ch, i);
                if (!std::isfinite(sample))
                    return false;
                energy += (double) sample * (double) sample;
            }
        }

        const auto analysis = beat::AudioFileAnalyzer::analyzeFile(file);
        if (!analysis
            || analysis->lengthInSamples <= 0
            || analysis->channelCount < 1
            || !std::isfinite(analysis->truePeakDbTP)
            || !std::isfinite(analysis->rmsDbFS)
            || analysis->clippingRatio < 0.0f)
        {
            std::cerr << "Offline export analysis failed\n";
            return false;
        }

        file.deleteFile();

        for (const int bitDepth : { 24, 32 })
        {
            auto formatFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-export-"
                + juce::String(bitDepth) + "bit.wav");
            if (formatFile.existsAsFile())
                formatFile.deleteFile();

            error.clear();
            if (!beat::AudioEngine::renderProjectToWav(makeTinyOfflineProject(),
                                                       formatFile,
                                                       48000.0,
                                                       256,
                                                       2,
                                                       &error,
                                                       {},
                                                       bitDepth))
            {
                std::cerr << "Offline " << bitDepth << "-bit export error: " << error << "\n";
                return false;
            }

            std::unique_ptr<juce::AudioFormatReader> formatReader(formatManager.createReaderFor(formatFile));
            const bool formatOk = formatReader != nullptr
                && formatReader->lengthInSamples > 0
                && (int) formatReader->numChannels == 2
                && (int) std::round(formatReader->sampleRate) == 48000
                && (int) formatReader->bitsPerSample == bitDepth;
            const auto formatAnalysis = beat::AudioFileAnalyzer::analyzeFile(formatFile);
            const bool analysisOk = formatAnalysis
                && formatAnalysis->bitDepth == bitDepth
                && formatAnalysis->channelCount == 2
                && (int) std::round(formatAnalysis->sampleRate) == 48000;
            if (!formatOk)
            {
                std::cerr << "Offline " << bitDepth << "-bit export validation failed"
                          << " bits=" << (formatReader != nullptr ? (int) formatReader->bitsPerSample : -1)
                          << " rate=" << (formatReader != nullptr ? formatReader->sampleRate : 0.0)
                          << "\n";
                formatFile.deleteFile();
                return false;
            }
            if (!analysisOk)
            {
                std::cerr << "Offline " << bitDepth << "-bit export analysis validation failed"
                          << " bits=" << (formatAnalysis ? formatAnalysis->bitDepth : -1)
                          << " channels=" << (formatAnalysis ? formatAnalysis->channelCount : -1)
                          << "\n";
                formatFile.deleteFile();
                return false;
            }

            formatFile.deleteFile();
        }

        return energy > 0.0001;
    }

    bool stressAudioEngineOfflineExportProgressAndCancel()
    {
        auto file = juce::File("/private/tmp").getChildFile("BeatBackendStress-export-progress.wav");
        if (file.existsAsFile())
            file.deleteFile();

        juce::String error;
        double lastProgress = -1.0;
        int progressCalls = 0;
        const bool exported = beat::AudioEngine::renderProjectToWav(
            makeTinyOfflineProject(),
            file,
            44100.0,
            256,
            2,
            &error,
            [&lastProgress, &progressCalls](double progress, juce::int64 samplesWritten, juce::int64 totalSamples)
            {
                if (progress < lastProgress || samplesWritten < 0 || totalSamples <= 0)
                    return false;
                lastProgress = progress;
                ++progressCalls;
                return true;
            });

        if (!exported || !file.existsAsFile() || progressCalls < 2 || lastProgress < 0.999)
        {
            std::cerr << "Offline export progress failed: exported=" << exported
                      << " progressCalls=" << progressCalls
                      << " lastProgress=" << lastProgress
                      << " error=" << error << "\n";
            file.deleteFile();
            return false;
        }

        file.deleteFile();

        auto cancelledFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-export-cancel.wav");
        if (cancelledFile.existsAsFile())
            cancelledFile.deleteFile();
        const juce::String preservedContents = "preserve existing render";
        if (!cancelledFile.replaceWithText(preservedContents))
            return false;

        error.clear();
        const bool cancelledExport = beat::AudioEngine::renderProjectToWav(
            makeTinyOfflineProject(),
            cancelledFile,
            44100.0,
            256,
            2,
            &error,
            [](double progress, juce::int64, juce::int64)
            {
                return progress < 0.25;
            });

        const bool ok = !cancelledExport
            && error.containsIgnoreCase("cancel")
            && cancelledFile.existsAsFile()
            && cancelledFile.loadFileAsString() == preservedContents
            && !cancelledFile.getSiblingFile(cancelledFile.getFileName() + ".tmp").existsAsFile();

        if (!ok)
        {
            std::cerr << "Offline export cancel failed: exported=" << cancelledExport
                      << " outputExists=" << cancelledFile.existsAsFile()
                      << " outputContents=" << cancelledFile.loadFileAsString()
                      << " error=" << error << "\n";
        }

        cancelledFile.deleteFile();
        cancelledFile.getSiblingFile(cancelledFile.getFileName() + ".tmp").deleteFile();
        return ok;
    }

    bool stressAudioEngineOfflineRangeExport()
    {
        auto file = juce::File("/private/tmp").getChildFile("BeatBackendStress-export-range.wav");
        if (file.existsAsFile())
            file.deleteFile();

        auto project = makeTinyOfflineProject();
        project.lengthBeats = 2.0;
        project.bpm = 120.0;
        auto& segment = project.tracks.front().segments.front();
        segment.lengthBeats = 1.0;
        auto& note = segment.notes.front();
        note.startBeat = 0.25;
        note.lengthBeats = 0.25;

        juce::String error;
        constexpr double startBeat = 0.25;
        constexpr double endBeat = 0.75;
        if (!beat::AudioEngine::renderProjectRangeToWav(project, startBeat, endBeat, file, false, 44100.0, 256, 2, &error))
        {
            std::cerr << "Offline range export error: " << error << "\n";
            return false;
        }

        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr)
            return false;

        const auto expectedSamples = (juce::int64) std::ceil(((endBeat - startBeat) * 60.0 / project.bpm) * 44100.0);
        const bool lengthOk = std::llabs(reader->lengthInSamples - expectedSamples) <= 1;
        const int compareSamples = (int) juce::jmin<juce::int64>(reader->lengthInSamples, expectedSamples);
        auto exported = readWavPrefix(file, compareSamples);
        auto live = renderOfflineRangeChunks(project, startBeat, compareSamples, 256, 44100.0);

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        bool parityOk = exported.getNumChannels() == live.getNumChannels()
            && exported.getNumSamples() >= compareSamples
            && live.getNumSamples() >= compareSamples
            && compareSamples > 0;

        if (parityOk)
        {
            for (int ch = 0; ch < live.getNumChannels(); ++ch)
            {
                for (int i = 0; i < compareSamples; ++i)
                {
                    const float liveSample = live.getSample(ch, i);
                    const float exportSample = exported.getSample(ch, i);
                    if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    {
                        parityOk = false;
                        break;
                    }

                    const float diff = std::abs(liveSample - exportSample);
                    maxAbsDiff = std::max(maxAbsDiff, diff);
                    sumAbsDiff += diff;
                    liveEnergy += (double) liveSample * (double) liveSample;
                }
                if (!parityOk)
                    break;
            }
        }

        const double meanAbsDiff = compareSamples > 0
            ? sumAbsDiff / (double) (live.getNumChannels() * compareSamples)
            : std::numeric_limits<double>::infinity();
        parityOk = parityOk
            && liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;

        juce::String emptyError;
        const bool emptyRejected = !beat::AudioEngine::renderProjectRangeToWav(project,
                                                                               1.0,
                                                                               1.0,
                                                                               file,
                                                                               false,
                                                                               44100.0,
                                                                               256,
                                                                               2,
                                                                               &emptyError)
            && emptyError.containsIgnoreCase("empty");

        file.deleteFile();
        const bool ok = lengthOk && parityOk && emptyRejected;
        if (!ok)
            std::cerr << "Offline range export length=" << reader->lengthInSamples
                      << " expected=" << expectedSamples
                      << " parity=" << parityOk
                      << " liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff
                      << " emptyError=" << emptyError << "\n";
        return ok;
    }

    bool stressAudioEngineReviewLoopRangeExportParity()
    {
        auto file = juce::File("/private/tmp").getChildFile("BeatBackendStress-review-loop-range.wav");
        if (file.existsAsFile())
            file.deleteFile();

        auto project = makeTinyOfflineProject();
        project.lengthBeats = 4.0;
        project.bpm = 120.0;
        auto& segment = project.tracks.front().segments.front();
        segment.lengthBeats = 2.0;
        auto& note = segment.notes.front();
        note.startBeat = 0.5;
        note.lengthBeats = 0.35;

        constexpr double startBeat = 0.25;
        constexpr double endBeat = 1.25;
        constexpr double sampleRate = 44100.0;
        constexpr int blockSize = 257;
        juce::String error;
        if (!beat::AudioEngine::renderProjectRangeToWav(project, startBeat, endBeat, file, false, sampleRate, blockSize, 2, &error))
        {
            std::cerr << "Review-loop range export error: " << error << "\n";
            return false;
        }

        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr)
        {
            file.deleteFile();
            return false;
        }

        const auto expectedSamples = (juce::int64) std::ceil(((endBeat - startBeat) * 60.0 / project.bpm) * sampleRate);
        const int compareSamples = (int) juce::jmin<juce::int64>(reader->lengthInSamples, expectedSamples);
        auto exported = readWavPrefix(file, compareSamples);
        auto loopLive = renderOfflineLoopRangeChunks(project, startBeat, endBeat, compareSamples, blockSize, sampleRate);

        double sumAbsDiff = 0.0;
        double liveEnergy = 0.0;
        float maxAbsDiff = 0.0f;
        bool parityOk = compareSamples > 0
            && exported.getNumChannels() == loopLive.getNumChannels()
            && exported.getNumSamples() >= compareSamples
            && loopLive.getNumSamples() >= compareSamples;

        if (parityOk)
        {
            for (int ch = 0; ch < loopLive.getNumChannels(); ++ch)
            {
                for (int i = 0; i < compareSamples; ++i)
                {
                    const float liveSample = loopLive.getSample(ch, i);
                    const float exportSample = exported.getSample(ch, i);
                    if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    {
                        parityOk = false;
                        break;
                    }

                    const float diff = std::abs(liveSample - exportSample);
                    maxAbsDiff = std::max(maxAbsDiff, diff);
                    sumAbsDiff += diff;
                    liveEnergy += (double) liveSample * (double) liveSample;
                }

                if (!parityOk)
                    break;
            }
        }

        const double meanAbsDiff = compareSamples > 0
            ? sumAbsDiff / (double) (loopLive.getNumChannels() * compareSamples)
            : std::numeric_limits<double>::infinity();
        const bool lengthOk = std::llabs(reader->lengthInSamples - expectedSamples) <= 1;
        parityOk = parityOk
            && liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;

        file.deleteFile();
        const bool ok = lengthOk && parityOk;
        if (!ok)
            std::cerr << "Review-loop range export parity failed"
                      << " length=" << reader->lengthInSamples
                      << " expected=" << expectedSamples
                      << " liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff
                      << "\n";
        return ok;
    }

    bool stressAudioEngineLiveExportParity()
    {
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 1.0;
        project.eqAutomation.push_back({ 0.0, -5.5f, 3.0f, -2.0f, 4.0f });

        beat::TrackEffect saturator;
        saturator.id = "parity-saturator";
        saturator.kind = beat::TrackEffectKind::Saturator;
        saturator.params.push_back({ "drive", 35.0f });
        saturator.params.push_back({ "mix", 70.0f });
        project.tracks.front().effects.push_back(std::move(saturator));

        constexpr int samples = 4096;
        auto live = renderOfflineChunks(project, samples, 256);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-live-export-parity.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Live/export parity export error: " << error << "\n";
            return false;
        }

        auto exported = readWavPrefix(exportFile, samples);
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
            return false;

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        return liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
    }

    bool stressAudioEngineNodemapLiveExportParity()
    {
        auto project = makeNodemapOfflineProject();
        constexpr int samples = 12000;
        constexpr int blockSize = 257;
        auto live = renderOfflineChunks(project, samples, blockSize);
        const double liveEnergy = bufferEnergy(live);

        if (!std::isfinite(liveEnergy) || liveEnergy <= 0.0001)
        {
            std::cerr << "Native Nodemap live render was silent or invalid energy=" << liveEnergy << "\n";
            return false;
        }

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-nodemap-live-export-parity.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, blockSize, 2, &error))
        {
            std::cerr << "Native Nodemap export error: " << error << "\n";
            return false;
        }

        auto exported = readWavPrefix(exportFile, samples);
        exportFile.deleteFile();
        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
            return false;

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        const bool ok = maxAbsDiff <= 0.00008f && meanAbsDiff <= 0.00002;
        if (!ok)
            std::cerr << "Native Nodemap live/export parity failed energy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        return ok;
    }

    bool stressAudioEngineInstrumentEffectLiveExportParity()
    {
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 1.0;

        beat::TrackEffect saturator;
        saturator.id = "instrument-parity-saturator";
        saturator.kind = beat::TrackEffectKind::Saturator;
        saturator.params.push_back({ "drive", 42.0f });
        saturator.params.push_back({ "mix", 85.0f });
        project.instruments.front().effects.push_back(std::move(saturator));

        constexpr int samples = 4096;
        auto live = renderOfflineChunks(project, samples, 257);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-instrument-effect-parity.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 257, 2, &error))
        {
            std::cerr << "Instrument effect parity export error: " << error << "\n";
            return false;
        }

        auto exported = readWavPrefix(exportFile, samples);
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
            return false;

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        const bool ok = liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
        if (!ok)
        {
            std::cerr << "Instrument effect live/export parity failed liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineInstrumentEffectExportTail()
    {
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 1.0;

        beat::TrackEffect delay;
        delay.id = "instrument-tail-delay";
        delay.kind = beat::TrackEffectKind::Delay;
        delay.params.push_back({ "timeMs", 180.0f });
        delay.params.push_back({ "feedback", 55.0f });
        delay.params.push_back({ "mix", 65.0f });
        project.instruments.front().effects.push_back(std::move(delay));

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-instrument-tail.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Instrument effect tail export error: " << error << "\n";
            return false;
        }

        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(exportFile));
        if (reader == nullptr)
            return false;

        const auto expectedMinimumSamples = (juce::int64) std::ceil((60.0 / project.bpm) * project.lengthBeats * 44100.0);
        const bool lengthIncludesTail = reader->lengthInSamples > expectedMinimumSamples + 1000;
        const double energy = wavEnergy(exportFile);
        exportFile.deleteFile();

        const bool ok = lengthIncludesTail && std::isfinite(energy) && energy > 0.0001;
        if (!ok)
        {
            std::cerr << "Instrument effect tail export failed length="
                      << (reader != nullptr ? reader->lengthInSamples : 0)
                      << " minimum=" << expectedMinimumSamples
                      << " energy=" << energy << "\n";
        }
        return ok;
    }

    bool stressAudioEngineEffectAutomationLiveExportParity()
    {
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 2.0;

        beat::TrackEffect filter;
        filter.id = "effect-automation-filter";
        filter.kind = beat::TrackEffectKind::Lowpass;
        filter.params.push_back({ "cutoffHz", 250.0f });
        filter.params.push_back({ "resonance", 0.15f });

        beat::MidiAutomationLane cutoffLane;
        cutoffLane.target = "cutoffHz";
        cutoffLane.points.push_back({ 0.0, 250.0f, beat::AutomationCurve::Linear });
        cutoffLane.points.push_back({ 0.5, 9000.0f, beat::AutomationCurve::Quadratic });
        cutoffLane.points.push_back({ 1.25, 1200.0f, beat::AutomationCurve::Cubic });
        filter.automation.push_back(std::move(cutoffLane));
        project.tracks.front().effects.push_back(std::move(filter));

        auto staticProject = project;
        staticProject.tracks.front().effects.front().automation.clear();

        constexpr int samples = 44100;
        auto live = renderOfflineChunks(project, samples, 257);
        auto staticRender = renderOfflineChunks(staticProject, samples, 257);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-effect-automation-parity.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 257, 2, &error))
        {
            std::cerr << "Effect automation parity export error: " << error << "\n";
            return false;
        }

        auto exported = readWavPrefix(exportFile, samples);
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
            return false;

        double liveStaticAbsDiff = 0.0;
        double liveExportAbsDiff = 0.0;
        float maxExportAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float staticSample = staticRender.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(staticSample) || !std::isfinite(exportSample))
                    return false;

                liveStaticAbsDiff += std::abs(liveSample - staticSample);
                const float exportDiff = std::abs(liveSample - exportSample);
                maxExportAbsDiff = std::max(maxExportAbsDiff, exportDiff);
                liveExportAbsDiff += exportDiff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double sampleCount = (double) (live.getNumChannels() * samples);
        const double meanStaticDiff = liveStaticAbsDiff / sampleCount;
        const double meanExportDiff = liveExportAbsDiff / sampleCount;
        const bool ok = liveEnergy > 0.0001
            && meanStaticDiff > 0.00001
            && maxExportAbsDiff <= 0.00008f
            && meanExportDiff <= 0.00002;

        if (!ok)
        {
            std::cerr << "Effect automation parity failed liveEnergy=" << liveEnergy
                      << " meanStaticDiff=" << meanStaticDiff
                      << " maxExportDiff=" << maxExportAbsDiff
                      << " meanExportDiff=" << meanExportDiff << "\n";
        }

        return ok;
    }

    bool stressAudioEngineSampleRateMatrix()
    {
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 1.0;
        project.eqAutomation.push_back({ 0.0, -2.0f, 1.5f, -1.0f, 2.5f });

        beat::TrackEffect delay;
        delay.id = "sample-rate-matrix-delay";
        delay.kind = beat::TrackEffectKind::Delay;
        delay.params.push_back({ "timeMs", 18.0f });
        delay.params.push_back({ "feedback", 12.0f });
        delay.params.push_back({ "mix", 18.0f });
        project.tracks.front().effects.push_back(std::move(delay));

        constexpr int samples = 4096;
        for (double sampleRate : { 44100.0, 48000.0, 96000.0 })
        {
            auto live = renderOfflineChunks(project, samples, 256, sampleRate);

            auto exportFile = juce::File("/private/tmp").getChildFile(
                "BeatBackendStress-sample-rate-matrix-" + juce::String((int) sampleRate) + ".wav");
            if (exportFile.existsAsFile())
                exportFile.deleteFile();

            juce::String error;
            if (!beat::AudioEngine::renderProjectToWav(project, exportFile, sampleRate, 256, 2, &error))
            {
                std::cerr << "Sample-rate matrix export error at " << sampleRate << ": " << error << "\n";
                return false;
            }

            auto exported = readWavPrefix(exportFile, samples);
            exportFile.deleteFile();

            if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
                return false;

            double sumAbsDiff = 0.0;
            float maxAbsDiff = 0.0f;
            double liveEnergy = 0.0;
            for (int ch = 0; ch < live.getNumChannels(); ++ch)
            {
                for (int i = 0; i < samples; ++i)
                {
                    const float liveSample = live.getSample(ch, i);
                    const float exportSample = exported.getSample(ch, i);
                    if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                        return false;

                    const float diff = std::abs(liveSample - exportSample);
                    maxAbsDiff = std::max(maxAbsDiff, diff);
                    sumAbsDiff += diff;
                    liveEnergy += (double) liveSample * (double) liveSample;
                }
            }

            const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
            const bool ok = liveEnergy > 0.0001
                && maxAbsDiff <= 0.00008f
                && meanAbsDiff <= 0.00002;
            if (!ok)
            {
                std::cerr << "Sample-rate matrix failed at " << sampleRate
                          << " liveEnergy=" << liveEnergy
                          << " maxAbsDiff=" << maxAbsDiff
                          << " meanAbsDiff=" << meanAbsDiff << "\n";
                return false;
            }
        }

        return true;
    }

    bool stressAudioEngineSampleLiveExportParity()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-parity-source.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto project = makeSampleLoopOfflineProject(sampleFile, true, false);
        project.lengthBeats = 2.0;

        constexpr int samples = 12000;
        auto live = renderOfflineChunks(project, samples, 256);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-live-export-parity.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Sample live/export parity export error: " << error << "\n";
            sampleFile.deleteFile();
            return false;
        }

        auto exported = readWavPrefix(exportFile, samples);
        sampleFile.deleteFile();
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
            return false;

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        return liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
    }

    bool stressAudioEngineAetherSampleSlotLiveExportParity()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-aether-slot-source.wav");
        if (!writeAudioClipFixture(sampleFile, 9 * 44100)) return false;

        auto project = makeDenseAetherProject();
        project.lengthBeats = 2.0;
        project.audioFiles.push_back({ "aether-slot-asset", "Aether Slot Fixture",
            sampleFile.getFullPathName(), 9.0, 44100.0 });
        auto& instrument = project.instruments.front();
        instrument.aether.oscA.enabled = false;
        instrument.aether.oscB.enabled = false;
        instrument.aether.sub.enabled = false;
        instrument.aether.noise.enabled = false;
        instrument.aether.sampleSlot1 = { 4, true, "aether-slot-asset", 69, 0.72f, -0.18f, 0,
            0.1f, 0.9f, true, 0.25f, 0.75f };
        instrument.aether.sampleSlot1.zones.push_back({ "aether-slot-asset", 69, 0, 80, 0, 127,
            0.72f, -0.18f, 0.1f, 0.9f, true, 0.25f, 0.75f });
        instrument.aether.sampleSlot1.zones.push_back({ "aether-slot-asset", 81, 40, 127, 0, 127,
            0.68f, 0.18f, 0.0f, 1.0f, false, 0.0f, 1.0f });

        constexpr int samples = 12000;
        const auto live = renderOfflineChunks(project, samples, 257);
        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-aether-slot-parity.wav");
        if (exportFile.existsAsFile()) exportFile.deleteFile();
        juce::String error;
        const bool exportedOk = beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 257, 2, &error);
        const auto exported = exportedOk ? readWavPrefix(exportFile, samples) : juce::AudioBuffer<float>();

        auto missingProject = project;
        missingProject.instruments.front().aether.sampleSlot1.audioFileId = "missing-asset";
        for (auto& zone : missingProject.instruments.front().aether.sampleSlot1.zones)
            zone.audioFileId = "missing-asset";
        const auto missing = renderOfflineChunks(missingProject, samples, 257);

        auto explicitOfflineEngine = std::make_unique<beat::AudioEngine>();
        explicitOfflineEngine->prepareForOffline(44100.0, 257, 2);
        explicitOfflineEngine->applyProject(project);
        beat::AudioEngine::SampleStreamingSnapshot offlineStreaming;
        const bool offlineWasStreamed = explicitOfflineEngine->pullSampleStreamingSnapshot(offlineStreaming);

        auto streamingEngine = std::make_unique<beat::AudioEngine>();
        streamingEngine->prepareForRealtime(44100.0, 257, 2);
        streamingEngine->applyProject(project);
        beat::AudioEngine::SampleStreamingSnapshot initialStreaming;
        const bool streamingSelected = streamingEngine->pullSampleStreamingSnapshot(initialStreaming);
        streamingEngine->requestPlay();
        juce::AudioBuffer<float> streamed(2, samples);
        streamed.clear();
        int streamedOffset = 0;
        while (streamedOffset < samples)
        {
            const int count = std::min(257, samples - streamedOffset);
            const auto block = renderEngineBlock(*streamingEngine, count);
            for (int channel = 0; channel < streamed.getNumChannels(); ++channel)
                streamed.copyFrom(channel, streamedOffset, block, channel, 0, count);
            streamedOffset += count;
        }
        (void) renderEngineBlock(*streamingEngine, 257);
        juce::AudioBuffer<float> streamingProbeOutput(2, 257);
        std::array<float*, 2> streamingProbeChannels {
            streamingProbeOutput.getWritePointer(0), streamingProbeOutput.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext streamingProbeContext;
        beat::test::beginRealtimeSafetyProbe();
        streamingEngine->audioDeviceIOCallbackWithContext(
            nullptr, 0, streamingProbeChannels.data(), 2, 257, streamingProbeContext);
        const size_t streamingCallbackViolations = beat::test::endRealtimeSafetyProbe();
        if (streamingCallbackViolations != 0)
            for (size_t index = 0; index < std::min<size_t>(streamingCallbackViolations, 128); ++index)
            {
                Dl_info info {};
                const auto violation = beat::test::realtimeSafetyViolation(index);
                if (violation.callsite != nullptr && dladdr(violation.callsite, &info) != 0)
                    std::cerr << "  streaming callback violation kind=" << (int) violation.kind
                              << " symbol=" << (info.dli_sname ? info.dli_sname : "unknown")
                              << " offset=" << (static_cast<const char*>(violation.callsite)
                                  - static_cast<const char*>(info.dli_saddr)) << "\n";
            }
        beat::AudioEngine::SampleStreamingSnapshot finalStreaming;
        const bool finalStreamingAvailable = streamingEngine->pullSampleStreamingSnapshot(finalStreaming);

        auto sharedAssetProject = project;
        if (!sharedAssetProject.tracks.empty() && !sharedAssetProject.tracks.front().segments.empty())
            sharedAssetProject.tracks.front().segments.front().audioFileId = "aether-slot-asset";
        auto sharedAssetEngine = std::make_unique<beat::AudioEngine>();
        sharedAssetEngine->prepareForRealtime(44100.0, 257, 2);
        sharedAssetEngine->applyProject(std::move(sharedAssetProject));
        beat::AudioEngine::SampleStreamingSnapshot sharedAssetStreaming;
        const bool sharedAssetWasStreamed = sharedAssetEngine->pullSampleStreamingSnapshot(sharedAssetStreaming);

        beat::AudioEngine transitionEngine;
        transitionEngine.prepareForOffline(44100.0, 257, 2);
        transitionEngine.applyProject(project);
        transitionEngine.requestPlay();
        const auto beforeReplacement = renderEngineBlock(transitionEngine, 4096);
        const float previousLeft = beforeReplacement.getSample(0, beforeReplacement.getNumSamples() - 1);
        const float previousRight = beforeReplacement.getSample(1, beforeReplacement.getNumSamples() - 1);
        auto replacementProject = project;
        replacementProject.instruments.front().aether.sampleSlot1.rootNote = 57;
        replacementProject.instruments.front().aether.sampleSlot1.pan = 0.62f;
        replacementProject.instruments.front().aether.sampleSlot1.startRatio = 0.2f;
        replacementProject.instruments.front().aether.sampleSlot1.zones[0].startRatio = 0.2f;
        transitionEngine.applyProject(std::move(replacementProject));
        const auto afterReplacement = renderEngineBlock(transitionEngine, 257);
        const float replacementBoundaryStep = juce::jmax(
            std::abs(afterReplacement.getSample(0, 0) - previousLeft),
            std::abs(afterReplacement.getSample(1, 0) - previousRight));
        sampleFile.deleteFile();
        exportFile.deleteFile();
        if (!exportedOk || exported.getNumSamples() < samples)
        {
            std::cerr << "Aether sample slot export failed: " << error << "\n";
            return false;
        }

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        for (int channel = 0; channel < live.getNumChannels(); ++channel)
            for (int sample = 0; sample < samples; ++sample)
            {
                const float a = live.getSample(channel, sample);
                const float b = exported.getSample(channel, sample);
                if (!std::isfinite(a) || !std::isfinite(b)) return false;
                const float diff = std::abs(a - b);
                sumAbsDiff += diff;
                maxAbsDiff = std::max(maxAbsDiff, diff);
            }
        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        const bool ok = bufferEnergy(live) > 0.0001
            && streamingSelected
            && initialStreaming.assetCount == 1
            && finalStreamingAvailable
            && finalStreaming.cache.pagesLoaded > 0
            && finalStreaming.cache.cacheHits > 0
            && streamingCallbackViolations == 0
            && bufferEnergy(streamed) > 0.0001
            && !offlineWasStreamed
            && !sharedAssetWasStreamed
            && bufferEnergy(missing) < 0.0000001
            && std::isfinite(replacementBoundaryStep)
            && bufferEnergy(afterReplacement) > 0.000001
            && replacementBoundaryStep < 0.2f
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
        if (!ok)
            std::cerr << "Aether streaming fixture failed liveEnergy=" << bufferEnergy(live)
                      << " streamingSelected=" << streamingSelected
                      << " assets=" << initialStreaming.assetCount
                      << " final=" << finalStreamingAvailable
                      << " loads=" << finalStreaming.cache.pagesLoaded
                      << " hits=" << finalStreaming.cache.cacheHits
                      << " callbackViolations=" << streamingCallbackViolations
                      << " streamedEnergy=" << bufferEnergy(streamed)
                      << " offlineStreamed=" << offlineWasStreamed
                      << " sharedStreamed=" << sharedAssetWasStreamed
                      << " missingEnergy=" << bufferEnergy(missing)
                      << " boundary=" << replacementBoundaryStep
                      << " maxDiff=" << maxAbsDiff << " meanDiff=" << meanAbsDiff << "\n";
        return ok;
    }

    bool stressAudioEngineMixedLiveExportParity()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-mixed-sample.wav");
        auto clipFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-mixed-clip.wav");
        if (!writeAudioClipFixture(sampleFile) || !writeAudioClipFixture(clipFile))
            return false;

        auto project = makeMixedRenderProject(sampleFile, clipFile);
        constexpr int samples = 44100;
        auto live = renderOfflineChunks(project, samples, 256);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-mixed-live-export-parity.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Mixed live/export parity export error: " << error << "\n";
            sampleFile.deleteFile();
            clipFile.deleteFile();
            return false;
        }

        auto exported = readWavPrefix(exportFile, samples);
        sampleFile.deleteFile();
        clipFile.deleteFile();
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
            return false;

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        const bool ok = liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
        if (!ok)
            std::cerr << "Mixed live/export parity liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        return ok;
    }

    bool hasSfzDiagnostic(const beat::SfzSubsetImport& parsed,
                          const juce::String& code,
                          beat::SfzDiagnosticSeverity severity)
    {
        return std::any_of(parsed.diagnostics.begin(), parsed.diagnostics.end(),
                           [&](const beat::SfzDiagnostic& diagnostic) {
            return diagnostic.code == code && diagnostic.severity == severity;
        });
    }

    bool stressSfzSubsetImporter()
    {
        const juce::String valid = R"sfz(
// Beat-owned bounded subset fixture
<control> default_path=Samples/Strings
<global> volume=-3 tune=7
<group> lokey=C3 hikey=B3 lovel=1 hivel=100 group=4 off_by=7
<region> sample=Soft Strings.wav pitch_keycenter=C4 loop_mode=loop_continuous loop_start=128 loop_end=2048 seq_length=3 seq_position=2 mystery_opcode=9
<group> lokey=C4 hikey=C5 lovel=101 hivel=127
<region> sample="Hard Strings.wav" key=C5 volume=-1 trigger=release offset=32 end=4096
)sfz";

        const auto parsed = beat::parseSfzSubsetText(valid);
        const auto repeated = beat::parseSfzSubsetText(valid);
        if (!parsed.isAccepted() || parsed.regions.size() != 2
            || parsed.defaultPath != "Samples/Strings"
            || parsed.ignoredOpcodeCount != 1
            || !hasSfzDiagnostic(parsed, "sfz.opcode.unsupported",
                                 beat::SfzDiagnosticSeverity::warning)
            || repeated.regions.size() != parsed.regions.size()
            || repeated.diagnostics.size() != parsed.diagnostics.size())
        {
            std::cerr << "SFZ valid subset parse failed accepted=" << parsed.isAccepted()
                      << " regions=" << parsed.regions.size()
                      << " ignored=" << parsed.ignoredOpcodeCount
                      << " diagnostics=" << parsed.diagnostics.size() << "\n";
            return false;
        }

        const auto& soft = parsed.regions[0];
        const auto& hard = parsed.regions[1];
        if (soft.samplePath != "Samples/Strings/Soft Strings.wav"
            || soft.rootNote != 60 || soft.loNote != 48 || soft.hiNote != 59
            || soft.loVelocity != 1 || soft.hiVelocity != 100
            || !near((float) soft.volumeDb, -3.0f) || !near((float) soft.tuneCents, 7.0f)
            || soft.group != 4 || soft.offBy != 7
            || soft.sequenceLength != 3 || soft.sequencePosition != 2
            || soft.loopMode != "loop_continuous"
            || soft.loopStartFrame != 128 || soft.loopEndFrame != 2048
            || hard.samplePath != "Samples/Strings/Hard Strings.wav"
            || hard.rootNote != 72 || hard.loNote != 60 || hard.hiNote != 72
            || hard.loVelocity != 101 || hard.hiVelocity != 127
            || !near((float) hard.volumeDb, -1.0f) || hard.trigger != "release"
            || hard.offsetFrames != 32 || hard.endFrame != 4096)
        {
            std::cerr << "SFZ inheritance or normalization mismatch\n";
            return false;
        }

        const juce::String malformed = R"sfz(
<region> sample=../escape.wav
<region> sample=ok.wav lokey=90 hikey=20
<region> sample=ok2.wav loop_mode=loop_continuous loop_start=20 loop_end=10
<region> sample=ok3.wav seq_length=2 seq_position=3
<region> sample=ok4.wav trigger=cc
)sfz";
        const auto rejected = beat::parseSfzSubsetText(malformed);
        if (rejected.isAccepted()
            || !hasSfzDiagnostic(rejected, "sfz.path.unsafe", beat::SfzDiagnosticSeverity::error)
            || !hasSfzDiagnostic(rejected, "sfz.region.range", beat::SfzDiagnosticSeverity::error)
            || !hasSfzDiagnostic(rejected, "sfz.region.loop-range", beat::SfzDiagnosticSeverity::error)
            || !hasSfzDiagnostic(rejected, "sfz.region.sequence", beat::SfzDiagnosticSeverity::error)
            || !hasSfzDiagnostic(rejected, "sfz.trigger.unsupported", beat::SfzDiagnosticSeverity::error))
        {
            std::cerr << "SFZ malformed-input diagnostics failed count="
                      << rejected.diagnostics.size() << "\n";
            return false;
        }

        for (const auto& unsafe : {
                 juce::String("<region> sample=/absolute.wav"),
                 juce::String("<region> sample=C:\\drive.wav"),
                 juce::String("<control> default_path=../escape <region> sample=ok.wav"),
             })
        {
            const auto unsafeResult = beat::parseSfzSubsetText(unsafe);
            if (!unsafeResult.hasErrors()
                || !hasSfzDiagnostic(unsafeResult, "sfz.path.unsafe",
                                     beat::SfzDiagnosticSeverity::error))
                return false;
        }

        beat::SfzSubsetParseLimits sourceLimit;
        sourceLimit.maximumSourceBytes = 8;
        const auto sourceLimited = beat::parseSfzSubsetText("<region> sample=ok.wav", sourceLimit);
        if (!hasSfzDiagnostic(sourceLimited, "sfz.limit.source",
                              beat::SfzDiagnosticSeverity::error))
            return false;

        beat::SfzSubsetParseLimits opcodeLimit;
        opcodeLimit.maximumOpcodes = 2;
        const auto opcodeLimited = beat::parseSfzSubsetText(
            "<region> sample=ok.wav key=60 volume=-2", opcodeLimit);
        if (!hasSfzDiagnostic(opcodeLimited, "sfz.limit.opcodes",
                              beat::SfzDiagnosticSeverity::error))
            return false;

        beat::SfzSubsetParseLimits regionLimit;
        regionLimit.maximumRegions = 1;
        const auto regionLimited = beat::parseSfzSubsetText(
            "<region> sample=one.wav\n<region> sample=two.wav", regionLimit);
        if (!hasSfzDiagnostic(regionLimited, "sfz.limit.regions",
                              beat::SfzDiagnosticSeverity::error)
            || regionLimited.regions.size() != 1)
            return false;

        const auto orphan = beat::parseSfzSubsetText("sample=orphan.wav");
        if (!hasSfzDiagnostic(orphan, "sfz.opcode.orphan",
                              beat::SfzDiagnosticSeverity::error))
            return false;

        const auto ignoredSection = beat::parseSfzSubsetText(
            "<curve> v_000=0.0\n<region> sample=ok.wav");
        if (!ignoredSection.isAccepted() || ignoredSection.ignoredOpcodeCount != 1
            || !hasSfzDiagnostic(ignoredSection, "sfz.header.unsupported",
                                 beat::SfzDiagnosticSeverity::warning)
            || !hasSfzDiagnostic(ignoredSection, "sfz.opcode.unsupported-section",
                                 beat::SfzDiagnosticSeverity::warning))
            return false;

        beat::SfzSubsetParseLimits diagnosticLimit;
        diagnosticLimit.maximumDiagnostics = 0;
        const auto diagnosticsSuppressed = beat::parseSfzSubsetText(
            "<region> sample=../escape.wav", diagnosticLimit);
        if (!diagnosticsSuppressed.hasErrors() || diagnosticsSuppressed.errorCount == 0
            || !diagnosticsSuppressed.diagnostics.empty())
            return false;

        auto file = juce::File("/private/tmp").getChildFile("BeatBackendStress-subset.sfz");
        if (file.existsAsFile()) file.deleteFile();
        if (!file.replaceWithText(valid))
            return false;
        const auto fromFile = beat::parseSfzSubsetFile(file);
        file.deleteFile();
        const auto missing = beat::parseSfzSubsetFile(file);
        return fromFile.isAccepted() && fromFile.sourceName == "BeatBackendStress-subset.sfz"
            && missing.hasErrors()
            && hasSfzDiagnostic(missing, "sfz.file.missing", beat::SfzDiagnosticSeverity::error);
    }

    bool hasSfzResolutionDiagnostic(const beat::SfzSampleResolution& resolved,
                                    const juce::String& code,
                                    beat::SfzDiagnosticSeverity severity)
    {
        return std::any_of(resolved.diagnostics.begin(), resolved.diagnostics.end(),
                           [&](const beat::SfzDiagnostic& diagnostic) {
            return diagnostic.code == code && diagnostic.severity == severity;
        });
    }

    bool stressSfzSampleResolver()
    {
        auto root = juce::File("/private/tmp").getChildFile("BeatBackendStress-sfz-resolve");
        auto outside = juce::File("/private/tmp").getChildFile("BeatBackendStress-sfz-outside.wav");
        if (root.exists()) root.deleteRecursively();
        if (outside.existsAsFile()) outside.deleteFile();

        bool passed = false;
        do
        {
            const auto samples = root.getChildFile("Samples");
            const auto sfzFile = root.getChildFile("instrument.sfz");
            const auto soft = samples.getChildFile("soft.wav");
            const auto hard = samples.getChildFile("hard.flac");
            const auto binary = samples.getChildFile("plugin.dylib");
            if (!samples.createDirectory()
                || !soft.replaceWithData("RIFF", 4)
                || !hard.replaceWithData("fLaC!", 5)
                || !binary.replaceWithData("BIN", 3)
                || !outside.replaceWithData("RIFF", 4))
                break;

            const juce::String source = R"sfz(
<region> sample=Samples/soft.wav lokey=C4 hikey=C4
<region> sample=Samples/soft.wav lokey=C4 hikey=C5 lovel=64
<region> sample=Samples/hard.flac key=D5 seq_length=2 seq_position=1
)sfz";
            if (!sfzFile.replaceWithText(source))
                break;
            const auto parsed = beat::parseSfzSubsetText(source);
            const auto resolved = beat::resolveSfzSubsetSamples(parsed, sfzFile);
            if (!resolved.isAccepted() || resolved.instrument == nullptr
                || resolved.instrument->regions.size() != 3
                || resolved.instrument->totalUniqueSampleBytes != 9
                || !resolved.instrument->hasSequenceMetadata
                || resolved.instrument->noteIndex[60].count != 2
                || resolved.instrument->noteIndex[61].count != 1
                || resolved.instrument->noteIndex[74].count != 1
                || resolved.instrument->noteIndex[60].indices[0] != 0
                || resolved.instrument->noteIndex[60].indices[1] != 1
                || resolved.instrument->regions[0].stableRegionIndex != 0
                || resolved.instrument->regions[2].stableRegionIndex != 2
                || resolved.instrument->regions[0].sampleFile != soft)
            {
                std::cerr << "SFZ sample resolution/index failed accepted=" << resolved.isAccepted()
                          << " errors=" << resolved.errorCount << "\n";
                break;
            }

            const auto missing = beat::resolveSfzSubsetSamples(
                beat::parseSfzSubsetText("<region> sample=Samples/missing.wav"), sfzFile);
            if (!hasSfzResolutionDiagnostic(missing, "sfz.resolve.sample-missing",
                                            beat::SfzDiagnosticSeverity::error))
                break;

            const auto wrongType = beat::resolveSfzSubsetSamples(
                beat::parseSfzSubsetText("<region> sample=Samples/plugin.dylib"), sfzFile);
            if (!hasSfzResolutionDiagnostic(wrongType, "sfz.resolve.file-type",
                                            beat::SfzDiagnosticSeverity::error))
                break;

            const auto link = samples.getChildFile("escape.wav");
            if (::symlink(outside.getFullPathName().toRawUTF8(),
                          link.getFullPathName().toRawUTF8()) != 0)
                break;
            const auto escaped = beat::resolveSfzSubsetSamples(
                beat::parseSfzSubsetText("<region> sample=Samples/escape.wav"), sfzFile);
            if (!hasSfzResolutionDiagnostic(escaped, "sfz.resolve.root-escape",
                                            beat::SfzDiagnosticSeverity::error))
                break;

            beat::SfzSampleResolutionLimits fileLimit;
            fileLimit.maximumSampleFileBytes = 3;
            const auto fileLimited = beat::resolveSfzSubsetSamples(
                beat::parseSfzSubsetText("<region> sample=Samples/soft.wav"), sfzFile, fileLimit);
            if (!hasSfzResolutionDiagnostic(fileLimited, "sfz.resolve.file-size",
                                            beat::SfzDiagnosticSeverity::error))
                break;

            beat::SfzSampleResolutionLimits totalLimit;
            totalLimit.maximumTotalUniqueSampleBytes = 8;
            const auto totalLimited = beat::resolveSfzSubsetSamples(parsed, sfzFile, totalLimit);
            if (!hasSfzResolutionDiagnostic(totalLimited, "sfz.resolve.total-size",
                                            beat::SfzDiagnosticSeverity::error))
                break;

            juce::String crowdedSource;
            for (int region = 0; region < 3; ++region)
                crowdedSource << "<region> sample=Samples/soft.wav key=C4\n";
            beat::SfzSampleResolutionLimits candidateLimit;
            candidateLimit.maximumCandidatesPerNote = 2;
            const auto crowded = beat::resolveSfzSubsetSamples(
                beat::parseSfzSubsetText(crowdedSource), sfzFile, candidateLimit);
            if (!hasSfzResolutionDiagnostic(crowded, "sfz.resolve.note-cap",
                                            beat::SfzDiagnosticSeverity::error))
                break;

            beat::SfzSampleResolutionLimits invalidLimits;
            invalidLimits.maximumCandidatesPerNote = 33;
            const auto invalidConfig = beat::resolveSfzSubsetSamples(parsed, sfzFile, invalidLimits);
            if (!hasSfzResolutionDiagnostic(invalidConfig, "sfz.resolve.limit-config",
                                            beat::SfzDiagnosticSeverity::error))
                break;

            beat::SfzSampleResolutionLimits noDetails;
            noDetails.maximumDiagnostics = 0;
            const auto suppressed = beat::resolveSfzSubsetSamples(
                beat::parseSfzSubsetText("<region> sample=Samples/missing.wav"), sfzFile, noDetails);
            if (!suppressed.hasErrors() || suppressed.errorCount == 0
                || !suppressed.diagnostics.empty())
                break;

            const auto parseRejected = beat::resolveSfzSubsetSamples(
                beat::parseSfzSubsetText("<region> sample=../escape.wav"), sfzFile);
            const auto sourceMissing = beat::resolveSfzSubsetSamples(parsed,
                root.getChildFile("missing.sfz"));
            if (!hasSfzResolutionDiagnostic(parseRejected, "sfz.resolve.parse-rejected",
                                            beat::SfzDiagnosticSeverity::error)
                || !hasSfzResolutionDiagnostic(sourceMissing, "sfz.resolve.source-missing",
                                                beat::SfzDiagnosticSeverity::error))
                break;

            passed = true;
        }
        while (false);

        root.deleteRecursively();
        outside.deleteFile();
        return passed;
    }

    bool hasSfzDecodeDiagnostic(const beat::SfzSampleDecodeResult& decoded,
                                const juce::String& code)
    {
        return std::any_of(decoded.diagnostics.begin(), decoded.diagnostics.end(),
                           [&](const beat::SfzDiagnostic& diagnostic) {
            return diagnostic.code == code
                && diagnostic.severity == beat::SfzDiagnosticSeverity::error;
        });
    }

#if BEAT_SFZ_DECODE_TESTING
    juce::File sfzDecodeHookTarget;
    juce::File sfzDecodeHookOutside;

    void replaceSfzTargetWithSymlink(const juce::File& file)
    {
        if (file != sfzDecodeHookTarget || !file.deleteFile()) return;
        ::symlink(sfzDecodeHookOutside.getFullPathName().toRawUTF8(),
                  file.getFullPathName().toRawUTF8());
    }

    void mutateSfzOpenDescriptor(const juce::File& file)
    {
        if (file != sfzDecodeHookTarget) return;
        const char changed[] = "changed-after-decode";
        file.replaceWithData(changed, sizeof(changed));
    }
#endif

    bool stressSfzSampleDecoder()
    {
        auto root = juce::File("/private/tmp").getChildFile("BeatBackendStress-sfz-decode");
        if (root.exists()) root.deleteRecursively();
        if (!root.createDirectory()) return false;

        const auto sfzFile = root.getChildFile("instrument.sfz");
        const auto monoFile = root.getChildFile("mono.wav");
        const auto stereoFile = root.getChildFile("stereo.wav");
        const auto outsideFile = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-sfz-decode-outside.wav");
        if (outsideFile.existsAsFile()) outsideFile.deleteFile();
        const auto writeWav = [](const juce::File& file, int channels, int frames,
                                 double sampleRate) {
            juce::AudioBuffer<float> audio(channels, frames);
            for (int channel = 0; channel < channels; ++channel)
                for (int frame = 0; frame < frames; ++frame)
                    audio.setSample(channel, frame,
                        0.25f * std::sin((float) frame * 0.031f + (float) channel));
            juce::WavAudioFormat wav;
            auto output = file.createOutputStream();
            std::unique_ptr<juce::AudioFormatWriter> writer(output
                ? wav.createWriterFor(output.get(), sampleRate, channels, 24, {}, 0)
                : nullptr);
            if (!writer) return false;
            output.release();
            return writer->writeFromAudioSampleBuffer(audio, 0, frames);
        };

        bool passed = false;
        do
        {
            if (!writeWav(monoFile, 1, 256, 48000.0)
                || !writeWav(stereoFile, 2, 128, 44100.0))
                break;
            const juce::String source = R"sfz(
<region> sample=mono.wav key=C4
<region> sample=mono.wav key=D4
<region> sample=stereo.wav key=E4
)sfz";
            if (!sfzFile.replaceWithText(source)) break;
            const auto resolved = beat::resolveSfzSubsetSamples(
                beat::parseSfzSubsetText(source), sfzFile);
            const auto decoded = beat::decodeSfzResolvedInstrument(resolved.instrument);
            if (!decoded.isAccepted() || !decoded.instrument
                || decoded.instrument->samples.size() != 2
                || decoded.instrument->regions.size() != 3
                || decoded.instrument->totalDecodedBytes != 2048
                || decoded.instrument->regions[0].sampleIndex != 0
                || decoded.instrument->regions[1].sampleIndex != 0
                || decoded.instrument->regions[2].sampleIndex != 1
                || decoded.instrument->samples[0].audio->getNumChannels() != 1
                || decoded.instrument->samples[0].audio->getNumSamples() != 256
                || decoded.instrument->samples[0].sourceSampleRate != 48000.0
                || decoded.instrument->samples[1].audio->getNumChannels() != 2
                || decoded.instrument->noteIndex[60].count != 1
                || decoded.instrument->noteIndex[62].count != 1
                || decoded.instrument->noteIndex[64].count != 1)
            {
                std::cerr << "SFZ decode failed accepted=" << decoded.isAccepted()
                          << " errors=" << decoded.errorCount << "\n";
                break;
            }

            const auto repeated = beat::decodeSfzResolvedInstrument(resolved.instrument);
            if (!repeated.isAccepted()
                || repeated.instrument->totalDecodedBytes != decoded.instrument->totalDecodedBytes
                || repeated.instrument->samples[0].audio->getSample(0, 127)
                    != decoded.instrument->samples[0].audio->getSample(0, 127))
                break;

            beat::SfzSampleDecodeLimits perSampleLimit;
            perSampleLimit.maximumDecodedBytesPerSample = 1023;
            const auto perSample = beat::decodeSfzResolvedInstrument(
                resolved.instrument, perSampleLimit);
            if (!hasSfzDecodeDiagnostic(perSample, "sfz.decode.sample-bytes"))
                break;

            beat::SfzSampleDecodeLimits aggregateLimit;
            aggregateLimit.maximumTotalDecodedBytes = 1024;
            const auto aggregate = beat::decodeSfzResolvedInstrument(
                resolved.instrument, aggregateLimit);
            if (!hasSfzDecodeDiagnostic(aggregate, "sfz.decode.total-bytes"))
                break;

            beat::SfzSampleDecodeLimits sampleCap;
            sampleCap.maximumUniqueSamples = 1;
            const auto capped = beat::decodeSfzResolvedInstrument(resolved.instrument, sampleCap);
            if (!hasSfzDecodeDiagnostic(capped, "sfz.decode.sample-cap"))
                break;

            beat::SfzSampleDecodeLimits channelCap;
            channelCap.maximumChannels = 1;
            const auto channels = beat::decodeSfzResolvedInstrument(
                resolved.instrument, channelCap);
            if (!hasSfzDecodeDiagnostic(channels, "sfz.decode.format"))
                break;

            beat::SfzSampleDecodeLimits invalidLimits;
            invalidLimits.maximumTotalDecodedBytes = 0;
            const auto invalid = beat::decodeSfzResolvedInstrument(
                resolved.instrument, invalidLimits);
            if (!hasSfzDecodeDiagnostic(invalid, "sfz.decode.limit-config"))
                break;

            beat::SfzSampleDecodeLimits noDetails;
            noDetails.maximumDiagnostics = 0;
            const auto missing = beat::decodeSfzResolvedInstrument(nullptr, noDetails);
            if (!missing.hasErrors() || missing.errorCount == 0
                || !missing.diagnostics.empty())
                break;

            auto tamperedIdentity = std::make_shared<beat::SfzResolvedInstrument>(
                *resolved.instrument);
            ++tamperedIdentity->regions[0].nativeIdentity.inode;
            const auto tampered = beat::decodeSfzResolvedInstrument(tamperedIdentity);
            if (!hasSfzDecodeDiagnostic(tampered, "sfz.decode.descriptor-identity"))
                break;

#if BEAT_SFZ_DECODE_TESTING
            if (!writeWav(outsideFile, 1, 256, 48000.0)) break;
            sfzDecodeHookTarget = monoFile;
            sfzDecodeHookOutside = outsideFile;
            beat::SfzSampleDecodeLimits noFollowLimits;
            noFollowLimits.beforeDescriptorOpen = replaceSfzTargetWithSymlink;
            const auto noFollow = beat::decodeSfzResolvedInstrument(
                resolved.instrument, noFollowLimits);
            sfzDecodeHookTarget = juce::File();
            sfzDecodeHookOutside = juce::File();
            if (!hasSfzDecodeDiagnostic(noFollow, "sfz.decode.no-follow"))
                break;

            if (!monoFile.deleteFile() || !writeWav(monoFile, 1, 256, 48000.0))
                break;
            const auto mutationResolved = beat::resolveSfzSubsetSamples(
                beat::parseSfzSubsetText(source), sfzFile);
            sfzDecodeHookTarget = monoFile;
            beat::SfzSampleDecodeLimits mutationLimits;
            mutationLimits.afterDecodeBeforeIdentityCheck = mutateSfzOpenDescriptor;
            const auto mutatedDuringDecode = beat::decodeSfzResolvedInstrument(
                mutationResolved.instrument, mutationLimits);
            sfzDecodeHookTarget = juce::File();
            if (!hasSfzDecodeDiagnostic(mutatedDuringDecode,
                                        "sfz.decode.descriptor-mutated"))
                break;
#endif

            if (!writeWav(monoFile, 1, 256, 48000.0)) break;
            const auto changedResolved = beat::resolveSfzSubsetSamples(
                beat::parseSfzSubsetText(source), sfzFile);
            const char changed[] = "changed";
            if (!monoFile.replaceWithData(changed, sizeof(changed))) break;
            const auto changedIdentity = beat::decodeSfzResolvedInstrument(
                changedResolved.instrument);
            if (!hasSfzDecodeDiagnostic(changedIdentity,
                                        "sfz.decode.descriptor-identity"))
                break;

            passed = true;
        }
        while (false);

        root.deleteRecursively();
        outsideFile.deleteFile();
        return passed;
    }

    bool stressManagedSfzAssetImport()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-managed-sfz-" + juce::Uuid().toString());
        const auto sourceRoot = root.getChildFile("source");
        const auto projectFile = root.getChildFile("Managed Project.beat");
        const auto sfzFile = sourceRoot.getChildFile("Keys.sfz");
        const auto sampleFile = sourceRoot.getChildFile("tone.wav");
        if (!sourceRoot.createDirectory()) return false;

        juce::AudioBuffer<float> audio(1, 2048);
        for (int frame = 0; frame < audio.getNumSamples(); ++frame)
            audio.setSample(0, frame, 0.25f * std::sin(
                (float) juce::MathConstants<double>::twoPi * 440.0f * frame / 48000.0f));
        juce::WavAudioFormat wav;
        auto output = sampleFile.createOutputStream();
        std::unique_ptr<juce::AudioFormatWriter> writer(output
            ? wav.createWriterFor(output.get(), 48000.0, 1, 24, {}, 0) : nullptr);
        if (!writer)
        {
            root.deleteRecursively();
            return false;
        }
        output.release();
        if (!writer->writeFromAudioSampleBuffer(audio, 0, audio.getNumSamples()))
        {
            root.deleteRecursively();
            return false;
        }
        writer.reset();
        if (!sfzFile.replaceWithText(
                "<region> sample=tone.wav pitch_keycenter=69 lokey=0 hikey=127 loop_mode=no_loop\n"))
        {
            root.deleteRecursively();
            return false;
        }

        bool passed = false;
        juce::String failureStep;
        do
        {
            const auto unsaved = beat::importManagedSfzAsset(sfzFile, juce::File());
            if (unsaved.ok() || !unsaved.error.containsIgnoreCase("save")) { failureStep = "unsaved guard"; break; }
            if (!projectFile.replaceWithText("{}")) { failureStep = "saved project fixture"; break; }

            const auto imported = beat::importManagedSfzAsset(sfzFile, projectFile);
            if (!imported.ok() || !imported.manifestPath.startsWith("./")
                || imported.sampleFiles.size() != 1)
                { failureStep = "initial import: " + imported.error; break; }
            const auto manifest = projectFile.getParentDirectory()
                .getChildFile(imported.manifestPath);
            const auto sourceCopy = projectFile.getParentDirectory()
                .getChildFile(imported.sourcePath);
            const auto sampleCopy = projectFile.getParentDirectory()
                .getChildFile(imported.sampleFiles[0].path);
            const auto loaded = beat::loadManagedSfzAsset(manifest);
            if (!manifest.existsAsFile() || !sourceCopy.existsAsFile()
                || !sampleCopy.existsAsFile() || !loaded.isAccepted()
                || !loaded.instrument || loaded.instrument->samples.size() != 1
                || loaded.instrument->regions.size() != 1)
                { failureStep = "materialized verification"; break; }

            const auto repeated = beat::importManagedSfzAsset(sfzFile, projectFile);
            if (!repeated.ok() || repeated.assetId != imported.assetId
                || repeated.manifestPath != imported.manifestPath)
                { failureStep = "deterministic reuse: " + repeated.error; break; }

            const auto originalManifestText = manifest.loadFileAsString();
            auto unsafeManifest = juce::JSON::parse(originalManifestText);
            auto* unsafeSamples = unsafeManifest.getProperty("samples", {}).getArray();
            if (unsafeSamples == nullptr || unsafeSamples->isEmpty())
                { failureStep = "security fixture manifest"; break; }
            unsafeSamples->getReference(0).getDynamicObject()->setProperty("path", "../source.sfz");
            if (!manifest.replaceWithText(juce::JSON::toString(unsafeManifest, true))
                || !hasSfzDecodeDiagnostic(beat::loadManagedSfzAsset(manifest),
                                           "sfz.managed.sample-integrity")
                || !manifest.replaceWithText(originalManifestText))
                { failureStep = "managed path traversal rejection"; break; }

            const auto symlink = sampleCopy.getSiblingFile("managed-link.wav");
            if (!sampleCopy.createSymbolicLink(symlink, false))
                { failureStep = "security symlink fixture"; break; }
            auto symlinkManifest = juce::JSON::parse(originalManifestText);
            symlinkManifest.getProperty("samples", {}).getArray()->getReference(0)
                .getDynamicObject()->setProperty("path", symlink.getRelativePathFrom(manifest.getParentDirectory()));
            const bool symlinkRejected = manifest.replaceWithText(juce::JSON::toString(symlinkManifest, true))
                && hasSfzDecodeDiagnostic(beat::loadManagedSfzAsset(manifest),
                                          "sfz.managed.sample-integrity");
            symlink.deleteFile();
            if (!symlinkRejected || !manifest.replaceWithText(originalManifestText))
                { failureStep = "managed symlink rejection"; break; }

            auto project = makeDenseAetherProject();
            auto& instrument = project.instruments.front();
            instrument.aether.oscA.enabled = false;
            instrument.aether.oscB.enabled = false;
            instrument.aether.sub.enabled = false;
            instrument.aether.noise.enabled = false;
            instrument.aether.sampleSlot1 = {};
            instrument.aether.sampleSlot1.enabled = true;
            instrument.aether.sampleSlot1.managedSfz.assetId = imported.assetId;
            instrument.aether.sampleSlot1.managedSfz.displayName = imported.displayName;
            instrument.aether.sampleSlot1.managedSfz.manifestPath = manifest.getFullPathName();
            const auto render64 = renderOfflineChunks(project, 8192, 64);
            const auto render64Repeat = renderOfflineChunks(project, 8192, 64);
            const auto render257 = renderOfflineChunks(project, 8192, 257);
            const auto render257Repeat = renderOfflineChunks(project, 8192, 257);
            if (bufferEnergy(render64) <= 0.0001
                || render64.getNumSamples() != render257.getNumSamples())
                { failureStep = "audible render"; break; }
            bool repeatedRenderMatches = render64.getNumSamples() == render64Repeat.getNumSamples()
                && render257.getNumSamples() == render257Repeat.getNumSamples();
            for (int channel = 0; channel < render64.getNumChannels(); ++channel)
                for (int sample = 0; sample < render64.getNumSamples(); ++sample)
                {
                    repeatedRenderMatches = repeatedRenderMatches
                        && render64.getSample(channel, sample) == render64Repeat.getSample(channel, sample)
                        && render257.getSample(channel, sample) == render257Repeat.getSample(channel, sample)
                        && std::isfinite(render257.getSample(channel, sample));
                }
            if (!repeatedRenderMatches)
            {
                failureStep = "same-configuration render determinism";
                break;
            }

            const auto rejectedFile = sourceRoot.getChildFile("Unsupported.sfz");
            if (!rejectedFile.replaceWithText(
                    "<region> sample=tone.wav key=69 trigger=release\n"))
                { failureStep = "unsupported fixture write"; break; }
            const auto beforeCount = beat::projectSidecarFolderFor(projectFile)
                .getChildFile("sfz").getNumberOfChildFiles(juce::File::findDirectories);
            const auto rejected = beat::importManagedSfzAsset(rejectedFile, projectFile);
            const auto afterCount = beat::projectSidecarFolderFor(projectFile)
                .getChildFile("sfz").getNumberOfChildFiles(juce::File::findDirectories);
            if (rejected.ok() || !rejected.error.containsIgnoreCase("release")
                || afterCount != beforeCount)
                { failureStep = "unsupported semantics transaction: " + rejected.error; break; }

            const char corruption[] = "tampered";
            if (!sampleCopy.replaceWithData(corruption, sizeof(corruption))) { failureStep = "tamper fixture write"; break; }
            const auto tampered = beat::loadManagedSfzAsset(manifest);
            if (!hasSfzDecodeDiagnostic(tampered, "sfz.managed.sample-integrity"))
                { failureStep = "tamper detection"; break; }

            passed = true;
        }
        while (false);

        if (!passed)
            std::cerr << "Managed SFZ failure step: " << failureStep << "\n";

        root.deleteRecursively();
        return passed;
    }

    std::shared_ptr<beat::SfzDecodedInstrument> makeSfzSlotInstrument(
        double tuneCents = 0.0, juce::String loopMode = "no_loop",
        bool overlap = false)
    {
        constexpr int frames = 32768;
        constexpr double sampleRate = 48000.0;
        auto instrument = std::make_shared<beat::SfzDecodedInstrument>();
        auto firstAudio = std::make_shared<juce::AudioBuffer<float>>(1, frames);
        auto secondAudio = std::make_shared<juce::AudioBuffer<float>>(2, frames);
        for (int frame = 0; frame < frames; ++frame)
        {
            const float first = 0.35f * std::sin(
                juce::MathConstants<double>::twoPi * 440.0 * frame / sampleRate);
            const float second = 0.3f * std::sin(
                juce::MathConstants<double>::twoPi * 660.0 * frame / sampleRate);
            firstAudio->setSample(0, frame, first);
            secondAudio->setSample(0, frame, second);
            secondAudio->setSample(1, frame, -second * 0.5f);
        }
        instrument->samples.push_back({ {}, firstAudio, sampleRate });
        instrument->samples.push_back({ {}, secondAudio, sampleRate });

        beat::SfzDecodedRegion first;
        first.sampleIndex = 0;
        first.stableRegionIndex = 0;
        first.definition.samplePath = "first.wav";
        first.definition.rootNote = 69;
        first.definition.loNote = overlap ? 60 : 69;
        first.definition.hiNote = overlap ? 72 : 69;
        first.definition.loVelocity = 0;
        first.definition.hiVelocity = overlap ? 100 : 127;
        first.definition.tuneCents = tuneCents;
        first.definition.offsetFrames = loopMode == "no_loop" ? 0 : 32;
        first.definition.endFrame = loopMode == "no_loop" ? frames - 1 : 255;
        first.definition.loopMode = loopMode;
        first.definition.loopStartFrame = loopMode == "no_loop" ? 0 : 64;
        first.definition.loopEndFrame = loopMode == "no_loop" ? 0 : 127;
        first.definition.panPercent = overlap ? -100.0 : 0.0;
        instrument->regions.push_back(first);

        if (overlap)
        {
            beat::SfzDecodedRegion second;
            second.sampleIndex = 1;
            second.stableRegionIndex = 1;
            second.definition.samplePath = "second.wav";
            second.definition.rootNote = 69;
            second.definition.loNote = 66;
            second.definition.hiNote = 78;
            second.definition.loVelocity = 64;
            second.definition.hiVelocity = 127;
            second.definition.endFrame = frames - 1;
            second.definition.panPercent = 100.0;
            instrument->regions.push_back(second);
        }

        for (size_t index = 0; index < instrument->regions.size(); ++index)
        {
            const auto& region = instrument->regions[index].definition;
            for (int note = region.loNote; note <= region.hiNote; ++note)
            {
                auto& candidates = instrument->noteIndex[(size_t) note];
                candidates.indices[candidates.count++] = (uint16_t) index;
            }
        }
        instrument->totalDecodedBytes = frames * 3 * (int64_t) sizeof(float);
        return instrument;
    }

    int positiveCrossings(const juce::AudioBuffer<float>& audio)
    {
        int crossings = 0;
        for (int sample = 1; sample < audio.getNumSamples(); ++sample)
            if (audio.getSample(0, sample - 1) <= 0.0f
                && audio.getSample(0, sample) > 0.0f)
                ++crossings;
        return crossings;
    }

    bool stressSfzSourceSlot()
    {
        constexpr double sampleRate = 48000.0;
        beat::SfzSourceSlot slot;
        if (!slot.prepare({ sampleRate, 256, 2 })
            || slot.prepare({ 0.0, 256, 2 }))
            return false;

        auto base = makeSfzSlotInstrument();
        std::weak_ptr<const beat::SfzDecodedInstrument> baseLifetime = base;
        if (!slot.publish(base) || slot.lifecycleState() != beat::SourceLifecycleState::ready)
            return false;
        base.reset();
        if (!slot.noteOn({ 69, 1.0f, 9101 }) || slot.activeVoiceCount() != 1)
            return false;

        juce::AudioBuffer<float> normal(2, 2048);
        normal.clear();
        beat::test::beginRealtimeSafetyProbe();
        slot.render(normal, 0, normal.getNumSamples());
        const auto callbackViolations = beat::test::endRealtimeSafetyProbe();
        const int normalCrossings = positiveCrossings(normal);
        if (callbackViolations != 0 || normalCrossings < 16 || normalCrossings > 21
            || !std::isfinite(normal.getMagnitude(0, normal.getNumSamples())))
            return false;

        auto tuned = makeSfzSlotInstrument(1200.0);
        if (slot.publish(tuned) || baseLifetime.expired())
            return false;
        slot.allNotesOff(true);
        if (slot.activeVoiceCount() != 0 || !slot.publish(tuned))
            return false;
        auto retired = slot.takeRetiredInstrument();
        if (!retired || baseLifetime.expired())
            return false;
        retired.reset();
        if (!baseLifetime.expired() || !slot.noteOn({ 69, 1.0f, 9102 }))
            return false;
        juce::AudioBuffer<float> octave(2, 2048);
        octave.clear();
        slot.render(octave, 0, octave.getNumSamples());
        const int octaveCrossings = positiveCrossings(octave);
        if (octaveCrossings < 34 || octaveCrossings > 40
            || octaveCrossings < normalCrossings * 2 - 2)
            return false;
        slot.allNotesOff(true);

        const auto renderBlocked = [](int blockSize)
        {
            beat::SfzSourceSlot renderedSlot;
            juce::AudioBuffer<float> output(2, 2048);
            output.clear();
            if (!renderedSlot.prepare({ 48000.0, blockSize, 2 })
                || !renderedSlot.publish(makeSfzSlotInstrument())
                || !renderedSlot.noteOn({ 69, 1.0f, 9150 }))
                return juce::AudioBuffer<float>();
            for (int start = 0; start < output.getNumSamples(); start += blockSize)
                renderedSlot.render(output, start,
                    std::min(blockSize, output.getNumSamples() - start));
            return output;
        };
        const auto blocked64 = renderBlocked(64);
        const auto blocked257 = renderBlocked(257);
        if (blocked64.getNumSamples() != blocked257.getNumSamples())
            return false;
        for (int channel = 0; channel < blocked64.getNumChannels(); ++channel)
            for (int sample = 0; sample < blocked64.getNumSamples(); ++sample)
                if (blocked64.getSample(channel, sample)
                    != blocked257.getSample(channel, sample))
                    return false;

        for (const double rate : { 44100.0, 48000.0, 88200.0, 96000.0, 192000.0 })
        {
            beat::SfzSourceSlot rateSlot;
            juce::AudioBuffer<float> rateRender(2, 8192);
            rateRender.clear();
            if (!rateSlot.prepare({ rate, 257, 2 })
                || !rateSlot.publish(makeSfzSlotInstrument())
                || !rateSlot.noteOn({ 69, 1.0f, (uint64_t) rate }))
                return false;
            rateSlot.render(rateRender, 0, rateRender.getNumSamples());
            const int expected = (int) std::round(440.0 * rateRender.getNumSamples() / rate);
            if (std::abs(positiveCrossings(rateRender) - expected) > 2)
                return false;
        }

        auto overlap = makeSfzSlotInstrument(0.0, "no_loop", true);
        if (!slot.publish(overlap)
            || !slot.noteOn({ 69, 80.0f / 127.0f, 9201 })
            || slot.activeVoiceCount() != 2)
            return false;
        juce::AudioBuffer<float> blended(2, 512);
        blended.clear();
        beat::test::beginRealtimeSafetyProbe();
        slot.render(blended, 0, blended.getNumSamples());
        const auto blendedViolations = beat::test::endRealtimeSafetyProbe();
        if (blendedViolations != 0
            || blended.getMagnitude(0, blended.getNumSamples()) <= 0.01f
            || blended.getMagnitude(1, blended.getNumSamples()) <= 0.01f)
            return false;
        slot.allNotesOff(true);
        if (slot.noteOn({ 20, 1.0f, 9202 }))
            return false;

        auto continuous = makeSfzSlotInstrument(0.0, "loop_continuous");
        if (!slot.publish(continuous)) return false;
        beat::test::beginRealtimeSafetyProbe();
        bool noteOnAccepted = true;
        for (int note = 0; note < beat::SfzSourceSlot::maximumVoices; ++note)
            if (!slot.noteOn({ 69, 0.8f, (uint64_t) (9300 + note) }))
                noteOnAccepted = false;
        const auto noteOnViolations = beat::test::endRealtimeSafetyProbe();
        if (!noteOnAccepted || noteOnViolations != 0
            || slot.activeVoiceCount() != beat::SfzSourceSlot::maximumVoices
            || slot.noteOn({ 69, 0.8f, 9400 }))
            return false;
        juce::AudioBuffer<float> looping(2, 1024);
        looping.clear();
        slot.render(looping, 0, looping.getNumSamples());
        if (slot.activeVoiceCount() != beat::SfzSourceSlot::maximumVoices)
            return false;
        slot.allNotesOff(false);
        juce::AudioBuffer<float> release(2, 512);
        release.clear();
        slot.render(release, 0, release.getNumSamples());
        if (slot.activeVoiceCount() != 0)
            return false;

        auto sustain = makeSfzSlotInstrument(0.0, "loop_sustain");
        if (!slot.publish(sustain) || !slot.noteOn({ 69, 0.8f, 9450 }))
            return false;
        looping.clear();
        slot.render(looping, 0, looping.getNumSamples());
        if (slot.activeVoiceCount() != 1)
            return false;
        slot.noteOff(9450);
        release.clear();
        slot.render(release, 0, release.getNumSamples());
        if (slot.activeVoiceCount() != 0)
            return false;

        auto oneShot = makeSfzSlotInstrument(0.0, "one_shot");
        if (!slot.publish(oneShot) || !slot.noteOn({ 69, 1.0f, 9501 }))
            return false;
        slot.noteOff(9501);
        juce::AudioBuffer<float> shortRender(2, 100);
        shortRender.clear();
        slot.render(shortRender, 0, shortRender.getNumSamples());
        if (slot.activeVoiceCount() != 1)
            return false;
        juce::AudioBuffer<float> finish(2, 256);
        finish.clear();
        slot.render(finish, 0, finish.getNumSamples());
        if (slot.activeVoiceCount() != 0)
            return false;

        auto unsupported = makeSfzSlotInstrument();
        unsupported->regions[0].definition.sequenceLength = 2;
        unsupported->regions[0].definition.sequencePosition = 1;
        if (slot.publish(unsupported))
            return false;
        unsupported = makeSfzSlotInstrument();
        unsupported->regions[0].definition.trigger = "release";
        if (slot.publish(unsupported))
            return false;
        unsupported = makeSfzSlotInstrument();
        unsupported->regions[0].definition.group = 1;
        if (slot.publish(unsupported))
            return false;
        unsupported = makeSfzSlotInstrument();
        auto invalidAudio = std::make_shared<juce::AudioBuffer<float>>(
            *unsupported->samples[0].audio);
        invalidAudio->setSample(0, 4, std::numeric_limits<float>::quiet_NaN());
        unsupported->samples[0].audio = invalidAudio;
        if (slot.publish(unsupported))
            return false;

        const auto telemetry = slot.telemetry();
        const auto sfzTelemetry = slot.sfzTelemetry();
        return telemetry.acceptedNoteEvents >= 20
            && telemetry.rejectedNoteEvents >= 2
            && telemetry.renderedSamples > 0
            && telemetry.renderedVoiceSamples > telemetry.renderedSamples
            && slot.stateVersion() >= 5
            && sfzTelemetry.candidateScans > 0
            && sfzTelemetry.candidateScans
                <= (telemetry.acceptedNoteEvents + telemetry.rejectedNoteEvents)
                    * beat::SfzSourceSlot::maximumCandidatesPerNote
            && sfzTelemetry.voicesStarted >= telemetry.acceptedNoteEvents
            && sfzTelemetry.noteCapacityRejects == 1
            && sfzTelemetry.publicationRejects >= 4
            && sfzTelemetry.retiredPublications > 0;
    }

    bool stressDecentSamplerFixtureImportAndPlayback()
    {
        const auto archiveFile = juce::File("/Users/alexcheng/Downloads/samples/109689_PercussionPalette_joshuameltzer_DecentSampler.zip");
        if (!archiveFile.existsAsFile())
        {
            std::cerr << "Decent fixture pack not present; skipping local fixture import/playback stress\n";
            return true;
        }

        auto extractedRoot = juce::File("/private/tmp").getChildFile("BeatBackendStress-decent-import");
        if (extractedRoot.exists())
            extractedRoot.deleteRecursively();
        if (!extractedRoot.createDirectory())
        {
            std::cerr << "Decent fixture temp root creation failed\n";
            return false;
        }

        const auto presetFile = beat::resolveDecentSamplerPreset(archiveFile, extractedRoot);
        if (!presetFile.existsAsFile())
        {
            extractedRoot.deleteRecursively();
            std::cerr << "Decent fixture .dspreset not found after extraction\n";
            return false;
        }

        const auto preset = beat::parseDecentSamplerPreset(presetFile);
        if (!preset)
        {
            extractedRoot.deleteRecursively();
            std::cerr << "Decent fixture parse failed\n";
            return false;
        }

        if (preset->samples.empty() || preset->sampleUrls.isEmpty())
        {
            extractedRoot.deleteRecursively();
            std::cerr << "Decent fixture produced no playable zones\n";
            return false;
        }

        auto project = makeDecentFixtureProject(*preset);
        const auto live = renderOfflineChunks(project, 44100, 256);
        const double liveEnergy = bufferEnergy(live);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-decent-fixture.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        const bool exportedOk = beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error);
        const double exportEnergy = exportedOk ? wavEnergy(exportFile) : std::numeric_limits<double>::quiet_NaN();

        if (exportFile.existsAsFile())
            exportFile.deleteFile();
        extractedRoot.deleteRecursively();

        const bool ok = std::isfinite(liveEnergy)
            && std::isfinite(exportEnergy)
            && liveEnergy > 0.0001
            && exportEnergy > 0.0001;
        if (!ok)
        {
            std::cerr << "Decent fixture playback failed liveEnergy=" << liveEnergy
                      << " exportEnergy=" << exportEnergy
                      << " exportError=" << error << "\n";
        }
        return ok;
    }

    bool stressDecentSamplerSyntheticMetadata()
    {
        const auto tempRoot = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-decent-synthetic-" + juce::String(juce::Time::getMillisecondCounterHiRes(), 0));
        if (tempRoot.exists())
            tempRoot.deleteRecursively();
        if (!tempRoot.createDirectory())
        {
            std::cerr << "Synthetic DecentSampler metadata stress failed: temp root creation failed "
                      << tempRoot.getFullPathName() << "\n";
            return false;
        }

        const auto resources = tempRoot.getChildFile("Resources");
        const auto samples = tempRoot.getChildFile("Samples");
        if (!resources.createDirectory() || !samples.createDirectory())
        {
            std::cerr << "Synthetic DecentSampler metadata stress failed: fixture folder creation failed\n";
            tempRoot.deleteRecursively();
            return false;
        }

        const auto imageFile = resources.getChildFile("bg.png");
        {
            juce::Image image(juce::Image::RGB, 2, 2, true);
            image.clear(image.getBounds(), juce::Colours::black);
            juce::PNGImageFormat png;
            auto output = imageFile.createOutputStream();
            if (output == nullptr || !png.writeImageToStream(image, *output))
            {
                std::cerr << "Synthetic DecentSampler metadata stress failed: png write failed\n";
                tempRoot.deleteRecursively();
                return false;
            }
        }

        const auto sampleFile = samples.getChildFile("hit.wav");
        {
            constexpr double sampleRate = 44100.0;
            constexpr int sampleCount = 22050;
            juce::AudioBuffer<float> buffer(1, sampleCount);
            for (int i = 0; i < sampleCount; ++i)
                buffer.setSample(0, i, 0.25f * std::sin((float) i * 0.013f));

            juce::WavAudioFormat wavFormat;
            auto output = sampleFile.createOutputStream();
            std::unique_ptr<juce::AudioFormatWriter> writer(
                wavFormat.createWriterFor(output.get(), sampleRate, 1, 16, {}, 0));
            if (writer == nullptr)
            {
                std::cerr << "Synthetic DecentSampler metadata stress failed: wav writer unavailable\n";
                tempRoot.deleteRecursively();
                return false;
            }
            output.release();
            if (!writer->writeFromAudioSampleBuffer(buffer, 0, sampleCount))
            {
                std::cerr << "Synthetic DecentSampler metadata stress failed: wav write failed\n";
                tempRoot.deleteRecursively();
                return false;
            }
        }

        const auto presetFile = tempRoot.getChildFile("SyntheticStress.dspreset");
        const auto xml = juce::String(R"xml(<?xml version="1.0" encoding="UTF-8"?>
<DecentSampler name="Synthetic Stress">
  <ui bgImage="Resources/bg.png" width="812" height="375">
    <labeled-knob x="19" y="80" width="108" height="108" label="tone" type="float" minValue="220" maxValue="22000" value="18000">
      <binding type="effect" level="instrument" position="0" parameter="FX_FILTER_FREQUENCY"/>
    </labeled-knob>
  </ui>
  <effects>
    <effect type="lowpass_4pl" position="0" frequency="18000.0" resonance="0.25"/>
  </effects>
  <groups>
    <group>
      <sample path="Samples/hit.wav" rootNote="36" loNote="35" hiNote="37" loVel="1" hiVel="127" loLength="0.1" hiLength="0.9" start="128" end="1024" seqPosition="2" chokeGroup="4" oneShot="true"/>
    </group>
  </groups>
</DecentSampler>
)xml");
        if (!presetFile.replaceWithText(xml))
        {
            std::cerr << "Synthetic DecentSampler metadata stress failed: preset write failed\n";
            tempRoot.deleteRecursively();
            return false;
        }

        const auto preset = beat::parseDecentSamplerPreset(presetFile);
        const auto hasToneFilterControl = preset
            ? std::any_of(preset->uiControlDetails.begin(), preset->uiControlDetails.end(), [] (const beat::DecentSamplerUiControl& control)
                {
                    if (!control.label.equalsIgnoreCase("tone"))
                        return false;

                    return std::any_of(control.bindings.begin(), control.bindings.end(), [] (const beat::DecentSamplerUiBinding& binding)
                        {
                            return binding.parameter.equalsIgnoreCase("FX_FILTER_FREQUENCY");
                        });
                })
            : false;

        const bool sampleOk = preset && preset->samples.size() == 1
            && preset->samples.front().path.endsWith("Samples/hit.wav")
            && preset->samples.front().oneShot
            && preset->samples.front().chokeGroup == 4
            && preset->samples.front().seqPosition == 2
            && std::abs(preset->samples.front().durationSeconds - 0.5) < 0.01
            && std::abs(preset->samples.front().loLengthSeconds - 0.1) < 0.0001
            && std::abs(preset->samples.front().hiLengthSeconds - 0.9) < 0.0001
            && preset->samples.front().startSample == 128
            && preset->samples.front().endSample == 1024;
        const bool uiOk = preset
            && preset->name == "Synthetic Stress"
            && preset->uiWidth == 812
            && preset->uiHeight == 375
            && juce::File(preset->uiImagePath).existsAsFile()
            && hasToneFilterControl;
        const bool effectsOk = preset
            && preset->effects.size() == 1
            && preset->effects.front().type == "lowpass_4pl"
            && preset->effects.front().position == 0
            && std::abs(preset->effects.front().frequency - 18000.0) < 0.001
            && std::abs(preset->effects.front().resonance - 0.25) < 0.001;

        const auto fallbackPresetFile = tempRoot.getChildFile("SyntheticFallbackStress.dspreset");
        const auto fallbackXml = juce::String(R"xml(<?xml version="1.0" encoding="UTF-8"?>
<DecentSampler name="Synthetic Fallback Stress">
  <ui width="640" height="320">
    <labeled-knob x="20" y="20" width="96" height="96" label="release" type="float" minValue="0" maxValue="3" value="1">
      <binding type="amp" level="instrument" position="0" parameter="ENV_RELEASE"/>
    </labeled-knob>
  </ui>
  <groups>
    <group>
      <sample path="Samples/hit.wav" rootNote="36"/>
    </group>
  </groups>
</DecentSampler>
)xml");
        const bool fallbackWritten = fallbackPresetFile.replaceWithText(fallbackXml);
        const auto fallbackPreset = fallbackWritten ? beat::parseDecentSamplerPreset(fallbackPresetFile) : std::nullopt;
        const bool fallbackUiOk = fallbackPreset
            && fallbackPreset->uiWidth == 640
            && fallbackPreset->uiHeight == 320
            && juce::File(fallbackPreset->uiImagePath).existsAsFile()
            && juce::File(fallbackPreset->uiImagePath) == imageFile;

        if (!sampleOk || !uiOk || !effectsOk || !fallbackUiOk)
        {
            std::cerr << "Synthetic DecentSampler metadata stress failed"
                      << " parsed=" << (preset.has_value() ? 1 : 0)
                      << " samples=" << (preset ? (int) preset->samples.size() : 0)
                      << " duration=" << (preset && !preset->samples.empty() ? preset->samples.front().durationSeconds : 0.0)
                      << " lengthRange=" << (preset && !preset->samples.empty()
                          ? juce::String(preset->samples.front().loLengthSeconds) + "-" + juce::String(preset->samples.front().hiLengthSeconds)
                          : juce::String())
                      << " ui=" << (preset ? juce::String(preset->uiWidth) + "x" + juce::String(preset->uiHeight) : juce::String())
                      << " hasToneFilterControl=" << hasToneFilterControl
                      << " effects=" << (preset ? (int) preset->effects.size() : 0)
                      << " fallbackUiOk=" << fallbackUiOk
                      << " fallbackImage=" << (fallbackPreset ? fallbackPreset->uiImagePath : juce::String())
                      << "\n";
        }

        tempRoot.deleteRecursively();
        return sampleOk && uiOk && effectsOk && fallbackUiOk;
    }

    bool stressDecentSamplerLorenzoUiMetadata()
    {
        const auto archiveFile = juce::File("/Users/alexcheng/Downloads/samples/283049_LorenzosDrums_LorenzoWood_v1_DecentSampler.zip");
        if (!archiveFile.existsAsFile())
        {
            std::cerr << "Decent Lorenzo fixture pack not present; skipping UI metadata stress\n";
            return true;
        }

        auto extractedRoot = juce::File("/private/tmp").getChildFile("BeatBackendStress-decent-lorenzo-ui");
        if (extractedRoot.exists())
            extractedRoot.deleteRecursively();
        if (!extractedRoot.createDirectory())
        {
            std::cerr << "Decent Lorenzo temp root creation failed\n";
            return false;
        }

        const auto presetFile = beat::resolveDecentSamplerPreset(archiveFile, extractedRoot);
        const auto preset = presetFile.existsAsFile() ? beat::parseDecentSamplerPreset(presetFile) : std::nullopt;
        const auto hasToneFilterControl = preset
            ? std::any_of(preset->uiControlDetails.begin(), preset->uiControlDetails.end(), [] (const beat::DecentSamplerUiControl& control)
                {
                    if (!control.label.equalsIgnoreCase("tone"))
                        return false;

                    return std::any_of(control.bindings.begin(), control.bindings.end(), [] (const beat::DecentSamplerUiBinding& binding)
                        {
                            return binding.parameter.equalsIgnoreCase("FX_FILTER_FREQUENCY");
                        });
                })
            : false;
        double maxVolumeDb = 0.0;
        int maxSeqPosition = 0;
        bool hasLowpassEffect = false;
        bool hasReverbEffect = false;
        if (preset)
        {
            for (const auto& sample : preset->samples)
            {
                maxVolumeDb = juce::jmax(maxVolumeDb, sample.volumeDb);
                maxSeqPosition = juce::jmax(maxSeqPosition, sample.seqPosition);
            }

            for (const auto& effect : preset->effects)
            {
                if (effect.type.containsIgnoreCase("lowpass") && effect.frequency > 10000.0)
                    hasLowpassEffect = true;
                if (effect.type.containsIgnoreCase("reverb") && effect.roomSize > 0.5 && effect.damping > 0.0)
                    hasReverbEffect = true;
            }
        }
        const bool ok = preset.has_value()
            && preset->samples.size() > 32
            && preset->sampleUrls.size() > 32
            && preset->uiImagePath.isNotEmpty()
            && juce::File(preset->uiImagePath).existsAsFile()
            && preset->uiWidth > 0
            && preset->uiHeight > 0
            && preset->uiControls.size() >= 3
            && preset->uiControlDetails.size() >= 3
            && preset->effects.size() >= 2
            && hasLowpassEffect
            && hasReverbEffect
            && hasToneFilterControl
            && maxVolumeDb > 10.0
            && maxSeqPosition > 0;

        if (!ok)
        {
            std::cerr << "Decent Lorenzo UI metadata parse failed"
                      << " preset=" << presetFile.getFullPathName()
                      << " samples=" << (preset ? (int) preset->samples.size() : 0)
                      << " urls=" << (preset ? preset->sampleUrls.size() : 0)
                      << " uiImage=" << (preset ? preset->uiImagePath : juce::String())
                      << " ui=" << (preset ? juce::String(preset->uiWidth) + "x" + juce::String(preset->uiHeight) : juce::String())
                      << " controls=" << (preset ? preset->uiControls.size() : 0)
                      << " controlDetails=" << (preset ? (int) preset->uiControlDetails.size() : 0)
                      << " effects=" << (preset ? (int) preset->effects.size() : 0)
                      << " lowpass=" << hasLowpassEffect
                      << " reverb=" << hasReverbEffect
                      << " hasToneFilterControl=" << hasToneFilterControl
                      << " maxVolumeDb=" << maxVolumeDb
                      << " maxSeqPosition=" << maxSeqPosition
                      << "\n";
        }

        extractedRoot.deleteRecursively();
        return ok;
    }

    bool stressDecentSamplerLorenzoImportAndPlayback()
    {
        const auto archiveFile = juce::File("/Users/alexcheng/Downloads/samples/283049_LorenzosDrums_LorenzoWood_v1_DecentSampler.zip");
        if (!archiveFile.existsAsFile())
        {
            std::cerr << "Decent Lorenzo fixture pack not present; skipping import/playback stress\n";
            return true;
        }

        auto extractedRoot = juce::File("/private/tmp").getChildFile("BeatBackendStress-decent-lorenzo-playback");
        if (extractedRoot.exists())
            extractedRoot.deleteRecursively();
        if (!extractedRoot.createDirectory())
        {
            std::cerr << "Decent Lorenzo playback temp root creation failed\n";
            return false;
        }

        const auto presetFile = beat::resolveDecentSamplerPreset(archiveFile, extractedRoot);
        const auto preset = presetFile.existsAsFile() ? beat::parseDecentSamplerPreset(presetFile) : std::nullopt;
        if (!preset)
        {
            extractedRoot.deleteRecursively();
            std::cerr << "Decent Lorenzo playback parse failed preset=" << presetFile.getFullPathName() << "\n";
            return false;
        }

        auto project = makeDecentFixtureProject(*preset);
        project.name = "Lorenzo DecentSampler Playback";
        project.instruments.front().id = "lorenzo-ds-kit";
        project.instruments.front().kind = "sampler";
        project.tracks.front().instrumentId = "lorenzo-ds-kit";
        project.tracks.front().segments.front().instrumentId = "lorenzo-ds-kit";
        for (auto& note : project.tracks.front().segments.front().notes)
            note.instrumentId = "lorenzo-ds-kit";

        const auto live = renderOfflineChunks(project, 44100, 256);
        const double liveEnergy = bufferEnergy(live);
        const float livePeak = bufferPeak(live);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-lorenzo-ds-fixture.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        const bool exportedOk = beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error);
        const double exportEnergy = exportedOk ? wavEnergy(exportFile) : std::numeric_limits<double>::quiet_NaN();

        if (exportFile.existsAsFile())
            exportFile.deleteFile();
        extractedRoot.deleteRecursively();

        const bool ok = preset->samples.size() >= 128
            && std::isfinite(liveEnergy)
            && std::isfinite(exportEnergy)
            && liveEnergy > 0.0001
            && exportEnergy > 0.0001
            && livePeak > 0.0005f
            && livePeak <= 1.0f;
        if (!ok)
        {
            std::cerr << "Decent Lorenzo playback failed samples=" << (int) preset->samples.size()
                      << " liveEnergy=" << liveEnergy
                      << " livePeak=" << livePeak
                      << " exportEnergy=" << exportEnergy
                      << " exportError=" << error << "\n";
        }
        return ok;
    }

    bool stressDecentSamplerHovefluteImportAndPlayback()
    {
        const auto archiveFile = juce::File("/Users/alexcheng/Downloads/samples/1043_Hoveflute_StefingoUnosson_DS.zip");
        if (!archiveFile.existsAsFile())
        {
            std::cerr << "Decent Hoveflute fixture pack not present; skipping import/playback stress\n";
            return true;
        }

        auto extractedRoot = juce::File("/private/tmp").getChildFile("BeatBackendStress-decent-hoveflute-playback");
        if (extractedRoot.exists())
            extractedRoot.deleteRecursively();
        if (!extractedRoot.createDirectory())
        {
            std::cerr << "Decent Hoveflute playback temp root creation failed\n";
            return false;
        }

        const auto presetFile = beat::resolveDecentSamplerPreset(archiveFile, extractedRoot);
        const auto preset = presetFile.existsAsFile() ? beat::parseDecentSamplerPreset(presetFile) : std::nullopt;
        if (!preset)
        {
            extractedRoot.deleteRecursively();
            std::cerr << "Decent Hoveflute playback parse failed preset=" << presetFile.getFullPathName() << "\n";
            return false;
        }

        bool samplePathsExist = true;
        bool sampleRangesValid = true;
        for (const auto& sample : preset->samples)
        {
            samplePathsExist = samplePathsExist && juce::File(sample.path).existsAsFile();
            sampleRangesValid = sampleRangesValid
                && sample.rootNote >= 0
                && sample.rootNote <= 127
                && sample.loNote >= 0
                && sample.hiNote <= 127
                && sample.loVel >= 0
                && sample.hiVel <= 127
                && sample.loNote <= sample.hiNote
                && sample.loVel <= sample.hiVel;
        }

        const bool uiImageExists = juce::File(preset->uiImagePath).existsAsFile();

        auto project = makeDecentFixtureProject(*preset);
        project.name = "Hoveflute DecentSampler Playback";

        const auto live = renderOfflineChunks(project, 44100, 256);
        const double liveEnergy = bufferEnergy(live);
        const float livePeak = bufferPeak(live);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-hoveflute-ds-fixture.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        const bool exportedOk = beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error);
        const double exportEnergy = exportedOk ? wavEnergy(exportFile) : std::numeric_limits<double>::quiet_NaN();

        if (exportFile.existsAsFile())
            exportFile.deleteFile();
        extractedRoot.deleteRecursively();

        const bool ok = preset->samples.size() >= 8
            && preset->sampleUrls.size() >= 8
            && preset->uiImagePath.isNotEmpty()
            && uiImageExists
            && preset->uiWidth > 0
            && preset->uiHeight > 0
            && !presetFile.getFullPathName().containsIgnoreCase(juce::File::getSeparatorString() + "__MACOSX" + juce::File::getSeparatorString())
            && samplePathsExist
            && sampleRangesValid
            && std::isfinite(liveEnergy)
            && std::isfinite(exportEnergy)
            && liveEnergy > 0.0001
            && exportEnergy > 0.0001
            && livePeak > 0.0005f
            && livePeak <= 1.0f;
        if (!ok)
        {
            std::cerr << "Decent Hoveflute playback failed preset=" << presetFile.getFullPathName()
                      << " samples=" << (int) preset->samples.size()
                      << " urls=" << preset->sampleUrls.size()
                      << " uiImage=" << preset->uiImagePath
                      << " ui=" << juce::String(preset->uiWidth) + "x" + juce::String(preset->uiHeight)
                      << " uiImageExists=" << uiImageExists
                      << " samplePathsExist=" << samplePathsExist
                      << " sampleRangesValid=" << sampleRangesValid
                      << " liveEnergy=" << liveEnergy
                      << " livePeak=" << livePeak
                      << " exportEnergy=" << exportEnergy
                      << " exportError=" << error << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAudioClipOfflineExport()
    {
        auto clipFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-export-source.wav");
        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-export.wav");
        if (!writeAudioClipFixture(clipFile))
            return false;
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(makeAudioClipOfflineProject(clipFile), exportFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Audio clip export error: " << error << "\n";
            return false;
        }

        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(exportFile));
        if (reader == nullptr || reader->lengthInSamples <= 0)
            return false;

        juce::AudioBuffer<float> buffer((int) reader->numChannels, (int) juce::jmin<juce::int64>(reader->lengthInSamples, 44100));
        reader->read(&buffer, 0, buffer.getNumSamples(), 0, true, true);

        double energy = 0.0;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(ch, i);
                if (!std::isfinite(sample))
                    return false;
                energy += (double) sample * (double) sample;
            }
        }

        clipFile.deleteFile();
        exportFile.deleteFile();
        return energy > 0.0001;
    }

    bool stressAudioEngineAudioClipFadeEnvelope()
    {
        auto clipFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-fade-source.wav");
        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-fade-export.wav");
        if (!writeAudioClipFixture(clipFile))
            return false;
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        const int samples = 22050;
        const auto dry = renderOfflineChunks(makeAudioClipFadeProject(clipFile, 0.0, 0.0), samples, 256);
        const auto faded = renderOfflineChunks(makeAudioClipFadeProject(clipFile, 0.5, 0.5), samples, 256);

        const double dryHead = bufferWindowEnergy(dry, 1024, 4096);
        const double fadedHead = bufferWindowEnergy(faded, 1024, 4096);
        const double dryTail = bufferWindowEnergy(dry, samples - 5120, 4096);
        const double fadedTail = bufferWindowEnergy(faded, samples - 5120, 4096);
        const double fadedTotal = bufferEnergy(faded);

        juce::String error;
        const bool exportedOk = beat::AudioEngine::renderProjectToWav(
            makeAudioClipFadeProject(clipFile, 0.5, 0.5),
            exportFile,
            44100.0,
            256,
            2,
            &error);
        const double exportTotal = exportedOk ? wavEnergy(exportFile) : std::numeric_limits<double>::quiet_NaN();

        clipFile.deleteFile();
        exportFile.deleteFile();

        const bool ok = std::isfinite(dryHead)
            && std::isfinite(fadedHead)
            && std::isfinite(dryTail)
            && std::isfinite(fadedTail)
            && std::isfinite(fadedTotal)
            && std::isfinite(exportTotal)
            && dryHead > 0.0001
            && dryTail > 0.0001
            && fadedTotal > 0.0001
            && exportTotal > 0.0001
            && fadedHead < dryHead * 0.75
            && fadedTail < dryTail * 0.75;

        if (!ok)
        {
            std::cerr << "Audio clip fade envelope failed dryHead=" << dryHead
                      << " fadedHead=" << fadedHead
                      << " dryTail=" << dryTail
                      << " fadedTail=" << fadedTail
                      << " fadedTotal=" << fadedTotal
                      << " exportTotal=" << exportTotal
                      << " exportError=" << error << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAudioClipOverlongFadeNormalization()
    {
        auto clipFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-overlong-fade-source.wav");
        if (!writeAudioClipFixture(clipFile))
            return false;

        constexpr int samples = 22050;
        constexpr int blockSize = 191;
        const auto normalized = renderOfflineChunks(makeAudioClipFadeProject(clipFile, 0.5, 0.5), samples, blockSize);
        const auto overlong = renderOfflineChunks(makeAudioClipFadeProject(clipFile, 0.9, 0.9), samples, blockSize);
        clipFile.deleteFile();

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double overlongEnergy = 0.0;
        for (int ch = 0; ch < normalized.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float normalizedSample = normalized.getSample(ch, i);
                const float overlongSample = overlong.getSample(ch, i);
                if (!std::isfinite(normalizedSample) || !std::isfinite(overlongSample))
                    return false;

                const float diff = std::abs(normalizedSample - overlongSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                overlongEnergy += (double) overlongSample * (double) overlongSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (normalized.getNumChannels() * samples);
        const bool ok = overlongEnergy > 0.0001
            && maxAbsDiff <= 0.000001f
            && meanAbsDiff <= 0.0000001;
        if (!ok)
        {
            std::cerr << "Audio clip overlong fade normalization failed energy=" << overlongEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAudioClipFadeLiveExportParity()
    {
        auto clipFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-fade-parity-source.wav");
        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-fade-parity.wav");
        if (!writeAudioClipFixture(clipFile))
            return false;
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        constexpr int samples = 22050;
        constexpr int blockSize = 257;
        auto project = makeAudioClipFadeProject(clipFile, 0.25, 0.35);
        const auto live = renderOfflineChunks(project, samples, blockSize);

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, blockSize, 2, &error))
        {
            std::cerr << "Audio clip fade parity export error: " << error << "\n";
            clipFile.deleteFile();
            return false;
        }

        const auto exported = readWavPrefix(exportFile, samples);
        clipFile.deleteFile();
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
        {
            std::cerr << "Audio clip fade parity channel/sample mismatch liveChannels=" << live.getNumChannels()
                      << " exportedChannels=" << exported.getNumChannels()
                      << " exportedSamples=" << exported.getNumSamples() << "\n";
            return false;
        }

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        const bool ok = liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
        if (!ok)
        {
            std::cerr << "Audio clip fade live/export parity failed liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAudioClipCrossfadeLiveExportParity()
    {
        auto clipFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-crossfade-parity-source.wav");
        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-crossfade-parity.wav");
        if (!writeAudioClipFixture(clipFile))
            return false;
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        constexpr int samples = 33075;
        constexpr int blockSize = 257;
        auto project = makeAudioClipCrossfadeProject(clipFile);
        const auto live = renderOfflineChunks(project, samples, blockSize);

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, blockSize, 2, &error))
        {
            std::cerr << "Audio clip crossfade parity export error: " << error << "\n";
            clipFile.deleteFile();
            return false;
        }

        const auto exported = readWavPrefix(exportFile, samples);
        clipFile.deleteFile();
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
        {
            std::cerr << "Audio clip crossfade parity channel/sample mismatch liveChannels=" << live.getNumChannels()
                      << " exportedChannels=" << exported.getNumChannels()
                      << " exportedSamples=" << exported.getNumSamples() << "\n";
            return false;
        }

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        const bool ok = liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
        if (!ok)
        {
            std::cerr << "Audio clip crossfade live/export parity failed liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAudioClipTrimLiveExportParity()
    {
        auto clipFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-trim-parity-source.wav");
        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-trim-parity.wav");
        if (!writeAudioClipFixture(clipFile))
            return false;
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        constexpr int samples = 16538;
        constexpr int blockSize = 257;
        auto project = makeAudioClipTrimProject(clipFile);
        const auto live = renderOfflineChunks(project, samples, blockSize);

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, blockSize, 2, &error))
        {
            std::cerr << "Audio clip trim parity export error: " << error << "\n";
            clipFile.deleteFile();
            return false;
        }

        const auto exported = readWavPrefix(exportFile, samples);
        clipFile.deleteFile();
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
        {
            std::cerr << "Audio clip trim parity channel/sample mismatch liveChannels=" << live.getNumChannels()
                      << " exportedChannels=" << exported.getNumChannels()
                      << " exportedSamples=" << exported.getNumSamples() << "\n";
            return false;
        }

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        const bool ok = liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
        if (!ok)
        {
            std::cerr << "Audio clip trim live/export parity failed liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineMasterLimiter()
    {
        auto project = makeTinyOfflineProject();
        auto& track = project.tracks.front();
        track.gainDb = 36.0f;

        auto& instrument = project.instruments.front();
        instrument.ampLevel = 1.0f;
        instrument.drive01 = 0.65f;

        project.eqAutomation.push_back({ 0.0, 18.0f, 18.0f, 18.0f, 18.0f });

        const auto live = renderOfflineChunks(project, 8192, 257);
        const float livePeak = bufferPeak(live);
        const double liveEnergy = bufferEnergy(live);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-master-limiter.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        const bool exportedOk = beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 257, 2, &error);
        const auto exported = exportedOk ? readWavPrefix(exportFile, 8192) : juce::AudioBuffer<float> {};
        const float exportPeak = exportedOk ? bufferPeak(exported) : std::numeric_limits<float>::quiet_NaN();
        exportFile.deleteFile();

        constexpr float ceilingWithQuantizationTolerance = 0.968f;
        const bool ok = exportedOk
            && std::isfinite(livePeak)
            && std::isfinite(exportPeak)
            && std::isfinite(liveEnergy)
            && liveEnergy > 0.001
            && livePeak <= ceilingWithQuantizationTolerance
            && exportPeak <= ceilingWithQuantizationTolerance;
        if (!ok)
        {
            std::cerr << "Master limiter stress failed livePeak=" << livePeak
                      << " exportPeak=" << exportPeak
                      << " liveEnergy=" << liveEnergy
                      << " exportedOk=" << exportedOk
                      << " error=" << error << "\n";
        }
        return ok;
    }

    bool stressAudioEngineMasterChainCompressor()
    {
        auto dryProject = makeTinyOfflineProject();
        auto compressedProject = makeTinyOfflineProject();

        dryProject.tracks.front().gainDb = 12.0f;
        compressedProject.tracks.front().gainDb = 12.0f;
        compressedProject.masterChain.compressorEnabled = true;
        compressedProject.masterChain.compressorThresholdDb = -42.0f;
        compressedProject.masterChain.compressorRatio = 16.0f;
        compressedProject.masterChain.compressorAttackMs = 0.5f;
        compressedProject.masterChain.compressorReleaseMs = 220.0f;
        compressedProject.masterChain.compressorMix = 100.0f;

        const auto dry = renderOfflineChunks(dryProject, 16384, 257);
        const auto wet = renderOfflineChunks(compressedProject, 16384, 257);
        const double dryEnergy = bufferEnergy(dry);
        const double wetEnergy = bufferEnergy(wet);
        const float dryPeak = bufferPeak(dry);
        const float wetPeak = bufferPeak(wet);

        double diff = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
            }
        }

        const bool ok = std::isfinite(dryEnergy)
            && std::isfinite(wetEnergy)
            && std::isfinite(dryPeak)
            && std::isfinite(wetPeak)
            && dryEnergy > 0.0001
            && wetEnergy > 0.000001
            && wetEnergy < dryEnergy
            && wetPeak <= dryPeak + 0.0001f
            && diff > 0.01;
        if (!ok)
        {
            std::cerr << "Master chain compressor stress failed dryEnergy=" << dryEnergy
                      << " wetEnergy=" << wetEnergy
                      << " dryPeak=" << dryPeak
                      << " wetPeak=" << wetPeak
                      << " diff=" << diff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineMasterChainBlockContinuity()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-master-chain-continuity.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto project = makeAudioClipOfflineProject(sampleFile);
        project.tracks.front().effects.clear();
        project.tracks.front().gainDb = 9.0f;
        project.masterChain.inputGainDb = 1.5f;
        project.masterChain.compressorEnabled = true;
        project.masterChain.compressorThresholdDb = -36.0f;
        project.masterChain.compressorRatio = 8.0f;
        project.masterChain.compressorAttackMs = 3.0f;
        project.masterChain.compressorReleaseMs = 180.0f;
        project.masterChain.outputGainDb = -1.0f;

        constexpr int samples = 32768;
        const auto largeBlock = renderOfflineChunks(project, samples, 4096);
        const auto smallBlock = renderOfflineChunks(project, samples, 127);
        sampleFile.deleteFile();

        double meanAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        for (int ch = 0; ch < largeBlock.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float a = largeBlock.getSample(ch, i);
                const float b = smallBlock.getSample(ch, i);
                if (!std::isfinite(a) || !std::isfinite(b))
                    return false;
                const float diff = std::abs(a - b);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                meanAbsDiff += diff;
            }
        }

        meanAbsDiff /= (double) (largeBlock.getNumChannels() * samples);
        const bool ok = bufferEnergy(largeBlock) > 0.0001
            && maxAbsDiff <= 0.001f
            && meanAbsDiff <= 0.000001;
        if (!ok)
        {
            std::cerr << "Master chain block continuity failed maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineSendReturnBus()
    {
        auto dryProject = makeTinyOfflineProject();
        auto sendProject = makeTinyOfflineProject();
        auto mutedProject = makeTinyOfflineProject();

        beat::ReturnBus bus;
        bus.id = "return-a";
        bus.name = "Return A";
        bus.gainDb = 0.0f;
        sendProject.returnBuses.push_back(bus);
        bus.mute = true;
        mutedProject.returnBuses.push_back(bus);

        beat::TrackSend send;
        send.busId = "return-a";
        send.gainDb = -6.0f;
        send.enabled = true;
        sendProject.tracks.front().sends.push_back(send);
        mutedProject.tracks.front().sends.push_back(send);

        const auto dry = renderOfflineChunks(dryProject, 8192, 257);
        const auto wet = renderOfflineChunks(sendProject, 8192, 257);
        const auto muted = renderOfflineChunks(mutedProject, 8192, 257);

        const double dryEnergy = bufferEnergy(dry);
        const double wetEnergy = bufferEnergy(wet);
        const double mutedEnergy = bufferEnergy(muted);

        double mutedDiff = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float mutedSample = muted.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(mutedSample) || !std::isfinite(wet.getSample(ch, i)))
                    return false;
                mutedDiff += std::abs((double) drySample - (double) mutedSample);
            }
        }

        const bool ok = std::isfinite(dryEnergy)
            && std::isfinite(wetEnergy)
            && std::isfinite(mutedEnergy)
            && dryEnergy > 0.0001
            && wetEnergy > dryEnergy * 1.1
            && mutedDiff < 0.00001;
        if (!ok)
        {
            std::cerr << "Send/return bus stress failed dryEnergy=" << dryEnergy
                      << " wetEnergy=" << wetEnergy
                      << " mutedEnergy=" << mutedEnergy
                      << " mutedDiff=" << mutedDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAetherSourceSendBuses()
    {
        auto dryProject = makeDenseAetherProject();
        auto sentProject = dryProject;
        auto mutedProject = dryProject;

        beat::ReturnBus bus;
        bus.id = "aether-fx-1";
        bus.name = "Aether FX 1";
        sentProject.returnBuses.push_back(bus);
        bus.mute = true;
        mutedProject.returnBuses.push_back(bus);

        auto configureSend = [](beat::Project& project)
        {
            auto& aether = project.instruments.front().aether;
            aether.fxBusIds[0] = "aether-fx-1";
            aether.oscA.fxSends[0] = 0.65f;
            aether.oscB.fxSends[0] = 0.0f;
            aether.sub.fxSends[0] = 0.0f;
            aether.noise.fxSends[0] = 0.0f;
        };
        configureSend(sentProject);
        configureSend(mutedProject);

        const auto dry = renderOfflineChunks(dryProject, 8192, 257);
        const auto sent = renderOfflineChunks(sentProject, 8192, 257);
        const auto muted = renderOfflineChunks(mutedProject, 8192, 257);
        const double dryEnergy = bufferEnergy(dry);
        const double sentEnergy = bufferEnergy(sent);
        double mutedDiff = 0.0;
        double sentDiff = 0.0;
        for (int channel = 0; channel < dry.getNumChannels(); ++channel)
        {
            for (int sample = 0; sample < dry.getNumSamples(); ++sample)
            {
                const float drySample = dry.getSample(channel, sample);
                const float sentSample = sent.getSample(channel, sample);
                const float mutedSample = muted.getSample(channel, sample);
                if (!std::isfinite(drySample) || !std::isfinite(sentSample) || !std::isfinite(mutedSample))
                    return false;
                sentDiff += std::abs((double) sentSample - drySample);
                mutedDiff += std::abs((double) mutedSample - drySample);
            }
        }

        const bool ok = dryEnergy > 0.0001
            && std::isfinite(sentEnergy)
            && sentDiff > 0.01
            && mutedDiff < 0.00001;
        if (!ok)
        {
            std::cerr << "Aether source-send bus stress failed dryEnergy=" << dryEnergy
                      << " sentEnergy=" << sentEnergy
                      << " sentDiff=" << sentDiff
                      << " mutedDiff=" << mutedDiff << "\n";
            return false;
        }

        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-aether-sample-send.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto sampleDryProject = makeDenseAetherProject();
        sampleDryProject.audioFiles.push_back({ "aether-send-sample", "Aether Send Sample",
            sampleFile.getFullPathName(), 0.5, 44100.0 });
        auto& dryAether = sampleDryProject.instruments.front().aether;
        dryAether.oscA.enabled = false;
        dryAether.oscB.enabled = false;
        dryAether.sub.enabled = false;
        dryAether.noise.enabled = false;
        dryAether.sampleSlot1 = { 4, true, "aether-send-sample", 69, 0.8f, 0.0f, 1,
            0.0f, 1.0f, false, 0.0f, 1.0f };

        auto sampleSentProject = sampleDryProject;
        auto sampleMutedProject = sampleDryProject;
        beat::ReturnBus sampleBus;
        sampleBus.id = "aether-sample-fx-1";
        sampleBus.name = "Aether Sample FX 1";
        sampleSentProject.returnBuses.push_back(sampleBus);
        sampleBus.mute = true;
        sampleMutedProject.returnBuses.push_back(sampleBus);
        const auto configureSampleSend = [](beat::Project& project)
        {
            auto& aether = project.instruments.front().aether;
            aether.fxBusIds[0] = "aether-sample-fx-1";
            aether.sampleSlot1.fxSends[0] = 0.65f;
        };
        configureSampleSend(sampleSentProject);
        configureSampleSend(sampleMutedProject);

        const auto sampleDry = renderOfflineChunks(sampleDryProject, 8192, 257);
        const auto sampleSent = renderOfflineChunks(sampleSentProject, 8192, 257);
        const auto sampleMuted = renderOfflineChunks(sampleMutedProject, 8192, 257);
        double sampleSentDiff = 0.0;
        double sampleMutedDiff = 0.0;
        for (int channel = 0; channel < sampleDry.getNumChannels(); ++channel)
            for (int sample = 0; sample < sampleDry.getNumSamples(); ++sample)
            {
                const float drySample = sampleDry.getSample(channel, sample);
                const float sentSample = sampleSent.getSample(channel, sample);
                const float mutedSample = sampleMuted.getSample(channel, sample);
                if (!std::isfinite(drySample) || !std::isfinite(sentSample) || !std::isfinite(mutedSample))
                {
                    sampleFile.deleteFile();
                    return false;
                }
                sampleSentDiff += std::abs((double) sentSample - drySample);
                sampleMutedDiff += std::abs((double) mutedSample - drySample);
            }

        beat::AudioEngine callbackEngine;
        constexpr int callbackBlockSize = 256;
        callbackEngine.prepareForOffline(48000.0, callbackBlockSize, 2);
        callbackEngine.applyProject(sampleSentProject);
        callbackEngine.requestPlay();
        for (int block = 0; block < 4; ++block)
            renderEngineBlock(callbackEngine, callbackBlockSize);
        juce::AudioBuffer<float> callbackOutput(2, callbackBlockSize);
        std::array<float*, 2> callbackOutputs {
            callbackOutput.getWritePointer(0), callbackOutput.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext callbackContext;
        beat::test::beginRealtimeSafetyProbe();
        callbackEngine.audioDeviceIOCallbackWithContext(
            nullptr, 0, callbackOutputs.data(), 2, callbackBlockSize, callbackContext);
        const size_t sampleSendViolations = beat::test::endRealtimeSafetyProbe();
        sampleFile.deleteFile();

        const bool sampleOk = bufferEnergy(sampleDry) > 0.0001
            && sampleSentDiff > 0.01
            && sampleMutedDiff < 0.00001
            && sampleSendViolations == 0
            && std::isfinite(bufferEnergy(callbackOutput));
        if (!sampleOk)
        {
            std::cerr << "Aether sample-source send stress failed sentDiff=" << sampleSentDiff
                      << " mutedDiff=" << sampleMutedDiff
                      << " callbackViolations=" << sampleSendViolations << "\n";
        }
        return sampleOk;
    }

    bool stressAudioEngineGroupRouting()
    {
        auto dryProject = makeTinyOfflineProject();
        auto groupedProject = makeTinyOfflineProject();
        auto attenuatedProject = makeTinyOfflineProject();

        beat::Track group;
        group.id = "group-a";
        group.name = "Group A";
        group.kind = beat::TrackKind::Group;
        group.gainDb = 0.0f;

        groupedProject.tracks.front().parentTrackId = group.id;
        groupedProject.tracks.push_back(group);

        group.gainDb = -12.0f;
        attenuatedProject.tracks.front().parentTrackId = group.id;
        attenuatedProject.tracks.push_back(group);

        const auto dry = renderOfflineChunks(dryProject, 8192, 257);
        const auto grouped = renderOfflineChunks(groupedProject, 8192, 257);
        const auto attenuated = renderOfflineChunks(attenuatedProject, 8192, 257);

        double groupedDiff = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float groupedSample = grouped.getSample(ch, i);
                const float attenuatedSample = attenuated.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(groupedSample) || !std::isfinite(attenuatedSample))
                    return false;
                groupedDiff += std::abs((double) drySample - (double) groupedSample);
            }
        }

        const double dryEnergy = bufferEnergy(dry);
        const double groupedEnergy = bufferEnergy(grouped);
        const double attenuatedEnergy = bufferEnergy(attenuated);
        const bool ok = std::isfinite(dryEnergy)
            && std::isfinite(groupedEnergy)
            && std::isfinite(attenuatedEnergy)
            && dryEnergy > 0.0001
            && groupedDiff < 0.00001
            && attenuatedEnergy < dryEnergy * 0.15;
        if (!ok)
        {
            std::cerr << "Group routing stress failed dryEnergy=" << dryEnergy
                      << " groupedEnergy=" << groupedEnergy
                      << " attenuatedEnergy=" << attenuatedEnergy
                      << " groupedDiff=" << groupedDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineTrackStemExport()
    {
        auto masterFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-master-export.wav");
        auto stemFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-track-stem.wav");
        auto missingStemFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-missing-stem.wav");
        if (masterFile.existsAsFile()) masterFile.deleteFile();
        if (stemFile.existsAsFile()) stemFile.deleteFile();
        if (missingStemFile.existsAsFile()) missingStemFile.deleteFile();

        juce::String error;
        auto project = makeTwoTrackOfflineProject();
        if (!beat::AudioEngine::renderProjectToWav(project, masterFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Master stem fixture export error: " << error << "\n";
            return false;
        }

        error.clear();
        if (!beat::AudioEngine::renderTrackToWav(project, "offline-track-b", stemFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Track stem export error: " << error << "\n";
            return false;
        }

        juce::String missingError;
        if (beat::AudioEngine::renderTrackToWav(project,
                                                "missing-track",
                                                missingStemFile,
                                                44100.0,
                                                256,
                                                2,
                                                &missingError))
        {
            return false;
        }

        auto liveSoloProject = project;
        for (auto& track : liveSoloProject.tracks)
        {
            const bool isTarget = track.id == "offline-track-b";
            track.solo = isTarget;
            track.mute = !isTarget;
        }

        constexpr int samples = 12000;
        const auto liveStem = renderOfflineChunks(liveSoloProject, samples, 256);
        const auto exportedStem = readWavPrefix(stemFile, samples);
        const double masterEnergy = wavEnergy(masterFile);
        const double stemEnergy = wavEnergy(stemFile);

        masterFile.deleteFile();
        stemFile.deleteFile();
        missingStemFile.deleteFile();

        bool parityOk = exportedStem.getNumChannels() == liveStem.getNumChannels()
            && exportedStem.getNumSamples() >= samples;
        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        if (parityOk)
        {
            for (int ch = 0; ch < liveStem.getNumChannels(); ++ch)
            {
                for (int i = 0; i < samples; ++i)
                {
                    const float liveSample = liveStem.getSample(ch, i);
                    const float exportSample = exportedStem.getSample(ch, i);
                    if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    {
                        parityOk = false;
                        break;
                    }

                    const float diff = std::abs(liveSample - exportSample);
                    maxAbsDiff = std::max(maxAbsDiff, diff);
                    sumAbsDiff += diff;
                    liveEnergy += (double) liveSample * (double) liveSample;
                }
                if (!parityOk)
                    break;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (liveStem.getNumChannels() * samples);
        const bool ok = std::isfinite(masterEnergy)
            && std::isfinite(stemEnergy)
            && masterEnergy > 0.0001
            && stemEnergy > 0.0001
            && std::abs(masterEnergy - stemEnergy) > 0.0001
            && liveEnergy > 0.0001
            && parityOk
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002
            && missingError.isNotEmpty();
        if (!ok)
        {
            std::cerr << "Track stem export stress failed masterEnergy=" << masterEnergy
                      << " stemEnergy=" << stemEnergy
                      << " liveEnergy=" << liveEnergy
                      << " parity=" << parityOk
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff
                      << " missingError=" << missingError << "\n";
        }
        return ok;
    }

    bool stressTrackBouncePlanner()
    {
        auto stemFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-bounce-source.wav");
        auto bouncedFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-bounce-render.wav");
        if (stemFile.existsAsFile()) stemFile.deleteFile();
        if (bouncedFile.existsAsFile()) bouncedFile.deleteFile();

        juce::String error;
        auto project = makeTwoTrackOfflineProject();
        if (!beat::AudioEngine::renderTrackToWav(project, "offline-track-b", stemFile, 44100.0, 256, 2, &error, {}, 24))
        {
            std::cerr << "Track bounce source render failed: " << error << "\n";
            return false;
        }

        juce::WavAudioFormat wavFormat;
        auto input = stemFile.createInputStream();
        std::unique_ptr<juce::AudioFormatReader> reader(input != nullptr
            ? wavFormat.createReaderFor(input.release(), true)
            : nullptr);
        if (reader == nullptr || reader->lengthInSamples <= 0 || reader->sampleRate <= 0.0)
        {
            std::cerr << "Track bounce source reader validation failed\n";
            stemFile.deleteFile();
            return false;
        }

        const double durationSeconds = (double) reader->lengthInSamples / reader->sampleRate;

        beat::TrackBounceSpec spec;
        spec.sourceTrackId = "offline-track-b";
        spec.bouncedTrackId = "offline-track-b-bounced";
        spec.audioFileId = "offline-track-b-bounce-audio";
        spec.segmentId = "offline-track-b-bounce-segment";
        spec.audioFileName = "Offline Track B Bounce";
        spec.audioFilePath = stemFile.getFullPathName();
        spec.durationSeconds = durationSeconds;
        spec.sampleRate = reader->sampleRate;
        spec.startBeat = 0.0;

        const auto originalTrackCount = project.tracks.size();
        const auto originalAudioFileCount = project.audioFiles.size();
        auto result = beat::applyTrackBounce(project, spec, &error);
        if (!result.has_value())
        {
            std::cerr << "Track bounce planner failed: " << error << "\n";
            stemFile.deleteFile();
            return false;
        }

        const auto sourceTrackIt = std::find_if(project.tracks.begin(),
                                                project.tracks.end(),
                                                [](const beat::Track& track) { return track.id == "offline-track-b"; });
        const auto bouncedTrackIt = std::find_if(project.tracks.begin(),
                                                 project.tracks.end(),
                                                 [](const beat::Track& track) { return track.id == "offline-track-b-bounced"; });
        const auto audioFileIt = std::find_if(project.audioFiles.begin(),
                                              project.audioFiles.end(),
                                              [](const beat::AudioFileAsset& audioFile)
                                              {
                                                  return audioFile.id == "offline-track-b-bounce-audio";
                                              });

        bool duplicateRejected = false;
        {
            juce::String duplicateError;
            auto staged = project;
            duplicateRejected = !beat::applyTrackBounce(staged, spec, &duplicateError).has_value()
                && duplicateError.isNotEmpty()
                && staged.tracks.size() == project.tracks.size()
                && staged.audioFiles.size() == project.audioFiles.size();
        }

        bool groupedBouncePolicyOk = false;
        {
            auto grouped = makeTwoTrackOfflineProject();
            beat::Track group;
            group.id = "bounce-group";
            group.name = "Bounce Group";
            group.kind = beat::TrackKind::Group;
            group.gainDb = -6.0f;
            grouped.tracks.push_back(group);
            auto source = std::find_if(grouped.tracks.begin(),
                                       grouped.tracks.end(),
                                       [](const beat::Track& track) { return track.id == "offline-track-b"; });
            if (source != grouped.tracks.end())
                source->parentTrackId = group.id;

            beat::TrackBounceSpec groupedSpec = spec;
            groupedSpec.bouncedTrackId = "offline-track-b-group-bounced";
            groupedSpec.audioFileId = "offline-track-b-group-bounce-audio";
            groupedSpec.segmentId = "offline-track-b-group-bounce-segment";
            groupedSpec.preserveParentRouting = false;

            juce::String groupedError;
            const auto directResult = beat::applyTrackBounce(grouped, groupedSpec, &groupedError);
            const auto directBounce = std::find_if(grouped.tracks.begin(),
                                                   grouped.tracks.end(),
                                                   [](const beat::Track& track) { return track.id == "offline-track-b-group-bounced"; });

            auto preserving = makeTwoTrackOfflineProject();
            preserving.tracks.push_back(group);
            auto preservingSource = std::find_if(preserving.tracks.begin(),
                                                 preserving.tracks.end(),
                                                 [](const beat::Track& track) { return track.id == "offline-track-b"; });
            if (preservingSource != preserving.tracks.end())
                preservingSource->parentTrackId = group.id;

            beat::TrackBounceSpec preservingSpec = spec;
            preservingSpec.bouncedTrackId = "offline-track-b-preserved-bounced";
            preservingSpec.audioFileId = "offline-track-b-preserved-bounce-audio";
            preservingSpec.segmentId = "offline-track-b-preserved-bounce-segment";
            preservingSpec.preserveParentRouting = true;

            juce::String preservingError;
            const auto preservedResult = beat::applyTrackBounce(preserving, preservingSpec, &preservingError);
            const auto preservedBounce = std::find_if(preserving.tracks.begin(),
                                                      preserving.tracks.end(),
                                                      [](const beat::Track& track) { return track.id == "offline-track-b-preserved-bounced"; });

            groupedBouncePolicyOk = directResult.has_value()
                && directBounce != grouped.tracks.end()
                && directBounce->parentTrackId.isEmpty()
                && preservedResult.has_value()
                && preservedBounce != preserving.tracks.end()
                && preservedBounce->parentTrackId == group.id;
        }

        const bool modelOk = project.tracks.size() == originalTrackCount + 1
            && project.audioFiles.size() == originalAudioFileCount + 1
            && sourceTrackIt != project.tracks.end()
            && sourceTrackIt->mute
            && !sourceTrackIt->solo
            && bouncedTrackIt != project.tracks.end()
            && bouncedTrackIt->kind == beat::TrackKind::Audio
            && bouncedTrackIt->audioFileId == "offline-track-b-bounce-audio"
            && bouncedTrackIt->segments.size() == 1
            && bouncedTrackIt->segments.front().kind == beat::SegmentPayloadKind::Audio
            && bouncedTrackIt->segments.front().audioFileId == "offline-track-b-bounce-audio"
            && std::abs(bouncedTrackIt->segments.front().lengthBeats - result->lengthBeats) < 0.0001
            && audioFileIt != project.audioFiles.end()
            && std::abs(audioFileIt->durationSeconds - durationSeconds) < 0.0001
            && duplicateRejected
            && groupedBouncePolicyOk;

        error.clear();
        const bool rendered = beat::AudioEngine::renderProjectToWav(project, bouncedFile, 44100.0, 256, 2, &error, {}, 24);
        const double sourceEnergy = wavEnergy(stemFile);
        const double bouncedEnergy = rendered ? wavEnergy(bouncedFile) : 0.0;

        const bool renderOk = rendered
            && std::isfinite(sourceEnergy)
            && std::isfinite(bouncedEnergy)
            && sourceEnergy > 0.0001
            && bouncedEnergy > 0.0001;

        stemFile.deleteFile();
        bouncedFile.deleteFile();

        if (!modelOk || !renderOk)
        {
            std::cerr << "Track bounce planner stress failed modelOk=" << modelOk
                      << " renderOk=" << renderOk
                      << " groupedBouncePolicyOk=" << groupedBouncePolicyOk
                      << " sourceEnergy=" << sourceEnergy
                      << " bouncedEnergy=" << bouncedEnergy
                      << " error=" << error << "\n";
        }

        return modelOk && renderOk;
    }

    bool stressAudioEngineProjectApplyChurn()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 128, 2);

        for (int i = 0; i < 80; ++i)
        {
            auto project = i % 2 == 0 ? makeTinyOfflineProject() : makeTwoTrackOfflineProject();
            project.bpm = 90.0 + (double) (i % 40);
            engine.applyProject(std::move(project));

            if (i % 5 == 0)
                engine.requestRestart();
            else if (i % 5 == 1)
                engine.requestPlay();
            else if (i % 5 == 2)
                engine.requestSeek((double) (i % 4) * 0.125);
            else if (i % 5 == 3)
                engine.requestPause();
            else
                engine.requestStop();

            for (int p = 0; p < 8; ++p)
            {
                if (!engine.queueRealtimeParameterChange("offline-synth", "filter.cutoff", (float) p / 8.0f, p * 2, 32))
                    return false;
            }

            const auto buffer = renderEngineBlock(engine, 512);
            const double energy = bufferEnergy(buffer);
            if (!std::isfinite(energy))
                return false;

            beat::AudioEngine::RenderTimingSnapshot timing;
            engine.pullRenderTimingSnapshot(timing);
        }

        return true;
    }

    bool stressAudioEngineDurableTelemetry()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(48000.0, 64, 2);
        engine.applyProject(makeTinyOfflineProject());
        engine.requestPlay();

        int accepted = 0;
        int rejected = 0;
        for (int i = 0; i < 1100; ++i)
        {
            if (engine.queueRealtimeParameterChange("offline-synth", "filter.cutoff", (float) (i % 100) / 100.0f, i % 64, 16))
                ++accepted;
            else
                ++rejected;
        }
        if (accepted != (int) beat::RenderBudgets::realtimeQueueEvents || rejected <= 0)
            return false;

        renderEngineBlock(engine, 64);
        beat::AudioEngine::RenderTimingSnapshot first;
        if (!engine.pullRenderTimingSnapshot(first)
            || first.realtimeQueueAccepted != accepted
            || first.realtimeQueueRejected != rejected
            || first.blockEventOverflows < 0
            || first.deadlineOverruns < 0
            || first.callbackSafetyViolations != 0)
            return false;

        renderEngineBlock(engine, 128);
        beat::AudioEngine::RenderTimingSnapshot second;
        return engine.pullRenderTimingSnapshot(second)
            && second.realtimeQueueAccepted == accepted
            && second.realtimeQueueRejected == rejected
            && second.callbackSafetyViolations > first.callbackSafetyViolations;
    }

    bool stressAudioEngineQualityModes()
    {
        beat::AudioEngine standard;
        beat::AudioEngine highQuality;
        standard.prepareForOffline(48000.0, 256, 2);
        highQuality.prepareForOffline(48000.0, 256, 2);
        if (standard.getProcessingQuality() != beat::AudioQuality::standardLive)
            return false;
        highQuality.setProcessingQuality(beat::AudioQuality::offlineHighQuality);
        if (highQuality.getProcessingQuality() != beat::AudioQuality::offlineHighQuality)
            return false;
        standard.applyProject(makeDenseAetherProject());
        highQuality.applyProject(makeDenseAetherProject());
        standard.requestPlay();
        highQuality.requestPlay();
        const auto live = renderEngineBlock(standard, 4096);
        const auto hq = renderEngineBlock(highQuality, 4096);
        if (standard.sequencer().getPosition() != highQuality.sequencer().getPosition())
            return false;
        double difference = 0.0;
        for (int channel = 0; channel < live.getNumChannels(); ++channel)
            for (int sample = 0; sample < live.getNumSamples(); ++sample)
            {
                const float a = live.getSample(channel, sample);
                const float b = hq.getSample(channel, sample);
                if (!std::isfinite(a) || !std::isfinite(b))
                    return false;
                difference += std::abs((double) a - (double) b);
            }
        if (difference <= 0.0001)
            return false;

        auto exportProject = makeDenseAetherProject();
        exportProject.lengthBeats = juce::jmin<beat::Beats>(exportProject.lengthBeats, 0.5);
        const auto defaultFile = juce::File("/private/tmp/BeatBackendStress-export-quality-default.wav");
        const auto standardFile = juce::File("/private/tmp/BeatBackendStress-export-quality-standard.wav");
        const auto highFile = juce::File("/private/tmp/BeatBackendStress-export-quality-high.wav");
        for (const auto& file : { defaultFile, standardFile, highFile })
            if (file.existsAsFile())
                file.deleteFile();

        juce::String error;
        const bool rendered = beat::AudioEngine::renderProjectToWav(
                exportProject, defaultFile, 48000.0, 256, 2, &error, {}, 32)
            && beat::AudioEngine::renderProjectToWav(
                exportProject, standardFile, 48000.0, 256, 2, &error, {}, 32,
                beat::AudioQuality::standardLive)
            && beat::AudioEngine::renderProjectToWav(
                exportProject, highFile, 48000.0, 256, 2, &error, {}, 32,
                beat::AudioQuality::offlineHighQuality);
        if (!rendered)
        {
            std::cerr << "Offline quality export failed: " << error << "\n";
            for (const auto& file : { defaultFile, standardFile, highFile })
                file.deleteFile();
            return false;
        }

        constexpr int comparisonSamples = 4096;
        const auto defaultExport = readWavPrefix(defaultFile, comparisonSamples);
        const auto standardExport = readWavPrefix(standardFile, comparisonSamples);
        const auto highExport = readWavPrefix(highFile, comparisonSamples);
        for (const auto& file : { defaultFile, standardFile, highFile })
            file.deleteFile();
        if (defaultExport.getNumSamples() < comparisonSamples
            || standardExport.getNumSamples() < comparisonSamples
            || highExport.getNumSamples() < comparisonSamples)
            return false;

        double explicitStandardDifference = 0.0;
        double highExportDifference = 0.0;
        for (int channel = 0; channel < defaultExport.getNumChannels(); ++channel)
            for (int sample = 0; sample < comparisonSamples; ++sample)
            {
                const float defaultSample = defaultExport.getSample(channel, sample);
                const float standardSample = standardExport.getSample(channel, sample);
                const float highSample = highExport.getSample(channel, sample);
                if (!std::isfinite(defaultSample) || !std::isfinite(standardSample) || !std::isfinite(highSample))
                    return false;
                explicitStandardDifference += std::abs((double) defaultSample - standardSample);
                highExportDifference += std::abs((double) defaultSample - highSample);
            }
        return explicitStandardDifference == 0.0 && highExportDifference > 0.0001;
    }

    bool stressAudioCallbackAllocationFreedom()
    {
        beat::AudioEngine engine;
        constexpr int blockSize = 256;
        engine.prepareForOffline(48000.0, blockSize, 2);
        engine.applyProject(makeDenseAetherProject());
        engine.requestPlay();
        for (int i = 0; i < 4; ++i)
            renderEngineBlock(engine, blockSize);

        juce::AudioBuffer<float> output(2, blockSize);
        std::array<float*, 2> outputs {
            output.getWritePointer(0),
            output.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;
        if (!engine.queueRealtimeParameterChange("dense-aether", "osc.a.position", 0.73f, 37, 64))
            return false;
        output.clear();
        beat::test::beginRealtimeSafetyProbe();
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, blockSize, context);
        const size_t violations = beat::test::endRealtimeSafetyProbe();
        if (violations != 0)
        {
            std::cerr << "Audio callback realtime-safety violations: " << violations << "\n";
            for (size_t index = 0; index < std::min<size_t>(violations, 128); ++index)
            {
                Dl_info info {};
                const auto violation = beat::test::realtimeSafetyViolation(index);
                const auto address = violation.callsite;
                if (address != nullptr && dladdr(address, &info) != 0)
                    std::cerr << "  " << index << " kind=" << (int) violation.kind << ": "
                              << (info.dli_sname != nullptr ? info.dli_sname : "unknown")
                              << " + " << (static_cast<const char*>(address) - static_cast<const char*>(info.dli_saddr))
                              << " bytes\n";
            }
        }
        return violations == 0 && std::isfinite(bufferEnergy(output));
    }

    class DeterministicSamplePageLoader final : public beat::SamplePageLoader
    {
    public:
        explicit DeterministicSamplePageLoader(int64_t frames) : totalFrames(frames) {}

        int readFrames(int64_t firstFrame, int frameCount,
                       float* left, float* right) noexcept override
        {
            calls.fetch_add(1, std::memory_order_relaxed);
            if (firstFrame < 0 || firstFrame >= totalFrames || frameCount <= 0)
                return 0;
            const int available = (int) std::min<int64_t>(frameCount, totalFrames - firstFrame);
            for (int index = 0; index < available; ++index)
            {
                const float value = expected(firstFrame + index);
                left[index] = value;
                right[index] = -value;
            }
            return available;
        }

        static float expected(int64_t frame) noexcept
        {
            return (float) ((frame % 997) + 1) / 997.0f;
        }

        const int64_t totalFrames;
        std::atomic<uint64_t> calls { 0 };
    };

    class StarvedSamplePageLoader final : public beat::SamplePageLoader
    {
    public:
        StarvedSamplePageLoader(int64_t frames, int delayMicroseconds)
            : totalFrames(frames), delay(delayMicroseconds)
        {
        }

        void failNextLoads(int count) noexcept
        {
            failuresRemaining.store(std::max(0, count), std::memory_order_release);
        }

        int readFrames(int64_t firstFrame, int frameCount,
                       float* left, float* right) noexcept override
        {
            calls.fetch_add(1, std::memory_order_relaxed);
            if (delay.count() > 0)
                std::this_thread::sleep_for(delay);

            int remaining = failuresRemaining.load(std::memory_order_acquire);
            while (remaining > 0)
            {
                if (failuresRemaining.compare_exchange_weak(
                        remaining, remaining - 1,
                        std::memory_order_acq_rel, std::memory_order_acquire))
                    return 0;
            }

            if (firstFrame < 0 || firstFrame >= totalFrames || frameCount <= 0)
                return 0;
            const int available = (int) std::min<int64_t>(frameCount, totalFrames - firstFrame);
            for (int index = 0; index < available; ++index)
            {
                const float value = DeterministicSamplePageLoader::expected(firstFrame + index);
                left[index] = value;
                right[index] = -value;
            }
            return available;
        }

        const int64_t totalFrames;
        const std::chrono::microseconds delay;
        std::atomic<int> failuresRemaining { 0 };
        std::atomic<uint64_t> calls { 0 };
    };

    bool stressBoundedSamplePageCache()
    {
        constexpr int64_t frameCount = (int64_t) beat::BoundedSamplePageCache::pageFrames * 96 + 17;
        DeterministicSamplePageLoader loader(frameCount);
        beat::BoundedSamplePageCache cache(loader, frameCount);
        if (!cache.isValid() || cache.frameCount() != frameCount || !cache.preloadFrame(0))
            return false;

        beat::BoundedSamplePageCache::StereoFrame frame;
        beat::test::beginRealtimeSafetyProbe();
        const bool hit = cache.readStereoFrame(123, frame);
        const bool miss = cache.readStereoFrame(
            (int64_t) beat::BoundedSamplePageCache::pageFrames * 20, frame);
        const size_t callbackViolations = beat::test::endRealtimeSafetyProbe();
        if (!hit || miss || callbackViolations != 0)
        {
            std::cerr << "  bounded cache callback boundary failed hit=" << hit
                      << " miss=" << miss << " violations=" << callbackViolations << "\n";
            return false;
        }

        // Repeated misses for one page occupy one queue entry.
        (void) cache.readStereoFrame((int64_t) beat::BoundedSamplePageCache::pageFrames * 20, frame);
        auto telemetry = cache.telemetry();
        if (telemetry.requestsAccepted != 1 || telemetry.requestsDeduplicated != 1
            || !cache.hasPendingRequest() || !cache.serviceOneRequest()
            || !cache.isPageResident(20))
        {
            std::cerr << "  bounded cache request dedup/service failed accepted="
                      << telemetry.requestsAccepted << " dedup=" << telemetry.requestsDeduplicated << "\n";
            return false;
        }

        const int64_t requestedFrame = (int64_t) beat::BoundedSamplePageCache::pageFrames * 20 + 37;
        if (!cache.readStereoFrame(requestedFrame, frame)
            || !near(frame.left, DeterministicSamplePageLoader::expected(requestedFrame), 0.000001f)
            || !near(frame.right, -frame.left, 0.000001f))
        {
            std::cerr << "  bounded cache materialized data mismatch\n";
            return false;
        }

        // Queue overflow is explicit and bounded; it cannot allocate or block.
        DeterministicSamplePageLoader saturationLoader(frameCount);
        beat::BoundedSamplePageCache saturated(saturationLoader, frameCount);
        for (int64_t page = 0; page < 90; ++page)
            (void) saturated.readStereoFrame(page * beat::BoundedSamplePageCache::pageFrames, frame);
        const auto saturationTelemetry = saturated.telemetry();
        if (saturationTelemetry.requestsAccepted != beat::BoundedSamplePageCache::requestCapacity
            || saturationTelemetry.requestsRejected == 0)
        {
            std::cerr << "  bounded cache saturation was not reported accepted="
                      << saturationTelemetry.requestsAccepted << " rejected="
                      << saturationTelemetry.requestsRejected << "\n";
            return false;
        }

        // Exercise bank replacement while a single worker services callback requests.
        DeterministicSamplePageLoader concurrentLoader(frameCount);
        beat::BoundedSamplePageCache concurrent(concurrentLoader, frameCount);
        for (int page = 0; page < (int) beat::BoundedSamplePageCache::residentPageCount; ++page)
            if (!concurrent.preloadFrame((int64_t) page * beat::BoundedSamplePageCache::pageFrames))
                return false;

        std::atomic<bool> callbackDone { false };
        std::thread worker([&] {
            while (!callbackDone.load(std::memory_order_acquire) || concurrent.hasPendingRequest())
            {
                if (!concurrent.serviceOneRequest())
                    std::this_thread::yield();
            }
        });

        uint32_t random = 0x9e3779b9u;
        uint64_t concurrentHits = 0;
        bool coherent = true;
        for (int iteration = 0; iteration < 200000; ++iteration)
        {
            random = random * 1664525u + 1013904223u;
            const int64_t position = (int64_t) (random % (uint32_t) frameCount);
            if (!concurrent.readStereoFrame(position, frame))
                continue;
            ++concurrentHits;
            if (!std::isfinite(frame.left) || !std::isfinite(frame.right)
                || !near(frame.left, DeterministicSamplePageLoader::expected(position), 0.000001f)
                || !near(frame.right, -frame.left, 0.000001f))
            {
                coherent = false;
                break;
            }
        }
        callbackDone.store(true, std::memory_order_release);
        worker.join();

        telemetry = concurrent.telemetry();
        if (!coherent || concurrentHits == 0 || telemetry.pagesLoaded <= beat::BoundedSamplePageCache::residentPageCount
            || telemetry.cacheMisses == 0 || telemetry.underflows != telemetry.cacheMisses)
        {
            std::cerr << "  bounded cache concurrency failed coherent=" << coherent
                      << " hits=" << concurrentHits << " loads=" << telemetry.pagesLoaded
                      << " misses=" << telemetry.cacheMisses << " underflows=" << telemetry.underflows << "\n";
            return false;
        }

        const auto beforeInvalid = cache.telemetry();
        if (cache.readStereoFrame(frameCount, frame))
            return false;
        const auto afterInvalid = cache.telemetry();
        return afterInvalid.underflows == beforeInvalid.underflows + 1
            && afterInvalid.requestsAccepted == beforeInvalid.requestsAccepted;
    }

    bool stressBoundedSamplePageCacheStarvation()
    {
        constexpr int pageCount = 128;
        constexpr int64_t frameCount =
            (int64_t) beat::BoundedSamplePageCache::pageFrames * pageCount;
        StarvedSamplePageLoader loader(frameCount, 2000);
        beat::BoundedSamplePageCache cache(loader, frameCount);
        if (!cache.preloadFrame(0))
            return false;

        loader.failNextLoads(64);
        std::atomic<bool> callbackDone { false };
        std::thread worker([&] {
            while (!callbackDone.load(std::memory_order_acquire) || cache.hasPendingRequest())
            {
                if (!cache.serviceOneRequest())
                    std::this_thread::yield();
            }
        });

        const auto started = std::chrono::steady_clock::now();
        beat::BoundedSamplePageCache::StereoFrame frame;
        uint32_t random = 0x7f4a7c15u;
        bool coherent = true;
        uint64_t hits = 0;
        beat::test::beginRealtimeSafetyProbe();
        for (int iteration = 0; iteration < 50000; ++iteration)
        {
            random = random * 1664525u + 1013904223u;
            const int64_t position = (int64_t) (random % (uint32_t) frameCount);
            const bool available = cache.readStereoFrame(position, frame);
            if (!std::isfinite(frame.left) || !std::isfinite(frame.right))
            {
                coherent = false;
                break;
            }
            if (available)
            {
                ++hits;
                if (!near(frame.left, DeterministicSamplePageLoader::expected(position), 0.000001f)
                    || !near(frame.right, -frame.left, 0.000001f))
                {
                    coherent = false;
                    break;
                }
            }
            else if (frame.left != 0.0f || frame.right != 0.0f)
            {
                coherent = false;
                break;
            }
        }
        const size_t callbackViolations = beat::test::endRealtimeSafetyProbe();

        bool starvationObserved = false;
        for (int attempt = 0; attempt < 1000; ++attempt)
        {
            if (cache.telemetry().pageLoadsFailed >= 64)
            {
                starvationObserved = true;
                break;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        loader.failNextLoads(0);
        const int64_t recoveryPosition =
            (int64_t) (pageCount - 1) * beat::BoundedSamplePageCache::pageFrames + 17;
        bool recovered = false;
        for (int attempt = 0; !recovered && attempt < 1000; ++attempt)
        {
            recovered = cache.readStereoFrame(recoveryPosition, frame);
            if (!recovered)
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        callbackDone.store(true, std::memory_order_release);
        worker.join();

        const auto telemetry = cache.telemetry();
        const double wallMs = std::chrono::duration<double, std::milli>(
            std::chrono::steady_clock::now() - started).count();
        std::cerr << "streaming starvation: wallMs=" << wallMs
                  << " hits=" << hits
                  << " misses=" << telemetry.cacheMisses
                  << " accepted=" << telemetry.requestsAccepted
                  << " rejected=" << telemetry.requestsRejected
                  << " dedup=" << telemetry.requestsDeduplicated
                  << " loaded=" << telemetry.pagesLoaded
                  << " failed=" << telemetry.pageLoadsFailed << "\n";

        return coherent && callbackViolations == 0 && starvationObserved && recovered
            && near(frame.left, DeterministicSamplePageLoader::expected(recoveryPosition), 0.000001f)
            && telemetry.cacheMisses > 0
            && telemetry.underflows == telemetry.cacheMisses
            && telemetry.requestsAccepted > 0
            && telemetry.requestsRejected > 0
            && telemetry.requestsDeduplicated > 0
            && telemetry.pagesLoaded >= 2
            && telemetry.pageLoadsFailed >= 64
            && wallMs < 5000.0;
    }

    bool stressSampleStreamingSession()
    {
        constexpr int sourceFrames = beat::BoundedSamplePageCache::pageFrames * 48;
        constexpr double sourceRate = 48000.0;
        auto file = juce::File("/private/tmp").getChildFile("BeatBackendStress-streaming-source.wav");
        if (file.existsAsFile())
            file.deleteFile();

        juce::AudioBuffer<float> sourceAudio(2, sourceFrames);
        for (int index = 0; index < sourceFrames; ++index)
        {
            const float value = 0.4f * std::sin(
                juce::MathConstants<double>::twoPi * 440.0 * (double) index / sourceRate);
            sourceAudio.setSample(0, index, value);
            sourceAudio.setSample(1, index, -value * 0.5f);
        }
        juce::WavAudioFormat wav;
        auto output = file.createOutputStream();
        std::unique_ptr<juce::AudioFormatWriter> writer(
            output != nullptr ? wav.createWriterFor(output.get(), sourceRate, 2, 24, {}, 0) : nullptr);
        if (writer == nullptr)
            return false;
        output.release();
        if (!writer->writeFromAudioSampleBuffer(sourceAudio, 0, sourceFrames))
            return false;
        writer.reset();

        bool passed = false;
        {
            juce::AudioFormatManager formats;
            formats.registerBasicFormats();
            auto session = std::make_shared<beat::SampleStreamingSession>();
            const auto metadata = session->addAsset(file, formats);
            if (!metadata || metadata->frames != sourceFrames || metadata->channels != 2
                || metadata->sampleRate != sourceRate)
                return false;

            auto source = std::make_shared<beat::ImmutableSampleSource>();
            source->streamingSession = session;
            source->streamingAssetIndex = metadata->index;
            source->streamingFrameCount = metadata->frames;
            source->streamingChannelCount = metadata->channels;
            source->sourceSampleRate = metadata->sampleRate;
            source->rootNote = 69;

            beat::SampleSourceSlot slot;
            if (!slot.prepare({ sourceRate, 256, 2 }) || !slot.publish(source)
                || !slot.noteOn({ 69, 1.0f, 5001 }))
                return false;

            beat::test::beginRealtimeSafetyProbe();
            const auto missing = slot.renderFrame();
            const size_t missingViolations = beat::test::endRealtimeSafetyProbe();
            if (missingViolations != 0 || missing.left != 0.0f || missing.right != 0.0f)
                return false;

            if (!session->preloadFrame(metadata->index, 0))
                return false;
            float recoveredPeak = 0.0f;
            float maximumStep = 0.0f;
            float previous = 0.0f;
            beat::test::beginRealtimeSafetyProbe();
            for (int index = 0; index < 192; ++index)
            {
                const auto frame = slot.renderFrame();
                recoveredPeak = std::max(recoveredPeak, std::abs(frame.left));
                maximumStep = std::max(maximumStep, std::abs(frame.left - previous));
                previous = frame.left;
            }
            const size_t recoveryViolations = beat::test::endRealtimeSafetyProbe();
            if (recoveryViolations != 0 || recoveredPeak < 0.1f || maximumStep > 0.08f)
                return false;

            beat::SampleSourceSlot starvationSlot;
            if (!starvationSlot.prepare({ sourceRate, 256, 2 })
                || !starvationSlot.publish(source)
                || !starvationSlot.noteOn({ 69, 1.0f, 5501 }))
                return false;
            float starvationPrevious = 0.0f;
            float starvationMaximumStep = 0.0f;
            float starvationTailPeak = 0.0f;
            bool starvationFinite = true;
            beat::test::beginRealtimeSafetyProbe();
            for (int index = 0; index < beat::BoundedSamplePageCache::pageFrames + 128; ++index)
            {
                const auto frame = starvationSlot.renderFrame();
                starvationFinite = starvationFinite
                    && std::isfinite(frame.left) && std::isfinite(frame.right);
                starvationMaximumStep = std::max(
                    starvationMaximumStep, std::abs(frame.left - starvationPrevious));
                starvationPrevious = frame.left;
                if (index >= beat::BoundedSamplePageCache::pageFrames + 112)
                    starvationTailPeak = std::max(starvationTailPeak, std::abs(frame.left));
            }
            const size_t starvationCallbackViolations = beat::test::endRealtimeSafetyProbe();
            if (!session->preloadFrame(metadata->index,
                                       beat::BoundedSamplePageCache::pageFrames + 128))
                return false;
            float starvationRecoveryPeak = 0.0f;
            for (int index = 0; index < 192; ++index)
            {
                const auto frame = starvationSlot.renderFrame();
                starvationFinite = starvationFinite
                    && std::isfinite(frame.left) && std::isfinite(frame.right);
                starvationMaximumStep = std::max(
                    starvationMaximumStep, std::abs(frame.left - starvationPrevious));
                starvationPrevious = frame.left;
                starvationRecoveryPeak = std::max(starvationRecoveryPeak, std::abs(frame.left));
            }
            if (!starvationFinite || starvationCallbackViolations != 0
                || starvationTailPeak > 0.000001f
                || starvationRecoveryPeak < 0.1f
                || starvationMaximumStep > 0.08f)
                return false;

            auto loopSource = std::make_shared<beat::ImmutableSampleSource>(*source);
            loopSource->loopEnabled = true;
            loopSource->loopStartRatio = 0.10f;
            loopSource->loopEndRatio = 0.80f;
            beat::SampleSourceSlot polyphonicSlot;
            if (!polyphonicSlot.prepare({ sourceRate, 256, 2 })
                || !polyphonicSlot.publish(loopSource))
                return false;
            for (int voice = 0; voice < beat::SampleSourceSlot::maximumVoices; ++voice)
                if (!polyphonicSlot.noteOn({ 48 + voice * 2, 0.35f, (uint64_t) (6000 + voice) }))
                    return false;

            if (!session->start())
                return false;
            const int64_t distantFrame = beat::BoundedSamplePageCache::pageFrames * 32 + 10;
            beat::BoundedSamplePageCache::StereoFrame streamed;
            beat::test::beginRealtimeSafetyProbe();
            const bool initiallyResident = session->readStereoFrame(metadata->index, distantFrame, streamed);
            const size_t requestViolations = beat::test::endRealtimeSafetyProbe();
            bool loaded = initiallyResident;
            for (int attempt = 0; !loaded && attempt < 200; ++attempt)
            {
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
                loaded = session->readStereoFrame(metadata->index, distantFrame, streamed);
            }

            bool polyphonicFinite = true;
            double polyphonicEnergy = 0.0;
            size_t polyphonicCallbackViolations = 0;
            const auto polyphonicStarted = std::chrono::steady_clock::now();
            for (int block = 0; block < 320; ++block)
            {
                beat::test::beginRealtimeSafetyProbe();
                for (int sampleIndex = 0; sampleIndex < 256; ++sampleIndex)
                {
                    const auto rendered = polyphonicSlot.renderFrame();
                    if (!std::isfinite(rendered.left) || !std::isfinite(rendered.right))
                    {
                        polyphonicFinite = false;
                        break;
                    }
                    polyphonicEnergy += (double) rendered.left * rendered.left
                        + (double) rendered.right * rendered.right;
                }
                polyphonicCallbackViolations += beat::test::endRealtimeSafetyProbe();
                if (!polyphonicFinite)
                    break;
                std::this_thread::yield();
            }
            const double polyphonicWallMs = std::chrono::duration<double, std::milli>(
                std::chrono::steady_clock::now() - polyphonicStarted).count();
            session->stop();
            const auto telemetry = session->telemetry(metadata->index);
            std::cerr << "streaming polyphony: wallMs=" << polyphonicWallMs
                      << " energy=" << polyphonicEnergy
                      << " hits=" << telemetry.cacheHits
                      << " misses=" << telemetry.cacheMisses
                      << " loaded=" << telemetry.pagesLoaded
                      << " rejected=" << telemetry.requestsRejected << "\n";
            passed = !initiallyResident && requestViolations == 0 && loaded
                && std::isfinite(streamed.left) && std::isfinite(streamed.right)
                && polyphonicFinite && polyphonicEnergy > 0.0001
                && polyphonicCallbackViolations == 0
                && telemetry.cacheHits > 0 && telemetry.underflows > 0
                && telemetry.requestsAccepted > 0
                && telemetry.pagesLoaded > beat::BoundedSamplePageCache::residentPageCount;
        }
        file.deleteFile();
        return passed;
    }

    bool stressAetherSampleSourceSlot()
    {
        if (beat::sourceSlotIndices.size() != 3
            || beat::sourceSlotIndices[0] != beat::SourceSlotIndex::one
            || beat::sourceSlotIndices[2] != beat::SourceSlotIndex::three)
        {
            return false;
        }

        auto source = std::make_shared<beat::ImmutableSampleSource>();
        source->sourceSampleRate = 48000.0;
        source->rootNote = 69;
        source->gain = 0.8f;
        source->pan = 0.0f;
        auto sourceAudio = std::make_shared<juce::AudioBuffer<float>>(1, 48000);
        source->audio = sourceAudio;
        for (int sample = 0; sample < sourceAudio->getNumSamples(); ++sample)
            sourceAudio->setSample(0, sample, std::sin(juce::MathConstants<double>::twoPi * 440.0 * sample / 48000.0));

        beat::SampleSourceSlot slot;
        if (slot.prepare({ 48000.0, 512, 2 }) == false
            || slot.publish(source) == false
            || slot.stateVersion() != 1
            || slot.lifecycleState() != beat::SourceLifecycleState::ready
            || slot.complexity() != beat::SourceComplexity::singleSample
            || slot.latencySamples() != 0)
        {
            return false;
        }

        beat::SampleSourceSlot secondSlot;
        beat::SampleSourceSlot thirdSlot;
        beat::SourceSlotRack rack;
        rack.attach(beat::SourceSlotIndex::one, &slot);
        rack.attach(beat::SourceSlotIndex::two, &secondSlot);
        rack.attach(beat::SourceSlotIndex::three, &thirdSlot);
        if (rack.slot(beat::SourceSlotIndex::one) != &slot
            || !secondSlot.publish(source)
            || !thirdSlot.publish(source)
            || !rack.prepare({ 48000.0, 512, 2 })
            || rack.latencySamples() != 0)
        {
            return false;
        }

        juce::AudioBuffer<float> output(2, 4800);
        output.clear();
        beat::test::beginRealtimeSafetyProbe();
        const bool accepted = slot.noteOn({ 69, 0.75f, 1001 });
        slot.render(output, 0, output.getNumSamples());
        slot.noteOff(1001);
        slot.render(output, 0, 512);
        const size_t violations = beat::test::endRealtimeSafetyProbe();
        if (!accepted || violations != 0 || slot.activeVoiceCount() != 0)
            return false;

        juce::AudioBuffer<float> rackOutput(2, 512);
        rackOutput.clear();
        if (!rack.noteOn(beat::SourceSlotIndex::one, { 69, 0.3f, 1101 })
            || !rack.noteOn(beat::SourceSlotIndex::two, { 69, 0.3f, 1102 })
            || !rack.noteOn(beat::SourceSlotIndex::three, { 69, 0.3f, 1103 }))
        {
            return false;
        }
        beat::test::beginRealtimeSafetyProbe();
        rack.render(rackOutput, 0, rackOutput.getNumSamples());
        const size_t rackViolations = beat::test::endRealtimeSafetyProbe();
        rack.allNotesOff(true);
        if (rackViolations != 0 || bufferEnergy(rackOutput) <= 0.01)
            return false;

        int crossings = 0;
        int firstCrossing = -1;
        int lastCrossing = -1;
        const float* left = output.getReadPointer(0);
        for (int sample = 1; sample < 4000; ++sample)
        {
            if (left[sample - 1] <= 0.0f && left[sample] > 0.0f)
            {
                if (firstCrossing < 0) firstCrossing = sample;
                lastCrossing = sample;
                ++crossings;
            }
        }
        const double measuredFrequency = crossings > 1
            ? (double) (crossings - 1) * 48000.0 / (double) (lastCrossing - firstCrossing)
            : 0.0;
        if (std::abs(measuredFrequency - 440.0) > 0.5
            || bufferEnergy(output) <= 0.01
            || slot.lifecycleState() != beat::SourceLifecycleState::ready)
        {
            return false;
        }

        slot.reset();
        if (!slot.prepare({ 44100.0, 256, 2 }))
            return false;
        juce::AudioBuffer<float> resampled(2, 4410);
        resampled.clear();
        if (!slot.noteOn({ 69, 1.0f, 2001 }))
            return false;
        slot.render(resampled, 0, resampled.getNumSamples());
        int resampledCrossings = 0;
        int firstResampled = -1;
        int lastResampled = -1;
        const float* resampledLeft = resampled.getReadPointer(0);
        for (int sample = 1; sample < resampled.getNumSamples(); ++sample)
        {
            if (resampledLeft[sample - 1] <= 0.0f && resampledLeft[sample] > 0.0f)
            {
                if (firstResampled < 0) firstResampled = sample;
                lastResampled = sample;
                ++resampledCrossings;
            }
        }
        const double resampledFrequency = resampledCrossings > 1
            ? (double) (resampledCrossings - 1) * 44100.0 / (double) (lastResampled - firstResampled)
            : 0.0;
        if (std::abs(resampledFrequency - 440.0) > 0.5)
            return false;

        auto slicedSource = std::make_shared<beat::ImmutableSampleSource>(*source);
        slicedSource->startRatio = 0.251f;
        slicedSource->endRatio = 0.301f;
        beat::SampleSourceSlot slicedSlot;
        if (!slicedSlot.prepare({ 48000.0, 512, 2 }) || !slicedSlot.publish(slicedSource)
            || !slicedSlot.noteOn({ 69, 1.0f, 2101 }))
            return false;
        const auto slicedFirst = slicedSlot.renderFrame();
        const int expectedStart = (int) std::round(0.251 * sourceAudio->getNumSamples());
        const float expectedFirst = sourceAudio->getSample(0, expectedStart)
            * slicedSource->gain * std::sqrt(0.5f);
        juce::AudioBuffer<float> slicedTail(2, 3000);
        slicedTail.clear();
        slicedSlot.render(slicedTail, 0, slicedTail.getNumSamples());
        if (std::abs(slicedFirst.left - expectedFirst) > 0.00001f
            || slicedSlot.activeVoiceCount() != 0)
            return false;

        auto loopedSource = std::make_shared<beat::ImmutableSampleSource>(*source);
        loopedSource->startRatio = 0.1f;
        loopedSource->endRatio = 0.9f;
        loopedSource->loopEnabled = true;
        loopedSource->loopStartRatio = 0.2f;
        loopedSource->loopEndRatio = 0.3f;
        beat::SampleSourceSlot loopedSlot;
        juce::AudioBuffer<float> loopedOutput(2, 20000);
        loopedOutput.clear();
        if (!loopedSlot.prepare({ 48000.0, 512, 2 }) || !loopedSlot.publish(loopedSource)
            || !loopedSlot.noteOn({ 69, 1.0f, 2201 }))
            return false;
        beat::test::beginRealtimeSafetyProbe();
        loopedSlot.render(loopedOutput, 0, loopedOutput.getNumSamples());
        const size_t loopViolations = beat::test::endRealtimeSafetyProbe();
        float maximumLoopStep = 0.0f;
        for (int sampleIndex = 1; sampleIndex < loopedOutput.getNumSamples(); ++sampleIndex)
            maximumLoopStep = std::max(maximumLoopStep,
                std::abs(loopedOutput.getSample(0, sampleIndex) - loopedOutput.getSample(0, sampleIndex - 1)));
        loopedSlot.noteOff(2201);
        loopedSlot.render(loopedOutput, 0, 512);
        if (loopViolations != 0 || loopedSlot.activeVoiceCount() != 0
            || bufferEnergy(loopedOutput) <= 0.01 || maximumLoopStep >= 0.15f)
            return false;

        auto invalidLoopSource = std::make_shared<beat::ImmutableSampleSource>(*source);
        invalidLoopSource->startRatio = 0.2f;
        invalidLoopSource->endRatio = 0.4f;
        invalidLoopSource->loopEnabled = true;
        invalidLoopSource->loopStartRatio = 0.35f;
        invalidLoopSource->loopEndRatio = 0.25f;
        beat::SampleSourceSlot invalidLoopSlot;
        juce::AudioBuffer<float> invalidLoopOutput(2, 12000);
        invalidLoopOutput.clear();
        if (!invalidLoopSlot.prepare({ 48000.0, 512, 2 }) || !invalidLoopSlot.publish(invalidLoopSource)
            || !invalidLoopSlot.noteOn({ 69, 1.0f, 2301 }))
            return false;
        invalidLoopSlot.render(invalidLoopOutput, 0, invalidLoopOutput.getNumSamples());
        if (invalidLoopSlot.activeVoiceCount() != 0)
            return false;

        const auto mappedFixture = [](float value, int loNote, int hiNote, int loVelocity, int hiVelocity)
        {
            auto mappedSource = std::make_shared<beat::ImmutableSampleSource>();
            auto audio = std::make_shared<juce::AudioBuffer<float>>(1, 4096);
            audio->clear();
            for (int sampleIndex = 0; sampleIndex < audio->getNumSamples(); ++sampleIndex)
                audio->setSample(0, sampleIndex, value);
            mappedSource->audio = audio;
            mappedSource->sourceSampleRate = 48000.0;
            mappedSource->rootNote = 60;
            mappedSource->loNote = loNote;
            mappedSource->hiNote = hiNote;
            mappedSource->loVelocity = loVelocity;
            mappedSource->hiVelocity = hiVelocity;
            return mappedSource;
        };
        auto mappedSource = std::make_shared<beat::ImmutableMappedSampleSource>();
        mappedSource->zones[0] = mappedFixture(0.5f, 0, 63, 0, 127);
        mappedSource->zones[1] = mappedFixture(0.25f, 64, 127, 0, 50);
        mappedSource->zones[2] = mappedFixture(-0.5f, 64, 127, 80, 127);
        mappedSource->zoneCount = 3;
        beat::MappedSampleSourceSlot mappedSlot;
        if (!mappedSlot.prepare({ 48000.0, 512, 2 }) || !mappedSlot.publish(mappedSource)
            || mappedSlot.complexity() != beat::SourceComplexity::mappedSample)
        {
            std::cerr << "  mapped setup failed\n";
            return false;
        }
        if (!mappedSlot.noteOn({ 40, 1.0f, 2401 })) { std::cerr << "  mapped low key rejected\n"; return false; }
        const auto lowKeyFrame = mappedSlot.renderFrame();
        mappedSlot.allNotesOff(true);
        if (!mappedSlot.noteOn({ 80, 0.25f, 2402 })) { std::cerr << "  mapped low velocity rejected\n"; return false; }
        const auto lowVelocityFrame = mappedSlot.renderFrame();
        mappedSlot.allNotesOff(true);
        if (!mappedSlot.noteOn({ 80, 0.9f, 2403 })) { std::cerr << "  mapped high velocity rejected\n"; return false; }
        beat::test::beginRealtimeSafetyProbe();
        const auto highVelocityFrame = mappedSlot.renderFrame();
        const size_t mappedViolations = beat::test::endRealtimeSafetyProbe();
        if (mappedSlot.noteOn({ 80, 0.6f, 2404 })) { std::cerr << "  mapped gap accepted\n"; return false; }
        if (lowKeyFrame.left <= 0.0f || lowVelocityFrame.left <= 0.0f
            || highVelocityFrame.left >= 0.0f || mappedViolations != 0)
        {
            std::cerr << "  mapped frames failed low=" << lowKeyFrame.left << " lowVel=" << lowVelocityFrame.left
                      << " highVel=" << highVelocityFrame.left << " violations=" << mappedViolations << "\n";
            return false;
        }
        const auto mappedTelemetry = mappedSlot.telemetry();
        if (mappedTelemetry.acceptedNoteEvents != 3 || mappedTelemetry.rejectedNoteEvents != 1)
        {
            std::cerr << "  mapped telemetry failed accepted=" << mappedTelemetry.acceptedNoteEvents
                      << " rejected=" << mappedTelemetry.rejectedNoteEvents << "\n";
            return false;
        }
        if (mappedSlot.publish(mappedSource)) { std::cerr << "  mapped active publish accepted\n"; return false; }
        mappedSlot.allNotesOff(true);

        auto overlapSource = std::make_shared<beat::ImmutableMappedSampleSource>();
        overlapSource->zones[0] = mappedFixture(0.5f, 0, 80, 0, 127);
        overlapSource->zones[1] = mappedFixture(0.25f, 40, 127, 0, 127);
        overlapSource->zoneCount = 2;
        beat::MappedSampleSourceSlot overlapSlot;
        if (!overlapSlot.prepare({ 48000.0, 512, 2 }) || !overlapSlot.publish(overlapSource))
            return false;
        const auto renderOverlapNote = [&](int note, float velocity, uint64_t stableId)
        {
            if (!overlapSlot.noteOn({ note, velocity, stableId }))
                return beat::SampleSourceSlot::StereoFrame {};
            const auto frame = overlapSlot.renderFrame();
            overlapSlot.allNotesOff(true);
            return frame;
        };
        const auto lowOverlap = renderOverlapNote(40, 1.0f, 2501);
        beat::test::beginRealtimeSafetyProbe();
        const auto middleOverlap = renderOverlapNote(60, 1.0f, 2502);
        const size_t overlapViolations = beat::test::endRealtimeSafetyProbe();
        const auto highOverlap = renderOverlapNote(80, 1.0f, 2503);
        const float expectedMiddle = (lowOverlap.left + highOverlap.left) * std::sqrt(0.5f);
        if (lowOverlap.left <= highOverlap.left
            || std::abs(middleOverlap.left - expectedMiddle) > 0.00001f
            || overlapViolations != 0)
        {
            std::cerr << "  mapped key crossfade failed low=" << lowOverlap.left
                      << " middle=" << middleOverlap.left << " expected=" << expectedMiddle
                      << " high=" << highOverlap.left << " violations=" << overlapViolations << "\n";
            return false;
        }

        auto velocityOverlapSource = std::make_shared<beat::ImmutableMappedSampleSource>();
        velocityOverlapSource->zones[0] = mappedFixture(0.5f, 0, 127, 0, 80);
        velocityOverlapSource->zones[1] = mappedFixture(0.25f, 0, 127, 40, 127);
        velocityOverlapSource->zoneCount = 2;
        beat::MappedSampleSourceSlot velocityOverlapSlot;
        if (!velocityOverlapSlot.prepare({ 48000.0, 512, 2 }) || !velocityOverlapSlot.publish(velocityOverlapSource))
            return false;
        const auto renderVelocityOverlap = [&](int velocity, uint64_t stableId)
        {
            const float normalizedVelocity = (float) velocity / 127.0f;
            if (!velocityOverlapSlot.noteOn({ 60, normalizedVelocity, stableId }))
                return 0.0f;
            const float normalizedFrame = velocityOverlapSlot.renderFrame().left / normalizedVelocity;
            velocityOverlapSlot.allNotesOff(true);
            return normalizedFrame;
        };
        const float lowVelocityOverlap = renderVelocityOverlap(40, 2601);
        const float middleVelocityOverlap = renderVelocityOverlap(60, 2602);
        const float highVelocityOverlap = renderVelocityOverlap(80, 2603);
        const float expectedVelocityMiddle = (lowVelocityOverlap + highVelocityOverlap) * std::sqrt(0.5f);
        if (std::abs(middleVelocityOverlap - expectedVelocityMiddle) > 0.00001f)
        {
            std::cerr << "  mapped velocity crossfade failed low=" << lowVelocityOverlap
                      << " middle=" << middleVelocityOverlap << " expected=" << expectedVelocityMiddle
                      << " high=" << highVelocityOverlap << "\n";
            return false;
        }

        auto threeWayOverlapSource = std::make_shared<beat::ImmutableMappedSampleSource>();
        threeWayOverlapSource->zones[0] = mappedFixture(-1.0f, 0, 127, 0, 127);
        threeWayOverlapSource->zones[1] = mappedFixture(0.5f, 20, 100, 0, 127);
        threeWayOverlapSource->zones[2] = mappedFixture(0.25f, 40, 85, 0, 127);
        threeWayOverlapSource->zoneCount = 3;
        beat::MappedSampleSourceSlot threeWayOverlapSlot;
        if (!threeWayOverlapSlot.prepare({ 48000.0, 512, 2 })
            || !threeWayOverlapSlot.publish(threeWayOverlapSource)
            || !threeWayOverlapSlot.noteOn({ 60, 1.0f, 2651 }))
            return false;
        const auto threeWayFrame = threeWayOverlapSlot.renderFrame();
        const float threeWayPosition = 20.0f / 45.0f;
        const float expectedThreeWay = std::sqrt(0.5f) * (
            0.25f * std::sin(threeWayPosition * juce::MathConstants<float>::halfPi)
            + 0.5f * std::cos(threeWayPosition * juce::MathConstants<float>::halfPi));
        if (threeWayOverlapSlot.activeVoiceCount() != 2
            || std::abs(threeWayFrame.left - expectedThreeWay) > 0.00001f)
        {
            std::cerr << "  mapped three-way bound failed frame=" << threeWayFrame.left
                      << " expected=" << expectedThreeWay
                      << " voices=" << threeWayOverlapSlot.activeVoiceCount() << "\n";
            return false;
        }
        threeWayOverlapSlot.allNotesOff(true);

        auto duplicateSource = std::make_shared<beat::ImmutableMappedSampleSource>();
        duplicateSource->zones[0] = mappedFixture(0.5f, 0, 127, 0, 127);
        duplicateSource->zones[1] = mappedFixture(-0.5f, 0, 127, 0, 127);
        duplicateSource->zoneCount = 2;
        beat::MappedSampleSourceSlot duplicateSlot;
        if (!duplicateSlot.prepare({ 48000.0, 512, 2 }) || !duplicateSlot.publish(duplicateSource)
            || !duplicateSlot.noteOn({ 60, 1.0f, 2701 }))
            return false;
        const auto duplicateFrame = duplicateSlot.renderFrame();
        if (duplicateFrame.left <= 0.0f || duplicateSlot.activeVoiceCount() != 1)
        {
            std::cerr << "  mapped duplicate tie-break failed frame=" << duplicateFrame.left
                      << " voices=" << duplicateSlot.activeVoiceCount() << "\n";
            return false;
        }
        duplicateSlot.allNotesOff(true);

        if (slot.publish(source))
            return false;
        slot.allNotesOff(true);
        slot.reset();
        for (int voice = 0; voice < beat::SampleSourceSlot::maximumVoices; ++voice)
            if (!slot.noteOn({ 60 + voice % 12, 1.0f, (uint64_t) (3000 + voice) }))
                return false;
        if (slot.noteOn({ 72, 1.0f, 4000 }))
            return false;
        const auto telemetry = slot.telemetry();
        return slot.activeVoiceCount() == beat::SampleSourceSlot::maximumVoices
            && telemetry.acceptedNoteEvents == beat::SampleSourceSlot::maximumVoices
            && telemetry.rejectedNoteEvents == 1
            && telemetry.renderedSamples == 0;
    }

    bool stressRealtimeSafetyDetectorNegativeCases()
    {
        using Kind = beat::test::RealtimeViolationKind;
        const auto detectsOnly = [](Kind expected, const std::function<void()>& operation) {
            beat::test::beginRealtimeSafetyProbe();
            operation();
            const size_t count = beat::test::endRealtimeSafetyProbe();
            if (count == 0)
                return false;
            for (size_t index = 0; index < count; ++index)
                if (beat::test::realtimeSafetyViolation(index).kind == expected)
                    return true;
            return false;
        };

        if (!detectsOnly(Kind::heapAllocation, [] {
                auto allocation = static_cast<void* (*)(size_t)>(&::operator new);
                void* value = allocation(32);
                ::operator delete(value);
            }))
        {
            std::cerr << "  detector missed heap allocation\n";
            return false;
        }

        pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
        std::atomic<bool> locked { false };
        std::thread holder([&] {
            pthread_mutex_lock(&mutex);
            locked.store(true, std::memory_order_release);
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
            pthread_mutex_unlock(&mutex);
        });
        while (!locked.load(std::memory_order_acquire))
            std::this_thread::yield();
        const bool lockDetected = detectsOnly(Kind::blockingLock, [&] {
            pthread_mutex_lock(&mutex);
            pthread_mutex_unlock(&mutex);
        });
        holder.join();
        pthread_mutex_destroy(&mutex);
        if (!lockDetected)
        {
            std::cerr << "  detector missed blocking lock\n";
            return false;
        }

        const auto temp = juce::File::getSpecialLocation(juce::File::tempDirectory)
                              .getNonexistentChildFile("beat-realtime-probe", ".tmp", false);
        temp.replaceWithText("probe");
        const auto path = temp.getFullPathName().toStdString();
        const bool fileDetected = detectsOnly(Kind::fileOperation, [&] {
            const int fd = open(path.c_str(), O_RDONLY);
            if (fd >= 0)
            {
                char byte {};
                (void) read(fd, &byte, 1);
                close(fd);
            }
        });
        temp.deleteFile();
        if (!fileDetected)
        {
            std::cerr << "  detector missed file operation\n";
            return false;
        }

        if (!detectsOnly(Kind::lazyInitialization, [] { BEAT_REPORT_REALTIME_LAZY_INITIALIZATION(); }))
        {
            std::cerr << "  detector missed lazy initialization\n";
            return false;
        }
        if (!detectsOnly(Kind::containerGrowth, [] { BEAT_REPORT_REALTIME_CONTAINER_GROWTH(); }))
        {
            std::cerr << "  detector missed container growth\n";
            return false;
        }

        beat::AudioEngine offline;
        offline.prepareForOffline(48000.0, 256, 2);
        offline.applyProject(makeDenseAetherProject());
        offline.requestPlay();
        (void) renderEngineBlock(offline, 256);
        beat::test::beginRealtimeSafetyProbe();
        const bool offlineExcluded = beat::test::endRealtimeSafetyProbe() == 0;
        if (!offlineExcluded)
            std::cerr << "  detector incorrectly included offline render\n";
        return offlineExcluded;
    }

    bool stressAudioEngineVariableBlockSizes()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 64, 2);
        auto project = makeTwoTrackOfflineProject();

        beat::TrackEffect delay;
        delay.id = "variable-block-delay";
        delay.kind = beat::TrackEffectKind::Delay;
        delay.params.push_back({ "timeMs", 32.0f });
        delay.params.push_back({ "feedback", 20.0f });
        delay.params.push_back({ "mix", 25.0f });
        project.tracks.front().effects.push_back(std::move(delay));

        engine.applyProject(std::move(project));
        engine.requestPlay();

        for (int samples : { 64, 127, 512, 1024, 4096, 8192, 257, 96 })
        {
            const auto buffer = renderEngineBlock(engine, samples);
            const double energy = bufferEnergy(buffer);
            if (!std::isfinite(energy))
                return false;
        }

        return true;
    }

    bool stressAudioEngineDenseAetherRoute()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 128, 2);
        engine.applyProject(makeDenseAetherProject());
        engine.requestPlay();

        double energy = 0.0;
        float peak = 0.0f;
        int maxSynthVoices = 0;
        int maxRoutes = 0;
        int maxAutomationEvents = 0;
        double maxSynthMs = 0.0;
        double maxRouteFxMs = 0.0;
        double maxTotalMs = 0.0;
        int64_t maxVoiceRenderSamples = 0;
        int64_t maxOscillatorSamples = 0;
        int64_t maxWavetableVoiceSamples = 0;
        int64_t maxFilterSamples = 0;
        int64_t maxFilterDriveSamples = 0;
        int64_t maxFilterCoefficientUpdates = 0;
        int64_t maxFilterCutoffUpdates = 0;
        int64_t maxFilterResonanceUpdates = 0;
        int64_t maxModulationSamples = 0;
        int64_t maxRealtimeRampSamples = 0;
        int64_t maxRouteEffectSamples = 0;
        int64_t maxRouteFilterEffectSamples = 0;
        int64_t maxRouteNonlinearEffectSamples = 0;
        bool filterCoefficientSplitMatched = true;

        for (int block = 0; block < 64; ++block)
        {
            if (block % 4 == 0)
            {
                const float position = 0.2f + (float) (block % 16) / 24.0f;
                if (!engine.queueRealtimeParameterChange("dense-aether", "osc.a.position", position, 0, 96))
                    return false;
                if (!engine.queueRealtimeParameterChange("dense-aether", "filter.cutoff", 0.35f + position * 0.45f, 12, 96))
                    return false;
            }

            const int blockSize = block % 5 == 0 ? 257 : (block % 3 == 0 ? 1024 : 512);
            const auto buffer = renderEngineBlock(engine, blockSize);
            const double blockEnergy = bufferEnergy(buffer);
            const float blockPeak = bufferPeak(buffer);
            if (!std::isfinite(blockEnergy) || !std::isfinite(blockPeak))
                return false;

            energy += blockEnergy;
            peak = juce::jmax(peak, blockPeak);

            beat::AudioEngine::RenderTimingSnapshot timing;
            if (!engine.pullRenderTimingSnapshot(timing))
                return false;
            if (!std::isfinite(timing.synthMs)
                || !std::isfinite(timing.voiceMs)
                || !std::isfinite(timing.modulationMs)
                || !std::isfinite(timing.fxMs)
                || !std::isfinite(timing.filterFxMs)
                || !std::isfinite(timing.totalMs))
                return false;

            maxSynthVoices = juce::jmax(maxSynthVoices, timing.activeSynthVoices);
            maxRoutes = juce::jmax(maxRoutes, timing.routeCount);
            maxAutomationEvents = juce::jmax(maxAutomationEvents, timing.automationEventCount);
            maxSynthMs = juce::jmax(maxSynthMs, timing.synthMs);
            maxRouteFxMs = juce::jmax(maxRouteFxMs, timing.filterFxMs);
            maxTotalMs = juce::jmax(maxTotalMs, timing.totalMs);
            maxVoiceRenderSamples = juce::jmax(maxVoiceRenderSamples, timing.voiceRenderSamples);
            maxOscillatorSamples = juce::jmax(maxOscillatorSamples, timing.oscillatorSamples);
            maxWavetableVoiceSamples = juce::jmax(maxWavetableVoiceSamples, timing.wavetableVoiceSamples);
            maxFilterSamples = juce::jmax(maxFilterSamples, timing.filterSamples);
            maxFilterDriveSamples = juce::jmax(maxFilterDriveSamples, timing.filterDriveSamples);
            maxFilterCoefficientUpdates = juce::jmax(maxFilterCoefficientUpdates, timing.filterCoefficientUpdates);
            maxFilterCutoffUpdates = juce::jmax(maxFilterCutoffUpdates, timing.filterCutoffUpdates);
            maxFilterResonanceUpdates = juce::jmax(maxFilterResonanceUpdates, timing.filterResonanceUpdates);
            filterCoefficientSplitMatched = filterCoefficientSplitMatched
                && timing.filterCoefficientUpdates == timing.filterCutoffUpdates + timing.filterResonanceUpdates;
            maxModulationSamples = juce::jmax(maxModulationSamples, timing.modulationSamples);
            maxRealtimeRampSamples = juce::jmax(maxRealtimeRampSamples, timing.realtimeRampSamples);
            maxRouteEffectSamples = juce::jmax(maxRouteEffectSamples, timing.routeEffectSamples);
            maxRouteFilterEffectSamples = juce::jmax(maxRouteFilterEffectSamples, timing.routeFilterEffectSamples);
            maxRouteNonlinearEffectSamples = juce::jmax(maxRouteNonlinearEffectSamples, timing.routeNonlinearEffectSamples);
        }

        const bool ok = energy > 0.01
            && peak > 0.001f
            && peak <= 1.0f
            && maxSynthVoices >= 8
            && maxRoutes >= 1
            && maxAutomationEvents > 0
            && maxSynthMs > 0.0
            && maxRouteFxMs > 0.0
            && maxTotalMs > 0.0
            && maxVoiceRenderSamples > 0
            && maxOscillatorSamples > 0
            && maxWavetableVoiceSamples > 0
            && maxFilterSamples > 0
            && maxFilterDriveSamples > 0
            && maxFilterCoefficientUpdates > 0
            && maxFilterCutoffUpdates > 0
            && maxFilterResonanceUpdates > 0
            && filterCoefficientSplitMatched
            && maxModulationSamples > 0
            && maxRealtimeRampSamples > 0
            && maxRouteEffectSamples > 0
            && maxRouteFilterEffectSamples > 0
            && maxRouteNonlinearEffectSamples > 0;
        if (!ok)
        {
            std::cerr << "Dense Aether route stress failed energy=" << energy
                      << " peak=" << peak
                      << " voices=" << maxSynthVoices
                      << " routes=" << maxRoutes
                      << " automation=" << maxAutomationEvents
                      << " synthMs=" << maxSynthMs
                      << " routeFxMs=" << maxRouteFxMs
                      << " totalMs=" << maxTotalMs
                      << " voiceSamples=" << maxVoiceRenderSamples
                      << " oscSamples=" << maxOscillatorSamples
                      << " wtSamples=" << maxWavetableVoiceSamples
                      << " filterSamples=" << maxFilterSamples
                      << " filterDriveSamples=" << maxFilterDriveSamples
                      << " filterCoeffUpdates=" << maxFilterCoefficientUpdates
                      << " filterCutoffUpdates=" << maxFilterCutoffUpdates
                      << " filterResonanceUpdates=" << maxFilterResonanceUpdates
                      << " filterCoeffSplitMatched=" << (filterCoefficientSplitMatched ? 1 : 0)
                      << " modSamples=" << maxModulationSamples
                      << " rampSamples=" << maxRealtimeRampSamples
                      << " routeFxSamples=" << maxRouteEffectSamples
                      << " routeFilterSamples=" << maxRouteFilterEffectSamples
                      << " routeNonlinearSamples=" << maxRouteNonlinearEffectSamples << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAetherRuntimeWarp()
    {
        auto baseProject = makeDenseAetherProject();
        auto warpedProject = baseProject;
        auto& baseInstrument = baseProject.instruments.front();
        auto& warpedInstrument = warpedProject.instruments.front();

        baseInstrument.aether.noise.enabled = false;
        baseInstrument.aether.noise.level = 0.0f;
        baseInstrument.aether.oscA.randomPhase = 0.0f;
        baseInstrument.aether.oscB.randomPhase = 0.0f;
        baseInstrument.aether.runtimeWarp = 0.0f;
        baseInstrument.aether.runtimeWarpMode = 0;

        warpedInstrument.aether.noise.enabled = false;
        warpedInstrument.aether.noise.level = 0.0f;
        warpedInstrument.aether.oscA.randomPhase = 0.0f;
        warpedInstrument.aether.oscB.randomPhase = 0.0f;
        warpedInstrument.aether.runtimeWarp = 0.82f;
        warpedInstrument.aether.runtimeWarpMode = 1;

        const auto base = renderOfflineBlock(baseProject, 18000);
        const auto warped = renderOfflineBlock(warpedProject, 18000);
        const double baseEnergy = bufferEnergy(base);
        const double warpedEnergy = bufferEnergy(warped);
        double diff = 0.0;
        float peak = 0.0f;
        const int channels = juce::jmin(base.getNumChannels(), warped.getNumChannels());
        const int samples = juce::jmin(base.getNumSamples(), warped.getNumSamples());
        for (int channel = 0; channel < channels; ++channel)
        {
            for (int i = 0; i < samples; ++i)
            {
                const auto warpedSample = warped.getSample(channel, i);
                diff += std::abs((double) base.getSample(channel, i) - (double) warpedSample);
                peak = juce::jmax(peak, std::abs(warpedSample));
            }
        }
        const double meanDiff = diff / (double) juce::jmax(1, channels * samples);
        const bool ok = std::isfinite(baseEnergy)
            && std::isfinite(warpedEnergy)
            && baseEnergy > 0.001
            && warpedEnergy > 0.001
            && meanDiff > 0.0004
            && peak > 0.001f
            && peak <= 1.0f;
        if (!ok)
        {
            std::cerr << "Aether runtime warp stress failed baseEnergy=" << baseEnergy
                      << " warpedEnergy=" << warpedEnergy
                      << " meanDiff=" << meanDiff
                      << " peak=" << peak << "\n";
        }
        return ok;
    }

    bool stressAudioEngineMaxUnisonAetherPolyphony()
    {
        beat::AudioEngine engine;
        constexpr int blockSize = 512;
        engine.prepareForOffline(44100.0, blockSize, 2);
        engine.applyProject(makeMaxUnisonAetherProject());
        engine.requestPlay();

        double energy = 0.0;
        float peak = 0.0f;
        int maxSynthVoices = 0;
        int maxAutomationEvents = 0;
        int64_t maxVoiceRenderSamples = 0;
        int64_t maxWavetableVoiceSamples = 0;
        int64_t maxFilterSamples = 0;
        int64_t maxModulationSamples = 0;
        double maxSynthMs = 0.0;
        double maxTotalMs = 0.0;

        for (int block = 0; block < 40; ++block)
        {
            if (block % 6 == 0)
            {
                if (!engine.queueRealtimeParameterChange("max-unison-aether",
                                                         "unison.detune",
                                                         10.0f + (float) (block % 12),
                                                         0,
                                                         128))
                    return false;
                if (!engine.queueRealtimeParameterChange("max-unison-aether",
                                                         "osc.b.position",
                                                         0.25f + (float) (block % 10) * 0.05f,
                                                         32,
                                                         160))
                    return false;
            }

            const auto buffer = renderEngineBlock(engine, blockSize);
            const double blockEnergy = bufferEnergy(buffer);
            const float blockPeak = bufferPeak(buffer);
            if (!std::isfinite(blockEnergy) || !std::isfinite(blockPeak))
                return false;

            energy += blockEnergy;
            peak = juce::jmax(peak, blockPeak);

            beat::AudioEngine::RenderTimingSnapshot timing;
            if (!engine.pullRenderTimingSnapshot(timing))
                return false;
            if (!std::isfinite(timing.synthMs)
                || !std::isfinite(timing.voiceMs)
                || !std::isfinite(timing.modulationMs)
                || !std::isfinite(timing.totalMs))
                return false;

            maxSynthVoices = juce::jmax(maxSynthVoices, timing.activeSynthVoices);
            maxAutomationEvents = juce::jmax(maxAutomationEvents, timing.automationEventCount);
            maxVoiceRenderSamples = juce::jmax(maxVoiceRenderSamples, timing.voiceRenderSamples);
            maxWavetableVoiceSamples = juce::jmax(maxWavetableVoiceSamples, timing.wavetableVoiceSamples);
            maxFilterSamples = juce::jmax(maxFilterSamples, timing.filterSamples);
            maxModulationSamples = juce::jmax(maxModulationSamples, timing.modulationSamples);
            maxSynthMs = juce::jmax(maxSynthMs, timing.synthMs);
            maxTotalMs = juce::jmax(maxTotalMs, timing.totalMs);
        }

        const int64_t expectedVoiceSamples = (int64_t) blockSize * 12;
        const int64_t expectedWavetableWork = expectedVoiceSamples * 8;
        const bool ok = energy > 0.01
            && peak > 0.001f
            && peak <= 1.0f
            && maxSynthVoices >= 12
            && maxAutomationEvents > 0
            && maxVoiceRenderSamples >= expectedVoiceSamples
            && maxWavetableVoiceSamples >= expectedWavetableWork
            && maxFilterSamples >= expectedVoiceSamples * 2
            && maxModulationSamples > 0
            && maxSynthMs > 0.0
            && maxTotalMs > 0.0;
        if (!ok)
        {
            std::cerr << "Max-unison Aether polyphony stress failed energy=" << energy
                      << " peak=" << peak
                      << " voices=" << maxSynthVoices
                      << " automation=" << maxAutomationEvents
                      << " voiceSamples=" << maxVoiceRenderSamples
                      << " wtSamples=" << maxWavetableVoiceSamples
                      << " filterSamples=" << maxFilterSamples
                      << " modSamples=" << maxModulationSamples
                      << " synthMs=" << maxSynthMs
                      << " totalMs=" << maxTotalMs << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAetherVoiceLimit()
    {
        auto project = makeMaxUnisonAetherProject();
        project.id = "limited-voice-aether-project";
        project.instruments.front().maxVoices = 4;

        beat::AudioEngine engine;
        constexpr int blockSize = 512;
        engine.prepareForOffline(44100.0, blockSize, 2);
        engine.applyProject(project);
        engine.requestPlay();

        double energy = 0.0;
        int maxSynthVoices = 0;
        int maxAutomationEvents = 0;

        for (int block = 0; block < 18; ++block)
        {
            const auto buffer = renderEngineBlock(engine, blockSize);
            energy += bufferEnergy(buffer);

            beat::AudioEngine::RenderTimingSnapshot timing;
            if (!engine.pullRenderTimingSnapshot(timing))
                return false;
            if (!std::isfinite(timing.synthMs) || !std::isfinite(timing.totalMs))
                return false;

            maxSynthVoices = juce::jmax(maxSynthVoices, timing.activeSynthVoices);
            maxAutomationEvents = juce::jmax(maxAutomationEvents, timing.automationEventCount);
        }

        const bool ok = energy > 0.01 && maxSynthVoices > 0 && maxSynthVoices <= 4 && maxAutomationEvents > 0;
        if (!ok)
        {
            std::cerr << "Aether voice-limit stress failed energy=" << energy
                      << " voices=" << maxSynthVoices
                      << " automation=" << maxAutomationEvents << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAetherMonoVoiceLimit()
    {
        auto project = makeMaxUnisonAetherProject();
        project.id = "mono-voice-aether-project";
        project.instruments.front().maxVoices = 12;
        project.instruments.front().mono = true;
        project.instruments.front().legato = true;

        beat::AudioEngine engine;
        constexpr int blockSize = 512;
        engine.prepareForOffline(44100.0, blockSize, 2);
        engine.applyProject(project);
        engine.requestPlay();

        double energy = 0.0;
        int maxSynthVoices = 0;

        for (int block = 0; block < 18; ++block)
        {
            const auto buffer = renderEngineBlock(engine, blockSize);
            energy += bufferEnergy(buffer);

            beat::AudioEngine::RenderTimingSnapshot timing;
            if (!engine.pullRenderTimingSnapshot(timing))
                return false;
            if (!std::isfinite(timing.synthMs) || !std::isfinite(timing.totalMs))
                return false;

            maxSynthVoices = juce::jmax(maxSynthVoices, timing.activeSynthVoices);
        }

        const bool ok = energy > 0.01 && maxSynthVoices > 0 && maxSynthVoices <= 1;
        if (!ok)
        {
            std::cerr << "Aether mono voice-limit stress failed energy=" << energy
                      << " voices=" << maxSynthVoices << "\n";
        }
        return ok;
    }

    bool stressAudioEngineDenseAetherLiveExportParity()
    {
        auto project = makeDenseAetherProject();
        project.eqAutomation.push_back({ 0.0, -1.5f, 1.0f, -0.5f, 1.5f });
        project.eqAutomation.push_back({ 4.0, 1.0f, -1.0f, 0.75f, -1.25f });

        auto staticProject = project;
        staticProject.automation.clear();
        staticProject.eqAutomation.clear();
        for (auto& instrument : staticProject.instruments)
        {
            for (auto& effect : instrument.effects)
                effect.automation.clear();
        }
        for (auto& track : staticProject.tracks)
        {
            for (auto& effect : track.effects)
                effect.automation.clear();
            for (auto& segment : track.segments)
            {
                segment.automation.clear();
                for (auto& note : segment.notes)
                    note.automation.clear();
            }
        }

        constexpr int samples = 12000;
        constexpr int blockSize = 257;
        auto live = renderOfflineChunks(project, samples, blockSize);
        auto staticRender = renderOfflineChunks(staticProject, samples, blockSize);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-dense-aether-parity.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, blockSize, 2, &error))
        {
            std::cerr << "Dense Aether parity export error: " << error << "\n";
            return false;
        }

        auto exported = readWavPrefix(exportFile, samples);
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
            return false;

        double sumAbsDiff = 0.0;
        double staticAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float staticSample = staticRender.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(staticSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                staticAbsDiff += std::abs(liveSample - staticSample);
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double sampleCount = (double) (live.getNumChannels() * samples);
        const double meanAbsDiff = sumAbsDiff / sampleCount;
        const double meanStaticDiff = staticAbsDiff / sampleCount;
        const bool ok = liveEnergy > 0.0001
            && meanStaticDiff > 0.00005
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
        if (!ok)
        {
            std::cerr << "Dense Aether live/export parity failed liveEnergy=" << liveEnergy
                      << " meanStaticDiff=" << meanStaticDiff
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAetherDeterministicNullExportFamily(beat::Project project,
                                                              const char* label,
                                                              const char* tempFileName,
                                                              int samples,
                                                              int blockSize,
                                                              double sampleRate)
    {
        auto liveA = renderOfflineChunks(project, samples, blockSize, sampleRate);
        auto liveB = renderOfflineChunks(project, samples, blockSize, sampleRate);
        const auto liveNull = bufferResidualStats(liveA, liveB, samples);

        auto exportFile = juce::File("/private/tmp").getChildFile(tempFileName);
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, sampleRate, blockSize, 2, &error, {}, 32))
        {
            std::cerr << label << " deterministic null export error: " << error << "\n";
            return false;
        }

        auto exported = readWavPrefix(exportFile, samples);
        exportFile.deleteFile();
        const auto exportNull = bufferResidualStats(liveA, exported, samples);
        const double exportResidualRatio = exportNull.sourceEnergy > 0.0
            ? exportNull.residualEnergy / exportNull.sourceEnergy
            : std::numeric_limits<double>::infinity();

        const bool ok = liveNull.ok
            && exportNull.ok
            && liveNull.sourceEnergy > 0.0001
            && liveNull.residualEnergy <= 0.000000000001
            && liveNull.maxAbsDiff <= 0.0000001f
            && exportNull.sourceEnergy > 0.0001
            && exportNull.maxAbsDiff <= 0.0000005f
            && exportNull.meanAbsDiff <= 0.00000008
            && exportResidualRatio <= 0.00000000001;

        if (!ok)
        {
            std::cerr << label << " deterministic null export failed"
                      << " liveOk=" << liveNull.ok
                      << " liveEnergy=" << liveNull.sourceEnergy
                      << " liveResidual=" << liveNull.residualEnergy
                      << " liveMaxDiff=" << liveNull.maxAbsDiff
                      << " exportOk=" << exportNull.ok
                      << " exportEnergy=" << exportNull.sourceEnergy
                      << " exportResidual=" << exportNull.residualEnergy
                      << " exportResidualRatio=" << exportResidualRatio
                      << " exportMaxDiff=" << exportNull.maxAbsDiff
                      << " exportMeanDiff=" << exportNull.meanAbsDiff
                      << "\n";
        }

        return ok;
    }

    bool stressAudioEngineAetherDeterministicNullExport()
    {
        auto project = makeDenseAetherProject();
        project.id = "deterministic-aether-null-export";
        project.name = "Deterministic Aether Null Export";
        project.lengthBeats = 1.25;

        auto& instrument = project.instruments.front();
        instrument.aether.noise.enabled = false;
        instrument.aether.noise.level = 0.0f;
        instrument.aether.oscA.randomPhase = 0.0f;
        instrument.aether.oscB.randomPhase = 0.0f;

        return stressAudioEngineAetherDeterministicNullExportFamily(
            project,
            "Aether",
            "BeatBackendStress-aether-null-export.wav",
            18000,
            257,
            44100.0);
    }

    bool stressAudioEngineMaxUnisonAetherDeterministicNullExport()
    {
        auto project = makeMaxUnisonAetherProject();
        project.id = "max-unison-aether-null-export";
        project.name = "Max Unison Aether Null Export";
        project.lengthBeats = 1.5;

        auto& instrument = project.instruments.front();
        instrument.aether.noise.enabled = false;
        instrument.aether.noise.level = 0.0f;
        instrument.aether.oscA.randomPhase = 0.0f;
        instrument.aether.oscB.randomPhase = 0.0f;

        return stressAudioEngineAetherDeterministicNullExportFamily(
            project,
            "Max-unison Aether",
            "BeatBackendStress-max-unison-aether-null-export.wav",
            16000,
            257,
            44100.0);
    }

    bool stressAudioEngineRuntimeWarpAetherDeterministicNullExport()
    {
        auto project = makeDenseAetherProject();
        project.id = "runtime-warp-aether-null-export";
        project.name = "Runtime Warp Aether Null Export";
        project.lengthBeats = 1.5;

        auto& instrument = project.instruments.front();
        instrument.aether.noise.enabled = false;
        instrument.aether.noise.level = 0.0f;
        instrument.aether.oscA.randomPhase = 0.0f;
        instrument.aether.oscB.randomPhase = 0.0f;
        instrument.aether.runtimeWarp = 0.78f;
        instrument.aether.runtimeWarpMode = 3;

        return stressAudioEngineAetherDeterministicNullExportFamily(
            project,
            "Runtime-warp Aether",
            "BeatBackendStress-runtime-warp-aether-null-export.wav",
            18000,
            257,
            44100.0);
    }

    bool stressAudioEngineMonoLegatoAetherDeterministicNullExport()
    {
        auto project = makeMonoLegatoAetherProject();
        project.id = "mono-legato-aether-null-export";
        project.name = "Mono Legato Aether Null Export";
        project.lengthBeats = 2.5;

        return stressAudioEngineAetherDeterministicNullExportFamily(
            project,
            "Mono-legato Aether",
            "BeatBackendStress-mono-legato-aether-null-export.wav",
            20000,
            193,
            48000.0);
    }

    bool stressAudioEngineRoutedAetherDeterministicNullExport()
    {
        auto project = makeDenseAetherProject();
        project.id = "routed-aether-null-export";
        project.name = "Routed Aether Null Export";
        project.lengthBeats = 1.75;

        auto& instrument = project.instruments.front();
        instrument.aether.noise.enabled = false;
        instrument.aether.noise.level = 0.0f;
        instrument.aether.oscA.randomPhase = 0.0f;
        instrument.aether.oscB.randomPhase = 0.0f;

        auto& track = project.tracks.front();
        track.parentTrackId = "aether-group";
        beat::TrackSend send;
        send.busId = "aether-return";
        send.gainDb = -8.0f;
        send.pan = 0.16f;
        send.enabled = true;
        track.sends.push_back(send);

        beat::Track group;
        group.id = "aether-group";
        group.name = "Aether Group";
        group.kind = beat::TrackKind::Group;
        group.gainDb = -2.5f;
        group.pan = -0.12f;
        beat::TrackEffect groupLowpass;
        groupLowpass.id = "aether-group-lowpass";
        groupLowpass.kind = beat::TrackEffectKind::Lowpass;
        groupLowpass.params.push_back({ "cutoffHz", 8800.0f });
        groupLowpass.params.push_back({ "resonance", 4.0f });
        group.effects.push_back(std::move(groupLowpass));
        project.tracks.push_back(std::move(group));

        beat::ReturnBus bus;
        bus.id = "aether-return";
        bus.name = "Aether Return";
        bus.gainDb = -7.0f;
        bus.pan = 0.24f;
        beat::TrackEffect returnSaturator;
        returnSaturator.id = "aether-return-saturator";
        returnSaturator.kind = beat::TrackEffectKind::Saturator;
        returnSaturator.params.push_back({ "drive", 8.0f });
        returnSaturator.params.push_back({ "mix", 24.0f });
        bus.effects.push_back(std::move(returnSaturator));
        project.returnBuses.push_back(std::move(bus));

        return stressAudioEngineAetherDeterministicNullExportFamily(
            project,
            "Routed Aether",
            "BeatBackendStress-routed-aether-null-export.wav",
            18000,
            211,
            44100.0);
    }

    bool stressAudioEngineFxHeavyAetherDeterministicNullExport()
    {
        auto project = makeDenseAetherProject();
        project.id = "fx-heavy-aether-null-export";
        project.name = "FX Heavy Aether Null Export";
        project.lengthBeats = 1.75;

        auto& instrument = project.instruments.front();
        instrument.aether.noise.enabled = false;
        instrument.aether.noise.level = 0.0f;
        instrument.aether.oscA.randomPhase = 0.0f;
        instrument.aether.oscB.randomPhase = 0.0f;

        beat::TrackEffect instrumentDistortion;
        instrumentDistortion.id = "fx-heavy-aether-instrument-distortion";
        instrumentDistortion.kind = beat::TrackEffectKind::Distortion;
        instrumentDistortion.params.push_back({ "drive", 13.0f });
        instrumentDistortion.params.push_back({ "tone", 58.0f });
        instrumentDistortion.params.push_back({ "mix", 42.0f });
        instrument.effects.push_back(std::move(instrumentDistortion));

        beat::TrackEffect instrumentChorus;
        instrumentChorus.id = "fx-heavy-aether-instrument-chorus";
        instrumentChorus.kind = beat::TrackEffectKind::Chorus;
        instrumentChorus.params.push_back({ "rateHz", 0.65f });
        instrumentChorus.params.push_back({ "depthMs", 7.0f });
        instrumentChorus.params.push_back({ "delayMs", 9.0f });
        instrumentChorus.params.push_back({ "feedback", 9.0f });
        instrumentChorus.params.push_back({ "mix", 26.0f });
        instrument.effects.push_back(std::move(instrumentChorus));

        auto& track = project.tracks.front();

        beat::TrackEffect trackCompressor;
        trackCompressor.id = "fx-heavy-aether-track-compressor";
        trackCompressor.kind = beat::TrackEffectKind::Compressor;
        trackCompressor.params.push_back({ "thresholdDb", -18.0f });
        trackCompressor.params.push_back({ "ratio", 3.0f });
        trackCompressor.params.push_back({ "attackMs", 8.0f });
        trackCompressor.params.push_back({ "releaseMs", 90.0f });
        trackCompressor.params.push_back({ "makeupDb", 1.5f });
        track.effects.push_back(std::move(trackCompressor));

        beat::TrackEffect trackPhaser;
        trackPhaser.id = "fx-heavy-aether-track-phaser";
        trackPhaser.kind = beat::TrackEffectKind::Phaser;
        trackPhaser.params.push_back({ "rateHz", 0.38f });
        trackPhaser.params.push_back({ "centerHz", 880.0f });
        trackPhaser.params.push_back({ "depthOct", 1.3f });
        trackPhaser.params.push_back({ "feedback", 18.0f });
        trackPhaser.params.push_back({ "mix", 24.0f });
        track.effects.push_back(std::move(trackPhaser));

        beat::TrackEffect trackDelay;
        trackDelay.id = "fx-heavy-aether-track-delay";
        trackDelay.kind = beat::TrackEffectKind::Delay;
        trackDelay.params.push_back({ "timeMs", 36.0f });
        trackDelay.params.push_back({ "feedback", 14.0f });
        trackDelay.params.push_back({ "mix", 18.0f });
        track.effects.push_back(std::move(trackDelay));

        return stressAudioEngineAetherDeterministicNullExportFamily(
            project,
            "FX-heavy Aether",
            "BeatBackendStress-fx-heavy-aether-null-export.wav",
            19000,
            229,
            44100.0);
    }

    bool stressWavetableOscillator()
    {
        static_assert(beat::params::patchSchemaVersion == 1);
        static_assert(beat::params::instrumentTypeWavetableSynth == std::string_view("wavetable-synth"));
        static_assert(beat::params::oscillator::a::position == std::string_view("osc.a.position"));
        static_assert(beat::params::modulation::sourceLfo1 == std::string_view("lfo.1"));
        static_assert(beat::params::modulation::targetUnisonSpread == std::string_view("unison.spread"));

        const std::array shapes {
            beat::BasicWavetableShape::Sine,
            beat::BasicWavetableShape::Saw,
            beat::BasicWavetableShape::Square,
            beat::BasicWavetableShape::Triangle,
            beat::BasicWavetableShape::Pulse
        };

        for (auto shape : shapes)
        {
            const auto table = beat::WavetableFactory::createBasic(shape, 8, 2048);
            if (!table.isValid() || table.getFrameCount() != 8 || table.getFrameSize() != 2048)
                return false;

            for (int frame = 0; frame < table.getFrameCount(); ++frame)
            {
                for (int i = 0; i < table.getFrameSize(); i += 17)
                {
                    const float sample = table.getSample(frame, i);
                    if (!std::isfinite(sample) || std::abs(sample) > 1.001f)
                        return false;
                }
            }

            beat::WavetableOscillator oscillator;
            oscillator.prepare(44100.0);
            oscillator.setWavetable(&table);
            oscillator.setFrequency(440.0);

            for (int positionStep = -4; positionStep <= 12; ++positionStep)
            {
                oscillator.setPosition((float) positionStep / 8.0f);

                for (int i = 0; i < 256; ++i)
                {
                    const float sample = oscillator.renderSample();
                    if (!std::isfinite(sample) || std::abs(sample) > 1.001f)
                        return false;
                }
            }
        }

        {
            const auto shape = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Saw, 0.8f, beat::WavetableWarpMode::Shape, 8, 2048);
            const auto fold = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Saw, 0.8f, beat::WavetableWarpMode::Fold, 8, 2048);
            const auto pinch = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Saw, 0.8f, beat::WavetableWarpMode::Pinch, 8, 2048);
            const auto mirror = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Saw, 0.8f, beat::WavetableWarpMode::Mirror, 8, 2048);
            double foldDiff = 0.0;
            double pinchDiff = 0.0;
            double mirrorDiff = 0.0;
            for (int i = 0; i < 2048; i += 8)
            {
                foldDiff += std::abs(shape.getSample(7, i) - fold.getSample(7, i));
                pinchDiff += std::abs(shape.getSample(7, i) - pinch.getSample(7, i));
                mirrorDiff += std::abs(shape.getSample(7, i) - mirror.getSample(7, i));
            }
            if (foldDiff <= 0.01 || pinchDiff <= 0.01 || mirrorDiff <= 0.01)
                return false;
        }

        const auto sine = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Sine, 8, 2048);
        beat::WavetableOscillator oscillator;
        oscillator.prepare(44100.0);
        oscillator.setWavetable(&sine);
        oscillator.setFrequency(440.0);
        oscillator.reset(0.0);

        int positiveCrossings = 0;
        float previous = oscillator.renderSample();
        for (int i = 1; i < 44100; ++i)
        {
            const float next = oscillator.renderSample();
            if (previous <= 0.0f && next > 0.0f)
                ++positiveCrossings;

            previous = next;
        }

        if (positiveCrossings < 438 || positiveCrossings > 442)
            return false;

        oscillator.setFrequency(100000000.0);
        oscillator.setPhase(12345.6789);
        for (int i = 0; i < 4096; ++i)
        {
            const float sample = oscillator.renderSample();
            if (!std::isfinite(sample) || !std::isfinite(oscillator.getPhase()))
                return false;

            if (oscillator.getPhase() < 0.0 || oscillator.getPhase() >= 1.0)
                return false;
        }

        {
            constexpr int size = 32;
            auto constantLevel = [](int harmonic, float value)
            {
                return beat::Wavetable::MipLevel { harmonic, std::vector<float>((size_t) size, value) };
            };
            std::vector<beat::Wavetable::TimbralFrame> frames(2);
            frames[0].mipLevels = { constantLevel(8, 0.0f), constantLevel(1, 0.0f) };
            frames[1].mipLevels = { constantLevel(8, 1.0f), constantLevel(1, 1.0f) };

            beat::Wavetable testTable({ "test.axes", "Independent axes", "stress" }, std::move(frames));
            beat::WavetableOscillator lowOsc;
            lowOsc.prepare(44100.0);
            lowOsc.setWavetable(&testTable);
            lowOsc.setPosition(1.0f);
            lowOsc.setFrequency(100.0);

            beat::WavetableOscillator highOsc;
            highOsc.prepare(44100.0);
            highOsc.setWavetable(&testTable);
            highOsc.setPosition(1.0f);
            highOsc.setFrequency(44100.0 * 0.49);

            if (lowOsc.renderSample() < 0.95f || highOsc.renderSample() < 0.95f)
                return false;
        }

        {
            constexpr int size = 32;
            beat::Wavetable::TimbralFrame frame;
            frame.mipLevels = {
                { 8, std::vector<float>((size_t) size, 0.8f) },
                { 1, std::vector<float>((size_t) size, 0.2f) }
            };
            beat::Wavetable mipTable({ "test.mips", "Mip selection", "stress" }, { std::move(frame) });
            beat::WavetableOscillator oscillator;
            oscillator.prepare(44100.0);
            oscillator.setWavetable(&mipTable);
            oscillator.setFrequency(100.0);
            const float low = oscillator.renderSample();
            oscillator.reset();
            oscillator.setFrequency(44100.0 * 0.49);
            const float high = oscillator.renderSample();
            if (low < 0.75f || high > 0.25f)
                return false;

            oscillator.reset();
            oscillator.setFrequency(44100.0 * 0.48 / 8.0 * 0.999);
            const float belowBoundary = oscillator.renderSample();
            oscillator.reset();
            oscillator.setFrequency(44100.0 * 0.48 / 8.0 * 1.001);
            const float aboveBoundary = oscillator.renderSample();
            if (std::abs(belowBoundary - aboveBoundary) > 0.01f)
            {
                std::cerr << "mip continuity failed " << belowBoundary << " " << aboveBoundary << "\n";
                return false;
            }
        }

        {
            constexpr int size = 32;
            std::vector<beat::Wavetable::TimbralFrame> frames(2);
            frames[0].mipLevels = { { 8, std::vector<float>((size_t) size, 0.0f) }, { 1, std::vector<float>((size_t) size, 0.0f) } };
            frames[1].mipLevels = { { 8, std::vector<float>((size_t) size, 1.0f) }, { 1, std::vector<float>((size_t) size, 1.0f) } };
            beat::Wavetable table({ "test.frame-continuity", "Frame continuity", "stress" }, std::move(frames));
            beat::WavetableOscillator oscillator;
            oscillator.prepare(44100.0);
            oscillator.setWavetable(&table);
            oscillator.setFrequency(440.0);
            oscillator.setPosition(0.499f);
            const float before = oscillator.renderSample();
            oscillator.reset();
            oscillator.setPosition(0.501f);
            const float after = oscillator.renderSample();
            if (std::abs(before - after) > 0.01f)
            {
                std::cerr << "frame continuity failed " << before << " " << after << "\n";
                return false;
            }
        }

        {
            using Error = beat::Wavetable::ValidationError;
            beat::Wavetable noFrames({ "bad.empty", "Empty", "stress" }, std::vector<beat::Wavetable::TimbralFrame> {});
            if (noFrames.isValid() || noFrames.getValidationError() != Error::noFrames || noFrames.getValidationErrorMessage().isEmpty())
            {
                std::cerr << "empty validation failed\n";
                return false;
            }

            beat::Wavetable::TimbralFrame mismatched;
            mismatched.mipLevels = {
                { 8, std::vector<float>(32, 0.0f) },
                { 4, std::vector<float>(16, 0.0f) }
            };
            beat::Wavetable badSize({ "bad.size", "Bad size", "stress" }, { std::move(mismatched) });
            if (badSize.isValid() || badSize.getValidationError() != Error::inconsistentFrameSize)
            {
                std::cerr << "size validation failed " << (int) badSize.getValidationError() << "\n";
                return false;
            }

            beat::Wavetable::TimbralFrame unordered;
            unordered.mipLevels = {
                { 4, std::vector<float>(32, 0.0f) },
                { 8, std::vector<float>(32, 0.0f) }
            };
            beat::Wavetable badOrder({ "bad.order", "Bad order", "stress" }, { std::move(unordered) });
            if (badOrder.isValid() || badOrder.getValidationError() != Error::unorderedHarmonicLimits)
            {
                std::cerr << "order validation failed " << (int) badOrder.getValidationError() << "\n";
                return false;
            }
        }

        {
            const auto first = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Saw, 8, 2048);
            const auto second = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Saw, 8, 2048);
            if (first.getMipLevelCount() < 2 || first.getMipLevelCount() != second.getMipLevelCount())
            {
                std::cerr << "mip count failed\n";
                return false;
            }
            for (int frame = 0; frame < first.getFrameCount(); ++frame)
            {
                for (int mip = 0; mip < first.getMipLevelCount(); ++mip)
                {
                    const auto* a = first.getMipLevel(frame, mip);
                    const auto* b = second.getMipLevel(frame, mip);
                    if (a == nullptr || b == nullptr || a->maxHarmonic != b->maxHarmonic || a->samples != b->samples)
                    {
                        std::cerr << "mip determinism failed " << frame << " " << mip << "\n";
                        return false;
                    }
                    double mean = 0.0;
                    for (const float sample : a->samples)
                        mean += sample;
                    if (std::abs(mean / (double) a->samples.size()) > 1.0e-6)
                    {
                        std::cerr << "mip dc failed " << frame << " " << mip << " " << mean / (double) a->samples.size() << "\n";
                        return false;
                    }
                }
            }
        }

        {
            const auto table = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Saw, 8, 2048);
            beat::WavetableOscillator standard;
            beat::WavetableOscillator highQuality;
            standard.prepare(48000.0);
            highQuality.prepare(48000.0);
            standard.setWavetable(&table);
            highQuality.setWavetable(&table);
            standard.setFrequency(997.0);
            highQuality.setFrequency(997.0);
            standard.setPosition(0.73f);
            highQuality.setPosition(0.73f);
            standard.setPhase(0.12345);
            highQuality.setPhase(0.12345);
            highQuality.setQuality(beat::AudioQuality::offlineHighQuality);
            double difference = 0.0;
            for (int i = 0; i < 4096; ++i)
            {
                const float live = standard.renderSample();
                const float hq = highQuality.renderSample();
                if (!std::isfinite(live) || !std::isfinite(hq) || std::abs(hq) > 1.001f)
                    return false;
                difference += std::abs((double) live - (double) hq);
                if (standard.getPhase() != highQuality.getPhase())
                    return false;
            }
            if (difference <= 0.0001)
                return false;
        }

        {
            const auto sine = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Sine, 8, 2048);
            const auto square = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Square, 8, 2048);
            const auto saw = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Saw, 8, 2048);
            beat::WavetableOscillator transitioning;
            beat::WavetableOscillator reference;
            for (auto* oscillator : { &transitioning, &reference })
            {
                oscillator->prepare(48000.0);
                oscillator->setWavetable(&sine);
                oscillator->setFrequency(997.0);
                oscillator->setPosition(0.8f);
                oscillator->setPhase(0.31);
            }
            for (int i = 0; i < 257; ++i)
            {
                transitioning.renderSample();
                reference.renderSample();
            }
            transitioning.setWavetable(&square);
            if (!transitioning.isTableTransitionActive())
                return false;
            const float firstTransition = transitioning.renderSample();
            const float continuedPrevious = reference.renderSample();
            if (std::abs(firstTransition - continuedPrevious) > 1.0e-6f)
            {
                std::cerr << "table replacement first sample " << firstTransition << " expected " << continuedPrevious << "\n";
                return false;
            }

            float previous = firstTransition;
            float maxStep = 0.0f;
            for (int i = 0; i < 120; ++i)
            {
                const float sample = transitioning.renderSample();
                maxStep = std::max(maxStep, std::abs(sample - previous));
                previous = sample;
            }
            transitioning.setWavetable(&saw);
            if (!transitioning.isTableTransitionActive())
                return false;
            for (int i = 0; i < 512; ++i)
            {
                const float sample = transitioning.renderSample();
                if (!std::isfinite(sample))
                    return false;
                maxStep = std::max(maxStep, std::abs(sample - previous));
                previous = sample;
            }
            if (transitioning.isTableTransitionActive() || !std::isfinite(maxStep))
            {
                std::cerr << "table replacement completion active=" << transitioning.isTableTransitionActive() << " maxStep=" << maxStep << "\n";
                return false;
            }
        }

        {
            const std::array<beat::WavetableFactory::CustomFrame, 4> frames {{
                { 0.12f, 0.04f, 0.0f, 0.06f, 0.04f, -0.24f, -0.55f, 0.18f, 0.0f },
                { 0.38f, 0.18f, 0.2f, 0.22f, 0.12f, -0.08f, -0.15f, 0.36f, 0.25f },
                { 0.66f, 0.55f, 0.42f, 0.48f, 0.28f, 0.18f, 0.3f, 0.58f, -0.16f },
                { 0.95f, 0.86f, 0.68f, 0.62f, 0.42f, 0.32f, 0.62f, 0.74f, 0.36f },
            }};
            const auto custom = beat::WavetableFactory::createCustom(frames, 8, 2048);
            const auto smoothCustom = beat::WavetableFactory::createCustom(frames, true, 8, 2048);
            const auto morphedCustom = beat::WavetableFactory::createCustom(frames, 0.0f, beat::WavetableWarpMode::Shape, false, 0.95f, 8, 2048);
            if (!custom.isValid() || custom.getFrameCount() != 8 || custom.getFrameSize() != 2048)
                return false;
            if (!smoothCustom.isValid() || smoothCustom.getFrameCount() != custom.getFrameCount() || smoothCustom.getFrameSize() != custom.getFrameSize())
                return false;
            if (!morphedCustom.isValid() || morphedCustom.getFrameCount() != custom.getFrameCount() || morphedCustom.getFrameSize() != custom.getFrameSize())
                return false;

            double interpolationDiff = 0.0;
            constexpr int probeFrame = 3;
            for (int i = 0; i < custom.getFrameSize(); ++i)
            {
                const float linear = custom.getSample(probeFrame, i);
                const float smooth = smoothCustom.getSample(probeFrame, i);
                if (!std::isfinite(linear) || !std::isfinite(smooth))
                    return false;
                interpolationDiff += std::abs((double) linear - (double) smooth);
            }
            if (interpolationDiff / (double) custom.getFrameSize() < 0.0004)
                return false;

            double morphDiff = 0.0;
            for (int i = 0; i < custom.getFrameSize(); ++i)
            {
                const float linear = custom.getSample(probeFrame, i);
                const float morphed = morphedCustom.getSample(probeFrame, i);
                if (!std::isfinite(linear) || !std::isfinite(morphed))
                    return false;
                morphDiff += std::abs((double) linear - (double) morphed);
            }
            if (morphDiff / (double) custom.getFrameSize() < 0.0002)
                return false;

            auto flatTiltFrames = frames;
            for (auto& frame : flatTiltFrames)
                frame.tilt = 0.0f;
            const auto untiltedCustom = beat::WavetableFactory::createCustom(flatTiltFrames, 8, 2048);
            double tiltDiff = 0.0;
            for (int i = 0; i < custom.getFrameSize(); ++i)
                tiltDiff += std::abs((double) custom.getSample(probeFrame, i) - (double) untiltedCustom.getSample(probeFrame, i));
            if (tiltDiff / (double) custom.getFrameSize() < 0.0004)
                return false;

            auto flatFocusFrames = frames;
            for (auto& frame : flatFocusFrames)
                frame.focus = 0.0f;
            const auto unfocusedCustom = beat::WavetableFactory::createCustom(flatFocusFrames, 8, 2048);
            double focusDiff = 0.0;
            for (int i = 0; i < custom.getFrameSize(); ++i)
                focusDiff += std::abs((double) custom.getSample(probeFrame, i) - (double) unfocusedCustom.getSample(probeFrame, i));
            if (focusDiff / (double) custom.getFrameSize() < 0.0004)
                return false;

            beat::WavetableOscillator customOsc;
            customOsc.prepare(48000.0);
            customOsc.setWavetable(&custom);
            customOsc.setFrequency(110.0);
            customOsc.setPosition(0.8f);

            double energy = 0.0;
            float peak = 0.0f;
            for (int i = 0; i < 4096; ++i)
            {
                const float sample = customOsc.renderSample();
                if (!std::isfinite(sample))
                    return false;
                energy += (double) sample * (double) sample;
                peak = std::max(peak, std::abs(sample));
            }

            if (!(energy > 0.001 && peak > 0.01f && peak <= 1.001f))
                return false;
        }

        return true;
    }

    bool stressOscillatorSampleRatePreparation()
    {
        const auto sine = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Sine, 8, 2048);
        constexpr double frequency = 440.0;
        constexpr double phase = 0.371;
        const std::array sampleRates { 44100.0, 48000.0, 88200.0, 96000.0, 192000.0 };

        for (double sampleRate : sampleRates)
        {
            beat::WavetableOscillator beforePrepare;
            beforePrepare.setFrequency(frequency);
            beforePrepare.setPhase(phase);
            beforePrepare.prepare(sampleRate);
            beforePrepare.setWavetable(&sine);
            if (std::abs(beforePrepare.getPhaseIncrement() - frequency / sampleRate) > 1.0e-12
                || std::abs(beforePrepare.getPhase() - phase) > 1.0e-12)
                return false;

            const double firstIncrement = beforePrepare.getPhaseIncrement();
            beforePrepare.prepare(sampleRate);
            if (beforePrepare.getPhaseIncrement() != firstIncrement
                || std::abs(beforePrepare.getPhase() - phase) > 1.0e-12)
                return false;

            beat::WavetableOscillator afterPrepare;
            afterPrepare.prepare(sampleRate);
            afterPrepare.setFrequency(frequency);
            afterPrepare.setPhase(phase);
            afterPrepare.setWavetable(&sine);
            if (std::abs(afterPrepare.getPhaseIncrement() - beforePrepare.getPhaseIncrement()) > 1.0e-12)
                return false;

            for (int i = 0; i < 4096; ++i)
            {
                const float a = beforePrepare.renderSample();
                const float b = afterPrepare.renderSample();
                if (a != b) return false;
            }

            double basicPhase = 0.0;
            int crossings = 0;
            float previous = beat::BasicOscillator::sample(0, basicPhase, frequency / sampleRate);
            for (int i = 1; i < (int) sampleRate; ++i)
            {
                basicPhase += frequency / sampleRate;
                basicPhase -= std::floor(basicPhase);
                const float next = beat::BasicOscillator::sample(0, basicPhase, frequency / sampleRate);
                if (previous <= 0.0f && next > 0.0f) ++crossings;
                previous = next;
            }
            if (crossings < 439 || crossings > 441) return false;
        }

        beat::WavetableOscillator changedRate;
        changedRate.setWavetable(&sine);
        changedRate.setFrequency(frequency);
        changedRate.setPhase(phase);
        changedRate.prepare(44100.0);
        const double oldIncrement = changedRate.getPhaseIncrement();
        changedRate.prepare(96000.0);
        return std::abs(oldIncrement - frequency / 44100.0) <= 1.0e-12
            && std::abs(changedRate.getPhaseIncrement() - frequency / 96000.0) <= 1.0e-12
            && std::abs(changedRate.getPhase() - phase) <= 1.0e-12;
    }

    bool stressSynthPatchContract()
    {
        beat::InstrumentDefinition untouched;
        untouched.kind = "synth";
        untouched.waveform = 1;
        if (beat::applySynthPatchContract({}, untouched))
            return false;
        if (untouched.kind != "synth" || untouched.waveform != 1)
            return false;

        const auto patch = juce::JSON::parse(R"json(
        {
          "schemaVersion": 1,
          "instrumentType": "wavetable-synth",
          "parameters": {
            "macro.1": 0.5,
            "macro.2": 0.8,
            "osc.a.enabled": true,
            "osc.a.wavetable": "basic.pulse",
            "osc.a.position": 0.25,
            "osc.a.warp": 0.58,
            "osc.a.warpMode": "fold",
            "osc.a.octave": -1,
            "osc.a.semitone": 12,
            "osc.a.fine": 7,
            "osc.a.tuning.mode": "harmonic",
            "osc.a.tuning.harmonic": 5,
            "osc.a.phaseMode": "memory",
            "osc.a.route": "direct",
            "osc.a.level": 0.7,
            "osc.a.pan": -0.4,
            "osc.a.phase": 0.33,
            "osc.a.randomPhase": 0.2,
            "osc.a.unison.voices": 3,
            "osc.a.unison.detune": 0.11,
            "osc.a.unison.spread": 0.27,
            "osc.b.enabled": true,
            "osc.b.wavetable": "basic.triangle",
            "osc.b.position": 0.1,
            "osc.b.warp": 0.36,
            "osc.b.warpMode": "pinch",
            "osc.b.octave": 1,
            "osc.b.semitone": 7,
            "osc.b.fine": -5,
            "osc.b.tuning.mode": "ratio",
            "osc.b.tuning.numerator": 3,
            "osc.b.tuning.denominator": 2,
            "osc.b.level": 0.3,
            "osc.b.pan": 0.2,
            "osc.b.phase": 0.66,
            "osc.b.randomPhase": 0.1,
            "osc.b.route": "filter1",
            "aether.sub.route": "filter2",
            "aether.noise.route": "direct",
            "aether.runtimeWarp": 0.24,
            "aether.runtimeWarpMode": "fold",
            "aether.runtimeWarp2": 0.41,
            "aether.runtimeWarp2Mode": "pinch",
            "aether.interaction.mode": "ring",
            "aether.interaction.amount": 0.72,
            "aether.mpe.enabled": true,
            "aether.mpe.masterChannel": 1,
            "aether.mpe.firstMemberChannel": 2,
            "aether.mpe.lastMemberChannel": 8,
            "osc.b.unison.voices": 7,
            "osc.b.unison.detune": 0.31,
            "osc.b.unison.spread": 0.83,
            "unison.enabled": true,
            "unison.voices": 5,
            "unison.detune": 0.2,
            "unison.blend": 0.6,
            "unison.spread": 0.4,
            "maxVoices": 6,
            "mono.enabled": true,
            "legato.enabled": true,
            "filter.enabled": true,
            "filter.type": "highpass",
            "filter.cutoff": 1000,
            "filter.keytrack": 0.62,
            "filter.resonance": 0.2,
            "filter.drive": 0.35,
            "filter.2.enabled": true,
            "filter.2.type": "bandpass",
            "filter.2.cutoff": 2400,
            "filter.2.resonance": 0.48,
            "filter.2.drive": 0.22,
            "filter.routing": "parallel",
            "env.1.attack": 0.01,
            "env.1.attackCurve": "exp",
            "env.1.decay": 0.2,
            "env.1.decayCurve": "s-curve",
            "env.1.sustain": 0.55,
            "env.1.release": 0.4,
            "env.1.releaseCurve": "log",
            "env.1.loop": true,
            "env.2.attack": 0.01,
            "env.2.attackCurve": "exp",
            "env.2.decay": 0.09,
            "env.2.decayCurve": "s-curve",
            "env.2.sustain": 0.0,
            "env.2.release": 0.16,
            "env.2.releaseCurve": "log",
            "env.2.loop": true,
            "env.3.attack": 0.02,
            "env.3.decay": 0.12,
            "env.3.sustain": 0.3,
            "env.3.release": 0.18,
            "env.3.loop": true,
            "env.4.attack": 0.03,
            "env.4.decay": 0.14,
            "env.4.sustain": 0.4,
            "env.4.release": 0.22,
            "amp.level": 0.7,
            "amp.pan": -0.25,
            "lfo.1.enabled": true,
            "lfo.1.shape": "square",
            "lfo.1.rate": 6.5,
            "lfo.1.sync": true,
            "lfo.1.syncedRate": "1/8",
            "lfo.1.smoothing": 0.35,
            "lfo.1.randomPhase": 0.42,
            "lfo.1.phase": 0.25,
            "lfo.1.retrigger": false,
            "lfo.1.oneShot": true,
            "lfo.2.enabled": true,
            "lfo.2.shape": "triangle",
            "lfo.2.rate": 0.75,
            "lfo.2.sync": true,
            "lfo.2.syncedRate": "1/2",
            "lfo.2.smoothing": 0.6,
            "lfo.2.randomPhase": 0.25,
            "lfo.2.phase": 0.5,
            "lfo.2.retrigger": true,
            "lfo.2.oneShot": false
            ,"lfo.10.enabled": true
            ,"lfo.10.shape": "square"
            ,"lfo.10.rate": 3.25
            ,"lfo.10.sync": true
            ,"lfo.10.syncedRate": "1/8t"
            ,"lfo.10.smoothing": 0.2
            ,"lfo.10.phase": 0.3
          },
          "modulation": [
            { "source": "macro.1", "target": "osc.a.position", "amount": 0.4, "enabled": true },
            { "source": "macro.1", "target": "osc.b.position", "amount": -0.3, "enabled": true },
            { "source": "macro.2", "target": "osc.b.level", "amount": 0.5, "enabled": true },
            { "source": "env.3", "target": "filter.drive", "amount": 0.33, "enabled": true },
            { "source": "env.4", "target": "amp.pan", "amount": -0.27, "enabled": true },
            { "source": "lfo.10", "target": "filter.resonance", "amount": 0.29, "enabled": true },
            { "source": "macro.2", "target": "osc.b.fine", "amount": 0.25, "enabled": true },
            { "source": "macro.1", "target": "osc.a.pan", "amount": 0.2, "enabled": true },
            { "source": "macro.2", "target": "osc.b.pan", "amount": -0.25, "enabled": true },
            { "source": "macro.1", "target": "unison.detune", "amount": 0.1, "enabled": true },
            { "source": "macro.1", "target": "unison.spread", "amount": 0.2, "enabled": true },
            { "source": "macro.2", "target": "osc.a.unison.detune", "amount": 0.12, "enabled": true },
            { "source": "macro.1", "target": "osc.b.unison.spread", "amount": -0.15, "enabled": true },
            { "source": "macro.1", "target": "filter.cutoff", "amount": 0.1, "enabled": true },
            { "source": "macro.2", "target": "filter.resonance", "amount": 0.25, "enabled": true },
            { "source": "macro.2", "target": "amp.level", "amount": -0.2, "enabled": true },
            { "source": "macro.1", "target": "amp.pan", "amount": 0.5, "enabled": true },
            { "source": "lfo.1", "target": "osc.a.position", "amount": -0.35, "bipolar": false, "enabled": true },
            { "source": "lfo.1", "target": "osc.a.fine", "amount": 0.5, "bipolar": true, "enabled": true },
            { "source": "lfo.1", "target": "osc.a.pan", "amount": 0.4, "bipolar": false, "enabled": true },
            { "source": "lfo.1", "target": "osc.b.position", "amount": 0.25, "bipolar": false, "enabled": true },
            { "source": "lfo.1", "target": "osc.b.pan", "amount": -0.2, "bipolar": true, "enabled": true },
            { "source": "lfo.2", "target": "osc.b.pan", "amount": 0.44, "bipolar": false, "enabled": true },
            { "source": "lfo.1", "target": "unison.spread", "amount": 0.33, "bipolar": false, "enabled": true },
            { "source": "env.1", "target": "filter.drive", "amount": 0.22, "enabled": true },
            { "source": "env.2", "target": "filter.resonance", "amount": 0.2, "enabled": true },
            { "source": "keytrack", "target": "osc.a.level", "amount": 0.2, "enabled": true },
            { "source": "modWheel", "target": "amp.pan", "amount": 0.35, "bipolar": true, "enabled": true },
            { "source": "pressure", "target": "filter.drive", "amount": 0.38, "bipolar": true, "enabled": true },
            { "source": "timbre", "target": "osc.b.position", "amount": -0.24, "bipolar": false, "enabled": true },
            { "source": "lfo.1", "target": "filter.cutoff", "amount": -0.2, "bipolar": false, "enabled": true },
            { "source": "lfo.1", "target": "filter.cutoff", "amount": 1.0, "enabled": false },
            { "source": "env.1", "target": "filter.cutoff", "amount": 0.3, "enabled": true },
            { "source": "velocity", "target": "amp.level", "amount": 0.25, "bipolar": false, "enabled": true }
          ]
        }
        )json");

        beat::InstrumentDefinition instrument;
        instrument.kind = "synth";
        if (!beat::applySynthPatchContract(patch, instrument))
            return false;

        if (instrument.kind != "wavetable" || instrument.waveform != 5 || !instrument.hasAether)
            return false;
        if (instrument.wavetableBank != 4 || !near(instrument.wavetablePosition, 0.25f))
            return false;
        if (instrument.wavetableUnison != 5 || !near(instrument.wavetableDetuneCents, 20.0f) || !near(instrument.wavetableBlend, 0.4f))
            return false;
        if (instrument.maxVoices != 6)
            return false;
        if (!instrument.mono || !instrument.legato)
            return false;
        if (!instrument.aether.oscA.enabled || instrument.aether.oscA.wavetable.bank != 4)
            return false;
        if (!near(instrument.aether.oscA.wavetable.position, 0.25f) || instrument.aether.oscA.wavetable.unison != 3)
            return false;
        if (!near(instrument.aether.oscA.wavetable.detuneCents, 11.0f) || !near(instrument.aether.oscA.wavetable.blend, 0.27f))
            return false;
        if (!near(instrument.aether.oscA.wavetable.warp, 0.58f) || instrument.aether.oscA.wavetable.warpMode != 1)
            return false;
        if (!near(instrument.aether.oscA.pan, -0.4f))
            return false;
        if (!near(instrument.aether.oscA.phase, 0.33f) || !near(instrument.aether.oscA.randomPhase, 0.2f))
            return false;
        if (instrument.aether.oscA.tuningMode != 1 || instrument.aether.oscA.harmonic != 5)
            return false;
        if (instrument.aether.oscA.phaseMode != 1)
            return false;
        if (instrument.aether.oscA.routing != 1 || instrument.aether.oscB.routing != 2
            || instrument.aether.sub.routing != 3 || instrument.aether.noise.routing != 1)
            return false;
        if (!near(instrument.aether.runtimeWarp, 0.24f) || instrument.aether.runtimeWarpMode != 1
            || !near(instrument.aether.runtimeWarp2, 0.41f) || instrument.aether.runtimeWarp2Mode != 2)
            return false;
        if (instrument.aether.interactionMode != 2 || !near(instrument.aether.interactionAmount, 0.72f))
            return false;
        if (!instrument.aether.memberExpressionZone.enabled
            || instrument.aether.memberExpressionZone.masterChannel != 1
            || instrument.aether.memberExpressionZone.firstMemberChannel != 2
            || instrument.aether.memberExpressionZone.lastMemberChannel != 8)
            return false;
        if (!instrument.aether.oscB.enabled || instrument.aether.oscB.wavetable.bank != 3)
            return false;
        if (!near(instrument.aether.oscB.wavetable.warp, 0.36f) || instrument.aether.oscB.wavetable.warpMode != 2)
            return false;
        if (!near(instrument.aether.oscB.level, 0.3f) || !near(instrument.aether.oscB.wavetable.position, 0.1f))
            return false;
        if (!near(instrument.aether.oscB.pan, 0.2f))
            return false;
        if (!near(instrument.aether.oscB.phase, 0.66f) || !near(instrument.aether.oscB.randomPhase, 0.1f))
            return false;
        if (instrument.aether.oscB.wavetable.unison != 7
            || !near(instrument.aether.oscB.wavetable.detuneCents, 31.0f)
            || !near(instrument.aether.oscB.wavetable.blend, 0.83f))
            return false;
        if (instrument.aether.oscB.octave != 1 || instrument.aether.oscB.semitone != 7 || !near(instrument.aether.oscB.fineCents, -5.0f))
            return false;
        if (instrument.aether.oscB.tuningMode != 2
            || !near(instrument.aether.oscB.ratioNumerator, 3.0f)
            || !near(instrument.aether.oscB.ratioDenominator, 2.0f))
            return false;
        if (instrument.filterType != 2 || instrument.cutoff01 < 0.55f || instrument.cutoff01 > 0.7f)
            return false;
        if (!near(instrument.filterKeytrack, 0.62f))
            return false;
        if (!near(instrument.resonance01, 0.2f) || !near(instrument.drive01, 0.35f))
            return false;
        if (!instrument.filter2Enabled || instrument.filter2Type != 1
            || instrument.filter2Cutoff01 < 0.65f || instrument.filter2Cutoff01 > 0.8f
            || !near(instrument.filter2Resonance01, 0.48f)
            || !near(instrument.filter2Drive01, 0.22f)
            || instrument.filterRouting != 1)
            return false;
        if (!near(instrument.attackMs, 10.0f) || !near(instrument.decayMs, 200.0f))
            return false;
        if (!near(instrument.sustain, 0.55f) || !near(instrument.releaseMs, 400.0f))
            return false;
        if (instrument.attackCurve != 1 || instrument.decayCurve != 3 || instrument.releaseCurve != 2)
            return false;
        if (!instrument.env1Loop)
            return false;
        if (!near(instrument.env2AttackMs, 10.0f) || !near(instrument.env2DecayMs, 90.0f) || !near(instrument.env2Sustain, 0.0f) || !near(instrument.env2ReleaseMs, 160.0f))
            return false;
        if (instrument.env2AttackCurve != 1 || instrument.env2DecayCurve != 3 || instrument.env2ReleaseCurve != 2)
            return false;
        if (!instrument.env2Loop)
            return false;
        if (!near(instrument.env3AttackMs, 20.0f) || !near(instrument.env3DecayMs, 120.0f)
            || !near(instrument.env3Sustain, 0.3f) || !near(instrument.env3ReleaseMs, 180.0f) || !instrument.env3Loop
            || !near(instrument.env4AttackMs, 30.0f) || !near(instrument.env4DecayMs, 140.0f)
            || !near(instrument.env4Sustain, 0.4f) || !near(instrument.env4ReleaseMs, 220.0f))
            return false;
        if (!near(instrument.ampLevel, 0.7f) || !near(instrument.ampPan, -0.25f))
            return false;
        if (instrument.lfoWaveform != 3 || !near(instrument.lfoRateHz, 6.5f) || !near(instrument.lfoPhaseOffset, 0.25f))
            return false;
        if (!instrument.lfoSync || instrument.lfoSyncedRate != "1/8")
            return false;
        if (!near(instrument.lfoSmoothing, 0.35f))
            return false;
        if (!near(instrument.lfoRandomPhase, 0.42f))
            return false;
        if (instrument.lfoRetrigger)
            return false;
        if (!instrument.lfoOneShot)
            return false;
        if (!instrument.lfo2Enabled || instrument.lfo2Waveform != 1 || !near(instrument.lfo2RateHz, 0.75f) || !near(instrument.lfo2PhaseOffset, 0.5f))
            return false;
        if (!instrument.lfo2Sync || instrument.lfo2SyncedRate != "1/2")
            return false;
        if (!near(instrument.lfo2Smoothing, 0.6f))
            return false;
        if (!near(instrument.lfo2RandomPhase, 0.25f))
            return false;
        if (!instrument.lfo2Retrigger)
            return false;
        if (instrument.lfo2OneShot)
            return false;
        if (!instrument.extraLfos[7].enabled || instrument.extraLfos[7].waveform != 3
            || !near(instrument.extraLfos[7].rateHz, 3.25f) || !near(instrument.extraLfos[7].smoothing, 0.2f)
            || !instrument.extraLfos[7].sync || instrument.extraLfos[7].syncedRate != "1/8t"
            || !near(instrument.extraLfos[7].phaseOffset, 0.3f)
            || !near(instrument.dynamicModulation.filterResonance.extraLfo[7], 0.29f))
            return false;
        if (!near(instrument.lfoDepth, 0.35f) || !near(instrument.lfoToPitch, 6.0f) || !near(instrument.lfoToFilter, -0.2f))
            return false;
        if (instrument.lfoPositionBipolar || !instrument.lfoPitchBipolar || instrument.lfoFilterBipolar)
            return false;
        if (!near(instrument.envToFilter, 0.3f))
            return false;
        if (!instrument.dynamicModulation.active)
            return false;
        if (!near(instrument.macroValues[0], 0.5f) || !near(instrument.macroValues[1], 0.8f))
            return false;
        if (!near(instrument.dynamicModulation.oscAPosition.macro1, 0.4f))
            return false;
        if (!near(instrument.dynamicModulation.oscBPosition.macro1, -0.3f))
            return false;
        if (!near(instrument.dynamicModulation.oscBLevel.macro2, 0.5f))
            return false;
        if (!near(instrument.dynamicModulation.oscBFine.macro2, 0.25f))
            return false;
        if (!near(instrument.dynamicModulation.oscAPan.macro1, 0.2f))
            return false;
        if (!near(instrument.dynamicModulation.oscBPan.macro2, -0.25f))
            return false;
        if (!near(instrument.dynamicModulation.unisonDetune.macro1, 0.1f))
            return false;
        if (!near(instrument.dynamicModulation.unisonSpread.macro1, 0.2f))
            return false;
        if (!near(instrument.dynamicModulation.oscAUnisonDetune.macro2, 0.12f))
            return false;
        if (!near(instrument.dynamicModulation.oscBUnisonSpread.macro1, -0.15f))
            return false;
        if (!near(instrument.dynamicModulation.filterCutoff.macro1, 0.1f))
            return false;
        if (!near(instrument.dynamicModulation.filterResonance.macro2, 0.25f))
            return false;
        if (!near(instrument.dynamicModulation.filterDrive.env3, 0.33f)
            || !near(instrument.dynamicModulation.ampPan.env4, -0.27f))
            return false;
        if (!near(instrument.dynamicModulation.ampLevel.macro2, -0.2f))
            return false;
        if (!near(instrument.dynamicModulation.ampPan.macro1, 0.5f))
            return false;
        if (!near(instrument.dynamicModulation.oscAPosition.lfo, -0.35f) || instrument.dynamicModulation.oscAPosition.lfoBipolar)
            return false;
        if (!near(instrument.dynamicModulation.oscAPan.lfo, 0.4f) || instrument.dynamicModulation.oscAPan.lfoBipolar)
            return false;
        if (!near(instrument.dynamicModulation.oscBPosition.lfo, 0.25f) || instrument.dynamicModulation.oscBPosition.lfoBipolar)
            return false;
        if (!near(instrument.dynamicModulation.oscBPan.lfo, -0.2f) || !instrument.dynamicModulation.oscBPan.lfoBipolar)
            return false;
        if (!near(instrument.dynamicModulation.oscBPan.lfo2, 0.44f) || instrument.dynamicModulation.oscBPan.lfo2Bipolar)
            return false;
        if (!near(instrument.dynamicModulation.filterCutoff.lfo, -0.2f) || !near(instrument.dynamicModulation.filterCutoff.env, 0.3f))
            return false;
        if (!near(instrument.dynamicModulation.unisonSpread.lfo, 0.33f) || instrument.dynamicModulation.unisonSpread.lfoBipolar)
            return false;
        if (instrument.dynamicModulation.filterCutoff.lfoBipolar || instrument.dynamicModulation.filterCutoff.envBipolar)
            return false;
        if (!near(instrument.dynamicModulation.filterDrive.env, 0.22f))
            return false;
        if (!near(instrument.dynamicModulation.filterResonance.env2, 0.2f) || instrument.dynamicModulation.filterResonance.env2Bipolar)
            return false;
        if (!near(instrument.dynamicModulation.oscALevel.keytrack, 0.2f) || instrument.dynamicModulation.oscALevel.keytrackBipolar)
            return false;
        if (!near(instrument.dynamicModulation.ampPan.modWheel, 0.35f) || !instrument.dynamicModulation.ampPan.modWheelBipolar)
            return false;
        if (!near(instrument.dynamicModulation.filterDrive.pressure, 0.38f) || !instrument.dynamicModulation.filterDrive.pressureBipolar)
            return false;
        if (!near(instrument.dynamicModulation.oscBPosition.timbre, -0.24f) || instrument.dynamicModulation.oscBPosition.timbreBipolar)
            return false;
        if (!near(instrument.dynamicModulation.ampLevel.velocity, 0.25f) || instrument.dynamicModulation.ampLevel.velocityBipolar)
            return false;

        const auto customPatch = juce::JSON::parse(R"json(
        {
          "schemaVersion": 1,
          "instrumentType": "wavetable-synth",
          "parameters": {
            "osc.a.enabled": true,
            "osc.a.wavetable": "user.custom",
            "osc.a.position": 0.74,
            "osc.a.level": 0.82,
            "osc.b.enabled": false,
            "unison.enabled": false,
            "filter.enabled": true,
            "filter.cutoff": 8400,
            "amp.level": 0.72
          },
          "modulation": [],
          "metadata": {
            "customWavetables": {
	              "user.custom": {
	                "id": "user.custom",
	                "name": "Verifier Custom",
	                "interpolation": "smooth",
	                "morph": 0.62,
	                "frames": [
	                  { "brightness": 0.12, "even": 0.04, "fold": 0.0, "formant": 0.06, "notch": 0.04, "skew": -0.24, "tilt": -0.55, "focus": 0.18, "phase": 0.0, "partials": [0.82, 0.12, 0.0, 0.36] },
	                  { "brightness": 0.38, "even": 0.18, "fold": 0.2, "formant": 0.22, "notch": 0.12, "skew": -0.08, "tilt": -0.15, "focus": 0.36, "phase": 0.25, "partials": [0.22, 0.74, 0.18, 0.0, 0.46] },
	                  { "brightness": 0.66, "even": 0.55, "fold": 0.42, "formant": 0.48, "notch": 0.28, "skew": 0.18, "tilt": 0.3, "focus": 0.58, "phase": -0.16, "partials": [0.0, 0.18, 0.68, 0.1, 0.0, 0.52] },
	                  { "brightness": 0.95, "even": 0.86, "fold": 0.68, "formant": 0.62, "notch": 0.42, "skew": 0.32, "tilt": 0.62, "focus": 0.74, "phase": 0.36, "partials": [0.08, 0.0, 0.22, 0.64, 0.18, 0.0, 0.44] }
                ]
              }
            }
          }
        }
        )json");

        beat::InstrumentDefinition customInstrument;
        if (!beat::applySynthPatchContract(customPatch, customInstrument))
            return false;
        if (customInstrument.wavetableBank != 5 || !customInstrument.aether.oscA.wavetable.custom)
            return false;
        if (customInstrument.aether.oscA.wavetable.bank != 5)
            return false;
	        if (!near(customInstrument.aether.oscA.wavetable.customFrames[3].fold, 0.68f))
	            return false;
	        if (!customInstrument.aether.oscA.wavetable.smoothInterpolation)
	            return false;
	        if (!near(customInstrument.aether.oscA.wavetable.morph, 0.62f))
	            return false;
	        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].formant, 0.48f))
	            return false;
	        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].notch, 0.28f))
	            return false;
	        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].partials[2], 0.68f))
	            return false;
	        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].skew, 0.18f))
            return false;
        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].tilt, 0.3f))
            return false;
        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].focus, 0.58f))
            return false;
        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].phase, -0.16f))
            return false;

        const auto mixedEraWavemapPatch = juce::JSON::parse(R"json(
        {
          "schemaVersion": 1,
          "instrumentType": "wavetable-synth",
          "parameters": {
            "osc.a.enabled": true,
            "osc.a.wavetable": "user.modern",
            "osc.a.position": 0.35,
            "osc.a.level": 0.78,
            "osc.b.enabled": true,
            "osc.b.wavetable": "user.legacy-only",
            "osc.b.position": 0.66,
            "osc.b.level": 0.5,
            "filter.enabled": true,
            "amp.level": 0.72
          },
          "modulation": [],
          "metadata": {
            "wavemaps": {
              "user.modern": {
                "id": "user.modern",
                "name": "Modern Current",
                "interpolation": "smooth",
                "morph": 0.22,
                "frames": [
                  { "brightness": 0.41, "even": 0.18, "fold": 0.66, "formant": 0.24, "notch": 0.11, "skew": 0.25, "tilt": 0.15, "focus": 0.44, "phase": 0.18, "partials": [0.1, 0.2, 0.3, 0.4] }
                ]
              }
            },
            "customWavetables": {
              "user.modern": {
                "name": "Stale Legacy Copy",
                "frames": [
                  { "brightness": 0.02, "fold": 0.03, "formant": 0.04 }
                ]
              },
              "user.legacy-only": {
                "id": "user.legacy-only",
                "name": "Legacy Only",
                "interpolation": "smooth",
                "morph": 0.77,
                "frames": [
                  { "brightness": 0.82, "even": 0.21, "fold": 0.17, "formant": 0.69, "notch": 0.27, "skew": -0.42, "tilt": -0.19, "focus": 0.58, "phase": -0.31, "partials": [0.9, 0.7, 0.5] }
                ]
              }
            }
          }
        }
        )json");

        beat::InstrumentDefinition mixedEraInstrument;
        if (!beat::applySynthPatchContract(mixedEraWavemapPatch, mixedEraInstrument))
            return false;
        if (!mixedEraInstrument.aether.oscA.wavetable.custom || !mixedEraInstrument.aether.oscB.wavetable.custom)
            return false;
        if (!near(mixedEraInstrument.aether.oscA.wavetable.customFrames[0].fold, 0.66f))
            return false;
        if (!near(mixedEraInstrument.aether.oscA.wavetable.customFrames[0].formant, 0.24f))
            return false;
        if (!near(mixedEraInstrument.aether.oscA.wavetable.morph, 0.22f))
            return false;
        if (!near(mixedEraInstrument.aether.oscB.wavetable.customFrames[0].formant, 0.69f))
            return false;
        if (!near(mixedEraInstrument.aether.oscB.wavetable.customFrames[0].notch, 0.27f))
            return false;
        if (!near(mixedEraInstrument.aether.oscB.wavetable.customFrames[0].partials[1], 0.7f))
            return false;
        if (!near(mixedEraInstrument.aether.oscB.wavetable.morph, 0.77f))
            return false;

        const auto macroPatch = juce::JSON::parse(R"json(
        {
          "instrumentType": "wavetable-synth",
          "parameters": {
            "osc.a.enabled": true,
            "osc.a.wavetable": "basic.saw",
            "amp.level": 0.4,
            "macro.1": 0.5,
            "macro.5": 0.25,
            "macro.6": 0.35,
            "macro.7": 0.45,
            "macro.8": 0.65
          },
          "metadata": {
            "macros": {
              "macro.1": { "id": "macro.1", "label": "Brightness", "min": 0.2, "max": 0.8, "curve": "ease-in" }
            }
          },
          "modulation": [
            { "source": "macro.1", "target": "amp.level", "amount": 0.5, "enabled": true },
            { "source": "macro.8", "target": "filter.drive", "amount": 0.37, "enabled": true }
          ]
        }
        )json");

        beat::InstrumentDefinition macroInstrument;
        if (!beat::applySynthPatchContract(macroPatch, macroInstrument))
            return false;
        if (!near(macroInstrument.ampLevel, 0.4f))
            return false;
        if (!near(macroInstrument.macroValues[0], 0.35f))
            return false;
        if (!near(macroInstrument.dynamicModulation.ampLevel.macro1, 0.5f))
            return false;
        if (!near(macroInstrument.macroValues[4], 0.25f) || !near(macroInstrument.macroValues[5], 0.35f)
            || !near(macroInstrument.macroValues[6], 0.45f) || !near(macroInstrument.macroValues[7], 0.65f)
            || !near(macroInstrument.dynamicModulation.filterDrive.macro8, 0.37f))
            return false;

        return true;
    }

    bool stressInstrumentVoiceWavetablePath()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 5;
        params.wavetableBank = 0;
        params.wavetablePosition = 0.5f;
        params.wavetableUnison = 3;
        params.wavetableDetuneCents = 9.0f;
        params.wavetableBlend = 0.5f;
        params.cutoff01 = 1.0f;
        params.resonance01 = 0.05f;
        params.drive01 = 0.0f;
        params.attackMs = 1.0f;
        params.decayMs = 20.0f;
        params.sustain = 1.0f;
        params.releaseMs = 20.0f;
        params.lfoDepth = 0.0f;

        auto render = [](const beat::InstrumentVoice::Params& renderParams) {
            beat::InstrumentVoice voice;
            voice.prepare(44100.0, 256);
            voice.setParams(renderParams);
            voice.startNote(69, 1.0f, nullptr, 0);

            juce::AudioBuffer<float> buffer(2, 4096);
            buffer.clear();
            voice.renderNextBlock(buffer, 0, buffer.getNumSamples());
            voice.stopNote(0.0f, false);
            return buffer;
        };

        auto buffer = render(params);

        double energy = 0.0;
        float peak = 0.0f;
        for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(channel, i);
                if (!std::isfinite(sample))
                    return false;
                peak = std::max(peak, std::abs(sample));
                energy += (double) sample * (double) sample;
            }
        }

        if (!(energy > 0.001 && peak > 0.001f && peak < 1.0f))
            return false;

        auto modulatedParams = params;
        modulatedParams.lfoDepth = 0.75f;
        modulatedParams.lfoRateHz = 6.0f;
        auto modulated = render(modulatedParams);

        double diff = 0.0;
        for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = modulated.getSample(channel, i);
                if (!std::isfinite(sample))
                    return false;
                diff += std::abs((double) sample - (double) buffer.getSample(channel, i));
            }
        }

        if (diff <= 0.1)
            return false;

        auto linearAttackParams = params;
        linearAttackParams.attackMs = 200.0f;
        linearAttackParams.attackCurve = 0;
        linearAttackParams.sustain = 1.0f;
        auto expAttackParams = linearAttackParams;
        expAttackParams.attackCurve = 1;
        auto linearAttack = render(linearAttackParams);
        auto expAttack = render(expAttackParams);
        double linearAttackEnergy = 0.0;
        double expAttackEnergy = 0.0;
        for (int channel = 0; channel < linearAttack.getNumChannels(); ++channel)
        {
            for (int i = 0; i < 1200; ++i)
            {
                const auto linearSample = (double) linearAttack.getSample(channel, i);
                const auto expSample = (double) expAttack.getSample(channel, i);
                linearAttackEnergy += linearSample * linearSample;
                expAttackEnergy += expSample * expSample;
            }
        }
        if (!(expAttackEnergy < linearAttackEnergy * 0.85))
            return false;

        auto keytrackClosedParams = params;
        keytrackClosedParams.filterType = 0;
        keytrackClosedParams.cutoff01 = 0.24f;
        keytrackClosedParams.filterKeytrack = 0.0f;
        keytrackClosedParams.wavetableUnison = 1;
        auto keytrackOpenParams = keytrackClosedParams;
        keytrackOpenParams.filterKeytrack = 1.0f;
        auto renderHighNote = [](const beat::InstrumentVoice::Params& renderParams) {
            beat::InstrumentVoice voice;
            voice.prepare(44100.0, 256);
            voice.setParams(renderParams);
            voice.startNote(84, 1.0f, nullptr, 0);

            juce::AudioBuffer<float> buffer(2, 4096);
            buffer.clear();
            voice.renderNextBlock(buffer, 0, buffer.getNumSamples());
            voice.stopNote(0.0f, false);
            return buffer;
        };
        auto keytrackClosed = renderHighNote(keytrackClosedParams);
        auto keytrackOpen = renderHighNote(keytrackOpenParams);
        double keytrackClosedEnergy = 0.0;
        double keytrackOpenEnergy = 0.0;
        for (int channel = 0; channel < keytrackClosed.getNumChannels(); ++channel)
        {
            for (int i = 0; i < keytrackClosed.getNumSamples(); ++i)
            {
                const auto closedSample = (double) keytrackClosed.getSample(channel, i);
                const auto openSample = (double) keytrackOpen.getSample(channel, i);
                keytrackClosedEnergy += closedSample * closedSample;
                keytrackOpenEnergy += openSample * openSample;
            }
        }
        if (!(keytrackOpenEnergy > keytrackClosedEnergy * 1.1))
            return false;

        auto renderWithVelocity = [](const beat::InstrumentVoice::Params& renderParams, float velocity, int midiNote = 69, int modWheelValue = 0, int pitchWheelValue = 8192, int pressureValue = 0, int timbreValue = 0) {
            beat::InstrumentVoice voice;
            voice.prepare(44100.0, 256);
            voice.setParams(renderParams);
            voice.startNote(midiNote, velocity, nullptr, 8192);
            voice.controllerMoved(1, modWheelValue);
            voice.channelPressureChanged(pressureValue);
            voice.controllerMoved(74, timbreValue);
            voice.pitchWheelMoved(pitchWheelValue);

            juce::AudioBuffer<float> buffer(2, 4096);
            buffer.clear();
            voice.renderNextBlock(buffer, 0, buffer.getNumSamples());
            voice.stopNote(0.0f, false);
            return buffer;
        };
        auto estimatePositiveCrossingFrequency = [](const juce::AudioBuffer<float>& buffer) {
            int first = -1;
            int last = -1;
            int crossings = 0;
            for (int i = 257; i < buffer.getNumSamples(); ++i)
            {
                if (buffer.getSample(0, i - 1) <= 0.0f && buffer.getSample(0, i) > 0.0f)
                {
                    if (first < 0)
                        first = i;
                    last = i;
                    ++crossings;
                }
            }
            if (crossings < 2 || last <= first)
                return 0.0;
            return ((double) (crossings - 1) * 44100.0) / (double) (last - first);
        };

        auto velocityBaseParams = params;
        velocityBaseParams.ampLevel = 0.08f;
        velocityBaseParams.wavetableUnison = 1;
        auto velocityModParams = velocityBaseParams;
        velocityModParams.dynamicModulation.active = true;
        velocityModParams.dynamicModulation.ampLevel.velocity = 0.75f;
        auto velocityBase = renderWithVelocity(velocityBaseParams, 0.5f);
        auto velocityMod = renderWithVelocity(velocityModParams, 0.5f);
        double velocityBaseEnergy = 0.0;
        double velocityModEnergy = 0.0;
        for (int channel = 0; channel < velocityBase.getNumChannels(); ++channel)
        {
            for (int i = 0; i < velocityBase.getNumSamples(); ++i)
            {
                const auto baseSample = (double) velocityBase.getSample(channel, i);
                const auto modSample = (double) velocityMod.getSample(channel, i);
                if (!std::isfinite(baseSample) || !std::isfinite(modSample))
                    return false;
                velocityBaseEnergy += baseSample * baseSample;
                velocityModEnergy += modSample * modSample;
            }
        }
        if (!(velocityModEnergy > velocityBaseEnergy * 4.0))
            return false;

        auto keytrackModParams = params;
        keytrackModParams.ampLevel = 0.0f;
        keytrackModParams.wavetableUnison = 1;
        keytrackModParams.dynamicModulation.active = true;
        keytrackModParams.dynamicModulation.ampLevel.keytrack = 1.0f;
        auto lowKeytrack = renderWithVelocity(keytrackModParams, 1.0f, 36);
        auto highKeytrack = renderWithVelocity(keytrackModParams, 1.0f, 96);
        double lowKeytrackEnergy = 0.0;
        double highKeytrackEnergy = 0.0;
        for (int channel = 0; channel < lowKeytrack.getNumChannels(); ++channel)
        {
            for (int i = 0; i < lowKeytrack.getNumSamples(); ++i)
            {
                const auto lowSample = (double) lowKeytrack.getSample(channel, i);
                const auto highSample = (double) highKeytrack.getSample(channel, i);
                if (!std::isfinite(lowSample) || !std::isfinite(highSample))
                    return false;
                lowKeytrackEnergy += lowSample * lowSample;
                highKeytrackEnergy += highSample * highSample;
            }
        }
        if (!(highKeytrackEnergy > lowKeytrackEnergy * 3.5))
            return false;

        auto modWheelParams = params;
        modWheelParams.ampLevel = 0.0f;
        modWheelParams.wavetableUnison = 1;
        modWheelParams.dynamicModulation.active = true;
        modWheelParams.dynamicModulation.ampLevel.modWheel = 1.0f;
        auto lowModWheel = renderWithVelocity(modWheelParams, 1.0f, 69, 16);
        auto highModWheel = renderWithVelocity(modWheelParams, 1.0f, 69, 127);
        double lowModWheelEnergy = 0.0;
        double highModWheelEnergy = 0.0;
        for (int channel = 0; channel < lowModWheel.getNumChannels(); ++channel)
        {
            for (int i = 0; i < lowModWheel.getNumSamples(); ++i)
            {
                const auto lowSample = (double) lowModWheel.getSample(channel, i);
                const auto highSample = (double) highModWheel.getSample(channel, i);
                if (!std::isfinite(lowSample) || !std::isfinite(highSample))
                    return false;
                lowModWheelEnergy += lowSample * lowSample;
                highModWheelEnergy += highSample * highSample;
            }
        }
        if (!(highModWheelEnergy > lowModWheelEnergy * 40.0))
            return false;

        auto pressureParams = params;
        pressureParams.ampLevel = 0.0f;
        pressureParams.wavetableUnison = 1;
        pressureParams.dynamicModulation.active = true;
        pressureParams.dynamicModulation.ampLevel.pressure = 1.0f;
        const auto lowPressure = renderWithVelocity(pressureParams, 1.0f, 69, 0, 8192, 16);
        const auto highPressure = renderWithVelocity(pressureParams, 1.0f, 69, 0, 8192, 127);
        if (!(bufferEnergy(highPressure) > bufferEnergy(lowPressure) * 40.0))
            return false;

        auto timbreParams = params;
        timbreParams.ampLevel = 0.0f;
        timbreParams.wavetableUnison = 1;
        timbreParams.dynamicModulation.active = true;
        timbreParams.dynamicModulation.ampLevel.timbre = 1.0f;
        const auto lowTimbre = renderWithVelocity(timbreParams, 1.0f, 69, 0, 8192, 0, 16);
        const auto highTimbre = renderWithVelocity(timbreParams, 1.0f, 69, 0, 8192, 0, 127);
        if (!(bufferEnergy(highTimbre) > bufferEnergy(lowTimbre) * 40.0))
            return false;

        auto pitchBendParams = params;
        pitchBendParams.hasAether = true;
        pitchBendParams.waveform = 5;
        pitchBendParams.ampLevel = 0.95f;
        pitchBendParams.ampPan = 0.0f;
        pitchBendParams.attackMs = 1.0f;
        pitchBendParams.decayMs = 10.0f;
        pitchBendParams.sustain = 1.0f;
        pitchBendParams.releaseMs = 20.0f;
        pitchBendParams.filterType = 0;
        pitchBendParams.cutoff01 = 1.0f;
        pitchBendParams.resonance01 = 0.0f;
        pitchBendParams.drive01 = 0.0f;
        pitchBendParams.lfoDepth = 0.0f;
        pitchBendParams.lfoToPitch = 0.0f;
        pitchBendParams.lfoToFilter = 0.0f;
        pitchBendParams.envToFilter = 0.0f;
        pitchBendParams.dynamicModulation.active = false;
        pitchBendParams.pitchBendRangeSemitones = 2.0f;
        pitchBendParams.aetherOscA.enabled = true;
        pitchBendParams.aetherOscA.level = 1.0f;
        pitchBendParams.aetherOscA.pan = 0.0f;
        pitchBendParams.aetherOscA.waveform = 0;
        pitchBendParams.aetherOscA.octave = 0;
        pitchBendParams.aetherOscA.semitone = 0;
        pitchBendParams.aetherOscA.fineCents = 0.0f;
        pitchBendParams.aetherOscA.phase = 0.0f;
        pitchBendParams.aetherOscA.randomPhase = 0.0f;
        pitchBendParams.aetherOscB.enabled = false;
        pitchBendParams.aetherSub.enabled = false;
        pitchBendParams.aetherNoise.enabled = false;
        const auto pitchBase = renderWithVelocity(pitchBendParams, 1.0f, 69, 0, 8192);
        const auto pitchBent = renderWithVelocity(pitchBendParams, 1.0f, 69, 0, 16383);
        const auto pitchBaseHz = estimatePositiveCrossingFrequency(pitchBase);
        const auto pitchBentHz = estimatePositiveCrossingFrequency(pitchBent);
        if (!(pitchBaseHz > 430.0 && pitchBaseHz < 450.0))
            return false;
        const auto bendRatio = pitchBentHz / pitchBaseHz;
        if (!(bendRatio > 1.115 && bendRatio < 1.13))
            return false;

        auto env2ModParams = params;
        env2ModParams.ampLevel = 0.0f;
        env2ModParams.wavetableUnison = 1;
        env2ModParams.env2AttackMs = 1.0f;
        env2ModParams.env2DecayMs = 40.0f;
        env2ModParams.env2Sustain = 0.0f;
        env2ModParams.env2ReleaseMs = 30.0f;
        env2ModParams.dynamicModulation.active = true;
        env2ModParams.dynamicModulation.ampLevel.env2 = 1.0f;
        auto env2Mod = renderWithVelocity(env2ModParams, 1.0f);
        double env2EarlyEnergy = 0.0;
        double env2LateEnergy = 0.0;
        for (int channel = 0; channel < env2Mod.getNumChannels(); ++channel)
        {
            for (int i = 512; i < 2048; ++i)
            {
                const auto sample = (double) env2Mod.getSample(channel, i);
                if (!std::isfinite(sample))
                    return false;
                env2EarlyEnergy += sample * sample;
            }
            for (int i = 6144; i < env2Mod.getNumSamples(); ++i)
            {
                const auto sample = (double) env2Mod.getSample(channel, i);
                if (!std::isfinite(sample))
                    return false;
                env2LateEnergy += sample * sample;
            }
        }
        if (!(env2EarlyEnergy > env2LateEnergy * 9.0))
            return false;

        auto env2LinearAttackParams = env2ModParams;
        env2LinearAttackParams.env2AttackMs = 80.0f;
        env2LinearAttackParams.env2DecayMs = 80.0f;
        env2LinearAttackParams.env2Sustain = 1.0f;
        env2LinearAttackParams.env2AttackCurve = 0;
        auto env2ExpAttackParams = env2LinearAttackParams;
        env2ExpAttackParams.env2AttackCurve = 1;
        auto env2LinearAttack = renderWithVelocity(env2LinearAttackParams, 1.0f);
        auto env2ExpAttack = renderWithVelocity(env2ExpAttackParams, 1.0f);
        double env2LinearAttackEnergy = 0.0;
        double env2ExpAttackEnergy = 0.0;
        for (int channel = 0; channel < env2LinearAttack.getNumChannels(); ++channel)
        {
            for (int i = 512; i < 2048; ++i)
            {
                const auto linearSample = (double) env2LinearAttack.getSample(channel, i);
                const auto expSample = (double) env2ExpAttack.getSample(channel, i);
                if (!std::isfinite(linearSample) || !std::isfinite(expSample))
                    return false;
                env2LinearAttackEnergy += linearSample * linearSample;
                env2ExpAttackEnergy += expSample * expSample;
            }
        }
        if (!(env2ExpAttackEnergy < env2LinearAttackEnergy * 0.7))
            return false;

        auto env2LoopParams = env2ModParams;
        env2LoopParams.env2AttackMs = 15.0f;
        env2LoopParams.env2DecayMs = 40.0f;
        env2LoopParams.env2Sustain = 0.0f;
        env2LoopParams.env2ReleaseMs = 50.0f;
        env2LoopParams.env2Loop = true;
        auto env2NoLoopParams = env2LoopParams;
        env2NoLoopParams.env2Loop = false;
        auto env2LoopRender = renderWithVelocity(env2LoopParams, 1.0f);
        auto env2NoLoopRender = renderWithVelocity(env2NoLoopParams, 1.0f);
        double env2LoopLateEnergy = 0.0;
        double env2NoLoopLateEnergy = 0.0;
        for (int channel = 0; channel < env2LoopRender.getNumChannels(); ++channel)
        {
            for (int i = 2800; i < env2LoopRender.getNumSamples(); ++i)
            {
                const auto loopSample = (double) env2LoopRender.getSample(channel, i);
                const auto noLoopSample = (double) env2NoLoopRender.getSample(channel, i);
                if (!std::isfinite(loopSample) || !std::isfinite(noLoopSample))
                    return false;
                env2LoopLateEnergy += loopSample * loopSample;
                env2NoLoopLateEnergy += noLoopSample * noLoopSample;
            }
        }
        if (!(env2LoopLateEnergy > env2NoLoopLateEnergy * 2.0))
            return false;

        auto env1LoopParams = params;
        env1LoopParams.ampLevel = 1.0f;
        env1LoopParams.attackMs = 15.0f;
        env1LoopParams.decayMs = 40.0f;
        env1LoopParams.sustain = 0.0f;
        env1LoopParams.releaseMs = 50.0f;
        env1LoopParams.env1Loop = true;
        env1LoopParams.dynamicModulation.active = false;
        env1LoopParams.wavetableUnison = 1;
        auto env1NoLoopParams = env1LoopParams;
        env1NoLoopParams.env1Loop = false;
        auto env1LoopRender = renderWithVelocity(env1LoopParams, 1.0f);
        auto env1NoLoopRender = renderWithVelocity(env1NoLoopParams, 1.0f);
        double env1LoopLateEnergy = 0.0;
        double env1NoLoopLateEnergy = 0.0;
        for (int channel = 0; channel < env1LoopRender.getNumChannels(); ++channel)
        {
            for (int i = 2800; i < env1LoopRender.getNumSamples(); ++i)
            {
                const auto loopSample = (double) env1LoopRender.getSample(channel, i);
                const auto noLoopSample = (double) env1NoLoopRender.getSample(channel, i);
                if (!std::isfinite(loopSample) || !std::isfinite(noLoopSample))
                    return false;
                env1LoopLateEnergy += loopSample * loopSample;
                env1NoLoopLateEnergy += noLoopSample * noLoopSample;
            }
        }
        if (!(env1LoopLateEnergy > env1NoLoopLateEnergy * 2.0))
            return false;

        auto lowpassParams = params;
        lowpassParams.cutoff01 = 0.35f;
        lowpassParams.filterType = 0;
        auto highpassParams = lowpassParams;
        highpassParams.filterType = 2;
        auto lowpass = render(lowpassParams);
        auto highpass = render(highpassParams);

        double filterDiff = 0.0;
        for (int channel = 0; channel < lowpass.getNumChannels(); ++channel)
        {
            for (int i = 0; i < lowpass.getNumSamples(); ++i)
                filterDiff += std::abs((double) lowpass.getSample(channel, i) - (double) highpass.getSample(channel, i));
        }

        if (filterDiff <= 0.1)
            return false;

        auto pitchOnlyParams = params;
        pitchOnlyParams.lfoDepth = 0.0f;
        pitchOnlyParams.lfoToPitch = 4.0f;
        pitchOnlyParams.lfoRateHz = 5.0f;
        auto pitchOnly = render(pitchOnlyParams);
        double pitchOnlyDiff = 0.0;
        for (int channel = 0; channel < pitchOnly.getNumChannels(); ++channel)
        {
            for (int i = 0; i < pitchOnly.getNumSamples(); ++i)
                pitchOnlyDiff += std::abs((double) pitchOnly.getSample(channel, i) - (double) buffer.getSample(channel, i));
        }

        if (pitchOnlyDiff <= 0.1)
            return false;

        auto oneShotLoopParams = params;
        oneShotLoopParams.lfoDepth = 0.8f;
        oneShotLoopParams.lfoWaveform = 2;
        oneShotLoopParams.lfoRateHz = 24.0f;
        oneShotLoopParams.lfoPhaseOffset = 0.0f;
        oneShotLoopParams.lfoRetrigger = true;
        oneShotLoopParams.lfoOneShot = false;
        auto oneShotLoop = render(oneShotLoopParams);
        auto oneShotHoldParams = oneShotLoopParams;
        oneShotHoldParams.lfoOneShot = true;
        auto oneShotHold = render(oneShotHoldParams);
        double oneShotDiff = 0.0;
        for (int channel = 0; channel < oneShotLoop.getNumChannels(); ++channel)
        {
            for (int i = 0; i < oneShotLoop.getNumSamples(); ++i)
            {
                const float looped = oneShotLoop.getSample(channel, i);
                const float held = oneShotHold.getSample(channel, i);
                if (!std::isfinite(looped) || !std::isfinite(held))
                    return false;
                oneShotDiff += std::abs((double) looped - (double) held);
            }
        }

        if (oneShotDiff <= 0.1)
            return false;

        auto unipolarFilterParams = params;
        unipolarFilterParams.cutoff01 = 0.45f;
        unipolarFilterParams.lfoToFilter = 0.75f;
        unipolarFilterParams.lfoFilterBipolar = false;
        auto unipolarFilter = render(unipolarFilterParams);
        double unipolarFilterDiff = 0.0;
        for (int channel = 0; channel < unipolarFilter.getNumChannels(); ++channel)
        {
            for (int i = 0; i < unipolarFilter.getNumSamples(); ++i)
                unipolarFilterDiff += std::abs((double) unipolarFilter.getSample(channel, i) - (double) buffer.getSample(channel, i));
        }

        if (unipolarFilterDiff <= 0.1)
            return false;

        auto pannedParams = params;
        pannedParams.ampPan = -1.0f;
        auto panned = render(pannedParams);
        double leftEnergy = 0.0;
        double rightEnergy = 0.0;
        for (int i = 0; i < panned.getNumSamples(); ++i)
        {
            const float left = panned.getSample(0, i);
            const float right = panned.getSample(1, i);
            if (!std::isfinite(left) || !std::isfinite(right))
                return false;
            leftEnergy += (double) left * (double) left;
            rightEnergy += (double) right * (double) right;
        }

        return leftEnergy > rightEnergy * 20.0;
    }

    bool stressInstrumentVoicePhaseMemory()
    {
        auto baseParams = beat::InstrumentVoice::Params {};
        baseParams.hasAether = true;
        baseParams.aetherOscA.enabled = true;
        baseParams.aetherOscA.level = 1.0f;
        baseParams.aetherOscA.waveform = 0;
        baseParams.aetherOscA.phaseMode = 1;
        baseParams.aetherOscB.enabled = false;
        baseParams.aetherSub.enabled = false;
        baseParams.aetherNoise.enabled = false;
        baseParams.cutoff01 = 1.0f;
        baseParams.resonance01 = 0.0f;
        baseParams.drive01 = 0.0f;
        baseParams.attackMs = 0.0f;
        baseParams.decayMs = 0.0f;
        baseParams.sustain = 1.0f;

        beat::InstrumentVoice basicVoice;
        basicVoice.prepare(48000.0, 128);
        basicVoice.setParams(baseParams);
        basicVoice.startNote(69, 1.0f, nullptr, 8192);
        juce::AudioBuffer<float> buffer(2, 37);
        buffer.clear();
        basicVoice.renderNextBlock(buffer, 0, buffer.getNumSamples());
        const double rememberedBasic = basicVoice.phaseMemoryBaseAForTest();
        if (!(rememberedBasic > 0.0 && rememberedBasic < 1.0))
            return false;
        basicVoice.stopNote(0.0f, false);
        basicVoice.startNote(69, 1.0f, nullptr, 8192);
        if (std::abs(basicVoice.phaseMemoryBaseAForTest() - rememberedBasic) > 1.0e-12)
            return false;
        basicVoice.stopNote(0.0f, false);
        baseParams.aetherOscA.phaseMode = 0;
        basicVoice.setParams(baseParams);
        basicVoice.startNote(69, 1.0f, nullptr, 8192);
        if (std::abs(basicVoice.phaseMemoryBaseAForTest()) > 1.0e-12)
            return false;

        auto wavetableParams = baseParams;
        wavetableParams.aetherOscA.waveform = 5;
        wavetableParams.aetherOscA.phaseMode = 1;
        wavetableParams.aetherOscA.wavetable.unison = 1;
        beat::InstrumentVoice wavetableVoice;
        wavetableVoice.prepare(48000.0, 128);
        wavetableVoice.setParams(wavetableParams);
        wavetableVoice.startNote(69, 1.0f, nullptr, 8192);
        buffer.clear();
        wavetableVoice.renderNextBlock(buffer, 0, buffer.getNumSamples());
        const double rememberedWavetable = wavetableVoice.wavetablePhaseAForTest();
        wavetableVoice.stopNote(0.0f, false);
        wavetableVoice.startNote(69, 1.0f, nullptr, 8192);
        if (std::abs(wavetableVoice.wavetablePhaseAForTest() - rememberedWavetable) > 1.0e-12)
            return false;

        struct TestSound final : juce::SynthesiserSound
        {
            bool appliesToNote(int) override { return true; }
            bool appliesToChannel(int) override { return true; }
        };

        beat::BeatSynthesiser stealing;
        auto* stolenVoice = new beat::InstrumentVoice();
        stolenVoice->setStableVoiceId(91);
        stolenVoice->prepare(48000.0, 128);
        auto stealParams = baseParams;
        stealParams.aetherOscA.phaseMode = 1;
        stolenVoice->setParams(stealParams);
        stealing.addVoice(stolenVoice);
        stealing.addSound(new TestSound());
        stealing.setNoteStealingEnabled(true);
        stealing.setCurrentPlaybackSampleRate(48000.0);
        stealing.noteOn(1, 60, 1.0f);
        juce::AudioBuffer<float> beforeSteal(2, 37);
        beforeSteal.clear();
        stealing.renderNextBlock(beforeSteal, juce::MidiBuffer {}, 0, beforeSteal.getNumSamples());
        const double phaseBeforeSteal = stolenVoice->phaseMemoryBaseAForTest();
        const float sampleBeforeSteal = beforeSteal.getSample(0, beforeSteal.getNumSamples() - 1);
        stealing.noteOn(1, 67, 1.0f);
        if (stolenVoice->getCurrentlyPlayingNote() != 67
            || std::abs(stolenVoice->phaseMemoryBaseAForTest() - phaseBeforeSteal) > 1.0e-12)
            return false;
        juce::AudioBuffer<float> afterSteal(2, 128);
        afterSteal.clear();
        stealing.renderNextBlock(afterSteal, juce::MidiBuffer {}, 0, afterSteal.getNumSamples());
        double stealEnergy = 0.0;
        for (int channel = 0; channel < afterSteal.getNumChannels(); ++channel)
            for (int sample = 0; sample < afterSteal.getNumSamples(); ++sample)
            {
                const float value = afterSteal.getSample(channel, sample);
                if (!std::isfinite(value))
                    return false;
                stealEnergy += (double) value * (double) value;
            }
        if (stealEnergy <= 0.0
            || std::abs(afterSteal.getSample(0, 0) - sampleBeforeSteal) > 1.0e-5f)
            return false;

        auto legatoParams = baseParams;
        legatoParams.aetherOscA.phaseMode = 0;
        legatoParams.legato = true;
        beat::InstrumentVoice legatoVoice;
        legatoVoice.prepare(48000.0, 128);
        legatoVoice.setParams(legatoParams);
        legatoVoice.startNote(60, 1.0f, nullptr, 8192);
        buffer.clear();
        legatoVoice.renderNextBlock(buffer, 0, buffer.getNumSamples());
        const double phaseBeforeLegatoRetune = legatoVoice.phaseMemoryBaseAForTest();
        legatoVoice.startNote(72, 1.0f, nullptr, 8192);
        return phaseBeforeLegatoRetune > 0.0
            && std::abs(legatoVoice.phaseMemoryBaseAForTest() - phaseBeforeLegatoRetune) <= 1.0e-12;
    }

    bool stressInstrumentVoiceDualFilters()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 1;
        params.cutoff01 = 0.58f;
        params.resonance01 = 0.2f;
        params.drive01 = 0.1f;
        params.filterType = 0;
        params.attackMs = 0.0f;
        params.decayMs = 0.0f;
        params.sustain = 1.0f;
        params.filter2Enabled = true;
        params.filter2Type = 2;
        params.filter2Cutoff01 = 0.42f;
        params.filter2Resonance01 = 0.35f;
        params.filter2Drive01 = 0.18f;

        const auto render = [](beat::InstrumentVoice::Params renderParams) {
            beat::InstrumentVoice voice;
            voice.prepare(48000.0, 256);
            voice.setParams(renderParams);
            voice.startNote(57, 0.9f, nullptr, 8192);
            juce::AudioBuffer<float> output(2, 2048);
            output.clear();
            voice.renderNextBlock(output, 0, output.getNumSamples());
            return output;
        };

        params.filterRouting = 0;
        const auto serial = render(params);
        params.filterRouting = 1;
        const auto parallel = render(params);
        params.filter2Enabled = false;
        const auto legacy = render(params);
        auto routedParams = params;
        routedParams.hasAether = true;
        routedParams.aetherOscA.enabled = true;
        routedParams.aetherOscA.level = 0.8f;
        routedParams.aetherOscA.waveform = 1;
        routedParams.filter2Enabled = true;
        routedParams.aetherOscA.routing = 2;
        const auto filter1Only = render(routedParams);
        routedParams.aetherOscA.routing = 3;
        const auto filter2Only = render(routedParams);
        auto singleWarpParams = routedParams;
        singleWarpParams.aetherOscA.routing = 0;
        singleWarpParams.aetherRuntimeWarp = 0.45f;
        singleWarpParams.aetherRuntimeWarpMode = 1;
        const auto singleWarp = render(singleWarpParams);
        auto dualWarpParams = singleWarpParams;
        dualWarpParams.aetherRuntimeWarp2 = 0.55f;
        dualWarpParams.aetherRuntimeWarp2Mode = 2;
        beat::InstrumentVoice::consumeRenderWorkStats();
        const auto dualWarp = render(dualWarpParams);
        const auto dualWarpWork = beat::InstrumentVoice::consumeRenderWorkStats();
        if (dualWarpWork.nonlinearSamples != dualWarpWork.voiceSamples * 32
            || beat::RenderBudgets::exceedsVoiceNonlinearWorkCeiling(dualWarpWork.nonlinearSamples, dualWarpWork.voiceSamples))
            return false;
        double serialParallelDiff = 0.0;
        double serialLegacyDiff = 0.0;
        double explicitFilterDiff = 0.0;
        double dualWarpDiff = 0.0;
        for (int channel = 0; channel < serial.getNumChannels(); ++channel)
        {
            for (int sample = 0; sample < serial.getNumSamples(); ++sample)
            {
                const float serialValue = serial.getSample(channel, sample);
                const float parallelValue = parallel.getSample(channel, sample);
                const float legacyValue = legacy.getSample(channel, sample);
                const float filter1Value = filter1Only.getSample(channel, sample);
                const float filter2Value = filter2Only.getSample(channel, sample);
                const float singleWarpValue = singleWarp.getSample(channel, sample);
                const float dualWarpValue = dualWarp.getSample(channel, sample);
                if (!std::isfinite(serialValue) || !std::isfinite(parallelValue) || !std::isfinite(legacyValue)
                    || !std::isfinite(filter1Value) || !std::isfinite(filter2Value)
                    || !std::isfinite(singleWarpValue) || !std::isfinite(dualWarpValue))
                    return false;
                serialParallelDiff += std::abs((double) serialValue - (double) parallelValue);
                serialLegacyDiff += std::abs((double) serialValue - (double) legacyValue);
                explicitFilterDiff += std::abs((double) filter1Value - (double) filter2Value);
                dualWarpDiff += std::abs((double) singleWarpValue - (double) dualWarpValue);
            }
        }
        return serialParallelDiff > 0.1 && serialLegacyDiff > 0.1 && explicitFilterDiff > 0.1 && dualWarpDiff > 0.1;
    }

    bool stressInstrumentVoiceBandlimitedBasicOscillators()
    {
        auto render = [] (int waveform)
        {
            beat::InstrumentVoice::Params params;
            params.waveform = waveform;
            params.cutoff01 = 1.0f;
            params.resonance01 = 0.05f;
            params.drive01 = 0.0f;
            params.attackMs = 1.0f;
            params.decayMs = 12.0f;
            params.sustain = 1.0f;
            params.releaseMs = 15.0f;

            beat::InstrumentVoice::consumeRenderWorkStats();
            beat::InstrumentVoice voice;
            voice.prepare(48000.0, 256);
            voice.setParams(params);
            voice.startNote(96, 0.8f, nullptr, 0);

            juce::AudioBuffer<float> buffer(2, 4096);
            buffer.clear();
            voice.renderNextBlock(buffer, 0, buffer.getNumSamples());
            const auto work = beat::InstrumentVoice::consumeRenderWorkStats();
            return std::pair { std::move(buffer), work };
        };

        auto [saw, sawWork] = render(1);
        auto [square, squareWork] = render(2);

        double sawEnergy = 0.0;
        double squareEnergy = 0.0;
        double diff = 0.0;
        float peak = 0.0f;
        for (int channel = 0; channel < saw.getNumChannels(); ++channel)
        {
            for (int sampleIndex = 0; sampleIndex < saw.getNumSamples(); ++sampleIndex)
            {
                const auto sawSample = saw.getSample(channel, sampleIndex);
                const auto squareSample = square.getSample(channel, sampleIndex);
                if (!std::isfinite(sawSample) || !std::isfinite(squareSample))
                    return false;

                peak = std::max({ peak, std::abs(sawSample), std::abs(squareSample) });
                sawEnergy += (double) sawSample * (double) sawSample;
                squareEnergy += (double) squareSample * (double) squareSample;
                diff += std::abs((double) sawSample - (double) squareSample);
            }
        }

        return sawEnergy > 0.001
            && squareEnergy > 0.001
            && diff > 0.1
            && peak < 1.0f
            && sawWork.oscillatorSamples >= saw.getNumSamples()
            && squareWork.oscillatorSamples >= square.getNumSamples()
            && sawWork.wavetableVoiceSamples == 0
            && squareWork.wavetableVoiceSamples == 0
            && sawWork.filterDriveSamples == 0
            && squareWork.filterDriveSamples == 0;
    }

    bool stressInstrumentVoiceLegatoRetune()
    {
        struct RetuneProbe
        {
            double energy { -1.0 };
            float firstSampleAbs { 0.0f };
            float earlyPeakAbs { 0.0f };
        };

        auto renderRetuneProbe = [](bool legato)
        {
            beat::InstrumentVoice::Params params;
            params.waveform = 0;
            params.cutoff01 = 1.0f;
            params.resonance01 = 0.05f;
            params.drive01 = 0.0f;
            params.ampLevel = 0.95f;
            params.attackMs = 220.0f;
            params.decayMs = 20.0f;
            params.sustain = 1.0f;
            params.releaseMs = 20.0f;
            params.glideMs = 24.0f;
            params.legato = legato;

            beat::InstrumentVoice voice;
            voice.prepare(48000.0, 256);
            voice.setParams(params);
            voice.startNote(60, 1.0f, nullptr, 0);

            juce::AudioBuffer<float> warmup(2, 12000);
            warmup.clear();
            voice.renderNextBlock(warmup, 0, warmup.getNumSamples());

            voice.startNote(72, 1.0f, nullptr, 0);
            juce::AudioBuffer<float> retuned(2, 1024);
            retuned.clear();
            voice.renderNextBlock(retuned, 0, retuned.getNumSamples());

            RetuneProbe probe;
            probe.energy = 0.0;
            for (int channel = 0; channel < retuned.getNumChannels(); ++channel)
            {
                for (int sample = 0; sample < retuned.getNumSamples(); ++sample)
                {
                    const float value = retuned.getSample(channel, sample);
                    if (!std::isfinite(value))
                    {
                        probe.energy = -1.0;
                        return probe;
                    }
                    const float absValue = std::abs(value);
                    if (channel == 0 && sample == 0)
                        probe.firstSampleAbs = absValue;
                    if (sample < 32)
                        probe.earlyPeakAbs = std::max(probe.earlyPeakAbs, absValue);
                    probe.energy += (double) value * (double) value;
                }
            }
            return probe;
        };

        const auto retrigger = renderRetuneProbe(false);
        const auto legato = renderRetuneProbe(true);
        return retrigger.energy > 0.0
            && legato.energy > 0.0
            && legato.firstSampleAbs > retrigger.firstSampleAbs * 2.0f
            && retrigger.earlyPeakAbs > legato.earlyPeakAbs * 1.5f;
    }

    bool stressInstrumentVoiceAetherPath()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 5;
        params.hasAether = true;
        params.cutoff01 = 1.0f;
        params.resonance01 = 0.05f;
        params.drive01 = 0.1f;
        params.attackMs = 1.0f;
        params.decayMs = 20.0f;
        params.sustain = 1.0f;
        params.releaseMs = 30.0f;
        params.ampLevel = 0.85f;

        params.aetherOscA.enabled = true;
        params.aetherOscA.level = 0.8f;
        params.aetherOscA.pan = -0.75f;
        params.aetherOscA.waveform = 5;
        params.aetherOscA.wavetable.bank = 0;
        params.aetherOscA.wavetable.position = 0.25f;
        params.aetherOscA.wavetable.unison = 3;
        params.aetherOscA.wavetable.detuneCents = 7.0f;
        params.aetherOscA.wavetable.blend = 0.35f;

        params.aetherOscB.enabled = true;
        params.aetherOscB.level = 0.45f;
        params.aetherOscB.pan = 0.75f;
        params.aetherOscB.waveform = 5;
        params.aetherOscB.semitone = 7;
        params.aetherOscB.fineCents = -4.0f;
        params.aetherOscB.wavetable.bank = 1;
        params.aetherOscB.wavetable.position = 0.65f;
        params.aetherOscB.wavetable.unison = 2;
        params.aetherOscB.wavetable.detuneCents = 4.0f;
        params.aetherOscB.wavetable.blend = 0.4f;

        params.aetherSub.enabled = true;
        params.aetherSub.level = 0.18f;
        params.aetherSub.octave = -1;
        params.aetherSub.waveform = 0;
        params.aetherNoise.enabled = true;
        params.aetherNoise.level = 0.05f;
        params.aetherNoise.color = 0.6f;

        {
            auto setupParams = params;
            setupParams.aetherOscB.enabled = false;
            setupParams.aetherSub.enabled = false;
            setupParams.aetherNoise.enabled = false;
            setupParams.wavetableBank = 2;
            setupParams.wavetable.position = 0.91f;
            setupParams.wavetable.unison = 8;

            const auto before = beat::InstrumentVoice::getWavetableCacheStats();
            beat::InstrumentVoice voice;
            voice.prepare(48000.0, 256);
            voice.setParams(setupParams);
            const auto after = beat::InstrumentVoice::getWavetableCacheStats();
            const auto cacheAccesses = (after.hits - before.hits) + (after.misses - before.misses);
            if (cacheAccesses != 1)
                return false;
        }

        auto render = [](const beat::InstrumentVoice::Params& renderParams) {
            beat::InstrumentVoice voice;
            voice.prepare(48000.0, 256);
            voice.setParams(renderParams);
            voice.startNote(57, 0.9f, nullptr, 0);

            juce::AudioBuffer<float> buffer(2, 4096);
            buffer.clear();
            voice.renderNextBlock(buffer, 0, buffer.getNumSamples());
            return buffer;
        };

        beat::InstrumentVoice::consumeRenderWorkStats();
        auto full = render(params);
        const auto staticWork = beat::InstrumentVoice::consumeRenderWorkStats();
        if (staticWork.oscillatorRateCalculations != 0)
            return false;
        if (staticWork.filterDriveSamples < (int64_t) full.getNumSamples() * beat::DriveStage::workSamplesForChannels(2))
            return false;
        if (staticWork.wavetableFrequencyUpdates > 8 || staticWork.wavetablePositionUpdates > 8)
            return false;
        if (staticWork.aetherOscASamples < (int64_t) full.getNumSamples() * 3
            || staticWork.aetherOscBSamples < (int64_t) full.getNumSamples() * 2
            || staticWork.aetherSubSamples < full.getNumSamples()
            || staticWork.aetherNoiseSamples < full.getNumSamples())
            return false;

        double fullEnergy = 0.0;
        float fullPeak = 0.0f;
        for (int channel = 0; channel < full.getNumChannels(); ++channel)
        {
            for (int i = 0; i < full.getNumSamples(); ++i)
            {
                const float sample = full.getSample(channel, i);
                if (!std::isfinite(sample))
                    return false;
                fullEnergy += (double) sample * (double) sample;
                fullPeak = std::max(fullPeak, std::abs(sample));
            }
        }

        if (!(fullEnergy > 0.001 && fullPeak > 0.001f && fullPeak <= 1.0f))
            return false;

        double fullLeftEnergy = 0.0;
        double fullRightEnergy = 0.0;
        for (int i = 0; i < full.getNumSamples(); ++i)
        {
            fullLeftEnergy += (double) full.getSample(0, i) * (double) full.getSample(0, i);
            fullRightEnergy += (double) full.getSample(1, i) * (double) full.getSample(1, i);
        }
        if (!(fullLeftEnergy > 0.0 && fullRightEnergy > 0.0 && std::abs(fullLeftEnergy - fullRightEnergy) > fullEnergy * 0.02))
            return false;

        auto inertDynamicParams = params;
        inertDynamicParams.dynamicModulation.active = true;
        beat::InstrumentVoice::consumeRenderWorkStats();
        auto inertDynamic = render(inertDynamicParams);
        const auto inertDynamicWork = beat::InstrumentVoice::consumeRenderWorkStats();
        if (inertDynamicWork.modulationSamples != 0 || inertDynamicWork.oscillatorRateCalculations != 0)
            return false;
        double inertDiff = 0.0;
        for (int channel = 0; channel < full.getNumChannels(); ++channel)
        {
            for (int i = 0; i < full.getNumSamples(); ++i)
                inertDiff += std::abs((double) full.getSample(channel, i) - (double) inertDynamic.getSample(channel, i));
        }
        if (inertDiff > 0.000001)
            return false;

        auto oscAOnlyParams = params;
        oscAOnlyParams.aetherOscB.enabled = false;
        oscAOnlyParams.aetherSub.enabled = false;
        oscAOnlyParams.aetherNoise.enabled = false;
        auto oscAOnly = render(oscAOnlyParams);

        double diff = 0.0;
        for (int channel = 0; channel < full.getNumChannels(); ++channel)
        {
            for (int i = 0; i < full.getNumSamples(); ++i)
                diff += std::abs((double) full.getSample(channel, i) - (double) oscAOnly.getSample(channel, i));
        }

        if (diff <= 0.1)
            return false;

        auto dynamicParams = params;
        dynamicParams.lfoRateHz = 4.0f;
        dynamicParams.dynamicModulation.active = true;
        dynamicParams.dynamicModulation.oscBPosition.lfo = 0.55f;
        dynamicParams.dynamicModulation.oscBPosition.lfoBipolar = false;
        dynamicParams.dynamicModulation.oscBLevel.lfo = -0.35f;
        dynamicParams.dynamicModulation.oscBLevel.lfoBipolar = false;
        dynamicParams.dynamicModulation.oscAPan.lfo = 0.5f;
        dynamicParams.dynamicModulation.oscAPan.lfoBipolar = false;
        dynamicParams.dynamicModulation.oscBPan.lfo = -0.5f;
        dynamicParams.dynamicModulation.oscAFine.lfo = 0.18f;
        dynamicParams.dynamicModulation.filterResonance.lfo = 0.25f;
        dynamicParams.dynamicModulation.filterResonance.lfoBipolar = false;
        dynamicParams.dynamicModulation.filterDrive.env = 0.22f;
        dynamicParams.dynamicModulation.unisonDetune.lfo = 0.08f;
        dynamicParams.dynamicModulation.unisonDetune.lfoBipolar = false;
        beat::InstrumentVoice::consumeRenderWorkStats();
        auto dynamic = render(dynamicParams);
        const auto dynamicWork = beat::InstrumentVoice::consumeRenderWorkStats();
        if (dynamicWork.oscillatorRateCalculations <= 0)
            return false;
        if (dynamicWork.filterDriveSamples < (int64_t) dynamic.getNumSamples() * beat::DriveStage::workSamplesForChannels(2))
            return false;
        if (dynamicWork.wavetablePositionUpdates <= 0
            || dynamicWork.wavetablePositionUpdates >= dynamicWork.wavetableVoiceSamples)
            return false;
        if (dynamicWork.wavetableFrequencyUpdates <= 0)
            return false;

        double dynamicDiff = 0.0;
        for (int channel = 0; channel < full.getNumChannels(); ++channel)
        {
            for (int i = 0; i < full.getNumSamples(); ++i)
            {
                const float sample = dynamic.getSample(channel, i);
                if (!std::isfinite(sample))
                    return false;
                dynamicDiff += std::abs((double) sample - (double) full.getSample(channel, i));
            }
        }

        if (dynamicDiff <= 0.1)
            return false;

        auto silentParams = params;
        silentParams.ampLevel = 0.0f;
        auto silent = render(silentParams);
        double silentEnergy = 0.0;
        for (int channel = 0; channel < silent.getNumChannels(); ++channel)
        {
            for (int i = 0; i < silent.getNumSamples(); ++i)
            {
                const float sample = silent.getSample(channel, i);
                if (!std::isfinite(sample))
                    return false;
                silentEnergy += (double) sample * (double) sample;
            }
        }

        return silentEnergy < 0.000001;
    }

    bool stressInstrumentVoiceAetherPolyphony()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 5;
        params.hasAether = true;
        params.cutoff01 = 0.62f;
        params.resonance01 = 0.22f;
        params.drive01 = 0.18f;
        params.filterType = 1;
        params.attackMs = 2.0f;
        params.decayMs = 80.0f;
        params.sustain = 0.75f;
        params.releaseMs = 120.0f;
        params.ampLevel = 0.7f;
        params.lfoDepth = 0.35f;
        params.lfoRateHz = 5.0f;
        params.lfoToFilter = 0.4f;
        params.lfoToPitch = 0.2f;
        params.envToFilter = 0.15f;

        params.aetherOscA.enabled = true;
        params.aetherOscA.level = 0.75f;
        params.aetherOscA.waveform = 5;
        params.aetherOscA.wavetable.bank = 0;
        params.aetherOscA.wavetable.position = 0.55f;
        params.aetherOscA.wavetable.unison = 8;
        params.aetherOscA.wavetable.detuneCents = 12.0f;
        params.aetherOscA.wavetable.blend = 0.7f;

        params.aetherOscB.enabled = true;
        params.aetherOscB.level = 0.5f;
        params.aetherOscB.waveform = 5;
        params.aetherOscB.semitone = 7;
        params.aetherOscB.wavetable.bank = 4;
        params.aetherOscB.wavetable.position = 0.45f;
        params.aetherOscB.wavetable.unison = 4;
        params.aetherOscB.wavetable.detuneCents = 8.0f;
        params.aetherOscB.wavetable.blend = 0.55f;

        params.aetherSub.enabled = true;
        params.aetherSub.level = 0.12f;
        params.aetherNoise.enabled = true;
        params.aetherNoise.level = 0.04f;
        params.aetherNoise.color = 0.75f;

        std::array<beat::InstrumentVoice, 16> voices;
        for (size_t i = 0; i < voices.size(); ++i)
        {
            voices[i].prepare(48000.0, 512);
            voices[i].setParams(params);
            voices[i].startNote(48 + (int) (i % 12), 0.75f, nullptr, 0);
        }

        juce::AudioBuffer<float> buffer(2, 512);
        float peak = 0.0f;
        double energy = 0.0;
        for (int block = 0; block < 128; ++block)
        {
            buffer.clear();
            for (auto& voice : voices)
                voice.renderNextBlock(buffer, 0, buffer.getNumSamples());

            for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
            {
                for (int i = 0; i < buffer.getNumSamples(); ++i)
                {
                    const float sample = buffer.getSample(channel, i);
                    if (!std::isfinite(sample))
                        return false;
                    peak = std::max(peak, std::abs(sample));
                    energy += (double) sample * (double) sample;
                }
            }
        }

        return energy > 0.01 && peak < 12.0f;
    }

    bool stressInstrumentVoiceRealtimeParameters()
    {
        beat::InstrumentVoice::Params params;
        params.hasAether = true;
        params.aetherOscA.enabled = true;
        params.aetherOscA.level = 0.8f;
        params.aetherOscA.waveform = 5;
        params.aetherOscA.wavetable.bank = 0;
        params.cutoff01 = 0.45f;
        params.resonance01 = 0.1f;
        params.ampLevel = 0.8f;

        beat::InstrumentVoice voice;
        voice.prepare(48000.0, 256);
        voice.setParams(params);
        voice.startNote(60, 0.9f, nullptr, 0);

        const std::array<std::pair<std::string_view, float>, 12> updates {{
            { "filter.cutoff", 0.72f },
            { "filter.resonance", 0.25f },
            { "filter.drive", 0.18f },
            { "amp.level", 0.66f },
            { "amp.pan", -0.35f },
            { "osc.a.position", 0.58f },
            { "osc.a.fine", 11.0f },
            { "osc.a.level", 0.7f },
            { "osc.b.position", 0.2f },
            { "unison.detune", 18.0f },
            { "unison.spread", 0.4f },
            { "lfo.1.rate", 4.0f },
        }};

        for (const auto& [parameter, value] : updates)
            if (!voice.applyRealtimeParameter(parameter, value))
                return false;
        if (!voice.applyRealtimeParameter("filter.cutoff", 0.18f, 256))
            return false;
        if (!voice.applyRealtimeParameter("amp.pan", 0.45f, 128))
            return false;
        if (!voice.applyRealtimeParameter("osc.a.position", 0.9f, 512))
            return false;
        if (voice.applyRealtimeParameter("wavetable.bank", 3.0f))
            return false;

        juce::AudioBuffer<float> buffer(2, 512);
        double energy = 0.0;
        for (int block = 0; block < 32; ++block)
        {
            buffer.clear();
            voice.renderNextBlock(buffer, 0, buffer.getNumSamples());
            for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
            {
                for (int i = 0; i < buffer.getNumSamples(); ++i)
                {
                    const float sample = buffer.getSample(channel, i);
                    if (!std::isfinite(sample))
                        return false;
                    energy += (double) sample * (double) sample;
                }
            }
        }

        return energy > 0.001;
    }

    bool stressInstrumentVoiceRealtimeRampOverride()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 0;
        params.cutoff01 = 1.0f;
        params.ampLevel = 1.0f;
        params.ampPan = 0.0f;
        params.attackMs = 1.0f;

        beat::InstrumentVoice voice;
        voice.prepare(48000.0, 256);
        voice.setParams(params);
        voice.startNote(60, 1.0f, nullptr, 0);

        if (!voice.applyRealtimeParameter("amp.pan", -1.0f, 2048))
            return false;
        if (!voice.applyRealtimeParameter("amp.pan", 1.0f, 0))
            return false;

        juce::AudioBuffer<float> buffer(2, 512);
        buffer.clear();
        voice.renderNextBlock(buffer, 0, buffer.getNumSamples());

        double leftEnergy = 0.0;
        double rightEnergy = 0.0;
        for (int i = 0; i < buffer.getNumSamples(); ++i)
        {
            leftEnergy += (double) buffer.getSample(0, i) * (double) buffer.getSample(0, i);
            rightEnergy += (double) buffer.getSample(1, i) * (double) buffer.getSample(1, i);
        }

        return rightEnergy > leftEnergy * 8.0;
    }

    bool stressInstrumentVoiceLiveBaselineVsNoteAutomation()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 0;
        params.cutoff01 = 1.0f;
        params.ampLevel = 1.0f;
        params.ampPan = 0.0f;
        params.attackMs = 1.0f;
        params.releaseMs = 5.0f;

        beat::InstrumentVoice voice;
        voice.prepare(48000.0, 256);
        voice.setParams(params);

        const auto renderPanBalance = [&voice]()
        {
            juce::AudioBuffer<float> buffer(2, 512);
            buffer.clear();
            voice.renderNextBlock(buffer, 0, buffer.getNumSamples());

            double leftEnergy = 0.0;
            double rightEnergy = 0.0;
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                leftEnergy += (double) buffer.getSample(0, i) * (double) buffer.getSample(0, i);
                rightEnergy += (double) buffer.getSample(1, i) * (double) buffer.getSample(1, i);
            }
            return std::pair<double, double> { leftEnergy, rightEnergy };
        };

        voice.startNote(60, 1.0f, nullptr, 0);
        if (!voice.applyRealtimeParameter("amp.pan", 1.0f, 0))
            return false;

        const auto liveRight = renderPanBalance();
        if (liveRight.second <= liveRight.first * 8.0)
            return false;

        voice.stopNote(0.0f, false);

        std::array<beat::VoiceNoteAutomation::Context, beat::VoiceNoteAutomation::maxPendingContexts> contexts {};
        contexts[0].midiNoteNumber = 60;
        contexts[0].eventCount = 1;
        contexts[0].events[0] = beat::makeRealtimeParameterChange(std::string_view {}, "amp.pan", -1.0f, 0, 0);

        beat::VoiceAutomationInbox::setPending(contexts.data(), 1);
        voice.startNote(60, 1.0f, nullptr, 0);
        beat::VoiceAutomationInbox::clearPending();

        const auto noteLocalLeft = renderPanBalance();
        if (noteLocalLeft.first <= noteLocalLeft.second * 8.0)
            return false;

        voice.stopNote(0.0f, false);
        voice.startNote(60, 1.0f, nullptr, 0);

        const auto restoredLiveRight = renderPanBalance();
        return restoredLiveRight.second > restoredLiveRight.first * 8.0;
    }

    bool stressInstrumentVoicePerNoteAutomation()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 0;
        params.cutoff01 = 0.9f;
        params.ampLevel = 1.0f;
        params.ampPan = 0.0f;
        params.attackMs = 1.0f;
        params.releaseMs = 5.0f;

        beat::InstrumentVoice voice;
        voice.prepare(48000.0, 256);
        voice.setParams(params);

        std::array<beat::VoiceNoteAutomation::Context, beat::VoiceNoteAutomation::maxPendingContexts> contexts {};
        contexts[0].midiNoteNumber = 60;
        contexts[0].eventCount = 1;
        contexts[0].events[0] = beat::makeRealtimeParameterChange(std::string_view {}, "amp.pan", -1.0f, 0, 0);

        beat::VoiceAutomationInbox::setPending(contexts.data(), 1);
        voice.startNote(60, 1.0f, nullptr, 0);
        beat::VoiceAutomationInbox::clearPending();

        juce::AudioBuffer<float> leftPanBuffer(2, 512);
        leftPanBuffer.clear();
        voice.renderNextBlock(leftPanBuffer, 0, leftPanBuffer.getNumSamples());

        double leftEnergy = 0.0;
        double rightEnergy = 0.0;
        for (int i = 0; i < leftPanBuffer.getNumSamples(); ++i)
        {
            leftEnergy += (double) leftPanBuffer.getSample(0, i) * (double) leftPanBuffer.getSample(0, i);
            rightEnergy += (double) leftPanBuffer.getSample(1, i) * (double) leftPanBuffer.getSample(1, i);
        }
        if (leftEnergy <= rightEnergy * 8.0)
            return false;

        voice.stopNote(0.0f, false);
        voice.startNote(60, 1.0f, nullptr, 0);

        juce::AudioBuffer<float> centeredBuffer(2, 512);
        centeredBuffer.clear();
        voice.renderNextBlock(centeredBuffer, 0, centeredBuffer.getNumSamples());

        leftEnergy = 0.0;
        rightEnergy = 0.0;
        for (int i = 0; i < centeredBuffer.getNumSamples(); ++i)
        {
            leftEnergy += (double) centeredBuffer.getSample(0, i) * (double) centeredBuffer.getSample(0, i);
            rightEnergy += (double) centeredBuffer.getSample(1, i) * (double) centeredBuffer.getSample(1, i);
        }

        const double balance = rightEnergy > 0.0 ? leftEnergy / rightEnergy : 999.0;
        return balance > 0.5 && balance < 2.0;
    }

    bool stressInstrumentVoiceMacroAutomation()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 0;
        params.cutoff01 = 1.0f;
        params.ampLevel = 1.0f;
        params.ampPan = 0.0f;
        params.attackMs = 1.0f;
        params.releaseMs = 5.0f;
        params.dynamicModulation.active = true;
        params.dynamicModulation.ampPan.macro1 = -1.0f;
        params.macroValues[0] = 0.0f;

        beat::InstrumentVoice voice;
        voice.prepare(48000.0, 256);
        voice.setParams(params);

        std::array<beat::VoiceNoteAutomation::Context, beat::VoiceNoteAutomation::maxPendingContexts> contexts {};
        contexts[0].midiNoteNumber = 60;
        contexts[0].eventCount = 1;
        contexts[0].events[0] = beat::makeRealtimeParameterChange(std::string_view {}, "macro.1", 1.0f, 0, 0);

        beat::VoiceAutomationInbox::setPending(contexts.data(), 1);
        voice.startNote(60, 1.0f, nullptr, 0);
        beat::VoiceAutomationInbox::clearPending();

        juce::AudioBuffer<float> macroBuffer(2, 512);
        macroBuffer.clear();
        voice.renderNextBlock(macroBuffer, 0, macroBuffer.getNumSamples());

        double leftEnergy = 0.0;
        double rightEnergy = 0.0;
        for (int i = 0; i < macroBuffer.getNumSamples(); ++i)
        {
            leftEnergy += (double) macroBuffer.getSample(0, i) * (double) macroBuffer.getSample(0, i);
            rightEnergy += (double) macroBuffer.getSample(1, i) * (double) macroBuffer.getSample(1, i);
        }
        if (leftEnergy <= rightEnergy * 8.0)
            return false;

        voice.stopNote(0.0f, false);
        voice.startNote(60, 1.0f, nullptr, 0);

        juce::AudioBuffer<float> resetBuffer(2, 512);
        resetBuffer.clear();
        voice.renderNextBlock(resetBuffer, 0, resetBuffer.getNumSamples());

        leftEnergy = 0.0;
        rightEnergy = 0.0;
        for (int i = 0; i < resetBuffer.getNumSamples(); ++i)
        {
            leftEnergy += (double) resetBuffer.getSample(0, i) * (double) resetBuffer.getSample(0, i);
            rightEnergy += (double) resetBuffer.getSample(1, i) * (double) resetBuffer.getSample(1, i);
        }

        const double balance = rightEnergy > 0.0 ? leftEnergy / rightEnergy : 999.0;
        return balance > 0.5 && balance < 2.0;
    }

    bool stressInstrumentVoicePerNotePitchCurve()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 0;
        params.cutoff01 = 1.0f;
        params.ampLevel = 1.0f;
        params.attackMs = 1.0f;

        beat::InstrumentVoice voice;
        voice.prepare(48000.0, 256);
        voice.setParams(params);

        std::array<beat::VoiceNoteAutomation::Context, beat::VoiceNoteAutomation::maxPendingContexts> contexts {};
        contexts[0].midiNoteNumber = 60;
        contexts[0].pitchEventCount = 2;
        contexts[0].pitchEvents[0] = { 0, (float) juce::MidiMessage::getMidiNoteInHertz(60), 0 };
        contexts[0].pitchEvents[1] = { 0, (float) juce::MidiMessage::getMidiNoteInHertz(72), 1024 };

        beat::VoiceAutomationInbox::setPending(contexts.data(), 1);
        voice.startNote(60, 1.0f, nullptr, 0);
        beat::VoiceAutomationInbox::clearPending();

        juce::AudioBuffer<float> buffer(2, 2048);
        buffer.clear();
        voice.renderNextBlock(buffer, 0, buffer.getNumSamples());

        const auto countCrossings = [&](int start, int end)
        {
            int crossings = 0;
            float previous = buffer.getSample(0, start);
            for (int i = start + 1; i < end; ++i)
            {
                const float current = buffer.getSample(0, i);
                if ((previous <= 0.0f && current > 0.0f) || (previous >= 0.0f && current < 0.0f))
                    ++crossings;
                previous = current;
            }
            return crossings;
        };

        const int earlyCrossings = countCrossings(128, 896);
        const int lateCrossings = countCrossings(1152, 1920);
        return lateCrossings > earlyCrossings;
    }

    bool stressInstrumentVoicePerNotePhaseAutomation()
    {
        beat::InstrumentVoice::Params params;
        params.hasAether = true;
        params.ampLevel = 1.0f;
        params.cutoff01 = 1.0f;
        params.attackMs = 0.0f;
        params.decayMs = 10.0f;
        params.sustain = 1.0f;
        params.releaseMs = 1.0f;
        params.aetherOscA.enabled = true;
        params.aetherOscA.level = 1.0f;
        params.aetherOscA.waveform = 0;
        params.aetherOscA.phase = 0.0f;
        params.aetherOscA.randomPhase = 0.0f;
        params.aetherOscB.enabled = false;
        params.aetherSub.enabled = false;
        params.aetherNoise.enabled = false;

        beat::InstrumentVoice voice;
        voice.prepare(48000.0, 256);
        voice.setParams(params);

        std::array<beat::VoiceNoteAutomation::Context, beat::VoiceNoteAutomation::maxPendingContexts> contexts {};
        contexts[0].midiNoteNumber = 60;
        contexts[0].eventCount = 1;
        contexts[0].events[0] = beat::makeRealtimeParameterChange(std::string_view {}, "osc.a.phase", 0.25f, 0, 0);

        beat::VoiceAutomationInbox::setPending(contexts.data(), 1);
        voice.startNote(60, 1.0f, nullptr, 0);
        beat::VoiceAutomationInbox::clearPending();

        juce::AudioBuffer<float> shiftedBuffer(2, 32);
        shiftedBuffer.clear();
        voice.renderNextBlock(shiftedBuffer, 0, shiftedBuffer.getNumSamples());

        auto earlyPeak = [](const juce::AudioBuffer<float>& buffer)
        {
            double peak = 0.0;
            for (int i = 0; i < juce::jmin(8, buffer.getNumSamples()); ++i)
                peak = juce::jmax(peak, std::abs((double) buffer.getSample(0, i)));
            return peak;
        };

        const double shiftedPeak = earlyPeak(shiftedBuffer);

        voice.stopNote(0.0f, false);
        voice.startNote(60, 1.0f, nullptr, 0);

        juce::AudioBuffer<float> baselineBuffer(2, 32);
        baselineBuffer.clear();
        voice.renderNextBlock(baselineBuffer, 0, baselineBuffer.getNumSamples());

        const double baselinePeak = earlyPeak(baselineBuffer);
        if (shiftedPeak <= 0.005 || baselinePeak >= shiftedPeak * 0.35)
        {
            std::cerr << "phase automation baseline leak peak: " << baselinePeak << " shifted: " << shiftedPeak << "\n";
            return false;
        }
        return true;
    }
}

int main()
{
    beat::test::prepareRealtimeSafetyInterposers();
    if (!stressRealtimeSafetyDetectorNegativeCases())
    {
        std::cerr << "Realtime safety detector negative-case stress failed\n";
        return 1;
    }
    if (!stressBoundedSamplePageCache())
    {
        std::cerr << "Bounded sample page-cache stress failed\n";
        return 1;
    }
    if (!stressBoundedSamplePageCacheStarvation())
    {
        std::cerr << "Bounded sample page-cache starvation stress failed\n";
        return 1;
    }
    if (!stressSampleStreamingSession())
    {
        std::cerr << "Sample streaming session stress failed\n";
        return 1;
    }
    if (!stressAetherSampleSourceSlot())
    {
        std::cerr << "Aether sample source-slot stress failed\n";
        return 1;
    }
    std::cerr << "realtime: start\n";
    if (!stressRealtimeQueue())
    {
        std::cerr << "Realtime SPSC queue stress failed\n";
        return 1;
    }
    if (!stressFixedObjectPool())
    {
        std::cerr << "Fixed object pool stress failed\n";
        return 1;
    }
    if (!stressRealtimeParameterQueue())
    {
        std::cerr << "Realtime parameter queue stress failed\n";
        return 1;
    }
    if (!stressParameterPolicy())
    {
        std::cerr << "Parameter policy stress failed\n";
        return 1;
    }
    std::cerr << "realtime: done\n";

    std::cerr << "nodemap: start\n";
    if (!stressNodemapNativeGraphContract())
    {
        std::cerr << "Nodemap native graph contract stress failed\n";
        return 1;
    }
    if (!stressNodemapNativeAuditionAndCycles())
    {
        std::cerr << "Nodemap native audition/cycle stress failed\n";
        return 1;
    }
    if (!stressNodemapNativeEffectsAndTemplates())
    {
        std::cerr << "Nodemap native effects/templates stress failed\n";
        return 1;
    }
    if (!stressNodemapNativeLargeGraphTiming())
    {
        std::cerr << "Nodemap native large graph timing stress failed\n";
        return 1;
    }
    if (!stressProjectRepositoryNodemapInstrumentRoundtrip())
    {
        std::cerr << "Nodemap repository roundtrip stress failed\n";
        return 1;
    }
    if (!stressAudioEngineNodemapLiveExportParity())
    {
        std::cerr << "Nodemap live/export parity stress failed\n";
        return 1;
    }
    std::cerr << "nodemap: done\n";

    std::cerr << "wavetable: start\n";
    if (!stressWavetableOscillator())
    {
        std::cerr << "Wavetable oscillator stress failed\n";
        return 1;
    }
    if (!stressOscillatorSampleRatePreparation())
    {
        std::cerr << "Oscillator sample-rate preparation stress failed\n";
        return 1;
    }
    std::cerr << "wavetable: done\n";

    std::cerr << "synth contract: start\n";
    if (!stressSynthPatchContract())
    {
        std::cerr << "Synth patch contract stress failed\n";
        return 1;
    }
    std::cerr << "synth contract: done\n";

    std::cerr << "voice: start\n";
    if (!stressEnvelopeShaper())
    {
        std::cerr << "Envelope shaper stress failed\n";
        return 1;
    }
    if (!stressLfoHelper())
    {
        std::cerr << "LFO helper stress failed\n";
        return 1;
    }
    if (!stressDynamicModulationHelper())
    {
        std::cerr << "Dynamic modulation helper stress failed\n";
        return 1;
    }
    if (!stressBasicOscillatorHelper())
    {
        std::cerr << "Basic oscillator helper stress failed\n";
        return 1;
    }
    if (!stressVoiceRenderWorkBlock())
    {
        std::cerr << "Voice render work block stress failed\n";
        return 1;
    }
    if (!stressVoiceRenderWorkBudgets())
    {
        std::cerr << "Voice render work budget stress failed\n";
        return 1;
    }
    if (!stressAetherInteractionSpectralBaseline())
    {
        std::cerr << "Aether interaction spectral baseline failed\n";
        return 1;
    }
    if (!stressAetherTableStackRenderer())
    {
        std::cerr << "Aether table stack renderer stress failed\n";
        return 1;
    }
    if (!stressFilterMathHelper())
    {
        std::cerr << "Filter math helper stress failed\n";
        return 1;
    }
    if (!stressDriveStageHelper())
    {
        std::cerr << "Drive stage helper stress failed\n";
        return 1;
    }
    if (!stressFilterStageHelper())
    {
        std::cerr << "Filter stage helper stress failed\n";
        return 1;
    }
    if (!stressMasterDcBlocker())
    {
        std::cerr << "Master DC blocker stress failed\n";
        return 1;
    }
    if (!stressVoiceAllocationHelper())
    {
        std::cerr << "Voice allocation helper stress failed\n";
        return 1;
    }
    if (!stressVoiceStealTransition())
    {
        std::cerr << "Voice steal transition stress failed\n";
        return 1;
    }
    if (!stressMemberChannelExpressionOwnership())
    {
        std::cerr << "Member-channel expression ownership stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceWavetablePath())
    {
        std::cerr << "Instrument voice wavetable stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoicePhaseMemory())
    {
        std::cerr << "Instrument voice phase-memory stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceDualFilters())
    {
        std::cerr << "Instrument voice dual-filter stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceBandlimitedBasicOscillators())
    {
        std::cerr << "Instrument voice bandlimited basic oscillator stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceLegatoRetune())
    {
        std::cerr << "Instrument voice legato retune stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceAetherPath())
    {
        std::cerr << "Instrument voice Aether stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceAetherPolyphony())
    {
        std::cerr << "Instrument voice Aether polyphony stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceRealtimeParameters())
    {
        std::cerr << "Instrument voice realtime parameter stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceRealtimeRampOverride())
    {
        std::cerr << "Instrument voice realtime ramp override stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceLiveBaselineVsNoteAutomation())
    {
        std::cerr << "Instrument voice live baseline vs note automation stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoicePerNoteAutomation())
    {
        std::cerr << "Instrument voice per-note automation stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceMacroAutomation())
    {
        std::cerr << "Instrument voice macro automation stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoicePerNotePitchCurve())
    {
        std::cerr << "Instrument voice per-note pitch curve stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoicePerNotePhaseAutomation())
    {
        std::cerr << "Instrument voice per-note phase automation stress failed\n";
        return 1;
    }
    std::cerr << "voice: done\n";

    std::cerr << "analysis: start\n";
    if (!stressFftAnalyzer())
    {
        std::cerr << "FFT analyzer stress failed\n";
        return 1;
    }
    if (!stressAudioFileAnalyzer())
    {
        std::cerr << "Audio file analyzer stress failed\n";
        return 1;
    }
    std::cerr << "analysis: done\n";

    std::cerr << "sequencer: start\n";
    if (!stressSequencerTransport())
    {
        std::cerr << "Sequencer transport stress failed\n";
        return 1;
    }
    if (!stressSequencerLoopCrossing())
    {
        std::cerr << "Sequencer loop crossing stress failed\n";
        return 1;
    }
    if (!stressSequencerLoopBoundaryScheduling())
    {
        std::cerr << "Sequencer loop boundary scheduling stress failed\n";
        return 1;
    }
    if (!stressSequencerCropsMidiNotesToSegmentLength())
    {
        std::cerr << "Sequencer cropped MIDI note scheduling stress failed\n";
        return 1;
    }
    if (!stressSequencerAutomationMetadata())
    {
        std::cerr << "Sequencer automation metadata stress failed\n";
        return 1;
    }
    if (!stressSequencerGlideMetadata())
    {
        std::cerr << "Sequencer glide metadata stress failed\n";
        return 1;
    }
    if (!stressSequencerSegmentAutomation())
    {
        std::cerr << "Sequencer segment automation stress failed\n";
        return 1;
    }
    if (!stressSequencerProjectAutomation())
    {
        std::cerr << "Sequencer project automation stress failed\n";
        return 1;
    }
    if (!stressSequencerAutomationConflictPrecedence())
    {
        std::cerr << "Sequencer automation conflict precedence stress failed\n";
        return 1;
    }
    if (!stressSequencerTrackEffectAutomation())
    {
        std::cerr << "Sequencer track effect automation stress failed\n";
        return 1;
    }
    if (!stressSequencerAutomationCurveCheckpoints())
    {
        std::cerr << "Sequencer automation curve checkpoint stress failed\n";
        return 1;
    }
    if (!stressSequencerTrackMixMetadata())
    {
        std::cerr << "Sequencer track mix metadata stress failed\n";
        return 1;
    }
    if (!stressSequencerAudioClipEvents())
    {
        std::cerr << "Sequencer audio clip event stress failed\n";
        return 1;
    }
    std::cerr << "sequencer: done\n";

    std::cerr << "persistence: start\n";
    if (!stressProjectAssetSidecarPackaging())
    {
        std::cerr << "Project asset sidecar packaging stress failed\n";
        return 1;
    }
    if (!stressAudioFileLibraryDeletePolicy())
    {
        std::cerr << "Audio file library delete policy stress failed\n";
        return 1;
    }
    if (!stressProjectIntegrityVerifier())
    {
        std::cerr << "Project integrity verifier stress failed\n";
        return 1;
    }
    if (!stressRecentProjectRepository())
    {
        if (std::getenv("AETHER_BASELINE_WAIVE_RECENT_PROJECT_EXISTS") != nullptr)
            std::cerr << "WAIVED baseline.recent-project-exists: path probing is intentionally disabled to avoid macOS TCC prompts\n";
        else
        {
            std::cerr << "Recent project repository stress failed\n";
            return 1;
        }
    }
    if (!stressProjectRepositoryPluginCapabilities())
    {
        std::cerr << "Project repository plugin capability stress failed\n";
        return 1;
    }
    if (!stressProjectRepositoryEffectDefaultsMigration())
    {
        std::cerr << "Project repository effect defaults migration stress failed\n";
        return 1;
    }
    if (!stressProjectRepositoryAetherInstrumentRoundtrip())
    {
        std::cerr << "Project repository Aether instrument roundtrip stress failed\n";
        return 1;
    }
    if (!stressProjectRepositoryAudioFileRoundtrip())
    {
        std::cerr << "Project repository audio file roundtrip stress failed\n";
        return 1;
    }
    if (!stressRecordingPlannerAppendTake())
    {
        std::cerr << "Recording planner append-take stress failed\n";
        return 1;
    }
    if (!stressRecordingPlannerLatencyCompensation())
    {
        std::cerr << "Recording planner latency compensation stress failed\n";
        return 1;
    }
    if (!stressRecordingLatencyCalibration())
    {
        std::cerr << "Recording latency calibration stress failed\n";
        return 1;
    }
    if (!stressRecordingSessionPlanner())
    {
        std::cerr << "Recording session planner stress failed\n";
        return 1;
    }
    if (!stressRecordingPlannerCommitCapture())
    {
        std::cerr << "Recording planner commit-capture stress failed\n";
        return 1;
    }
    if (!stressProjectRepositorySampleInstrumentRoundtrip())
    {
        std::cerr << "Project repository sample instrument roundtrip stress failed\n";
        return 1;
    }
    if (!stressProjectDocumentBackup())
    {
        std::cerr << "Project document backup stress failed\n";
        return 1;
    }
    std::cerr << "persistence: done\n";

    std::cerr << "engine: start\n";
    std::cerr << "  track meters\n";
    if (!stressAudioEngineTrackMeters())
    {
        std::cerr << "Audio engine track meter stress failed\n";
        return 1;
    }
    std::cerr << "  track gain/pan render\n";
    if (!stressAudioEngineTrackGainPanRender())
    {
        std::cerr << "Audio engine track gain/pan render stress failed\n";
        return 1;
    }
    std::cerr << "  extra LFO tempo sync\n";
    if (!stressAudioEngineExtraLfoTempoSync())
    {
        std::cerr << "Audio engine extra-LFO tempo-sync stress failed\n";
        return 1;
    }
    std::cerr << "  track effects\n";
    if (!stressAudioEngineTrackEffects())
    {
        std::cerr << "Audio engine track effects stress failed\n";
        return 1;
    }
    std::cerr << "  instrument effects\n";
    if (!stressAudioEngineInstrumentEffects())
    {
        std::cerr << "Audio engine instrument effects stress failed\n";
        return 1;
    }
    std::cerr << "  plugin effect placeholder\n";
    if (!stressAudioEnginePluginEffectPlaceholder())
    {
        std::cerr << "Audio engine plugin effect placeholder stress failed\n";
        return 1;
    }
    std::cerr << "  effect latency estimate\n";
    if (!stressAudioEngineEffectLatencyEstimate())
    {
        std::cerr << "Audio engine effect latency estimate stress failed\n";
        return 1;
    }
    std::cerr << "  transport command coalescing\n";
    if (!stressAudioEngineTransportCommandCoalescing())
    {
        std::cerr << "Audio engine transport command coalescing stress failed\n";
        return 1;
    }
    std::cerr << "  device snapshot\n";
    if (!stressAudioEngineDeviceSnapshot())
    {
        std::cerr << "Audio engine device snapshot stress failed\n";
        return 1;
    }
    std::cerr << "  input recording capture\n";
    if (!stressAudioEngineInputRecordingCapture())
    {
        std::cerr << "Audio engine input recording capture stress failed\n";
        return 1;
    }
    std::cerr << "  input monitoring\n";
    if (!stressAudioEngineInputMonitoring())
    {
        std::cerr << "Audio engine input monitoring stress failed\n";
        return 1;
    }
    std::cerr << "  plugin latency compensation\n";
    if (!stressAudioEnginePluginLatencyCompensation())
    {
        std::cerr << "Audio engine plugin latency compensation stress failed\n";
        return 1;
    }
    std::cerr << "  compressor effect\n";
    if (!stressAudioEngineCompressorEffect())
    {
        std::cerr << "Audio engine compressor effect stress failed\n";
        return 1;
    }
    std::cerr << "  distortion effect\n";
    if (!stressAudioEngineDistortionEffect())
    {
        std::cerr << "Audio engine distortion effect stress failed\n";
        return 1;
    }
    std::cerr << "  chorus effect\n";
    if (!stressAudioEngineChorusEffect())
    {
        std::cerr << "Audio engine chorus effect stress failed\n";
        return 1;
    }
    std::cerr << "  phaser effect\n";
    if (!stressAudioEnginePhaserEffect())
    {
        std::cerr << "Audio engine phaser effect stress failed\n";
        return 1;
    }
    std::cerr << "  flanger effect\n";
    if (!stressAudioEngineFlangerEffect())
    {
        std::cerr << "Audio engine flanger effect stress failed\n";
        return 1;
    }
    std::cerr << "  bitcrush chunk continuity\n";
    if (!stressAudioEngineBitcrushChunkContinuity())
    {
        std::cerr << "Audio engine bitcrush chunk continuity stress failed\n";
        return 1;
    }
    std::cerr << "  transport panic reset\n";
    if (!stressAudioEngineTransportPanicReset())
    {
        std::cerr << "Audio engine transport panic reset stress failed\n";
        return 1;
    }
    std::cerr << "  apply project runtime boundary\n";
    if (!stressAudioEngineApplyProjectRuntimeBoundary())
    {
        std::cerr << "Audio engine apply-project runtime boundary stress failed\n";
        return 1;
    }
    std::cerr << "  effect graph transition\n";
    if (!stressAudioEngineEffectGraphTransition())
    {
        std::cerr << "Audio engine effect graph transition stress failed\n";
        return 1;
    }
    std::cerr << "  transport command burst\n";
    if (!stressAudioEngineTransportCommandBurst())
    {
        std::cerr << "Audio engine transport command burst stress failed\n";
        return 1;
    }
    std::cerr << "  queued loop clamp transport\n";
    if (!stressAudioEngineQueuedLoopClampTransport())
    {
        std::cerr << "Audio engine queued loop clamp transport stress failed\n";
        return 1;
    }
    std::cerr << "  audio clip playback\n";
    if (!stressAudioEngineAudioClipPlayback())
    {
        std::cerr << "Audio engine audio clip playback stress failed\n";
        return 1;
    }
    std::cerr << "  tail effects\n";
    if (!stressAudioEngineTailEffects())
    {
        std::cerr << "Audio engine delay/reverb stress failed\n";
        return 1;
    }
    std::cerr << "  denormal tail protection\n";
    if (!stressAudioEngineDenormalTailProtection())
    {
        std::cerr << "Audio engine denormal tail protection stress failed\n";
        return 1;
    }
    std::cerr << "  route automation\n";
    if (!stressAudioEngineRouteAutomation())
    {
        std::cerr << "Audio engine route automation stress failed\n";
        return 1;
    }
    std::cerr << "  automation block-size stability\n";
    if (!stressAudioEngineAutomationBlockSizeStability())
    {
        std::cerr << "Audio engine automation block-size stability stress failed\n";
        return 1;
    }
    std::cerr << "  sample instrument routing\n";
    if (!stressAudioEngineSampleInstrumentRouting())
    {
        std::cerr << "Audio engine sample instrument routing stress failed\n";
        return 1;
    }
    std::cerr << "  sample zones and release\n";
    if (!stressAudioEngineSampleZonesAndRelease())
    {
        std::cerr << "Audio engine sample zone/release stress failed\n";
        return 1;
    }
    std::cerr << "  sample zone direct path loading\n";
    if (!stressAudioEngineSampleZoneDirectPathLoading())
    {
        std::cerr << "Audio engine sample zone direct-path loading stress failed\n";
        return 1;
    }
    std::cerr << "  sample zone start/end slicing\n";
    if (!stressAudioEngineSampleZoneStartEndSlicing())
    {
        std::cerr << "Audio engine sample zone start/end slicing stress failed\n";
        return 1;
    }
    std::cerr << "  sample zone length selection\n";
    if (!stressAudioEngineSampleZoneLengthSelection())
    {
        std::cerr << "Audio engine sample zone length selection stress failed\n";
        return 1;
    }
    std::cerr << "  sample zone multi-variable selection\n";
    if (!stressAudioEngineSampleZoneMultiVariableSelection())
    {
        std::cerr << "Audio engine sample zone multi-variable selection stress failed\n";
        return 1;
    }
    std::cerr << "engine: done\n";

    std::cerr << "sample/export: start\n";
    if (!stressAudioEngineSampleLoopAndOneShot())
    {
        std::cerr << "Audio engine sample loop/one-shot stress failed\n";
        return 1;
    }
    if (!stressAudioEngineSampleChokeGroups())
    {
        std::cerr << "Audio engine sample choke group stress failed\n";
        return 1;
    }
    if (!stressAudioEngineOfflineExport())
    {
        std::cerr << "Audio engine offline export stress failed\n";
        return 1;
    }
    if (!stressAudioEngineOfflineExportProgressAndCancel())
    {
        std::cerr << "Audio engine offline export progress/cancel stress failed\n";
        return 1;
    }
    if (!stressAudioEngineOfflineRangeExport())
    {
        std::cerr << "Audio engine offline range export stress failed\n";
        return 1;
    }
    if (!stressAudioEngineReviewLoopRangeExportParity())
    {
        std::cerr << "Audio engine review-loop range export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineLiveExportParity())
    {
        std::cerr << "Audio engine live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineInstrumentEffectLiveExportParity())
    {
        std::cerr << "Audio engine instrument effect live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineInstrumentEffectExportTail())
    {
        std::cerr << "Audio engine instrument effect export tail stress failed\n";
        return 1;
    }
    if (!stressAudioEngineEffectAutomationLiveExportParity())
    {
        std::cerr << "Audio engine effect automation live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineSampleRateMatrix())
    {
        std::cerr << "Audio engine sample-rate matrix stress failed\n";
        return 1;
    }
    if (!stressAudioEngineSampleLiveExportParity())
    {
        std::cerr << "Audio engine sample live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAetherSampleSlotLiveExportParity())
    {
        std::cerr << "Audio engine Aether sample slot live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineMixedLiveExportParity())
    {
        std::cerr << "Audio engine mixed live/export parity stress failed\n";
        return 1;
    }
    std::cerr << "sample/export: done\n";

    std::cerr << "sfz subset: start\n";
    if (!stressSfzSubsetImporter())
    {
        std::cerr << "SFZ subset importer stress failed\n";
        return 1;
    }
    if (!stressSfzSampleResolver())
    {
        std::cerr << "SFZ sample resolver stress failed\n";
        return 1;
    }
    if (!stressSfzSampleDecoder())
    {
        std::cerr << "SFZ sample decoder stress failed\n";
        return 1;
    }
    if (!stressManagedSfzAssetImport())
    {
        std::cerr << "Managed SFZ asset import stress failed\n";
        return 1;
    }
    if (!stressSfzSourceSlot())
    {
        std::cerr << "SFZ source slot stress failed\n";
        return 1;
    }
    std::cerr << "sfz subset: done\n";

    std::cerr << "decent sampler: start\n";
    if (!stressDecentSamplerFixtureImportAndPlayback())
    {
        std::cerr << "Decent Sampler fixture import/playback stress failed\n";
        return 1;
    }
    if (!stressDecentSamplerSyntheticMetadata())
    {
        std::cerr << "Decent Sampler synthetic metadata stress failed\n";
        return 1;
    }
    if (!stressDecentSamplerLorenzoUiMetadata())
    {
        std::cerr << "Decent Sampler Lorenzo UI metadata stress failed\n";
        return 1;
    }
    if (!stressDecentSamplerLorenzoImportAndPlayback())
    {
        std::cerr << "Decent Sampler Lorenzo import/playback stress failed\n";
        return 1;
    }
    if (!stressDecentSamplerHovefluteImportAndPlayback())
    {
        std::cerr << "Decent Sampler Hoveflute import/playback stress failed\n";
        return 1;
    }
    std::cerr << "decent sampler: done\n";

    std::cerr << "audio clips/master/routing: start\n";
    if (!stressAudioEngineAudioClipOfflineExport())
    {
        std::cerr << "Audio engine audio clip offline export stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAudioClipFadeEnvelope())
    {
        std::cerr << "Audio engine audio clip fade envelope stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAudioClipOverlongFadeNormalization())
    {
        std::cerr << "Audio engine audio clip overlong fade normalization stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAudioClipFadeLiveExportParity())
    {
        std::cerr << "Audio engine audio clip fade live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAudioClipCrossfadeLiveExportParity())
    {
        std::cerr << "Audio engine audio clip crossfade live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAudioClipTrimLiveExportParity())
    {
        std::cerr << "Audio engine audio clip trim live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineMasterLimiter())
    {
        std::cerr << "Audio engine master limiter stress failed\n";
        return 1;
    }
    if (!stressAudioEngineMasterChainCompressor())
    {
        std::cerr << "Audio engine master chain compressor stress failed\n";
        return 1;
    }
    if (!stressAudioEngineMasterChainBlockContinuity())
    {
        std::cerr << "Audio engine master chain block continuity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineSendReturnBus())
    {
        std::cerr << "Audio engine send/return bus stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAetherSourceSendBuses())
    {
        std::cerr << "Audio engine Aether source-send bus stress failed\n";
        return 1;
    }
    if (!stressAudioEngineGroupRouting())
    {
        std::cerr << "Audio engine group routing stress failed\n";
        return 1;
    }
    if (!stressAudioEngineTrackStemExport())
    {
        std::cerr << "Audio engine track stem export stress failed\n";
        return 1;
    }
    if (!stressTrackBouncePlanner())
    {
        std::cerr << "Track bounce planner stress failed\n";
        return 1;
    }
    std::cerr << "audio clips/master/routing: done\n";

    std::cerr << "churn/dense: start\n";
    if (!stressAudioEngineProjectApplyChurn())
    {
        std::cerr << "Audio engine project apply churn stress failed\n";
        return 1;
    }
    if (!stressAudioEngineDurableTelemetry())
    {
        std::cerr << "Audio engine durable telemetry stress failed\n";
        return 1;
    }
    if (!stressAudioEngineQualityModes())
    {
        std::cerr << "Audio engine quality modes stress failed\n";
        return 1;
    }
    if (!stressAudioCallbackAllocationFreedom())
    {
        std::cerr << "Audio callback allocation freedom stress failed\n";
        return 1;
    }
    if (!stressAudioEngineDenseAetherRoute())
    {
        std::cerr << "Audio engine dense Aether route stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAetherRuntimeWarp())
    {
        std::cerr << "Audio engine Aether runtime warp stress failed\n";
        return 1;
    }
    if (!stressAudioEngineMaxUnisonAetherPolyphony())
    {
        std::cerr << "Audio engine max-unison Aether polyphony stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAetherVoiceLimit())
    {
        std::cerr << "Audio engine Aether voice-limit stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAetherMonoVoiceLimit())
    {
        std::cerr << "Audio engine Aether mono voice-limit stress failed\n";
        return 1;
    }
    if (!stressAudioEngineNativeMidiExpressionActivity())
    {
        std::cerr << "Audio engine native MIDI expression activity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineDenseAetherLiveExportParity())
    {
        std::cerr << "Audio engine dense Aether live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAetherDeterministicNullExport())
    {
        std::cerr << "Audio engine Aether deterministic null export stress failed\n";
        return 1;
    }
    if (!stressAudioEngineMaxUnisonAetherDeterministicNullExport())
    {
        std::cerr << "Audio engine max-unison Aether deterministic null export stress failed\n";
        return 1;
    }
    if (!stressAudioEngineRuntimeWarpAetherDeterministicNullExport())
    {
        std::cerr << "Audio engine runtime-warp Aether deterministic null export stress failed\n";
        return 1;
    }
    if (!stressAudioEngineMonoLegatoAetherDeterministicNullExport())
    {
        std::cerr << "Audio engine mono-legato Aether deterministic null export stress failed\n";
        return 1;
    }
    if (!stressAudioEngineRoutedAetherDeterministicNullExport())
    {
        std::cerr << "Audio engine routed Aether deterministic null export stress failed\n";
        return 1;
    }
    if (!stressAudioEngineFxHeavyAetherDeterministicNullExport())
    {
        std::cerr << "Audio engine FX-heavy Aether deterministic null export stress failed\n";
        return 1;
    }
    if (!stressAudioEngineVariableBlockSizes())
    {
        std::cerr << "Audio engine variable block size stress failed\n";
        return 1;
    }
    std::cerr << "churn/dense: done\n";

    std::cout << "Backend stress passed\n";
    return 0;
}

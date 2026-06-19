#include "InstrumentVoice.h"

#include <cmath>
#include <atomic>
#include <map>
#include <mutex>
#include <utility>

namespace beat
{
    namespace
    {
        thread_local InstrumentVoice::NoteAutomationContext* pendingNoteAutomationContexts = nullptr;
        thread_local int pendingNoteAutomationContextCount = 0;
        std::atomic<int64_t> wavetableCacheHits { 0 };
        std::atomic<int64_t> wavetableCacheMisses { 0 };
        std::atomic<int> wavetableCacheSize { 0 };
        std::atomic<int64_t> renderVoiceBlocks { 0 };
        std::atomic<int64_t> renderVoiceSamples { 0 };
        std::atomic<int64_t> renderOscillatorSamples { 0 };
        std::atomic<int64_t> renderWavetableVoiceSamples { 0 };
        std::atomic<int64_t> renderAetherOscASamples { 0 };
        std::atomic<int64_t> renderAetherOscBSamples { 0 };
        std::atomic<int64_t> renderAetherSubSamples { 0 };
        std::atomic<int64_t> renderAetherNoiseSamples { 0 };
        std::atomic<int64_t> renderFilterSamples { 0 };
        std::atomic<int64_t> renderFilterDriveSamples { 0 };
        std::atomic<int64_t> renderFilterCoefficientUpdates { 0 };
        std::atomic<int64_t> renderModulationSamples { 0 };
        std::atomic<int64_t> renderRealtimeRampSamples { 0 };
        std::atomic<int64_t> renderOscillatorRateCalculations { 0 };
        std::atomic<int64_t> renderWavetableFrequencyUpdates { 0 };
        std::atomic<int64_t> renderWavetablePositionUpdates { 0 };
        constexpr std::pair<float, float> centerPanGains { 0.70710678f, 0.70710678f };

        float clamp01(float v)
        {
            return juce::jlimit(0.0f, 1.0f, v);
        }

        float polyBlep(double phase, double phaseDelta) noexcept
        {
            const auto dt = juce::jlimit(1.0e-9, 0.5, std::abs(phaseDelta));
            if (phase < dt)
            {
                const auto t = phase / dt;
                return (float) (t + t - t * t - 1.0);
            }
            if (phase > 1.0 - dt)
            {
                const auto t = (phase - 1.0) / dt;
                return (float) (t * t + t + t + 1.0);
            }
            return 0.0f;
        }

        float oscillatorSample(int waveform, double phase, double phaseDelta)
        {
            const float p = (float) (phase - std::floor(phase));
            switch (waveform)
            {
                case 0:  return std::sin(p * juce::MathConstants<float>::twoPi);
                case 1:
                {
                    auto value = 2.0f * p - 1.0f;
                    value -= polyBlep(p, phaseDelta);
                    return value;
                }
                case 2:
                {
                    auto value = p < 0.5f ? 1.0f : -1.0f;
                    value += polyBlep(p, phaseDelta);
                    auto shifted = p + 0.5f;
                    if (shifted >= 1.0f) shifted -= 1.0f;
                    value -= polyBlep(shifted, phaseDelta);
                    return value;
                }
                case 3:  return 4.f * std::abs(p - 0.5f) - 1.f;
                default: return juce::Random::getSystemRandom().nextFloat() * 2.f - 1.f;
            }
        }

        float nextNoise(juce::uint32& state);

        float lfoValue(int waveform, double phase, float smoothing = 0.0f, bool oneShot = false)
        {
            const float p = oneShot ? juce::jlimit(0.0f, 1.0f, (float) phase) : (float) (phase - std::floor(phase));
            const float sine = std::sin(p * juce::MathConstants<float>::twoPi);
            float shaped;
            switch (waveform)
            {
                case 1: shaped = p < 0.5f ? p * 4.0f - 1.0f : 3.0f - p * 4.0f; break;
                case 2: shaped = p * 2.0f - 1.0f; break;
                case 3: shaped = p < 0.5f ? 1.0f : -1.0f; break;
                case 0:
                default: return sine;
            }
            const float mix = juce::jlimit(0.0f, 1.0f, smoothing);
            return shaped + (sine - shaped) * mix;
        }

        float lfoRouteValue(float raw, bool bipolar) noexcept
        {
            return bipolar ? raw : (raw + 1.0f) * 0.5f;
        }

        double deterministicPhaseJitter(juce::uint32 seed) noexcept
        {
            seed ^= seed >> 16;
            seed *= 0x7feb352du;
            seed ^= seed >> 15;
            seed *= 0x846ca68bu;
            seed ^= seed >> 16;
            return (double) (seed & 0x00ffffffu) / (double) 0x01000000u;
        }

        float envRouteValue(float env, bool bipolar) noexcept
        {
            return bipolar ? env * 2.0f - 1.0f : env;
        }

        bool dynamicTargetActive(const InstrumentVoice::Params::DynamicModTarget& target) noexcept
        {
            return std::abs(target.lfo) > 0.0001f || std::abs(target.lfo2) > 0.0001f || std::abs(target.env) > 0.0001f;
        }

        float dynamicTargetOffset(
            const InstrumentVoice::Params::DynamicModTarget& target,
            float rawLfo,
            float rawLfo2,
            float env,
            float scale) noexcept
        {
            return (lfoRouteValue(rawLfo, target.lfoBipolar) * target.lfo
                + lfoRouteValue(rawLfo2, target.lfo2Bipolar) * target.lfo2
                + envRouteValue(env, target.envBipolar) * target.env) * scale;
        }

        float cutoffHz(float normalized, double sampleRate)
        {
            const float minF = 20.0f;
            const float maxF = juce::jmin(20000.0f, (float) sampleRate * 0.45f);
            return minF * std::pow(maxF / minF, clamp01(normalized));
        }

        juce::dsp::StateVariableTPTFilterType filterTypeForParam(int type) noexcept
        {
            switch (type)
            {
                case 1: return juce::dsp::StateVariableTPTFilterType::bandpass;
                case 2: return juce::dsp::StateVariableTPTFilterType::highpass;
                case 0:
                default: return juce::dsp::StateVariableTPTFilterType::lowpass;
            }
        }

        std::pair<float, float> equalPowerPanGains(float pan) noexcept
        {
            const float normalized = (juce::jlimit(-1.0f, 1.0f, pan) + 1.0f) * 0.5f;
            const float angle = normalized * juce::MathConstants<float>::halfPi;
            return { std::cos(angle), std::sin(angle) };
        }

        float nextNoise(juce::uint32& state)
        {
            state = state * 1664525u + 1013904223u;
            return ((state >> 8) * (1.0f / 8388607.5f)) - 1.0f;
        }

        float denormalSafe(float value) noexcept
        {
            return std::abs(value) < 1.0e-20f ? 0.0f : value;
        }

        double pitchRate(int octave, int semitone, float fineCents) noexcept
        {
            return std::exp2(
                            (double) octave
                                + (double) semitone / 12.0
                                + (double) fineCents / 1200.0);
        }

        float quantizeWavetablePosition(float position) noexcept
        {
            return std::round(clamp01(position) * 4096.0f) / 4096.0f;
        }

        double quantizeWavetableFrequency(double frequencyHz) noexcept
        {
            if (!std::isfinite(frequencyHz))
                return 0.0;

            constexpr double resolutionHz = 0.03125;
            return std::round(juce::jmax(0.0, frequencyHz) / resolutionHz) * resolutionHz;
        }

        BasicWavetableShape basicShapeForBank(int bank) noexcept
        {
            switch (bank)
            {
                case 1: return BasicWavetableShape::Sine;
                case 2: return BasicWavetableShape::Square;
                case 3: return BasicWavetableShape::Triangle;
                case 4: return BasicWavetableShape::Pulse;
                case 0:
                default: return BasicWavetableShape::Saw;
            }
        }

        std::array<WavetableFactory::CustomFrame, 4> factoryCustomFrames(
            const InstrumentVoice::Params::WavetableConfig& config) noexcept
        {
            std::array<WavetableFactory::CustomFrame, 4> frames;
            for (size_t i = 0; i < frames.size(); ++i)
            {
                frames[i] = {
                    juce::jlimit(0.0f, 1.0f, config.customFrames[i].brightness),
                    juce::jlimit(0.0f, 1.0f, config.customFrames[i].even),
                    juce::jlimit(0.0f, 1.0f, config.customFrames[i].fold),
                    juce::jlimit(-1.0f, 1.0f, config.customFrames[i].phase),
                };
            }
            return frames;
        }

        Wavetable createTableForConfig(const InstrumentVoice::Params::WavetableConfig& config)
        {
            const auto warpMode = config.warpMode == 1
                ? WavetableWarpMode::Fold
                : config.warpMode == 2
                    ? WavetableWarpMode::Pinch
                    : WavetableWarpMode::Shape;
            if (config.custom || config.bank == 5)
                return WavetableFactory::createCustom(factoryCustomFrames(config), config.warp, warpMode);

            return WavetableFactory::createBasic(basicShapeForBank(config.bank), config.warp, warpMode);
        }

        juce::String wavetableCacheKey(const InstrumentVoice::Params::WavetableConfig& config)
        {
            juce::String key;
            const bool custom = config.custom || config.bank == 5;
            key << "bank=" << config.bank
                << "|custom=" << (custom ? 1 : 0)
                << "|warp=" << juce::String(juce::jlimit(0.0f, 1.0f, config.warp), 4)
                << "|warpMode=" << juce::jlimit(0, 2, config.warpMode);
            if (custom)
            {
                for (const auto& frame : config.customFrames)
                {
                    key << "|"
                        << juce::String(juce::jlimit(0.0f, 1.0f, frame.brightness), 4) << ","
                        << juce::String(juce::jlimit(0.0f, 1.0f, frame.even), 4) << ","
                        << juce::String(juce::jlimit(0.0f, 1.0f, frame.fold), 4) << ","
                        << juce::String(juce::jlimit(-1.0f, 1.0f, frame.phase), 4);
                }
            }
            return key;
        }

        std::shared_ptr<const Wavetable> sharedTableForConfig(const InstrumentVoice::Params::WavetableConfig& config)
        {
            static std::mutex cacheMutex;
            static std::map<juce::String, std::shared_ptr<const Wavetable>> cache;
            constexpr size_t maxCachedTables = 64;

            const auto key = wavetableCacheKey(config);
            {
                const std::lock_guard<std::mutex> lock(cacheMutex);
                if (auto found = cache.find(key); found != cache.end())
                {
                    wavetableCacheHits.fetch_add(1, std::memory_order_relaxed);
                    wavetableCacheSize.store((int) cache.size(), std::memory_order_relaxed);
                    return found->second;
                }
            }

            wavetableCacheMisses.fetch_add(1, std::memory_order_relaxed);
            auto table = std::make_shared<Wavetable>(createTableForConfig(config));

            const std::lock_guard<std::mutex> lock(cacheMutex);
            if (auto found = cache.find(key); found != cache.end())
            {
                wavetableCacheHits.fetch_add(1, std::memory_order_relaxed);
                wavetableCacheSize.store((int) cache.size(), std::memory_order_relaxed);
                return found->second;
            }

            cache[key] = table;
            while (cache.size() > maxCachedTables)
                cache.erase(cache.begin());
            wavetableCacheSize.store((int) cache.size(), std::memory_order_relaxed);
            return table;
        }
    }

    void InstrumentVoice::setPendingNoteAutomationContexts(NoteAutomationContext* contexts, int count) noexcept
    {
        pendingNoteAutomationContexts = contexts;
        pendingNoteAutomationContextCount = juce::jlimit(0, (int) maxPendingNoteAutomationContexts, count);
    }

    void InstrumentVoice::clearPendingNoteAutomationContexts() noexcept
    {
        pendingNoteAutomationContexts = nullptr;
        pendingNoteAutomationContextCount = 0;
    }

    InstrumentVoice::WavetableCacheStats InstrumentVoice::getWavetableCacheStats() noexcept
    {
        return {
            wavetableCacheHits.load(std::memory_order_relaxed),
            wavetableCacheMisses.load(std::memory_order_relaxed),
            wavetableCacheSize.load(std::memory_order_relaxed),
        };
    }

    InstrumentVoice::RenderWorkStats InstrumentVoice::consumeRenderWorkStats() noexcept
    {
        return {
            renderVoiceBlocks.exchange(0, std::memory_order_relaxed),
            renderVoiceSamples.exchange(0, std::memory_order_relaxed),
            renderOscillatorSamples.exchange(0, std::memory_order_relaxed),
            renderWavetableVoiceSamples.exchange(0, std::memory_order_relaxed),
            renderAetherOscASamples.exchange(0, std::memory_order_relaxed),
            renderAetherOscBSamples.exchange(0, std::memory_order_relaxed),
            renderAetherSubSamples.exchange(0, std::memory_order_relaxed),
            renderAetherNoiseSamples.exchange(0, std::memory_order_relaxed),
            renderFilterSamples.exchange(0, std::memory_order_relaxed),
            renderFilterDriveSamples.exchange(0, std::memory_order_relaxed),
            renderFilterCoefficientUpdates.exchange(0, std::memory_order_relaxed),
            renderModulationSamples.exchange(0, std::memory_order_relaxed),
            renderRealtimeRampSamples.exchange(0, std::memory_order_relaxed),
            renderOscillatorRateCalculations.exchange(0, std::memory_order_relaxed),
            renderWavetableFrequencyUpdates.exchange(0, std::memory_order_relaxed),
            renderWavetablePositionUpdates.exchange(0, std::memory_order_relaxed),
        };
    }

    void InstrumentVoice::prepare(double sr, int blockSize)
    {
        sampleRate = sr;
        for (auto& osc : wavetableOscillators)
            osc.prepare(sampleRate);
        for (auto& osc : aetherOscillatorsA)
            osc.prepare(sampleRate);
        for (auto& osc : aetherOscillatorsB)
            osc.prepare(sampleRate);
        adsr.setSampleRate(sr);
        filterLeft.prepare({ sr, (juce::uint32) blockSize, 1u });
        filterRight.prepare({ sr, (juce::uint32) blockSize, 1u });
        filterLeft.setType(filterTypeForParam(params.filterType));
        filterRight.setType(filterTypeForParam(params.filterType));
    }

    void InstrumentVoice::setParams(const Params& p)
    {
        baseParams = p;
        params = p;
        params.wavetable.bank = params.wavetableBank;
        params.wavetable.custom = params.wavetableBank == 5;
        params.wavetable.position = params.wavetablePosition;
        params.wavetable.warp = params.wavetableWarp;
        params.wavetable.warpMode = params.wavetableWarpMode;
        params.wavetable.unison = params.wavetableUnison;
        params.wavetable.detuneCents = params.wavetableDetuneCents;
        params.wavetable.blend = params.wavetableBlend;
        if (legacyWavetableNeedsSetup())
        {
            activeWavetableUnison = juce::jlimit(1, 8, params.wavetable.unison);
            wavetableTable = sharedTableForConfig(params.wavetable);
            configureWavetableOscillatorBank(wavetableOscillators, wavetableTable.get(), params.wavetable, baseFrequencyHz);
            invalidateWavetableBankCache(wavetableUnisonPlan);
        }
        else
        {
            activeWavetableUnison = 1;
            wavetableTable.reset();
            clearWavetableOscillatorBank(wavetableOscillators, wavetableUnisonPlan);
        }

        if (aetherOscillatorNeedsWavetable(params.aetherOscA))
        {
            aetherTableA = sharedTableForConfig(params.aetherOscA.wavetable);
            configureWavetableOscillatorBank(aetherOscillatorsA, aetherTableA.get(), params.aetherOscA.wavetable, baseFrequencyHz);
        }
        else
        {
            aetherTableA.reset();
            clearWavetableOscillatorBank(aetherOscillatorsA, aetherUnisonPlanA);
        }

        if (aetherOscillatorNeedsWavetable(params.aetherOscB))
        {
            aetherTableB = sharedTableForConfig(params.aetherOscB.wavetable);
            configureWavetableOscillatorBank(aetherOscillatorsB, aetherTableB.get(), params.aetherOscB.wavetable, baseFrequencyHz);
        }
        else
        {
            aetherTableB.reset();
            clearWavetableOscillatorBank(aetherOscillatorsB, aetherUnisonPlanB);
        }
        adsrParams.attack  = juce::jmax(0.001f, p.attackMs  * 0.001f);
        adsrParams.decay   = juce::jmax(0.001f, p.decayMs   * 0.001f);
        adsrParams.sustain = juce::jlimit(0.0f, 1.0f, p.sustain);
        adsrParams.release = juce::jmax(0.001f, p.releaseMs * 0.001f);
        adsr.setParameters(adsrParams);

        filterLeft.setType(filterTypeForParam(p.filterType));
        filterRight.setType(filterTypeForParam(p.filterType));
        filterLeft.setCutoffFrequency(cutoffHz(p.cutoff01, sampleRate));
        filterRight.setCutoffFrequency(cutoffHz(p.cutoff01, sampleRate));
        cachedFilterHz = cutoffHz(p.cutoff01, sampleRate);
        cachedFilterResonance = 0.5f + p.resonance01 * 4.0f;
        filterLeft.setResonance(cachedFilterResonance);
        filterRight.setResonance(cachedFilterResonance);
        refreshCachedPanGains();
        refreshCachedPitchRates();
        refreshCachedDynamicModulationFlags();
        resetRealtimeRampsFromParams();
    }

    void InstrumentVoice::RealtimeRamp::reset(float value) noexcept
    {
        current = value;
        target = value;
        step = 0.0f;
        remaining = 0;
    }

    void InstrumentVoice::RealtimeRamp::setTarget(float value, int rampSamples) noexcept
    {
        target = value;
        remaining = juce::jmax(0, rampSamples);
        if (remaining == 0)
        {
            reset(value);
            return;
        }
        step = (target - current) / (float) remaining;
    }

    float InstrumentVoice::RealtimeRamp::next() noexcept
    {
        if (remaining <= 0)
            return current;
        current += step;
        --remaining;
        if (remaining == 0)
            current = target;
        return current;
    }

    namespace
    {
        int realtimeParamIndexForId(std::string_view parameterId) noexcept
        {
            if (parameterId == "filter.cutoff") return 0;
            if (parameterId == "filter.resonance") return 1;
            if (parameterId == "filter.drive") return 2;
            if (parameterId == "amp.level") return 3;
            if (parameterId == "amp.pan") return 4;
            if (parameterId == "osc.a.position") return 5;
            if (parameterId == "osc.b.position") return 6;
            if (parameterId == "osc.a.fine") return 7;
            if (parameterId == "osc.b.fine") return 8;
            if (parameterId == "osc.a.level") return 9;
            if (parameterId == "osc.b.level") return 10;
            if (parameterId == "osc.a.pan") return 11;
            if (parameterId == "osc.b.pan") return 12;
            if (parameterId == "unison.detune") return 13;
            if (parameterId == "unison.spread") return 14;
            if (parameterId == "lfo.1.rate") return 15;
            if (parameterId == "lfo.1.depth") return 16;
            return -1;
        }
    }

    void InstrumentVoice::resetRealtimeRampsFromParams() noexcept
    {
        realtimeRamps[(size_t) RealtimeParam::FilterCutoff].reset(params.cutoff01);
        realtimeRamps[(size_t) RealtimeParam::FilterResonance].reset(params.resonance01);
        realtimeRamps[(size_t) RealtimeParam::FilterDrive].reset(params.drive01);
        realtimeRamps[(size_t) RealtimeParam::AmpLevel].reset(params.ampLevel);
        realtimeRamps[(size_t) RealtimeParam::AmpPan].reset(params.ampPan);
        realtimeRamps[(size_t) RealtimeParam::OscAPosition].reset(params.aetherOscA.wavetable.position);
        realtimeRamps[(size_t) RealtimeParam::OscBPosition].reset(params.aetherOscB.wavetable.position);
        realtimeRamps[(size_t) RealtimeParam::OscAFine].reset(params.aetherOscA.fineCents);
        realtimeRamps[(size_t) RealtimeParam::OscBFine].reset(params.aetherOscB.fineCents);
        realtimeRamps[(size_t) RealtimeParam::OscALevel].reset(params.aetherOscA.level);
        realtimeRamps[(size_t) RealtimeParam::OscBLevel].reset(params.aetherOscB.level);
        realtimeRamps[(size_t) RealtimeParam::OscAPan].reset(params.aetherOscA.pan);
        realtimeRamps[(size_t) RealtimeParam::OscBPan].reset(params.aetherOscB.pan);
        realtimeRamps[(size_t) RealtimeParam::UnisonDetune].reset(params.wavetableDetuneCents);
        realtimeRamps[(size_t) RealtimeParam::UnisonSpread].reset(params.wavetableBlend);
        realtimeRamps[(size_t) RealtimeParam::LfoRate].reset(params.lfoRateHz);
        realtimeRamps[(size_t) RealtimeParam::LfoDepth].reset(params.lfoDepth);
        activeRealtimeRampCount = 0;
    }

    void InstrumentVoice::setRealtimeRamp(RealtimeParam param, float value, int rampSamples) noexcept
    {
        auto& ramp = realtimeRamps[(size_t) param];
        ramp.setTarget(value, rampSamples);
        if (rampSamples <= 0)
        {
            deactivateRealtimeRamp(param);
            applyRealtimeValue(param, ramp.current);
            return;
        }
        activateRealtimeRamp(param);
    }

    void InstrumentVoice::activateRealtimeRamp(RealtimeParam param) noexcept
    {
        const auto index = (size_t) param;
        for (int i = 0; i < activeRealtimeRampCount; ++i)
            if (activeRealtimeRampIndices[(size_t) i] == index)
                return;

        if (activeRealtimeRampCount >= (int) activeRealtimeRampIndices.size())
            return;

        activeRealtimeRampIndices[(size_t) activeRealtimeRampCount] = index;
        ++activeRealtimeRampCount;
    }

    void InstrumentVoice::deactivateRealtimeRamp(RealtimeParam param) noexcept
    {
        const auto index = (size_t) param;
        for (int i = 0; i < activeRealtimeRampCount; ++i)
        {
            if (activeRealtimeRampIndices[(size_t) i] != index)
                continue;

            --activeRealtimeRampCount;
            if (i != activeRealtimeRampCount)
                activeRealtimeRampIndices[(size_t) i] = activeRealtimeRampIndices[(size_t) activeRealtimeRampCount];
            return;
        }
    }

    bool InstrumentVoice::applyRealtimeParameter(std::string_view parameterId, float value, int rampSamples) noexcept
    {
        return setRealtimeParameterValue(parameterId, value, rampSamples, true);
    }

    bool InstrumentVoice::setRealtimeParameterValue(std::string_view parameterId, float value, int rampSamples, bool updateBaseline) noexcept
    {
        const auto normalized = clamp01(value);
        const int index = realtimeParamIndexForId(parameterId);
        if (index < 0)
            return false;

        const auto param = (RealtimeParam) index;
        if (!isVoiceActive())
            rampSamples = 0;
        if (updateBaseline)
            applyParamToParams(baseParams, param, value);
        switch (param)
        {
            case RealtimeParam::FilterCutoff:
            case RealtimeParam::FilterResonance:
            case RealtimeParam::FilterDrive:
            case RealtimeParam::AmpLevel:
            case RealtimeParam::OscAPosition:
            case RealtimeParam::OscBPosition:
            case RealtimeParam::OscALevel:
            case RealtimeParam::OscBLevel:
            case RealtimeParam::UnisonSpread:
            case RealtimeParam::LfoDepth:
                setRealtimeRamp(param, normalized, rampSamples);
                return true;
            case RealtimeParam::AmpPan:
            case RealtimeParam::OscAPan:
            case RealtimeParam::OscBPan:
                setRealtimeRamp(param, juce::jlimit(-1.0f, 1.0f, value), rampSamples);
                return true;
            case RealtimeParam::OscAFine:
            case RealtimeParam::OscBFine:
                setRealtimeRamp(param, juce::jlimit(-100.0f, 100.0f, value), rampSamples);
                return true;
            case RealtimeParam::UnisonDetune:
                setRealtimeRamp(param, juce::jlimit(0.0f, 100.0f, value), rampSamples);
                return true;
            case RealtimeParam::LfoRate:
                setRealtimeRamp(param, juce::jlimit(0.01f, 50.0f, value), rampSamples);
                return true;
            case RealtimeParam::Count:
                break;
        }
        return false;
    }

    void InstrumentVoice::applyParamToParams(Params& target, RealtimeParam param, float value) noexcept
    {
        switch (param)
        {
            case RealtimeParam::FilterCutoff:
                target.cutoff01 = clamp01(value);
                break;
            case RealtimeParam::FilterResonance:
                target.resonance01 = clamp01(value);
                break;
            case RealtimeParam::FilterDrive:
                target.drive01 = clamp01(value);
                break;
            case RealtimeParam::AmpLevel:
                target.ampLevel = clamp01(value);
                break;
            case RealtimeParam::AmpPan:
                target.ampPan = juce::jlimit(-1.0f, 1.0f, value);
                break;
            case RealtimeParam::OscAPosition:
                target.wavetablePosition = clamp01(value);
                target.wavetable.position = target.wavetablePosition;
                target.aetherOscA.wavetable.position = target.wavetablePosition;
                break;
            case RealtimeParam::OscBPosition:
                target.aetherOscB.wavetable.position = clamp01(value);
                break;
            case RealtimeParam::OscAFine:
                target.aetherOscA.fineCents = juce::jlimit(-100.0f, 100.0f, value);
                break;
            case RealtimeParam::OscBFine:
                target.aetherOscB.fineCents = juce::jlimit(-100.0f, 100.0f, value);
                break;
            case RealtimeParam::OscALevel:
                target.aetherOscA.level = clamp01(value);
                break;
            case RealtimeParam::OscBLevel:
                target.aetherOscB.level = clamp01(value);
                break;
            case RealtimeParam::OscAPan:
                target.aetherOscA.pan = juce::jlimit(-1.0f, 1.0f, value);
                break;
            case RealtimeParam::OscBPan:
                target.aetherOscB.pan = juce::jlimit(-1.0f, 1.0f, value);
                break;
            case RealtimeParam::UnisonDetune:
                target.wavetableDetuneCents = juce::jlimit(0.0f, 100.0f, value);
                target.wavetable.detuneCents = target.wavetableDetuneCents;
                target.aetherOscA.wavetable.detuneCents = target.wavetableDetuneCents;
                target.aetherOscB.wavetable.detuneCents = target.wavetableDetuneCents;
                break;
            case RealtimeParam::UnisonSpread:
                target.wavetableBlend = clamp01(value);
                target.wavetable.blend = target.wavetableBlend;
                target.aetherOscA.wavetable.blend = target.wavetableBlend;
                target.aetherOscB.wavetable.blend = target.wavetableBlend;
                break;
            case RealtimeParam::LfoRate:
                target.lfoRateHz = juce::jlimit(0.01f, 50.0f, value);
                break;
            case RealtimeParam::LfoDepth:
                target.lfoDepth = clamp01(value);
                break;
            case RealtimeParam::Count:
                break;
        }
    }

    void InstrumentVoice::applyRealtimeValue(RealtimeParam param, float value) noexcept
    {
        applyParamToParams(params, param, value);
        switch (param)
        {
            case RealtimeParam::FilterCutoff:
            {
                const float nextFilterHz = cutoffHz(params.cutoff01, sampleRate);
                if (std::abs(nextFilterHz - cachedFilterHz) > 0.5f)
                {
                    filterLeft.setCutoffFrequency(nextFilterHz);
                    filterRight.setCutoffFrequency(nextFilterHz);
                    cachedFilterHz = nextFilterHz;
                }
                break;
            }
            case RealtimeParam::FilterResonance:
            {
                const float nextResonance = 0.5f + params.resonance01 * 4.0f;
                if (std::abs(nextResonance - cachedFilterResonance) > 0.001f)
                {
                    filterLeft.setResonance(nextResonance);
                    filterRight.setResonance(nextResonance);
                    cachedFilterResonance = nextResonance;
                }
                break;
            }
            case RealtimeParam::FilterDrive:
            case RealtimeParam::AmpLevel:
            case RealtimeParam::OscAPosition:
            case RealtimeParam::OscBPosition:
            case RealtimeParam::OscAFine:
            case RealtimeParam::OscBFine:
                refreshCachedPitchRates();
                break;
            case RealtimeParam::OscALevel:
            case RealtimeParam::OscBLevel:
            case RealtimeParam::UnisonDetune:
            case RealtimeParam::UnisonSpread:
            case RealtimeParam::LfoRate:
            case RealtimeParam::LfoDepth:
                break;
            case RealtimeParam::AmpPan:
            case RealtimeParam::OscAPan:
            case RealtimeParam::OscBPan:
                refreshCachedPanGains();
                break;
            case RealtimeParam::Count:
                break;
        }
    }

    void InstrumentVoice::advanceRealtimeRamps() noexcept
    {
        int writeIndex = 0;
        for (int readIndex = 0; readIndex < activeRealtimeRampCount; ++readIndex)
        {
            const auto paramIndex = activeRealtimeRampIndices[(size_t) readIndex];
            auto& ramp = realtimeRamps[paramIndex];
            if (!ramp.active())
                continue;
            applyRealtimeValue((RealtimeParam) paramIndex, ramp.next());
            if (ramp.active())
            {
                activeRealtimeRampIndices[(size_t) writeIndex] = paramIndex;
                ++writeIndex;
            }
        }
        activeRealtimeRampCount = writeIndex;
    }

    void InstrumentVoice::loadPendingNoteAutomation(int midiNoteNumber) noexcept
    {
        voiceAutomationEventCount = 0;
        voicePitchEventCount = 0;
        nextVoiceAutomationEvent = 0;
        nextVoicePitchEvent = 0;
        voiceSamplePosition = 0;

        if (pendingNoteAutomationContexts == nullptr || pendingNoteAutomationContextCount <= 0)
            return;

        for (int i = 0; i < pendingNoteAutomationContextCount; ++i)
        {
            auto& context = pendingNoteAutomationContexts[i];
            if (context.midiNoteNumber != midiNoteNumber)
                continue;

            voiceAutomationEventCount = juce::jlimit(0, (int) maxNoteAutomationEvents, context.eventCount);
            for (int eventIndex = 0; eventIndex < voiceAutomationEventCount; ++eventIndex)
                voiceAutomationEvents[(size_t) eventIndex] = context.events[(size_t) eventIndex];
            voicePitchEventCount = juce::jlimit(0, (int) maxNoteAutomationEvents, context.pitchEventCount);
            for (int eventIndex = 0; eventIndex < voicePitchEventCount; ++eventIndex)
                voicePitchEvents[(size_t) eventIndex] = context.pitchEvents[(size_t) eventIndex];

            context.midiNoteNumber = -1;
            context.eventCount = 0;
            context.pitchEventCount = 0;
            return;
        }
    }

    void InstrumentVoice::advanceVoiceAutomation() noexcept
    {
        while (nextVoicePitchEvent < voicePitchEventCount)
        {
            const auto& event = voicePitchEvents[(size_t) nextVoicePitchEvent];
            if (event.sampleOffset > voiceSamplePosition)
                break;
            pitchFrequencyRamp.setTarget(juce::jlimit(1.0f, 24000.0f, event.frequencyHz), event.rampSamples);
            ++nextVoicePitchEvent;
        }

        while (nextVoiceAutomationEvent < voiceAutomationEventCount)
        {
            const auto& event = voiceAutomationEvents[(size_t) nextVoiceAutomationEvent];
            if (event.sampleOffset > voiceSamplePosition)
                break;
            setRealtimeParameterValue(event.parameterIdView(), event.value, event.rampSamples, false);
            ++nextVoiceAutomationEvent;
        }
    }

    void InstrumentVoice::startNote(int midiNoteNumber, float velocity,
                                    juce::SynthesiserSound*, int)
    {
        params = baseParams;
        resetRealtimeRampsFromParams();
        filterLeft.setType(filterTypeForParam(params.filterType));
        filterRight.setType(filterTypeForParam(params.filterType));
        filterLeft.setCutoffFrequency(cutoffHz(params.cutoff01, sampleRate));
        filterRight.setCutoffFrequency(cutoffHz(params.cutoff01, sampleRate));
        cachedFilterHz = cutoffHz(params.cutoff01, sampleRate);
        cachedFilterResonance = 0.5f + params.resonance01 * 4.0f;
        filterLeft.setResonance(cachedFilterResonance);
        filterRight.setResonance(cachedFilterResonance);
        refreshCachedPanGains();
        refreshCachedDynamicModulationFlags();

        level     = velocity;
        phase     = 0.0;
        noiseState = (juce::uint32) (midiNoteNumber * 747796405u + 2891336453u);
        aetherOscAPhaseOffset = juce::jlimit(0.0, 1.0, (double) params.aetherOscA.phase)
            + deterministicPhaseJitter(noiseState ^ 0xa9f14c31u) * juce::jlimit(0.0, 1.0, (double) params.aetherOscA.randomPhase);
        aetherOscBPhaseOffset = juce::jlimit(0.0, 1.0, (double) params.aetherOscB.phase)
            + deterministicPhaseJitter(noiseState ^ 0x6c8e9cf5u) * juce::jlimit(0.0, 1.0, (double) params.aetherOscB.randomPhase);
        if (params.lfoRetrigger)
            lfoPhase = std::fmod(juce::jlimit(0.0, 1.0, (double) params.lfoPhaseOffset)
                + deterministicPhaseJitter(noiseState ^ 0x35a1d7bdu) * juce::jlimit(0.0, 1.0, (double) params.lfoRandomPhase),
                1.0);
        if (params.lfo2Retrigger)
            lfo2Phase = std::fmod(juce::jlimit(0.0, 1.0, (double) params.lfo2PhaseOffset)
                + deterministicPhaseJitter(noiseState ^ 0x91c2ef43u) * juce::jlimit(0.0, 1.0, (double) params.lfo2RandomPhase),
                1.0);
        baseFrequencyHz = juce::MidiMessage::getMidiNoteInHertz(midiNoteNumber);
        phaseDelta = baseFrequencyHz / sampleRate;
        pitchFrequencyRamp.reset((float) baseFrequencyHz);
        previousDriveInput = {};
        driveDownsampleState = {};
        previousRawEnvelope = 0.0f;
        if (legacyWavetableNeedsSetup())
            configureWavetableOscillators(baseFrequencyHz);
        else
            clearWavetableOscillatorBank(wavetableOscillators, wavetableUnisonPlan);
        if (aetherOscillatorNeedsWavetable(params.aetherOscA))
        {
            configureWavetableOscillatorBank(aetherOscillatorsA, aetherTableA.get(), params.aetherOscA.wavetable, baseFrequencyHz);
            for (auto& osc : aetherOscillatorsA)
                osc.setPhase(aetherOscAPhaseOffset);
        }
        else
            clearWavetableOscillatorBank(aetherOscillatorsA, aetherUnisonPlanA);

        if (aetherOscillatorNeedsWavetable(params.aetherOscB))
        {
            configureWavetableOscillatorBank(aetherOscillatorsB, aetherTableB.get(), params.aetherOscB.wavetable, baseFrequencyHz);
            for (auto& osc : aetherOscillatorsB)
                osc.setPhase(aetherOscBPhaseOffset);
        }
        else
            clearWavetableOscillatorBank(aetherOscillatorsB, aetherUnisonPlanB);
        refreshCachedPitchRates();
        loadPendingNoteAutomation(midiNoteNumber);
        adsr.noteOn();
    }

    void InstrumentVoice::stopNote(float, bool allowTailOff)
    {
        if (allowTailOff)
        {
            adsr.noteOff();
        }
        else
        {
            adsr.reset();
            clearCurrentNote();
        }
    }

    void InstrumentVoice::renderNextBlock(juce::AudioBuffer<float>& out,
                                          int startSample, int numSamples)
    {
        juce::ScopedNoDenormals noDenormals;
        if (!adsr.isActive()) return;

        const float pitchMod = juce::jmax(0.0f, params.lfoToPitch);
        const bool useDynamicModulation = params.dynamicModulation.active && cachedAnyDynamicModulationTarget;
        const bool hasPitchMod = !useDynamicModulation && pitchMod > 0.0001f;
        const bool hasPositionMod = !useDynamicModulation && std::abs(params.lfoDepth) > 0.0001f;
        const bool hasDynamicFilterCoefficientMod = useDynamicModulation
            && (cachedFilterCutoffDynamic || cachedFilterResonanceDynamic);
        const bool hasFilterMod = hasDynamicFilterCoefficientMod
            || std::abs(params.lfoToFilter) > 0.0001f
            || std::abs(params.envToFilter) > 0.0001f;
        const bool needsLfoValue = useDynamicModulation || hasPitchMod || hasPositionMod || hasFilterMod;
        const bool needsLfo2Value = useDynamicModulation && params.lfo2Enabled;
        const bool hasAmpPanMod = cachedAmpPanDynamic;
        const double lfoPhaseDelta = juce::jmax(0.01f, params.lfoRateHz) / sampleRate;
        const double lfo2PhaseDelta = juce::jmax(0.01f, params.lfo2RateHz) / sampleRate;
        const bool hasVoiceAutomation = voicePitchEventCount > 0 || voiceAutomationEventCount > 0;
        int64_t modulationSamples = 0;
        int64_t realtimeRampSamples = 0;
        currentBlockOscillatorSamples = 0;
        currentBlockWavetableVoiceSamples = 0;
        currentBlockAetherOscASamples = 0;
        currentBlockAetherOscBSamples = 0;
        currentBlockAetherSubSamples = 0;
        currentBlockAetherNoiseSamples = 0;
        currentBlockOscillatorRateCalculations = 0;
        currentBlockFilterDriveSamples = 0;
        currentBlockFilterCoefficientUpdates = 0;
        currentBlockWavetableFrequencyUpdates = 0;
        currentBlockWavetablePositionUpdates = 0;

        for (int i = 0; i < numSamples; ++i)
        {
            if (hasVoiceAutomation)
            {
                advanceVoiceAutomation();
                ++modulationSamples;
            }
            if (activeRealtimeRampCount > 0)
            {
                realtimeRampSamples += activeRealtimeRampCount;
                advanceRealtimeRamps();
            }
            const float rawLfo = needsLfoValue ? lfoValue(params.lfoWaveform, lfoPhase, params.lfoSmoothing, params.lfoOneShot) : 0.0f;
            const float rawLfo2 = needsLfo2Value ? lfoValue(params.lfo2Waveform, lfo2Phase, params.lfo2Smoothing, params.lfo2OneShot) : 0.0f;
            if (needsLfoValue || useDynamicModulation)
                ++modulationSamples;
            const float positionLfo = hasPositionMod ? lfoRouteValue(rawLfo, params.lfoPositionBipolar) * clamp01(params.lfoDepth) : 0.0f;
            const float pitchLfo = hasPitchMod ? lfoRouteValue(rawLfo, params.lfoPitchBipolar) : 0.0f;
            const float filterLfo = !useDynamicModulation && hasFilterMod ? lfoRouteValue(rawLfo, params.lfoFilterBipolar) : 0.0f;
            const float env = shapedEnvelope(adsr.getNextSample());
            const double currentPitchFrequency = juce::jmax(1.0f, pitchFrequencyRamp.next());
            double currentPhaseDelta = currentPitchFrequency / sampleRate;
            if (hasPitchMod)
                currentPhaseDelta *= std::exp2((pitchLfo * pitchMod) / 12.0);
            if (useDynamicModulation && !params.hasAether)
            {
                const float oscAFineCents = dynamicTargetOffset(params.dynamicModulation.oscAFine, rawLfo, rawLfo2, env, 100.0f);
                currentPhaseDelta *= std::exp2(oscAFineCents / 1200.0f);
            }
            const double currentFrequency = currentPhaseDelta * sampleRate;
            const float dynamicOscAPosition = useDynamicModulation && cachedAetherOscAPositionDynamic
                ? dynamicTargetOffset(params.dynamicModulation.oscAPosition, rawLfo, rawLfo2, env, 1.0f)
                : 0.0f;
            const float dynamicUnisonDetune = useDynamicModulation && cachedUnisonDetuneDynamic
                ? dynamicTargetOffset(params.dynamicModulation.unisonDetune, rawLfo, rawLfo2, env, 100.0f)
                : 0.0f;
            const float dynamicUnisonSpread = useDynamicModulation && cachedUnisonSpreadDynamic
                ? dynamicTargetOffset(params.dynamicModulation.unisonSpread, rawLfo, rawLfo2, env, 1.0f)
                : 0.0f;

            // Oscillator
            StereoSample raw;
            if (params.hasAether)
            {
                raw = renderAetherTableStack(currentFrequency, rawLfo, rawLfo2, env);
            }
            else
            {
                const float mono = params.waveform == 5
                    ? renderWavetableStack(currentFrequency, positionLfo + dynamicOscAPosition, dynamicUnisonDetune, dynamicUnisonSpread)
                    : params.waveform == 4
                        ? nextNoise(noiseState)
                        : oscillatorSample(params.waveform, phase, currentPhaseDelta);
                if (params.waveform != 5)
                    ++currentBlockOscillatorSamples;
                raw = { mono, mono };
            }
            float left = raw.left;
            float right = raw.right;

            // Drive (soft clipping)
            const float drive = clamp01(params.drive01 + (useDynamicModulation && cachedFilterDriveDynamic
                ? dynamicTargetOffset(params.dynamicModulation.filterDrive, rawLfo, rawLfo2, env, 1.0f)
                : 0.0f));
            if (drive > 0.0001f)
            {
                const float driveGain = 1.0f + drive * 6.0f;
                const auto driven = processDriveOversampled({ left, right }, driveGain);
                left = driven.left;
                right = driven.right;
                currentBlockFilterDriveSamples += 4;
            }
            else
            {
                previousDriveInput = { left, right };
                driveDownsampleState = { left, right };
            }

            if (hasFilterMod)
            {
                    const float cutoffMod = useDynamicModulation && cachedFilterCutoffDynamic
                        ? dynamicTargetOffset(params.dynamicModulation.filterCutoff, rawLfo, rawLfo2, env, 0.35f)
                        : filterLfo * params.lfoToFilter * 0.35f + env * params.envToFilter * 0.35f;
                const float nextFilterHz = cutoffHz(params.cutoff01 + cutoffMod, sampleRate);
                if (std::abs(nextFilterHz - cachedFilterHz) > 6.0f)
                {
                    filterLeft.setCutoffFrequency(nextFilterHz);
                    filterRight.setCutoffFrequency(nextFilterHz);
                    cachedFilterHz = nextFilterHz;
                    currentBlockFilterCoefficientUpdates += 2;
                }
                if (useDynamicModulation && cachedFilterResonanceDynamic)
                {
                    const float resonance = clamp01(params.resonance01
                        + dynamicTargetOffset(params.dynamicModulation.filterResonance, rawLfo, rawLfo2, env, 1.0f));
                    const float nextResonance = 0.5f + resonance * 4.0f;
                    if (std::abs(nextResonance - cachedFilterResonance) > 0.001f)
                    {
                        filterLeft.setResonance(nextResonance);
                        filterRight.setResonance(nextResonance);
                        cachedFilterResonance = nextResonance;
                        currentBlockFilterCoefficientUpdates += 2;
                    }
                }
            }
            left = filterLeft.processSample(0, left);
            right = filterRight.processSample(0, right);

            const float ampLevel = clamp01(params.ampLevel + (useDynamicModulation && cachedAmpLevelDynamic
                ? dynamicTargetOffset(params.dynamicModulation.ampLevel, rawLfo, rawLfo2, env, 1.0f)
                : 0.0f));
            const float ampPan = hasAmpPanMod
                ? juce::jlimit(-1.0f, 1.0f, params.ampPan + dynamicTargetOffset(params.dynamicModulation.ampPan, rawLfo, rawLfo2, env, 1.0f))
                : params.ampPan;
            const auto panGains = hasAmpPanMod ? equalPowerPanGains(ampPan) : cachedAmpPanGains;
            const float voiceGain = env * level * 0.4f * ampLevel;
            const auto [leftGain, rightGain] = panGains;

            for (int ch = 0; ch < out.getNumChannels(); ++ch)
            {
                const float sample = ch == 0 ? left * leftGain : ch == 1 ? right * rightGain : (left + right) * 0.5f;
                const float output = sample * voiceGain;
                out.addSample(ch, startSample + i, denormalSafe(output));
            }

            phase += currentPhaseDelta;
            if (phase >= 1.0) phase -= 1.0;
            if (needsLfoValue)
            {
                lfoPhase += lfoPhaseDelta;
                if (params.lfoOneShot)
                    lfoPhase = juce::jmin(1.0, lfoPhase);
                else if (lfoPhase >= 1.0)
                    lfoPhase -= 1.0;
                if (needsLfo2Value)
                {
                    lfo2Phase += lfo2PhaseDelta;
                    if (params.lfo2OneShot)
                        lfo2Phase = juce::jmin(1.0, lfo2Phase);
                    else if (lfo2Phase >= 1.0)
                        lfo2Phase -= 1.0;
                }
            }
            ++voiceSamplePosition;
        }

        if (!adsr.isActive())
            clearCurrentNote();

        renderVoiceBlocks.fetch_add(1, std::memory_order_relaxed);
        renderVoiceSamples.fetch_add(numSamples, std::memory_order_relaxed);
        renderOscillatorSamples.fetch_add(currentBlockOscillatorSamples, std::memory_order_relaxed);
        renderWavetableVoiceSamples.fetch_add(currentBlockWavetableVoiceSamples, std::memory_order_relaxed);
        renderAetherOscASamples.fetch_add(currentBlockAetherOscASamples, std::memory_order_relaxed);
        renderAetherOscBSamples.fetch_add(currentBlockAetherOscBSamples, std::memory_order_relaxed);
        renderAetherSubSamples.fetch_add(currentBlockAetherSubSamples, std::memory_order_relaxed);
        renderAetherNoiseSamples.fetch_add(currentBlockAetherNoiseSamples, std::memory_order_relaxed);
        renderFilterSamples.fetch_add((int64_t) numSamples * 2, std::memory_order_relaxed);
        renderFilterDriveSamples.fetch_add(currentBlockFilterDriveSamples, std::memory_order_relaxed);
        renderFilterCoefficientUpdates.fetch_add(currentBlockFilterCoefficientUpdates, std::memory_order_relaxed);
        renderModulationSamples.fetch_add(modulationSamples, std::memory_order_relaxed);
        renderRealtimeRampSamples.fetch_add(realtimeRampSamples, std::memory_order_relaxed);
        renderOscillatorRateCalculations.fetch_add(currentBlockOscillatorRateCalculations, std::memory_order_relaxed);
        renderWavetableFrequencyUpdates.fetch_add(currentBlockWavetableFrequencyUpdates, std::memory_order_relaxed);
        renderWavetablePositionUpdates.fetch_add(currentBlockWavetablePositionUpdates, std::memory_order_relaxed);
    }

    InstrumentVoice::StereoSample InstrumentVoice::processDriveOversampled(StereoSample sample, float driveGain) noexcept
    {
        constexpr float downsampleAlpha = 0.72f;

        const auto processChannel = [driveGain] (float input)
        {
            return std::tanh(input * driveGain);
        };

        const float leftMidpoint = 0.5f * (previousDriveInput.left + sample.left);
        const float rightMidpoint = 0.5f * (previousDriveInput.right + sample.right);
        const float leftDownsampled = 0.5f * (processChannel(leftMidpoint) + processChannel(sample.left));
        const float rightDownsampled = 0.5f * (processChannel(rightMidpoint) + processChannel(sample.right));

        driveDownsampleState.left = denormalSafe(driveDownsampleState.left
            + downsampleAlpha * (leftDownsampled - driveDownsampleState.left));
        driveDownsampleState.right = denormalSafe(driveDownsampleState.right
            + downsampleAlpha * (rightDownsampled - driveDownsampleState.right));
        previousDriveInput = sample;
        return driveDownsampleState;
    }

    float InstrumentVoice::shapedEnvelope(float rawEnvelope) noexcept
    {
        const float raw = clamp01(rawEnvelope);
        const float sustain = clamp01(params.sustain);

        const auto applyCurve = [] (float value, int curve)
        {
            const float x = clamp01(value);
            if (curve == 1) return x * x;
            if (curve == 2) return 1.0f - (1.0f - x) * (1.0f - x);
            if (curve == 3) return x * x * (3.0f - 2.0f * x);
            return x;
        };

        float shaped = raw;
        if (std::abs(raw - previousRawEnvelope) < 0.00001f)
        {
            shaped = raw;
        }
        else if (raw > previousRawEnvelope)
        {
            shaped = applyCurve(raw, params.attackCurve);
        }
        else if (raw > sustain && sustain < 0.999f)
        {
            const float progress = (1.0f - raw) / juce::jmax(0.001f, 1.0f - sustain);
            shaped = 1.0f - applyCurve(progress, params.decayCurve) * (1.0f - sustain);
        }
        else if (sustain > 0.001f)
        {
            const float progress = 1.0f - raw / sustain;
            shaped = sustain * (1.0f - applyCurve(progress, params.releaseCurve));
        }
        previousRawEnvelope = raw;
        return clamp01(shaped);
    }

    void InstrumentVoice::configureWavetableOscillators(double frequencyHz) noexcept
    {
        configureWavetableOscillatorBank(wavetableOscillators, wavetableTable.get(), params.wavetable, frequencyHz);
        invalidateWavetableBankCache(wavetableUnisonPlan);
        activeWavetableUnison = juce::jlimit(1, 8, params.wavetable.unison);
    }

    void InstrumentVoice::configureWavetableOscillatorBank(
        std::array<WavetableOscillator, 8>& oscillators,
        const Wavetable* table,
        const Params::WavetableConfig& config,
        double frequencyHz) noexcept
    {
        const int unison = juce::jlimit(1, 8, config.unison);
        const float detuneCents = juce::jlimit(0.0f, 100.0f, config.detuneCents);
        const float blend = clamp01(config.blend);
        const float position = clamp01(config.position);

        for (int voice = 0; voice < (int) oscillators.size(); ++voice)
        {
            auto& osc = oscillators[(size_t) voice];
            const float centered = unison == 1
                ? 0.0f
                : ((float) voice / (float) (unison - 1)) * 2.0f - 1.0f;
            const double rate = std::exp2((centered * detuneCents) / 1200.0);
            osc.prepare(sampleRate);
            osc.setWavetable(table);
            osc.setPosition(position);
            osc.setFrequency(frequencyHz * rate);
            osc.reset((double) voice * 0.071 * (double) blend + (double) centered * 0.00008 * (double) blend);
        }
    }

    void InstrumentVoice::clearWavetableOscillatorBank(
        std::array<WavetableOscillator, 8>& oscillators,
        WavetableUnisonPlan& plan) noexcept
    {
        for (auto& osc : oscillators)
            osc.setWavetable(nullptr);
        invalidateWavetableBankCache(plan);
    }

    bool InstrumentVoice::legacyWavetableNeedsSetup() const noexcept
    {
        return !params.hasAether
            && params.waveform == 5;
    }

    bool InstrumentVoice::aetherOscillatorNeedsWavetable(const Params::AetherOscillator& osc) const noexcept
    {
        return params.hasAether
            && osc.enabled
            && osc.waveform == 5;
    }

    float InstrumentVoice::renderWavetableStack(
        double frequencyHz,
        float positionMod,
        float detuneCentsMod,
        float spreadMod) noexcept
    {
        return renderWavetableOscillatorBank(wavetableOscillators, wavetableUnisonPlan, params.wavetable, frequencyHz, positionMod, detuneCentsMod, spreadMod);
    }

    float InstrumentVoice::renderWavetableOscillatorBank(
        std::array<WavetableOscillator, 8>& oscillators,
        WavetableUnisonPlan& plan,
        const Params::WavetableConfig& config,
        double frequencyHz,
        float positionMod,
        float detuneCentsMod,
        float spreadMod) noexcept
    {
        if (!std::isfinite(frequencyHz) || frequencyHz <= 0.0)
            frequencyHz = baseFrequencyHz;

        auto& renderPlan = updateWavetableUnisonPlan(plan, config, detuneCentsMod, spreadMod);
        const float modulatedPosition = quantizeWavetablePosition(config.position + positionMod);
        float sum = 0.0f;
        currentBlockWavetableVoiceSamples += renderPlan.unison;

        for (int voice = 0; voice < renderPlan.unison; ++voice)
        {
            auto& osc = oscillators[(size_t) voice];
            const auto index = (size_t) voice;
            const double phaseDriftHz = (double) renderPlan.phaseSpread[index] * sampleRate;
            const double nextFrequencyHz = quantizeWavetableFrequency(frequencyHz * renderPlan.rates[index] + phaseDriftHz);
            if (std::abs(nextFrequencyHz - renderPlan.appliedFrequencyHz[index]) > 0.000001)
            {
                osc.setFrequency(nextFrequencyHz);
                renderPlan.appliedFrequencyHz[index] = nextFrequencyHz;
                ++currentBlockWavetableFrequencyUpdates;
            }

            if (std::abs(modulatedPosition - renderPlan.appliedPosition[index]) > 0.000001f)
            {
                osc.setPosition(modulatedPosition);
                renderPlan.appliedPosition[index] = modulatedPosition;
                ++currentBlockWavetablePositionUpdates;
            }
            sum += osc.renderSample() * renderPlan.weights[(size_t) voice];
        }

        return juce::jlimit(-1.0f, 1.0f, sum / juce::jmax(1.0f, renderPlan.weightSum));
    }

    InstrumentVoice::WavetableUnisonPlan& InstrumentVoice::updateWavetableUnisonPlan(
        WavetableUnisonPlan& plan,
        const Params::WavetableConfig& config,
        float detuneCentsMod,
        float spreadMod) noexcept
    {
        const int unison = juce::jlimit(1, 8, config.unison);
        const float rawDetuneCents = juce::jlimit(0.0f, 100.0f, config.detuneCents + detuneCentsMod);
        const float rawSpread = clamp01(config.blend + spreadMod);
        const float detuneCents = std::round(rawDetuneCents * 10.0f) * 0.1f;
        const float spread = std::round(rawSpread * 512.0f) / 512.0f;

        if (plan.unison == unison
            && std::abs(plan.detuneCents - detuneCents) < 0.0001f
            && std::abs(plan.spread - spread) < 0.0001f)
            return plan;

        plan.unison = unison;
        plan.detuneCents = detuneCents;
        plan.spread = spread;
        plan.weightSum = 0.0f;

        for (int voice = 0; voice < (int) plan.rates.size(); ++voice)
        {
            const float centered = unison == 1
                ? 0.0f
                : ((float) voice / (float) (unison - 1)) * 2.0f - 1.0f;
            const float weight = voice == 0 ? 1.0f : 0.72f;
            plan.centered[(size_t) voice] = centered;
            plan.rates[(size_t) voice] = voice < unison
                ? std::exp2(((double) centered * (double) detuneCents) / 1200.0)
                : 1.0;
            plan.weights[(size_t) voice] = voice < unison ? weight : 0.0f;
            plan.phaseSpread[(size_t) voice] = voice < unison ? centered * 0.00008f * spread : 0.0f;
            if (voice < unison)
                plan.weightSum += weight;
        }

        plan.weightSum = juce::jmax(1.0f, plan.weightSum);
        invalidateWavetableBankCache(plan);
        return plan;
    }

    void InstrumentVoice::invalidateWavetableBankCache(WavetableUnisonPlan& plan) noexcept
    {
        plan.appliedFrequencyHz.fill(-1.0);
        plan.appliedPosition.fill(-1.0f);
    }

    void InstrumentVoice::refreshCachedPanGains() noexcept
    {
        cachedAmpPanGains = equalPowerPanGains(params.ampPan);
        cachedAetherOscAPanGains = equalPowerPanGains(params.aetherOscA.pan);
        cachedAetherOscBPanGains = equalPowerPanGains(params.aetherOscB.pan);
    }

    void InstrumentVoice::refreshCachedPitchRates() noexcept
    {
        cachedAetherOscARate = pitchRate(params.aetherOscA.octave,
                                         params.aetherOscA.semitone,
                                         params.aetherOscA.fineCents);
        cachedAetherOscBRate = pitchRate(params.aetherOscB.octave,
                                         params.aetherOscB.semitone,
                                         params.aetherOscB.fineCents);
        cachedAetherSubRate = std::exp2((double) params.aetherSub.octave);
    }

    void InstrumentVoice::refreshCachedDynamicModulationFlags() noexcept
    {
        const auto& modulation = params.dynamicModulation;
        if (!modulation.active)
        {
            cachedAmpPanDynamic = false;
            cachedAetherOscAPanDynamic = false;
            cachedAetherOscBPanDynamic = false;
            cachedAetherOscAFineDynamic = false;
            cachedAetherOscBFineDynamic = false;
            cachedAetherOscAPositionDynamic = false;
            cachedAetherOscBPositionDynamic = false;
            cachedAetherOscALevelDynamic = false;
            cachedAetherOscBLevelDynamic = false;
            cachedFilterCutoffDynamic = false;
            cachedFilterResonanceDynamic = false;
            cachedFilterDriveDynamic = false;
            cachedAmpLevelDynamic = false;
            cachedUnisonDetuneDynamic = false;
            cachedUnisonSpreadDynamic = false;
            cachedAnyDynamicModulationTarget = false;
            return;
        }

        cachedAmpPanDynamic = dynamicTargetActive(modulation.ampPan);
        cachedAetherOscAPanDynamic = dynamicTargetActive(modulation.oscAPan);
        cachedAetherOscBPanDynamic = dynamicTargetActive(modulation.oscBPan);
        cachedAetherOscAFineDynamic = dynamicTargetActive(modulation.oscAFine);
        cachedAetherOscBFineDynamic = dynamicTargetActive(modulation.oscBFine);
        cachedAetherOscAPositionDynamic = dynamicTargetActive(modulation.oscAPosition);
        cachedAetherOscBPositionDynamic = dynamicTargetActive(modulation.oscBPosition);
        cachedAetherOscALevelDynamic = dynamicTargetActive(modulation.oscALevel);
        cachedAetherOscBLevelDynamic = dynamicTargetActive(modulation.oscBLevel);
        cachedFilterCutoffDynamic = dynamicTargetActive(modulation.filterCutoff);
        cachedFilterResonanceDynamic = dynamicTargetActive(modulation.filterResonance);
        cachedFilterDriveDynamic = dynamicTargetActive(modulation.filterDrive);
        cachedAmpLevelDynamic = dynamicTargetActive(modulation.ampLevel);
        cachedUnisonDetuneDynamic = dynamicTargetActive(modulation.unisonDetune);
        cachedUnisonSpreadDynamic = dynamicTargetActive(modulation.unisonSpread);
        cachedAnyDynamicModulationTarget =
            cachedAmpPanDynamic
            || cachedAetherOscAPanDynamic
            || cachedAetherOscBPanDynamic
            || cachedAetherOscAFineDynamic
            || cachedAetherOscBFineDynamic
            || cachedAetherOscAPositionDynamic
            || cachedAetherOscBPositionDynamic
            || cachedAetherOscALevelDynamic
            || cachedAetherOscBLevelDynamic
            || cachedFilterCutoffDynamic
            || cachedFilterResonanceDynamic
            || cachedFilterDriveDynamic
            || cachedAmpLevelDynamic
            || cachedUnisonDetuneDynamic
            || cachedUnisonSpreadDynamic;
    }

    InstrumentVoice::StereoSample InstrumentVoice::renderAetherTableStack(double frequencyHz, float rawLfo, float rawLfo2, float env) noexcept
    {
        const bool useDynamicModulation = params.dynamicModulation.active && cachedAnyDynamicModulationTarget;
        const float unisonDetuneMod = useDynamicModulation && cachedUnisonDetuneDynamic
            ? dynamicTargetOffset(params.dynamicModulation.unisonDetune, rawLfo, rawLfo2, env, 100.0f)
            : 0.0f;
        const float unisonSpreadMod = useDynamicModulation && cachedUnisonSpreadDynamic
            ? dynamicTargetOffset(params.dynamicModulation.unisonSpread, rawLfo, rawLfo2, env, 1.0f)
            : 0.0f;
        float leftSum = 0.0f;
        float rightSum = 0.0f;
        float levelSum = 0.0f;

        const auto add = [&](float value, float level, float pan, std::pair<float, float> staticPanGains, bool panIsDynamic)
        {
            const float safeLevel = clamp01(level);
            const auto [leftGain, rightGain] = panIsDynamic ? equalPowerPanGains(pan) : staticPanGains;
            leftSum += value * safeLevel * leftGain;
            rightSum += value * safeLevel * rightGain;
            levelSum += safeLevel;
        };

        const auto renderOsc = [&](
            const Params::AetherOscillator& osc,
            std::array<WavetableOscillator, 8>& oscillators,
            const Params::DynamicModTarget& positionTarget,
            const Params::DynamicModTarget& fineTarget,
            const Params::DynamicModTarget& levelTarget,
            const Params::DynamicModTarget& panTarget,
            std::pair<float, float> staticPanGains,
            bool panIsDynamic,
            bool fineIsDynamic,
            bool positionIsDynamic,
            bool levelIsDynamic,
            double staticRate,
            double phaseOffset,
            int64_t& componentSampleCounter)
        {
            const float modulatedLevel = clamp01(osc.level + (useDynamicModulation && levelIsDynamic
                ? dynamicTargetOffset(levelTarget, rawLfo, rawLfo2, env, 1.0f)
                : 0.0f));
            if (!osc.enabled || modulatedLevel <= 0.0f)
                return;
            const float modulatedPan = juce::jlimit(-1.0f, 1.0f, osc.pan + (useDynamicModulation
                ? dynamicTargetOffset(panTarget, rawLfo, rawLfo2, env, 1.0f)
                : 0.0f));

            const float positionMod = useDynamicModulation && positionIsDynamic
                ? dynamicTargetOffset(positionTarget, rawLfo, rawLfo2, env, 1.0f)
                : 0.0f;
            if (osc.waveform == 4)
            {
                ++currentBlockOscillatorSamples;
                ++componentSampleCounter;
                add(nextNoise(noiseState), modulatedLevel, modulatedPan, staticPanGains, panIsDynamic);
                return;
            }

            double rate = staticRate;
            if (fineIsDynamic)
            {
                const float fineOffsetCents = dynamicTargetOffset(fineTarget, rawLfo, rawLfo2, env, 100.0f);
                rate *= std::exp2((double) fineOffsetCents / 1200.0);
                ++currentBlockOscillatorRateCalculations;
            }

            float value = 0.0f;
            if (osc.waveform == 5)
            {
                const auto before = currentBlockWavetableVoiceSamples;
                value = renderWavetableOscillatorBank(
                    oscillators,
                    (&oscillators == &aetherOscillatorsA ? aetherUnisonPlanA : aetherUnisonPlanB),
                    osc.wavetable,
                    frequencyHz * rate,
                    positionMod,
                    unisonDetuneMod,
                    unisonSpreadMod);
                componentSampleCounter += currentBlockWavetableVoiceSamples - before;
            }
            else
            {
                value = oscillatorSample(osc.waveform, phase * rate + phaseOffset, (frequencyHz * rate) / sampleRate);
                ++currentBlockOscillatorSamples;
                ++componentSampleCounter;
            }
            add(value, modulatedLevel, modulatedPan, staticPanGains, panIsDynamic);
        };

        renderOsc(
            params.aetherOscA,
            aetherOscillatorsA,
            params.dynamicModulation.oscAPosition,
            params.dynamicModulation.oscAFine,
            params.dynamicModulation.oscALevel,
            params.dynamicModulation.oscAPan,
            cachedAetherOscAPanGains,
            cachedAetherOscAPanDynamic,
            cachedAetherOscAFineDynamic,
            cachedAetherOscAPositionDynamic,
            cachedAetherOscALevelDynamic,
            cachedAetherOscARate,
            aetherOscAPhaseOffset,
            currentBlockAetherOscASamples);
        renderOsc(
            params.aetherOscB,
            aetherOscillatorsB,
            params.dynamicModulation.oscBPosition,
            params.dynamicModulation.oscBFine,
            params.dynamicModulation.oscBLevel,
            params.dynamicModulation.oscBPan,
            cachedAetherOscBPanGains,
            cachedAetherOscBPanDynamic,
            cachedAetherOscBFineDynamic,
            cachedAetherOscBPositionDynamic,
            cachedAetherOscBLevelDynamic,
            cachedAetherOscBRate,
            aetherOscBPhaseOffset,
            currentBlockAetherOscBSamples);

        if (params.aetherSub.enabled && params.aetherSub.level > 0.0f)
        {
            ++currentBlockOscillatorSamples;
            ++currentBlockAetherSubSamples;
            add(oscillatorSample(params.aetherSub.waveform, phase * cachedAetherSubRate, (frequencyHz * cachedAetherSubRate) / sampleRate),
                params.aetherSub.level,
                0.0f,
                centerPanGains,
                false);
        }

        if (params.aetherNoise.enabled && params.aetherNoise.level > 0.0f)
        {
            ++currentBlockOscillatorSamples;
            ++currentBlockAetherNoiseSamples;
            const float noise = nextNoise(noiseState);
            add(noise * (0.35f + clamp01(params.aetherNoise.color) * 0.65f), params.aetherNoise.level, 0.0f, centerPanGains, false);
        }

        if (levelSum <= 0.0f)
            return {};

        const float normalizer = juce::jmax(0.35f, levelSum);
        return {
            juce::jlimit(-1.0f, 1.0f, leftSum / normalizer),
            juce::jlimit(-1.0f, 1.0f, rightSum / normalizer),
        };
    }
}

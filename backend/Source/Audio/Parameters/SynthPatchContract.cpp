#include "SynthPatchContract.h"

#include <cmath>

namespace beat
{
    namespace
    {
        juce::var objectProperty(const juce::var& object, const juce::String& name, const juce::var& fallback = {})
        {
            if (auto* dyn = object.getDynamicObject())
            {
                for (const auto& pair : dyn->getProperties())
                    if (pair.name.toString() == name)
                        return pair.value;
            }
            return fallback;
        }

        double synthNumberParam(const juce::var& params, const juce::String& id, double fallback)
        {
            const auto value = objectProperty(params, id, fallback);
            if (value.isBool()) return (bool) value ? 1.0 : 0.0;
            if (value.isString()) return fallback;
            const double number = (double) value;
            return std::isfinite(number) ? number : fallback;
        }

        juce::String synthStringParam(const juce::var& params, const juce::String& id, const juce::String& fallback)
        {
            const auto value = objectProperty(params, id, fallback);
            return value.isString() ? value.toString() : fallback;
        }

        float cutoffHzTo01(double hz)
        {
            constexpr double minHz = 20.0;
            constexpr double maxHz = 20000.0;
            const double safeHz = juce::jlimit(minHz, maxHz, hz);
            return (float) juce::jlimit(0.0, 1.0, std::log(safeHz / minHz) / std::log(maxHz / minHz));
        }

        float routeAmount(const juce::var& modulation, const juce::String& source, const juce::String& target)
        {
            float amount = 0.0f;
            if (auto* routes = modulation.getArray())
            {
                for (const auto& route : *routes)
                {
                    if (!route.isObject()) continue;
                    if (!(bool) objectProperty(route, "enabled", true)) continue;
                    if (objectProperty(route, "source", {}).toString() != source) continue;
                    if (objectProperty(route, "target", {}).toString() != target) continue;
                    amount += (float) (double) objectProperty(route, "amount", 0.0);
                }
            }
            return juce::jlimit(-1.0f, 1.0f, amount);
        }

        bool routeBipolar(const juce::var& modulation, const juce::String& source, const juce::String& target, bool fallback)
        {
            if (auto* routes = modulation.getArray())
            {
                for (const auto& route : *routes)
                {
                    if (!route.isObject()) continue;
                    if (!(bool) objectProperty(route, "enabled", true)) continue;
                    if (objectProperty(route, "source", {}).toString() != source) continue;
                    if (objectProperty(route, "target", {}).toString() != target) continue;
                    return (bool) objectProperty(route, "bipolar", fallback);
                }
            }
            return fallback;
        }

        float staticRouteScale(const juce::String& target)
        {
            return target.endsWith(".fine") ? 100.0f : 1.0f;
        }

        float staticRouteAmount(const juce::var& params, const juce::var& modulation, const juce::String& target)
        {
            float amount = 0.0f;
            const float scale = staticRouteScale(target);
            if (auto* routes = modulation.getArray())
            {
                for (const auto& route : *routes)
                {
                    if (!route.isObject()) continue;
                    if (!(bool) objectProperty(route, "enabled", true)) continue;
                    if (objectProperty(route, "target", {}).toString() != target) continue;

                    const auto source = objectProperty(route, "source", {}).toString();
                    if (!source.startsWith("macro.")) continue;

                    const float sourceValue = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, source, 0.0));
                    const float routeValue = juce::jlimit(-1.0f, 1.0f, (float) (double) objectProperty(route, "amount", 0.0));
                    amount += sourceValue * routeValue * scale;
                }
            }
            return juce::jlimit(-scale, scale, amount);
        }

        InstrumentDefinition::WavetableConfig::CustomFrame customFrameFromVar(
            const juce::var& value,
            InstrumentDefinition::WavetableConfig::CustomFrame fallback)
        {
            if (!value.isObject()) return fallback;
            fallback.brightness = juce::jlimit(0.0f, 1.0f, (float) (double) objectProperty(value, "brightness", fallback.brightness));
            fallback.even = juce::jlimit(0.0f, 1.0f, (float) (double) objectProperty(value, "even", fallback.even));
            fallback.fold = juce::jlimit(0.0f, 1.0f, (float) (double) objectProperty(value, "fold", fallback.fold));
            fallback.phase = juce::jlimit(-1.0f, 1.0f, (float) (double) objectProperty(value, "phase", fallback.phase));
            return fallback;
        }

        void applyCustomWavetableFrames(
            InstrumentDefinition::WavetableConfig& config,
            const juce::var& customWavetables,
            const juce::String& id)
        {
            if (!id.startsWith("user."))
                return;

            config.bank = 5;
            config.custom = true;

            const auto definition = objectProperty(customWavetables, id, {});
            const auto frames = objectProperty(definition, "frames", {});
            if (auto* frameArray = frames.getArray())
            {
                const int count = juce::jmin((int) config.customFrames.size(), frameArray->size());
                for (int i = 0; i < count; ++i)
                    config.customFrames[(size_t) i] = customFrameFromVar((*frameArray)[i], config.customFrames[(size_t) i]);
            }
        }

        InstrumentDefinition::WavetableConfig synthWavetableConfig(
            const juce::var& params,
            const juce::var& modulation,
            const juce::var& customWavetables,
            const juce::String& oscillator,
            InstrumentDefinition::WavetableConfig fallback)
        {
            const auto prefix = "osc." + oscillator + ".";
            const auto wavetableId = synthStringParam(params, prefix + "wavetable", "basic.saw");
            fallback.bank = synthWavetableBankForId(wavetableId);
            fallback.custom = false;
            applyCustomWavetableFrames(fallback, customWavetables, wavetableId);
            fallback.position = juce::jlimit(
                0.0f,
                1.0f,
                (float) synthNumberParam(params, prefix + "position", fallback.position)
                    + staticRouteAmount(params, modulation, prefix + "position"));
            return fallback;
        }

        InstrumentDefinition::AetherOscillator synthOscillatorConfig(
            const juce::var& params,
            const juce::var& modulation,
            const juce::var& customWavetables,
            const juce::String& oscillator,
            InstrumentDefinition::AetherOscillator fallback)
        {
            const auto prefix = "osc." + oscillator + ".";
            fallback.enabled = synthNumberParam(params, prefix + "enabled", fallback.enabled ? 1.0 : 0.0) >= 0.5;
            fallback.level = juce::jlimit(
                0.0f,
                1.0f,
                (float) synthNumberParam(params, prefix + "level", fallback.level)
                    + staticRouteAmount(params, modulation, prefix + "level"));
            fallback.pan = juce::jlimit(
                -1.0f,
                1.0f,
                (float) synthNumberParam(params, prefix + "pan", fallback.pan)
                    + staticRouteAmount(params, modulation, prefix + "pan"));
            fallback.waveform = 5;
            fallback.octave = juce::jlimit(-4, 4, (int) std::round(synthNumberParam(params, prefix + "octave", fallback.octave)));
            fallback.semitone = juce::jlimit(-24, 24, (int) std::round(synthNumberParam(params, prefix + "semitone", fallback.semitone)));
            fallback.fineCents = juce::jlimit(
                -100.0f,
                100.0f,
                (float) synthNumberParam(params, prefix + "fine", fallback.fineCents)
                    + staticRouteAmount(params, modulation, prefix + "fine"));
            fallback.wavetable = synthWavetableConfig(params, modulation, customWavetables, oscillator, fallback.wavetable);
            return fallback;
        }

        bool configureDynamicTarget(
            InstrumentDefinition::DynamicModTarget& target,
            const juce::var& modulation,
            const juce::String& routeTarget,
            bool lfoEnabled,
            bool lfo2Enabled)
        {
            target.lfo = lfoEnabled ? routeAmount(modulation, "lfo.1", routeTarget) : 0.0f;
            target.lfoBipolar = routeBipolar(modulation, "lfo.1", routeTarget, true);
            target.lfo2 = lfo2Enabled ? routeAmount(modulation, "lfo.2", routeTarget) : 0.0f;
            target.lfo2Bipolar = routeBipolar(modulation, "lfo.2", routeTarget, true);
            target.env = routeAmount(modulation, "env.1", routeTarget);
            target.envBipolar = routeBipolar(modulation, "env.1", routeTarget, false);
            return std::abs(target.lfo) > 0.0001f || std::abs(target.lfo2) > 0.0001f || std::abs(target.env) > 0.0001f;
        }

        void configureDynamicModulation(
            InstrumentDefinition::DynamicModulation& dynamicModulation,
            const juce::var& modulation,
            bool lfoEnabled,
            bool lfo2Enabled)
        {
            dynamicModulation = {};
            bool active = false;
            active |= configureDynamicTarget(dynamicModulation.oscAPosition, modulation, "osc.a.position", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.oscAFine, modulation, "osc.a.fine", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.oscALevel, modulation, "osc.a.level", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.oscAPan, modulation, "osc.a.pan", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.oscBPosition, modulation, "osc.b.position", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.oscBFine, modulation, "osc.b.fine", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.oscBLevel, modulation, "osc.b.level", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.oscBPan, modulation, "osc.b.pan", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.filterCutoff, modulation, "filter.cutoff", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.filterResonance, modulation, "filter.resonance", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.filterDrive, modulation, "filter.drive", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.ampLevel, modulation, "amp.level", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.ampPan, modulation, "amp.pan", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.unisonDetune, modulation, "unison.detune", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.unisonSpread, modulation, "unison.spread", lfoEnabled, lfo2Enabled);
            dynamicModulation.active = active;
        }
    }

    int parseSynthLfoWaveform(const juce::var& value)
    {
        if (value.isString())
        {
            const auto waveform = value.toString();
            if (waveform == "triangle") return 1;
            if (waveform == "saw") return 2;
            if (waveform == "square") return 3;
            return 0;
        }
        return juce::jlimit(0, 3, (int) value);
    }

    int parseSynthFilterType(const juce::var& value)
    {
        if (value.isString())
        {
            const auto type = value.toString();
            if (type == "bandpass") return 1;
            if (type == "highpass") return 2;
            return 0;
        }
        return juce::jlimit(0, 2, (int) value);
    }

    int synthWavetableBankForId(const juce::String& id)
    {
        if (id == "basic.sine") return 1;
        if (id == "basic.square") return 2;
        if (id == "basic.triangle") return 3;
        if (id == "basic.pulse") return 4;
        if (id.startsWith("user.")) return 5;
        return 0;
    }

    bool applySynthPatchContract(const juce::var& patch, InstrumentDefinition& instrument)
    {
        if (!patch.isObject()) return false;
        if (objectProperty(patch, "instrumentType", {}).toString() != "wavetable-synth") return false;

        const auto params = objectProperty(patch, "parameters", {});
        if (!params.isObject()) return false;
        const auto modulation = objectProperty(patch, "modulation", {});
        const auto metadata = objectProperty(patch, "metadata", {});
        auto customWavetables = objectProperty(metadata, "wavemaps", {});
        if (!customWavetables.isObject())
            customWavetables = objectProperty(metadata, "customWavetables", {});

        instrument.kind = "wavetable";
        instrument.waveform = 5;
        instrument.wavetableBank = synthWavetableBankForId(synthStringParam(params, "osc.a.wavetable", "basic.saw"));
        instrument.wavetablePosition = juce::jlimit(
            0.0f,
            1.0f,
            (float) synthNumberParam(params, "osc.a.position", instrument.wavetablePosition)
                + staticRouteAmount(params, modulation, "osc.a.position"));
        const bool unisonEnabled = synthNumberParam(params, "unison.enabled", 0.0) >= 0.5;
        instrument.wavetableUnison = unisonEnabled
            ? juce::jlimit(1, 8, (int) std::round(synthNumberParam(params, "unison.voices", instrument.wavetableUnison)))
            : 1;
        instrument.wavetableDetuneCents = unisonEnabled
            ? juce::jlimit(
                0.0f,
                100.0f,
                ((float) synthNumberParam(params, "unison.detune", 0.12)
                    + staticRouteAmount(params, modulation, "unison.detune")) * 100.0f)
            : 0.0f;
        instrument.wavetableBlend = unisonEnabled
            ? juce::jlimit(
                0.0f,
                1.0f,
                (float) synthNumberParam(params, "unison.spread", synthNumberParam(params, "unison.blend", instrument.wavetableBlend))
                    + staticRouteAmount(params, modulation, "unison.spread"))
            : 0.0f;

        InstrumentDefinition::WavetableConfig baseWavetable;
        baseWavetable.bank = instrument.wavetableBank;
        baseWavetable.position = instrument.wavetablePosition;
        baseWavetable.warp = instrument.wavetableWarp;
        baseWavetable.unison = instrument.wavetableUnison;
        baseWavetable.detuneCents = instrument.wavetableDetuneCents;
        baseWavetable.blend = instrument.wavetableBlend;
        applyCustomWavetableFrames(baseWavetable, customWavetables, synthStringParam(params, "osc.a.wavetable", "basic.saw"));

        InstrumentDefinition::AetherOscillator oscA;
        oscA.enabled = true;
        oscA.level = 0.8f;
        oscA.wavetable = baseWavetable;

        InstrumentDefinition::AetherOscillator oscB;
        oscB.enabled = false;
        oscB.level = 0.6f;
        oscB.wavetable = baseWavetable;
        applyCustomWavetableFrames(oscB.wavetable, customWavetables, synthStringParam(params, "osc.b.wavetable", "basic.square"));
        if (!oscB.wavetable.custom)
            oscB.wavetable.bank = synthWavetableBankForId(synthStringParam(params, "osc.b.wavetable", "basic.square"));

        instrument.hasAether = true;
        instrument.aether.oscA = synthOscillatorConfig(params, modulation, customWavetables, "a", oscA);
        instrument.aether.oscB = synthOscillatorConfig(params, modulation, customWavetables, "b", oscB);
        instrument.aether.oscA.wavetable.unison = instrument.wavetableUnison;
        instrument.aether.oscA.wavetable.detuneCents = instrument.wavetableDetuneCents;
        instrument.aether.oscA.wavetable.blend = instrument.wavetableBlend;
        instrument.aether.oscB.wavetable.unison = instrument.wavetableUnison;
        instrument.aether.oscB.wavetable.detuneCents = instrument.wavetableDetuneCents;
        instrument.aether.oscB.wavetable.blend = instrument.wavetableBlend;

        const bool filterEnabled = synthNumberParam(params, "filter.enabled", 1.0) >= 0.5;
        instrument.filterType = parseSynthFilterType(synthStringParam(params, "filter.type", "lowpass"));
        instrument.cutoff01 = filterEnabled
            ? juce::jlimit(0.0f, 1.0f, cutoffHzTo01(synthNumberParam(params, "filter.cutoff", 18000.0))
                + staticRouteAmount(params, modulation, "filter.cutoff"))
            : 1.0f;
        instrument.resonance01 = filterEnabled
            ? juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "filter.resonance", instrument.resonance01)
                + staticRouteAmount(params, modulation, "filter.resonance"))
            : 0.0f;
        instrument.drive01 = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "filter.drive", instrument.drive01)
            + staticRouteAmount(params, modulation, "filter.drive"));
        instrument.attackMs = juce::jlimit(0.0f, 30000.0f, (float) synthNumberParam(params, "env.1.attack", 0.005) * 1000.0f);
        instrument.decayMs = juce::jlimit(0.0f, 30000.0f, (float) synthNumberParam(params, "env.1.decay", 0.15) * 1000.0f);
        instrument.sustain = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "env.1.sustain", instrument.sustain));
        instrument.releaseMs = juce::jlimit(0.0f, 30000.0f, (float) synthNumberParam(params, "env.1.release", 0.25) * 1000.0f);
        instrument.ampLevel = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "amp.level", instrument.ampLevel)
            + staticRouteAmount(params, modulation, "amp.level"));
        instrument.ampPan = juce::jlimit(-1.0f, 1.0f, (float) synthNumberParam(params, "amp.pan", instrument.ampPan)
            + staticRouteAmount(params, modulation, "amp.pan"));
        instrument.lfoWaveform = parseSynthLfoWaveform(synthStringParam(params, "lfo.1.shape", "sine"));
        instrument.lfoRateHz = juce::jlimit(0.01f, 50.0f, (float) synthNumberParam(params, "lfo.1.rate", instrument.lfoRateHz));
        instrument.lfo2Enabled = synthNumberParam(params, "lfo.2.enabled", instrument.lfo2Enabled ? 1.0 : 0.0) >= 0.5;
        instrument.lfo2Waveform = parseSynthLfoWaveform(synthStringParam(params, "lfo.2.shape", "triangle"));
        instrument.lfo2RateHz = juce::jlimit(0.01f, 50.0f, (float) synthNumberParam(params, "lfo.2.rate", instrument.lfo2RateHz));

        const bool lfoEnabled = synthNumberParam(params, "lfo.1.enabled", 1.0) >= 0.5;
        instrument.lfoDepth = lfoEnabled ? std::abs(routeAmount(modulation, "lfo.1", "osc.a.position")) : 0.0f;
        instrument.lfoToPitch = lfoEnabled ? std::abs(routeAmount(modulation, "lfo.1", "osc.a.fine")) * 12.0f : 0.0f;
        instrument.lfoToFilter = lfoEnabled ? routeAmount(modulation, "lfo.1", "filter.cutoff") : 0.0f;
        instrument.lfoPositionBipolar = routeBipolar(modulation, "lfo.1", "osc.a.position", true);
        instrument.lfoPitchBipolar = routeBipolar(modulation, "lfo.1", "osc.a.fine", true);
        instrument.lfoFilterBipolar = routeBipolar(modulation, "lfo.1", "filter.cutoff", true);
        instrument.envToFilter = routeAmount(modulation, "env.1", "filter.cutoff");
        configureDynamicModulation(instrument.dynamicModulation, modulation, lfoEnabled, instrument.lfo2Enabled);
        return true;
    }
}

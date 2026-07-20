#include "SynthPatchContract.h"
#include "ParameterIds.h"
#include "../Wavetable/WavetableUnisonConfig.h"

#include <cmath>
#include <utility>

namespace beat
{
    int synthWavetableBankForId(const juce::String& id);
    int synthWavetableWarpModeForId(const juce::String& id);

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

        void copyObjectProperties(juce::DynamicObject& target, const juce::var& source)
        {
            if (auto* dyn = source.getDynamicObject())
                for (const auto& pair : dyn->getProperties())
                    target.setProperty(pair.name, pair.value);
        }

        juce::var mergedWavemapMetadata(const juce::var& metadata)
        {
            auto* merged = new juce::DynamicObject();
            copyObjectProperties(*merged, objectProperty(metadata, "customWavetables", {}));
            copyObjectProperties(*merged, objectProperty(metadata, "wavemaps", {}));
            return juce::var(merged);
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

        int macroIndexForSource(const juce::String& source)
        {
            if (source == "macro.1") return 1;
            if (source == "macro.2") return 2;
            if (source == "macro.3") return 3;
            if (source == "macro.4") return 4;
            if (source == "macro.5") return 5;
            if (source == "macro.6") return 6;
            if (source == "macro.7") return 7;
            if (source == "macro.8") return 8;
            return 0;
        }

        int envelopeCurveForId(const juce::String& id)
        {
            if (id == "exp") return 1;
            if (id == "log") return 2;
            if (id == "s-curve") return 3;
            return 0;
        }

        int synthRuntimeWarpModeForId(const juce::String& id)
        {
            if (id == "fold") return 1;
            if (id == "pinch") return 2;
            if (id == "mirror") return 3;
            return 0;
        }

        float applyMacroCurve(float value, const juce::String& curve)
        {
            const float x = juce::jlimit(0.0f, 1.0f, value);
            if (curve == "ease-in") return x * x;
            if (curve == "ease-out") return 1.0f - std::pow(1.0f - x, 2.0f);
            if (curve == "s-curve") return x * x * (3.0f - 2.0f * x);
            return x;
        }

        float macroSourceValue(const juce::var& params, const juce::var& metadata, const juce::String& source)
        {
            const int index = macroIndexForSource(source);
            if (index == 0) return 0.0f;
            const float raw = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, source, 0.0));
            const auto macros = objectProperty(metadata, "macros", {});
            const auto macro = objectProperty(macros, source, {});
            if (!macro.isObject()) return raw;
            const float rawMin = juce::jlimit(0.0f, 1.0f, (float) (double) objectProperty(macro, "min", 0.0));
            const float rawMax = juce::jlimit(0.0f, 1.0f, (float) (double) objectProperty(macro, "max", 1.0));
            const float min = juce::jmin(rawMin, rawMax);
            const float max = juce::jmax(rawMin, rawMax);
            const auto curve = objectProperty(macro, "curve", "linear").toString();
            return juce::jlimit(0.0f, 1.0f, min + (max - min) * applyMacroCurve(raw, curve));
        }

        InstrumentDefinition::WavetableConfig::CustomFrame customFrameFromVar(
            const juce::var& value,
            InstrumentDefinition::WavetableConfig::CustomFrame fallback)
        {
            if (!value.isObject()) return fallback;
            fallback.brightness = juce::jlimit(0.0f, 1.0f, (float) (double) objectProperty(value, "brightness", fallback.brightness));
            fallback.even = juce::jlimit(0.0f, 1.0f, (float) (double) objectProperty(value, "even", fallback.even));
            fallback.fold = juce::jlimit(0.0f, 1.0f, (float) (double) objectProperty(value, "fold", fallback.fold));
            fallback.formant = juce::jlimit(0.0f, 1.0f, (float) (double) objectProperty(value, "formant", fallback.formant));
            fallback.notch = juce::jlimit(0.0f, 1.0f, (float) (double) objectProperty(value, "notch", fallback.notch));
            fallback.skew = juce::jlimit(-1.0f, 1.0f, (float) (double) objectProperty(value, "skew", fallback.skew));
            fallback.tilt = juce::jlimit(-1.0f, 1.0f, (float) (double) objectProperty(value, "tilt", fallback.tilt));
            fallback.focus = juce::jlimit(0.0f, 1.0f, (float) (double) objectProperty(value, "focus", fallback.focus));
            fallback.phase = juce::jlimit(-1.0f, 1.0f, (float) (double) objectProperty(value, "phase", fallback.phase));
            const auto partialValues = objectProperty(value, "partials", {});
            if (auto* partials = partialValues.getArray())
            {
                const int count = juce::jmin((int) fallback.partials.size(), partials->size());
                for (int i = 0; i < count; ++i)
                    fallback.partials[(size_t) i] = juce::jlimit(0.0f, 1.0f, (float) (double) (*partials)[i]);
            }
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
            config.smoothInterpolation = objectProperty(definition, "interpolation", "linear").toString() == "smooth";
            config.morph = juce::jlimit(0.0f, 1.0f, (float) (double) objectProperty(definition, "morph", config.morph));
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
            const juce::var& metadata,
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
                (float) synthNumberParam(params, prefix + "position", fallback.position));
            fallback.warp = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "warp", fallback.warp));
            fallback.warpMode = synthWavetableWarpModeForId(synthStringParam(params, prefix + "warpMode", "shape"));
            fallback.unison = juce::jlimit(
                1,
                WavetableUnison::maxVoices,
                (int) std::round(synthNumberParam(params, prefix + "unison.voices", fallback.unison)));
            fallback.detuneCents = juce::jlimit(
                0.0f,
                100.0f,
                (float) synthNumberParam(params, prefix + "unison.detune", fallback.detuneCents / 100.0f) * 100.0f);
            fallback.blend = juce::jlimit(
                0.0f,
                1.0f,
                (float) synthNumberParam(params, prefix + "unison.spread", fallback.blend));
            return fallback;
        }

        InstrumentDefinition::AetherOscillator synthOscillatorConfig(
            const juce::var& params,
            const juce::var& modulation,
            const juce::var& metadata,
            const juce::var& customWavetables,
            const juce::String& oscillator,
            InstrumentDefinition::AetherOscillator fallback)
        {
            const auto prefix = "osc." + oscillator + ".";
            fallback.enabled = synthNumberParam(params, prefix + "enabled", fallback.enabled ? 1.0 : 0.0) >= 0.5;
            fallback.level = juce::jlimit(
                0.0f,
                1.0f,
                (float) synthNumberParam(params, prefix + "level", fallback.level));
            fallback.pan = juce::jlimit(
                -1.0f,
                1.0f,
                (float) synthNumberParam(params, prefix + "pan", fallback.pan));
            fallback.waveform = 5;
            fallback.octave = juce::jlimit(-4, 4, (int) std::round(synthNumberParam(params, prefix + "octave", fallback.octave)));
            fallback.semitone = juce::jlimit(-24, 24, (int) std::round(synthNumberParam(params, prefix + "semitone", fallback.semitone)));
            fallback.fineCents = juce::jlimit(
                -100.0f,
                100.0f,
                (float) synthNumberParam(params, prefix + "fine", fallback.fineCents));
            const auto tuningMode = synthStringParam(params, prefix + "tuning.mode", "semitone");
            fallback.tuningMode = tuningMode == "harmonic" ? 1 : tuningMode == "ratio" ? 2 : tuningMode == "step" ? 3 : 0;
            fallback.harmonic = juce::jlimit(1, 64, (int) std::round(synthNumberParam(params, prefix + "tuning.harmonic", fallback.harmonic)));
            fallback.ratioNumerator = juce::jlimit(0.001f, 64.0f, (float) synthNumberParam(params, prefix + "tuning.numerator", fallback.ratioNumerator));
            fallback.ratioDenominator = juce::jlimit(0.001f, 64.0f, (float) synthNumberParam(params, prefix + "tuning.denominator", fallback.ratioDenominator));
            fallback.tuningStep = juce::jlimit(-96, 96, (int) std::round(synthNumberParam(params, prefix + "tuning.step", fallback.tuningStep)));
            fallback.tuningDivisions = juce::jlimit(1, 96, (int) std::round(synthNumberParam(params, prefix + "tuning.divisions", fallback.tuningDivisions)));
            fallback.phaseMode = synthStringParam(params, prefix + "phaseMode", "retrigger") == "memory" ? 1 : 0;
            const auto route = synthStringParam(params, prefix + "route", "filter");
            fallback.routing = route == "direct" ? 1 : route == "filter1" ? 2 : route == "filter2" ? 3 : 0;
            fallback.phase = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "phase", fallback.phase));
            fallback.randomPhase = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "randomPhase", fallback.randomPhase));
            fallback.fxSends[0] = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "fxSend1", fallback.fxSends[0]));
            fallback.fxSends[1] = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "fxSend2", fallback.fxSends[1]));
            fallback.wavetable = synthWavetableConfig(params, modulation, metadata, customWavetables, oscillator, fallback.wavetable);
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
            for (size_t index = 0; index < target.extraLfo.size(); ++index)
            {
                const auto source = "lfo." + juce::String((int) index + 3);
                target.extraLfo[index] = routeAmount(modulation, source, routeTarget);
                target.extraLfoBipolar[index] = routeBipolar(modulation, source, routeTarget, true);
            }
            target.env = routeAmount(modulation, "env.1", routeTarget);
            target.envBipolar = routeBipolar(modulation, "env.1", routeTarget, false);
            target.env2 = routeAmount(modulation, "env.2", routeTarget);
            target.env2Bipolar = routeBipolar(modulation, "env.2", routeTarget, false);
            target.env3 = routeAmount(modulation, "env.3", routeTarget);
            target.env3Bipolar = routeBipolar(modulation, "env.3", routeTarget, false);
            target.env4 = routeAmount(modulation, "env.4", routeTarget);
            target.env4Bipolar = routeBipolar(modulation, "env.4", routeTarget, false);
            target.velocity = routeAmount(modulation, "velocity", routeTarget);
            target.velocityBipolar = routeBipolar(modulation, "velocity", routeTarget, false);
            target.keytrack = routeAmount(modulation, "keytrack", routeTarget);
            target.keytrackBipolar = routeBipolar(modulation, "keytrack", routeTarget, false);
            target.modWheel = routeAmount(modulation, "modWheel", routeTarget);
            target.modWheelBipolar = routeBipolar(modulation, "modWheel", routeTarget, false);
            target.pressure = routeAmount(modulation, "pressure", routeTarget);
            target.pressureBipolar = routeBipolar(modulation, "pressure", routeTarget, false);
            target.timbre = routeAmount(modulation, "timbre", routeTarget);
            target.timbreBipolar = routeBipolar(modulation, "timbre", routeTarget, false);
            target.macro1 = routeAmount(modulation, "macro.1", routeTarget);
            target.macro2 = routeAmount(modulation, "macro.2", routeTarget);
            target.macro3 = routeAmount(modulation, "macro.3", routeTarget);
            target.macro4 = routeAmount(modulation, "macro.4", routeTarget);
            target.macro5 = routeAmount(modulation, "macro.5", routeTarget);
            target.macro6 = routeAmount(modulation, "macro.6", routeTarget);
            target.macro7 = routeAmount(modulation, "macro.7", routeTarget);
            target.macro8 = routeAmount(modulation, "macro.8", routeTarget);
            return std::abs(target.lfo) > 0.0001f
                || std::abs(target.lfo2) > 0.0001f
                || std::any_of(target.extraLfo.begin(), target.extraLfo.end(), [](float value) { return std::abs(value) > 0.0001f; })
                || std::abs(target.env) > 0.0001f
                || std::abs(target.env2) > 0.0001f
                || std::abs(target.env3) > 0.0001f
                || std::abs(target.env4) > 0.0001f
                || std::abs(target.velocity) > 0.0001f
                || std::abs(target.keytrack) > 0.0001f
                || std::abs(target.modWheel) > 0.0001f
                || std::abs(target.pressure) > 0.0001f
                || std::abs(target.timbre) > 0.0001f
                || std::abs(target.macro1) > 0.0001f
                || std::abs(target.macro2) > 0.0001f
                || std::abs(target.macro3) > 0.0001f
                || std::abs(target.macro4) > 0.0001f
                || std::abs(target.macro5) > 0.0001f
                || std::abs(target.macro6) > 0.0001f
                || std::abs(target.macro7) > 0.0001f
                || std::abs(target.macro8) > 0.0001f;
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
            active |= configureDynamicTarget(dynamicModulation.oscAUnisonDetune, modulation, "osc.a.unison.detune", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.oscAUnisonSpread, modulation, "osc.a.unison.spread", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.oscBUnisonDetune, modulation, "osc.b.unison.detune", lfoEnabled, lfo2Enabled);
            active |= configureDynamicTarget(dynamicModulation.oscBUnisonSpread, modulation, "osc.b.unison.spread", lfoEnabled, lfo2Enabled);
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

    int synthWavetableWarpModeForId(const juce::String& id)
    {
        if (id == "fold") return 1;
        if (id == "pinch") return 2;
        if (id == "mirror") return 3;
        return 0;
    }

    bool applySynthPatchContract(const juce::var& patch, InstrumentDefinition& instrument)
    {
        if (!patch.isObject()) return false;
        const auto instrumentType = objectProperty(patch, "instrumentType", {}).toString();
        const bool isAether = instrumentType == params::instrumentTypeWavetableSynth.data();
        const bool isLumus = instrumentType == params::instrumentTypeLumusHybridSynth.data();
        if (!isAether && !isLumus) return false;
        const auto patchNamespace = objectProperty(patch, "namespace", {});
        if (isLumus)
        {
            const auto schemaVersion = objectProperty(patch, "schemaVersion", {});
            if ((!schemaVersion.isInt() && !schemaVersion.isInt64())
                || (int) schemaVersion != params::lumusPatchSchemaVersion
                || patchNamespace.toString() != "lumus")
                return false;
        }
        else if (!patchNamespace.isVoid() && patchNamespace.toString().isNotEmpty()
                 && patchNamespace.toString() != params::synthNamespace.data())
        {
            return false;
        }

        const auto params = objectProperty(patch, "parameters", {});
        if (!params.isObject()) return false;
        const auto modulation = objectProperty(patch, "modulation", {});
        const auto metadata = objectProperty(patch, "metadata", {});
        const auto customWavetables = mergedWavemapMetadata(metadata);

        instrument.kind = "wavetable";
        instrument.synthEngine = isLumus
            ? InstrumentDefinition::SynthEngine::Lumus
            : InstrumentDefinition::SynthEngine::Aether;
        instrument.waveform = 5;
        instrument.maxVoices = juce::jlimit(1, 32, (int) std::round(synthNumberParam(params, "maxVoices", instrument.maxVoices)));
        instrument.mono = synthNumberParam(params, "mono.enabled", instrument.mono ? 1.0 : 0.0) >= 0.5;
        instrument.legato = synthNumberParam(params, "legato.enabled", instrument.legato ? 1.0 : 0.0) >= 0.5;
        instrument.wavetableBank = synthWavetableBankForId(synthStringParam(params, "osc.a.wavetable", "basic.saw"));
        instrument.wavetablePosition = juce::jlimit(
            0.0f,
            1.0f,
            (float) synthNumberParam(params, "osc.a.position", instrument.wavetablePosition));
        instrument.wavetableWarp = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "osc.a.warp", instrument.wavetableWarp));
        instrument.wavetableWarpMode = synthWavetableWarpModeForId(synthStringParam(params, "osc.a.warpMode", "shape"));
        const bool unisonEnabled = synthNumberParam(params, "unison.enabled", 0.0) >= 0.5;
        instrument.wavetableUnison = unisonEnabled
            ? juce::jlimit(1, WavetableUnison::maxVoices, (int) std::round(synthNumberParam(params, "unison.voices", instrument.wavetableUnison)))
            : 1;
        instrument.wavetableDetuneCents = unisonEnabled
            ? juce::jlimit(
                0.0f,
                100.0f,
                (float) synthNumberParam(params, "unison.detune", 0.12) * 100.0f)
            : 0.0f;
        instrument.wavetableBlend = unisonEnabled
            ? juce::jlimit(
                0.0f,
                1.0f,
                (float) synthNumberParam(params, "unison.spread", synthNumberParam(params, "unison.blend", instrument.wavetableBlend)))
            : 0.0f;

        InstrumentDefinition::WavetableConfig baseWavetable;
        baseWavetable.bank = instrument.wavetableBank;
        baseWavetable.position = instrument.wavetablePosition;
        baseWavetable.warp = instrument.wavetableWarp;
        baseWavetable.warpMode = instrument.wavetableWarpMode;
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
        instrument.aether.oscA = synthOscillatorConfig(params, modulation, metadata, customWavetables, "a", oscA);
        instrument.aether.oscB = synthOscillatorConfig(params, modulation, metadata, customWavetables, "b", oscB);
        const auto sourceRoute = [](const juce::String& route) { return route == "direct" ? 1 : route == "filter1" ? 2 : route == "filter2" ? 3 : 0; };
        instrument.aether.sub.routing = sourceRoute(synthStringParam(params, "aether.sub.route", "filter"));
        instrument.aether.noise.routing = sourceRoute(synthStringParam(params, "aether.noise.route", "filter"));
        instrument.aether.sampleSlot1.schemaVersion = 4;
        instrument.aether.sampleSlot1.audioFileId = synthStringParam(params, "aether.sample.1.audioFileId", "");
        const bool requestedSampleSlotEnabled = synthNumberParam(params, "aether.sample.1.enabled", 0.0) >= 0.5;
        instrument.aether.sampleSlot1.enabled = requestedSampleSlotEnabled
            && instrument.aether.sampleSlot1.audioFileId.isNotEmpty();
        instrument.aether.sampleSlot1.rootNote = juce::jlimit(0, 127,
            (int) std::round(synthNumberParam(params, "aether.sample.1.rootNote", 60.0)));
        instrument.aether.sampleSlot1.level = juce::jlimit(0.0f, 1.0f,
            (float) synthNumberParam(params, "aether.sample.1.level", 0.8));
        instrument.aether.sampleSlot1.pan = juce::jlimit(-1.0f, 1.0f,
            (float) synthNumberParam(params, "aether.sample.1.pan", 0.0));
        instrument.aether.sampleSlot1.routing = sourceRoute(
            synthStringParam(params, "aether.sample.1.route", "filter"));
        instrument.aether.sampleSlot1.startRatio = juce::jlimit(0.0f, 1.0f,
            (float) synthNumberParam(params, "aether.sample.1.start", 0.0));
        instrument.aether.sampleSlot1.endRatio = juce::jlimit(0.0f, 1.0f,
            (float) synthNumberParam(params, "aether.sample.1.end", 1.0));
        instrument.aether.sampleSlot1.loopEnabled = synthNumberParam(params, "aether.sample.1.loop.enabled", 0.0) >= 0.5;
        instrument.aether.sampleSlot1.loopStartRatio = juce::jlimit(0.0f, 1.0f,
            (float) synthNumberParam(params, "aether.sample.1.loop.start", 0.0));
        instrument.aether.sampleSlot1.loopEndRatio = juce::jlimit(0.0f, 1.0f,
            (float) synthNumberParam(params, "aether.sample.1.loop.end", 1.0));
        instrument.aether.sampleSlot1.fxSends[0] = juce::jlimit(0.0f, 1.0f,
            (float) synthNumberParam(params, "aether.sample.1.fxSend1", 0.0));
        instrument.aether.sampleSlot1.fxSends[1] = juce::jlimit(0.0f, 1.0f,
            (float) synthNumberParam(params, "aether.sample.1.fxSend2", 0.0));
        if (instrument.aether.sampleSlot1.endRatio <= instrument.aether.sampleSlot1.startRatio)
        {
            instrument.aether.sampleSlot1.startRatio = 0.0f;
            instrument.aether.sampleSlot1.endRatio = 1.0f;
        }
        if (instrument.aether.sampleSlot1.loopStartRatio < instrument.aether.sampleSlot1.startRatio
            || instrument.aether.sampleSlot1.loopEndRatio > instrument.aether.sampleSlot1.endRatio
            || instrument.aether.sampleSlot1.loopEndRatio <= instrument.aether.sampleSlot1.loopStartRatio)
            instrument.aether.sampleSlot1.loopEnabled = false;
        if (const auto* mappedZones = objectProperty(metadata, "sampleSlot1Zones", {}).getArray())
        {
            for (int index = 0; index < juce::jmin(8, mappedZones->size()); ++index)
            {
                const auto& mapped = mappedZones->getReference(index);
                if (!mapped.isObject()) continue;
                InstrumentDefinition::AetherSampleSlot::Zone zone;
                zone.audioFileId = mapped.getProperty("audioFileId", "").toString();
                zone.rootNote = juce::jlimit(0, 127, (int) mapped.getProperty("rootNote", 60));
                zone.loNote = juce::jlimit(0, 127, (int) mapped.getProperty("loNote", 0));
                zone.hiNote = juce::jlimit(zone.loNote, 127, (int) mapped.getProperty("hiNote", 127));
                zone.loVelocity = juce::jlimit(0, 127, (int) mapped.getProperty("loVelocity", 0));
                zone.hiVelocity = juce::jlimit(zone.loVelocity, 127, (int) mapped.getProperty("hiVelocity", 127));
                zone.level = juce::jlimit(0.0f, 1.0f, (float) (double) mapped.getProperty("level", 0.8));
                zone.pan = juce::jlimit(-1.0f, 1.0f, (float) (double) mapped.getProperty("pan", 0.0));
                zone.startRatio = juce::jlimit(0.0f, 1.0f, (float) (double) mapped.getProperty("startRatio", 0.0));
                zone.endRatio = juce::jlimit(zone.startRatio, 1.0f, (float) (double) mapped.getProperty("endRatio", 1.0));
                zone.loopEnabled = (bool) mapped.getProperty("loopEnabled", false);
                zone.loopStartRatio = juce::jlimit(zone.startRatio, zone.endRatio, (float) (double) mapped.getProperty("loopStartRatio", zone.startRatio));
                zone.loopEndRatio = juce::jlimit(zone.loopStartRatio, zone.endRatio, (float) (double) mapped.getProperty("loopEndRatio", zone.endRatio));
                if (zone.audioFileId.isNotEmpty()) instrument.aether.sampleSlot1.zones.push_back(std::move(zone));
            }
        }
        instrument.aether.sampleSlot1.enabled = requestedSampleSlotEnabled
            && (instrument.aether.sampleSlot1.audioFileId.isNotEmpty()
                || !instrument.aether.sampleSlot1.zones.empty());
        auto& granular = instrument.aether.granularSlot2;
        granular.schemaVersion = 1;
        granular.builtinSource = synthStringParam(params, "aether.granular.2.builtinSource", "");
        if (granular.builtinSource != "benchmark") granular.builtinSource.clear();
        granular.rootNote = juce::jlimit(0, 127, (int) std::round(synthNumberParam(params, "aether.granular.2.rootNote", 60.0)));
        granular.level = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "aether.granular.2.level", 0.7));
        granular.routing = sourceRoute(synthStringParam(params, "aether.granular.2.route", "filter"));
        granular.position = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "aether.granular.2.position", 0.5));
        granular.positionSpread = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "aether.granular.2.positionSpread", 0.1));
        granular.grainMilliseconds = juce::jlimit(2.0f, 1000.0f, (float) synthNumberParam(params, "aether.granular.2.grainMilliseconds", 80.0));
        granular.densityHz = juce::jlimit(0.1f, 200.0f, (float) synthNumberParam(params, "aether.granular.2.densityHz", 12.0));
        granular.pitchSemitones = juce::jlimit(-48.0f, 48.0f, (float) synthNumberParam(params, "aether.granular.2.pitchSemitones", 0.0));
        granular.stereoSpread = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "aether.granular.2.stereoSpread", 0.5));
        granular.randomSeed = (uint32_t) juce::jlimit(1.0, 4294967295.0,
            synthNumberParam(params, "aether.granular.2.randomSeed", 1.0));
        granular.fxSends[0] = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "aether.granular.2.fxSend1", 0.0));
        granular.fxSends[1] = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "aether.granular.2.fxSend2", 0.0));
        const auto managedGranular = objectProperty(metadata, "managedGranular", {});
        if (managedGranular.isObject() && (int) managedGranular.getProperty("schemaVersion", 0) <= 1)
        {
            granular.managedAsset.assetId = managedGranular.getProperty("assetId", {}).toString();
            granular.managedAsset.displayName = managedGranular.getProperty("displayName", {}).toString();
            granular.managedAsset.manifestPath = managedGranular.getProperty("manifestPath", {}).toString();
            granular.managedAsset.audioPath = managedGranular.getProperty("audioPath", {}).toString();
        }
        granular.enabled = synthNumberParam(params, "aether.granular.2.enabled", 0.0) >= 0.5
            && (granular.builtinSource.isNotEmpty() || granular.managedAsset.manifestPath.isNotEmpty());
        instrument.aether.sub.fxSends[0] = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "aether.sub.fxSend1", 0.0));
        instrument.aether.sub.fxSends[1] = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "aether.sub.fxSend2", 0.0));
        instrument.aether.noise.fxSends[0] = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "aether.noise.fxSend1", 0.0));
        instrument.aether.noise.fxSends[1] = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "aether.noise.fxSend2", 0.0));
        instrument.aether.fxBusIds[0] = synthStringParam(params, "aether.fxBus1Id", "");
        instrument.aether.fxBusIds[1] = synthStringParam(params, "aether.fxBus2Id", "");
        instrument.aether.runtimeWarp = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "aether.runtimeWarp", 0.0));
        instrument.aether.runtimeWarpMode = synthRuntimeWarpModeForId(synthStringParam(params, "aether.runtimeWarpMode", "shape"));
        instrument.aether.runtimeWarp2 = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "aether.runtimeWarp2", 0.0));
        instrument.aether.runtimeWarp2Mode = synthRuntimeWarpModeForId(synthStringParam(params, "aether.runtimeWarp2Mode", "shape"));
        const auto interactionMode = synthStringParam(params, "aether.interaction.mode", "off");
        instrument.aether.interactionMode = interactionMode == "am" ? 1 : interactionMode == "ring" ? 2 : 0;
        instrument.aether.interactionAmount = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "aether.interaction.amount", 0.0));
        instrument.aether.memberExpressionZone.enabled = synthNumberParam(params, "aether.mpe.enabled", 0.0) >= 0.5;
        instrument.aether.memberExpressionZone.schemaVersion = 1;
        instrument.aether.memberExpressionZone.masterChannel = juce::jlimit(1, 16, (int) std::round(synthNumberParam(params, "aether.mpe.masterChannel", 1.0)));
        instrument.aether.memberExpressionZone.firstMemberChannel = juce::jlimit(1, 16, (int) std::round(synthNumberParam(params, "aether.mpe.firstMemberChannel", 2.0)));
        instrument.aether.memberExpressionZone.lastMemberChannel = juce::jlimit(1, 16, (int) std::round(synthNumberParam(params, "aether.mpe.lastMemberChannel", 16.0)));
        if (instrument.aether.memberExpressionZone.firstMemberChannel > instrument.aether.memberExpressionZone.lastMemberChannel)
            std::swap(instrument.aether.memberExpressionZone.firstMemberChannel, instrument.aether.memberExpressionZone.lastMemberChannel);
        if (instrument.aether.memberExpressionZone.masterChannel >= instrument.aether.memberExpressionZone.firstMemberChannel
            && instrument.aether.memberExpressionZone.masterChannel <= instrument.aether.memberExpressionZone.lastMemberChannel)
            instrument.aether.memberExpressionZone.enabled = false;

        const bool filterEnabled = synthNumberParam(params, "filter.enabled", 1.0) >= 0.5;
        instrument.filterType = parseSynthFilterType(synthStringParam(params, "filter.type", "lowpass"));
        instrument.cutoff01 = filterEnabled
            ? juce::jlimit(0.0f, 1.0f, cutoffHzTo01(synthNumberParam(params, "filter.cutoff", 18000.0)))
            : 1.0f;
        instrument.filterKeytrack = filterEnabled
            ? juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "filter.keytrack", instrument.filterKeytrack))
            : 0.0f;
        instrument.resonance01 = filterEnabled
            ? juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "filter.resonance", instrument.resonance01))
            : 0.0f;
        instrument.drive01 = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "filter.drive", instrument.drive01));
        instrument.filter2Enabled = synthNumberParam(params, "filter.2.enabled", 0.0) >= 0.5;
        instrument.filter2Type = parseSynthFilterType(synthStringParam(params, "filter.2.type", "lowpass"));
        instrument.filter2Cutoff01 = juce::jlimit(0.0f, 1.0f, cutoffHzTo01(synthNumberParam(params, "filter.2.cutoff", 18000.0)));
        instrument.filter2Resonance01 = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "filter.2.resonance", 0.1));
        instrument.filter2Drive01 = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "filter.2.drive", 0.0));
        instrument.filterRouting = synthStringParam(params, "filter.routing", "serial") == "parallel" ? 1 : 0;
        instrument.attackMs = juce::jlimit(0.0f, 30000.0f, (float) synthNumberParam(params, "env.1.attack", 0.005) * 1000.0f);
        instrument.attackCurve = envelopeCurveForId(synthStringParam(params, "env.1.attackCurve", "linear"));
        instrument.decayMs = juce::jlimit(0.0f, 30000.0f, (float) synthNumberParam(params, "env.1.decay", 0.15) * 1000.0f);
        instrument.decayCurve = envelopeCurveForId(synthStringParam(params, "env.1.decayCurve", "linear"));
        instrument.sustain = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "env.1.sustain", instrument.sustain));
        instrument.releaseMs = juce::jlimit(0.0f, 30000.0f, (float) synthNumberParam(params, "env.1.release", 0.25) * 1000.0f);
        instrument.releaseCurve = envelopeCurveForId(synthStringParam(params, "env.1.releaseCurve", "linear"));
        instrument.env1Loop = synthNumberParam(params, "env.1.loop", instrument.env1Loop ? 1.0 : 0.0) >= 0.5;
        instrument.env2AttackMs = juce::jlimit(0.0f, 30000.0f, (float) synthNumberParam(params, "env.2.attack", 0.01) * 1000.0f);
        instrument.env2AttackCurve = envelopeCurveForId(synthStringParam(params, "env.2.attackCurve", "linear"));
        instrument.env2DecayMs = juce::jlimit(0.0f, 30000.0f, (float) synthNumberParam(params, "env.2.decay", 0.3) * 1000.0f);
        instrument.env2DecayCurve = envelopeCurveForId(synthStringParam(params, "env.2.decayCurve", "linear"));
        instrument.env2Sustain = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "env.2.sustain", 0.0));
        instrument.env2ReleaseMs = juce::jlimit(0.0f, 30000.0f, (float) synthNumberParam(params, "env.2.release", 0.2) * 1000.0f);
        instrument.env2ReleaseCurve = envelopeCurveForId(synthStringParam(params, "env.2.releaseCurve", "linear"));
        instrument.env2Loop = synthNumberParam(params, "env.2.loop", instrument.env2Loop ? 1.0 : 0.0) >= 0.5;
        const auto applyExtraEnvelope = [&](int index, float& attack, int& attackCurve, float& decay, int& decayCurve,
                                             float& sustain, float& release, int& releaseCurve, bool& loop)
        {
            const auto prefix = "env." + juce::String(index) + ".";
            attack = juce::jlimit(0.0f, 30000.0f, (float) synthNumberParam(params, prefix + "attack", 0.01) * 1000.0f);
            attackCurve = envelopeCurveForId(synthStringParam(params, prefix + "attackCurve", "linear"));
            decay = juce::jlimit(0.0f, 30000.0f, (float) synthNumberParam(params, prefix + "decay", 0.3) * 1000.0f);
            decayCurve = envelopeCurveForId(synthStringParam(params, prefix + "decayCurve", "linear"));
            sustain = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "sustain", 0.0));
            release = juce::jlimit(0.0f, 30000.0f, (float) synthNumberParam(params, prefix + "release", 0.2) * 1000.0f);
            releaseCurve = envelopeCurveForId(synthStringParam(params, prefix + "releaseCurve", "linear"));
            loop = synthNumberParam(params, prefix + "loop", loop ? 1.0 : 0.0) >= 0.5;
        };
        applyExtraEnvelope(3, instrument.env3AttackMs, instrument.env3AttackCurve, instrument.env3DecayMs, instrument.env3DecayCurve,
            instrument.env3Sustain, instrument.env3ReleaseMs, instrument.env3ReleaseCurve, instrument.env3Loop);
        applyExtraEnvelope(4, instrument.env4AttackMs, instrument.env4AttackCurve, instrument.env4DecayMs, instrument.env4DecayCurve,
            instrument.env4Sustain, instrument.env4ReleaseMs, instrument.env4ReleaseCurve, instrument.env4Loop);
        instrument.ampLevel = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "amp.level", instrument.ampLevel));
        instrument.ampPan = juce::jlimit(-1.0f, 1.0f, (float) synthNumberParam(params, "amp.pan", instrument.ampPan));
        instrument.lfoWaveform = parseSynthLfoWaveform(synthStringParam(params, "lfo.1.shape", "sine"));
        instrument.lfoRateHz = juce::jlimit(0.01f, 50.0f, (float) synthNumberParam(params, "lfo.1.rate", instrument.lfoRateHz));
        instrument.lfoSync = synthNumberParam(params, "lfo.1.sync", instrument.lfoSync ? 1.0 : 0.0) >= 0.5;
        instrument.lfoSyncedRate = synthStringParam(params, "lfo.1.syncedRate", instrument.lfoSyncedRate);
        instrument.lfoSmoothing = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "lfo.1.smoothing", instrument.lfoSmoothing));
        instrument.lfoRandomPhase = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "lfo.1.randomPhase", instrument.lfoRandomPhase));
        instrument.lfoPhaseOffset = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "lfo.1.phase", instrument.lfoPhaseOffset));
        instrument.lfoRetrigger = synthNumberParam(params, "lfo.1.retrigger", instrument.lfoRetrigger ? 1.0 : 0.0) >= 0.5;
        instrument.lfoOneShot = synthNumberParam(params, "lfo.1.oneShot", instrument.lfoOneShot ? 1.0 : 0.0) >= 0.5;
        instrument.lfo2Enabled = synthNumberParam(params, "lfo.2.enabled", instrument.lfo2Enabled ? 1.0 : 0.0) >= 0.5;
        instrument.lfo2Waveform = parseSynthLfoWaveform(synthStringParam(params, "lfo.2.shape", "triangle"));
        instrument.lfo2RateHz = juce::jlimit(0.01f, 50.0f, (float) synthNumberParam(params, "lfo.2.rate", instrument.lfo2RateHz));
        instrument.lfo2Sync = synthNumberParam(params, "lfo.2.sync", instrument.lfo2Sync ? 1.0 : 0.0) >= 0.5;
        instrument.lfo2SyncedRate = synthStringParam(params, "lfo.2.syncedRate", instrument.lfo2SyncedRate);
        instrument.lfo2Smoothing = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "lfo.2.smoothing", instrument.lfo2Smoothing));
        instrument.lfo2RandomPhase = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "lfo.2.randomPhase", instrument.lfo2RandomPhase));
        instrument.lfo2PhaseOffset = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, "lfo.2.phase", instrument.lfo2PhaseOffset));
        instrument.lfo2Retrigger = synthNumberParam(params, "lfo.2.retrigger", instrument.lfo2Retrigger ? 1.0 : 0.0) >= 0.5;
        instrument.lfo2OneShot = synthNumberParam(params, "lfo.2.oneShot", instrument.lfo2OneShot ? 1.0 : 0.0) >= 0.5;
        for (size_t index = 0; index < instrument.extraLfos.size(); ++index)
        {
            auto& lfo = instrument.extraLfos[index];
            const auto prefix = "lfo." + juce::String((int) index + 3) + ".";
            lfo.enabled = synthNumberParam(params, prefix + "enabled", 0.0) >= 0.5;
            lfo.waveform = parseSynthLfoWaveform(synthStringParam(params, prefix + "shape", "sine"));
            lfo.rateHz = juce::jlimit(0.01f, 50.0f, (float) synthNumberParam(params, prefix + "rate", 1.0));
            lfo.sync = synthNumberParam(params, prefix + "sync", 0.0) >= 0.5;
            lfo.syncedRate = synthStringParam(params, prefix + "syncedRate", "1/4");
            lfo.smoothing = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "smoothing", 0.0));
            lfo.randomPhase = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "randomPhase", 0.0));
            lfo.phaseOffset = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "phase", 0.0));
            lfo.retrigger = synthNumberParam(params, prefix + "retrigger", 1.0) >= 0.5;
            lfo.oneShot = synthNumberParam(params, prefix + "oneShot", 0.0) >= 0.5;
        }

        const bool lfoEnabled = synthNumberParam(params, "lfo.1.enabled", 1.0) >= 0.5;
        instrument.lfoDepth = lfoEnabled ? std::abs(routeAmount(modulation, "lfo.1", "osc.a.position")) : 0.0f;
        instrument.lfoToPitch = lfoEnabled ? std::abs(routeAmount(modulation, "lfo.1", "osc.a.fine")) * 12.0f : 0.0f;
        instrument.lfoToFilter = lfoEnabled ? routeAmount(modulation, "lfo.1", "filter.cutoff") : 0.0f;
        instrument.lfoPositionBipolar = routeBipolar(modulation, "lfo.1", "osc.a.position", true);
        instrument.lfoPitchBipolar = routeBipolar(modulation, "lfo.1", "osc.a.fine", true);
        instrument.lfoFilterBipolar = routeBipolar(modulation, "lfo.1", "filter.cutoff", true);
        instrument.envToFilter = routeAmount(modulation, "env.1", "filter.cutoff");
        instrument.macroValues = {
            macroSourceValue(params, metadata, "macro.1"),
            macroSourceValue(params, metadata, "macro.2"),
            macroSourceValue(params, metadata, "macro.3"),
            macroSourceValue(params, metadata, "macro.4"),
            macroSourceValue(params, metadata, "macro.5"),
            macroSourceValue(params, metadata, "macro.6"),
            macroSourceValue(params, metadata, "macro.7"),
            macroSourceValue(params, metadata, "macro.8"),
        };
        configureDynamicModulation(instrument.dynamicModulation, modulation, lfoEnabled, instrument.lfo2Enabled);
        return true;
    }
}

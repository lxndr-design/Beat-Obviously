#include "SynthPatchContract.h"
#include "ParameterIds.h"
#include "../Wavetable/WavetableUnisonConfig.h"

#include <array>
#include <cmath>
#include <set>
#include <utility>

namespace beat
{
    int synthWavetableBankForId(const juce::String& id);
    int synthWavetableWarpModeForId(const juce::String& id, bool allowSpectral = false);

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

        juce::String canonicalLumenId(const juce::String& value)
        {
            return value.startsWith("lumus.") ? juce::String("lumen.") + value.substring(6) : value;
        }

        juce::var canonicalizeLegacyLumusObjectKeys(const juce::var& source)
        {
            auto* result = new juce::DynamicObject();
            if (auto* object = source.getDynamicObject())
            {
                for (const auto& pair : object->getProperties())
                {
                    const auto name = pair.name.toString();
                    if (name.startsWith("lumus."))
                        result->setProperty(canonicalLumenId(name), pair.value);
                }
                for (const auto& pair : object->getProperties())
                {
                    const auto name = pair.name.toString();
                    if (!name.startsWith("lumus."))
                        result->setProperty(pair.name, pair.value);
                }
            }
            return juce::var(result);
        }

        juce::var canonicalizeLegacyLumusModulation(const juce::var& source)
        {
            juce::Array<juce::var> result;
            if (const auto* routes = source.getArray())
                for (const auto& route : *routes)
                {
                    if (!route.isObject())
                    {
                        result.add(route);
                        continue;
                    }
                    auto* canonicalRoute = new juce::DynamicObject();
                    copyObjectProperties(*canonicalRoute, route);
                    for (const auto property : { "source", "target" })
                    {
                        const auto value = objectProperty(route, property, {});
                        if (value.isString())
                            canonicalRoute->setProperty(property, canonicalLumenId(value.toString()));
                    }
                    result.add(juce::var(canonicalRoute));
                }
            return juce::var(result);
        }

        juce::var canonicalizeLegacyLumusSynthPatch(const juce::var& source)
        {
            if (!source.isObject()) return source;
            const auto instrumentType = objectProperty(source, "instrumentType", {}).toString();
            const auto patchNamespace = objectProperty(source, "namespace", {}).toString();
            const bool legacyIdentity = instrumentType == params::legacyInstrumentTypeLumusHybridSynth.data()
                || patchNamespace == params::legacyLumusNamespace.data();
            const auto parameters = objectProperty(source, "parameters", {});
            const auto metadata = objectProperty(source, "metadata", {});
            bool legacyKeys = false;
            if (auto* object = parameters.getDynamicObject())
                for (const auto& pair : object->getProperties())
                    legacyKeys = legacyKeys || pair.name.toString().startsWith("lumus.");
            if (auto* object = metadata.getDynamicObject())
                legacyKeys = legacyKeys
                    || object->hasProperty("lumusSourceRack")
                    || object->hasProperty("lumusSampleSlots")
                    || object->hasProperty("lumusGranularSlots")
                    || object->hasProperty("lumusClip");
            if (!legacyIdentity && !legacyKeys) return source;

            auto* patch = new juce::DynamicObject();
            copyObjectProperties(*patch, source);
            if (instrumentType == params::legacyInstrumentTypeLumusHybridSynth.data())
                patch->setProperty("instrumentType", params::instrumentTypeLumenHybridSynth.data());
            if (patchNamespace == params::legacyLumusNamespace.data())
                patch->setProperty("namespace", params::lumenNamespace.data());
            if (parameters.isObject())
                patch->setProperty("parameters", canonicalizeLegacyLumusObjectKeys(parameters));
            const auto modulation = objectProperty(source, "modulation", {});
            if (modulation.isArray())
                patch->setProperty("modulation", canonicalizeLegacyLumusModulation(modulation));

            if (metadata.isObject())
            {
                auto* canonicalMetadata = new juce::DynamicObject();
                copyObjectProperties(*canonicalMetadata, metadata);
                constexpr std::array<std::pair<const char*, const char*>, 4> aliases {{
                    { "lumusSourceRack", "lumenSourceRack" },
                    { "lumusSampleSlots", "lumenSampleSlots" },
                    { "lumusGranularSlots", "lumenGranularSlots" },
                    { "lumusClip", "lumenClip" },
                }};
                for (const auto& [legacyName, canonicalName] : aliases)
                    if (!canonicalMetadata->hasProperty(canonicalName)
                        && metadata.getDynamicObject()->hasProperty(legacyName))
                        canonicalMetadata->setProperty(canonicalName, objectProperty(metadata, legacyName, {}));
                patch->setProperty("metadata", juce::var(canonicalMetadata));
            }
            return juce::var(patch);
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

        uint8_t routeCurve(const juce::var& modulation, const juce::String& source, const juce::String& target)
        {
            if (auto* routes = modulation.getArray())
            {
                for (const auto& route : *routes)
                {
                    if (!route.isObject()) continue;
                    if (!(bool) objectProperty(route, "enabled", true)) continue;
                    if (objectProperty(route, "source", {}).toString() != source) continue;
                    if (objectProperty(route, "target", {}).toString() != target) continue;
                    const auto curve = objectProperty(route, "curve", "linear").toString();
                    if (curve == "ease-in") return 1;
                    if (curve == "ease-out") return 2;
                    if (curve == "s-curve") return 3;
                    return 0;
                }
            }
            return 0;
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
            bool allowSpectralWarp,
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
            fallback.warpMode = synthWavetableWarpModeForId(
                synthStringParam(params, prefix + "warpMode", "shape"),
                allowSpectralWarp);
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
            bool allowSpectralWarp,
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
            fallback.routing = route == "direct" ? 1 : route == "filter1" ? 2 : route == "filter2" ? 3 : route == "none" ? 4 : 0;
            fallback.phase = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "phase", fallback.phase));
            fallback.randomPhase = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "randomPhase", fallback.randomPhase));
            fallback.fxSends[0] = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "fxSend1", fallback.fxSends[0]));
            fallback.fxSends[1] = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "fxSend2", fallback.fxSends[1]));
            fallback.wavetable = synthWavetableConfig(
                params, modulation, metadata, customWavetables, oscillator, allowSpectralWarp, fallback.wavetable);
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
            target.curves[0] = routeCurve(modulation, "lfo.1", routeTarget);
            target.curves[1] = routeCurve(modulation, "lfo.2", routeTarget);
            for (size_t index = 0; index < target.extraLfo.size(); ++index)
                target.curves[index + 2] = routeCurve(modulation, "lfo." + juce::String((int) index + 3), routeTarget);
            target.curves[10] = routeCurve(modulation, "env.1", routeTarget);
            target.curves[11] = routeCurve(modulation, "env.2", routeTarget);
            target.curves[12] = routeCurve(modulation, "env.3", routeTarget);
            target.curves[13] = routeCurve(modulation, "env.4", routeTarget);
            target.curves[14] = routeCurve(modulation, "velocity", routeTarget);
            target.curves[15] = routeCurve(modulation, "keytrack", routeTarget);
            target.curves[16] = routeCurve(modulation, "modWheel", routeTarget);
            target.curves[17] = routeCurve(modulation, "pressure", routeTarget);
            target.curves[18] = routeCurve(modulation, "timbre", routeTarget);
            for (size_t index = 0; index < 8; ++index)
                target.curves[index + 19] = routeCurve(modulation, "macro." + juce::String((int) index + 1), routeTarget);
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
            bool lfo2Enabled,
            bool includeLumenTargets)
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
            if (includeLumenTargets)
            {
                active |= configureDynamicTarget(dynamicModulation.oscCPosition, modulation, "osc.c.position", lfoEnabled, lfo2Enabled);
                active |= configureDynamicTarget(dynamicModulation.oscCFine, modulation, "osc.c.fine", lfoEnabled, lfo2Enabled);
                active |= configureDynamicTarget(dynamicModulation.oscCLevel, modulation, "osc.c.level", lfoEnabled, lfo2Enabled);
                active |= configureDynamicTarget(dynamicModulation.oscCPan, modulation, "osc.c.pan", lfoEnabled, lfo2Enabled);
                active |= configureDynamicTarget(dynamicModulation.oscCUnisonDetune, modulation, "osc.c.unison.detune", lfoEnabled, lfo2Enabled);
                active |= configureDynamicTarget(dynamicModulation.oscCUnisonSpread, modulation, "osc.c.unison.spread", lfoEnabled, lfo2Enabled);
            }
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

    int synthWavetableWarpModeForId(const juce::String& id, bool allowSpectral)
    {
        if (id == "fold") return 1;
        if (id == "pinch") return 2;
        if (id == "mirror") return 3;
        if (allowSpectral && id == "harmonic-shift") return 4;
        if (allowSpectral && id == "harmonic-stretch") return 5;
        if (allowSpectral && id == "spectral-smear") return 6;
        if (allowSpectral && id == "spectral-skew") return 7;
        if (allowSpectral && id == "spectral-filter") return 8;
        return 0;
    }

    juce::var normalizeAurumModulationContract(const juce::var& modulation, int aurumVersion)
    {
        juce::Array<juce::var> normalized;
        auto* routes = modulation.getArray();
        if (routes == nullptr) return juce::var(normalized);
        const juce::StringArray allowedSources {
            "lfo.1", "env.1", "macro.1", "macro.2", "velocity", "keytrack", "modWheel", "pressure"
        };
        std::set<juce::String> ids;
        for (const auto& route : *routes)
        {
            if (!route.isObject() || normalized.size() >= 8) continue;
            const auto id = objectProperty(route, "id", {}).toString().trim().substring(0, 64);
            const auto source = objectProperty(route, "source", {}).toString();
            const auto target = objectProperty(route, "target", {}).toString();
            const auto amountValue = objectProperty(route, "amount", {});
            if (!amountValue.isInt() && !amountValue.isInt64() && !amountValue.isDouble()) continue;
            bool targetAllowed = target == "amp.level" || target == "amp.pan";
            if (aurumVersion >= 12)
            {
                targetAllowed = targetAllowed
                    || target == "aurum.filter.a.cutoff"
                    || target == "aurum.filter.b.cutoff";
                for (int index = 1; index <= 6 && !targetAllowed; ++index)
                    targetAllowed = target == juce::String("aurum.op.") + juce::String(index) + ".level"
                        || target == juce::String("aurum.op.") + juce::String(index) + ".pan";
            }
            if (aurumVersion >= 13)
                targetAllowed = targetAllowed
                    || target == "aurum.filter.a.resonance"
                    || target == "aurum.filter.a.drive"
                    || target == "aurum.filter.b.resonance"
                    || target == "aurum.filter.b.drive";
            const double amount = (double) amountValue;
            if (id.isEmpty() || ids.contains(id) || !allowedSources.contains(source)
                || !targetAllowed || !std::isfinite(amount))
                continue;
            ids.insert(id);
            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("id", id);
            object->setProperty("source", source);
            object->setProperty("target", target);
            object->setProperty("amount", juce::jlimit(-1.0, 1.0, amount));
            object->setProperty("bipolar", (bool) objectProperty(route, "bipolar", false));
            object->setProperty("enabled", (bool) objectProperty(route, "enabled", true));
            const auto curve = objectProperty(route, "curve", "linear").toString();
            object->setProperty("curve", curve == "ease-in" || curve == "ease-out" || curve == "s-curve" ? curve : "linear");
            normalized.add(juce::var(object.get()));
        }
        return juce::var(normalized);
    }

    bool applyAurumModulationContract(const juce::var& aurum, InstrumentDefinition& instrument)
    {
        if (!aurum.isObject()) return false;
        const int aurumVersion = (int) objectProperty(aurum, "version", 0);
        const auto modulation = normalizeAurumModulationContract(objectProperty(aurum, "modulation", {}), aurumVersion);
        instrument.aurum.modulation = modulation;
        instrument.dynamicModulation = {};
        bool active = false;
        active |= configureDynamicTarget(instrument.dynamicModulation.ampLevel, modulation, "amp.level", true, instrument.lfo2Enabled);
        active |= configureDynamicTarget(instrument.dynamicModulation.ampPan, modulation, "amp.pan", true, instrument.lfo2Enabled);
        if (aurumVersion >= 12)
        {
            for (size_t index = 0; index < instrument.dynamicModulation.aurumOperatorLevel.size(); ++index)
            {
                const auto prefix = "aurum.op." + juce::String((int) index + 1);
                active |= configureDynamicTarget(instrument.dynamicModulation.aurumOperatorLevel[index], modulation, prefix + ".level", true, instrument.lfo2Enabled);
                active |= configureDynamicTarget(instrument.dynamicModulation.aurumOperatorPan[index], modulation, prefix + ".pan", true, instrument.lfo2Enabled);
            }
            active |= configureDynamicTarget(instrument.dynamicModulation.aurumFilterCutoff[0], modulation, "aurum.filter.a.cutoff", true, instrument.lfo2Enabled);
            active |= configureDynamicTarget(instrument.dynamicModulation.aurumFilterCutoff[1], modulation, "aurum.filter.b.cutoff", true, instrument.lfo2Enabled);
        }
        if (aurumVersion >= 13)
        {
            active |= configureDynamicTarget(instrument.dynamicModulation.aurumFilterResonance[0], modulation, "aurum.filter.a.resonance", true, instrument.lfo2Enabled);
            active |= configureDynamicTarget(instrument.dynamicModulation.aurumFilterResonance[1], modulation, "aurum.filter.b.resonance", true, instrument.lfo2Enabled);
            active |= configureDynamicTarget(instrument.dynamicModulation.aurumFilterDrive[0], modulation, "aurum.filter.a.drive", true, instrument.lfo2Enabled);
            active |= configureDynamicTarget(instrument.dynamicModulation.aurumFilterDrive[1], modulation, "aurum.filter.b.drive", true, instrument.lfo2Enabled);
        }
        instrument.dynamicModulation.active = active;

        if (auto* macros = objectProperty(aurum, "macroValues", {}).getArray())
        {
            const int count = juce::jmin((int) instrument.macroValues.size(), macros->size());
            for (int index = 0; index < count; ++index)
                instrument.macroValues[(size_t) index] = juce::jlimit(0.0f, 1.0f, (float) (double) macros->getReference(index));
        }
        return active;
    }

    bool applySynthPatchContract(const juce::var& inputPatch, InstrumentDefinition& instrument)
    {
        const auto patch = canonicalizeLegacyLumusSynthPatch(inputPatch);
        if (!patch.isObject()) return false;
        const auto instrumentType = objectProperty(patch, "instrumentType", {}).toString();
        const bool isAether = instrumentType == params::instrumentTypeWavetableSynth.data();
        const bool isLumen = instrumentType == params::instrumentTypeLumenHybridSynth.data();
        if (!isAether && !isLumen) return false;
        const auto patchNamespace = objectProperty(patch, "namespace", {});
        if (isLumen)
        {
            const auto schemaVersion = objectProperty(patch, "schemaVersion", {});
            if ((!schemaVersion.isInt() && !schemaVersion.isInt64())
                || ((int) schemaVersion != params::lumenLegacyPatchSchemaVersion
                    && (int) schemaVersion != params::lumenPreviousPatchSchemaVersion
                    && (int) schemaVersion != params::lumenSampleModePatchSchemaVersion
                    && (int) schemaVersion != params::lumenSampleOwnershipPatchSchemaVersion
                    && (int) schemaVersion != params::lumenGranularPatchSchemaVersion
                    && (int) schemaVersion != params::lumenMultisamplePatchSchemaVersion
                    && (int) schemaVersion != params::lumenArpeggiatorPatchSchemaVersion
                    && (int) schemaVersion != params::lumenArpeggiatorSwingPatchSchemaVersion
                    && (int) schemaVersion != params::lumenArpeggiatorScalePatchSchemaVersion
                    && (int) schemaVersion != params::lumenClipPatchSchemaVersion
                    && (int) schemaVersion != params::lumenPolyphonicClipPatchSchemaVersion
                    && (int) schemaVersion != params::lumenSamplePlaybackPatchSchemaVersion
                    && (int) schemaVersion != params::lumenSampleLoopTailPatchSchemaVersion
                    && (int) schemaVersion != params::lumenSampleSlicePatchSchemaVersion
                    && (int) schemaVersion != params::lumenSpectralWarpPatchSchemaVersion
                    && (int) schemaVersion != params::lumenPatchSchemaVersion)
                || patchNamespace.toString() != params::lumenNamespace.data())
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
        std::array<bool, 3> lumenSampleModes {};
        std::array<bool, 3> lumenSingleSampleModes {};
        std::array<bool, 3> lumenGranularModes {};
        if (isLumen && (int) objectProperty(patch, "schemaVersion", 0) >= params::lumenPreviousPatchSchemaVersion)
        {
            const auto rack = objectProperty(metadata, "lumenSourceRack", {});
            const auto slots = objectProperty(rack, "slots", {});
            const auto* slotArray = slots.getArray();
            static constexpr std::array<const char*, 3> requiredIds {{ "a", "b", "c" }};
            const int rackSchemaVersion = (int) objectProperty(rack, "schemaVersion", 0);
            const int patchSchemaVersion = (int) objectProperty(patch, "schemaVersion", 0);
            if (!rack.isObject()
                || rackSchemaVersion != (patchSchemaVersion >= params::lumenSampleModePatchSchemaVersion ? 2 : 1)
                || slotArray == nullptr || slotArray->size() != (int) requiredIds.size())
                return false;
            for (int index = 0; index < slotArray->size(); ++index)
            {
                const auto& slot = slotArray->getReference(index);
                const auto mode = objectProperty(slot, "mode", {}).toString();
                if (!slot.isObject()
                    || objectProperty(slot, "id", {}).toString() != requiredIds[(size_t) index]
                    || (mode != "wavetable" && mode != "sample"
                        && (patchSchemaVersion < params::lumenGranularPatchSchemaVersion || mode != "granular")
                        && (patchSchemaVersion < params::lumenMultisamplePatchSchemaVersion || mode != "multisample")))
                    return false;
                lumenSampleModes[(size_t) index] = mode == "sample" || mode == "multisample";
                lumenSingleSampleModes[(size_t) index] = mode == "sample";
                lumenGranularModes[(size_t) index] = mode == "granular";
            }
        }
        const auto customWavetables = mergedWavemapMetadata(metadata);
        const int activeLumenSchema = isLumen ? (int) objectProperty(patch, "schemaVersion", 0) : 0;
        const bool allowSpectralWarp = activeLumenSchema >= params::lumenSpectralWarpPatchSchemaVersion;

        instrument.kind = "wavetable";
        instrument.synthEngine = isLumen
            ? InstrumentDefinition::SynthEngine::Lumen
            : InstrumentDefinition::SynthEngine::Aether;
        if (isLumen && (int) objectProperty(patch, "schemaVersion", 0) >= params::lumenArpeggiatorPatchSchemaVersion)
        {
            const auto arpMode = synthStringParam(params, "lumen.arp.mode", "up");
            const auto arpRate = synthStringParam(params, "lumen.arp.rate", "1/16");
            instrument.lumen.arpeggiator.enabled = synthNumberParam(params, "lumen.arp.enabled", 0.0) >= 0.5;
            instrument.lumen.arpeggiator.mode = arpMode == "down" ? 1 : arpMode == "upDown" ? 2 : arpMode == "random" ? 3 : 0;
            instrument.lumen.arpeggiator.rateDivision = arpRate == "1/4" ? 4 : arpRate == "1/8" ? 8 : arpRate == "1/32" ? 32 : 16;
            instrument.lumen.arpeggiator.gate = juce::jlimit(0.05f, 1.0f,
                (float) synthNumberParam(params, "lumen.arp.gate", 0.75));
            if ((int) objectProperty(patch, "schemaVersion", 0) >= params::lumenArpeggiatorSwingPatchSchemaVersion)
                instrument.lumen.arpeggiator.swing = juce::jlimit(0.0f, 0.75f,
                    (float) synthNumberParam(params, "lumen.arp.swing", 0.0));
            instrument.lumen.arpeggiator.octaves = juce::jlimit(1, 4,
                (int) std::round(synthNumberParam(params, "lumen.arp.octaves", 1.0)));
            if ((int) objectProperty(patch, "schemaVersion", 0) >= params::lumenArpeggiatorScalePatchSchemaVersion)
            {
                const auto key = synthStringParam(params, "lumen.arp.key", "c");
                const auto scale = synthStringParam(params, "lumen.arp.scale", "chromatic");
                static constexpr std::array<const char*, 12> keys {{
                    "c", "cSharp", "d", "dSharp", "e", "f",
                    "fSharp", "g", "gSharp", "a", "aSharp", "b"
                }};
                auto keyIndex = -1;
                for (int index = 0; index < (int) keys.size(); ++index)
                    if (key == keys[(size_t) index]) { keyIndex = index; break; }
                if (keyIndex < 0
                    || (scale != "chromatic" && scale != "major" && scale != "naturalMinor"
                        && scale != "majorPentatonic" && scale != "blues"))
                    return false;
                instrument.lumen.arpeggiator.rootPitchClass = keyIndex;
                instrument.lumen.arpeggiator.scale = scale == "major" ? 1
                    : scale == "naturalMinor" ? 2
                    : scale == "majorPentatonic" ? 3
                    : scale == "blues" ? 4
                    : 0;
            }
        }
        if (isLumen && (int) objectProperty(patch, "schemaVersion", 0) >= params::lumenClipPatchSchemaVersion)
        {
            const auto clipRate = synthStringParam(params, "lumen.clip.rate", "1/16");
            if (clipRate != "1/4" && clipRate != "1/8" && clipRate != "1/16" && clipRate != "1/32")
                return false;
            instrument.lumen.clip.enabled = synthNumberParam(params, "lumen.clip.enabled", 0.0) >= 0.5;
            if (instrument.lumen.clip.enabled && instrument.lumen.arpeggiator.enabled) return false;
            instrument.lumen.clip.rateDivision = clipRate == "1/4" ? 4 : clipRate == "1/8" ? 8 : clipRate == "1/32" ? 32 : 16;
            instrument.lumen.clip.swing = juce::jlimit(0.0f, 0.75f,
                (float) synthNumberParam(params, "lumen.clip.swing", 0.0));

            const auto clip = objectProperty(metadata, "lumenClip", {});
            const auto clipLength = objectProperty(clip, "lengthSteps", {});
            const int patchVersion = (int) objectProperty(patch, "schemaVersion", 0);
            const int clipSchemaVersion = (int) objectProperty(clip, "schemaVersion", 0);
            if (!clip.isObject()
                || (!clipLength.isInt() && !clipLength.isInt64())
                || (int) clipLength < 1 || (int) clipLength > 32)
                return false;
            instrument.lumen.clip.lengthSteps = (int) clipLength;

            if (patchVersion < params::lumenPolyphonicClipPatchSchemaVersion)
            {
                const auto clipSteps = objectProperty(clip, "steps", {});
                const auto* stepArray = clipSteps.getArray();
                if (clipSchemaVersion != 1 || stepArray == nullptr || stepArray->size() != (int) clipLength)
                    return false;
                for (int index = 0; index < stepArray->size(); ++index)
                {
                    const auto& step = stepArray->getReference(index);
                    const auto enabled = objectProperty(step, "enabled", {});
                    const auto pitchOffset = objectProperty(step, "pitchOffset", {});
                    const auto lengthSteps = objectProperty(step, "lengthSteps", {});
                    const auto velocity = objectProperty(step, "velocity", {});
                    if (!step.isObject() || !enabled.isBool()
                        || (!pitchOffset.isInt() && !pitchOffset.isInt64())
                        || (!lengthSteps.isInt() && !lengthSteps.isInt64())
                        || (!velocity.isInt() && !velocity.isInt64() && !velocity.isDouble())
                        || (int) pitchOffset < -48 || (int) pitchOffset > 48
                        || (int) lengthSteps < 1 || (int) lengthSteps > (int) clipLength - index
                        || !std::isfinite((double) velocity) || (double) velocity <= 0.0 || (double) velocity > 1.0)
                        return false;
                    if (!(bool) enabled) continue;
                    auto& destination = instrument.lumen.clip.notes[(size_t) instrument.lumen.clip.noteCount++];
                    destination.startStep = index;
                    destination.pitchOffset = (int) pitchOffset;
                    destination.lengthSteps = (int) lengthSteps;
                    destination.velocity = (float) velocity;
                }
            }
            else
            {
                const auto clipNotes = objectProperty(clip, "notes", {});
                const auto* noteArray = clipNotes.getArray();
                if (clipSchemaVersion != 2 || noteArray == nullptr
                    || noteArray->size() > InstrumentDefinition::LumenConfig::Clip::maxNotes)
                    return false;
                instrument.lumen.clip.noteCount = noteArray->size();
                for (int index = 0; index < noteArray->size(); ++index)
                {
                    const auto& note = noteArray->getReference(index);
                    const auto startStep = objectProperty(note, "startStep", {});
                    const auto pitchOffset = objectProperty(note, "pitchOffset", {});
                    const auto lengthSteps = objectProperty(note, "lengthSteps", {});
                    const auto velocity = objectProperty(note, "velocity", {});
                    if (!note.isObject()
                        || (!startStep.isInt() && !startStep.isInt64())
                        || (!pitchOffset.isInt() && !pitchOffset.isInt64())
                        || (!lengthSteps.isInt() && !lengthSteps.isInt64())
                        || (!velocity.isInt() && !velocity.isInt64() && !velocity.isDouble())
                        || (int) startStep < 0 || (int) startStep >= (int) clipLength
                        || (int) pitchOffset < -48 || (int) pitchOffset > 48
                        || (int) lengthSteps < 1 || (int) lengthSteps > (int) clipLength - (int) startStep
                        || !std::isfinite((double) velocity) || (double) velocity <= 0.0 || (double) velocity > 1.0)
                        return false;
                    auto& destination = instrument.lumen.clip.notes[(size_t) index];
                    destination.startStep = (int) startStep;
                    destination.pitchOffset = (int) pitchOffset;
                    destination.lengthSteps = (int) lengthSteps;
                    destination.velocity = (float) velocity;
                }
            }
        }
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
        instrument.wavetableWarpMode = synthWavetableWarpModeForId(
            synthStringParam(params, "osc.a.warpMode", "shape"),
            allowSpectralWarp);
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
        instrument.aether.oscA = synthOscillatorConfig(
            params, modulation, metadata, customWavetables, "a", allowSpectralWarp, oscA);
        instrument.aether.oscB = synthOscillatorConfig(
            params, modulation, metadata, customWavetables, "b", allowSpectralWarp, oscB);
        if (isLumen && (int) objectProperty(patch, "schemaVersion", 0) >= params::lumenPreviousPatchSchemaVersion)
        {
            InstrumentDefinition::AetherOscillator oscC;
            oscC.enabled = false;
            oscC.level = 0.6f;
            oscC.wavetable = baseWavetable;
            applyCustomWavetableFrames(oscC.wavetable, customWavetables,
                synthStringParam(params, "osc.c.wavetable", "basic.saw"));
            if (!oscC.wavetable.custom)
                oscC.wavetable.bank = synthWavetableBankForId(synthStringParam(params, "osc.c.wavetable", "basic.saw"));
            instrument.lumen.oscC = synthOscillatorConfig(params, modulation, metadata,
                customWavetables, "c", allowSpectralWarp, oscC);
            if (lumenSampleModes[2]) instrument.lumen.oscC.enabled = false;
        }
        else
        {
            // Deterministic v1 migration: the new third slot exists but remains silent.
            instrument.lumen.oscC = {};
        }
        const auto sourceRoute = [](const juce::String& route) { return route == "direct" ? 1 : route == "filter1" ? 2 : route == "filter2" ? 3 : route == "none" ? 4 : 0; };
        instrument.aether.sub.routing = sourceRoute(synthStringParam(params, "aether.sub.route", "filter"));
        instrument.aether.noise.routing = sourceRoute(synthStringParam(params, "aether.noise.route", "filter"));
        juce::var lumenSampleMetadata;
        if (isLumen && activeLumenSchema >= params::lumenSampleOwnershipPatchSchemaVersion)
        {
            lumenSampleMetadata = objectProperty(metadata, "lumenSampleSlots", {});
            if (!lumenSampleMetadata.isObject()) return false;
            static constexpr std::array<const char*, 3> requiredSampleSlots {{ "a", "b", "c" }};
            for (const auto* slotId : requiredSampleSlots)
            {
                const auto slot = objectProperty(lumenSampleMetadata, slotId, {});
                const auto zones = objectProperty(slot, "zones", {});
                const int expectedSampleMetadataSchema = activeLumenSchema
                    >= params::lumenSampleSlicePatchSchemaVersion ? 2 : 1;
                if (!slot.isObject() || (int) objectProperty(slot, "schemaVersion", 0) != expectedSampleMetadataSchema
                    || zones.getArray() == nullptr || zones.getArray()->size() > 8)
                    return false;
                if (expectedSampleMetadataSchema == 2)
                {
                    const auto slices = objectProperty(slot, "slices", {});
                    if (slices.getArray() == nullptr || slices.getArray()->size() > 16)
                        return false;
                }
            }
        }
        const auto parseSampleSlot = [&](InstrumentDefinition::AetherSampleSlot& target,
                                         const juce::String& prefix,
                                         const juce::var& slotMetadata,
                                         bool allowSliceSelection) -> bool
        {
            const auto parameter = [&prefix](const char* suffix) { return prefix + suffix; };
            target = {};
            target.schemaVersion = 5;
            target.audioFileId = synthStringParam(params, parameter("audioFileId"), "");
            const bool requestedEnabled = synthNumberParam(params, parameter("enabled"), 0.0) >= 0.5;
            target.rootNote = juce::jlimit(0, 127, (int) std::round(synthNumberParam(params, parameter("rootNote"), 60.0)));
            target.level = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, parameter("level"), 0.8));
            target.pan = juce::jlimit(-1.0f, 1.0f, (float) synthNumberParam(params, parameter("pan"), 0.0));
            target.routing = sourceRoute(synthStringParam(params, parameter("route"), "filter"));
            target.startRatio = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, parameter("start"), 0.0));
            target.endRatio = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, parameter("end"), 1.0));
            target.loopEnabled = synthNumberParam(params, parameter("loop.enabled"), 0.0) >= 0.5;
            target.loopStartRatio = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, parameter("loop.start"), 0.0));
            target.loopEndRatio = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, parameter("loop.end"), 1.0));
            if (isLumen && activeLumenSchema >= params::lumenSamplePlaybackPatchSchemaVersion)
            {
                const auto direction = synthStringParam(params, parameter("direction"), "forward");
                if (direction != "forward" && direction != "reverse") return false;
                target.reverse = direction == "reverse";
                target.playbackRate = juce::jlimit(0.25f, 4.0f,
                    (float) synthNumberParam(params, parameter("playbackRate"), 1.0));
            }
            if (isLumen && activeLumenSchema >= params::lumenSampleLoopTailPatchSchemaVersion)
            {
                const auto loopMode = synthStringParam(params, parameter("loopMode"), "forward");
                if (loopMode != "forward" && loopMode != "pingPong") return false;
                target.pingPongLoop = loopMode == "pingPong";
                const double releaseTailMs = synthNumberParam(params, parameter("releaseTailMs"), 4.0);
                target.releaseTailMs = std::isfinite(releaseTailMs)
                    ? juce::jlimit(1.0f, 2000.0f, (float) releaseTailMs) : 4.0f;
            }
            target.fxSends[0] = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, parameter("fxSend1"), 0.0));
            target.fxSends[1] = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, parameter("fxSend2"), 0.0));
            if (target.endRatio <= target.startRatio)
            {
                target.startRatio = 0.0f;
                target.endRatio = 1.0f;
            }
            if (target.loopStartRatio < target.startRatio || target.loopEndRatio > target.endRatio
                || target.loopEndRatio <= target.loopStartRatio)
                target.loopEnabled = false;
            const auto zoneData = slotMetadata.isObject()
                ? objectProperty(slotMetadata, "zones", {})
                : objectProperty(metadata, "sampleSlot1Zones", {});
            if (const auto* mappedZones = zoneData.getArray())
            for (int index = 0; index < mappedZones->size(); ++index)
            {
                const auto& mapped = mappedZones->getReference(index);
                if (!mapped.isObject()) return false;
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
                if (zone.audioFileId.isNotEmpty()) target.zones.push_back(std::move(zone));
            }
            const auto managed = slotMetadata.isObject() ? objectProperty(slotMetadata, "managedSfz", {}) : juce::var();
            if (!managed.isVoid())
            {
                if (!managed.isObject() || (int) objectProperty(managed, "schemaVersion", 0) != 1) return false;
                target.managedSfz.schemaVersion = 1;
                target.managedSfz.assetId = objectProperty(managed, "assetId", {}).toString();
                target.managedSfz.displayName = objectProperty(managed, "displayName", {}).toString();
                target.managedSfz.manifestPath = objectProperty(managed, "manifestPath", {}).toString();
                target.managedSfz.sourcePath = objectProperty(managed, "sourcePath", {}).toString();
                if (const auto* paths = objectProperty(managed, "samplePaths", {}).getArray())
                    for (const auto& path : *paths)
                        if (path.isString() && path.toString().isNotEmpty()) target.managedSfz.samplePaths.push_back(path.toString());
            }
            if (isLumen && activeLumenSchema >= params::lumenSampleSlicePatchSchemaVersion)
            {
                const auto sliceData = objectProperty(slotMetadata, "slices", {});
                const auto* slices = sliceData.getArray();
                if (slices == nullptr || slices->size() > 16) return false;
                std::set<juce::String> ids;
                for (const auto& sliceVar : *slices)
                {
                    if (!sliceVar.isObject()) return false;
                    InstrumentDefinition::AetherSampleSlot::Slice slice;
                    slice.id = objectProperty(sliceVar, "id", {}).toString();
                    const double start = objectProperty(sliceVar, "startRatio", -1.0);
                    const double end = objectProperty(sliceVar, "endRatio", -1.0);
                    if (slice.id.isEmpty() || slice.id.length() > 64 || ids.count(slice.id) != 0
                        || !std::isfinite(start) || !std::isfinite(end)
                        || start < 0.0 || end > 1.0 || end <= start)
                        return false;
                    ids.insert(slice.id);
                    slice.startRatio = (float) start;
                    slice.endRatio = (float) end;
                    target.slices.push_back(std::move(slice));
                }
                target.selectedSliceId = synthStringParam(params, parameter("selectedSliceId"), "");
                if (target.selectedSliceId.isNotEmpty() && allowSliceSelection)
                {
                    const auto found = std::find_if(target.slices.begin(), target.slices.end(),
                        [&](const auto& slice) { return slice.id == target.selectedSliceId; });
                    if (found == target.slices.end()) return false;
                }
            }
            target.enabled = requestedEnabled && (target.audioFileId.isNotEmpty()
                || !target.zones.empty() || target.managedSfz.manifestPath.isNotEmpty());
            return true;
        };
        if (isLumen && activeLumenSchema >= params::lumenSampleOwnershipPatchSchemaVersion)
        {
            static constexpr std::array<const char*, 3> ids {{ "a", "b", "c" }};
            for (size_t index = 0; index < ids.size(); ++index)
            {
                if (!parseSampleSlot(instrument.lumen.sampleSlots[index],
                        "lumen.source." + juce::String(ids[index]) + ".sample.",
                        objectProperty(lumenSampleMetadata, ids[index], {}),
                        lumenSingleSampleModes[index]))
                    return false;
                instrument.lumen.sampleModes[index] = lumenSampleModes[index];
                instrument.lumen.sampleSlots[index].enabled = instrument.lumen.sampleSlots[index].enabled
                    && lumenSampleModes[index];
                if (!lumenSingleSampleModes[index])
                {
                    instrument.lumen.sampleSlots[index].reverse = false;
                    instrument.lumen.sampleSlots[index].playbackRate = 1.0f;
                    instrument.lumen.sampleSlots[index].pingPongLoop = false;
                    instrument.lumen.sampleSlots[index].releaseTailMs = 4.0f;
                    instrument.lumen.sampleSlots[index].selectedSliceId.clear();
                    instrument.lumen.sampleSlots[index].slices.clear();
                }
            }
            instrument.aether.sampleSlot1 = instrument.lumen.sampleSlots[2];
            if (lumenSampleModes[0]) instrument.aether.oscA.enabled = false;
            if (lumenSampleModes[1]) instrument.aether.oscB.enabled = false;
        }
        else
        {
            if (!parseSampleSlot(instrument.aether.sampleSlot1, "aether.sample.1.", {}, false)) return false;
            if (isLumen && activeLumenSchema >= params::lumenSampleModePatchSchemaVersion)
                instrument.aether.sampleSlot1.enabled = instrument.aether.sampleSlot1.enabled && lumenSampleModes[2];
        }
        const auto parseGranularSlot = [&](InstrumentDefinition::AetherGranularSlot& granular,
                                           const juce::String& prefix,
                                           const juce::var& slotMetadata) -> bool
        {
        granular = {};
        granular.schemaVersion = 1;
        granular.builtinSource = synthStringParam(params, prefix + "builtinSource", "");
        if (granular.builtinSource != "benchmark") granular.builtinSource.clear();
        granular.rootNote = juce::jlimit(0, 127, (int) std::round(synthNumberParam(params, prefix + "rootNote", 60.0)));
        granular.level = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "level", 0.7));
        granular.routing = sourceRoute(synthStringParam(params, prefix + "route", "filter"));
        granular.position = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "position", 0.5));
        granular.positionSpread = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "positionSpread", 0.1));
        granular.grainMilliseconds = juce::jlimit(2.0f, 1000.0f, (float) synthNumberParam(params, prefix + "grainMilliseconds", 80.0));
        granular.densityHz = juce::jlimit(0.1f, 200.0f, (float) synthNumberParam(params, prefix + "densityHz", 12.0));
        granular.pitchSemitones = juce::jlimit(-48.0f, 48.0f, (float) synthNumberParam(params, prefix + "pitchSemitones", 0.0));
        granular.stereoSpread = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "stereoSpread", 0.5));
        granular.randomSeed = (uint32_t) juce::jlimit(1.0, 4294967295.0,
            synthNumberParam(params, prefix + "randomSeed", 1.0));
        granular.fxSends[0] = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "fxSend1", 0.0));
        granular.fxSends[1] = juce::jlimit(0.0f, 1.0f, (float) synthNumberParam(params, prefix + "fxSend2", 0.0));
        const auto managedGranular = slotMetadata.isObject()
            ? objectProperty(slotMetadata, "managedAsset", {})
            : objectProperty(metadata, "managedGranular", {});
        if (!managedGranular.isVoid())
        {
            if (!managedGranular.isObject() || (int) managedGranular.getProperty("schemaVersion", 0) != 1) return false;
            granular.managedAsset.assetId = managedGranular.getProperty("assetId", {}).toString();
            granular.managedAsset.displayName = managedGranular.getProperty("displayName", {}).toString();
            granular.managedAsset.manifestPath = managedGranular.getProperty("manifestPath", {}).toString();
            granular.managedAsset.audioPath = managedGranular.getProperty("audioPath", {}).toString();
        }
        granular.enabled = synthNumberParam(params, prefix + "enabled", 0.0) >= 0.5
            && (granular.builtinSource.isNotEmpty() || granular.managedAsset.manifestPath.isNotEmpty());
        return true;
        };
        if (!parseGranularSlot(instrument.aether.granularSlot2, "aether.granular.2.", {})) return false;
        if (isLumen && activeLumenSchema >= params::lumenGranularPatchSchemaVersion)
        {
            const auto granularMetadata = objectProperty(metadata, "lumenGranularSlots", {});
            if (!granularMetadata.isObject()) return false;
            static constexpr std::array<const char*, 3> ids {{ "a", "b", "c" }};
            for (size_t index = 0; index < ids.size(); ++index)
            {
                const auto slotMetadata = objectProperty(granularMetadata, ids[index], {});
                if (!slotMetadata.isObject() || (int) objectProperty(slotMetadata, "schemaVersion", 0) != 1) return false;
                if (!parseGranularSlot(instrument.lumen.granularSlots[index],
                        "lumen.source." + juce::String(ids[index]) + ".granular.", slotMetadata)) return false;
                instrument.lumen.granularModes[index] = lumenGranularModes[index];
                instrument.lumen.granularSlots[index].enabled = instrument.lumen.granularSlots[index].enabled
                    && lumenGranularModes[index];
            }
            if (lumenGranularModes[0]) instrument.aether.oscA.enabled = false;
            if (lumenGranularModes[1]) instrument.aether.oscB.enabled = false;
            if (lumenGranularModes[2]) instrument.lumen.oscC.enabled = false;
        }
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
        instrument.lfoKeytrackRate = isLumen && activeLumenSchema >= params::lumenKeytrackedLfoPatchSchemaVersion
            ? juce::jlimit(-1.0f, 1.0f, (float) synthNumberParam(params, "lfo.1.keytrackRate", 0.0))
            : 0.0f;
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
        instrument.lfo2KeytrackRate = isLumen && activeLumenSchema >= params::lumenKeytrackedLfoPatchSchemaVersion
            ? juce::jlimit(-1.0f, 1.0f, (float) synthNumberParam(params, "lfo.2.keytrackRate", 0.0))
            : 0.0f;
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
            lfo.keytrackRate = isLumen && activeLumenSchema >= params::lumenKeytrackedLfoPatchSchemaVersion
                ? juce::jlimit(-1.0f, 1.0f, (float) synthNumberParam(params, prefix + "keytrackRate", 0.0))
                : 0.0f;
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
        configureDynamicModulation(instrument.dynamicModulation, modulation, lfoEnabled, instrument.lfo2Enabled, isLumen);
        return true;
    }
}

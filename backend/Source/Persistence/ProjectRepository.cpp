#include "ProjectRepository.h"
#include "../Audio/Effects/TrackEffectDefaults.h"

#include <cmath>

namespace beat
{
    namespace
    {
        TrackKind trackKindFromVar(const juce::var& value)
        {
            if (value.isString())
            {
                const auto kind = value.toString();
                if (kind == "midi") return TrackKind::Midi;
                if (kind == "mixed") return TrackKind::Mixed;
                if (kind == "group") return TrackKind::Group;
                return TrackKind::Audio;
            }
            return (TrackKind) (int) value;
        }

        // Minimal JSON encoder for Project. juce::JSON handles var → string;
        // we build a juce::var tree and let it serialize.
        juce::var pluginCapabilityToVar(const PluginCapability& capability)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("id", capability.id);
            o->setProperty("kind", capability.kind);
            o->setProperty("label", capability.label);
            o->setProperty("realtime", capability.realtime);
            o->setProperty("offline", capability.offline);
            o->setProperty("latencySamples", capability.latencySamples);
            o->setProperty("fallbackMode", capability.fallbackMode);
            return juce::var(o.get());
        }

        juce::var pluginToVar(const PluginAdapterDefinition& plugin)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("id", plugin.id);
            o->setProperty("name", plugin.name);
            o->setProperty("vendor", plugin.vendor);
            o->setProperty("version", plugin.version);
            o->setProperty("kind", plugin.kind);
            o->setProperty("format", plugin.format);
            o->setProperty("status", plugin.status);
            o->setProperty("instrumentMode", plugin.instrumentMode);
            o->setProperty("description", plugin.description);
            o->setProperty("sourceFileName", plugin.sourceFileName);
            o->setProperty("sourcePath", plugin.sourcePath);
            o->setProperty("uiImagePath", plugin.uiImagePath);
            o->setProperty("uiImageDataUrl", plugin.uiImageDataUrl);
            o->setProperty("associatedInstrumentId", plugin.associatedInstrumentId);
            o->setProperty("uiWidth", plugin.uiWidth);
            o->setProperty("uiHeight", plugin.uiHeight);
            o->setProperty("uiControlDetails", plugin.uiControlDetails);
            o->setProperty("sampleCount", plugin.sampleCount);
            o->setProperty("uiControlCount", plugin.uiControlCount);
            o->setProperty("factory", plugin.factory);
            o->setProperty("installedAt", plugin.installedAt);

            juce::Array<juce::var> capabilityArr;
            for (const auto& capability : plugin.capabilities)
                capabilityArr.add(pluginCapabilityToVar(capability));
            o->setProperty("capabilities", capabilityArr);
            return juce::var(o.get());
        }

        juce::var recordingInputToVar(const RecordingInputProfile& profile)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("inputDeviceId", profile.inputDeviceId);
            o->setProperty("inputDeviceName", profile.inputDeviceName);
            o->setProperty("inputChannelStart", profile.inputChannelStart);
            o->setProperty("inputChannelCount", profile.inputChannelCount);
            o->setProperty("calibrationSampleRate", profile.calibrationSampleRate);
            o->setProperty("measuredRoundTripSamples", profile.measuredRoundTripSamples);
            o->setProperty("reportedInputLatencySamples", profile.reportedInputLatencySamples);
            o->setProperty("reportedOutputLatencySamples", profile.reportedOutputLatencySamples);
            o->setProperty("userLatencyAdjustmentSamples", profile.userLatencyAdjustmentSamples);
            return juce::var(o.get());
        }

        RecordingInputProfile recordingInputFromVar(const juce::var& inputVar)
        {
            RecordingInputProfile profile;
            if (!inputVar.isObject())
                return profile;

            profile.inputDeviceId = inputVar.getProperty("inputDeviceId", "").toString();
            profile.inputDeviceName = inputVar.getProperty("inputDeviceName", "").toString();
            profile.inputChannelStart = juce::jlimit(0, 1024, (int) inputVar.getProperty("inputChannelStart", 0));
            profile.inputChannelCount = juce::jlimit(1, 1024, (int) inputVar.getProperty("inputChannelCount", 2));
            profile.calibrationSampleRate = juce::jlimit(0.0, 768000.0, (double) inputVar.getProperty("calibrationSampleRate", 0.0));
            profile.measuredRoundTripSamples = juce::jlimit(0, 1920000, (int) inputVar.getProperty("measuredRoundTripSamples", 0));
            profile.reportedInputLatencySamples = juce::jlimit(0, 1920000, (int) inputVar.getProperty("reportedInputLatencySamples", 0));
            profile.reportedOutputLatencySamples = juce::jlimit(0, 1920000, (int) inputVar.getProperty("reportedOutputLatencySamples", 0));
            profile.userLatencyAdjustmentSamples = juce::jlimit(-1920000, 1920000, (int) inputVar.getProperty("userLatencyAdjustmentSamples", 0));
            return profile;
        }

        juce::var masterChainToVar(const MasterChainSettings& settings)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("inputGainDb", settings.inputGainDb);
            o->setProperty("compressorEnabled", settings.compressorEnabled);
            o->setProperty("compressorThresholdDb", settings.compressorThresholdDb);
            o->setProperty("compressorRatio", settings.compressorRatio);
            o->setProperty("compressorAttackMs", settings.compressorAttackMs);
            o->setProperty("compressorReleaseMs", settings.compressorReleaseMs);
            o->setProperty("compressorMakeupDb", settings.compressorMakeupDb);
            o->setProperty("compressorMix", settings.compressorMix);
            o->setProperty("outputGainDb", settings.outputGainDb);
            return juce::var(o.get());
        }

        MasterChainSettings masterChainFromVar(const juce::var& masterVar)
        {
            MasterChainSettings settings;
            if (!masterVar.isObject())
                return settings;

            settings.inputGainDb = juce::jlimit(-48.0f, 24.0f, (float) (double) masterVar.getProperty("inputGainDb", 0.0));
            settings.compressorEnabled = (bool) masterVar.getProperty("compressorEnabled", false);
            settings.compressorThresholdDb = juce::jlimit(-60.0f, 0.0f, (float) (double) masterVar.getProperty("compressorThresholdDb", -18.0));
            settings.compressorRatio = juce::jlimit(1.0f, 40.0f, (float) (double) masterVar.getProperty("compressorRatio", 2.0));
            settings.compressorAttackMs = juce::jlimit(0.1f, 200.0f, (float) (double) masterVar.getProperty("compressorAttackMs", 20.0));
            settings.compressorReleaseMs = juce::jlimit(1.0f, 3000.0f, (float) (double) masterVar.getProperty("compressorReleaseMs", 160.0));
            settings.compressorMakeupDb = juce::jlimit(-24.0f, 24.0f, (float) (double) masterVar.getProperty("compressorMakeupDb", 0.0));
            settings.compressorMix = juce::jlimit(0.0f, 100.0f, (float) (double) masterVar.getProperty("compressorMix", 100.0));
            settings.outputGainDb = juce::jlimit(-48.0f, 24.0f, (float) (double) masterVar.getProperty("outputGainDb", 0.0));
            return settings;
        }

        juce::var trackSendToVar(const TrackSend& send)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("busId", send.busId);
            o->setProperty("gainDb", send.gainDb);
            o->setProperty("pan", send.pan);
            o->setProperty("enabled", send.enabled);
            o->setProperty("preFader", send.preFader);
            return juce::var(o.get());
        }

        juce::var trackEffectToVar(const TrackEffect& effect)
        {
            juce::DynamicObject::Ptr eo = new juce::DynamicObject();
            eo->setProperty("id",       effect.id);
            eo->setProperty("kind",     (int) effect.kind);
            eo->setProperty("schemaVersion", effect.schemaVersion);
            eo->setProperty("bypassed", effect.bypassed);
            eo->setProperty("pluginId", effect.pluginId);
            eo->setProperty("pluginName", effect.pluginName);
            eo->setProperty("pluginFormat", effect.pluginFormat);
            eo->setProperty("latencySamples", effect.latencySamples);

            juce::DynamicObject::Ptr params = new juce::DynamicObject();
            for (const auto& param : effect.params)
                params->setProperty(param.key, param.value);
            eo->setProperty("params", juce::var(params.get()));

            juce::Array<juce::var> automationArr;
            for (const auto& lane : effect.automation)
            {
                juce::DynamicObject::Ptr laneObject = new juce::DynamicObject();
                laneObject->setProperty("param", lane.target);
                juce::Array<juce::var> pointsArr;
                for (const auto& point : lane.points)
                {
                    juce::DynamicObject::Ptr pointObject = new juce::DynamicObject();
                    pointObject->setProperty("beat", point.beat);
                    pointObject->setProperty("value", point.value);
                    pointObject->setProperty("curve", (int) point.curve);
                    pointsArr.add(juce::var(pointObject.get()));
                }
                laneObject->setProperty("points", pointsArr);
                automationArr.add(juce::var(laneObject.get()));
            }
            eo->setProperty("automation", automationArr);
            return juce::var(eo.get());
        }

        juce::var wavetableFrameToVar(const InstrumentDefinition::WavetableConfig::CustomFrame& frame)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("brightness", frame.brightness);
            o->setProperty("even", frame.even);
            o->setProperty("fold", frame.fold);
            o->setProperty("formant", frame.formant);
            o->setProperty("notch", frame.notch);
            o->setProperty("skew", frame.skew);
            o->setProperty("tilt", frame.tilt);
            o->setProperty("focus", frame.focus);
            o->setProperty("phase", frame.phase);
            juce::Array<juce::var> partials;
            for (const auto partial : frame.partials)
                partials.add(partial);
            o->setProperty("partials", partials);
            return juce::var(o.get());
        }

        InstrumentDefinition::WavetableConfig::CustomFrame wavetableFrameFromVar(
            const juce::var& frameVar,
            InstrumentDefinition::WavetableConfig::CustomFrame fallback)
        {
            if (!frameVar.isObject())
                return fallback;

            fallback.brightness = juce::jlimit(0.0f, 1.0f, (float) (double) frameVar.getProperty("brightness", fallback.brightness));
            fallback.even = juce::jlimit(0.0f, 1.0f, (float) (double) frameVar.getProperty("even", fallback.even));
            fallback.fold = juce::jlimit(0.0f, 1.0f, (float) (double) frameVar.getProperty("fold", fallback.fold));
            fallback.formant = juce::jlimit(0.0f, 1.0f, (float) (double) frameVar.getProperty("formant", fallback.formant));
            fallback.notch = juce::jlimit(0.0f, 1.0f, (float) (double) frameVar.getProperty("notch", fallback.notch));
            fallback.skew = juce::jlimit(-1.0f, 1.0f, (float) (double) frameVar.getProperty("skew", fallback.skew));
            fallback.tilt = juce::jlimit(-1.0f, 1.0f, (float) (double) frameVar.getProperty("tilt", fallback.tilt));
            fallback.focus = juce::jlimit(0.0f, 1.0f, (float) (double) frameVar.getProperty("focus", fallback.focus));
            fallback.phase = juce::jlimit(0.0f, 1.0f, (float) (double) frameVar.getProperty("phase", fallback.phase));

            if (auto* partials = frameVar.getProperty("partials", {}).getArray())
            {
                const auto count = juce::jmin((int) partials->size(), (int) fallback.partials.size());
                for (int i = 0; i < count; ++i)
                    fallback.partials[(size_t) i] = juce::jlimit(0.0f, 1.0f, (float) (double) partials->getReference(i));
            }
            return fallback;
        }

        juce::var wavetableConfigToVar(const InstrumentDefinition::WavetableConfig& wavetable)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("bank", wavetable.bank);
            o->setProperty("custom", wavetable.custom);
            o->setProperty("position", wavetable.position);
            o->setProperty("warp", wavetable.warp);
            o->setProperty("warpMode", wavetable.warpMode);
            o->setProperty("smoothInterpolation", wavetable.smoothInterpolation);
            o->setProperty("morph", wavetable.morph);
            o->setProperty("unison", wavetable.unison);
            o->setProperty("detuneCents", wavetable.detuneCents);
            o->setProperty("blend", wavetable.blend);

            juce::Array<juce::var> frames;
            for (const auto& frame : wavetable.customFrames)
                frames.add(wavetableFrameToVar(frame));
            o->setProperty("customFrames", frames);
            return juce::var(o.get());
        }

        InstrumentDefinition::WavetableConfig wavetableConfigFromVar(
            const juce::var& wavetableVar,
            InstrumentDefinition::WavetableConfig fallback)
        {
            if (!wavetableVar.isObject())
                return fallback;

            fallback.bank = juce::jlimit(0, 8, (int) wavetableVar.getProperty("bank", fallback.bank));
            fallback.custom = (bool) wavetableVar.getProperty("custom", fallback.custom);
            fallback.position = juce::jlimit(0.0f, 1.0f, (float) (double) wavetableVar.getProperty("position", fallback.position));
            fallback.warp = juce::jlimit(0.0f, 1.0f, (float) (double) wavetableVar.getProperty("warp", fallback.warp));
            fallback.warpMode = juce::jlimit(0, 3, (int) wavetableVar.getProperty("warpMode", fallback.warpMode));
            fallback.smoothInterpolation = (bool) wavetableVar.getProperty("smoothInterpolation", fallback.smoothInterpolation);
            fallback.morph = juce::jlimit(0.0f, 1.0f, (float) (double) wavetableVar.getProperty("morph", fallback.morph));
            fallback.unison = juce::jlimit(1, 8, (int) wavetableVar.getProperty("unison", fallback.unison));
            fallback.detuneCents = juce::jlimit(0.0f, 100.0f, (float) (double) wavetableVar.getProperty("detuneCents", fallback.detuneCents));
            fallback.blend = juce::jlimit(0.0f, 1.0f, (float) (double) wavetableVar.getProperty("blend", fallback.blend));

            if (auto* frames = wavetableVar.getProperty("customFrames", {}).getArray())
            {
                const auto count = juce::jmin((int) frames->size(), (int) fallback.customFrames.size());
                for (int i = 0; i < count; ++i)
                    fallback.customFrames[(size_t) i] = wavetableFrameFromVar(frames->getReference(i), fallback.customFrames[(size_t) i]);
            }
            return fallback;
        }

        juce::var aetherOscillatorToVar(const InstrumentDefinition::AetherOscillator& oscillator)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("enabled", oscillator.enabled);
            o->setProperty("level", oscillator.level);
            o->setProperty("pan", oscillator.pan);
            o->setProperty("waveform", oscillator.waveform);
            o->setProperty("octave", oscillator.octave);
            o->setProperty("semitone", oscillator.semitone);
            o->setProperty("fineCents", oscillator.fineCents);
            o->setProperty("phase", oscillator.phase);
            o->setProperty("randomPhase", oscillator.randomPhase);
            o->setProperty("wavetable", wavetableConfigToVar(oscillator.wavetable));
            return juce::var(o.get());
        }

        InstrumentDefinition::AetherOscillator aetherOscillatorFromVar(
            const juce::var& oscillatorVar,
            InstrumentDefinition::AetherOscillator fallback)
        {
            if (!oscillatorVar.isObject())
                return fallback;

            fallback.enabled = (bool) oscillatorVar.getProperty("enabled", fallback.enabled);
            fallback.level = juce::jlimit(0.0f, 1.0f, (float) (double) oscillatorVar.getProperty("level", fallback.level));
            fallback.pan = juce::jlimit(-1.0f, 1.0f, (float) (double) oscillatorVar.getProperty("pan", fallback.pan));
            fallback.waveform = juce::jlimit(0, 8, (int) oscillatorVar.getProperty("waveform", fallback.waveform));
            fallback.octave = juce::jlimit(-4, 4, (int) oscillatorVar.getProperty("octave", fallback.octave));
            fallback.semitone = juce::jlimit(-24, 24, (int) oscillatorVar.getProperty("semitone", fallback.semitone));
            fallback.fineCents = juce::jlimit(-100.0f, 100.0f, (float) (double) oscillatorVar.getProperty("fineCents", fallback.fineCents));
            fallback.phase = juce::jlimit(0.0f, 1.0f, (float) (double) oscillatorVar.getProperty("phase", fallback.phase));
            fallback.randomPhase = juce::jlimit(0.0f, 1.0f, (float) (double) oscillatorVar.getProperty("randomPhase", fallback.randomPhase));
            fallback.wavetable = wavetableConfigFromVar(oscillatorVar.getProperty("wavetable", {}), fallback.wavetable);
            return fallback;
        }

        InstrumentDefinition::AetherConfig defaultAetherConfigForWavetable(const InstrumentDefinition::WavetableConfig& globalWavetable)
        {
            InstrumentDefinition::AetherConfig config;
            config.oscA.enabled = true;
            config.oscA.level = 0.78f;
            config.oscA.wavetable = globalWavetable;

            config.oscB.enabled = false;
            config.oscB.level = 0.42f;
            config.oscB.semitone = 7;
            config.oscB.fineCents = -4.0f;
            config.oscB.wavetable = globalWavetable;
            config.oscB.wavetable.bank = 1;
            config.oscB.wavetable.position = 0.25f;
            config.oscB.wavetable.warp = 0.16f;
            config.oscB.wavetable.detuneCents = 8.0f;
            config.oscB.wavetable.blend = 0.35f;

            config.sub.enabled = true;
            config.sub.level = 0.18f;
            config.sub.octave = -1;
            config.sub.waveform = 0;

            config.noise.enabled = false;
            config.noise.level = 0.08f;
            config.noise.color = 0.45f;
            config.runtimeWarp = 0.0f;
            config.runtimeWarpMode = 0;
            return config;
        }

        juce::var aetherConfigToVar(const InstrumentDefinition::AetherConfig& aether)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("oscA", aetherOscillatorToVar(aether.oscA));
            o->setProperty("oscB", aetherOscillatorToVar(aether.oscB));

            juce::DynamicObject::Ptr sub = new juce::DynamicObject();
            sub->setProperty("enabled", aether.sub.enabled);
            sub->setProperty("level", aether.sub.level);
            sub->setProperty("octave", aether.sub.octave);
            sub->setProperty("waveform", aether.sub.waveform);
            o->setProperty("sub", juce::var(sub.get()));

            juce::DynamicObject::Ptr noise = new juce::DynamicObject();
            noise->setProperty("enabled", aether.noise.enabled);
            noise->setProperty("level", aether.noise.level);
            noise->setProperty("color", aether.noise.color);
            o->setProperty("noise", juce::var(noise.get()));
            o->setProperty("runtimeWarp", aether.runtimeWarp);
            o->setProperty("runtimeWarpMode", aether.runtimeWarpMode);
            return juce::var(o.get());
        }

        InstrumentDefinition::AetherConfig aetherConfigFromVar(
            const juce::var& aetherVar,
            const InstrumentDefinition::WavetableConfig& globalWavetable)
        {
            auto config = defaultAetherConfigForWavetable(globalWavetable);
            if (!aetherVar.isObject())
                return config;

            config.oscA = aetherOscillatorFromVar(aetherVar.getProperty("oscA", {}), config.oscA);
            config.oscB = aetherOscillatorFromVar(aetherVar.getProperty("oscB", {}), config.oscB);

            const auto sub = aetherVar.getProperty("sub", {});
            if (sub.isObject())
            {
                config.sub.enabled = (bool) sub.getProperty("enabled", config.sub.enabled);
                config.sub.level = juce::jlimit(0.0f, 1.0f, (float) (double) sub.getProperty("level", config.sub.level));
                config.sub.octave = juce::jlimit(-4, 0, (int) sub.getProperty("octave", config.sub.octave));
                config.sub.waveform = juce::jlimit(0, 8, (int) sub.getProperty("waveform", config.sub.waveform));
            }

            const auto noise = aetherVar.getProperty("noise", {});
            if (noise.isObject())
            {
                config.noise.enabled = (bool) noise.getProperty("enabled", config.noise.enabled);
                config.noise.level = juce::jlimit(0.0f, 1.0f, (float) (double) noise.getProperty("level", config.noise.level));
                config.noise.color = juce::jlimit(0.0f, 1.0f, (float) (double) noise.getProperty("color", config.noise.color));
            }
            config.runtimeWarp = juce::jlimit(0.0f, 1.0f, (float) (double) aetherVar.getProperty("runtimeWarp", config.runtimeWarp));
            config.runtimeWarpMode = juce::jlimit(0, 3, (int) aetherVar.getProperty("runtimeWarpMode", config.runtimeWarpMode));
            return config;
        }

        juce::var dynamicModTargetToVar(const InstrumentDefinition::DynamicModTarget& target)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("lfo", target.lfo);
            o->setProperty("lfoBipolar", target.lfoBipolar);
            o->setProperty("lfo2", target.lfo2);
            o->setProperty("lfo2Bipolar", target.lfo2Bipolar);
            o->setProperty("env", target.env);
            o->setProperty("envBipolar", target.envBipolar);
            o->setProperty("env2", target.env2);
            o->setProperty("env2Bipolar", target.env2Bipolar);
            o->setProperty("velocity", target.velocity);
            o->setProperty("velocityBipolar", target.velocityBipolar);
            o->setProperty("keytrack", target.keytrack);
            o->setProperty("keytrackBipolar", target.keytrackBipolar);
            o->setProperty("modWheel", target.modWheel);
            o->setProperty("modWheelBipolar", target.modWheelBipolar);
            o->setProperty("macro1", target.macro1);
            o->setProperty("macro2", target.macro2);
            o->setProperty("macro3", target.macro3);
            o->setProperty("macro4", target.macro4);
            return juce::var(o.get());
        }

        InstrumentDefinition::DynamicModTarget dynamicModTargetFromVar(
            const juce::var& targetVar,
            InstrumentDefinition::DynamicModTarget fallback)
        {
            if (!targetVar.isObject())
                return fallback;

            const auto bipolar = [] (const juce::var& value, const juce::Identifier& key, bool defaultValue)
            {
                return (bool) value.getProperty(key, defaultValue);
            };
            const auto amount = [] (const juce::var& value, const juce::Identifier& key, float defaultValue)
            {
                return juce::jlimit(-1.0f, 1.0f, (float) (double) value.getProperty(key, defaultValue));
            };

            fallback.lfo = amount(targetVar, "lfo", fallback.lfo);
            fallback.lfoBipolar = bipolar(targetVar, "lfoBipolar", fallback.lfoBipolar);
            fallback.lfo2 = amount(targetVar, "lfo2", fallback.lfo2);
            fallback.lfo2Bipolar = bipolar(targetVar, "lfo2Bipolar", fallback.lfo2Bipolar);
            fallback.env = amount(targetVar, "env", fallback.env);
            fallback.envBipolar = bipolar(targetVar, "envBipolar", fallback.envBipolar);
            fallback.env2 = amount(targetVar, "env2", fallback.env2);
            fallback.env2Bipolar = bipolar(targetVar, "env2Bipolar", fallback.env2Bipolar);
            fallback.velocity = amount(targetVar, "velocity", fallback.velocity);
            fallback.velocityBipolar = bipolar(targetVar, "velocityBipolar", fallback.velocityBipolar);
            fallback.keytrack = amount(targetVar, "keytrack", fallback.keytrack);
            fallback.keytrackBipolar = bipolar(targetVar, "keytrackBipolar", fallback.keytrackBipolar);
            fallback.modWheel = amount(targetVar, "modWheel", fallback.modWheel);
            fallback.modWheelBipolar = bipolar(targetVar, "modWheelBipolar", fallback.modWheelBipolar);
            fallback.macro1 = amount(targetVar, "macro1", fallback.macro1);
            fallback.macro2 = amount(targetVar, "macro2", fallback.macro2);
            fallback.macro3 = amount(targetVar, "macro3", fallback.macro3);
            fallback.macro4 = amount(targetVar, "macro4", fallback.macro4);
            return fallback;
        }

        juce::var dynamicModulationToVar(const InstrumentDefinition::DynamicModulation& modulation)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("active", modulation.active);
            o->setProperty("oscAPosition", dynamicModTargetToVar(modulation.oscAPosition));
            o->setProperty("oscAFine", dynamicModTargetToVar(modulation.oscAFine));
            o->setProperty("oscALevel", dynamicModTargetToVar(modulation.oscALevel));
            o->setProperty("oscAPan", dynamicModTargetToVar(modulation.oscAPan));
            o->setProperty("oscBPosition", dynamicModTargetToVar(modulation.oscBPosition));
            o->setProperty("oscBFine", dynamicModTargetToVar(modulation.oscBFine));
            o->setProperty("oscBLevel", dynamicModTargetToVar(modulation.oscBLevel));
            o->setProperty("oscBPan", dynamicModTargetToVar(modulation.oscBPan));
            o->setProperty("filterCutoff", dynamicModTargetToVar(modulation.filterCutoff));
            o->setProperty("filterResonance", dynamicModTargetToVar(modulation.filterResonance));
            o->setProperty("filterDrive", dynamicModTargetToVar(modulation.filterDrive));
            o->setProperty("ampLevel", dynamicModTargetToVar(modulation.ampLevel));
            o->setProperty("ampPan", dynamicModTargetToVar(modulation.ampPan));
            o->setProperty("unisonDetune", dynamicModTargetToVar(modulation.unisonDetune));
            o->setProperty("unisonSpread", dynamicModTargetToVar(modulation.unisonSpread));
            return juce::var(o.get());
        }

        InstrumentDefinition::DynamicModulation dynamicModulationFromVar(
            const juce::var& modulationVar,
            InstrumentDefinition::DynamicModulation fallback)
        {
            if (!modulationVar.isObject())
                return fallback;

            fallback.active = (bool) modulationVar.getProperty("active", fallback.active);
            fallback.oscAPosition = dynamicModTargetFromVar(modulationVar.getProperty("oscAPosition", {}), fallback.oscAPosition);
            fallback.oscAFine = dynamicModTargetFromVar(modulationVar.getProperty("oscAFine", {}), fallback.oscAFine);
            fallback.oscALevel = dynamicModTargetFromVar(modulationVar.getProperty("oscALevel", {}), fallback.oscALevel);
            fallback.oscAPan = dynamicModTargetFromVar(modulationVar.getProperty("oscAPan", {}), fallback.oscAPan);
            fallback.oscBPosition = dynamicModTargetFromVar(modulationVar.getProperty("oscBPosition", {}), fallback.oscBPosition);
            fallback.oscBFine = dynamicModTargetFromVar(modulationVar.getProperty("oscBFine", {}), fallback.oscBFine);
            fallback.oscBLevel = dynamicModTargetFromVar(modulationVar.getProperty("oscBLevel", {}), fallback.oscBLevel);
            fallback.oscBPan = dynamicModTargetFromVar(modulationVar.getProperty("oscBPan", {}), fallback.oscBPan);
            fallback.filterCutoff = dynamicModTargetFromVar(modulationVar.getProperty("filterCutoff", {}), fallback.filterCutoff);
            fallback.filterResonance = dynamicModTargetFromVar(modulationVar.getProperty("filterResonance", {}), fallback.filterResonance);
            fallback.filterDrive = dynamicModTargetFromVar(modulationVar.getProperty("filterDrive", {}), fallback.filterDrive);
            fallback.ampLevel = dynamicModTargetFromVar(modulationVar.getProperty("ampLevel", {}), fallback.ampLevel);
            fallback.ampPan = dynamicModTargetFromVar(modulationVar.getProperty("ampPan", {}), fallback.ampPan);
            fallback.unisonDetune = dynamicModTargetFromVar(modulationVar.getProperty("unisonDetune", {}), fallback.unisonDetune);
            fallback.unisonSpread = dynamicModTargetFromVar(modulationVar.getProperty("unisonSpread", {}), fallback.unisonSpread);
            return fallback;
        }

        juce::var returnBusToVar(const ReturnBus& bus)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("id", bus.id);
            o->setProperty("schemaVersion", bus.schemaVersion);
            o->setProperty("name", bus.name);
            o->setProperty("color", bus.color);
            o->setProperty("icon", bus.icon);
            o->setProperty("channelLayout", bus.channelLayout);
            o->setProperty("outputBusId", bus.outputBusId);
            o->setProperty("outputEnabled", bus.outputEnabled);
            o->setProperty("inputTrimDb", bus.inputTrimDb);
            o->setProperty("gainDb", bus.gainDb);
            o->setProperty("pan", bus.pan);
            o->setProperty("mute", bus.mute);
            o->setProperty("solo", bus.solo);
            o->setProperty("soloSafe", bus.soloSafe);
            o->setProperty("mixerOrder", bus.mixerOrder);

            juce::Array<juce::var> sendArr;
            for (const auto& send : bus.sends)
                sendArr.add(trackSendToVar(send));
            o->setProperty("sends", sendArr);

            juce::Array<juce::var> automationArr;
            for (const auto& lane : bus.automation)
            {
                juce::DynamicObject::Ptr laneObject = new juce::DynamicObject();
                laneObject->setProperty("target", lane.target);
                juce::Array<juce::var> pointsArr;
                for (const auto& point : lane.points)
                {
                    juce::DynamicObject::Ptr pointObject = new juce::DynamicObject();
                    pointObject->setProperty("beat", point.beat);
                    pointObject->setProperty("value", point.value);
                    pointObject->setProperty("curve", (int) point.curve);
                    pointsArr.add(juce::var(pointObject.get()));
                }
                laneObject->setProperty("points", pointsArr);
                automationArr.add(juce::var(laneObject.get()));
            }
            o->setProperty("automation", automationArr);

            juce::Array<juce::var> effectArr;
            for (const auto& effect : bus.effects)
                effectArr.add(trackEffectToVar(effect));
            juce::DynamicObject::Ptr effects = new juce::DynamicObject();
            effects->setProperty("filters", effectArr);
            o->setProperty("effects", juce::var(effects.get()));
            return juce::var(o.get());
        }

        TrackSend trackSendFromVar(const juce::var& sendVar)
        {
            TrackSend send;
            if (!sendVar.isObject())
                return send;

            send.busId = sendVar.getProperty("busId", sendVar.getProperty("returnBusId", "")).toString();
            send.gainDb = juce::jlimit(-96.0f, 24.0f, (float) (double) sendVar.getProperty("gainDb", -96.0));
            send.pan = juce::jlimit(-1.0f, 1.0f, (float) (double) sendVar.getProperty("pan", 0.0));
            send.enabled = (bool) sendVar.getProperty("enabled", true);
            send.preFader = (bool) sendVar.getProperty("preFader", false);
            return send;
        }

        TrackEffect trackEffectFromVar(const juce::var& ev)
        {
            TrackEffect effect;
            if (!ev.isObject())
                return effect;

            effect.id = ev.getProperty("id", "").toString();
            effect.kind = (TrackEffectKind) (int) ev.getProperty("kind", (int) TrackEffectKind::Unknown);
            effect.schemaVersion = juce::jlimit(0, kCurrentTrackEffectSchemaVersion, (int) ev.getProperty("schemaVersion", 0));
            effect.bypassed = (bool) ev.getProperty("bypassed", false);
            effect.pluginId = ev.getProperty("pluginId", "").toString();
            effect.pluginName = ev.getProperty("pluginName", ev.getProperty("name", "")).toString();
            effect.pluginFormat = ev.getProperty("pluginFormat", ev.getProperty("format", "")).toString();
            effect.latencySamples = juce::jlimit(0, 192000, (int) ev.getProperty("latencySamples", 0));

            if (auto* params = ev.getProperty("params", {}).getDynamicObject())
            {
                for (const auto& property : params->getProperties())
                {
                    if (!property.value.isDouble() && !property.value.isInt() && !property.value.isBool())
                        continue;
                    effect.params.push_back({ property.name.toString(), (float) (double) property.value });
                }
            }

            if (auto* lanes = ev.getProperty("automation", {}).getArray())
            {
                for (const auto& lv : *lanes)
                {
                    if (!lv.isObject()) continue;
                    MidiAutomationLane lane;
                    lane.target = lv.getProperty("param", lv.getProperty("target", "")).toString();
                    if (auto* points = lv.getProperty("points", {}).getArray())
                    {
                        for (const auto& pv : *points)
                        {
                            if (!pv.isObject()) continue;
                            MidiAutomationPoint point;
                            point.beat = (double) pv.getProperty("beat", 0.0);
                            point.value = (float) (double) pv.getProperty("value", 0.0);
                            point.curve = (AutomationCurve) (int) pv.getProperty("curve", (int) AutomationCurve::Linear);
                            if (std::isfinite(point.beat) && std::isfinite(point.value))
                                lane.points.push_back(point);
                        }
                    }
                    if (!lane.target.isEmpty() && !lane.points.empty())
                        effect.automation.push_back(std::move(lane));
                }
            }

            if (effect.kind != TrackEffectKind::Unknown)
                normalizeTrackEffect(effect);

            return effect;
        }

        ReturnBus returnBusFromVar(const juce::var& busVar)
        {
            ReturnBus bus;
            if (!busVar.isObject())
                return bus;

            bus.id = busVar.getProperty("id", "").toString();
            bus.schemaVersion = juce::jmax(1, (int) busVar.getProperty("schemaVersion", 1));
            bus.name = busVar.getProperty("name", "").toString();
            bus.color = busVar.getProperty("color", "").toString();
            bus.icon = busVar.getProperty("icon", "").toString();
            bus.channelLayout = busVar.getProperty("channelLayout", "stereo").toString();
            bus.outputBusId = busVar.getProperty("outputBusId", "").toString();
            bus.outputEnabled = (bool) busVar.getProperty("outputEnabled", true);
            bus.inputTrimDb = juce::jlimit(-96.0f, 24.0f, (float) (double) busVar.getProperty("inputTrimDb", 0.0));
            bus.gainDb = juce::jlimit(-96.0f, 24.0f, (float) (double) busVar.getProperty("gainDb", 0.0));
            bus.pan = juce::jlimit(-1.0f, 1.0f, (float) (double) busVar.getProperty("pan", 0.0));
            bus.mute = (bool) busVar.getProperty("mute", false);
            bus.solo = (bool) busVar.getProperty("solo", false);
            bus.soloSafe = (bool) busVar.getProperty("soloSafe", false);
            bus.mixerOrder = juce::jmax(0, (int) busVar.getProperty("mixerOrder", 0));

            if (auto* sends = busVar.getProperty("sends", {}).getArray())
                for (const auto& sv : *sends)
                {
                    auto send = trackSendFromVar(sv);
                    if (send.busId.isNotEmpty()) bus.sends.push_back(send);
                }

            if (auto* lanes = busVar.getProperty("automation", {}).getArray())
                for (const auto& lv : *lanes)
                {
                    if (!lv.isObject()) continue;
                    MidiAutomationLane lane;
                    lane.target = lv.getProperty("target", lv.getProperty("param", "")).toString();
                    if (auto* points = lv.getProperty("points", {}).getArray())
                        for (const auto& pv : *points)
                        {
                            if (!pv.isObject()) continue;
                            MidiAutomationPoint point;
                            point.beat = (double) pv.getProperty("beat", 0.0);
                            point.value = (float) (double) pv.getProperty("value", 0.0);
                            point.curve = (AutomationCurve) (int) pv.getProperty("curve", (int) AutomationCurve::Linear);
                            if (std::isfinite(point.beat) && std::isfinite(point.value)) lane.points.push_back(point);
                        }
                    if (!lane.target.isEmpty() && !lane.points.empty()) bus.automation.push_back(std::move(lane));
                }

            if (auto* filters = busVar.getProperty("effects", {}).getProperty("filters", {}).getArray())
            {
                for (const auto& ev : *filters)
                {
                    auto effect = trackEffectFromVar(ev);
                    if (effect.kind != TrackEffectKind::Unknown)
                        bus.effects.push_back(std::move(effect));
                }
            }
            return bus;
        }

        juce::var trackToVar(const Track& t)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("id",        t.id);
            o->setProperty("name",      t.name);
            o->setProperty("kind",      (int) t.kind);
            o->setProperty("instrumentId", t.instrumentId);
            o->setProperty("audioFileId",  t.audioFileId);
            o->setProperty("parentTrackId", t.parentTrackId);
            o->setProperty("outputBusId", t.outputBusId);
            o->setProperty("outputEnabled", t.outputEnabled);
            o->setProperty("gainDb",    t.gainDb);
            o->setProperty("pan",       t.pan);
            o->setProperty("mute",      t.mute);
            o->setProperty("solo",      t.solo);
            o->setProperty("recordArmed", t.recordArmed);
            o->setProperty("inputMonitoring", t.inputMonitoring);
            o->setProperty("inputDeviceId", t.inputDeviceId);
            o->setProperty("inputChannelStart", t.inputChannelStart);
            o->setProperty("inputChannelCount", t.inputChannelCount);
            o->setProperty("recordGainDb", t.recordGainDb);

            juce::Array<juce::var> sendArr;
            for (const auto& send : t.sends)
                sendArr.add(trackSendToVar(send));
            o->setProperty("sends", sendArr);

            juce::Array<juce::var> effectArr;
            for (const auto& effect : t.effects)
                effectArr.add(trackEffectToVar(effect));
            juce::DynamicObject::Ptr effects = new juce::DynamicObject();
            effects->setProperty("filters", effectArr);
            o->setProperty("effects", juce::var(effects.get()));

            juce::Array<juce::var> segArr;
            for (const auto& s : t.segments)
            {
                juce::DynamicObject::Ptr so = new juce::DynamicObject();
                so->setProperty("id",          s.id);
                so->setProperty("startBeat",   s.startBeat);
                so->setProperty("lengthBeats", s.lengthBeats);
                so->setProperty("sourceStartBeat", s.sourceStartBeat);
                so->setProperty("fadeInBeats", s.fadeInBeats);
                so->setProperty("fadeOutBeats", s.fadeOutBeats);
                so->setProperty("repeats",     s.repeats);
                so->setProperty("layer",       s.layer);
                so->setProperty("muted",       s.muted);
                so->setProperty("kind",        (int) s.kind);
                so->setProperty("audioFileId", s.audioFileId);
                so->setProperty("audioGainDb", s.audioGainDb);

                juce::Array<juce::var> notesArr;
                for (const auto& n : s.notes)
                {
                    juce::DynamicObject::Ptr no = new juce::DynamicObject();
                    no->setProperty("pitch",      n.pitch);
                    no->setProperty("velocity",   n.velocity);
                    no->setProperty("startBeat",  n.startBeat);
                    no->setProperty("lengthBeats",n.lengthBeats);
                    if (n.connectToIndex >= 0)
                        no->setProperty("connectToIndex", n.connectToIndex);
                    if (!n.curve.empty())
                    {
                        juce::Array<juce::var> curveArr;
                        for (const auto& point : n.curve)
                        {
                            juce::DynamicObject::Ptr pointObject = new juce::DynamicObject();
                            pointObject->setProperty("beat", point.beat);
                            pointObject->setProperty("pitch", point.pitch);
                            curveArr.add(juce::var(pointObject.get()));
                        }
                        no->setProperty("curve", curveArr);
                    }
                    if (!n.automation.empty())
                    {
                        juce::Array<juce::var> automationArr;
                        for (const auto& lane : n.automation)
                        {
                            juce::DynamicObject::Ptr laneObject = new juce::DynamicObject();
                            laneObject->setProperty("target", lane.target);
                            juce::Array<juce::var> pointsArr;
                            for (const auto& point : lane.points)
                            {
                                juce::DynamicObject::Ptr pointObject = new juce::DynamicObject();
                                pointObject->setProperty("beat", point.beat);
                                pointObject->setProperty("value", point.value);
                                pointObject->setProperty("curve", (int) point.curve);
                                pointsArr.add(juce::var(pointObject.get()));
                            }
                            laneObject->setProperty("points", pointsArr);
                            automationArr.add(juce::var(laneObject.get()));
                        }
                        no->setProperty("automation", automationArr);
                    }
                    notesArr.add(juce::var(no.get()));
                }
                so->setProperty("notes", notesArr);
                segArr.add(juce::var(so.get()));
            }
            o->setProperty("segments", segArr);
            return juce::var(o.get());
        }

        juce::var audioFileToVar(const AudioFileAsset& audioFile)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("id", audioFile.id);
            o->setProperty("name", audioFile.name);
            o->setProperty("path", audioFile.path);
            o->setProperty("durationSeconds", audioFile.durationSeconds);
            o->setProperty("sampleRate", audioFile.sampleRate);
            return juce::var(o.get());
        }

        juce::var sampleZoneToVar(const InstrumentDefinition::SampleZone& zone)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("path", zone.path);
            o->setProperty("rootNote", zone.rootNote);
            o->setProperty("loNote", zone.loNote);
            o->setProperty("hiNote", zone.hiNote);
            o->setProperty("loVel", zone.loVel);
            o->setProperty("hiVel", zone.hiVel);
            o->setProperty("volumeDb", zone.volumeDb);
            o->setProperty("pan", zone.pan);
            o->setProperty("tuningCents", zone.tuningCents);
            o->setProperty("seqPosition", zone.seqPosition);
            o->setProperty("loopEnabled", zone.loopEnabled);
            o->setProperty("loopStart", zone.loopStart);
            o->setProperty("loopEnd", zone.loopEnd);
            o->setProperty("oneShot", zone.oneShot);
            o->setProperty("durationSeconds", zone.durationSeconds);
            o->setProperty("loLengthSeconds", zone.loLengthSeconds);
            o->setProperty("hiLengthSeconds", zone.hiLengthSeconds);
            o->setProperty("chokeGroup", zone.chokeGroup);
            o->setProperty("startSample", zone.startSample);
            o->setProperty("endSample", zone.endSample);
            return juce::var(o.get());
        }

        juce::String nodemapString(std::string_view value)
        {
            return juce::String(value.data(), value.size());
        }

        juce::var nodemapNodeToVar(const Nodemap::Node& node)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("id", nodemapString(node.id));
            o->setProperty("kind", nodemapString(Nodemap::nodeKindToString(node.kind)));
            o->setProperty("label", nodemapString(node.label));
            o->setProperty("x", node.x);
            o->setProperty("y", node.y);

            juce::DynamicObject::Ptr params = new juce::DynamicObject();
            for (const auto& [key, value] : node.params)
                params->setProperty(juce::Identifier(nodemapString(key)), value);
            o->setProperty("params", juce::var(params.get()));
            return juce::var(o.get());
        }

        juce::var nodemapCableToVar(const Nodemap::Cable& cable)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("id", nodemapString(cable.id));
            o->setProperty("fromNodeId", nodemapString(cable.fromNodeId));
            o->setProperty("fromPortId", nodemapString(cable.fromPortId));
            o->setProperty("toNodeId", nodemapString(cable.toNodeId));
            o->setProperty("toPortId", nodemapString(cable.toPortId));
            o->setProperty("amount", cable.amount);
            return juce::var(o.get());
        }

        juce::var nodemapGraphToVar(const Nodemap::Graph& graph)
        {
            const auto normalized = Nodemap::validateAndNormalize(graph).graph;
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("schemaVersion", normalized.schemaVersion);

            juce::Array<juce::var> nodes;
            for (const auto& node : normalized.nodes)
                nodes.add(nodemapNodeToVar(node));
            o->setProperty("nodes", nodes);

            juce::Array<juce::var> cables;
            for (const auto& cable : normalized.cables)
                cables.add(nodemapCableToVar(cable));
            o->setProperty("cables", cables);
            return juce::var(o.get());
        }

        std::optional<Nodemap::Graph> nodemapGraphFromVar(const juce::var& graphVar)
        {
            if (!graphVar.isObject())
                return std::nullopt;

            Nodemap::Graph graph;
            graph.schemaVersion = juce::jmax(1, (int) graphVar.getProperty("schemaVersion", 1));

            if (auto* nodes = graphVar.getProperty("nodes", {}).getArray())
            {
                for (const auto& nv : *nodes)
                {
                    if (!nv.isObject())
                        continue;
                    const auto kind = Nodemap::nodeKindFromString(nv.getProperty("kind", "oscillator").toString().toStdString());
                    if (!kind)
                        continue;

                    Nodemap::Node node;
                    node.id = nv.getProperty("id", "").toString().toStdString();
                    node.kind = *kind;
                    node.label = nv.getProperty("label", juce::String(Nodemap::definitionFor(*kind).label)).toString().toStdString();
                    node.x = (double) nv.getProperty("x", 0.0);
                    node.y = (double) nv.getProperty("y", 0.0);

                    const auto paramsVar = nv.getProperty("params", {});
                    if (auto* params = paramsVar.getDynamicObject())
                    {
                        const auto& properties = params->getProperties();
                        for (int i = 0; i < properties.size(); ++i)
                            node.params[properties.getName(i).toString().toStdString()] = (float) (double) properties.getValueAt(i);
                    }
                    graph.nodes.push_back(std::move(node));
                }
            }

            if (auto* cables = graphVar.getProperty("cables", {}).getArray())
            {
                for (const auto& cv : *cables)
                {
                    if (!cv.isObject())
                        continue;
                    Nodemap::Cable cable;
                    cable.id = cv.getProperty("id", "").toString().toStdString();
                    cable.fromNodeId = cv.getProperty("fromNodeId", "").toString().toStdString();
                    cable.fromPortId = cv.getProperty("fromPortId", "").toString().toStdString();
                    cable.toNodeId = cv.getProperty("toNodeId", "").toString().toStdString();
                    cable.toPortId = cv.getProperty("toPortId", "").toString().toStdString();
                    cable.amount = juce::jlimit(-16.0f, 16.0f, (float) (double) cv.getProperty("amount", 1.0));
                    graph.cables.push_back(std::move(cable));
                }
            }

            return Nodemap::validateAndNormalize(graph).graph;
        }

        juce::var instrumentToVar(const InstrumentDefinition& instrument)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("id", instrument.id);
            o->setProperty("kind", instrument.kind);
            o->setProperty("waveform", instrument.waveform);
            o->setProperty("cutoff01", instrument.cutoff01);
            o->setProperty("filterKeytrack", instrument.filterKeytrack);
            o->setProperty("resonance01", instrument.resonance01);
            o->setProperty("drive01", instrument.drive01);
            o->setProperty("color01", instrument.color01);
            o->setProperty("filterType", instrument.filterType);
            o->setProperty("attackMs", instrument.attackMs);
            o->setProperty("attackCurve", instrument.attackCurve);
            o->setProperty("decayMs", instrument.decayMs);
            o->setProperty("decayCurve", instrument.decayCurve);
            o->setProperty("sustain", instrument.sustain);
            o->setProperty("releaseMs", instrument.releaseMs);
            o->setProperty("releaseCurve", instrument.releaseCurve);
            o->setProperty("env1Loop", instrument.env1Loop);
            o->setProperty("env2AttackMs", instrument.env2AttackMs);
            o->setProperty("env2AttackCurve", instrument.env2AttackCurve);
            o->setProperty("env2DecayMs", instrument.env2DecayMs);
            o->setProperty("env2DecayCurve", instrument.env2DecayCurve);
            o->setProperty("env2Sustain", instrument.env2Sustain);
            o->setProperty("env2ReleaseMs", instrument.env2ReleaseMs);
            o->setProperty("env2ReleaseCurve", instrument.env2ReleaseCurve);
            o->setProperty("env2Loop", instrument.env2Loop);
            o->setProperty("ampLevel", instrument.ampLevel);
            o->setProperty("ampPan", instrument.ampPan);
            o->setProperty("glideMs", instrument.glideMs);
            o->setProperty("maxVoices", instrument.maxVoices);
            o->setProperty("mono", instrument.mono);
            o->setProperty("legato", instrument.legato);
            o->setProperty("wavetableBank", instrument.wavetableBank);
            o->setProperty("wavetablePosition", instrument.wavetablePosition);
            o->setProperty("wavetableWarp", instrument.wavetableWarp);
            o->setProperty("wavetableWarpMode", instrument.wavetableWarpMode);
            o->setProperty("wavetableUnison", instrument.wavetableUnison);
            o->setProperty("wavetableDetuneCents", instrument.wavetableDetuneCents);
            o->setProperty("wavetableBlend", instrument.wavetableBlend);
            o->setProperty("lfoWaveform", instrument.lfoWaveform);
            o->setProperty("lfoRateHz", instrument.lfoRateHz);
            o->setProperty("lfoDepth", instrument.lfoDepth);
            o->setProperty("lfoSync", instrument.lfoSync);
            o->setProperty("lfoSyncedRate", instrument.lfoSyncedRate);
            o->setProperty("lfoSmoothing", instrument.lfoSmoothing);
            o->setProperty("lfoRandomPhase", instrument.lfoRandomPhase);
            o->setProperty("lfoPhase", instrument.lfoPhaseOffset);
            o->setProperty("lfoRetrigger", instrument.lfoRetrigger);
            o->setProperty("lfoOneShot", instrument.lfoOneShot);
            o->setProperty("lfo2Enabled", instrument.lfo2Enabled);
            o->setProperty("lfo2Waveform", instrument.lfo2Waveform);
            o->setProperty("lfo2RateHz", instrument.lfo2RateHz);
            o->setProperty("lfo2Sync", instrument.lfo2Sync);
            o->setProperty("lfo2SyncedRate", instrument.lfo2SyncedRate);
            o->setProperty("lfo2Smoothing", instrument.lfo2Smoothing);
            o->setProperty("lfo2RandomPhase", instrument.lfo2RandomPhase);
            o->setProperty("lfo2Phase", instrument.lfo2PhaseOffset);
            o->setProperty("lfo2Retrigger", instrument.lfo2Retrigger);
            o->setProperty("lfo2OneShot", instrument.lfo2OneShot);
            o->setProperty("lfoPositionBipolar", instrument.lfoPositionBipolar);
            o->setProperty("lfoPitchBipolar", instrument.lfoPitchBipolar);
            o->setProperty("lfoFilterBipolar", instrument.lfoFilterBipolar);
            o->setProperty("lfoToPitch", instrument.lfoToPitch);
            o->setProperty("lfoToFilter", instrument.lfoToFilter);
            o->setProperty("envToFilter", instrument.envToFilter);
            juce::Array<juce::var> macroValues;
            for (const auto macroValue : instrument.macroValues)
                macroValues.add(macroValue);
            o->setProperty("macroValues", macroValues);
            o->setProperty("dynamicModulation", dynamicModulationToVar(instrument.dynamicModulation));
            o->setProperty("hasAether", instrument.hasAether);
            if (instrument.hasAether)
                o->setProperty("aether", aetherConfigToVar(instrument.aether));
            if (instrument.nodeGraph)
                o->setProperty("nodeGraph", nodemapGraphToVar(*instrument.nodeGraph));
            if (!instrument.taxonomy.isVoid())
                o->setProperty("taxonomy", instrument.taxonomy);

            juce::Array<juce::var> effectArr;
            for (const auto& effect : instrument.effects)
                effectArr.add(trackEffectToVar(effect));
            juce::DynamicObject::Ptr effects = new juce::DynamicObject();
            effects->setProperty("filters", effectArr);
            o->setProperty("effects", juce::var(effects.get()));

            juce::Array<juce::var> sampleUrls;
            for (const auto& sampleUrl : instrument.sampleUrls)
                sampleUrls.add(sampleUrl);
            o->setProperty("sampleUrls", sampleUrls);

            juce::Array<juce::var> sampleZones;
            for (const auto& zone : instrument.sampleZones)
                sampleZones.add(sampleZoneToVar(zone));
            o->setProperty("sampleZones", sampleZones);
            return juce::var(o.get());
        }

        juce::String projectToJson(const Project& p)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("id",         p.id);
            o->setProperty("name",       p.name);
            o->setProperty("bpm",        p.bpm);
            o->setProperty("lengthBeats",p.lengthBeats);
            o->setProperty("tsNum",      p.timeSignatureNum);
            o->setProperty("tsDenom",    p.timeSignatureDenom);
            o->setProperty("recordingInput", recordingInputToVar(p.recordingInput));
            o->setProperty("masterChain", masterChainToVar(p.masterChain));

            juce::Array<juce::var> trackArr;
            for (const auto& t : p.tracks) trackArr.add(trackToVar(t));
            o->setProperty("tracks", trackArr);

            juce::Array<juce::var> returnBusArr;
            for (const auto& bus : p.returnBuses)
                returnBusArr.add(returnBusToVar(bus));
            o->setProperty("returnBuses", returnBusArr);

            juce::Array<juce::var> audioFileArr;
            for (const auto& audioFile : p.audioFiles)
                audioFileArr.add(audioFileToVar(audioFile));
            o->setProperty("audioFiles", audioFileArr);

            juce::Array<juce::var> instrumentArr;
            for (const auto& instrument : p.instruments)
                instrumentArr.add(instrumentToVar(instrument));
            o->setProperty("instruments", instrumentArr);

            juce::Array<juce::var> pluginArr;
            for (const auto& plugin : p.plugins)
                pluginArr.add(pluginToVar(plugin));
            o->setProperty("plugins", pluginArr);

            juce::Array<juce::var> eqArr;
            for (const auto& e : p.eqAutomation)
            {
                juce::DynamicObject::Ptr eo = new juce::DynamicObject();
                eo->setProperty("atBeat", e.atBeat);
                eo->setProperty("lowDb",  e.lowDb);
                eo->setProperty("midDb",  e.midDb);
                eo->setProperty("highDb", e.highDb);
                eo->setProperty("airDb",  e.airDb);
                eqArr.add(juce::var(eo.get()));
            }
            o->setProperty("eqAutomation", eqArr);

            return juce::JSON::toString(juce::var(o.get()), true);
        }

        Project projectFromJson(const juce::String& json)
        {
            Project p;
            auto parsed = juce::JSON::parse(json);
            if (!parsed.isObject()) return p;

            p.id                 = parsed.getProperty("id", "").toString();
            p.name               = parsed.getProperty("name", "Untitled").toString();
            p.bpm                = (double) parsed.getProperty("bpm", 120.0);
            p.lengthBeats        = (double) parsed.getProperty("lengthBeats", 64.0);
            p.timeSignatureNum   = (int)    parsed.getProperty("tsNum", 4);
            p.timeSignatureDenom = (int)    parsed.getProperty("tsDenom", 4);
            p.recordingInput = recordingInputFromVar(parsed.getProperty("recordingInput", {}));
            p.masterChain = masterChainFromVar(parsed.getProperty("masterChain", {}));

            if (auto* audioFiles = parsed.getProperty("audioFiles", {}).getArray())
            {
                for (const auto& av : *audioFiles)
                {
                    if (!av.isObject()) continue;
                    AudioFileAsset audioFile;
                    audioFile.id = av.getProperty("id", "").toString();
                    audioFile.name = av.getProperty("name", "").toString();
                    audioFile.path = av.getProperty("path", "").toString();
                    audioFile.durationSeconds = juce::jmax(0.0, (double) av.getProperty("durationSeconds", 0.0));
                    audioFile.sampleRate = juce::jmax(0.0, (double) av.getProperty("sampleRate", 0.0));
                    if (audioFile.id.isNotEmpty() && audioFile.path.isNotEmpty())
                        p.audioFiles.push_back(std::move(audioFile));
                }
            }

            if (auto* instruments = parsed.getProperty("instruments", {}).getArray())
            {
                for (const auto& iv : *instruments)
                {
                    if (!iv.isObject()) continue;
                    InstrumentDefinition instrument;
                    instrument.id = iv.getProperty("id", "").toString();
                    instrument.kind = iv.getProperty("kind", "").toString();
                    if (instrument.id.isEmpty())
                        continue;

                    instrument.waveform = juce::jlimit(0, 8, (int) iv.getProperty("waveform", instrument.waveform));
                    instrument.cutoff01 = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("cutoff01", instrument.cutoff01));
                    instrument.filterKeytrack = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("filterKeytrack", instrument.filterKeytrack));
                    instrument.resonance01 = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("resonance01", instrument.resonance01));
                    instrument.drive01 = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("drive01", instrument.drive01));
                    instrument.color01 = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("color01", instrument.color01));
                    instrument.filterType = juce::jlimit(0, 8, (int) iv.getProperty("filterType", instrument.filterType));
                    instrument.attackMs = juce::jlimit(0.0f, 10000.0f, (float) (double) iv.getProperty("attackMs", instrument.attackMs));
                    instrument.attackCurve = juce::jlimit(0, 3, (int) iv.getProperty("attackCurve", instrument.attackCurve));
                    instrument.decayMs = juce::jlimit(0.0f, 10000.0f, (float) (double) iv.getProperty("decayMs", instrument.decayMs));
                    instrument.decayCurve = juce::jlimit(0, 3, (int) iv.getProperty("decayCurve", instrument.decayCurve));
                    instrument.sustain = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("sustain", instrument.sustain));
                    instrument.releaseMs = juce::jlimit(0.0f, 10000.0f, (float) (double) iv.getProperty("releaseMs", instrument.releaseMs));
                    instrument.releaseCurve = juce::jlimit(0, 3, (int) iv.getProperty("releaseCurve", instrument.releaseCurve));
                    instrument.env1Loop = (bool) iv.getProperty("env1Loop", instrument.env1Loop);
                    instrument.env2AttackMs = juce::jlimit(0.0f, 10000.0f, (float) (double) iv.getProperty("env2AttackMs", instrument.env2AttackMs));
                    instrument.env2AttackCurve = juce::jlimit(0, 3, (int) iv.getProperty("env2AttackCurve", instrument.env2AttackCurve));
                    instrument.env2DecayMs = juce::jlimit(0.0f, 10000.0f, (float) (double) iv.getProperty("env2DecayMs", instrument.env2DecayMs));
                    instrument.env2DecayCurve = juce::jlimit(0, 3, (int) iv.getProperty("env2DecayCurve", instrument.env2DecayCurve));
                    instrument.env2Sustain = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("env2Sustain", instrument.env2Sustain));
                    instrument.env2ReleaseMs = juce::jlimit(0.0f, 10000.0f, (float) (double) iv.getProperty("env2ReleaseMs", instrument.env2ReleaseMs));
                    instrument.env2ReleaseCurve = juce::jlimit(0, 3, (int) iv.getProperty("env2ReleaseCurve", instrument.env2ReleaseCurve));
                    instrument.env2Loop = (bool) iv.getProperty("env2Loop", instrument.env2Loop);
                    instrument.ampLevel = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("ampLevel", instrument.ampLevel));
                    instrument.ampPan = juce::jlimit(-1.0f, 1.0f, (float) (double) iv.getProperty("ampPan", instrument.ampPan));
                    instrument.glideMs = juce::jlimit(0.0f, 5000.0f, (float) (double) iv.getProperty("glideMs", instrument.glideMs));
                    instrument.maxVoices = juce::jlimit(1, 32, (int) iv.getProperty("maxVoices", instrument.maxVoices));
                    instrument.mono = (bool) iv.getProperty("mono", instrument.mono);
                    instrument.legato = (bool) iv.getProperty("legato", instrument.legato);
                    instrument.wavetableBank = juce::jlimit(0, 8, (int) iv.getProperty("wavetableBank", instrument.wavetableBank));
                    instrument.wavetablePosition = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("wavetablePosition", instrument.wavetablePosition));
                    instrument.wavetableWarp = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("wavetableWarp", instrument.wavetableWarp));
                    instrument.wavetableWarpMode = juce::jlimit(0, 3, (int) iv.getProperty("wavetableWarpMode", instrument.wavetableWarpMode));
                    instrument.wavetableUnison = juce::jlimit(1, 8, (int) iv.getProperty("wavetableUnison", instrument.wavetableUnison));
                    instrument.wavetableDetuneCents = juce::jlimit(0.0f, 100.0f, (float) (double) iv.getProperty("wavetableDetuneCents", instrument.wavetableDetuneCents));
                    instrument.wavetableBlend = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("wavetableBlend", instrument.wavetableBlend));
                    instrument.lfoWaveform = juce::jlimit(0, 8, (int) iv.getProperty("lfoWaveform", instrument.lfoWaveform));
                    instrument.lfoRateHz = juce::jlimit(0.01f, 40.0f, (float) (double) iv.getProperty("lfoRateHz", instrument.lfoRateHz));
                    instrument.lfoDepth = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("lfoDepth", instrument.lfoDepth));
                    instrument.lfoSync = (bool) iv.getProperty("lfoSync", instrument.lfoSync);
                    instrument.lfoSyncedRate = iv.getProperty("lfoSyncedRate", instrument.lfoSyncedRate).toString();
                    instrument.lfoSmoothing = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("lfoSmoothing", instrument.lfoSmoothing));
                    instrument.lfoRandomPhase = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("lfoRandomPhase", instrument.lfoRandomPhase));
                    instrument.lfoPhaseOffset = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("lfoPhase", instrument.lfoPhaseOffset));
                    instrument.lfoRetrigger = (bool) iv.getProperty("lfoRetrigger", instrument.lfoRetrigger);
                    instrument.lfoOneShot = (bool) iv.getProperty("lfoOneShot", instrument.lfoOneShot);
                    instrument.lfo2Enabled = (bool) iv.getProperty("lfo2Enabled", instrument.lfo2Enabled);
                    instrument.lfo2Waveform = juce::jlimit(0, 8, (int) iv.getProperty("lfo2Waveform", instrument.lfo2Waveform));
                    instrument.lfo2RateHz = juce::jlimit(0.01f, 40.0f, (float) (double) iv.getProperty("lfo2RateHz", instrument.lfo2RateHz));
                    instrument.lfo2Sync = (bool) iv.getProperty("lfo2Sync", instrument.lfo2Sync);
                    instrument.lfo2SyncedRate = iv.getProperty("lfo2SyncedRate", instrument.lfo2SyncedRate).toString();
                    instrument.lfo2Smoothing = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("lfo2Smoothing", instrument.lfo2Smoothing));
                    instrument.lfo2RandomPhase = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("lfo2RandomPhase", instrument.lfo2RandomPhase));
                    instrument.lfo2PhaseOffset = juce::jlimit(0.0f, 1.0f, (float) (double) iv.getProperty("lfo2Phase", instrument.lfo2PhaseOffset));
                    instrument.lfo2Retrigger = (bool) iv.getProperty("lfo2Retrigger", instrument.lfo2Retrigger);
                    instrument.lfo2OneShot = (bool) iv.getProperty("lfo2OneShot", instrument.lfo2OneShot);
                    instrument.lfoPositionBipolar = (bool) iv.getProperty("lfoPositionBipolar", instrument.lfoPositionBipolar);
                    instrument.lfoPitchBipolar = (bool) iv.getProperty("lfoPitchBipolar", instrument.lfoPitchBipolar);
                    instrument.lfoFilterBipolar = (bool) iv.getProperty("lfoFilterBipolar", instrument.lfoFilterBipolar);
                    instrument.lfoToPitch = juce::jlimit(0.0f, 24.0f, (float) (double) iv.getProperty("lfoToPitch", instrument.lfoToPitch));
                    instrument.lfoToFilter = juce::jlimit(-1.0f, 1.0f, (float) (double) iv.getProperty("lfoToFilter", instrument.lfoToFilter));
                    instrument.envToFilter = juce::jlimit(-1.0f, 1.0f, (float) (double) iv.getProperty("envToFilter", instrument.envToFilter));
                    if (auto* macroValues = iv.getProperty("macroValues", {}).getArray())
                    {
                        const auto count = juce::jmin((int) macroValues->size(), (int) instrument.macroValues.size());
                        for (int i = 0; i < count; ++i)
                            instrument.macroValues[(size_t) i] = juce::jlimit(0.0f, 1.0f, (float) (double) macroValues->getReference(i));
                    }
                    instrument.dynamicModulation = dynamicModulationFromVar(iv.getProperty("dynamicModulation", {}), instrument.dynamicModulation);
                    instrument.taxonomy = iv.getProperty("taxonomy", {});
                    instrument.hasAether = (bool) iv.getProperty("hasAether", instrument.hasAether);
                    InstrumentDefinition::WavetableConfig globalWavetable;
                    globalWavetable.bank = instrument.wavetableBank;
                    globalWavetable.position = instrument.wavetablePosition;
                    globalWavetable.warp = instrument.wavetableWarp;
                    globalWavetable.warpMode = instrument.wavetableWarpMode;
                    globalWavetable.unison = instrument.wavetableUnison;
                    globalWavetable.detuneCents = instrument.wavetableDetuneCents;
                    globalWavetable.blend = instrument.wavetableBlend;
                    const auto aether = iv.getProperty("aether", {});
                    if (aether.isObject() || instrument.hasAether)
                    {
                        instrument.hasAether = true;
                        instrument.aether = aetherConfigFromVar(aether, globalWavetable);
                    }
                    instrument.nodeGraph = nodemapGraphFromVar(iv.getProperty("nodeGraph", {}));

                    if (auto* filters = iv.getProperty("effects", {}).getProperty("filters", {}).getArray())
                    {
                        instrument.effects.reserve((size_t) filters->size());
                        for (const auto& ev : *filters)
                        {
                            auto effect = trackEffectFromVar(ev);
                            if (effect.kind != TrackEffectKind::Unknown)
                                instrument.effects.push_back(std::move(effect));
                        }
                    }

                    if (auto* sampleUrls = iv.getProperty("sampleUrls", {}).getArray())
                    {
                        for (const auto& sampleUrl : *sampleUrls)
                        {
                            const auto path = sampleUrl.toString();
                            if (path.isNotEmpty() && !instrument.sampleUrls.contains(path))
                                instrument.sampleUrls.add(path);
                        }
                    }

                    if (auto* sampleZones = iv.getProperty("sampleZones", {}).getArray())
                    {
                        for (const auto& zv : *sampleZones)
                        {
                            if (!zv.isObject()) continue;
                            InstrumentDefinition::SampleZone zone;
                            zone.path = zv.getProperty("path", "").toString();
                            if (zone.path.isEmpty()) continue;
                            zone.rootNote = juce::jlimit(0, 127, (int) zv.getProperty("rootNote", zone.rootNote));
                            zone.loNote = juce::jlimit(0, 127, (int) zv.getProperty("loNote", zone.loNote));
                            zone.hiNote = juce::jlimit(0, 127, (int) zv.getProperty("hiNote", zone.hiNote));
                            zone.loVel = juce::jlimit(0, 127, (int) zv.getProperty("loVel", zone.loVel));
                            zone.hiVel = juce::jlimit(0, 127, (int) zv.getProperty("hiVel", zone.hiVel));
                            zone.volumeDb = juce::jlimit(-48.0f, 24.0f, (float) (double) zv.getProperty("volumeDb", zone.volumeDb));
                            zone.pan = juce::jlimit(-1.0f, 1.0f, (float) (double) zv.getProperty("pan", zone.pan));
                            zone.tuningCents = juce::jlimit(-1200.0f, 1200.0f, (float) (double) zv.getProperty("tuningCents", zone.tuningCents));
                            zone.seqPosition = juce::jmax(0, (int) zv.getProperty("seqPosition", zone.seqPosition));
                            zone.loopEnabled = (bool) zv.getProperty("loopEnabled", zone.loopEnabled);
                            zone.loopStart = juce::jmax(0, (int) zv.getProperty("loopStart", zone.loopStart));
                            zone.loopEnd = juce::jmax(0, (int) zv.getProperty("loopEnd", zone.loopEnd));
                            zone.oneShot = (bool) zv.getProperty("oneShot", zone.oneShot);
                            zone.durationSeconds = juce::jmax(0.0, (double) zv.getProperty("durationSeconds", zone.durationSeconds));
                            zone.loLengthSeconds = juce::jmax(0.0, (double) zv.getProperty("loLengthSeconds", zone.loLengthSeconds));
                            zone.hiLengthSeconds = juce::jmax(0.0, (double) zv.getProperty("hiLengthSeconds", zone.hiLengthSeconds));
                            zone.chokeGroup = juce::jmax(0, (int) zv.getProperty("chokeGroup", zone.chokeGroup));
                            zone.startSample = juce::jmax(0, (int) zv.getProperty("startSample", zone.startSample));
                            zone.endSample = juce::jmax(0, (int) zv.getProperty("endSample", zone.endSample));
                            if (zone.loNote > zone.hiNote) std::swap(zone.loNote, zone.hiNote);
                            if (zone.loVel > zone.hiVel) std::swap(zone.loVel, zone.hiVel);
                            if (zone.hiLengthSeconds > 0.0 && zone.loLengthSeconds > zone.hiLengthSeconds)
                                std::swap(zone.loLengthSeconds, zone.hiLengthSeconds);
                            if (zone.endSample > 0 && zone.startSample >= zone.endSample)
                            {
                                zone.startSample = 0;
                                zone.endSample = 0;
                            }
                            if (zone.loopEnd > 0 && zone.loopStart >= zone.loopEnd)
                                zone.loopEnabled = false;
                            instrument.sampleZones.push_back(zone);
                            if (!instrument.sampleUrls.contains(zone.path))
                                instrument.sampleUrls.add(zone.path);
                        }
                    }

                    p.instruments.push_back(std::move(instrument));
                }
            }

            if (auto* plugins = parsed.getProperty("plugins", {}).getArray())
            {
                for (const auto& pv : *plugins)
                {
                    if (!pv.isObject()) continue;
                    PluginAdapterDefinition plugin;
                    plugin.id = pv.getProperty("id", "").toString();
                    plugin.name = pv.getProperty("name", "").toString();
                    plugin.vendor = pv.getProperty("vendor", "").toString();
                    plugin.version = pv.getProperty("version", "").toString();
                    plugin.kind = pv.getProperty("kind", "").toString();
                    plugin.format = pv.getProperty("format", "").toString();
                    plugin.status = pv.getProperty("status", "").toString();
                    plugin.instrumentMode = pv.getProperty("instrumentMode", "").toString();
                    plugin.description = pv.getProperty("description", "").toString();
                    plugin.sourceFileName = pv.getProperty("sourceFileName", "").toString();
                    plugin.sourcePath = pv.getProperty("sourcePath", "").toString();
                    plugin.uiImagePath = pv.getProperty("uiImagePath", "").toString();
                    plugin.uiImageDataUrl = pv.getProperty("uiImageDataUrl", "").toString();
                    plugin.associatedInstrumentId = pv.getProperty("associatedInstrumentId", "").toString();
                    plugin.uiWidth = (int) pv.getProperty("uiWidth", 0);
                    plugin.uiHeight = (int) pv.getProperty("uiHeight", 0);
                    plugin.uiControlDetails = pv.getProperty("uiControlDetails", {});
                    plugin.sampleCount = (int) pv.getProperty("sampleCount", 0);
                    plugin.uiControlCount = (int) pv.getProperty("uiControlCount", 0);
                    plugin.factory = (bool) pv.getProperty("factory", false);
                    plugin.installedAt = (double) pv.getProperty("installedAt", 0.0);

                    if (auto* capabilities = pv.getProperty("capabilities", {}).getArray())
                    {
                        for (const auto& cv : *capabilities)
                        {
                            if (!cv.isObject()) continue;
                            PluginCapability capability;
                            capability.id = cv.getProperty("id", "").toString();
                            capability.kind = cv.getProperty("kind", "").toString();
                            capability.label = cv.getProperty("label", cv.getProperty("name", "")).toString();
                            capability.realtime = (bool) cv.getProperty("realtime", false);
                            capability.offline = (bool) cv.getProperty("offline", false);
                            capability.latencySamples = juce::jlimit(0, 192000, (int) cv.getProperty("latencySamples", 0));
                            capability.fallbackMode = cv.getProperty("fallbackMode", cv.getProperty("fallback", "")).toString();
                            if (capability.kind.isNotEmpty())
                                plugin.capabilities.push_back(std::move(capability));
                        }
                    }

                    if (plugin.id.isNotEmpty())
                        p.plugins.push_back(std::move(plugin));
                }
            }

            if (auto* tracks = parsed.getProperty("tracks", {}).getArray())
            {
                for (const auto& tv : *tracks)
                {
                    Track t;
                    t.id    = tv.getProperty("id", "").toString();
                    t.name  = tv.getProperty("name", "").toString();
                    t.kind  = trackKindFromVar(tv.getProperty("kind", 0));
                    t.instrumentId = tv.getProperty("instrumentId", "").toString();
                    t.audioFileId  = tv.getProperty("audioFileId", "").toString();
                    t.parentTrackId = tv.getProperty("parentTrackId", "").toString();
                    t.outputBusId = tv.getProperty("outputBusId", "").toString();
                    t.outputEnabled = (bool) tv.getProperty("outputEnabled", true);
                    t.gainDb = (float) (double) tv.getProperty("gainDb", 0.0);
                    t.pan    = (float) (double) tv.getProperty("pan", 0.0);
                    t.mute   = (bool) tv.getProperty("mute", false);
                    t.solo   = (bool) tv.getProperty("solo", false);
                    t.recordArmed = (bool) tv.getProperty("recordArmed", false);
                    t.inputMonitoring = (bool) tv.getProperty("inputMonitoring", false);
                    t.inputDeviceId = tv.getProperty("inputDeviceId", "").toString();
                    t.inputChannelStart = juce::jlimit(0, 1024, (int) tv.getProperty("inputChannelStart", 0));
                    t.inputChannelCount = juce::jlimit(1, 1024, (int) tv.getProperty("inputChannelCount", 1));
                    t.recordGainDb = (float) (double) tv.getProperty("recordGainDb", 0.0);

                    if (auto* sends = tv.getProperty("sends", {}).getArray())
                    {
                        for (const auto& sv : *sends)
                        {
                            auto send = trackSendFromVar(sv);
                            if (send.busId.isNotEmpty())
                                t.sends.push_back(send);
                        }
                    }

                    if (auto* filters = tv.getProperty("effects", {}).getProperty("filters", {}).getArray())
                    {
                        for (const auto& ev : *filters)
                        {
                            auto effect = trackEffectFromVar(ev);
                            if (effect.kind != TrackEffectKind::Unknown)
                                t.effects.push_back(std::move(effect));
                        }
                    }

                    if (auto* segs = tv.getProperty("segments", {}).getArray())
                    {
                        for (const auto& sv : *segs)
                        {
                            Segment s;
                            s.id          = sv.getProperty("id", "").toString();
                            s.trackId     = t.id;
                            s.startBeat   = (double) sv.getProperty("startBeat", 0.0);
                            s.lengthBeats = (double) sv.getProperty("lengthBeats", 4.0);
                            s.sourceStartBeat = (double) sv.getProperty("sourceStartBeat", 0.0);
                            s.fadeInBeats = (double) sv.getProperty("fadeInBeats", 0.0);
                            s.fadeOutBeats = (double) sv.getProperty("fadeOutBeats", 0.0);
                            s.repeats     = (int) sv.getProperty("repeats", 0);
                            s.layer       = (int) sv.getProperty("layer", 0);
                            s.muted       = (bool) sv.getProperty("muted", false);
                            s.kind        = (SegmentPayloadKind) (int) sv.getProperty("kind", 1);
                            s.audioFileId = sv.getProperty("audioFileId", "").toString();
                            s.audioGainDb = (float) (double) sv.getProperty("audioGainDb", 0.0);

                            if (auto* notes = sv.getProperty("notes", {}).getArray())
                            {
                                for (const auto& nv : *notes)
                                {
                                    MidiNote n;
                                    n.pitch       = (int) nv.getProperty("pitch", 60);
                                    n.velocity    = (int) nv.getProperty("velocity", 100);
                                    n.startBeat   = (double) nv.getProperty("startBeat", 0.0);
                                    n.lengthBeats = (double) nv.getProperty("lengthBeats", 0.25);
                                    n.connectToIndex = juce::jmax(-1, (int) nv.getProperty("connectToIndex", -1));
                                    if (auto* curve = nv.getProperty("curve", {}).getArray())
                                    {
                                        n.curve.reserve((size_t) curve->size());
                                        for (const auto& pointVar : *curve)
                                        {
                                            if (!pointVar.isObject()) continue;
                                            MidiPitchCurvePoint point;
                                            point.beat = (double) pointVar.getProperty("beat", n.startBeat);
                                            point.pitch = juce::jlimit(0.0, 127.0, (double) pointVar.getProperty("pitch", (double) n.pitch));
                                            if (std::isfinite(point.beat) && std::isfinite(point.pitch))
                                                n.curve.push_back(point);
                                        }
                                        std::sort(n.curve.begin(), n.curve.end(),
                                                  [](const MidiPitchCurvePoint& a, const MidiPitchCurvePoint& b) {
                                                      return a.beat < b.beat;
                                                  });
                                    }
                                    if (auto* automation = nv.getProperty("automation", {}).getArray())
                                    {
                                        for (const auto& laneVar : *automation)
                                        {
                                            if (!laneVar.isObject()) continue;
                                            MidiAutomationLane lane;
                                            lane.target = laneVar.getProperty("target", "").toString();
                                            if (lane.target.isEmpty() || lane.target == "pitch")
                                                continue;

                                            if (auto* points = laneVar.getProperty("points", {}).getArray())
                                            {
                                                lane.points.reserve((size_t) points->size());
                                                for (const auto& pointVar : *points)
                                                {
                                                    if (!pointVar.isObject()) continue;
                                                    MidiAutomationPoint point;
                                                    point.beat = (double) pointVar.getProperty("beat", n.startBeat);
                                                    point.value = (float) (double) pointVar.getProperty("value", 0.0);
                                                    point.curve = (AutomationCurve) (int) pointVar.getProperty("curve", (int) AutomationCurve::Linear);
                                                    if (std::isfinite(point.beat) && std::isfinite(point.value))
                                                        lane.points.push_back(point);
                                                }
                                            }

                                            if (!lane.points.empty())
                                            {
                                                std::sort(lane.points.begin(), lane.points.end(),
                                                          [](const MidiAutomationPoint& a, const MidiAutomationPoint& b) {
                                                              return a.beat < b.beat;
                                                          });
                                                n.automation.push_back(std::move(lane));
                                            }
                                        }
                                    }
                                    s.notes.push_back(n);
                                }
                            }
                            t.segments.push_back(std::move(s));
                        }
                    }
                    p.tracks.push_back(std::move(t));
                }
            }

            if (auto* buses = parsed.getProperty("returnBuses", {}).getArray())
            {
                for (const auto& bv : *buses)
                {
                    auto bus = returnBusFromVar(bv);
                    if (bus.id.isNotEmpty())
                        p.returnBuses.push_back(std::move(bus));
                }
            }

            if (auto* eq = parsed.getProperty("eqAutomation", {}).getArray())
            {
                for (const auto& ev : *eq)
                {
                    EqAutomationPoint e;
                    e.atBeat = (double) ev.getProperty("atBeat", 0.0);
                    e.lowDb  = (float) (double) ev.getProperty("lowDb", 0.0);
                    e.midDb  = (float) (double) ev.getProperty("midDb", 0.0);
                    e.highDb = (float) (double) ev.getProperty("highDb", 0.0);
                    e.airDb  = (float) (double) ev.getProperty("airDb", 0.0);
                    p.eqAutomation.push_back(e);
                }
            }
            return p;
        }

        juce::String recentProjectNameFor(const juce::File& file, const juce::var& document = {})
        {
            if (document.isObject())
            {
                const auto project = document.getProperty("project", {});
                const auto name = project.getProperty("name", {}).toString().trim();
                if (name.isNotEmpty())
                    return name;
            }

            return file.getFileNameWithoutExtension().isNotEmpty()
                ? file.getFileNameWithoutExtension()
                : juce::String("Untitled");
        }

        juce::int64 normalizeTimestampMs(juce::int64 timestamp)
        {
            if (timestamp <= 0)
                return 0;

            constexpr juce::int64 minPlausibleRecentTimestampMs = 1704067200000LL; // 2024-01-01

            // Older recent-project rows were stored as Unix seconds. The
            // frontend contract is JavaScript timestamps in milliseconds.
            const auto timestampMs = timestamp < 100000000000LL ? timestamp * 1000 : timestamp;
            return timestampMs >= minPlausibleRecentTimestampMs ? timestampMs : 0;
        }
    }

    void ProjectRepository::save(const Project& p)
    {
        Statement stmt(db, R"sql(
            INSERT INTO projects(id, name, bpm, length_beats, saved_at, json_blob)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              bpm = excluded.bpm,
              length_beats = excluded.length_beats,
              saved_at = excluded.saved_at,
              json_blob = excluded.json_blob
        )sql");
        stmt.bind(1, p.id);
        stmt.bind(2, p.name);
        stmt.bind(3, (double) p.bpm);
        stmt.bind(4, (double) p.lengthBeats);
        stmt.bind(5, (int) (juce::Time::currentTimeMillis() / 1000));
        stmt.bind(6, projectToJson(p));
        stmt.step();
    }

    std::optional<Project> ProjectRepository::load(const Id& id)
    {
        Statement stmt(db, "SELECT json_blob FROM projects WHERE id = ?");
        stmt.bind(1, id);
        if (!stmt.step()) return std::nullopt;
        return projectFromJson(stmt.columnText(0));
    }

    std::vector<ProjectRepository::Summary> ProjectRepository::list()
    {
        std::vector<Summary> out;
        Statement stmt(db, "SELECT id, name, saved_at FROM projects ORDER BY saved_at DESC");
        while (stmt.step())
        {
            out.push_back({ stmt.columnText(0), stmt.columnText(1), (juce::int64) stmt.columnInt(2) });
        }
        return out;
    }

    void ProjectRepository::remove(const Id& id)
    {
        Statement stmt(db, "DELETE FROM projects WHERE id = ?");
        stmt.bind(1, id);
        stmt.step();
    }

    void ProjectRepository::recordRecentProject(const juce::File& file, const juce::var& document)
    {
        if (file.getFullPathName().isEmpty())
            return;

        Statement stmt(db, R"sql(
            INSERT INTO recent_projects(path, name, opened_at, size_bytes)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                name = excluded.name,
                opened_at = excluded.opened_at,
                size_bytes = excluded.size_bytes
        )sql");
        stmt.bind(1, file.getFullPathName());
        stmt.bind(2, recentProjectNameFor(file, document));
        stmt.bind(3, (double) juce::Time::currentTimeMillis());
        stmt.bind(4, static_cast<double>(file.existsAsFile() ? file.getSize() : 0));
        stmt.step();

        db.exec(R"sql(
            DELETE FROM recent_projects
            WHERE path NOT IN (
                SELECT path FROM recent_projects
                ORDER BY opened_at DESC
                LIMIT 16
            )
        )sql");
    }

    std::vector<ProjectRepository::RecentProject> ProjectRepository::listRecentProjects(int limit)
    {
        std::vector<RecentProject> out;
        Statement stmt(db, R"sql(
            SELECT path, name, opened_at, size_bytes
            FROM recent_projects
            ORDER BY opened_at DESC
            LIMIT ?
        )sql");
        stmt.bind(1, juce::jlimit(1, 128, limit));
        while (stmt.step())
        {
            const auto path = stmt.columnText(0);
            out.push_back({
                path,
                stmt.columnText(1),
                normalizeTimestampMs((juce::int64) stmt.columnDouble(2)),
                stmt.columnDouble(3),
                // Do not probe recent-project paths while building the startup
                // list. On macOS, checking a file under Documents can trigger
                // a TCC permission prompt before the user chooses to open it.
                path.isNotEmpty(),
            });
        }
        return out;
    }

    void ProjectRepository::removeRecentProject(const juce::String& path)
    {
        if (path.isEmpty())
            return;

        Statement stmt(db, "DELETE FROM recent_projects WHERE path = ?");
        stmt.bind(1, path);
        stmt.step();
    }
}

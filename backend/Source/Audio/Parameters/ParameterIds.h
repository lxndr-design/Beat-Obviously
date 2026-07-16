#pragma once

#include <array>
#include <string_view>

namespace beat::params
{
    inline constexpr int patchSchemaVersion = 1;
    inline constexpr std::string_view instrumentTypeWavetableSynth { "wavetable-synth" };
    inline constexpr std::string_view synthNamespace { "synth" };

    namespace oscillator
    {
        namespace a
        {
            inline constexpr std::string_view enabled { "osc.a.enabled" };
            inline constexpr std::string_view wavetable { "osc.a.wavetable" };
            inline constexpr std::string_view position { "osc.a.position" };
            inline constexpr std::string_view warp { "osc.a.warp" };
            inline constexpr std::string_view warpMode { "osc.a.warpMode" };
            inline constexpr std::string_view octave { "osc.a.octave" };
            inline constexpr std::string_view semitone { "osc.a.semitone" };
            inline constexpr std::string_view fine { "osc.a.fine" };
            inline constexpr std::string_view level { "osc.a.level" };
            inline constexpr std::string_view pan { "osc.a.pan" };
            inline constexpr std::string_view phase { "osc.a.phase" };
            inline constexpr std::string_view randomPhase { "osc.a.randomPhase" };
        }

        namespace b
        {
            inline constexpr std::string_view enabled { "osc.b.enabled" };
            inline constexpr std::string_view wavetable { "osc.b.wavetable" };
            inline constexpr std::string_view position { "osc.b.position" };
            inline constexpr std::string_view warp { "osc.b.warp" };
            inline constexpr std::string_view warpMode { "osc.b.warpMode" };
            inline constexpr std::string_view octave { "osc.b.octave" };
            inline constexpr std::string_view semitone { "osc.b.semitone" };
            inline constexpr std::string_view fine { "osc.b.fine" };
            inline constexpr std::string_view level { "osc.b.level" };
            inline constexpr std::string_view pan { "osc.b.pan" };
            inline constexpr std::string_view phase { "osc.b.phase" };
            inline constexpr std::string_view randomPhase { "osc.b.randomPhase" };
        }
    }

    namespace unison
    {
        inline constexpr std::string_view enabled { "unison.enabled" };
        inline constexpr std::string_view voices { "unison.voices" };
        inline constexpr std::string_view detune { "unison.detune" };
        inline constexpr std::string_view blend { "unison.blend" };
        inline constexpr std::string_view spread { "unison.spread" };
    }

    namespace filter
    {
        inline constexpr std::string_view enabled { "filter.enabled" };
        inline constexpr std::string_view type { "filter.type" };
        inline constexpr std::string_view cutoff { "filter.cutoff" };
        inline constexpr std::string_view resonance { "filter.resonance" };
        inline constexpr std::string_view drive { "filter.drive" };
    }

    namespace amp
    {
        inline constexpr std::string_view level { "amp.level" };
        inline constexpr std::string_view pan { "amp.pan" };
    }

    namespace granular
    {
        inline constexpr std::string_view enabled { "aether.granular.2.enabled" };
        inline constexpr std::string_view builtinSource { "aether.granular.2.builtinSource" };
        inline constexpr std::string_view rootNote { "aether.granular.2.rootNote" };
        inline constexpr std::string_view level { "aether.granular.2.level" };
        inline constexpr std::string_view route { "aether.granular.2.route" };
        inline constexpr std::string_view position { "aether.granular.2.position" };
        inline constexpr std::string_view positionSpread { "aether.granular.2.positionSpread" };
        inline constexpr std::string_view grainMilliseconds { "aether.granular.2.grainMilliseconds" };
        inline constexpr std::string_view densityHz { "aether.granular.2.densityHz" };
        inline constexpr std::string_view pitchSemitones { "aether.granular.2.pitchSemitones" };
        inline constexpr std::string_view stereoSpread { "aether.granular.2.stereoSpread" };
        inline constexpr std::string_view randomSeed { "aether.granular.2.randomSeed" };
        inline constexpr std::string_view fxSend1 { "aether.granular.2.fxSend1" };
        inline constexpr std::string_view fxSend2 { "aether.granular.2.fxSend2" };
    }

    namespace lfo
    {
        inline constexpr std::string_view rate1 { "lfo.1.rate" };
        inline constexpr std::string_view depth1 { "lfo.1.depth" };
    }

    namespace wavetable
    {
        inline constexpr std::string_view basicSine { "basic.sine" };
        inline constexpr std::string_view basicSaw { "basic.saw" };
        inline constexpr std::string_view basicSquare { "basic.square" };
        inline constexpr std::string_view basicTriangle { "basic.triangle" };
        inline constexpr std::string_view basicPulse { "basic.pulse" };
    }

    namespace modulation
    {
        inline constexpr std::string_view sourceEnv1 { "env.1" };
        inline constexpr std::string_view sourceEnv2 { "env.2" };
        inline constexpr std::string_view sourceEnv3 { "env.3" };
        inline constexpr std::string_view sourceEnv4 { "env.4" };
        inline constexpr std::string_view sourceLfo1 { "lfo.1" };
        inline constexpr std::string_view sourceLfo2 { "lfo.2" };
        inline constexpr std::array<std::string_view, 8> sourceExtraLfos {{
            "lfo.3", "lfo.4", "lfo.5", "lfo.6", "lfo.7", "lfo.8", "lfo.9", "lfo.10"
        }};
        inline constexpr std::string_view sourceVelocity { "velocity" };
        inline constexpr std::string_view sourceKeytrack { "keytrack" };
        inline constexpr std::string_view sourceModWheel { "modWheel" };
        inline constexpr std::string_view sourceMacro1 { "macro.1" };
        inline constexpr std::string_view sourceMacro2 { "macro.2" };
        inline constexpr std::string_view sourceMacro3 { "macro.3" };
        inline constexpr std::string_view sourceMacro4 { "macro.4" };
        inline constexpr std::string_view sourceMacro5 { "macro.5" };
        inline constexpr std::string_view sourceMacro6 { "macro.6" };
        inline constexpr std::string_view sourceMacro7 { "macro.7" };
        inline constexpr std::string_view sourceMacro8 { "macro.8" };

        inline constexpr std::string_view targetOscAPosition { "osc.a.position" };
        inline constexpr std::string_view targetOscAFine { "osc.a.fine" };
        inline constexpr std::string_view targetOscALevel { "osc.a.level" };
        inline constexpr std::string_view targetOscAPan { "osc.a.pan" };
        inline constexpr std::string_view targetOscBPosition { "osc.b.position" };
        inline constexpr std::string_view targetOscBFine { "osc.b.fine" };
        inline constexpr std::string_view targetOscBLevel { "osc.b.level" };
        inline constexpr std::string_view targetOscBPan { "osc.b.pan" };
        inline constexpr std::string_view targetFilterCutoff { "filter.cutoff" };
        inline constexpr std::string_view targetFilterResonance { "filter.resonance" };
        inline constexpr std::string_view targetFilterDrive { "filter.drive" };
        inline constexpr std::string_view targetAmpLevel { "amp.level" };
        inline constexpr std::string_view targetAmpPan { "amp.pan" };
        inline constexpr std::string_view targetUnisonDetune { "unison.detune" };
        inline constexpr std::string_view targetUnisonSpread { "unison.spread" };
    }
}

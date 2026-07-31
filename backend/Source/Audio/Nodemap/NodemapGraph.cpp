#include "NodemapGraph.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <initializer_list>
#include <limits>
#include <set>
#include <unordered_set>

namespace beat::Nodemap
{
    namespace
    {
        constexpr double twoPi = 6.28318530717958647692;

        struct StereoFrame
        {
            float left { 0.0f };
            float right { 0.0f };
        };

        struct EvalContext
        {
            struct AudioMemo
            {
                StereoFrame value;
                uint64_t generation { 0 };
            };

            struct CvMemo
            {
                float value { 0.0f };
                uint64_t generation { 0 };
            };

            struct IncomingPort
            {
                const Node* destination { nullptr };
                std::string portId;
                std::vector<const Cable*> cables;
            };

            const Graph& graph;
            const AuditionOptions& options;
            double timeSeconds { 0.0 };
            double noteFrequency { 261.6255653005986 };
            uint64_t generation { 1 };
            std::unordered_map<std::string, const Node*> nodesById;
            std::vector<IncomingPort> incoming;
            std::unordered_map<const Node*, AudioMemo> audioMemo;
            std::unordered_map<const Node*, CvMemo> cvMemo;
            std::unordered_map<const Node*, uint64_t> audioVisiting;
            std::unordered_map<const Node*, uint64_t> cvVisiting;
        };

        void beginEvalSample(EvalContext& context) noexcept
        {
            ++context.generation;
            if (context.generation != 0)
                return;
            context.generation = 1;
            for (auto& [node, memo] : context.audioMemo) memo.generation = 0;
            for (auto& [node, memo] : context.cvMemo) memo.generation = 0;
            for (auto& [node, generation] : context.audioVisiting) generation = 0;
            for (auto& [node, generation] : context.cvVisiting) generation = 0;
        }

        void prepareEvalContext(EvalContext& context)
        {
            context.nodesById.reserve(context.graph.nodes.size());
            context.incoming.reserve(context.graph.cables.size());
            context.audioMemo.reserve(context.graph.nodes.size());
            context.cvMemo.reserve(context.graph.nodes.size());
            context.audioVisiting.reserve(context.graph.nodes.size());
            context.cvVisiting.reserve(context.graph.nodes.size());
            for (const auto& node : context.graph.nodes)
            {
                context.nodesById[node.id] = &node;
                context.audioMemo.emplace(&node, EvalContext::AudioMemo {});
                context.cvMemo.emplace(&node, EvalContext::CvMemo {});
                context.audioVisiting.emplace(&node, 0);
                context.cvVisiting.emplace(&node, 0);
            }
            for (const auto& cable : context.graph.cables)
            {
                const auto destination = context.nodesById.find(cable.toNodeId);
                if (destination == context.nodesById.end()) continue;
                auto incoming = std::find_if(context.incoming.begin(), context.incoming.end(), [&](const EvalContext::IncomingPort& entry) {
                    return entry.destination == destination->second && entry.portId == cable.toPortId;
                });
                if (incoming == context.incoming.end())
                {
                    context.incoming.push_back({ destination->second, cable.toPortId, {} });
                    incoming = std::prev(context.incoming.end());
                }
                incoming->cables.push_back(&cable);
            }
        }

        float clamp01(float value) noexcept
        {
            return std::clamp(value, 0.0f, 1.0f);
        }

        float clampBipolar(float value) noexcept
        {
            return std::clamp(value, -1.0f, 1.0f);
        }

        float param(const Node& node, std::string_view id, float fallback) noexcept
        {
            for (const auto& [key, value] : node.params)
                if (key == id) return value;
            return fallback;
        }

        uint32_t hashString(std::string_view value) noexcept
        {
            uint32_t hash = 2166136261u;
            for (const auto c : value)
            {
                hash ^= (uint8_t) c;
                hash *= 16777619u;
            }
            return hash;
        }

        float seededNoise(uint32_t seed, double timeSeconds, std::string_view nodeId) noexcept
        {
            auto state = seed ^ hashString(nodeId) ^ (uint32_t) (timeSeconds * 48000.0);
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            return ((float) (state & 0xffffu) / 32767.5f) - 1.0f;
        }

        float oscillatorSample(float waveform, double phase) noexcept
        {
            phase -= std::floor(phase);
            const int shape = (int) std::round(waveform);
            switch (shape)
            {
                case 1: return (float) (2.0 * phase - 1.0);
                case 2: return phase < 0.5 ? 1.0f : -1.0f;
                case 3: return (float) (1.0 - std::abs(phase * 4.0 - 2.0));
                default: return std::sin((float) (phase * twoPi));
            }
        }

        StereoFrame panMono(float mono, float pan) noexcept
        {
            pan = clampBipolar(pan);
            const float angle = (pan + 1.0f) * 0.25f * (float) twoPi;
            const float left = std::cos(angle);
            const float right = std::sin(angle);
            return { mono * left, mono * right };
        }

        StereoFrame add(StereoFrame a, StereoFrame b) noexcept
        {
            return { a.left + b.left, a.right + b.right };
        }

        StereoFrame multiply(StereoFrame frame, float gain) noexcept
        {
            return { frame.left * gain, frame.right * gain };
        }

        SignalType signalForPort(const Node& node, std::string_view portId)
        {
            const auto& definition = definitionFor(node.kind);
            const auto found = std::find_if(definition.ports.begin(), definition.ports.end(), [&](const PortDefinition& port) {
                return port.id == portId;
            });
            return found == definition.ports.end() ? SignalType::Audio : found->signal;
        }

        const PortDefinition* portFor(const Node& node, std::string_view portId, PortDirection direction)
        {
            const auto& definition = definitionFor(node.kind);
            const auto found = std::find_if(definition.ports.begin(), definition.ports.end(), [&](const PortDefinition& port) {
                return port.id == portId && port.direction == direction;
            });
            return found == definition.ports.end() ? nullptr : &*found;
        }

        const std::vector<const Cable*>& incomingCables(const EvalContext& context, const Node& node, std::string_view portId)
        {
            static const std::vector<const Cable*> empty;
            for (const auto& incoming : context.incoming)
                if (incoming.destination == &node && incoming.portId == portId) return incoming.cables;
            return empty;
        }

        float evalCv(EvalContext& context, const Node& node, std::string_view portId);
        StereoFrame evalAudio(EvalContext& context, const Node& node, std::string_view portId);

        float sumCvInputs(EvalContext& context, const Node& node, std::string_view portId, float fallback = 0.0f)
        {
            const auto& cables = incomingCables(context, node, portId);
            if (cables.empty())
                return fallback;

            float sum = 0.0f;
            for (const auto* cable : cables)
            {
                const auto source = context.nodesById.find(cable->fromNodeId);
                if (source != context.nodesById.end())
                    sum += evalCv(context, *source->second, cable->fromPortId) * cable->amount;
            }
            return sum;
        }

        float sumCvInputsAny(EvalContext& context, const Node& node, std::initializer_list<std::string_view> portIds, float fallback = 0.0f)
        {
            bool routed = false;
            float sum = 0.0f;
            for (const auto portId : portIds)
            {
                const auto& cables = incomingCables(context, node, portId);
                if (cables.empty())
                    continue;
                routed = true;
                for (const auto* cable : cables)
                {
                    const auto source = context.nodesById.find(cable->fromNodeId);
                    if (source != context.nodesById.end())
                        sum += evalCv(context, *source->second, cable->fromPortId) * cable->amount;
                }
            }
            return routed ? sum : fallback;
        }

        StereoFrame sumAudioInputs(EvalContext& context, const Node& node, std::string_view portId)
        {
            StereoFrame output;
            for (const auto* cable : incomingCables(context, node, portId))
            {
                const auto source = context.nodesById.find(cable->fromNodeId);
                if (source != context.nodesById.end())
                    output = add(output, multiply(evalAudio(context, *source->second, cable->fromPortId), cable->amount));
            }
            return output;
        }

        StereoFrame sumAudioInputsAny(EvalContext& context, const Node& node, std::initializer_list<std::string_view> portIds)
        {
            StereoFrame output;
            for (const auto portId : portIds)
                output = add(output, sumAudioInputs(context, node, portId));
            return output;
        }

        float evalCv(EvalContext& context, const Node& node, std::string_view portId)
        {
            const auto* key = &node;
            auto& memo = context.cvMemo.at(key);
            if (memo.generation == context.generation)
                return memo.value;
            auto& visitingGeneration = context.cvVisiting.at(key);
            if (visitingGeneration == context.generation)
                return 0.0f;

            visitingGeneration = context.generation;
            float value = 0.0f;

            switch (node.kind)
            {
                case NodeKind::Envelope:
                {
                    const float attack = std::max(0.001f, param(node, "attack", 0.01f));
                    const float decay = std::max(0.001f, param(node, "decay", 0.18f));
                    const float sustain = clamp01(param(node, "sustain", 0.5f));
                    const auto t = (float) context.timeSeconds;
                    value = t < attack ? t / attack : std::max(sustain, 1.0f - ((t - attack) / decay) * (1.0f - sustain));
                    break;
                }
                case NodeKind::Lfo:
                {
                    const float rate = std::max(0.01f, param(node, "rate", 3.0f));
                    const float depth = param(node, "amount", param(node, "depth", 1.0f));
                    const float phase = (float) (context.timeSeconds * rate - std::floor(context.timeSeconds * rate));
                    const int shape = (int) std::round(param(node, "shape", 0.0f));
                    switch (shape)
                    {
                        case 1: value = (1.0f - std::abs(phase * 4.0f - 2.0f)) * 2.0f - 1.0f; break;
                        case 2: value = phase * 2.0f - 1.0f; break;
                        case 3: value = phase < 0.5f ? 1.0f : -1.0f; break;
                        default: value = std::sin((float) (phase * twoPi)); break;
                    }
                    value *= depth;
                    break;
                }
                case NodeKind::Constant:
                    value = param(node, "value", 0.5f);
                    break;
                case NodeKind::CvScale:
                {
                    const float input = sumCvInputs(context, node, "cv-in", 0.0f);
                    value = input * param(node, "amount", 1.0f) + param(node, "offset", 0.0f);
                    if (param(node, "clamp", 1.0f) > 0.5f)
                        value = clampBipolar(value);
                    break;
                }
                case NodeKind::Velocity:
                    value = context.options.velocity;
                    break;
                case NodeKind::Keytrack:
                    value = context.options.keytrack;
                    break;
                case NodeKind::ModWheel:
                    value = context.options.modWheel;
                    break;
                case NodeKind::Macro:
                    value = context.options.macro1;
                    break;
                case NodeKind::Random:
                    value = seededNoise(context.options.randomSeed, 0.0, node.id);
                    break;
                default:
                    value = sumCvInputs(context, node, std::string(portId), 0.0f);
                    break;
            }

            visitingGeneration = 0;
            memo.value = value;
            memo.generation = context.generation;
            return value;
        }

        StereoFrame evalAudio(EvalContext& context, const Node& node, std::string_view portId)
        {
            const auto* key = &node;
            auto& memo = context.audioMemo.at(key);
            if (memo.generation == context.generation)
                return memo.value;
            auto& visitingGeneration = context.audioVisiting.at(key);
            if (visitingGeneration == context.generation)
                return {};

            visitingGeneration = context.generation;
            StereoFrame frame;

            switch (node.kind)
            {
                case NodeKind::InstrumentOut:
                    frame = sumAudioInputs(context, node, "audio-in");
                    break;
                case NodeKind::Oscillator:
                {
                    const float pitchCv = sumCvInputs(context, node, "pitch", 0.0f);
                    const float levelCv = sumCvInputsAny(context, node, { "level-cv", "level" }, 0.0f);
                    const float panCv = sumCvInputsAny(context, node, { "pan-cv", "pan" }, 0.0f);
                    const float semitone = param(node, "octave", 0.0f) * 12.0f
                        + param(node, "semitone", 0.0f)
                        + param(node, "fine", 0.0f) / 100.0f
                        + pitchCv * 24.0f * param(node, "pitchCvAmount", 1.0f);
                    const float frequency = (float) context.noteFrequency * std::pow(2.0f, semitone / 12.0f);
                    const float level = clamp01(param(node, "level", 0.7f) + levelCv * param(node, "levelCvAmount", 1.0f));
                    const float pan = clampBipolar(param(node, "pan", 0.0f) + panCv * param(node, "panCvAmount", 1.0f));
                    const auto sample = oscillatorSample(param(node, "waveform", param(node, "shape", 0.0f)), context.timeSeconds * frequency + param(node, "phase", 0.0f));
                    frame = panMono(sample * level, pan);
                    break;
                }
                case NodeKind::OscillatorMerge:
                    frame = add(multiply(sumAudioInputs(context, node, "osc-a"), clamp01(param(node, "levelA", 1.0f))),
                                multiply(sumAudioInputs(context, node, "osc-b"), clamp01(param(node, "levelB", 0.55f))));
                    break;
                case NodeKind::ExistingInstrument:
                {
                    const float pitchCv = sumCvInputs(context, node, "pitch", 0.0f);
                    const float semitone = param(node, "octave", 0.0f) * 12.0f
                        + param(node, "semitone", 0.0f)
                        + param(node, "fine", 0.0f) / 100.0f
                        + pitchCv * 24.0f * param(node, "pitchCvAmount", 1.0f);
                    const float frequency = (float) context.noteFrequency * std::pow(2.0f, semitone / 12.0f);
                    const float level = clamp01(param(node, "level", 0.75f) + sumCvInputsAny(context, node, { "level-cv", "level" }, 0.0f) * param(node, "levelCvAmount", 1.0f));
                    const float sample = oscillatorSample(3.0f, context.timeSeconds * context.noteFrequency)
                        + 0.35f * oscillatorSample(1.0f, context.timeSeconds * frequency * 0.5);
                    frame = panMono(sample * 0.5f * level, param(node, "pan", 0.0f));
                    break;
                }
                case NodeKind::Noise:
                    frame = panMono(seededNoise(context.options.randomSeed, context.timeSeconds, node.id)
                                        * clamp01(param(node, "level", 0.35f) + sumCvInputsAny(context, node, { "level-cv", "level" }, 0.0f) * param(node, "levelCvAmount", 1.0f)),
                                    param(node, "pan", 0.0f));
                    break;
                case NodeKind::Mixer:
                    frame = add(add(sumAudioInputs(context, node, "in-1"), sumAudioInputs(context, node, "in-2")),
                                sumAudioInputs(context, node, "in-3"));
                    frame = multiply(frame, clamp01(param(node, "level", 0.75f)));
                    break;
                case NodeKind::Gain:
                {
                    frame = sumAudioInputs(context, node, "audio-in");
                    const float level = clamp01(param(node, "level", 0.8f) + sumCvInputsAny(context, node, { "level-cv", "level" }, 0.0f) * param(node, "levelCvAmount", 1.0f));
                    const float pan = clampBipolar(param(node, "pan", 0.0f) + sumCvInputsAny(context, node, { "pan-cv", "pan" }, 0.0f) * param(node, "panCvAmount", 1.0f));
                    const auto mono = (frame.left + frame.right) * 0.5f * level;
                    frame = panMono(mono, pan);
                    break;
                }
                case NodeKind::Filter:
                {
                    frame = sumAudioInputs(context, node, "audio-in");
                    float cutoff = param(node, "cutoff", 0.65f);
                    cutoff = cutoff > 1.0f ? (std::log2(std::clamp(cutoff, 20.0f, 20000.0f) / 20.0f) / std::log2(1000.0f)) : cutoff;
                    cutoff = clamp01(cutoff + sumCvInputsAny(context, node, { "cutoff-cv", "cutoff" }, 0.0f) * param(node, "cutoffCvAmount", 1.0f));
                    const float resonance = clamp01(param(node, "resonance", 0.1f) + sumCvInputsAny(context, node, { "resonance-cv", "resonance" }, 0.0f) * param(node, "resonanceCvAmount", 1.0f));
                    const float drive = std::max(0.0f, param(node, "drive", 0.0f) + sumCvInputsAny(context, node, { "drive-cv", "drive" }, 0.0f) * param(node, "driveCvAmount", 1.0f));
                    const float tone = 0.18f + cutoff * 0.82f;
                    frame.left = std::tanh((frame.left * tone + frame.left * drive) * (1.0f + resonance));
                    frame.right = std::tanh((frame.right * tone + frame.right * drive) * (1.0f + resonance));
                    break;
                }
                case NodeKind::Unison:
                    frame = multiply(sumAudioInputs(context, node, "audio-in"),
                                     1.0f + clamp01((param(node, "voices", 4.0f) + sumCvInputs(context, node, "voices", 0.0f)) / 32.0f));
                    break;
                case NodeKind::Shaper:
                case NodeKind::Distortion:
                    frame = sumAudioInputs(context, node, "audio-in");
                    {
                        const float drive = std::max(0.0f, param(node, "drive", 0.5f) + sumCvInputsAny(context, node, { "drive-cv", "drive" }, 0.0f));
                        frame.left = std::tanh(frame.left * (1.0f + drive * 8.0f));
                        frame.right = std::tanh(frame.right * (1.0f + drive * 8.0f));
                    }
                    break;
                case NodeKind::Delay:
                case NodeKind::Chorus:
                case NodeKind::Reverb:
                case NodeKind::Phaser:
                case NodeKind::Flanger:
                    frame = sumAudioInputs(context, node, "audio-in");
                    frame = add(multiply(frame, 0.78f + clamp01(sumCvInputs(context, node, "mix", 0.0f)) * 0.18f),
                                panMono(std::sin((float) (context.timeSeconds * twoPi * 0.7)) * 0.04f, 0.0f));
                    break;
                case NodeKind::Compressor:
                    frame = sumAudioInputs(context, node, "audio-in");
                    frame.left = clampBipolar(frame.left * 0.7f);
                    frame.right = clampBipolar(frame.right * 0.7f);
                    break;
                case NodeKind::Bitcrush:
                    frame = sumAudioInputs(context, node, "audio-in");
                    frame.left = std::round(frame.left * 16.0f) / 16.0f;
                    frame.right = std::round(frame.right * 16.0f) / 16.0f;
                    break;
                default:
                    frame = {};
                    break;
            }

            if (!std::isfinite(frame.left)) frame.left = 0.0f;
            if (!std::isfinite(frame.right)) frame.right = 0.0f;
            frame.left = clampBipolar(frame.left);
            frame.right = clampBipolar(frame.right);
            visitingGeneration = 0;
            memo.value = frame;
            memo.generation = context.generation;
            return frame;
        }

        Node makeNode(std::string id, NodeKind kind, std::string label, double x, double y)
        {
            Node node;
            node.id = std::move(id);
            node.kind = kind;
            node.label = std::move(label);
            node.x = x;
            node.y = y;
            return node;
        }

        Cable makeCable(std::string id, std::string fromNode, std::string fromPort, std::string toNode, std::string toPort, float amount = 1.0f)
        {
            Cable cable;
            cable.id = std::move(id);
            cable.fromNodeId = std::move(fromNode);
            cable.fromPortId = std::move(fromPort);
            cable.toNodeId = std::move(toNode);
            cable.toPortId = std::move(toPort);
            cable.amount = amount;
            return cable;
        }

        void addIssue(std::vector<Issue>& issues, IssueSeverity severity, std::string id, std::string nodeId, std::string message)
        {
            issues.push_back({ severity, std::move(id), std::move(nodeId), std::move(message) });
        }
    }

    const NodeDefinition& definitionFor(NodeKind kind)
    {
        static const std::vector<NodeDefinition> definitions {
            { NodeKind::InstrumentOut, NodeCategory::Output, "Instrument Out", { { "audio-in", PortDirection::Input, SignalType::Audio } } },
            { NodeKind::Oscillator, NodeCategory::Source, "Oscillator", { { "pitch", PortDirection::Input, SignalType::Cv }, { "level-cv", PortDirection::Input, SignalType::Cv }, { "position-cv", PortDirection::Input, SignalType::Cv }, { "pan-cv", PortDirection::Input, SignalType::Cv }, { "level", PortDirection::Input, SignalType::Cv }, { "pan", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::OscillatorMerge, NodeCategory::Utility, "Oscillator Merge", { { "osc-a", PortDirection::Input, SignalType::Audio }, { "osc-b", PortDirection::Input, SignalType::Audio }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::ExistingInstrument, NodeCategory::Source, "Instrument", { { "pitch", PortDirection::Input, SignalType::Cv }, { "level-cv", PortDirection::Input, SignalType::Cv }, { "level", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::Noise, NodeCategory::Source, "Noise", { { "level-cv", PortDirection::Input, SignalType::Cv }, { "level", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::Mixer, NodeCategory::Utility, "Mixer", { { "in-1", PortDirection::Input, SignalType::Audio }, { "in-2", PortDirection::Input, SignalType::Audio }, { "in-3", PortDirection::Input, SignalType::Audio }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::Gain, NodeCategory::Utility, "Gain", { { "audio-in", PortDirection::Input, SignalType::Audio }, { "level-cv", PortDirection::Input, SignalType::Cv }, { "pan-cv", PortDirection::Input, SignalType::Cv }, { "level", PortDirection::Input, SignalType::Cv }, { "pan", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::Filter, NodeCategory::Effect, "Filter", { { "audio-in", PortDirection::Input, SignalType::Audio }, { "cutoff-cv", PortDirection::Input, SignalType::Cv }, { "resonance-cv", PortDirection::Input, SignalType::Cv }, { "drive-cv", PortDirection::Input, SignalType::Cv }, { "cutoff", PortDirection::Input, SignalType::Cv }, { "resonance", PortDirection::Input, SignalType::Cv }, { "drive", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::Envelope, NodeCategory::Modulation, "Envelope", { { "cv-out", PortDirection::Output, SignalType::Cv } } },
            { NodeKind::Lfo, NodeCategory::Modulation, "LFO", { { "cv-out", PortDirection::Output, SignalType::Cv } } },
            { NodeKind::Constant, NodeCategory::Modulation, "Constant CV", { { "cv-out", PortDirection::Output, SignalType::Cv } } },
            { NodeKind::CvScale, NodeCategory::Utility, "CV Scale", { { "cv-in", PortDirection::Input, SignalType::Cv }, { "cv-out", PortDirection::Output, SignalType::Cv } } },
            { NodeKind::Velocity, NodeCategory::Modulation, "Velocity", { { "cv-out", PortDirection::Output, SignalType::Cv } } },
            { NodeKind::Keytrack, NodeCategory::Modulation, "Keytrack", { { "cv-out", PortDirection::Output, SignalType::Cv } } },
            { NodeKind::ModWheel, NodeCategory::Modulation, "Mod Wheel", { { "cv-out", PortDirection::Output, SignalType::Cv } } },
            { NodeKind::Macro, NodeCategory::Modulation, "Macro", { { "cv-out", PortDirection::Output, SignalType::Cv } } },
            { NodeKind::Random, NodeCategory::Modulation, "Random CV", { { "cv-out", PortDirection::Output, SignalType::Cv } } },
            { NodeKind::Unison, NodeCategory::Utility, "Unison", { { "audio-in", PortDirection::Input, SignalType::Audio }, { "voices", PortDirection::Input, SignalType::Cv }, { "detune-cv", PortDirection::Input, SignalType::Cv }, { "spread-cv", PortDirection::Input, SignalType::Cv }, { "detune", PortDirection::Input, SignalType::Cv }, { "spread", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::Shaper, NodeCategory::Effect, "Shaper", { { "audio-in", PortDirection::Input, SignalType::Audio }, { "drive-cv", PortDirection::Input, SignalType::Cv }, { "drive", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::Distortion, NodeCategory::Effect, "Distortion", { { "audio-in", PortDirection::Input, SignalType::Audio }, { "drive-cv", PortDirection::Input, SignalType::Cv }, { "drive", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::Delay, NodeCategory::Effect, "Delay", { { "audio-in", PortDirection::Input, SignalType::Audio }, { "mix", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::Chorus, NodeCategory::Effect, "Chorus", { { "audio-in", PortDirection::Input, SignalType::Audio }, { "mix", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::Reverb, NodeCategory::Effect, "Reverb", { { "audio-in", PortDirection::Input, SignalType::Audio }, { "mix", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::Phaser, NodeCategory::Effect, "Phaser", { { "audio-in", PortDirection::Input, SignalType::Audio }, { "mix", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::Flanger, NodeCategory::Effect, "Flanger", { { "audio-in", PortDirection::Input, SignalType::Audio }, { "mix", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::Compressor, NodeCategory::Effect, "Compressor", { { "audio-in", PortDirection::Input, SignalType::Audio }, { "threshold", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
            { NodeKind::Bitcrush, NodeCategory::Effect, "Bitcrush", { { "audio-in", PortDirection::Input, SignalType::Audio }, { "bits", PortDirection::Input, SignalType::Cv }, { "audio-out", PortDirection::Output, SignalType::Audio } } },
        };
        const auto found = std::find_if(definitions.begin(), definitions.end(), [kind](const auto& definition) {
            return definition.kind == kind;
        });
        return found == definitions.end() ? definitions.front() : *found;
    }

    std::optional<NodeKind> nodeKindFromString(std::string_view value)
    {
        for (const auto kind : {
                 NodeKind::InstrumentOut, NodeKind::Oscillator, NodeKind::OscillatorMerge, NodeKind::ExistingInstrument, NodeKind::Noise,
                 NodeKind::Mixer, NodeKind::Gain, NodeKind::Filter, NodeKind::Envelope, NodeKind::Lfo,
                 NodeKind::Constant, NodeKind::CvScale, NodeKind::Velocity, NodeKind::Keytrack, NodeKind::ModWheel,
                 NodeKind::Macro, NodeKind::Random, NodeKind::Unison, NodeKind::Shaper, NodeKind::Distortion,
                 NodeKind::Delay, NodeKind::Chorus, NodeKind::Reverb, NodeKind::Phaser, NodeKind::Flanger,
                 NodeKind::Compressor, NodeKind::Bitcrush,
             })
        {
            if (nodeKindToString(kind) == value)
                return kind;
        }
        return std::nullopt;
    }

    std::string_view nodeKindToString(NodeKind kind) noexcept
    {
        switch (kind)
        {
            case NodeKind::InstrumentOut: return "output";
            case NodeKind::Oscillator: return "oscillator";
            case NodeKind::OscillatorMerge: return "oscillatorMerge";
            case NodeKind::ExistingInstrument: return "instrument";
            case NodeKind::Noise: return "noise";
            case NodeKind::Mixer: return "mixer";
            case NodeKind::Gain: return "gain";
            case NodeKind::Filter: return "filter";
            case NodeKind::Envelope: return "envelope";
            case NodeKind::Lfo: return "lfo";
            case NodeKind::Constant: return "constant";
            case NodeKind::CvScale: return "cvScale";
            case NodeKind::Velocity: return "velocity";
            case NodeKind::Keytrack: return "keytrack";
            case NodeKind::ModWheel: return "modWheel";
            case NodeKind::Macro: return "macro";
            case NodeKind::Random: return "random";
            case NodeKind::Unison: return "unison";
            case NodeKind::Shaper: return "shaper";
            case NodeKind::Distortion: return "distortion";
            case NodeKind::Delay: return "delay";
            case NodeKind::Chorus: return "chorus";
            case NodeKind::Reverb: return "reverb";
            case NodeKind::Phaser: return "phaser";
            case NodeKind::Flanger: return "flanger";
            case NodeKind::Compressor: return "compressor";
            case NodeKind::Bitcrush: return "bitcrush";
        }
        return "oscillator";
    }

    Graph makeOutputOnlyGraph()
    {
        Graph graph;
        graph.nodes.push_back(makeNode("node-out", NodeKind::InstrumentOut, "Instrument Out", 640, 240));
        return graph;
    }

    Graph makeBasicOscillatorGraph()
    {
        auto graph = makeOutputOnlyGraph();
        auto oscillator = makeNode("node-osc", NodeKind::Oscillator, "Oscillator", 320, 240);
        oscillator.params["level"] = 0.72f;
        graph.nodes.push_back(std::move(oscillator));
        graph.cables.push_back(makeCable("cable-osc-out", "node-osc", "audio-out", "node-out", "audio-in"));
        return graph;
    }

    Graph makeProofTemplate(std::string_view templateId)
    {
        auto graph = makeBasicOscillatorGraph();
        if (templateId == "filtered-mono")
        {
            graph.nodes.push_back(makeNode("node-filter", NodeKind::Filter, "Filter", 480, 240));
            graph.cables.clear();
            graph.cables.push_back(makeCable("cable-osc-filter", "node-osc", "audio-out", "node-filter", "audio-in"));
            graph.cables.push_back(makeCable("cable-filter-out", "node-filter", "audio-out", "node-out", "audio-in"));
        }
        else if (templateId == "moving-texture")
        {
            graph.nodes.push_back(makeNode("node-lfo", NodeKind::Lfo, "LFO", 320, 420));
            graph.nodes.push_back(makeNode("node-filter", NodeKind::Filter, "Filter", 500, 240));
            graph.cables.clear();
            graph.cables.push_back(makeCable("cable-osc-filter", "node-osc", "audio-out", "node-filter", "audio-in"));
            graph.cables.push_back(makeCable("cable-lfo-filter", "node-lfo", "cv-out", "node-filter", "cutoff-cv", 0.25f));
            graph.cables.push_back(makeCable("cable-filter-out", "node-filter", "audio-out", "node-out", "audio-in"));
        }
        else if (templateId == "snare-hit" || templateId == "tom-hit" || templateId == "crash-hit")
        {
            graph.nodes.clear();
            graph.cables.clear();
            graph.nodes.push_back(makeNode("node-out", NodeKind::InstrumentOut, "Instrument Out", 760, 260));
            graph.nodes.push_back(makeNode("node-noise", NodeKind::Noise, "Noise", 240, 160));
            graph.nodes.push_back(makeNode("node-osc", NodeKind::Oscillator, "Body", 240, 320));
            graph.nodes.push_back(makeNode("node-mix", NodeKind::Mixer, "Mixer", 460, 240));
            graph.nodes.push_back(makeNode("node-gain", NodeKind::Gain, "Hit Level", 620, 240));
            graph.cables.push_back(makeCable("cable-noise-mix", "node-noise", "audio-out", "node-mix", "in-1"));
            graph.cables.push_back(makeCable("cable-osc-mix", "node-osc", "audio-out", "node-mix", "in-2"));
            graph.cables.push_back(makeCable("cable-mix-gain", "node-mix", "audio-out", "node-gain", "audio-in"));
            graph.cables.push_back(makeCable("cable-gain-out", "node-gain", "audio-out", "node-out", "audio-in"));
            if (templateId == "crash-hit")
                graph.nodes.back().params["level"] = 0.55f;
        }
        return graph;
    }

    Graph makeLargeStressGraph(int sourceCount, int cableCount)
    {
        Graph graph = makeOutputOnlyGraph();
        graph.nodes.push_back(makeNode("node-mix", NodeKind::Mixer, "Large Mixer", 900, 300));
        graph.nodes.push_back(makeNode("node-gain", NodeKind::Gain, "Large Gain", 1100, 300));
        graph.cables.push_back(makeCable("cable-mix-gain", "node-mix", "audio-out", "node-gain", "audio-in"));
        graph.cables.push_back(makeCable("cable-gain-out", "node-gain", "audio-out", "node-out", "audio-in"));

        for (int i = 0; i < sourceCount; ++i)
        {
            auto source = makeNode("node-source-" + std::to_string(i), i % 3 == 0 ? NodeKind::Noise : NodeKind::Oscillator, "Large Source", 80 + (i % 10) * 80, 80 + (i / 10) * 60);
            source.params["level"] = 0.04f + (float) (i % 7) * 0.005f;
            source.params["waveform"] = (float) (i % 4);
            graph.nodes.push_back(std::move(source));
            graph.cables.push_back(makeCable("cable-source-" + std::to_string(i), "node-source-" + std::to_string(i), "audio-out", "node-mix", i % 3 == 0 ? "in-2" : "in-1", 0.1f));
        }

        for (int i = 0; (int) graph.cables.size() < cableCount; ++i)
        {
            auto cv = makeNode("node-cv-" + std::to_string(i), i % 2 == 0 ? NodeKind::Lfo : NodeKind::Constant, "Large CV", 80 + (i % 12) * 78, 720 + (i / 12) * 52);
            cv.params["value"] = (float) (i % 9) / 18.0f;
            graph.nodes.push_back(std::move(cv));
            graph.cables.push_back(makeCable("cable-cv-" + std::to_string(i), "node-cv-" + std::to_string(i), "cv-out", "node-gain", i % 2 == 0 ? "level-cv" : "pan-cv", 0.02f));
        }

        return graph;
    }

    ValidationResult validateAndNormalize(const Graph& graph)
    {
        ValidationResult result;
        result.graph.schemaVersion = 1;

        std::unordered_set<std::string> nodeIds;
        bool keptOutput = false;
        int duplicateOutputCount = 0;
        for (auto node : graph.nodes)
        {
            if (node.kind == NodeKind::InstrumentOut)
            {
                if (keptOutput)
                {
                    ++duplicateOutputCount;
                    addIssue(result.issues, IssueSeverity::Warning, "duplicate-output", node.id, "Only one Instrument Out is allowed.");
                    continue;
                }
                keptOutput = true;
                node.id = node.id.empty() ? "node-out" : node.id;
                node.label = "Instrument Out";
            }
            if (node.id.empty())
                node.id = "node-" + std::to_string(result.graph.nodes.size() + 1);
            if (!nodeIds.insert(node.id).second)
            {
                addIssue(result.issues, IssueSeverity::Warning, "duplicate-node", node.id, "Duplicate node id was pruned.");
                continue;
            }
            result.graph.nodes.push_back(std::move(node));
        }

        if (!keptOutput)
        {
            addIssue(result.issues, IssueSeverity::Error, "missing-output", "", "Missing Instrument Out.");
            result.graph.nodes.push_back(makeNode("node-out", NodeKind::InstrumentOut, "Instrument Out", 640, 240));
        }
        result.hasOutput = true;

        std::unordered_map<std::string, const Node*> nodesById;
        for (const auto& node : result.graph.nodes)
            nodesById[node.id] = &node;

        std::set<std::string> cableKeys;
        for (auto cable : graph.cables)
        {
            const auto from = nodesById.find(cable.fromNodeId);
            const auto to = nodesById.find(cable.toNodeId);
            if (from == nodesById.end() || to == nodesById.end())
            {
                addIssue(result.issues, IssueSeverity::Warning, "missing-cable-node", cable.id, "Cable references a missing node.");
                continue;
            }
            if (from->first == to->first)
            {
                addIssue(result.issues, IssueSeverity::Warning, "self-cable", cable.id, "Self cables are not allowed.");
                continue;
            }
            const auto* outPort = portFor(*from->second, cable.fromPortId, PortDirection::Output);
            const auto* inPort = portFor(*to->second, cable.toPortId, PortDirection::Input);
            if (outPort == nullptr || inPort == nullptr)
            {
                addIssue(result.issues, IssueSeverity::Warning, "missing-port", cable.id, "Cable references a missing or wrong-direction port.");
                continue;
            }
            if (outPort->signal != inPort->signal)
            {
                addIssue(result.issues, IssueSeverity::Warning, "wrong-signal", cable.id, "Cable signal types are incompatible.");
                continue;
            }
            const auto key = cable.fromNodeId + ":" + cable.fromPortId + ">" + cable.toNodeId + ":" + cable.toPortId;
            if (!cableKeys.insert(key).second)
            {
                addIssue(result.issues, IssueSeverity::Warning, "duplicate-cable", cable.id, "Duplicate cable edge was pruned.");
                continue;
            }
            if (cable.id.empty())
                cable.id = "cable-" + std::to_string(result.graph.cables.size() + 1);
            result.graph.cables.push_back(std::move(cable));
        }

        std::unordered_map<std::string, std::vector<const Cable*>> incoming;
        std::unordered_map<std::string, std::vector<const Cable*>> outgoing;
        for (const auto& cable : result.graph.cables)
        {
            incoming[cable.toNodeId].push_back(&cable);
            outgoing[cable.fromNodeId].push_back(&cable);
        }

        const auto output = std::find_if(result.graph.nodes.begin(), result.graph.nodes.end(), [](const Node& node) {
            return node.kind == NodeKind::InstrumentOut;
        });

        std::unordered_set<std::string> routed;
        std::unordered_set<std::string> visiting;
        std::unordered_set<std::string> visited;
        std::function<bool(const std::string&)> reachesOutput = [&](const std::string& nodeId) {
            if (nodeId == output->id)
                return true;
            if (visiting.contains(nodeId))
            {
                result.hasCycle = true;
                return false;
            }
            if (visited.contains(nodeId))
                return routed.contains(nodeId);
            visiting.insert(nodeId);
            bool reaches = false;
            for (const auto* cable : outgoing[nodeId])
                reaches = reaches || reachesOutput(cable->toNodeId);
            visiting.erase(nodeId);
            visited.insert(nodeId);
            if (reaches)
                routed.insert(nodeId);
            return reaches;
        };

        for (const auto& node : result.graph.nodes)
        {
            if (node.kind != NodeKind::InstrumentOut && reachesOutput(node.id))
                routed.insert(node.id);
        }

        result.hasAudioPathToOutput = std::any_of(result.graph.cables.begin(), result.graph.cables.end(), [&](const Cable& cable) {
            return cable.toNodeId == output->id && signalForPort(*nodesById[cable.fromNodeId], cable.fromPortId) == SignalType::Audio;
        });

        if (!result.hasAudioPathToOutput)
            addIssue(result.issues, IssueSeverity::Info, "silent-output", output->id, "Nothing reaches Instrument Out, so this instrument is silent.");
        if (result.hasCycle)
            addIssue(result.issues, IssueSeverity::Warning, "cycle", "", "Cyclic routes are protected and render silent for the cyclic branch.");

        for (const auto& node : result.graph.nodes)
        {
            if (node.kind != NodeKind::InstrumentOut && !routed.contains(node.id))
                addIssue(result.issues, IssueSeverity::Info, "not-routed", node.id, node.label + " is not routed to Instrument Out.");
        }

        result.valid = std::none_of(result.issues.begin(), result.issues.end(), [](const Issue& issue) {
            return issue.severity == IssueSeverity::Error;
        });
        (void) duplicateOutputCount;
        return result;
    }

    struct RealtimeRenderer::Impl
    {
        Graph graph;
        AuditionOptions options;
        std::unique_ptr<EvalContext> context;
        const Node* output { nullptr };
        int sampleIndex { 0 };
        int sampleCount { 0 };
        bool active { false };

        Impl(const Graph& source, double sampleRate)
        {
            auto validation = validateAndNormalize(source);
            graph = std::move(validation.graph);
            options.sampleRate = sampleRate > 0.0 ? sampleRate : 48000.0;
            if (!validation.hasAudioPathToOutput)
                return;
            const auto found = std::find_if(graph.nodes.begin(), graph.nodes.end(), [](const Node& node) {
                return node.kind == NodeKind::InstrumentOut;
            });
            if (found == graph.nodes.end())
                return;
            output = &*found;
            context = std::make_unique<EvalContext>(EvalContext { graph, options });
            prepareEvalContext(*context);
        }
    };

    RealtimeRenderer::RealtimeRenderer() = default;
    RealtimeRenderer::~RealtimeRenderer() = default;
    RealtimeRenderer::RealtimeRenderer(RealtimeRenderer&&) noexcept = default;
    RealtimeRenderer& RealtimeRenderer::operator=(RealtimeRenderer&&) noexcept = default;

    bool RealtimeRenderer::prepare(const Graph& graph, double sampleRate)
    {
        auto next = std::make_unique<Impl>(graph, sampleRate);
        if (next->context == nullptr || next->output == nullptr)
        {
            impl.reset();
            return false;
        }
        impl = std::move(next);
        return true;
    }

    bool RealtimeRenderer::startNote(const AuditionOptions& nextOptions) noexcept
    {
        if (impl == nullptr || impl->context == nullptr || impl->output == nullptr)
            return false;
        impl->options = nextOptions;
        impl->options.sampleRate = impl->options.sampleRate > 0.0
            ? impl->options.sampleRate : 48000.0;
        impl->sampleIndex = 0;
        impl->sampleCount = std::max(1, impl->options.sampleCount);
        impl->context->noteFrequency = 440.0
            * std::pow(2.0, ((double) impl->options.midiNote - 69.0) / 12.0);
        impl->context->timeSeconds = 0.0;
        impl->active = true;
        return true;
    }

    void RealtimeRenderer::stop(bool allowTailOff) noexcept
    {
        if (impl != nullptr && !allowTailOff)
            impl->active = false;
    }

    RealtimeFrame RealtimeRenderer::renderFrame() noexcept
    {
        if (impl == nullptr || !impl->active || impl->context == nullptr || impl->output == nullptr)
            return {};
        if (impl->sampleIndex >= impl->sampleCount)
        {
            impl->active = false;
            return {};
        }

        impl->context->timeSeconds = (double) impl->sampleIndex / impl->options.sampleRate;
        beginEvalSample(*impl->context);
        const auto frame = evalAudio(*impl->context, *impl->output, "audio-in");
        ++impl->sampleIndex;
        if (impl->sampleIndex >= impl->sampleCount)
            impl->active = false;
        return { frame.left, frame.right };
    }

    bool RealtimeRenderer::isActive() const noexcept
    {
        return impl != nullptr && impl->active;
    }

    AuditionResult renderOneNote(const Graph& graph, const AuditionOptions& options)
    {
        const auto validation = validateAndNormalize(graph);
        AuditionResult result;
        result.left.assign((size_t) std::max(0, options.sampleCount), 0.0f);
        result.right.assign((size_t) std::max(0, options.sampleCount), 0.0f);
        if (!validation.hasAudioPathToOutput || options.sampleRate <= 0.0 || options.sampleCount <= 0)
            return result;

        const auto output = std::find_if(validation.graph.nodes.begin(), validation.graph.nodes.end(), [](const Node& node) {
            return node.kind == NodeKind::InstrumentOut;
        });
        if (output == validation.graph.nodes.end())
            return result;

        const double frequency = 440.0 * std::pow(2.0, ((double) options.midiNote - 69.0) / 12.0);
        double energy = 0.0;

        EvalContext context { validation.graph, options };
        context.noteFrequency = frequency;
        prepareEvalContext(context);

        for (int sample = 0; sample < options.sampleCount; ++sample)
        {
            context.timeSeconds = (double) sample / options.sampleRate;
            beginEvalSample(context);

            const auto frame = evalAudio(context, *output, "audio-in");
            result.left[(size_t) sample] = frame.left;
            result.right[(size_t) sample] = frame.right;
            result.peak = std::max(result.peak, std::max(std::abs(frame.left), std::abs(frame.right)));
            energy += (double) frame.left * frame.left + (double) frame.right * frame.right;
            if (std::isfinite(frame.left) && std::isfinite(frame.right))
                result.finiteSamples += 2;
        }

        result.rms = (float) std::sqrt(energy / (double) std::max(1, options.sampleCount * 2));
        result.silent = result.peak <= 0.00001f || result.rms <= 0.000001f;
        return result;
    }
}

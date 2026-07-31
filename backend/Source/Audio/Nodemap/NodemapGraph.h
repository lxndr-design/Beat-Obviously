#pragma once

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace beat::Nodemap
{
    enum class NodeCategory
    {
        Source,
        Utility,
        Modulation,
        Effect,
        Output,
    };

    enum class NodeKind
    {
        InstrumentOut,
        Oscillator,
        OscillatorMerge,
        ExistingInstrument,
        Noise,
        Mixer,
        Gain,
        Filter,
        Envelope,
        Lfo,
        Constant,
        CvScale,
        Velocity,
        Keytrack,
        ModWheel,
        Macro,
        Random,
        Unison,
        Shaper,
        Distortion,
        Delay,
        Chorus,
        Reverb,
        Phaser,
        Flanger,
        Compressor,
        Bitcrush,
    };

    enum class PortDirection
    {
        Input,
        Output,
    };

    enum class SignalType
    {
        Audio,
        Cv,
    };

    struct PortDefinition
    {
        std::string id;
        PortDirection direction { PortDirection::Input };
        SignalType signal { SignalType::Audio };
    };

    struct NodeDefinition
    {
        NodeKind kind { NodeKind::Oscillator };
        NodeCategory category { NodeCategory::Source };
        std::string label;
        std::vector<PortDefinition> ports;
    };

    struct Node
    {
        std::string id;
        NodeKind kind { NodeKind::Oscillator };
        std::string label;
        double x { 0.0 };
        double y { 0.0 };
        std::unordered_map<std::string, float> params;
    };

    struct Cable
    {
        std::string id;
        std::string fromNodeId;
        std::string fromPortId;
        std::string toNodeId;
        std::string toPortId;
        float amount { 1.0f };
    };

    struct Graph
    {
        int schemaVersion { 1 };
        std::vector<Node> nodes;
        std::vector<Cable> cables;
    };

    enum class IssueSeverity
    {
        Info,
        Warning,
        Error,
    };

    struct Issue
    {
        IssueSeverity severity { IssueSeverity::Warning };
        std::string id;
        std::string nodeId;
        std::string message;
    };

    struct ValidationResult
    {
        Graph graph;
        std::vector<Issue> issues;
        bool valid { true };
        bool hasOutput { false };
        bool hasAudioPathToOutput { false };
        bool hasCycle { false };
    };

    struct AuditionOptions
    {
        double sampleRate { 48000.0 };
        int sampleCount { 48000 };
        int midiNote { 60 };
        float velocity { 0.8f };
        float keytrack { 60.0f / 127.0f };
        float modWheel { 0.0f };
        float macro1 { 0.0f };
        uint32_t randomSeed { 0x12345678u };
    };

    struct AuditionResult
    {
        std::vector<float> left;
        std::vector<float> right;
        float peak { 0.0f };
        float rms { 0.0f };
        int finiteSamples { 0 };
        bool silent { true };
    };

    struct RealtimeFrame
    {
        float left { 0.0f };
        float right { 0.0f };
    };

    class RealtimeRenderer
    {
    public:
        RealtimeRenderer();
        ~RealtimeRenderer();
        RealtimeRenderer(RealtimeRenderer&&) noexcept;
        RealtimeRenderer& operator=(RealtimeRenderer&&) noexcept;
        RealtimeRenderer(const RealtimeRenderer&) = delete;
        RealtimeRenderer& operator=(const RealtimeRenderer&) = delete;

        bool prepare(const Graph& graph, double sampleRate);
        bool startNote(const AuditionOptions& options) noexcept;
        void stop(bool allowTailOff) noexcept;
        RealtimeFrame renderFrame() noexcept;
        bool isActive() const noexcept;

    private:
        struct Impl;
        std::unique_ptr<Impl> impl;
    };

    const NodeDefinition& definitionFor(NodeKind kind);
    std::optional<NodeKind> nodeKindFromString(std::string_view value);
    std::string_view nodeKindToString(NodeKind kind) noexcept;

    Graph makeOutputOnlyGraph();
    Graph makeBasicOscillatorGraph();
    Graph makeProofTemplate(std::string_view templateId);
    Graph makeLargeStressGraph(int sourceCount = 100, int cableCount = 300);

    ValidationResult validateAndNormalize(const Graph& graph);
    AuditionResult renderOneNote(const Graph& graph, const AuditionOptions& options = {});
}

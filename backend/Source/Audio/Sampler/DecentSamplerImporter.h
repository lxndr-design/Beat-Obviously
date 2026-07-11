#pragma once

#include <juce_core/juce_core.h>

#include <optional>
#include <vector>

namespace beat
{
    struct DecentSamplerSample
    {
        juce::String path;
        juce::String name;
        juce::String trigger { "attack" };
        int rootNote { 60 };
        int loNote { 0 };
        int hiNote { 127 };
        int loVel { 0 };
        int hiVel { 127 };
        double volumeDb { 0.0 };
        double pan { 0.0 };
        double tuning { 0.0 };
        int seqPosition { 0 };
        int chokeGroup { 0 };
        bool loopEnabled { false };
        int loopStart { 0 };
        int loopEnd { 0 };
        bool oneShot { false };
        double durationSeconds { 0.0 };
        double loLengthSeconds { 0.0 };
        double hiLengthSeconds { 0.0 };
        int startSample { 0 };
        int endSample { 0 };
    };

    struct DecentSamplerUiBinding
    {
        juce::String type;
        juce::String level;
        juce::String parameter;
        int position { -1 };
    };

    struct DecentSamplerUiControl
    {
        juce::String kind;
        juce::String label;
        double x { 0.0 };
        double y { 0.0 };
        double width { 0.0 };
        double height { 0.0 };
        double minValue { 0.0 };
        double maxValue { 1.0 };
        double value { 0.0 };
        std::vector<DecentSamplerUiBinding> bindings;
    };

    struct DecentSamplerEffect
    {
        juce::String type;
        int position { -1 };
        double frequency { 0.0 };
        double resonance { 0.0 };
        double wetLevel { 0.0 };
        double roomSize { 0.0 };
        double damping { 0.0 };
    };

    struct DecentSamplerImport
    {
        juce::String name;
        juce::String path;
        juce::String pluginId { "decent-sampler" };
        juce::String uiImagePath;
        int uiWidth { 0 };
        int uiHeight { 0 };
        juce::StringArray uiControls;
        std::vector<DecentSamplerUiControl> uiControlDetails;
        std::vector<DecentSamplerEffect> effects;
        juce::StringArray sampleUrls;
        std::vector<DecentSamplerSample> samples;
    };

    juce::File defaultDecentSamplerImportRoot();
    juce::File findDecentSamplerPresetInFolder(const juce::File& folder);
    juce::File extractDecentSamplerArchive(const juce::File& archiveFile, const juce::File& importRoot);
    juce::File resolveDecentSamplerPreset(const juce::File& selectedFile, const juce::File& importRoot);
    std::optional<DecentSamplerImport> parseDecentSamplerPreset(const juce::File& presetFile);
}

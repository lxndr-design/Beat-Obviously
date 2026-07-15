#pragma once

#include <juce_core/juce_core.h>

#include <cstdint>
#include <vector>

namespace beat
{
    enum class SfzDiagnosticSeverity
    {
        warning,
        error,
    };

    struct SfzDiagnostic
    {
        SfzDiagnosticSeverity severity { SfzDiagnosticSeverity::error };
        juce::String code;
        juce::String message;
        int line { 1 };
        int column { 1 };
    };

    struct SfzSubsetRegion
    {
        juce::String samplePath;
        int rootNote { 60 };
        int loNote { 0 };
        int hiNote { 127 };
        int loVelocity { 0 };
        int hiVelocity { 127 };
        double tuneCents { 0.0 };
        double volumeDb { 0.0 };
        double panPercent { 0.0 };
        int64_t offsetFrames { 0 };
        int64_t endFrame { 0 };
        juce::String loopMode { "no_loop" };
        int64_t loopStartFrame { 0 };
        int64_t loopEndFrame { 0 };
        int group { 0 };
        int offBy { 0 };
        int sequenceLength { 1 };
        int sequencePosition { 1 };
        juce::String trigger { "attack" };
        int sourceLine { 1 };
    };

    struct SfzSubsetParseLimits
    {
        int64_t maximumSourceBytes { 1024 * 1024 };
        size_t maximumOpcodes { 4096 };
        size_t maximumRegions { 256 };
        size_t maximumDiagnostics { 512 };
    };

    struct SfzSubsetImport
    {
        juce::String sourceName;
        juce::String defaultPath;
        std::vector<SfzSubsetRegion> regions;
        std::vector<SfzDiagnostic> diagnostics;
        size_t ignoredOpcodeCount { 0 };
        size_t warningCount { 0 };
        size_t errorCount { 0 };

        bool hasErrors() const noexcept;
        bool isAccepted() const noexcept { return !hasErrors() && !regions.empty(); }
    };

    /**
     * Parse Beat's deliberately bounded SFZ subset into a playback-neutral model.
     *
     * This function performs no file access, sample decoding, playback publication,
     * or callback work. Unsupported opcodes are retained as warnings rather than
     * silently acquiring semantics from another implementation.
     */
    SfzSubsetImport parseSfzSubsetText(const juce::String& source,
                                       const SfzSubsetParseLimits& limits = {});

    /** Control/import-thread wrapper. Reads only the selected text file. */
    SfzSubsetImport parseSfzSubsetFile(const juce::File& file,
                                       const SfzSubsetParseLimits& limits = {});
}

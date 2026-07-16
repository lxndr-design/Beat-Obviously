#pragma once

#include <juce_core/juce_core.h>
#include <vector>

namespace beat
{
    struct HybridSourceDocumentDiagnostic
    {
        juce::String code;
        juce::String path;
        juce::String message;
    };

    /**
     * Validates only the persisted Slot 1/2 migration boundary.
     *
     * This deliberately does not normalize or mutate the document. Unknown
     * versions and malformed structures are reported so callers can fail
     * without silently discarding data they do not understand.
     */
    std::vector<HybridSourceDocumentDiagnostic> validateHybridSourceDocument(const juce::var& document);
}

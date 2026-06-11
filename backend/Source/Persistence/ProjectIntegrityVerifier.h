#pragma once

#include <juce_core/juce_core.h>

namespace beat
{
    enum class ProjectIntegritySeverity
    {
        Info,
        Warning,
        Error,
    };

    struct ProjectIntegrityIssue
    {
        ProjectIntegritySeverity severity { ProjectIntegritySeverity::Info };
        juce::String code;
        juce::String message;
        juce::String path;

        juce::var toVar() const;
    };

    struct ProjectIntegrityReport
    {
        juce::Array<ProjectIntegrityIssue> issues;

        int errorCount() const;
        int warningCount() const;
        bool ok() const;
        juce::var toVar() const;
    };

    ProjectIntegrityReport verifyProjectDocumentIntegrity(const juce::var& document,
                                                          const juce::File& projectFile);

    bool repairProjectDocumentSegmentTrackIds(juce::var& document);

    bool hasFatalProjectDocumentIntegrityErrors(const ProjectIntegrityReport& report) noexcept;
}

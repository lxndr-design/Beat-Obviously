#pragma once

#include <juce_core/juce_core.h>

namespace beat::diagnostics
{
    struct LogTail
    {
        juce::String text;
        int lineCount { 0 };
        bool truncated { false };
    };

    inline juce::File logFile()
    {
        return juce::File::getSpecialLocation(juce::File::userHomeDirectory)
            .getChildFile("Library").getChildFile("Logs").getChildFile("Beat")
            .getChildFile("Beat-debug.log");
    }

    inline LogTail readLogTail(const juce::File& file, int requestedLines)
    {
        constexpr int64_t maximumReadBytes = 256 * 1024;
        const int maximumLines = juce::jlimit(1, 1000, requestedLines);
        if (!file.existsAsFile())
            return {};

        juce::FileInputStream stream(file);
        if (!stream.openedOk())
            return {};

        const auto size = stream.getTotalLength();
        const auto start = juce::jmax<int64_t>(0, size - maximumReadBytes);
        if (!stream.setPosition(start))
            return {};

        juce::MemoryBlock bytes;
        stream.readIntoMemoryBlock(bytes, maximumReadBytes);
        auto content = juce::String::fromUTF8(static_cast<const char*>(bytes.getData()),
                                               static_cast<int>(bytes.getSize()));
        bool truncated = start > 0;
        if (start > 0)
        {
            const int firstNewline = content.indexOfChar('\n');
            if (firstNewline >= 0)
                content = content.substring(firstNewline + 1);
        }

        juce::StringArray lines;
        lines.addLines(content);
        while (!lines.isEmpty() && lines[lines.size() - 1].isEmpty())
            lines.remove(lines.size() - 1);
        if (lines.size() > maximumLines)
        {
            lines.removeRange(0, lines.size() - maximumLines);
            truncated = true;
        }

        return { lines.joinIntoString("\n"), lines.size(), truncated };
    }

    inline LogTail readLogTail(int requestedLines)
    {
        return readLogTail(logFile(), requestedLines);
    }

    inline bool clearLogFile(const juce::File& file)
    {
        return !file.existsAsFile() || file.replaceWithText({});
    }

    inline bool saveLogSnapshot(const juce::File& file, const juce::String& snapshot)
    {
        const auto parent = file.getParentDirectory();
        if (!parent.exists() && !parent.createDirectory())
            return false;
        return file.replaceWithText(snapshot);
    }

    inline juce::String timestamp()
    {
        return juce::Time::getCurrentTime().formatted("%Y-%m-%dT%H:%M:%S.%l%z");
    }

    inline void log(const juce::String& category, const juce::String& message)
    {
        juce::Logger::writeToLog(timestamp() + " [" + category + "] " + message);
    }

    class ScopedDuration
    {
    public:
        ScopedDuration(juce::String categoryIn, juce::String operationIn)
            : category(std::move(categoryIn)), operation(std::move(operationIn)), startedMs(juce::Time::getMillisecondCounterHiRes())
        {
            log(category, operation + " started");
        }

        ~ScopedDuration()
        {
            log(category, operation + " ready durationMs="
                + juce::String(juce::Time::getMillisecondCounterHiRes() - startedMs, 2));
        }

    private:
        juce::String category;
        juce::String operation;
        double startedMs { 0.0 };
    };
}

#pragma once

#include <juce_core/juce_core.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

namespace beat
{
    /**
     * Runs Spotify Basic Pitch away from Beat's audio and message threads.
     * Basic Pitch owns inference and note extraction; this adapter only
     * launches the pinned local runtime and reads its note-event CSV.
     */
    class AudioToMidiService
    {
    public:
        struct NoteEvent
        {
            double startSeconds { 0.0 };
            double endSeconds { 0.0 };
            int pitch { 60 };
            int velocity { 100 };
            std::vector<int> pitchBends;
        };

        struct Status
        {
            juce::String jobId;
            bool active { false };
            bool finished { true };
            bool ok { false };
            bool cancelled { false };
            double progress { 0.0 };
            juce::String stage;
            juce::String error;
            std::vector<NoteEvent> notes;
        };

        AudioToMidiService() = default;

        ~AudioToMidiService()
        {
            cancel();
            if (worker.joinable())
                worker.join();
            std::shared_ptr<Job> current;
            {
                const std::lock_guard<std::mutex> lock(jobLock);
                current = job;
            }
            if (current)
                current->outputDirectory.deleteRecursively();
        }

        Status start(const juce::File& source, const juce::String& profile)
        {
            joinFinishedWorker();

            const auto runner = findRunner();
            if (! source.existsAsFile())
                return failedStatus("The source stem audio file is missing.");
            if (! isSupportedProfile(profile))
                return failedStatus("This stem does not have a supported pitched transcription profile.");
            if (! runner.existsAsFile())
                return failedStatus("Audio-to-MIDI is not installed. Run scripts/setup-audio-to-midi.sh, then restart Beat.");

            auto next = std::make_shared<Job>();
            next->id = juce::Uuid().toString();
            next->source = source;
            next->profile = profile;
            next->outputDirectory = juce::File::getSpecialLocation(juce::File::tempDirectory)
                .getChildFile("Beat Audio To MIDI")
                .getChildFile(next->id);

            {
                const std::lock_guard<std::mutex> lock(jobLock);
                if (job && ! job->finished.load(std::memory_order_acquire))
                    return failedStatus("Another audio-to-MIDI job is already running.");
                job = next;
            }

            if (next->outputDirectory.createDirectory().failed())
                return failedStatus("Beat could not create a temporary audio-to-MIDI workspace.");

            worker = std::thread([this, next, runner] { run(next, runner); });
            return statusFor(next);
        }

        Status status() const
        {
            std::shared_ptr<Job> current;
            {
                const std::lock_guard<std::mutex> lock(jobLock);
                current = job;
            }
            return statusFor(current);
        }

        Status cancel()
        {
            std::shared_ptr<Job> current;
            {
                const std::lock_guard<std::mutex> lock(jobLock);
                current = job;
            }
            if (current)
                current->cancel.store(true, std::memory_order_release);
            return statusFor(current);
        }

    private:
        struct Job
        {
            juce::String id;
            juce::File source;
            juce::String profile;
            juce::File outputDirectory;
            std::atomic<bool> cancel { false };
            std::atomic<bool> finished { false };
            std::atomic<bool> ok { false };
            std::atomic<double> progress { 0.02 };
            mutable std::mutex resultLock;
            juce::String stage { "Preparing Spotify Basic Pitch" };
            juce::String error;
            std::vector<NoteEvent> notes;
        };

        static bool isSupportedProfile(const juce::String& profile)
        {
            return profile == "bass" || profile == "vocals" || profile == "other";
        }

        static Status failedStatus(const juce::String& error)
        {
            Status status;
            status.error = error;
            status.stage = "Unavailable";
            return status;
        }

        static juce::File findRunner()
        {
            const auto overridePath = juce::SystemStats::getEnvironmentVariable("BEAT_AUDIO_TO_MIDI", {});
            if (overridePath.isNotEmpty())
            {
                const juce::File overrideFile(overridePath);
                if (overrideFile.existsAsFile())
                    return overrideFile;
            }

            const auto executable = juce::File::getSpecialLocation(juce::File::currentExecutableFile);
            const auto bundled = executable.getParentDirectory()
                .getSiblingFile("Resources")
                .getChildFile("audio-to-midi")
                .getChildFile("bin")
                .getChildFile("basic-pitch");
            if (bundled.existsAsFile())
                return bundled;

            auto folder = executable.getParentDirectory();
            for (int level = 0; level < 8; ++level)
            {
                const auto candidate = folder.getChildFile(".venv-transcription")
                    .getChildFile("bin")
                    .getChildFile("basic-pitch");
                if (candidate.existsAsFile())
                    return candidate;
                const auto parent = folder.getParentDirectory();
                if (parent == folder)
                    break;
                folder = parent;
            }

            for (const auto& path : { "/opt/homebrew/bin/basic-pitch", "/usr/local/bin/basic-pitch" })
            {
                const juce::File candidate(path);
                if (candidate.existsAsFile())
                    return candidate;
            }
            return {};
        }

        static juce::String outputTail(const juce::String& output)
        {
            constexpr int maximumCharacters = 1600;
            return output.length() > maximumCharacters ? output.substring(output.length() - maximumCharacters) : output;
        }

        static void addFrequencyArguments(juce::StringArray& arguments, const juce::String& profile)
        {
            arguments.add("--minimum-frequency");
            if (profile == "bass")
            {
                arguments.add("30");
                arguments.add("--maximum-frequency");
                arguments.add("500");
            }
            else if (profile == "vocals")
            {
                arguments.add("65");
                arguments.add("--maximum-frequency");
                arguments.add("1600");
            }
            else
            {
                arguments.add("27.5");
                arguments.add("--maximum-frequency");
                arguments.add("4200");
            }
        }

        static juce::File findNoteEventsCsv(const juce::File& directory)
        {
            juce::Array<juce::File> files;
            directory.findChildFiles(files, juce::File::findFiles, true, "*_basic_pitch.csv");
            return files.isEmpty() ? juce::File() : files.getFirst();
        }

        static std::vector<NoteEvent> readNoteEvents(const juce::File& csv)
        {
            std::vector<NoteEvent> result;
            juce::StringArray lines;
            lines.addLines(csv.loadFileAsString());
            result.reserve(static_cast<size_t>(juce::jmax(0, lines.size() - 1)));

            for (int lineIndex = 1; lineIndex < lines.size(); ++lineIndex)
            {
                juce::StringArray columns;
                columns.addTokens(lines[lineIndex], ",", "\"");
                columns.trim();
                if (columns.size() < 4)
                    continue;

                NoteEvent note;
                note.startSeconds = columns[0].getDoubleValue();
                note.endSeconds = columns[1].getDoubleValue();
                note.pitch = juce::jlimit(0, 127, columns[2].getIntValue());
                note.velocity = juce::jlimit(1, 127, columns[3].getIntValue());
                if (! std::isfinite(note.startSeconds) || ! std::isfinite(note.endSeconds)
                    || note.startSeconds < 0.0 || note.endSeconds <= note.startSeconds)
                    continue;

                note.pitchBends.reserve(static_cast<size_t>(juce::jmax(0, columns.size() - 4)));
                for (int columnIndex = 4; columnIndex < columns.size(); ++columnIndex)
                    if (columns[columnIndex].isNotEmpty())
                        note.pitchBends.push_back(columns[columnIndex].getIntValue());
                result.push_back(std::move(note));
            }

            std::sort(result.begin(), result.end(), [](const NoteEvent& a, const NoteEvent& b) {
                if (a.startSeconds != b.startSeconds)
                    return a.startSeconds < b.startSeconds;
                return a.pitch < b.pitch;
            });
            return result;
        }

        static void finishWithError(const std::shared_ptr<Job>& job, const juce::String& error)
        {
            job->outputDirectory.deleteRecursively();
            {
                const std::lock_guard<std::mutex> lock(job->resultLock);
                job->error = error;
                job->stage = job->cancel.load(std::memory_order_acquire)
                    ? "Audio-to-MIDI cancelled"
                    : "Audio-to-MIDI failed";
            }
            job->ok.store(false, std::memory_order_release);
            job->finished.store(true, std::memory_order_release);
        }

        static void run(const std::shared_ptr<Job>& job, const juce::File& runner)
        {
            juce::StringArray arguments;
            arguments.add(runner.getFullPathName());
            arguments.add(job->outputDirectory.getFullPathName());
            arguments.add(job->source.getFullPathName());
            arguments.add("--save-note-events");
           #if JUCE_MAC
            arguments.add("--model-serialization");
            arguments.add("coreml");
           #endif
            addFrequencyArguments(arguments, job->profile);

            juce::ChildProcess process;
            if (! process.start(arguments, juce::ChildProcess::wantStdOut | juce::ChildProcess::wantStdErr))
            {
                finishWithError(job, "Could not launch Spotify Basic Pitch.");
                return;
            }

            {
                const std::lock_guard<std::mutex> lock(job->resultLock);
                job->stage = "Transcribing pitched notes";
            }
            job->progress.store(0.12, std::memory_order_release);

            juce::String output;
            std::array<char, 4096> buffer {};
            while (process.isRunning())
            {
                if (job->cancel.load(std::memory_order_acquire))
                {
                    process.kill();
                    finishWithError(job, "Audio-to-MIDI was cancelled.");
                    return;
                }

                const auto bytesRead = process.readProcessOutput(buffer.data(), static_cast<int>(buffer.size()));
                if (bytesRead > 0)
                    output += juce::String::fromUTF8(buffer.data(), bytesRead);
                juce::Thread::sleep(35);
            }

            output += process.readAllProcessOutput();
            const auto noteEvents = findNoteEventsCsv(job->outputDirectory);
            if (process.getExitCode() != 0 || ! noteEvents.existsAsFile())
            {
                const auto detail = outputTail(output).trim();
                finishWithError(job, "Spotify Basic Pitch did not produce note events."
                    + (detail.isNotEmpty() ? juce::String(" ") + detail : juce::String()));
                return;
            }

            auto notes = readNoteEvents(noteEvents);
            job->outputDirectory.deleteRecursively();
            {
                const std::lock_guard<std::mutex> lock(job->resultLock);
                job->notes = std::move(notes);
                job->stage = "Audio-to-MIDI complete";
            }
            job->progress.store(1.0, std::memory_order_release);
            job->ok.store(true, std::memory_order_release);
            job->finished.store(true, std::memory_order_release);
        }

        static Status statusFor(const std::shared_ptr<Job>& current)
        {
            if (! current)
                return {};

            Status status;
            status.jobId = current->id;
            status.finished = current->finished.load(std::memory_order_acquire);
            status.active = ! status.finished;
            status.ok = current->ok.load(std::memory_order_acquire);
            status.cancelled = status.finished && current->cancel.load(std::memory_order_acquire);
            status.progress = current->progress.load(std::memory_order_acquire);
            {
                const std::lock_guard<std::mutex> lock(current->resultLock);
                status.stage = current->stage;
                status.error = current->error;
                status.notes = current->notes;
            }
            return status;
        }

        void joinFinishedWorker()
        {
            std::shared_ptr<Job> current;
            {
                const std::lock_guard<std::mutex> lock(jobLock);
                current = job;
            }
            if (current && current->finished.load(std::memory_order_acquire) && worker.joinable())
                worker.join();
        }

        mutable std::mutex jobLock;
        std::shared_ptr<Job> job;
        std::thread worker;
    };
}

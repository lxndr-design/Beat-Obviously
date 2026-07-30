#pragma once

#include <juce_core/juce_core.h>

#include <array>
#include <atomic>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

namespace beat
{
    /**
     * Runs the optional local Demucs ONNX command-line runtime away from the
     * audio and message threads. The Python environment and model cache are
     * deliberately external to the app binary so normal audio import remains
     * fast and Beat can report a missing runtime without changing a project.
     */
    class StemSeparationService
    {
    public:
        struct StemFile
        {
            juce::String stem;
            juce::String path;
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
            std::vector<StemFile> stems;
        };

        StemSeparationService() = default;

        ~StemSeparationService()
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

        Status start(const juce::File& source)
        {
            joinFinishedWorker();

            const auto runner = findRunner();
            if (! source.existsAsFile())
                return failedStatus("The source audio file is missing.");
            if (! runner.existsAsFile())
                return failedStatus("Stem separation is not installed. Run scripts/setup-stem-separation.sh, then restart Beat.");

            auto next = std::make_shared<Job>();
            next->id = juce::Uuid().toString();
            next->source = source;
            next->outputDirectory = juce::File::getSpecialLocation(juce::File::tempDirectory)
                .getChildFile("Beat Stem Separation")
                .getChildFile(next->id);
            next->modelCacheDirectory = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                .getChildFile("Beat")
                .getChildFile("Stem Models");

            {
                const std::lock_guard<std::mutex> lock(jobLock);
                if (job && ! job->finished.load(std::memory_order_acquire))
                    return failedStatus("Another stem-separation job is already running.");
                job = next;
            }

            next->outputDirectory.createDirectory();
            next->modelCacheDirectory.createDirectory();
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

        void discardOutputs(const juce::String& jobId)
        {
            std::shared_ptr<Job> current;
            {
                const std::lock_guard<std::mutex> lock(jobLock);
                current = job;
            }
            if (current && current->id == jobId && current->finished.load(std::memory_order_acquire))
                current->outputDirectory.deleteRecursively();
        }

    private:
        struct Job
        {
            juce::String id;
            juce::File source;
            juce::File outputDirectory;
            juce::File modelCacheDirectory;
            std::atomic<bool> cancel { false };
            std::atomic<bool> finished { false };
            std::atomic<bool> ok { false };
            std::atomic<double> progress { 0.01 };
            mutable std::mutex resultLock;
            juce::String stage { "Preparing stem separation" };
            juce::String error;
            std::vector<StemFile> stems;
        };

        static Status failedStatus(const juce::String& error)
        {
            Status status;
            status.error = error;
            status.stage = "Unavailable";
            return status;
        }

        static juce::File findRunner()
        {
            const auto overridePath = juce::SystemStats::getEnvironmentVariable("BEAT_STEM_SEPARATOR", {});
            if (overridePath.isNotEmpty())
            {
                const juce::File overrideFile(overridePath);
                if (overrideFile.existsAsFile())
                    return overrideFile;
            }

            const auto executable = juce::File::getSpecialLocation(juce::File::currentExecutableFile);
            const auto bundled = executable.getParentDirectory()
                .getSiblingFile("Resources")
                .getChildFile("stem-separator")
                .getChildFile("bin")
                .getChildFile("demucs-onnx");
            if (bundled.existsAsFile())
                return bundled;

            auto folder = executable.getParentDirectory();
            for (int level = 0; level < 8; ++level)
            {
                const auto candidate = folder.getChildFile(".venv-stems")
                    .getChildFile("bin")
                    .getChildFile("demucs-onnx");
                if (candidate.existsAsFile())
                    return candidate;
                const auto parent = folder.getParentDirectory();
                if (parent == folder)
                    break;
                folder = parent;
            }

            for (const auto& path : { "/opt/homebrew/bin/demucs-onnx", "/usr/local/bin/demucs-onnx" })
            {
                const juce::File candidate(path);
                if (candidate.existsAsFile())
                    return candidate;
            }
            return {};
        }

        static juce::String outputTail(const juce::String& output)
        {
            constexpr int maximumCharacters = 1200;
            return output.length() > maximumCharacters ? output.substring(output.length() - maximumCharacters) : output;
        }

        static void updateProgress(Job& job, const juce::String& output)
        {
            int bestPercent = 0;
            for (int start = 0; start < output.length(); ++start)
            {
                if (! juce::CharacterFunctions::isDigit(output[start]))
                    continue;
                int end = start;
                while (end < output.length() && juce::CharacterFunctions::isDigit(output[end]))
                    ++end;
                if (end < output.length() && output[end] == '%')
                    bestPercent = juce::jmax(bestPercent, output.substring(start, end).getIntValue());
                start = end;
            }
            if (bestPercent > 0)
            {
                job.progress.store(juce::jlimit(0.02, 0.96, bestPercent / 100.0), std::memory_order_release);
                return;
            }

            const auto chunkIndex = output.lastIndexOfIgnoreCase("chunk ");
            if (chunkIndex < 0)
                return;
            auto chunkLineEnd = output.indexOfChar(chunkIndex, '\n');
            if (chunkLineEnd < 0)
                chunkLineEnd = output.length();
            const auto chunkLine = output.substring(chunkIndex, chunkLineEnd);
            const auto slash = chunkLine.indexOfChar('/');
            if (slash < 0)
                return;
            const auto completed = chunkLine.substring(6, slash).getIntValue();
            int denominatorEnd = slash + 1;
            while (denominatorEnd < chunkLine.length() && juce::CharacterFunctions::isDigit(chunkLine[denominatorEnd]))
                ++denominatorEnd;
            const auto total = chunkLine.substring(slash + 1, denominatorEnd).getIntValue();
            if (completed > 0 && total > 0)
                job.progress.store(juce::jlimit(0.02, 0.96, 0.05 + 0.9 * completed / total), std::memory_order_release);
        }

        static juce::File findStemFile(const juce::File& directory, const juce::String& stem)
        {
            juce::Array<juce::File> files;
            directory.findChildFiles(files, juce::File::findFiles, true, "*.wav");
            for (const auto& file : files)
            {
                const auto base = file.getFileNameWithoutExtension().toLowerCase();
                if (base == stem || base.endsWith("_" + stem) || base.endsWith("-" + stem)
                    || base.endsWith(" (" + stem + ")"))
                    return file;
            }
            return {};
        }

        static juce::String titleCaseStem(const juce::String& stem)
        {
            return stem.substring(0, 1).toUpperCase() + stem.substring(1);
        }

        static void finishWithError(const std::shared_ptr<Job>& job, const juce::String& error)
        {
            job->outputDirectory.deleteRecursively();
            {
                const std::lock_guard<std::mutex> lock(job->resultLock);
                job->error = error;
                job->stage = job->cancel.load(std::memory_order_acquire) ? "Cancelled" : "Stem separation failed";
            }
            job->ok.store(false, std::memory_order_release);
            job->finished.store(true, std::memory_order_release);
        }

        static void run(const std::shared_ptr<Job>& job, const juce::File& runner)
        {
            juce::StringArray arguments;
            arguments.add("/usr/bin/env");
            arguments.add("HF_HUB_OFFLINE=1");
            arguments.add(runner.getFullPathName());
            arguments.add("separate");
            arguments.add(job->source.getFullPathName());
            arguments.add(job->outputDirectory.getFullPathName());
            arguments.add("--model");
            arguments.add("htdemucs");
            arguments.add("--small");
            arguments.add("--providers");
            // CoreML currently rejects a general-slice node in the htdemucs
            // ONNX graph on macOS. CPU is slower but reliable and portable.
            arguments.add("cpu");
            arguments.add("--cache-dir");
            arguments.add(job->modelCacheDirectory.getFullPathName());
            arguments.add("--verbose");

            juce::ChildProcess process;
            if (! process.start(arguments, juce::ChildProcess::wantStdOut | juce::ChildProcess::wantStdErr))
            {
                finishWithError(job, "Could not launch the local stem-separation runtime.");
                return;
            }

            {
                const std::lock_guard<std::mutex> lock(job->resultLock);
                job->stage = "Separating vocals, drums, bass, and other";
            }
            job->progress.store(0.02, std::memory_order_release);

            juce::String output;
            std::array<char, 4096> buffer {};
            while (process.isRunning())
            {
                if (job->cancel.load(std::memory_order_acquire))
                {
                    process.kill();
                    finishWithError(job, "Stem separation was cancelled.");
                    return;
                }

                const auto bytesRead = process.readProcessOutput(buffer.data(), static_cast<int>(buffer.size()));
                if (bytesRead > 0)
                {
                    output += juce::String::fromUTF8(buffer.data(), bytesRead);
                    updateProgress(*job, outputTail(output));
                }
                juce::Thread::sleep(35);
            }

            output += process.readAllProcessOutput();
            if (process.getExitCode() != 0)
            {
                finishWithError(job, "The stem-separation runtime failed. " + outputTail(output).trim());
                return;
            }

            const std::array<juce::String, 4> expected { "drums", "bass", "vocals", "other" };
            std::vector<StemFile> stems;
            stems.reserve(expected.size());
            for (const auto& stem : expected)
            {
                auto file = findStemFile(job->outputDirectory, stem);
                if (! file.existsAsFile())
                {
                    finishWithError(job, "Stem separation completed without producing the expected " + stem + " WAV file.");
                    return;
                }

                const auto named = job->outputDirectory.getChildFile(
                    job->source.getFileNameWithoutExtension() + " - " + titleCaseStem(stem) + ".wav");
                if (file != named)
                {
                    if (named.existsAsFile())
                        named.deleteFile();
                    if (file.moveFileTo(named))
                        file = named;
                }
                stems.push_back({ stem, file.getFullPathName() });
            }

            {
                const std::lock_guard<std::mutex> lock(job->resultLock);
                job->stems = std::move(stems);
                job->stage = "Stem separation complete";
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
                status.stems = current->stems;
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

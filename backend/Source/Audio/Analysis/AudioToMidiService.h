#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <deque>
#include <memory>
#include <mutex>
#include <thread>
#include <unordered_map>
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
            juce::String instrument;
            bool isDrum { false };
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

            const auto runner = profile == "piano"
                ? findPianoRunner()
                : profile == "multi-instrument"
                    ? findMultiInstrumentRunner()
                    : findBasicPitchRunner();
            if (! source.existsAsFile())
                return failedStatus("The source stem audio file is missing.");
            if (! isSupportedProfile(profile))
                return failedStatus("This stem does not have a supported pitched transcription profile.");
            if (! runner.existsAsFile())
                return failedStatus(profile == "piano"
                    ? "Piano transcription is not installed. Run scripts/setup-piano-transcription.sh, then restart Beat."
                    : profile == "multi-instrument"
                        ? "Multi-instrument transcription is not installed. Run scripts/setup-multi-instrument-transcription.sh, authenticate with Hugging Face, then restart Beat."
                        : "Audio-to-MIDI is not installed. Run scripts/setup-audio-to-midi.sh, then restart Beat.");

            auto next = std::make_shared<Job>();
            next->id = juce::Uuid().toString();
            next->source = source;
            next->profile = profile;
            next->stage = profile == "piano"
                ? "Preparing Transkun piano transcription"
                : profile == "multi-instrument"
                    ? "Preparing MuScriptor multi-instrument transcription"
                    : "Preparing Spotify Basic Pitch";
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
            juce::String stage { "Preparing audio-to-MIDI" };
            juce::String error;
            std::vector<NoteEvent> notes;
        };

        static bool isSupportedProfile(const juce::String& profile)
        {
            return profile == "bass" || profile == "vocals" || profile == "other"
                || profile == "piano" || profile == "piano-recovery" || profile == "multi-instrument";
        }

        static Status failedStatus(const juce::String& error)
        {
            Status status;
            status.error = error;
            status.stage = "Unavailable";
            return status;
        }

        static juce::File findBasicPitchRunner()
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

        static juce::File findPianoRunner()
        {
            const auto overridePath = juce::SystemStats::getEnvironmentVariable("BEAT_PIANO_TO_MIDI", {});
            if (overridePath.isNotEmpty())
            {
                const juce::File overrideFile(overridePath);
                if (overrideFile.existsAsFile())
                    return overrideFile;
            }

            const auto executable = juce::File::getSpecialLocation(juce::File::currentExecutableFile);
            const auto bundled = executable.getParentDirectory()
                .getSiblingFile("Resources")
                .getChildFile("piano-to-midi")
                .getChildFile("bin")
                .getChildFile("transkun");
            if (bundled.existsAsFile())
                return bundled;

            auto folder = executable.getParentDirectory();
            for (int level = 0; level < 8; ++level)
            {
                const auto candidate = folder.getChildFile(".venv-transkun")
                    .getChildFile("bin")
                    .getChildFile("transkun");
                if (candidate.existsAsFile())
                    return candidate;
                const auto parent = folder.getParentDirectory();
                if (parent == folder)
                    break;
                folder = parent;
            }

            for (const auto& path : { "/opt/homebrew/bin/transkun", "/usr/local/bin/transkun" })
            {
                const juce::File candidate(path);
                if (candidate.existsAsFile())
                    return candidate;
            }
            return {};
        }

        static juce::File findMultiInstrumentRunner()
        {
            const auto overridePath = juce::SystemStats::getEnvironmentVariable("BEAT_MULTI_INSTRUMENT_TO_MIDI", {});
            if (overridePath.isNotEmpty())
            {
                const juce::File overrideFile(overridePath);
                if (overrideFile.existsAsFile())
                    return overrideFile;
            }

            const auto executable = juce::File::getSpecialLocation(juce::File::currentExecutableFile);
            const auto bundled = executable.getParentDirectory()
                .getSiblingFile("Resources")
                .getChildFile("multi-instrument-to-midi")
                .getChildFile("bin")
                .getChildFile("muscriptor");
            if (bundled.existsAsFile())
                return bundled;

            auto folder = executable.getParentDirectory();
            for (int level = 0; level < 8; ++level)
            {
                const auto candidate = folder.getChildFile(".venv-muscriptor")
                    .getChildFile("bin")
                    .getChildFile("muscriptor");
                if (candidate.existsAsFile())
                    return candidate;
                const auto parent = folder.getParentDirectory();
                if (parent == folder)
                    break;
                folder = parent;
            }

            for (const auto& path : { "/opt/homebrew/bin/muscriptor", "/usr/local/bin/muscriptor" })
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

        static void addRecoveryArguments(juce::StringArray& arguments, const juce::String& profile)
        {
            // Basic Pitch's defaults favor precision and discard short/quieter
            // events. These bounded, stem-aware values recover more musical
            // onsets while retaining the model's Melodia cleanup pass.
            arguments.add("--onset-threshold");
            arguments.add(profile == "bass" ? "0.40"
                : profile == "vocals" ? "0.42"
                : profile == "piano-recovery" ? "0.62"
                : "0.44");
            arguments.add("--frame-threshold");
            arguments.add(profile == "bass" ? "0.24" : profile == "piano-recovery" ? "0.18" : "0.26");
            arguments.add("--minimum-note-length");
            arguments.add(profile == "bass" ? "75"
                : profile == "vocals" ? "65"
                : profile == "piano-recovery" ? "100"
                : "55");
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

        static std::vector<NoteEvent> readMidiNoteEvents(const juce::File& midiPath)
        {
            juce::FileInputStream input(midiPath);
            if (! input.openedOk())
                return {};

            juce::MidiFile midi;
            if (! midi.readFrom(input))
                return {};
            midi.convertTimestampTicksToSeconds();

            struct ActiveNote
            {
                double startSeconds { 0.0 };
                int velocity { 100 };
            };

            std::vector<NoteEvent> result;
            for (int trackIndex = 0; trackIndex < midi.getNumTracks(); ++trackIndex)
            {
                const auto* track = midi.getTrack(trackIndex);
                if (track == nullptr)
                    continue;
                std::array<std::deque<ActiveNote>, 16 * 128> active;
                for (int eventIndex = 0; eventIndex < track->getNumEvents(); ++eventIndex)
                {
                    const auto message = track->getEventPointer(eventIndex)->message;
                    if (! message.isNoteOnOrOff())
                        continue;
                    const auto channel = juce::jlimit(1, 16, message.getChannel()) - 1;
                    const auto pitch = juce::jlimit(0, 127, message.getNoteNumber());
                    auto& queue = active[static_cast<size_t>(channel * 128 + pitch)];
                    if (message.isNoteOn())
                    {
                        queue.push_back({ message.getTimeStamp(), juce::jlimit(1, 127, static_cast<int>(message.getVelocity())) });
                        continue;
                    }
                    if (queue.empty())
                        continue;
                    const auto start = queue.front();
                    queue.pop_front();
                    const auto endSeconds = message.getTimeStamp();
                    if (! std::isfinite(start.startSeconds) || ! std::isfinite(endSeconds)
                        || start.startSeconds < 0.0 || endSeconds <= start.startSeconds)
                        continue;
                    result.push_back({ start.startSeconds, endSeconds, pitch, start.velocity, {} });
                }
            }

            std::sort(result.begin(), result.end(), [](const NoteEvent& a, const NoteEvent& b) {
                if (a.startSeconds != b.startSeconds)
                    return a.startSeconds < b.startSeconds;
                return a.pitch < b.pitch;
            });
            return result;
        }

        static std::vector<NoteEvent> readMuScriptorNoteEvents(const juce::File& jsonPath)
        {
            std::vector<NoteEvent> result;
            const auto parsed = juce::JSON::parse(jsonPath.loadFileAsString());
            const auto* events = parsed.getArray();
            if (events == nullptr)
                return result;

            std::unordered_map<int, NoteEvent> active;
            for (const auto& event : *events)
            {
                if (! event.isObject())
                    continue;
                const auto type = event.getProperty("type", {}).toString();
                if (type == "start")
                {
                    const auto index = static_cast<int>(event.getProperty("index", -1));
                    const auto startSeconds = static_cast<double>(event.getProperty("start_time", -1.0));
                    const auto pitch = static_cast<int>(event.getProperty("pitch", -1));
                    auto instrument = event.getProperty("instrument", "other").toString().trim().toLowerCase();
                    instrument = instrument.replaceCharacter(' ', '_');
                    if (index < 0 || ! std::isfinite(startSeconds) || startSeconds < 0.0 || pitch < 0 || pitch > 127)
                        continue;
                    NoteEvent note;
                    note.startSeconds = startSeconds;
                    note.endSeconds = startSeconds;
                    note.pitch = pitch;
                    note.instrument = instrument.isNotEmpty() ? instrument : "other";
                    note.isDrum = note.instrument == "drums";
                    active[index] = std::move(note);
                    continue;
                }
                if (type != "end")
                    continue;

                const auto index = static_cast<int>(event.getProperty("start_event_index", -1));
                const auto found = active.find(index);
                if (found == active.end())
                    continue;
                auto note = std::move(found->second);
                active.erase(found);
                note.endSeconds = static_cast<double>(event.getProperty("end_time", note.startSeconds));
                if (! std::isfinite(note.endSeconds) || note.endSeconds <= note.startSeconds)
                    note.endSeconds = note.startSeconds + (note.isDrum ? 0.04 : 0.03);
                result.push_back(std::move(note));
            }

            std::sort(result.begin(), result.end(), [](const NoteEvent& a, const NoteEvent& b) {
                if (a.instrument != b.instrument)
                    return a.instrument < b.instrument;
                if (a.startSeconds != b.startSeconds)
                    return a.startSeconds < b.startSeconds;
                return a.pitch < b.pitch;
            });
            return result;
        }

        static void inferVelocitiesFromSource(const juce::File& source, std::vector<NoteEvent>& notes)
        {
            if (notes.empty())
                return;

            juce::AudioFormatManager formats;
            formats.registerBasicFormats();
            std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(source));
            if (reader == nullptr || reader->sampleRate <= 0.0 || reader->numChannels == 0)
                return;

            std::vector<double> loudnessDb(notes.size(), -80.0);
            for (size_t noteIndex = 0; noteIndex < notes.size(); ++noteIndex)
            {
                const auto& note = notes[noteIndex];
                const auto windowSeconds = juce::jlimit(0.045, 0.12, (note.endSeconds - note.startSeconds) * 0.35);
                const auto startSample = juce::jmax<juce::int64>(0, static_cast<juce::int64>(std::llround((note.startSeconds - 0.012) * reader->sampleRate)));
                const auto sampleCount = juce::jlimit(64, 16384, static_cast<int>(std::llround(windowSeconds * reader->sampleRate)));
                juce::AudioBuffer<float> buffer(static_cast<int>(reader->numChannels), sampleCount);
                buffer.clear();
                if (! reader->read(&buffer, 0, sampleCount, startSample, true, true))
                    continue;

                double meanSquare = 0.0;
                for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
                {
                    const auto rms = static_cast<double>(buffer.getRMSLevel(channel, 0, sampleCount));
                    meanSquare += rms * rms;
                }
                const auto rms = std::sqrt(meanSquare / static_cast<double>(buffer.getNumChannels()));
                loudnessDb[noteIndex] = 20.0 * std::log10(juce::jmax(1.0e-6, rms));
            }

            auto sorted = loudnessDb;
            std::sort(sorted.begin(), sorted.end());
            auto low = sorted[static_cast<size_t>(std::floor((sorted.size() - 1) * 0.10))];
            auto high = sorted[static_cast<size_t>(std::floor((sorted.size() - 1) * 0.90))];
            if (high - low < 6.0)
            {
                const auto middle = (low + high) * 0.5;
                low = middle - 3.0;
                high = middle + 3.0;
            }
            for (size_t noteIndex = 0; noteIndex < notes.size(); ++noteIndex)
            {
                const auto normalized = juce::jlimit(0.0, 1.0, (loudnessDb[noteIndex] - low) / (high - low));
                const auto floorVelocity = notes[noteIndex].isDrum ? 45 : 35;
                notes[noteIndex].velocity = juce::jlimit(1, 127,
                    static_cast<int>(std::lround(floorVelocity + normalized * (127 - floorVelocity))));
            }
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

        static void runPiano(const std::shared_ptr<Job>& job, const juce::File& runner)
        {
            const auto midiOutput = job->outputDirectory.getChildFile("transkun-piano.mid");
            juce::StringArray arguments;
            arguments.add(runner.getFullPathName());
            arguments.add(job->source.getFullPathName());
            arguments.add(midiOutput.getFullPathName());
            arguments.add("--device");
            arguments.add("cpu");

            juce::ChildProcess process;
            if (! process.start(arguments, juce::ChildProcess::wantStdOut | juce::ChildProcess::wantStdErr))
            {
                finishWithError(job, "Could not launch Transkun.");
                return;
            }

            {
                const std::lock_guard<std::mutex> lock(job->resultLock);
                job->stage = "Transcribing piano attacks and intervals with Transkun";
            }
            job->progress.store(0.12, std::memory_order_release);

            juce::String output;
            std::array<char, 4096> buffer {};
            while (process.isRunning())
            {
                if (job->cancel.load(std::memory_order_acquire))
                {
                    process.kill();
                    finishWithError(job, "Piano transcription was cancelled.");
                    return;
                }
                const auto bytesRead = process.readProcessOutput(buffer.data(), static_cast<int>(buffer.size()));
                if (bytesRead > 0)
                    output += juce::String::fromUTF8(buffer.data(), bytesRead);
                juce::Thread::sleep(35);
            }

            output += process.readAllProcessOutput();
            if (process.getExitCode() != 0 || ! midiOutput.existsAsFile())
            {
                const auto detail = outputTail(output).trim();
                finishWithError(job, "Transkun did not produce piano note events."
                    + (detail.isNotEmpty() ? juce::String(" ") + detail : juce::String()));
                return;
            }

            auto notes = readMidiNoteEvents(midiOutput);
            job->outputDirectory.deleteRecursively();
            if (notes.empty())
            {
                finishWithError(job, "Transkun completed but did not detect piano notes.");
                return;
            }
            {
                const std::lock_guard<std::mutex> lock(job->resultLock);
                job->notes = std::move(notes);
                job->stage = "Transkun piano transcription complete";
            }
            job->progress.store(1.0, std::memory_order_release);
            job->ok.store(true, std::memory_order_release);
            job->finished.store(true, std::memory_order_release);
        }

        static void runMultiInstrument(const std::shared_ptr<Job>& job, const juce::File& runner)
        {
            const auto jsonOutput = job->outputDirectory.getChildFile("muscriptor-events.json");
            juce::StringArray arguments;
            arguments.add(runner.getFullPathName());
            arguments.add("transcribe");
            arguments.add(job->source.getFullPathName());
            arguments.add("--output");
            arguments.add(jsonOutput.getFullPathName());
            arguments.add("--format");
            arguments.add("json");
            arguments.add("--model");
            arguments.add("small");
            arguments.add("--device");
            arguments.add("auto");
            arguments.add("--beam-size");
            arguments.add("1");
            arguments.add("--prelude-forcing");

            juce::ChildProcess process;
            if (! process.start(arguments, juce::ChildProcess::wantStdOut | juce::ChildProcess::wantStdErr))
            {
                finishWithError(job, "Could not launch MuScriptor.");
                return;
            }

            {
                const std::lock_guard<std::mutex> lock(job->resultLock);
                job->stage = "Separating instruments and transcribing notes with MuScriptor";
            }
            job->progress.store(0.10, std::memory_order_release);

            juce::String output;
            std::array<char, 4096> buffer {};
            while (process.isRunning())
            {
                if (job->cancel.load(std::memory_order_acquire))
                {
                    process.kill();
                    finishWithError(job, "Multi-instrument transcription was cancelled.");
                    return;
                }
                const auto bytesRead = process.readProcessOutput(buffer.data(), static_cast<int>(buffer.size()));
                if (bytesRead > 0)
                    output += juce::String::fromUTF8(buffer.data(), bytesRead);
                juce::Thread::sleep(35);
            }

            output += process.readAllProcessOutput();
            if (process.getExitCode() != 0 || ! jsonOutput.existsAsFile())
            {
                const auto detail = outputTail(output).trim();
                finishWithError(job, "MuScriptor did not produce instrument note events."
                    + (detail.isNotEmpty() ? juce::String(" ") + detail : juce::String()));
                return;
            }

            auto notes = readMuScriptorNoteEvents(jsonOutput);
            if (notes.empty())
            {
                finishWithError(job, "MuScriptor completed but did not detect instrument notes.");
                return;
            }
            {
                const std::lock_guard<std::mutex> lock(job->resultLock);
                job->stage = "Recovering note dynamics from the source audio";
            }
            job->progress.store(0.92, std::memory_order_release);
            inferVelocitiesFromSource(job->source, notes);
            job->outputDirectory.deleteRecursively();
            {
                const std::lock_guard<std::mutex> lock(job->resultLock);
                job->notes = std::move(notes);
                job->stage = "MuScriptor multi-instrument transcription complete";
            }
            job->progress.store(1.0, std::memory_order_release);
            job->ok.store(true, std::memory_order_release);
            job->finished.store(true, std::memory_order_release);
        }

        static void run(const std::shared_ptr<Job>& job, const juce::File& runner)
        {
            if (job->profile == "piano")
            {
                runPiano(job, runner);
                return;
            }
            if (job->profile == "multi-instrument")
            {
                runMultiInstrument(job, runner);
                return;
            }

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
            addRecoveryArguments(arguments, job->profile);

            juce::ChildProcess process;
            if (! process.start(arguments, juce::ChildProcess::wantStdOut | juce::ChildProcess::wantStdErr))
            {
                finishWithError(job, "Could not launch Spotify Basic Pitch.");
                return;
            }

            {
                const std::lock_guard<std::mutex> lock(job->resultLock);
                job->stage = job->profile == "piano-recovery"
                    ? "Checking missed piano strikes with Basic Pitch"
                    : "Transcribing pitched notes with Basic Pitch";
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

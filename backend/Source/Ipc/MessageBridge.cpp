#include "MessageBridge.h"
#include "Schema.h"
#include "../Audio/Analysis/AudioFileAnalyzer.h"
#include "../Audio/Effects/TrackEffectDefaults.h"
#include "../Audio/Parameters/SynthPatchContract.h"
#include "../Audio/Recording/RecordingPlanner.h"
#include "../Audio/Recording/RecordingSessionPlanner.h"
#include "../Audio/Rendering/TrackBouncePlanner.h"
#include "../Audio/Sampler/DecentSamplerImporter.h"
#include "../Persistence/AudioFileLibraryActions.h"
#include "../Persistence/ManagedSfzAsset.h"
#include "../Persistence/ManagedGranularAsset.h"
#include "../Persistence/ProjectAssetPackage.h"
#include "../Persistence/ProjectDocumentBackup.h"
#include "../Persistence/ProjectIntegrityVerifier.h"

#include <juce_audio_formats/juce_audio_formats.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <thread>
#include <vector>

namespace beat
{
    namespace
    {
        constexpr const char* audioImportWildcard = "*.wav;*.aif;*.aiff;*.mp3;*.flac;*.ogg;*.m4a";
        constexpr const char* decentImportWildcard = "*.dspreset;*.zip";
        constexpr const char* sfzImportWildcard = "*.sfz";
        constexpr const char* granularImportWildcard = "*.wav;*.aif;*.aiff;*.flac";

        void setFiniteProperty(juce::DynamicObject& object, const juce::Identifier& name, double value)
        {
            if (std::isfinite(value))
                object.setProperty(name, value);
        }

        void setAudioAnalysisProperties(juce::DynamicObject& object, const AudioFileAnalysis& analysis)
        {
            setFiniteProperty(object, "leftPeakDbFS", analysis.leftPeakDbFS);
            setFiniteProperty(object, "rightPeakDbFS", analysis.rightPeakDbFS);
            setFiniteProperty(object, "truePeakDbTP", analysis.truePeakDbTP);
            setFiniteProperty(object, "rmsDbFS", analysis.rmsDbFS);
            setFiniteProperty(object, "crestFactorDb", analysis.crestFactorDb);
            setFiniteProperty(object, "dcOffset", analysis.dcOffset);
            object.setProperty("clippingCount", static_cast<double>(analysis.clippingCount));
            setFiniteProperty(object, "clippingRatio", analysis.clippingRatio);
            setFiniteProperty(object, "stereoCorrelation", analysis.stereoCorrelation);
            setFiniteProperty(object, "integratedLufs", analysis.integratedLufs);
        }

        juce::var makeAudioAnalysis(const AudioFileAnalysis& analysis)
        {
            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("sampleRate", analysis.sampleRate);
            object->setProperty("durationSeconds", analysis.durationSeconds);
            object->setProperty("lengthInSamples", static_cast<double>(analysis.lengthInSamples));
            object->setProperty("channelCount", analysis.channelCount);
            object->setProperty("bitDepth", analysis.bitDepth);
            setAudioAnalysisProperties(*object, analysis);
            return juce::var(object.get());
        }

        juce::var stringArrayToVar(const juce::StringArray& values)
        {
            juce::Array<juce::var> out;
            out.ensureStorageAllocated(values.size());
            for (const auto& value : values)
                out.add(value);
            return juce::var(out);
        }

        juce::var makeAudioDeviceSnapshotVar(const AudioEngine::AudioDeviceSnapshot& snapshot)
        {
            juce::Array<juce::var> devices;
            devices.ensureStorageAllocated((int) snapshot.devices.size());
            for (const auto& device : snapshot.devices)
            {
                juce::DynamicObject::Ptr object = new juce::DynamicObject();
                object->setProperty("typeName", device.typeName);
                object->setProperty("name", device.name);
                object->setProperty("input", device.input);
                object->setProperty("output", device.output);
                object->setProperty("currentInput", device.currentInput);
                object->setProperty("currentOutput", device.currentOutput);
                devices.add(juce::var(object.get()));
            }

            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("currentTypeName", snapshot.currentTypeName);
            object->setProperty("currentInputName", snapshot.currentInputName);
            object->setProperty("currentOutputName", snapshot.currentOutputName);
            object->setProperty("sampleRate", snapshot.sampleRate);
            object->setProperty("bufferSize", snapshot.bufferSize);
            object->setProperty("inputLatencySamples", snapshot.inputLatencySamples);
            object->setProperty("outputLatencySamples", snapshot.outputLatencySamples);
            object->setProperty("inputChannelNames", stringArrayToVar(snapshot.inputChannelNames));
            object->setProperty("outputChannelNames", stringArrayToVar(snapshot.outputChannelNames));
            object->setProperty("devices", devices);
            return juce::var(object.get());
        }

        juce::String trackKindToString(TrackKind kind)
        {
            switch (kind)
            {
                case TrackKind::Midi: return "midi";
                case TrackKind::Mixed: return "mixed";
                case TrackKind::Group: return "group";
                case TrackKind::Audio:
                default: return "audio";
            }
        }

        juce::String safeExportFileStem(const juce::String& name, int index)
        {
            auto clean = name.retainCharacters("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_").trim();
            if (clean.isEmpty())
                clean = "Track " + juce::String(index + 1);
            return clean;
        }

        juce::File uniqueStemExportFile(const juce::File& folder,
                                        const juce::String& requestedName,
                                        int index,
                                        juce::StringArray& usedNames)
        {
            const auto baseName = safeExportFileStem(requestedName, index);
            auto candidateName = baseName;
            int suffix = 2;
            while (usedNames.contains(candidateName, true))
                candidateName = baseName + " " + juce::String(suffix++);
            usedNames.add(candidateName);
            return folder.getChildFile(candidateName).withFileExtension(".wav");
        }

        juce::var makeAudioFileAssetVar(const AudioFileAsset& audioFile,
                                        const std::optional<AudioFileAnalysis>& analysis = std::nullopt)
        {
            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("id", audioFile.id);
            object->setProperty("name", audioFile.name);
            object->setProperty("path", audioFile.path);
            object->setProperty("durationSeconds", audioFile.durationSeconds);
            object->setProperty("sampleRate", audioFile.sampleRate);
            if (analysis.has_value())
            {
                object->setProperty("bitDepth", analysis->bitDepth);
                setAudioAnalysisProperties(*object, *analysis);
            }
            return juce::var(object.get());
        }

        juce::var makeAudioSegmentVar(const Segment& segment)
        {
            juce::DynamicObject::Ptr payload = new juce::DynamicObject();
            payload->setProperty("kind", "audio");
            payload->setProperty("audioFileId", segment.audioFileId);
            payload->setProperty("gainDb", segment.audioGainDb);

            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("id", segment.id);
            object->setProperty("trackId", segment.trackId);
            object->setProperty("startBeat", segment.startBeat);
            object->setProperty("lengthBeats", segment.lengthBeats);
            object->setProperty("sourceStartBeat", segment.sourceStartBeat);
            object->setProperty("fadeInBeats", segment.fadeInBeats);
            object->setProperty("fadeOutBeats", segment.fadeOutBeats);
            object->setProperty("repeats", segment.repeats);
            object->setProperty("layer", segment.layer);
            object->setProperty("muted", segment.muted);
            object->setProperty("payload", juce::var(payload.get()));
            return juce::var(object.get());
        }

        juce::var makeBouncedTrackVar(const Track& track)
        {
            juce::DynamicObject::Ptr effects = new juce::DynamicObject();
            effects->setProperty("filters", juce::Array<juce::var> {});

            juce::Array<juce::var> segments;
            for (const auto& segment : track.segments)
                segments.add(makeAudioSegmentVar(segment));

            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("id", track.id);
            object->setProperty("name", track.name);
            object->setProperty("kind", trackKindToString(track.kind));
            object->setProperty("instrumentId", track.instrumentId);
            object->setProperty("audioFileId", track.audioFileId);
            object->setProperty("parentTrackId", track.parentTrackId);
            object->setProperty("gainDb", track.gainDb);
            object->setProperty("pan", track.pan);
            object->setProperty("mute", track.mute);
            object->setProperty("solo", track.solo);
            object->setProperty("recordArmed", track.recordArmed);
            object->setProperty("inputMonitoring", track.inputMonitoring);
            object->setProperty("inputDeviceId", track.inputDeviceId);
            object->setProperty("inputChannelStart", track.inputChannelStart);
            object->setProperty("inputChannelCount", track.inputChannelCount);
            object->setProperty("recordGainDb", track.recordGainDb);
            object->setProperty("effects", juce::var(effects.get()));
            object->setProperty("segments", segments);
            object->setProperty("rowHeight", "normal");
            return juce::var(object.get());
        }

        juce::var makeRecordingCaptureStatsVar(const RecordingCaptureStats& stats)
        {
            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("active", stats.active);
            object->setProperty("channels", stats.channels);
            object->setProperty("recordedSamples", stats.recordedSamples);
            object->setProperty("capacitySamples", stats.capacitySamples);
            object->setProperty("sampleRate", stats.sampleRate);
            object->setProperty("overflowed", stats.overflowed);
            object->setProperty("durationSeconds", stats.sampleRate > 0.0
                ? static_cast<double>(stats.recordedSamples) / stats.sampleRate
                : 0.0);
            return juce::var(object.get());
        }

        juce::var makeRecordingSessionPlanVar(const RecordingSessionPlan& plan)
        {
            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("trackId", plan.trackId);
            object->setProperty("transportStartBeat", plan.transportStartBeat);
            object->setProperty("captureStartBeat", plan.captureStartBeat);
            object->setProperty("countInBeats", plan.countInBeats);
            object->setProperty("captureDelaySeconds", plan.captureDelaySeconds);
            object->setProperty("maxDurationSeconds", plan.maxDurationSeconds);
            object->setProperty("inputChannels", plan.inputChannels);
            return juce::var(object.get());
        }

        juce::Array<juce::var> makeFloatArrayVar(const std::vector<float>& values)
        {
            juce::Array<juce::var> out;
            out.ensureStorageAllocated((int) values.size());
            for (const auto value : values)
                out.add(value);
            return out;
        }

        juce::var makeWaveformChannel(const AudioWaveformChannel& channel)
        {
            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("upper", makeFloatArrayVar(channel.upper));
            object->setProperty("lower", makeFloatArrayVar(channel.lower));
            return juce::var(object.get());
        }

        juce::var makeWaveformSummary(const AudioWaveformSummary& waveform)
        {
            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("left", makeWaveformChannel(waveform.left));
            object->setProperty("right", makeWaveformChannel(waveform.right));
            object->setProperty("sampleRate", waveform.sampleRate);
            object->setProperty("durationSeconds", waveform.durationSeconds);
            object->setProperty("lengthInSamples", static_cast<double>(waveform.lengthInSamples));
            object->setProperty("channelCount", waveform.channelCount);
            object->setProperty("bucketCount", waveform.bucketCount);
            return juce::var(object.get());
        }

        juce::String makeWavDataUrl(const juce::File& file)
        {
            juce::MemoryBlock data;
            if (! file.loadFileAsData(data) || data.getSize() == 0)
                return {};

            return "data:audio/wav;base64," + juce::Base64::toBase64(data.getData(), data.getSize());
        }

        juce::String makeImageDataUrl(const juce::File& file)
        {
            if (! file.existsAsFile())
                return {};

            const auto size = file.getSize();
            constexpr juce::int64 maxInlineImageBytes = 2 * 1024 * 1024;
            if (size <= 0 || size > maxInlineImageBytes)
                return {};

            const auto extension = file.getFileExtension().toLowerCase();
            juce::String mime;
            if (extension == ".png")
                mime = "image/png";
            else if (extension == ".jpg" || extension == ".jpeg")
                mime = "image/jpeg";
            else if (extension == ".webp")
                mime = "image/webp";
            else
                return {};

            juce::MemoryBlock data;
            if (! file.loadFileAsData(data) || data.getSize() == 0)
                return {};

            return "data:" + mime + ";base64," + juce::Base64::toBase64(data.getData(), data.getSize());
        }

        juce::Array<juce::var> makeStringArrayVar(const juce::StringArray& values)
        {
            juce::Array<juce::var> out;
            for (const auto& value : values)
                out.add(value);
            return out;
        }

        juce::var makeSidecarCleanupReport(const ProjectSidecarCleanupReport& report)
        {
            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("deletedFiles", report.deletedFiles);
            object->setProperty("failedFiles", report.failedFiles);
            object->setProperty("deletedPaths", makeStringArrayVar(report.deletedPaths));
            object->setProperty("failedPaths", makeStringArrayVar(report.failedPaths));
            return juce::var(object.get());
        }

        struct ExportRenderOptions
        {
            double sampleRate { 44100.0 };
            int blockSize { 512 };
            int channels { 2 };
            int bitDepth { 16 };
            AudioQuality quality { AudioQuality::standardLive };
        };

        int normalizeExportBitDepth(int value) noexcept
        {
            if (value <= 16) return 16;
            if (value <= 24) return 24;
            return 32;
        }

        ExportRenderOptions parseExportRenderOptions(const juce::var& payload)
        {
            ExportRenderOptions out;
            const auto options = payload.getProperty("options", {});
            if (options.isObject())
            {
                out.sampleRate = juce::jlimit(8000.0, 192000.0, (double) options.getProperty("sampleRate", out.sampleRate));
                out.blockSize = juce::jlimit(64, 8192, (int) options.getProperty("blockSize", out.blockSize));
                out.channels = juce::jlimit(1, 2, (int) options.getProperty("channels", out.channels));
                out.bitDepth = normalizeExportBitDepth((int) options.getProperty("bitDepth", out.bitDepth));
                out.quality = options.getProperty("quality", "standard").toString() == "high"
                    ? AudioQuality::offlineHighQuality
                    : AudioQuality::standardLive;
            }
            return out;
        }

        juce::var makeAudioFile(const juce::File& file)
        {
            juce::AudioFormatManager formatManager;
            formatManager.registerBasicFormats();

            std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
            if (reader == nullptr)
                return juce::var();

            juce::DynamicObject::Ptr audioFile = new juce::DynamicObject();
            audioFile->setProperty("id", juce::Uuid().toString());
            audioFile->setProperty("name", file.getFileName());
            audioFile->setProperty("path", file.getFullPathName());
            audioFile->setProperty("durationSeconds", reader->sampleRate > 0.0
                ? static_cast<double>(reader->lengthInSamples) / reader->sampleRate
                : 0.0);
            audioFile->setProperty("sampleRate", reader->sampleRate);
            audioFile->setProperty("bitDepth", static_cast<int>(reader->bitsPerSample));
            audioFile->setProperty("sizeBytes", static_cast<double>(file.getSize()));
            audioFile->setProperty("importedAt", static_cast<double>(juce::Time::getCurrentTime().toMilliseconds()));
            if (auto analysis = AudioFileAnalyzer::analyzeFile(file))
                setAudioAnalysisProperties(*audioFile, *analysis);
            return juce::var(audioFile.get());
        }

        double clamp01(double value) noexcept
        {
            if (! std::isfinite(value))
                return 0.0;
            return juce::jlimit(0.0, 1.0, value);
        }

        juce::String sanitizeWavemapId(juce::String id, const juce::String& fallback)
        {
            id = id.trim();
            if (id.isEmpty())
                id = fallback;
            if (! id.startsWith("user."))
                id = "user." + id;

            juce::String out;
            for (auto c : id)
            {
                if (juce::CharacterFunctions::isLetterOrDigit(c) || c == '.' || c == '_' || c == '-')
                    out << c;
                else
                    out << "-";
            }
            return out.isNotEmpty() ? out : "user.wavemap";
        }

        juce::var analyzeHarmonicPartials(const std::vector<float>& samples, int start, int end)
        {
            constexpr int partialCount = 16;
            const int length = std::max(1, end - start);
            const int stride = std::max(1, length / 1024);
            const int count = std::max(1, (length + stride - 1) / stride);
            std::array<double, partialCount> magnitudes {};
            double peak = 0.0001;

            for (int partial = 0; partial < partialCount; ++partial)
            {
                const int harmonic = partial + 1;
                double real = 0.0;
                double imag = 0.0;
                double windowSum = 0.0;
                int sampleIndex = 0;
                for (int index = start; index < end; index += stride)
                {
                    const double sample = juce::jlimit(-1.0, 1.0, (double) samples[(size_t) index]);
                    const double phase = juce::MathConstants<double>::twoPi * (double) harmonic * (double) sampleIndex / (double) std::max(1, count - 1);
                    const double window = 0.5 - 0.5 * std::cos(juce::MathConstants<double>::twoPi * (double) sampleIndex / (double) std::max(1, count - 1));
                    real += sample * std::cos(phase) * window;
                    imag -= sample * std::sin(phase) * window;
                    windowSum += window;
                    ++sampleIndex;
                }
                magnitudes[(size_t) partial] = std::sqrt(real * real + imag * imag) / std::max(0.0001, windowSum);
                peak = std::max(peak, magnitudes[(size_t) partial]);
            }

            juce::Array<juce::var> partials;
            for (const auto magnitude : magnitudes)
                partials.add(clamp01(std::sqrt(magnitude / peak)));
            return juce::var(partials);
        }

        double estimateSpectralTiltFromPartials(const juce::var& partialValues)
        {
            if (auto* partials = partialValues.getArray())
            {
                double low = 0.0;
                double high = 0.0;
                for (int i = 0; i < partials->size(); ++i)
                {
                    const auto value = clamp01((double) (*partials)[i]);
                    if (i < 4)
                        low += value;
                    else if (i >= 8 && i < 16)
                        high += value;
                }
                return juce::jlimit(-1.0, 1.0, (high - low) / std::max(0.001, high + low));
            }
            return 0.0;
        }

        double estimateSpectralCentroidFromPartials(const juce::var& partialValues)
        {
            if (auto* partials = partialValues.getArray())
            {
                double weighted = 0.0;
                double total = 0.0;
                for (int i = 0; i < partials->size(); ++i)
                {
                    const auto value = clamp01((double) (*partials)[i]);
                    weighted += value * (double) (i + 1);
                    total += value;
                }
                return total > 0.0 ? weighted / total : 0.0;
            }
            return 0.0;
        }

        int dominantHarmonicFromPartials(const juce::var& partialValues)
        {
            int harmonic = 0;
            double peak = 0.0;
            if (auto* partials = partialValues.getArray())
            {
                for (int i = 0; i < partials->size(); ++i)
                {
                    const auto value = clamp01((double) (*partials)[i]);
                    if (value > peak)
                    {
                        peak = value;
                        harmonic = i + 1;
                    }
                }
            }
            return harmonic;
        }

        juce::var makeWavemapFrame(const std::vector<float>& samples,
                                   int start,
                                   int end,
                                   const juce::String& wavemapId,
                                   int frameIndex)
        {
            const int safeStart = juce::jlimit(0, (int) samples.size(), start);
            const int safeEnd = juce::jlimit(safeStart + 1, (int) samples.size(), end);
            double sumSquares = 0.0;
            double sumAbs = 0.0;
            double derivative = 0.0;
            double zeroCrossings = 0.0;
            double positiveEnergy = 0.0;
            double negativeEnergy = 0.0;
            double peak = 0.0;
            double previous = samples[(size_t) safeStart];

            for (int index = safeStart; index < safeEnd; ++index)
            {
                const double sample = juce::jlimit(-1.0, 1.0, (double) samples[(size_t) index]);
                sumSquares += sample * sample;
                sumAbs += std::abs(sample);
                derivative += std::abs(sample - previous);
                peak = std::max(peak, std::abs(sample));
                if ((sample >= 0.0 && previous < 0.0) || (sample < 0.0 && previous >= 0.0))
                    zeroCrossings += 1.0;
                if (sample >= 0.0)
                    positiveEnergy += sample * sample;
                else
                    negativeEnergy += sample * sample;
                previous = sample;
            }

            const auto count = std::max(1, safeEnd - safeStart);
            const auto rms = std::sqrt(sumSquares / (double) count);
            const auto meanAbs = sumAbs / (double) count;
            const auto zeroDensity = zeroCrossings / (double) count;
            const auto roughness = derivative / (double) count;
            const auto totalPolarityEnergy = positiveEnergy + negativeEnergy + 1.0e-9;
            const auto asymmetry = std::abs(positiveEnergy - negativeEnergy) / totalPolarityEnergy;

            juce::DynamicObject::Ptr frame = new juce::DynamicObject();
            frame->setProperty("id", wavemapId + ".frame." + juce::String(frameIndex + 1));
            frame->setProperty("label", juce::String::charToString("ABCD"[juce::jlimit(0, 3, frameIndex)]));
            frame->setProperty("position", frameIndex / 3.0);
            frame->setProperty("brightness", clamp01(0.18 + rms * 0.52 + zeroDensity * 1.8 + roughness * 0.85));
            frame->setProperty("even", clamp01(0.1 + zeroDensity * 1.25 + asymmetry * 0.55));
            frame->setProperty("fold", clamp01(0.05 + roughness * 1.65 + meanAbs * 0.35));
            frame->setProperty("formant", clamp01(0.08 + rms * 0.28 + roughness * 1.1 + zeroDensity * 0.7));
            frame->setProperty("notch", clamp01(0.04 + (1.0 - rms) * 0.16 + roughness * 0.72 + asymmetry * 0.5));
            frame->setProperty("skew", juce::jlimit(-1.0, 1.0, (zeroDensity * 10.0 - meanAbs) * 0.22 + (rms - 0.28) * 0.35));
            const auto partials = analyzeHarmonicPartials(samples, safeStart, safeEnd);
            const auto tilt = estimateSpectralTiltFromPartials(partials);
            const auto spectralCentroid = estimateSpectralCentroidFromPartials(partials);
            const auto dominantHarmonic = dominantHarmonicFromPartials(partials);
            const auto dominantPhase = juce::jlimit(-juce::MathConstants<double>::pi,
                                                    juce::MathConstants<double>::pi,
                                                    (positiveEnergy - negativeEnergy) / totalPolarityEnergy * juce::MathConstants<double>::pi);
            frame->setProperty("tilt", tilt);
            frame->setProperty("focus", clamp01(0.18 + roughness * 0.68 + std::abs(tilt) * 0.24 + asymmetry * 0.18));
            frame->setProperty("phase", juce::jlimit(-1.0, 1.0, (positiveEnergy - negativeEnergy) / totalPolarityEnergy));
            frame->setProperty("partials", partials);
            juce::DynamicObject::Ptr analysis = new juce::DynamicObject();
            analysis->setProperty("sourceStartSample", static_cast<double>(safeStart));
            analysis->setProperty("sourceEndSample", static_cast<double>(safeEnd));
            analysis->setProperty("rms", rms);
            analysis->setProperty("peak", peak);
            analysis->setProperty("zeroCrossRate", zeroDensity);
            analysis->setProperty("roughness", roughness);
            analysis->setProperty("asymmetry", asymmetry);
            analysis->setProperty("spectralCentroid", spectralCentroid);
            analysis->setProperty("dominantHarmonic", dominantHarmonic);
            analysis->setProperty("dominantPhase", dominantPhase);
            frame->setProperty("analysis", juce::var(analysis.get()));
            return juce::var(frame.get());
        }

        std::pair<int, int> clampSampleWindow(int start, int end, int length)
        {
            const auto width = std::max(1, end - start);
            auto safeStart = juce::jlimit(0, std::max(0, length - 1), start);
            auto safeEnd = std::min(length, safeStart + width);
            if (safeEnd - safeStart < width)
            {
                safeStart = std::max(0, safeEnd - width);
                safeEnd = std::min(length, safeStart + width);
            }
            return { safeStart, std::max(safeStart + 1, safeEnd) };
        }

        int peakSampleIndex(const std::vector<float>& samples, int start, int end)
        {
            const auto safeStart = juce::jlimit(0, std::max(0, (int) samples.size() - 1), start);
            const auto safeEnd = std::max(safeStart + 1, std::min((int) samples.size(), end));
            auto peakIndex = safeStart;
            auto peak = 0.0f;
            for (int index = safeStart; index < safeEnd; ++index)
            {
                const auto value = std::abs(samples[(size_t) index]);
                if (value > peak)
                {
                    peak = value;
                    peakIndex = index;
                }
            }
            return peakIndex;
        }

        int strongestRmsWindowStart(const std::vector<float>& samples, int start, int end, int window)
        {
            const auto safeStart = juce::jlimit(0, std::max(0, (int) samples.size() - 1), start);
            const auto safeEnd = std::max(safeStart + 1, std::min((int) samples.size(), end));
            const auto safeWindow = juce::jlimit(1, safeEnd - safeStart, window);
            const auto step = std::max(1, safeWindow / 8);
            auto bestStart = safeStart;
            auto bestEnergy = -1.0;
            for (int index = safeStart; index <= safeEnd - safeWindow; index += step)
            {
                auto energy = 0.0;
                for (int sampleIndex = index; sampleIndex < index + safeWindow; ++sampleIndex)
                {
                    const auto sample = samples[(size_t) sampleIndex];
                    energy += (double) sample * (double) sample;
                }
                if (energy > bestEnergy)
                {
                    bestEnergy = energy;
                    bestStart = index;
                }
            }
            return bestStart;
        }

        std::pair<int, int> wavemapSelectionWindow(const std::vector<float>& samples, const juce::var& selection)
        {
            const auto length = (int) samples.size();
            if (length <= 0)
                return { 0, 1 };

            const auto mode = selection.isObject()
                ? selection.getProperty("mode", "full").toString()
                : juce::String("full");
            auto start = 0;
            auto end = length;
            if (mode == "manual")
            {
                const auto startRatio = juce::jlimit(0.0, 1.0, (double) selection.getProperty("startRatio", 0.0));
                const auto endRatio = juce::jlimit(0.0, 1.0, (double) selection.getProperty("endRatio", 1.0));
                start = (int) std::floor(std::min(startRatio, endRatio) * length);
                end = (int) std::ceil(std::max(startRatio, endRatio) * length);
            }
            else if (mode == "transient")
            {
                const auto ratio = juce::jlimit(0.0, 1.0, (double) selection.getProperty("windowRatio", 0.28));
                const auto window = std::max(1, std::min(length, std::max(256, (int) std::floor(length * ratio))));
                const auto peak = peakSampleIndex(samples, 0, length);
                start = peak - (int) std::floor(window * 0.18);
                end = start + window;
            }
            else if (mode == "sustain")
            {
                const auto ratio = juce::jlimit(0.0, 1.0, (double) selection.getProperty("windowRatio", 0.5));
                const auto window = std::max(1, std::min(length, std::max(512, (int) std::floor(length * ratio))));
                const auto searchStart = std::min(length - 1, (int) std::floor(length * 0.22));
                start = strongestRmsWindowStart(samples, searchStart, length, window);
                end = start + window;
            }

            return clampSampleWindow(start, end, length);
        }

        juce::var makeWavemapFromAudioFile(const juce::File& file,
                                           const juce::String& audioFileId,
                                           juce::String wavemapId,
                                           juce::String name,
                                           const juce::var& selection)
        {
            juce::AudioFormatManager formatManager;
            formatManager.registerBasicFormats();
            std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
            if (reader == nullptr || reader->lengthInSamples <= 0)
                return {};

            constexpr int maxResynthSamples = 262144;
            const int readCount = (int) std::min<juce::int64>(reader->lengthInSamples, maxResynthSamples);
            juce::AudioBuffer<float> buffer((int) std::max<juce::uint32>(1, reader->numChannels), readCount);
            if (! reader->read(&buffer, 0, readCount, 0, true, true))
                return {};

            std::vector<float> samples;
            samples.resize((size_t) readCount);
            const int channels = std::max(1, buffer.getNumChannels());
            for (int sampleIndex = 0; sampleIndex < readCount; ++sampleIndex)
            {
                float sum = 0.0f;
                for (int channel = 0; channel < channels; ++channel)
                    sum += buffer.getSample(channel, sampleIndex);
                samples[(size_t) sampleIndex] = juce::jlimit(-1.0f, 1.0f, sum / (float) channels);
            }

            wavemapId = sanitizeWavemapId(wavemapId, file.getFileNameWithoutExtension());
            if (name.trim().isEmpty())
                name = file.getFileNameWithoutExtension() + " Wavemap";

            const auto [selectionStart, selectionEnd] = wavemapSelectionWindow(samples, selection);
            const int selectedLength = std::max(1, selectionEnd - selectionStart);

            juce::Array<juce::var> frames;
            constexpr int frameCount = 4;
            const int frameLength = std::max(1, selectedLength / frameCount);
            for (int frameIndex = 0; frameIndex < frameCount; ++frameIndex)
            {
                const int start = selectionStart + frameIndex * frameLength;
                const int end = frameIndex == frameCount - 1 ? selectionEnd : std::min(selectionEnd, start + frameLength);
                frames.add(makeWavemapFrame(samples, start, end, wavemapId, frameIndex));
            }

            const auto selectionMode = selection.isObject()
                ? selection.getProperty("mode", "full").toString()
                : juce::String("full");
            juce::DynamicObject::Ptr source = new juce::DynamicObject();
            source->setProperty("kind", "imported-audio");
            source->setProperty("label", selectionMode == "full"
                ? file.getFileNameWithoutExtension()
                : file.getFileNameWithoutExtension() + " " + selectionMode);
            source->setProperty("audioFileId", audioFileId);
            source->setProperty("path", file.getFullPathName());
            source->setProperty("sampleRate", reader->sampleRate);
            source->setProperty("channelCount", static_cast<int>(reader->numChannels));
            source->setProperty("bitDepth", static_cast<int>(reader->bitsPerSample));
            source->setProperty("sourceSampleCount", static_cast<double>(reader->lengthInSamples));
            source->setProperty("analyzedSampleCount", static_cast<double>(selectedLength));
            source->setProperty("frameCount", frameCount);
            source->setProperty("sourceStartSample", static_cast<double>(selectionStart));
            source->setProperty("sourceEndSample", static_cast<double>(selectionEnd));
            source->setProperty("createdAt", static_cast<double>(juce::Time::getCurrentTime().toMilliseconds()));

            juce::DynamicObject::Ptr wavemap = new juce::DynamicObject();
            wavemap->setProperty("schemaVersion", 1);
            wavemap->setProperty("id", wavemapId);
            wavemap->setProperty("name", name);
            wavemap->setProperty("kind", "resynthesized");
            wavemap->setProperty("interpolation", "smooth");
            wavemap->setProperty("morph", 0.42);
            wavemap->setProperty("source", juce::var(source.get()));
            wavemap->setProperty("frames", frames);
            return juce::var(wavemap.get());
        }

        double fallbackImportedAtForFile(const juce::File& file)
        {
            auto created = file.getCreationTime().toMilliseconds();
            if (created > 0)
                return static_cast<double>(created);

            auto modified = file.getLastModificationTime().toMilliseconds();
            if (modified > 0)
                return static_cast<double>(modified);

            return static_cast<double>(juce::Time::getCurrentTime().toMilliseconds());
        }

        bool audioFileNeedsMetadataRefresh(const juce::var& audioFile, bool hasAnalysis)
        {
            if (!audioFile.isObject())
                return false;

            const auto path = audioFile.getProperty("path", {}).toString();
            if (path.isEmpty() || !juce::File(path).existsAsFile())
                return false;

            return (double) audioFile.getProperty("durationSeconds", 0.0) <= 0.0
                || (int) audioFile.getProperty("sampleRate", 0) <= 0
                || (double) audioFile.getProperty("sizeBytes", 0.0) <= 0.0
                || (double) audioFile.getProperty("importedAt", 0.0) <= 0.0
                || !hasAnalysis;
        }

        juce::var refreshAudioFileMetadata(const juce::var& existing)
        {
            const auto path = existing.getProperty("path", {}).toString();
            auto refreshed = makeAudioFile(juce::File(path));
            if (!refreshed.isObject())
                return existing;

            if (auto* object = refreshed.getDynamicObject())
            {
                object->setProperty("id", existing.getProperty("id", {}));

                const auto storedName = existing.getProperty("name", {}).toString();
                if (storedName.isNotEmpty())
                    object->setProperty("name", storedName);

                const auto storedImportedAt = (double) existing.getProperty("importedAt", 0.0);
                object->setProperty("importedAt", storedImportedAt > 0.0
                    ? storedImportedAt
                    : fallbackImportedAtForFile(juce::File(path)));
            }

            return refreshed;
        }

        juce::File audioLibraryDirectory()
        {
            return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                .getChildFile("Beat")
                .getChildFile("Audio Files");
        }

        juce::File uniqueAudioLibraryFile(const juce::File& source)
        {
            auto folder = audioLibraryDirectory();
            folder.createDirectory();
            auto candidate = folder.getChildFile(source.getFileName());
            if (! candidate.exists())
                return candidate;

            const auto base = source.getFileNameWithoutExtension();
            const auto ext = source.getFileExtension();
            for (int i = 2; i < 10000; ++i)
            {
                candidate = folder.getChildFile(base + " " + juce::String(i) + ext);
                if (! candidate.exists())
                    return candidate;
            }
            return folder.getChildFile(base + " " + juce::Uuid().toString().substring(0, 8) + ext);
        }

        juce::File importAudioFileIntoLibrary(const juce::File& source)
        {
            const auto folder = audioLibraryDirectory();
            if (source.getParentDirectory() == folder)
                return source;

            auto destination = uniqueAudioLibraryFile(source);
            if (destination.existsAsFile())
                destination.deleteFile();
            return source.copyFileTo(destination) ? destination : source;
        }

        juce::var makeAudioFileResponse(const juce::File& file)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            response->setProperty("file", makeAudioFile(file));
            return juce::var(response.get());
        }

        juce::File resolveFrontendAssetPath(const juce::String& path)
        {
            if (path.startsWith("/samples/"))
            {
                const auto executable = juce::File::getSpecialLocation(juce::File::currentExecutableFile);
                const auto resources = executable.getParentDirectory().getSiblingFile("Resources").getChildFile("frontend");
                return resources.getChildFile(path.substring(1));
            }
            return juce::File(path);
        }

        bool assetPathExists(const juce::String& path)
        {
            if (path.isEmpty() || path.startsWith("blob:") || path.startsWith("data:"))
                return true;
            return resolveFrontendAssetPath(path).existsAsFile();
        }

        void addMissingAssetPath(juce::StringArray& missing, const juce::String& path)
        {
            if (path.isNotEmpty() && !assetPathExists(path))
                missing.addIfNotAlreadyThere(path);
        }

        juce::StringArray collectMissingExportAssets(const juce::var& instrumentsVar, const juce::var& audioFilesVar)
        {
            juce::StringArray missing;
            if (auto* audioFiles = audioFilesVar.getArray())
            {
                for (const auto& audioFile : *audioFiles)
                {
                    if (!audioFile.isObject()) continue;
                    addMissingAssetPath(missing, audioFile.getProperty("path", {}).toString());
                }
            }

            if (auto* instruments = instrumentsVar.getArray())
            {
                for (const auto& instrument : *instruments)
                {
                    if (!instrument.isObject()) continue;
                    addMissingAssetPath(missing, instrument.getProperty("sampleUrl", {}).toString());
                    if (auto* sampleUrls = instrument.getProperty("sampleUrls", {}).getArray())
                    {
                        for (const auto& sampleUrl : *sampleUrls)
                            addMissingAssetPath(missing, sampleUrl.toString());
                    }
                    if (auto* sampleMap = instrument.getProperty("sampleMap", {}).getArray())
                    {
                        for (const auto& zone : *sampleMap)
                        {
                            if (!zone.isObject()) continue;
                            addMissingAssetPath(missing, zone.getProperty("path", zone.getProperty("sampleUrl", {})).toString());
                        }
                    }
                }
            }
            return missing;
        }

        juce::String missingAssetExportError(const juce::StringArray& missing)
        {
            if (missing.isEmpty()) return {};
            juce::StringArray shown;
            const int limit = juce::jmin(6, missing.size());
            for (int i = 0; i < limit; ++i)
                shown.add(missing[i]);
            auto message = "Cannot export WAV because referenced audio/sample files are missing:\n"
                + shown.joinIntoString("\n");
            if (missing.size() > limit)
                message += "\n...and " + juce::String(missing.size() - limit) + " more.";
            return message;
        }

        juce::String projectIntegrityErrorDetails(const ProjectIntegrityReport& report)
        {
            if (report.ok())
                return {};

            juce::StringArray shown;
            for (const auto& issue : report.issues)
            {
                if (issue.severity != ProjectIntegritySeverity::Error)
                    continue;

                shown.add(issue.path.isNotEmpty()
                    ? issue.code + " at " + issue.path + ": " + issue.message
                    : issue.code + ": " + issue.message);

                if (shown.size() >= 6)
                    break;
            }

            const auto remaining = report.errorCount() - shown.size();
            if (remaining > 0)
                shown.add("...and " + juce::String(remaining) + " more.");
            return shown.joinIntoString("\n");
        }

        juce::String projectIntegritySaveError(const ProjectIntegrityReport& report)
        {
            const auto details = projectIntegrityErrorDetails(report);
            if (details.isEmpty())
                return {};
            return "Cannot save Beat project because the document has invalid references:\n" + details;
        }

        juce::String projectIntegrityOpenError(const ProjectIntegrityReport& report)
        {
            const auto details = projectIntegrityErrorDetails(report);
            if (details.isEmpty())
                return {};
            return "Cannot open Beat project because the document has invalid references:\n" + details;
        }

        juce::String assetPolicyForPath(const juce::String& path, const juce::String& kind)
        {
            if (kind == "plugin") return "plugin";
            return path.startsWith("/samples/") ? "bundled" : "external";
        }

        juce::var makeMissingAssetObject(const juce::String& kind,
                                         const juce::String& path,
                                         const juce::String& name,
                                         const juce::String& policy)
        {
            juce::DynamicObject::Ptr asset = new juce::DynamicObject();
            asset->setProperty("id", "missing-" + juce::Uuid().toString());
            asset->setProperty("kind", kind);
            asset->setProperty("path", path);
            if (name.isNotEmpty())
                asset->setProperty("name", name);
            asset->setProperty("policy", policy.isNotEmpty() ? policy : assetPolicyForPath(path, kind));
            asset->setProperty("references", juce::Array<juce::var> {});
            return juce::var(asset.get());
        }

        juce::Array<juce::var> collectMissingDocumentAssets(const juce::var& document)
        {
            juce::Array<juce::var> missing;
            juce::StringArray seen;
            const auto addMissing = [&](const juce::String& kind,
                                        const juce::String& path,
                                        const juce::String& name = {},
                                        const juce::String& policy = {})
            {
                if (path.isEmpty() || assetPathExists(path) || seen.contains(path))
                    return;
                seen.add(path);
                missing.add(makeMissingAssetObject(kind, path, name, policy));
            };

            if (auto* assets = document.getProperty("assets", {}).getArray())
            {
                for (const auto& asset : *assets)
                {
                    if (!asset.isObject()) continue;
                    addMissing(
                        asset.getProperty("kind", "sample").toString(),
                        asset.getProperty("path", {}).toString(),
                        asset.getProperty("name", {}).toString(),
                        asset.getProperty("policy", {}).toString());
                }
                return missing;
            }

            if (auto* audioFiles = document.getProperty("audioFiles", {}).getArray())
            {
                for (const auto& audioFile : *audioFiles)
                {
                    if (!audioFile.isObject()) continue;
                    addMissing("audio",
                               audioFile.getProperty("path", {}).toString(),
                               audioFile.getProperty("name", {}).toString());
                }
            }
            if (auto* instruments = document.getProperty("instruments", {}).getArray())
            {
                for (const auto& instrument : *instruments)
                {
                    if (!instrument.isObject()) continue;
                    const auto instrumentName = instrument.getProperty("name", {}).toString();
                    addMissing("sample", instrument.getProperty("sampleUrl", {}).toString(), instrumentName);
                    if (auto* sampleUrls = instrument.getProperty("sampleUrls", {}).getArray())
                        for (const auto& sampleUrl : *sampleUrls)
                            addMissing("sample", sampleUrl.toString(), instrumentName);
                    if (auto* sampleMap = instrument.getProperty("sampleMap", {}).getArray())
                    {
                        for (const auto& zone : *sampleMap)
                        {
                            if (!zone.isObject()) continue;
                            addMissing("sample",
                                       zone.getProperty("path", zone.getProperty("sampleUrl", {})).toString(),
                                       zone.getProperty("name", instrumentName).toString());
                        }
                    }
                }
            }
            return missing;
        }

        float boundedEqDb(double value) noexcept
        {
            return juce::jlimit(-24.0f, 24.0f, (float) value);
        }

        float eqBandValue(const juce::Array<juce::var>* bands, int index) noexcept
        {
            if (bands == nullptr || index < 0 || index >= bands->size())
                return 0.0f;
            return boundedEqDb((double) bands->getReference(index));
        }

        EqAutomationPoint parseEqAutomationPoint(const juce::var& pointVar)
        {
            EqAutomationPoint point;
            point.atBeat = (double) pointVar.getProperty("atBeat", 0.0);

            if (auto* bands = pointVar.getProperty("bandsDb", {}).getArray())
            {
                point.lowDb = 0.5f * (eqBandValue(bands, 0) + eqBandValue(bands, 1));
                point.midDb = 0.5f * (eqBandValue(bands, 2) + eqBandValue(bands, 3));
                point.highDb = 0.5f * (eqBandValue(bands, 4) + eqBandValue(bands, 5));
                point.airDb = eqBandValue(bands, 6);
                return point;
            }

            point.lowDb = boundedEqDb((double) pointVar.getProperty("lowDb", 0.0));
            point.midDb = boundedEqDb((double) pointVar.getProperty("midDb", 0.0));
            point.highDb = boundedEqDb((double) pointVar.getProperty("highDb", 0.0));
            point.airDb = boundedEqDb((double) pointVar.getProperty("airDb", 0.0));
            return point;
        }

        void saveAudioFile(Database& database, const juce::var& audioFile);

        juce::var makeDecentSamplerImport(Database& database, const DecentSamplerImport& source)
        {
            juce::Array<juce::var> samples;
            for (const auto& sourceSample : source.samples)
            {
                juce::DynamicObject::Ptr sample = new juce::DynamicObject();
                sample->setProperty("path", sourceSample.path);
                sample->setProperty("name", sourceSample.name);
                sample->setProperty("trigger", sourceSample.trigger);
                sample->setProperty("rootNote", sourceSample.rootNote);
                sample->setProperty("loNote", sourceSample.loNote);
                sample->setProperty("hiNote", sourceSample.hiNote);
                sample->setProperty("loVel", sourceSample.loVel);
                sample->setProperty("hiVel", sourceSample.hiVel);
                sample->setProperty("volumeDb", sourceSample.volumeDb);
                sample->setProperty("pan", sourceSample.pan);
                sample->setProperty("tuning", sourceSample.tuning);
                sample->setProperty("seqPosition", sourceSample.seqPosition);
                sample->setProperty("chokeGroup", sourceSample.chokeGroup);
                sample->setProperty("loopEnabled", sourceSample.loopEnabled);
                sample->setProperty("loopStart", sourceSample.loopStart);
                sample->setProperty("loopEnd", sourceSample.loopEnd);
                sample->setProperty("oneShot", sourceSample.oneShot);
                sample->setProperty("durationSeconds", sourceSample.durationSeconds);
                sample->setProperty("loLengthSeconds", sourceSample.loLengthSeconds);
                sample->setProperty("hiLengthSeconds", sourceSample.hiLengthSeconds);
                sample->setProperty("startSample", sourceSample.startSample);
                sample->setProperty("endSample", sourceSample.endSample);
                samples.add(juce::var(sample.get()));
            }

            juce::Array<juce::var> audioFiles;
            juce::Array<juce::var> sampleUrlVars;
            for (const auto& url : source.sampleUrls)
            {
                sampleUrlVars.add(url);
                const auto audioFile = makeAudioFile(juce::File(url));
                if (! audioFile.isVoid())
                {
                    saveAudioFile(database, audioFile);
                    audioFiles.add(audioFile);
                }
            }

            juce::Array<juce::var> uiControlDetails;
            for (const auto& sourceControl : source.uiControlDetails)
            {
                juce::DynamicObject::Ptr control = new juce::DynamicObject();
                control->setProperty("kind", sourceControl.kind);
                control->setProperty("label", sourceControl.label);
                control->setProperty("x", sourceControl.x);
                control->setProperty("y", sourceControl.y);
                control->setProperty("width", sourceControl.width);
                control->setProperty("height", sourceControl.height);
                control->setProperty("minValue", sourceControl.minValue);
                control->setProperty("maxValue", sourceControl.maxValue);
                control->setProperty("value", sourceControl.value);

                juce::Array<juce::var> bindings;
                for (const auto& sourceBinding : sourceControl.bindings)
                {
                    juce::DynamicObject::Ptr binding = new juce::DynamicObject();
                    binding->setProperty("type", sourceBinding.type);
                    binding->setProperty("level", sourceBinding.level);
                    binding->setProperty("parameter", sourceBinding.parameter);
                    binding->setProperty("position", sourceBinding.position);
                    bindings.add(juce::var(binding.get()));
                }
                control->setProperty("bindings", bindings);
                uiControlDetails.add(juce::var(control.get()));
            }

            juce::Array<juce::var> dsEffects;
            for (const auto& sourceEffect : source.effects)
            {
                juce::DynamicObject::Ptr effect = new juce::DynamicObject();
                effect->setProperty("type", sourceEffect.type);
                effect->setProperty("position", sourceEffect.position);
                effect->setProperty("frequency", sourceEffect.frequency);
                effect->setProperty("resonance", sourceEffect.resonance);
                effect->setProperty("wetLevel", sourceEffect.wetLevel);
                effect->setProperty("roomSize", sourceEffect.roomSize);
                effect->setProperty("damping", sourceEffect.damping);
                dsEffects.add(juce::var(effect.get()));
            }

            juce::DynamicObject::Ptr preset = new juce::DynamicObject();
            preset->setProperty("name", source.name);
            preset->setProperty("path", source.path);
            preset->setProperty("pluginId", source.pluginId);
            preset->setProperty("uiImagePath", source.uiImagePath);
            if (source.uiImagePath.isNotEmpty())
            {
                const auto uiImageDataUrl = makeImageDataUrl(juce::File(source.uiImagePath));
                if (uiImageDataUrl.isNotEmpty())
                    preset->setProperty("uiImageDataUrl", uiImageDataUrl);
            }
            preset->setProperty("uiWidth", source.uiWidth);
            preset->setProperty("uiHeight", source.uiHeight);
            preset->setProperty("uiControls", source.uiControls);
            preset->setProperty("uiControlDetails", uiControlDetails);
            preset->setProperty("effects", dsEffects);
            preset->setProperty("sampleUrls", sampleUrlVars);
            preset->setProperty("samples", samples);
            preset->setProperty("audioFiles", audioFiles);
            return juce::var(preset.get());
        }

        void saveAudioFile(Database& database, const juce::var& audioFile)
        {
            if (!audioFile.isObject()) return;

            const auto bindOptionalDouble = [](Statement& stmt, int idx, const juce::var& value)
            {
                if (value.isVoid())
                {
                    stmt.bindNull(idx);
                    return;
                }

                const auto numericValue = static_cast<double>(value);
                if (std::isfinite(numericValue))
                    stmt.bind(idx, numericValue);
                else
                    stmt.bindNull(idx);
            };

            Statement stmt(database, R"sql(
                INSERT INTO audio_files(
                    id, name, path, duration_s, sample_rate, bit_depth, size_bytes, imported_at,
                    left_peak_dbfs, right_peak_dbfs, true_peak_dbtp, rms_dbfs, crest_factor_db,
                    dc_offset, clipping_count, clipping_ratio, stereo_correlation, integrated_lufs)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name = excluded.name,
                  path = excluded.path,
                  duration_s = excluded.duration_s,
                  sample_rate = excluded.sample_rate,
                  bit_depth = excluded.bit_depth,
                  size_bytes = excluded.size_bytes,
                  imported_at = excluded.imported_at,
                  left_peak_dbfs = excluded.left_peak_dbfs,
                  right_peak_dbfs = excluded.right_peak_dbfs,
                  true_peak_dbtp = excluded.true_peak_dbtp,
                  rms_dbfs = excluded.rms_dbfs,
                  crest_factor_db = excluded.crest_factor_db,
                  dc_offset = excluded.dc_offset,
                  clipping_count = excluded.clipping_count,
                  clipping_ratio = excluded.clipping_ratio,
                  stereo_correlation = excluded.stereo_correlation,
                  integrated_lufs = excluded.integrated_lufs
            )sql");
            stmt.bind(1, audioFile.getProperty("id", {}).toString());
            stmt.bind(2, audioFile.getProperty("name", {}).toString());
            stmt.bind(3, audioFile.getProperty("path", {}).toString());
            stmt.bind(4, (double) audioFile.getProperty("durationSeconds", 0.0));
            stmt.bind(5, (int) audioFile.getProperty("sampleRate", 0));
            stmt.bind(6, (int) audioFile.getProperty("bitDepth", 0));
            stmt.bind(7, (double) audioFile.getProperty("sizeBytes", 0.0));
            stmt.bind(8, (double) audioFile.getProperty("importedAt", 0.0));
            bindOptionalDouble(stmt, 9, audioFile.getProperty("leftPeakDbFS", {}));
            bindOptionalDouble(stmt, 10, audioFile.getProperty("rightPeakDbFS", {}));
            bindOptionalDouble(stmt, 11, audioFile.getProperty("truePeakDbTP", {}));
            bindOptionalDouble(stmt, 12, audioFile.getProperty("rmsDbFS", {}));
            bindOptionalDouble(stmt, 13, audioFile.getProperty("crestFactorDb", {}));
            bindOptionalDouble(stmt, 14, audioFile.getProperty("dcOffset", {}));
            stmt.bind(15, (int) audioFile.getProperty("clippingCount", 0));
            bindOptionalDouble(stmt, 16, audioFile.getProperty("clippingRatio", {}));
            bindOptionalDouble(stmt, 17, audioFile.getProperty("stereoCorrelation", {}));
            bindOptionalDouble(stmt, 18, audioFile.getProperty("integratedLufs", {}));
            stmt.step();
        }

        juce::var makeTrainingResponse(bool started, const juce::String& reason = {})
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            response->setProperty("started", started);
            if (reason.isNotEmpty())
                response->setProperty("reason", reason);
            return juce::var(response.get());
        }

        juce::var makeTrainingStatus(
            const juce::String& task,
            const juce::String& status,
            int signalCount,
            const juce::String& message = {},
            int exitCode = 0)
        {
            juce::DynamicObject::Ptr event = new juce::DynamicObject();
            event->setProperty("task", task);
            event->setProperty("status", status);
            event->setProperty("signalCount", signalCount);
            if (message.isNotEmpty())
                event->setProperty("message", message);
            event->setProperty("exitCode", exitCode);
            return juce::var(event.get());
        }

        juce::File findTrainingRootFrom(juce::File start)
        {
            if (start.existsAsFile())
                start = start.getParentDirectory();

            for (auto dir = start; dir.exists(); dir = dir.getParentDirectory())
            {
                if (dir.getChildFile("scripts/ai/train-beat-qwen.sh").existsAsFile()
                    && dir.getChildFile("training/beat-qwen").isDirectory())
                    return dir;

                const auto parent = dir.getParentDirectory();
                if (parent == dir)
                    break;
            }

            return {};
        }

        juce::File findTrainingRoot()
        {
            if (auto root = findTrainingRootFrom(juce::File::getCurrentWorkingDirectory()); root.exists())
                return root;

            if (auto root = findTrainingRootFrom(juce::File::getSpecialLocation(juce::File::currentExecutableFile)); root.exists())
                return root;

            if (auto root = findTrainingRootFrom(juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile("beat")); root.exists())
                return root;

            return {};
        }

        juce::String trainingScriptNameForTask(const juce::String& task)
        {
            if (task == "drums") return "train-beat-qwen.sh";
            if (task == "instruments") return "train-beat-instrument-qwen.sh";
            if (task == "midi") return "train-beat-midi-qwen.sh";
            return {};
        }

        juce::String datasetNameForTask(const juce::String& task)
        {
            if (task == "drums") return "beat-drum-finetune.jsonl";
            if (task == "instruments") return "beat-instrument-finetune.jsonl";
            if (task == "midi") return "beat-midi-song-finetune.jsonl";
            return {};
        }

        TrackKind parseTrackKind(const juce::var& value)
        {
            if (value.isString())
            {
                const auto kind = value.toString();
                if (kind == "midi") return TrackKind::Midi;
                if (kind == "mixed") return TrackKind::Mixed;
                if (kind == "group") return TrackKind::Group;
                return TrackKind::Audio;
            }
            return static_cast<TrackKind>((int) value);
        }

        SegmentPayloadKind parseSegmentKind(const juce::var& value)
        {
            if (value.isString())
            {
                const auto kind = value.toString();
                if (kind == "midi") return SegmentPayloadKind::Midi;
                if (kind == "drum") return SegmentPayloadKind::Drum;
                if (kind == "mixed") return SegmentPayloadKind::Mixed;
                return SegmentPayloadKind::Audio;
            }
            return static_cast<SegmentPayloadKind>((int) value);
        }

        TrackEffectKind parseTrackEffectKind(const juce::var& value)
        {
            if (value.isInt() || value.isInt64())
            {
                const auto kind = (TrackEffectKind) (int) value;
                switch (kind)
                {
                    case TrackEffectKind::Bitcrush:
                    case TrackEffectKind::Lowpass:
                    case TrackEffectKind::Highpass:
                    case TrackEffectKind::Saturator:
                    case TrackEffectKind::Reverb:
                    case TrackEffectKind::Delay:
                    case TrackEffectKind::Compressor:
                    case TrackEffectKind::Plugin:
                    case TrackEffectKind::Chorus:
                    case TrackEffectKind::Phaser:
                    case TrackEffectKind::Flanger:
                    case TrackEffectKind::Distortion:
                        return kind;
                    case TrackEffectKind::Unknown:
                    default:
                        return TrackEffectKind::Unknown;
                }
            }

            const auto kind = value.toString();
            if (kind == "bitcrush") return TrackEffectKind::Bitcrush;
            if (kind == "lowpass") return TrackEffectKind::Lowpass;
            if (kind == "highpass") return TrackEffectKind::Highpass;
            if (kind == "saturator") return TrackEffectKind::Saturator;
            if (kind == "distortion") return TrackEffectKind::Distortion;
            if (kind == "reverb") return TrackEffectKind::Reverb;
            if (kind == "delay") return TrackEffectKind::Delay;
            if (kind == "compressor") return TrackEffectKind::Compressor;
            if (kind == "chorus") return TrackEffectKind::Chorus;
            if (kind == "phaser") return TrackEffectKind::Phaser;
            if (kind == "flanger") return TrackEffectKind::Flanger;
            if (kind == "plugin") return TrackEffectKind::Plugin;
            return TrackEffectKind::Unknown;
        }

        AutomationCurve parseAutomationCurve(const juce::var& value)
        {
            if (value.isString())
            {
                const auto curve = value.toString().toLowerCase();
                if (curve == "hold") return AutomationCurve::Hold;
                if (curve == "quadratic") return AutomationCurve::Quadratic;
                if (curve == "cubic") return AutomationCurve::Cubic;
                if (curve == "easein" || curve == "ease-in") return AutomationCurve::EaseIn;
                if (curve == "easeout" || curve == "ease-out") return AutomationCurve::EaseOut;
                if (curve == "smoothstep" || curve == "smooth-step") return AutomationCurve::Smoothstep;
                return AutomationCurve::Linear;
            }
            const int curve = (int) value;
            if (curve == 0) return AutomationCurve::Hold;
            if (curve == 2) return AutomationCurve::Quadratic;
            if (curve == 3) return AutomationCurve::Cubic;
            if (curve == 4) return AutomationCurve::EaseIn;
            if (curve == 5) return AutomationCurve::EaseOut;
            if (curve == 6) return AutomationCurve::Smoothstep;
            return AutomationCurve::Linear;
        }

        int parseWaveform(const juce::var& value, const juce::String& kind)
        {
            juce::ignoreUnused(kind);
            if (value.isString())
            {
                const auto waveform = value.toString();
                if (waveform == "sine") return 0;
                if (waveform == "saw") return 1;
                if (waveform == "square") return 2;
                if (waveform == "triangle") return 3;
                if (waveform == "noise") return 4;
                if (waveform == "wavetable") return 5;
                return 1;
            }
            return juce::jlimit(0, 5, (int) value);
        }

        int parseWavetableBank(const juce::var& value)
        {
            if (value.isString())
            {
                const auto bank = value.toString();
                if (bank == "glass") return 1;
                if (bank == "vocal") return 2;
                if (bank == "organ") return 3;
                if (bank == "fm") return 4;
                return 0;
            }
            return juce::jlimit(0, 4, (int) value);
        }

        int parseWavetableWarpMode(const juce::var& value)
        {
            if (value.isString())
            {
                const auto mode = value.toString();
                if (mode == "fold") return 1;
                if (mode == "pinch") return 2;
                if (mode == "mirror") return 3;
                return 0;
            }
            return juce::jlimit(0, 3, (int) value);
        }

        int parseSubWaveform(const juce::var& value)
        {
            if (value.isString())
            {
                const auto waveform = value.toString();
                if (waveform == "square") return 2;
                if (waveform == "triangle") return 3;
                return 0;
            }
            return juce::jlimit(0, 3, (int) value);
        }

        float normalizedParam(const juce::var& object, const juce::Identifier& name, float fallback);
        float floatParam(const juce::var& object, const juce::Identifier& name, float fallback, float minValue, float maxValue);

        int parseEnvelopeCurve(const juce::var& value, int fallback)
        {
            if (value.isString())
            {
                const auto curve = value.toString();
                if (curve == "exp") return 1;
                if (curve == "log") return 2;
                if (curve == "s-curve") return 3;
                if (curve == "linear") return 0;
                return fallback;
            }
            return juce::jlimit(0, 3, (int) value);
        }

        InstrumentDefinition::WavetableConfig parseWavetableConfig(
            const juce::var& value,
            InstrumentDefinition::WavetableConfig fallback)
        {
            if (!value.isObject()) return fallback;
            fallback.bank = parseWavetableBank(value.getProperty("bank", fallback.bank));
            fallback.position = normalizedParam(value, "position", fallback.position);
            fallback.warp = normalizedParam(value, "warp", fallback.warp);
            fallback.warpMode = parseWavetableWarpMode(value.getProperty("warpMode", fallback.warpMode));
            fallback.smoothInterpolation = (bool) value.getProperty(
                "smoothInterpolation",
                value.getProperty("interpolation", fallback.smoothInterpolation ? "smooth" : "linear").toString() == "smooth");
            fallback.morph = normalizedParam(value, "morph", fallback.morph);
            fallback.unison = juce::jlimit(1, 8, (int) value.getProperty("unison", fallback.unison));
            fallback.detuneCents = floatParam(value, "detuneCents", fallback.detuneCents, 0.0f, 100.0f);
            fallback.blend = normalizedParam(value, "blend", fallback.blend);
            return fallback;
        }

        InstrumentDefinition::AetherOscillator parseAetherOscillator(
            const juce::var& value,
            InstrumentDefinition::AetherOscillator fallback)
        {
            if (!value.isObject()) return fallback;
            fallback.enabled = (bool) value.getProperty("enabled", fallback.enabled);
            fallback.level = normalizedParam(value, "level", fallback.level);
            fallback.pan = floatParam(value, "pan", fallback.pan, -1.0f, 1.0f);
            fallback.waveform = parseWaveform(value.getProperty("waveform", "wavetable"), juce::String());
            fallback.octave = juce::jlimit(-4, 4, (int) value.getProperty("octave", fallback.octave));
            fallback.semitone = juce::jlimit(-24, 24, (int) value.getProperty("semitone", fallback.semitone));
            fallback.fineCents = floatParam(value, "fineCents", fallback.fineCents, -100.0f, 100.0f);
            fallback.phase = normalizedParam(value, "phase", fallback.phase);
            fallback.randomPhase = normalizedParam(value, "randomPhase", fallback.randomPhase);
            fallback.fxSends[0] = normalizedParam(value, "fxSend1", fallback.fxSends[0]);
            fallback.fxSends[1] = normalizedParam(value, "fxSend2", fallback.fxSends[1]);
            fallback.wavetable = parseWavetableConfig(value.getProperty("wavetable", {}), fallback.wavetable);
            return fallback;
        }

        int parseSourceRoute(const juce::var& value)
        {
            if (value.isString())
            {
                const auto route = value.toString();
                if (route == "direct") return 1;
                if (route == "filter1") return 2;
                if (route == "filter2") return 3;
                return 0;
            }
            return juce::jlimit(0, 3, (int) value);
        }

        float normalizedParam(const juce::var& object, const juce::Identifier& name, float fallback)
        {
            if (!object.isObject()) return fallback;
            return juce::jlimit(0.0f, 1.0f, (float) (double) object.getProperty(name, fallback));
        }

        float floatParam(const juce::var& object, const juce::Identifier& name, float fallback, float minValue, float maxValue)
        {
            if (!object.isObject()) return fallback;
            return juce::jlimit(minValue, maxValue, (float) (double) object.getProperty(name, fallback));
        }

        int frequencyToMidi(double hz)
        {
            if (hz <= 0.0 || !std::isfinite(hz)) return 60;
            return juce::jlimit(0, 127, (int) std::round(69.0 + 12.0 * std::log2(hz / 440.0)));
        }

        double drumTimingOffsetBeats(int step, double stepLengthBeats, double swingPercent, double leanPercent)
        {
            const auto swing = juce::jlimit(0.0, 100.0, swingPercent);
            const auto lean = juce::jlimit(-50.0, 50.0, leanPercent);
            const auto swingOffset = (step % 2 == 1)
                ? ((swing - 50.0) / 50.0) * stepLengthBeats * 0.5
                : 0.0;
            return swingOffset + (lean / 100.0) * stepLengthBeats;
        }

        PluginCapability parsePluginCapability(const juce::var& capabilityVar)
        {
            PluginCapability capability;
            if (!capabilityVar.isObject()) return capability;

            capability.id = capabilityVar.getProperty("id", "").toString();
            capability.kind = capabilityVar.getProperty("kind", "").toString();
            capability.label = capabilityVar.getProperty("label", capabilityVar.getProperty("name", "")).toString();
            capability.realtime = (bool) capabilityVar.getProperty("realtime", false);
            capability.offline = (bool) capabilityVar.getProperty("offline", false);
            capability.latencySamples = juce::jlimit(0, 192000, (int) capabilityVar.getProperty("latencySamples", 0));
            capability.fallbackMode = capabilityVar.getProperty("fallbackMode", capabilityVar.getProperty("fallback", "")).toString();
            return capability;
        }

        PluginAdapterDefinition parsePluginAdapter(const juce::var& pluginVar)
        {
            PluginAdapterDefinition plugin;
            if (!pluginVar.isObject()) return plugin;

            plugin.id = pluginVar.getProperty("id", "").toString();
            plugin.name = pluginVar.getProperty("name", "").toString();
            plugin.vendor = pluginVar.getProperty("vendor", "").toString();
            plugin.version = pluginVar.getProperty("version", "").toString();
            plugin.kind = pluginVar.getProperty("kind", "").toString();
            plugin.format = pluginVar.getProperty("format", "").toString();
            plugin.status = pluginVar.getProperty("status", "").toString();
            plugin.instrumentMode = pluginVar.getProperty("instrumentMode", "").toString();
            plugin.description = pluginVar.getProperty("description", "").toString();
            plugin.sourceFileName = pluginVar.getProperty("sourceFileName", "").toString();
            plugin.sourcePath = pluginVar.getProperty("sourcePath", "").toString();
            plugin.uiImagePath = pluginVar.getProperty("uiImagePath", "").toString();
            plugin.uiImageDataUrl = pluginVar.getProperty("uiImageDataUrl", "").toString();
            plugin.uiWidth = (int) pluginVar.getProperty("uiWidth", 0);
            plugin.uiHeight = (int) pluginVar.getProperty("uiHeight", 0);
            plugin.uiControlDetails = pluginVar.getProperty("uiControlDetails", {});
            plugin.sampleCount = (int) pluginVar.getProperty("sampleCount", 0);
            plugin.uiControlCount = (int) pluginVar.getProperty("uiControlCount", 0);
            plugin.factory = (bool) pluginVar.getProperty("factory", false);
            plugin.installedAt = (double) pluginVar.getProperty("installedAt", 0.0);

            if (auto* capabilities = pluginVar.getProperty("capabilities", {}).getArray())
            {
                plugin.capabilities.reserve((size_t) capabilities->size());
                for (const auto& capabilityVar : *capabilities)
                {
                    auto capability = parsePluginCapability(capabilityVar);
                    if (capability.kind.isNotEmpty())
                        plugin.capabilities.push_back(std::move(capability));
                }
            }

            return plugin;
        }

        RecordingInputProfile parseRecordingInputProfile(const juce::var& inputVar)
        {
            RecordingInputProfile profile;
            if (!inputVar.isObject())
                return profile;

            profile.inputDeviceId = inputVar.getProperty("inputDeviceId", "").toString();
            profile.inputDeviceName = inputVar.getProperty("inputDeviceName", "").toString();
            profile.inputChannelStart = juce::jlimit(0, 1024, (int) inputVar.getProperty("inputChannelStart", 0));
            profile.inputChannelCount = juce::jlimit(1, 1024, (int) inputVar.getProperty("inputChannelCount", 2));
            profile.calibrationSampleRate = juce::jlimit(0.0, 768000.0, (double) inputVar.getProperty("calibrationSampleRate", 0.0));
            profile.measuredRoundTripSamples = juce::jlimit(0, 1920000, (int) inputVar.getProperty("measuredRoundTripSamples", 0));
            profile.reportedInputLatencySamples = juce::jlimit(0, 1920000, (int) inputVar.getProperty("reportedInputLatencySamples", 0));
            profile.reportedOutputLatencySamples = juce::jlimit(0, 1920000, (int) inputVar.getProperty("reportedOutputLatencySamples", 0));
            profile.userLatencyAdjustmentSamples = juce::jlimit(-1920000, 1920000, (int) inputVar.getProperty("userLatencyAdjustmentSamples", 0));
            return profile;
        }

        MasterChainSettings parseMasterChainSettings(const juce::var& masterVar)
        {
            MasterChainSettings settings;
            if (!masterVar.isObject())
                return settings;

            settings.inputGainDb = juce::jlimit(-48.0f, 24.0f, (float) (double) masterVar.getProperty("inputGainDb", 0.0));
            settings.compressorEnabled = (bool) masterVar.getProperty("compressorEnabled", false);
            settings.compressorThresholdDb = juce::jlimit(-60.0f, 0.0f, (float) (double) masterVar.getProperty("compressorThresholdDb", -18.0));
            settings.compressorRatio = juce::jlimit(1.0f, 40.0f, (float) (double) masterVar.getProperty("compressorRatio", 2.0));
            settings.compressorAttackMs = juce::jlimit(0.1f, 200.0f, (float) (double) masterVar.getProperty("compressorAttackMs", 20.0));
            settings.compressorReleaseMs = juce::jlimit(1.0f, 3000.0f, (float) (double) masterVar.getProperty("compressorReleaseMs", 160.0));
            settings.compressorMakeupDb = juce::jlimit(-24.0f, 24.0f, (float) (double) masterVar.getProperty("compressorMakeupDb", 0.0));
            settings.compressorMix = juce::jlimit(0.0f, 100.0f, (float) (double) masterVar.getProperty("compressorMix", 100.0));
            settings.outputGainDb = juce::jlimit(-48.0f, 24.0f, (float) (double) masterVar.getProperty("outputGainDb", 0.0));
            return settings;
        }

        TrackSend parseTrackSend(const juce::var& sendVar)
        {
            TrackSend send;
            if (!sendVar.isObject())
                return send;

            send.busId = sendVar.getProperty("busId", sendVar.getProperty("returnBusId", "")).toString();
            send.gainDb = juce::jlimit(-96.0f, 24.0f, (float) (double) sendVar.getProperty("gainDb", -96.0));
            send.pan = juce::jlimit(-1.0f, 1.0f, (float) (double) sendVar.getProperty("pan", 0.0));
            send.enabled = (bool) sendVar.getProperty("enabled", true);
            return send;
        }

        TrackEffect parseTrackEffect(const juce::var& effectVar)
        {
            TrackEffect effect;
            if (!effectVar.isObject())
                return effect;

            effect.id = effectVar.getProperty("id", "").toString();
            effect.kind = parseTrackEffectKind(effectVar.getProperty("kind", ""));
            effect.schemaVersion = juce::jlimit(0, kCurrentTrackEffectSchemaVersion, (int) effectVar.getProperty("schemaVersion", 0));
            effect.bypassed = (bool) effectVar.getProperty("bypassed", false);
            effect.pluginId = effectVar.getProperty("pluginId", "").toString();
            effect.pluginName = effectVar.getProperty("pluginName", effectVar.getProperty("name", "")).toString();
            effect.pluginFormat = effectVar.getProperty("pluginFormat", effectVar.getProperty("format", "")).toString();
            effect.latencySamples = juce::jlimit(0, 192000, (int) effectVar.getProperty("latencySamples", 0));

            if (auto* object = effectVar.getProperty("params", {}).getDynamicObject())
            {
                for (const auto& property : object->getProperties())
                {
                    if (!property.value.isDouble() && !property.value.isInt() && !property.value.isBool())
                        continue;
                    effect.params.push_back({
                        property.name.toString(),
                        juce::jlimit(-100000.0f, 100000.0f, (float) (double) property.value),
                    });
                }
            }

            if (auto* automation = effectVar.getProperty("automation", {}).getArray())
            {
                for (const auto& laneVar : *automation)
                {
                    if (!laneVar.isObject()) continue;
                    MidiAutomationLane lane;
                    lane.target = laneVar.getProperty("param", laneVar.getProperty("target", "")).toString();
                    if (lane.target.isEmpty()) continue;
                    if (auto* points = laneVar.getProperty("points", {}).getArray())
                    {
                        for (const auto& pointVar : *points)
                        {
                            if (!pointVar.isObject()) continue;
                            MidiAutomationPoint point;
                            point.beat = (double) pointVar.getProperty("beat", 0.0);
                            point.value = (float) (double) pointVar.getProperty("value", 0.0);
                            point.curve = parseAutomationCurve(pointVar.getProperty("curve", "linear"));
                            if (std::isfinite(point.beat) && std::isfinite(point.value))
                                lane.points.push_back(point);
                        }
                    }
                    if (!lane.points.empty())
                    {
                        std::sort(lane.points.begin(), lane.points.end(),
                                  [](const MidiAutomationPoint& a, const MidiAutomationPoint& b) {
                                      return a.beat < b.beat;
                                  });
                        effect.automation.push_back(std::move(lane));
                    }
                }
            }

            if (effect.kind != TrackEffectKind::Unknown)
                normalizeTrackEffect(effect);

            return effect;
        }

        Project parseProjectFromFrontend(const juce::var& projectVar,
                                         const juce::var& instrumentsVar,
                                         const juce::var& audioFilesVar)
        {
            Project p;
            if (!projectVar.isObject()) return p;

            p.id = projectVar.getProperty("id", "").toString();
            p.name = projectVar.getProperty("name", "Untitled").toString();
            p.bpm = (double) projectVar.getProperty("bpm", 120.0);
            p.lengthBeats = (double) projectVar.getProperty("lengthBeats", 64.0);

            const auto timeSignature = projectVar.getProperty("timeSignature", {});
            if (timeSignature.isObject())
            {
                p.timeSignatureNum = (int) timeSignature.getProperty("num", 4);
                p.timeSignatureDenom = (int) timeSignature.getProperty("denom", 4);
            }
            p.recordingInput = parseRecordingInputProfile(projectVar.getProperty("recordingInput", {}));
            p.masterChain = parseMasterChainSettings(projectVar.getProperty("masterChain", {}));

            if (auto* audioFiles = audioFilesVar.getArray())
            {
                p.audioFiles.reserve((size_t) audioFiles->size());
                for (const auto& audioFileVar : *audioFiles)
                {
                    if (!audioFileVar.isObject()) continue;
                    AudioFileAsset audioFile;
                    audioFile.id = audioFileVar.getProperty("id", "").toString();
                    audioFile.name = audioFileVar.getProperty("name", "").toString();
                    audioFile.path = audioFileVar.getProperty("path", "").toString();
                    audioFile.durationSeconds = (double) audioFileVar.getProperty("durationSeconds", 0.0);
                    audioFile.sampleRate = (double) audioFileVar.getProperty("sampleRate", 0.0);
                    if (audioFile.id.isNotEmpty() && audioFile.path.isNotEmpty())
                        p.audioFiles.push_back(std::move(audioFile));
                }
            }

            if (auto* plugins = projectVar.getProperty("plugins", {}).getArray())
            {
                p.plugins.reserve((size_t) plugins->size());
                for (const auto& pluginVar : *plugins)
                {
                    auto plugin = parsePluginAdapter(pluginVar);
                    if (plugin.id.isNotEmpty())
                        p.plugins.push_back(std::move(plugin));
                }
            }

            if (auto* tracks = projectVar.getProperty("tracks", {}).getArray())
            {
                for (const auto& trackVar : *tracks)
                {
                    if (!trackVar.isObject()) continue;
                    Track t;
                    t.id = trackVar.getProperty("id", "").toString();
                    t.name = trackVar.getProperty("name", "").toString();
                    t.kind = parseTrackKind(trackVar.getProperty("kind", "audio"));
                    t.instrumentId = trackVar.getProperty("instrumentId", "").toString();
                    t.audioFileId = trackVar.getProperty("audioFileId", "").toString();
                    t.parentTrackId = trackVar.getProperty("parentTrackId", "").toString();
                    t.gainDb = (float) (double) trackVar.getProperty("gainDb", 0.0);
                    t.pan = (float) (double) trackVar.getProperty("pan", 0.0);
                    t.mute = (bool) trackVar.getProperty("mute", false);
                    t.solo = (bool) trackVar.getProperty("solo", false);
                    t.recordArmed = (bool) trackVar.getProperty("recordArmed", false);
                    t.inputMonitoring = (bool) trackVar.getProperty("inputMonitoring", false);
                    t.inputDeviceId = trackVar.getProperty("inputDeviceId", "").toString();
                    t.inputChannelStart = juce::jlimit(0, 1024, (int) trackVar.getProperty("inputChannelStart", 0));
                    t.inputChannelCount = juce::jlimit(1, 1024, (int) trackVar.getProperty("inputChannelCount", 1));
                    t.recordGainDb = (float) (double) trackVar.getProperty("recordGainDb", 0.0);

                    if (auto* automation = trackVar.getProperty("automation", {}).getArray())
                    {
                        for (const auto& laneVar : *automation)
                        {
                            if (!laneVar.isObject()) continue;
                            ProjectAutomationLane lane;
                            lane.trackId = t.id;
                            lane.instrumentId = t.instrumentId;
                            lane.target = laneVar.getProperty("target", "").toString();
                            if (lane.target.isEmpty() || lane.target == "pitch") continue;

                            if (auto* points = laneVar.getProperty("points", {}).getArray())
                            {
                                lane.points.reserve((size_t) points->size());
                                for (const auto& pointVar : *points)
                                {
                                    if (!pointVar.isObject()) continue;
                                    MidiAutomationPoint point;
                                    point.beat = (double) pointVar.getProperty("beat", 0.0);
                                    point.value = (float) (double) pointVar.getProperty("value", 0.0);
                                    point.curve = parseAutomationCurve(pointVar.getProperty("curve", "linear"));
                                    if (std::isfinite(point.beat) && std::isfinite(point.value))
                                        lane.points.push_back(point);
                                }
                            }

                            if (!lane.points.empty())
                            {
                                std::sort(lane.points.begin(), lane.points.end(),
                                          [](const MidiAutomationPoint& a, const MidiAutomationPoint& b) {
                                              return a.beat < b.beat;
                                          });
                                p.automation.push_back(std::move(lane));
                            }
                        }
                    }

                    if (auto* sends = trackVar.getProperty("sends", {}).getArray())
                    {
                        for (const auto& sendVar : *sends)
                        {
                            auto send = parseTrackSend(sendVar);
                            if (send.busId.isNotEmpty())
                                t.sends.push_back(send);
                        }
                    }

                    const auto effects = trackVar.getProperty("effects", {});
                    if (auto* filters = effects.getProperty("filters", {}).getArray())
                    {
                        t.effects.reserve((size_t) filters->size());
                        for (const auto& effectVar : *filters)
                        {
                            auto effect = parseTrackEffect(effectVar);

                            if (effect.kind != TrackEffectKind::Unknown)
                                t.effects.push_back(std::move(effect));
                        }
                    }

                    if (auto* segments = trackVar.getProperty("segments", {}).getArray())
                    {
                        for (const auto& segmentVar : *segments)
                        {
                            if (!segmentVar.isObject()) continue;
                            Segment s;
                            s.id = segmentVar.getProperty("id", "").toString();
                            s.trackId = t.id;
                            s.startBeat = (double) segmentVar.getProperty("startBeat", 0.0);
                            s.lengthBeats = (double) segmentVar.getProperty("lengthBeats", 4.0);
                            s.sourceStartBeat = (double) segmentVar.getProperty("sourceStartBeat", 0.0);
                            s.fadeInBeats = (double) segmentVar.getProperty("fadeInBeats", 0.0);
                            s.fadeOutBeats = (double) segmentVar.getProperty("fadeOutBeats", 0.0);
                            s.repeats = (int) segmentVar.getProperty("repeats", 0);
                            s.layer = (int) segmentVar.getProperty("layer", 0);
                            s.muted = (bool) segmentVar.getProperty("muted", false);
                            s.instrumentId = segmentVar.getProperty("instrumentId", t.instrumentId).toString();

                            const auto payload = segmentVar.getProperty("payload", {});
                            if (payload.isObject())
                            {
                                s.kind = parseSegmentKind(payload.getProperty("kind", "midi"));
                                s.audioFileId = payload.getProperty("audioFileId", "").toString();
                                s.audioGainDb = (float) (double) payload.getProperty("gainDb", 0.0);
                                if (s.kind == SegmentPayloadKind::Drum)
                                {
                                    const int stepCount = juce::jmax(1, (int) payload.getProperty("stepCount", 16));
                                    const double speed = juce::jmax(0.1, (double) payload.getProperty("speed", 4.0));
                                    const double effectiveLengthBeats = s.lengthBeats / speed;
                                    const double stepLengthBeats = effectiveLengthBeats / (double) stepCount;
                                    const double swingPercent = (double) payload.getProperty("swingPercent", 50.0);
                                    const auto defaultPitchHz = (double) payload.getProperty("defaultPitchHz", 0.0);

                                    if (auto* rows = payload.getProperty("rows", {}).getArray())
                                    {
                                        for (const auto& rowVar : *rows)
                                        {
                                            if (!rowVar.isObject()) continue;
                                            const auto rowInstrumentId = rowVar.getProperty("instrumentId", s.instrumentId).toString();
                                            if (auto* steps = rowVar.getProperty("steps", {}).getArray())
                                            {
                                                for (int step = 0; step < juce::jmin(stepCount, steps->size()); ++step)
                                                {
                                                    const auto& stepVar = steps->getReference(step);
                                                    bool on = false;
                                                    int velocity = 110;
                                                    double leanPercent = 0.0;
                                                    double pitchHz = defaultPitchHz;

                                                    if (stepVar.isObject())
                                                    {
                                                        on = (bool) stepVar.getProperty("on", false);
                                                        velocity = juce::jlimit(0, 127, (int) stepVar.getProperty("velocity", velocity));
                                                        leanPercent = (double) stepVar.getProperty("leanPercent", 0.0);
                                                        pitchHz = (double) stepVar.getProperty("pitchHz", pitchHz);
                                                    }
                                                    else
                                                    {
                                                        on = (bool) stepVar;
                                                    }

                                                    if (!on) continue;

                                                    MidiNote n;
                                                    n.instrumentId = rowInstrumentId;
                                                    n.pitch = frequencyToMidi(pitchHz > 0.0 ? pitchHz : 261.625565);
                                                    n.velocity = velocity;
                                                    n.startBeat = juce::jmax(0.0, step * stepLengthBeats + drumTimingOffsetBeats(step, stepLengthBeats, swingPercent, leanPercent));
                                                    n.lengthBeats = juce::jlimit(0.02, 0.25, stepLengthBeats);
                                                    s.notes.push_back(n);
                                                }
                                            }
                                        }
                                    }
                                }
                                else if (auto* notes = payload.getProperty("notes", {}).getArray())
                                {
                                    const int transpose = (int) segmentVar.getProperty("transpose", 0);
                                    for (const auto& noteVar : *notes)
                                    {
                                        if (!noteVar.isObject()) continue;
                                        MidiNote n;
                                        n.instrumentId = s.instrumentId.isNotEmpty() ? s.instrumentId : t.instrumentId;
                                        n.pitch = juce::jlimit(0, 127, (int) noteVar.getProperty("pitch", 60) + transpose);
                                        n.velocity = juce::jlimit(0, 127, (int) noteVar.getProperty("velocity", 100));
                                        n.startBeat = (double) noteVar.getProperty("startBeat", 0.0);
                                        n.lengthBeats = (double) noteVar.getProperty("lengthBeats", 0.25);
                                        n.connectToIndex = juce::jmax(-1, (int) noteVar.getProperty("connectToIndex", -1));
                                        if (auto* curve = noteVar.getProperty("curve", {}).getArray())
                                        {
                                            n.curve.reserve((size_t) curve->size());
                                            for (const auto& pointVar : *curve)
                                            {
                                                if (!pointVar.isObject()) continue;
                                                MidiPitchCurvePoint point;
                                                point.beat = (double) pointVar.getProperty("beat", n.startBeat);
                                                point.pitch = juce::jlimit(0.0, 127.0, (double) pointVar.getProperty("pitch", (double) n.pitch) + (double) transpose);
                                                if (std::isfinite(point.beat) && std::isfinite(point.pitch))
                                                    n.curve.push_back(point);
                                            }
                                            std::sort(n.curve.begin(), n.curve.end(),
                                                      [](const MidiPitchCurvePoint& a, const MidiPitchCurvePoint& b) {
                                                          return a.beat < b.beat;
                                                      });
                                        }
                                        if (auto* automation = noteVar.getProperty("automation", {}).getArray())
                                        {
                                            for (const auto& laneVar : *automation)
                                            {
                                                if (!laneVar.isObject()) continue;
                                                MidiAutomationLane lane;
                                                lane.target = laneVar.getProperty("target", "").toString();
                                                if (lane.target.isEmpty() || lane.target == "pitch") continue;

                                                if (auto* points = laneVar.getProperty("points", {}).getArray())
                                                {
                                                    lane.points.reserve((size_t) points->size());
                                                    for (const auto& pointVar : *points)
                                                    {
                                                        if (!pointVar.isObject()) continue;
                                                MidiAutomationPoint point;
                                                point.beat = (double) pointVar.getProperty("beat", n.startBeat);
                                                point.value = (float) (double) pointVar.getProperty("value", 0.0);
                                                point.curve = parseAutomationCurve(pointVar.getProperty("curve", "linear"));
                                                if (std::isfinite(point.beat) && std::isfinite(point.value))
                                                    lane.points.push_back(point);
                                                    }
                                                }

                                                if (!lane.points.empty())
                                                {
                                                    std::sort(lane.points.begin(), lane.points.end(),
                                                              [](const MidiAutomationPoint& a, const MidiAutomationPoint& b) {
                                                                  return a.beat < b.beat;
                                                              });
                                                    n.automation.push_back(std::move(lane));
                                                }
                                            }
                                        }
                                        s.notes.push_back(n);
                                    }
                                }

                                const auto segmentAutomationSource = payload.getProperty("automation", segmentVar.getProperty("automation", {}));
                                if (auto* automation = segmentAutomationSource.getArray())
                                {
                                    for (const auto& laneVar : *automation)
                                    {
                                        if (!laneVar.isObject()) continue;
                                        MidiAutomationLane lane;
                                        lane.target = laneVar.getProperty("target", "").toString();
                                        if (lane.target.isEmpty() || lane.target == "pitch") continue;

                                        if (auto* points = laneVar.getProperty("points", {}).getArray())
                                        {
                                            lane.points.reserve((size_t) points->size());
                                            for (const auto& pointVar : *points)
                                            {
                                                if (!pointVar.isObject()) continue;
                                                MidiAutomationPoint point;
                                                point.beat = (double) pointVar.getProperty("beat", 0.0);
                                                point.value = (float) (double) pointVar.getProperty("value", 0.0);
                                                point.curve = parseAutomationCurve(pointVar.getProperty("curve", "linear"));
                                                if (std::isfinite(point.beat) && std::isfinite(point.value))
                                                    lane.points.push_back(point);
                                            }
                                        }

                                        if (!lane.points.empty())
                                        {
                                            std::sort(lane.points.begin(), lane.points.end(),
                                                      [](const MidiAutomationPoint& a, const MidiAutomationPoint& b) {
                                                          return a.beat < b.beat;
                                                      });
                                            s.automation.push_back(std::move(lane));
                                        }
                                    }
                                }
                            }
                            else
                            {
                                s.kind = parseSegmentKind(segmentVar.getProperty("kind", 1));
                            }

                            t.segments.push_back(std::move(s));
                        }
                    }
                    p.tracks.push_back(std::move(t));
                }
            }

            if (auto* buses = projectVar.getProperty("returnBuses", {}).getArray())
            {
                for (const auto& busVar : *buses)
                {
                    if (!busVar.isObject()) continue;
                    ReturnBus bus;
                    bus.id = busVar.getProperty("id", "").toString();
                    bus.name = busVar.getProperty("name", "").toString();
                    bus.gainDb = juce::jlimit(-96.0f, 24.0f, (float) (double) busVar.getProperty("gainDb", 0.0));
                    bus.pan = juce::jlimit(-1.0f, 1.0f, (float) (double) busVar.getProperty("pan", 0.0));
                    bus.mute = (bool) busVar.getProperty("mute", false);
                    if (auto* filters = busVar.getProperty("effects", {}).getProperty("filters", {}).getArray())
                    {
                        for (const auto& effectVar : *filters)
                        {
                            auto effect = parseTrackEffect(effectVar);
                            if (effect.kind != TrackEffectKind::Unknown)
                                bus.effects.push_back(std::move(effect));
                        }
                    }
                    if (bus.id.isNotEmpty())
                        p.returnBuses.push_back(std::move(bus));
                }
            }

            if (auto* instruments = instrumentsVar.getArray())
            {
                for (const auto& instrumentVar : *instruments)
                {
                    if (!instrumentVar.isObject()) continue;
                    InstrumentDefinition instrument;
                    instrument.id = instrumentVar.getProperty("id", "").toString();
                    instrument.kind = instrumentVar.getProperty("kind", "").toString();
                    if (instrument.id.isEmpty()) continue;

                    instrument.waveform = parseWaveform(instrumentVar.getProperty("waveform", "saw"), instrument.kind);

                    const auto knobs = instrumentVar.getProperty("knobs", {});
                    instrument.cutoff01 = normalizedParam(knobs, "cutoff", instrument.cutoff01);
                    instrument.filterKeytrack = normalizedParam(instrumentVar, "filterKeytrack", instrument.filterKeytrack);
                    instrument.resonance01 = normalizedParam(knobs, "resonance", instrument.resonance01);
                    instrument.drive01 = normalizedParam(knobs, "drive", instrument.drive01);
                    instrument.color01 = normalizedParam(knobs, "color", instrument.color01);
                    instrument.filterType = parseSynthFilterType(instrumentVar.getProperty("filterType", "lowpass"));

                    const auto envelope = instrumentVar.getProperty("envelope", {});
                    instrument.attackMs = floatParam(envelope, "attack", instrument.attackMs, 0.0f, 10000.0f);
                    instrument.attackCurve = parseEnvelopeCurve(envelope.getProperty("attackCurve", instrument.attackCurve), instrument.attackCurve);
                    instrument.decayMs = floatParam(envelope, "decay", instrument.decayMs, 0.0f, 10000.0f);
                    instrument.decayCurve = parseEnvelopeCurve(envelope.getProperty("decayCurve", instrument.decayCurve), instrument.decayCurve);
                    instrument.sustain = normalizedParam(envelope, "sustain", instrument.sustain);
                    instrument.releaseMs = floatParam(envelope, "release", instrument.releaseMs, 0.0f, 10000.0f);
                    instrument.releaseCurve = parseEnvelopeCurve(envelope.getProperty("releaseCurve", instrument.releaseCurve), instrument.releaseCurve);
                    instrument.env1Loop = (bool) envelope.getProperty("loop", instrument.env1Loop);

                    const auto wavetable = instrumentVar.getProperty("wavetable", {});
                    if (wavetable.isObject())
                    {
                        instrument.wavetableBank = parseWavetableBank(wavetable.getProperty("bank", "aether"));
                        instrument.wavetablePosition = normalizedParam(wavetable, "position", instrument.wavetablePosition);
                        instrument.wavetableWarp = normalizedParam(wavetable, "warp", instrument.wavetableWarp);
                        instrument.wavetableWarpMode = parseWavetableWarpMode(wavetable.getProperty("warpMode", instrument.wavetableWarpMode));
                        instrument.wavetableUnison = juce::jlimit(1, 8, (int) wavetable.getProperty("unison", instrument.wavetableUnison));
                        instrument.wavetableDetuneCents = floatParam(wavetable, "detuneCents", instrument.wavetableDetuneCents, 0.0f, 100.0f);
                        instrument.wavetableBlend = normalizedParam(wavetable, "blend", instrument.wavetableBlend);
                    }
                    instrument.lfoWaveform = parseSynthLfoWaveform(instrumentVar.getProperty("lfoWaveform", "sine"));
                    instrument.lfoRateHz = floatParam(instrumentVar, "lfoRateHz", instrument.lfoRateHz, 0.01f, 40.0f);
                    instrument.lfoDepth = normalizedParam(instrumentVar, "lfoDepth", instrument.lfoDepth);
                    instrument.lfoSync = (bool) instrumentVar.getProperty("lfoSync", instrument.lfoSync);
                    instrument.lfoSyncedRate = instrumentVar.getProperty("lfoSyncedRate", instrument.lfoSyncedRate).toString();
                    instrument.lfoSmoothing = normalizedParam(instrumentVar, "lfoSmoothing", instrument.lfoSmoothing);
                    instrument.lfoRandomPhase = normalizedParam(instrumentVar, "lfoRandomPhase", instrument.lfoRandomPhase);
                    instrument.lfoPhaseOffset = normalizedParam(instrumentVar, "lfoPhase", instrument.lfoPhaseOffset);
                    instrument.lfoRetrigger = (bool) instrumentVar.getProperty("lfoRetrigger", instrument.lfoRetrigger);
                    instrument.lfoOneShot = (bool) instrumentVar.getProperty("lfoOneShot", instrument.lfoOneShot);
                    instrument.lfo2Enabled = (bool) instrumentVar.getProperty("lfo2Enabled", instrument.lfo2Enabled);
                    instrument.lfo2Waveform = parseSynthLfoWaveform(instrumentVar.getProperty("lfo2Waveform", "triangle"));
                    instrument.lfo2RateHz = floatParam(instrumentVar, "lfo2RateHz", instrument.lfo2RateHz, 0.01f, 40.0f);
                    instrument.lfo2Sync = (bool) instrumentVar.getProperty("lfo2Sync", instrument.lfo2Sync);
                    instrument.lfo2SyncedRate = instrumentVar.getProperty("lfo2SyncedRate", instrument.lfo2SyncedRate).toString();
                    instrument.lfo2Smoothing = normalizedParam(instrumentVar, "lfo2Smoothing", instrument.lfo2Smoothing);
                    instrument.lfo2RandomPhase = normalizedParam(instrumentVar, "lfo2RandomPhase", instrument.lfo2RandomPhase);
                    instrument.lfo2PhaseOffset = normalizedParam(instrumentVar, "lfo2Phase", instrument.lfo2PhaseOffset);
                    instrument.lfo2Retrigger = (bool) instrumentVar.getProperty("lfo2Retrigger", instrument.lfo2Retrigger);
                    instrument.lfo2OneShot = (bool) instrumentVar.getProperty("lfo2OneShot", instrument.lfo2OneShot);
                    instrument.lfoPositionBipolar = (bool) instrumentVar.getProperty("lfoPositionBipolar", instrument.lfoPositionBipolar);
                    instrument.lfoPitchBipolar = (bool) instrumentVar.getProperty("lfoPitchBipolar", instrument.lfoPitchBipolar);
                    instrument.lfoFilterBipolar = (bool) instrumentVar.getProperty("lfoFilterBipolar", instrument.lfoFilterBipolar);
                    instrument.lfoToPitch = floatParam(instrumentVar, "lfoToPitch", instrument.lfoToPitch, 0.0f, 24.0f);
                    instrument.lfoToFilter = floatParam(instrumentVar, "lfoToFilter", instrument.lfoToFilter, -1.0f, 1.0f);
                    instrument.envToFilter = floatParam(instrumentVar, "envToFilter", instrument.envToFilter, -1.0f, 1.0f);
                    instrument.ampLevel = floatParam(instrumentVar, "ampLevel", instrument.ampLevel, 0.0f, 1.0f);
                    instrument.ampPan = floatParam(instrumentVar, "ampPan", instrument.ampPan, -1.0f, 1.0f);
                    instrument.glideMs = floatParam(instrumentVar, "glideMs", instrument.glideMs, 0.0f, 5000.0f);
                    instrument.maxVoices = juce::jlimit(1, 32, (int) instrumentVar.getProperty("maxVoices", instrument.maxVoices));
                    instrument.mono = (bool) instrumentVar.getProperty("mono", instrument.mono);
                    instrument.legato = (bool) instrumentVar.getProperty("legato", instrument.legato);
                    instrument.taxonomy = instrumentVar.getProperty("taxonomy", {});

                    if (auto* filters = instrumentVar.getProperty("effects", {}).getProperty("filters", {}).getArray())
                    {
                        instrument.effects.reserve((size_t) filters->size());
                        for (const auto& effectVar : *filters)
                        {
                            auto effect = parseTrackEffect(effectVar);
                            if (effect.kind != TrackEffectKind::Unknown)
                                instrument.effects.push_back(std::move(effect));
                        }
                    }

                    InstrumentDefinition::WavetableConfig globalWavetable;
                    globalWavetable.bank = instrument.wavetableBank;
                    globalWavetable.position = instrument.wavetablePosition;
                    globalWavetable.warp = instrument.wavetableWarp;
                    globalWavetable.warpMode = instrument.wavetableWarpMode;
                    globalWavetable.unison = instrument.wavetableUnison;
                    globalWavetable.detuneCents = instrument.wavetableDetuneCents;
                    globalWavetable.blend = instrument.wavetableBlend;

                    const auto aether = instrumentVar.getProperty("aether", {});
                    if (aether.isObject())
                    {
                        instrument.hasAether = true;

                        InstrumentDefinition::AetherOscillator oscA;
                        oscA.enabled = true;
                        oscA.level = 0.78f;
                        oscA.wavetable = globalWavetable;
                        instrument.aether.oscA = parseAetherOscillator(aether.getProperty("oscA", {}), oscA);

                        InstrumentDefinition::AetherOscillator oscB;
                        oscB.enabled = false;
                        oscB.level = 0.42f;
                        oscB.semitone = 7;
                        oscB.fineCents = -4.0f;
                        oscB.wavetable = globalWavetable;
                        oscB.wavetable.bank = 1;
                        oscB.wavetable.position = 0.25f;
                        oscB.wavetable.warp = 0.16f;
                        oscB.wavetable.detuneCents = 8.0f;
                        oscB.wavetable.blend = 0.35f;
                        instrument.aether.oscB = parseAetherOscillator(aether.getProperty("oscB", {}), oscB);

                        const auto sub = aether.getProperty("sub", {});
                        instrument.aether.sub.enabled = sub.isObject() ? (bool) sub.getProperty("enabled", true) : true;
                        instrument.aether.sub.level = normalizedParam(sub, "level", 0.18f);
                        instrument.aether.sub.octave = juce::jlimit(-4, 0, (int) sub.getProperty("octave", -1));
                        instrument.aether.sub.waveform = parseSubWaveform(sub.getProperty("waveform", "sine"));
                        instrument.aether.sub.fxSends[0] = normalizedParam(sub, "fxSend1", 0.0f);
                        instrument.aether.sub.fxSends[1] = normalizedParam(sub, "fxSend2", 0.0f);

                        const auto noise = aether.getProperty("noise", {});
                        instrument.aether.noise.enabled = noise.isObject() ? (bool) noise.getProperty("enabled", false) : false;
                        instrument.aether.noise.level = normalizedParam(noise, "level", 0.08f);
                        instrument.aether.noise.color = normalizedParam(noise, "color", 0.45f);
                        instrument.aether.noise.fxSends[0] = normalizedParam(noise, "fxSend1", 0.0f);
                        instrument.aether.noise.fxSends[1] = normalizedParam(noise, "fxSend2", 0.0f);
                        const auto sampleSlot1 = aether.getProperty("sampleSlot1", {});
                        if (sampleSlot1.isObject())
                        {
                            const int slotSchemaVersion = juce::jmax(0, (int) sampleSlot1.getProperty("schemaVersion", 0));
                            instrument.aether.sampleSlot1.schemaVersion = 5;
                            const bool requestedSlotEnabled = (bool) sampleSlot1.getProperty("enabled", false);
                            instrument.aether.sampleSlot1.enabled = requestedSlotEnabled;
                            instrument.aether.sampleSlot1.audioFileId = sampleSlot1.getProperty("audioFileId", "").toString();
                            instrument.aether.sampleSlot1.rootNote = juce::jlimit(0, 127, (int) sampleSlot1.getProperty("rootNote", 60));
                            instrument.aether.sampleSlot1.level = normalizedParam(sampleSlot1, "level", 0.8f);
                            instrument.aether.sampleSlot1.pan = floatParam(sampleSlot1, "pan", 0.0f, -1.0f, 1.0f);
                            instrument.aether.sampleSlot1.routing = parseSourceRoute(sampleSlot1.getProperty("route", "filter"));
                            instrument.aether.sampleSlot1.startRatio = normalizedParam(sampleSlot1, "startRatio", 0.0f);
                            instrument.aether.sampleSlot1.endRatio = normalizedParam(sampleSlot1, "endRatio", 1.0f);
                            instrument.aether.sampleSlot1.loopEnabled = (bool) sampleSlot1.getProperty("loopEnabled", false);
                            instrument.aether.sampleSlot1.loopStartRatio = normalizedParam(sampleSlot1, "loopStartRatio", 0.0f);
                            instrument.aether.sampleSlot1.loopEndRatio = normalizedParam(sampleSlot1, "loopEndRatio", 1.0f);
                            if (const auto* sampleFxSends = sampleSlot1.getProperty("fxSends", {}).getArray())
                            {
                                if (!sampleFxSends->isEmpty())
                                    instrument.aether.sampleSlot1.fxSends[0] = juce::jlimit(0.0f, 1.0f, (float) (double) sampleFxSends->getReference(0));
                                if (sampleFxSends->size() > 1)
                                    instrument.aether.sampleSlot1.fxSends[1] = juce::jlimit(0.0f, 1.0f, (float) (double) sampleFxSends->getReference(1));
                            }
                            else
                            {
                                instrument.aether.sampleSlot1.fxSends[0] = normalizedParam(sampleSlot1, "fxSend1", 0.0f);
                                instrument.aether.sampleSlot1.fxSends[1] = normalizedParam(sampleSlot1, "fxSend2", 0.0f);
                            }
                            if (instrument.aether.sampleSlot1.endRatio <= instrument.aether.sampleSlot1.startRatio)
                            {
                                instrument.aether.sampleSlot1.startRatio = 0.0f;
                                instrument.aether.sampleSlot1.endRatio = 1.0f;
                            }
                            if (instrument.aether.sampleSlot1.loopStartRatio < instrument.aether.sampleSlot1.startRatio
                                || instrument.aether.sampleSlot1.loopEndRatio > instrument.aether.sampleSlot1.endRatio
                                || instrument.aether.sampleSlot1.loopEndRatio <= instrument.aether.sampleSlot1.loopStartRatio)
                                instrument.aether.sampleSlot1.loopEnabled = false;
                            if (const auto* mappedZones = sampleSlot1.getProperty("zones", {}).getArray())
                            {
                                for (int index = 0; index < juce::jmin(8, mappedZones->size()); ++index)
                                {
                                    const auto& mapped = mappedZones->getReference(index);
                                    if (!mapped.isObject()) continue;
                                    InstrumentDefinition::AetherSampleSlot::Zone zone;
                                    zone.audioFileId = mapped.getProperty("audioFileId", "").toString();
                                    zone.rootNote = juce::jlimit(0, 127, (int) mapped.getProperty("rootNote", 60));
                                    zone.loNote = juce::jlimit(0, 127, (int) mapped.getProperty("loNote", 0));
                                    zone.hiNote = juce::jlimit(zone.loNote, 127, (int) mapped.getProperty("hiNote", 127));
                                    zone.loVelocity = juce::jlimit(0, 127, (int) mapped.getProperty("loVelocity", 0));
                                    zone.hiVelocity = juce::jlimit(zone.loVelocity, 127, (int) mapped.getProperty("hiVelocity", 127));
                                    zone.level = normalizedParam(mapped, "level", 0.8f);
                                    zone.pan = floatParam(mapped, "pan", 0.0f, -1.0f, 1.0f);
                                    zone.startRatio = normalizedParam(mapped, "startRatio", 0.0f);
                                    zone.endRatio = normalizedParam(mapped, "endRatio", 1.0f);
                                    zone.loopEnabled = (bool) mapped.getProperty("loopEnabled", false);
                                    zone.loopStartRatio = normalizedParam(mapped, "loopStartRatio", zone.startRatio);
                                    zone.loopEndRatio = normalizedParam(mapped, "loopEndRatio", zone.endRatio);
                                    if (zone.audioFileId.isNotEmpty()) instrument.aether.sampleSlot1.zones.push_back(std::move(zone));
                                }
                            }
                            const auto managedSfz = sampleSlot1.getProperty("managedSfz", {});
                            if (managedSfz.isObject()
                                && (int) managedSfz.getProperty("schemaVersion", 0) <= 1)
                            {
                                instrument.aether.sampleSlot1.managedSfz.assetId = managedSfz.getProperty("assetId", {}).toString();
                                instrument.aether.sampleSlot1.managedSfz.displayName = managedSfz.getProperty("displayName", {}).toString();
                                instrument.aether.sampleSlot1.managedSfz.manifestPath = managedSfz.getProperty("manifestPath", {}).toString();
                                instrument.aether.sampleSlot1.managedSfz.sourcePath = managedSfz.getProperty("sourcePath", {}).toString();
                                if (const auto* paths = managedSfz.getProperty("samplePaths", {}).getArray())
                                    for (const auto& path : *paths)
                                        if (path.toString().isNotEmpty())
                                            instrument.aether.sampleSlot1.managedSfz.samplePaths.push_back(path.toString());
                            }
                            instrument.aether.sampleSlot1.enabled = requestedSlotEnabled
                                && slotSchemaVersion <= 5
                                && (instrument.aether.sampleSlot1.audioFileId.isNotEmpty()
                                    || !instrument.aether.sampleSlot1.zones.empty()
                                    || instrument.aether.sampleSlot1.managedSfz.manifestPath.isNotEmpty());
                        }
                        const auto granularSlot2 = aether.getProperty("granularSlot2", {});
                        if (granularSlot2.isObject())
                        {
                            const int slotSchemaVersion = juce::jmax(0, (int) granularSlot2.getProperty("schemaVersion", 0));
                            auto& slot = instrument.aether.granularSlot2;
                            slot.schemaVersion = 1;
                            const bool requestedEnabled = (bool) granularSlot2.getProperty("enabled", false);
                            slot.builtinSource = granularSlot2.getProperty("builtinSource", {}).toString();
                            if (slot.builtinSource != "benchmark") slot.builtinSource.clear();
                            slot.rootNote = juce::jlimit(0, 127, (int) granularSlot2.getProperty("rootNote", 60));
                            slot.level = normalizedParam(granularSlot2, "level", 0.7f);
                            slot.routing = parseSourceRoute(granularSlot2.getProperty("route", "filter"));
                            slot.position = normalizedParam(granularSlot2, "position", 0.5f);
                            slot.positionSpread = normalizedParam(granularSlot2, "positionSpread", 0.1f);
                            slot.grainMilliseconds = floatParam(granularSlot2, "grainMilliseconds", 80.0f, 2.0f, 1000.0f);
                            slot.densityHz = floatParam(granularSlot2, "densityHz", 12.0f, 0.1f, 200.0f);
                            slot.pitchSemitones = floatParam(granularSlot2, "pitchSemitones", 0.0f, -48.0f, 48.0f);
                            slot.stereoSpread = normalizedParam(granularSlot2, "stereoSpread", 0.5f);
                            slot.randomSeed = (uint32_t) juce::jlimit(1.0, 4294967295.0,
                                (double) granularSlot2.getProperty("randomSeed", 1.0));
                            if (const auto* sends = granularSlot2.getProperty("fxSends", {}).getArray())
                            {
                                if (!sends->isEmpty()) slot.fxSends[0] = juce::jlimit(0.0f, 1.0f, (float) (double) sends->getReference(0));
                                if (sends->size() > 1) slot.fxSends[1] = juce::jlimit(0.0f, 1.0f, (float) (double) sends->getReference(1));
                            }
                            const auto managed = granularSlot2.getProperty("managedAsset", {});
                            if (managed.isObject() && (int) managed.getProperty("schemaVersion", 0) <= 1)
                            {
                                slot.managedAsset.assetId = managed.getProperty("assetId", {}).toString();
                                slot.managedAsset.displayName = managed.getProperty("displayName", {}).toString();
                                slot.managedAsset.manifestPath = managed.getProperty("manifestPath", {}).toString();
                                slot.managedAsset.audioPath = managed.getProperty("audioPath", {}).toString();
                            }
                            slot.enabled = requestedEnabled && slotSchemaVersion <= slot.schemaVersion
                                && (slot.builtinSource.isNotEmpty() || slot.managedAsset.manifestPath.isNotEmpty());
                        }
                        instrument.aether.fxBusIds[0] = aether.getProperty("fxBus1Id", "").toString();
                        instrument.aether.fxBusIds[1] = aether.getProperty("fxBus2Id", "").toString();
                        instrument.aether.runtimeWarp = normalizedParam(aether, "runtimeWarp", 0.0f);
                        instrument.aether.runtimeWarpMode = parseWavetableWarpMode(aether.getProperty("runtimeWarpMode", 0));
                        instrument.aether.runtimeWarp2 = normalizedParam(aether, "runtimeWarp2", 0.0f);
                        instrument.aether.runtimeWarp2Mode = parseWavetableWarpMode(aether.getProperty("runtimeWarp2Mode", 0));
                    }

                    if (auto* sampleUrls = instrumentVar.getProperty("sampleUrls", {}).getArray())
                    {
                        for (const auto& sampleUrl : *sampleUrls)
                        {
                            const auto url = sampleUrl.toString();
                            if (url.isNotEmpty()) instrument.sampleUrls.add(url);
                        }
                    }
                    const auto sampleUrl = instrumentVar.getProperty("sampleUrl", "").toString();
                    if (sampleUrl.isNotEmpty() && !instrument.sampleUrls.contains(sampleUrl))
                        instrument.sampleUrls.add(sampleUrl);

                    if (auto* sampleMap = instrumentVar.getProperty("sampleMap", {}).getArray())
                    {
                        for (const auto& zoneVar : *sampleMap)
                        {
                            if (!zoneVar.isObject()) continue;
                            InstrumentDefinition::SampleZone zone;
                            zone.path = zoneVar.getProperty("path", zoneVar.getProperty("sampleUrl", "")).toString();
                            if (zone.path.isEmpty()) continue;
                            zone.rootNote = juce::jlimit(0, 127, (int) zoneVar.getProperty("rootNote", 60));
                            zone.loNote = juce::jlimit(0, 127, (int) zoneVar.getProperty("loNote", 0));
                            zone.hiNote = juce::jlimit(0, 127, (int) zoneVar.getProperty("hiNote", 127));
                            zone.loVel = juce::jlimit(0, 127, (int) zoneVar.getProperty("loVel", 0));
                            zone.hiVel = juce::jlimit(0, 127, (int) zoneVar.getProperty("hiVel", 127));
                            zone.volumeDb = juce::jlimit(-48.0f, 24.0f, (float) (double) zoneVar.getProperty("volumeDb", 0.0));
                            zone.pan = juce::jlimit(-1.0f, 1.0f, (float) (double) zoneVar.getProperty("pan", 0.0));
                            zone.tuningCents = juce::jlimit(-1200.0f, 1200.0f, (float) (double) zoneVar.getProperty("tuning", zoneVar.getProperty("tuningCents", 0.0)));
                            zone.seqPosition = juce::jmax(0, (int) zoneVar.getProperty("seqPosition", 0));
                            zone.chokeGroup = juce::jmax(0, (int) zoneVar.getProperty("chokeGroup", zoneVar.getProperty("exclusiveGroup", 0)));
                            zone.loopEnabled = (bool) zoneVar.getProperty("loopEnabled", false);
                            zone.loopStart = juce::jmax(0, (int) zoneVar.getProperty("loopStart", 0));
                            zone.loopEnd = juce::jmax(0, (int) zoneVar.getProperty("loopEnd", 0));
                            zone.oneShot = (bool) zoneVar.getProperty("oneShot", false);
                            zone.durationSeconds = juce::jmax(0.0, (double) zoneVar.getProperty("durationSeconds", 0.0));
                            zone.loLengthSeconds = juce::jmax(0.0, (double) zoneVar.getProperty("loLengthSeconds", 0.0));
                            zone.hiLengthSeconds = juce::jmax(0.0, (double) zoneVar.getProperty("hiLengthSeconds", 0.0));
                            zone.startSample = juce::jmax(0, (int) zoneVar.getProperty("startSample", 0));
                            zone.endSample = juce::jmax(0, (int) zoneVar.getProperty("endSample", 0));
                            if (zone.loNote > zone.hiNote) std::swap(zone.loNote, zone.hiNote);
                            if (zone.loVel > zone.hiVel) std::swap(zone.loVel, zone.hiVel);
                            if (zone.hiLengthSeconds > 0.0 && zone.loLengthSeconds > zone.hiLengthSeconds)
                                std::swap(zone.loLengthSeconds, zone.hiLengthSeconds);
                            if (zone.endSample > 0 && zone.startSample >= zone.endSample)
                            {
                                zone.startSample = 0;
                                zone.endSample = 0;
                            }
                            if (zone.loopEnd > 0 && zone.loopStart >= zone.loopEnd) zone.loopEnabled = false;
                            instrument.sampleZones.push_back(zone);
                            if (!instrument.sampleUrls.contains(zone.path))
                                instrument.sampleUrls.add(zone.path);
                        }
                    }

                    applySynthPatchContract(instrumentVar.getProperty("synthPatch", {}), instrument);

                    p.instruments.push_back(std::move(instrument));
                }
            }

            const auto eqSource = projectVar.getProperty("masterEqAutomation", projectVar.getProperty("eqAutomation", {}));
            if (auto* eq = eqSource.getArray())
            {
                for (const auto& pointVar : *eq)
                {
                    if (!pointVar.isObject()) continue;
                    p.eqAutomation.push_back(parseEqAutomationPoint(pointVar));
                }
            }

            const auto automationSource = projectVar.getProperty("projectAutomation", projectVar.getProperty("automation", {}));
            if (auto* automation = automationSource.getArray())
            {
                for (const auto& laneVar : *automation)
                {
                    if (!laneVar.isObject()) continue;
                    ProjectAutomationLane lane;
                    lane.trackId = laneVar.getProperty("trackId", "").toString();
                    lane.instrumentId = laneVar.getProperty("instrumentId", "").toString();
                    lane.target = laneVar.getProperty("target", "").toString();
                    if (lane.target.isEmpty() || lane.target == "pitch") continue;

                    if (auto* points = laneVar.getProperty("points", {}).getArray())
                    {
                        lane.points.reserve((size_t) points->size());
                        for (const auto& pointVar : *points)
                        {
                            if (!pointVar.isObject()) continue;
                            MidiAutomationPoint point;
                            point.beat = (double) pointVar.getProperty("beat", 0.0);
                            point.value = (float) (double) pointVar.getProperty("value", 0.0);
                            point.curve = parseAutomationCurve(pointVar.getProperty("curve", "linear"));
                            if (std::isfinite(point.beat) && std::isfinite(point.value))
                                lane.points.push_back(point);
                        }
                    }

                    if (!lane.points.empty())
                    {
                        std::sort(lane.points.begin(), lane.points.end(),
                                  [](const MidiAutomationPoint& a, const MidiAutomationPoint& b) {
                                      return a.beat < b.beat;
                                  });
                        p.automation.push_back(std::move(lane));
                    }
                }
            }

            return p;
        }
    }

    MessageBridge::MessageBridge(AudioEngine& e, Database& d, juce::WebBrowserComponent& b)
        : engine(e), database(d), browser(b)
    {
        // Hook engine events → emit() so the UI sees them.
        engine.onPositionChanged = [this](Beats b) {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("positionBeat", (double) b);
            emit(ipc::kind::EV_POSITION_CHANGED, juce::var(o.get()));
        };
        engine.onSegmentTriggered = [this](const Sequencer::TriggerEvent& ev) {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("segmentId", ev.segmentId);
            o->setProperty("repetition", ev.repetition);
            emit(ipc::kind::EV_SEGMENT_TRIGGER, juce::var(o.get()));
        };
        engine.onSynthExpressionActivity = [this](const AudioEngine::SynthExpressionActivity& activity) {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("instrumentId", activity.instrumentId);
            o->setProperty("source", "midi");
            o->setProperty("active", activity.active);
            o->setProperty("activeNotes", activity.activeNotes);
            o->setProperty("pitchBendSemitones", activity.pitchBendSemitones);
            o->setProperty("velocity", activity.velocity);
            o->setProperty("keytrack", activity.keytrack);
            o->setProperty("modWheel", activity.modWheel);
            o->setProperty("pressure", activity.pressure);
            o->setProperty("timbre", activity.timbre);
            emit(ipc::kind::EV_SYNTH_EXPRESSION_ACTIVITY, juce::var(o.get()));
        };
        startTimerHz(30);
    }

    MessageBridge::~MessageBridge()
    {
        {
            const std::lock_guard<std::mutex> lock(exportJobLock);
            if (activeExportJob)
                activeExportJob->cancel.store(true, std::memory_order_release);
        }
        if (exportThread.joinable())
            exportThread.join();
        stopTimer();
        engine.onPositionChanged = nullptr;
        engine.onSegmentTriggered = nullptr;
        engine.onSynthExpressionActivity = nullptr;
    }

    void MessageBridge::joinFinishedExportThreadIfNeeded()
    {
        std::shared_ptr<ExportJob> job;
        {
            const std::lock_guard<std::mutex> lock(exportJobLock);
            job = activeExportJob;
        }

        if (job != nullptr && job->finished.load(std::memory_order_acquire) && exportThread.joinable())
            exportThread.join();
    }

    juce::var MessageBridge::exportJobStatusVar(const std::shared_ptr<ExportJob>& job) const
    {
        juce::DynamicObject::Ptr object = new juce::DynamicObject();
        if (job == nullptr)
        {
            object->setProperty("active", false);
            object->setProperty("finished", true);
            object->setProperty("ok", false);
            object->setProperty("progress", 0.0);
            object->setProperty("path", juce::String());
            object->setProperty("error", juce::String());
            return juce::var(object.get());
        }

        object->setProperty("active", !job->finished.load(std::memory_order_acquire));
        object->setProperty("finished", job->finished.load(std::memory_order_acquire));
        object->setProperty("ok", job->ok.load(std::memory_order_acquire));
        object->setProperty("jobId", job->id);
        object->setProperty("type", job->type);
        object->setProperty("progress", job->progress.load(std::memory_order_acquire));
        object->setProperty("samplesWritten", static_cast<double>(job->samplesWritten.load(std::memory_order_acquire)));
        object->setProperty("totalSamples", static_cast<double>(job->totalSamples.load(std::memory_order_acquire)));
        {
            const std::lock_guard<std::mutex> lock(job->statusLock);
            object->setProperty("path", job->path);
            object->setProperty("error", job->error);
            if (!job->analysis.isVoid())
                object->setProperty("analysis", job->analysis);
        }
        return juce::var(object.get());
    }

    void MessageBridge::timerCallback()
    {
        AudioEngine::RenderTimingSnapshot timing;
        if (engine.pullRenderTimingSnapshot(timing) && timing.sequence != 0 && timing.sequence != lastRenderTimingSequence)
        {
            lastRenderTimingSequence = timing.sequence;

            juce::DynamicObject::Ptr timingObject = new juce::DynamicObject();
            timingObject->setProperty("sequence", (double) timing.sequence);
            timingObject->setProperty("blockSamples", timing.blockSamples);
            timingObject->setProperty("sampleRate", timing.sampleRate);
            timingObject->setProperty("scheduleMs", timing.scheduleMs);
            timingObject->setProperty("synthMs", timing.synthMs);
            timingObject->setProperty("voiceMs", timing.voiceMs);
            timingObject->setProperty("modulationMs", timing.modulationMs);
            timingObject->setProperty("samplesMs", timing.samplesMs);
            timingObject->setProperty("fxMs", timing.fxMs);
            timingObject->setProperty("filterFxMs", timing.filterFxMs);
            timingObject->setProperty("analyzerMs", timing.analyzerMs);
            timingObject->setProperty("copyMs", timing.copyMs);
            timingObject->setProperty("totalMs", timing.totalMs);
            timingObject->setProperty("loadPercent", timing.loadPercent);
            timingObject->setProperty("activeSynthVoices", timing.activeSynthVoices);
            timingObject->setProperty("activeSampleVoices", timing.activeSampleVoices);
            timingObject->setProperty("activeAudioClipVoices", timing.activeAudioClipVoices);
            timingObject->setProperty("routeCount", timing.routeCount);
            timingObject->setProperty("automationEventCount", timing.automationEventCount);
            timingObject->setProperty("wavetableCacheHits", (double) timing.wavetableCacheHits);
            timingObject->setProperty("wavetableCacheMisses", (double) timing.wavetableCacheMisses);
            timingObject->setProperty("wavetableCacheSize", timing.wavetableCacheSize);
            timingObject->setProperty("voiceRenderBlocks", (double) timing.voiceRenderBlocks);
            timingObject->setProperty("voiceRenderSamples", (double) timing.voiceRenderSamples);
            timingObject->setProperty("oscillatorSamples", (double) timing.oscillatorSamples);
            timingObject->setProperty("wavetableVoiceSamples", (double) timing.wavetableVoiceSamples);
            timingObject->setProperty("aetherOscASamples", (double) timing.aetherOscASamples);
            timingObject->setProperty("aetherOscBSamples", (double) timing.aetherOscBSamples);
            timingObject->setProperty("aetherSubSamples", (double) timing.aetherSubSamples);
            timingObject->setProperty("aetherNoiseSamples", (double) timing.aetherNoiseSamples);
            timingObject->setProperty("filterSamples", (double) timing.filterSamples);
            timingObject->setProperty("filterDriveSamples", (double) timing.filterDriveSamples);
            timingObject->setProperty("voiceNonlinearSamples", (double) timing.voiceNonlinearSamples);
            timingObject->setProperty("filterCoefficientUpdates", (double) timing.filterCoefficientUpdates);
            timingObject->setProperty("filterCutoffUpdates", (double) timing.filterCutoffUpdates);
            timingObject->setProperty("filterResonanceUpdates", (double) timing.filterResonanceUpdates);
            timingObject->setProperty("modulationSamples", (double) timing.modulationSamples);
            timingObject->setProperty("realtimeRampSamples", (double) timing.realtimeRampSamples);
            timingObject->setProperty("oscillatorRateCalculations", (double) timing.oscillatorRateCalculations);
            timingObject->setProperty("wavetableFrequencyUpdates", (double) timing.wavetableFrequencyUpdates);
            timingObject->setProperty("wavetablePositionUpdates", (double) timing.wavetablePositionUpdates);
            timingObject->setProperty("routeEffectSamples", (double) timing.routeEffectSamples);
            timingObject->setProperty("routeFilterEffectSamples", (double) timing.routeFilterEffectSamples);
            timingObject->setProperty("routeNonlinearEffectSamples", (double) timing.routeNonlinearEffectSamples);
            timingObject->setProperty("routeDelayEffectSamples", (double) timing.routeDelayEffectSamples);
            timingObject->setProperty("modulationWorkBudgetOverruns", (double) timing.modulationWorkBudgetOverruns);
            timingObject->setProperty("nonlinearWorkBudgetOverruns", (double) timing.nonlinearWorkBudgetOverruns);
            emit(ipc::kind::EV_RENDER_TIMING, juce::var(timingObject.get()));
        }

        std::vector<AudioEngine::TrackMeterSnapshot> meterSnapshots;
        if (engine.pullTrackMeterSnapshots(meterSnapshots))
        {
            uint64_t newestMeterSequence = 0;
            for (const auto& meter : meterSnapshots)
                newestMeterSequence = std::max(newestMeterSequence, meter.sequence);

            if (newestMeterSequence != 0 && newestMeterSequence != lastTrackMeterSequence)
            {
                lastTrackMeterSequence = newestMeterSequence;
                juce::Array<juce::var> tracks;
                tracks.ensureStorageAllocated((int) meterSnapshots.size());
                for (const auto& meter : meterSnapshots)
                {
                    juce::DynamicObject::Ptr track = new juce::DynamicObject();
                    track->setProperty("id", meter.trackId);
                    track->setProperty("rms", juce::jlimit(0.0f, 1.0f, meter.rms));
                    track->setProperty("peak", juce::jlimit(0.0f, 1.0f, meter.peak));
                    track->setProperty("leftRms", juce::jlimit(0.0f, 1.0f, meter.leftRms));
                    track->setProperty("rightRms", juce::jlimit(0.0f, 1.0f, meter.rightRms));
                    track->setProperty("leftPeak", juce::jlimit(0.0f, 1.0f, meter.leftPeak));
                    track->setProperty("rightPeak", juce::jlimit(0.0f, 1.0f, meter.rightPeak));
                    if (std::isfinite(meter.rmsDbFS))
                        track->setProperty("rmsDbFS", meter.rmsDbFS);
                    if (std::isfinite(meter.peakDbFS))
                        track->setProperty("peakDbFS", meter.peakDbFS);
                    if (std::isfinite(meter.truePeakDbTP))
                        track->setProperty("truePeakDbTP", meter.truePeakDbTP);
                    if (std::isfinite(meter.momentaryLufs))
                        track->setProperty("momentaryLufs", meter.momentaryLufs);
                    tracks.add(juce::var(track.get()));
                }

                juce::DynamicObject::Ptr event = new juce::DynamicObject();
                event->setProperty("tracks", tracks);
                emit(ipc::kind::EV_LEVEL_METERS, juce::var(event.get()));
            }
        }

        FftAnalyzer::Snapshot snapshot;
        if (!engine.pullMasterAnalyzerSnapshot(snapshot))
            return;

        if (snapshot.sequence == 0 || snapshot.sequence == lastAnalyzerSequence)
            return;

        lastAnalyzerSequence = snapshot.sequence;

        juce::Array<juce::var> bands;
        bands.ensureStorageAllocated(FftAnalyzer::bandCount);
        for (float band : snapshot.spectrum)
            bands.add(juce::jlimit(0.0f, 1.0f, band));

        juce::DynamicObject::Ptr o = new juce::DynamicObject();
        o->setProperty("sequence", (double) snapshot.sequence);
        o->setProperty("rms", snapshot.rms);
        o->setProperty("peak", snapshot.peak);
        o->setProperty("bands", bands);
        emit(ipc::kind::EV_ANALYZER_SPECTRUM, juce::var(o.get()));
    }

    void MessageBridge::install()
    {
        // Native functions and the bootstrap user script are registered on the
        // WebBrowserComponent::Options before construction in MainComponent.
        // This method remains as a lifecycle hook for future subscriptions.
    }

    juce::var MessageBridge::handleRequest(const juce::String& kind, const juce::var& payload)
    {
        using namespace ipc::kind;

        if (kind == APP_READY)
        {
            if (onAppReady)
                onAppReady();
            return juce::var(true);
        }

        if (kind == TRANSPORT_PLAY)       { engine.requestPlay();  return juce::var(true); }
        if (kind == TRANSPORT_PAUSE)      { engine.requestPause(); return juce::var(true); }
        if (kind == TRANSPORT_STOP)       { engine.requestStop();  return juce::var(true); }
        if (kind == TRANSPORT_RESTART)    { engine.requestRestart(); return juce::var(true); }
        if (kind == TRANSPORT_SEEK)
        {
            engine.requestSeek((double) payload.getProperty("positionBeat", 0.0));
            return juce::var(true);
        }
        if (kind == TRANSPORT_SET_SPEED)
        {
            engine.requestSpeed((double) payload.getProperty("speed", 1.0));
            return juce::var(true);
        }
        if (kind == TRANSPORT_SET_LOOP)
        {
            auto range = payload.getProperty("range", {});
            if (range.isObject())
            {
                engine.requestLoop(
                    (double) range.getProperty("startBeat", 0.0),
                    (double) range.getProperty("endBeat", 0.0));
            }
            else
            {
                engine.requestClearLoop();
            }
            return juce::var(true);
        }

        if (kind == ENGINE_APPLY_PROJECT)
        {
            engine.applyProject(parseProjectFromFrontend(
                payload.getProperty("project", {}),
                payload.getProperty("instruments", {}),
                payload.getProperty("audioFiles", {})));
            return juce::var(true);
        }

        if (kind == ENGINE_SET_PARAMETER)
        {
            const auto instrumentId = payload.getProperty("instrumentId", {}).toString();
            const auto parameterId = payload.getProperty("parameterId", {}).toString();
            const auto value = (float) (double) payload.getProperty("value", 0.0);
            const auto sampleOffset = (int) payload.getProperty("sampleOffset", 0);
            const auto rampSamples = (int) payload.getProperty("rampSamples", 0);
            return juce::var(engine.queueRealtimeParameterChange(instrumentId, parameterId, value, sampleOffset, rampSamples));
        }

        if (kind == PROJECT_SAVE)
        {
            const auto project = payload.getProperty("project", {});
            const auto id = project.getProperty("id", juce::Uuid().toString()).toString();
            const auto name = project.getProperty("name", "Untitled").toString();
            const auto bpm = (double) project.getProperty("bpm", 120.0);
            const auto lengthBeats = (double) project.getProperty("lengthBeats", 64.0);
            const auto json = juce::JSON::toString(project, true);

            Statement stmt(database, R"sql(
                INSERT INTO projects(id, name, bpm, length_beats, saved_at, json_blob)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name = excluded.name,
                  bpm = excluded.bpm,
                  length_beats = excluded.length_beats,
                  saved_at = excluded.saved_at,
                  json_blob = excluded.json_blob
            )sql");
            stmt.bind(1, id);
            stmt.bind(2, name);
            stmt.bind(3, bpm);
            stmt.bind(4, lengthBeats);
            stmt.bind(5, (int) (juce::Time::currentTimeMillis() / 1000));
            stmt.bind(6, json);
            stmt.step();
            return juce::var(true);
        }

        if (kind == PROJECT_LOAD)
        {
            const auto id = payload.getProperty("id", {}).toString();
            Statement stmt(database, "SELECT json_blob FROM projects WHERE id = ?");
            stmt.bind(1, id);

            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            if (stmt.step())
                response->setProperty("project", juce::JSON::parse(stmt.columnText(0)));
            else
                response->setProperty("project", juce::var());
            return juce::var(response.get());
        }

        if (kind == PROJECT_LIST)
        {
            juce::Array<juce::var> arr;
            for (const auto& s : projectRepo.list())
            {
                juce::DynamicObject::Ptr o = new juce::DynamicObject();
                o->setProperty("id", s.id);
                o->setProperty("name", s.name);
                o->setProperty("savedAt", (double) s.savedAt);
                arr.add(juce::var(o.get()));
            }
            juce::DynamicObject::Ptr r = new juce::DynamicObject();
            r->setProperty("projects", arr);
            return juce::var(r.get());
        }

        if (kind == PROJECT_SAVE_FILE)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto document = payload.getProperty("document", {});
            if (!document.isObject())
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", "No project document was provided.");
                return juce::var(response.get());
            }

            auto pathHint = payload.getProperty("pathHint", {}).toString();
            const bool forcePicker = (bool) payload.getProperty("forcePicker", false);
            juce::File file;
            if (pathHint.isNotEmpty() && !forcePicker)
            {
                file = juce::File(pathHint);
            }
            else
            {
                const auto project = document.getProperty("project", {});
                const auto rawName = project.getProperty("name", "Untitled").toString();
                const auto safeName = rawName.retainCharacters("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_").trim();
                const auto fallbackName = safeName.isNotEmpty() && safeName != "Untitled" ? safeName : juce::String("NewSong");
                auto start = juce::File::getSpecialLocation(juce::File::userDocumentsDirectory)
                    .getChildFile(fallbackName)
                    .withFileExtension(".beat");
                juce::FileChooser chooser("Save Beat Project", start, "*.beat", true);
                if (!chooser.browseForFileToSave(true))
                {
                    response->setProperty("path", juce::String());
                    return juce::var(response.get());
                }
                file = chooser.getResult();
            }

            if (!file.hasFileExtension(".beat"))
                file = file.withFileExtension(".beat");

            const auto parent = file.getParentDirectory();
            if (!parent.exists() && !parent.createDirectory())
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", "Could not create project directory.");
                return juce::var(response.get());
            }

            auto tempFile = parent.getChildFile(file.getFileName() + ".tmp");
            if (tempFile.existsAsFile() && !tempFile.deleteFile())
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", "Could not clear previous temporary project file.");
                return juce::var(response.get());
            }

            auto documentToWrite = juce::JSON::parse(juce::JSON::toString(document));
            juce::String packagingError;
            if (!packageExternalDocumentAssets(documentToWrite, file, packagingError))
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", packagingError.isNotEmpty() ? packagingError : "Could not package project assets.");
                return juce::var(response.get());
            }

            const auto integrityReport = verifyProjectDocumentIntegrity(documentToWrite, file);
            if (!integrityReport.ok())
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", projectIntegritySaveError(integrityReport));
                return juce::var(response.get());
            }

            const auto serializedDocument = juce::JSON::toString(documentToWrite, true);
            if (!tempFile.replaceWithText(serializedDocument))
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", "Could not write Beat project file.");
                return juce::var(response.get());
            }

            const auto validation = juce::JSON::parse(tempFile);
            if (!validation.isObject())
            {
                tempFile.deleteFile();
                response->setProperty("path", juce::String());
                response->setProperty("error", "Beat project file failed validation before save.");
                return juce::var(response.get());
            }

            juce::String backupError;
            juce::File backupFile;
            if (!createProjectBackupBeforeReplace(file, backupError, &backupFile))
            {
                tempFile.deleteFile();
                response->setProperty("path", juce::String());
                response->setProperty("error", backupError.isNotEmpty() ? backupError : "Could not create project backup.");
                return juce::var(response.get());
            }

            if (!tempFile.replaceFileIn(file))
            {
                tempFile.deleteFile();
                response->setProperty("path", juce::String());
                response->setProperty("error", "Could not finalize Beat project file.");
                return juce::var(response.get());
            }

            const auto cleanupReport = cleanupUnusedProjectSidecarAssets(documentToWrite, file);
            response->setProperty("cleanupReport", makeSidecarCleanupReport(cleanupReport));
            response->setProperty("integrityReport", integrityReport.toVar());
            projectRepo.recordRecentProject(file, documentToWrite);
            response->setProperty("path", file.getFullPathName());
            if (backupFile.existsAsFile())
                response->setProperty("backupPath", backupFile.getFullPathName());
            return juce::var(response.get());
        }

        if (kind == PROJECT_OPEN_FILE)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto directPath = payload.getProperty("directPath", {}).toString();
            const auto pathHint = payload.getProperty("pathHint", {}).toString();
            juce::File file;
            if (directPath.isNotEmpty())
            {
                file = juce::File(directPath);
                if (!file.existsAsFile())
                {
                    response->setProperty("path", juce::String());
                    response->setProperty("error", "Recent project file no longer exists.");
                    return juce::var(response.get());
                }
            }
            else
            {
                const auto start = pathHint.isNotEmpty()
                    ? juce::File(pathHint)
                    : juce::File::getSpecialLocation(juce::File::userDocumentsDirectory);
                juce::FileChooser chooser("Open Beat Project", start, "*.beat", true);
                if (!chooser.browseForFileToOpen())
                {
                    response->setProperty("path", juce::String());
                    return juce::var(response.get());
                }
                file = chooser.getResult();
            }

            auto parsed = juce::JSON::parse(file);
            if (!parsed.isObject())
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", "Could not read Beat project file.");
                return juce::var(response.get());
            }

            resolveDocumentAssetPaths(parsed, file);
            const auto integrityReport = verifyProjectDocumentIntegrity(parsed, file);
            if (hasFatalProjectDocumentIntegrityErrors(integrityReport))
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", projectIntegrityOpenError(integrityReport));
                response->setProperty("integrityReport", integrityReport.toVar());
                return juce::var(response.get());
            }

            response->setProperty("path", file.getFullPathName());
            response->setProperty("document", parsed);
            response->setProperty("missingAssets", collectMissingDocumentAssets(parsed));
            response->setProperty("integrityReport", integrityReport.toVar());
            projectRepo.recordRecentProject(file, parsed);
            return juce::var(response.get());
        }

        if (kind == PROJECT_RECENT_LIST)
        {
            juce::Array<juce::var> items;
            for (const auto& recent : projectRepo.listRecentProjects(16))
            {
                juce::DynamicObject::Ptr item = new juce::DynamicObject();
                item->setProperty("path", recent.path);
                item->setProperty("name", recent.name);
                item->setProperty("openedAt", static_cast<double>(recent.openedAt));
                item->setProperty("sizeBytes", recent.sizeBytes);
                item->setProperty("exists", recent.exists);
                items.add(juce::var(item.get()));
            }

            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            response->setProperty("projects", items);
            return juce::var(response.get());
        }

        if (kind == PROJECT_RECENT_REMOVE)
        {
            const auto path = payload.getProperty("path", {}).toString();
            projectRepo.removeRecentProject(path);
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            response->setProperty("ok", true);
            return juce::var(response.get());
        }

        if (kind == PROJECT_REVEAL_FILE)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto path = payload.getProperty("path", {}).toString();
            if (path.isEmpty())
            {
                response->setProperty("ok", false);
                response->setProperty("missing", true);
                response->setProperty("error", "No project file path was provided.");
                return juce::var(response.get());
            }

            const juce::File file(path);
            if (! file.existsAsFile())
            {
                response->setProperty("ok", false);
                response->setProperty("missing", true);
                response->setProperty("error", "This project file is no longer available on disk.");
                return juce::var(response.get());
            }

            file.revealToUser();
            response->setProperty("ok", true);
            response->setProperty("missing", false);
            return juce::var(response.get());
        }

        if (kind == PROJECT_CHOOSE_EXPORT_FOLDER)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto pathHint = payload.getProperty("pathHint", {}).toString();
            const auto start = pathHint.isNotEmpty()
                ? juce::File(pathHint)
                : juce::File::getSpecialLocation(juce::File::userDocumentsDirectory);
            juce::FileChooser chooser("Choose Export Folder", start, "*", true);
            if (!chooser.browseForDirectory())
            {
                response->setProperty("path", juce::String());
                response->setProperty("cancelled", true);
                return juce::var(response.get());
            }

            response->setProperty("path", chooser.getResult().getFullPathName());
            response->setProperty("cancelled", false);
            return juce::var(response.get());
        }

        if (kind == PROJECT_INSPECT_DOCUMENT)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            auto document = payload.getProperty("document", {});
            if (!document.isObject())
            {
                response->setProperty("missingAssets", juce::Array<juce::var> {});
                response->setProperty("error", "No Beat project document was provided.");
                return juce::var(response.get());
            }

            auto inspected = juce::JSON::parse(juce::JSON::toString(document));
            if (!inspected.isObject())
            {
                response->setProperty("missingAssets", juce::Array<juce::var> {});
                response->setProperty("error", "Beat project document failed inspection serialization.");
                return juce::var(response.get());
            }

            const auto projectPath = payload.getProperty("projectPath", payload.getProperty("path", {})).toString();
            const juce::File projectFile(projectPath);
            if (projectPath.isNotEmpty())
                resolveDocumentAssetPaths(inspected, projectFile);

            const auto integrityReport = verifyProjectDocumentIntegrity(inspected, projectFile);
            response->setProperty("path", projectFile.existsAsFile() ? projectFile.getFullPathName() : juce::String());
            response->setProperty("missingAssets", collectMissingDocumentAssets(inspected));
            response->setProperty("integrityReport", integrityReport.toVar());
            return juce::var(response.get());
        }

        if (kind == PROJECT_REPAIR_DOCUMENT)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            auto document = payload.getProperty("document", {});
            if (!document.isObject())
            {
                response->setProperty("changed", false);
                response->setProperty("missingAssets", juce::Array<juce::var> {});
                response->setProperty("error", "No Beat project document was provided.");
                return juce::var(response.get());
            }

            auto repaired = juce::JSON::parse(juce::JSON::toString(document));
            if (!repaired.isObject())
            {
                response->setProperty("changed", false);
                response->setProperty("missingAssets", juce::Array<juce::var> {});
                response->setProperty("error", "Beat project document failed repair serialization.");
                return juce::var(response.get());
            }

            const auto action = payload.getProperty("action", "rebuildAssetManifest").toString();
            bool changed = false;
            if (action == "rebuildAssetManifest")
            {
                changed = rebuildDocumentAssetManifest(repaired);
            }
            else if (action == "repairSegmentTrackIds")
            {
                changed = repairProjectDocumentSegmentTrackIds(repaired);
            }
            else
            {
                response->setProperty("changed", false);
                response->setProperty("document", repaired);
                response->setProperty("missingAssets", juce::Array<juce::var> {});
                response->setProperty("error", "Unsupported project repair action: " + action);
                return juce::var(response.get());
            }

            const auto projectPath = payload.getProperty("projectPath", payload.getProperty("path", {})).toString();
            const juce::File projectFile(projectPath);
            auto inspected = juce::JSON::parse(juce::JSON::toString(repaired));
            if (projectPath.isNotEmpty())
                resolveDocumentAssetPaths(inspected, projectFile);

            const auto integrityReport = verifyProjectDocumentIntegrity(inspected, projectFile);
            response->setProperty("changed", changed);
            response->setProperty("document", repaired);
            response->setProperty("path", projectFile.existsAsFile() ? projectFile.getFullPathName() : juce::String());
            response->setProperty("missingAssets", collectMissingDocumentAssets(inspected));
            response->setProperty("integrityReport", integrityReport.toVar());
            return juce::var(response.get());
        }

        if (kind == PROJECT_LIST_BACKUPS)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto projectPath = payload.getProperty("projectPath", payload.getProperty("path", {})).toString();
            if (projectPath.isEmpty())
            {
                response->setProperty("backups", juce::Array<juce::var> {});
                response->setProperty("error", "No project path was provided.");
                return juce::var(response.get());
            }

            juce::Array<juce::var> backups;
            for (const auto& backup : listProjectBackups(juce::File(projectPath)))
            {
                juce::DynamicObject::Ptr item = new juce::DynamicObject();
                const auto parsed = juce::JSON::parse(backup.file);
                item->setProperty("path", backup.file.getFullPathName());
                item->setProperty("name", backup.file.getFileName());
                item->setProperty("modifiedAt", backup.modifiedAt.toISO8601(true));
                item->setProperty("sizeBytes", static_cast<double>(backup.sizeBytes));
                item->setProperty("latest", backup.latest);

                if (parsed.isObject())
                {
                    const auto project = parsed.getProperty("project", {});
                    const auto integrityReport = verifyProjectDocumentIntegrity(parsed, juce::File(projectPath));
                    item->setProperty("projectName", project.getProperty("name", {}).toString());
                    item->setProperty("projectId", project.getProperty("id", {}).toString());
                    item->setProperty("savedAt", parsed.getProperty("savedAt", {}));
                    item->setProperty("schemaVersion", parsed.getProperty("schemaVersion", {}));
                    item->setProperty("valid", !hasFatalProjectDocumentIntegrityErrors(integrityReport));
                    item->setProperty("integrityReport", integrityReport.toVar());
                }
                else
                {
                    item->setProperty("valid", false);
                    item->setProperty("error", "Project backup is not valid JSON.");
                }
                backups.add(juce::var(item.get()));
            }

            response->setProperty("backups", backups);
            return juce::var(response.get());
        }

        if (kind == PROJECT_RESTORE_BACKUP)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto projectPath = payload.getProperty("projectPath", payload.getProperty("path", {})).toString();
            const auto backupPath = payload.getProperty("backupPath", {}).toString();
            if (projectPath.isEmpty() || backupPath.isEmpty())
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", "Project restore requires a project path and backup path.");
                return juce::var(response.get());
            }

            juce::String error;
            juce::File overwrittenBackup;
            const juce::File projectFile(projectPath);
            if (!restoreProjectBackup(projectFile, juce::File(backupPath), error, &overwrittenBackup))
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", error.isNotEmpty() ? error : "Could not restore project backup.");
                return juce::var(response.get());
            }

            response->setProperty("path", projectFile.getFullPathName());
            if (overwrittenBackup.existsAsFile())
                response->setProperty("backupPath", overwrittenBackup.getFullPathName());

            auto parsed = juce::JSON::parse(projectFile);
            if (!parsed.isObject())
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", "Restored project failed validation.");
                return juce::var(response.get());
            }

            resolveDocumentAssetPaths(parsed, projectFile);
            const auto integrityReport = verifyProjectDocumentIntegrity(parsed, projectFile);
            if (hasFatalProjectDocumentIntegrityErrors(integrityReport))
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", projectIntegrityOpenError(integrityReport));
                response->setProperty("integrityReport", integrityReport.toVar());
                return juce::var(response.get());
            }

            response->setProperty("document", parsed);
            response->setProperty("missingAssets", collectMissingDocumentAssets(parsed));
            response->setProperty("integrityReport", integrityReport.toVar());
            projectRepo.recordRecentProject(projectFile, parsed);
            return juce::var(response.get());
        }

        if (kind == PROJECT_RELINK_ASSET)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto asset = payload.getProperty("asset", {});
            const auto assetKind = asset.getProperty("kind", "sample").toString();
            const auto assetName = asset.getProperty("name", asset.getProperty("path", "asset")).toString();
            const auto pathHint = payload.getProperty("pathHint", asset.getProperty("path", {})).toString();
            const auto start = pathHint.isNotEmpty()
                ? juce::File(pathHint)
                : juce::File::getSpecialLocation(juce::File::userDocumentsDirectory);
            const auto wildcard = assetKind == "plugin" ? decentImportWildcard : audioImportWildcard;
            juce::FileChooser chooser("Relink " + assetName, start, wildcard, true);
            if (!chooser.browseForFileToOpen())
            {
                response->setProperty("path", juce::String());
                return juce::var(response.get());
            }
            const auto file = chooser.getResult();
            if (!file.existsAsFile())
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", "Selected replacement file does not exist.");
                return juce::var(response.get());
            }
            response->setProperty("path", file.getFullPathName());
            return juce::var(response.get());
        }

        if (kind == PROJECT_CLEANUP_ASSETS)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto projectPath = payload.getProperty("projectPath", payload.getProperty("path", {})).toString();
            const auto document = payload.getProperty("document", {});
            if (projectPath.isEmpty() || !document.isObject())
            {
                response->setProperty("report", makeSidecarCleanupReport({}));
                response->setProperty("error", "Asset cleanup requires a project path and document payload.");
                return juce::var(response.get());
            }

            const auto report = cleanupUnusedProjectSidecarAssets(document, juce::File(projectPath));
            response->setProperty("report", makeSidecarCleanupReport(report));
            if (!report.ok())
                response->setProperty("error", "Some project sidecar assets could not be deleted.");
            return juce::var(response.get());
        }

        if (kind == PROJECT_EXPORT_STATUS)
        {
            joinFinishedExportThreadIfNeeded();
            std::shared_ptr<ExportJob> job;
            {
                const std::lock_guard<std::mutex> lock(exportJobLock);
                job = activeExportJob;
            }
            return exportJobStatusVar(job);
        }

        if (kind == PROJECT_EXPORT_CANCEL)
        {
            std::shared_ptr<ExportJob> job;
            {
                const std::lock_guard<std::mutex> lock(exportJobLock);
                job = activeExportJob;
                if (job)
                    job->cancel.store(true, std::memory_order_release);
            }
            return exportJobStatusVar(job);
        }

        if (kind == PROJECT_EXPORT_WAV_ASYNC
            || kind == PROJECT_EXPORT_TRACK_WAV_ASYNC
            || kind == PROJECT_EXPORT_RANGE_WAV_ASYNC
            || kind == PROJECT_EXPORT_ALL_TRACK_WAVS_ASYNC)
        {
            const bool exportTrack = kind == PROJECT_EXPORT_TRACK_WAV_ASYNC;
            const bool exportRange = kind == PROJECT_EXPORT_RANGE_WAV_ASYNC;
            const bool exportAllStems = kind == PROJECT_EXPORT_ALL_TRACK_WAVS_ASYNC;
            const juce::String exportType = exportAllStems ? "stems" : (exportTrack ? "track" : (exportRange ? "range" : "project"));

            joinFinishedExportThreadIfNeeded();
            {
                const std::lock_guard<std::mutex> lock(exportJobLock);
                if (activeExportJob && !activeExportJob->finished.load(std::memory_order_acquire))
                {
                    juce::DynamicObject::Ptr response = new juce::DynamicObject();
                    response->setProperty("job", exportJobStatusVar(activeExportJob));
                    response->setProperty("error", "An export is already running.");
                    return juce::var(response.get());
                }
            }

            auto pathHint = payload.getProperty("pathHint", {}).toString();
            auto start = pathHint.isNotEmpty()
                ? juce::File(pathHint)
                : juce::File::getSpecialLocation(juce::File::userDocumentsDirectory)
                    .getChildFile(exportAllStems ? "Beat Stems"
                                                 : (exportTrack ? "Beat Track Export.wav"
                                                                : (exportRange ? "Beat Range Export.wav" : "Beat Export.wav")));

            juce::FileChooser chooser(exportAllStems ? "Export All Track Stems"
                                                     : (exportTrack ? "Export Track WAV"
                                                                    : (exportRange ? "Export Range WAV" : "Export WAV")),
                                      start,
                                      "*.wav",
                                      true);
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const bool choseDestination = exportAllStems
                ? chooser.browseForDirectory()
                : chooser.browseForFileToSave(true);
            if (!choseDestination)
            {
                response->setProperty("started", false);
                response->setProperty("job", exportJobStatusVar(nullptr));
                return juce::var(response.get());
            }

            auto file = chooser.getResult();
            if (!exportAllStems && !file.hasFileExtension(".wav"))
                file = file.withFileExtension(".wav");

            const auto projectPayload = payload.getProperty("project", {});
            if (!projectPayload.isObject())
            {
                response->setProperty("started", false);
                response->setProperty("error", "No project payload was provided for export.");
                response->setProperty("job", exportJobStatusVar(nullptr));
                return juce::var(response.get());
            }

            const auto instrumentsPayload = payload.getProperty("instruments", {});
            const auto audioFilesPayload = payload.getProperty("audioFiles", {});
            const auto missingAssets = collectMissingExportAssets(instrumentsPayload, audioFilesPayload);
            if (!missingAssets.isEmpty())
            {
                response->setProperty("started", false);
                response->setProperty("error", missingAssetExportError(missingAssets));
                response->setProperty("job", exportJobStatusVar(nullptr));
                return juce::var(response.get());
            }

            auto project = parseProjectFromFrontend(projectPayload,
                                                    instrumentsPayload,
                                                    audioFilesPayload);
            const auto trackId = payload.getProperty("trackId", {}).toString();
            if (exportTrack && trackId.isEmpty())
            {
                response->setProperty("started", false);
                response->setProperty("error", "No track was selected for export.");
                response->setProperty("job", exportJobStatusVar(nullptr));
                return juce::var(response.get());
            }
            std::vector<Track> stemTracks;
            if (exportAllStems)
            {
                for (const auto& track : project.tracks)
                {
                    if (track.kind != TrackKind::Group)
                        stemTracks.push_back(track);
                }

                if (stemTracks.empty())
                {
                    response->setProperty("started", false);
                    response->setProperty("error", "There are no renderable tracks to export as stems.");
                    response->setProperty("job", exportJobStatusVar(nullptr));
                    return juce::var(response.get());
                }

                if (!file.exists() && !file.createDirectory())
                {
                    response->setProperty("started", false);
                    response->setProperty("error", "Could not create stem export folder.");
                    response->setProperty("job", exportJobStatusVar(nullptr));
                    return juce::var(response.get());
                }
            }

            const auto startBeat = static_cast<Beats>(payload.getProperty("startBeat", 0.0));
            const auto endBeat = static_cast<Beats>(payload.getProperty("endBeat", 0.0));
            const bool includeTail = static_cast<bool>(payload.getProperty("includeTail", false));
            const auto renderOptions = parseExportRenderOptions(payload);
            if (exportRange && endBeat <= startBeat)
            {
                response->setProperty("started", false);
                response->setProperty("error", "Export range must have an end beat after its start beat.");
                response->setProperty("job", exportJobStatusVar(nullptr));
                return juce::var(response.get());
            }

            auto job = std::make_shared<ExportJob>();
            job->id = juce::Uuid().toString();
            job->type = exportType;
            job->path = file.getFullPathName();

            {
                const std::lock_guard<std::mutex> lock(exportJobLock);
                activeExportJob = job;
            }

            if (exportThread.joinable())
                exportThread.join();

            exportThread = std::thread([this,
                                        job,
                                        exportTrack,
                                        exportRange,
                                        exportAllStems,
                                        trackId,
                                        startBeat,
                                        endBeat,
                                        includeTail,
                                        renderOptions,
                                        stemTracks = std::move(stemTracks),
                                        project = std::move(project),
                                        file]() mutable
            {
                juce::int64 lastEmitMs = 0;
                emit(ipc::kind::EV_EXPORT_PROGRESS, exportJobStatusVar(job));

                juce::String error;
                const auto progress = [this, job, &lastEmitMs](double progressValue,
                                                               juce::int64 samplesWritten,
                                                               juce::int64 totalSamples)
                {
                    job->progress.store(juce::jlimit(0.0, 1.0, progressValue), std::memory_order_release);
                    job->samplesWritten.store(samplesWritten, std::memory_order_release);
                    job->totalSamples.store(totalSamples, std::memory_order_release);

                    const auto now = juce::Time::currentTimeMillis();
                    if (now - lastEmitMs >= 100 || progressValue >= 1.0 || progressValue <= 0.0)
                    {
                        lastEmitMs = now;
                        emit(ipc::kind::EV_EXPORT_PROGRESS, exportJobStatusVar(job));
                    }

                    return !job->cancel.load(std::memory_order_acquire);
                };

                bool exported = false;
                if (exportAllStems)
                {
                    juce::StringArray usedStemNames;
                    const int trackCount = (int) stemTracks.size();
                    bool ok = trackCount > 0;
                    job->totalSamples.store(trackCount, std::memory_order_release);

                    for (int i = 0; ok && i < trackCount; ++i)
                    {
                        if (job->cancel.load(std::memory_order_acquire))
                        {
                            error = "Export cancelled.";
                            ok = false;
                            break;
                        }

                        const auto track = stemTracks[(size_t) i];
                        const auto stemFile = uniqueStemExportFile(file, track.name, i, usedStemNames);
                        const double batchBase = trackCount > 0 ? (double) i / (double) trackCount : 0.0;
                        const double batchSpan = trackCount > 0 ? 1.0 / (double) trackCount : 1.0;
                        juce::String trackError;
                        const auto trackProgress = [this, job, &lastEmitMs, batchBase, batchSpan, i, trackCount](
                                                        double progressValue,
                                                        juce::int64,
                                                        juce::int64)
                        {
                            const auto mappedProgress = juce::jlimit(0.0, 1.0, batchBase + batchSpan * progressValue);
                            job->progress.store(mappedProgress, std::memory_order_release);
                            job->samplesWritten.store(i, std::memory_order_release);
                            job->totalSamples.store(trackCount, std::memory_order_release);

                            const auto now = juce::Time::currentTimeMillis();
                            if (now - lastEmitMs >= 100 || mappedProgress >= 1.0 || mappedProgress <= 0.0)
                            {
                                lastEmitMs = now;
                                emit(ipc::kind::EV_EXPORT_PROGRESS, exportJobStatusVar(job));
                            }

                            return !job->cancel.load(std::memory_order_acquire);
                        };

                        ok = AudioEngine::renderTrackToWav(project,
                                                           track.id,
                                                           stemFile,
                                                           renderOptions.sampleRate,
                                                           renderOptions.blockSize,
                                                           renderOptions.channels,
                                                           &trackError,
                                                           trackProgress,
                                                           renderOptions.bitDepth,
                                                           renderOptions.quality);
                        if (!ok)
                            error = track.name + ": " + trackError;
                        else
                            job->samplesWritten.store(i + 1, std::memory_order_release);
                    }

                    exported = ok;
                }
                else if (exportTrack)
                {
                    exported = AudioEngine::renderTrackToWav(std::move(project),
                                                             trackId,
                                                             file,
                                                             renderOptions.sampleRate,
                                                             renderOptions.blockSize,
                                                             renderOptions.channels,
                                                             &error,
                                                             progress,
                                                             renderOptions.bitDepth,
                                                             renderOptions.quality);
                }
                else if (exportRange)
                {
                    exported = AudioEngine::renderProjectRangeToWav(std::move(project),
                                                                    startBeat,
                                                                    endBeat,
                                                                    file,
                                                                    includeTail,
                                                                    renderOptions.sampleRate,
                                                                    renderOptions.blockSize,
                                                                    renderOptions.channels,
                                                                    &error,
                                                                    progress,
                                                                    renderOptions.bitDepth,
                                                                    renderOptions.quality);
                }
                else
                {
                    exported = AudioEngine::renderProjectToWav(std::move(project),
                                                               file,
                                                               renderOptions.sampleRate,
                                                               renderOptions.blockSize,
                                                               renderOptions.channels,
                                                               &error,
                                                               progress,
                                                               renderOptions.bitDepth,
                                                               renderOptions.quality);
                }
                {
                    const std::lock_guard<std::mutex> statusLock(job->statusLock);
                    job->error = exported ? juce::String() : error;
                    if (exported)
                    {
                        if (auto analysis = AudioFileAnalyzer::analyzeFile(file))
                            job->analysis = makeAudioAnalysis(*analysis);
                    }
                }
                job->ok.store(exported, std::memory_order_release);
                job->progress.store(exported ? 1.0 : job->progress.load(std::memory_order_acquire), std::memory_order_release);
                job->finished.store(true, std::memory_order_release);
                emit(ipc::kind::EV_EXPORT_PROGRESS, exportJobStatusVar(job));
            });

            response->setProperty("started", true);
            response->setProperty("job", exportJobStatusVar(job));
            return juce::var(response.get());
        }

        if (kind == PROJECT_BOUNCE_TRACK_WAV)
        {
            auto pathHint = payload.getProperty("pathHint", {}).toString();
            auto start = pathHint.isNotEmpty()
                ? juce::File(pathHint)
                : juce::File::getSpecialLocation(juce::File::userDocumentsDirectory)
                    .getChildFile("Beat Track Bounce.wav");

            juce::FileChooser chooser("Bounce Track To WAV", start, "*.wav", true);
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            if (!chooser.browseForFileToSave(true))
            {
                response->setProperty("path", juce::String());
                return juce::var(response.get());
            }

            auto file = chooser.getResult();
            if (!file.hasFileExtension(".wav"))
                file = file.withFileExtension(".wav");

            const auto projectPayload = payload.getProperty("project", {});
            if (!projectPayload.isObject())
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", "No project payload was provided for track bounce.");
                return juce::var(response.get());
            }

            const auto instrumentsPayload = payload.getProperty("instruments", {});
            auto audioFilesPayload = payload.getProperty("audioFiles", {});
            if (!audioFilesPayload.isArray())
                audioFilesPayload = projectPayload.getProperty("audioFiles", {});
            const auto missingAssets = collectMissingExportAssets(instrumentsPayload, audioFilesPayload);
            if (!missingAssets.isEmpty())
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", missingAssetExportError(missingAssets));
                return juce::var(response.get());
            }

            auto project = parseProjectFromFrontend(projectPayload,
                                                    instrumentsPayload,
                                                    audioFilesPayload);
            const auto trackId = payload.getProperty("trackId", {}).toString();
            if (trackId.isEmpty())
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", "No track was selected for bounce.");
                return juce::var(response.get());
            }

            const auto renderOptions = parseExportRenderOptions(payload);
            juce::String error;
            const bool rendered = AudioEngine::renderTrackToWav(project,
                                                                trackId,
                                                                file,
                                                                renderOptions.sampleRate,
                                                                renderOptions.blockSize,
                                                                renderOptions.channels,
                                                                &error,
                                                                {},
                                                                renderOptions.bitDepth,
                                                                renderOptions.quality);
            if (!rendered)
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", error);
                return juce::var(response.get());
            }

            const auto analysis = AudioFileAnalyzer::analyzeFile(file);
            if (!analysis.has_value() || analysis->durationSeconds <= 0.0 || analysis->sampleRate <= 0.0)
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", "Bounced WAV could not be analyzed.");
                return juce::var(response.get());
            }

            TrackBounceSpec bounceSpec;
            bounceSpec.sourceTrackId = trackId;
            bounceSpec.audioFilePath = file.getFullPathName();
            bounceSpec.audioFileName = file.getFileNameWithoutExtension();
            bounceSpec.durationSeconds = analysis->durationSeconds;
            bounceSpec.sampleRate = analysis->sampleRate;
            const auto bounceResult = applyTrackBounce(project, bounceSpec, &error);
            if (!bounceResult.has_value())
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", error);
                return juce::var(response.get());
            }

            const auto audioFileIt = std::find_if(project.audioFiles.begin(),
                                                  project.audioFiles.end(),
                                                  [&bounceResult](const AudioFileAsset& audioFile)
                                                  {
                                                      return audioFile.id == bounceResult->audioFileId;
                                                  });
            const auto trackIt = std::find_if(project.tracks.begin(),
                                              project.tracks.end(),
                                              [&bounceResult](const Track& track)
                                              {
                                                  return track.id == bounceResult->bouncedTrackId;
                                              });
            if (audioFileIt == project.audioFiles.end() || trackIt == project.tracks.end())
            {
                response->setProperty("path", juce::String());
                response->setProperty("error", "Bounced project update could not be serialized.");
                return juce::var(response.get());
            }

            response->setProperty("path", file.getFullPathName());
            response->setProperty("sourceTrackId", bounceResult->sourceTrackId);
            response->setProperty("audioFile", makeAudioFileAssetVar(*audioFileIt, analysis));
            response->setProperty("track", makeBouncedTrackVar(*trackIt));
            response->setProperty("analysis", makeAudioAnalysis(*analysis));
            return juce::var(response.get());
        }

        if (kind == PROJECT_EXPORT_WAV || kind == PROJECT_EXPORT_TRACK_WAV || kind == PROJECT_EXPORT_RANGE_WAV)
        {
            auto pathHint = payload.getProperty("pathHint", {}).toString();
            const bool exportTrack = kind == PROJECT_EXPORT_TRACK_WAV;
            const bool exportRange = kind == PROJECT_EXPORT_RANGE_WAV;
            auto start = pathHint.isNotEmpty()
                ? juce::File(pathHint)
                : juce::File::getSpecialLocation(juce::File::userDocumentsDirectory)
                    .getChildFile(exportTrack ? "Beat Track Export.wav"
                                              : (exportRange ? "Beat Range Export.wav" : "Beat Export.wav"));

            juce::FileChooser chooser(exportTrack ? "Export Track WAV"
                                                  : (exportRange ? "Export Range WAV" : "Export WAV"),
                                      start,
                                      "*.wav",
                                      true);
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            if (chooser.browseForFileToSave(true))
            {
                auto file = chooser.getResult();
                if (!file.hasFileExtension(".wav"))
                    file = file.withFileExtension(".wav");

                const auto projectPayload = payload.getProperty("project", {});
                if (!projectPayload.isObject())
                {
                    response->setProperty("path", juce::String());
                    response->setProperty("error", "No project payload was provided for export.");
                    return juce::var(response.get());
                }

                const auto instrumentsPayload = payload.getProperty("instruments", {});
                const auto audioFilesPayload = payload.getProperty("audioFiles", {});
                const auto missingAssets = collectMissingExportAssets(instrumentsPayload, audioFilesPayload);
                if (!missingAssets.isEmpty())
                {
                    response->setProperty("path", juce::String());
                    response->setProperty("error", missingAssetExportError(missingAssets));
                    return juce::var(response.get());
                }

                auto project = parseProjectFromFrontend(projectPayload,
                                                        instrumentsPayload,
                                                        audioFilesPayload);
                juce::String error;
                const auto trackId = payload.getProperty("trackId", {}).toString();
                if (exportTrack && trackId.isEmpty())
                {
                    response->setProperty("path", juce::String());
                    response->setProperty("error", "No track was selected for export.");
                    return juce::var(response.get());
                }

                const auto startBeat = static_cast<Beats>(payload.getProperty("startBeat", 0.0));
                const auto endBeat = static_cast<Beats>(payload.getProperty("endBeat", 0.0));
                const bool includeTail = static_cast<bool>(payload.getProperty("includeTail", false));
                const auto renderOptions = parseExportRenderOptions(payload);
                bool exported = false;
                if (exportTrack)
                {
                    exported = AudioEngine::renderTrackToWav(std::move(project),
                                                             trackId,
                                                             file,
                                                             renderOptions.sampleRate,
                                                             renderOptions.blockSize,
                                                             renderOptions.channels,
                                                             &error,
                                                             {},
                                                             renderOptions.bitDepth,
                                                             renderOptions.quality);
                }
                else if (exportRange)
                {
                    if (endBeat <= startBeat)
                    {
                        response->setProperty("path", juce::String());
                        response->setProperty("error", "Export range must have an end beat after its start beat.");
                        return juce::var(response.get());
                    }
                    exported = AudioEngine::renderProjectRangeToWav(std::move(project),
                                                                    startBeat,
                                                                    endBeat,
                                                                    file,
                                                                    includeTail,
                                                                    renderOptions.sampleRate,
                                                                    renderOptions.blockSize,
                                                                    renderOptions.channels,
                                                                    &error,
                                                                    {},
                                                                    renderOptions.bitDepth,
                                                                    renderOptions.quality);
                }
                else
                {
                    exported = AudioEngine::renderProjectToWav(std::move(project),
                                                               file,
                                                               renderOptions.sampleRate,
                                                               renderOptions.blockSize,
                                                               renderOptions.channels,
                                                               &error,
                                                               {},
                                                               renderOptions.bitDepth,
                                                               renderOptions.quality);
                }

                if (exported)
                {
                    response->setProperty("path", file.getFullPathName());
                    if (auto analysis = AudioFileAnalyzer::analyzeFile(file))
                        response->setProperty("analysis", makeAudioAnalysis(*analysis));
                }
                else
                {
                    response->setProperty("path", juce::String());
                    response->setProperty("error", error);
                }
            }
            else
            {
                response->setProperty("path", juce::String());
            }
            return juce::var(response.get());
        }

        if (kind == INSTRUMENT_RENDER_PREVIEW)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto instrumentPayload = payload.getProperty("instrument", {});
            if (!instrumentPayload.isObject())
            {
                response->setProperty("error", "Instrument preview requires an instrument payload.");
                return juce::var(response.get());
            }

            juce::Array<juce::var> instruments;
            instruments.add(instrumentPayload);
            const auto missingAssets = collectMissingExportAssets(juce::var(instruments), {});
            if (!missingAssets.isEmpty())
            {
                response->setProperty("error", missingAssetExportError(missingAssets));
                return juce::var(response.get());
            }

            const auto instrumentId = instrumentPayload.getProperty("id", "preview-instrument").toString();
            const auto note = juce::jlimit(0, 127, (int) payload.getProperty("note", 60));
            const auto velocity = juce::jlimit(1, 127, (int) payload.getProperty("velocity", 100));
            const auto bpm = juce::jlimit(30.0, 300.0, (double) payload.getProperty("bpm", 120.0));
            const auto durationBeats = juce::jlimit(0.25, 16.0, (double) payload.getProperty("durationBeats", 2.0));
            const auto bucketCount = juce::jlimit(1, 4096, (int) payload.getProperty("bucketCount", 256));
            const bool includeAudio = static_cast<bool>(payload.getProperty("includeAudio", false));

            juce::DynamicObject::Ptr noteObject = new juce::DynamicObject();
            noteObject->setProperty("pitch", note);
            noteObject->setProperty("velocity", velocity);
            noteObject->setProperty("startBeat", 0.0);
            noteObject->setProperty("lengthBeats", durationBeats);
            juce::Array<juce::var> notes;
            notes.add(juce::var(noteObject.get()));

            juce::DynamicObject::Ptr payloadObject = new juce::DynamicObject();
            payloadObject->setProperty("kind", "midi");
            payloadObject->setProperty("notes", notes);

            juce::DynamicObject::Ptr segmentObject = new juce::DynamicObject();
            segmentObject->setProperty("id", "preview-segment");
            segmentObject->setProperty("startBeat", 0.0);
            segmentObject->setProperty("lengthBeats", durationBeats);
            segmentObject->setProperty("instrumentId", instrumentId);
            segmentObject->setProperty("payload", juce::var(payloadObject.get()));
            juce::Array<juce::var> segments;
            segments.add(juce::var(segmentObject.get()));

            juce::DynamicObject::Ptr trackObject = new juce::DynamicObject();
            trackObject->setProperty("id", "preview-track");
            trackObject->setProperty("name", "Preview");
            trackObject->setProperty("kind", "midi");
            trackObject->setProperty("instrumentId", instrumentId);
            trackObject->setProperty("segments", segments);
            juce::Array<juce::var> tracks;
            tracks.add(juce::var(trackObject.get()));

            juce::DynamicObject::Ptr projectObject = new juce::DynamicObject();
            projectObject->setProperty("id", "preview-project");
            projectObject->setProperty("name", "Instrument Preview");
            projectObject->setProperty("bpm", bpm);
            projectObject->setProperty("lengthBeats", durationBeats);
            projectObject->setProperty("tracks", tracks);

            auto project = parseProjectFromFrontend(juce::var(projectObject.get()), juce::var(instruments), {});
            const auto previewFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                .getChildFile("BeatInstrumentPreview-" + juce::Uuid().toString() + ".wav");
            if (previewFile.existsAsFile())
                previewFile.deleteFile();

            juce::String error;
            const bool rendered = AudioEngine::renderProjectToWav(std::move(project),
                                                                  previewFile,
                                                                  44100.0,
                                                                  512,
                                                                  2,
                                                                  &error);
            if (!rendered)
            {
                previewFile.deleteFile();
                response->setProperty("error", error.isNotEmpty() ? error : "Instrument preview render failed.");
                return juce::var(response.get());
            }

            if (auto analysis = AudioFileAnalyzer::analyzeFile(previewFile))
                response->setProperty("analysis", makeAudioAnalysis(*analysis));

            if (auto waveform = AudioFileAnalyzer::analyzeWaveformFile(previewFile, bucketCount))
                response->setProperty("waveform", makeWaveformSummary(*waveform));
            else
                response->setProperty("waveform", juce::var());

            if (includeAudio)
            {
                auto audioDataUrl = makeWavDataUrl(previewFile);
                if (audioDataUrl.isNotEmpty())
                    response->setProperty("audioDataUrl", audioDataUrl);
            }

            response->setProperty("durationBeats", durationBeats);
            response->setProperty("note", note);
            response->setProperty("velocity", velocity);
            previewFile.deleteFile();
            return juce::var(response.get());
        }

        if (kind == INSTRUMENT_IMPORT_DECENT)
        {
            auto pathHint = payload.getProperty("pathHint", {}).toString();
            auto start = pathHint.isNotEmpty() ? juce::File(pathHint) : juce::File();
            auto importRoot = defaultDecentSamplerImportRoot();
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            if (start.existsAsFile() || start.isDirectory())
            {
                auto presetFile = resolveDecentSamplerPreset(start, importRoot);
                auto preset = presetFile.existsAsFile() ? parseDecentSamplerPreset(presetFile) : std::nullopt;
                response->setProperty("preset", preset ? makeDecentSamplerImport(database, *preset) : juce::var());
                return juce::var(response.get());
            }

            juce::FileChooser chooser("Import Decent Sampler preset or pack", start, decentImportWildcard, true);
            if (! chooser.browseForFileToOpen())
            {
                response->setProperty("preset", juce::var());
                return juce::var(response.get());
            }

            auto presetFile = resolveDecentSamplerPreset(chooser.getResult(), importRoot);
            auto preset = presetFile.existsAsFile() ? parseDecentSamplerPreset(presetFile) : std::nullopt;
            response->setProperty("preset", preset ? makeDecentSamplerImport(database, *preset) : juce::var());
            return juce::var(response.get());
        }

        if (kind == INSTRUMENT_IMPORT_SFZ)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto projectPath = payload.getProperty("projectPath", {}).toString();
            if (projectPath.isEmpty())
            {
                response->setProperty("error", "Save the project to a .beat file before importing an SFZ instrument.");
                return juce::var(response.get());
            }

            auto pathHint = payload.getProperty("pathHint", {}).toString();
            juce::File selected;
            if (pathHint.isNotEmpty() && juce::File(pathHint).existsAsFile())
                selected = juce::File(pathHint);
            else
            {
                const auto start = pathHint.isNotEmpty() ? juce::File(pathHint) : juce::File();
                juce::FileChooser chooser("Import SFZ into Aether Sample Slot 1", start, sfzImportWildcard, true);
                if (!chooser.browseForFileToOpen())
                    return juce::var(response.get());
                selected = chooser.getResult();
            }

            const auto imported = importManagedSfzAsset(selected, juce::File(projectPath));
            if (!imported.ok())
            {
                response->setProperty("error", imported.error);
                juce::Array<juce::var> diagnostics;
                for (const auto& diagnostic : imported.diagnostics)
                {
                    juce::DynamicObject::Ptr item = new juce::DynamicObject();
                    item->setProperty("severity", diagnostic.severity == SfzDiagnosticSeverity::error ? "error" : "warning");
                    item->setProperty("code", diagnostic.code);
                    item->setProperty("message", diagnostic.message);
                    item->setProperty("line", diagnostic.line);
                    item->setProperty("column", diagnostic.column);
                    diagnostics.add(juce::var(item.get()));
                }
                response->setProperty("diagnostics", diagnostics);
                return juce::var(response.get());
            }

            juce::DynamicObject::Ptr managed = new juce::DynamicObject();
            managed->setProperty("schemaVersion", 1);
            managed->setProperty("assetId", imported.assetId);
            managed->setProperty("displayName", imported.displayName);
            managed->setProperty("manifestPath", resolveProjectRelativePath(juce::File(projectPath), imported.manifestPath));
            managed->setProperty("sourcePath", resolveProjectRelativePath(juce::File(projectPath), imported.sourcePath));
            juce::Array<juce::var> samplePaths;
            for (const auto& sample : imported.sampleFiles)
                samplePaths.add(resolveProjectRelativePath(juce::File(projectPath), sample.path));
            managed->setProperty("samplePaths", samplePaths);
            response->setProperty("managedSfz", juce::var(managed.get()));
            return juce::var(response.get());
        }

        if (kind == INSTRUMENT_IMPORT_GRANULAR)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto projectPath = payload.getProperty("projectPath", {}).toString();
            if (projectPath.isEmpty())
            {
                response->setProperty("error", "Save the project to a .beat file before importing granular audio.");
                return juce::var(response.get());
            }
            auto pathHint = payload.getProperty("pathHint", {}).toString();
            juce::File selected;
            if (pathHint.isNotEmpty() && juce::File(pathHint).existsAsFile())
                selected = juce::File(pathHint);
            else
            {
                const auto start = pathHint.isNotEmpty() ? juce::File(pathHint) : juce::File();
                juce::FileChooser chooser("Import audio into Aether Granular Slot 2", start, granularImportWildcard, true);
                if (!chooser.browseForFileToOpen()) return juce::var(response.get());
                selected = chooser.getResult();
            }
            const auto imported = importManagedGranularAsset(selected, juce::File(projectPath));
            if (!imported.ok())
            {
                response->setProperty("error", imported.error);
                return juce::var(response.get());
            }
            juce::DynamicObject::Ptr managed = new juce::DynamicObject();
            managed->setProperty("schemaVersion", 1);
            managed->setProperty("assetId", imported.assetId);
            managed->setProperty("displayName", imported.displayName);
            managed->setProperty("manifestPath", resolveProjectRelativePath(juce::File(projectPath), imported.manifestPath));
            managed->setProperty("audioPath", resolveProjectRelativePath(juce::File(projectPath), imported.audioPath));
            response->setProperty("managedGranular", juce::var(managed.get()));
            return juce::var(response.get());
        }

        if (kind == INSTRUMENT_RESYNTHESIZE_WAVEMAP)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto audioFile = payload.getProperty("audioFile", {});
            if (! audioFile.isObject())
            {
                response->setProperty("error", "Wavemap resynthesis requires an audio file.");
                return juce::var(response.get());
            }

            const auto path = audioFile.getProperty("path", {}).toString();
            const auto file = juce::File(path);
            if (path.isEmpty() || ! file.existsAsFile())
            {
                response->setProperty("error", "Wavemap resynthesis requires an existing audio file path.");
                return juce::var(response.get());
            }

            auto wavemap = makeWavemapFromAudioFile(file,
                                                    audioFile.getProperty("id", {}).toString(),
                                                    payload.getProperty("wavemapId", {}).toString(),
                                                    payload.getProperty("name", {}).toString(),
                                                    payload.getProperty("selection", {}));
            if (wavemap.isVoid())
            {
                response->setProperty("error", "Audio file could not be decoded for wavemap resynthesis.");
                return juce::var(response.get());
            }

            response->setProperty("wavemap", wavemap);
            return juce::var(response.get());
        }

        if (kind == AUDIO_IMPORT)
        {
            auto pathHint = payload.getProperty("pathHint", {}).toString();
            auto start = pathHint.isNotEmpty() ? juce::File(pathHint) : juce::File();
            if (start.existsAsFile())
                start = start.getParentDirectory();

            juce::FileChooser chooser("Import audio", start, audioImportWildcard, true);
            if (! chooser.browseForFileToOpen())
            {
                juce::DynamicObject::Ptr response = new juce::DynamicObject();
                response->setProperty("file", juce::var());
                return juce::var(response.get());
            }

            auto response = makeAudioFileResponse(importAudioFileIntoLibrary(chooser.getResult()));
            saveAudioFile(database, response.getProperty("file", {}));
            return response;
        }

        if (kind == AUDIO_IMPORT_MANY)
        {
            auto pathHint = payload.getProperty("pathHint", {}).toString();
            auto start = pathHint.isNotEmpty() ? juce::File(pathHint) : juce::File();
            if (start.existsAsFile())
                start = start.getParentDirectory();

            juce::FileChooser chooser("Import audio", start, audioImportWildcard, true);
            juce::Array<juce::File> results;
            if (chooser.browseForMultipleFilesToOpen())
                results = chooser.getResults();

            juce::Array<juce::var> files;
            for (const auto& file : results)
            {
                auto audioFile = makeAudioFile(importAudioFileIntoLibrary(file));
                if (! audioFile.isVoid())
                {
                    saveAudioFile(database, audioFile);
                    files.add(audioFile);
                }
            }

            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            response->setProperty("files", files);
            return juce::var(response.get());
        }

        if (kind == AUDIO_LIST)
        {
            juce::Array<juce::var> files;
            {
                Statement stmt(database, R"sql(
                    SELECT id, name, path, duration_s, sample_rate, bit_depth, size_bytes, imported_at,
                           left_peak_dbfs, right_peak_dbfs, true_peak_dbtp, rms_dbfs, crest_factor_db,
                           dc_offset, clipping_count, clipping_ratio, stereo_correlation, integrated_lufs
                    FROM audio_files
                    ORDER BY name ASC
                )sql");
                while (stmt.step())
                {
                    juce::DynamicObject::Ptr audioFile = new juce::DynamicObject();
                    const auto setNullableDoubleColumn = [&](const char* name, int col)
                    {
                        if (! stmt.columnIsNull(col))
                            audioFile->setProperty(name, stmt.columnDouble(col));
                    };

                    audioFile->setProperty("id", stmt.columnText(0));
                    audioFile->setProperty("name", stmt.columnText(1));
                    audioFile->setProperty("path", stmt.columnText(2));
                    audioFile->setProperty("durationSeconds", stmt.columnDouble(3));
                    audioFile->setProperty("sampleRate", stmt.columnInt(4));
                    audioFile->setProperty("bitDepth", stmt.columnInt(5));
                    audioFile->setProperty("sizeBytes", stmt.columnDouble(6));
                    audioFile->setProperty("importedAt", stmt.columnDouble(7));
                    setNullableDoubleColumn("leftPeakDbFS", 8);
                    setNullableDoubleColumn("rightPeakDbFS", 9);
                    setNullableDoubleColumn("truePeakDbTP", 10);
                    setNullableDoubleColumn("rmsDbFS", 11);
                    setNullableDoubleColumn("crestFactorDb", 12);
                    setNullableDoubleColumn("dcOffset", 13);
                    audioFile->setProperty("clippingCount", stmt.columnInt(14));
                    setNullableDoubleColumn("clippingRatio", 15);
                    setNullableDoubleColumn("stereoCorrelation", 16);
                    setNullableDoubleColumn("integratedLufs", 17);

                    const bool hasAnalysis = !stmt.columnIsNull(8)
                        || !stmt.columnIsNull(9)
                        || !stmt.columnIsNull(10)
                        || !stmt.columnIsNull(11)
                        || !stmt.columnIsNull(12)
                        || !stmt.columnIsNull(16)
                        || !stmt.columnIsNull(17);
                    auto audioFileVar = juce::var(audioFile.get());
                    if (audioFileNeedsMetadataRefresh(audioFileVar, hasAnalysis))
                        audioFileVar = refreshAudioFileMetadata(audioFileVar);
                    files.add(audioFileVar);
                }
            }

            for (const auto& file : files)
                saveAudioFile(database, file);

            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            response->setProperty("files", files);
            return juce::var(response.get());
        }

        if (kind == AUDIO_WAVEFORM)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto path = payload.getProperty("path", {}).toString();
            const auto bucketCount = juce::jlimit(1, 4096, (int) payload.getProperty("bucketCount", 256));
            const auto file = juce::File(path);
            if (path.isEmpty() || !file.existsAsFile())
            {
                response->setProperty("waveform", juce::var());
                response->setProperty("error", "Audio waveform requires an existing file path.");
                return juce::var(response.get());
            }

            const auto modifiedMs = file.getLastModificationTime().toMilliseconds();
            const auto sizeBytes = file.getSize();
            for (const auto& cached : waveformCache)
            {
                if (cached.path == path
                    && cached.bucketCount == bucketCount
                    && cached.modifiedMs == modifiedMs
                    && cached.sizeBytes == sizeBytes)
                {
                    response->setProperty("waveform", cached.waveform);
                    response->setProperty("cached", true);
                    return juce::var(response.get());
                }
            }

            if (auto waveform = AudioFileAnalyzer::analyzeWaveformFile(file, bucketCount))
            {
                auto waveformVar = makeWaveformSummary(*waveform);
                response->setProperty("waveform", waveformVar);
                response->setProperty("cached", false);

                waveformCache.push_back({ path, modifiedMs, sizeBytes, bucketCount, waveformVar });
                constexpr size_t maxWaveformCacheEntries = 64;
                if (waveformCache.size() > maxWaveformCacheEntries)
                    waveformCache.erase(waveformCache.begin(), waveformCache.begin() + (waveformCache.size() - maxWaveformCacheEntries));
            }
            else
            {
                response->setProperty("waveform", juce::var());
                response->setProperty("error", "Audio waveform could not be decoded.");
            }
            return juce::var(response.get());
        }

        if (kind == AUDIO_LIST_DEVICES)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            response->setProperty("snapshot", makeAudioDeviceSnapshotVar(engine.listAudioDevices()));
            return juce::var(response.get());
        }

        if (kind == AUDIO_SELECT_INPUT_DEVICE)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto typeName = payload.getProperty("typeName", {}).toString();
            const auto deviceName = payload.getProperty("deviceName", {}).toString();
            const auto inputChannels = juce::jlimit(1, 32, (int) payload.getProperty("inputChannelCount", 2));

            if (deviceName.isEmpty())
            {
                response->setProperty("ok", false);
                response->setProperty("error", "No input device was selected.");
                response->setProperty("snapshot", makeAudioDeviceSnapshotVar(engine.listAudioDevices()));
                return juce::var(response.get());
            }

            juce::String error;
            const bool ok = engine.selectInputDevice(typeName, deviceName, inputChannels, &error);
            response->setProperty("ok", ok);
            if (!ok)
                response->setProperty("error", error.isNotEmpty() ? error : "Could not select input device.");
            response->setProperty("snapshot", makeAudioDeviceSnapshotVar(engine.listAudioDevices()));
            return juce::var(response.get());
        }

        if (kind == AUDIO_SELECT_OUTPUT_DEVICE)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto typeName = payload.getProperty("typeName", {}).toString();
            const auto deviceName = payload.getProperty("deviceName", {}).toString();

            if (deviceName.isEmpty())
            {
                response->setProperty("ok", false);
                response->setProperty("error", "No output device was selected.");
                response->setProperty("snapshot", makeAudioDeviceSnapshotVar(engine.listAudioDevices()));
                return juce::var(response.get());
            }

            juce::String error;
            const bool ok = engine.selectOutputDevice(typeName, deviceName, &error);
            response->setProperty("ok", ok);
            if (!ok)
                response->setProperty("error", error.isNotEmpty() ? error : "Could not select output device.");
            response->setProperty("snapshot", makeAudioDeviceSnapshotVar(engine.listAudioDevices()));
            return juce::var(response.get());
        }

        if (kind == RECORDING_PLAN)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto projectPayload = payload.getProperty("project", {});
            if (!projectPayload.isObject())
            {
                response->setProperty("plan", juce::var());
                response->setProperty("error", "Recording plan requires a project payload.");
                return juce::var(response.get());
            }

            const auto project = parseProjectFromFrontend(projectPayload,
                                                          payload.getProperty("instruments", {}),
                                                          payload.getProperty("audioFiles", {}));
            RecordingSessionSpec spec;
            spec.trackId = payload.getProperty("trackId", {}).toString();
            spec.requestedStartBeat = (double) payload.getProperty("startBeat", 0.0);
            spec.countInBeats = (double) payload.getProperty("countInBeats", 0.0);
            spec.bpm = (double) payload.getProperty("bpm", project.bpm);
            const auto deviceSnapshot = engine.listAudioDevices(false);
            const auto fallbackSampleRate = deviceSnapshot.sampleRate > 0.0 ? deviceSnapshot.sampleRate : 44100.0;
            spec.sampleRate = (double) payload.getProperty("sampleRate", fallbackSampleRate);
            spec.maxDurationSeconds = (double) payload.getProperty("maxDurationSeconds", 60.0);
            spec.inputChannels = juce::jlimit(1, 32, (int) payload.getProperty("inputChannels", 2));
            spec.requireRecordArm = (bool) payload.getProperty("requireRecordArm", true);

            juce::String error;
            const auto plan = planRecordingSession(project, spec, &error);
            response->setProperty("plan", plan ? makeRecordingSessionPlanVar(*plan) : juce::var());
            if (!plan)
                response->setProperty("error", error.isNotEmpty() ? error : "Recording session could not be planned.");
            return juce::var(response.get());
        }

        if (kind == RECORDING_PREPARE)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            juce::String error;
            const auto maxDurationSeconds = juce::jlimit(0.01, 60.0 * 60.0, (double) payload.getProperty("maxDurationSeconds", 60.0));
            const auto inputChannels = juce::jlimit(1, 32, (int) payload.getProperty("inputChannels", 2));
            const bool ok = engine.prepareInputRecording(maxDurationSeconds, inputChannels, &error);
            response->setProperty("ok", ok);
            response->setProperty("stats", makeRecordingCaptureStatsVar(engine.inputRecordingStats()));
            if (!ok)
                response->setProperty("error", error.isNotEmpty() ? error : "Could not prepare input recording.");
            return juce::var(response.get());
        }

        if (kind == RECORDING_START)
        {
            engine.startInputRecording();
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            response->setProperty("stats", makeRecordingCaptureStatsVar(engine.inputRecordingStats()));
            return juce::var(response.get());
        }

        if (kind == RECORDING_STOP)
        {
            const auto stats = engine.stopInputRecording();
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            response->setProperty("stats", makeRecordingCaptureStatsVar(stats));
            return juce::var(response.get());
        }

        if (kind == RECORDING_CANCEL)
        {
            engine.cancelInputRecording();
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            response->setProperty("stats", makeRecordingCaptureStatsVar(engine.inputRecordingStats()));
            return juce::var(response.get());
        }

        if (kind == RECORDING_STATUS)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            response->setProperty("stats", makeRecordingCaptureStatsVar(engine.inputRecordingStats()));
            return juce::var(response.get());
        }

        if (kind == RECORDING_WRITE_WAV)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto pathHint = payload.getProperty("pathHint", {}).toString();
            if (pathHint.trim().isEmpty())
            {
                response->setProperty("path", juce::String());
                response->setProperty("stats", makeRecordingCaptureStatsVar(engine.inputRecordingStats()));
                response->setProperty("error", "Recording write requires an output path.");
                return juce::var(response.get());
            }

            juce::String error;
            const auto bitDepth = normalizeExportBitDepth((int) payload.getProperty("bitDepth", 24));
            const juce::File outputFile(pathHint);
            const bool ok = engine.writeInputRecordingToWav(outputFile, &error, bitDepth);
            response->setProperty("path", ok ? outputFile.getFullPathName() : juce::String());
            response->setProperty("stats", makeRecordingCaptureStatsVar(engine.inputRecordingStats()));
            if (ok)
            {
                if (auto analysis = AudioFileAnalyzer::analyzeFile(outputFile))
                    response->setProperty("analysis", makeAudioAnalysis(*analysis));
            }
            else
            {
                response->setProperty("error", error.isNotEmpty() ? error : "Could not write recorded WAV.");
            }
            return juce::var(response.get());
        }

        if (kind == RECORDING_COMMIT_TAKE)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto projectPayload = payload.getProperty("project", {});
            const auto pathHint = payload.getProperty("pathHint", {}).toString();
            if (!projectPayload.isObject())
            {
                response->setProperty("error", "Recording commit requires a project payload.");
                response->setProperty("stats", makeRecordingCaptureStatsVar(engine.inputRecordingStats()));
                return juce::var(response.get());
            }
            if (pathHint.trim().isEmpty())
            {
                response->setProperty("error", "Recording commit requires an output path.");
                response->setProperty("stats", makeRecordingCaptureStatsVar(engine.inputRecordingStats()));
                return juce::var(response.get());
            }

            auto project = parseProjectFromFrontend(projectPayload,
                                                    payload.getProperty("instruments", {}),
                                                    payload.getProperty("audioFiles", {}));
            RecordedTakeSpec spec;
            spec.trackId = payload.getProperty("trackId", {}).toString();
            spec.trackName = payload.getProperty("trackName", "Recorded Audio").toString();
            spec.audioFileId = payload.getProperty("audioFileId", {}).toString();
            spec.segmentId = payload.getProperty("segmentId", {}).toString();
            spec.name = payload.getProperty("name", juce::File(pathHint).getFileNameWithoutExtension()).toString();
            spec.startBeat = (double) payload.getProperty("startBeat", 0.0);
            spec.bpm = (double) payload.getProperty("bpm", project.bpm);
            spec.gainDb = (float) (double) payload.getProperty("gainDb", 0.0);
            spec.compensateLatency = (bool) payload.getProperty("compensateLatency", true);
            spec.inputLatencySamples = (int) payload.getProperty("inputLatencySamples", 0);
            spec.outputLatencySamples = (int) payload.getProperty("outputLatencySamples", 0);
            spec.manualLatencySamples = (int) payload.getProperty("manualLatencySamples", 0);

            juce::String error;
            const auto bitDepth = normalizeExportBitDepth((int) payload.getProperty("bitDepth", 24));
            const auto result = commitRecordedCapture(project, engine.inputRecordingCapture(), juce::File(pathHint), spec, &error, bitDepth);
            response->setProperty("stats", makeRecordingCaptureStatsVar(engine.inputRecordingStats()));
            if (!result)
            {
                response->setProperty("error", error.isNotEmpty() ? error : "Could not commit recorded take.");
                return juce::var(response.get());
            }

            const auto audioIt = std::find_if(project.audioFiles.begin(),
                                              project.audioFiles.end(),
                                              [&result](const AudioFileAsset& audioFile) { return audioFile.id == result->audioFileId; });
            const auto trackIt = std::find_if(project.tracks.begin(),
                                              project.tracks.end(),
                                              [&result](const Track& track) { return track.id == result->trackId; });

            response->setProperty("path", juce::File(pathHint).getFullPathName());
            response->setProperty("trackId", result->trackId);
            response->setProperty("audioFileId", result->audioFileId);
            response->setProperty("segmentId", result->segmentId);
            response->setProperty("lengthBeats", result->lengthBeats);
            const auto analysis = AudioFileAnalyzer::analyzeFile(juce::File(pathHint));
            if (audioIt != project.audioFiles.end())
            {
                auto audioFileVar = makeAudioFileAssetVar(*audioIt, analysis);
                response->setProperty("audioFile", audioFileVar);
                saveAudioFile(database, audioFileVar);
            }
            if (trackIt != project.tracks.end())
                response->setProperty("track", makeBouncedTrackVar(*trackIt));
            if (analysis)
                response->setProperty("analysis", makeAudioAnalysis(*analysis));
            return juce::var(response.get());
        }

        if (kind == AUDIO_DELETE)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const bool deleteFiles = (bool) payload.getProperty("deleteFiles", true);
            juce::StringArray idsToDelete;

            if (auto* ids = payload.getProperty("ids", {}).getArray())
            {
                for (const auto& idVar : *ids)
                {
                    const auto id = idVar.toString();
                    if (id.isNotEmpty())
                        idsToDelete.addIfNotAlreadyThere(id);
                }
            }

            const auto result = deleteAudioFileLibraryEntries(database, idsToDelete, deleteFiles, audioLibraryDirectory());
            response->setProperty("deletedIds", makeStringArrayVar(result.deletedIds));
            response->setProperty("failedIds", makeStringArrayVar(result.failedIds));
            response->setProperty("failedPaths", makeStringArrayVar(result.failedPaths));
            if (!result.failedIds.isEmpty())
                response->setProperty("error", "Some audio files could not be deleted.");
            return juce::var(response.get());
        }

        if (kind == AUDIO_REVEAL)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            const auto path = payload.getProperty("path", {}).toString();
            if (path.isEmpty())
            {
                response->setProperty("ok", false);
                response->setProperty("error", "No audio file path was provided.");
                return juce::var(response.get());
            }

            const juce::File file(path);
            if (file.exists())
            {
                file.revealToUser();
                response->setProperty("ok", true);
                return juce::var(response.get());
            }

            const auto parent = file.getParentDirectory();
            if (parent.exists())
            {
                parent.revealToUser();
                response->setProperty("ok", true);
                return juce::var(response.get());
            }

            response->setProperty("ok", false);
            response->setProperty("error", "This audio file is no longer available on disk.");
            return juce::var(response.get());
        }

        if (kind == EQ_SET_AUTOMATION)
        {
            std::vector<EqAutomationPoint> pts;
            if (auto* a = payload.getProperty("points", {}).getArray())
            {
                for (const auto& v : *a)
                {
                    if (v.isObject())
                        pts.push_back(parseEqAutomationPoint(v));
                }
            }
            engine.setEqAutomation(std::move(pts));
            return juce::var(true);
        }

        if (kind == TRAINING_RUN)
        {
            const auto task = payload.getProperty("task", {}).toString();
            const auto jsonl = payload.getProperty("jsonl", {}).toString();
            const auto signalCount = (int) payload.getProperty("signalCount", 0);
            const auto scriptName = trainingScriptNameForTask(task);
            const auto datasetName = datasetNameForTask(task);

            if (scriptName.isEmpty() || datasetName.isEmpty())
                return makeTrainingResponse(false, "Unknown training task.");

            if (jsonl.trim().isEmpty())
                return makeTrainingResponse(false, "Training dataset is empty.");

            const auto root = findTrainingRoot();
            if (! root.exists())
                return makeTrainingResponse(false, "Could not find Beat training workspace.");

            const auto trainDir = root.getChildFile("training/beat-qwen");
            const auto script = root.getChildFile("scripts/ai").getChildFile(scriptName);
            if (! script.existsAsFile())
                return makeTrainingResponse(false, "Missing training script: " + script.getFullPathName());

            if (! trainDir.createDirectory())
                return makeTrainingResponse(false, "Could not create training directory.");

            const auto dataset = trainDir.getChildFile(datasetName);
            if (! dataset.replaceWithText(jsonl.trim() + "\n"))
                return makeTrainingResponse(false, "Could not write training dataset.");

            emit(EV_TRAINING_STATUS, makeTrainingStatus(task, "started", signalCount, "Training started."));

            std::thread([this, task, script, signalCount]() {
                const auto command = juce::String("/bin/bash \"") + script.getFullPathName() + "\"";
                juce::ChildProcess process;
                const auto started = process.start(command);
                if (! started)
                {
                    emit(ipc::kind::EV_TRAINING_STATUS, makeTrainingStatus(task, "failed", signalCount, "Could not start training process.", -1));
                    return;
                }

                juce::String output;
                while (process.isRunning())
                {
                    output += process.readAllProcessOutput();
                    juce::Thread::sleep(500);
                }
                output += process.readAllProcessOutput();
                const auto exitCode = process.getExitCode();

                if (exitCode == 0)
                {
                    emit(ipc::kind::EV_TRAINING_STATUS, makeTrainingStatus(task, "finished", signalCount, "Training complete.", exitCode));
                }
                else
                {
                    const auto tail = output.substring(juce::jmax(0, output.length() - 600));
                    emit(ipc::kind::EV_TRAINING_STATUS, makeTrainingStatus(task, "failed", signalCount, tail.isNotEmpty() ? tail : "Training failed.", exitCode));
                }
            }).detach();

            return makeTrainingResponse(true);
        }

        if (kind == PING)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("pong", true);
            o->setProperty("backendVersion", "0.2.1");
            return juce::var(o.get());
        }

        // Unknown kind — JS will see ok:true but log a warning.
        DBG("Unhandled IPC kind: " << kind);
        return juce::var(true);
    }

    void MessageBridge::emit(const juce::String& kind, const juce::var& payload)
    {
        // Build a JSON envelope: { kind, ...payload } and send to JS via a
        // global hook (window.__BEAT_INBOUND__). The bootstrap script registered
        // in JS forwards to all subscribers.
        juce::DynamicObject::Ptr env = new juce::DynamicObject();
        env->setProperty("kind", kind);
        if (payload.isObject())
        {
            if (auto* obj = payload.getDynamicObject())
                for (const auto& pair : obj->getProperties())
                    env->setProperty(pair.name, pair.value);
        }
        const auto js = juce::String("window.__BEAT_INBOUND__ && window.__BEAT_INBOUND__(")
                      + juce::JSON::toString(juce::var(env.get()), true) + ");";

        // Marshal to the message thread — evaluateJavascript must be called there.
        juce::MessageManager::callAsync([this, js]() {
            browser.evaluateJavascript(js, nullptr);
        });
    }
}

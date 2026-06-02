#include "MessageBridge.h"
#include "Schema.h"
#include "../Audio/Parameters/SynthPatchContract.h"

#include <juce_audio_formats/juce_audio_formats.h>
#include <algorithm>
#include <cmath>
#include <thread>

namespace beat
{
    namespace
    {
        constexpr const char* audioImportWildcard = "*.wav;*.aif;*.aiff;*.mp3;*.flac;*.ogg;*.m4a";

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
            return juce::var(audioFile.get());
        }

        juce::var makeAudioFileResponse(const juce::File& file)
        {
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            response->setProperty("file", makeAudioFile(file));
            return juce::var(response.get());
        }

        void saveAudioFile(Database& database, const juce::var& audioFile);

        juce::File resolveRelativeSamplePath(const juce::File& presetFile, juce::String path)
        {
            path = path.replaceCharacter('\\', '/').trim();
            if (path.isEmpty()) return {};

            juce::File file(path);
            if (path.startsWithChar('/') || path.contains(":")) return file;
            return presetFile.getParentDirectory().getChildFile(path);
        }

        juce::String firstStringAttribute(const juce::XmlElement& element, std::initializer_list<const char*> names)
        {
            for (const auto* name : names)
            {
                const auto value = element.getStringAttribute(name).trim();
                if (value.isNotEmpty()) return value;
            }
            return {};
        }

        int intAttribute(const juce::XmlElement& element, std::initializer_list<const char*> names, int fallback)
        {
            for (const auto* name : names)
            {
                if (element.hasAttribute(name))
                    return element.getIntAttribute(name, fallback);
            }
            return fallback;
        }

        double doubleAttribute(const juce::XmlElement& element, std::initializer_list<const char*> names, double fallback)
        {
            for (const auto* name : names)
            {
                if (element.hasAttribute(name))
                    return element.getDoubleAttribute(name, fallback);
            }
            return fallback;
        }

        void collectDecentSamples(const juce::XmlElement& element, const juce::File& presetFile, juce::Array<juce::var>& samples, juce::StringArray& sampleUrls)
        {
            if (element.hasTagName("sample"))
            {
                const auto samplePath = firstStringAttribute(element, { "path", "file", "filename", "fileName", "sample" });
                const auto file = resolveRelativeSamplePath(presetFile, samplePath);
                if (file.existsAsFile())
                {
                    const auto path = file.getFullPathName();
                    if (!sampleUrls.contains(path))
                        sampleUrls.add(path);

                    juce::DynamicObject::Ptr sample = new juce::DynamicObject();
                    sample->setProperty("path", path);
                    sample->setProperty("name", file.getFileName());
                    sample->setProperty("rootNote", intAttribute(element, { "rootNote", "root", "pitch_keycenter" }, 60));
                    sample->setProperty("loNote", intAttribute(element, { "loNote", "loKey", "lokey" }, 0));
                    sample->setProperty("hiNote", intAttribute(element, { "hiNote", "hiKey", "hikey" }, 127));
                    sample->setProperty("loVel", intAttribute(element, { "loVel", "lovel" }, 0));
                    sample->setProperty("hiVel", intAttribute(element, { "hiVel", "hivel" }, 127));
                    sample->setProperty("volumeDb", doubleAttribute(element, { "volume", "gain" }, 0.0));
                    sample->setProperty("pan", doubleAttribute(element, { "pan" }, 0.0));
                    sample->setProperty("tuning", doubleAttribute(element, { "tuning", "pitch" }, 0.0));
                    sample->setProperty("seqPosition", intAttribute(element, { "seqPosition", "seq_position" }, 0));
                    samples.add(juce::var(sample.get()));
                }
            }

            for (auto* child = element.getFirstChildElement(); child != nullptr; child = child->getNextElement())
                collectDecentSamples(*child, presetFile, samples, sampleUrls);
        }

        juce::var makeDecentSamplerImport(Database& database, const juce::File& presetFile)
        {
            auto xml = juce::XmlDocument::parse(presetFile);
            if (xml == nullptr) return {};

            juce::Array<juce::var> samples;
            juce::StringArray sampleUrls;
            collectDecentSamples(*xml, presetFile, samples, sampleUrls);
            if (sampleUrls.isEmpty()) return {};

            juce::Array<juce::var> audioFiles;
            juce::Array<juce::var> sampleUrlVars;
            for (const auto& url : sampleUrls)
            {
                sampleUrlVars.add(url);
                const auto audioFile = makeAudioFile(juce::File(url));
                if (! audioFile.isVoid())
                {
                    saveAudioFile(database, audioFile);
                    audioFiles.add(audioFile);
                }
            }

            juce::DynamicObject::Ptr preset = new juce::DynamicObject();
            preset->setProperty("name", xml->getStringAttribute("name", presetFile.getFileNameWithoutExtension()));
            preset->setProperty("path", presetFile.getFullPathName());
            preset->setProperty("sampleUrls", sampleUrlVars);
            preset->setProperty("samples", samples);
            preset->setProperty("audioFiles", audioFiles);
            return juce::var(preset.get());
        }

        void saveAudioFile(Database& database, const juce::var& audioFile)
        {
            if (!audioFile.isObject()) return;

            Statement stmt(database, R"sql(
                INSERT INTO audio_files(id, name, path, duration_s, sample_rate)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name = excluded.name,
                  path = excluded.path,
                  duration_s = excluded.duration_s,
                  sample_rate = excluded.sample_rate
            )sql");
            stmt.bind(1, audioFile.getProperty("id", {}).toString());
            stmt.bind(2, audioFile.getProperty("name", {}).toString());
            stmt.bind(3, audioFile.getProperty("path", {}).toString());
            stmt.bind(4, (double) audioFile.getProperty("durationSeconds", 0.0));
            stmt.bind(5, (int) audioFile.getProperty("sampleRate", 0));
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

        InstrumentDefinition::WavetableConfig parseWavetableConfig(
            const juce::var& value,
            InstrumentDefinition::WavetableConfig fallback)
        {
            if (!value.isObject()) return fallback;
            fallback.bank = parseWavetableBank(value.getProperty("bank", fallback.bank));
            fallback.position = normalizedParam(value, "position", fallback.position);
            fallback.warp = normalizedParam(value, "warp", fallback.warp);
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
            fallback.wavetable = parseWavetableConfig(value.getProperty("wavetable", {}), fallback.wavetable);
            return fallback;
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

        Project parseProjectFromFrontend(const juce::var& projectVar, const juce::var& instrumentsVar)
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
                    t.gainDb = (float) (double) trackVar.getProperty("gainDb", 0.0);
                    t.pan = (float) (double) trackVar.getProperty("pan", 0.0);
                    t.mute = (bool) trackVar.getProperty("mute", false);
                    t.solo = (bool) trackVar.getProperty("solo", false);

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
                                        if (auto* curve = noteVar.getProperty("curve", {}).getArray())
                                        {
                                            n.curve.reserve((size_t) curve->size());
                                            for (const auto& pointVar : *curve)
                                            {
                                                if (!pointVar.isObject()) continue;
                                                MidiPitchCurvePoint point;
                                                point.beat = (double) pointVar.getProperty("beat", n.startBeat);
                                                point.pitch = juce::jlimit(0, 127, (int) pointVar.getProperty("pitch", n.pitch) + transpose);
                                                if (std::isfinite(point.beat))
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
                    instrument.resonance01 = normalizedParam(knobs, "resonance", instrument.resonance01);
                    instrument.drive01 = normalizedParam(knobs, "drive", instrument.drive01);
                    instrument.color01 = normalizedParam(knobs, "color", instrument.color01);
                    instrument.filterType = parseSynthFilterType(instrumentVar.getProperty("filterType", "lowpass"));

                    const auto envelope = instrumentVar.getProperty("envelope", {});
                    instrument.attackMs = floatParam(envelope, "attack", instrument.attackMs, 0.0f, 10000.0f);
                    instrument.decayMs = floatParam(envelope, "decay", instrument.decayMs, 0.0f, 10000.0f);
                    instrument.sustain = normalizedParam(envelope, "sustain", instrument.sustain);
                    instrument.releaseMs = floatParam(envelope, "release", instrument.releaseMs, 0.0f, 10000.0f);

                    const auto wavetable = instrumentVar.getProperty("wavetable", {});
                    if (wavetable.isObject())
                    {
                        instrument.wavetableBank = parseWavetableBank(wavetable.getProperty("bank", "aether"));
                        instrument.wavetablePosition = normalizedParam(wavetable, "position", instrument.wavetablePosition);
                        instrument.wavetableWarp = normalizedParam(wavetable, "warp", instrument.wavetableWarp);
                        instrument.wavetableUnison = juce::jlimit(1, 8, (int) wavetable.getProperty("unison", instrument.wavetableUnison));
                        instrument.wavetableDetuneCents = floatParam(wavetable, "detuneCents", instrument.wavetableDetuneCents, 0.0f, 100.0f);
                        instrument.wavetableBlend = normalizedParam(wavetable, "blend", instrument.wavetableBlend);
                    }
                    instrument.lfoWaveform = parseSynthLfoWaveform(instrumentVar.getProperty("lfoWaveform", "sine"));
                    instrument.lfoRateHz = floatParam(instrumentVar, "lfoRateHz", instrument.lfoRateHz, 0.01f, 40.0f);
                    instrument.lfoDepth = normalizedParam(instrumentVar, "lfoDepth", instrument.lfoDepth);
                    instrument.lfoRetrigger = (bool) instrumentVar.getProperty("lfoRetrigger", instrument.lfoRetrigger);
                    instrument.lfoPositionBipolar = (bool) instrumentVar.getProperty("lfoPositionBipolar", instrument.lfoPositionBipolar);
                    instrument.lfoPitchBipolar = (bool) instrumentVar.getProperty("lfoPitchBipolar", instrument.lfoPitchBipolar);
                    instrument.lfoFilterBipolar = (bool) instrumentVar.getProperty("lfoFilterBipolar", instrument.lfoFilterBipolar);
                    instrument.lfoToPitch = floatParam(instrumentVar, "lfoToPitch", instrument.lfoToPitch, 0.0f, 24.0f);
                    instrument.lfoToFilter = floatParam(instrumentVar, "lfoToFilter", instrument.lfoToFilter, -1.0f, 1.0f);
                    instrument.envToFilter = floatParam(instrumentVar, "envToFilter", instrument.envToFilter, -1.0f, 1.0f);
                    instrument.ampLevel = floatParam(instrumentVar, "ampLevel", instrument.ampLevel, 0.0f, 1.0f);
                    instrument.ampPan = floatParam(instrumentVar, "ampPan", instrument.ampPan, -1.0f, 1.0f);

                    InstrumentDefinition::WavetableConfig globalWavetable;
                    globalWavetable.bank = instrument.wavetableBank;
                    globalWavetable.position = instrument.wavetablePosition;
                    globalWavetable.warp = instrument.wavetableWarp;
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

                        const auto noise = aether.getProperty("noise", {});
                        instrument.aether.noise.enabled = noise.isObject() ? (bool) noise.getProperty("enabled", false) : false;
                        instrument.aether.noise.level = normalizedParam(noise, "level", 0.08f);
                        instrument.aether.noise.color = normalizedParam(noise, "color", 0.45f);
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
                            if (zone.loNote > zone.hiNote) std::swap(zone.loNote, zone.hiNote);
                            if (zone.loVel > zone.hiVel) std::swap(zone.loVel, zone.hiVel);
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
                    EqAutomationPoint point;
                    point.atBeat = (double) pointVar.getProperty("atBeat", 0.0);
                    point.lowDb = (float) (double) pointVar.getProperty("lowDb", 0.0);
                    point.midDb = (float) (double) pointVar.getProperty("midDb", 0.0);
                    point.highDb = (float) (double) pointVar.getProperty("highDb", 0.0);
                    point.airDb = (float) (double) pointVar.getProperty("airDb", 0.0);
                    p.eqAutomation.push_back(point);
                }
            }

            const auto automationSource = projectVar.getProperty("projectAutomation", projectVar.getProperty("automation", {}));
            if (auto* automation = automationSource.getArray())
            {
                for (const auto& laneVar : *automation)
                {
                    if (!laneVar.isObject()) continue;
                    ProjectAutomationLane lane;
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
        startTimerHz(30);
    }

    MessageBridge::~MessageBridge()
    {
        stopTimer();
        engine.onPositionChanged = nullptr;
        engine.onSegmentTriggered = nullptr;
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
            timingObject->setProperty("samplesMs", timing.samplesMs);
            timingObject->setProperty("fxMs", timing.fxMs);
            timingObject->setProperty("analyzerMs", timing.analyzerMs);
            timingObject->setProperty("copyMs", timing.copyMs);
            timingObject->setProperty("totalMs", timing.totalMs);
            timingObject->setProperty("loadPercent", timing.loadPercent);
            emit(ipc::kind::EV_RENDER_TIMING, juce::var(timingObject.get()));
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
                payload.getProperty("instruments", {})));
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

        if (kind == PROJECT_EXPORT_WAV)
        {
            auto pathHint = payload.getProperty("pathHint", {}).toString();
            auto start = pathHint.isNotEmpty()
                ? juce::File(pathHint)
                : juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile("Beat Export.wav");

            juce::FileChooser chooser("Export WAV", start, "*.wav", true);
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            if (chooser.browseForFileToSave(true))
            {
                auto file = chooser.getResult();
                if (!file.hasFileExtension(".wav"))
                    file = file.withFileExtension(".wav");
                response->setProperty("path", file.getFullPathName());
            }
            else
            {
                response->setProperty("path", juce::String());
            }
            return juce::var(response.get());
        }

        if (kind == INSTRUMENT_IMPORT_DECENT)
        {
            auto pathHint = payload.getProperty("pathHint", {}).toString();
            auto start = pathHint.isNotEmpty() ? juce::File(pathHint) : juce::File();
            if (start.existsAsFile())
                start = start.getParentDirectory();

            juce::FileChooser chooser("Import Decent Sampler preset", start, "*.dspreset", true);
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            if (! chooser.browseForFileToOpen())
            {
                response->setProperty("preset", juce::var());
                return juce::var(response.get());
            }

            response->setProperty("preset", makeDecentSamplerImport(database, chooser.getResult()));
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

            auto response = makeAudioFileResponse(chooser.getResult());
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
                auto audioFile = makeAudioFile(file);
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
            Statement stmt(database, "SELECT id, name, path, duration_s, sample_rate FROM audio_files ORDER BY name ASC");
            while (stmt.step())
            {
                juce::DynamicObject::Ptr audioFile = new juce::DynamicObject();
                audioFile->setProperty("id", stmt.columnText(0));
                audioFile->setProperty("name", stmt.columnText(1));
                audioFile->setProperty("path", stmt.columnText(2));
                audioFile->setProperty("durationSeconds", stmt.columnDouble(3));
                audioFile->setProperty("sampleRate", stmt.columnInt(4));
                files.add(juce::var(audioFile.get()));
            }
            juce::DynamicObject::Ptr response = new juce::DynamicObject();
            response->setProperty("files", files);
            return juce::var(response.get());
        }

        if (kind == EQ_SET_AUTOMATION)
        {
            std::vector<EqAutomationPoint> pts;
            if (auto* a = payload.getProperty("points", {}).getArray())
            {
                for (const auto& v : *a)
                {
                    EqAutomationPoint p;
                    p.atBeat = (double) v.getProperty("atBeat", 0.0);
                    p.lowDb  = (float) (double) v.getProperty("lowDb", 0.0);
                    p.midDb  = (float) (double) v.getProperty("midDb", 0.0);
                    p.highDb = (float) (double) v.getProperty("highDb", 0.0);
                    p.airDb  = (float) (double) v.getProperty("airDb", 0.0);
                    pts.push_back(p);
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
            o->setProperty("backendVersion", "0.1.0");
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

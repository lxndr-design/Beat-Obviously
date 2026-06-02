#include "AudioEngine.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace beat
{
    namespace
    {
        // Sound that matches any note — InstrumentVoice handles the actual sound.
        struct PassSound : public juce::SynthesiserSound
        {
            bool appliesToNote(int) override    { return true; }
            bool appliesToChannel(int) override { return true; }
        };

        struct StereoPanGains
        {
            float left { 1.0f };
            float right { 1.0f };
        };

        StereoPanGains equalPowerPan(float pan) noexcept
        {
            const auto normalized = juce::jlimit(0.0f, 1.0f, pan * 0.5f + 0.5f);
            const auto angle = normalized * juce::MathConstants<float>::halfPi;
            return { std::cos(angle), std::sin(angle) };
        }
    }

    AudioEngine::AudioEngine()
    {
        formatManager.registerBasicFormats();
        pendingNoteOffs.reserve(256);
        pendingParameterAutomation.reserve(2048);
        blockRealtimeParameterEvents.reserve(2048);
        activeSampleVoices.reserve(256);
        instrumentRenderStates.reserve(64);
        synth.addSound(new PassSound());
        for (int i = 0; i < 16; ++i)
        {
            auto* v = new InstrumentVoice();
            synth.addVoice(v);
        }
    }

    AudioEngine::~AudioEngine() = default;

    void AudioEngine::prepare()
    {
        const auto err = device.initialiseWithDefaultDevices(0, 2);
        if (err.isNotEmpty())
            DBG("AudioEngine init error: " << err);
        device.addAudioCallback(this);
    }

    void AudioEngine::prepareForOffline(double sr, int block, int channels)
    {
        sampleRate = sr > 0.0 ? sr : 44100.0;
        block = juce::jmax(1, block);
        channels = juce::jmax(1, channels);

        seq.setSampleRate(sampleRate);
        synth.setCurrentPlaybackSampleRate(sampleRate);
        for (int i = 0; i < synth.getNumVoices(); ++i)
            if (auto* v = dynamic_cast<InstrumentVoice*>(synth.getVoice(i)))
                v->prepare(sampleRate, block);
        {
            const juce::ScopedLock lock(sampleLock);
            for (auto& route : instrumentRenderStates)
            {
                if (route.synth == nullptr) continue;
                route.synth->setCurrentPlaybackSampleRate(sampleRate);
                for (int i = 0; i < route.synth->getNumVoices(); ++i)
                    if (auto* v = dynamic_cast<InstrumentVoice*>(route.synth->getVoice(i)))
                        v->prepare(sampleRate, block);
            }
        }

        bitcrush.prepare(sampleRate, block);
        masterEq.prepare(sampleRate, block, channels);
        masterAnalyzer.prepare(sampleRate);
        mixBuf.setSize(juce::jmax(2, channels), block, false, false, true);
        routeBuf.setSize(juce::jmax(2, channels), block, false, false, true);
    }

    void AudioEngine::shutdown()
    {
        device.removeAudioCallback(this);
        device.closeAudioDevice();
    }

    void AudioEngine::applyProject(Project p)
    {
        seq.setTempo(p.bpm);
        masterEq.setAutomation(p.eqAutomation);
        rebuildSampleInstruments(p);
        seq.setProject(std::move(p));
    }

    void AudioEngine::setEqAutomation(std::vector<EqAutomationPoint> pts)
    {
        masterEq.setAutomation(std::move(pts));
    }

    void AudioEngine::requestPlay()
    {
        seq.play();
    }

    void AudioEngine::requestPause()
    {
        seq.pause();
        stopAllNotes(true);
    }

    void AudioEngine::requestStop()
    {
        seq.stop();
        stopAllNotes(false);
    }

    void AudioEngine::requestRestart()
    {
        seq.seek(0.0);
        seq.play();
    }

    void AudioEngine::requestSeek(Beats positionBeat)
    {
        seq.seek(positionBeat);
    }

    void AudioEngine::requestSpeed(double speed)
    {
        seq.setSpeed(speed);
    }

    void AudioEngine::requestLoop(Beats start, Beats end)
    {
        seq.setLoop(start, end);
    }

    void AudioEngine::requestClearLoop()
    {
        seq.clearLoop();
    }

    bool AudioEngine::queueRealtimeParameterChange(Id instrumentId,
                                                   juce::String parameterId,
                                                   float value,
                                                   int sampleOffset,
                                                   int rampSamples) noexcept
    {
        return realtimeParameterChanges.push(makeRealtimeParameterChange(instrumentId.toRawUTF8(),
                                                                         parameterId.toRawUTF8(),
                                                                         value,
                                                                         sampleOffset,
                                                                         rampSamples));
    }

    bool AudioEngine::pullMasterAnalyzerSnapshot(FftAnalyzer::Snapshot& out) const noexcept
    {
        return masterAnalyzer.pullSnapshot(out);
    }

    bool AudioEngine::pullRenderTimingSnapshot(RenderTimingSnapshot& out) const noexcept
    {
        const auto sequence = renderTimingSequence.load(std::memory_order_acquire);
        if (sequence == 0)
            return false;

        const auto ticksPerSecond = juce::Time::getHighResolutionTicksPerSecond();
        const auto ticksToMs = [ticksPerSecond](int64_t ticks)
        {
            return ticksPerSecond > 0.0 ? (double) ticks * 1000.0 / ticksPerSecond : 0.0;
        };

        out.sequence = sequence;
        out.blockSamples = renderTimingBlockSamples.load(std::memory_order_relaxed);
        out.sampleRate = sampleRate;
        out.scheduleMs = ticksToMs(renderTimingScheduleTicks.load(std::memory_order_relaxed));
        out.synthMs = ticksToMs(renderTimingSynthTicks.load(std::memory_order_relaxed));
        out.samplesMs = ticksToMs(renderTimingSamplesTicks.load(std::memory_order_relaxed));
        out.fxMs = ticksToMs(renderTimingFxTicks.load(std::memory_order_relaxed));
        out.analyzerMs = ticksToMs(renderTimingAnalyzerTicks.load(std::memory_order_relaxed));
        out.copyMs = ticksToMs(renderTimingCopyTicks.load(std::memory_order_relaxed));
        out.totalMs = ticksToMs(renderTimingTotalTicks.load(std::memory_order_relaxed));
        const double blockMs = sampleRate > 0.0 && out.blockSamples > 0
            ? (double) out.blockSamples * 1000.0 / sampleRate
            : 0.0;
        out.loadPercent = blockMs > 0.0 ? juce::jlimit(0.0, 999.0, (out.totalMs / blockMs) * 100.0) : 0.0;
        return true;
    }

    void AudioEngine::stopAllNotes(bool allowTailOff)
    {
        const juce::ScopedLock lock(sampleLock);
        synth.allNotesOff(0, allowTailOff);
        for (auto& route : instrumentRenderStates)
        {
            if (route.synth != nullptr)
                route.synth->allNotesOff(0, allowTailOff);
            route.midi.clear();
        }
        pendingNoteOffs.clear();
        pendingParameterAutomation.clear();
        blockRealtimeParameterEvents.clear();
        activeSampleVoices.clear();
    }

    std::unique_ptr<juce::Synthesiser> AudioEngine::createInstrumentSynth(const InstrumentDefinition& instrument)
    {
        auto instrumentSynth = std::make_unique<juce::Synthesiser>();
        instrumentSynth->addSound(new PassSound());

        InstrumentVoice::Params params;
        const auto copyWavetable = [](const InstrumentDefinition::WavetableConfig& source)
        {
            InstrumentVoice::Params::WavetableConfig target;
            target.bank = source.bank;
            target.custom = source.custom;
            target.position = source.position;
            target.warp = source.warp;
            target.unison = source.unison;
            target.detuneCents = source.detuneCents;
            target.blend = source.blend;
            for (size_t i = 0; i < target.customFrames.size(); ++i)
            {
                target.customFrames[i] = {
                    source.customFrames[i].brightness,
                    source.customFrames[i].even,
                    source.customFrames[i].fold,
                    source.customFrames[i].phase,
                };
            }
            return target;
        };

        params.cutoff01 = instrument.cutoff01;
        params.resonance01 = instrument.resonance01;
        params.drive01 = instrument.drive01;
        params.color01 = instrument.color01;
        params.filterType = instrument.filterType;
        params.attackMs = instrument.attackMs;
        params.decayMs = instrument.decayMs;
        params.sustain = instrument.sustain;
        params.releaseMs = instrument.releaseMs;
        params.ampLevel = instrument.ampLevel;
        params.ampPan = instrument.ampPan;
        params.waveform = instrument.waveform;
        params.wavetableBank = instrument.wavetableBank;
        params.wavetablePosition = instrument.wavetablePosition;
        params.wavetableWarp = instrument.wavetableWarp;
        params.wavetableUnison = instrument.wavetableUnison;
        params.wavetableDetuneCents = instrument.wavetableDetuneCents;
        params.wavetableBlend = instrument.wavetableBlend;
        params.lfoWaveform = instrument.lfoWaveform;
        params.lfoRateHz = instrument.lfoRateHz;
        params.lfoDepth = instrument.lfoDepth;
        params.lfoRetrigger = instrument.lfoRetrigger;
        params.lfoPositionBipolar = instrument.lfoPositionBipolar;
        params.lfoPitchBipolar = instrument.lfoPitchBipolar;
        params.lfoFilterBipolar = instrument.lfoFilterBipolar;
        params.lfoToPitch = instrument.lfoToPitch;
        params.lfoToFilter = instrument.lfoToFilter;
        params.envToFilter = instrument.envToFilter;
        params.dynamicModulation = {
            instrument.dynamicModulation.active,
            {
                instrument.dynamicModulation.oscAPosition.lfo,
                instrument.dynamicModulation.oscAPosition.lfoBipolar,
                instrument.dynamicModulation.oscAPosition.env,
                instrument.dynamicModulation.oscAPosition.envBipolar,
            },
            {
                instrument.dynamicModulation.oscAFine.lfo,
                instrument.dynamicModulation.oscAFine.lfoBipolar,
                instrument.dynamicModulation.oscAFine.env,
                instrument.dynamicModulation.oscAFine.envBipolar,
            },
            {
                instrument.dynamicModulation.oscALevel.lfo,
                instrument.dynamicModulation.oscALevel.lfoBipolar,
                instrument.dynamicModulation.oscALevel.env,
                instrument.dynamicModulation.oscALevel.envBipolar,
            },
            {
                instrument.dynamicModulation.oscAPan.lfo,
                instrument.dynamicModulation.oscAPan.lfoBipolar,
                instrument.dynamicModulation.oscAPan.env,
                instrument.dynamicModulation.oscAPan.envBipolar,
            },
            {
                instrument.dynamicModulation.oscBPosition.lfo,
                instrument.dynamicModulation.oscBPosition.lfoBipolar,
                instrument.dynamicModulation.oscBPosition.env,
                instrument.dynamicModulation.oscBPosition.envBipolar,
            },
            {
                instrument.dynamicModulation.oscBFine.lfo,
                instrument.dynamicModulation.oscBFine.lfoBipolar,
                instrument.dynamicModulation.oscBFine.env,
                instrument.dynamicModulation.oscBFine.envBipolar,
            },
            {
                instrument.dynamicModulation.oscBLevel.lfo,
                instrument.dynamicModulation.oscBLevel.lfoBipolar,
                instrument.dynamicModulation.oscBLevel.env,
                instrument.dynamicModulation.oscBLevel.envBipolar,
            },
            {
                instrument.dynamicModulation.oscBPan.lfo,
                instrument.dynamicModulation.oscBPan.lfoBipolar,
                instrument.dynamicModulation.oscBPan.env,
                instrument.dynamicModulation.oscBPan.envBipolar,
            },
            {
                instrument.dynamicModulation.filterCutoff.lfo,
                instrument.dynamicModulation.filterCutoff.lfoBipolar,
                instrument.dynamicModulation.filterCutoff.env,
                instrument.dynamicModulation.filterCutoff.envBipolar,
            },
            {
                instrument.dynamicModulation.filterResonance.lfo,
                instrument.dynamicModulation.filterResonance.lfoBipolar,
                instrument.dynamicModulation.filterResonance.env,
                instrument.dynamicModulation.filterResonance.envBipolar,
            },
            {
                instrument.dynamicModulation.filterDrive.lfo,
                instrument.dynamicModulation.filterDrive.lfoBipolar,
                instrument.dynamicModulation.filterDrive.env,
                instrument.dynamicModulation.filterDrive.envBipolar,
            },
            {
                instrument.dynamicModulation.ampLevel.lfo,
                instrument.dynamicModulation.ampLevel.lfoBipolar,
                instrument.dynamicModulation.ampLevel.env,
                instrument.dynamicModulation.ampLevel.envBipolar,
            },
            {
                instrument.dynamicModulation.ampPan.lfo,
                instrument.dynamicModulation.ampPan.lfoBipolar,
                instrument.dynamicModulation.ampPan.env,
                instrument.dynamicModulation.ampPan.envBipolar,
            },
            {
                instrument.dynamicModulation.unisonDetune.lfo,
                instrument.dynamicModulation.unisonDetune.lfoBipolar,
                instrument.dynamicModulation.unisonDetune.env,
                instrument.dynamicModulation.unisonDetune.envBipolar,
            },
            {
                instrument.dynamicModulation.unisonSpread.lfo,
                instrument.dynamicModulation.unisonSpread.lfoBipolar,
                instrument.dynamicModulation.unisonSpread.env,
                instrument.dynamicModulation.unisonSpread.envBipolar,
            },
        };
        params.wavetable = copyWavetable({
            instrument.wavetableBank,
            instrument.wavetableBank == 5,
            instrument.wavetablePosition,
            instrument.wavetableWarp,
            instrument.wavetableUnison,
            instrument.wavetableDetuneCents,
            instrument.wavetableBlend,
        });
        params.hasAether = instrument.hasAether;
        params.aetherOscA = {
            instrument.aether.oscA.enabled,
            instrument.aether.oscA.level,
            instrument.aether.oscA.pan,
            instrument.aether.oscA.waveform,
            instrument.aether.oscA.octave,
            instrument.aether.oscA.semitone,
            instrument.aether.oscA.fineCents,
            copyWavetable(instrument.aether.oscA.wavetable),
        };
        params.aetherOscB = {
            instrument.aether.oscB.enabled,
            instrument.aether.oscB.level,
            instrument.aether.oscB.pan,
            instrument.aether.oscB.waveform,
            instrument.aether.oscB.octave,
            instrument.aether.oscB.semitone,
            instrument.aether.oscB.fineCents,
            copyWavetable(instrument.aether.oscB.wavetable),
        };
        params.aetherSub = {
            instrument.aether.sub.enabled,
            instrument.aether.sub.level,
            instrument.aether.sub.octave,
            instrument.aether.sub.waveform,
        };
        params.aetherNoise = {
            instrument.aether.noise.enabled,
            instrument.aether.noise.level,
            instrument.aether.noise.color,
        };

        for (int i = 0; i < 16; ++i)
        {
            auto* voice = new InstrumentVoice();
            voice->prepare(sampleRate, mixBuf.getNumSamples() > 0 ? mixBuf.getNumSamples() : 512);
            voice->setParams(params);
            instrumentSynth->addVoice(voice);
        }
        instrumentSynth->setCurrentPlaybackSampleRate(sampleRate);
        return instrumentSynth;
    }

    void AudioEngine::rebuildSampleInstruments(const Project& project)
    {
        std::map<juce::String, SampleInstrument> next;
        std::vector<InstrumentRenderState> nextRenderStates;
        std::map<juce::String, const InstrumentDefinition*> instrumentById;
        const auto executable = juce::File::getSpecialLocation(juce::File::currentExecutableFile);
        const auto resources = executable.getParentDirectory().getSiblingFile("Resources").getChildFile("frontend");

        for (const auto& instrument : project.instruments)
        {
            if (instrument.id.isNotEmpty())
                instrumentById[instrument.id] = &instrument;
            if (instrument.sampleUrls.isEmpty()) continue;
            SampleInstrument sampleInstrument;
            std::map<juce::String, std::shared_ptr<SampleBuffer>> loadedSamples;

            for (const auto& url : instrument.sampleUrls)
            {
                if (url.startsWith("data:")) continue;
                juce::File file(url);
                if (url.startsWith("/samples/"))
                    file = resources.getChildFile(url.substring(1));
                if (!file.existsAsFile()) continue;

                std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
                if (reader == nullptr || reader->lengthInSamples <= 0) continue;

                auto sample = std::make_shared<SampleBuffer>();
                sample->sourceSampleRate = reader->sampleRate > 0.0 ? reader->sampleRate : sampleRate;
                sample->audio.setSize((int) reader->numChannels, (int) reader->lengthInSamples);
                reader->read(&sample->audio, 0, (int) reader->lengthInSamples, 0, true, true);
                loadedSamples[url] = std::move(sample);
            }

            if (!instrument.sampleZones.empty())
            {
                for (const auto& zone : instrument.sampleZones)
                {
                    auto foundSample = loadedSamples.find(zone.path);
                    if (foundSample == loadedSamples.end()) continue;
                    sampleInstrument.zones.push_back({
                        foundSample->second,
                        zone.rootNote,
                        zone.loNote,
                        zone.hiNote,
                        zone.loVel,
                        zone.hiVel,
                        zone.volumeDb,
                        zone.pan,
                        zone.tuningCents,
                        zone.seqPosition,
                    });
                }
            }
            else
            {
                for (const auto& [_, sample] : loadedSamples)
                {
                    sampleInstrument.zones.push_back({
                        sample,
                        60,
                        0,
                        127,
                        0,
                        127,
                        0.0f,
                        0.0f,
                        0.0f,
                        0,
                    });
                }
            }

            if (!sampleInstrument.zones.empty())
                next[instrument.id] = std::move(sampleInstrument);
        }

        nextRenderStates.reserve(project.tracks.size());
        for (const auto& track : project.tracks)
        {
            if (track.instrumentId.isEmpty())
                continue;

            const auto foundInstrument = instrumentById.find(track.instrumentId);
            if (foundInstrument == instrumentById.end() || foundInstrument->second == nullptr)
                continue;

            InstrumentRenderState route;
            route.trackId = track.id;
            route.instrumentId = track.instrumentId;
            route.synth = createInstrumentSynth(*foundInstrument->second);
            route.gainDb = track.gainDb;
            route.pan = track.pan;
            nextRenderStates.push_back(std::move(route));
        }

        const juce::ScopedLock lock(sampleLock);
        sampleInstruments = std::move(next);
        instrumentRenderStates = std::move(nextRenderStates);
        activeSampleVoices.clear();
        pendingNoteOffs.clear();
        pendingParameterAutomation.clear();
        blockRealtimeParameterEvents.clear();
    }

    AudioEngine::InstrumentRenderState* AudioEngine::findInstrumentRenderState(const Id& instrumentId)
    {
        if (instrumentId.isEmpty()) return nullptr;
        for (auto& state : instrumentRenderStates)
        {
            if (state.instrumentId == instrumentId)
                return &state;
        }
        return nullptr;
    }

    AudioEngine::InstrumentRenderState* AudioEngine::findTrackRenderState(const Id& trackId, const Id& instrumentId)
    {
        if (trackId.isNotEmpty())
        {
            for (auto& state : instrumentRenderStates)
            {
                if (state.trackId == trackId && (instrumentId.isEmpty() || state.instrumentId == instrumentId))
                    return &state;
            }
        }

        return findInstrumentRenderState(instrumentId);
    }

    namespace
    {
        bool idEqualsView(const juce::String& id, std::string_view view) noexcept
        {
            const char* raw = id.toRawUTF8();
            return std::strlen(raw) == view.size() && std::memcmp(raw, view.data(), view.size()) == 0;
        }
    }

    bool AudioEngine::applyRealtimeParameterToSynth(juce::Synthesiser& targetSynth,
                                                    std::string_view parameterId,
                                                    float value,
                                                    int rampSamples) noexcept
    {
        bool applied = false;
        for (int i = 0; i < targetSynth.getNumVoices(); ++i)
        {
            if (auto* voice = dynamic_cast<InstrumentVoice*>(targetSynth.getVoice(i)))
                applied = voice->applyRealtimeParameter(parameterId, value, rampSamples) || applied;
        }
        return applied;
    }

    void AudioEngine::drainRealtimeParameterChangesLocked(int numSamples) noexcept
    {
        RealtimeParameterChange change;
        int drained = 0;
        while (drained < 256 && realtimeParameterChanges.pop(change))
        {
            ++drained;
            if (change.sampleOffset >= numSamples)
            {
                // Keep the path bounded: future sample-accurate scheduling can
                // split these per block, but for now we clamp into this block.
                change.sampleOffset = juce::jmax(0, numSamples - 1);
            }
            if (blockRealtimeParameterEvents.size() < blockRealtimeParameterEvents.capacity())
                blockRealtimeParameterEvents.push_back(change);
        }
    }

    void AudioEngine::advancePendingParameterAutomationLocked(int numSamples) noexcept
    {
        size_t writeIndex = 0;
        for (size_t readIndex = 0; readIndex < pendingParameterAutomation.size(); ++readIndex)
        {
            auto event = pendingParameterAutomation[readIndex];
            if (event.samplesUntilEvent < numSamples)
            {
                event.change.sampleOffset = juce::jlimit(0, numSamples - 1, event.samplesUntilEvent);
                if (blockRealtimeParameterEvents.size() < blockRealtimeParameterEvents.capacity())
                    blockRealtimeParameterEvents.push_back(event.change);
                continue;
            }

            event.samplesUntilEvent -= numSamples;
            if (writeIndex != readIndex)
                pendingParameterAutomation[writeIndex] = event;
            ++writeIndex;
        }
        pendingParameterAutomation.resize(writeIndex);
    }

    void AudioEngine::scheduleNoteAutomationLocked(const Sequencer::TriggerEvent& ev) noexcept
    {
        const auto* note = ev.sourceNote;
        if (note == nullptr || (note->automation.empty() && note->curve.empty())) return;

        const double sr = sampleRate > 0.0 ? sampleRate : 44100.0;
        const double tempo = juce::jmax(1.0, seq.getTempo());
        const double speed = juce::jmax(0.1, seq.getSpeed());
        const double samplesPerBeat = sr * 60.0 / tempo / speed;
        auto* route = findTrackRenderState(ev.trackId, ev.instrumentId);
        auto& contextCount = route != nullptr ? route->noteAutomationContextCount : defaultNoteAutomationContextCount;
        auto& contexts = route != nullptr ? route->noteAutomationContexts : defaultNoteAutomationContexts;

        if (contextCount >= (int) contexts.size()) return;

        auto& context = contexts[(size_t) contextCount];
        context.midiNoteNumber = ev.pitch;
        context.eventCount = 0;
        context.pitchEventCount = 0;

        const auto pushPitchChange = [&](int pitch,
                                         int samplesFromNoteStart,
                                         int rampSamples) noexcept
        {
            if (context.pitchEventCount >= (int) InstrumentVoice::maxNoteAutomationEvents) return;
            context.pitchEvents[(size_t) context.pitchEventCount] = {
                juce::jmax(0, samplesFromNoteStart),
                (float) juce::MidiMessage::getMidiNoteInHertz(juce::jlimit(0, 127, pitch)),
                juce::jmax(0, rampSamples),
            };
            ++context.pitchEventCount;
        };

        const auto pushVoiceChange = [&](std::string_view target,
                                         float value,
                                         int samplesFromNoteStart,
                                         int rampSamples) noexcept
        {
            if (target.empty() || target == std::string_view("pitch")) return;
            if (context.eventCount >= (int) InstrumentVoice::maxNoteAutomationEvents) return;
            context.events[(size_t) context.eventCount] = makeRealtimeParameterChange(std::string_view {},
                                                                                      target,
                                                                                      value,
                                                                                      juce::jmax(0, samplesFromNoteStart),
                                                                                      juce::jmax(0, rampSamples));
            ++context.eventCount;
        };

        bool emittedInitialPitch = false;
        for (size_t i = 0; i < note->curve.size(); ++i)
        {
            const auto& point = note->curve[i];
            if (point.beat < note->startBeat || point.beat > note->startBeat + note->lengthBeats)
                continue;

            const int pointOffset = (int) std::round((point.beat - note->startBeat) * samplesPerBeat);
            if (!emittedInitialPitch)
            {
                pushPitchChange(point.pitch, pointOffset, 0);
                emittedInitialPitch = true;
            }

            const MidiPitchCurvePoint* nextPoint = nullptr;
            for (size_t nextIndex = i + 1; nextIndex < note->curve.size(); ++nextIndex)
            {
                const auto& candidate = note->curve[nextIndex];
                if (candidate.beat >= point.beat && candidate.beat <= note->startBeat + note->lengthBeats)
                {
                    nextPoint = &candidate;
                    break;
                }
            }
            if (nextPoint == nullptr)
                continue;

            const int nextOffset = (int) std::round((nextPoint->beat - note->startBeat) * samplesPerBeat);
            pushPitchChange(nextPoint->pitch, pointOffset, juce::jmax(0, nextOffset - pointOffset));
        }

        for (const auto& lane : note->automation)
        {
            if (lane.target.isEmpty() || lane.points.empty()) continue;
            const auto target = std::string_view(lane.target.toRawUTF8());
            bool emittedInitialValue = false;

            for (size_t i = 0; i < lane.points.size(); ++i)
            {
                const auto& point = lane.points[i];
                if (point.beat < note->startBeat || point.beat > note->startBeat + note->lengthBeats)
                    continue;

                const int pointOffset = (int) std::round((point.beat - note->startBeat) * samplesPerBeat);

                if (!emittedInitialValue)
                {
                    pushVoiceChange(target, point.value, pointOffset, 0);
                    emittedInitialValue = true;
                }

                const MidiAutomationPoint* nextPoint = nullptr;
                for (size_t nextIndex = i + 1; nextIndex < lane.points.size(); ++nextIndex)
                {
                    const auto& candidate = lane.points[nextIndex];
                    if (candidate.beat >= point.beat && candidate.beat <= note->startBeat + note->lengthBeats)
                    {
                        nextPoint = &candidate;
                        break;
                    }
                }
                if (nextPoint == nullptr)
                    continue;

                const int nextOffset = (int) std::round((nextPoint->beat - note->startBeat) * samplesPerBeat);
                pushVoiceChange(target,
                                nextPoint->value,
                                pointOffset,
                                juce::jmax(0, nextOffset - pointOffset));
            }
        }

        if (context.eventCount > 0 || context.pitchEventCount > 0)
            ++contextCount;
    }

    void AudioEngine::renderSynthWithRealtimeParametersLocked(juce::Synthesiser& targetSynth,
                                                              juce::AudioBuffer<float>& output,
                                                              juce::MidiBuffer& midi,
                                                              std::string_view instrumentId,
                                                              int numSamples) noexcept
    {
        const auto eventMatches = [&](const RealtimeParameterChange& change) noexcept
        {
            const auto targetInstrumentId = change.instrumentIdView();
            if (instrumentId.empty())
                return targetInstrumentId.empty();
            return !targetInstrumentId.empty() && targetInstrumentId == instrumentId;
        };

        bool hasEvents = false;
        for (const auto& event : blockRealtimeParameterEvents)
        {
            if (eventMatches(event))
            {
                hasEvents = true;
                break;
            }
        }

        if (!hasEvents)
        {
            targetSynth.renderNextBlock(output, midi, 0, numSamples);
            return;
        }

        int cursor = 0;
        while (cursor < numSamples)
        {
            for (const auto& event : blockRealtimeParameterEvents)
            {
                if (!eventMatches(event) || event.sampleOffset != cursor) continue;
                applyRealtimeParameterToSynth(targetSynth,
                                              event.parameterIdView(),
                                              event.value,
                                              event.rampSamples);
            }

            int nextOffset = numSamples;
            for (const auto& event : blockRealtimeParameterEvents)
            {
                if (!eventMatches(event)) continue;
                if (event.sampleOffset > cursor)
                    nextOffset = juce::jmin(nextOffset, event.sampleOffset);
            }

            const int chunkSamples = nextOffset - cursor;
            if (chunkSamples > 0)
                targetSynth.renderNextBlock(output, midi, cursor, chunkSamples);

            cursor = nextOffset;
        }
    }

    void AudioEngine::addRouteToMixLocked(juce::AudioBuffer<float>& route,
                                          int numSamples,
                                          float gainDb,
                                          float pan) noexcept
    {
        const auto gain = juce::Decibels::decibelsToGain(gainDb);
        const auto panGains = equalPowerPan(pan);
        const int routeChannels = route.getNumChannels();
        const int mixChannels = mixBuf.getNumChannels();

        for (int ch = 0; ch < mixChannels; ++ch)
        {
            const int sourceCh = juce::jmin(ch, routeChannels - 1);
            const float panGain = ch == 0 ? panGains.left : ch == 1 ? panGains.right : 1.0f;
            mixBuf.addFrom(ch, 0, route, sourceCh, 0, numSamples, gain * panGain);
        }
    }

    bool AudioEngine::startSampleVoiceLocked(const Sequencer::TriggerEvent& ev)
    {
        auto found = sampleInstruments.find(ev.instrumentId);
        if (found == sampleInstruments.end() || found->second.zones.empty()) return false;

        auto& instrument = found->second;
        const int zoneCount = (int) instrument.zones.size();
        int matchCount = 0;
        for (int i = 0; i < zoneCount; ++i)
        {
            const auto& zone = instrument.zones[(size_t) i];
            if (ev.pitch >= zone.loNote && ev.pitch <= zone.hiNote && ev.velocity >= zone.loVel && ev.velocity <= zone.hiVel)
                ++matchCount;
        }

        int candidateIndex = -1;
        if (matchCount > 0)
        {
            const int targetMatch = instrument.nextIndex % matchCount;
            int currentMatch = 0;
            for (int i = 0; i < zoneCount; ++i)
            {
                const auto& zone = instrument.zones[(size_t) i];
                const bool matches = ev.pitch >= zone.loNote && ev.pitch <= zone.hiNote
                    && ev.velocity >= zone.loVel && ev.velocity <= zone.hiVel;
                if (!matches) continue;
                if (currentMatch == targetMatch)
                {
                    candidateIndex = i;
                    break;
                }
                ++currentMatch;
            }
            instrument.nextIndex = (instrument.nextIndex + 1) % juce::jmax(1, matchCount);
        }
        else
        {
            candidateIndex = instrument.nextIndex % juce::jmax(1, zoneCount);
            instrument.nextIndex = (instrument.nextIndex + 1) % juce::jmax(1, zoneCount);
        }
        if (candidateIndex < 0 || candidateIndex >= zoneCount) return false;

        const auto& zone = instrument.zones[(size_t) candidateIndex];
        const auto sample = zone.buffer;
        if (!sample) return false;

        const double pitchRate = juce::MidiMessage::getMidiNoteInHertz(ev.pitch)
            / juce::MidiMessage::getMidiNoteInHertz(juce::jlimit(0, 127, zone.rootNote));
        const double tuningRate = std::pow(2.0, zone.tuningCents / 1200.0);
        const float voiceGain = juce::Decibels::decibelsToGain(zone.volumeDb + ev.trackGainDb + ev.segmentGainDb);
        activeSampleVoices.push_back({
            sample,
            0.0,
            (sample->sourceSampleRate / sampleRate) * pitchRate * tuningRate,
            juce::jlimit(0.0f, 1.0f, ev.velocity / 127.0f) * 0.7f * voiceGain,
            juce::jlimit(-1.0f, 1.0f, zone.pan + ev.trackPan),
            ev.sampleOffset,
        });
        return true;
    }

    void AudioEngine::renderSampleVoicesLocked(int numSamples)
    {
        const int outChannels = mixBuf.getNumChannels();
        size_t writeIndex = 0;
        for (size_t readIndex = 0; readIndex < activeSampleVoices.size(); ++readIndex)
        {
            auto& voice = activeSampleVoices[readIndex];
            const auto& sample = voice.sample;
            if (!sample || sample->audio.getNumSamples() <= 0)
                continue;

            const int sourceChannels = sample->audio.getNumChannels();
            const int sourceSamples = sample->audio.getNumSamples();
            const int start = juce::jlimit(0, numSamples, voice.startOffset);
            const auto panGains = equalPowerPan(voice.pan);
            voice.startOffset = 0;
            for (int outSample = start; outSample < numSamples; ++outSample)
            {
                const int sourceIndex = (int) voice.position;
                if (sourceIndex >= sourceSamples - 1) break;

                const float frac = (float) (voice.position - sourceIndex);
                for (int ch = 0; ch < outChannels; ++ch)
                {
                    const int sourceCh = juce::jmin(ch, sourceChannels - 1);
                    const float a = sample->audio.getSample(sourceCh, sourceIndex);
                    const float b = sample->audio.getSample(sourceCh, sourceIndex + 1);
                    const float panGain = ch == 0 ? panGains.left : ch == 1 ? panGains.right : 1.0f;
                    mixBuf.addSample(ch, outSample, (a + (b - a) * frac) * voice.gain * panGain);
                }
                voice.position += voice.rate;
            }

            if (voice.position >= sourceSamples - 1)
                continue;

            if (writeIndex != readIndex)
                activeSampleVoices[writeIndex] = std::move(voice);
            ++writeIndex;
        }
        activeSampleVoices.resize(writeIndex);
    }

    void AudioEngine::publishRenderTiming(int numSamples,
                                          int64_t scheduleTicks,
                                          int64_t synthTicks,
                                          int64_t samplesTicks,
                                          int64_t fxTicks,
                                          int64_t analyzerTicks,
                                          int64_t copyTicks,
                                          int64_t totalTicks) noexcept
    {
        renderTimingBlockSamples.store(numSamples, std::memory_order_relaxed);
        renderTimingScheduleTicks.store(scheduleTicks, std::memory_order_relaxed);
        renderTimingSynthTicks.store(synthTicks, std::memory_order_relaxed);
        renderTimingSamplesTicks.store(samplesTicks, std::memory_order_relaxed);
        renderTimingFxTicks.store(fxTicks, std::memory_order_relaxed);
        renderTimingAnalyzerTicks.store(analyzerTicks, std::memory_order_relaxed);
        renderTimingCopyTicks.store(copyTicks, std::memory_order_relaxed);
        renderTimingTotalTicks.store(totalTicks, std::memory_order_relaxed);
        renderTimingSequence.fetch_add(1, std::memory_order_release);
    }

    void AudioEngine::audioDeviceAboutToStart(juce::AudioIODevice* dev)
    {
        const int block = dev->getCurrentBufferSizeSamples();
        const int channels = dev->getActiveOutputChannels().countNumberOfSetBits();
        prepareForOffline(dev->getCurrentSampleRate(), block, channels);
    }

    void AudioEngine::audioDeviceStopped() {}

    void AudioEngine::audioDeviceIOCallbackWithContext(const float* const*, int,
                                                       float* const* outputChannels, int numOutChannels,
                                                       int numSamples,
                                                       const juce::AudioIODeviceCallbackContext&)
    {
        const auto blockStartTicks = juce::Time::getHighResolutionTicks();
        auto markTicks = [] { return juce::Time::getHighResolutionTicks(); };
        auto ticksBetween = [](int64_t start, int64_t end) { return juce::jmax<int64_t>(0, end - start); };

        mixBuf.setSize(juce::jmax(2, numOutChannels), numSamples, false, false, true);
        routeBuf.setSize(juce::jmax(2, numOutChannels), numSamples, false, false, true);
        mixBuf.clear();

        // 1. Advance the sequencer; collect MIDI events for this block.
        auto phaseStartTicks = markTicks();
        juce::MidiBuffer midi;
        {
            const juce::ScopedTryLock lock(sampleLock);
            if (lock.isLocked())
            {
                blockRealtimeParameterEvents.clear();
                defaultNoteAutomationContextCount = 0;
                drainRealtimeParameterChangesLocked(numSamples);
                advancePendingParameterAutomationLocked(numSamples);
                for (auto& state : instrumentRenderStates)
                {
                    state.midi.clear();
                    state.noteAutomationContextCount = 0;
                }

                size_t noteOffWrite = 0;
                for (size_t noteOffRead = 0; noteOffRead < pendingNoteOffs.size(); ++noteOffRead)
                {
                    auto noteOff = pendingNoteOffs[noteOffRead];
                    if (noteOff.samplesUntilOff < numSamples)
                    {
                        const auto event = juce::MidiMessage::noteOff(1, noteOff.pitch);
                        if (auto* route = findTrackRenderState(noteOff.trackId, noteOff.instrumentId))
                            route->midi.addEvent(event, juce::jmax(0, noteOff.samplesUntilOff));
                        else
                            midi.addEvent(event, juce::jmax(0, noteOff.samplesUntilOff));
                        continue;
                    }

                    noteOff.samplesUntilOff -= numSamples;
                    if (noteOffWrite != noteOffRead)
                        pendingNoteOffs[noteOffWrite] = std::move(noteOff);
                    ++noteOffWrite;
                }
                pendingNoteOffs.resize(noteOffWrite);

                const auto pushParameterEvent = [&](const Sequencer::ParameterAutomationEvent& ev) {
                    if (blockRealtimeParameterEvents.size() >= blockRealtimeParameterEvents.capacity())
                        return;
                    blockRealtimeParameterEvents.push_back(
                        makeRealtimeParameterChange(ev.instrumentId.toRawUTF8(),
                                                    ev.parameterId.toRawUTF8(),
                                                    ev.value,
                                                    ev.sampleOffset,
                                                    ev.rampSamples));
                };

                seq.render(numSamples, [&](const Sequencer::TriggerEvent& ev) {
                    if (startSampleVoiceLocked(ev))
                    {
                        if (onSegmentTriggered) onSegmentTriggered(ev);
                        return;
                    }

                    scheduleNoteAutomationLocked(ev);

                    juce::MidiBuffer* targetMidi = &midi;
                    if (auto* route = findTrackRenderState(ev.trackId, ev.instrumentId))
                        targetMidi = &route->midi;

                    targetMidi->addEvent(juce::MidiMessage::noteOn(1, ev.pitch, (juce::uint8) ev.velocity),
                                         ev.sampleOffset);
                    const int offSample = ev.sampleOffset + ev.lengthSamples;
                    if (offSample < numSamples)
                    {
                        targetMidi->addEvent(juce::MidiMessage::noteOff(1, ev.pitch), offSample);
                    }
                    else
                    {
                        pendingNoteOffs.push_back({ ev.trackId, ev.instrumentId, ev.pitch, offSample - numSamples });
                    }

                    if (onSegmentTriggered) onSegmentTriggered(ev);
                }, pushParameterEvent);
            }
            else
            {
                blockRealtimeParameterEvents.clear();
                defaultNoteAutomationContextCount = 0;
                seq.render(numSamples, [&](const Sequencer::TriggerEvent& ev) {
                    midi.addEvent(juce::MidiMessage::noteOn(1, ev.pitch, (juce::uint8) ev.velocity),
                                  ev.sampleOffset);
                    midi.addEvent(juce::MidiMessage::noteOff(1, ev.pitch),
                                  juce::jlimit(ev.sampleOffset, numSamples - 1, ev.sampleOffset + ev.lengthSamples));
                });
            }
        }
        const auto scheduleTicks = ticksBetween(phaseStartTicks, markTicks());

        // 2. Synth renders into mixBuf.
        phaseStartTicks = markTicks();
        int64_t samplesTicks = 0;
        {
            const juce::ScopedTryLock lock(sampleLock);
            if (lock.isLocked())
            {
                InstrumentVoice::setPendingNoteAutomationContexts(defaultNoteAutomationContexts.data(),
                                                                   defaultNoteAutomationContextCount);
                renderSynthWithRealtimeParametersLocked(synth, mixBuf, midi, {}, numSamples);
                InstrumentVoice::clearPendingNoteAutomationContexts();
                for (auto& route : instrumentRenderStates)
                {
                    if (route.synth != nullptr)
                    {
                        routeBuf.clear();
                        InstrumentVoice::setPendingNoteAutomationContexts(route.noteAutomationContexts.data(),
                                                                           route.noteAutomationContextCount);
                        renderSynthWithRealtimeParametersLocked(*route.synth,
                                                                routeBuf,
                                                                route.midi,
                                                                route.instrumentId.toRawUTF8(),
                                                                numSamples);
                        InstrumentVoice::clearPendingNoteAutomationContexts();
                        addRouteToMixLocked(routeBuf, numSamples, route.gainDb, route.pan);
                    }
                    else
                    {
                        InstrumentVoice::setPendingNoteAutomationContexts(route.noteAutomationContexts.data(),
                                                                           route.noteAutomationContextCount);
                        renderSynthWithRealtimeParametersLocked(synth, mixBuf, route.midi, {}, numSamples);
                        InstrumentVoice::clearPendingNoteAutomationContexts();
                    }
                }
                const auto sampleStartTicks = markTicks();
                renderSampleVoicesLocked(numSamples);
                samplesTicks = ticksBetween(sampleStartTicks, markTicks());
            }
            else
            {
                InstrumentVoice::clearPendingNoteAutomationContexts();
                synth.renderNextBlock(mixBuf, midi, 0, numSamples);
            }
        }
        const auto synthTicks = juce::jmax<int64_t>(0, ticksBetween(phaseStartTicks, markTicks()) - samplesTicks);

        // 3. Master FX chain — for v1, bitcrush is per-engine; per-track
        //    routing is a follow-up.
        phaseStartTicks = markTicks();
        bitcrush.process(mixBuf);
        masterEq.setCurrentBeat(seq.getPosition());
        masterEq.process(mixBuf);
        const auto fxTicks = ticksBetween(phaseStartTicks, markTicks());
        phaseStartTicks = markTicks();
        masterAnalyzer.process(mixBuf);
        const auto analyzerTicks = ticksBetween(phaseStartTicks, markTicks());

        // 4. Copy mixBuf → device output.
        phaseStartTicks = markTicks();
        for (int ch = 0; ch < numOutChannels; ++ch)
        {
            const float* src = mixBuf.getReadPointer(juce::jmin(ch, mixBuf.getNumChannels() - 1));
            std::memcpy(outputChannels[ch], src, sizeof(float) * (size_t) numSamples);
        }
        const auto copyTicks = ticksBetween(phaseStartTicks, markTicks());
        publishRenderTiming(numSamples,
                            scheduleTicks,
                            synthTicks,
                            samplesTicks,
                            fxTicks,
                            analyzerTicks,
                            copyTicks,
                            ticksBetween(blockStartTicks, markTicks()));

        // 5. Notify UI of position changes ~60Hz.
        const int64_t now = juce::Time::getHighResolutionTicks();
        const double  hz  = juce::Time::getHighResolutionTicksPerSecond();
        const int64_t lastTicks = lastPositionPushSamples.load();
        if ((now - lastTicks) / hz > 1.0 / 60.0)
        {
            lastPositionPushSamples.store(now);
            if (onPositionChanged) onPositionChanged(seq.getPosition());
        }
    }
}

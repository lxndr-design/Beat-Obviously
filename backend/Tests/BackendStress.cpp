#include "../Source/Audio/Sequencer.h"
#include "../Source/Audio/Analysis/FftAnalyzer.h"
#include "../Source/Audio/InstrumentVoice.h"
#include "../Source/Audio/Parameters/ParameterIds.h"
#include "../Source/Audio/Parameters/SynthPatchContract.h"
#include "../Source/Audio/Realtime/FixedObjectPool.h"
#include "../Source/Audio/Realtime/RealtimeParameterQueue.h"
#include "../Source/Audio/Realtime/SpscRingBuffer.h"
#include "../Source/Audio/Wavetable/WavetableFactory.h"
#include "../Source/Audio/Wavetable/WavetableOscillator.h"

#include <array>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <string_view>
#include <thread>
#include <vector>

namespace
{
    bool near(float actual, float expected, float tolerance = 0.0001f)
    {
        return std::abs(actual - expected) <= tolerance;
    }

    beat::Project makeStressProject()
    {
        beat::Project project;
        project.id = "stress-project";
        project.name = "Backend Stress";
        project.bpm = 132.0;
        project.lengthBeats = 64.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "stress-synth";
        instrument.kind = "synth";
        instrument.waveform = 1;
        instrument.lfoDepth = 0.0f;
        project.instruments.push_back(instrument);

        beat::ProjectAutomationLane projectLane;
        projectLane.instrumentId = instrument.id;
        projectLane.target = "filter.cutoff";
        projectLane.points.push_back({ 0.0, 0.2f });
        projectLane.points.push_back({ 4.0, 0.8f });
        project.automation.push_back(std::move(projectLane));

        beat::Track track;
        track.id = "stress-track";
        track.name = "Stress Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = instrument.id;

        beat::Segment segment;
        segment.id = "stress-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = instrument.id;
        segment.startBeat = 0.0;
        segment.lengthBeats = 4.0;
        segment.repeats = 32;

        for (int i = 0; i < 8; ++i)
        {
            beat::MidiNote note;
            note.instrumentId = instrument.id;
            note.pitch = 48 + (i % 12);
            note.velocity = 80 + (i % 32);
            note.startBeat = i * 0.25;
            note.lengthBeats = 0.125;
            if (i == 0)
            {
                beat::MidiAutomationLane lane;
                lane.target = "filter.cutoff";
                lane.points.push_back({ note.startBeat, 0.25f });
                lane.points.push_back({ note.startBeat + note.lengthBeats, 0.75f });
                note.automation.push_back(std::move(lane));
            }
            segment.notes.push_back(note);
        }

        beat::MidiAutomationLane segmentLane;
        segmentLane.target = "amp.level";
        segmentLane.points.push_back({ 0.0, 0.4f });
        segmentLane.points.push_back({ 2.0, 0.9f });
        segment.automation.push_back(std::move(segmentLane));

        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    bool stressFftAnalyzer()
    {
        const std::array blockSizes { 127, 256, 480, 511, 960, 1000 };

        for (int blockSize : blockSizes)
        {
            beat::FftAnalyzer analyzer;
            analyzer.prepare(44100.0);

            juce::AudioBuffer<float> buffer(2, blockSize);
            double phase = 0.0;
            const double delta = 440.0 / 44100.0;
            for (int block = 0; block < 24; ++block)
            {
                for (int i = 0; i < buffer.getNumSamples(); ++i)
                {
                    const float sample = std::sin((float) (phase * juce::MathConstants<double>::twoPi)) * 0.5f;
                    buffer.setSample(0, i, sample);
                    buffer.setSample(1, i, sample);
                    phase += delta;
                    if (phase >= 1.0) phase -= 1.0;
                }
                analyzer.process(buffer);
            }

            beat::FftAnalyzer::Snapshot snapshot;
            if (!analyzer.pullSnapshot(snapshot))
                return false;

            float maxBand = 0.0f;
            for (float band : snapshot.spectrum)
                maxBand = std::max(maxBand, band);

            if (!(snapshot.sequence > 0 && snapshot.rms > 0.0f && snapshot.peak > 0.0f && maxBand > 0.0f))
                return false;
        }

        return true;
    }

    bool stressRealtimeQueue()
    {
        beat::SpscRingBuffer<int, 4> queue;
        if (!queue.empty() || queue.full() || queue.capacity() != 4)
            return false;

        for (int value = 1; value <= 4; ++value)
            if (!queue.push(value))
                return false;
        if (!queue.full() || queue.size() != 4 || queue.push(5))
            return false;

        int out = 0;
        for (int expected = 1; expected <= 2; ++expected)
            if (!queue.pop(out) || out != expected)
                return false;
        if (!queue.push(5) || !queue.push(6))
            return false;

        for (int expected : { 3, 4, 5, 6 })
            if (!queue.pop(out) || out != expected)
                return false;
        if (queue.pop(out) || !queue.empty())
            return false;

        beat::SpscRingBuffer<int, 256> threaded;
        constexpr int iterations = 100000;
        std::atomic<bool> failed { false };
        std::thread producer([&] {
            for (int value = 0; value < iterations && !failed.load();)
            {
                if (threaded.push(value))
                    ++value;
                else
                    std::this_thread::yield();
            }
        });
        std::thread consumer([&] {
            for (int expected = 0; expected < iterations && !failed.load();)
            {
                int value = -1;
                if (!threaded.pop(value))
                {
                    std::this_thread::yield();
                    continue;
                }
                if (value != expected)
                {
                    failed.store(true);
                    return;
                }
                ++expected;
            }
        });
        producer.join();
        consumer.join();
        return !failed.load() && threaded.empty();
    }

    struct PoolPayload
    {
        int id { -1 };
        float value { 0.0f };
    };

    bool stressFixedObjectPool()
    {
        beat::FixedObjectPool<PoolPayload, 8> pool;
        std::array<PoolPayload*, 8> acquired {};

        for (size_t i = 0; i < acquired.size(); ++i)
        {
            acquired[i] = pool.tryAcquire();
            if (acquired[i] == nullptr || !pool.owns(acquired[i]))
                return false;
            acquired[i]->id = (int) i;
            acquired[i]->value = (float) i * 0.5f;
        }
        if (pool.tryAcquire() != nullptr || pool.used() != acquired.size())
            return false;

        pool.release(acquired[3]);
        auto* reused = pool.tryAcquire();
        if (reused == nullptr || reused->id != -1 || reused->value != 0.0f)
            return false;
        pool.release(reused);

        for (auto* payload : acquired)
            pool.release(payload);
        if (pool.used() != 0)
            return false;

        beat::FixedObjectPool<PoolPayload, 32> threadedPool;
        std::atomic<int> operations { 0 };
        std::atomic<bool> failed { false };
        std::vector<std::thread> workers;
        for (int worker = 0; worker < 4; ++worker)
        {
            workers.emplace_back([&, worker] {
                for (int i = 0; i < 2000 && !failed.load(); ++i)
                {
                    PoolPayload* payload = nullptr;
                    while (payload == nullptr && !failed.load())
                    {
                        payload = threadedPool.tryAcquire();
                        if (payload == nullptr)
                            std::this_thread::yield();
                    }
                    if (payload == nullptr)
                        return;
                    payload->id = worker;
                    payload->value = (float) i;
                    operations.fetch_add(1);
                    threadedPool.release(payload);
                }
            });
        }

        for (auto& worker : workers)
            worker.join();

        return !failed.load() && operations.load() == 8000 && threadedPool.used() == 0;
    }

    bool stressRealtimeParameterQueue()
    {
        auto change = beat::makeRealtimeParameterChange("stress-synth",
                                                        "osc.a.position",
                                                        0.42f,
                                                        12,
                                                        128);
        if (change.instrumentIdView() != "stress-synth" || change.parameterIdView() != "osc.a.position")
            return false;
        if (!near(change.value, 0.42f) || change.sampleOffset != 12 || change.rampSamples != 128)
            return false;

        const std::string longInstrument(128, 'i');
        const std::string longParameter(128, 'p');
        const auto truncated = beat::makeRealtimeParameterChange(longInstrument, longParameter, 0.25f, -4, -8);
        if (truncated.instrumentIdView().size() != beat::RealtimeParameterChange::instrumentIdCapacity - 1)
            return false;
        if (truncated.parameterIdView().size() != beat::RealtimeParameterChange::parameterIdCapacity - 1)
            return false;
        if (truncated.sampleOffset != 0 || truncated.rampSamples != 0)
            return false;

        beat::RealtimeParameterQueue<3> queue;
        if (!queue.push(beat::makeRealtimeParameterChange("a", "filter.cutoff", 0.1f)))
            return false;
        if (!queue.push(beat::makeRealtimeParameterChange("a", "filter.resonance", 0.2f)))
            return false;
        if (!queue.push(beat::makeRealtimeParameterChange("b", "amp.level", 0.3f)))
            return false;
        if (!queue.full() || queue.push(beat::makeRealtimeParameterChange("c", "amp.pan", 0.4f)))
            return false;

        beat::RealtimeParameterChange out;
        if (!queue.pop(out) || out.instrumentIdView() != "a" || out.parameterIdView() != "filter.cutoff" || !near(out.value, 0.1f))
            return false;
        if (!queue.push(beat::makeRealtimeParameterChange("c", "amp.pan", 0.4f)))
            return false;

        const std::array expectedParameters {
            std::string_view { "filter.resonance" },
            std::string_view { "amp.level" },
            std::string_view { "amp.pan" },
        };
        for (const auto expected : expectedParameters)
        {
            if (!queue.pop(out) || out.parameterIdView() != expected)
                return false;
        }
        return queue.empty();
    }

    bool stressSequencerTransport()
    {
        beat::Sequencer sequencer;
        sequencer.setSampleRate(44100.0);
        sequencer.setTempo(132.0);
        sequencer.setProject(makeStressProject());

        int triggerCount = 0;
        for (int block = 0; block < 10000; ++block)
        {
            switch (block % 17)
            {
                case 0: sequencer.seek(0.0); sequencer.play(); break;
                case 1: sequencer.pause(); break;
                case 2: sequencer.play(); break;
                case 3: sequencer.seek((block % 64) * 0.25); break;
                case 4: sequencer.setSpeed(0.5 + (block % 8) * 0.25); break;
                case 5: sequencer.setLoop(0.0, 8.0); break;
                case 6: sequencer.clearLoop(); break;
                case 7: sequencer.stop(); break;
                default: break;
            }

            sequencer.render(128, [&](const beat::Sequencer::TriggerEvent& ev) {
                if (ev.sampleOffset < 0 || ev.sampleOffset >= 128 || ev.lengthSamples <= 0)
                    std::abort();
                ++triggerCount;
            });

            if (!std::isfinite(sequencer.getPosition()))
                return false;
        }

        return triggerCount > 0;
    }

    bool stressSequencerAutomationMetadata()
    {
        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(makeStressProject());
        sequencer.seek(0.0);
        sequencer.play();

        bool foundAutomatedNote = false;
        sequencer.render(2048, [&](const beat::Sequencer::TriggerEvent& ev) {
            if (ev.sourceNote == nullptr)
                std::abort();
            if (!ev.sourceNote->automation.empty())
            {
                foundAutomatedNote = true;
                const auto& lane = ev.sourceNote->automation.front();
                if (lane.target != "filter.cutoff" || lane.points.size() != 2)
                    std::abort();
                if (ev.segmentStartBeat != 0.0)
                    std::abort();
            }
        });

        return foundAutomatedNote;
    }

    bool stressSequencerSegmentAutomation()
    {
        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(makeStressProject());
        sequencer.seek(1.0);
        sequencer.play();

        bool foundSegmentAutomation = false;
        sequencer.render(512,
            [](const beat::Sequencer::TriggerEvent&) {},
            [&](const beat::Sequencer::ParameterAutomationEvent& ev) {
                if (ev.parameterId != "amp.level")
                    return;
                foundSegmentAutomation = true;
                if (ev.sampleOffset != 0)
                    std::abort();
                if (std::abs(ev.value - 0.65f) > 0.01f)
                    std::abort();
                if (ev.rampSamples <= 0)
                    std::abort();
            });

        return foundSegmentAutomation;
    }

    bool stressSequencerProjectAutomation()
    {
        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(makeStressProject());
        sequencer.seek(2.0);
        sequencer.play();

        bool foundProjectAutomation = false;
        sequencer.render(512,
            [](const beat::Sequencer::TriggerEvent&) {},
            [&](const beat::Sequencer::ParameterAutomationEvent& ev) {
                if (ev.segmentId.isNotEmpty() || ev.parameterId != "filter.cutoff")
                    return;
                foundProjectAutomation = true;
                if (ev.instrumentId != "stress-synth")
                    std::abort();
                if (ev.sampleOffset != 0)
                    std::abort();
                if (std::abs(ev.value - 0.5f) > 0.01f)
                    std::abort();
                if (ev.rampSamples <= 0)
                    std::abort();
            });

        return foundProjectAutomation;
    }

    bool stressSequencerTrackMixMetadata()
    {
        auto project = makeStressProject();
        auto& track = project.tracks.front();
        auto& segment = track.segments.front();
        track.gainDb = -6.0f;
        track.pan = 0.5f;
        segment.audioGainDb = -3.0f;

        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(project);
        sequencer.seek(0.0);
        sequencer.play();

        bool foundMixMetadata = false;
        sequencer.render(4096, [&](const beat::Sequencer::TriggerEvent& ev) {
            foundMixMetadata = true;
            if (ev.trackId != "stress-track" || ev.instrumentId != "stress-synth")
                std::abort();
            if (!near(ev.trackGainDb, -6.0f) || !near(ev.trackPan, 0.5f) || !near(ev.segmentGainDb, -3.0f))
                std::abort();
        });

        return foundMixMetadata;
    }

    bool stressWavetableOscillator()
    {
        static_assert(beat::params::patchSchemaVersion == 1);
        static_assert(beat::params::instrumentTypeWavetableSynth == std::string_view("wavetable-synth"));
        static_assert(beat::params::oscillator::a::position == std::string_view("osc.a.position"));
        static_assert(beat::params::modulation::sourceLfo1 == std::string_view("lfo.1"));
        static_assert(beat::params::modulation::targetUnisonSpread == std::string_view("unison.spread"));

        const std::array shapes {
            beat::BasicWavetableShape::Sine,
            beat::BasicWavetableShape::Saw,
            beat::BasicWavetableShape::Square,
            beat::BasicWavetableShape::Triangle,
            beat::BasicWavetableShape::Pulse
        };

        for (auto shape : shapes)
        {
            const auto table = beat::WavetableFactory::createBasic(shape, 8, 2048);
            if (!table.isValid() || table.getFrameCount() != 8 || table.getFrameSize() != 2048)
                return false;

            for (int frame = 0; frame < table.getFrameCount(); ++frame)
            {
                for (int i = 0; i < table.getFrameSize(); i += 17)
                {
                    const float sample = table.getSample(frame, i);
                    if (!std::isfinite(sample) || std::abs(sample) > 1.001f)
                        return false;
                }
            }

            beat::WavetableOscillator oscillator;
            oscillator.prepare(44100.0);
            oscillator.setWavetable(&table);
            oscillator.setFrequency(440.0);

            for (int positionStep = -4; positionStep <= 12; ++positionStep)
            {
                oscillator.setPosition((float) positionStep / 8.0f);

                for (int i = 0; i < 256; ++i)
                {
                    const float sample = oscillator.renderSample();
                    if (!std::isfinite(sample) || std::abs(sample) > 1.001f)
                        return false;
                }
            }
        }

        const auto sine = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Sine, 8, 2048);
        beat::WavetableOscillator oscillator;
        oscillator.prepare(44100.0);
        oscillator.setWavetable(&sine);
        oscillator.setFrequency(440.0);
        oscillator.reset(0.0);

        int positiveCrossings = 0;
        float previous = oscillator.renderSample();
        for (int i = 1; i < 44100; ++i)
        {
            const float next = oscillator.renderSample();
            if (previous <= 0.0f && next > 0.0f)
                ++positiveCrossings;

            previous = next;
        }

        if (positiveCrossings < 438 || positiveCrossings > 442)
            return false;

        oscillator.setFrequency(100000000.0);
        oscillator.setPhase(12345.6789);
        for (int i = 0; i < 4096; ++i)
        {
            const float sample = oscillator.renderSample();
            if (!std::isfinite(sample) || !std::isfinite(oscillator.getPhase()))
                return false;

            if (oscillator.getPhase() < 0.0 || oscillator.getPhase() >= 1.0)
                return false;
        }

        {
            constexpr int frames = 8;
            constexpr int size = 32;
            std::vector<float> stepped((size_t) frames * (size_t) size, 0.0f);
            for (int frame = 0; frame < frames; ++frame)
            {
                const float value = (float) frame / (float) (frames - 1);
                for (int i = 0; i < size; ++i)
                    stepped[(size_t) frame * (size_t) size + (size_t) i] = value;
            }

            beat::Wavetable testTable({ "test.bandlimit", "Bandlimit", "stress" }, frames, size, std::move(stepped));
            beat::WavetableOscillator lowOsc;
            lowOsc.prepare(44100.0);
            lowOsc.setWavetable(&testTable);
            lowOsc.setPosition(1.0f);
            lowOsc.setFrequency(100.0);

            beat::WavetableOscillator highOsc;
            highOsc.prepare(44100.0);
            highOsc.setWavetable(&testTable);
            highOsc.setPosition(1.0f);
            highOsc.setFrequency(44100.0 * 0.49);

            if (lowOsc.renderSample() < 0.95f)
                return false;
            if (highOsc.renderSample() > 0.25f)
                return false;
        }

        {
            const std::array<beat::WavetableFactory::CustomFrame, 4> frames {{
                { 0.12f, 0.04f, 0.0f, 0.0f },
                { 0.38f, 0.18f, 0.2f, 0.25f },
                { 0.66f, 0.55f, 0.42f, -0.16f },
                { 0.95f, 0.86f, 0.68f, 0.36f },
            }};
            const auto custom = beat::WavetableFactory::createCustom(frames, 8, 2048);
            if (!custom.isValid() || custom.getFrameCount() != 8 || custom.getFrameSize() != 2048)
                return false;

            beat::WavetableOscillator customOsc;
            customOsc.prepare(48000.0);
            customOsc.setWavetable(&custom);
            customOsc.setFrequency(110.0);
            customOsc.setPosition(0.8f);

            double energy = 0.0;
            float peak = 0.0f;
            for (int i = 0; i < 4096; ++i)
            {
                const float sample = customOsc.renderSample();
                if (!std::isfinite(sample))
                    return false;
                energy += (double) sample * (double) sample;
                peak = std::max(peak, std::abs(sample));
            }

            if (!(energy > 0.001 && peak > 0.01f && peak <= 1.001f))
                return false;
        }

        return true;
    }

    bool stressSynthPatchContract()
    {
        beat::InstrumentDefinition untouched;
        untouched.kind = "synth";
        untouched.waveform = 1;
        if (beat::applySynthPatchContract({}, untouched))
            return false;
        if (untouched.kind != "synth" || untouched.waveform != 1)
            return false;

        const auto patch = juce::JSON::parse(R"json(
        {
          "schemaVersion": 1,
          "instrumentType": "wavetable-synth",
          "parameters": {
            "macro.1": 0.5,
            "macro.2": 0.8,
            "osc.a.enabled": true,
            "osc.a.wavetable": "basic.pulse",
            "osc.a.position": 0.25,
            "osc.a.octave": -1,
            "osc.a.semitone": 12,
            "osc.a.fine": 7,
            "osc.a.level": 0.7,
            "osc.a.pan": -0.4,
            "osc.b.enabled": true,
            "osc.b.wavetable": "basic.triangle",
            "osc.b.position": 0.1,
            "osc.b.octave": 1,
            "osc.b.semitone": 7,
            "osc.b.fine": -5,
            "osc.b.level": 0.3,
            "osc.b.pan": 0.2,
            "unison.enabled": true,
            "unison.voices": 5,
            "unison.detune": 0.2,
            "unison.blend": 0.6,
            "unison.spread": 0.4,
            "filter.enabled": true,
            "filter.type": "highpass",
            "filter.cutoff": 1000,
            "filter.resonance": 0.2,
            "filter.drive": 0.35,
            "env.1.attack": 0.01,
            "env.1.decay": 0.2,
            "env.1.sustain": 0.55,
            "env.1.release": 0.4,
            "amp.level": 0.7,
            "amp.pan": -0.25,
            "lfo.1.enabled": true,
            "lfo.1.shape": "square",
            "lfo.1.rate": 6.5
          },
          "modulation": [
            { "source": "macro.1", "target": "osc.a.position", "amount": 0.4, "enabled": true },
            { "source": "macro.1", "target": "osc.b.position", "amount": -0.3, "enabled": true },
            { "source": "macro.2", "target": "osc.b.level", "amount": 0.5, "enabled": true },
            { "source": "macro.2", "target": "osc.b.fine", "amount": 0.25, "enabled": true },
            { "source": "macro.1", "target": "osc.a.pan", "amount": 0.2, "enabled": true },
            { "source": "macro.2", "target": "osc.b.pan", "amount": -0.25, "enabled": true },
            { "source": "macro.1", "target": "unison.detune", "amount": 0.1, "enabled": true },
            { "source": "macro.1", "target": "unison.spread", "amount": 0.2, "enabled": true },
            { "source": "macro.1", "target": "filter.cutoff", "amount": 0.1, "enabled": true },
            { "source": "macro.2", "target": "filter.resonance", "amount": 0.25, "enabled": true },
            { "source": "macro.2", "target": "amp.level", "amount": -0.2, "enabled": true },
            { "source": "macro.1", "target": "amp.pan", "amount": 0.5, "enabled": true },
            { "source": "lfo.1", "target": "osc.a.position", "amount": -0.35, "bipolar": false, "enabled": true },
            { "source": "lfo.1", "target": "osc.a.fine", "amount": 0.5, "bipolar": true, "enabled": true },
            { "source": "lfo.1", "target": "osc.a.pan", "amount": 0.4, "bipolar": false, "enabled": true },
            { "source": "lfo.1", "target": "osc.b.position", "amount": 0.25, "bipolar": false, "enabled": true },
            { "source": "lfo.1", "target": "osc.b.pan", "amount": -0.2, "bipolar": true, "enabled": true },
            { "source": "lfo.1", "target": "unison.spread", "amount": 0.33, "bipolar": false, "enabled": true },
            { "source": "env.1", "target": "filter.drive", "amount": 0.22, "enabled": true },
            { "source": "lfo.1", "target": "filter.cutoff", "amount": -0.2, "bipolar": false, "enabled": true },
            { "source": "lfo.1", "target": "filter.cutoff", "amount": 1.0, "enabled": false },
            { "source": "env.1", "target": "filter.cutoff", "amount": 0.3, "enabled": true }
          ]
        }
        )json");

        beat::InstrumentDefinition instrument;
        instrument.kind = "synth";
        if (!beat::applySynthPatchContract(patch, instrument))
            return false;

        if (instrument.kind != "wavetable" || instrument.waveform != 5 || !instrument.hasAether)
            return false;
        if (instrument.wavetableBank != 4 || !near(instrument.wavetablePosition, 0.45f))
            return false;
        if (instrument.wavetableUnison != 5 || !near(instrument.wavetableDetuneCents, 25.0f) || !near(instrument.wavetableBlend, 0.5f))
            return false;
        if (!instrument.aether.oscA.enabled || instrument.aether.oscA.wavetable.bank != 4)
            return false;
        if (!near(instrument.aether.oscA.wavetable.position, 0.45f) || instrument.aether.oscA.wavetable.unison != 5)
            return false;
        if (!near(instrument.aether.oscA.pan, -0.3f))
            return false;
        if (!instrument.aether.oscB.enabled || instrument.aether.oscB.wavetable.bank != 3)
            return false;
        if (!near(instrument.aether.oscB.level, 0.7f) || !near(instrument.aether.oscB.wavetable.position, 0.0f))
            return false;
        if (!near(instrument.aether.oscB.pan, 0.0f))
            return false;
        if (instrument.aether.oscB.octave != 1 || instrument.aether.oscB.semitone != 7 || !near(instrument.aether.oscB.fineCents, 15.0f))
            return false;
        if (instrument.filterType != 2 || instrument.cutoff01 < 0.55f || instrument.cutoff01 > 0.7f)
            return false;
        if (!near(instrument.resonance01, 0.4f) || !near(instrument.drive01, 0.35f))
            return false;
        if (!near(instrument.attackMs, 10.0f) || !near(instrument.decayMs, 200.0f))
            return false;
        if (!near(instrument.sustain, 0.55f) || !near(instrument.releaseMs, 400.0f))
            return false;
        if (!near(instrument.ampLevel, 0.54f) || !near(instrument.ampPan, 0.0f))
            return false;
        if (instrument.lfoWaveform != 3 || !near(instrument.lfoRateHz, 6.5f))
            return false;
        if (!near(instrument.lfoDepth, 0.35f) || !near(instrument.lfoToPitch, 6.0f) || !near(instrument.lfoToFilter, -0.2f))
            return false;
        if (instrument.lfoPositionBipolar || !instrument.lfoPitchBipolar || instrument.lfoFilterBipolar)
            return false;
        if (!near(instrument.envToFilter, 0.3f))
            return false;
        if (!instrument.dynamicModulation.active)
            return false;
        if (!near(instrument.dynamicModulation.oscAPosition.lfo, -0.35f) || instrument.dynamicModulation.oscAPosition.lfoBipolar)
            return false;
        if (!near(instrument.dynamicModulation.oscAPan.lfo, 0.4f) || instrument.dynamicModulation.oscAPan.lfoBipolar)
            return false;
        if (!near(instrument.dynamicModulation.oscBPosition.lfo, 0.25f) || instrument.dynamicModulation.oscBPosition.lfoBipolar)
            return false;
        if (!near(instrument.dynamicModulation.oscBPan.lfo, -0.2f) || !instrument.dynamicModulation.oscBPan.lfoBipolar)
            return false;
        if (!near(instrument.dynamicModulation.filterCutoff.lfo, -0.2f) || !near(instrument.dynamicModulation.filterCutoff.env, 0.3f))
            return false;
        if (!near(instrument.dynamicModulation.unisonSpread.lfo, 0.33f) || instrument.dynamicModulation.unisonSpread.lfoBipolar)
            return false;
        if (instrument.dynamicModulation.filterCutoff.lfoBipolar || instrument.dynamicModulation.filterCutoff.envBipolar)
            return false;
        if (!near(instrument.dynamicModulation.filterDrive.env, 0.22f))
            return false;

        const auto customPatch = juce::JSON::parse(R"json(
        {
          "schemaVersion": 1,
          "instrumentType": "wavetable-synth",
          "parameters": {
            "osc.a.enabled": true,
            "osc.a.wavetable": "user.custom",
            "osc.a.position": 0.74,
            "osc.a.level": 0.82,
            "osc.b.enabled": false,
            "unison.enabled": false,
            "filter.enabled": true,
            "filter.cutoff": 8400,
            "amp.level": 0.72
          },
          "modulation": [],
          "metadata": {
            "customWavetables": {
              "user.custom": {
                "id": "user.custom",
                "name": "Verifier Custom",
                "frames": [
                  { "brightness": 0.12, "even": 0.04, "fold": 0.0, "phase": 0.0 },
                  { "brightness": 0.38, "even": 0.18, "fold": 0.2, "phase": 0.25 },
                  { "brightness": 0.66, "even": 0.55, "fold": 0.42, "phase": -0.16 },
                  { "brightness": 0.95, "even": 0.86, "fold": 0.68, "phase": 0.36 }
                ]
              }
            }
          }
        }
        )json");

        beat::InstrumentDefinition customInstrument;
        if (!beat::applySynthPatchContract(customPatch, customInstrument))
            return false;
        if (customInstrument.wavetableBank != 5 || !customInstrument.aether.oscA.wavetable.custom)
            return false;
        if (customInstrument.aether.oscA.wavetable.bank != 5)
            return false;
        if (!near(customInstrument.aether.oscA.wavetable.customFrames[3].fold, 0.68f))
            return false;
        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].phase, -0.16f))
            return false;

        return true;
    }

    bool stressInstrumentVoiceWavetablePath()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 5;
        params.wavetableBank = 0;
        params.wavetablePosition = 0.5f;
        params.wavetableUnison = 3;
        params.wavetableDetuneCents = 9.0f;
        params.wavetableBlend = 0.5f;
        params.cutoff01 = 1.0f;
        params.resonance01 = 0.05f;
        params.drive01 = 0.0f;
        params.attackMs = 1.0f;
        params.decayMs = 20.0f;
        params.sustain = 1.0f;
        params.releaseMs = 20.0f;
        params.lfoDepth = 0.0f;

        auto render = [](const beat::InstrumentVoice::Params& renderParams) {
            beat::InstrumentVoice voice;
            voice.prepare(44100.0, 256);
            voice.setParams(renderParams);
            voice.startNote(69, 1.0f, nullptr, 0);

            juce::AudioBuffer<float> buffer(2, 4096);
            buffer.clear();
            voice.renderNextBlock(buffer, 0, buffer.getNumSamples());
            voice.stopNote(0.0f, false);
            return buffer;
        };

        auto buffer = render(params);

        double energy = 0.0;
        float peak = 0.0f;
        for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(channel, i);
                if (!std::isfinite(sample))
                    return false;
                peak = std::max(peak, std::abs(sample));
                energy += (double) sample * (double) sample;
            }
        }

        if (!(energy > 0.001 && peak > 0.001f && peak < 1.0f))
            return false;

        auto modulatedParams = params;
        modulatedParams.lfoDepth = 0.75f;
        modulatedParams.lfoRateHz = 6.0f;
        auto modulated = render(modulatedParams);

        double diff = 0.0;
        for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = modulated.getSample(channel, i);
                if (!std::isfinite(sample))
                    return false;
                diff += std::abs((double) sample - (double) buffer.getSample(channel, i));
            }
        }

        if (diff <= 0.1)
            return false;

        auto lowpassParams = params;
        lowpassParams.cutoff01 = 0.35f;
        lowpassParams.filterType = 0;
        auto highpassParams = lowpassParams;
        highpassParams.filterType = 2;
        auto lowpass = render(lowpassParams);
        auto highpass = render(highpassParams);

        double filterDiff = 0.0;
        for (int channel = 0; channel < lowpass.getNumChannels(); ++channel)
        {
            for (int i = 0; i < lowpass.getNumSamples(); ++i)
                filterDiff += std::abs((double) lowpass.getSample(channel, i) - (double) highpass.getSample(channel, i));
        }

        if (filterDiff <= 0.1)
            return false;

        auto pitchOnlyParams = params;
        pitchOnlyParams.lfoDepth = 0.0f;
        pitchOnlyParams.lfoToPitch = 4.0f;
        pitchOnlyParams.lfoRateHz = 5.0f;
        auto pitchOnly = render(pitchOnlyParams);
        double pitchOnlyDiff = 0.0;
        for (int channel = 0; channel < pitchOnly.getNumChannels(); ++channel)
        {
            for (int i = 0; i < pitchOnly.getNumSamples(); ++i)
                pitchOnlyDiff += std::abs((double) pitchOnly.getSample(channel, i) - (double) buffer.getSample(channel, i));
        }

        if (pitchOnlyDiff <= 0.1)
            return false;

        auto unipolarFilterParams = params;
        unipolarFilterParams.cutoff01 = 0.45f;
        unipolarFilterParams.lfoToFilter = 0.75f;
        unipolarFilterParams.lfoFilterBipolar = false;
        auto unipolarFilter = render(unipolarFilterParams);
        double unipolarFilterDiff = 0.0;
        for (int channel = 0; channel < unipolarFilter.getNumChannels(); ++channel)
        {
            for (int i = 0; i < unipolarFilter.getNumSamples(); ++i)
                unipolarFilterDiff += std::abs((double) unipolarFilter.getSample(channel, i) - (double) buffer.getSample(channel, i));
        }

        if (unipolarFilterDiff <= 0.1)
            return false;

        auto pannedParams = params;
        pannedParams.ampPan = -1.0f;
        auto panned = render(pannedParams);
        double leftEnergy = 0.0;
        double rightEnergy = 0.0;
        for (int i = 0; i < panned.getNumSamples(); ++i)
        {
            const float left = panned.getSample(0, i);
            const float right = panned.getSample(1, i);
            if (!std::isfinite(left) || !std::isfinite(right))
                return false;
            leftEnergy += (double) left * (double) left;
            rightEnergy += (double) right * (double) right;
        }

        return leftEnergy > rightEnergy * 20.0;
    }

    bool stressInstrumentVoiceAetherPath()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 5;
        params.hasAether = true;
        params.cutoff01 = 1.0f;
        params.resonance01 = 0.05f;
        params.drive01 = 0.1f;
        params.attackMs = 1.0f;
        params.decayMs = 20.0f;
        params.sustain = 1.0f;
        params.releaseMs = 30.0f;
        params.ampLevel = 0.85f;

        params.aetherOscA.enabled = true;
        params.aetherOscA.level = 0.8f;
        params.aetherOscA.pan = -0.75f;
        params.aetherOscA.waveform = 5;
        params.aetherOscA.wavetable.bank = 0;
        params.aetherOscA.wavetable.position = 0.25f;
        params.aetherOscA.wavetable.unison = 3;
        params.aetherOscA.wavetable.detuneCents = 7.0f;
        params.aetherOscA.wavetable.blend = 0.35f;

        params.aetherOscB.enabled = true;
        params.aetherOscB.level = 0.45f;
        params.aetherOscB.pan = 0.75f;
        params.aetherOscB.waveform = 5;
        params.aetherOscB.semitone = 7;
        params.aetherOscB.fineCents = -4.0f;
        params.aetherOscB.wavetable.bank = 1;
        params.aetherOscB.wavetable.position = 0.65f;
        params.aetherOscB.wavetable.unison = 2;
        params.aetherOscB.wavetable.detuneCents = 4.0f;
        params.aetherOscB.wavetable.blend = 0.4f;

        params.aetherSub.enabled = true;
        params.aetherSub.level = 0.18f;
        params.aetherSub.octave = -1;
        params.aetherSub.waveform = 0;
        params.aetherNoise.enabled = true;
        params.aetherNoise.level = 0.05f;
        params.aetherNoise.color = 0.6f;

        auto render = [](const beat::InstrumentVoice::Params& renderParams) {
            beat::InstrumentVoice voice;
            voice.prepare(48000.0, 256);
            voice.setParams(renderParams);
            voice.startNote(57, 0.9f, nullptr, 0);

            juce::AudioBuffer<float> buffer(2, 4096);
            buffer.clear();
            voice.renderNextBlock(buffer, 0, buffer.getNumSamples());
            return buffer;
        };

        auto full = render(params);
        double fullEnergy = 0.0;
        float fullPeak = 0.0f;
        for (int channel = 0; channel < full.getNumChannels(); ++channel)
        {
            for (int i = 0; i < full.getNumSamples(); ++i)
            {
                const float sample = full.getSample(channel, i);
                if (!std::isfinite(sample))
                    return false;
                fullEnergy += (double) sample * (double) sample;
                fullPeak = std::max(fullPeak, std::abs(sample));
            }
        }

        if (!(fullEnergy > 0.001 && fullPeak > 0.001f && fullPeak <= 1.0f))
            return false;

        double fullLeftEnergy = 0.0;
        double fullRightEnergy = 0.0;
        for (int i = 0; i < full.getNumSamples(); ++i)
        {
            fullLeftEnergy += (double) full.getSample(0, i) * (double) full.getSample(0, i);
            fullRightEnergy += (double) full.getSample(1, i) * (double) full.getSample(1, i);
        }
        if (!(fullLeftEnergy > 0.0 && fullRightEnergy > 0.0 && std::abs(fullLeftEnergy - fullRightEnergy) > fullEnergy * 0.02))
            return false;

        auto oscAOnlyParams = params;
        oscAOnlyParams.aetherOscB.enabled = false;
        oscAOnlyParams.aetherSub.enabled = false;
        oscAOnlyParams.aetherNoise.enabled = false;
        auto oscAOnly = render(oscAOnlyParams);

        double diff = 0.0;
        for (int channel = 0; channel < full.getNumChannels(); ++channel)
        {
            for (int i = 0; i < full.getNumSamples(); ++i)
                diff += std::abs((double) full.getSample(channel, i) - (double) oscAOnly.getSample(channel, i));
        }

        if (diff <= 0.1)
            return false;

        auto dynamicParams = params;
        dynamicParams.lfoRateHz = 4.0f;
        dynamicParams.dynamicModulation.active = true;
        dynamicParams.dynamicModulation.oscBPosition.lfo = 0.55f;
        dynamicParams.dynamicModulation.oscBPosition.lfoBipolar = false;
        dynamicParams.dynamicModulation.oscBLevel.lfo = -0.35f;
        dynamicParams.dynamicModulation.oscBLevel.lfoBipolar = false;
        dynamicParams.dynamicModulation.oscAPan.lfo = 0.5f;
        dynamicParams.dynamicModulation.oscAPan.lfoBipolar = false;
        dynamicParams.dynamicModulation.oscBPan.lfo = -0.5f;
        dynamicParams.dynamicModulation.filterResonance.lfo = 0.25f;
        dynamicParams.dynamicModulation.filterResonance.lfoBipolar = false;
        dynamicParams.dynamicModulation.filterDrive.env = 0.22f;
        dynamicParams.dynamicModulation.unisonDetune.lfo = 0.08f;
        dynamicParams.dynamicModulation.unisonDetune.lfoBipolar = false;
        auto dynamic = render(dynamicParams);

        double dynamicDiff = 0.0;
        for (int channel = 0; channel < full.getNumChannels(); ++channel)
        {
            for (int i = 0; i < full.getNumSamples(); ++i)
            {
                const float sample = dynamic.getSample(channel, i);
                if (!std::isfinite(sample))
                    return false;
                dynamicDiff += std::abs((double) sample - (double) full.getSample(channel, i));
            }
        }

        if (dynamicDiff <= 0.1)
            return false;

        auto silentParams = params;
        silentParams.ampLevel = 0.0f;
        auto silent = render(silentParams);
        double silentEnergy = 0.0;
        for (int channel = 0; channel < silent.getNumChannels(); ++channel)
        {
            for (int i = 0; i < silent.getNumSamples(); ++i)
            {
                const float sample = silent.getSample(channel, i);
                if (!std::isfinite(sample))
                    return false;
                silentEnergy += (double) sample * (double) sample;
            }
        }

        return silentEnergy < 0.000001;
    }

    bool stressInstrumentVoiceAetherPolyphony()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 5;
        params.hasAether = true;
        params.cutoff01 = 0.62f;
        params.resonance01 = 0.22f;
        params.drive01 = 0.18f;
        params.filterType = 1;
        params.attackMs = 2.0f;
        params.decayMs = 80.0f;
        params.sustain = 0.75f;
        params.releaseMs = 120.0f;
        params.ampLevel = 0.7f;
        params.lfoDepth = 0.35f;
        params.lfoRateHz = 5.0f;
        params.lfoToFilter = 0.4f;
        params.lfoToPitch = 0.2f;
        params.envToFilter = 0.15f;

        params.aetherOscA.enabled = true;
        params.aetherOscA.level = 0.75f;
        params.aetherOscA.waveform = 5;
        params.aetherOscA.wavetable.bank = 0;
        params.aetherOscA.wavetable.position = 0.55f;
        params.aetherOscA.wavetable.unison = 8;
        params.aetherOscA.wavetable.detuneCents = 12.0f;
        params.aetherOscA.wavetable.blend = 0.7f;

        params.aetherOscB.enabled = true;
        params.aetherOscB.level = 0.5f;
        params.aetherOscB.waveform = 5;
        params.aetherOscB.semitone = 7;
        params.aetherOscB.wavetable.bank = 4;
        params.aetherOscB.wavetable.position = 0.45f;
        params.aetherOscB.wavetable.unison = 4;
        params.aetherOscB.wavetable.detuneCents = 8.0f;
        params.aetherOscB.wavetable.blend = 0.55f;

        params.aetherSub.enabled = true;
        params.aetherSub.level = 0.12f;
        params.aetherNoise.enabled = true;
        params.aetherNoise.level = 0.04f;
        params.aetherNoise.color = 0.75f;

        std::array<beat::InstrumentVoice, 16> voices;
        for (size_t i = 0; i < voices.size(); ++i)
        {
            voices[i].prepare(48000.0, 512);
            voices[i].setParams(params);
            voices[i].startNote(48 + (int) (i % 12), 0.75f, nullptr, 0);
        }

        juce::AudioBuffer<float> buffer(2, 512);
        float peak = 0.0f;
        double energy = 0.0;
        for (int block = 0; block < 128; ++block)
        {
            buffer.clear();
            for (auto& voice : voices)
                voice.renderNextBlock(buffer, 0, buffer.getNumSamples());

            for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
            {
                for (int i = 0; i < buffer.getNumSamples(); ++i)
                {
                    const float sample = buffer.getSample(channel, i);
                    if (!std::isfinite(sample))
                        return false;
                    peak = std::max(peak, std::abs(sample));
                    energy += (double) sample * (double) sample;
                }
            }
        }

        return energy > 0.01 && peak < 12.0f;
    }

    bool stressInstrumentVoiceRealtimeParameters()
    {
        beat::InstrumentVoice::Params params;
        params.hasAether = true;
        params.aetherOscA.enabled = true;
        params.aetherOscA.level = 0.8f;
        params.aetherOscA.waveform = 5;
        params.aetherOscA.wavetable.bank = 0;
        params.cutoff01 = 0.45f;
        params.resonance01 = 0.1f;
        params.ampLevel = 0.8f;

        beat::InstrumentVoice voice;
        voice.prepare(48000.0, 256);
        voice.setParams(params);
        voice.startNote(60, 0.9f, nullptr, 0);

        const std::array<std::pair<std::string_view, float>, 12> updates {{
            { "filter.cutoff", 0.72f },
            { "filter.resonance", 0.25f },
            { "filter.drive", 0.18f },
            { "amp.level", 0.66f },
            { "amp.pan", -0.35f },
            { "osc.a.position", 0.58f },
            { "osc.a.fine", 11.0f },
            { "osc.a.level", 0.7f },
            { "osc.b.position", 0.2f },
            { "unison.detune", 18.0f },
            { "unison.spread", 0.4f },
            { "lfo.1.rate", 4.0f },
        }};

        for (const auto& [parameter, value] : updates)
            if (!voice.applyRealtimeParameter(parameter, value))
                return false;
        if (!voice.applyRealtimeParameter("filter.cutoff", 0.18f, 256))
            return false;
        if (!voice.applyRealtimeParameter("amp.pan", 0.45f, 128))
            return false;
        if (!voice.applyRealtimeParameter("osc.a.position", 0.9f, 512))
            return false;
        if (voice.applyRealtimeParameter("wavetable.bank", 3.0f))
            return false;

        juce::AudioBuffer<float> buffer(2, 512);
        double energy = 0.0;
        for (int block = 0; block < 32; ++block)
        {
            buffer.clear();
            voice.renderNextBlock(buffer, 0, buffer.getNumSamples());
            for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
            {
                for (int i = 0; i < buffer.getNumSamples(); ++i)
                {
                    const float sample = buffer.getSample(channel, i);
                    if (!std::isfinite(sample))
                        return false;
                    energy += (double) sample * (double) sample;
                }
            }
        }

        return energy > 0.001;
    }

    bool stressInstrumentVoiceRealtimeRampOverride()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 0;
        params.cutoff01 = 1.0f;
        params.ampLevel = 1.0f;
        params.ampPan = 0.0f;
        params.attackMs = 1.0f;

        beat::InstrumentVoice voice;
        voice.prepare(48000.0, 256);
        voice.setParams(params);
        voice.startNote(60, 1.0f, nullptr, 0);

        if (!voice.applyRealtimeParameter("amp.pan", -1.0f, 2048))
            return false;
        if (!voice.applyRealtimeParameter("amp.pan", 1.0f, 0))
            return false;

        juce::AudioBuffer<float> buffer(2, 512);
        buffer.clear();
        voice.renderNextBlock(buffer, 0, buffer.getNumSamples());

        double leftEnergy = 0.0;
        double rightEnergy = 0.0;
        for (int i = 0; i < buffer.getNumSamples(); ++i)
        {
            leftEnergy += (double) buffer.getSample(0, i) * (double) buffer.getSample(0, i);
            rightEnergy += (double) buffer.getSample(1, i) * (double) buffer.getSample(1, i);
        }

        return rightEnergy > leftEnergy * 8.0;
    }

    bool stressInstrumentVoicePerNoteAutomation()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 0;
        params.cutoff01 = 0.9f;
        params.ampLevel = 1.0f;
        params.ampPan = 0.0f;
        params.attackMs = 1.0f;
        params.releaseMs = 5.0f;

        beat::InstrumentVoice voice;
        voice.prepare(48000.0, 256);
        voice.setParams(params);

        std::array<beat::InstrumentVoice::NoteAutomationContext, beat::InstrumentVoice::maxPendingNoteAutomationContexts> contexts {};
        contexts[0].midiNoteNumber = 60;
        contexts[0].eventCount = 1;
        contexts[0].events[0] = beat::makeRealtimeParameterChange(std::string_view {}, "amp.pan", -1.0f, 0, 0);

        beat::InstrumentVoice::setPendingNoteAutomationContexts(contexts.data(), 1);
        voice.startNote(60, 1.0f, nullptr, 0);
        beat::InstrumentVoice::clearPendingNoteAutomationContexts();

        juce::AudioBuffer<float> leftPanBuffer(2, 512);
        leftPanBuffer.clear();
        voice.renderNextBlock(leftPanBuffer, 0, leftPanBuffer.getNumSamples());

        double leftEnergy = 0.0;
        double rightEnergy = 0.0;
        for (int i = 0; i < leftPanBuffer.getNumSamples(); ++i)
        {
            leftEnergy += (double) leftPanBuffer.getSample(0, i) * (double) leftPanBuffer.getSample(0, i);
            rightEnergy += (double) leftPanBuffer.getSample(1, i) * (double) leftPanBuffer.getSample(1, i);
        }
        if (leftEnergy <= rightEnergy * 8.0)
            return false;

        voice.stopNote(0.0f, false);
        voice.startNote(60, 1.0f, nullptr, 0);

        juce::AudioBuffer<float> centeredBuffer(2, 512);
        centeredBuffer.clear();
        voice.renderNextBlock(centeredBuffer, 0, centeredBuffer.getNumSamples());

        leftEnergy = 0.0;
        rightEnergy = 0.0;
        for (int i = 0; i < centeredBuffer.getNumSamples(); ++i)
        {
            leftEnergy += (double) centeredBuffer.getSample(0, i) * (double) centeredBuffer.getSample(0, i);
            rightEnergy += (double) centeredBuffer.getSample(1, i) * (double) centeredBuffer.getSample(1, i);
        }

        const double balance = rightEnergy > 0.0 ? leftEnergy / rightEnergy : 999.0;
        return balance > 0.5 && balance < 2.0;
    }

    bool stressInstrumentVoicePerNotePitchCurve()
    {
        beat::InstrumentVoice::Params params;
        params.waveform = 0;
        params.cutoff01 = 1.0f;
        params.ampLevel = 1.0f;
        params.attackMs = 1.0f;

        beat::InstrumentVoice voice;
        voice.prepare(48000.0, 256);
        voice.setParams(params);

        std::array<beat::InstrumentVoice::NoteAutomationContext, beat::InstrumentVoice::maxPendingNoteAutomationContexts> contexts {};
        contexts[0].midiNoteNumber = 60;
        contexts[0].pitchEventCount = 2;
        contexts[0].pitchEvents[0] = { 0, (float) juce::MidiMessage::getMidiNoteInHertz(60), 0 };
        contexts[0].pitchEvents[1] = { 0, (float) juce::MidiMessage::getMidiNoteInHertz(72), 1024 };

        beat::InstrumentVoice::setPendingNoteAutomationContexts(contexts.data(), 1);
        voice.startNote(60, 1.0f, nullptr, 0);
        beat::InstrumentVoice::clearPendingNoteAutomationContexts();

        juce::AudioBuffer<float> buffer(2, 2048);
        buffer.clear();
        voice.renderNextBlock(buffer, 0, buffer.getNumSamples());

        const auto countCrossings = [&](int start, int end)
        {
            int crossings = 0;
            float previous = buffer.getSample(0, start);
            for (int i = start + 1; i < end; ++i)
            {
                const float current = buffer.getSample(0, i);
                if ((previous <= 0.0f && current > 0.0f) || (previous >= 0.0f && current < 0.0f))
                    ++crossings;
                previous = current;
            }
            return crossings;
        };

        const int earlyCrossings = countCrossings(128, 896);
        const int lateCrossings = countCrossings(1152, 1920);
        return lateCrossings > earlyCrossings;
    }
}

int main()
{
    std::cerr << "realtime: start\n";
    if (!stressRealtimeQueue())
    {
        std::cerr << "Realtime SPSC queue stress failed\n";
        return 1;
    }
    if (!stressFixedObjectPool())
    {
        std::cerr << "Fixed object pool stress failed\n";
        return 1;
    }
    if (!stressRealtimeParameterQueue())
    {
        std::cerr << "Realtime parameter queue stress failed\n";
        return 1;
    }
    std::cerr << "realtime: done\n";

    std::cerr << "wavetable: start\n";
    if (!stressWavetableOscillator())
    {
        std::cerr << "Wavetable oscillator stress failed\n";
        return 1;
    }
    std::cerr << "wavetable: done\n";

    std::cerr << "synth contract: start\n";
    if (!stressSynthPatchContract())
    {
        std::cerr << "Synth patch contract stress failed\n";
        return 1;
    }
    std::cerr << "synth contract: done\n";

    std::cerr << "voice: start\n";
    if (!stressInstrumentVoiceWavetablePath())
    {
        std::cerr << "Instrument voice wavetable stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceAetherPath())
    {
        std::cerr << "Instrument voice Aether stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceAetherPolyphony())
    {
        std::cerr << "Instrument voice Aether polyphony stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceRealtimeParameters())
    {
        std::cerr << "Instrument voice realtime parameter stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceRealtimeRampOverride())
    {
        std::cerr << "Instrument voice realtime ramp override stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoicePerNoteAutomation())
    {
        std::cerr << "Instrument voice per-note automation stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoicePerNotePitchCurve())
    {
        std::cerr << "Instrument voice per-note pitch curve stress failed\n";
        return 1;
    }
    std::cerr << "voice: done\n";

    std::cerr << "fft: start\n";
    if (!stressFftAnalyzer())
    {
        std::cerr << "FFT analyzer stress failed\n";
        return 1;
    }
    std::cerr << "fft: done\n";

    if (!stressSequencerTransport())
    {
        std::cerr << "Sequencer transport stress failed\n";
        return 1;
    }
    if (!stressSequencerAutomationMetadata())
    {
        std::cerr << "Sequencer automation metadata stress failed\n";
        return 1;
    }
    if (!stressSequencerSegmentAutomation())
    {
        std::cerr << "Sequencer segment automation stress failed\n";
        return 1;
    }
    if (!stressSequencerProjectAutomation())
    {
        std::cerr << "Sequencer project automation stress failed\n";
        return 1;
    }
    if (!stressSequencerTrackMixMetadata())
    {
        std::cerr << "Sequencer track mix metadata stress failed\n";
        return 1;
    }

    std::cout << "Backend stress passed\n";
    return 0;
}

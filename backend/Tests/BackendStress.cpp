#include "../Source/Audio/Sequencer.h"
#include "../Source/Audio/Analysis/FftAnalyzer.h"
#include "../Source/Audio/Parameters/ParameterIds.h"
#include "../Source/Audio/Wavetable/WavetableFactory.h"
#include "../Source/Audio/Wavetable/WavetableOscillator.h"

#include <array>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <string_view>

namespace
{
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
            segment.notes.push_back(note);
        }

        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    bool stressFftAnalyzer()
    {
        beat::FftAnalyzer analyzer;
        analyzer.prepare(44100.0);

        juce::AudioBuffer<float> buffer(2, 256);
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

        return snapshot.sequence > 0 && snapshot.rms > 0.0f && snapshot.peak > 0.0f && maxBand > 0.0f;
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

        return true;
    }
}

int main()
{
    std::cerr << "wavetable: start\n";
    if (!stressWavetableOscillator())
    {
        std::cerr << "Wavetable oscillator stress failed\n";
        return 1;
    }
    std::cerr << "wavetable: done\n";

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

    std::cout << "Backend stress passed\n";
    return 0;
}

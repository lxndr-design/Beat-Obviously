#include "../Source/Audio/Sequencer.h"
#include "../Source/Audio/AudioEngine.h"
#include "../Source/Audio/Analysis/AudioFileAnalyzer.h"
#include "../Source/Audio/Analysis/FftAnalyzer.h"
#include "../Source/Audio/Envelope/EnvelopeShaper.h"
#include "../Source/Audio/InstrumentVoice.h"
#include "../Source/Audio/Modulation/Lfo.h"
#include "../Source/Audio/Parameters/ParameterIds.h"
#include "../Source/Audio/Parameters/SynthPatchContract.h"
#include "../Source/Audio/Realtime/FixedObjectPool.h"
#include "../Source/Audio/Realtime/RealtimeParameterQueue.h"
#include "../Source/Audio/Realtime/SpscRingBuffer.h"
#include "../Source/Audio/Recording/RecordingCalibration.h"
#include "../Source/Audio/Recording/RecordingPlanner.h"
#include "../Source/Audio/Recording/RecordingSessionPlanner.h"
#include "../Source/Audio/Rendering/TrackBouncePlanner.h"
#include "../Source/Audio/Sampler/DecentSamplerImporter.h"
#include "../Source/Audio/Wavetable/WavetableFactory.h"
#include "../Source/Audio/Wavetable/WavetableOscillator.h"
#include "../Source/Persistence/ProjectAssetPackage.h"
#include "../Source/Persistence/ProjectDocumentBackup.h"
#include "../Source/Persistence/ProjectIntegrityVerifier.h"
#include "../Source/Persistence/Database.h"
#include "../Source/Persistence/ProjectRepository.h"

#include <array>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <optional>
#include <set>
#include <string_view>
#include <thread>
#include <vector>

namespace
{
    bool near(float actual, float expected, float tolerance = 0.0001f)
    {
        return std::abs(actual - expected) <= tolerance;
    }

    bool stressEnvelopeShaper()
    {
        if (!(beat::EnvelopeShaper::applyCurve(0.5f, 1) < beat::EnvelopeShaper::applyCurve(0.5f, 0)))
            return false;
        if (!(beat::EnvelopeShaper::applyCurve(0.5f, 2) > beat::EnvelopeShaper::applyCurve(0.5f, 0)))
            return false;

        float previous = 0.0f;
        beat::EnvelopeShaper::LoopState state;
        const beat::EnvelopeShaper::LoopConfig config {
            10.0f,
            30.0f,
            0.0f,
            20.0f,
            0,
            0,
            0,
        };

        float firstCyclePeak = 0.0f;
        float secondCyclePeak = 0.0f;
        float latest = 0.0f;
        for (int i = 0; i < 90; ++i)
        {
            latest = beat::EnvelopeShaper::renderLoop(state, config, 1000.0, previous).value;
            if (i < 40)
                firstCyclePeak = std::max(firstCyclePeak, latest);
            else if (i < 80)
                secondCyclePeak = std::max(secondCyclePeak, latest);
            if (!std::isfinite(latest))
                return false;
        }
        if (!(firstCyclePeak > 0.9f && secondCyclePeak > 0.9f))
            return false;

        state.beginRelease(latest);
        bool completed = false;
        float released = 1.0f;
        for (int i = 0; i < 30; ++i)
        {
            const auto result = beat::EnvelopeShaper::renderLoop(state, config, 1000.0, previous);
            released = result.value;
            completed = completed || result.releaseComplete;
            if (!std::isfinite(released))
                return false;
        }
        return completed && released < 0.001f;
    }

    bool stressLfoHelper()
    {
        const float sineQuarter = beat::Lfo::value(0, 0.25);
        const float triangleQuarter = beat::Lfo::value(1, 0.25);
        const float sawQuarter = beat::Lfo::value(2, 0.25);
        const float squareQuarter = beat::Lfo::value(3, 0.25);
        if (!near(sineQuarter, 1.0f, 0.0001f))
            return false;
        if (!near(triangleQuarter, 0.0f, 0.0001f))
            return false;
        if (!near(sawQuarter, -0.5f, 0.0001f))
            return false;
        if (!near(squareQuarter, 1.0f, 0.0001f))
            return false;

        const float unsmoothed = beat::Lfo::value(3, 0.125, 0.0f);
        const float smoothed = beat::Lfo::value(3, 0.125, 1.0f);
        if (!(smoothed < unsmoothed && smoothed > 0.7f))
            return false;

        const float oneShotHeld = beat::Lfo::value(2, 1.4, 0.0f, true);
        const float looped = beat::Lfo::value(2, 1.4, 0.0f, false);
        if (!near(oneShotHeld, 1.0f, 0.0001f) || !near(looped, -0.2f, 0.0001f))
            return false;

        return near(beat::Lfo::routeValue(-0.5f, true), -0.5f)
            && near(beat::Lfo::routeValue(-0.5f, false), 0.25f);
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

    beat::Project makeDenseAetherProject()
    {
        beat::Project project;
        project.id = "dense-aether-project";
        project.name = "Dense Aether Route";
        project.bpm = 148.0;
        project.lengthBeats = 8.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "dense-aether";
        instrument.kind = "synth";
        instrument.waveform = 5;
        instrument.hasAether = true;
        instrument.cutoff01 = 0.68f;
        instrument.resonance01 = 0.18f;
        instrument.drive01 = 0.22f;
        instrument.filterType = 1;
        instrument.attackMs = 2.0f;
        instrument.decayMs = 80.0f;
        instrument.sustain = 0.72f;
        instrument.releaseMs = 140.0f;
        instrument.ampLevel = 0.62f;
        instrument.lfoRateHz = 5.0f;
        instrument.lfoDepth = 0.35f;
        instrument.lfoToFilter = 0.22f;
        instrument.lfoToPitch = 0.08f;
        instrument.envToFilter = 0.12f;
        instrument.dynamicModulation.active = true;
        instrument.dynamicModulation.oscAPosition.lfo = 0.28f;
        instrument.dynamicModulation.oscBPosition.lfo = 0.38f;
        instrument.dynamicModulation.oscBPosition.lfoBipolar = false;
        instrument.dynamicModulation.filterCutoff.env = 0.18f;
        instrument.dynamicModulation.unisonDetune.lfo = 0.08f;
        instrument.dynamicModulation.unisonDetune.lfoBipolar = false;
        instrument.dynamicModulation.unisonSpread.lfo = 0.2f;
        instrument.dynamicModulation.unisonSpread.lfoBipolar = false;

        instrument.aether.oscA.enabled = true;
        instrument.aether.oscA.level = 0.72f;
        instrument.aether.oscA.pan = -0.25f;
        instrument.aether.oscA.waveform = 5;
        instrument.aether.oscA.wavetable.bank = 0;
        instrument.aether.oscA.wavetable.position = 0.56f;
        instrument.aether.oscA.wavetable.unison = 8;
        instrument.aether.oscA.wavetable.detuneCents = 13.0f;
        instrument.aether.oscA.wavetable.blend = 0.68f;

        instrument.aether.oscB.enabled = true;
        instrument.aether.oscB.level = 0.46f;
        instrument.aether.oscB.pan = 0.3f;
        instrument.aether.oscB.waveform = 5;
        instrument.aether.oscB.semitone = 7;
        instrument.aether.oscB.fineCents = -5.0f;
        instrument.aether.oscB.wavetable.bank = 4;
        instrument.aether.oscB.wavetable.position = 0.42f;
        instrument.aether.oscB.wavetable.unison = 4;
        instrument.aether.oscB.wavetable.detuneCents = 8.0f;
        instrument.aether.oscB.wavetable.blend = 0.58f;

        instrument.aether.sub.enabled = true;
        instrument.aether.sub.level = 0.12f;
        instrument.aether.sub.octave = -1;
        instrument.aether.noise.enabled = true;
        instrument.aether.noise.level = 0.035f;
        instrument.aether.noise.color = 0.72f;
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "dense-aether-track";
        track.name = "Dense Aether";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "dense-aether";
        track.gainDb = -5.0f;
        track.pan = -0.08f;

        beat::TrackEffect filter;
        filter.id = "dense-aether-filter";
        filter.kind = beat::TrackEffectKind::Lowpass;
        filter.params.push_back({ "cutoffHz", 7200.0f });
        filter.params.push_back({ "resonance", 8.0f });
        track.effects.push_back(std::move(filter));

        beat::TrackEffect saturation;
        saturation.id = "dense-aether-saturator";
        saturation.kind = beat::TrackEffectKind::Saturator;
        saturation.params.push_back({ "drive", 16.0f });
        saturation.params.push_back({ "mix", 18.0f });
        track.effects.push_back(std::move(saturation));

        beat::Segment segment;
        segment.id = "dense-aether-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "dense-aether";
        segment.startBeat = 0.0;
        segment.lengthBeats = 8.0;

        constexpr std::array<int, 8> chord { 40, 47, 52, 55, 59, 64, 67, 71 };
        for (int step = 0; step < 32; ++step)
        {
            for (int voice = 0; voice < 4; ++voice)
            {
                beat::MidiNote note;
                note.instrumentId = "dense-aether";
                note.pitch = chord[(size_t) ((step + voice * 2) % (int) chord.size())];
                note.velocity = 72 + ((step + voice * 9) % 44);
                note.startBeat = (double) step * 0.125;
                note.lengthBeats = 0.36 + (double) (voice % 2) * 0.08;

                if ((step + voice) % 5 == 0)
                {
                    beat::MidiAutomationLane lane;
                    lane.target = "osc.a.position";
                    lane.points.push_back({ note.startBeat, 0.25f });
                    lane.points.push_back({ note.startBeat + note.lengthBeats, 0.8f });
                    note.automation.push_back(std::move(lane));
                }

                segment.notes.push_back(std::move(note));
            }
        }

        beat::MidiAutomationLane ampLane;
        ampLane.target = "amp.level";
        ampLane.points.push_back({ 0.0, 0.45f });
        ampLane.points.push_back({ 4.0, 0.85f });
        ampLane.points.push_back({ 8.0, 0.55f });
        segment.automation.push_back(std::move(ampLane));

        track.segments.push_back(std::move(segment));

        beat::ProjectAutomationLane cutoffLane;
        cutoffLane.trackId = track.id;
        cutoffLane.target = "effect.dense-aether-filter.cutoffHz";
        cutoffLane.points.push_back({ 0.0, 2400.0f });
        cutoffLane.points.push_back({ 2.0, 9800.0f });
        cutoffLane.points.push_back({ 6.0, 3600.0f });
        project.automation.push_back(std::move(cutoffLane));

        project.tracks.push_back(std::move(track));
        return project;
    }

    beat::Project makeMaxUnisonAetherProject()
    {
        auto project = makeDenseAetherProject();
        project.id = "max-unison-aether-project";
        project.name = "Max Unison Aether Polyphony";
        project.bpm = 132.0;
        project.lengthBeats = 2.0;

        auto& instrument = project.instruments.front();
        instrument.id = "max-unison-aether";
        instrument.ampLevel = 0.36f;
        instrument.drive01 = 0.12f;
        instrument.releaseMs = 90.0f;
        instrument.aether.oscA.level = 0.48f;
        instrument.aether.oscA.wavetable.unison = 8;
        instrument.aether.oscA.wavetable.detuneCents = 14.0f;
        instrument.aether.oscA.wavetable.blend = 0.76f;
        instrument.aether.oscB.level = 0.32f;
        instrument.aether.oscB.wavetable.unison = 8;
        instrument.aether.oscB.wavetable.detuneCents = 10.0f;
        instrument.aether.oscB.wavetable.blend = 0.62f;
        instrument.aether.sub.level = 0.06f;
        instrument.aether.noise.level = 0.015f;

        auto& track = project.tracks.front();
        track.instrumentId = instrument.id;
        track.gainDb = -11.0f;
        track.pan = 0.0f;

        auto& segment = track.segments.front();
        segment.id = "max-unison-aether-segment";
        segment.instrumentId = instrument.id;
        segment.lengthBeats = 2.0;
        segment.notes.clear();
        segment.automation.clear();

        constexpr std::array<int, 16> chord {
            36, 40, 43, 47, 48, 52, 55, 59,
            60, 64, 67, 71, 72, 76, 79, 83
        };
        for (size_t i = 0; i < chord.size(); ++i)
        {
            beat::MidiNote note;
            note.instrumentId = instrument.id;
            note.pitch = chord[i];
            note.velocity = 62 + (int) ((i * 5) % 48);
            note.startBeat = 0.0;
            note.lengthBeats = 1.5;
            segment.notes.push_back(std::move(note));
        }

        beat::MidiAutomationLane positionLane;
        positionLane.target = "osc.a.position";
        positionLane.points.push_back({ 0.0, 0.35f });
        positionLane.points.push_back({ 1.0, 0.72f });
        positionLane.points.push_back({ 2.0, 0.48f });
        segment.automation.push_back(std::move(positionLane));

        project.automation.clear();
        beat::ProjectAutomationLane cutoffLane;
        cutoffLane.trackId = track.id;
        cutoffLane.target = "effect.dense-aether-filter.cutoffHz";
        cutoffLane.points.push_back({ 0.0, 1800.0f });
        cutoffLane.points.push_back({ 1.0, 8400.0f });
        cutoffLane.points.push_back({ 2.0, 3200.0f });
        project.automation.push_back(std::move(cutoffLane));

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

    bool stressAudioFileAnalyzer()
    {
        constexpr double sampleRate = 48000.0;
        constexpr int samples = 48000;
        juce::AudioBuffer<float> buffer(2, samples);

        for (int i = 0; i < samples; ++i)
        {
            const auto phase = (float) i * 1000.0f / (float) sampleRate;
            const auto sample = std::sin(phase * juce::MathConstants<float>::twoPi);
            buffer.setSample(0, i, sample * 0.5f);
            buffer.setSample(1, i, sample * -0.25f);
        }

        const auto analysis = beat::AudioFileAnalyzer::analyzeBuffer(buffer, sampleRate);
        if (analysis.channelCount != 2 || analysis.lengthInSamples != samples)
            return false;
        if (std::abs(analysis.durationSeconds - 1.0) > 0.0001)
            return false;
        if (std::abs(analysis.leftPeakDbFS - -6.0206f) > 0.05f)
            return false;
        if (std::abs(analysis.rightPeakDbFS - -12.0412f) > 0.05f)
            return false;
        if (std::abs(analysis.rmsDbFS - -11.0721f) > 0.08f)
            return false;
        if (std::abs(analysis.crestFactorDb - 5.0515f) > 0.1f)
            return false;
        if (std::abs(analysis.dcOffset) > 0.00001f)
            return false;
        if (analysis.clippingCount != 0 || analysis.clippingRatio != 0.0f)
            return false;
        if (std::abs(analysis.stereoCorrelation - -1.0f) > 0.001f)
            return false;
        if (!std::isfinite(analysis.truePeakDbTP) || analysis.truePeakDbTP < analysis.leftPeakDbFS - 0.05f)
            return false;
        if (!std::isfinite(analysis.integratedLufs) || analysis.integratedLufs >= 0.0f)
            return false;

        auto tempFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-audio-analysis.wav");
        if (tempFile.existsAsFile())
            tempFile.deleteFile();
        juce::WavAudioFormat wavFormat;
        auto output = tempFile.createOutputStream();
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wavFormat.createWriterFor(output.get(), sampleRate, 2, 24, {}, 0));
        if (writer == nullptr)
        {
            std::cerr << "Audio file analyzer stress failed: wav writer unavailable\n";
            return false;
        }
        output.release();
        if (!writer->writeFromAudioSampleBuffer(buffer, 0, samples))
        {
            std::cerr << "Audio file analyzer stress failed: wav write failed\n";
            return false;
        }
        writer.reset();

        const auto fileAnalysis = beat::AudioFileAnalyzer::analyzeFile(tempFile);
        if (!fileAnalysis)
        {
            std::cerr << "Audio file analyzer stress failed: file analysis unavailable\n";
            tempFile.deleteFile();
            return false;
        }
        if (fileAnalysis->channelCount != 2 || fileAnalysis->lengthInSamples != samples || fileAnalysis->bitDepth != 24)
        {
            std::cerr << "Audio file analyzer stress failed: metadata channels="
                      << fileAnalysis->channelCount
                      << " samples=" << fileAnalysis->lengthInSamples
                      << " bitDepth=" << fileAnalysis->bitDepth << "\n";
            tempFile.deleteFile();
            return false;
        }
        if (std::abs(fileAnalysis->leftPeakDbFS - analysis.leftPeakDbFS) > 0.06f)
        {
            std::cerr << "Audio file analyzer stress failed: left peak buffer="
                      << analysis.leftPeakDbFS << " file=" << fileAnalysis->leftPeakDbFS << "\n";
            tempFile.deleteFile();
            return false;
        }
        if (std::abs(fileAnalysis->rightPeakDbFS - analysis.rightPeakDbFS) > 0.06f)
        {
            std::cerr << "Audio file analyzer stress failed: right peak buffer="
                      << analysis.rightPeakDbFS << " file=" << fileAnalysis->rightPeakDbFS << "\n";
            tempFile.deleteFile();
            return false;
        }
        if (std::abs(fileAnalysis->rmsDbFS - analysis.rmsDbFS) > 0.06f)
        {
            std::cerr << "Audio file analyzer stress failed: rms buffer="
                      << analysis.rmsDbFS << " file=" << fileAnalysis->rmsDbFS << "\n";
            tempFile.deleteFile();
            return false;
        }
        if (std::abs(fileAnalysis->stereoCorrelation - analysis.stereoCorrelation) > 0.001f)
        {
            std::cerr << "Audio file analyzer stress failed: correlation buffer="
                      << analysis.stereoCorrelation << " file=" << fileAnalysis->stereoCorrelation << "\n";
            tempFile.deleteFile();
            return false;
        }
        if (std::abs(fileAnalysis->integratedLufs - analysis.integratedLufs) > 0.2f)
        {
            std::cerr << "Audio file analyzer stress failed: lufs buffer="
                      << analysis.integratedLufs << " file=" << fileAnalysis->integratedLufs << "\n";
            tempFile.deleteFile();
            return false;
        }

        const auto waveform = beat::AudioFileAnalyzer::analyzeWaveformFile(tempFile, 32);
        tempFile.deleteFile();
        if (!waveform || waveform->bucketCount != 32 || waveform->left.upper.size() != 32 || waveform->right.lower.size() != 32)
        {
            std::cerr << "Audio waveform stress failed: waveform unavailable or wrong bucket count\n";
            return false;
        }
        float leftUpperPeak = 0.0f;
        float rightLowerPeak = 0.0f;
        for (size_t i = 0; i < waveform->left.upper.size(); ++i)
        {
            leftUpperPeak = std::max(leftUpperPeak, waveform->left.upper[i]);
            rightLowerPeak = std::max(rightLowerPeak, waveform->right.lower[i]);
            if (waveform->left.upper[i] < 0.0f || waveform->left.upper[i] > 1.0f
                || waveform->left.lower[i] < 0.0f || waveform->left.lower[i] > 1.0f
                || waveform->right.upper[i] < 0.0f || waveform->right.upper[i] > 1.0f
                || waveform->right.lower[i] < 0.0f || waveform->right.lower[i] > 1.0f)
            {
                std::cerr << "Audio waveform stress failed: bucket out of normalized bounds\n";
                return false;
            }
        }
        if (leftUpperPeak < 0.45f || rightLowerPeak < 0.2f)
        {
            std::cerr << "Audio waveform stress failed: expected stereo peaks left="
                      << leftUpperPeak << " rightLower=" << rightLowerPeak << "\n";
            return false;
        }

        buffer.clear();
        buffer.setSample(0, 8, 1.0f);
        buffer.setSample(1, 16, -1.0f);
        const auto clipping = beat::AudioFileAnalyzer::analyzeBuffer(buffer, sampleRate);
        return clipping.clippingCount == 2
            && clipping.clippingRatio > 0.0f
            && clipping.truePeakDbTP >= -0.01f;
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

    bool stressSequencerLoopCrossing()
    {
        beat::Sequencer sequencer;
        sequencer.setSampleRate(44100.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(makeStressProject());
        sequencer.setLoop(4.0, 8.0);
        sequencer.play();

        sequencer.seek(10.0);
        sequencer.render(512, [](const beat::Sequencer::TriggerEvent&) {});
        if (sequencer.getPosition() <= 4.5 || sequencer.getPosition() >= 11.0)
            return false;

        sequencer.seek(8.0);
        sequencer.render(512, [](const beat::Sequencer::TriggerEvent&) {});
        if (sequencer.getPosition() < 4.0 || sequencer.getPosition() > 4.05)
            return false;

        sequencer.seek(7.99);
        sequencer.render(1024, [](const beat::Sequencer::TriggerEvent&) {});
        return sequencer.getPosition() >= 4.0 && sequencer.getPosition() <= 4.05;
    }

    bool stressSequencerLoopBoundaryScheduling()
    {
        beat::Sequencer sequencer;
        sequencer.setSampleRate(44100.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(makeStressProject());
        sequencer.setLoop(4.0, 8.0);
        sequencer.seek(7.99);
        sequencer.play();

        bool triggeredLoopStart = false;
        bool triggeredPastLoopEnd = false;
        sequencer.render(4096, [&](const beat::Sequencer::TriggerEvent& ev) {
            if (ev.segmentStartBeat > 4.0 && ev.segmentStartBeat >= 8.0)
                triggeredPastLoopEnd = true;
            if (std::abs(ev.segmentStartBeat - 4.0) < 0.000001
                && ev.sampleOffset > 0
                && ev.sampleOffset < 4096)
            {
                triggeredLoopStart = true;
            }
        });

        return triggeredLoopStart && !triggeredPastLoopEnd;
    }

    bool stressSequencerCropsMidiNotesToSegmentLength()
    {
        beat::Project project;
        project.id = "crop-midi-segment-project";
        project.name = "Crop MIDI Segment Project";
        project.bpm = 120.0;
        project.lengthBeats = 4.0;

        beat::Track track;
        track.id = "crop-track";
        track.name = "Crop Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "crop-instrument";

        beat::Segment segment;
        segment.id = "crop-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "crop-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 1.0;
        segment.repeats = 1;

        beat::MidiNote inside;
        inside.instrumentId = "crop-instrument";
        inside.pitch = 60;
        inside.velocity = 100;
        inside.startBeat = 0.25;
        inside.lengthBeats = 0.25;
        segment.notes.push_back(inside);

        beat::MidiNote crossingTail;
        crossingTail.instrumentId = "crop-instrument";
        crossingTail.pitch = 62;
        crossingTail.velocity = 100;
        crossingTail.startBeat = 0.75;
        crossingTail.lengthBeats = 0.75;
        segment.notes.push_back(crossingTail);

        beat::MidiNote outsideCroppedTail;
        outsideCroppedTail.instrumentId = "crop-instrument";
        outsideCroppedTail.pitch = 64;
        outsideCroppedTail.velocity = 100;
        outsideCroppedTail.startBeat = 1.25;
        outsideCroppedTail.lengthBeats = 0.25;
        segment.notes.push_back(outsideCroppedTail);

        track.segments.push_back(segment);
        project.tracks.push_back(track);

        beat::Sequencer sequencer;
        sequencer.setSampleRate(44100.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(std::move(project));
        sequencer.seek(0.0);
        sequencer.play();

        int insideCount = 0;
        int clippedTailCount = 0;
        int outsideCount = 0;
        bool clippedDuration = false;

        sequencer.render(44100 * 2, [&](const beat::Sequencer::TriggerEvent& ev) {
            if (ev.pitch == 60)
                ++insideCount;
            else if (ev.pitch == 62)
            {
                ++clippedTailCount;
                clippedDuration = clippedDuration || ev.lengthBeats <= 0.251;
            }
            else if (ev.pitch == 64)
                ++outsideCount;
        });

        return insideCount == 2
            && clippedTailCount == 2
            && outsideCount == 0
            && clippedDuration;
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

    bool stressSequencerGlideMetadata()
    {
        auto project = makeStressProject();
        project.instruments.front().glideMs = 120.0f;
        auto& note = project.tracks.front().segments.front().notes.front();
        note.connectToIndex = 1;

        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(project);
        sequencer.seek(0.0);
        sequencer.play();

        bool foundGlideNote = false;
        sequencer.render(2048, [&](const beat::Sequencer::TriggerEvent& ev) {
            if (ev.noteIndex == 0)
            {
                foundGlideNote = true;
                if (ev.glideTargetPitch != project.tracks.front().segments.front().notes[1].pitch)
                    std::abort();
                if (!near(ev.instrumentGlideMs, 120.0f))
                    std::abort();
            }
        });

        return foundGlideNote;
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
        bool checkedSegmentAutomationStart = false;
        sequencer.render(512,
            [](const beat::Sequencer::TriggerEvent&) {},
            [&](const beat::Sequencer::ParameterAutomationEvent& ev) {
                if (ev.parameterId != "amp.level")
                    return;
                foundSegmentAutomation = true;
                if (!checkedSegmentAutomationStart && ev.sampleOffset == 0)
                {
                    checkedSegmentAutomationStart = true;
                    if (std::abs(ev.value - 0.65f) > 0.01f)
                        std::abort();
                    if (ev.rampSamples <= 0)
                        std::abort();
                }
            });

        return foundSegmentAutomation && checkedSegmentAutomationStart;
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
        bool checkedProjectAutomationStart = false;
        sequencer.render(512,
            [](const beat::Sequencer::TriggerEvent&) {},
            [&](const beat::Sequencer::ParameterAutomationEvent& ev) {
                if (ev.segmentId.isNotEmpty() || ev.parameterId != "filter.cutoff")
                    return;
                foundProjectAutomation = true;
                if (ev.instrumentId != "stress-synth")
                    std::abort();
                if (!checkedProjectAutomationStart && ev.sampleOffset == 0)
                {
                    checkedProjectAutomationStart = true;
                    if (std::abs(ev.value - 0.5f) > 0.01f)
                        std::abort();
                    if (ev.rampSamples <= 0)
                        std::abort();
                }
            });

        return foundProjectAutomation && checkedProjectAutomationStart;
    }

    bool stressSequencerTrackEffectAutomation()
    {
        beat::Project project;
        project.id = "track-effect-automation";
        project.bpm = 120.0;
        project.lengthBeats = 8.0;

        beat::Track track;
        track.id = "effect-track";
        track.kind = beat::TrackKind::Audio;

        beat::TrackEffect effect;
        effect.id = "effect-lowpass";
        effect.kind = beat::TrackEffectKind::Lowpass;
        effect.params.push_back({ "cutoffHz", 1000.0f });
        beat::MidiAutomationLane lane;
        lane.target = "cutoffHz";
        lane.points.push_back({ 0.0, 1000.0f, beat::AutomationCurve::Quadratic });
        lane.points.push_back({ 4.0, 9000.0f });
        effect.automation.push_back(std::move(lane));
        track.effects.push_back(std::move(effect));
        project.tracks.push_back(std::move(track));

        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(project);
        sequencer.seek(2.0);
        sequencer.play();

        bool foundEffectAutomation = false;
        bool checkedEffectAutomationStart = false;
        sequencer.render(512,
            [](const beat::Sequencer::TriggerEvent&) {},
            [&](const beat::Sequencer::ParameterAutomationEvent& ev) {
                if (ev.trackId != "effect-track" || ev.parameterId != "effect.effect-lowpass.cutoffHz")
                    return;
                foundEffectAutomation = true;
                if (!checkedEffectAutomationStart && ev.sampleOffset == 0)
                {
                    checkedEffectAutomationStart = true;
                    if (std::abs(ev.value - 3000.0f) > 1.0f)
                        std::abort();
                }
            });

        return foundEffectAutomation && checkedEffectAutomationStart;
    }

    bool stressSequencerAutomationCurveCheckpoints()
    {
        beat::Project project;
        project.id = "automation-curve-checkpoints";
        project.bpm = 60.0;
        project.lengthBeats = 2.0;

        auto addLane = [&](const juce::String& target, beat::AutomationCurve curve) {
            beat::ProjectAutomationLane lane;
            lane.trackId = "automation-track";
            lane.target = target;
            lane.points.push_back({ 0.0, 0.0f, curve });
            lane.points.push_back({ 1.0, 1.0f, beat::AutomationCurve::Linear });
            project.automation.push_back(std::move(lane));
        };

        addLane("track.gainDb", beat::AutomationCurve::Linear);
        addLane("track.pan", beat::AutomationCurve::Cubic);
        addLane("track.width", beat::AutomationCurve::EaseOut);
        addLane("track.send", beat::AutomationCurve::Smoothstep);

        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(60.0);
        sequencer.setProject(project);
        sequencer.seek(0.0);
        sequencer.play();

        std::vector<beat::Sequencer::ParameterAutomationEvent> events;
        sequencer.render(48000,
            [](const beat::Sequencer::TriggerEvent&) {},
            [&](const beat::Sequencer::ParameterAutomationEvent& ev) {
                events.push_back(ev);
            });

        int linearCount = 0;
        int cubicCount = 0;
        int easeOutCount = 0;
        int smoothstepCount = 0;
        float linearMid = -1.0f;
        float cubicMid = -1.0f;
        float easeOutMid = -1.0f;
        float smoothstepMid = -1.0f;
        int linearMidDistance = std::numeric_limits<int>::max();
        int cubicMidDistance = std::numeric_limits<int>::max();
        int easeOutMidDistance = std::numeric_limits<int>::max();
        int smoothstepMidDistance = std::numeric_limits<int>::max();

        for (const auto& ev : events)
        {
            const int distance = std::abs(ev.sampleOffset - 24000);
            if (ev.parameterId == "track.gainDb")
            {
                ++linearCount;
                if (distance < linearMidDistance)
                {
                    linearMidDistance = distance;
                    linearMid = ev.value;
                }
            }
            else if (ev.parameterId == "track.pan")
            {
                ++cubicCount;
                if (distance < cubicMidDistance)
                {
                    cubicMidDistance = distance;
                    cubicMid = ev.value;
                }
            }
            else if (ev.parameterId == "track.width")
            {
                ++easeOutCount;
                if (distance < easeOutMidDistance)
                {
                    easeOutMidDistance = distance;
                    easeOutMid = ev.value;
                }
            }
            else if (ev.parameterId == "track.send")
            {
                ++smoothstepCount;
                if (distance < smoothstepMidDistance)
                {
                    smoothstepMidDistance = distance;
                    smoothstepMid = ev.value;
                }
            }
        }

        const bool ok = linearCount > 100
            && cubicCount > 100
            && easeOutCount > 100
            && smoothstepCount > 100
            && std::abs(linearMid - 0.5f) < 0.02f
            && std::abs(cubicMid - 0.125f) < 0.02f
            && std::abs(easeOutMid - 0.75f) < 0.02f
            && std::abs(smoothstepMid - 0.5f) < 0.02f;

        if (!ok)
        {
            std::cerr << "Automation curve checkpoint stress failed linearCount=" << linearCount
                      << " cubicCount=" << cubicCount
                      << " easeOutCount=" << easeOutCount
                      << " smoothstepCount=" << smoothstepCount
                      << " linearMid=" << linearMid
                      << " cubicMid=" << cubicMid
                      << " easeOutMid=" << easeOutMid
                      << " smoothstepMid=" << smoothstepMid << "\n";
        }

        return ok;
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

    bool stressSequencerAudioClipEvents()
    {
        beat::Project project;
        project.id = "audio-clip-sequencer";
        project.bpm = 120.0;
        project.lengthBeats = 4.0;

        beat::Track track;
        track.id = "audio-track";
        track.kind = beat::TrackKind::Audio;
        track.gainDb = -4.0f;
        track.pan = -0.25f;

        beat::Segment segment;
        segment.id = "audio-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Audio;
        segment.audioFileId = "audio-file";
        segment.audioGainDb = -2.0f;
        segment.startBeat = 1.0;
        segment.lengthBeats = 2.0;
        segment.sourceStartBeat = 0.25;
        segment.fadeInBeats = 0.25;
        segment.fadeOutBeats = 0.5;
        track.segments.push_back(segment);
        project.tracks.push_back(track);

        beat::Sequencer sequencer;
        sequencer.setSampleRate(48000.0);
        sequencer.setTempo(120.0);
        sequencer.setProject(project);
        sequencer.seek(1.5);
        sequencer.play();

        bool foundClip = false;
        sequencer.render(512,
            [](const beat::Sequencer::TriggerEvent&) {},
            {},
            [&](const beat::Sequencer::AudioClipEvent& ev) {
                foundClip = true;
                if (ev.trackId != "audio-track" || ev.segmentId != "audio-segment" || ev.audioFileId != "audio-file")
                    std::abort();
                if (ev.sampleOffset != 0 || ev.lengthSamples <= 0)
                    std::abort();
                if (std::abs(ev.sourceOffsetBeats - 0.75) > 0.0001)
                    std::abort();
                if (std::abs(ev.clipOffsetBeats - 0.5) > 0.0001 || std::abs(ev.clipLengthBeats - 2.0) > 0.0001)
                    std::abort();
                if (std::abs(ev.fadeInBeats - 0.25) > 0.0001 || std::abs(ev.fadeOutBeats - 0.5) > 0.0001)
                    std::abort();
                if (!near(ev.trackGainDb, -4.0f) || !near(ev.trackPan, -0.25f) || !near(ev.segmentGainDb, -2.0f))
                    std::abort();
            });

        return foundClip;
    }

    bool writeAudioClipFixture(const juce::File& file)
    {
        if (file.existsAsFile())
            file.deleteFile();

        std::unique_ptr<juce::FileOutputStream> stream(file.createOutputStream());
        if (stream == nullptr || stream->failedToOpen())
            return false;

        constexpr int sampleRate = 44100;
        constexpr int channels = 1;
        constexpr int totalSamples = sampleRate / 2;
        constexpr int bitsPerSample = 16;
        constexpr int bytesPerSample = bitsPerSample / 8;
        constexpr uint32_t dataBytes = totalSamples * channels * bytesPerSample;

        const auto writeU16 = [&stream](uint16_t value)
        {
            const unsigned char bytes[2] {
                (unsigned char) (value & 0xffu),
                (unsigned char) ((value >> 8u) & 0xffu),
            };
            return stream->write(bytes, sizeof(bytes));
        };
        const auto writeU32 = [&stream](uint32_t value)
        {
            const unsigned char bytes[4] {
                (unsigned char) (value & 0xffu),
                (unsigned char) ((value >> 8u) & 0xffu),
                (unsigned char) ((value >> 16u) & 0xffu),
                (unsigned char) ((value >> 24u) & 0xffu),
            };
            return stream->write(bytes, sizeof(bytes));
        };

        stream->write("RIFF", 4);
        writeU32(36 + dataBytes);
        stream->write("WAVE", 4);
        stream->write("fmt ", 4);
        writeU32(16);
        writeU16(1);
        writeU16(channels);
        writeU32(sampleRate);
        writeU32(sampleRate * channels * bytesPerSample);
        writeU16(channels * bytesPerSample);
        writeU16(bitsPerSample);
        stream->write("data", 4);
        writeU32(dataBytes);

        for (int i = 0; i < totalSamples; ++i)
        {
            const float tone = std::sin((float) i * juce::MathConstants<float>::twoPi * 220.0f / (float) sampleRate) * 0.6f;
            writeU16((uint16_t) (int16_t) std::lrint(tone * 32767.0f));
        }

        stream->flush();
        return true;
    }

    bool writeSampleZoneOffsetFixture(const juce::File& file)
    {
        if (file.existsAsFile())
            file.deleteFile();

        std::unique_ptr<juce::FileOutputStream> stream(file.createOutputStream());
        if (stream == nullptr || stream->failedToOpen())
            return false;

        constexpr int sampleRate = 44100;
        constexpr int channels = 1;
        constexpr int totalSamples = 4096;
        constexpr int bitsPerSample = 16;
        constexpr int bytesPerSample = bitsPerSample / 8;
        constexpr uint32_t dataBytes = totalSamples * channels * bytesPerSample;

        const auto writeU16 = [&stream](uint16_t value)
        {
            const unsigned char bytes[2] {
                (unsigned char) (value & 0xffu),
                (unsigned char) ((value >> 8u) & 0xffu),
            };
            return stream->write(bytes, sizeof(bytes));
        };
        const auto writeU32 = [&stream](uint32_t value)
        {
            const unsigned char bytes[4] {
                (unsigned char) (value & 0xffu),
                (unsigned char) ((value >> 8u) & 0xffu),
                (unsigned char) ((value >> 16u) & 0xffu),
                (unsigned char) ((value >> 24u) & 0xffu),
            };
            return stream->write(bytes, sizeof(bytes));
        };

        stream->write("RIFF", 4);
        writeU32(36 + dataBytes);
        stream->write("WAVE", 4);
        stream->write("fmt ", 4);
        writeU32(16);
        writeU16(1);
        writeU16(channels);
        writeU32(sampleRate);
        writeU32(sampleRate * channels * bytesPerSample);
        writeU16(channels * bytesPerSample);
        writeU16(bitsPerSample);
        stream->write("data", 4);
        writeU32(dataBytes);

        for (int i = 0; i < totalSamples; ++i)
        {
            const float amplitude = i < totalSamples / 2 ? 0.02f : 0.75f;
            const float tone = std::sin((float) i * juce::MathConstants<float>::twoPi * 330.0f / (float) sampleRate) * amplitude;
            writeU16((uint16_t) (int16_t) std::lrint(tone * 32767.0f));
        }

        stream->flush();
        return true;
    }

    beat::Project makeDecentFixtureProject(const beat::DecentSamplerImport& source)
    {
        beat::Project project;
        project.id = "decent-fixture-project";
        project.name = "Decent Sampler Fixture";
        project.bpm = 120.0;
        project.lengthBeats = 2.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "decent-fixture-instrument";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 35.0f;
        instrument.sampleUrls = source.sampleUrls;
        for (const auto& sample : source.samples)
        {
            instrument.sampleZones.push_back({
                sample.path,
                sample.rootNote,
                sample.loNote,
                sample.hiNote,
                sample.loVel,
                sample.hiVel,
                (float) sample.volumeDb,
                (float) sample.pan,
                (float) sample.tuning,
                sample.seqPosition,
                sample.loopEnabled,
                sample.loopStart,
                sample.loopEnd,
                sample.oneShot,
                sample.durationSeconds,
                sample.loLengthSeconds,
                sample.hiLengthSeconds,
                sample.chokeGroup,
                sample.startSample,
                sample.endSample,
            });
        }
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "decent-fixture-track";
        track.name = "Decent Fixture Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "decent-fixture-instrument";

        beat::Segment segment;
        segment.id = "decent-fixture-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "decent-fixture-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 2.0;

        const auto& instrumentRef = project.instruments.front();
        const int noteCount = juce::jmin(16, (int) instrumentRef.sampleZones.size());
        for (int i = 0; i < noteCount; ++i)
        {
            const auto& zone = instrumentRef.sampleZones[(size_t) i];
            beat::MidiNote note;
            note.instrumentId = "decent-fixture-instrument";
            note.pitch = juce::jlimit(0, 127, zone.loNote <= zone.hiNote ? zone.loNote : zone.rootNote);
            note.velocity = juce::jlimit(1, 127, (zone.loVel + zone.hiVel) / 2);
            note.startBeat = (double) i * 0.125;
            note.lengthBeats = 0.08;
            segment.notes.push_back(note);
        }

        track.segments.push_back(std::move(segment));
        project.tracks.push_back(std::move(track));
        return project;
    }

    beat::Project makeAudioClipOfflineProject(const juce::File& file)
    {
        beat::Project project;
        project.id = "offline-audio-clip-project";
        project.name = "Offline Audio Clip";
        project.bpm = 120.0;
        project.lengthBeats = 1.0;

        beat::AudioFileAsset audioFile;
        audioFile.id = "clip-file";
        audioFile.name = "Clip Fixture";
        audioFile.path = file.getFullPathName();
        audioFile.durationSeconds = 0.5;
        audioFile.sampleRate = 44100.0;
        project.audioFiles.push_back(std::move(audioFile));

        beat::Track track;
        track.id = "audio-clip-track";
        track.name = "Audio Clip Track";
        track.kind = beat::TrackKind::Audio;

        beat::TrackEffect effect;
        effect.id = "clip-saturator";
        effect.kind = beat::TrackEffectKind::Saturator;
        effect.params.push_back({ "drive", 30.0f });
        effect.params.push_back({ "mix", 25.0f });
        track.effects.push_back(std::move(effect));

        beat::Segment segment;
        segment.id = "audio-clip-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Audio;
        segment.audioFileId = "clip-file";
        segment.startBeat = 0.0;
        segment.lengthBeats = 1.0;
        track.segments.push_back(std::move(segment));
        project.tracks.push_back(std::move(track));
        return project;
    }

    beat::Project makeAudioClipFadeProject(const juce::File& file, double fadeInBeats, double fadeOutBeats)
    {
        beat::Project project;
        project.id = "offline-audio-clip-fade-project";
        project.name = "Offline Audio Clip Fade";
        project.bpm = 120.0;
        project.lengthBeats = 1.0;

        beat::AudioFileAsset audioFile;
        audioFile.id = "clip-file";
        audioFile.name = "Clip Fixture";
        audioFile.path = file.getFullPathName();
        audioFile.durationSeconds = 0.5;
        audioFile.sampleRate = 44100.0;
        project.audioFiles.push_back(std::move(audioFile));

        beat::Track track;
        track.id = "audio-clip-fade-track";
        track.name = "Audio Clip Fade Track";
        track.kind = beat::TrackKind::Audio;

        beat::Segment segment;
        segment.id = "audio-clip-fade-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Audio;
        segment.audioFileId = "clip-file";
        segment.startBeat = 0.0;
        segment.lengthBeats = 1.0;
        segment.fadeInBeats = fadeInBeats;
        segment.fadeOutBeats = fadeOutBeats;
        track.segments.push_back(std::move(segment));
        project.tracks.push_back(std::move(track));
        return project;
    }

    beat::Project makeAudioClipCrossfadeProject(const juce::File& file)
    {
        beat::Project project;
        project.id = "offline-audio-clip-crossfade-project";
        project.name = "Offline Audio Clip Crossfade";
        project.bpm = 120.0;
        project.lengthBeats = 1.75;

        beat::AudioFileAsset audioFile;
        audioFile.id = "clip-file";
        audioFile.name = "Clip Fixture";
        audioFile.path = file.getFullPathName();
        audioFile.durationSeconds = 0.5;
        audioFile.sampleRate = 44100.0;
        project.audioFiles.push_back(std::move(audioFile));

        beat::Track track;
        track.id = "audio-clip-crossfade-track";
        track.name = "Audio Clip Crossfade Track";
        track.kind = beat::TrackKind::Audio;

        beat::Segment left;
        left.id = "audio-clip-crossfade-left";
        left.trackId = track.id;
        left.kind = beat::SegmentPayloadKind::Audio;
        left.audioFileId = "clip-file";
        left.startBeat = 0.0;
        left.lengthBeats = 1.0;
        left.fadeOutBeats = 0.25;
        track.segments.push_back(std::move(left));

        beat::Segment right;
        right.id = "audio-clip-crossfade-right";
        right.trackId = track.id;
        right.kind = beat::SegmentPayloadKind::Audio;
        right.audioFileId = "clip-file";
        right.startBeat = 0.75;
        right.lengthBeats = 1.0;
        right.fadeInBeats = 0.25;
        track.segments.push_back(std::move(right));

        project.tracks.push_back(std::move(track));
        return project;
    }

    beat::Project makeAudioClipTrimProject(const juce::File& file)
    {
        beat::Project project;
        project.id = "offline-audio-clip-trim-project";
        project.name = "Offline Audio Clip Trim";
        project.bpm = 120.0;
        project.lengthBeats = 0.75;

        beat::AudioFileAsset audioFile;
        audioFile.id = "clip-file";
        audioFile.name = "Clip Fixture";
        audioFile.path = file.getFullPathName();
        audioFile.durationSeconds = 0.5;
        audioFile.sampleRate = 44100.0;
        project.audioFiles.push_back(std::move(audioFile));

        beat::Track track;
        track.id = "audio-clip-trim-track";
        track.name = "Audio Clip Trim Track";
        track.kind = beat::TrackKind::Audio;

        beat::Segment segment;
        segment.id = "audio-clip-trim-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Audio;
        segment.audioFileId = "clip-file";
        segment.startBeat = 0.0;
        segment.lengthBeats = 0.75;
        segment.sourceStartBeat = 0.25;
        track.segments.push_back(std::move(segment));

        project.tracks.push_back(std::move(track));
        return project;
    }

    beat::Project makeSampleInstrumentOfflineProject(const juce::File& file)
    {
        beat::Project project;
        project.id = "offline-sample-route-project";
        project.name = "Offline Sample Route";
        project.bpm = 120.0;
        project.lengthBeats = 0.5;

        beat::InstrumentDefinition instrument;
        instrument.id = "sample-route-instrument";
        instrument.kind = "sampler";
        instrument.sampleUrls.add(file.getFullPathName());
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "sample-route-track";
        track.name = "Sample Route Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "sample-route-instrument";

        beat::Segment segment;
        segment.id = "sample-route-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "sample-route-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 0.5;

        beat::MidiNote note;
        note.instrumentId = "sample-route-instrument";
        note.pitch = 60;
        note.velocity = 120;
        note.startBeat = 0.0;
        note.lengthBeats = 0.25;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeSampleZoneOfflineProject(const juce::File& file, int velocity, float noteLengthBeats)
    {
        beat::Project project;
        project.id = "offline-sample-zone-project";
        project.name = "Offline Sample Zone";
        project.bpm = 120.0;
        project.lengthBeats = 0.75;

        beat::InstrumentDefinition instrument;
        instrument.id = "sample-zone-instrument";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 5.0f;
        instrument.sampleUrls.add(file.getFullPathName());
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            0,
            63,
            -24.0f,
            0.0f,
            0.0f,
            0,
            false,
            0,
            0,
            false,
        });
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            64,
            127,
            0.0f,
            0.0f,
            0.0f,
            1,
            false,
            0,
            0,
            false,
        });
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "sample-zone-track";
        track.name = "Sample Zone Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "sample-zone-instrument";

        beat::Segment segment;
        segment.id = "sample-zone-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "sample-zone-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 0.75;

        beat::MidiNote note;
        note.instrumentId = "sample-zone-instrument";
        note.pitch = 60;
        note.velocity = velocity;
        note.startBeat = 0.0;
        note.lengthBeats = noteLengthBeats;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeSampleZoneOffsetProject(const juce::File& file, int startSample, int endSample)
    {
        beat::Project project;
        project.id = "sample-zone-offset-project";
        project.name = "Sample Zone Offset";
        project.bpm = 120.0;
        project.lengthBeats = 0.5;

        beat::InstrumentDefinition instrument;
        instrument.id = "sample-zone-offset-instrument";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 1.0f;
        instrument.sampleUrls.add(file.getFullPathName());

        beat::InstrumentDefinition::SampleZone zone;
        zone.path = file.getFullPathName();
        zone.rootNote = 60;
        zone.loNote = 0;
        zone.hiNote = 127;
        zone.loVel = 0;
        zone.hiVel = 127;
        zone.oneShot = true;
        zone.startSample = startSample;
        zone.endSample = endSample;
        instrument.sampleZones.push_back(zone);
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "sample-zone-offset-track";
        track.name = "Sample Zone Offset Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "sample-zone-offset-instrument";

        beat::Segment segment;
        segment.id = "sample-zone-offset-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "sample-zone-offset-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 0.5;

        beat::MidiNote note;
        note.instrumentId = "sample-zone-offset-instrument";
        note.pitch = 60;
        note.velocity = 127;
        note.startBeat = 0.0;
        note.lengthBeats = 0.25;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeSampleZoneLengthProject(const juce::File& file, float noteLengthBeats)
    {
        beat::Project project;
        project.id = "offline-sample-zone-length-project";
        project.name = "Offline Sample Zone Length";
        project.bpm = 120.0;
        project.lengthBeats = 1.25;

        beat::InstrumentDefinition instrument;
        instrument.id = "sample-zone-length-instrument";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 5.0f;
        instrument.sampleUrls.add(file.getFullPathName());
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            0,
            127,
            -36.0f,
            0.0f,
            0.0f,
            0,
            false,
            0,
            0,
            false,
            0.1,
            0.0,
            0.2,
        });
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            0,
            127,
            0.0f,
            0.0f,
            0.0f,
            1,
            false,
            0,
            0,
            false,
            0.8,
            0.2,
            1.2,
        });
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "sample-zone-length-track";
        track.name = "Sample Zone Length Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "sample-zone-length-instrument";

        beat::Segment segment;
        segment.id = "sample-zone-length-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "sample-zone-length-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 1.25;

        beat::MidiNote note;
        note.instrumentId = "sample-zone-length-instrument";
        note.pitch = 60;
        note.velocity = 112;
        note.startBeat = 0.0;
        note.lengthBeats = noteLengthBeats;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeSampleZoneMultiVariableProject(const juce::File& file, int velocity, float noteLengthBeats)
    {
        beat::Project project;
        project.id = "offline-sample-zone-multi-variable-project";
        project.name = "Offline Sample Zone Multi Variable";
        project.bpm = 120.0;
        project.lengthBeats = 1.25;

        beat::InstrumentDefinition instrument;
        instrument.id = "sample-zone-multi-variable-instrument";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 5.0f;
        instrument.sampleUrls.add(file.getFullPathName());
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            0,
            63,
            -36.0f,
            0.0f,
            0.0f,
            0,
            false,
            0,
            0,
            false,
            0.08,
            0.0,
            0.2,
        });
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            64,
            127,
            -24.0f,
            0.0f,
            0.0f,
            1,
            false,
            0,
            0,
            false,
            0.08,
            0.0,
            0.2,
        });
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            0,
            63,
            -12.0f,
            0.0f,
            0.0f,
            2,
            false,
            0,
            0,
            false,
            0.8,
            0.2,
            1.2,
        });
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            64,
            127,
            0.0f,
            0.0f,
            0.0f,
            3,
            false,
            0,
            0,
            false,
            0.8,
            0.2,
            1.2,
        });
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "sample-zone-multi-variable-track";
        track.name = "Sample Zone Multi Variable Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "sample-zone-multi-variable-instrument";

        beat::Segment segment;
        segment.id = "sample-zone-multi-variable-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "sample-zone-multi-variable-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 1.25;

        beat::MidiNote note;
        note.instrumentId = "sample-zone-multi-variable-instrument";
        note.pitch = 60;
        note.velocity = velocity;
        note.startBeat = 0.0;
        note.lengthBeats = noteLengthBeats;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeSampleLoopOfflineProject(const juce::File& file, bool loopEnabled, bool oneShot)
    {
        beat::Project project;
        project.id = "offline-sample-loop-project";
        project.name = "Offline Sample Loop";
        project.bpm = 120.0;
        project.lengthBeats = 2.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "sample-loop-instrument";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 5.0f;
        instrument.sampleUrls.add(file.getFullPathName());
        instrument.sampleZones.push_back({
            file.getFullPathName(),
            60,
            0,
            127,
            0,
            127,
            0.0f,
            0.0f,
            0.0f,
            0,
            loopEnabled,
            1200,
            3600,
            oneShot,
        });
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "sample-loop-track";
        track.name = "Sample Loop Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "sample-loop-instrument";

        beat::Segment segment;
        segment.id = "sample-loop-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "sample-loop-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 2.0;

        beat::MidiNote note;
        note.instrumentId = "sample-loop-instrument";
        note.pitch = 60;
        note.velocity = 120;
        note.startBeat = 0.0;
        note.lengthBeats = oneShot ? 0.02 : 1.5;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeSampleChokeOfflineProject(const juce::File& file, int chokeGroup)
    {
        beat::Project project;
        project.id = "offline-sample-choke-project";
        project.name = "Offline Sample Choke";
        project.bpm = 120.0;
        project.lengthBeats = 1.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "sample-choke-instrument";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 80.0f;
        instrument.sampleUrls.add(file.getFullPathName());

        beat::InstrumentDefinition::SampleZone zone;
        zone.path = file.getFullPathName();
        zone.rootNote = 60;
        zone.loNote = 0;
        zone.hiNote = 127;
        zone.loVel = 0;
        zone.hiVel = 127;
        zone.volumeDb = 0.0f;
        zone.seqPosition = 0;
        zone.oneShot = true;
        zone.chokeGroup = chokeGroup;
        instrument.sampleZones.push_back(zone);
        project.instruments.push_back(std::move(instrument));

        beat::Track track;
        track.id = "sample-choke-track";
        track.name = "Sample Choke Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = "sample-choke-instrument";

        beat::Segment segment;
        segment.id = "sample-choke-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = "sample-choke-instrument";
        segment.startBeat = 0.0;
        segment.lengthBeats = 1.0;

        for (double startBeat : { 0.0, 0.1 })
        {
            beat::MidiNote note;
            note.instrumentId = "sample-choke-instrument";
            note.pitch = 60;
            note.velocity = 120;
            note.startBeat = startBeat;
            note.lengthBeats = 0.02;
            segment.notes.push_back(note);
        }

        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    beat::Project makeTinyOfflineProject();

    beat::Project makeMixedRenderProject(const juce::File& sampleFile, const juce::File& clipFile)
    {
        auto project = makeTinyOfflineProject();
        project.id = "mixed-render-project";
        project.name = "Mixed Render Project";
        project.lengthBeats = 2.0;
        project.eqAutomation.push_back({ 0.0, 1.5f, -2.0f, 0.5f, 2.5f });

        beat::TrackEffect synthDelay;
        synthDelay.id = "mixed-synth-delay";
        synthDelay.kind = beat::TrackEffectKind::Delay;
        synthDelay.params.push_back({ "timeMs", 48.0f });
        synthDelay.params.push_back({ "feedback", 18.0f });
        synthDelay.params.push_back({ "mix", 20.0f });
        project.tracks.front().effects.push_back(std::move(synthDelay));

        beat::InstrumentDefinition sampler;
        sampler.id = "mixed-sampler";
        sampler.kind = "sampler";
        sampler.attackMs = 0.0f;
        sampler.releaseMs = 20.0f;
        sampler.sampleUrls.add(sampleFile.getFullPathName());
        sampler.sampleZones.push_back({
            sampleFile.getFullPathName(),
            60,
            0,
            127,
            0,
            127,
            -3.0f,
            0.0f,
            0.0f,
            0,
            true,
            1200,
            3600,
            false,
        });
        project.instruments.push_back(std::move(sampler));

        beat::Track samplerTrack;
        samplerTrack.id = "mixed-sampler-track";
        samplerTrack.name = "Mixed Sampler";
        samplerTrack.kind = beat::TrackKind::Midi;
        samplerTrack.instrumentId = "mixed-sampler";

        beat::TrackEffect samplerFilter;
        samplerFilter.id = "mixed-sampler-filter";
        samplerFilter.kind = beat::TrackEffectKind::Lowpass;
        samplerFilter.params.push_back({ "cutoffHz", 6000.0f });
        samplerFilter.params.push_back({ "resonance", 10.0f });
        samplerTrack.effects.push_back(std::move(samplerFilter));

        beat::Segment samplerSegment;
        samplerSegment.id = "mixed-sampler-segment";
        samplerSegment.trackId = samplerTrack.id;
        samplerSegment.kind = beat::SegmentPayloadKind::Midi;
        samplerSegment.instrumentId = "mixed-sampler";
        samplerSegment.startBeat = 0.125;
        samplerSegment.lengthBeats = 1.5;
        for (int i = 0; i < 4; ++i)
        {
            beat::MidiNote note;
            note.instrumentId = "mixed-sampler";
            note.pitch = 60;
            note.velocity = 96 + i * 6;
            note.startBeat = i * 0.25;
            note.lengthBeats = 0.2;
            samplerSegment.notes.push_back(note);
        }
        samplerTrack.segments.push_back(std::move(samplerSegment));
        project.tracks.push_back(std::move(samplerTrack));

        beat::AudioFileAsset audioFile;
        audioFile.id = "mixed-clip-file";
        audioFile.name = "Mixed Clip";
        audioFile.path = clipFile.getFullPathName();
        audioFile.durationSeconds = 0.5;
        audioFile.sampleRate = 44100.0;
        project.audioFiles.push_back(std::move(audioFile));

        beat::Track audioTrack;
        audioTrack.id = "mixed-audio-track";
        audioTrack.name = "Mixed Audio";
        audioTrack.kind = beat::TrackKind::Audio;
        audioTrack.gainDb = -6.0f;
        audioTrack.pan = -0.15f;

        beat::TrackEffect audioSaturator;
        audioSaturator.id = "mixed-audio-saturator";
        audioSaturator.kind = beat::TrackEffectKind::Saturator;
        audioSaturator.params.push_back({ "drive", 20.0f });
        audioSaturator.params.push_back({ "mix", 30.0f });
        audioTrack.effects.push_back(std::move(audioSaturator));

        beat::Segment audioSegment;
        audioSegment.id = "mixed-audio-segment";
        audioSegment.trackId = audioTrack.id;
        audioSegment.kind = beat::SegmentPayloadKind::Audio;
        audioSegment.audioFileId = "mixed-clip-file";
        audioSegment.audioGainDb = -3.0f;
        audioSegment.startBeat = 0.25;
        audioSegment.lengthBeats = 1.0;
        audioTrack.segments.push_back(std::move(audioSegment));
        project.tracks.push_back(std::move(audioTrack));

        beat::ProjectAutomationLane gainLane;
        gainLane.trackId = "mixed-sampler-track";
        gainLane.target = "track.gainDb";
        gainLane.points.push_back({ 0.0, -3.0f });
        gainLane.points.push_back({ 1.5, -9.0f });
        project.automation.push_back(std::move(gainLane));

        return project;
    }

    beat::Project makeTwoTrackOfflineProject()
    {
        beat::Project project;
        project.id = "two-track-offline-project";
        project.name = "Two Track Offline";
        project.bpm = 120.0;
        project.lengthBeats = 0.75;

        beat::InstrumentDefinition instrument;
        instrument.id = "offline-synth";
        instrument.kind = "synth";
        instrument.waveform = 0;
        instrument.cutoff01 = 1.0f;
        instrument.attackMs = 1.0f;
        instrument.releaseMs = 20.0f;
        project.instruments.push_back(instrument);

        beat::Track firstTrack;
        firstTrack.id = "offline-track";
        firstTrack.name = "Offline Track";
        firstTrack.kind = beat::TrackKind::Midi;
        firstTrack.instrumentId = instrument.id;

        beat::Segment firstSegment;
        firstSegment.id = "offline-segment";
        firstSegment.trackId = firstTrack.id;
        firstSegment.kind = beat::SegmentPayloadKind::Midi;
        firstSegment.instrumentId = instrument.id;
        firstSegment.startBeat = 0.0;
        firstSegment.lengthBeats = 0.5;

        beat::MidiNote firstNote;
        firstNote.instrumentId = instrument.id;
        firstNote.pitch = 60;
        firstNote.velocity = 110;
        firstNote.startBeat = 0.0;
        firstNote.lengthBeats = 0.25;
        firstSegment.notes.push_back(firstNote);
        firstTrack.segments.push_back(firstSegment);

        beat::Track secondTrack = firstTrack;
        secondTrack.id = "offline-track-b";
        secondTrack.name = "Offline Track B";
        secondTrack.pan = 0.8f;
        secondTrack.gainDb = -3.0f;
        secondTrack.segments.front().id = "offline-segment-b";
        secondTrack.segments.front().trackId = secondTrack.id;
        secondTrack.segments.front().startBeat = 0.25;
        secondTrack.segments.front().notes.front().pitch = 72;

        project.tracks.push_back(std::move(firstTrack));
        project.tracks.push_back(std::move(secondTrack));

        return project;
    }

    beat::Project makeTinyOfflineProject()
    {
        beat::Project project;
        project.id = "offline-export-project";
        project.name = "Offline Export";
        project.bpm = 120.0;
        project.lengthBeats = 0.5;

        beat::InstrumentDefinition instrument;
        instrument.id = "offline-synth";
        instrument.kind = "synth";
        instrument.waveform = 0;
        instrument.cutoff01 = 1.0f;
        instrument.attackMs = 1.0f;
        instrument.releaseMs = 20.0f;
        project.instruments.push_back(instrument);

        beat::Track track;
        track.id = "offline-track";
        track.name = "Offline Track";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = instrument.id;

        beat::Segment segment;
        segment.id = "offline-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = instrument.id;
        segment.startBeat = 0.0;
        segment.lengthBeats = 0.5;

        beat::MidiNote note;
        note.instrumentId = instrument.id;
        note.pitch = 60;
        note.velocity = 110;
        note.startBeat = 0.0;
        note.lengthBeats = 0.25;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);
        return project;
    }

    bool stressAudioEngineTrackMeters()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 256, 2);
        engine.applyProject(makeTinyOfflineProject());
        engine.requestPlay();

        juce::AudioBuffer<float> buffer(2, 2048);
        buffer.clear();
        std::array<float*, 2> outputs {
            buffer.getWritePointer(0),
            buffer.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, buffer.getNumSamples(), context);

        std::vector<beat::AudioEngine::TrackMeterSnapshot> meters;
        if (!engine.pullTrackMeterSnapshots(meters))
            return false;

        bool foundMaster = false;
        bool foundTrack = false;
        for (const auto& meter : meters)
        {
            if (!std::isfinite(meter.rms)
                || !std::isfinite(meter.peak)
                || !std::isfinite(meter.leftRms)
                || !std::isfinite(meter.rightRms)
                || !std::isfinite(meter.leftPeak)
                || !std::isfinite(meter.rightPeak))
                return false;
            const bool hasChannelSignal = meter.leftRms > 0.0f
                || meter.rightRms > 0.0f
                || meter.leftPeak > 0.0f
                || meter.rightPeak > 0.0f;
            if (meter.trackId == "master")
            {
                foundMaster = meter.sequence > 0
                    && meter.rms > 0.0f
                    && meter.peak > 0.0f
                    && hasChannelSignal
                    && std::isfinite(meter.rmsDbFS)
                    && std::isfinite(meter.peakDbFS)
                    && std::isfinite(meter.truePeakDbTP)
                    && std::isfinite(meter.momentaryLufs)
                    && meter.truePeakDbTP >= meter.peakDbFS - 0.25f;
            }
            if (meter.trackId == "offline-track")
            {
                foundTrack = meter.sequence > 0
                    && meter.rms > 0.0f
                    && meter.peak > 0.0f
                    && hasChannelSignal;
            }
        }

        return foundMaster && foundTrack;
    }

    juce::AudioBuffer<float> renderOfflineBlock(beat::Project project, int samples);
    double bufferEnergy(const juce::AudioBuffer<float>& buffer);

    bool stressAudioEngineTrackGainPanRender()
    {
        auto dryProject = makeTinyOfflineProject();
        auto quietProject = makeTinyOfflineProject();
        auto leftProject = makeTinyOfflineProject();
        auto rightProject = makeTinyOfflineProject();

        quietProject.tracks.front().gainDb = -24.0f;
        leftProject.tracks.front().pan = -1.0f;
        rightProject.tracks.front().pan = 1.0f;

        const auto dry = renderOfflineBlock(std::move(dryProject), 8192);
        const auto quiet = renderOfflineBlock(std::move(quietProject), 8192);
        const auto left = renderOfflineBlock(std::move(leftProject), 8192);
        const auto right = renderOfflineBlock(std::move(rightProject), 8192);

        const auto channelEnergy = [] (const juce::AudioBuffer<float>& buffer, int channel)
        {
            double energy = 0.0;
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(channel, i);
                if (!std::isfinite(sample))
                    return std::numeric_limits<double>::quiet_NaN();
                energy += (double) sample * (double) sample;
            }
            return energy;
        };

        const double dryEnergy = bufferEnergy(dry);
        const double quietEnergy = bufferEnergy(quiet);
        const double leftL = channelEnergy(left, 0);
        const double leftR = channelEnergy(left, 1);
        const double rightL = channelEnergy(right, 0);
        const double rightR = channelEnergy(right, 1);

        const bool ok = std::isfinite(dryEnergy)
            && std::isfinite(quietEnergy)
            && dryEnergy > 0.0001
            && quietEnergy < dryEnergy * 0.02
            && leftL > leftR * 32.0
            && rightR > rightL * 32.0;

        if (!ok)
        {
            std::cerr << "Track gain/pan render stress failed dryEnergy=" << dryEnergy
                      << " quietEnergy=" << quietEnergy
                      << " leftL=" << leftL
                      << " leftR=" << leftR
                      << " rightL=" << rightL
                      << " rightR=" << rightR << "\n";
        }

        return ok;
    }

    juce::AudioBuffer<float> renderOfflineBlock(beat::Project project, int samples = 4096)
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 256, 2);
        engine.applyProject(std::move(project));
        engine.requestPlay();

        juce::AudioBuffer<float> buffer(2, samples);
        buffer.clear();
        std::array<float*, 2> outputs {
            buffer.getWritePointer(0),
            buffer.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, buffer.getNumSamples(), context);
        return buffer;
    }

    double bufferEnergy(const juce::AudioBuffer<float>& buffer)
    {
        double energy = 0.0;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(ch, i);
                if (!std::isfinite(sample))
                    return std::numeric_limits<double>::quiet_NaN();
                energy += (double) sample * (double) sample;
            }
        }
        return energy;
    }

    float bufferPeak(const juce::AudioBuffer<float>& buffer)
    {
        float peak = 0.0f;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(ch, i);
                if (!std::isfinite(sample))
                    return std::numeric_limits<float>::quiet_NaN();
                peak = juce::jmax(peak, std::abs(sample));
            }
        }
        return peak;
    }

    double bufferWindowEnergy(const juce::AudioBuffer<float>& buffer, int startSample, int numSamples)
    {
        const int start = juce::jlimit(0, buffer.getNumSamples(), startSample);
        const int end = juce::jlimit(start, buffer.getNumSamples(), start + juce::jmax(0, numSamples));
        double energy = 0.0;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            for (int i = start; i < end; ++i)
            {
                const float sample = buffer.getSample(ch, i);
                if (!std::isfinite(sample))
                    return std::numeric_limits<double>::quiet_NaN();
                energy += (double) sample * (double) sample;
            }
        }
        return energy;
    }

    bool bufferHasSubnormalSamples(const juce::AudioBuffer<float>& buffer)
    {
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(ch, i);
                if (!std::isfinite(sample))
                    return true;
                if (std::fpclassify(sample) == FP_SUBNORMAL)
                    return true;
            }
        }
        return false;
    }

    double wavEnergy(const juce::File& file)
    {
        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr || reader->lengthInSamples <= 0 || reader->numChannels < 1)
            return std::numeric_limits<double>::quiet_NaN();

        juce::AudioBuffer<float> buffer((int) reader->numChannels,
                                        (int) juce::jmin<juce::int64>(reader->lengthInSamples, 44100));
        reader->read(&buffer, 0, buffer.getNumSamples(), 0, true, true);
        return bufferEnergy(buffer);
    }

    juce::AudioBuffer<float> renderEngineBlock(beat::AudioEngine& engine, int samples = 4096)
    {
        juce::AudioBuffer<float> buffer(2, samples);
        buffer.clear();
        std::array<float*, 2> outputs {
            buffer.getWritePointer(0),
            buffer.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, buffer.getNumSamples(), context);
        return buffer;
    }

    juce::AudioBuffer<float> renderOfflineChunks(beat::Project project, int samples, int blockSize = 256, double sampleRate = 44100.0)
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(sampleRate, blockSize, 2);
        engine.applyProject(std::move(project));
        engine.requestSeek(0.0);
        engine.requestPlay();

        juce::AudioBuffer<float> output(2, samples);
        juce::AudioBuffer<float> block(2, blockSize);
        output.clear();
        juce::AudioIODeviceCallbackContext context;

        int written = 0;
        while (written < samples)
        {
            const int samplesThisBlock = juce::jmin(blockSize, samples - written);
            block.setSize(2, samplesThisBlock, false, false, true);
            block.clear();

            std::array<float*, 2> outputs {
                block.getWritePointer(0),
                block.getWritePointer(1),
            };
            engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, samplesThisBlock, context);

            for (int ch = 0; ch < output.getNumChannels(); ++ch)
                output.copyFrom(ch, written, block, ch, 0, samplesThisBlock);

            written += samplesThisBlock;
        }

        engine.requestStop();
        return output;
    }

    juce::AudioBuffer<float> renderOfflineRangeChunks(
        beat::Project project,
        double startBeat,
        int samples,
        int blockSize = 256,
        double sampleRate = 44100.0)
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(sampleRate, blockSize, 2);
        engine.applyProject(std::move(project));
        engine.requestSeek(startBeat);
        engine.requestPlay();

        juce::AudioBuffer<float> output(2, samples);
        juce::AudioBuffer<float> block(2, blockSize);
        output.clear();
        juce::AudioIODeviceCallbackContext context;

        int written = 0;
        while (written < samples)
        {
            const int samplesThisBlock = juce::jmin(blockSize, samples - written);
            block.setSize(2, samplesThisBlock, false, false, true);
            block.clear();

            std::array<float*, 2> outputs {
                block.getWritePointer(0),
                block.getWritePointer(1),
            };
            engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, samplesThisBlock, context);

            for (int ch = 0; ch < output.getNumChannels(); ++ch)
                output.copyFrom(ch, written, block, ch, 0, samplesThisBlock);

            written += samplesThisBlock;
        }

        engine.requestStop();
        return output;
    }

    juce::AudioBuffer<float> renderOfflineLoopRangeChunks(
        beat::Project project,
        double startBeat,
        double endBeat,
        int samples,
        int blockSize = 256,
        double sampleRate = 44100.0)
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(sampleRate, blockSize, 2);
        engine.applyProject(std::move(project));
        engine.requestLoop(startBeat, endBeat);
        engine.requestSeek(startBeat);
        engine.requestPlay();

        juce::AudioBuffer<float> output(2, samples);
        juce::AudioBuffer<float> block(2, blockSize);
        output.clear();
        juce::AudioIODeviceCallbackContext context;

        int written = 0;
        while (written < samples)
        {
            const int samplesThisBlock = juce::jmin(blockSize, samples - written);
            block.setSize(2, samplesThisBlock, false, false, true);
            block.clear();

            std::array<float*, 2> outputs {
                block.getWritePointer(0),
                block.getWritePointer(1),
            };
            engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, samplesThisBlock, context);

            for (int ch = 0; ch < output.getNumChannels(); ++ch)
                output.copyFrom(ch, written, block, ch, 0, samplesThisBlock);

            written += samplesThisBlock;
        }

        engine.requestStop();
        return output;
    }

    juce::AudioBuffer<float> readWavPrefix(const juce::File& file, int samples)
    {
        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr || reader->lengthInSamples <= 0 || reader->numChannels < 1)
            return {};

        const int channels = (int) juce::jmin<unsigned int>(2u, reader->numChannels);
        const int sampleCount = (int) juce::jmin<juce::int64>(samples, reader->lengthInSamples);
        juce::AudioBuffer<float> buffer(channels, sampleCount);
        buffer.clear();
        reader->read(&buffer, 0, sampleCount, 0, true, true);
        return buffer;
    }

    bool stressAudioEngineTrackEffects()
    {
        auto dryProject = makeTinyOfflineProject();
        auto wetProject = makeTinyOfflineProject();

        beat::TrackEffect effect;
        effect.id = "stress-filter";
        effect.kind = beat::TrackEffectKind::Highpass;
        effect.bypassed = false;
        effect.params.push_back({ "cutoffHz", 5000.0f });
        effect.params.push_back({ "resonance", 0.0f });
        wetProject.tracks.front().effects.push_back(std::move(effect));

        auto dry = renderOfflineBlock(std::move(dryProject));
        auto wet = renderOfflineBlock(std::move(wetProject));

        double diff = 0.0;
        double wetEnergy = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
                wetEnergy += (double) wetSample * (double) wetSample;
            }
        }

        return diff > 0.01 && wetEnergy >= 0.0;
    }

    bool stressAudioEngineInstrumentEffects()
    {
        auto dryProject = makeTinyOfflineProject();
        auto wetProject = makeTinyOfflineProject();

        beat::TrackEffect saturator;
        saturator.id = "instrument-saturator";
        saturator.kind = beat::TrackEffectKind::Saturator;
        saturator.bypassed = false;
        saturator.params.push_back({ "drive", 70.0f });
        saturator.params.push_back({ "mix", 100.0f });
        wetProject.instruments.front().effects.push_back(std::move(saturator));

        auto dry = renderOfflineBlock(std::move(dryProject));
        auto wet = renderOfflineBlock(std::move(wetProject));

        double diff = 0.0;
        double wetEnergy = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
                wetEnergy += (double) wetSample * (double) wetSample;
            }
        }

        return diff > 0.01 && wetEnergy > 0.000001;
    }

    bool stressAudioEnginePluginEffectPlaceholder()
    {
        auto dryProject = makeTinyOfflineProject();
        auto pluginProject = makeTinyOfflineProject();

        beat::TrackEffect effect;
        effect.id = "future-plugin-effect";
        effect.kind = beat::TrackEffectKind::Plugin;
        effect.pluginId = "plugin-placeholder";
        effect.pluginName = "Unavailable Effect Plugin";
        effect.pluginFormat = "bridge";
        effect.params.push_back({ "mix", 100.0f });
        pluginProject.tracks.front().effects.push_back(std::move(effect));

        auto dry = renderOfflineBlock(std::move(dryProject));
        auto withPlaceholder = renderOfflineBlock(std::move(pluginProject));

        double diff = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float placeholderSample = withPlaceholder.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(placeholderSample))
                    return false;
                diff += std::abs((double) drySample - (double) placeholderSample);
            }
        }

        return diff < 0.000001;
    }

    bool stressAudioEngineEffectLatencyEstimate()
    {
        auto project = makeTinyOfflineProject();

        beat::TrackEffect pluginA;
        pluginA.id = "plugin-latency-a";
        pluginA.kind = beat::TrackEffectKind::Plugin;
        pluginA.pluginId = "bridge-a";
        pluginA.latencySamples = 128;

        beat::TrackEffect pluginB;
        pluginB.id = "plugin-latency-b";
        pluginB.kind = beat::TrackEffectKind::Plugin;
        pluginB.pluginId = "bridge-b";
        pluginB.latencySamples = 0;

        beat::PluginAdapterDefinition bridgeB;
        bridgeB.id = "bridge-b";
        bridgeB.name = "Latency Bridge B";
        bridgeB.kind = "effect";
        bridgeB.format = "bridge";
        bridgeB.status = "installed";
        beat::PluginCapability effectCapability;
        effectCapability.id = "bridge-b-effect";
        effectCapability.kind = "effect";
        effectCapability.label = "Latency effect";
        effectCapability.realtime = true;
        effectCapability.offline = true;
        effectCapability.latencySamples = 256;
        effectCapability.fallbackMode = "pass-through";
        bridgeB.capabilities.push_back(std::move(effectCapability));
        project.plugins.push_back(std::move(bridgeB));

        beat::TrackEffect bypassed;
        bypassed.id = "bypassed-latency";
        bypassed.kind = beat::TrackEffectKind::Plugin;
        bypassed.pluginId = "bridge-c";
        bypassed.latencySamples = 8192;
        bypassed.bypassed = true;

        project.tracks.front().effects.push_back(std::move(pluginA));
        project.tracks.front().effects.push_back(std::move(pluginB));
        project.tracks.front().effects.push_back(std::move(bypassed));

        beat::Track secondTrack;
        secondTrack.id = "latency-track-b";
        secondTrack.name = "Latency Track B";
        secondTrack.kind = beat::TrackKind::Midi;

        beat::TrackEffect pluginC;
        pluginC.id = "plugin-latency-c";
        pluginC.kind = beat::TrackEffectKind::Plugin;
        pluginC.pluginId = "bridge-d";
        pluginC.latencySamples = 64;
        secondTrack.effects.push_back(std::move(pluginC));
        project.tracks.push_back(std::move(secondTrack));

        if (beat::AudioEngine::estimateProjectLatencySamples(project) != 384)
            return false;

        beat::AudioEngine engine;
        engine.prepareForOffline(48000.0, 512, 2);
        engine.applyProject(std::move(project));
        return engine.getProjectLatencySamples() == 384;
    }

    bool stressAudioEngineTransportCommandCoalescing()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(48000.0, 256, 2);
        engine.applyProject(makeTinyOfflineProject());

        juce::AudioBuffer<float> block(2, 256);
        std::array<float*, 2> outputs {
            block.getWritePointer(0),
            block.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;

        for (int i = 0; i < 900; ++i)
        {
            if ((i % 2) == 0)
                engine.requestPlay();
            else
                engine.requestPause();
        }
        block.clear();
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, block.getNumSamples(), context);
        if (engine.sequencer().isPlaying())
            return false;

        engine.requestSeek(3.5);
        engine.requestPlay();
        block.clear();
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, block.getNumSamples(), context);
        if (!engine.sequencer().isPlaying() || std::abs(engine.sequencer().getPosition() - 3.5) > 0.05)
            return false;

        engine.requestRestart();
        engine.requestPause();
        block.clear();
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, block.getNumSamples(), context);
        return !engine.sequencer().isPlaying()
            && engine.sequencer().getPosition() >= 0.0
            && engine.sequencer().getPosition() < 0.05;
    }

    bool stressAudioEngineDeviceSnapshot()
    {
        beat::AudioEngine engine;
        const auto snapshot = engine.listAudioDevices(false);

        std::set<juce::String> seen;
        for (const auto& device : snapshot.devices)
        {
            if (device.typeName.isEmpty() || device.name.isEmpty())
            {
                std::cerr << "Audio device snapshot contains unnamed device\n";
                return false;
            }

            if (!device.input && !device.output)
            {
                std::cerr << "Audio device snapshot contains device with no IO role\n";
                return false;
            }

            const auto key = device.typeName + "\n" + device.name;
            if (seen.count(key) > 0)
            {
                std::cerr << "Audio device snapshot contains duplicate device " << key << "\n";
                return false;
            }
            seen.insert(key);
        }

        return snapshot.sampleRate >= 0.0
            && snapshot.bufferSize >= 0
            && snapshot.inputLatencySamples >= 0
            && snapshot.outputLatencySamples >= 0
            && snapshot.inputChannelNames.size() >= 0
            && snapshot.outputChannelNames.size() >= 0;
    }

    bool stressAudioEngineInputRecordingCapture()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(48000.0, 128, 2);

        juce::String error;
        if (!engine.prepareInputRecording(0.25, 2, &error))
        {
            std::cerr << "Recording prepare failed: " << error << "\n";
            return false;
        }

        juce::AudioBuffer<float> input(2, 128);
        for (int i = 0; i < input.getNumSamples(); ++i)
        {
            const float phase = (float) i / (float) input.getNumSamples();
            input.setSample(0, i, std::sin(phase * juce::MathConstants<float>::twoPi) * 0.45f);
            input.setSample(1, i, (phase * 2.0f - 1.0f) * 0.25f);
        }

        juce::AudioBuffer<float> output(2, 128);
        std::array<const float*, 2> inputs {
            input.getReadPointer(0),
            input.getReadPointer(1),
        };
        std::array<float*, 2> outputs {
            output.getWritePointer(0),
            output.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;

        engine.startInputRecording();
        output.clear();
        engine.audioDeviceIOCallbackWithContext(inputs.data(), (int) inputs.size(), outputs.data(), 2, input.getNumSamples(), context);
        const auto stats = engine.stopInputRecording();
        if (stats.active || stats.overflowed || stats.recordedSamples != input.getNumSamples()
            || stats.channels != 2 || std::abs(stats.sampleRate - 48000.0) > 0.0001)
        {
            std::cerr << "Recording stats mismatch samples=" << stats.recordedSamples
                      << " channels=" << stats.channels
                      << " overflow=" << stats.overflowed << "\n";
            return false;
        }

        auto file = juce::File("/private/tmp").getChildFile("BeatBackendStress-input-recording.wav");
        file.deleteFile();
        if (!engine.writeInputRecordingToWav(file, &error, 24))
        {
            std::cerr << "Recording write failed: " << error << "\n";
            return false;
        }

        const auto captured = readWavPrefix(file, 128);
        const double capturedEnergy = bufferEnergy(captured);
        if (captured.getNumChannels() != 2
            || captured.getNumSamples() != 128
            || !std::isfinite(capturedEnergy)
            || capturedEnergy < 0.1)
        {
            file.deleteFile();
            return false;
        }
        file.deleteFile();

        if (!engine.prepareInputRecording(64.0 / 48000.0, 1, &error))
            return false;

        std::array<const float*, 1> monoInput { input.getReadPointer(0) };
        engine.startInputRecording();
        output.clear();
        engine.audioDeviceIOCallbackWithContext(monoInput.data(), (int) monoInput.size(), outputs.data(), 2, input.getNumSamples(), context);
        const auto overflowStats = engine.stopInputRecording();
        return !overflowStats.active
            && overflowStats.overflowed
            && overflowStats.channels == 1
            && overflowStats.recordedSamples == 64;
    }

    bool stressAudioEngineInputMonitoring()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(48000.0, 128, 2);

        juce::AudioBuffer<float> input(2, 128);
        for (int i = 0; i < input.getNumSamples(); ++i)
        {
            const float phase = (float) i / (float) input.getNumSamples();
            input.setSample(0, i, std::sin(phase * juce::MathConstants<float>::twoPi) * 0.35f);
            input.setSample(1, i, std::cos(phase * juce::MathConstants<float>::twoPi) * 0.25f);
        }

        juce::AudioBuffer<float> output(2, 128);
        std::array<const float*, 2> inputs {
            input.getReadPointer(0),
            input.getReadPointer(1),
        };
        std::array<float*, 2> outputs {
            output.getWritePointer(0),
            output.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;

        output.clear();
        engine.audioDeviceIOCallbackWithContext(inputs.data(), (int) inputs.size(), outputs.data(), 2, output.getNumSamples(), context);
        const double defaultOffEnergy = bufferEnergy(output);
        if (!std::isfinite(defaultOffEnergy) || defaultOffEnergy > 0.000001)
            return false;

        engine.setInputMonitoringEnabled(true, -6.0f);
        if (!engine.isInputMonitoringEnabled())
            return false;

        output.clear();
        engine.audioDeviceIOCallbackWithContext(inputs.data(), (int) inputs.size(), outputs.data(), 2, output.getNumSamples(), context);
        const double monitorEnergy = bufferEnergy(output);

        std::vector<beat::AudioEngine::TrackMeterSnapshot> meters;
        const bool metersOk = engine.pullTrackMeterSnapshots(meters)
            && std::any_of(meters.begin(), meters.end(), [](const auto& meter) {
                return meter.trackId == "master"
                    && meter.sequence > 0
                    && meter.rms > 0.0f
                    && meter.peak > 0.0f
                    && std::isfinite(meter.leftRms)
                    && std::isfinite(meter.rightRms)
                    && std::isfinite(meter.leftPeak)
                    && std::isfinite(meter.rightPeak)
                    && (meter.leftRms > 0.0f
                        || meter.rightRms > 0.0f
                        || meter.leftPeak > 0.0f
                        || meter.rightPeak > 0.0f);
            });

        engine.setInputMonitoringEnabled(false);
        output.clear();
        engine.audioDeviceIOCallbackWithContext(inputs.data(), (int) inputs.size(), outputs.data(), 2, output.getNumSamples(), context);
        const double disabledEnergy = bufferEnergy(output);

        beat::Project monitorProject;
        monitorProject.id = "input-monitor-project";
        monitorProject.name = "Input Monitor Project";
        monitorProject.bpm = 120.0;
        beat::Track monitorTrack;
        monitorTrack.id = "input-monitor-track";
        monitorTrack.name = "Input Monitor Track";
        monitorTrack.kind = beat::TrackKind::Audio;
        monitorTrack.recordArmed = true;
        monitorTrack.inputMonitoring = true;
        monitorTrack.recordGainDb = -6.0f;
        monitorProject.tracks.push_back(monitorTrack);
        engine.applyProject(monitorProject);
        if (!engine.isInputMonitoringEnabled())
            return false;

        output.clear();
        engine.audioDeviceIOCallbackWithContext(inputs.data(), (int) inputs.size(), outputs.data(), 2, output.getNumSamples(), context);
        const double projectMonitorEnergy = bufferEnergy(output);

        monitorProject.tracks.front().inputMonitoring = false;
        engine.applyProject(std::move(monitorProject));
        if (engine.isInputMonitoringEnabled())
            return false;

        return std::isfinite(monitorEnergy)
            && monitorEnergy > 0.0001
            && metersOk
            && std::isfinite(disabledEnergy)
            && disabledEnergy < 0.000001
            && std::isfinite(projectMonitorEnergy)
            && projectMonitorEnergy > 0.0001;
    }

    beat::Project makePluginLatencyCompensationProject(const juce::File& file)
    {
        beat::Project project;
        project.id = "plugin-latency-comp-project";
        project.name = "Plugin Latency Compensation";
        project.bpm = 120.0;
        project.lengthBeats = 0.5;

        beat::InstrumentDefinition instrument;
        instrument.id = "plugin-latency-sample";
        instrument.kind = "sampler";
        instrument.attackMs = 0.0f;
        instrument.releaseMs = 5.0f;
        instrument.sampleUrls.add(file.getFullPathName());
        project.instruments.push_back(std::move(instrument));

        const auto addTrack = [&](const char* id, bool delayed)
        {
            beat::Track track;
            track.id = id;
            track.name = id;
            track.kind = beat::TrackKind::Midi;
            track.instrumentId = "plugin-latency-sample";

            if (delayed)
            {
                beat::TrackEffect plugin;
                plugin.id = "latency-plugin";
                plugin.kind = beat::TrackEffectKind::Plugin;
                plugin.pluginId = "latency-fixture";
                plugin.pluginName = "Latency Fixture";
                plugin.latencySamples = 512;
                track.effects.push_back(std::move(plugin));
            }

            beat::Segment segment;
            segment.id = juce::String(id) + "-segment";
            segment.trackId = track.id;
            segment.kind = beat::SegmentPayloadKind::Midi;
            segment.instrumentId = "plugin-latency-sample";
            segment.startBeat = 0.0;
            segment.lengthBeats = 0.5;

            beat::MidiNote note;
            note.instrumentId = "plugin-latency-sample";
            note.pitch = 60;
            note.velocity = 120;
            note.startBeat = 0.0;
            note.lengthBeats = 0.25;
            segment.notes.push_back(note);

            track.segments.push_back(segment);
            project.tracks.push_back(std::move(track));
        };

        addTrack("latency-dry-track", false);
        addTrack("latency-plugin-track", true);
        return project;
    }

    bool stressAudioEnginePluginLatencyCompensation()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-plugin-latency.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto rendered = renderOfflineBlock(makePluginLatencyCompensationProject(sampleFile), 4096);
        const double earlyEnergy = bufferWindowEnergy(rendered, 0, 360);
        const double lateEnergy = bufferWindowEnergy(rendered, 900, 900);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(earlyEnergy)
            && std::isfinite(lateEnergy)
            && earlyEnergy < 0.00000001
            && lateEnergy > 0.0001;
        if (!ok)
            std::cerr << "Plugin latency compensation early=" << earlyEnergy
                      << " late=" << lateEnergy << "\n";
        return ok;
    }

    bool stressAudioEngineCompressorEffect()
    {
        auto dryProject = makeTinyOfflineProject();
        auto compressedProject = makeTinyOfflineProject();

        beat::TrackEffect compressor;
        compressor.id = "stress-compressor";
        compressor.kind = beat::TrackEffectKind::Compressor;
        compressor.params.push_back({ "thresholdDb", -36.0f });
        compressor.params.push_back({ "ratio", 12.0f });
        compressor.params.push_back({ "attackMs", 1.0f });
        compressor.params.push_back({ "releaseMs", 60.0f });
        compressor.params.push_back({ "makeupDb", 0.0f });
        compressor.params.push_back({ "mix", 100.0f });
        compressedProject.tracks.front().effects.push_back(std::move(compressor));

        auto dry = renderOfflineBlock(std::move(dryProject));
        auto wet = renderOfflineBlock(std::move(compressedProject));

        double diff = 0.0;
        double wetEnergy = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
                wetEnergy += (double) wetSample * (double) wetSample;
            }
        }

        return diff > 0.01 && wetEnergy > 0.000001;
    }

    bool stressAudioEngineDistortionEffect()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-distortion-continuity.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto dryProject = makeAudioClipOfflineProject(sampleFile);
        auto distortionProject = makeAudioClipOfflineProject(sampleFile);
        dryProject.tracks.front().effects.clear();
        distortionProject.tracks.front().effects.clear();

        beat::TrackEffect distortion;
        distortion.id = "stress-distortion";
        distortion.kind = beat::TrackEffectKind::Distortion;
        distortion.params.push_back({ "drive", 75.0f });
        distortion.params.push_back({ "shape", 65.0f });
        distortion.params.push_back({ "trimDb", 8.0f });
        distortion.params.push_back({ "mix", 80.0f });
        distortionProject.tracks.front().effects.push_back(std::move(distortion));

        auto dry = renderOfflineBlock(std::move(dryProject), 8192);
        auto wet = renderOfflineBlock(distortionProject, 8192);

        double diff = 0.0;
        double wetEnergy = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
                wetEnergy += (double) wetSample * (double) wetSample;
            }
        }

        if (!(diff > 0.001 && wetEnergy > 0.000001))
        {
            sampleFile.deleteFile();
            return false;
        }

        constexpr int samples = 8192;
        auto largeBlock = renderOfflineChunks(distortionProject, samples, 4096);
        auto smallBlock = renderOfflineChunks(distortionProject, samples, 127);
        sampleFile.deleteFile();

        float maxAbsDiff = 0.0f;
        for (int ch = 0; ch < largeBlock.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float largeSample = largeBlock.getSample(ch, i);
                const float smallSample = smallBlock.getSample(ch, i);
                if (!std::isfinite(largeSample) || !std::isfinite(smallSample))
                    return false;
                maxAbsDiff = std::max(maxAbsDiff, std::abs(largeSample - smallSample));
            }
        }

        if (maxAbsDiff > 0.000001f)
        {
            std::cerr << "Distortion chunk continuity failed maxDiff=" << maxAbsDiff << "\n";
            return false;
        }

        {
            beat::AudioEngine engine;
            constexpr int blockSize = 512;
            engine.prepareForOffline(44100.0, blockSize, 2);
            engine.applyProject(distortionProject);
            engine.requestPlay();
            const auto timingBuffer = renderEngineBlock(engine, blockSize);
            if (!std::isfinite(bufferEnergy(timingBuffer)))
                return false;

            beat::AudioEngine::RenderTimingSnapshot timing;
            if (!engine.pullRenderTimingSnapshot(timing))
                return false;

            const int64_t expectedOversampledWork = (int64_t) blockSize * 2 * 2;
            if (timing.routeNonlinearEffectSamples < expectedOversampledWork)
            {
                std::cerr << "Distortion nonlinear oversampling counter failed samples="
                          << timing.routeNonlinearEffectSamples
                          << " expected>=" << expectedOversampledWork << "\n";
                return false;
            }
        }
        return true;
    }

    bool stressAudioEngineChorusEffect()
    {
        auto dryProject = makeTinyOfflineProject();
        auto chorusProject = makeTinyOfflineProject();

        beat::TrackEffect chorus;
        chorus.id = "stress-chorus";
        chorus.kind = beat::TrackEffectKind::Chorus;
        chorus.params.push_back({ "rateHz", 1.25f });
        chorus.params.push_back({ "depthMs", 12.0f });
        chorus.params.push_back({ "delayMs", 9.0f });
        chorus.params.push_back({ "feedback", 18.0f });
        chorus.params.push_back({ "mix", 65.0f });
        chorusProject.tracks.front().effects.push_back(std::move(chorus));

        auto dry = renderOfflineBlock(std::move(dryProject), 8192);
        auto wet = renderOfflineBlock(chorusProject, 8192);

        double diff = 0.0;
        double wetEnergy = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
                wetEnergy += (double) wetSample * (double) wetSample;
            }
        }

        if (!(diff > 0.001 && wetEnergy > 0.000001))
            return false;

        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 256, 2);
        engine.applyProject(std::move(chorusProject));
        engine.requestPlay();
        const auto playing = renderEngineBlock(engine, 4096);
        if (!(bufferEnergy(playing) > 0.0001))
            return false;

        engine.requestStop();
        const auto stopped = renderEngineBlock(engine, 4096);
        const double stoppedEnergy = bufferEnergy(stopped);
        return std::isfinite(stoppedEnergy) && stoppedEnergy <= 0.000001;
    }

    bool stressAudioEnginePhaserEffect()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-phaser-continuity.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto dryProject = makeAudioClipOfflineProject(sampleFile);
        auto phaserProject = makeAudioClipOfflineProject(sampleFile);
        dryProject.tracks.front().effects.clear();
        phaserProject.tracks.front().effects.clear();

        beat::TrackEffect phaser;
        phaser.id = "stress-phaser";
        phaser.kind = beat::TrackEffectKind::Phaser;
        phaser.params.push_back({ "rateHz", 0.7f });
        phaser.params.push_back({ "centerHz", 1100.0f });
        phaser.params.push_back({ "depthOct", 2.2f });
        phaser.params.push_back({ "feedback", 42.0f });
        phaser.params.push_back({ "mix", 70.0f });
        phaserProject.tracks.front().effects.push_back(std::move(phaser));

        auto dry = renderOfflineBlock(std::move(dryProject), 8192);
        auto wet = renderOfflineBlock(phaserProject, 8192);

        double diff = 0.0;
        double wetEnergy = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
                wetEnergy += (double) wetSample * (double) wetSample;
            }
        }

        if (!(diff > 0.001 && wetEnergy > 0.000001))
        {
            sampleFile.deleteFile();
            return false;
        }

        constexpr int samples = 8192;
        auto largeBlock = renderOfflineChunks(phaserProject, samples, 4096);
        auto smallBlock = renderOfflineChunks(phaserProject, samples, 127);
        sampleFile.deleteFile();

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        for (int ch = 0; ch < largeBlock.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float largeSample = largeBlock.getSample(ch, i);
                const float smallSample = smallBlock.getSample(ch, i);
                if (!std::isfinite(largeSample) || !std::isfinite(smallSample))
                    return false;

                const float sampleDiff = std::abs(largeSample - smallSample);
                maxAbsDiff = std::max(maxAbsDiff, sampleDiff);
                sumAbsDiff += sampleDiff;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (largeBlock.getNumChannels() * samples);
        const bool ok = maxAbsDiff <= 0.00001f && meanAbsDiff <= 0.000001;
        if (!ok)
        {
            std::cerr << "Phaser chunk continuity failed maxDiff=" << maxAbsDiff
                      << " meanDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineFlangerEffect()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-flanger-continuity.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto dryProject = makeAudioClipOfflineProject(sampleFile);
        auto flangerProject = makeAudioClipOfflineProject(sampleFile);
        dryProject.tracks.front().effects.clear();
        flangerProject.tracks.front().effects.clear();

        beat::TrackEffect flanger;
        flanger.id = "stress-flanger";
        flanger.kind = beat::TrackEffectKind::Flanger;
        flanger.params.push_back({ "rateHz", 0.42f });
        flanger.params.push_back({ "depthMs", 3.4f });
        flanger.params.push_back({ "delayMs", 2.2f });
        flanger.params.push_back({ "feedback", 55.0f });
        flanger.params.push_back({ "mix", 72.0f });
        flangerProject.tracks.front().effects.push_back(std::move(flanger));

        auto dry = renderOfflineBlock(std::move(dryProject), 8192);
        auto wet = renderOfflineBlock(flangerProject, 8192);

        double diff = 0.0;
        double wetEnergy = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
                wetEnergy += (double) wetSample * (double) wetSample;
            }
        }

        if (!(diff > 0.001 && wetEnergy > 0.000001))
        {
            sampleFile.deleteFile();
            return false;
        }

        constexpr int samples = 8192;
        auto largeBlock = renderOfflineChunks(flangerProject, samples, 4096);
        auto smallBlock = renderOfflineChunks(flangerProject, samples, 127);
        sampleFile.deleteFile();

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        for (int ch = 0; ch < largeBlock.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float largeSample = largeBlock.getSample(ch, i);
                const float smallSample = smallBlock.getSample(ch, i);
                if (!std::isfinite(largeSample) || !std::isfinite(smallSample))
                    return false;

                const float sampleDiff = std::abs(largeSample - smallSample);
                maxAbsDiff = std::max(maxAbsDiff, sampleDiff);
                sumAbsDiff += sampleDiff;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (largeBlock.getNumChannels() * samples);
        const bool ok = maxAbsDiff <= 0.00001f && meanAbsDiff <= 0.000001;
        if (!ok)
        {
            std::cerr << "Flanger chunk continuity failed maxDiff=" << maxAbsDiff
                      << " meanDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineBitcrushChunkContinuity()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-bitcrush-continuity.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto project = makeAudioClipOfflineProject(sampleFile);
        project.tracks.front().effects.clear();

        beat::TrackEffect bitcrush;
        bitcrush.id = "chunk-bitcrush";
        bitcrush.kind = beat::TrackEffectKind::Bitcrush;
        bitcrush.params.push_back({ "bits", 5.0f });
        bitcrush.params.push_back({ "rate", 20.0f });
        bitcrush.params.push_back({ "mix", 100.0f });
        project.tracks.front().effects.push_back(std::move(bitcrush));

        constexpr int samples = 8192;
        auto largeBlock = renderOfflineChunks(project, samples, 4096);
        auto smallBlock = renderOfflineChunks(project, samples, 127);
        sampleFile.deleteFile();

        double largeEnergy = 0.0;
        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        for (int ch = 0; ch < largeBlock.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float largeSample = largeBlock.getSample(ch, i);
                const float smallSample = smallBlock.getSample(ch, i);
                if (!std::isfinite(largeSample) || !std::isfinite(smallSample))
                    return false;

                const float diff = std::abs(largeSample - smallSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                largeEnergy += (double) largeSample * (double) largeSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (largeBlock.getNumChannels() * samples);
        const bool ok = largeEnergy > 0.000001
            && maxAbsDiff <= 0.000001f
            && meanAbsDiff <= 0.0000001;
        if (!ok)
        {
            std::cerr << "Bitcrush chunk continuity failed energy=" << largeEnergy
                      << " maxDiff=" << maxAbsDiff
                      << " meanDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineTransportPanicReset()
    {
        auto project = makeTinyOfflineProject();

        beat::TrackEffect delay;
        delay.id = "panic-delay";
        delay.kind = beat::TrackEffectKind::Delay;
        delay.params.push_back({ "timeMs", 180.0f });
        delay.params.push_back({ "feedback", 70.0f });
        delay.params.push_back({ "mix", 70.0f });
        project.tracks.front().effects.push_back(std::move(delay));

        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 256, 2);
        engine.applyProject(project);
        engine.requestPlay();

        const auto playing = renderEngineBlock(engine, 4096);
        const double playingEnergy = bufferEnergy(playing);
        if (!(playingEnergy > 0.0001))
            return false;

        engine.requestStop();
        const auto stopped = renderEngineBlock(engine, 4096);
        const double stoppedEnergy = bufferEnergy(stopped);
        if (!std::isfinite(stoppedEnergy) || stoppedEnergy > 0.000001)
            return false;

        engine.requestRestart();
        const auto restarted = renderEngineBlock(engine, 4096);
        const double restartedEnergy = bufferEnergy(restarted);
        if (!(restartedEnergy > 0.0001))
            return false;

        engine.requestSeek(0.25);
        const auto afterSeek = renderEngineBlock(engine, 4096);
        const double afterSeekEnergy = bufferEnergy(afterSeek);
        return std::isfinite(afterSeekEnergy);
    }

    bool stressAudioEngineApplyProjectRuntimeBoundary()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 256, 2);
        engine.applyProject(makeTinyOfflineProject());
        engine.requestPlay();

        const auto playing = renderEngineBlock(engine, 4096);
        const double playingEnergy = bufferEnergy(playing);
        if (!(std::isfinite(playingEnergy) && playingEnergy > 0.0001))
            return false;

        beat::Project empty;
        empty.id = "empty-runtime-boundary-project";
        empty.name = "Empty Runtime Boundary";
        empty.bpm = 120.0;
        empty.lengthBeats = 4.0;
        engine.applyProject(std::move(empty));

        const auto afterApply = renderEngineBlock(engine, 4096);
        const double afterApplyEnergy = bufferEnergy(afterApply);
        if (!std::isfinite(afterApplyEnergy) || afterApplyEnergy > 0.000001)
            return false;

        return engine.sequencer().isPlaying();
    }

    bool stressAudioEngineTransportCommandBurst()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 128, 2);
        engine.applyProject(makeTinyOfflineProject());

        engine.requestPlay();
        for (int i = 0; i < 200; ++i)
        {
            engine.requestSeek((double) (i % 8) * 0.0625);
            if (i % 2 == 0)
                engine.requestPause();
            else
                engine.requestPlay();
        }
        engine.requestSeek(0.5);
        engine.requestPause();
        if (engine.sequencer().isPlaying() || std::abs(engine.sequencer().getPosition() - 0.5) > 0.0001)
            return false;

        const auto paused = renderEngineBlock(engine, 2048);
        const double pausedEnergy = bufferEnergy(paused);
        if (!std::isfinite(pausedEnergy) || pausedEnergy > 0.000001)
            return false;
        if (std::abs(engine.sequencer().getPosition() - 0.5) > 0.0001)
            return false;

        for (int i = 0; i < 200; ++i)
            engine.requestSeek((double) (i % 4) * 0.125);
        engine.requestRestart();
        if (!engine.sequencer().isPlaying() || engine.sequencer().getPosition() > 0.0001)
            return false;

        const auto restarted = renderEngineBlock(engine, 4096);
        const double restartedEnergy = bufferEnergy(restarted);
        return std::isfinite(restartedEnergy) && restartedEnergy > 0.0001 && engine.sequencer().isPlaying();
    }

    bool stressAudioEngineQueuedLoopClampTransport()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 128, 2);
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 16.0;
        engine.applyProject(std::move(project));

        engine.requestLoop(4.0, 8.0);
        engine.requestSeek(9.0);
        engine.requestPlay();
        (void) renderEngineBlock(engine, 256);
        const double beyondEndPosition = engine.sequencer().getPosition();
        if (!(beyondEndPosition > 9.0))
            return false;

        engine.requestSeek(7.99);
        engine.requestPlay();
        (void) renderEngineBlock(engine, 1024);
        const double crossedPosition = engine.sequencer().getPosition();
        if (!(crossedPosition >= 4.0 && crossedPosition < 4.2))
            return false;

        for (int i = 0; i < 160; ++i)
        {
            engine.requestSeek(i % 2 == 0 ? 7.98 : 9.25);
            engine.requestPause();
            engine.requestPlay();
            engine.requestLoop(4.0, 8.0);
        }
        engine.requestSeek(7.99);
        engine.requestPlay();
        (void) renderEngineBlock(engine, 1024);
        const double burstCrossedPosition = engine.sequencer().getPosition();
        return burstCrossedPosition >= 4.0 && burstCrossedPosition < 4.2;
    }

    bool stressAudioEngineAudioClipPlayback()
    {
        auto file = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip.wav");
        if (!writeAudioClipFixture(file))
            return false;

        auto project = makeAudioClipOfflineProject(file);
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 256, 2);
        engine.applyProject(std::move(project));
        engine.requestPlay();

        juce::AudioBuffer<float> buffer(2, 4096);
        buffer.clear();
        std::array<float*, 2> outputs {
            buffer.getWritePointer(0),
            buffer.getWritePointer(1),
        };
        juce::AudioIODeviceCallbackContext context;
        engine.audioDeviceIOCallbackWithContext(nullptr, 0, outputs.data(), 2, buffer.getNumSamples(), context);

        double energy = 0.0;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(ch, i);
                if (!std::isfinite(sample))
                    return false;
                energy += (double) sample * (double) sample;
            }
        }

        std::vector<beat::AudioEngine::TrackMeterSnapshot> meters;
        if (!engine.pullTrackMeterSnapshots(meters))
            return false;

        bool foundTrack = false;
        for (const auto& meter : meters)
        {
            if (meter.trackId == "audio-clip-track")
            {
                foundTrack = meter.sequence > 0
                    && meter.rms > 0.0f
                    && meter.peak > 0.0f
                    && std::isfinite(meter.leftRms)
                    && std::isfinite(meter.rightRms)
                    && std::isfinite(meter.leftPeak)
                    && std::isfinite(meter.rightPeak)
                    && (meter.leftRms > 0.0f
                        || meter.rightRms > 0.0f
                        || meter.leftPeak > 0.0f
                        || meter.rightPeak > 0.0f);
            }
        }

        file.deleteFile();
        return energy > 0.0001 && foundTrack;
    }

    bool stressAudioEngineTailEffects()
    {
        auto dryProject = makeTinyOfflineProject();
        auto delayProject = makeTinyOfflineProject();
        auto reverbProject = makeTinyOfflineProject();

        beat::TrackEffect delay;
        delay.id = "stress-delay";
        delay.kind = beat::TrackEffectKind::Delay;
        delay.params.push_back({ "timeMs", 12.0f });
        delay.params.push_back({ "feedback", 35.0f });
        delay.params.push_back({ "mix", 50.0f });
        delayProject.tracks.front().effects.push_back(std::move(delay));

        beat::TrackEffect reverb;
        reverb.id = "stress-reverb";
        reverb.kind = beat::TrackEffectKind::Reverb;
        reverb.params.push_back({ "roomSize", 45.0f });
        reverb.params.push_back({ "damping", 30.0f });
        reverb.params.push_back({ "mix", 30.0f });
        reverbProject.tracks.front().effects.push_back(std::move(reverb));

        auto dry = renderOfflineBlock(std::move(dryProject), 8192);
        auto delayed = renderOfflineBlock(std::move(delayProject), 8192);
        auto reverbed = renderOfflineBlock(std::move(reverbProject), 8192);

        double delayDiff = 0.0;
        double reverbDiff = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float delaySample = delayed.getSample(ch, i);
                const float reverbSample = reverbed.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(delaySample) || !std::isfinite(reverbSample))
                    return false;
                delayDiff += std::abs((double) drySample - (double) delaySample);
                reverbDiff += std::abs((double) drySample - (double) reverbSample);
            }
        }

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-delay-tail.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        auto exportProject = makeTinyOfflineProject();
        beat::TrackEffect exportDelay;
        exportDelay.id = "stress-export-delay";
        exportDelay.kind = beat::TrackEffectKind::Delay;
        exportDelay.params.push_back({ "timeMs", 250.0f });
        exportDelay.params.push_back({ "feedback", 40.0f });
        exportDelay.params.push_back({ "mix", 60.0f });
        exportProject.tracks.front().effects.push_back(std::move(exportDelay));

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(std::move(exportProject), exportFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Delay tail export error: " << error << "\n";
            return false;
        }

        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(exportFile));
        const auto expectedDrySamples = (juce::int64) std::ceil(0.5 * 60.0 / 120.0 * 44100.0);
        const bool hasTail = reader != nullptr && reader->lengthInSamples > expectedDrySamples + 1000;
        exportFile.deleteFile();

        return delayDiff > 0.01 && reverbDiff > 0.01 && hasTail;
    }

    bool stressAudioEngineDenormalTailProtection()
    {
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 0.5;

        auto& instrument = project.instruments.front();
        instrument.releaseMs = 5.0f;

        beat::TrackEffect delay;
        delay.id = "denormal-delay";
        delay.kind = beat::TrackEffectKind::Delay;
        delay.params.push_back({ "timeMs", 2.0f });
        delay.params.push_back({ "feedback", 45.0f });
        delay.params.push_back({ "mix", 60.0f });
        project.tracks.front().effects.push_back(std::move(delay));

        const auto rendered = renderOfflineChunks(std::move(project), 196608, 257);
        if (bufferHasSubnormalSamples(rendered))
        {
            std::cerr << "Denormal tail stress found a non-finite or subnormal sample\n";
            return false;
        }

        const double earlyEnergy = bufferWindowEnergy(rendered, 0, 8192);
        const double tailEnergy = bufferWindowEnergy(rendered, rendered.getNumSamples() - 8192, 8192);
        const bool ok = std::isfinite(earlyEnergy)
            && std::isfinite(tailEnergy)
            && earlyEnergy > 0.0001;
        if (!ok)
            std::cerr << "Denormal tail energy early=" << earlyEnergy << " tail=" << tailEnergy << "\n";
        return ok;
    }

    bool stressAudioEngineRouteAutomation()
    {
        auto dryProject = makeTinyOfflineProject();
        auto quietProject = makeTinyOfflineProject();
        auto brightProject = makeTinyOfflineProject();
        auto filteredProject = makeTinyOfflineProject();

        beat::ProjectAutomationLane gainLane;
        gainLane.trackId = "offline-track";
        gainLane.target = "track.gainDb";
        gainLane.points.push_back({ 0.0, -48.0f });
        quietProject.automation.push_back(std::move(gainLane));

        beat::TrackEffect brightFilter;
        brightFilter.id = "route-auto-filter";
        brightFilter.kind = beat::TrackEffectKind::Lowpass;
        brightFilter.params.push_back({ "cutoffHz", 20000.0f });
        brightFilter.params.push_back({ "resonance", 0.0f });
        brightProject.tracks.front().effects.push_back(brightFilter);
        filteredProject.tracks.front().effects.push_back(std::move(brightFilter));

        beat::ProjectAutomationLane filterLane;
        filterLane.trackId = "offline-track";
        filterLane.target = "effect.route-auto-filter.cutoffHz";
        filterLane.points.push_back({ 0.0, 80.0f });
        filteredProject.automation.push_back(std::move(filterLane));

        auto dry = renderOfflineBlock(std::move(dryProject), 4096);
        auto quiet = renderOfflineBlock(std::move(quietProject), 4096);
        auto bright = renderOfflineBlock(std::move(brightProject), 4096);
        auto filtered = renderOfflineBlock(std::move(filteredProject), 4096);

        double dryEnergy = 0.0;
        double quietEnergy = 0.0;
        double filterDiff = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float quietSample = quiet.getSample(ch, i);
                const float brightSample = bright.getSample(ch, i);
                const float filteredSample = filtered.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(quietSample) || !std::isfinite(brightSample) || !std::isfinite(filteredSample))
                    return false;
                dryEnergy += (double) drySample * (double) drySample;
                quietEnergy += (double) quietSample * (double) quietSample;
                filterDiff += std::abs((double) brightSample - (double) filteredSample);
            }
        }

        return dryEnergy > 0.0001
            && quietEnergy < dryEnergy * 0.05
            && filterDiff > 0.01;
    }

    bool stressAudioEngineAutomationBlockSizeStability()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-automation-block-size.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto project = makeAudioClipOfflineProject(sampleFile);
        project.lengthBeats = 2.0;

        beat::ProjectAutomationLane gainLane;
        gainLane.trackId = "audio-clip-track";
        gainLane.target = "track.gainDb";
        gainLane.points.push_back({ 0.0, -18.0f, beat::AutomationCurve::Cubic });
        gainLane.points.push_back({ 1.0, 0.0f, beat::AutomationCurve::Linear });
        project.automation.push_back(std::move(gainLane));

        constexpr int samples = 44100;
        auto smallBlock = renderOfflineChunks(project, samples, 128);
        auto largeBlock = renderOfflineChunks(project, samples, 4096);
        sampleFile.deleteFile();

        double energy = 0.0;
        double absDiff = 0.0;
        float maxDiff = 0.0f;
        for (int ch = 0; ch < smallBlock.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float a = smallBlock.getSample(ch, i);
                const float b = largeBlock.getSample(ch, i);
                if (!std::isfinite(a) || !std::isfinite(b))
                    return false;
                energy += (double) a * (double) a;
                const float diff = std::abs(a - b);
                absDiff += diff;
                maxDiff = std::max(maxDiff, diff);
            }
        }

        const double meanDiff = absDiff / (double) (smallBlock.getNumChannels() * samples);
        const bool ok = energy > 0.0001
            && meanDiff < 0.00002
            && maxDiff < 0.00025f;

        if (!ok)
        {
            std::cerr << "Automation block-size stability failed energy=" << energy
                      << " meanDiff=" << meanDiff
                      << " maxDiff=" << maxDiff << "\n";
        }

        return ok;
    }

    bool stressAudioEngineSampleInstrumentRouting()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-route.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto dryProject = makeSampleInstrumentOfflineProject(sampleFile);
        auto filteredProject = makeSampleInstrumentOfflineProject(sampleFile);
        auto quietProject = makeSampleInstrumentOfflineProject(sampleFile);

        beat::TrackEffect filter;
        filter.id = "sample-route-filter";
        filter.kind = beat::TrackEffectKind::Lowpass;
        filter.params.push_back({ "cutoffHz", 80.0f });
        filter.params.push_back({ "resonance", 0.0f });
        filteredProject.tracks.front().effects.push_back(std::move(filter));

        beat::ProjectAutomationLane gainLane;
        gainLane.trackId = "sample-route-track";
        gainLane.target = "track.gainDb";
        gainLane.points.push_back({ 0.0, -48.0f });
        quietProject.automation.push_back(std::move(gainLane));

        auto dry = renderOfflineBlock(std::move(dryProject), 4096);
        auto filtered = renderOfflineBlock(std::move(filteredProject), 4096);
        auto quiet = renderOfflineBlock(std::move(quietProject), 4096);

        double dryEnergy = 0.0;
        double quietEnergy = 0.0;
        double filterDiff = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float filteredSample = filtered.getSample(ch, i);
                const float quietSample = quiet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(filteredSample) || !std::isfinite(quietSample))
                    return false;
                dryEnergy += (double) drySample * (double) drySample;
                quietEnergy += (double) quietSample * (double) quietSample;
                filterDiff += std::abs((double) drySample - (double) filteredSample);
            }
        }

        sampleFile.deleteFile();
        const bool ok = dryEnergy > 0.0001
            && quietEnergy < dryEnergy * 0.05
            && filterDiff > 0.01;
        if (!ok)
            std::cerr << "Sample route dryEnergy=" << dryEnergy
                      << " quietEnergy=" << quietEnergy
                      << " filterDiff=" << filterDiff << "\n";
        return ok;
    }

    bool stressAudioEngineSampleZonesAndRelease()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-zone.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto lowVelocity = renderOfflineBlock(makeSampleZoneOfflineProject(sampleFile, 48, 0.25f), 8192);
        auto highVelocity = renderOfflineBlock(makeSampleZoneOfflineProject(sampleFile, 112, 0.25f), 8192);
        auto shortNote = renderOfflineBlock(makeSampleZoneOfflineProject(sampleFile, 112, 0.05f), 12000);

        const double lowEnergy = bufferEnergy(lowVelocity);
        const double highEnergy = bufferEnergy(highVelocity);
        const double earlyEnergy = bufferWindowEnergy(shortNote, 0, 1400);
        const double lateEnergy = bufferWindowEnergy(shortNote, 7000, 2000);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(lowEnergy)
            && std::isfinite(highEnergy)
            && std::isfinite(earlyEnergy)
            && std::isfinite(lateEnergy)
            && lowEnergy > 0.000001
            && highEnergy > lowEnergy * 25.0
            && earlyEnergy > 0.0001
            && lateEnergy < earlyEnergy * 0.001;
        if (!ok)
            std::cerr << "Sample zone/release lowEnergy=" << lowEnergy
                      << " highEnergy=" << highEnergy
                      << " earlyEnergy=" << earlyEnergy
                      << " lateEnergy=" << lateEnergy << "\n";
        return ok;
    }

    bool stressAudioEngineSampleZoneDirectPathLoading()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-zone-direct.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto project = makeSampleZoneOfflineProject(sampleFile, 112, 0.25f);
        project.instruments.front().sampleUrls.clear();

        auto rendered = renderOfflineBlock(std::move(project), 8192);
        const double energy = bufferEnergy(rendered);
        const float peak = bufferPeak(rendered);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(energy)
            && std::isfinite(peak)
            && energy > 0.0001
            && peak > 0.001f;
        if (!ok)
            std::cerr << "Sample zone direct path loading energy=" << energy
                      << " peak=" << peak << "\n";
        return ok;
    }

    bool stressAudioEngineSampleZoneStartEndSlicing()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-zone-offset.wav");
        if (!writeSampleZoneOffsetFixture(sampleFile))
            return false;

        auto full = renderOfflineBlock(makeSampleZoneOffsetProject(sampleFile, 0, 0), 4096);
        auto sliced = renderOfflineBlock(makeSampleZoneOffsetProject(sampleFile, 2048, 3072), 4096);

        const double fullEarlyEnergy = bufferWindowEnergy(full, 0, 512);
        const double slicedEarlyEnergy = bufferWindowEnergy(sliced, 0, 512);
        const double slicedLateEnergy = bufferWindowEnergy(sliced, 1800, 512);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(fullEarlyEnergy)
            && std::isfinite(slicedEarlyEnergy)
            && std::isfinite(slicedLateEnergy)
            && fullEarlyEnergy > 0.000001
            && slicedEarlyEnergy > fullEarlyEnergy * 100.0
            && slicedLateEnergy < slicedEarlyEnergy * 0.2;
        if (!ok)
            std::cerr << "Sample zone start/end slicing fullEarly=" << fullEarlyEnergy
                      << " slicedEarly=" << slicedEarlyEnergy
                      << " slicedLate=" << slicedLateEnergy << "\n";
        return ok;
    }

    bool stressAudioEngineSampleZoneLengthSelection()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-zone-length.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto shortNote = renderOfflineBlock(makeSampleZoneLengthProject(sampleFile, 0.08f), 12000);
        auto longNote = renderOfflineBlock(makeSampleZoneLengthProject(sampleFile, 1.0f), 24000);

        const double shortEnergy = bufferEnergy(shortNote);
        const double longEnergy = bufferEnergy(longNote);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(shortEnergy)
            && std::isfinite(longEnergy)
            && shortEnergy > 0.00000001
            && longEnergy > shortEnergy * 80.0;
        if (!ok)
            std::cerr << "Sample zone length selection shortEnergy=" << shortEnergy
                      << " longEnergy=" << longEnergy << "\n";
        return ok;
    }

    bool stressAudioEngineSampleZoneMultiVariableSelection()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-zone-multi-variable.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto lowShort = renderOfflineBlock(makeSampleZoneMultiVariableProject(sampleFile, 48, 0.08f), 12000);
        auto highShort = renderOfflineBlock(makeSampleZoneMultiVariableProject(sampleFile, 112, 0.08f), 12000);
        auto lowLong = renderOfflineBlock(makeSampleZoneMultiVariableProject(sampleFile, 48, 1.0f), 24000);
        auto highLong = renderOfflineBlock(makeSampleZoneMultiVariableProject(sampleFile, 112, 1.0f), 24000);

        const double lowShortEnergy = bufferEnergy(lowShort);
        const double highShortEnergy = bufferEnergy(highShort);
        const double lowLongEnergy = bufferEnergy(lowLong);
        const double highLongEnergy = bufferEnergy(highLong);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(lowShortEnergy)
            && std::isfinite(highShortEnergy)
            && std::isfinite(lowLongEnergy)
            && std::isfinite(highLongEnergy)
            && lowShortEnergy > 0.000000001
            && highShortEnergy > lowShortEnergy * 8.0
            && lowLongEnergy > highShortEnergy * 8.0
            && highLongEnergy > lowLongEnergy * 8.0;
        if (!ok)
            std::cerr << "Sample zone multi-variable selection lowShort=" << lowShortEnergy
                      << " highShort=" << highShortEnergy
                      << " lowLong=" << lowLongEnergy
                      << " highLong=" << highLongEnergy << "\n";
        return ok;
    }

    bool stressProjectAssetSidecarPackaging()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-assets-" + juce::Uuid().toString());
        const auto sourceFolder = root.getChildFile("source");
        const auto projectFile = root.getChildFile("Portable Project.beat");
        const auto audioFile = sourceFolder.getChildFile("Loop Source.wav");
        const auto sampleFile = sourceFolder.getChildFile("Snare Hit.wav");

        if (!root.createDirectory()
            || !sourceFolder.createDirectory()
            || !audioFile.replaceWithText("audio-fixture")
            || !sampleFile.replaceWithText("sample-fixture"))
        {
            std::cerr << "Could not create project asset packaging fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        juce::DynamicObject::Ptr audio = new juce::DynamicObject();
        audio->setProperty("id", "audio-1");
        audio->setProperty("name", "Loop Source");
        audio->setProperty("path", audioFile.getFullPathName());

        juce::DynamicObject::Ptr zone = new juce::DynamicObject();
        zone->setProperty("path", sampleFile.getFullPathName());
        zone->setProperty("sampleUrl", sampleFile.getFullPathName());
        zone->setProperty("rootNote", 64);
        zone->setProperty("loNote", 60);
        zone->setProperty("hiNote", 67);
        zone->setProperty("loVel", 24);
        zone->setProperty("hiVel", 96);
        zone->setProperty("volumeDb", -3.5);
        zone->setProperty("pan", 0.25);
        zone->setProperty("tuning", -12.0);
        zone->setProperty("seqPosition", 2);
        zone->setProperty("durationSeconds", 0.42);
        zone->setProperty("loLengthSeconds", 0.12);
        zone->setProperty("hiLengthSeconds", 0.66);
        zone->setProperty("startSample", 128);
        zone->setProperty("endSample", 2048);

        juce::Array<juce::var> sampleUrls;
        sampleUrls.add(sampleFile.getFullPathName());
        juce::Array<juce::var> sampleMap;
        sampleMap.add(juce::var(zone.get()));

        juce::DynamicObject::Ptr instrument = new juce::DynamicObject();
        instrument->setProperty("id", "sample-inst");
        instrument->setProperty("name", "Sample Inst");
        instrument->setProperty("sampleUrl", sampleFile.getFullPathName());
        instrument->setProperty("sampleUrls", sampleUrls);
        instrument->setProperty("sampleMap", sampleMap);

        const auto makeAsset = [](const juce::String& id,
                                  const juce::String& kind,
                                  const juce::String& path,
                                  const juce::String& policy)
        {
            juce::DynamicObject::Ptr asset = new juce::DynamicObject();
            asset->setProperty("id", id);
            asset->setProperty("kind", kind);
            asset->setProperty("path", path);
            asset->setProperty("policy", policy);
            asset->setProperty("references", juce::Array<juce::var> {});
            return juce::var(asset.get());
        };

        juce::Array<juce::var> assets;
        assets.add(makeAsset("audio-asset", "audio", audioFile.getFullPathName(), "external"));
        assets.add(makeAsset("sample-asset", "sample", sampleFile.getFullPathName(), "external"));
        assets.add(makeAsset("factory-asset", "sample", "/samples/factory.wav", "bundled"));

        juce::Array<juce::var> audioFiles;
        audioFiles.add(juce::var(audio.get()));
        juce::Array<juce::var> instruments;
        instruments.add(juce::var(instrument.get()));

        juce::DynamicObject::Ptr documentObject = new juce::DynamicObject();
        documentObject->setProperty("schemaVersion", 1);
        documentObject->setProperty("audioFiles", audioFiles);
        documentObject->setProperty("instruments", instruments);
        documentObject->setProperty("assets", assets);
        juce::var document(documentObject.get());

        auto repairDocument = juce::JSON::parse(juce::JSON::toString(document));
        const bool manifestChanged = beat::rebuildDocumentAssetManifest(repairDocument);
        const auto repairedAssets = repairDocument.getProperty("assets", {});
        const auto* repairedAssetArray = repairedAssets.getArray();
        bool manifestRepairOk = manifestChanged && repairedAssetArray != nullptr && repairedAssetArray->size() == 2;
        if (manifestRepairOk)
        {
            const auto audioAsset = repairedAssetArray->getReference(0);
            const auto sampleAsset = repairedAssetArray->getReference(1);
            const auto* sampleRefs = sampleAsset.getProperty("references", {}).getArray();
            manifestRepairOk =
                audioAsset.getProperty("kind", {}).toString() == "audio"
                && audioAsset.getProperty("path", {}).toString() == audioFile.getFullPathName()
                && sampleAsset.getProperty("kind", {}).toString() == "sample"
                && sampleAsset.getProperty("path", {}).toString() == sampleFile.getFullPathName()
                && sampleRefs != nullptr
                && sampleRefs->size() == 3
                && sampleRefs->contains("instrument:sample-inst:sampleUrl")
                && sampleRefs->contains("instrument:sample-inst:sampleUrls:0")
                && sampleRefs->contains("instrument:sample-inst:sampleMap:0");
        }

        juce::String error;
        const bool packaged = beat::packageExternalDocumentAssets(document, projectFile, error);
        if (!packaged)
        {
            std::cerr << "Project asset packaging failed: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        const auto packagedAudioPath = document.getProperty("audioFiles", {})[0].getProperty("path", {}).toString();
        const auto packagedSamplePath = document.getProperty("instruments", {})[0].getProperty("sampleUrl", {}).toString();
        const auto packagedSampleUrl = document.getProperty("instruments", {})[0].getProperty("sampleUrls", {})[0].toString();
        const auto packagedZone = document.getProperty("instruments", {})[0].getProperty("sampleMap", {})[0];
        const auto packagedZonePath = packagedZone.getProperty("path", {}).toString();
        const auto packagedBundledAssetPath = document.getProperty("assets", {})[2].getProperty("path", {}).toString();

        const bool relativePathsOk = packagedAudioPath.startsWith("./")
            && packagedSamplePath.startsWith("./")
            && packagedSampleUrl == packagedSamplePath
            && packagedZonePath == packagedSamplePath
            && packagedBundledAssetPath == "/samples/factory.wav";

        const auto copiedAudio = projectFile.getParentDirectory().getChildFile(packagedAudioPath);
        const auto copiedSample = projectFile.getParentDirectory().getChildFile(packagedSamplePath);
        const bool copiedOk = copiedAudio.existsAsFile()
            && copiedSample.existsAsFile()
            && copiedAudio.loadFileAsString() == "audio-fixture"
            && copiedSample.loadFileAsString() == "sample-fixture";

        beat::resolveDocumentAssetPaths(document, projectFile);
        const auto resolvedAudioPath = document.getProperty("audioFiles", {})[0].getProperty("path", {}).toString();
        const auto resolvedSamplePath = document.getProperty("instruments", {})[0].getProperty("sampleUrl", {}).toString();
        const bool resolvedOk = resolvedAudioPath.startsWith(root.getFullPathName())
            && resolvedSamplePath.startsWith(root.getFullPathName())
            && juce::File(resolvedAudioPath).existsAsFile()
            && juce::File(resolvedSamplePath).existsAsFile();
        const auto resolvedZone = document.getProperty("instruments", {})[0].getProperty("sampleMap", {})[0];
        const bool zoneMetadataOk =
            (int) resolvedZone.getProperty("rootNote", -1) == 64
            && (int) resolvedZone.getProperty("loNote", -1) == 60
            && (int) resolvedZone.getProperty("hiNote", -1) == 67
            && (int) resolvedZone.getProperty("loVel", -1) == 24
            && (int) resolvedZone.getProperty("hiVel", -1) == 96
            && std::abs((double) resolvedZone.getProperty("volumeDb", 0.0) - -3.5) < 0.0001
            && std::abs((double) resolvedZone.getProperty("pan", 0.0) - 0.25) < 0.0001
            && std::abs((double) resolvedZone.getProperty("tuning", 0.0) - -12.0) < 0.0001
            && (int) resolvedZone.getProperty("seqPosition", -1) == 2
            && std::abs((double) resolvedZone.getProperty("durationSeconds", 0.0) - 0.42) < 0.0001
            && std::abs((double) resolvedZone.getProperty("loLengthSeconds", 0.0) - 0.12) < 0.0001
            && std::abs((double) resolvedZone.getProperty("hiLengthSeconds", 0.0) - 0.66) < 0.0001
            && (int) resolvedZone.getProperty("startSample", -1) == 128
            && (int) resolvedZone.getProperty("endSample", -1) == 2048;

        root.deleteRecursively();
        const bool ok = manifestRepairOk && relativePathsOk && copiedOk && resolvedOk && zoneMetadataOk;
        if (!ok)
        {
            std::cerr << "Project asset sidecar packaging manifestRepair=" << manifestRepairOk
                      << " relative=" << relativePathsOk
                      << " copied=" << copiedOk
                      << " resolved=" << resolvedOk
                      << " zoneMetadata=" << zoneMetadataOk
                      << "\n";
        }
        return ok;
    }

    bool reportContainsIssueCode(const beat::ProjectIntegrityReport& report,
                                 const juce::String& code,
                                 beat::ProjectIntegritySeverity severity)
    {
        for (const auto& issue : report.issues)
            if (issue.code == code && issue.severity == severity)
                return true;
        return false;
    }

    bool stressProjectIntegrityVerifier()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-integrity-" + juce::Uuid().toString());
        const auto sourceFolder = root.getChildFile("source");
        const auto projectFile = root.getChildFile("Integrity Project.beat");
        const auto audioFile = sourceFolder.getChildFile("Loop.wav");
        const auto sampleFile = sourceFolder.getChildFile("Hit.wav");

        if (!root.createDirectory()
            || !sourceFolder.createDirectory()
            || !audioFile.replaceWithText("audio-fixture")
            || !sampleFile.replaceWithText("sample-fixture"))
        {
            std::cerr << "Could not create project integrity fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        const auto makeAsset = [](const juce::String& id,
                                  const juce::String& kind,
                                  const juce::String& path,
                                  const juce::String& policy)
        {
            juce::DynamicObject::Ptr asset = new juce::DynamicObject();
            asset->setProperty("id", id);
            asset->setProperty("kind", kind);
            asset->setProperty("path", path);
            asset->setProperty("policy", policy);
            asset->setProperty("references", juce::Array<juce::var> {});
            return juce::var(asset.get());
        };

        juce::DynamicObject::Ptr audio = new juce::DynamicObject();
        audio->setProperty("id", "audio-1");
        audio->setProperty("name", "Loop");
        audio->setProperty("path", audioFile.getFullPathName());

        juce::DynamicObject::Ptr zone = new juce::DynamicObject();
        zone->setProperty("path", sampleFile.getFullPathName());
        zone->setProperty("sampleUrl", sampleFile.getFullPathName());
        zone->setProperty("rootNote", 60);
        zone->setProperty("loNote", 0);
        zone->setProperty("hiNote", 127);
        zone->setProperty("loVel", 0);
        zone->setProperty("hiVel", 127);

        juce::Array<juce::var> sampleUrls;
        sampleUrls.add(sampleFile.getFullPathName());
        juce::Array<juce::var> sampleMap;
        sampleMap.add(juce::var(zone.get()));

        juce::DynamicObject::Ptr instrument = new juce::DynamicObject();
        instrument->setProperty("id", "sample-inst");
        instrument->setProperty("name", "Sample Inst");
        instrument->setProperty("sampleUrl", sampleFile.getFullPathName());
        instrument->setProperty("sampleUrls", sampleUrls);
        instrument->setProperty("sampleMap", sampleMap);

        juce::DynamicObject::Ptr payload = new juce::DynamicObject();
        payload->setProperty("kind", "audio");
        payload->setProperty("audioFileId", "audio-1");
        payload->setProperty("gainDb", 0.0);

        juce::DynamicObject::Ptr segment = new juce::DynamicObject();
        segment->setProperty("id", "segment-1");
        segment->setProperty("trackId", "track-1");
        segment->setProperty("instrumentId", "sample-inst");
        segment->setProperty("startBeat", 0.0);
        segment->setProperty("lengthBeats", 4.0);
        segment->setProperty("repeats", 0);
        segment->setProperty("payload", juce::var(payload.get()));

        juce::Array<juce::var> segments;
        segments.add(juce::var(segment.get()));

        juce::DynamicObject::Ptr track = new juce::DynamicObject();
        track->setProperty("id", "track-1");
        track->setProperty("name", "Track");
        track->setProperty("kind", "mixed");
        track->setProperty("instrumentId", "sample-inst");
        track->setProperty("segments", segments);

        juce::Array<juce::var> tracks;
        tracks.add(juce::var(track.get()));

        juce::DynamicObject::Ptr project = new juce::DynamicObject();
        project->setProperty("id", "project-1");
        project->setProperty("name", "Integrity Project");
        project->setProperty("bpm", 120.0);
        project->setProperty("lengthBeats", 16.0);
        project->setProperty("tracks", tracks);

        juce::Array<juce::var> assets;
        assets.add(makeAsset("audio-asset", "audio", audioFile.getFullPathName(), "external"));
        assets.add(makeAsset("sample-asset", "sample", sampleFile.getFullPathName(), "external"));

        juce::Array<juce::var> audioFiles;
        audioFiles.add(juce::var(audio.get()));
        juce::Array<juce::var> instruments;
        instruments.add(juce::var(instrument.get()));

        juce::DynamicObject::Ptr plugin = new juce::DynamicObject();
        plugin->setProperty("id", "decent-plugin");
        plugin->setProperty("name", "Decent Plugin");
        plugin->setProperty("format", "decent-sampler");
        plugin->setProperty("associatedInstrumentId", "sample-inst");
        juce::Array<juce::var> plugins;
        plugins.add(juce::var(plugin.get()));

        juce::DynamicObject::Ptr documentObject = new juce::DynamicObject();
        documentObject->setProperty("schemaVersion", 1);
        documentObject->setProperty("project", juce::var(project.get()));
        documentObject->setProperty("audioFiles", audioFiles);
        documentObject->setProperty("instruments", instruments);
        documentObject->setProperty("plugins", plugins);
        documentObject->setProperty("assets", assets);
        juce::var document(documentObject.get());

        juce::String error;
        if (!beat::packageExternalDocumentAssets(document, projectFile, error))
        {
            std::cerr << "Project asset packaging failed for integrity fixture: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        const auto cleanReport = beat::verifyProjectDocumentIntegrity(document, projectFile);
        if (!cleanReport.ok() || beat::hasFatalProjectDocumentIntegrityErrors(cleanReport))
        {
            std::cerr << "Clean project integrity fixture failed with "
                      << cleanReport.errorCount() << " errors and "
                      << cleanReport.warningCount() << " warnings\n";
            root.deleteRecursively();
            return false;
        }

        auto badPluginDocument = juce::JSON::parse(juce::JSON::toString(document));
        auto badPlugins = badPluginDocument.getProperty("plugins", {});
        if (auto* badPluginArray = badPlugins.getArray())
        {
            if (!badPluginArray->isEmpty())
            {
                if (auto* badPlugin = badPluginArray->getReference(0).getDynamicObject())
                    badPlugin->setProperty("associatedInstrumentId", "missing-sampler");
            }
        }
        const auto badPluginReport = beat::verifyProjectDocumentIntegrity(badPluginDocument, projectFile);
        if (!reportContainsIssueCode(badPluginReport,
                                     "plugin.instrument.missing",
                                     beat::ProjectIntegritySeverity::Warning)
            || beat::hasFatalProjectDocumentIntegrityErrors(badPluginReport))
        {
            std::cerr << "Missing plugin sampler instrument was not reported by integrity verifier\n";
            root.deleteRecursively();
            return false;
        }

        auto duplicateIdDocument = juce::JSON::parse(juce::JSON::toString(document));
        auto duplicateTracks = duplicateIdDocument.getProperty("project", {}).getProperty("tracks", {});
        if (auto* duplicateTrackArray = duplicateTracks.getArray())
        {
            juce::DynamicObject::Ptr duplicateTrack = new juce::DynamicObject();
            duplicateTrack->setProperty("id", "track-1");
            duplicateTrack->setProperty("name", "Duplicate Track");
            duplicateTrack->setProperty("kind", "mixed");
            duplicateTrack->setProperty("segments", juce::Array<juce::var> {});
            duplicateTrackArray->add(juce::var(duplicateTrack.get()));
        }
        const auto duplicateIdReport = beat::verifyProjectDocumentIntegrity(duplicateIdDocument, projectFile);
        if (!reportContainsIssueCode(duplicateIdReport,
                                     "track.id.duplicate",
                                     beat::ProjectIntegritySeverity::Error)
            || !beat::hasFatalProjectDocumentIntegrityErrors(duplicateIdReport))
        {
            std::cerr << "Duplicate track id was not reported by integrity verifier\n";
            root.deleteRecursively();
            return false;
        }

        auto badRecordingDocument = juce::JSON::parse(juce::JSON::toString(document));
        auto badRecordingProject = badRecordingDocument.getProperty("project", {});
        if (auto* badRecordingProjectObject = badRecordingProject.getDynamicObject())
        {
            juce::DynamicObject::Ptr recordingInput = new juce::DynamicObject();
            recordingInput->setProperty("inputChannelStart", -1);
            recordingInput->setProperty("inputChannelCount", 0);
            recordingInput->setProperty("measuredRoundTripSamples", 512);
            recordingInput->setProperty("reportedInputLatencySamples", -4);
            recordingInput->setProperty("reportedOutputLatencySamples", 128);
            badRecordingProjectObject->setProperty("recordingInput", juce::var(recordingInput.get()));

            auto recordingTracks = badRecordingProjectObject->getProperty("tracks");
            if (auto* recordingTrackArray = recordingTracks.getArray())
            {
                if (!recordingTrackArray->isEmpty())
                {
                    if (auto* recordingTrack = recordingTrackArray->getReference(0).getDynamicObject())
                    {
                        recordingTrack->setProperty("recordArmed", true);
                        recordingTrack->setProperty("inputMonitoring", true);
                        recordingTrack->setProperty("inputChannelStart", -1);
                        recordingTrack->setProperty("inputChannelCount", 0);
                    }
                }
            }
        }

        const auto badRecordingReport = beat::verifyProjectDocumentIntegrity(badRecordingDocument, projectFile);
        if (!reportContainsIssueCode(badRecordingReport,
                                     "recording.input.channels.invalid",
                                     beat::ProjectIntegritySeverity::Warning)
            || !reportContainsIssueCode(badRecordingReport,
                                        "recording.calibration.sampleRate.missing",
                                        beat::ProjectIntegritySeverity::Warning)
            || !reportContainsIssueCode(badRecordingReport,
                                        "recording.calibration.latency.invalid",
                                        beat::ProjectIntegritySeverity::Warning)
            || !reportContainsIssueCode(badRecordingReport,
                                        "track.recording.channels.invalid",
                                        beat::ProjectIntegritySeverity::Warning)
            || beat::hasFatalProjectDocumentIntegrityErrors(badRecordingReport))
        {
            std::cerr << "Bad recording metadata was not reported by integrity verifier\n";
            root.deleteRecursively();
            return false;
        }

        auto badGraphDocument = juce::JSON::parse(juce::JSON::toString(document));
        auto badTracks = badGraphDocument.getProperty("project", {}).getProperty("tracks", {});
        if (auto* badTrackArray = badTracks.getArray())
        {
            if (!badTrackArray->isEmpty())
            {
                auto badSegments = badTrackArray->getReference(0).getProperty("segments", {});
                if (auto* badSegmentArray = badSegments.getArray())
                {
                    if (!badSegmentArray->isEmpty())
                    {
                        if (auto* badSegment = badSegmentArray->getReference(0).getDynamicObject())
                        {
                            badSegment->setProperty("trackId", "missing-track");
                            badSegment->setProperty("startBeat", -0.25);
                            badSegment->setProperty("lengthBeats", -1.0);

                            auto badPayload = badSegment->getProperty("payload");
                            if (auto* badPayloadObject = badPayload.getDynamicObject())
                                badPayloadObject->setProperty("audioFileId", "missing-audio");
                        }
                    }
                }
            }
        }
        const auto badGraphReport = beat::verifyProjectDocumentIntegrity(badGraphDocument, projectFile);
        const bool badGraphOk = reportContainsIssueCode(badGraphReport,
                                                        "segment.trackId.mismatch",
                                                        beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badGraphReport,
                                       "segment.start.invalid",
                                       beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badGraphReport,
                                       "segment.length.invalid",
                                       beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badGraphReport,
                                       "segment.audioFile.missing",
                                       beat::ProjectIntegritySeverity::Error)
            && beat::hasFatalProjectDocumentIntegrityErrors(badGraphReport);
        if (!badGraphOk)
        {
            std::cerr << "Bad segment graph was not fully reported by integrity verifier errors="
                      << badGraphReport.errorCount()
                      << " warnings=" << badGraphReport.warningCount() << "\n";
            root.deleteRecursively();
            return false;
        }

        auto badGroupDocument = juce::JSON::parse(juce::JSON::toString(document));
        auto badGroupTracks = badGroupDocument.getProperty("project", {}).getProperty("tracks", {});
        if (auto* badGroupTrackArray = badGroupTracks.getArray())
        {
            if (!badGroupTrackArray->isEmpty())
            {
                if (auto* firstTrack = badGroupTrackArray->getReference(0).getDynamicObject())
                    firstTrack->setProperty("parentTrackId", "track-1");
            }

            juce::DynamicObject::Ptr childOfNonGroup = new juce::DynamicObject();
            childOfNonGroup->setProperty("id", "child-non-group");
            childOfNonGroup->setProperty("name", "Child Non Group");
            childOfNonGroup->setProperty("kind", "mixed");
            childOfNonGroup->setProperty("parentTrackId", "track-1");
            childOfNonGroup->setProperty("segments", juce::Array<juce::var> {});
            badGroupTrackArray->add(juce::var(childOfNonGroup.get()));

            juce::DynamicObject::Ptr childMissing = new juce::DynamicObject();
            childMissing->setProperty("id", "child-missing");
            childMissing->setProperty("name", "Child Missing");
            childMissing->setProperty("kind", "mixed");
            childMissing->setProperty("parentTrackId", "missing-group");
            childMissing->setProperty("segments", juce::Array<juce::var> {});
            badGroupTrackArray->add(juce::var(childMissing.get()));

            juce::DynamicObject::Ptr groupA = new juce::DynamicObject();
            groupA->setProperty("id", "group-a");
            groupA->setProperty("name", "Group A");
            groupA->setProperty("kind", "group");
            groupA->setProperty("parentTrackId", "group-b");
            groupA->setProperty("segments", juce::Array<juce::var> {});
            badGroupTrackArray->add(juce::var(groupA.get()));

            juce::DynamicObject::Ptr groupB = new juce::DynamicObject();
            groupB->setProperty("id", "group-b");
            groupB->setProperty("name", "Group B");
            groupB->setProperty("kind", "group");
            groupB->setProperty("parentTrackId", "group-a");
            groupB->setProperty("segments", juce::Array<juce::var> {});
            badGroupTrackArray->add(juce::var(groupB.get()));
        }
        const auto badGroupReport = beat::verifyProjectDocumentIntegrity(badGroupDocument, projectFile);
        const bool badGroupOk = reportContainsIssueCode(badGroupReport,
                                                        "track.parent.self",
                                                        beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badGroupReport,
                                       "track.parent.notGroup",
                                       beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badGroupReport,
                                       "track.parent.missing",
                                       beat::ProjectIntegritySeverity::Error)
            && reportContainsIssueCode(badGroupReport,
                                       "track.parent.cycle",
                                       beat::ProjectIntegritySeverity::Error)
            && beat::hasFatalProjectDocumentIntegrityErrors(badGroupReport);
        if (!badGroupOk)
        {
            std::cerr << "Bad group routing graph was not reported by integrity verifier errors="
                      << badGroupReport.errorCount()
                      << " warnings=" << badGroupReport.warningCount() << "\n";
            root.deleteRecursively();
            return false;
        }

        auto audioTimingDocument = juce::JSON::parse(juce::JSON::toString(document));
        auto audioTimingFiles = audioTimingDocument.getProperty("audioFiles", {});
        if (auto* audioTimingFileArray = audioTimingFiles.getArray())
        {
            if (!audioTimingFileArray->isEmpty())
            {
                if (auto* audioObject = audioTimingFileArray->getReference(0).getDynamicObject())
                {
                    audioObject->setProperty("durationSeconds", 1.0);
                    audioObject->setProperty("sampleRate", 44100.0);
                }
            }
        }
        auto audioTimingTracks = audioTimingDocument.getProperty("project", {}).getProperty("tracks", {});
        if (auto* audioTimingTrackArray = audioTimingTracks.getArray())
        {
            if (!audioTimingTrackArray->isEmpty())
            {
                auto audioTimingSegments = audioTimingTrackArray->getReference(0).getProperty("segments", {});
                if (auto* audioTimingSegmentArray = audioTimingSegments.getArray())
                {
                    if (!audioTimingSegmentArray->isEmpty())
                    {
                        if (auto* audioTimingSegment = audioTimingSegmentArray->getReference(0).getDynamicObject())
                        {
                            audioTimingSegment->setProperty("sourceStartBeat", 1.5);
                            audioTimingSegment->setProperty("lengthBeats", 1.0);
                            audioTimingSegment->setProperty("fadeInBeats", 0.75);
                            audioTimingSegment->setProperty("fadeOutBeats", 0.75);
                        }
                    }
                }
            }
        }
        const auto audioTimingReport = beat::verifyProjectDocumentIntegrity(audioTimingDocument, projectFile);
        const bool audioTimingOk = audioTimingReport.ok()
            && reportContainsIssueCode(audioTimingReport,
                                       "segment.audio.trim.exceedsSource",
                                       beat::ProjectIntegritySeverity::Warning)
            && reportContainsIssueCode(audioTimingReport,
                                       "segment.fade.exceedsLength",
                                       beat::ProjectIntegritySeverity::Warning);
        if (!audioTimingOk)
        {
            std::cerr << "Audio segment timing warnings were not reported errors="
                      << audioTimingReport.errorCount()
                      << " warnings=" << audioTimingReport.warningCount() << "\n";
            root.deleteRecursively();
            return false;
        }

        auto audioSourceOutDocument = juce::JSON::parse(juce::JSON::toString(audioTimingDocument));
        auto audioSourceOutTracks = audioSourceOutDocument.getProperty("project", {}).getProperty("tracks", {});
        if (auto* audioSourceOutTrackArray = audioSourceOutTracks.getArray())
        {
            if (!audioSourceOutTrackArray->isEmpty())
            {
                auto audioSourceOutSegments = audioSourceOutTrackArray->getReference(0).getProperty("segments", {});
                if (auto* audioSourceOutSegmentArray = audioSourceOutSegments.getArray())
                {
                    if (!audioSourceOutSegmentArray->isEmpty())
                    {
                        if (auto* audioSourceOutSegment = audioSourceOutSegmentArray->getReference(0).getDynamicObject())
                        {
                            audioSourceOutSegment->setProperty("sourceStartBeat", 2.1);
                            audioSourceOutSegment->setProperty("fadeInBeats", 0.0);
                            audioSourceOutSegment->setProperty("fadeOutBeats", 0.0);
                        }
                    }
                }
            }
        }
        const auto audioSourceOutReport = beat::verifyProjectDocumentIntegrity(audioSourceOutDocument, projectFile);
        if (!reportContainsIssueCode(audioSourceOutReport,
                                     "segment.audio.sourceStart.outOfRange",
                                     beat::ProjectIntegritySeverity::Error)
            || !beat::hasFatalProjectDocumentIntegrityErrors(audioSourceOutReport))
        {
            std::cerr << "Out-of-range audio source start was not reported\n";
            root.deleteRecursively();
            return false;
        }

        auto trackIdRepairDocument = juce::JSON::parse(juce::JSON::toString(document));
        auto repairTracks = trackIdRepairDocument.getProperty("project", {}).getProperty("tracks", {});
        if (auto* repairTrackArray = repairTracks.getArray())
        {
            if (!repairTrackArray->isEmpty())
            {
                auto repairSegments = repairTrackArray->getReference(0).getProperty("segments", {});
                if (auto* repairSegmentArray = repairSegments.getArray())
                {
                    if (!repairSegmentArray->isEmpty())
                        if (auto* repairSegment = repairSegmentArray->getReference(0).getDynamicObject())
                            repairSegment->setProperty("trackId", "stale-track-id");
                }
            }
        }

        const auto trackIdRepairBefore = beat::verifyProjectDocumentIntegrity(trackIdRepairDocument, projectFile);
        const bool repairedTrackIds = beat::repairProjectDocumentSegmentTrackIds(trackIdRepairDocument);
        const auto trackIdRepairAfter = beat::verifyProjectDocumentIntegrity(trackIdRepairDocument, projectFile);
        if (!reportContainsIssueCode(trackIdRepairBefore,
                                     "segment.trackId.mismatch",
                                     beat::ProjectIntegritySeverity::Error)
            || !beat::hasFatalProjectDocumentIntegrityErrors(trackIdRepairBefore)
            || !repairedTrackIds
            || !trackIdRepairAfter.ok()
            || beat::hasFatalProjectDocumentIntegrityErrors(trackIdRepairAfter))
        {
            std::cerr << "Segment trackId repair failed beforeErrors="
                      << trackIdRepairBefore.errorCount()
                      << " afterErrors=" << trackIdRepairAfter.errorCount()
                      << " repaired=" << repairedTrackIds << "\n";
            root.deleteRecursively();
            return false;
        }

        const auto packagedSamplePath = document.getProperty("instruments", {})[0]
            .getProperty("sampleUrl", {})
            .toString();
        const auto packagedSampleFile = projectFile.getParentDirectory().getChildFile(packagedSamplePath);
        packagedSampleFile.deleteFile();

        const auto missingReport = beat::verifyProjectDocumentIntegrity(document, projectFile);
        if (missingReport.ok()
            || !reportContainsIssueCode(missingReport,
                                        "asset.missing",
                                        beat::ProjectIntegritySeverity::Error)
            || beat::hasFatalProjectDocumentIntegrityErrors(missingReport))
        {
            std::cerr << "Missing project asset was not reported by integrity verifier\n";
            root.deleteRecursively();
            return false;
        }

        if (!sampleFile.copyFileTo(packagedSampleFile))
        {
            std::cerr << "Could not restore packaged sample fixture\n";
            root.deleteRecursively();
            return false;
        }

        const auto orphan = beat::projectSidecarFolderFor(projectFile)
            .getChildFile("samples")
            .getChildFile("orphan.wav");
        if (!orphan.getParentDirectory().createDirectory()
            || !orphan.replaceWithText("orphan"))
        {
            std::cerr << "Could not create sidecar orphan fixture\n";
            root.deleteRecursively();
            return false;
        }

        const auto orphanReport = beat::verifyProjectDocumentIntegrity(document, projectFile);
        bool ok = orphanReport.ok()
            && reportContainsIssueCode(orphanReport,
                                       "asset.sidecar.orphan",
                                       beat::ProjectIntegritySeverity::Warning);

        if (ok)
        {
            const auto cleanup = beat::cleanupUnusedProjectSidecarAssets(document, projectFile);
            const auto cleanedReport = beat::verifyProjectDocumentIntegrity(document, projectFile);
            ok = cleanup.ok()
                && cleanup.deletedFiles == 1
                && !orphan.existsAsFile()
                && packagedSampleFile.existsAsFile()
                && cleanedReport.ok()
                && !reportContainsIssueCode(cleanedReport,
                                            "asset.sidecar.orphan",
                                            beat::ProjectIntegritySeverity::Warning);
            if (!ok)
            {
                std::cerr << "Sidecar cleanup failed deleted=" << cleanup.deletedFiles
                          << " failed=" << cleanup.failedFiles
                          << " orphanExists=" << orphan.existsAsFile()
                          << " sampleExists=" << packagedSampleFile.existsAsFile()
                          << " cleanedWarnings=" << cleanedReport.warningCount() << "\n";
            }
        }

        if (!ok)
        {
            std::cerr << "Sidecar orphan report failed with errors="
                      << orphanReport.errorCount()
                      << " warnings=" << orphanReport.warningCount() << "\n";
        }

        root.deleteRecursively();
        return ok;
    }

    bool stressRecentProjectRepository()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-recents-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("recents.sqlite");
        const auto firstFile = root.getChildFile("First.beat");
        const auto secondFile = root.getChildFile("Second.beat");
        const auto missingPath = root.getChildFile("Missing.beat").getFullPathName();

        if (!root.createDirectory()
            || !firstFile.replaceWithText("{}")
            || !secondFile.replaceWithText("{}"))
        {
            std::cerr << "Could not create recent project fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::Database db(dbFile);
        beat::ProjectRepository repo(db);

        {
            beat::Statement stmt(db, R"sql(
                INSERT INTO recent_projects(path, name, opened_at, size_bytes)
                VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)
            )sql");
            stmt.bind(1, firstFile.getFullPathName());
            stmt.bind(2, "First");
            stmt.bind(3, 100);
            stmt.bind(4, (double) firstFile.getSize());
            stmt.bind(5, missingPath);
            stmt.bind(6, "Missing");
            stmt.bind(7, 1710000001);
            stmt.bind(8, 0.0);
            stmt.bind(9, secondFile.getFullPathName());
            stmt.bind(10, "Second");
            stmt.bind(11, (double) 1710000002000LL);
            stmt.bind(12, (double) secondFile.getSize());
            stmt.step();
        }

        const auto recents = repo.listRecentProjects();
        const bool orderOk = recents.size() == 3
            && recents[0].path == secondFile.getFullPathName()
            && recents[1].path == missingPath
            && recents[2].path == firstFile.getFullPathName();
        const bool existenceOk = orderOk
            && recents[0].exists
            && !recents[1].exists
            && recents[2].exists;
        const bool legacyTimestampOk = orderOk
            && recents[0].openedAt == 1710000002000LL
            && recents[1].openedAt == 1710000001000LL
            && recents[2].openedAt == 0;

        repo.removeRecentProject(missingPath);
        const auto afterRemove = repo.listRecentProjects();
        const bool removeOk = afterRemove.size() == 2
            && afterRemove[0].path == secondFile.getFullPathName()
            && afterRemove[1].path == firstFile.getFullPathName();

        juce::DynamicObject::Ptr project = new juce::DynamicObject();
        project->setProperty("name", "Named From Document");
        juce::DynamicObject::Ptr document = new juce::DynamicObject();
        document->setProperty("project", juce::var(project.get()));
        repo.recordRecentProject(firstFile, juce::var(document.get()));
        const auto afterRecord = repo.listRecentProjects();
        const bool recordOk = !afterRecord.empty()
            && afterRecord.front().path == firstFile.getFullPathName()
            && afterRecord.front().name == "Named From Document"
            && afterRecord.front().sizeBytes == (double) firstFile.getSize()
            && afterRecord.front().openedAt > 1000000000000LL;

        root.deleteRecursively();
        const bool ok = orderOk && existenceOk && legacyTimestampOk && removeOk && recordOk;
        if (!ok)
        {
            std::cerr << "Recent project repository stress failed order=" << orderOk
                      << " existence=" << existenceOk
                      << " legacyTimestamp=" << legacyTimestampOk
                      << " remove=" << removeOk
                      << " record=" << recordOk << "\n";
        }
        return ok;
    }

    bool stressProjectRepositoryPluginCapabilities()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-plugin-capabilities-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("projects.sqlite");

        if (!root.createDirectory())
        {
            std::cerr << "Could not create plugin capability fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::Project project;
        project.id = "plugin-capability-project";
        project.name = "Plugin Capability Project";
        project.bpm = 128.0;

        beat::PluginAdapterDefinition adapter;
        adapter.id = "adapter-aether-bridge";
        adapter.name = "Aether Bridge Host";
        adapter.vendor = "Beat";
        adapter.version = "0.2.0";
        adapter.kind = "synth";
        adapter.format = "bridge";
        adapter.status = "available";
        adapter.instrumentMode = "fallback-aether";
        adapter.description = "Fallback-capable protected synth adapter.";
        adapter.sourceFileName = "Lorenzos Drums V1.dspreset";
        adapter.sourcePath = "/tmp/Lorenzos Drums V1.dspreset";
        adapter.uiImagePath = "/tmp/Resources/bg_lorenzodrums.png";
        adapter.uiImageDataUrl = "data:image/png;base64,beatdsui";
        adapter.associatedInstrumentId = "lorenzos-drums-sampler";
        adapter.uiWidth = 812;
        adapter.uiHeight = 375;
        adapter.sampleCount = 192;
        adapter.uiControlCount = 9;
        adapter.factory = true;
        adapter.installedAt = 123456.0;

        beat::PluginCapability instrumentCapability;
        instrumentCapability.id = "aether-fallback-instrument";
        instrumentCapability.kind = "instrument";
        instrumentCapability.label = "Create Aether-backed instrument";
        instrumentCapability.realtime = true;
        instrumentCapability.offline = true;
        instrumentCapability.latencySamples = 0;
        instrumentCapability.fallbackMode = "aether";
        adapter.capabilities.push_back(std::move(instrumentCapability));

        beat::PluginCapability effectCapability;
        effectCapability.id = "bridge-effect-placeholder";
        effectCapability.kind = "effect";
        effectCapability.label = "Preserve effect placeholder";
        effectCapability.realtime = false;
        effectCapability.offline = true;
        effectCapability.latencySamples = 512;
        effectCapability.fallbackMode = "pass-through";
        adapter.capabilities.push_back(std::move(effectCapability));
        project.plugins.push_back(std::move(adapter));

        beat::Database db(dbFile);
        beat::ProjectRepository repo(db);
        repo.save(project);

        const auto loaded = repo.load(project.id);
        bool ok = loaded.has_value()
            && loaded->plugins.size() == 1
            && loaded->plugins.front().id == "adapter-aether-bridge"
            && loaded->plugins.front().sourceFileName == "Lorenzos Drums V1.dspreset"
            && loaded->plugins.front().sourcePath == "/tmp/Lorenzos Drums V1.dspreset"
            && loaded->plugins.front().uiImagePath == "/tmp/Resources/bg_lorenzodrums.png"
            && loaded->plugins.front().uiImageDataUrl == "data:image/png;base64,beatdsui"
            && loaded->plugins.front().associatedInstrumentId == "lorenzos-drums-sampler"
            && loaded->plugins.front().uiWidth == 812
            && loaded->plugins.front().uiHeight == 375
            && loaded->plugins.front().sampleCount == 192
            && loaded->plugins.front().uiControlCount == 9
            && loaded->plugins.front().factory
            && loaded->plugins.front().capabilities.size() == 2
            && loaded->plugins.front().capabilities.front().kind == "instrument"
            && loaded->plugins.front().capabilities.front().realtime
            && loaded->plugins.front().capabilities.front().offline
            && loaded->plugins.front().capabilities.front().fallbackMode == "aether"
            && loaded->plugins.front().capabilities.back().kind == "effect"
            && !loaded->plugins.front().capabilities.back().realtime
            && loaded->plugins.front().capabilities.back().offline
            && loaded->plugins.front().capabilities.back().latencySamples == 512
            && loaded->plugins.front().capabilities.back().fallbackMode == "pass-through";

        root.deleteRecursively();
        if (!ok)
        {
            std::cerr << "Project repository plugin capability roundtrip failed"
                      << " loaded=" << loaded.has_value()
                      << " pluginCount=" << (loaded ? (int) loaded->plugins.size() : -1)
                      << "\n";
        }
        return ok;
    }

    bool stressProjectRepositoryEffectDefaultsMigration()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-effect-defaults-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("projects.sqlite");

        if (!root.createDirectory())
        {
            std::cerr << "Could not create effect defaults fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::Project project;
        project.id = "effect-defaults-project";
        project.name = "Effect Defaults";

        beat::TrackEffect trackReverb;
        trackReverb.id = "legacy-track-reverb";
        trackReverb.kind = beat::TrackEffectKind::Reverb;
        trackReverb.schemaVersion = 0;
        trackReverb.params.push_back({ "mix", 33.0f });

        beat::TrackEffect returnDelay;
        returnDelay.id = "legacy-return-delay";
        returnDelay.kind = beat::TrackEffectKind::Delay;
        returnDelay.schemaVersion = 0;
        returnDelay.params.push_back({ "feedback", 44.0f });

        beat::TrackEffect instrumentDistortion;
        instrumentDistortion.id = "legacy-instrument-distortion";
        instrumentDistortion.kind = beat::TrackEffectKind::Distortion;
        instrumentDistortion.schemaVersion = 0;
        instrumentDistortion.params.push_back({ "drive", 77.0f });

        beat::Track track;
        track.id = "fx-track";
        track.name = "FX Track";
        track.effects.push_back(std::move(trackReverb));
        project.tracks.push_back(std::move(track));

        beat::ReturnBus bus;
        bus.id = "fx-return";
        bus.name = "FX Return";
        bus.effects.push_back(std::move(returnDelay));
        project.returnBuses.push_back(std::move(bus));

        beat::InstrumentDefinition instrument;
        instrument.id = "fx-instrument";
        instrument.kind = "synth";
        instrument.effects.push_back(std::move(instrumentDistortion));
        project.instruments.push_back(std::move(instrument));

        beat::Database db(dbFile);
        beat::ProjectRepository repo(db);
        repo.save(project);

        const auto loaded = repo.load(project.id);
        if (!loaded.has_value())
        {
            root.deleteRecursively();
            return false;
        }

        repo.save(*loaded);
        const auto reloaded = repo.load(project.id);

        const auto paramValue = [] (const beat::TrackEffect& effect, const juce::String& key) -> std::optional<float>
        {
            for (const auto& param : effect.params)
                if (param.key == key)
                    return param.value;
            return std::nullopt;
        };

        bool ok = reloaded.has_value()
            && reloaded->tracks.size() == 1
            && reloaded->tracks.front().effects.size() == 1
            && reloaded->returnBuses.size() == 1
            && reloaded->returnBuses.front().effects.size() == 1
            && reloaded->instruments.size() == 1
            && reloaded->instruments.front().effects.size() == 1;

        if (ok)
        {
            const auto& trackEffect = reloaded->tracks.front().effects.front();
            const auto& returnEffect = reloaded->returnBuses.front().effects.front();
            const auto& instrumentEffect = reloaded->instruments.front().effects.front();

            ok = trackEffect.schemaVersion == 1
                && returnEffect.schemaVersion == 1
                && instrumentEffect.schemaVersion == 1
                && paramValue(trackEffect, "roomSize").value_or(-1.0f) == 40.0f
                && paramValue(trackEffect, "damping").value_or(-1.0f) == 35.0f
                && paramValue(trackEffect, "mix").value_or(-1.0f) == 33.0f
                && paramValue(returnEffect, "timeMs").value_or(-1.0f) == 250.0f
                && paramValue(returnEffect, "feedback").value_or(-1.0f) == 44.0f
                && paramValue(returnEffect, "mix").value_or(-1.0f) == 18.0f
                && paramValue(instrumentEffect, "drive").value_or(-1.0f) == 77.0f
                && paramValue(instrumentEffect, "shape").value_or(-1.0f) == 35.0f
                && paramValue(instrumentEffect, "trimDb").value_or(-1.0f) == 6.0f
                && paramValue(instrumentEffect, "mix").value_or(-1.0f) == 45.0f;
        }

        root.deleteRecursively();
        if (!ok)
            std::cerr << "Project repository effect defaults migration failed\n";
        return ok;
    }

    bool stressProjectRepositoryAudioFileRoundtrip()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-audio-repository-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("projects.sqlite");

        if (!root.createDirectory())
        {
            std::cerr << "Could not create audio repository fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::Project project;
        project.id = "audio-repository-project";
        project.name = "Audio Repository Project";
        project.bpm = 120.0;
        project.lengthBeats = 8.0;
        project.recordingInput.inputDeviceId = "builtin-input";
        project.recordingInput.inputDeviceName = "Built-in Microphone";
        project.recordingInput.inputChannelStart = 1;
        project.recordingInput.inputChannelCount = 2;
        project.recordingInput.calibrationSampleRate = 48000.0;
        project.recordingInput.measuredRoundTripSamples = 960;
        project.recordingInput.reportedInputLatencySamples = 128;
        project.recordingInput.reportedOutputLatencySamples = 256;
        project.recordingInput.userLatencyAdjustmentSamples = 48;

        beat::InstrumentDefinition curveInstrument;
        curveInstrument.id = "curve-synth";
        curveInstrument.kind = "synth";
        curveInstrument.glideMs = 140.0f;
        curveInstrument.maxVoices = 7;
        curveInstrument.mono = true;
        curveInstrument.legato = true;
        project.instruments.push_back(curveInstrument);

        beat::AudioFileAsset audioFile;
        audioFile.id = "recorded-take-audio";
        audioFile.name = "Recorded Take";
        audioFile.path = root.getChildFile("Recorded Take.wav").getFullPathName();
        audioFile.durationSeconds = 2.0;
        audioFile.sampleRate = 48000.0;
        project.audioFiles.push_back(audioFile);

        beat::Track track;
        track.id = "audio-track";
        track.name = "Recorded Audio";
        track.kind = beat::TrackKind::Audio;
        track.audioFileId = audioFile.id;
        track.recordArmed = true;
        track.inputMonitoring = true;
        track.inputDeviceId = "builtin-input";
        track.inputChannelStart = 1;
        track.inputChannelCount = 2;
        track.recordGainDb = -3.5f;

        beat::Segment segment;
        segment.id = "recorded-take-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Audio;
        segment.audioFileId = audioFile.id;
        segment.startBeat = 2.0;
        segment.lengthBeats = 4.0;
        segment.sourceStartBeat = 0.25;
        segment.fadeInBeats = 0.125;
        segment.fadeOutBeats = 0.25;
        segment.audioGainDb = -3.0f;
        track.segments.push_back(segment);
        project.tracks.push_back(track);

        beat::Track midiTrack;
        midiTrack.id = "curve-midi-track";
        midiTrack.name = "Curve MIDI";
        midiTrack.kind = beat::TrackKind::Midi;
        midiTrack.instrumentId = "curve-synth";

        beat::Segment midiSegment;
        midiSegment.id = "curve-midi-segment";
        midiSegment.trackId = midiTrack.id;
        midiSegment.kind = beat::SegmentPayloadKind::Midi;
        midiSegment.instrumentId = midiTrack.instrumentId;
        midiSegment.startBeat = 1.0;
        midiSegment.lengthBeats = 2.0;

        beat::MidiNote curveNote;
        curveNote.instrumentId = midiTrack.instrumentId;
        curveNote.pitch = 60;
        curveNote.velocity = 96;
        curveNote.startBeat = 0.25;
        curveNote.lengthBeats = 1.25;
        curveNote.connectToIndex = 1;
        curveNote.curve.push_back({ 0.25, 60.25 });
        curveNote.curve.push_back({ 1.50, 63.75 });
        beat::MidiAutomationLane noteLane;
        noteLane.target = "filter.cutoff";
        noteLane.points.push_back({ 0.25, 0.2f, beat::AutomationCurve::Smoothstep });
        noteLane.points.push_back({ 1.50, 0.8f, beat::AutomationCurve::Linear });
        curveNote.automation.push_back(std::move(noteLane));
        midiSegment.notes.push_back(curveNote);
        beat::MidiNote glideTargetNote;
        glideTargetNote.instrumentId = midiTrack.instrumentId;
        glideTargetNote.pitch = 67;
        glideTargetNote.velocity = 84;
        glideTargetNote.startBeat = 1.5;
        glideTargetNote.lengthBeats = 0.25;
        midiSegment.notes.push_back(glideTargetNote);
        midiTrack.segments.push_back(midiSegment);
        project.tracks.push_back(midiTrack);

        beat::Database db(dbFile);
        beat::ProjectRepository repo(db);
        repo.save(project);

        const auto loaded = repo.load(project.id);
        const bool ok = loaded.has_value()
            && loaded->audioFiles.size() == 1
            && loaded->audioFiles.front().id == audioFile.id
            && loaded->audioFiles.front().name == audioFile.name
            && loaded->audioFiles.front().path == audioFile.path
            && std::abs(loaded->audioFiles.front().durationSeconds - audioFile.durationSeconds) < 0.0001
            && std::abs(loaded->audioFiles.front().sampleRate - audioFile.sampleRate) < 0.0001
            && loaded->tracks.size() == 2
            && loaded->tracks.front().audioFileId == audioFile.id
            && loaded->tracks.front().recordArmed
            && loaded->tracks.front().inputMonitoring
            && loaded->recordingInput.inputDeviceId == "builtin-input"
            && loaded->recordingInput.inputDeviceName == "Built-in Microphone"
            && loaded->recordingInput.inputChannelStart == 1
            && loaded->recordingInput.inputChannelCount == 2
            && std::abs(loaded->recordingInput.calibrationSampleRate - 48000.0) < 0.0001
            && loaded->recordingInput.measuredRoundTripSamples == 960
            && loaded->recordingInput.reportedInputLatencySamples == 128
            && loaded->recordingInput.reportedOutputLatencySamples == 256
            && loaded->recordingInput.userLatencyAdjustmentSamples == 48
            && loaded->tracks.front().inputDeviceId == "builtin-input"
            && loaded->tracks.front().inputChannelStart == 1
            && loaded->tracks.front().inputChannelCount == 2
            && std::abs(loaded->tracks.front().recordGainDb + 3.5f) < 0.0001f
            && loaded->tracks.front().segments.size() == 1
            && loaded->tracks.front().segments.front().kind == beat::SegmentPayloadKind::Audio
            && loaded->tracks.front().segments.front().audioFileId == audioFile.id
            && std::abs(loaded->tracks.front().segments.front().sourceStartBeat - 0.25) < 0.0001
            && std::abs(loaded->tracks.front().segments.front().audioGainDb + 3.0f) < 0.0001f
            && loaded->tracks[1].segments.size() == 1
            && loaded->instruments.size() == 1
            && std::abs(loaded->instruments.front().glideMs - 140.0f) < 0.0001f
            && loaded->instruments.front().maxVoices == 7
            && loaded->instruments.front().mono
            && loaded->instruments.front().legato
            && loaded->tracks[1].segments.front().notes.size() == 2
            && loaded->tracks[1].segments.front().notes.front().connectToIndex == 1
            && loaded->tracks[1].segments.front().notes.front().curve.size() == 2
            && std::abs(loaded->tracks[1].segments.front().notes.front().curve.front().pitch - 60.25) < 0.0001
            && std::abs(loaded->tracks[1].segments.front().notes.front().curve.back().pitch - 63.75) < 0.0001
            && loaded->tracks[1].segments.front().notes.front().automation.size() == 1
            && loaded->tracks[1].segments.front().notes.front().automation.front().target == "filter.cutoff"
            && loaded->tracks[1].segments.front().notes.front().automation.front().points.size() == 2
            && loaded->tracks[1].segments.front().notes.front().automation.front().points.front().curve == beat::AutomationCurve::Smoothstep
            && std::abs(loaded->tracks[1].segments.front().notes.front().automation.front().points.back().value - 0.8f) < 0.0001f;

        root.deleteRecursively();
        if (!ok)
        {
            std::cerr << "Project repository audio file roundtrip failed"
                      << " loaded=" << loaded.has_value()
                      << " audioFileCount=" << (loaded ? (int) loaded->audioFiles.size() : -1)
                      << " trackCount=" << (loaded ? (int) loaded->tracks.size() : -1)
                      << "\n";
        }
        return ok;
    }

    bool stressRecordingPlannerAppendTake()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-recording-planner-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("projects.sqlite");
        const auto takeFile = root.getChildFile("Recorded Take.wav");

        if (!root.createDirectory() || !writeAudioClipFixture(takeFile))
        {
            std::cerr << "Could not create recording planner fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::Project project;
        project.id = "recording-planner-project";
        project.name = "Recording Planner Project";
        project.bpm = 120.0;
        project.lengthBeats = 1.0;

        beat::RecordedTakeSpec spec;
        spec.trackId = "record-track";
        spec.trackName = "Vocal Take";
        spec.audioFileId = "recorded-audio";
        spec.segmentId = "recorded-segment";
        spec.name = "Recorded Take";
        spec.path = takeFile.getFullPathName();
        spec.startBeat = 2.0;
        spec.durationSeconds = 2.0;
        spec.bpm = project.bpm;
        spec.sampleRate = 44100.0;
        spec.gainDb = -6.0f;

        juce::String error;
        const auto result = beat::appendRecordedTake(project, spec, &error);
        if (!result.has_value())
        {
            std::cerr << "Recording planner append failed: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        const bool modelOk = project.audioFiles.size() == 1
            && project.tracks.size() == 1
            && project.tracks.front().kind == beat::TrackKind::Audio
            && project.tracks.front().segments.size() == 1
            && project.tracks.front().segments.front().kind == beat::SegmentPayloadKind::Audio
            && project.tracks.front().segments.front().audioFileId == result->audioFileId
            && std::abs(result->lengthBeats - 4.0) < 0.0001
            && std::abs(project.lengthBeats - 6.0) < 0.0001;

        const auto rendered = renderOfflineBlock(project, 132300);
        const double renderedEnergy = bufferEnergy(rendered);
        const bool renderOk = std::isfinite(renderedEnergy) && renderedEnergy > 0.0001;

        beat::Database db(dbFile);
        beat::ProjectRepository repo(db);
        repo.save(project);
        const auto loaded = repo.load(project.id);
        const bool roundtripOk = loaded.has_value()
            && loaded->audioFiles.size() == 1
            && loaded->audioFiles.front().id == result->audioFileId
            && loaded->tracks.size() == 1
            && loaded->tracks.front().segments.size() == 1
            && loaded->tracks.front().segments.front().audioFileId == result->audioFileId;

        beat::RecordedTakeSpec duplicateSpec = spec;
        duplicateSpec.segmentId = "recorded-segment-b";
        const auto duplicate = beat::appendRecordedTake(project, duplicateSpec, &error);
        const bool duplicateRejected = !duplicate.has_value();

        root.deleteRecursively();
        const bool ok = modelOk && renderOk && roundtripOk && duplicateRejected;
        if (!ok)
        {
            std::cerr << "Recording planner stress failed model=" << modelOk
                      << " render=" << renderOk
                      << " energy=" << renderedEnergy
                      << " roundtrip=" << roundtripOk
                      << " duplicateRejected=" << duplicateRejected << "\n";
        }
        return ok;
    }

    bool stressRecordingPlannerLatencyCompensation()
    {
        beat::Project project;
        project.id = "recording-latency-project";
        project.name = "Recording Latency Project";
        project.bpm = 60.0;
        project.lengthBeats = 1.0;

        beat::RecordedTakeSpec spec;
        spec.trackId = "latency-track";
        spec.audioFileId = "latency-audio";
        spec.segmentId = "latency-segment";
        spec.path = "/private/tmp/BeatBackendStress-latency.wav";
        spec.startBeat = 2.0;
        spec.durationSeconds = 1.0;
        spec.bpm = project.bpm;
        spec.sampleRate = 1000.0;
        spec.inputLatencySamples = 250;
        spec.outputLatencySamples = 250;

        juce::String error;
        const auto result = beat::appendRecordedTake(project, spec, &error);
        if (!result.has_value())
        {
            std::cerr << "Recording latency append failed: " << error << "\n";
            return false;
        }

        const auto& segment = project.tracks.front().segments.front();
        const bool shiftedEarlier = std::abs(segment.startBeat - 1.5) < 0.0001
            && std::abs(segment.sourceStartBeat) < 0.0001
            && std::abs(segment.lengthBeats - 1.0) < 0.0001
            && std::abs(result->lengthBeats - 1.0) < 0.0001;

        beat::Project clampedProject;
        clampedProject.id = "recording-latency-clamped-project";
        clampedProject.name = "Recording Latency Clamped Project";
        clampedProject.bpm = 60.0;

        beat::RecordedTakeSpec clampedSpec = spec;
        clampedSpec.trackId = "latency-track-b";
        clampedSpec.audioFileId = "latency-audio-b";
        clampedSpec.segmentId = "latency-segment-b";
        clampedSpec.startBeat = 0.25;

        const auto clamped = beat::appendRecordedTake(clampedProject, clampedSpec, &error);
        if (!clamped.has_value())
        {
            std::cerr << "Recording clamped latency append failed: " << error << "\n";
            return false;
        }

        const auto& clampedSegment = clampedProject.tracks.front().segments.front();
        const bool clampedOk = std::abs(clampedSegment.startBeat) < 0.0001
            && std::abs(clampedSegment.sourceStartBeat - 0.25) < 0.0001
            && std::abs(clampedSegment.lengthBeats - 0.75) < 0.0001
            && std::abs(clamped->lengthBeats - 0.75) < 0.0001;

        if (!shiftedEarlier || !clampedOk)
        {
            std::cerr << "Recording latency compensation mismatch shifted=" << shiftedEarlier
                      << " clamped=" << clampedOk << "\n";
        }
        return shiftedEarlier && clampedOk;
    }

    bool stressRecordingLatencyCalibration()
    {
        beat::RecordingLatencyCalibrationSpec calibrationSpec;
        calibrationSpec.sampleRate = 48000.0;
        calibrationSpec.measuredRoundTripSamples = 960;
        calibrationSpec.reportedInputLatencySamples = 128;
        calibrationSpec.reportedOutputLatencySamples = 256;
        calibrationSpec.userAdjustmentSamples = 48;

        juce::String error;
        const auto calibration = beat::calculateRecordingLatencyCalibration(calibrationSpec, &error);
        if (!calibration.has_value())
        {
            std::cerr << "Recording latency calibration failed: " << error << "\n";
            return false;
        }

        const bool calibrationOk = calibration->reportedLatencySamples == 384
            && calibration->manualLatencySamples == 624
            && calibration->compensatedLatencySamples == 1008
            && std::abs(calibration->measuredRoundTripMs - 20.0) < 0.0001
            && std::abs(calibration->manualLatencyMs - 13.0) < 0.0001
            && std::abs(calibration->compensatedLatencyMs - 21.0) < 0.0001;

        beat::RecordingInputProfile profile;
        profile.calibrationSampleRate = calibrationSpec.sampleRate;
        profile.measuredRoundTripSamples = calibrationSpec.measuredRoundTripSamples;
        profile.reportedInputLatencySamples = calibrationSpec.reportedInputLatencySamples;
        profile.reportedOutputLatencySamples = calibrationSpec.reportedOutputLatencySamples;
        profile.userLatencyAdjustmentSamples = calibrationSpec.userAdjustmentSamples;
        const auto profileCalibration = beat::calculateRecordingLatencyCalibration(profile, &error);
        const bool profileCalibrationOk = profileCalibration.has_value()
            && profileCalibration->compensatedLatencySamples == calibration->compensatedLatencySamples;

        beat::RecordedTakeSpec spec;
        spec.trackId = "calibrated-track";
        spec.audioFileId = "calibrated-audio";
        spec.segmentId = "calibrated-segment";
        spec.path = "/private/tmp/BeatBackendStress-calibrated-recording.wav";
        spec.startBeat = 2.0;
        spec.durationSeconds = 1.0;
        spec.bpm = 120.0;
        spec.sampleRate = calibrationSpec.sampleRate;

        const auto calibratedSpec = beat::applyRecordingLatencyCalibration(spec, *calibration, &error);
        if (!calibratedSpec.has_value())
        {
            std::cerr << "Recording latency calibration apply failed: " << error << "\n";
            return false;
        }

        beat::Project project;
        project.id = "calibrated-recording-project";
        project.name = "Calibrated Recording Project";
        project.bpm = spec.bpm;
        const auto result = beat::appendRecordedTake(project, *calibratedSpec, &error);
        if (!result.has_value())
        {
            std::cerr << "Calibrated recording append failed: " << error << "\n";
            return false;
        }

        const auto& segment = project.tracks.front().segments.front();
        const double expectedLatencyBeats = (double) calibration->compensatedLatencySamples
            / spec.sampleRate
            * spec.bpm
            / 60.0;
        const bool placementOk = std::abs(segment.startBeat - (spec.startBeat - expectedLatencyBeats)) < 0.0001
            && std::abs(segment.sourceStartBeat) < 0.0001;

        beat::RecordingLatencyCalibrationSpec invalidSpec = calibrationSpec;
        invalidSpec.measuredRoundTripSamples = -1;
        const bool invalidRejected = !beat::calculateRecordingLatencyCalibration(invalidSpec, &error).has_value();

        const bool ok = calibrationOk && profileCalibrationOk && placementOk && invalidRejected;
        if (!ok)
        {
            std::cerr << "Recording latency calibration stress failed calibration=" << calibrationOk
                      << " profileCalibration=" << profileCalibrationOk
                      << " placement=" << placementOk
                      << " invalidRejected=" << invalidRejected
                      << " expectedLatencyBeats=" << expectedLatencyBeats << "\n";
        }
        return ok;
    }

    bool stressRecordingSessionPlanner()
    {
        beat::Project project;
        project.id = "recording-session-project";
        project.name = "Recording Session Project";
        project.bpm = 120.0;

        beat::Track vocal;
        vocal.id = "vocal-track";
        vocal.name = "Vocal";
        vocal.kind = beat::TrackKind::Audio;
        vocal.recordArmed = true;
        vocal.inputMonitoring = true;

        beat::Track guitar;
        guitar.id = "guitar-track";
        guitar.name = "Guitar";
        guitar.kind = beat::TrackKind::Audio;
        guitar.recordArmed = false;

        project.tracks.push_back(vocal);
        project.tracks.push_back(guitar);

        juce::String error;
        beat::RecordingSessionSpec spec;
        spec.trackId = "vocal-track";
        spec.requestedStartBeat = 8.0;
        spec.countInBeats = 4.0;
        spec.bpm = 120.0;
        spec.sampleRate = 48000.0;
        spec.maxDurationSeconds = 12.0;
        spec.inputChannels = 2;

        const auto planned = beat::planRecordingSession(project, spec, &error);
        const bool normalCountInOk = planned.has_value()
            && planned->trackId == "vocal-track"
            && std::abs(planned->transportStartBeat - 4.0) < 0.0001
            && std::abs(planned->captureStartBeat - 8.0) < 0.0001
            && std::abs(planned->countInBeats - 4.0) < 0.0001
            && std::abs(planned->captureDelaySeconds - 2.0) < 0.0001
            && planned->inputChannels == 2;

        beat::RecordingSessionSpec clampedSpec = spec;
        clampedSpec.trackId = {};
        clampedSpec.requestedStartBeat = 1.0;
        clampedSpec.countInBeats = 4.0;
        clampedSpec.inputChannels = 128;

        const auto clamped = beat::planRecordingSession(project, clampedSpec, &error);
        const bool clampedCountInOk = clamped.has_value()
            && clamped->trackId == "vocal-track"
            && std::abs(clamped->transportStartBeat) < 0.0001
            && std::abs(clamped->captureStartBeat - 1.0) < 0.0001
            && std::abs(clamped->countInBeats - 1.0) < 0.0001
            && std::abs(clamped->captureDelaySeconds - 0.5) < 0.0001
            && clamped->inputChannels == 32;

        beat::RecordingSessionSpec unarmedSpec = spec;
        unarmedSpec.trackId = "guitar-track";
        const bool unarmedRejected = !beat::planRecordingSession(project, unarmedSpec, &error).has_value();

        beat::Project noArmedProject = project;
        for (auto& track : noArmedProject.tracks)
            track.recordArmed = false;

        beat::RecordingSessionSpec firstArmedSpec = spec;
        firstArmedSpec.trackId = {};
        const bool missingArmedRejected = !beat::planRecordingSession(noArmedProject, firstArmedSpec, &error).has_value();

        beat::RecordingSessionSpec invalidSpec = spec;
        invalidSpec.maxDurationSeconds = 0.0;
        const bool invalidDurationRejected = !beat::planRecordingSession(project, invalidSpec, &error).has_value();

        const bool ok = normalCountInOk
            && clampedCountInOk
            && unarmedRejected
            && missingArmedRejected
            && invalidDurationRejected;

        if (!ok)
        {
            std::cerr << "Recording session planner stress failed normal=" << normalCountInOk
                      << " clamped=" << clampedCountInOk
                      << " unarmedRejected=" << unarmedRejected
                      << " missingArmedRejected=" << missingArmedRejected
                      << " invalidDurationRejected=" << invalidDurationRejected
                      << " lastError=" << error << "\n";
        }

        return ok;
    }

    bool stressRecordingPlannerCommitCapture()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-recording-commit-" + juce::Uuid().toString());
        const auto takeFile = root.getChildFile("Committed Take.wav");
        const auto duplicateFile = root.getChildFile("Duplicate Take.wav");
        const auto exportFile = root.getChildFile("Committed Take Export.wav");

        if (!root.createDirectory())
        {
            std::cerr << "Could not create recording commit fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::RecordingCapture capture;
        juce::String error;
        if (!capture.prepare(44100.0, 2, 0.1, &error))
        {
            std::cerr << "Recording capture prepare failed: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        juce::AudioBuffer<float> input(2, 512);
        for (int i = 0; i < input.getNumSamples(); ++i)
        {
            const float phase = (float) i / (float) input.getNumSamples();
            input.setSample(0, i, std::sin(phase * juce::MathConstants<float>::twoPi) * 0.55f);
            input.setSample(1, i, std::cos(phase * juce::MathConstants<float>::twoPi) * 0.35f);
        }
        std::array<const float*, 2> inputs {
            input.getReadPointer(0),
            input.getReadPointer(1),
        };

        capture.start();
        capture.captureBlock(inputs.data(), (int) inputs.size(), input.getNumSamples());
        capture.stop();

        beat::Project project;
        project.id = "recording-commit-project";
        project.name = "Recording Commit Project";
        project.bpm = 120.0;
        project.lengthBeats = 1.0;

        beat::RecordedTakeSpec spec;
        spec.trackId = "commit-track";
        spec.trackName = "Committed Takes";
        spec.audioFileId = "commit-audio";
        spec.segmentId = "commit-segment";
        spec.name = "Committed Take";
        spec.startBeat = 0.0;
        spec.bpm = project.bpm;

        const auto result = beat::commitRecordedCapture(project, capture, takeFile, spec, &error, 24);
        if (!result.has_value())
        {
            std::cerr << "Recording commit failed: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        const auto expectedDuration = (double) input.getNumSamples() / 44100.0;
        const bool modelOk = takeFile.existsAsFile()
            && project.audioFiles.size() == 1
            && std::abs(project.audioFiles.front().durationSeconds - expectedDuration) < 0.0001
            && project.tracks.size() == 1
            && project.tracks.front().segments.size() == 1
            && project.tracks.front().segments.front().audioFileId == result->audioFileId
            && std::abs(result->lengthBeats - expectedDuration * project.bpm / 60.0) < 0.0001;

        const auto rendered = renderOfflineBlock(project, 2048);
        const double renderedEnergy = bufferEnergy(rendered);
        const bool renderOk = std::isfinite(renderedEnergy) && renderedEnergy > 0.0001;

        const bool exported = beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error);
        const double exportedEnergy = exported ? wavEnergy(exportFile) : 0.0;
        const bool exportOk = exported && std::isfinite(exportedEnergy) && exportedEnergy > 0.0001;

        beat::RecordingCapture duplicateCapture;
        const bool duplicatePrepared = duplicateCapture.prepare(44100.0, 1, 0.1, &error);
        duplicateCapture.start();
        std::array<const float*, 1> monoInput { input.getReadPointer(0) };
        duplicateCapture.captureBlock(monoInput.data(), (int) monoInput.size(), 128);
        duplicateCapture.stop();

        beat::RecordedTakeSpec duplicateSpec = spec;
        duplicateSpec.segmentId = "commit-segment-b";
        const auto audioFileCountBefore = project.audioFiles.size();
        const auto duplicate = duplicatePrepared
            ? beat::commitRecordedCapture(project, duplicateCapture, duplicateFile, duplicateSpec, &error, 24)
            : std::optional<beat::RecordedTakeResult> {};
        const bool rollbackOk = duplicatePrepared
            && !duplicate.has_value()
            && !duplicateFile.existsAsFile()
            && project.audioFiles.size() == audioFileCountBefore;

        root.deleteRecursively();
        const bool ok = modelOk && renderOk && exportOk && rollbackOk;
        if (!ok)
        {
            std::cerr << "Recording commit stress failed model=" << modelOk
                      << " render=" << renderOk
                      << " energy=" << renderedEnergy
                      << " export=" << exportOk
                      << " exportEnergy=" << exportedEnergy
                      << " rollback=" << rollbackOk << "\n";
        }
        return ok;
    }

    bool stressProjectRepositorySampleInstrumentRoundtrip()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-sample-instrument-repository-" + juce::Uuid().toString());
        const auto dbFile = root.getChildFile("projects.sqlite");
        const auto sampleFile = root.getChildFile("Sample Instrument.wav");

        if (!root.createDirectory() || !writeAudioClipFixture(sampleFile))
        {
            std::cerr << "Could not create sample instrument repository fixture at "
                      << root.getFullPathName() << "\n";
            root.deleteRecursively();
            return false;
        }

        beat::Project project;
        project.id = "sample-instrument-repository-project";
        project.name = "Sample Instrument Repository Project";
        project.bpm = 120.0;
        project.lengthBeats = 2.0;

        beat::InstrumentDefinition instrument;
        instrument.id = "repo-sampler";
        instrument.kind = "sampler";
        instrument.attackMs = 1.0f;
        instrument.releaseMs = 50.0f;
        instrument.ampLevel = 0.8f;
        instrument.sampleUrls.add(sampleFile.getFullPathName());

        beat::InstrumentDefinition::SampleZone zone;
        zone.path = sampleFile.getFullPathName();
        zone.rootNote = 62;
        zone.loNote = 60;
        zone.hiNote = 64;
        zone.loVel = 32;
        zone.hiVel = 127;
        zone.volumeDb = -4.0f;
        zone.pan = 0.25f;
        zone.tuningCents = 7.0f;
        zone.seqPosition = 2;
        zone.loopEnabled = true;
        zone.loopStart = 128;
        zone.loopEnd = 1024;
        zone.oneShot = false;
        zone.durationSeconds = 0.5;
        zone.loLengthSeconds = 0.125;
        zone.hiLengthSeconds = 0.75;
        zone.chokeGroup = 3;
        zone.startSample = 32;
        zone.endSample = 4096;
        instrument.sampleZones.push_back(zone);

        beat::TrackEffect instrumentEffect;
        instrumentEffect.id = "repo-instrument-filter";
        instrumentEffect.kind = beat::TrackEffectKind::Lowpass;
        instrumentEffect.params.push_back({ "cutoffHz", 3200.0f });
        instrumentEffect.params.push_back({ "resonance", 0.35f });
        instrument.effects.push_back(std::move(instrumentEffect));

        project.instruments.push_back(instrument);

        beat::Track track;
        track.id = "repo-sampler-track";
        track.name = "Repository Sampler";
        track.kind = beat::TrackKind::Midi;
        track.instrumentId = instrument.id;

        beat::Segment segment;
        segment.id = "repo-sampler-segment";
        segment.trackId = track.id;
        segment.kind = beat::SegmentPayloadKind::Midi;
        segment.instrumentId = instrument.id;
        segment.startBeat = 0.0;
        segment.lengthBeats = 1.0;
        beat::MidiNote note;
        note.instrumentId = instrument.id;
        note.pitch = 62;
        note.velocity = 96;
        note.startBeat = 0.0;
        note.lengthBeats = 0.5;
        segment.notes.push_back(note);
        track.segments.push_back(segment);
        project.tracks.push_back(track);

        const auto before = renderOfflineBlock(project, 12000);
        const double beforeEnergy = bufferEnergy(before);

        beat::Database db(dbFile);
        beat::ProjectRepository repo(db);
        repo.save(project);
        const auto loaded = repo.load(project.id);

        bool metadataOk = loaded.has_value()
            && loaded->instruments.size() == 1
            && loaded->instruments.front().id == instrument.id
            && loaded->instruments.front().kind == "sampler"
            && loaded->instruments.front().sampleUrls.size() == 1
            && loaded->instruments.front().sampleZones.size() == 1
            && loaded->instruments.front().effects.size() == 1
            && loaded->instruments.front().effects.front().id == "repo-instrument-filter"
            && loaded->instruments.front().effects.front().kind == beat::TrackEffectKind::Lowpass
            && loaded->instruments.front().effects.front().params.size() == 2;

        if (metadataOk)
        {
            const auto& loadedZone = loaded->instruments.front().sampleZones.front();
            metadataOk = loadedZone.path == zone.path
                && loadedZone.rootNote == zone.rootNote
                && loadedZone.loNote == zone.loNote
                && loadedZone.hiNote == zone.hiNote
                && loadedZone.loVel == zone.loVel
                && loadedZone.hiVel == zone.hiVel
                && std::abs(loadedZone.volumeDb - zone.volumeDb) < 0.0001f
                && std::abs(loadedZone.pan - zone.pan) < 0.0001f
                && std::abs(loadedZone.tuningCents - zone.tuningCents) < 0.0001f
                && loadedZone.seqPosition == zone.seqPosition
                && loadedZone.loopEnabled == zone.loopEnabled
                && loadedZone.loopStart == zone.loopStart
                && loadedZone.loopEnd == zone.loopEnd
                && loadedZone.oneShot == zone.oneShot
                && std::abs(loadedZone.durationSeconds - zone.durationSeconds) < 0.0001
                && std::abs(loadedZone.loLengthSeconds - zone.loLengthSeconds) < 0.0001
                && std::abs(loadedZone.hiLengthSeconds - zone.hiLengthSeconds) < 0.0001
                && loadedZone.chokeGroup == zone.chokeGroup
                && loadedZone.startSample == zone.startSample
                && loadedZone.endSample == zone.endSample;
        }

        double afterEnergy = 0.0;
        if (loaded.has_value())
            afterEnergy = bufferEnergy(renderOfflineBlock(*loaded, 12000));

        root.deleteRecursively();
        const bool renderOk = std::isfinite(beforeEnergy)
            && std::isfinite(afterEnergy)
            && beforeEnergy > 0.0001
            && afterEnergy > 0.0001;
        const bool ok = metadataOk && renderOk;
        if (!ok)
        {
            std::cerr << "Project repository sample instrument roundtrip failed metadata=" << metadataOk
                      << " beforeEnergy=" << beforeEnergy
                      << " afterEnergy=" << afterEnergy
                      << " loaded=" << loaded.has_value()
                      << "\n";
        }
        return ok;
    }

    bool stressProjectDocumentBackup()
    {
        const auto root = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-backup-" + juce::Uuid().toString());
        const auto projectFile = root.getChildFile("Backup Project.beat");
        const auto makeProjectDocument = [](int version, const juce::String& name)
        {
            juce::DynamicObject::Ptr track = new juce::DynamicObject();
            track->setProperty("id", "track-" + juce::String(version));
            track->setProperty("name", "Track " + juce::String(version));
            track->setProperty("kind", "mixed");
            track->setProperty("segments", juce::Array<juce::var> {});

            juce::Array<juce::var> tracks;
            tracks.add(juce::var(track.get()));

            juce::DynamicObject::Ptr project = new juce::DynamicObject();
            project->setProperty("id", "project-" + juce::String(version));
            project->setProperty("name", name);
            project->setProperty("bpm", 120.0);
            project->setProperty("lengthBeats", 16.0);
            project->setProperty("tracks", tracks);

            juce::DynamicObject::Ptr document = new juce::DynamicObject();
            document->setProperty("schemaVersion", 1);
            document->setProperty("savedAt", static_cast<double>(version));
            document->setProperty("project", juce::var(project.get()));
            document->setProperty("instruments", juce::Array<juce::var> {});
            document->setProperty("audioFiles", juce::Array<juce::var> {});
            document->setProperty("assets", juce::Array<juce::var> {});
            return juce::JSON::toString(juce::var(document.get()), true);
        };

        if (!root.createDirectory())
        {
            std::cerr << "Could not create project backup fixture at "
                      << root.getFullPathName() << "\n";
            return false;
        }

        juce::String error;
        juce::File latest;
        if (!beat::createProjectBackupBeforeReplace(projectFile, error, &latest)
            || latest.existsAsFile()
            || beat::projectBackupFolderFor(projectFile).exists())
        {
            std::cerr << "Project backup should be a no-op for first save: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        const auto version1 = makeProjectDocument(1, "Backup V1");
        const auto version2 = makeProjectDocument(2, "Backup V2");
        const auto version3 = makeProjectDocument(3, "Backup V3");

        if (!projectFile.replaceWithText(version1))
        {
            root.deleteRecursively();
            return false;
        }

        if (!beat::createProjectBackupBeforeReplace(projectFile, error, &latest)
            || !latest.existsAsFile()
            || latest.loadFileAsString() != version1)
        {
            std::cerr << "Project backup latest file failed: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        if (!projectFile.replaceWithText(version2)
            || !beat::createProjectBackupBeforeReplace(projectFile, error, &latest)
            || !latest.existsAsFile()
            || latest.loadFileAsString() != version2)
        {
            std::cerr << "Project backup latest replacement failed: " << error << "\n";
            root.deleteRecursively();
            return false;
        }

        const auto listedBackups = beat::listProjectBackups(projectFile);
        juce::Array<juce::File> backups;
        beat::projectBackupFolderFor(projectFile).findChildFiles(backups, juce::File::findFiles, false, "*.beat");
        bool ok = backups.size() >= 3
            && !listedBackups.empty()
            && listedBackups.front().latest
            && beat::latestProjectBackupFileFor(projectFile).existsAsFile();

        if (!ok)
        {
            std::cerr << "Project backup expected latest plus timestamped snapshots, found "
                      << backups.size() << "\n";
        }

        juce::File restoreBackup;
        if (ok)
        {
            ok = projectFile.replaceWithText(version3)
                && beat::restoreProjectBackup(projectFile, listedBackups.front().file, error, &restoreBackup)
                && projectFile.loadFileAsString() == version2
                && restoreBackup.existsAsFile()
                && restoreBackup.loadFileAsString() == version3;
            if (!ok)
            {
                std::cerr << "Project backup restore failed: " << error
                          << " restored=" << projectFile.loadFileAsString()
                          << " backup=" << restoreBackup.getFullPathName() << "\n";
            }
        }

        if (ok)
        {
            const auto outsideBackup = root.getChildFile("Outside Backup.beat");
            juce::String outsideError;
            juce::File ignoredBackup;
            ok = outsideBackup.replaceWithText(version1)
                && !beat::restoreProjectBackup(projectFile, outsideBackup, outsideError, &ignoredBackup)
                && outsideError.containsIgnoreCase("outside");
            if (!ok)
            {
                std::cerr << "Project backup restore should reject outside backup: "
                          << outsideError << "\n";
            }
        }

        if (ok)
        {
            const auto corruptBackup = beat::projectBackupFolderFor(projectFile).getChildFile("Corrupt.beat");
            juce::String corruptError;
            juce::File ignoredBackup;
            ok = corruptBackup.replaceWithText("{not-json")
                && !beat::restoreProjectBackup(projectFile, corruptBackup, corruptError, &ignoredBackup)
                && corruptError.containsIgnoreCase("validation");
            if (!ok)
            {
                std::cerr << "Project backup restore should reject corrupt backup: "
                          << corruptError << "\n";
            }
        }

        root.deleteRecursively();
        return ok;
    }

    bool stressAudioEngineSampleLoopAndOneShot()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-loop.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto looped = renderOfflineBlock(makeSampleLoopOfflineProject(sampleFile, true, false), 36000);
        auto oneShot = renderOfflineBlock(makeSampleLoopOfflineProject(sampleFile, false, true), 16000);

        const double loopEarlyEnergy = bufferWindowEnergy(looped, 0, 4000);
        const double loopLateEnergy = bufferWindowEnergy(looped, 26000, 4000);
        const double oneShotEarlyEnergy = bufferWindowEnergy(oneShot, 0, 1200);
        const double oneShotLateEnergy = bufferWindowEnergy(oneShot, 7000, 2000);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(loopEarlyEnergy)
            && std::isfinite(loopLateEnergy)
            && std::isfinite(oneShotEarlyEnergy)
            && std::isfinite(oneShotLateEnergy)
            && loopEarlyEnergy > 0.0001
            && loopLateEnergy > loopEarlyEnergy * 0.05
            && oneShotEarlyEnergy > 0.0001
            && oneShotLateEnergy > oneShotEarlyEnergy * 0.01;
        if (!ok)
            std::cerr << "Sample loop/one-shot loopEarly=" << loopEarlyEnergy
                      << " loopLate=" << loopLateEnergy
                      << " oneShotEarly=" << oneShotEarlyEnergy
                      << " oneShotLate=" << oneShotLateEnergy << "\n";
        return ok;
    }

    bool stressAudioEngineSampleChokeGroups()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-choke.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto stacked = renderOfflineBlock(makeSampleChokeOfflineProject(sampleFile, 0), 14000);
        auto choked = renderOfflineBlock(makeSampleChokeOfflineProject(sampleFile, 1), 14000);

        const double stackedLateEnergy = bufferWindowEnergy(stacked, 5200, 2500);
        const double chokedLateEnergy = bufferWindowEnergy(choked, 5200, 2500);

        sampleFile.deleteFile();
        const bool ok = std::isfinite(stackedLateEnergy)
            && std::isfinite(chokedLateEnergy)
            && stackedLateEnergy > 0.0001
            && chokedLateEnergy > 0.0001
            && chokedLateEnergy < stackedLateEnergy * 0.45;
        if (!ok)
            std::cerr << "Sample choke stackedLate=" << stackedLateEnergy
                      << " chokedLate=" << chokedLateEnergy << "\n";
        return ok;
    }

    bool stressAudioEngineOfflineExport()
    {
        auto file = juce::File("/private/tmp").getChildFile("BeatBackendStress-export.wav");
        if (file.existsAsFile())
            file.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(makeTinyOfflineProject(), file, 44100.0, 256, 2, &error))
        {
            std::cerr << "Offline export error: " << error << "\n";
            return false;
        }
        if (!file.existsAsFile() || file.getSize() <= 44)
            return false;

        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr || reader->lengthInSamples <= 0 || reader->numChannels < 1)
            return false;

        juce::AudioBuffer<float> buffer((int) reader->numChannels, (int) juce::jmin<juce::int64>(reader->lengthInSamples, 44100));
        reader->read(&buffer, 0, buffer.getNumSamples(), 0, true, true);

        double energy = 0.0;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(ch, i);
                if (!std::isfinite(sample))
                    return false;
                energy += (double) sample * (double) sample;
            }
        }

        const auto analysis = beat::AudioFileAnalyzer::analyzeFile(file);
        if (!analysis
            || analysis->lengthInSamples <= 0
            || analysis->channelCount < 1
            || !std::isfinite(analysis->truePeakDbTP)
            || !std::isfinite(analysis->rmsDbFS)
            || analysis->clippingRatio < 0.0f)
        {
            std::cerr << "Offline export analysis failed\n";
            return false;
        }

        file.deleteFile();

        for (const int bitDepth : { 24, 32 })
        {
            auto formatFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-export-"
                + juce::String(bitDepth) + "bit.wav");
            if (formatFile.existsAsFile())
                formatFile.deleteFile();

            error.clear();
            if (!beat::AudioEngine::renderProjectToWav(makeTinyOfflineProject(),
                                                       formatFile,
                                                       48000.0,
                                                       256,
                                                       2,
                                                       &error,
                                                       {},
                                                       bitDepth))
            {
                std::cerr << "Offline " << bitDepth << "-bit export error: " << error << "\n";
                return false;
            }

            std::unique_ptr<juce::AudioFormatReader> formatReader(formatManager.createReaderFor(formatFile));
            const bool formatOk = formatReader != nullptr
                && formatReader->lengthInSamples > 0
                && (int) formatReader->numChannels == 2
                && (int) std::round(formatReader->sampleRate) == 48000
                && (int) formatReader->bitsPerSample == bitDepth;
            const auto formatAnalysis = beat::AudioFileAnalyzer::analyzeFile(formatFile);
            const bool analysisOk = formatAnalysis
                && formatAnalysis->bitDepth == bitDepth
                && formatAnalysis->channelCount == 2
                && (int) std::round(formatAnalysis->sampleRate) == 48000;
            if (!formatOk)
            {
                std::cerr << "Offline " << bitDepth << "-bit export validation failed"
                          << " bits=" << (formatReader != nullptr ? (int) formatReader->bitsPerSample : -1)
                          << " rate=" << (formatReader != nullptr ? formatReader->sampleRate : 0.0)
                          << "\n";
                formatFile.deleteFile();
                return false;
            }
            if (!analysisOk)
            {
                std::cerr << "Offline " << bitDepth << "-bit export analysis validation failed"
                          << " bits=" << (formatAnalysis ? formatAnalysis->bitDepth : -1)
                          << " channels=" << (formatAnalysis ? formatAnalysis->channelCount : -1)
                          << "\n";
                formatFile.deleteFile();
                return false;
            }

            formatFile.deleteFile();
        }

        return energy > 0.0001;
    }

    bool stressAudioEngineOfflineExportProgressAndCancel()
    {
        auto file = juce::File("/private/tmp").getChildFile("BeatBackendStress-export-progress.wav");
        if (file.existsAsFile())
            file.deleteFile();

        juce::String error;
        double lastProgress = -1.0;
        int progressCalls = 0;
        const bool exported = beat::AudioEngine::renderProjectToWav(
            makeTinyOfflineProject(),
            file,
            44100.0,
            256,
            2,
            &error,
            [&lastProgress, &progressCalls](double progress, juce::int64 samplesWritten, juce::int64 totalSamples)
            {
                if (progress < lastProgress || samplesWritten < 0 || totalSamples <= 0)
                    return false;
                lastProgress = progress;
                ++progressCalls;
                return true;
            });

        if (!exported || !file.existsAsFile() || progressCalls < 2 || lastProgress < 0.999)
        {
            std::cerr << "Offline export progress failed: exported=" << exported
                      << " progressCalls=" << progressCalls
                      << " lastProgress=" << lastProgress
                      << " error=" << error << "\n";
            file.deleteFile();
            return false;
        }

        file.deleteFile();

        auto cancelledFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-export-cancel.wav");
        if (cancelledFile.existsAsFile())
            cancelledFile.deleteFile();
        const juce::String preservedContents = "preserve existing render";
        if (!cancelledFile.replaceWithText(preservedContents))
            return false;

        error.clear();
        const bool cancelledExport = beat::AudioEngine::renderProjectToWav(
            makeTinyOfflineProject(),
            cancelledFile,
            44100.0,
            256,
            2,
            &error,
            [](double progress, juce::int64, juce::int64)
            {
                return progress < 0.25;
            });

        const bool ok = !cancelledExport
            && error.containsIgnoreCase("cancel")
            && cancelledFile.existsAsFile()
            && cancelledFile.loadFileAsString() == preservedContents
            && !cancelledFile.getSiblingFile(cancelledFile.getFileName() + ".tmp").existsAsFile();

        if (!ok)
        {
            std::cerr << "Offline export cancel failed: exported=" << cancelledExport
                      << " outputExists=" << cancelledFile.existsAsFile()
                      << " outputContents=" << cancelledFile.loadFileAsString()
                      << " error=" << error << "\n";
        }

        cancelledFile.deleteFile();
        cancelledFile.getSiblingFile(cancelledFile.getFileName() + ".tmp").deleteFile();
        return ok;
    }

    bool stressAudioEngineOfflineRangeExport()
    {
        auto file = juce::File("/private/tmp").getChildFile("BeatBackendStress-export-range.wav");
        if (file.existsAsFile())
            file.deleteFile();

        auto project = makeTinyOfflineProject();
        project.lengthBeats = 2.0;
        project.bpm = 120.0;
        auto& segment = project.tracks.front().segments.front();
        segment.lengthBeats = 1.0;
        auto& note = segment.notes.front();
        note.startBeat = 0.25;
        note.lengthBeats = 0.25;

        juce::String error;
        constexpr double startBeat = 0.25;
        constexpr double endBeat = 0.75;
        if (!beat::AudioEngine::renderProjectRangeToWav(project, startBeat, endBeat, file, false, 44100.0, 256, 2, &error))
        {
            std::cerr << "Offline range export error: " << error << "\n";
            return false;
        }

        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr)
            return false;

        const auto expectedSamples = (juce::int64) std::ceil(((endBeat - startBeat) * 60.0 / project.bpm) * 44100.0);
        const bool lengthOk = std::llabs(reader->lengthInSamples - expectedSamples) <= 1;
        const int compareSamples = (int) juce::jmin<juce::int64>(reader->lengthInSamples, expectedSamples);
        auto exported = readWavPrefix(file, compareSamples);
        auto live = renderOfflineRangeChunks(project, startBeat, compareSamples, 256, 44100.0);

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        bool parityOk = exported.getNumChannels() == live.getNumChannels()
            && exported.getNumSamples() >= compareSamples
            && live.getNumSamples() >= compareSamples
            && compareSamples > 0;

        if (parityOk)
        {
            for (int ch = 0; ch < live.getNumChannels(); ++ch)
            {
                for (int i = 0; i < compareSamples; ++i)
                {
                    const float liveSample = live.getSample(ch, i);
                    const float exportSample = exported.getSample(ch, i);
                    if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    {
                        parityOk = false;
                        break;
                    }

                    const float diff = std::abs(liveSample - exportSample);
                    maxAbsDiff = std::max(maxAbsDiff, diff);
                    sumAbsDiff += diff;
                    liveEnergy += (double) liveSample * (double) liveSample;
                }
                if (!parityOk)
                    break;
            }
        }

        const double meanAbsDiff = compareSamples > 0
            ? sumAbsDiff / (double) (live.getNumChannels() * compareSamples)
            : std::numeric_limits<double>::infinity();
        parityOk = parityOk
            && liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;

        juce::String emptyError;
        const bool emptyRejected = !beat::AudioEngine::renderProjectRangeToWav(project,
                                                                               1.0,
                                                                               1.0,
                                                                               file,
                                                                               false,
                                                                               44100.0,
                                                                               256,
                                                                               2,
                                                                               &emptyError)
            && emptyError.containsIgnoreCase("empty");

        file.deleteFile();
        const bool ok = lengthOk && parityOk && emptyRejected;
        if (!ok)
            std::cerr << "Offline range export length=" << reader->lengthInSamples
                      << " expected=" << expectedSamples
                      << " parity=" << parityOk
                      << " liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff
                      << " emptyError=" << emptyError << "\n";
        return ok;
    }

    bool stressAudioEngineReviewLoopRangeExportParity()
    {
        auto file = juce::File("/private/tmp").getChildFile("BeatBackendStress-review-loop-range.wav");
        if (file.existsAsFile())
            file.deleteFile();

        auto project = makeTinyOfflineProject();
        project.lengthBeats = 4.0;
        project.bpm = 120.0;
        auto& segment = project.tracks.front().segments.front();
        segment.lengthBeats = 2.0;
        auto& note = segment.notes.front();
        note.startBeat = 0.5;
        note.lengthBeats = 0.35;

        constexpr double startBeat = 0.25;
        constexpr double endBeat = 1.25;
        constexpr double sampleRate = 44100.0;
        constexpr int blockSize = 257;
        juce::String error;
        if (!beat::AudioEngine::renderProjectRangeToWav(project, startBeat, endBeat, file, false, sampleRate, blockSize, 2, &error))
        {
            std::cerr << "Review-loop range export error: " << error << "\n";
            return false;
        }

        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr)
        {
            file.deleteFile();
            return false;
        }

        const auto expectedSamples = (juce::int64) std::ceil(((endBeat - startBeat) * 60.0 / project.bpm) * sampleRate);
        const int compareSamples = (int) juce::jmin<juce::int64>(reader->lengthInSamples, expectedSamples);
        auto exported = readWavPrefix(file, compareSamples);
        auto loopLive = renderOfflineLoopRangeChunks(project, startBeat, endBeat, compareSamples, blockSize, sampleRate);

        double sumAbsDiff = 0.0;
        double liveEnergy = 0.0;
        float maxAbsDiff = 0.0f;
        bool parityOk = compareSamples > 0
            && exported.getNumChannels() == loopLive.getNumChannels()
            && exported.getNumSamples() >= compareSamples
            && loopLive.getNumSamples() >= compareSamples;

        if (parityOk)
        {
            for (int ch = 0; ch < loopLive.getNumChannels(); ++ch)
            {
                for (int i = 0; i < compareSamples; ++i)
                {
                    const float liveSample = loopLive.getSample(ch, i);
                    const float exportSample = exported.getSample(ch, i);
                    if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    {
                        parityOk = false;
                        break;
                    }

                    const float diff = std::abs(liveSample - exportSample);
                    maxAbsDiff = std::max(maxAbsDiff, diff);
                    sumAbsDiff += diff;
                    liveEnergy += (double) liveSample * (double) liveSample;
                }

                if (!parityOk)
                    break;
            }
        }

        const double meanAbsDiff = compareSamples > 0
            ? sumAbsDiff / (double) (loopLive.getNumChannels() * compareSamples)
            : std::numeric_limits<double>::infinity();
        const bool lengthOk = std::llabs(reader->lengthInSamples - expectedSamples) <= 1;
        parityOk = parityOk
            && liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;

        file.deleteFile();
        const bool ok = lengthOk && parityOk;
        if (!ok)
            std::cerr << "Review-loop range export parity failed"
                      << " length=" << reader->lengthInSamples
                      << " expected=" << expectedSamples
                      << " liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff
                      << "\n";
        return ok;
    }

    bool stressAudioEngineLiveExportParity()
    {
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 1.0;
        project.eqAutomation.push_back({ 0.0, -5.5f, 3.0f, -2.0f, 4.0f });

        beat::TrackEffect saturator;
        saturator.id = "parity-saturator";
        saturator.kind = beat::TrackEffectKind::Saturator;
        saturator.params.push_back({ "drive", 35.0f });
        saturator.params.push_back({ "mix", 70.0f });
        project.tracks.front().effects.push_back(std::move(saturator));

        constexpr int samples = 4096;
        auto live = renderOfflineChunks(project, samples, 256);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-live-export-parity.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Live/export parity export error: " << error << "\n";
            return false;
        }

        auto exported = readWavPrefix(exportFile, samples);
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
            return false;

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        return liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
    }

    bool stressAudioEngineInstrumentEffectLiveExportParity()
    {
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 1.0;

        beat::TrackEffect saturator;
        saturator.id = "instrument-parity-saturator";
        saturator.kind = beat::TrackEffectKind::Saturator;
        saturator.params.push_back({ "drive", 42.0f });
        saturator.params.push_back({ "mix", 85.0f });
        project.instruments.front().effects.push_back(std::move(saturator));

        constexpr int samples = 4096;
        auto live = renderOfflineChunks(project, samples, 257);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-instrument-effect-parity.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 257, 2, &error))
        {
            std::cerr << "Instrument effect parity export error: " << error << "\n";
            return false;
        }

        auto exported = readWavPrefix(exportFile, samples);
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
            return false;

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        const bool ok = liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
        if (!ok)
        {
            std::cerr << "Instrument effect live/export parity failed liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineInstrumentEffectExportTail()
    {
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 1.0;

        beat::TrackEffect delay;
        delay.id = "instrument-tail-delay";
        delay.kind = beat::TrackEffectKind::Delay;
        delay.params.push_back({ "timeMs", 180.0f });
        delay.params.push_back({ "feedback", 55.0f });
        delay.params.push_back({ "mix", 65.0f });
        project.instruments.front().effects.push_back(std::move(delay));

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-instrument-tail.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Instrument effect tail export error: " << error << "\n";
            return false;
        }

        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(exportFile));
        if (reader == nullptr)
            return false;

        const auto expectedMinimumSamples = (juce::int64) std::ceil((60.0 / project.bpm) * project.lengthBeats * 44100.0);
        const bool lengthIncludesTail = reader->lengthInSamples > expectedMinimumSamples + 1000;
        const double energy = wavEnergy(exportFile);
        exportFile.deleteFile();

        const bool ok = lengthIncludesTail && std::isfinite(energy) && energy > 0.0001;
        if (!ok)
        {
            std::cerr << "Instrument effect tail export failed length="
                      << (reader != nullptr ? reader->lengthInSamples : 0)
                      << " minimum=" << expectedMinimumSamples
                      << " energy=" << energy << "\n";
        }
        return ok;
    }

    bool stressAudioEngineEffectAutomationLiveExportParity()
    {
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 2.0;

        beat::TrackEffect filter;
        filter.id = "effect-automation-filter";
        filter.kind = beat::TrackEffectKind::Lowpass;
        filter.params.push_back({ "cutoffHz", 250.0f });
        filter.params.push_back({ "resonance", 0.15f });

        beat::MidiAutomationLane cutoffLane;
        cutoffLane.target = "cutoffHz";
        cutoffLane.points.push_back({ 0.0, 250.0f, beat::AutomationCurve::Linear });
        cutoffLane.points.push_back({ 0.5, 9000.0f, beat::AutomationCurve::Quadratic });
        cutoffLane.points.push_back({ 1.25, 1200.0f, beat::AutomationCurve::Cubic });
        filter.automation.push_back(std::move(cutoffLane));
        project.tracks.front().effects.push_back(std::move(filter));

        auto staticProject = project;
        staticProject.tracks.front().effects.front().automation.clear();

        constexpr int samples = 44100;
        auto live = renderOfflineChunks(project, samples, 257);
        auto staticRender = renderOfflineChunks(staticProject, samples, 257);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-effect-automation-parity.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 257, 2, &error))
        {
            std::cerr << "Effect automation parity export error: " << error << "\n";
            return false;
        }

        auto exported = readWavPrefix(exportFile, samples);
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
            return false;

        double liveStaticAbsDiff = 0.0;
        double liveExportAbsDiff = 0.0;
        float maxExportAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float staticSample = staticRender.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(staticSample) || !std::isfinite(exportSample))
                    return false;

                liveStaticAbsDiff += std::abs(liveSample - staticSample);
                const float exportDiff = std::abs(liveSample - exportSample);
                maxExportAbsDiff = std::max(maxExportAbsDiff, exportDiff);
                liveExportAbsDiff += exportDiff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double sampleCount = (double) (live.getNumChannels() * samples);
        const double meanStaticDiff = liveStaticAbsDiff / sampleCount;
        const double meanExportDiff = liveExportAbsDiff / sampleCount;
        const bool ok = liveEnergy > 0.0001
            && meanStaticDiff > 0.00001
            && maxExportAbsDiff <= 0.00008f
            && meanExportDiff <= 0.00002;

        if (!ok)
        {
            std::cerr << "Effect automation parity failed liveEnergy=" << liveEnergy
                      << " meanStaticDiff=" << meanStaticDiff
                      << " maxExportDiff=" << maxExportAbsDiff
                      << " meanExportDiff=" << meanExportDiff << "\n";
        }

        return ok;
    }

    bool stressAudioEngineSampleRateMatrix()
    {
        auto project = makeTinyOfflineProject();
        project.lengthBeats = 1.0;
        project.eqAutomation.push_back({ 0.0, -2.0f, 1.5f, -1.0f, 2.5f });

        beat::TrackEffect delay;
        delay.id = "sample-rate-matrix-delay";
        delay.kind = beat::TrackEffectKind::Delay;
        delay.params.push_back({ "timeMs", 18.0f });
        delay.params.push_back({ "feedback", 12.0f });
        delay.params.push_back({ "mix", 18.0f });
        project.tracks.front().effects.push_back(std::move(delay));

        constexpr int samples = 4096;
        for (double sampleRate : { 44100.0, 48000.0, 96000.0 })
        {
            auto live = renderOfflineChunks(project, samples, 256, sampleRate);

            auto exportFile = juce::File("/private/tmp").getChildFile(
                "BeatBackendStress-sample-rate-matrix-" + juce::String((int) sampleRate) + ".wav");
            if (exportFile.existsAsFile())
                exportFile.deleteFile();

            juce::String error;
            if (!beat::AudioEngine::renderProjectToWav(project, exportFile, sampleRate, 256, 2, &error))
            {
                std::cerr << "Sample-rate matrix export error at " << sampleRate << ": " << error << "\n";
                return false;
            }

            auto exported = readWavPrefix(exportFile, samples);
            exportFile.deleteFile();

            if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
                return false;

            double sumAbsDiff = 0.0;
            float maxAbsDiff = 0.0f;
            double liveEnergy = 0.0;
            for (int ch = 0; ch < live.getNumChannels(); ++ch)
            {
                for (int i = 0; i < samples; ++i)
                {
                    const float liveSample = live.getSample(ch, i);
                    const float exportSample = exported.getSample(ch, i);
                    if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                        return false;

                    const float diff = std::abs(liveSample - exportSample);
                    maxAbsDiff = std::max(maxAbsDiff, diff);
                    sumAbsDiff += diff;
                    liveEnergy += (double) liveSample * (double) liveSample;
                }
            }

            const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
            const bool ok = liveEnergy > 0.0001
                && maxAbsDiff <= 0.00008f
                && meanAbsDiff <= 0.00002;
            if (!ok)
            {
                std::cerr << "Sample-rate matrix failed at " << sampleRate
                          << " liveEnergy=" << liveEnergy
                          << " maxAbsDiff=" << maxAbsDiff
                          << " meanAbsDiff=" << meanAbsDiff << "\n";
                return false;
            }
        }

        return true;
    }

    bool stressAudioEngineSampleLiveExportParity()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-parity-source.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto project = makeSampleLoopOfflineProject(sampleFile, true, false);
        project.lengthBeats = 2.0;

        constexpr int samples = 12000;
        auto live = renderOfflineChunks(project, samples, 256);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-sample-live-export-parity.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Sample live/export parity export error: " << error << "\n";
            sampleFile.deleteFile();
            return false;
        }

        auto exported = readWavPrefix(exportFile, samples);
        sampleFile.deleteFile();
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
            return false;

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        return liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
    }

    bool stressAudioEngineMixedLiveExportParity()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-mixed-sample.wav");
        auto clipFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-mixed-clip.wav");
        if (!writeAudioClipFixture(sampleFile) || !writeAudioClipFixture(clipFile))
            return false;

        auto project = makeMixedRenderProject(sampleFile, clipFile);
        constexpr int samples = 44100;
        auto live = renderOfflineChunks(project, samples, 256);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-mixed-live-export-parity.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Mixed live/export parity export error: " << error << "\n";
            sampleFile.deleteFile();
            clipFile.deleteFile();
            return false;
        }

        auto exported = readWavPrefix(exportFile, samples);
        sampleFile.deleteFile();
        clipFile.deleteFile();
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
            return false;

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        const bool ok = liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
        if (!ok)
            std::cerr << "Mixed live/export parity liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        return ok;
    }

    bool stressDecentSamplerFixtureImportAndPlayback()
    {
        const auto archiveFile = juce::File("/Users/alexcheng/Downloads/samples/109689_PercussionPalette_joshuameltzer_DecentSampler.zip");
        if (!archiveFile.existsAsFile())
        {
            std::cerr << "Decent fixture pack not present; skipping local fixture import/playback stress\n";
            return true;
        }

        auto extractedRoot = juce::File("/private/tmp").getChildFile("BeatBackendStress-decent-import");
        if (extractedRoot.exists())
            extractedRoot.deleteRecursively();
        if (!extractedRoot.createDirectory())
        {
            std::cerr << "Decent fixture temp root creation failed\n";
            return false;
        }

        const auto presetFile = beat::resolveDecentSamplerPreset(archiveFile, extractedRoot);
        if (!presetFile.existsAsFile())
        {
            extractedRoot.deleteRecursively();
            std::cerr << "Decent fixture .dspreset not found after extraction\n";
            return false;
        }

        const auto preset = beat::parseDecentSamplerPreset(presetFile);
        if (!preset)
        {
            extractedRoot.deleteRecursively();
            std::cerr << "Decent fixture parse failed\n";
            return false;
        }

        if (preset->samples.empty() || preset->sampleUrls.isEmpty())
        {
            extractedRoot.deleteRecursively();
            std::cerr << "Decent fixture produced no playable zones\n";
            return false;
        }

        auto project = makeDecentFixtureProject(*preset);
        const auto live = renderOfflineChunks(project, 44100, 256);
        const double liveEnergy = bufferEnergy(live);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-decent-fixture.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        const bool exportedOk = beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error);
        const double exportEnergy = exportedOk ? wavEnergy(exportFile) : std::numeric_limits<double>::quiet_NaN();

        if (exportFile.existsAsFile())
            exportFile.deleteFile();
        extractedRoot.deleteRecursively();

        const bool ok = std::isfinite(liveEnergy)
            && std::isfinite(exportEnergy)
            && liveEnergy > 0.0001
            && exportEnergy > 0.0001;
        if (!ok)
        {
            std::cerr << "Decent fixture playback failed liveEnergy=" << liveEnergy
                      << " exportEnergy=" << exportEnergy
                      << " exportError=" << error << "\n";
        }
        return ok;
    }

    bool stressDecentSamplerSyntheticMetadata()
    {
        const auto tempRoot = juce::File("/private/tmp")
            .getChildFile("BeatBackendStress-decent-synthetic-" + juce::String(juce::Time::getMillisecondCounterHiRes(), 0));
        if (tempRoot.exists())
            tempRoot.deleteRecursively();
        if (!tempRoot.createDirectory())
        {
            std::cerr << "Synthetic DecentSampler metadata stress failed: temp root creation failed "
                      << tempRoot.getFullPathName() << "\n";
            return false;
        }

        const auto resources = tempRoot.getChildFile("Resources");
        const auto samples = tempRoot.getChildFile("Samples");
        if (!resources.createDirectory() || !samples.createDirectory())
        {
            std::cerr << "Synthetic DecentSampler metadata stress failed: fixture folder creation failed\n";
            tempRoot.deleteRecursively();
            return false;
        }

        const auto imageFile = resources.getChildFile("bg.png");
        {
            juce::Image image(juce::Image::RGB, 2, 2, true);
            image.clear(image.getBounds(), juce::Colours::black);
            juce::PNGImageFormat png;
            auto output = imageFile.createOutputStream();
            if (output == nullptr || !png.writeImageToStream(image, *output))
            {
                std::cerr << "Synthetic DecentSampler metadata stress failed: png write failed\n";
                tempRoot.deleteRecursively();
                return false;
            }
        }

        const auto sampleFile = samples.getChildFile("hit.wav");
        {
            constexpr double sampleRate = 44100.0;
            constexpr int sampleCount = 22050;
            juce::AudioBuffer<float> buffer(1, sampleCount);
            for (int i = 0; i < sampleCount; ++i)
                buffer.setSample(0, i, 0.25f * std::sin((float) i * 0.013f));

            juce::WavAudioFormat wavFormat;
            auto output = sampleFile.createOutputStream();
            std::unique_ptr<juce::AudioFormatWriter> writer(
                wavFormat.createWriterFor(output.get(), sampleRate, 1, 16, {}, 0));
            if (writer == nullptr)
            {
                std::cerr << "Synthetic DecentSampler metadata stress failed: wav writer unavailable\n";
                tempRoot.deleteRecursively();
                return false;
            }
            output.release();
            if (!writer->writeFromAudioSampleBuffer(buffer, 0, sampleCount))
            {
                std::cerr << "Synthetic DecentSampler metadata stress failed: wav write failed\n";
                tempRoot.deleteRecursively();
                return false;
            }
        }

        const auto presetFile = tempRoot.getChildFile("SyntheticStress.dspreset");
        const auto xml = juce::String(R"xml(<?xml version="1.0" encoding="UTF-8"?>
<DecentSampler name="Synthetic Stress">
  <ui bgImage="Resources/bg.png" width="812" height="375">
    <labeled-knob x="19" y="80" width="108" height="108" label="tone" type="float" minValue="220" maxValue="22000" value="18000">
      <binding type="effect" level="instrument" position="0" parameter="FX_FILTER_FREQUENCY"/>
    </labeled-knob>
  </ui>
  <effects>
    <effect type="lowpass_4pl" position="0" frequency="18000.0" resonance="0.25"/>
  </effects>
  <groups>
    <group>
      <sample path="Samples/hit.wav" rootNote="36" loNote="35" hiNote="37" loVel="1" hiVel="127" loLength="0.1" hiLength="0.9" start="128" end="1024" seqPosition="2" chokeGroup="4" oneShot="true"/>
    </group>
  </groups>
</DecentSampler>
)xml");
        if (!presetFile.replaceWithText(xml))
        {
            std::cerr << "Synthetic DecentSampler metadata stress failed: preset write failed\n";
            tempRoot.deleteRecursively();
            return false;
        }

        const auto preset = beat::parseDecentSamplerPreset(presetFile);
        const auto hasToneFilterControl = preset
            ? std::any_of(preset->uiControlDetails.begin(), preset->uiControlDetails.end(), [] (const beat::DecentSamplerUiControl& control)
                {
                    if (!control.label.equalsIgnoreCase("tone"))
                        return false;

                    return std::any_of(control.bindings.begin(), control.bindings.end(), [] (const beat::DecentSamplerUiBinding& binding)
                        {
                            return binding.parameter.equalsIgnoreCase("FX_FILTER_FREQUENCY");
                        });
                })
            : false;

        const bool sampleOk = preset && preset->samples.size() == 1
            && preset->samples.front().path.endsWith("Samples/hit.wav")
            && preset->samples.front().oneShot
            && preset->samples.front().chokeGroup == 4
            && preset->samples.front().seqPosition == 2
            && std::abs(preset->samples.front().durationSeconds - 0.5) < 0.01
            && std::abs(preset->samples.front().loLengthSeconds - 0.1) < 0.0001
            && std::abs(preset->samples.front().hiLengthSeconds - 0.9) < 0.0001
            && preset->samples.front().startSample == 128
            && preset->samples.front().endSample == 1024;
        const bool uiOk = preset
            && preset->name == "Synthetic Stress"
            && preset->uiWidth == 812
            && preset->uiHeight == 375
            && juce::File(preset->uiImagePath).existsAsFile()
            && hasToneFilterControl;
        const bool effectsOk = preset
            && preset->effects.size() == 1
            && preset->effects.front().type == "lowpass_4pl"
            && preset->effects.front().position == 0
            && std::abs(preset->effects.front().frequency - 18000.0) < 0.001
            && std::abs(preset->effects.front().resonance - 0.25) < 0.001;

        const auto fallbackPresetFile = tempRoot.getChildFile("SyntheticFallbackStress.dspreset");
        const auto fallbackXml = juce::String(R"xml(<?xml version="1.0" encoding="UTF-8"?>
<DecentSampler name="Synthetic Fallback Stress">
  <ui width="640" height="320">
    <labeled-knob x="20" y="20" width="96" height="96" label="release" type="float" minValue="0" maxValue="3" value="1">
      <binding type="amp" level="instrument" position="0" parameter="ENV_RELEASE"/>
    </labeled-knob>
  </ui>
  <groups>
    <group>
      <sample path="Samples/hit.wav" rootNote="36"/>
    </group>
  </groups>
</DecentSampler>
)xml");
        const bool fallbackWritten = fallbackPresetFile.replaceWithText(fallbackXml);
        const auto fallbackPreset = fallbackWritten ? beat::parseDecentSamplerPreset(fallbackPresetFile) : std::nullopt;
        const bool fallbackUiOk = fallbackPreset
            && fallbackPreset->uiWidth == 640
            && fallbackPreset->uiHeight == 320
            && juce::File(fallbackPreset->uiImagePath).existsAsFile()
            && juce::File(fallbackPreset->uiImagePath) == imageFile;

        if (!sampleOk || !uiOk || !effectsOk || !fallbackUiOk)
        {
            std::cerr << "Synthetic DecentSampler metadata stress failed"
                      << " parsed=" << (preset.has_value() ? 1 : 0)
                      << " samples=" << (preset ? (int) preset->samples.size() : 0)
                      << " duration=" << (preset && !preset->samples.empty() ? preset->samples.front().durationSeconds : 0.0)
                      << " lengthRange=" << (preset && !preset->samples.empty()
                          ? juce::String(preset->samples.front().loLengthSeconds) + "-" + juce::String(preset->samples.front().hiLengthSeconds)
                          : juce::String())
                      << " ui=" << (preset ? juce::String(preset->uiWidth) + "x" + juce::String(preset->uiHeight) : juce::String())
                      << " hasToneFilterControl=" << hasToneFilterControl
                      << " effects=" << (preset ? (int) preset->effects.size() : 0)
                      << " fallbackUiOk=" << fallbackUiOk
                      << " fallbackImage=" << (fallbackPreset ? fallbackPreset->uiImagePath : juce::String())
                      << "\n";
        }

        tempRoot.deleteRecursively();
        return sampleOk && uiOk && effectsOk && fallbackUiOk;
    }

    bool stressDecentSamplerLorenzoUiMetadata()
    {
        const auto archiveFile = juce::File("/Users/alexcheng/Downloads/samples/283049_LorenzosDrums_LorenzoWood_v1_DecentSampler.zip");
        if (!archiveFile.existsAsFile())
        {
            std::cerr << "Decent Lorenzo fixture pack not present; skipping UI metadata stress\n";
            return true;
        }

        auto extractedRoot = juce::File("/private/tmp").getChildFile("BeatBackendStress-decent-lorenzo-ui");
        if (extractedRoot.exists())
            extractedRoot.deleteRecursively();
        if (!extractedRoot.createDirectory())
        {
            std::cerr << "Decent Lorenzo temp root creation failed\n";
            return false;
        }

        const auto presetFile = beat::resolveDecentSamplerPreset(archiveFile, extractedRoot);
        const auto preset = presetFile.existsAsFile() ? beat::parseDecentSamplerPreset(presetFile) : std::nullopt;
        const auto hasToneFilterControl = preset
            ? std::any_of(preset->uiControlDetails.begin(), preset->uiControlDetails.end(), [] (const beat::DecentSamplerUiControl& control)
                {
                    if (!control.label.equalsIgnoreCase("tone"))
                        return false;

                    return std::any_of(control.bindings.begin(), control.bindings.end(), [] (const beat::DecentSamplerUiBinding& binding)
                        {
                            return binding.parameter.equalsIgnoreCase("FX_FILTER_FREQUENCY");
                        });
                })
            : false;
        double maxVolumeDb = 0.0;
        int maxSeqPosition = 0;
        bool hasLowpassEffect = false;
        bool hasReverbEffect = false;
        if (preset)
        {
            for (const auto& sample : preset->samples)
            {
                maxVolumeDb = juce::jmax(maxVolumeDb, sample.volumeDb);
                maxSeqPosition = juce::jmax(maxSeqPosition, sample.seqPosition);
            }

            for (const auto& effect : preset->effects)
            {
                if (effect.type.containsIgnoreCase("lowpass") && effect.frequency > 10000.0)
                    hasLowpassEffect = true;
                if (effect.type.containsIgnoreCase("reverb") && effect.roomSize > 0.5 && effect.damping > 0.0)
                    hasReverbEffect = true;
            }
        }
        const bool ok = preset.has_value()
            && preset->samples.size() > 32
            && preset->sampleUrls.size() > 32
            && preset->uiImagePath.isNotEmpty()
            && juce::File(preset->uiImagePath).existsAsFile()
            && preset->uiWidth > 0
            && preset->uiHeight > 0
            && preset->uiControls.size() >= 3
            && preset->uiControlDetails.size() >= 3
            && preset->effects.size() >= 2
            && hasLowpassEffect
            && hasReverbEffect
            && hasToneFilterControl
            && maxVolumeDb > 10.0
            && maxSeqPosition > 0;

        if (!ok)
        {
            std::cerr << "Decent Lorenzo UI metadata parse failed"
                      << " preset=" << presetFile.getFullPathName()
                      << " samples=" << (preset ? (int) preset->samples.size() : 0)
                      << " urls=" << (preset ? preset->sampleUrls.size() : 0)
                      << " uiImage=" << (preset ? preset->uiImagePath : juce::String())
                      << " ui=" << (preset ? juce::String(preset->uiWidth) + "x" + juce::String(preset->uiHeight) : juce::String())
                      << " controls=" << (preset ? preset->uiControls.size() : 0)
                      << " controlDetails=" << (preset ? (int) preset->uiControlDetails.size() : 0)
                      << " effects=" << (preset ? (int) preset->effects.size() : 0)
                      << " lowpass=" << hasLowpassEffect
                      << " reverb=" << hasReverbEffect
                      << " hasToneFilterControl=" << hasToneFilterControl
                      << " maxVolumeDb=" << maxVolumeDb
                      << " maxSeqPosition=" << maxSeqPosition
                      << "\n";
        }

        extractedRoot.deleteRecursively();
        return ok;
    }

    bool stressDecentSamplerLorenzoImportAndPlayback()
    {
        const auto archiveFile = juce::File("/Users/alexcheng/Downloads/samples/283049_LorenzosDrums_LorenzoWood_v1_DecentSampler.zip");
        if (!archiveFile.existsAsFile())
        {
            std::cerr << "Decent Lorenzo fixture pack not present; skipping import/playback stress\n";
            return true;
        }

        auto extractedRoot = juce::File("/private/tmp").getChildFile("BeatBackendStress-decent-lorenzo-playback");
        if (extractedRoot.exists())
            extractedRoot.deleteRecursively();
        if (!extractedRoot.createDirectory())
        {
            std::cerr << "Decent Lorenzo playback temp root creation failed\n";
            return false;
        }

        const auto presetFile = beat::resolveDecentSamplerPreset(archiveFile, extractedRoot);
        const auto preset = presetFile.existsAsFile() ? beat::parseDecentSamplerPreset(presetFile) : std::nullopt;
        if (!preset)
        {
            extractedRoot.deleteRecursively();
            std::cerr << "Decent Lorenzo playback parse failed preset=" << presetFile.getFullPathName() << "\n";
            return false;
        }

        auto project = makeDecentFixtureProject(*preset);
        project.name = "Lorenzo DecentSampler Playback";
        project.instruments.front().id = "lorenzo-ds-kit";
        project.instruments.front().kind = "sampler";
        project.tracks.front().instrumentId = "lorenzo-ds-kit";
        project.tracks.front().segments.front().instrumentId = "lorenzo-ds-kit";
        for (auto& note : project.tracks.front().segments.front().notes)
            note.instrumentId = "lorenzo-ds-kit";

        const auto live = renderOfflineChunks(project, 44100, 256);
        const double liveEnergy = bufferEnergy(live);
        const float livePeak = bufferPeak(live);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-lorenzo-ds-fixture.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        const bool exportedOk = beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error);
        const double exportEnergy = exportedOk ? wavEnergy(exportFile) : std::numeric_limits<double>::quiet_NaN();

        if (exportFile.existsAsFile())
            exportFile.deleteFile();
        extractedRoot.deleteRecursively();

        const bool ok = preset->samples.size() >= 128
            && std::isfinite(liveEnergy)
            && std::isfinite(exportEnergy)
            && liveEnergy > 0.0001
            && exportEnergy > 0.0001
            && livePeak > 0.0005f
            && livePeak <= 1.0f;
        if (!ok)
        {
            std::cerr << "Decent Lorenzo playback failed samples=" << (int) preset->samples.size()
                      << " liveEnergy=" << liveEnergy
                      << " livePeak=" << livePeak
                      << " exportEnergy=" << exportEnergy
                      << " exportError=" << error << "\n";
        }
        return ok;
    }

    bool stressDecentSamplerHovefluteImportAndPlayback()
    {
        const auto archiveFile = juce::File("/Users/alexcheng/Downloads/samples/1043_Hoveflute_StefingoUnosson_DS.zip");
        if (!archiveFile.existsAsFile())
        {
            std::cerr << "Decent Hoveflute fixture pack not present; skipping import/playback stress\n";
            return true;
        }

        auto extractedRoot = juce::File("/private/tmp").getChildFile("BeatBackendStress-decent-hoveflute-playback");
        if (extractedRoot.exists())
            extractedRoot.deleteRecursively();
        if (!extractedRoot.createDirectory())
        {
            std::cerr << "Decent Hoveflute playback temp root creation failed\n";
            return false;
        }

        const auto presetFile = beat::resolveDecentSamplerPreset(archiveFile, extractedRoot);
        const auto preset = presetFile.existsAsFile() ? beat::parseDecentSamplerPreset(presetFile) : std::nullopt;
        if (!preset)
        {
            extractedRoot.deleteRecursively();
            std::cerr << "Decent Hoveflute playback parse failed preset=" << presetFile.getFullPathName() << "\n";
            return false;
        }

        bool samplePathsExist = true;
        bool sampleRangesValid = true;
        for (const auto& sample : preset->samples)
        {
            samplePathsExist = samplePathsExist && juce::File(sample.path).existsAsFile();
            sampleRangesValid = sampleRangesValid
                && sample.rootNote >= 0
                && sample.rootNote <= 127
                && sample.loNote >= 0
                && sample.hiNote <= 127
                && sample.loVel >= 0
                && sample.hiVel <= 127
                && sample.loNote <= sample.hiNote
                && sample.loVel <= sample.hiVel;
        }

        const bool uiImageExists = juce::File(preset->uiImagePath).existsAsFile();

        auto project = makeDecentFixtureProject(*preset);
        project.name = "Hoveflute DecentSampler Playback";

        const auto live = renderOfflineChunks(project, 44100, 256);
        const double liveEnergy = bufferEnergy(live);
        const float livePeak = bufferPeak(live);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-hoveflute-ds-fixture.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        const bool exportedOk = beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 256, 2, &error);
        const double exportEnergy = exportedOk ? wavEnergy(exportFile) : std::numeric_limits<double>::quiet_NaN();

        if (exportFile.existsAsFile())
            exportFile.deleteFile();
        extractedRoot.deleteRecursively();

        const bool ok = preset->samples.size() >= 8
            && preset->sampleUrls.size() >= 8
            && preset->uiImagePath.isNotEmpty()
            && uiImageExists
            && preset->uiWidth > 0
            && preset->uiHeight > 0
            && !presetFile.getFullPathName().containsIgnoreCase(juce::File::getSeparatorString() + "__MACOSX" + juce::File::getSeparatorString())
            && samplePathsExist
            && sampleRangesValid
            && std::isfinite(liveEnergy)
            && std::isfinite(exportEnergy)
            && liveEnergy > 0.0001
            && exportEnergy > 0.0001
            && livePeak > 0.0005f
            && livePeak <= 1.0f;
        if (!ok)
        {
            std::cerr << "Decent Hoveflute playback failed preset=" << presetFile.getFullPathName()
                      << " samples=" << (int) preset->samples.size()
                      << " urls=" << preset->sampleUrls.size()
                      << " uiImage=" << preset->uiImagePath
                      << " ui=" << juce::String(preset->uiWidth) + "x" + juce::String(preset->uiHeight)
                      << " uiImageExists=" << uiImageExists
                      << " samplePathsExist=" << samplePathsExist
                      << " sampleRangesValid=" << sampleRangesValid
                      << " liveEnergy=" << liveEnergy
                      << " livePeak=" << livePeak
                      << " exportEnergy=" << exportEnergy
                      << " exportError=" << error << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAudioClipOfflineExport()
    {
        auto clipFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-export-source.wav");
        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-export.wav");
        if (!writeAudioClipFixture(clipFile))
            return false;
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(makeAudioClipOfflineProject(clipFile), exportFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Audio clip export error: " << error << "\n";
            return false;
        }

        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(exportFile));
        if (reader == nullptr || reader->lengthInSamples <= 0)
            return false;

        juce::AudioBuffer<float> buffer((int) reader->numChannels, (int) juce::jmin<juce::int64>(reader->lengthInSamples, 44100));
        reader->read(&buffer, 0, buffer.getNumSamples(), 0, true, true);

        double energy = 0.0;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            for (int i = 0; i < buffer.getNumSamples(); ++i)
            {
                const float sample = buffer.getSample(ch, i);
                if (!std::isfinite(sample))
                    return false;
                energy += (double) sample * (double) sample;
            }
        }

        clipFile.deleteFile();
        exportFile.deleteFile();
        return energy > 0.0001;
    }

    bool stressAudioEngineAudioClipFadeEnvelope()
    {
        auto clipFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-fade-source.wav");
        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-fade-export.wav");
        if (!writeAudioClipFixture(clipFile))
            return false;
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        const int samples = 22050;
        const auto dry = renderOfflineChunks(makeAudioClipFadeProject(clipFile, 0.0, 0.0), samples, 256);
        const auto faded = renderOfflineChunks(makeAudioClipFadeProject(clipFile, 0.5, 0.5), samples, 256);

        const double dryHead = bufferWindowEnergy(dry, 1024, 4096);
        const double fadedHead = bufferWindowEnergy(faded, 1024, 4096);
        const double dryTail = bufferWindowEnergy(dry, samples - 5120, 4096);
        const double fadedTail = bufferWindowEnergy(faded, samples - 5120, 4096);
        const double fadedTotal = bufferEnergy(faded);

        juce::String error;
        const bool exportedOk = beat::AudioEngine::renderProjectToWav(
            makeAudioClipFadeProject(clipFile, 0.5, 0.5),
            exportFile,
            44100.0,
            256,
            2,
            &error);
        const double exportTotal = exportedOk ? wavEnergy(exportFile) : std::numeric_limits<double>::quiet_NaN();

        clipFile.deleteFile();
        exportFile.deleteFile();

        const bool ok = std::isfinite(dryHead)
            && std::isfinite(fadedHead)
            && std::isfinite(dryTail)
            && std::isfinite(fadedTail)
            && std::isfinite(fadedTotal)
            && std::isfinite(exportTotal)
            && dryHead > 0.0001
            && dryTail > 0.0001
            && fadedTotal > 0.0001
            && exportTotal > 0.0001
            && fadedHead < dryHead * 0.75
            && fadedTail < dryTail * 0.75;

        if (!ok)
        {
            std::cerr << "Audio clip fade envelope failed dryHead=" << dryHead
                      << " fadedHead=" << fadedHead
                      << " dryTail=" << dryTail
                      << " fadedTail=" << fadedTail
                      << " fadedTotal=" << fadedTotal
                      << " exportTotal=" << exportTotal
                      << " exportError=" << error << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAudioClipOverlongFadeNormalization()
    {
        auto clipFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-overlong-fade-source.wav");
        if (!writeAudioClipFixture(clipFile))
            return false;

        constexpr int samples = 22050;
        constexpr int blockSize = 191;
        const auto normalized = renderOfflineChunks(makeAudioClipFadeProject(clipFile, 0.5, 0.5), samples, blockSize);
        const auto overlong = renderOfflineChunks(makeAudioClipFadeProject(clipFile, 0.9, 0.9), samples, blockSize);
        clipFile.deleteFile();

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double overlongEnergy = 0.0;
        for (int ch = 0; ch < normalized.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float normalizedSample = normalized.getSample(ch, i);
                const float overlongSample = overlong.getSample(ch, i);
                if (!std::isfinite(normalizedSample) || !std::isfinite(overlongSample))
                    return false;

                const float diff = std::abs(normalizedSample - overlongSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                overlongEnergy += (double) overlongSample * (double) overlongSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (normalized.getNumChannels() * samples);
        const bool ok = overlongEnergy > 0.0001
            && maxAbsDiff <= 0.000001f
            && meanAbsDiff <= 0.0000001;
        if (!ok)
        {
            std::cerr << "Audio clip overlong fade normalization failed energy=" << overlongEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAudioClipFadeLiveExportParity()
    {
        auto clipFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-fade-parity-source.wav");
        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-fade-parity.wav");
        if (!writeAudioClipFixture(clipFile))
            return false;
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        constexpr int samples = 22050;
        constexpr int blockSize = 257;
        auto project = makeAudioClipFadeProject(clipFile, 0.25, 0.35);
        const auto live = renderOfflineChunks(project, samples, blockSize);

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, blockSize, 2, &error))
        {
            std::cerr << "Audio clip fade parity export error: " << error << "\n";
            clipFile.deleteFile();
            return false;
        }

        const auto exported = readWavPrefix(exportFile, samples);
        clipFile.deleteFile();
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
        {
            std::cerr << "Audio clip fade parity channel/sample mismatch liveChannels=" << live.getNumChannels()
                      << " exportedChannels=" << exported.getNumChannels()
                      << " exportedSamples=" << exported.getNumSamples() << "\n";
            return false;
        }

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        const bool ok = liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
        if (!ok)
        {
            std::cerr << "Audio clip fade live/export parity failed liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAudioClipCrossfadeLiveExportParity()
    {
        auto clipFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-crossfade-parity-source.wav");
        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-crossfade-parity.wav");
        if (!writeAudioClipFixture(clipFile))
            return false;
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        constexpr int samples = 33075;
        constexpr int blockSize = 257;
        auto project = makeAudioClipCrossfadeProject(clipFile);
        const auto live = renderOfflineChunks(project, samples, blockSize);

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, blockSize, 2, &error))
        {
            std::cerr << "Audio clip crossfade parity export error: " << error << "\n";
            clipFile.deleteFile();
            return false;
        }

        const auto exported = readWavPrefix(exportFile, samples);
        clipFile.deleteFile();
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
        {
            std::cerr << "Audio clip crossfade parity channel/sample mismatch liveChannels=" << live.getNumChannels()
                      << " exportedChannels=" << exported.getNumChannels()
                      << " exportedSamples=" << exported.getNumSamples() << "\n";
            return false;
        }

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        const bool ok = liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
        if (!ok)
        {
            std::cerr << "Audio clip crossfade live/export parity failed liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAudioClipTrimLiveExportParity()
    {
        auto clipFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-trim-parity-source.wav");
        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-clip-trim-parity.wav");
        if (!writeAudioClipFixture(clipFile))
            return false;
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        constexpr int samples = 16538;
        constexpr int blockSize = 257;
        auto project = makeAudioClipTrimProject(clipFile);
        const auto live = renderOfflineChunks(project, samples, blockSize);

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, blockSize, 2, &error))
        {
            std::cerr << "Audio clip trim parity export error: " << error << "\n";
            clipFile.deleteFile();
            return false;
        }

        const auto exported = readWavPrefix(exportFile, samples);
        clipFile.deleteFile();
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
        {
            std::cerr << "Audio clip trim parity channel/sample mismatch liveChannels=" << live.getNumChannels()
                      << " exportedChannels=" << exported.getNumChannels()
                      << " exportedSamples=" << exported.getNumSamples() << "\n";
            return false;
        }

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        const bool ok = liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
        if (!ok)
        {
            std::cerr << "Audio clip trim live/export parity failed liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineMasterLimiter()
    {
        auto project = makeTinyOfflineProject();
        auto& track = project.tracks.front();
        track.gainDb = 36.0f;

        auto& instrument = project.instruments.front();
        instrument.ampLevel = 1.0f;
        instrument.drive01 = 0.65f;

        project.eqAutomation.push_back({ 0.0, 18.0f, 18.0f, 18.0f, 18.0f });

        const auto live = renderOfflineChunks(project, 8192, 257);
        const float livePeak = bufferPeak(live);
        const double liveEnergy = bufferEnergy(live);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-master-limiter.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        const bool exportedOk = beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, 257, 2, &error);
        const auto exported = exportedOk ? readWavPrefix(exportFile, 8192) : juce::AudioBuffer<float> {};
        const float exportPeak = exportedOk ? bufferPeak(exported) : std::numeric_limits<float>::quiet_NaN();
        exportFile.deleteFile();

        constexpr float ceilingWithQuantizationTolerance = 0.968f;
        const bool ok = exportedOk
            && std::isfinite(livePeak)
            && std::isfinite(exportPeak)
            && std::isfinite(liveEnergy)
            && liveEnergy > 0.001
            && livePeak <= ceilingWithQuantizationTolerance
            && exportPeak <= ceilingWithQuantizationTolerance;
        if (!ok)
        {
            std::cerr << "Master limiter stress failed livePeak=" << livePeak
                      << " exportPeak=" << exportPeak
                      << " liveEnergy=" << liveEnergy
                      << " exportedOk=" << exportedOk
                      << " error=" << error << "\n";
        }
        return ok;
    }

    bool stressAudioEngineMasterChainCompressor()
    {
        auto dryProject = makeTinyOfflineProject();
        auto compressedProject = makeTinyOfflineProject();

        dryProject.tracks.front().gainDb = 12.0f;
        compressedProject.tracks.front().gainDb = 12.0f;
        compressedProject.masterChain.compressorEnabled = true;
        compressedProject.masterChain.compressorThresholdDb = -42.0f;
        compressedProject.masterChain.compressorRatio = 16.0f;
        compressedProject.masterChain.compressorAttackMs = 0.5f;
        compressedProject.masterChain.compressorReleaseMs = 220.0f;
        compressedProject.masterChain.compressorMix = 100.0f;

        const auto dry = renderOfflineChunks(dryProject, 16384, 257);
        const auto wet = renderOfflineChunks(compressedProject, 16384, 257);
        const double dryEnergy = bufferEnergy(dry);
        const double wetEnergy = bufferEnergy(wet);
        const float dryPeak = bufferPeak(dry);
        const float wetPeak = bufferPeak(wet);

        double diff = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float wetSample = wet.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(wetSample))
                    return false;
                diff += std::abs((double) drySample - (double) wetSample);
            }
        }

        const bool ok = std::isfinite(dryEnergy)
            && std::isfinite(wetEnergy)
            && std::isfinite(dryPeak)
            && std::isfinite(wetPeak)
            && dryEnergy > 0.0001
            && wetEnergy > 0.000001
            && wetEnergy < dryEnergy
            && wetPeak <= dryPeak + 0.0001f
            && diff > 0.01;
        if (!ok)
        {
            std::cerr << "Master chain compressor stress failed dryEnergy=" << dryEnergy
                      << " wetEnergy=" << wetEnergy
                      << " dryPeak=" << dryPeak
                      << " wetPeak=" << wetPeak
                      << " diff=" << diff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineMasterChainBlockContinuity()
    {
        auto sampleFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-master-chain-continuity.wav");
        if (!writeAudioClipFixture(sampleFile))
            return false;

        auto project = makeAudioClipOfflineProject(sampleFile);
        project.tracks.front().effects.clear();
        project.tracks.front().gainDb = 9.0f;
        project.masterChain.inputGainDb = 1.5f;
        project.masterChain.compressorEnabled = true;
        project.masterChain.compressorThresholdDb = -36.0f;
        project.masterChain.compressorRatio = 8.0f;
        project.masterChain.compressorAttackMs = 3.0f;
        project.masterChain.compressorReleaseMs = 180.0f;
        project.masterChain.outputGainDb = -1.0f;

        constexpr int samples = 32768;
        const auto largeBlock = renderOfflineChunks(project, samples, 4096);
        const auto smallBlock = renderOfflineChunks(project, samples, 127);
        sampleFile.deleteFile();

        double meanAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        for (int ch = 0; ch < largeBlock.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float a = largeBlock.getSample(ch, i);
                const float b = smallBlock.getSample(ch, i);
                if (!std::isfinite(a) || !std::isfinite(b))
                    return false;
                const float diff = std::abs(a - b);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                meanAbsDiff += diff;
            }
        }

        meanAbsDiff /= (double) (largeBlock.getNumChannels() * samples);
        const bool ok = bufferEnergy(largeBlock) > 0.0001
            && maxAbsDiff <= 0.001f
            && meanAbsDiff <= 0.000001;
        if (!ok)
        {
            std::cerr << "Master chain block continuity failed maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineSendReturnBus()
    {
        auto dryProject = makeTinyOfflineProject();
        auto sendProject = makeTinyOfflineProject();
        auto mutedProject = makeTinyOfflineProject();

        beat::ReturnBus bus;
        bus.id = "return-a";
        bus.name = "Return A";
        bus.gainDb = 0.0f;
        sendProject.returnBuses.push_back(bus);
        bus.mute = true;
        mutedProject.returnBuses.push_back(bus);

        beat::TrackSend send;
        send.busId = "return-a";
        send.gainDb = -6.0f;
        send.enabled = true;
        sendProject.tracks.front().sends.push_back(send);
        mutedProject.tracks.front().sends.push_back(send);

        const auto dry = renderOfflineChunks(dryProject, 8192, 257);
        const auto wet = renderOfflineChunks(sendProject, 8192, 257);
        const auto muted = renderOfflineChunks(mutedProject, 8192, 257);

        const double dryEnergy = bufferEnergy(dry);
        const double wetEnergy = bufferEnergy(wet);
        const double mutedEnergy = bufferEnergy(muted);

        double mutedDiff = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float mutedSample = muted.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(mutedSample) || !std::isfinite(wet.getSample(ch, i)))
                    return false;
                mutedDiff += std::abs((double) drySample - (double) mutedSample);
            }
        }

        const bool ok = std::isfinite(dryEnergy)
            && std::isfinite(wetEnergy)
            && std::isfinite(mutedEnergy)
            && dryEnergy > 0.0001
            && wetEnergy > dryEnergy * 1.1
            && mutedDiff < 0.00001;
        if (!ok)
        {
            std::cerr << "Send/return bus stress failed dryEnergy=" << dryEnergy
                      << " wetEnergy=" << wetEnergy
                      << " mutedEnergy=" << mutedEnergy
                      << " mutedDiff=" << mutedDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineGroupRouting()
    {
        auto dryProject = makeTinyOfflineProject();
        auto groupedProject = makeTinyOfflineProject();
        auto attenuatedProject = makeTinyOfflineProject();

        beat::Track group;
        group.id = "group-a";
        group.name = "Group A";
        group.kind = beat::TrackKind::Group;
        group.gainDb = 0.0f;

        groupedProject.tracks.front().parentTrackId = group.id;
        groupedProject.tracks.push_back(group);

        group.gainDb = -12.0f;
        attenuatedProject.tracks.front().parentTrackId = group.id;
        attenuatedProject.tracks.push_back(group);

        const auto dry = renderOfflineChunks(dryProject, 8192, 257);
        const auto grouped = renderOfflineChunks(groupedProject, 8192, 257);
        const auto attenuated = renderOfflineChunks(attenuatedProject, 8192, 257);

        double groupedDiff = 0.0;
        for (int ch = 0; ch < dry.getNumChannels(); ++ch)
        {
            for (int i = 0; i < dry.getNumSamples(); ++i)
            {
                const float drySample = dry.getSample(ch, i);
                const float groupedSample = grouped.getSample(ch, i);
                const float attenuatedSample = attenuated.getSample(ch, i);
                if (!std::isfinite(drySample) || !std::isfinite(groupedSample) || !std::isfinite(attenuatedSample))
                    return false;
                groupedDiff += std::abs((double) drySample - (double) groupedSample);
            }
        }

        const double dryEnergy = bufferEnergy(dry);
        const double groupedEnergy = bufferEnergy(grouped);
        const double attenuatedEnergy = bufferEnergy(attenuated);
        const bool ok = std::isfinite(dryEnergy)
            && std::isfinite(groupedEnergy)
            && std::isfinite(attenuatedEnergy)
            && dryEnergy > 0.0001
            && groupedDiff < 0.00001
            && attenuatedEnergy < dryEnergy * 0.15;
        if (!ok)
        {
            std::cerr << "Group routing stress failed dryEnergy=" << dryEnergy
                      << " groupedEnergy=" << groupedEnergy
                      << " attenuatedEnergy=" << attenuatedEnergy
                      << " groupedDiff=" << groupedDiff << "\n";
        }
        return ok;
    }

    bool stressAudioEngineTrackStemExport()
    {
        auto masterFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-master-export.wav");
        auto stemFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-track-stem.wav");
        auto missingStemFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-missing-stem.wav");
        if (masterFile.existsAsFile()) masterFile.deleteFile();
        if (stemFile.existsAsFile()) stemFile.deleteFile();
        if (missingStemFile.existsAsFile()) missingStemFile.deleteFile();

        juce::String error;
        auto project = makeTwoTrackOfflineProject();
        if (!beat::AudioEngine::renderProjectToWav(project, masterFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Master stem fixture export error: " << error << "\n";
            return false;
        }

        error.clear();
        if (!beat::AudioEngine::renderTrackToWav(project, "offline-track-b", stemFile, 44100.0, 256, 2, &error))
        {
            std::cerr << "Track stem export error: " << error << "\n";
            return false;
        }

        juce::String missingError;
        if (beat::AudioEngine::renderTrackToWav(project,
                                                "missing-track",
                                                missingStemFile,
                                                44100.0,
                                                256,
                                                2,
                                                &missingError))
        {
            return false;
        }

        auto liveSoloProject = project;
        for (auto& track : liveSoloProject.tracks)
        {
            const bool isTarget = track.id == "offline-track-b";
            track.solo = isTarget;
            track.mute = !isTarget;
        }

        constexpr int samples = 12000;
        const auto liveStem = renderOfflineChunks(liveSoloProject, samples, 256);
        const auto exportedStem = readWavPrefix(stemFile, samples);
        const double masterEnergy = wavEnergy(masterFile);
        const double stemEnergy = wavEnergy(stemFile);

        masterFile.deleteFile();
        stemFile.deleteFile();
        missingStemFile.deleteFile();

        bool parityOk = exportedStem.getNumChannels() == liveStem.getNumChannels()
            && exportedStem.getNumSamples() >= samples;
        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        if (parityOk)
        {
            for (int ch = 0; ch < liveStem.getNumChannels(); ++ch)
            {
                for (int i = 0; i < samples; ++i)
                {
                    const float liveSample = liveStem.getSample(ch, i);
                    const float exportSample = exportedStem.getSample(ch, i);
                    if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    {
                        parityOk = false;
                        break;
                    }

                    const float diff = std::abs(liveSample - exportSample);
                    maxAbsDiff = std::max(maxAbsDiff, diff);
                    sumAbsDiff += diff;
                    liveEnergy += (double) liveSample * (double) liveSample;
                }
                if (!parityOk)
                    break;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (liveStem.getNumChannels() * samples);
        const bool ok = std::isfinite(masterEnergy)
            && std::isfinite(stemEnergy)
            && masterEnergy > 0.0001
            && stemEnergy > 0.0001
            && std::abs(masterEnergy - stemEnergy) > 0.0001
            && liveEnergy > 0.0001
            && parityOk
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002
            && missingError.isNotEmpty();
        if (!ok)
        {
            std::cerr << "Track stem export stress failed masterEnergy=" << masterEnergy
                      << " stemEnergy=" << stemEnergy
                      << " liveEnergy=" << liveEnergy
                      << " parity=" << parityOk
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff
                      << " missingError=" << missingError << "\n";
        }
        return ok;
    }

    bool stressTrackBouncePlanner()
    {
        auto stemFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-bounce-source.wav");
        auto bouncedFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-bounce-render.wav");
        if (stemFile.existsAsFile()) stemFile.deleteFile();
        if (bouncedFile.existsAsFile()) bouncedFile.deleteFile();

        juce::String error;
        auto project = makeTwoTrackOfflineProject();
        if (!beat::AudioEngine::renderTrackToWav(project, "offline-track-b", stemFile, 44100.0, 256, 2, &error, {}, 24))
        {
            std::cerr << "Track bounce source render failed: " << error << "\n";
            return false;
        }

        juce::WavAudioFormat wavFormat;
        auto input = stemFile.createInputStream();
        std::unique_ptr<juce::AudioFormatReader> reader(input != nullptr
            ? wavFormat.createReaderFor(input.release(), true)
            : nullptr);
        if (reader == nullptr || reader->lengthInSamples <= 0 || reader->sampleRate <= 0.0)
        {
            std::cerr << "Track bounce source reader validation failed\n";
            stemFile.deleteFile();
            return false;
        }

        const double durationSeconds = (double) reader->lengthInSamples / reader->sampleRate;

        beat::TrackBounceSpec spec;
        spec.sourceTrackId = "offline-track-b";
        spec.bouncedTrackId = "offline-track-b-bounced";
        spec.audioFileId = "offline-track-b-bounce-audio";
        spec.segmentId = "offline-track-b-bounce-segment";
        spec.audioFileName = "Offline Track B Bounce";
        spec.audioFilePath = stemFile.getFullPathName();
        spec.durationSeconds = durationSeconds;
        spec.sampleRate = reader->sampleRate;
        spec.startBeat = 0.0;

        const auto originalTrackCount = project.tracks.size();
        const auto originalAudioFileCount = project.audioFiles.size();
        auto result = beat::applyTrackBounce(project, spec, &error);
        if (!result.has_value())
        {
            std::cerr << "Track bounce planner failed: " << error << "\n";
            stemFile.deleteFile();
            return false;
        }

        const auto sourceTrackIt = std::find_if(project.tracks.begin(),
                                                project.tracks.end(),
                                                [](const beat::Track& track) { return track.id == "offline-track-b"; });
        const auto bouncedTrackIt = std::find_if(project.tracks.begin(),
                                                 project.tracks.end(),
                                                 [](const beat::Track& track) { return track.id == "offline-track-b-bounced"; });
        const auto audioFileIt = std::find_if(project.audioFiles.begin(),
                                              project.audioFiles.end(),
                                              [](const beat::AudioFileAsset& audioFile)
                                              {
                                                  return audioFile.id == "offline-track-b-bounce-audio";
                                              });

        bool duplicateRejected = false;
        {
            juce::String duplicateError;
            auto staged = project;
            duplicateRejected = !beat::applyTrackBounce(staged, spec, &duplicateError).has_value()
                && duplicateError.isNotEmpty()
                && staged.tracks.size() == project.tracks.size()
                && staged.audioFiles.size() == project.audioFiles.size();
        }

        bool groupedBouncePolicyOk = false;
        {
            auto grouped = makeTwoTrackOfflineProject();
            beat::Track group;
            group.id = "bounce-group";
            group.name = "Bounce Group";
            group.kind = beat::TrackKind::Group;
            group.gainDb = -6.0f;
            grouped.tracks.push_back(group);
            auto source = std::find_if(grouped.tracks.begin(),
                                       grouped.tracks.end(),
                                       [](const beat::Track& track) { return track.id == "offline-track-b"; });
            if (source != grouped.tracks.end())
                source->parentTrackId = group.id;

            beat::TrackBounceSpec groupedSpec = spec;
            groupedSpec.bouncedTrackId = "offline-track-b-group-bounced";
            groupedSpec.audioFileId = "offline-track-b-group-bounce-audio";
            groupedSpec.segmentId = "offline-track-b-group-bounce-segment";
            groupedSpec.preserveParentRouting = false;

            juce::String groupedError;
            const auto directResult = beat::applyTrackBounce(grouped, groupedSpec, &groupedError);
            const auto directBounce = std::find_if(grouped.tracks.begin(),
                                                   grouped.tracks.end(),
                                                   [](const beat::Track& track) { return track.id == "offline-track-b-group-bounced"; });

            auto preserving = makeTwoTrackOfflineProject();
            preserving.tracks.push_back(group);
            auto preservingSource = std::find_if(preserving.tracks.begin(),
                                                 preserving.tracks.end(),
                                                 [](const beat::Track& track) { return track.id == "offline-track-b"; });
            if (preservingSource != preserving.tracks.end())
                preservingSource->parentTrackId = group.id;

            beat::TrackBounceSpec preservingSpec = spec;
            preservingSpec.bouncedTrackId = "offline-track-b-preserved-bounced";
            preservingSpec.audioFileId = "offline-track-b-preserved-bounce-audio";
            preservingSpec.segmentId = "offline-track-b-preserved-bounce-segment";
            preservingSpec.preserveParentRouting = true;

            juce::String preservingError;
            const auto preservedResult = beat::applyTrackBounce(preserving, preservingSpec, &preservingError);
            const auto preservedBounce = std::find_if(preserving.tracks.begin(),
                                                      preserving.tracks.end(),
                                                      [](const beat::Track& track) { return track.id == "offline-track-b-preserved-bounced"; });

            groupedBouncePolicyOk = directResult.has_value()
                && directBounce != grouped.tracks.end()
                && directBounce->parentTrackId.isEmpty()
                && preservedResult.has_value()
                && preservedBounce != preserving.tracks.end()
                && preservedBounce->parentTrackId == group.id;
        }

        const bool modelOk = project.tracks.size() == originalTrackCount + 1
            && project.audioFiles.size() == originalAudioFileCount + 1
            && sourceTrackIt != project.tracks.end()
            && sourceTrackIt->mute
            && !sourceTrackIt->solo
            && bouncedTrackIt != project.tracks.end()
            && bouncedTrackIt->kind == beat::TrackKind::Audio
            && bouncedTrackIt->audioFileId == "offline-track-b-bounce-audio"
            && bouncedTrackIt->segments.size() == 1
            && bouncedTrackIt->segments.front().kind == beat::SegmentPayloadKind::Audio
            && bouncedTrackIt->segments.front().audioFileId == "offline-track-b-bounce-audio"
            && std::abs(bouncedTrackIt->segments.front().lengthBeats - result->lengthBeats) < 0.0001
            && audioFileIt != project.audioFiles.end()
            && std::abs(audioFileIt->durationSeconds - durationSeconds) < 0.0001
            && duplicateRejected
            && groupedBouncePolicyOk;

        error.clear();
        const bool rendered = beat::AudioEngine::renderProjectToWav(project, bouncedFile, 44100.0, 256, 2, &error, {}, 24);
        const double sourceEnergy = wavEnergy(stemFile);
        const double bouncedEnergy = rendered ? wavEnergy(bouncedFile) : 0.0;

        const bool renderOk = rendered
            && std::isfinite(sourceEnergy)
            && std::isfinite(bouncedEnergy)
            && sourceEnergy > 0.0001
            && bouncedEnergy > 0.0001;

        stemFile.deleteFile();
        bouncedFile.deleteFile();

        if (!modelOk || !renderOk)
        {
            std::cerr << "Track bounce planner stress failed modelOk=" << modelOk
                      << " renderOk=" << renderOk
                      << " groupedBouncePolicyOk=" << groupedBouncePolicyOk
                      << " sourceEnergy=" << sourceEnergy
                      << " bouncedEnergy=" << bouncedEnergy
                      << " error=" << error << "\n";
        }

        return modelOk && renderOk;
    }

    bool stressAudioEngineProjectApplyChurn()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 128, 2);

        for (int i = 0; i < 80; ++i)
        {
            auto project = i % 2 == 0 ? makeTinyOfflineProject() : makeTwoTrackOfflineProject();
            project.bpm = 90.0 + (double) (i % 40);
            engine.applyProject(std::move(project));

            if (i % 5 == 0)
                engine.requestRestart();
            else if (i % 5 == 1)
                engine.requestPlay();
            else if (i % 5 == 2)
                engine.requestSeek((double) (i % 4) * 0.125);
            else if (i % 5 == 3)
                engine.requestPause();
            else
                engine.requestStop();

            for (int p = 0; p < 8; ++p)
            {
                if (!engine.queueRealtimeParameterChange("offline-synth", "filter.cutoff", (float) p / 8.0f, p * 2, 32))
                    return false;
            }

            const auto buffer = renderEngineBlock(engine, 512);
            const double energy = bufferEnergy(buffer);
            if (!std::isfinite(energy))
                return false;

            beat::AudioEngine::RenderTimingSnapshot timing;
            engine.pullRenderTimingSnapshot(timing);
        }

        return true;
    }

    bool stressAudioEngineVariableBlockSizes()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 64, 2);
        auto project = makeTwoTrackOfflineProject();

        beat::TrackEffect delay;
        delay.id = "variable-block-delay";
        delay.kind = beat::TrackEffectKind::Delay;
        delay.params.push_back({ "timeMs", 32.0f });
        delay.params.push_back({ "feedback", 20.0f });
        delay.params.push_back({ "mix", 25.0f });
        project.tracks.front().effects.push_back(std::move(delay));

        engine.applyProject(std::move(project));
        engine.requestPlay();

        for (int samples : { 64, 127, 512, 1024, 4096, 8192, 257, 96 })
        {
            const auto buffer = renderEngineBlock(engine, samples);
            const double energy = bufferEnergy(buffer);
            if (!std::isfinite(energy))
                return false;
        }

        return true;
    }

    bool stressAudioEngineDenseAetherRoute()
    {
        beat::AudioEngine engine;
        engine.prepareForOffline(44100.0, 128, 2);
        engine.applyProject(makeDenseAetherProject());
        engine.requestPlay();

        double energy = 0.0;
        float peak = 0.0f;
        int maxSynthVoices = 0;
        int maxRoutes = 0;
        int maxAutomationEvents = 0;
        double maxSynthMs = 0.0;
        double maxRouteFxMs = 0.0;
        double maxTotalMs = 0.0;
        int64_t maxVoiceRenderSamples = 0;
        int64_t maxOscillatorSamples = 0;
        int64_t maxWavetableVoiceSamples = 0;
        int64_t maxFilterSamples = 0;
        int64_t maxFilterDriveSamples = 0;
        int64_t maxFilterCoefficientUpdates = 0;
        int64_t maxModulationSamples = 0;
        int64_t maxRealtimeRampSamples = 0;
        int64_t maxRouteEffectSamples = 0;
        int64_t maxRouteFilterEffectSamples = 0;
        int64_t maxRouteNonlinearEffectSamples = 0;

        for (int block = 0; block < 64; ++block)
        {
            if (block % 4 == 0)
            {
                const float position = 0.2f + (float) (block % 16) / 24.0f;
                if (!engine.queueRealtimeParameterChange("dense-aether", "osc.a.position", position, 0, 96))
                    return false;
                if (!engine.queueRealtimeParameterChange("dense-aether", "filter.cutoff", 0.35f + position * 0.45f, 12, 96))
                    return false;
            }

            const int blockSize = block % 5 == 0 ? 257 : (block % 3 == 0 ? 1024 : 512);
            const auto buffer = renderEngineBlock(engine, blockSize);
            const double blockEnergy = bufferEnergy(buffer);
            const float blockPeak = bufferPeak(buffer);
            if (!std::isfinite(blockEnergy) || !std::isfinite(blockPeak))
                return false;

            energy += blockEnergy;
            peak = juce::jmax(peak, blockPeak);

            beat::AudioEngine::RenderTimingSnapshot timing;
            if (!engine.pullRenderTimingSnapshot(timing))
                return false;
            if (!std::isfinite(timing.synthMs)
                || !std::isfinite(timing.voiceMs)
                || !std::isfinite(timing.modulationMs)
                || !std::isfinite(timing.fxMs)
                || !std::isfinite(timing.filterFxMs)
                || !std::isfinite(timing.totalMs))
                return false;

            maxSynthVoices = juce::jmax(maxSynthVoices, timing.activeSynthVoices);
            maxRoutes = juce::jmax(maxRoutes, timing.routeCount);
            maxAutomationEvents = juce::jmax(maxAutomationEvents, timing.automationEventCount);
            maxSynthMs = juce::jmax(maxSynthMs, timing.synthMs);
            maxRouteFxMs = juce::jmax(maxRouteFxMs, timing.filterFxMs);
            maxTotalMs = juce::jmax(maxTotalMs, timing.totalMs);
            maxVoiceRenderSamples = juce::jmax(maxVoiceRenderSamples, timing.voiceRenderSamples);
            maxOscillatorSamples = juce::jmax(maxOscillatorSamples, timing.oscillatorSamples);
            maxWavetableVoiceSamples = juce::jmax(maxWavetableVoiceSamples, timing.wavetableVoiceSamples);
            maxFilterSamples = juce::jmax(maxFilterSamples, timing.filterSamples);
            maxFilterDriveSamples = juce::jmax(maxFilterDriveSamples, timing.filterDriveSamples);
            maxFilterCoefficientUpdates = juce::jmax(maxFilterCoefficientUpdates, timing.filterCoefficientUpdates);
            maxModulationSamples = juce::jmax(maxModulationSamples, timing.modulationSamples);
            maxRealtimeRampSamples = juce::jmax(maxRealtimeRampSamples, timing.realtimeRampSamples);
            maxRouteEffectSamples = juce::jmax(maxRouteEffectSamples, timing.routeEffectSamples);
            maxRouteFilterEffectSamples = juce::jmax(maxRouteFilterEffectSamples, timing.routeFilterEffectSamples);
            maxRouteNonlinearEffectSamples = juce::jmax(maxRouteNonlinearEffectSamples, timing.routeNonlinearEffectSamples);
        }

        const bool ok = energy > 0.01
            && peak > 0.001f
            && peak <= 1.0f
            && maxSynthVoices >= 8
            && maxRoutes >= 1
            && maxAutomationEvents > 0
            && maxSynthMs > 0.0
            && maxRouteFxMs > 0.0
            && maxTotalMs > 0.0
            && maxVoiceRenderSamples > 0
            && maxOscillatorSamples > 0
            && maxWavetableVoiceSamples > 0
            && maxFilterSamples > 0
            && maxFilterDriveSamples > 0
            && maxFilterCoefficientUpdates > 0
            && maxModulationSamples > 0
            && maxRealtimeRampSamples > 0
            && maxRouteEffectSamples > 0
            && maxRouteFilterEffectSamples > 0
            && maxRouteNonlinearEffectSamples > 0;
        if (!ok)
        {
            std::cerr << "Dense Aether route stress failed energy=" << energy
                      << " peak=" << peak
                      << " voices=" << maxSynthVoices
                      << " routes=" << maxRoutes
                      << " automation=" << maxAutomationEvents
                      << " synthMs=" << maxSynthMs
                      << " routeFxMs=" << maxRouteFxMs
                      << " totalMs=" << maxTotalMs
                      << " voiceSamples=" << maxVoiceRenderSamples
                      << " oscSamples=" << maxOscillatorSamples
                      << " wtSamples=" << maxWavetableVoiceSamples
                      << " filterSamples=" << maxFilterSamples
                      << " filterDriveSamples=" << maxFilterDriveSamples
                      << " filterCoeffUpdates=" << maxFilterCoefficientUpdates
                      << " modSamples=" << maxModulationSamples
                      << " rampSamples=" << maxRealtimeRampSamples
                      << " routeFxSamples=" << maxRouteEffectSamples
                      << " routeFilterSamples=" << maxRouteFilterEffectSamples
                      << " routeNonlinearSamples=" << maxRouteNonlinearEffectSamples << "\n";
        }
        return ok;
    }

    bool stressAudioEngineMaxUnisonAetherPolyphony()
    {
        beat::AudioEngine engine;
        constexpr int blockSize = 512;
        engine.prepareForOffline(44100.0, blockSize, 2);
        engine.applyProject(makeMaxUnisonAetherProject());
        engine.requestPlay();

        double energy = 0.0;
        float peak = 0.0f;
        int maxSynthVoices = 0;
        int maxAutomationEvents = 0;
        int64_t maxVoiceRenderSamples = 0;
        int64_t maxWavetableVoiceSamples = 0;
        int64_t maxFilterSamples = 0;
        int64_t maxModulationSamples = 0;
        double maxSynthMs = 0.0;
        double maxTotalMs = 0.0;

        for (int block = 0; block < 40; ++block)
        {
            if (block % 6 == 0)
            {
                if (!engine.queueRealtimeParameterChange("max-unison-aether",
                                                         "unison.detune",
                                                         10.0f + (float) (block % 12),
                                                         0,
                                                         128))
                    return false;
                if (!engine.queueRealtimeParameterChange("max-unison-aether",
                                                         "osc.b.position",
                                                         0.25f + (float) (block % 10) * 0.05f,
                                                         32,
                                                         160))
                    return false;
            }

            const auto buffer = renderEngineBlock(engine, blockSize);
            const double blockEnergy = bufferEnergy(buffer);
            const float blockPeak = bufferPeak(buffer);
            if (!std::isfinite(blockEnergy) || !std::isfinite(blockPeak))
                return false;

            energy += blockEnergy;
            peak = juce::jmax(peak, blockPeak);

            beat::AudioEngine::RenderTimingSnapshot timing;
            if (!engine.pullRenderTimingSnapshot(timing))
                return false;
            if (!std::isfinite(timing.synthMs)
                || !std::isfinite(timing.voiceMs)
                || !std::isfinite(timing.modulationMs)
                || !std::isfinite(timing.totalMs))
                return false;

            maxSynthVoices = juce::jmax(maxSynthVoices, timing.activeSynthVoices);
            maxAutomationEvents = juce::jmax(maxAutomationEvents, timing.automationEventCount);
            maxVoiceRenderSamples = juce::jmax(maxVoiceRenderSamples, timing.voiceRenderSamples);
            maxWavetableVoiceSamples = juce::jmax(maxWavetableVoiceSamples, timing.wavetableVoiceSamples);
            maxFilterSamples = juce::jmax(maxFilterSamples, timing.filterSamples);
            maxModulationSamples = juce::jmax(maxModulationSamples, timing.modulationSamples);
            maxSynthMs = juce::jmax(maxSynthMs, timing.synthMs);
            maxTotalMs = juce::jmax(maxTotalMs, timing.totalMs);
        }

        const int64_t expectedVoiceSamples = (int64_t) blockSize * 12;
        const int64_t expectedWavetableWork = expectedVoiceSamples * 8;
        const bool ok = energy > 0.01
            && peak > 0.001f
            && peak <= 1.0f
            && maxSynthVoices >= 12
            && maxAutomationEvents > 0
            && maxVoiceRenderSamples >= expectedVoiceSamples
            && maxWavetableVoiceSamples >= expectedWavetableWork
            && maxFilterSamples >= expectedVoiceSamples * 2
            && maxModulationSamples > 0
            && maxSynthMs > 0.0
            && maxTotalMs > 0.0;
        if (!ok)
        {
            std::cerr << "Max-unison Aether polyphony stress failed energy=" << energy
                      << " peak=" << peak
                      << " voices=" << maxSynthVoices
                      << " automation=" << maxAutomationEvents
                      << " voiceSamples=" << maxVoiceRenderSamples
                      << " wtSamples=" << maxWavetableVoiceSamples
                      << " filterSamples=" << maxFilterSamples
                      << " modSamples=" << maxModulationSamples
                      << " synthMs=" << maxSynthMs
                      << " totalMs=" << maxTotalMs << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAetherVoiceLimit()
    {
        auto project = makeMaxUnisonAetherProject();
        project.id = "limited-voice-aether-project";
        project.instruments.front().maxVoices = 4;

        beat::AudioEngine engine;
        constexpr int blockSize = 512;
        engine.prepareForOffline(44100.0, blockSize, 2);
        engine.applyProject(project);
        engine.requestPlay();

        double energy = 0.0;
        int maxSynthVoices = 0;
        int maxAutomationEvents = 0;

        for (int block = 0; block < 18; ++block)
        {
            const auto buffer = renderEngineBlock(engine, blockSize);
            energy += bufferEnergy(buffer);

            beat::AudioEngine::RenderTimingSnapshot timing;
            if (!engine.pullRenderTimingSnapshot(timing))
                return false;
            if (!std::isfinite(timing.synthMs) || !std::isfinite(timing.totalMs))
                return false;

            maxSynthVoices = juce::jmax(maxSynthVoices, timing.activeSynthVoices);
            maxAutomationEvents = juce::jmax(maxAutomationEvents, timing.automationEventCount);
        }

        const bool ok = energy > 0.01 && maxSynthVoices > 0 && maxSynthVoices <= 4 && maxAutomationEvents > 0;
        if (!ok)
        {
            std::cerr << "Aether voice-limit stress failed energy=" << energy
                      << " voices=" << maxSynthVoices
                      << " automation=" << maxAutomationEvents << "\n";
        }
        return ok;
    }

    bool stressAudioEngineAetherMonoVoiceLimit()
    {
        auto project = makeMaxUnisonAetherProject();
        project.id = "mono-voice-aether-project";
        project.instruments.front().maxVoices = 12;
        project.instruments.front().mono = true;
        project.instruments.front().legato = true;

        beat::AudioEngine engine;
        constexpr int blockSize = 512;
        engine.prepareForOffline(44100.0, blockSize, 2);
        engine.applyProject(project);
        engine.requestPlay();

        double energy = 0.0;
        int maxSynthVoices = 0;

        for (int block = 0; block < 18; ++block)
        {
            const auto buffer = renderEngineBlock(engine, blockSize);
            energy += bufferEnergy(buffer);

            beat::AudioEngine::RenderTimingSnapshot timing;
            if (!engine.pullRenderTimingSnapshot(timing))
                return false;
            if (!std::isfinite(timing.synthMs) || !std::isfinite(timing.totalMs))
                return false;

            maxSynthVoices = juce::jmax(maxSynthVoices, timing.activeSynthVoices);
        }

        const bool ok = energy > 0.01 && maxSynthVoices > 0 && maxSynthVoices <= 1;
        if (!ok)
        {
            std::cerr << "Aether mono voice-limit stress failed energy=" << energy
                      << " voices=" << maxSynthVoices << "\n";
        }
        return ok;
    }

    bool stressAudioEngineDenseAetherLiveExportParity()
    {
        auto project = makeDenseAetherProject();
        project.eqAutomation.push_back({ 0.0, -1.5f, 1.0f, -0.5f, 1.5f });
        project.eqAutomation.push_back({ 4.0, 1.0f, -1.0f, 0.75f, -1.25f });

        constexpr int samples = 12000;
        constexpr int blockSize = 257;
        auto live = renderOfflineChunks(project, samples, blockSize);

        auto exportFile = juce::File("/private/tmp").getChildFile("BeatBackendStress-dense-aether-parity.wav");
        if (exportFile.existsAsFile())
            exportFile.deleteFile();

        juce::String error;
        if (!beat::AudioEngine::renderProjectToWav(project, exportFile, 44100.0, blockSize, 2, &error))
        {
            std::cerr << "Dense Aether parity export error: " << error << "\n";
            return false;
        }

        auto exported = readWavPrefix(exportFile, samples);
        exportFile.deleteFile();

        if (exported.getNumChannels() != live.getNumChannels() || exported.getNumSamples() < samples)
            return false;

        double sumAbsDiff = 0.0;
        float maxAbsDiff = 0.0f;
        double liveEnergy = 0.0;
        for (int ch = 0; ch < live.getNumChannels(); ++ch)
        {
            for (int i = 0; i < samples; ++i)
            {
                const float liveSample = live.getSample(ch, i);
                const float exportSample = exported.getSample(ch, i);
                if (!std::isfinite(liveSample) || !std::isfinite(exportSample))
                    return false;

                const float diff = std::abs(liveSample - exportSample);
                maxAbsDiff = std::max(maxAbsDiff, diff);
                sumAbsDiff += diff;
                liveEnergy += (double) liveSample * (double) liveSample;
            }
        }

        const double meanAbsDiff = sumAbsDiff / (double) (live.getNumChannels() * samples);
        const bool ok = liveEnergy > 0.0001
            && maxAbsDiff <= 0.00008f
            && meanAbsDiff <= 0.00002;
        if (!ok)
        {
            std::cerr << "Dense Aether live/export parity failed liveEnergy=" << liveEnergy
                      << " maxAbsDiff=" << maxAbsDiff
                      << " meanAbsDiff=" << meanAbsDiff << "\n";
        }
        return ok;
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

        {
            const auto shape = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Saw, 0.8f, beat::WavetableWarpMode::Shape, 8, 2048);
            const auto fold = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Saw, 0.8f, beat::WavetableWarpMode::Fold, 8, 2048);
            const auto pinch = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Saw, 0.8f, beat::WavetableWarpMode::Pinch, 8, 2048);
            double foldDiff = 0.0;
            double pinchDiff = 0.0;
            for (int i = 0; i < 2048; i += 8)
            {
                foldDiff += std::abs(shape.getSample(7, i) - fold.getSample(7, i));
                pinchDiff += std::abs(shape.getSample(7, i) - pinch.getSample(7, i));
            }
            if (foldDiff <= 0.01 || pinchDiff <= 0.01)
                return false;
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
                { 0.12f, 0.04f, 0.0f, 0.06f, 0.04f, -0.24f, -0.55f, 0.18f, 0.0f },
                { 0.38f, 0.18f, 0.2f, 0.22f, 0.12f, -0.08f, -0.15f, 0.36f, 0.25f },
                { 0.66f, 0.55f, 0.42f, 0.48f, 0.28f, 0.18f, 0.3f, 0.58f, -0.16f },
                { 0.95f, 0.86f, 0.68f, 0.62f, 0.42f, 0.32f, 0.62f, 0.74f, 0.36f },
            }};
            const auto custom = beat::WavetableFactory::createCustom(frames, 8, 2048);
            const auto smoothCustom = beat::WavetableFactory::createCustom(frames, true, 8, 2048);
            const auto morphedCustom = beat::WavetableFactory::createCustom(frames, 0.0f, beat::WavetableWarpMode::Shape, false, 0.95f, 8, 2048);
            if (!custom.isValid() || custom.getFrameCount() != 8 || custom.getFrameSize() != 2048)
                return false;
            if (!smoothCustom.isValid() || smoothCustom.getFrameCount() != custom.getFrameCount() || smoothCustom.getFrameSize() != custom.getFrameSize())
                return false;
            if (!morphedCustom.isValid() || morphedCustom.getFrameCount() != custom.getFrameCount() || morphedCustom.getFrameSize() != custom.getFrameSize())
                return false;

            double interpolationDiff = 0.0;
            constexpr int probeFrame = 3;
            for (int i = 0; i < custom.getFrameSize(); ++i)
            {
                const float linear = custom.getSample(probeFrame, i);
                const float smooth = smoothCustom.getSample(probeFrame, i);
                if (!std::isfinite(linear) || !std::isfinite(smooth))
                    return false;
                interpolationDiff += std::abs((double) linear - (double) smooth);
            }
            if (interpolationDiff / (double) custom.getFrameSize() < 0.0004)
                return false;

            double morphDiff = 0.0;
            for (int i = 0; i < custom.getFrameSize(); ++i)
            {
                const float linear = custom.getSample(probeFrame, i);
                const float morphed = morphedCustom.getSample(probeFrame, i);
                if (!std::isfinite(linear) || !std::isfinite(morphed))
                    return false;
                morphDiff += std::abs((double) linear - (double) morphed);
            }
            if (morphDiff / (double) custom.getFrameSize() < 0.0002)
                return false;

            auto flatTiltFrames = frames;
            for (auto& frame : flatTiltFrames)
                frame.tilt = 0.0f;
            const auto untiltedCustom = beat::WavetableFactory::createCustom(flatTiltFrames, 8, 2048);
            double tiltDiff = 0.0;
            for (int i = 0; i < custom.getFrameSize(); ++i)
                tiltDiff += std::abs((double) custom.getSample(probeFrame, i) - (double) untiltedCustom.getSample(probeFrame, i));
            if (tiltDiff / (double) custom.getFrameSize() < 0.0004)
                return false;

            auto flatFocusFrames = frames;
            for (auto& frame : flatFocusFrames)
                frame.focus = 0.0f;
            const auto unfocusedCustom = beat::WavetableFactory::createCustom(flatFocusFrames, 8, 2048);
            double focusDiff = 0.0;
            for (int i = 0; i < custom.getFrameSize(); ++i)
                focusDiff += std::abs((double) custom.getSample(probeFrame, i) - (double) unfocusedCustom.getSample(probeFrame, i));
            if (focusDiff / (double) custom.getFrameSize() < 0.0004)
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
            "osc.a.warp": 0.58,
            "osc.a.warpMode": "fold",
            "osc.a.octave": -1,
            "osc.a.semitone": 12,
            "osc.a.fine": 7,
            "osc.a.level": 0.7,
            "osc.a.pan": -0.4,
            "osc.a.phase": 0.33,
            "osc.a.randomPhase": 0.2,
            "osc.b.enabled": true,
            "osc.b.wavetable": "basic.triangle",
            "osc.b.position": 0.1,
            "osc.b.warp": 0.36,
            "osc.b.warpMode": "pinch",
            "osc.b.octave": 1,
            "osc.b.semitone": 7,
            "osc.b.fine": -5,
            "osc.b.level": 0.3,
            "osc.b.pan": 0.2,
            "osc.b.phase": 0.66,
            "osc.b.randomPhase": 0.1,
            "unison.enabled": true,
            "unison.voices": 5,
            "unison.detune": 0.2,
            "unison.blend": 0.6,
            "unison.spread": 0.4,
            "maxVoices": 6,
            "mono.enabled": true,
            "legato.enabled": true,
            "filter.enabled": true,
            "filter.type": "highpass",
            "filter.cutoff": 1000,
            "filter.keytrack": 0.62,
            "filter.resonance": 0.2,
            "filter.drive": 0.35,
            "env.1.attack": 0.01,
            "env.1.attackCurve": "exp",
            "env.1.decay": 0.2,
            "env.1.decayCurve": "s-curve",
            "env.1.sustain": 0.55,
            "env.1.release": 0.4,
            "env.1.releaseCurve": "log",
            "env.1.loop": true,
            "env.2.attack": 0.01,
            "env.2.attackCurve": "exp",
            "env.2.decay": 0.09,
            "env.2.decayCurve": "s-curve",
            "env.2.sustain": 0.0,
            "env.2.release": 0.16,
            "env.2.releaseCurve": "log",
            "env.2.loop": true,
            "amp.level": 0.7,
            "amp.pan": -0.25,
            "lfo.1.enabled": true,
            "lfo.1.shape": "square",
            "lfo.1.rate": 6.5,
            "lfo.1.sync": true,
            "lfo.1.syncedRate": "1/8",
            "lfo.1.smoothing": 0.35,
            "lfo.1.randomPhase": 0.42,
            "lfo.1.phase": 0.25,
            "lfo.1.retrigger": false,
            "lfo.1.oneShot": true,
            "lfo.2.enabled": true,
            "lfo.2.shape": "triangle",
            "lfo.2.rate": 0.75,
            "lfo.2.sync": true,
            "lfo.2.syncedRate": "1/2",
            "lfo.2.smoothing": 0.6,
            "lfo.2.randomPhase": 0.25,
            "lfo.2.phase": 0.5,
            "lfo.2.retrigger": true,
            "lfo.2.oneShot": false
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
            { "source": "lfo.2", "target": "osc.b.pan", "amount": 0.44, "bipolar": false, "enabled": true },
            { "source": "lfo.1", "target": "unison.spread", "amount": 0.33, "bipolar": false, "enabled": true },
            { "source": "env.1", "target": "filter.drive", "amount": 0.22, "enabled": true },
            { "source": "env.2", "target": "filter.resonance", "amount": 0.2, "enabled": true },
            { "source": "keytrack", "target": "osc.a.level", "amount": 0.2, "enabled": true },
            { "source": "modWheel", "target": "amp.pan", "amount": 0.35, "bipolar": true, "enabled": true },
            { "source": "lfo.1", "target": "filter.cutoff", "amount": -0.2, "bipolar": false, "enabled": true },
            { "source": "lfo.1", "target": "filter.cutoff", "amount": 1.0, "enabled": false },
            { "source": "env.1", "target": "filter.cutoff", "amount": 0.3, "enabled": true },
            { "source": "velocity", "target": "amp.level", "amount": 0.25, "bipolar": false, "enabled": true }
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
        if (instrument.maxVoices != 6)
            return false;
        if (!instrument.mono || !instrument.legato)
            return false;
        if (!instrument.aether.oscA.enabled || instrument.aether.oscA.wavetable.bank != 4)
            return false;
        if (!near(instrument.aether.oscA.wavetable.position, 0.45f) || instrument.aether.oscA.wavetable.unison != 5)
            return false;
        if (!near(instrument.aether.oscA.wavetable.warp, 0.58f) || instrument.aether.oscA.wavetable.warpMode != 1)
            return false;
        if (!near(instrument.aether.oscA.pan, -0.3f))
            return false;
        if (!near(instrument.aether.oscA.phase, 0.33f) || !near(instrument.aether.oscA.randomPhase, 0.2f))
            return false;
        if (!instrument.aether.oscB.enabled || instrument.aether.oscB.wavetable.bank != 3)
            return false;
        if (!near(instrument.aether.oscB.wavetable.warp, 0.36f) || instrument.aether.oscB.wavetable.warpMode != 2)
            return false;
        if (!near(instrument.aether.oscB.level, 0.7f) || !near(instrument.aether.oscB.wavetable.position, 0.0f))
            return false;
        if (!near(instrument.aether.oscB.pan, 0.0f))
            return false;
        if (!near(instrument.aether.oscB.phase, 0.66f) || !near(instrument.aether.oscB.randomPhase, 0.1f))
            return false;
        if (instrument.aether.oscB.octave != 1 || instrument.aether.oscB.semitone != 7 || !near(instrument.aether.oscB.fineCents, 15.0f))
            return false;
        if (instrument.filterType != 2 || instrument.cutoff01 < 0.55f || instrument.cutoff01 > 0.7f)
            return false;
        if (!near(instrument.filterKeytrack, 0.62f))
            return false;
        if (!near(instrument.resonance01, 0.4f) || !near(instrument.drive01, 0.35f))
            return false;
        if (!near(instrument.attackMs, 10.0f) || !near(instrument.decayMs, 200.0f))
            return false;
        if (!near(instrument.sustain, 0.55f) || !near(instrument.releaseMs, 400.0f))
            return false;
        if (instrument.attackCurve != 1 || instrument.decayCurve != 3 || instrument.releaseCurve != 2)
            return false;
        if (!instrument.env1Loop)
            return false;
        if (!near(instrument.env2AttackMs, 10.0f) || !near(instrument.env2DecayMs, 90.0f) || !near(instrument.env2Sustain, 0.0f) || !near(instrument.env2ReleaseMs, 160.0f))
            return false;
        if (instrument.env2AttackCurve != 1 || instrument.env2DecayCurve != 3 || instrument.env2ReleaseCurve != 2)
            return false;
        if (!instrument.env2Loop)
            return false;
        if (!near(instrument.ampLevel, 0.54f) || !near(instrument.ampPan, 0.0f))
            return false;
        if (instrument.lfoWaveform != 3 || !near(instrument.lfoRateHz, 6.5f) || !near(instrument.lfoPhaseOffset, 0.25f))
            return false;
        if (!instrument.lfoSync || instrument.lfoSyncedRate != "1/8")
            return false;
        if (!near(instrument.lfoSmoothing, 0.35f))
            return false;
        if (!near(instrument.lfoRandomPhase, 0.42f))
            return false;
        if (instrument.lfoRetrigger)
            return false;
        if (!instrument.lfoOneShot)
            return false;
        if (!instrument.lfo2Enabled || instrument.lfo2Waveform != 1 || !near(instrument.lfo2RateHz, 0.75f) || !near(instrument.lfo2PhaseOffset, 0.5f))
            return false;
        if (!instrument.lfo2Sync || instrument.lfo2SyncedRate != "1/2")
            return false;
        if (!near(instrument.lfo2Smoothing, 0.6f))
            return false;
        if (!near(instrument.lfo2RandomPhase, 0.25f))
            return false;
        if (!instrument.lfo2Retrigger)
            return false;
        if (instrument.lfo2OneShot)
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
        if (!near(instrument.dynamicModulation.oscBPan.lfo2, 0.44f) || instrument.dynamicModulation.oscBPan.lfo2Bipolar)
            return false;
        if (!near(instrument.dynamicModulation.filterCutoff.lfo, -0.2f) || !near(instrument.dynamicModulation.filterCutoff.env, 0.3f))
            return false;
        if (!near(instrument.dynamicModulation.unisonSpread.lfo, 0.33f) || instrument.dynamicModulation.unisonSpread.lfoBipolar)
            return false;
        if (instrument.dynamicModulation.filterCutoff.lfoBipolar || instrument.dynamicModulation.filterCutoff.envBipolar)
            return false;
        if (!near(instrument.dynamicModulation.filterDrive.env, 0.22f))
            return false;
        if (!near(instrument.dynamicModulation.filterResonance.env2, 0.2f) || instrument.dynamicModulation.filterResonance.env2Bipolar)
            return false;
        if (!near(instrument.dynamicModulation.oscALevel.keytrack, 0.2f) || instrument.dynamicModulation.oscALevel.keytrackBipolar)
            return false;
        if (!near(instrument.dynamicModulation.ampPan.modWheel, 0.35f) || !instrument.dynamicModulation.ampPan.modWheelBipolar)
            return false;
        if (!near(instrument.dynamicModulation.ampLevel.velocity, 0.25f) || instrument.dynamicModulation.ampLevel.velocityBipolar)
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
	                "interpolation": "smooth",
	                "morph": 0.62,
	                "frames": [
	                  { "brightness": 0.12, "even": 0.04, "fold": 0.0, "formant": 0.06, "notch": 0.04, "skew": -0.24, "tilt": -0.55, "focus": 0.18, "phase": 0.0, "partials": [0.82, 0.12, 0.0, 0.36] },
	                  { "brightness": 0.38, "even": 0.18, "fold": 0.2, "formant": 0.22, "notch": 0.12, "skew": -0.08, "tilt": -0.15, "focus": 0.36, "phase": 0.25, "partials": [0.22, 0.74, 0.18, 0.0, 0.46] },
	                  { "brightness": 0.66, "even": 0.55, "fold": 0.42, "formant": 0.48, "notch": 0.28, "skew": 0.18, "tilt": 0.3, "focus": 0.58, "phase": -0.16, "partials": [0.0, 0.18, 0.68, 0.1, 0.0, 0.52] },
	                  { "brightness": 0.95, "even": 0.86, "fold": 0.68, "formant": 0.62, "notch": 0.42, "skew": 0.32, "tilt": 0.62, "focus": 0.74, "phase": 0.36, "partials": [0.08, 0.0, 0.22, 0.64, 0.18, 0.0, 0.44] }
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
	        if (!customInstrument.aether.oscA.wavetable.smoothInterpolation)
	            return false;
	        if (!near(customInstrument.aether.oscA.wavetable.morph, 0.62f))
	            return false;
	        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].formant, 0.48f))
	            return false;
	        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].notch, 0.28f))
	            return false;
	        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].partials[2], 0.68f))
	            return false;
	        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].skew, 0.18f))
            return false;
        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].tilt, 0.3f))
            return false;
        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].focus, 0.58f))
            return false;
        if (!near(customInstrument.aether.oscA.wavetable.customFrames[2].phase, -0.16f))
            return false;

        const auto macroPatch = juce::JSON::parse(R"json(
        {
          "instrumentType": "wavetable-synth",
          "parameters": {
            "osc.a.enabled": true,
            "osc.a.wavetable": "basic.saw",
            "amp.level": 0.4,
            "macro.1": 0.5
          },
          "metadata": {
            "macros": {
              "macro.1": { "id": "macro.1", "label": "Brightness", "min": 0.2, "max": 0.8, "curve": "ease-in" }
            }
          },
          "modulation": [
            { "source": "macro.1", "target": "amp.level", "amount": 0.5, "enabled": true }
          ]
        }
        )json");

        beat::InstrumentDefinition macroInstrument;
        if (!beat::applySynthPatchContract(macroPatch, macroInstrument))
            return false;
        if (!near(macroInstrument.ampLevel, 0.575f))
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

        auto linearAttackParams = params;
        linearAttackParams.attackMs = 200.0f;
        linearAttackParams.attackCurve = 0;
        linearAttackParams.sustain = 1.0f;
        auto expAttackParams = linearAttackParams;
        expAttackParams.attackCurve = 1;
        auto linearAttack = render(linearAttackParams);
        auto expAttack = render(expAttackParams);
        double linearAttackEnergy = 0.0;
        double expAttackEnergy = 0.0;
        for (int channel = 0; channel < linearAttack.getNumChannels(); ++channel)
        {
            for (int i = 0; i < 1200; ++i)
            {
                const auto linearSample = (double) linearAttack.getSample(channel, i);
                const auto expSample = (double) expAttack.getSample(channel, i);
                linearAttackEnergy += linearSample * linearSample;
                expAttackEnergy += expSample * expSample;
            }
        }
        if (!(expAttackEnergy < linearAttackEnergy * 0.85))
            return false;

        auto keytrackClosedParams = params;
        keytrackClosedParams.filterType = 0;
        keytrackClosedParams.cutoff01 = 0.24f;
        keytrackClosedParams.filterKeytrack = 0.0f;
        keytrackClosedParams.wavetableUnison = 1;
        auto keytrackOpenParams = keytrackClosedParams;
        keytrackOpenParams.filterKeytrack = 1.0f;
        auto renderHighNote = [](const beat::InstrumentVoice::Params& renderParams) {
            beat::InstrumentVoice voice;
            voice.prepare(44100.0, 256);
            voice.setParams(renderParams);
            voice.startNote(84, 1.0f, nullptr, 0);

            juce::AudioBuffer<float> buffer(2, 4096);
            buffer.clear();
            voice.renderNextBlock(buffer, 0, buffer.getNumSamples());
            voice.stopNote(0.0f, false);
            return buffer;
        };
        auto keytrackClosed = renderHighNote(keytrackClosedParams);
        auto keytrackOpen = renderHighNote(keytrackOpenParams);
        double keytrackClosedEnergy = 0.0;
        double keytrackOpenEnergy = 0.0;
        for (int channel = 0; channel < keytrackClosed.getNumChannels(); ++channel)
        {
            for (int i = 0; i < keytrackClosed.getNumSamples(); ++i)
            {
                const auto closedSample = (double) keytrackClosed.getSample(channel, i);
                const auto openSample = (double) keytrackOpen.getSample(channel, i);
                keytrackClosedEnergy += closedSample * closedSample;
                keytrackOpenEnergy += openSample * openSample;
            }
        }
        if (!(keytrackOpenEnergy > keytrackClosedEnergy * 1.1))
            return false;

        auto renderWithVelocity = [](const beat::InstrumentVoice::Params& renderParams, float velocity, int midiNote = 69, int modWheelValue = 0, int pitchWheelValue = 8192) {
            beat::InstrumentVoice voice;
            voice.prepare(44100.0, 256);
            voice.setParams(renderParams);
            voice.startNote(midiNote, velocity, nullptr, 8192);
            voice.controllerMoved(1, modWheelValue);
            voice.pitchWheelMoved(pitchWheelValue);

            juce::AudioBuffer<float> buffer(2, 4096);
            buffer.clear();
            voice.renderNextBlock(buffer, 0, buffer.getNumSamples());
            voice.stopNote(0.0f, false);
            return buffer;
        };
        auto estimatePositiveCrossingFrequency = [](const juce::AudioBuffer<float>& buffer) {
            int first = -1;
            int last = -1;
            int crossings = 0;
            for (int i = 257; i < buffer.getNumSamples(); ++i)
            {
                if (buffer.getSample(0, i - 1) <= 0.0f && buffer.getSample(0, i) > 0.0f)
                {
                    if (first < 0)
                        first = i;
                    last = i;
                    ++crossings;
                }
            }
            if (crossings < 2 || last <= first)
                return 0.0;
            return ((double) (crossings - 1) * 44100.0) / (double) (last - first);
        };

        auto velocityBaseParams = params;
        velocityBaseParams.ampLevel = 0.08f;
        velocityBaseParams.wavetableUnison = 1;
        auto velocityModParams = velocityBaseParams;
        velocityModParams.dynamicModulation.active = true;
        velocityModParams.dynamicModulation.ampLevel.velocity = 0.75f;
        auto velocityBase = renderWithVelocity(velocityBaseParams, 0.5f);
        auto velocityMod = renderWithVelocity(velocityModParams, 0.5f);
        double velocityBaseEnergy = 0.0;
        double velocityModEnergy = 0.0;
        for (int channel = 0; channel < velocityBase.getNumChannels(); ++channel)
        {
            for (int i = 0; i < velocityBase.getNumSamples(); ++i)
            {
                const auto baseSample = (double) velocityBase.getSample(channel, i);
                const auto modSample = (double) velocityMod.getSample(channel, i);
                if (!std::isfinite(baseSample) || !std::isfinite(modSample))
                    return false;
                velocityBaseEnergy += baseSample * baseSample;
                velocityModEnergy += modSample * modSample;
            }
        }
        if (!(velocityModEnergy > velocityBaseEnergy * 4.0))
            return false;

        auto keytrackModParams = params;
        keytrackModParams.ampLevel = 0.0f;
        keytrackModParams.wavetableUnison = 1;
        keytrackModParams.dynamicModulation.active = true;
        keytrackModParams.dynamicModulation.ampLevel.keytrack = 1.0f;
        auto lowKeytrack = renderWithVelocity(keytrackModParams, 1.0f, 36);
        auto highKeytrack = renderWithVelocity(keytrackModParams, 1.0f, 96);
        double lowKeytrackEnergy = 0.0;
        double highKeytrackEnergy = 0.0;
        for (int channel = 0; channel < lowKeytrack.getNumChannels(); ++channel)
        {
            for (int i = 0; i < lowKeytrack.getNumSamples(); ++i)
            {
                const auto lowSample = (double) lowKeytrack.getSample(channel, i);
                const auto highSample = (double) highKeytrack.getSample(channel, i);
                if (!std::isfinite(lowSample) || !std::isfinite(highSample))
                    return false;
                lowKeytrackEnergy += lowSample * lowSample;
                highKeytrackEnergy += highSample * highSample;
            }
        }
        if (!(highKeytrackEnergy > lowKeytrackEnergy * 3.5))
            return false;

        auto modWheelParams = params;
        modWheelParams.ampLevel = 0.0f;
        modWheelParams.wavetableUnison = 1;
        modWheelParams.dynamicModulation.active = true;
        modWheelParams.dynamicModulation.ampLevel.modWheel = 1.0f;
        auto lowModWheel = renderWithVelocity(modWheelParams, 1.0f, 69, 16);
        auto highModWheel = renderWithVelocity(modWheelParams, 1.0f, 69, 127);
        double lowModWheelEnergy = 0.0;
        double highModWheelEnergy = 0.0;
        for (int channel = 0; channel < lowModWheel.getNumChannels(); ++channel)
        {
            for (int i = 0; i < lowModWheel.getNumSamples(); ++i)
            {
                const auto lowSample = (double) lowModWheel.getSample(channel, i);
                const auto highSample = (double) highModWheel.getSample(channel, i);
                if (!std::isfinite(lowSample) || !std::isfinite(highSample))
                    return false;
                lowModWheelEnergy += lowSample * lowSample;
                highModWheelEnergy += highSample * highSample;
            }
        }
        if (!(highModWheelEnergy > lowModWheelEnergy * 40.0))
            return false;

        auto pitchBendParams = params;
        pitchBendParams.hasAether = true;
        pitchBendParams.waveform = 5;
        pitchBendParams.ampLevel = 0.95f;
        pitchBendParams.ampPan = 0.0f;
        pitchBendParams.attackMs = 1.0f;
        pitchBendParams.decayMs = 10.0f;
        pitchBendParams.sustain = 1.0f;
        pitchBendParams.releaseMs = 20.0f;
        pitchBendParams.filterType = 0;
        pitchBendParams.cutoff01 = 1.0f;
        pitchBendParams.resonance01 = 0.0f;
        pitchBendParams.drive01 = 0.0f;
        pitchBendParams.lfoDepth = 0.0f;
        pitchBendParams.lfoToPitch = 0.0f;
        pitchBendParams.lfoToFilter = 0.0f;
        pitchBendParams.envToFilter = 0.0f;
        pitchBendParams.dynamicModulation.active = false;
        pitchBendParams.pitchBendRangeSemitones = 2.0f;
        pitchBendParams.aetherOscA.enabled = true;
        pitchBendParams.aetherOscA.level = 1.0f;
        pitchBendParams.aetherOscA.pan = 0.0f;
        pitchBendParams.aetherOscA.waveform = 0;
        pitchBendParams.aetherOscA.octave = 0;
        pitchBendParams.aetherOscA.semitone = 0;
        pitchBendParams.aetherOscA.fineCents = 0.0f;
        pitchBendParams.aetherOscA.phase = 0.0f;
        pitchBendParams.aetherOscA.randomPhase = 0.0f;
        pitchBendParams.aetherOscB.enabled = false;
        pitchBendParams.aetherSub.enabled = false;
        pitchBendParams.aetherNoise.enabled = false;
        const auto pitchBase = renderWithVelocity(pitchBendParams, 1.0f, 69, 0, 8192);
        const auto pitchBent = renderWithVelocity(pitchBendParams, 1.0f, 69, 0, 16383);
        const auto pitchBaseHz = estimatePositiveCrossingFrequency(pitchBase);
        const auto pitchBentHz = estimatePositiveCrossingFrequency(pitchBent);
        if (!(pitchBaseHz > 430.0 && pitchBaseHz < 450.0))
            return false;
        const auto bendRatio = pitchBentHz / pitchBaseHz;
        if (!(bendRatio > 1.115 && bendRatio < 1.13))
            return false;

        auto env2ModParams = params;
        env2ModParams.ampLevel = 0.0f;
        env2ModParams.wavetableUnison = 1;
        env2ModParams.env2AttackMs = 1.0f;
        env2ModParams.env2DecayMs = 40.0f;
        env2ModParams.env2Sustain = 0.0f;
        env2ModParams.env2ReleaseMs = 30.0f;
        env2ModParams.dynamicModulation.active = true;
        env2ModParams.dynamicModulation.ampLevel.env2 = 1.0f;
        auto env2Mod = renderWithVelocity(env2ModParams, 1.0f);
        double env2EarlyEnergy = 0.0;
        double env2LateEnergy = 0.0;
        for (int channel = 0; channel < env2Mod.getNumChannels(); ++channel)
        {
            for (int i = 512; i < 2048; ++i)
            {
                const auto sample = (double) env2Mod.getSample(channel, i);
                if (!std::isfinite(sample))
                    return false;
                env2EarlyEnergy += sample * sample;
            }
            for (int i = 6144; i < env2Mod.getNumSamples(); ++i)
            {
                const auto sample = (double) env2Mod.getSample(channel, i);
                if (!std::isfinite(sample))
                    return false;
                env2LateEnergy += sample * sample;
            }
        }
        if (!(env2EarlyEnergy > env2LateEnergy * 9.0))
            return false;

        auto env2LinearAttackParams = env2ModParams;
        env2LinearAttackParams.env2AttackMs = 80.0f;
        env2LinearAttackParams.env2DecayMs = 80.0f;
        env2LinearAttackParams.env2Sustain = 1.0f;
        env2LinearAttackParams.env2AttackCurve = 0;
        auto env2ExpAttackParams = env2LinearAttackParams;
        env2ExpAttackParams.env2AttackCurve = 1;
        auto env2LinearAttack = renderWithVelocity(env2LinearAttackParams, 1.0f);
        auto env2ExpAttack = renderWithVelocity(env2ExpAttackParams, 1.0f);
        double env2LinearAttackEnergy = 0.0;
        double env2ExpAttackEnergy = 0.0;
        for (int channel = 0; channel < env2LinearAttack.getNumChannels(); ++channel)
        {
            for (int i = 512; i < 2048; ++i)
            {
                const auto linearSample = (double) env2LinearAttack.getSample(channel, i);
                const auto expSample = (double) env2ExpAttack.getSample(channel, i);
                if (!std::isfinite(linearSample) || !std::isfinite(expSample))
                    return false;
                env2LinearAttackEnergy += linearSample * linearSample;
                env2ExpAttackEnergy += expSample * expSample;
            }
        }
        if (!(env2ExpAttackEnergy < env2LinearAttackEnergy * 0.7))
            return false;

        auto env2LoopParams = env2ModParams;
        env2LoopParams.env2AttackMs = 15.0f;
        env2LoopParams.env2DecayMs = 40.0f;
        env2LoopParams.env2Sustain = 0.0f;
        env2LoopParams.env2ReleaseMs = 50.0f;
        env2LoopParams.env2Loop = true;
        auto env2NoLoopParams = env2LoopParams;
        env2NoLoopParams.env2Loop = false;
        auto env2LoopRender = renderWithVelocity(env2LoopParams, 1.0f);
        auto env2NoLoopRender = renderWithVelocity(env2NoLoopParams, 1.0f);
        double env2LoopLateEnergy = 0.0;
        double env2NoLoopLateEnergy = 0.0;
        for (int channel = 0; channel < env2LoopRender.getNumChannels(); ++channel)
        {
            for (int i = 2800; i < env2LoopRender.getNumSamples(); ++i)
            {
                const auto loopSample = (double) env2LoopRender.getSample(channel, i);
                const auto noLoopSample = (double) env2NoLoopRender.getSample(channel, i);
                if (!std::isfinite(loopSample) || !std::isfinite(noLoopSample))
                    return false;
                env2LoopLateEnergy += loopSample * loopSample;
                env2NoLoopLateEnergy += noLoopSample * noLoopSample;
            }
        }
        if (!(env2LoopLateEnergy > env2NoLoopLateEnergy * 2.0))
            return false;

        auto env1LoopParams = params;
        env1LoopParams.ampLevel = 1.0f;
        env1LoopParams.attackMs = 15.0f;
        env1LoopParams.decayMs = 40.0f;
        env1LoopParams.sustain = 0.0f;
        env1LoopParams.releaseMs = 50.0f;
        env1LoopParams.env1Loop = true;
        env1LoopParams.dynamicModulation.active = false;
        env1LoopParams.wavetableUnison = 1;
        auto env1NoLoopParams = env1LoopParams;
        env1NoLoopParams.env1Loop = false;
        auto env1LoopRender = renderWithVelocity(env1LoopParams, 1.0f);
        auto env1NoLoopRender = renderWithVelocity(env1NoLoopParams, 1.0f);
        double env1LoopLateEnergy = 0.0;
        double env1NoLoopLateEnergy = 0.0;
        for (int channel = 0; channel < env1LoopRender.getNumChannels(); ++channel)
        {
            for (int i = 2800; i < env1LoopRender.getNumSamples(); ++i)
            {
                const auto loopSample = (double) env1LoopRender.getSample(channel, i);
                const auto noLoopSample = (double) env1NoLoopRender.getSample(channel, i);
                if (!std::isfinite(loopSample) || !std::isfinite(noLoopSample))
                    return false;
                env1LoopLateEnergy += loopSample * loopSample;
                env1NoLoopLateEnergy += noLoopSample * noLoopSample;
            }
        }
        if (!(env1LoopLateEnergy > env1NoLoopLateEnergy * 2.0))
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

        auto oneShotLoopParams = params;
        oneShotLoopParams.lfoDepth = 0.8f;
        oneShotLoopParams.lfoWaveform = 2;
        oneShotLoopParams.lfoRateHz = 24.0f;
        oneShotLoopParams.lfoPhaseOffset = 0.0f;
        oneShotLoopParams.lfoRetrigger = true;
        oneShotLoopParams.lfoOneShot = false;
        auto oneShotLoop = render(oneShotLoopParams);
        auto oneShotHoldParams = oneShotLoopParams;
        oneShotHoldParams.lfoOneShot = true;
        auto oneShotHold = render(oneShotHoldParams);
        double oneShotDiff = 0.0;
        for (int channel = 0; channel < oneShotLoop.getNumChannels(); ++channel)
        {
            for (int i = 0; i < oneShotLoop.getNumSamples(); ++i)
            {
                const float looped = oneShotLoop.getSample(channel, i);
                const float held = oneShotHold.getSample(channel, i);
                if (!std::isfinite(looped) || !std::isfinite(held))
                    return false;
                oneShotDiff += std::abs((double) looped - (double) held);
            }
        }

        if (oneShotDiff <= 0.1)
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

    bool stressInstrumentVoiceBandlimitedBasicOscillators()
    {
        auto render = [] (int waveform)
        {
            beat::InstrumentVoice::Params params;
            params.waveform = waveform;
            params.cutoff01 = 1.0f;
            params.resonance01 = 0.05f;
            params.drive01 = 0.0f;
            params.attackMs = 1.0f;
            params.decayMs = 12.0f;
            params.sustain = 1.0f;
            params.releaseMs = 15.0f;

            beat::InstrumentVoice::consumeRenderWorkStats();
            beat::InstrumentVoice voice;
            voice.prepare(48000.0, 256);
            voice.setParams(params);
            voice.startNote(96, 0.8f, nullptr, 0);

            juce::AudioBuffer<float> buffer(2, 4096);
            buffer.clear();
            voice.renderNextBlock(buffer, 0, buffer.getNumSamples());
            const auto work = beat::InstrumentVoice::consumeRenderWorkStats();
            return std::pair { std::move(buffer), work };
        };

        auto [saw, sawWork] = render(1);
        auto [square, squareWork] = render(2);

        double sawEnergy = 0.0;
        double squareEnergy = 0.0;
        double diff = 0.0;
        float peak = 0.0f;
        for (int channel = 0; channel < saw.getNumChannels(); ++channel)
        {
            for (int sampleIndex = 0; sampleIndex < saw.getNumSamples(); ++sampleIndex)
            {
                const auto sawSample = saw.getSample(channel, sampleIndex);
                const auto squareSample = square.getSample(channel, sampleIndex);
                if (!std::isfinite(sawSample) || !std::isfinite(squareSample))
                    return false;

                peak = std::max({ peak, std::abs(sawSample), std::abs(squareSample) });
                sawEnergy += (double) sawSample * (double) sawSample;
                squareEnergy += (double) squareSample * (double) squareSample;
                diff += std::abs((double) sawSample - (double) squareSample);
            }
        }

        return sawEnergy > 0.001
            && squareEnergy > 0.001
            && diff > 0.1
            && peak < 1.0f
            && sawWork.oscillatorSamples >= saw.getNumSamples()
            && squareWork.oscillatorSamples >= square.getNumSamples()
            && sawWork.wavetableVoiceSamples == 0
            && squareWork.wavetableVoiceSamples == 0
            && sawWork.filterDriveSamples == 0
            && squareWork.filterDriveSamples == 0;
    }

    bool stressInstrumentVoiceLegatoRetune()
    {
        struct RetuneProbe
        {
            double energy { -1.0 };
            float firstSampleAbs { 0.0f };
            float earlyPeakAbs { 0.0f };
        };

        auto renderRetuneProbe = [](bool legato)
        {
            beat::InstrumentVoice::Params params;
            params.waveform = 0;
            params.cutoff01 = 1.0f;
            params.resonance01 = 0.05f;
            params.drive01 = 0.0f;
            params.ampLevel = 0.95f;
            params.attackMs = 220.0f;
            params.decayMs = 20.0f;
            params.sustain = 1.0f;
            params.releaseMs = 20.0f;
            params.glideMs = 24.0f;
            params.legato = legato;

            beat::InstrumentVoice voice;
            voice.prepare(48000.0, 256);
            voice.setParams(params);
            voice.startNote(60, 1.0f, nullptr, 0);

            juce::AudioBuffer<float> warmup(2, 12000);
            warmup.clear();
            voice.renderNextBlock(warmup, 0, warmup.getNumSamples());

            voice.startNote(72, 1.0f, nullptr, 0);
            juce::AudioBuffer<float> retuned(2, 1024);
            retuned.clear();
            voice.renderNextBlock(retuned, 0, retuned.getNumSamples());

            RetuneProbe probe;
            probe.energy = 0.0;
            for (int channel = 0; channel < retuned.getNumChannels(); ++channel)
            {
                for (int sample = 0; sample < retuned.getNumSamples(); ++sample)
                {
                    const float value = retuned.getSample(channel, sample);
                    if (!std::isfinite(value))
                    {
                        probe.energy = -1.0;
                        return probe;
                    }
                    const float absValue = std::abs(value);
                    if (channel == 0 && sample == 0)
                        probe.firstSampleAbs = absValue;
                    if (sample < 32)
                        probe.earlyPeakAbs = std::max(probe.earlyPeakAbs, absValue);
                    probe.energy += (double) value * (double) value;
                }
            }
            return probe;
        };

        const auto retrigger = renderRetuneProbe(false);
        const auto legato = renderRetuneProbe(true);
        return retrigger.energy > 0.0
            && legato.energy > 0.0
            && legato.firstSampleAbs > retrigger.firstSampleAbs * 2.0f
            && retrigger.earlyPeakAbs > legato.earlyPeakAbs * 1.5f;
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

        {
            auto setupParams = params;
            setupParams.aetherOscB.enabled = false;
            setupParams.aetherSub.enabled = false;
            setupParams.aetherNoise.enabled = false;
            setupParams.wavetableBank = 2;
            setupParams.wavetable.position = 0.91f;
            setupParams.wavetable.unison = 8;

            const auto before = beat::InstrumentVoice::getWavetableCacheStats();
            beat::InstrumentVoice voice;
            voice.prepare(48000.0, 256);
            voice.setParams(setupParams);
            const auto after = beat::InstrumentVoice::getWavetableCacheStats();
            const auto cacheAccesses = (after.hits - before.hits) + (after.misses - before.misses);
            if (cacheAccesses != 1)
                return false;
        }

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

        beat::InstrumentVoice::consumeRenderWorkStats();
        auto full = render(params);
        const auto staticWork = beat::InstrumentVoice::consumeRenderWorkStats();
        if (staticWork.oscillatorRateCalculations != 0)
            return false;
        if (staticWork.filterDriveSamples < (int64_t) full.getNumSamples() * 4)
            return false;
        if (staticWork.wavetableFrequencyUpdates > 8 || staticWork.wavetablePositionUpdates > 8)
            return false;
        if (staticWork.aetherOscASamples < (int64_t) full.getNumSamples() * 3
            || staticWork.aetherOscBSamples < (int64_t) full.getNumSamples() * 2
            || staticWork.aetherSubSamples < full.getNumSamples()
            || staticWork.aetherNoiseSamples < full.getNumSamples())
            return false;

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

        auto inertDynamicParams = params;
        inertDynamicParams.dynamicModulation.active = true;
        beat::InstrumentVoice::consumeRenderWorkStats();
        auto inertDynamic = render(inertDynamicParams);
        const auto inertDynamicWork = beat::InstrumentVoice::consumeRenderWorkStats();
        if (inertDynamicWork.modulationSamples != 0 || inertDynamicWork.oscillatorRateCalculations != 0)
            return false;
        double inertDiff = 0.0;
        for (int channel = 0; channel < full.getNumChannels(); ++channel)
        {
            for (int i = 0; i < full.getNumSamples(); ++i)
                inertDiff += std::abs((double) full.getSample(channel, i) - (double) inertDynamic.getSample(channel, i));
        }
        if (inertDiff > 0.000001)
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
        dynamicParams.dynamicModulation.oscAFine.lfo = 0.18f;
        dynamicParams.dynamicModulation.filterResonance.lfo = 0.25f;
        dynamicParams.dynamicModulation.filterResonance.lfoBipolar = false;
        dynamicParams.dynamicModulation.filterDrive.env = 0.22f;
        dynamicParams.dynamicModulation.unisonDetune.lfo = 0.08f;
        dynamicParams.dynamicModulation.unisonDetune.lfoBipolar = false;
        beat::InstrumentVoice::consumeRenderWorkStats();
        auto dynamic = render(dynamicParams);
        const auto dynamicWork = beat::InstrumentVoice::consumeRenderWorkStats();
        if (dynamicWork.oscillatorRateCalculations <= 0)
            return false;
        if (dynamicWork.filterDriveSamples < (int64_t) dynamic.getNumSamples() * 4)
            return false;
        if (dynamicWork.wavetablePositionUpdates <= 0
            || dynamicWork.wavetablePositionUpdates >= dynamicWork.wavetableVoiceSamples)
            return false;
        if (dynamicWork.wavetableFrequencyUpdates <= 0)
            return false;

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
    if (!stressEnvelopeShaper())
    {
        std::cerr << "Envelope shaper stress failed\n";
        return 1;
    }
    if (!stressLfoHelper())
    {
        std::cerr << "LFO helper stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceWavetablePath())
    {
        std::cerr << "Instrument voice wavetable stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceBandlimitedBasicOscillators())
    {
        std::cerr << "Instrument voice bandlimited basic oscillator stress failed\n";
        return 1;
    }
    if (!stressInstrumentVoiceLegatoRetune())
    {
        std::cerr << "Instrument voice legato retune stress failed\n";
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

    std::cerr << "analysis: start\n";
    if (!stressFftAnalyzer())
    {
        std::cerr << "FFT analyzer stress failed\n";
        return 1;
    }
    if (!stressAudioFileAnalyzer())
    {
        std::cerr << "Audio file analyzer stress failed\n";
        return 1;
    }
    std::cerr << "analysis: done\n";

    std::cerr << "sequencer: start\n";
    if (!stressSequencerTransport())
    {
        std::cerr << "Sequencer transport stress failed\n";
        return 1;
    }
    if (!stressSequencerLoopCrossing())
    {
        std::cerr << "Sequencer loop crossing stress failed\n";
        return 1;
    }
    if (!stressSequencerLoopBoundaryScheduling())
    {
        std::cerr << "Sequencer loop boundary scheduling stress failed\n";
        return 1;
    }
    if (!stressSequencerCropsMidiNotesToSegmentLength())
    {
        std::cerr << "Sequencer cropped MIDI note scheduling stress failed\n";
        return 1;
    }
    if (!stressSequencerAutomationMetadata())
    {
        std::cerr << "Sequencer automation metadata stress failed\n";
        return 1;
    }
    if (!stressSequencerGlideMetadata())
    {
        std::cerr << "Sequencer glide metadata stress failed\n";
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
    if (!stressSequencerTrackEffectAutomation())
    {
        std::cerr << "Sequencer track effect automation stress failed\n";
        return 1;
    }
    if (!stressSequencerAutomationCurveCheckpoints())
    {
        std::cerr << "Sequencer automation curve checkpoint stress failed\n";
        return 1;
    }
    if (!stressSequencerTrackMixMetadata())
    {
        std::cerr << "Sequencer track mix metadata stress failed\n";
        return 1;
    }
    if (!stressSequencerAudioClipEvents())
    {
        std::cerr << "Sequencer audio clip event stress failed\n";
        return 1;
    }
    std::cerr << "sequencer: done\n";

    std::cerr << "persistence: start\n";
    if (!stressProjectAssetSidecarPackaging())
    {
        std::cerr << "Project asset sidecar packaging stress failed\n";
        return 1;
    }
    if (!stressProjectIntegrityVerifier())
    {
        std::cerr << "Project integrity verifier stress failed\n";
        return 1;
    }
    if (!stressRecentProjectRepository())
    {
        std::cerr << "Recent project repository stress failed\n";
        return 1;
    }
    if (!stressProjectRepositoryPluginCapabilities())
    {
        std::cerr << "Project repository plugin capability stress failed\n";
        return 1;
    }
    if (!stressProjectRepositoryEffectDefaultsMigration())
    {
        std::cerr << "Project repository effect defaults migration stress failed\n";
        return 1;
    }
    if (!stressProjectRepositoryAudioFileRoundtrip())
    {
        std::cerr << "Project repository audio file roundtrip stress failed\n";
        return 1;
    }
    if (!stressRecordingPlannerAppendTake())
    {
        std::cerr << "Recording planner append-take stress failed\n";
        return 1;
    }
    if (!stressRecordingPlannerLatencyCompensation())
    {
        std::cerr << "Recording planner latency compensation stress failed\n";
        return 1;
    }
    if (!stressRecordingLatencyCalibration())
    {
        std::cerr << "Recording latency calibration stress failed\n";
        return 1;
    }
    if (!stressRecordingSessionPlanner())
    {
        std::cerr << "Recording session planner stress failed\n";
        return 1;
    }
    if (!stressRecordingPlannerCommitCapture())
    {
        std::cerr << "Recording planner commit-capture stress failed\n";
        return 1;
    }
    if (!stressProjectRepositorySampleInstrumentRoundtrip())
    {
        std::cerr << "Project repository sample instrument roundtrip stress failed\n";
        return 1;
    }
    if (!stressProjectDocumentBackup())
    {
        std::cerr << "Project document backup stress failed\n";
        return 1;
    }
    std::cerr << "persistence: done\n";

    std::cerr << "engine: start\n";
    std::cerr << "  track meters\n";
    if (!stressAudioEngineTrackMeters())
    {
        std::cerr << "Audio engine track meter stress failed\n";
        return 1;
    }
    std::cerr << "  track gain/pan render\n";
    if (!stressAudioEngineTrackGainPanRender())
    {
        std::cerr << "Audio engine track gain/pan render stress failed\n";
        return 1;
    }
    std::cerr << "  track effects\n";
    if (!stressAudioEngineTrackEffects())
    {
        std::cerr << "Audio engine track effects stress failed\n";
        return 1;
    }
    std::cerr << "  instrument effects\n";
    if (!stressAudioEngineInstrumentEffects())
    {
        std::cerr << "Audio engine instrument effects stress failed\n";
        return 1;
    }
    std::cerr << "  plugin effect placeholder\n";
    if (!stressAudioEnginePluginEffectPlaceholder())
    {
        std::cerr << "Audio engine plugin effect placeholder stress failed\n";
        return 1;
    }
    std::cerr << "  effect latency estimate\n";
    if (!stressAudioEngineEffectLatencyEstimate())
    {
        std::cerr << "Audio engine effect latency estimate stress failed\n";
        return 1;
    }
    std::cerr << "  transport command coalescing\n";
    if (!stressAudioEngineTransportCommandCoalescing())
    {
        std::cerr << "Audio engine transport command coalescing stress failed\n";
        return 1;
    }
    std::cerr << "  device snapshot\n";
    if (!stressAudioEngineDeviceSnapshot())
    {
        std::cerr << "Audio engine device snapshot stress failed\n";
        return 1;
    }
    std::cerr << "  input recording capture\n";
    if (!stressAudioEngineInputRecordingCapture())
    {
        std::cerr << "Audio engine input recording capture stress failed\n";
        return 1;
    }
    std::cerr << "  input monitoring\n";
    if (!stressAudioEngineInputMonitoring())
    {
        std::cerr << "Audio engine input monitoring stress failed\n";
        return 1;
    }
    std::cerr << "  plugin latency compensation\n";
    if (!stressAudioEnginePluginLatencyCompensation())
    {
        std::cerr << "Audio engine plugin latency compensation stress failed\n";
        return 1;
    }
    std::cerr << "  compressor effect\n";
    if (!stressAudioEngineCompressorEffect())
    {
        std::cerr << "Audio engine compressor effect stress failed\n";
        return 1;
    }
    std::cerr << "  distortion effect\n";
    if (!stressAudioEngineDistortionEffect())
    {
        std::cerr << "Audio engine distortion effect stress failed\n";
        return 1;
    }
    std::cerr << "  chorus effect\n";
    if (!stressAudioEngineChorusEffect())
    {
        std::cerr << "Audio engine chorus effect stress failed\n";
        return 1;
    }
    std::cerr << "  phaser effect\n";
    if (!stressAudioEnginePhaserEffect())
    {
        std::cerr << "Audio engine phaser effect stress failed\n";
        return 1;
    }
    std::cerr << "  flanger effect\n";
    if (!stressAudioEngineFlangerEffect())
    {
        std::cerr << "Audio engine flanger effect stress failed\n";
        return 1;
    }
    std::cerr << "  bitcrush chunk continuity\n";
    if (!stressAudioEngineBitcrushChunkContinuity())
    {
        std::cerr << "Audio engine bitcrush chunk continuity stress failed\n";
        return 1;
    }
    std::cerr << "  transport panic reset\n";
    if (!stressAudioEngineTransportPanicReset())
    {
        std::cerr << "Audio engine transport panic reset stress failed\n";
        return 1;
    }
    std::cerr << "  apply project runtime boundary\n";
    if (!stressAudioEngineApplyProjectRuntimeBoundary())
    {
        std::cerr << "Audio engine apply-project runtime boundary stress failed\n";
        return 1;
    }
    std::cerr << "  transport command burst\n";
    if (!stressAudioEngineTransportCommandBurst())
    {
        std::cerr << "Audio engine transport command burst stress failed\n";
        return 1;
    }
    std::cerr << "  queued loop clamp transport\n";
    if (!stressAudioEngineQueuedLoopClampTransport())
    {
        std::cerr << "Audio engine queued loop clamp transport stress failed\n";
        return 1;
    }
    std::cerr << "  audio clip playback\n";
    if (!stressAudioEngineAudioClipPlayback())
    {
        std::cerr << "Audio engine audio clip playback stress failed\n";
        return 1;
    }
    std::cerr << "  tail effects\n";
    if (!stressAudioEngineTailEffects())
    {
        std::cerr << "Audio engine delay/reverb stress failed\n";
        return 1;
    }
    std::cerr << "  denormal tail protection\n";
    if (!stressAudioEngineDenormalTailProtection())
    {
        std::cerr << "Audio engine denormal tail protection stress failed\n";
        return 1;
    }
    std::cerr << "  route automation\n";
    if (!stressAudioEngineRouteAutomation())
    {
        std::cerr << "Audio engine route automation stress failed\n";
        return 1;
    }
    std::cerr << "  automation block-size stability\n";
    if (!stressAudioEngineAutomationBlockSizeStability())
    {
        std::cerr << "Audio engine automation block-size stability stress failed\n";
        return 1;
    }
    std::cerr << "  sample instrument routing\n";
    if (!stressAudioEngineSampleInstrumentRouting())
    {
        std::cerr << "Audio engine sample instrument routing stress failed\n";
        return 1;
    }
    std::cerr << "  sample zones and release\n";
    if (!stressAudioEngineSampleZonesAndRelease())
    {
        std::cerr << "Audio engine sample zone/release stress failed\n";
        return 1;
    }
    std::cerr << "  sample zone direct path loading\n";
    if (!stressAudioEngineSampleZoneDirectPathLoading())
    {
        std::cerr << "Audio engine sample zone direct-path loading stress failed\n";
        return 1;
    }
    std::cerr << "  sample zone start/end slicing\n";
    if (!stressAudioEngineSampleZoneStartEndSlicing())
    {
        std::cerr << "Audio engine sample zone start/end slicing stress failed\n";
        return 1;
    }
    std::cerr << "  sample zone length selection\n";
    if (!stressAudioEngineSampleZoneLengthSelection())
    {
        std::cerr << "Audio engine sample zone length selection stress failed\n";
        return 1;
    }
    std::cerr << "  sample zone multi-variable selection\n";
    if (!stressAudioEngineSampleZoneMultiVariableSelection())
    {
        std::cerr << "Audio engine sample zone multi-variable selection stress failed\n";
        return 1;
    }
    std::cerr << "engine: done\n";

    std::cerr << "sample/export: start\n";
    if (!stressAudioEngineSampleLoopAndOneShot())
    {
        std::cerr << "Audio engine sample loop/one-shot stress failed\n";
        return 1;
    }
    if (!stressAudioEngineSampleChokeGroups())
    {
        std::cerr << "Audio engine sample choke group stress failed\n";
        return 1;
    }
    if (!stressAudioEngineOfflineExport())
    {
        std::cerr << "Audio engine offline export stress failed\n";
        return 1;
    }
    if (!stressAudioEngineOfflineExportProgressAndCancel())
    {
        std::cerr << "Audio engine offline export progress/cancel stress failed\n";
        return 1;
    }
    if (!stressAudioEngineOfflineRangeExport())
    {
        std::cerr << "Audio engine offline range export stress failed\n";
        return 1;
    }
    if (!stressAudioEngineReviewLoopRangeExportParity())
    {
        std::cerr << "Audio engine review-loop range export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineLiveExportParity())
    {
        std::cerr << "Audio engine live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineInstrumentEffectLiveExportParity())
    {
        std::cerr << "Audio engine instrument effect live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineInstrumentEffectExportTail())
    {
        std::cerr << "Audio engine instrument effect export tail stress failed\n";
        return 1;
    }
    if (!stressAudioEngineEffectAutomationLiveExportParity())
    {
        std::cerr << "Audio engine effect automation live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineSampleRateMatrix())
    {
        std::cerr << "Audio engine sample-rate matrix stress failed\n";
        return 1;
    }
    if (!stressAudioEngineSampleLiveExportParity())
    {
        std::cerr << "Audio engine sample live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineMixedLiveExportParity())
    {
        std::cerr << "Audio engine mixed live/export parity stress failed\n";
        return 1;
    }
    std::cerr << "sample/export: done\n";

    std::cerr << "decent sampler: start\n";
    if (!stressDecentSamplerFixtureImportAndPlayback())
    {
        std::cerr << "Decent Sampler fixture import/playback stress failed\n";
        return 1;
    }
    if (!stressDecentSamplerSyntheticMetadata())
    {
        std::cerr << "Decent Sampler synthetic metadata stress failed\n";
        return 1;
    }
    if (!stressDecentSamplerLorenzoUiMetadata())
    {
        std::cerr << "Decent Sampler Lorenzo UI metadata stress failed\n";
        return 1;
    }
    if (!stressDecentSamplerLorenzoImportAndPlayback())
    {
        std::cerr << "Decent Sampler Lorenzo import/playback stress failed\n";
        return 1;
    }
    if (!stressDecentSamplerHovefluteImportAndPlayback())
    {
        std::cerr << "Decent Sampler Hoveflute import/playback stress failed\n";
        return 1;
    }
    std::cerr << "decent sampler: done\n";

    std::cerr << "audio clips/master/routing: start\n";
    if (!stressAudioEngineAudioClipOfflineExport())
    {
        std::cerr << "Audio engine audio clip offline export stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAudioClipFadeEnvelope())
    {
        std::cerr << "Audio engine audio clip fade envelope stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAudioClipOverlongFadeNormalization())
    {
        std::cerr << "Audio engine audio clip overlong fade normalization stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAudioClipFadeLiveExportParity())
    {
        std::cerr << "Audio engine audio clip fade live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAudioClipCrossfadeLiveExportParity())
    {
        std::cerr << "Audio engine audio clip crossfade live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAudioClipTrimLiveExportParity())
    {
        std::cerr << "Audio engine audio clip trim live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineMasterLimiter())
    {
        std::cerr << "Audio engine master limiter stress failed\n";
        return 1;
    }
    if (!stressAudioEngineMasterChainCompressor())
    {
        std::cerr << "Audio engine master chain compressor stress failed\n";
        return 1;
    }
    if (!stressAudioEngineMasterChainBlockContinuity())
    {
        std::cerr << "Audio engine master chain block continuity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineSendReturnBus())
    {
        std::cerr << "Audio engine send/return bus stress failed\n";
        return 1;
    }
    if (!stressAudioEngineGroupRouting())
    {
        std::cerr << "Audio engine group routing stress failed\n";
        return 1;
    }
    if (!stressAudioEngineTrackStemExport())
    {
        std::cerr << "Audio engine track stem export stress failed\n";
        return 1;
    }
    if (!stressTrackBouncePlanner())
    {
        std::cerr << "Track bounce planner stress failed\n";
        return 1;
    }
    std::cerr << "audio clips/master/routing: done\n";

    std::cerr << "churn/dense: start\n";
    if (!stressAudioEngineProjectApplyChurn())
    {
        std::cerr << "Audio engine project apply churn stress failed\n";
        return 1;
    }
    if (!stressAudioEngineDenseAetherRoute())
    {
        std::cerr << "Audio engine dense Aether route stress failed\n";
        return 1;
    }
    if (!stressAudioEngineMaxUnisonAetherPolyphony())
    {
        std::cerr << "Audio engine max-unison Aether polyphony stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAetherVoiceLimit())
    {
        std::cerr << "Audio engine Aether voice-limit stress failed\n";
        return 1;
    }
    if (!stressAudioEngineAetherMonoVoiceLimit())
    {
        std::cerr << "Audio engine Aether mono voice-limit stress failed\n";
        return 1;
    }
    if (!stressAudioEngineDenseAetherLiveExportParity())
    {
        std::cerr << "Audio engine dense Aether live/export parity stress failed\n";
        return 1;
    }
    if (!stressAudioEngineVariableBlockSizes())
    {
        std::cerr << "Audio engine variable block size stress failed\n";
        return 1;
    }
    std::cerr << "churn/dense: done\n";

    std::cout << "Backend stress passed\n";
    return 0;
}

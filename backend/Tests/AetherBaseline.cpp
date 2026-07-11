#include "../Source/Audio/Realtime/RealtimeParameterQueue.h"
#include "../Source/Audio/Wavetable/WavetableFactory.h"
#include "../Source/Audio/Wavetable/WavetableOscillator.h"

#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_dsp/juce_dsp.h>

#include <chrono>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <numeric>
#include <sys/resource.h>

namespace
{
    struct Metrics
    {
        double pitchErrorCents {};
        double aliasRatio {};
        double dc {};
        double maxDiscontinuity {};
        double rms {};
        double renderMs {};
        int deadlineOverruns {};
    };

    std::vector<float> render(double sampleRate, int blockSize, double frequency, float position,
                              int unison, bool automate, double seconds = 0.25)
    {
        const int samples = juce::jmax(1, (int) std::round(sampleRate * seconds));
        const auto table = beat::WavetableFactory::createBasic(beat::BasicWavetableShape::Saw, 0.55f,
                                                               beat::WavetableWarpMode::Fold, 8, 2048);
        std::array<beat::WavetableOscillator, 8> oscillators;
        for (int voice = 0; voice < unison; ++voice)
        {
            auto& oscillator = oscillators[(size_t) voice];
            oscillator.prepare(sampleRate);
            oscillator.setWavetable(&table);
            oscillator.setFrequency(frequency * std::pow(2.0, ((double) voice - (unison - 1) * 0.5) * 7.0 / 1200.0));
            oscillator.setPosition(position);
            oscillator.setPhase((double) voice / (double) juce::jmax(1, unison));
        }

        std::vector<float> output((size_t) samples);
        int cursor = 0;
        while (cursor < samples)
        {
            const int count = juce::jmin(blockSize, samples - cursor);
            for (int i = 0; i < count; ++i)
            {
                const int index = cursor + i;
                if (automate)
                {
                    const float p = 0.5f + 0.48f * std::sin((float) index * 0.017f);
                    for (int voice = 0; voice < unison; ++voice)
                        oscillators[(size_t) voice].setPosition(p);
                }
                float value = 0.0f;
                for (int voice = 0; voice < unison; ++voice)
                    value += oscillators[(size_t) voice].renderSample();
                output[(size_t) index] = value / (float) unison;
            }
            cursor += count;
        }
        return output;
    }

    Metrics measure(const std::vector<float>& samples, double sampleRate, double expectedFrequency, double elapsedMs,
                    int deadlineOverruns)
    {
        Metrics result;
        result.renderMs = elapsedMs;
        result.deadlineOverruns = deadlineOverruns;
        if (samples.empty()) return result;

        double sum = 0.0;
        double square = 0.0;
        int crossings = 0;
        int first = -1;
        int last = -1;
        for (size_t i = 0; i < samples.size(); ++i)
        {
            const double value = samples[i];
            sum += value;
            square += value * value;
            if (i > 0)
            {
                result.maxDiscontinuity = juce::jmax(result.maxDiscontinuity,
                    std::abs((double) samples[i] - (double) samples[i - 1]));
                if (samples[i - 1] <= 0.0f && samples[i] > 0.0f)
                {
                    if (first < 0) first = (int) i;
                    last = (int) i;
                    ++crossings;
                }
            }
        }
        result.dc = sum / (double) samples.size();
        result.rms = std::sqrt(square / (double) samples.size());
        double measuredFrequency = expectedFrequency;
        if (crossings > 1 && last > first)
        {
            measuredFrequency = (double) (crossings - 1) * sampleRate / (double) (last - first);
            result.pitchErrorCents = 1200.0 * std::log2(measuredFrequency / expectedFrequency);
        }

        constexpr int order = 12;
        constexpr int fftSize = 1 << order;
        std::vector<float> fft((size_t) fftSize * 2, 0.0f);
        const int copy = juce::jmin(fftSize, (int) samples.size());
        for (int i = 0; i < copy; ++i)
        {
            const float window = 0.5f - 0.5f * std::cos(juce::MathConstants<float>::twoPi * (float) i / (float) (copy - 1));
            fft[(size_t) i] = samples[(size_t) i] * window;
        }
        juce::dsp::FFT transform(order);
        transform.performFrequencyOnlyForwardTransform(fft.data());
        double total = 0.0;
        double harmonic = 0.0;
        for (int bin = 1; bin < fftSize / 2; ++bin)
        {
            const double energy = (double) fft[(size_t) bin] * fft[(size_t) bin];
            total += energy;
            const double hz = (double) bin * sampleRate / (double) fftSize;
            const int nearest = juce::jmax(1, (int) std::round(hz / measuredFrequency));
            if (std::abs(hz - nearest * measuredFrequency) <= sampleRate / fftSize * 1.5)
                harmonic += energy;
        }
        result.aliasRatio = total > 0.0 ? juce::jlimit(0.0, 1.0, (total - harmonic) / total) : 0.0;
        return result;
    }

    bool writeWav(const juce::File& file, const std::vector<float>& samples, double sampleRate)
    {
        file.getParentDirectory().createDirectory();
        auto stream = std::unique_ptr<juce::FileOutputStream>(file.createOutputStream());
        if (!stream) return false;
        juce::WavAudioFormat format;
        auto writer = std::unique_ptr<juce::AudioFormatWriter>(format.createWriterFor(stream.release(), sampleRate, 1, 32, {}, 0));
        if (!writer) return false;
        juce::AudioBuffer<float> buffer(1, (int) samples.size());
        std::copy(samples.begin(), samples.end(), buffer.getWritePointer(0));
        return writer->writeFromAudioSampleBuffer(buffer, 0, buffer.getNumSamples());
    }

    juce::var metricJson(const Metrics& value)
    {
        auto* object = new juce::DynamicObject();
        object->setProperty("pitchErrorCents", value.pitchErrorCents);
        object->setProperty("aliasEnergyRatio", value.aliasRatio);
        object->setProperty("dcMean", value.dc);
        object->setProperty("maxDiscontinuity", value.maxDiscontinuity);
        object->setProperty("rms", value.rms);
        object->setProperty("renderMs", value.renderMs);
        object->setProperty("deadlineOverruns", value.deadlineOverruns);
        return juce::var(object);
    }
}

int main(int argc, char** argv)
{
    const juce::File outputRoot(argc > 1 ? argv[1] : "/private/tmp/beat-aether-baseline");
    outputRoot.createDirectory();
    const std::array sampleRates { 44100.0, 48000.0, 88200.0, 96000.0, 192000.0 };
    const std::array blockSizes { 64, 128, 256, 512, 1024 };
    const struct Scenario { const char* name; double frequency; float position; int unison; bool automate; } scenarios[] {
        { "initialization", 440.0, 0.0f, 1, false },
        { "dense-modulation", 261.625565, 0.65f, 4, true },
        { "maximum-unison", 220.0, 0.4f, 8, false },
        { "rapid-automation", 329.627557, 0.2f, 2, true },
        { "high-note-sweep", 7040.0, 0.8f, 1, false },
        { "live-offline-parity", 523.251131, 0.5f, 2, false },
    };

    juce::Array<juce::var> rows;
    int accepted = 0;
    int rejected = 0;
    beat::RealtimeParameterQueue<64> queue;
    for (int i = 0; i < 80; ++i)
        (queue.push(beat::makeRealtimeParameterChange("baseline", "osc.a.position", (float) i / 80.0f)) ? ++accepted : ++rejected);

    for (const auto& scenario : scenarios)
    {
        for (double sampleRate : sampleRates)
        {
            for (int blockSize : blockSizes)
            {
                const auto start = std::chrono::steady_clock::now();
                auto samples = render(sampleRate, blockSize, scenario.frequency, scenario.position, scenario.unison, scenario.automate);
                const auto elapsed = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
                const double audioMs = (double) samples.size() * 1000.0 / sampleRate;
                const auto metrics = measure(samples, sampleRate, scenario.frequency, elapsed, elapsed > audioMs ? 1 : 0);
                const auto name = juce::String(scenario.name) + "-" + juce::String((int) sampleRate) + "-" + juce::String(blockSize);
                if (!writeWav(outputRoot.getChildFile(name + ".wav"), samples, sampleRate)) return 2;
                auto* row = new juce::DynamicObject();
                row->setProperty("scenario", scenario.name);
                row->setProperty("sampleRate", sampleRate);
                row->setProperty("blockSize", blockSize);
                row->setProperty("metrics", metricJson(metrics));
                rows.add(juce::var(row));
            }
        }
    }

    struct rusage usage {};
    getrusage(RUSAGE_SELF, &usage);
    auto* root = new juce::DynamicObject();
    root->setProperty("schema", "beat.aether-baseline.v1");
    root->setProperty("rows", juce::var(rows));
    root->setProperty("queueAccepted", accepted);
    root->setProperty("queueRejected", rejected);
    root->setProperty("queueOverflow", rejected);
    root->setProperty("peakRssBytes", (juce::int64) usage.ru_maxrss);
    root->setProperty("renderCounters", "not available in isolated oscillator harness");
    root->setProperty("cacheBehavior", "direct immutable table; cache bypassed");
    const auto report = juce::JSON::toString(juce::var(root), true);
    if (!outputRoot.getChildFile("baseline.json").replaceWithText(report)) return 3;
    std::cout << report << "\n";
    return 0;
}

#include "AudioEngine.h"
#include "Effects/TrackEffectDefaults.h"
#include "Realtime/VoiceAutomationInbox.h"
#include "VoiceAllocation.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <map>
#include <utility>

namespace beat
{
    namespace
    {
        bool busRoutesTo(const ReturnBus& bus, const Id& destination) noexcept
        {
            if (bus.outputEnabled && bus.outputBusId == destination)
                return true;
            return std::any_of(bus.sends.begin(), bus.sends.end(), [&](const TrackSend& send) {
                return send.enabled && send.busId == destination;
            });
        }

        const ReturnBus* findProjectBus(const Project& project, const Id& id) noexcept
        {
            for (const auto& bus : project.returnBuses)
                if (bus.id == id) return &bus;
            return nullptr;
        }

        bool busCanReach(const Project& project, const Id& sourceId, const Id& targetId, juce::StringArray& visited)
        {
            if (sourceId == targetId) return true;
            if (sourceId.isEmpty() || visited.contains(sourceId)) return false;
            visited.add(sourceId);
            const auto* source = findProjectBus(project, sourceId);
            if (source == nullptr) return false;
            if (source->outputEnabled && source->outputBusId.isNotEmpty()
                && busCanReach(project, source->outputBusId, targetId, visited)) return true;
            for (const auto& send : source->sends)
                if (send.enabled && send.busId.isNotEmpty()
                    && busCanReach(project, send.busId, targetId, visited)) return true;
            return false;
        }

        bool routeFeedsSoloTarget(const Project& project, const Id& destination)
        {
            if (destination.isEmpty()) return false;
            for (const auto& target : project.returnBuses)
            {
                if (!target.solo && !target.soloSafe) continue;
                juce::StringArray visited;
                if (busCanReach(project, destination, target.id, visited)) return true;
            }
            return false;
        }

        bool busIsOnSoloPath(const Project& project, const Id& busId)
        {
            for (const auto& target : project.returnBuses)
            {
                if (!target.solo && !target.soloSafe) continue;
                juce::StringArray upstreamVisited;
                juce::StringArray downstreamVisited;
                if (busCanReach(project, busId, target.id, upstreamVisited)
                    || busCanReach(project, target.id, busId, downstreamVisited)) return true;
            }
            return false;
        }

        bool busIsSoloOrDownstream(const Project& project, const Id& busId)
        {
            for (const auto& target : project.returnBuses)
            {
                if (!target.solo && !target.soloSafe) continue;
                juce::StringArray visited;
                if (busCanReach(project, target.id, busId, visited)) return true;
            }
            return false;
        }

        std::vector<const ReturnBus*> orderedAudioBuses(const Project& project)
        {
            std::vector<const ReturnBus*> remaining;
            for (const auto& bus : project.returnBuses)
                if (bus.id.isNotEmpty()) remaining.push_back(&bus);

            std::vector<const ReturnBus*> ordered;
            ordered.reserve(remaining.size());
            while (!remaining.empty())
            {
                auto candidate = remaining.end();
                for (auto it = remaining.begin(); it != remaining.end(); ++it)
                {
                    if (busRoutesTo(**it, (*it)->id))
                        continue;
                    const auto incoming = std::any_of(remaining.begin(), remaining.end(), [&](const ReturnBus* source) {
                        return source != *it && busRoutesTo(*source, (*it)->id);
                    });
                    if (incoming) continue;
                    if (candidate == remaining.end()
                        || (*it)->mixerOrder < (*candidate)->mixerOrder
                        || ((*it)->mixerOrder == (*candidate)->mixerOrder && (*it)->id < (*candidate)->id))
                        candidate = it;
                }
                if (candidate == remaining.end())
                    break; // Cyclic buses fail closed and are not installed in the realtime graph.
                ordered.push_back(*candidate);
                remaining.erase(candidate);
            }
            return ordered;
        }

        // Sound that matches any note — InstrumentVoice handles the actual sound.
        struct PassSound : public juce::SynthesiserSound
        {
            bool appliesToNote(int) override    { return true; }
            bool appliesToChannel(int) override { return true; }
        };

        class NodemapVoice final : public juce::SynthesiserVoice
        {
        public:
            bool canPlaySound(juce::SynthesiserSound*) override { return true; }

            void setGraph(Nodemap::Graph graphToUse)
            {
                graph = std::move(graphToUse);
            }

            void prepare(double sr)
            {
                sampleRate = sr > 0.0 ? sr : 44100.0;
            }

            void startNote(int midiNoteNumber,
                           float velocity,
                           juce::SynthesiserSound*,
                           int) override
            {
                Nodemap::AuditionOptions options;
                options.sampleRate = sampleRate;
                options.sampleCount = juce::jmax(1, (int) std::round(sampleRate * 2.0));
                options.midiNote = midiNoteNumber;
                options.velocity = juce::jlimit(0.0f, 1.0f, velocity);
                options.keytrack = juce::jlimit(0.0f, 1.0f, (float) midiNoteNumber / 127.0f);
                options.randomSeed = (juce::uint32) (0x2a17b4c3u ^ (juce::uint32) midiNoteNumber);
                rendered = Nodemap::renderOneNote(graph, options);
                cursor = 0;
                active = !rendered.silent && !rendered.left.empty() && !rendered.right.empty();
                if (!active)
                    clearCurrentNote();
            }

            void stopNote(float, bool allowTailOff) override
            {
                if (!allowTailOff)
                {
                    active = false;
                    clearCurrentNote();
                }
            }

            void pitchWheelMoved(int) override {}
            void controllerMoved(int, int) override {}

            void renderNextBlock(juce::AudioBuffer<float>& outputBuffer,
                                 int startSample,
                                 int numSamples) override
            {
                if (!active)
                    return;

                const int channelCount = outputBuffer.getNumChannels();
                for (int i = 0; i < numSamples; ++i)
                {
                    if (cursor >= rendered.left.size())
                    {
                        active = false;
                        clearCurrentNote();
                        return;
                    }

                    const auto left = rendered.left[cursor];
                    const auto right = cursor < rendered.right.size() ? rendered.right[cursor] : left;
                    if (channelCount > 0)
                        outputBuffer.addSample(0, startSample + i, left);
                    if (channelCount > 1)
                        outputBuffer.addSample(1, startSample + i, right);
                    for (int channel = 2; channel < channelCount; ++channel)
                        outputBuffer.addSample(channel, startSample + i, 0.5f * (left + right));
                    ++cursor;
                }
            }

        private:
            Nodemap::Graph graph { Nodemap::makeOutputOnlyGraph() };
            Nodemap::AuditionResult rendered;
            double sampleRate { 44100.0 };
            size_t cursor { 0 };
            bool active { false };
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

        StereoPanGains stereoBalancePan(float pan) noexcept
        {
            const auto clamped = juce::jlimit(-1.0f, 1.0f, pan);
            return {
                clamped > 0.0f ? 1.0f - clamped : 1.0f,
                clamped < 0.0f ? 1.0f + clamped : 1.0f,
            };
        }

        double syncedLfoDivisionBeats(const juce::String& division)
        {
            const auto trimmed = division.trim();
            const bool dotted = trimmed.endsWithIgnoreCase("d");
            const bool triplet = trimmed.endsWithIgnoreCase("t");
            auto core = trimmed;
            if (dotted || triplet)
                core = core.dropLastCharacters(1);

            const auto slash = core.indexOfChar('/');
            if (slash <= 0 || slash >= core.length() - 1)
                return 1.0;

            const double numerator = core.substring(0, slash).getDoubleValue();
            const double denominator = core.substring(slash + 1).getDoubleValue();
            if (!std::isfinite(numerator) || !std::isfinite(denominator) || numerator <= 0.0 || denominator <= 0.0)
                return 1.0;

            double beats = (numerator / denominator) * 4.0;
            if (dotted)
                beats *= 1.5;
            else if (triplet)
                beats *= 2.0 / 3.0;

            return juce::jlimit(1.0 / 64.0, 64.0, beats);
        }

        float effectiveLfoRateHz(float rateHz, bool sync, const juce::String& division, double bpm)
        {
            if (!sync)
                return juce::jlimit(0.01f, 50.0f, rateHz);

            const double beatsPerCycle = syncedLfoDivisionBeats(division);
            const double cyclesPerSecond = (juce::jmax(1.0, bpm) / 60.0) / beatsPerCycle;
            return juce::jlimit(0.01f, 50.0f, (float) cyclesPerSecond);
        }

        struct FadeSamplePair
        {
            int in { 0 };
            int out { 0 };
        };

        FadeSamplePair normalizedFadeSamples(double fadeInBeats,
                                             double fadeOutBeats,
                                             double samplesPerBeat,
                                             int clipTotalSamples) noexcept
        {
            const int total = juce::jmax(1, clipTotalSamples);
            int fadeIn = juce::jlimit(0, total, (int) std::round(juce::jmax(0.0, fadeInBeats) * samplesPerBeat));
            int fadeOut = juce::jlimit(0, total, (int) std::round(juce::jmax(0.0, fadeOutBeats) * samplesPerBeat));

            const int fadeSum = fadeIn + fadeOut;
            if (fadeSum > total)
            {
                const double scale = (double) total / (double) fadeSum;
                fadeIn = juce::jlimit(0, total, (int) std::floor((double) fadeIn * scale));
                fadeOut = juce::jlimit(0, total - fadeIn, total - fadeIn);
            }

            return { fadeIn, fadeOut };
        }

        juce::File resolveAudioPath(const juce::String& path)
        {
            juce::File file(path);
            if (path.startsWith("/samples/"))
            {
                const auto executable = juce::File::getSpecialLocation(juce::File::currentExecutableFile);
                const auto resources = executable.getParentDirectory().getSiblingFile("Resources").getChildFile("frontend");
                file = resources.getChildFile(path.substring(1));
            }
            return file;
        }

        float trackEffectParam(const TrackEffect& effect, const char* key, float fallback) noexcept
        {
            for (const auto& param : effect.params)
            {
                if (param.key == key)
                    return param.value;
            }
            return fallback;
        }

        bool setTrackEffectParam(TrackEffect& effect, const juce::String& key, float value) noexcept
        {
            for (auto& param : effect.params)
            {
                if (param.key == key)
                {
                    param.value = value;
                    return true;
                }
            }
            return false; // Unknown parameters are rejected without allocating on the callback.
        }

        bool isRouteAutomationTarget(const juce::String& target) noexcept
        {
            return target == "track.gainDb"
                || target == "track.gain"
                || target == "track.pan"
                || target == "bus.gainDb"
                || target == "bus.gain"
                || target == "bus.pan"
                || target == "bus.inputTrimDb"
                || target == "bus.mute"
                || target.startsWith("send.")
                || target.startsWith("effect.")
                || target.startsWith("effects.");
        }

        const PluginAdapterDefinition* findPluginAdapter(const Project& project,
                                                         const Id& pluginId) noexcept
        {
            if (pluginId.isEmpty())
                return nullptr;

            for (const auto& plugin : project.plugins)
            {
                if (plugin.id == pluginId)
                    return &plugin;
            }

            return nullptr;
        }

        int pluginAdapterEffectLatencySamples(const PluginAdapterDefinition& plugin) noexcept
        {
            int latency = 0;
            for (const auto& capability : plugin.capabilities)
            {
                if (capability.kind == "effect" && (capability.realtime || capability.offline))
                    latency = juce::jmax(latency, juce::jmax(0, capability.latencySamples));
            }
            return latency;
        }

        int effectiveTrackEffectLatencySamples(const Project& project,
                                               const TrackEffect& effect) noexcept
        {
            if (effect.bypassed)
                return 0;

            const int declaredLatency = juce::jmax(0, effect.latencySamples);
            if (declaredLatency > 0 || effect.kind != TrackEffectKind::Plugin)
                return declaredLatency;

            if (const auto* plugin = findPluginAdapter(project, effect.pluginId))
                return pluginAdapterEffectLatencySamples(*plugin);

            return 0;
        }

        const InstrumentDefinition* findInstrumentDefinition(const Project& project,
                                                             const Id& instrumentId) noexcept
        {
            if (instrumentId.isEmpty())
                return nullptr;

            for (const auto& instrument : project.instruments)
            {
                if (instrument.id == instrumentId)
                    return &instrument;
            }

            return nullptr;
        }

        bool isMidiExpressionInstrument(const InstrumentDefinition& instrument) noexcept
        {
            return instrument.hasAether
                || instrument.kind == "synth"
                || instrument.kind == "wavetable";
        }

        std::vector<TrackEffect> composeRouteEffects(const InstrumentDefinition* instrument,
                                                     const std::vector<TrackEffect>& trackEffects)
        {
            std::vector<TrackEffect> effects;
            const auto instrumentEffectCount = instrument != nullptr ? instrument->effects.size() : 0;
            effects.reserve(instrumentEffectCount + trackEffects.size());

            if (instrument != nullptr)
            {
                for (const auto& effect : instrument->effects)
                    effects.push_back(effect);
            }

            for (const auto& effect : trackEffects)
                effects.push_back(effect);

            return effects;
        }

        int routeEffectsLatencySamples(const Project& project,
                                       const std::vector<TrackEffect>& effects) noexcept
        {
            int latency = 0;
            for (const auto& effect : effects)
                latency += effectiveTrackEffectLatencySamples(project, effect);
            return latency;
        }

        void applyPluginEffectCapabilitiesToList(Project& project, std::vector<TrackEffect>& effects)
        {
            for (auto& effect : effects)
            {
                if (effect.kind != TrackEffectKind::Plugin)
                    continue;

                const auto* plugin = findPluginAdapter(project, effect.pluginId);
                if (plugin == nullptr)
                    continue;

                if (effect.pluginName.isEmpty())
                    effect.pluginName = plugin->name;
                if (effect.pluginFormat.isEmpty())
                    effect.pluginFormat = plugin->format;
                if (effect.latencySamples <= 0)
                    effect.latencySamples = pluginAdapterEffectLatencySamples(*plugin);
            }
        }

        void applyPluginEffectCapabilities(Project& project)
        {
            for (auto& instrument : project.instruments)
                applyPluginEffectCapabilitiesToList(project, instrument.effects);

            for (auto& track : project.tracks)
                applyPluginEffectCapabilitiesToList(project, track.effects);

            for (auto& bus : project.returnBuses)
                applyPluginEffectCapabilitiesToList(project, bus.effects);
        }

        void normalizeProjectTrackEffects(Project& project)
        {
            for (auto& instrument : project.instruments)
                for (auto& effect : instrument.effects)
                    if (effect.kind != TrackEffectKind::Unknown)
                        normalizeTrackEffect(effect);

            for (auto& track : project.tracks)
                for (auto& effect : track.effects)
                    if (effect.kind != TrackEffectKind::Unknown)
                        normalizeTrackEffect(effect);

            for (auto& bus : project.returnBuses)
                for (auto& effect : bus.effects)
                    if (effect.kind != TrackEffectKind::Unknown)
                        normalizeTrackEffect(effect);
        }

        int scratchBlockCapacity(int requestedBlock) noexcept
        {
            return juce::jmax(juce::jmax(1, requestedBlock), 8192);
        }

        float denormalSafe(float value) noexcept
        {
            return std::abs(value) < 1.0e-20f ? 0.0f : value;
        }

        float amplitudeToDb(float amplitude) noexcept
        {
            if (!std::isfinite(amplitude) || amplitude <= 0.0f)
                return -std::numeric_limits<float>::infinity();
            return juce::jmax(-120.0f, 20.0f * std::log10(amplitude));
        }

        float loudnessFromMeanSquare(double meanSquare) noexcept
        {
            if (!std::isfinite(meanSquare) || meanSquare <= 0.0)
                return -std::numeric_limits<float>::infinity();
            return static_cast<float>(-0.691 + 10.0 * std::log10(meanSquare));
        }

        template <typename BiquadState>
        BiquadState makeLiveMeterBiquad(const juce::String& type,
                                        double sampleRate,
                                        double frequency,
                                        double q,
                                        double gainDb = 0.0) noexcept
        {
            BiquadState state;
            const auto safeSampleRate = juce::jmax(1.0, sampleRate);
            const auto omega = juce::MathConstants<double>::twoPi * frequency / safeSampleRate;
            const auto sinOmega = std::sin(omega);
            const auto cosOmega = std::cos(omega);

            if (type == "highpass")
            {
                const auto alpha = sinOmega / (2.0 * q);
                const auto a0 = 1.0 + alpha;
                state.b0 = ((1.0 + cosOmega) * 0.5) / a0;
                state.b1 = (-(1.0 + cosOmega)) / a0;
                state.b2 = ((1.0 + cosOmega) * 0.5) / a0;
                state.a1 = (-2.0 * cosOmega) / a0;
                state.a2 = (1.0 - alpha) / a0;
                return state;
            }

            const auto a = std::pow(10.0, gainDb / 40.0);
            const auto alpha = sinOmega / (2.0 * q);
            const auto sqrtA = std::sqrt(a);
            const auto a0 = (a + 1.0) - (a - 1.0) * cosOmega + 2.0 * sqrtA * alpha;
            state.b0 = (a * ((a + 1.0) + (a - 1.0) * cosOmega + 2.0 * sqrtA * alpha)) / a0;
            state.b1 = (-2.0 * a * ((a - 1.0) + (a + 1.0) * cosOmega)) / a0;
            state.b2 = (a * ((a + 1.0) + (a - 1.0) * cosOmega - 2.0 * sqrtA * alpha)) / a0;
            state.a1 = (2.0 * ((a - 1.0) - (a + 1.0) * cosOmega)) / a0;
            state.a2 = ((a + 1.0) - (a - 1.0) * cosOmega - 2.0 * sqrtA * alpha) / a0;
            return state;
        }

        template <typename BiquadState>
        float processLiveMeterBiquad(BiquadState& state, float input) noexcept
        {
            const auto x0 = static_cast<double>(input);
            const auto y0 = state.b0 * x0
                + state.b1 * state.x1
                + state.b2 * state.x2
                - state.a1 * state.y1
                - state.a2 * state.y2;
            state.x2 = state.x1;
            state.x1 = x0;
            state.y2 = state.y1;
            state.y1 = y0;
            return static_cast<float>(y0);
        }

        float catmullRom(float y0, float y1, float y2, float y3, float t) noexcept
        {
            const auto t2 = t * t;
            const auto t3 = t2 * t;
            return 0.5f * ((2.0f * y1)
                + (-y0 + y2) * t
                + (2.0f * y0 - 5.0f * y1 + 4.0f * y2 - y3) * t2
                + (-y0 + 3.0f * y1 - 3.0f * y2 + y3) * t3);
        }

        template <typename MeterState>
        float pushTruePeakSample(MeterState& state, int channel, float sample) noexcept
        {
            auto& window = state.truePeakWindow[(size_t) channel];
            auto& size = state.truePeakWindowSize[(size_t) channel];
            float peak = std::abs(sample);

            if (size < (int) window.size())
            {
                window[(size_t) size++] = sample;
                return peak;
            }

            window[0] = window[1];
            window[1] = window[2];
            window[2] = window[3];
            window[3] = sample;

            for (int step = 1; step < 4; ++step)
                peak = juce::jmax(peak, std::abs(catmullRom(window[0], window[1], window[2], window[3], (float) step / 4.0f)));

            return peak;
        }

        void clearDenormalSamples(juce::AudioBuffer<float>& buffer, int startSample, int numSamples) noexcept
        {
            for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
            {
                auto* samples = buffer.getWritePointer(ch, startSample);
                for (int i = 0; i < numSamples; ++i)
                    samples[i] = denormalSafe(samples[i]);
            }
        }

        double estimateTrackEffectTailSeconds(const std::vector<TrackEffect>& effects) noexcept
        {
            double tailSeconds = 0.0;
            for (const auto& effect : effects)
            {
                if (effect.bypassed) continue;
                if (effect.kind == TrackEffectKind::Delay)
                {
                    const double timeMs = juce::jlimit(1.0, 2000.0, (double) trackEffectParam(effect, "timeMs", 250.0f));
                    const double feedback = juce::jlimit(0.0, 0.95, (double) trackEffectParam(effect, "feedback", 25.0f) / 100.0);
                    const double repeats = feedback > 0.001 ? juce::jlimit(1.0, 10.0, std::log(0.001) / std::log(feedback)) : 1.0;
                    tailSeconds = juce::jmax(tailSeconds, timeMs / 1000.0 * repeats);
                }
                else if (effect.kind == TrackEffectKind::Reverb)
                {
                    const double room = juce::jlimit(0.0, 1.0, (double) trackEffectParam(effect, "roomSize", 40.0f) / 100.0);
                    tailSeconds = juce::jmax(tailSeconds, 0.75 + room * 3.0);
                }
            }
            return juce::jlimit(0.0, 8.0, tailSeconds);
        }

        double estimateProjectTailSeconds(const Project& project) noexcept
        {
            double tailSeconds = 0.0;
            for (const auto& track : project.tracks)
            {
                const auto* instrument = findInstrumentDefinition(project, track.instrumentId);
                tailSeconds = juce::jmax(
                    tailSeconds,
                    estimateTrackEffectTailSeconds(composeRouteEffects(instrument, track.effects)));
            }
            return tailSeconds;
        }

        constexpr size_t maxActiveSampleVoices = 192;

        bool canLoadReaderIntoAudioBuffer(const juce::AudioFormatReader& reader) noexcept
        {
            return reader.numChannels > 0
                && reader.numChannels <= 32
                && reader.lengthInSamples > 0
                && reader.lengthInSamples <= static_cast<juce::int64>(std::numeric_limits<int>::max());
        }
    }

    AudioEngine::AudioEngine()
    {
        formatManager.registerBasicFormats();
        pendingNoteOffs.reserve(256);
        pendingParameterAutomation.reserve(2048);
        blockRealtimeParameterEvents.reserve(2048);
        blockRouteParameterEvents.reserve(1024);
        activeSampleVoices.reserve(256);
        activeAudioClipVoices.reserve(256);
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
        juce::String error;
        if (!prepareWithDefaultDevices(0, 2, &error) && error.isNotEmpty())
            DBG("AudioEngine init error: " << error);
    }

    bool AudioEngine::prepareWithDefaultDevices(int inputChannels,
                                                int outputChannels,
                                                juce::String* error)
    {
        if (device == nullptr)
            device = std::make_unique<juce::AudioDeviceManager>();

        device->removeAudioCallback(this);
        inputChannels = juce::jlimit(0, 32, inputChannels);
        outputChannels = juce::jlimit(1, 32, outputChannels);
        const auto err = device->initialiseWithDefaultDevices(inputChannels, outputChannels);
        if (err.isNotEmpty())
        {
            if (error != nullptr)
                *error = err;
            return false;
        }

        device->addAudioCallback(this);
        refreshMidiInputCallbacks();
        if (error != nullptr)
            *error = {};
        return true;
    }

    AudioEngine::AudioDeviceSnapshot AudioEngine::listAudioDevices(bool scanAvailableDevices)
    {
        AudioDeviceSnapshot snapshot;
        if (device == nullptr)
        {
            if (!scanAvailableDevices)
                return snapshot;

            device = std::make_unique<juce::AudioDeviceManager>();
        }

        snapshot.currentTypeName = device->getCurrentAudioDeviceType();

        juce::AudioDeviceManager::AudioDeviceSetup setup;
        device->getAudioDeviceSetup(setup);
        snapshot.currentInputName = setup.inputDeviceName;
        snapshot.currentOutputName = setup.outputDeviceName;

        if (auto* current = device->getCurrentAudioDevice())
        {
            if (snapshot.currentInputName.isEmpty())
                snapshot.currentInputName = current->getName();
            if (snapshot.currentOutputName.isEmpty())
                snapshot.currentOutputName = current->getName();
            snapshot.sampleRate = current->getCurrentSampleRate();
            snapshot.bufferSize = current->getCurrentBufferSizeSamples();
            snapshot.inputLatencySamples = current->getInputLatencyInSamples();
            snapshot.outputLatencySamples = current->getOutputLatencyInSamples();
            snapshot.inputChannelNames = current->getInputChannelNames();
            snapshot.outputChannelNames = current->getOutputChannelNames();
        }

        if (!scanAvailableDevices)
            return snapshot;

        juce::StringArray seen;
        for (auto* type : device->getAvailableDeviceTypes())
        {
            if (type == nullptr)
                continue;

            type->scanForDevices();
            const auto typeName = type->getTypeName();
            const auto inputNames = type->getDeviceNames(true);
            const auto outputNames = type->getDeviceNames(false);

            auto addDevice = [&](const juce::String& name, bool isInput, bool isOutput)
            {
                const auto key = typeName + "\n" + name;
                const int existing = seen.indexOf(key);
                if (existing >= 0)
                {
                    auto& info = snapshot.devices[(size_t) existing];
                    info.input = info.input || isInput;
                    info.output = info.output || isOutput;
                    info.currentInput = info.currentInput || (isInput && name == snapshot.currentInputName && typeName == snapshot.currentTypeName);
                    info.currentOutput = info.currentOutput || (isOutput && name == snapshot.currentOutputName && typeName == snapshot.currentTypeName);
                    return;
                }

                seen.add(key);
                AudioDeviceInfo info;
                info.typeName = typeName;
                info.name = name;
                info.input = isInput;
                info.output = isOutput;
                info.currentInput = isInput && name == snapshot.currentInputName && typeName == snapshot.currentTypeName;
                info.currentOutput = isOutput && name == snapshot.currentOutputName && typeName == snapshot.currentTypeName;
                snapshot.devices.push_back(std::move(info));
            };

            for (const auto& name : inputNames)
                addDevice(name, true, outputNames.contains(name));

            for (const auto& name : outputNames)
                if (!inputNames.contains(name))
                    addDevice(name, false, true);
        }

        return snapshot;
    }

    bool AudioEngine::selectInputDevice(const juce::String& typeName,
                                        const juce::String& inputDeviceName,
                                        int inputChannelCount,
                                        juce::String* error)
    {
        if (device == nullptr)
            device = std::make_unique<juce::AudioDeviceManager>();

        const int channels = juce::jlimit(1, 32, inputChannelCount);
        const auto requestedType = typeName.trim();
        if (requestedType.isNotEmpty() && requestedType != device->getCurrentAudioDeviceType())
            device->setCurrentAudioDeviceType(requestedType, true);

        juce::AudioDeviceManager::AudioDeviceSetup setup;
        device->getAudioDeviceSetup(setup);
        setup.inputDeviceName = inputDeviceName;
        setup.useDefaultInputChannels = false;
        setup.inputChannels.clear();
        setup.inputChannels.setRange(0, channels, true);

        const auto err = device->setAudioDeviceSetup(setup, true);
        if (err.isNotEmpty())
        {
            if (error != nullptr)
                *error = err;
            return false;
        }

        if (error != nullptr)
            *error = {};
        refreshMidiInputCallbacks();
        return true;
    }

    bool AudioEngine::selectOutputDevice(const juce::String& typeName,
                                         const juce::String& outputDeviceName,
                                         juce::String* error)
    {
        if (device == nullptr)
            device = std::make_unique<juce::AudioDeviceManager>();

        const auto requestedType = typeName.trim();
        if (requestedType.isNotEmpty() && requestedType != device->getCurrentAudioDeviceType())
            device->setCurrentAudioDeviceType(requestedType, true);

        juce::AudioDeviceManager::AudioDeviceSetup setup;
        device->getAudioDeviceSetup(setup);
        setup.outputDeviceName = outputDeviceName;
        setup.useDefaultOutputChannels = true;
        setup.outputChannels.clear();

        const auto err = device->setAudioDeviceSetup(setup, true);
        if (err.isNotEmpty())
        {
            if (error != nullptr)
                *error = err;
            return false;
        }

        juce::AudioDeviceManager::AudioDeviceSetup appliedSetup;
        device->getAudioDeviceSetup(appliedSetup);
        const auto appliedType = device->getCurrentAudioDeviceType();
        if (appliedSetup.outputDeviceName != outputDeviceName
            || (requestedType.isNotEmpty() && appliedType != requestedType))
        {
            if (error != nullptr)
                *error = "The audio system kept output on '" + appliedSetup.outputDeviceName + "'.";
            return false;
        }

        if (error != nullptr)
            *error = {};
        return true;
    }

    void AudioEngine::prepareForOffline(double sr, int block, int channels)
    {
        sampleRate = sr > 0.0 ? sr : 44100.0;
        block = juce::jmax(1, block);
        const int scratchBlock = scratchBlockCapacity(block);
        channels = juce::jmax(1, channels);

        seq.setSampleRate(sampleRate);
        synth.setCurrentPlaybackSampleRate(sampleRate);
        for (int i = 0; i < synth.getNumVoices(); ++i)
            if (auto* v = dynamic_cast<InstrumentVoice*>(synth.getVoice(i)))
                v->prepare(sampleRate, scratchBlock);
        {
            const juce::ScopedLock lock(sampleLock);
            for (auto& route : instrumentRenderStates)
            {
                if (route.synth == nullptr) continue;
                route.synth->setCurrentPlaybackSampleRate(sampleRate);
                for (int i = 0; i < route.synth->getNumVoices(); ++i)
                    if (auto* v = dynamic_cast<InstrumentVoice*>(route.synth->getVoice(i)))
                        v->prepare(sampleRate, scratchBlock);
            }
        }

        bitcrush.prepare(sampleRate, scratchBlock);
        masterEq.prepare(sampleRate, scratchBlock, channels);
        masterLimiter.prepare(sampleRate, scratchBlock, channels);
        masterLimiter.setCeilingDb(-0.3f);
        masterLimiter.setReleaseMs(35.0f);
        masterAnalyzer.prepare(sampleRate);
        prepareMasterLoudnessMeter(channels);
        mixBuf.setSize(juce::jmax(2, channels), scratchBlock, false, false, true);
        routeBuf.setSize(juce::jmax(2, channels), scratchBlock, false, false, true);
    }

    bool AudioEngine::renderProjectToWav(Project project,
                                         const juce::File& outputFile,
                                         double sr,
                                         int blockSize,
                                         int channels,
                                         juce::String* error,
                                         RenderProgressCallback progress,
                                         int bitDepth)
    {
        const auto endBeat = project.lengthBeats;
        return renderProjectRangeToWav(std::move(project),
                                       0.0,
                                       endBeat,
                                       outputFile,
                                       true,
                                       sr,
                                       blockSize,
                                       channels,
                                       error,
                                       std::move(progress),
                                       bitDepth);
    }

    bool AudioEngine::renderProjectRangeToWav(Project project,
                                             Beats startBeat,
                                             Beats endBeat,
                                             const juce::File& outputFile,
                                             bool includeTail,
                                             double sr,
                                             int blockSize,
                                             int channels,
                                             juce::String* error,
                                             RenderProgressCallback progress,
                                             int bitDepth)
    {
        const auto setError = [error](const juce::String& message)
        {
            if (error != nullptr)
                *error = message;
            return false;
        };

        if (outputFile.getFullPathName().isEmpty())
            return setError("No output file selected.");

        normalizeProjectTrackEffects(project);
        applyPluginEffectCapabilities(project);
        normalizeProjectTrackEffects(project);

        sr = sr > 0.0 ? sr : 44100.0;
        blockSize = juce::jmax(1, blockSize);
        channels = juce::jlimit(1, 2, channels);
        bitDepth = (bitDepth <= 16) ? 16 : (bitDepth <= 24 ? 24 : 32);

        const double bpm = juce::jmax(1.0, project.bpm);
        const double projectLengthBeats = juce::jmax(0.0, project.lengthBeats);
        startBeat = juce::jlimit(0.0, projectLengthBeats, startBeat);
        endBeat = juce::jlimit(startBeat, projectLengthBeats, endBeat);
        const double lengthBeats = juce::jmax(0.0, endBeat - startBeat);
        if (lengthBeats <= 0.0)
            return setError("Export range is empty.");

        const juce::int64 totalSamples = juce::jmax<juce::int64>(
            1,
            (juce::int64) std::ceil((lengthBeats * 60.0 / bpm + (includeTail ? estimateProjectTailSeconds(project) : 0.0)) * sr));

        auto parent = outputFile.getParentDirectory();
        if (!parent.exists() && !parent.createDirectory())
            return setError("Could not create export directory.");

        auto tempFile = parent.getChildFile(outputFile.getFileName() + ".tmp");
        if (tempFile.existsAsFile() && !tempFile.deleteFile())
            return setError("Could not clear previous temporary export file.");

        std::unique_ptr<juce::FileOutputStream> stream(tempFile.createOutputStream());
        if (stream == nullptr || stream->failedToOpen())
            return setError("Could not open export file for writing.");

        const int bitsPerSample = bitDepth;
        const int bytesPerSample = bitsPerSample / 8;
        const juce::int64 dataBytes64 = totalSamples * channels * bytesPerSample;
        if (dataBytes64 > (juce::int64) std::numeric_limits<uint32_t>::max() - 36)
            return setError("Export is too long for this WAV writer.");

        const auto dataBytes = (uint32_t) dataBytes64;
        const auto byteRate = (uint32_t) std::round(sr) * (uint32_t) channels * (uint32_t) bytesPerSample;
        const auto blockAlign = (uint16_t) (channels * bytesPerSample);
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
        const auto writeS24 = [&stream](int32_t value)
        {
            const unsigned char bytes[3] {
                (unsigned char) (value & 0xff),
                (unsigned char) ((value >> 8) & 0xff),
                (unsigned char) ((value >> 16) & 0xff),
            };
            return stream->write(bytes, sizeof(bytes));
        };
        stream->write("RIFF", 4);
        writeU32(36 + dataBytes);
        stream->write("WAVE", 4);
        stream->write("fmt ", 4);
        writeU32(16);
        writeU16(1);
        writeU16((uint16_t) channels);
        writeU32((uint32_t) std::round(sr));
        writeU32(byteRate);
        writeU16(blockAlign);
        writeU16(bitsPerSample);
        stream->write("data", 4);
        writeU32(dataBytes);

        AudioEngine offlineEngine;
        offlineEngine.prepareForOffline(sr, blockSize, channels);
        offlineEngine.applyProject(std::move(project));
        offlineEngine.requestSeek(startBeat);
        offlineEngine.requestPlay();

        juce::AudioBuffer<float> block(channels, blockSize);
        std::vector<float*> outputPointers((size_t) channels, nullptr);
        juce::AudioIODeviceCallbackContext context;

        juce::int64 samplesWritten = 0;
        if (progress && !progress(0.0, 0, totalSamples))
        {
            offlineEngine.requestStop();
            stream.reset();
            tempFile.deleteFile();
            return setError("Export cancelled.");
        }

        while (samplesWritten < totalSamples)
        {
            const int samplesThisBlock = (int) juce::jmin<juce::int64>(blockSize, totalSamples - samplesWritten);
            block.setSize(channels, samplesThisBlock, false, false, true);
            block.clear();

            for (int ch = 0; ch < channels; ++ch)
                outputPointers[(size_t) ch] = block.getWritePointer(ch);

            offlineEngine.audioDeviceIOCallbackWithContext(nullptr,
                                                           0,
                                                           outputPointers.data(),
                                                           channels,
                                                           samplesThisBlock,
                                                           context);

            for (int i = 0; i < samplesThisBlock; ++i)
            {
                for (int ch = 0; ch < channels; ++ch)
                {
                    const auto sample = juce::jlimit(-1.0f, 1.0f, block.getSample(ch, i));
                    if (bitsPerSample == 16)
                    {
                        writeU16((uint16_t) (int16_t) std::lrint(sample * 32767.0f));
                    }
                    else if (bitsPerSample == 24)
                    {
                        writeS24((int32_t) std::lrint(sample * 8388607.0f));
                    }
                    else
                    {
                        writeU32((uint32_t) (int32_t) std::lrint(sample * 2147483647.0f));
                    }
                }
            }

            samplesWritten += samplesThisBlock;
            if (progress
                && !progress(totalSamples > 0 ? (double) samplesWritten / (double) totalSamples : 1.0,
                             samplesWritten,
                             totalSamples))
            {
                offlineEngine.requestStop();
                stream.reset();
                tempFile.deleteFile();
                return setError("Export cancelled.");
            }
        }

        offlineEngine.requestStop();
        stream->flush();
        stream.reset();

        if (!tempFile.existsAsFile() || tempFile.getSize() <= 44)
        {
            tempFile.deleteFile();
            return setError("Rendered export file failed validation.");
        }

        {
            juce::WavAudioFormat wavFormat;
            auto input = tempFile.createInputStream();
            std::unique_ptr<juce::AudioFormatReader> reader(input != nullptr
                ? wavFormat.createReaderFor(input.release(), true)
                : nullptr);
            if (reader == nullptr
                || reader->lengthInSamples <= 0
                || reader->lengthInSamples > totalSamples
                || (int) reader->numChannels != channels
                || (int) std::round(reader->sampleRate) != (int) std::round(sr))
            {
                const auto validationError = reader == nullptr
                    ? juce::String("Rendered export WAV failed reader validation.")
                    : juce::String("Rendered export WAV failed reader validation: samples=")
                        + juce::String(reader->lengthInSamples)
                        + "/" + juce::String(totalSamples)
                        + " channels=" + juce::String((int) reader->numChannels)
                        + "/" + juce::String(channels)
                        + " sampleRate=" + juce::String(reader->sampleRate, 1)
                        + "/" + juce::String(sr, 1);
                tempFile.deleteFile();
                return setError(validationError);
            }
        }

        if (!tempFile.replaceFileIn(outputFile))
        {
            tempFile.deleteFile();
            return setError("Could not finalize exported WAV file.");
        }

        return true;
    }

    bool AudioEngine::renderTrackToWav(Project project,
                                       const Id& trackId,
                                       const juce::File& outputFile,
                                       double sr,
                                       int blockSize,
                                       int channels,
                                       juce::String* error,
                                       RenderProgressCallback progress,
                                       int bitDepth)
    {
        const auto setError = [error](const juce::String& message)
        {
            if (error != nullptr)
                *error = message;
            return false;
        };

        if (trackId.isEmpty())
            return setError("No track selected for render.");

        bool found = false;
        for (auto& track : project.tracks)
        {
            const bool isTarget = track.id == trackId;
            found = found || isTarget;
            track.solo = isTarget;
            track.mute = !isTarget;
        }

        if (!found)
            return setError("Selected track was not found in the project.");

        return renderProjectToWav(std::move(project), outputFile, sr, blockSize, channels, error, std::move(progress), bitDepth);
    }

    int AudioEngine::estimateProjectLatencySamples(const Project& project) noexcept
    {
        int maxTrackLatency = 0;
        for (const auto& track : project.tracks)
        {
            const auto* instrument = findInstrumentDefinition(project, track.instrumentId);
            maxTrackLatency = juce::jmax(
                maxTrackLatency,
                routeEffectsLatencySamples(project, composeRouteEffects(instrument, track.effects)));
        }
        return maxTrackLatency;
    }

    void AudioEngine::shutdown()
    {
        if (device != nullptr)
        {
            removeMidiInputCallbacks();
            device->removeAudioCallback(this);
            device->closeAudioDevice();
            device.reset();
        }
    }

    void AudioEngine::applyProject(Project p)
    {
        normalizeProjectTrackEffects(p);
        applyPluginEffectCapabilities(p);
        normalizeProjectTrackEffects(p);
        bool monitorInput = false;
        float monitorGainDb = 0.0f;
        for (const auto& track : p.tracks)
        {
            if (track.recordArmed && track.inputMonitoring)
            {
                monitorInput = true;
                monitorGainDb = track.recordGainDb;
            }
        }
        setInputMonitoringEnabled(monitorInput, monitorGainDb);
        transportCommands.clear();
        seq.setTempo(p.bpm);
        masterEq.setAutomation(p.eqAutomation);
        masterChainSettings = p.masterChain;
        masterCompressorEnvelope = 0.0f;
        projectLatencySamples = estimateProjectLatencySamples(p);
        rebuildSampleInstruments(p);
    }

    void AudioEngine::setEqAutomation(std::vector<EqAutomationPoint> pts)
    {
        masterEq.setAutomation(std::move(pts));
    }

    void AudioEngine::requestPlay()
    {
        seq.play();
        queueTransportCommand({ TransportCommand::Type::Play, 0.0, 0.0 });
    }

    void AudioEngine::requestPause()
    {
        TransportCommand command { TransportCommand::Type::Pause, 0.0, 0.0 };
        seq.pause();
        if (!tryApplyUrgentTransportCommand(command))
            queueTransportCommand(command);
    }

    void AudioEngine::requestStop()
    {
        TransportCommand command { TransportCommand::Type::Stop, 0.0, 0.0 };
        seq.stop();
        if (!tryApplyUrgentTransportCommand(command))
            queueTransportCommand(command);
    }

    void AudioEngine::requestRestart()
    {
        TransportCommand command { TransportCommand::Type::Restart, 0.0, 0.0 };
        seq.seek(0.0);
        seq.play();
        if (!tryApplyUrgentTransportCommand(command))
            queueTransportCommand(command);
    }

    void AudioEngine::requestSeek(Beats positionBeat)
    {
        TransportCommand command { TransportCommand::Type::Seek, positionBeat, 0.0 };
        seq.seek(positionBeat);
        if (!tryApplyUrgentTransportCommand(command))
            queueTransportCommand(command);
    }

    void AudioEngine::requestSpeed(double speed)
    {
        seq.setSpeed(speed);
        queueTransportCommand({ TransportCommand::Type::Speed, speed, 0.0 });
    }

    void AudioEngine::requestLoop(Beats start, Beats end)
    {
        seq.setLoop(start, end);
        queueTransportCommand({ TransportCommand::Type::SetLoop, start, end });
    }

    void AudioEngine::requestClearLoop()
    {
        seq.clearLoop();
        queueTransportCommand({ TransportCommand::Type::ClearLoop, 0.0, 0.0 });
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

    bool AudioEngine::pullTrackMeterSnapshots(std::vector<TrackMeterSnapshot>& out)
    {
        const juce::ScopedTryLock lock(sampleLock);
        if (!lock.isLocked())
            return false;

        out.clear();
        out.reserve(trackMeterStates.size() + 1);
        const auto append = [this, &out](const TrackMeterState& state)
        {
            const bool isMaster = state.trackId == "master";
            out.push_back({
                state.trackId,
                state.publishedRms.load(std::memory_order_relaxed),
                state.publishedPeak.load(std::memory_order_relaxed),
                state.publishedChannelRms[0].load(std::memory_order_relaxed),
                state.publishedChannelRms[1].load(std::memory_order_relaxed),
                state.publishedChannelPeak[0].load(std::memory_order_relaxed),
                state.publishedChannelPeak[1].load(std::memory_order_relaxed),
                isMaster ? masterLoudnessMeterState.publishedRmsDbFS.load(std::memory_order_relaxed) : -std::numeric_limits<float>::infinity(),
                isMaster ? masterLoudnessMeterState.publishedPeakDbFS.load(std::memory_order_relaxed) : -std::numeric_limits<float>::infinity(),
                isMaster ? masterLoudnessMeterState.publishedTruePeakDbTP.load(std::memory_order_relaxed) : -std::numeric_limits<float>::infinity(),
                isMaster ? masterLoudnessMeterState.publishedMomentaryLufs.load(std::memory_order_relaxed) : -std::numeric_limits<float>::infinity(),
                state.sequence.load(std::memory_order_relaxed),
            });
        };

        append(masterMeterState);
        for (const auto& state : trackMeterStates)
            append(state);
        return true;
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
        out.voiceMs = ticksToMs(renderTimingVoiceTicks.load(std::memory_order_relaxed));
        out.modulationMs = ticksToMs(renderTimingModulationTicks.load(std::memory_order_relaxed));
        out.samplesMs = ticksToMs(renderTimingSamplesTicks.load(std::memory_order_relaxed));
        out.fxMs = ticksToMs(renderTimingFxTicks.load(std::memory_order_relaxed));
        out.filterFxMs = ticksToMs(renderTimingFilterFxTicks.load(std::memory_order_relaxed));
        out.analyzerMs = ticksToMs(renderTimingAnalyzerTicks.load(std::memory_order_relaxed));
        out.copyMs = ticksToMs(renderTimingCopyTicks.load(std::memory_order_relaxed));
        out.totalMs = ticksToMs(renderTimingTotalTicks.load(std::memory_order_relaxed));
        const double blockMs = sampleRate > 0.0 && out.blockSamples > 0
            ? (double) out.blockSamples * 1000.0 / sampleRate
            : 0.0;
        out.loadPercent = blockMs > 0.0 ? juce::jlimit(0.0, 999.0, (out.totalMs / blockMs) * 100.0) : 0.0;
        out.activeSynthVoices = renderTimingActiveSynthVoices.load(std::memory_order_relaxed);
        out.activeSampleVoices = renderTimingActiveSampleVoices.load(std::memory_order_relaxed);
        out.activeAudioClipVoices = renderTimingActiveAudioClipVoices.load(std::memory_order_relaxed);
        out.routeCount = renderTimingRouteCount.load(std::memory_order_relaxed);
        out.automationEventCount = renderTimingAutomationEventCount.load(std::memory_order_relaxed);
        const auto wavetableStats = InstrumentVoice::getWavetableCacheStats();
        out.wavetableCacheHits = wavetableStats.hits;
        out.wavetableCacheMisses = wavetableStats.misses;
        out.wavetableCacheSize = wavetableStats.size;
        out.voiceRenderBlocks = renderTimingVoiceRenderBlocks.load(std::memory_order_relaxed);
        out.voiceRenderSamples = renderTimingVoiceRenderSamples.load(std::memory_order_relaxed);
        out.oscillatorSamples = renderTimingOscillatorSamples.load(std::memory_order_relaxed);
        out.wavetableVoiceSamples = renderTimingWavetableVoiceSamples.load(std::memory_order_relaxed);
        out.aetherOscASamples = renderTimingAetherOscASamples.load(std::memory_order_relaxed);
        out.aetherOscBSamples = renderTimingAetherOscBSamples.load(std::memory_order_relaxed);
        out.aetherSubSamples = renderTimingAetherSubSamples.load(std::memory_order_relaxed);
        out.aetherNoiseSamples = renderTimingAetherNoiseSamples.load(std::memory_order_relaxed);
        out.filterSamples = renderTimingFilterSamples.load(std::memory_order_relaxed);
        out.filterDriveSamples = renderTimingFilterDriveSamples.load(std::memory_order_relaxed);
        out.filterCoefficientUpdates = renderTimingFilterCoefficientUpdates.load(std::memory_order_relaxed);
        out.filterCutoffUpdates = renderTimingFilterCutoffUpdates.load(std::memory_order_relaxed);
        out.filterResonanceUpdates = renderTimingFilterResonanceUpdates.load(std::memory_order_relaxed);
        out.modulationSamples = renderTimingModulationSamples.load(std::memory_order_relaxed);
        out.realtimeRampSamples = renderTimingRealtimeRampSamples.load(std::memory_order_relaxed);
        out.oscillatorRateCalculations = renderTimingOscillatorRateCalculations.load(std::memory_order_relaxed);
        out.wavetableFrequencyUpdates = renderTimingWavetableFrequencyUpdates.load(std::memory_order_relaxed);
        out.wavetablePositionUpdates = renderTimingWavetablePositionUpdates.load(std::memory_order_relaxed);
        out.routeEffectSamples = renderTimingRouteEffectSamples.load(std::memory_order_relaxed);
        out.routeFilterEffectSamples = renderTimingRouteFilterEffectSamples.load(std::memory_order_relaxed);
        out.routeNonlinearEffectSamples = renderTimingRouteNonlinearEffectSamples.load(std::memory_order_relaxed);
        out.routeDelayEffectSamples = renderTimingRouteDelayEffectSamples.load(std::memory_order_relaxed);
        return true;
    }

    bool AudioEngine::prepareInputRecording(double maxDurationSeconds,
                                            int channels,
                                            juce::String* error)
    {
        return inputRecording.prepare(sampleRate, channels, maxDurationSeconds, error);
    }

    void AudioEngine::startInputRecording() noexcept
    {
        inputRecording.start();
    }

    RecordingCaptureStats AudioEngine::stopInputRecording() noexcept
    {
        return inputRecording.stop();
    }

    void AudioEngine::cancelInputRecording() noexcept
    {
        inputRecording.cancel();
    }

    RecordingCaptureStats AudioEngine::inputRecordingStats() const noexcept
    {
        return inputRecording.stats();
    }

    bool AudioEngine::writeInputRecordingToWav(const juce::File& outputFile,
                                               juce::String* error,
                                               int bitDepth) const
    {
        return inputRecording.writeToWav(outputFile, error, bitDepth);
    }

    void AudioEngine::setInputMonitoringEnabled(bool enabled, float gainDb) noexcept
    {
        inputMonitoringGain.store(juce::Decibels::decibelsToGain(gainDb), std::memory_order_relaxed);
        inputMonitoringEnabled.store(enabled, std::memory_order_release);
    }

    bool AudioEngine::isInputMonitoringEnabled() const noexcept
    {
        return inputMonitoringEnabled.load(std::memory_order_acquire);
    }

    bool AudioEngine::injectMidiInputForTesting(const juce::MidiMessage& message)
    {
        return handleMidiExpressionMessage(message);
    }

    void AudioEngine::refreshMidiInputCallbacks()
    {
        if (device == nullptr)
            return;

        removeMidiInputCallbacks();
        const auto inputs = juce::MidiInput::getAvailableDevices();
        enabledMidiInputIdentifiers.reserve((size_t) inputs.size());
        for (const auto& input : inputs)
        {
            if (input.identifier.isEmpty())
                continue;
            device->setMidiInputDeviceEnabled(input.identifier, true);
            device->addMidiInputDeviceCallback(input.identifier, this);
            enabledMidiInputIdentifiers.push_back(input.identifier);
        }
    }

    void AudioEngine::removeMidiInputCallbacks() noexcept
    {
        if (device == nullptr)
            return;

        for (const auto& identifier : enabledMidiInputIdentifiers)
            device->removeMidiInputDeviceCallback(identifier, this);
        enabledMidiInputIdentifiers.clear();
    }

    bool AudioEngine::handleMidiExpressionMessage(const juce::MidiMessage& message)
    {
        std::vector<SynthExpressionActivity> updates;
        {
            const juce::ScopedLock lock(sampleLock);
            if (monitoredMidiExpressionTargets.empty())
                return false;

            updates.reserve(monitoredMidiExpressionTargets.size());
            for (const auto& target : monitoredMidiExpressionTargets)
            {
                auto& notes = activeMidiExpressionNotes[target.instrumentId];
                if (message.isNoteOn())
                {
                    const int channel = message.getChannel();
                    const int noteNumber = message.getNoteNumber();
                    auto found = std::find_if(notes.begin(), notes.end(), [&](const ActiveMidiExpressionNote& note) {
                        return note.channel == channel && note.note == noteNumber;
                    });
                    const ActiveMidiExpressionNote next {
                        channel,
                        noteNumber,
                        juce::jlimit(0.0f, 1.0f, message.getFloatVelocity()),
                        juce::jlimit(0.0f, 1.0f, (float) noteNumber / 127.0f),
                    };
                    if (found != notes.end())
                        *found = next;
                    else
                        notes.push_back(next);
                }
                else if (message.isNoteOff())
                {
                    const int channel = message.getChannel();
                    const int noteNumber = message.getNoteNumber();
                    notes.erase(std::remove_if(notes.begin(), notes.end(), [&](const ActiveMidiExpressionNote& note) {
                        return note.channel == channel && note.note == noteNumber;
                    }), notes.end());
                }
                else if (message.isPitchWheel())
                {
                    const auto normalized = juce::jlimit(
                        -1.0f,
                        1.0f,
                        ((float) message.getPitchWheelValue() - 8192.0f) / 8192.0f);
                    midiExpressionPitchBend[target.instrumentId] = normalized * 2.0f;
                }
                else if (message.isController() && message.getControllerNumber() == 1)
                {
                    midiExpressionModWheel[target.instrumentId] = juce::jlimit(
                        0.0f,
                        1.0f,
                        (float) message.getControllerValue() / 127.0f);
                }
                else
                {
                    continue;
                }
                updates.push_back(midiExpressionSnapshotLocked(target.instrumentId));
            }
        }

        for (const auto& update : updates)
            publishMidiExpressionActivity(update);
        return !updates.empty();
    }

    void AudioEngine::clearNativeMidiExpressionStateLocked(const std::vector<Id>& retainedInstrumentIds)
    {
        const auto isRetained = [&](const Id& instrumentId) {
            return std::find(retainedInstrumentIds.begin(), retainedInstrumentIds.end(), instrumentId)
                != retainedInstrumentIds.end();
        };

        for (auto it = activeMidiExpressionNotes.begin(); it != activeMidiExpressionNotes.end();)
        {
            if (isRetained(it->first))
                ++it;
            else
                it = activeMidiExpressionNotes.erase(it);
        }
        for (auto it = midiExpressionPitchBend.begin(); it != midiExpressionPitchBend.end();)
        {
            if (isRetained(it->first))
                ++it;
            else
                it = midiExpressionPitchBend.erase(it);
        }
        for (auto it = midiExpressionModWheel.begin(); it != midiExpressionModWheel.end();)
        {
            if (isRetained(it->first))
                ++it;
            else
                it = midiExpressionModWheel.erase(it);
        }
    }

    AudioEngine::SynthExpressionActivity AudioEngine::midiExpressionSnapshotLocked(const Id& instrumentId) const
    {
        SynthExpressionActivity activity;
        activity.instrumentId = instrumentId;
        if (const auto found = activeMidiExpressionNotes.find(instrumentId); found != activeMidiExpressionNotes.end())
        {
            activity.activeNotes = (int) found->second.size();
            for (const auto& note : found->second)
            {
                activity.velocity += note.velocity;
                activity.keytrack += note.keytrack;
            }
            if (activity.activeNotes > 0)
            {
                activity.velocity /= (float) activity.activeNotes;
                activity.keytrack /= (float) activity.activeNotes;
            }
        }
        if (const auto found = midiExpressionPitchBend.find(instrumentId); found != midiExpressionPitchBend.end())
            activity.pitchBendSemitones = found->second;
        if (const auto found = midiExpressionModWheel.find(instrumentId); found != midiExpressionModWheel.end())
            activity.modWheel = found->second;
        activity.active = activity.activeNotes > 0
            || std::abs(activity.pitchBendSemitones) > 0.001f
            || activity.modWheel > 0.001f;
        return activity;
    }

    void AudioEngine::publishMidiExpressionActivity(const SynthExpressionActivity& activity) const
    {
        if (onSynthExpressionActivity)
            onSynthExpressionActivity(activity);
    }

    void AudioEngine::stopAllNotes(bool allowTailOff)
    {
        const juce::ScopedLock lock(sampleLock);
        resetRuntimeStateLocked(allowTailOff);
    }

    void AudioEngine::resetRouteRuntimeLocked(InstrumentRenderState& route, bool allowTailOff) noexcept
    {
        if (route.synth != nullptr)
            route.synth->allNotesOff(0, allowTailOff);

        route.midi.clear();
        route.noteAutomationContextCount = 0;
        route.gainDb = route.baseGainDb;
        route.pan = route.basePan;
        route.inputTrimDb = route.baseInputTrimDb;
        route.mute = route.baseMute;
        route.sends = route.baseSends;
        route.effects = route.baseEffects;

        for (auto& filter : route.filterStates)
        {
            if (filter != nullptr)
                filter->reset();
        }

        for (auto& reverb : route.reverbStates)
        {
            if (reverb != nullptr)
                reverb->reset();
        }

        for (auto& delay : route.delayStates)
        {
            if (delay != nullptr)
            {
                delay->buffer.clear();
                delay->writePosition = 0;
            }
        }

        for (auto& delay : route.pluginLatencyStates)
        {
            if (delay != nullptr)
            {
                delay->buffer.clear();
                delay->writePosition = 0;
            }
        }

        for (auto& bitcrush : route.bitcrushStates)
        {
            std::fill(bitcrush.heldSamples.begin(), bitcrush.heldSamples.end(), 0.0f);
            bitcrush.holdCounter = 0;
        }

        for (auto& chorus : route.chorusStates)
        {
            if (chorus != nullptr)
            {
                chorus->buffer.clear();
                chorus->writePosition = 0;
                chorus->phase = 0.0f;
            }
        }

        for (auto& phaser : route.phaserStates)
        {
            if (phaser != nullptr)
            {
                for (auto& stages : phaser->x1)
                    stages.fill(0.0f);
                for (auto& stages : phaser->y1)
                    stages.fill(0.0f);
                std::fill(phaser->feedback.begin(), phaser->feedback.end(), 0.0f);
                phaser->phase = 0.0f;
            }
        }

        if (route.compensationDelayState != nullptr)
        {
            route.compensationDelayState->buffer.clear();
            route.compensationDelayState->writePosition = 0;
        }
        for (auto& delay : route.sendCompensationStates)
            if (delay != nullptr)
            {
                delay->buffer.clear();
                delay->writePosition = 0;
            }

        for (auto& compressor : route.compressorStates)
            compressor.envelope = 0.0f;

        if (route.returnBuffer.getNumSamples() > 0)
            route.returnBuffer.clear();
        if (route.groupBuffer.getNumSamples() > 0)
            route.groupBuffer.clear();
    }

    void AudioEngine::resetRuntimeStateLocked(bool allowTailOff) noexcept
    {
        synth.allNotesOff(0, allowTailOff);
        for (auto& route : instrumentRenderStates)
            resetRouteRuntimeLocked(route, allowTailOff);
        for (auto& route : groupRenderStates)
            resetRouteRuntimeLocked(route, allowTailOff);
        for (auto& route : returnRenderStates)
            resetRouteRuntimeLocked(route, allowTailOff);

        pendingNoteOffs.clear();
        pendingParameterAutomation.clear();
        blockRealtimeParameterEvents.clear();
        blockRouteParameterEvents.clear();
        realtimeParameterChanges.clear();
        defaultNoteAutomationContextCount = 0;
        activeSampleVoices.clear();
        activeAudioClipVoices.clear();
        resetMasterLoudnessMeter();
    }

    bool AudioEngine::queueTransportCommand(TransportCommand command) noexcept
    {
        if (transportCommands.push(command))
            return true;

        transportCommands.clear();
        if (transportCommands.push(command))
            return false;

        const juce::ScopedLock lock(sampleLock);
        applyTransportCommandLocked(command);
        return false;
    }

    bool AudioEngine::tryApplyUrgentTransportCommand(TransportCommand command) noexcept
    {
        const juce::ScopedTryLock lock(sampleLock);
        if (!lock.isLocked())
            return false;

        transportCommands.clear();
        applyTransportCommandLocked(command);
        return true;
    }

    void AudioEngine::applyTransportCommandLocked(const TransportCommand& command) noexcept
    {
        switch (command.type)
        {
            case TransportCommand::Type::Play:
                seq.play();
                break;

            case TransportCommand::Type::Pause:
                seq.pause();
                resetRuntimeStateLocked(false);
                break;

            case TransportCommand::Type::Stop:
                seq.stop();
                resetRuntimeStateLocked(false);
                break;

            case TransportCommand::Type::Restart:
                resetRuntimeStateLocked(false);
                seq.seek(0.0);
                seq.play();
                break;

            case TransportCommand::Type::Seek:
                resetRuntimeStateLocked(false);
                seq.seek(command.valueA);
                break;

            case TransportCommand::Type::Speed:
                seq.setSpeed(command.valueA);
                break;

            case TransportCommand::Type::SetLoop:
                seq.setLoop(command.valueA, command.valueB);
                break;

            case TransportCommand::Type::ClearLoop:
                seq.clearLoop();
                break;
        }
    }

    void AudioEngine::drainTransportCommandsLocked() noexcept
    {
        TransportCommand command;
        int drained = 0;
        bool hasSeek = false;
        Beats latestSeek = 0.0;
        bool hasTerminal = false;
        TransportCommand terminalCommand;

        while (drained < 512 && transportCommands.pop(command))
        {
            switch (command.type)
            {
                case TransportCommand::Type::Seek:
                    hasSeek = true;
                    latestSeek = command.valueA;
                    break;

                case TransportCommand::Type::Play:
                case TransportCommand::Type::Pause:
                    hasTerminal = true;
                    terminalCommand = command;
                    break;

                case TransportCommand::Type::Stop:
                    hasSeek = true;
                    latestSeek = 0.0;
                    hasTerminal = true;
                    terminalCommand = { TransportCommand::Type::Pause, 0.0, 0.0 };
                    break;

                case TransportCommand::Type::Restart:
                    hasSeek = true;
                    latestSeek = 0.0;
                    hasTerminal = true;
                    terminalCommand = { TransportCommand::Type::Play, 0.0, 0.0 };
                    break;

                case TransportCommand::Type::Speed:
                case TransportCommand::Type::SetLoop:
                case TransportCommand::Type::ClearLoop:
                    applyTransportCommandLocked(command);
                    break;
            }
            ++drained;
        }

        if (hasSeek || (hasTerminal && terminalCommand.type == TransportCommand::Type::Pause))
        {
            resetRuntimeStateLocked(false);
            if (hasSeek)
                seq.seek(latestSeek);
            if (hasTerminal)
            {
                if (terminalCommand.type == TransportCommand::Type::Play)
                    seq.play();
                else
                    seq.pause();
            }
            return;
        }

        if (hasTerminal)
            applyTransportCommandLocked(terminalCommand);
    }

    std::unique_ptr<juce::Synthesiser> AudioEngine::createInstrumentSynth(const InstrumentDefinition& instrument)
    {
        auto instrumentSynth = std::make_unique<juce::Synthesiser>();
        instrumentSynth->addSound(new PassSound());

        if (instrument.nodeGraph)
        {
            const auto allocation = VoiceAllocation::policyFor(instrument.maxVoices, instrument.mono, instrument.legato);
            instrumentSynth->setNoteStealingEnabled(allocation.noteStealing);
            for (int i = 0; i < allocation.voiceCount; ++i)
            {
                auto* voice = new NodemapVoice();
                voice->prepare(sampleRate);
                voice->setGraph(*instrument.nodeGraph);
                instrumentSynth->addVoice(voice);
            }
            instrumentSynth->setCurrentPlaybackSampleRate(sampleRate);
            return instrumentSynth;
        }

        InstrumentVoice::Params params;
        const auto copyWavetable = [](const InstrumentDefinition::WavetableConfig& source)
        {
            InstrumentVoice::Params::WavetableConfig target;
            target.bank = source.bank;
            target.custom = source.custom;
            target.position = source.position;
            target.warp = source.warp;
            target.warpMode = source.warpMode;
            target.smoothInterpolation = source.smoothInterpolation;
            target.morph = source.morph;
            target.unison = source.unison;
            target.detuneCents = source.detuneCents;
            target.blend = source.blend;
            for (size_t i = 0; i < target.customFrames.size(); ++i)
            {
                target.customFrames[i] = {
                    source.customFrames[i].brightness,
                    source.customFrames[i].even,
                    source.customFrames[i].fold,
                    source.customFrames[i].formant,
                    source.customFrames[i].notch,
                    source.customFrames[i].skew,
                    source.customFrames[i].tilt,
                    source.customFrames[i].focus,
                    source.customFrames[i].phase,
                };
                target.customFrames[i].partials = source.customFrames[i].partials;
            }
            return target;
        };

        params.cutoff01 = instrument.cutoff01;
        params.filterKeytrack = instrument.filterKeytrack;
        params.resonance01 = instrument.resonance01;
        params.drive01 = instrument.drive01;
        params.color01 = instrument.color01;
        params.filterType = instrument.filterType;
        params.attackMs = instrument.attackMs;
        params.attackCurve = instrument.attackCurve;
        params.decayMs = instrument.decayMs;
        params.decayCurve = instrument.decayCurve;
        params.sustain = instrument.sustain;
        params.releaseMs = instrument.releaseMs;
        params.releaseCurve = instrument.releaseCurve;
        params.env1Loop = instrument.env1Loop;
        params.env2AttackMs = instrument.env2AttackMs;
        params.env2AttackCurve = instrument.env2AttackCurve;
        params.env2DecayMs = instrument.env2DecayMs;
        params.env2DecayCurve = instrument.env2DecayCurve;
        params.env2Sustain = instrument.env2Sustain;
        params.env2ReleaseMs = instrument.env2ReleaseMs;
        params.env2ReleaseCurve = instrument.env2ReleaseCurve;
        params.env2Loop = instrument.env2Loop;
        params.ampLevel = instrument.ampLevel;
        params.ampPan = instrument.ampPan;
        params.glideMs = juce::jlimit(0.0f, 5000.0f, instrument.glideMs);
        const auto allocation = VoiceAllocation::policyFor(instrument.maxVoices, instrument.mono, instrument.legato);
        params.mono = allocation.mono;
        params.legato = allocation.legato;
        params.maxVoices = allocation.voiceCount;
        params.waveform = instrument.waveform;
        params.wavetableBank = instrument.wavetableBank;
        params.wavetablePosition = instrument.wavetablePosition;
        params.wavetableWarp = instrument.wavetableWarp;
        params.wavetableWarpMode = instrument.wavetableWarpMode;
        params.wavetableUnison = instrument.wavetableUnison;
        params.wavetableDetuneCents = instrument.wavetableDetuneCents;
        params.wavetableBlend = instrument.wavetableBlend;
        params.lfoWaveform = instrument.lfoWaveform;
        params.lfoRateHz = effectiveLfoRateHz(instrument.lfoRateHz, instrument.lfoSync, instrument.lfoSyncedRate, seq.getTempo());
        params.lfoDepth = instrument.lfoDepth;
        params.lfoSmoothing = juce::jlimit(0.0f, 1.0f, instrument.lfoSmoothing);
        params.lfoRandomPhase = juce::jlimit(0.0f, 1.0f, instrument.lfoRandomPhase);
        params.lfoPhaseOffset = juce::jlimit(0.0f, 1.0f, instrument.lfoPhaseOffset);
        params.lfoRetrigger = instrument.lfoRetrigger;
        params.lfoOneShot = instrument.lfoOneShot;
        params.lfo2Enabled = instrument.lfo2Enabled;
        params.lfo2Waveform = instrument.lfo2Waveform;
        params.lfo2RateHz = effectiveLfoRateHz(instrument.lfo2RateHz, instrument.lfo2Sync, instrument.lfo2SyncedRate, seq.getTempo());
        params.lfo2Smoothing = juce::jlimit(0.0f, 1.0f, instrument.lfo2Smoothing);
        params.lfo2RandomPhase = juce::jlimit(0.0f, 1.0f, instrument.lfo2RandomPhase);
        params.lfo2PhaseOffset = juce::jlimit(0.0f, 1.0f, instrument.lfo2PhaseOffset);
        params.lfo2Retrigger = instrument.lfo2Retrigger;
        params.lfo2OneShot = instrument.lfo2OneShot;
        params.lfoPositionBipolar = instrument.lfoPositionBipolar;
        params.lfoPitchBipolar = instrument.lfoPitchBipolar;
        params.lfoFilterBipolar = instrument.lfoFilterBipolar;
        params.lfoToPitch = instrument.lfoToPitch;
        params.lfoToFilter = instrument.lfoToFilter;
        params.envToFilter = instrument.envToFilter;
        params.macroValues = instrument.macroValues;
        const auto copyDynamicTarget = [](const InstrumentDefinition::DynamicModTarget& source)
        {
            InstrumentVoice::Params::DynamicModTarget target;
            target.lfo = source.lfo;
            target.lfoBipolar = source.lfoBipolar;
            target.lfo2 = source.lfo2;
            target.lfo2Bipolar = source.lfo2Bipolar;
            target.env = source.env;
            target.envBipolar = source.envBipolar;
            target.env2 = source.env2;
            target.env2Bipolar = source.env2Bipolar;
            target.velocity = source.velocity;
            target.velocityBipolar = source.velocityBipolar;
            target.keytrack = source.keytrack;
            target.keytrackBipolar = source.keytrackBipolar;
            target.modWheel = source.modWheel;
            target.modWheelBipolar = source.modWheelBipolar;
            target.macro1 = source.macro1;
            target.macro2 = source.macro2;
            target.macro3 = source.macro3;
            target.macro4 = source.macro4;
            return target;
        };
        params.dynamicModulation.active = instrument.dynamicModulation.active;
        params.dynamicModulation.oscAPosition = copyDynamicTarget(instrument.dynamicModulation.oscAPosition);
        params.dynamicModulation.oscAFine = copyDynamicTarget(instrument.dynamicModulation.oscAFine);
        params.dynamicModulation.oscALevel = copyDynamicTarget(instrument.dynamicModulation.oscALevel);
        params.dynamicModulation.oscAPan = copyDynamicTarget(instrument.dynamicModulation.oscAPan);
        params.dynamicModulation.oscBPosition = copyDynamicTarget(instrument.dynamicModulation.oscBPosition);
        params.dynamicModulation.oscBFine = copyDynamicTarget(instrument.dynamicModulation.oscBFine);
        params.dynamicModulation.oscBLevel = copyDynamicTarget(instrument.dynamicModulation.oscBLevel);
        params.dynamicModulation.oscBPan = copyDynamicTarget(instrument.dynamicModulation.oscBPan);
        params.dynamicModulation.filterCutoff = copyDynamicTarget(instrument.dynamicModulation.filterCutoff);
        params.dynamicModulation.filterResonance = copyDynamicTarget(instrument.dynamicModulation.filterResonance);
        params.dynamicModulation.filterDrive = copyDynamicTarget(instrument.dynamicModulation.filterDrive);
        params.dynamicModulation.ampLevel = copyDynamicTarget(instrument.dynamicModulation.ampLevel);
        params.dynamicModulation.ampPan = copyDynamicTarget(instrument.dynamicModulation.ampPan);
        params.dynamicModulation.unisonDetune = copyDynamicTarget(instrument.dynamicModulation.unisonDetune);
        params.dynamicModulation.unisonSpread = copyDynamicTarget(instrument.dynamicModulation.unisonSpread);
        params.wavetable = copyWavetable({
            instrument.wavetableBank,
            instrument.wavetableBank == 5,
            instrument.wavetablePosition,
            instrument.wavetableWarp,
            instrument.wavetableWarpMode,
            false,
            0.0f,
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
            instrument.aether.oscA.phase,
            instrument.aether.oscA.randomPhase,
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
            instrument.aether.oscB.phase,
            instrument.aether.oscB.randomPhase,
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
        params.aetherRuntimeWarp = juce::jlimit(0.0f, 1.0f, instrument.aether.runtimeWarp);
        params.aetherRuntimeWarpMode = juce::jlimit(0, 3, instrument.aether.runtimeWarpMode);
        params.hasAurum = instrument.hasAurum;
        for (size_t index = 0; index < params.aurumOperators.size(); ++index)
        {
            const auto& source = instrument.aurum.operators[index];
            params.aurumOperators[index] = {
                source.enabled,
                source.waveform,
                source.ratio,
                source.coarse,
                source.fineCents,
                source.level,
                source.phase,
                source.attackMs,
                source.decayMs,
                source.sustain,
                source.releaseMs,
                source.harmonics,
                source.wavefold,
                source.pitchAttackMs,
                source.pitchDecayMs,
                source.pitchSustain,
                source.pitchReleaseMs,
                source.pitchEnvelopeSemitones,
                source.phaseAttackMs,
                source.phaseDecayMs,
                source.phaseSustain,
                source.phaseReleaseMs,
                source.phaseEnvelopeDegrees,
                source.velocityCurve,
                source.keytrackCurve,
            };
            params.aurumMatrix[index] = instrument.aurum.matrix[index];
            params.aurumRmMatrix[index] = instrument.aurum.rmMatrix[index];
        }
        params.aurumUnison = juce::jlimit(1, 8, instrument.aurum.unison);
        params.aurumDetuneCents = juce::jlimit(0.0f, 100.0f, instrument.aurum.detuneCents);
        params.aurumStereoSpread = juce::jlimit(0.0f, 1.0f, instrument.aurum.stereoSpread);
        params.aurumOversampling = instrument.aurum.oversampling >= 4 ? 4 : instrument.aurum.oversampling >= 2 ? 2 : 1;
        for (size_t index = 0; index < params.aurumFilters.size(); ++index)
        {
            const auto& source = instrument.aurum.filters[index];
            params.aurumFilters[index] = {
                source.enabled,
                juce::jlimit(0, 2, source.type),
                juce::jlimit(0.0f, 1.0f, source.cutoff01),
                juce::jlimit(0.0f, 1.0f, source.resonance01),
                juce::jlimit(0.0f, 1.0f, source.drive01),
            };
        }
        params.aurumFilterRouting = instrument.aurum.filterRouting == 1 ? 1 : 0;

        instrumentSynth->setNoteStealingEnabled(allocation.noteStealing);
        for (int i = 0; i < allocation.voiceCount; ++i)
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
        std::map<juce::String, std::shared_ptr<SampleBuffer>> nextAudioFiles;
        std::vector<InstrumentRenderState> nextRenderStates;
        std::map<juce::String, const InstrumentDefinition*> instrumentById;
        std::map<juce::String, std::shared_ptr<SampleBuffer>> loadedBufferCache;

        const auto loadBuffer = [&](const juce::String& path) -> std::shared_ptr<SampleBuffer>
        {
            if (path.isEmpty() || path.startsWith("data:")) return nullptr;
            const auto file = resolveAudioPath(path);
            if (!file.existsAsFile()) return nullptr;
            const auto cacheKey = file.getFullPathName();
            if (auto found = loadedBufferCache.find(cacheKey); found != loadedBufferCache.end())
                return found->second;

            std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
            if (reader == nullptr || !canLoadReaderIntoAudioBuffer(*reader)) return nullptr;

            auto sample = std::make_shared<SampleBuffer>();
            sample->sourceSampleRate = reader->sampleRate > 0.0 ? reader->sampleRate : sampleRate;
            sample->audio.setSize((int) reader->numChannels, (int) reader->lengthInSamples);
            reader->read(&sample->audio, 0, (int) reader->lengthInSamples, 0, true, true);
            loadedBufferCache[cacheKey] = sample;
            return sample;
        };

        for (const auto& file : project.audioFiles)
        {
            if (file.id.isEmpty()) continue;
            if (auto buffer = loadBuffer(file.path))
                nextAudioFiles[file.id] = std::move(buffer);
        }

        for (const auto& instrument : project.instruments)
        {
            if (instrument.id.isNotEmpty())
                instrumentById[instrument.id] = &instrument;
            if (instrument.sampleUrls.isEmpty() && instrument.sampleZones.empty()) continue;
            SampleInstrument sampleInstrument;
            const bool hasDefaultSynthEnvelope = std::abs(instrument.attackMs - 5.0f) < 0.001f
                && std::abs(instrument.releaseMs - 200.0f) < 0.001f;
            sampleInstrument.attackMs = hasDefaultSynthEnvelope
                ? 1.0f
                : juce::jlimit(0.0f, 2000.0f, instrument.attackMs);
            sampleInstrument.releaseMs = hasDefaultSynthEnvelope
                ? 60.0f
                : juce::jlimit(0.0f, 5000.0f, instrument.releaseMs);
            std::map<juce::String, std::shared_ptr<SampleBuffer>> loadedSamples;

            for (const auto& url : instrument.sampleUrls)
            {
                if (auto sample = loadBuffer(url))
                    loadedSamples[url] = std::move(sample);
            }

            if (!instrument.sampleZones.empty())
            {
                for (const auto& zone : instrument.sampleZones)
                {
                    auto foundSample = loadedSamples.find(zone.path);
                    if (foundSample == loadedSamples.end())
                    {
                        if (auto sample = loadBuffer(zone.path))
                        {
                            loadedSamples[zone.path] = std::move(sample);
                            foundSample = loadedSamples.find(zone.path);
                        }
                    }
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
                        zone.loopEnabled,
                        zone.loopStart,
                        zone.loopEnd,
                        zone.oneShot,
                        zone.durationSeconds,
                        zone.loLengthSeconds,
                        zone.hiLengthSeconds,
                        zone.chokeGroup,
                        zone.startSample,
                        zone.endSample,
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
                        false,
                        0,
                        0,
                        false,
                        0.0,
                        0.0,
                        0.0,
                        0,
                        0,
                        0,
                    });
                }
            }

            if (!sampleInstrument.zones.empty())
            {
                std::stable_sort(sampleInstrument.zones.begin(),
                                 sampleInstrument.zones.end(),
                                 [](const SampleInstrument::Zone& a, const SampleInstrument::Zone& b) {
                                     return a.seqPosition < b.seqPosition;
                                 });
                next[instrument.id] = std::move(sampleInstrument);
            }
        }

        nextRenderStates.reserve(project.tracks.size());
        std::vector<InstrumentRenderState> nextGroupStates;
        nextGroupStates.reserve(project.tracks.size());
        std::vector<InstrumentRenderState> nextReturnStates;
        nextReturnStates.reserve(project.returnBuses.size());
        std::vector<TrackMeterState> nextMeterStates;
        nextMeterStates.reserve(project.tracks.size());
        std::vector<MonitoredMidiExpressionTarget> nextMidiExpressionTargets;
        std::vector<Id> retainedMidiExpressionInstrumentIds;
        const bool anyAudioBusSolo = std::any_of(project.returnBuses.begin(), project.returnBuses.end(),
                                                 [](const ReturnBus& bus) { return bus.solo; });
        for (const auto& track : project.tracks)
        {
            if (track.id.isNotEmpty())
                nextMeterStates.emplace_back(track.id);

            if (track.kind == TrackKind::Group)
            {
                InstrumentRenderState route;
                route.trackId = track.id;
                route.parentTrackId = track.parentTrackId;
                route.outputBusId = track.outputBusId;
                route.outputEnabled = track.outputEnabled;
                route.mute = track.mute;
                route.gainDb = track.gainDb;
                route.pan = track.pan;
                route.effects = track.effects;
                route.sends = track.sends;
                if (anyAudioBusSolo)
                {
                    for (auto& send : route.sends)
                        send.enabled = send.enabled && routeFeedsSoloTarget(project, send.busId);
                    const bool primaryFeedsSolo = route.outputBusId.isNotEmpty() && routeFeedsSoloTarget(project, route.outputBusId);
                    route.outputEnabled = route.outputEnabled && primaryFeedsSolo;
                    route.audible = primaryFeedsSolo || std::any_of(route.sends.begin(), route.sends.end(),
                                                                   [](const TrackSend& send) { return send.enabled; });
                }
                route.baseGainDb = track.gainDb;
                route.basePan = track.pan;
                route.baseMute = track.mute;
                route.baseSends = route.sends;
                route.baseEffects = track.effects;
                route.groupBus = true;
                route.groupBuffer.setSize(routeBuf.getNumChannels(), routeBuf.getNumSamples(), false, false, true);
                route.groupBuffer.clear();
                route.routeLatencySamples = routeEffectsLatencySamples(project, route.effects);
                nextGroupStates.push_back(std::move(route));
                continue;
            }

            InstrumentRenderState route;
            route.trackId = track.id;
            route.instrumentId = track.instrumentId;
            route.parentTrackId = track.parentTrackId;
            route.outputBusId = track.outputBusId;
            route.outputEnabled = track.outputEnabled;
            route.mute = track.mute;
            route.gainDb = track.gainDb;
            route.pan = track.pan;

            const InstrumentDefinition* routeInstrument = nullptr;
            if (track.instrumentId.isNotEmpty())
            {
                const auto foundInstrument = instrumentById.find(track.instrumentId);
                if (foundInstrument != instrumentById.end())
                    routeInstrument = foundInstrument->second;
            }

            if ((track.kind == TrackKind::Midi || track.kind == TrackKind::Mixed)
                && (track.recordArmed || track.inputMonitoring)
                && routeInstrument != nullptr
                && isMidiExpressionInstrument(*routeInstrument))
            {
                const bool duplicate = std::any_of(
                    nextMidiExpressionTargets.begin(),
                    nextMidiExpressionTargets.end(),
                    [&](const MonitoredMidiExpressionTarget& target) {
                        return target.instrumentId == track.instrumentId;
                    });
                if (!duplicate)
                {
                    nextMidiExpressionTargets.push_back({ track.id, track.instrumentId });
                    retainedMidiExpressionInstrumentIds.push_back(track.instrumentId);
                }
            }

            route.effects = composeRouteEffects(routeInstrument, track.effects);
            route.sends = track.sends;
            if (anyAudioBusSolo)
            {
                for (auto& send : route.sends)
                    send.enabled = send.enabled && routeFeedsSoloTarget(project, send.busId);
                const bool primaryFeedsSolo = route.outputBusId.isNotEmpty() && routeFeedsSoloTarget(project, route.outputBusId);
                route.outputEnabled = route.outputEnabled && primaryFeedsSolo;
                route.audible = primaryFeedsSolo || std::any_of(route.sends.begin(), route.sends.end(),
                                                               [](const TrackSend& send) { return send.enabled; });
            }
            route.baseGainDb = track.gainDb;
            route.basePan = track.pan;
            route.baseMute = track.mute;
            route.baseSends = route.sends;
            route.baseEffects = route.effects;
            route.routeLatencySamples = routeEffectsLatencySamples(project, route.effects);

            if (routeInstrument != nullptr)
                route.synth = createInstrumentSynth(*routeInstrument);

            nextRenderStates.push_back(std::move(route));
        }

        for (const auto* busPtr : orderedAudioBuses(project))
        {
            const auto& bus = *busPtr;

            InstrumentRenderState route;
            route.trackId = bus.id;
            route.outputBusId = bus.outputBusId;
            route.outputEnabled = bus.outputEnabled;
            route.inputTrimDb = bus.inputTrimDb;
            route.mute = bus.mute;
            route.gainDb = bus.gainDb;
            route.pan = bus.pan;
            route.effects = bus.effects;
            route.sends = bus.sends;
            if (anyAudioBusSolo)
            {
                route.audible = busIsOnSoloPath(project, bus.id);
                for (auto& send : route.sends)
                    send.enabled = send.enabled && busIsOnSoloPath(project, send.busId);
                if (route.outputBusId.isNotEmpty())
                    route.outputEnabled = route.outputEnabled && busIsOnSoloPath(project, route.outputBusId);
                else
                    route.outputEnabled = route.outputEnabled && busIsSoloOrDownstream(project, bus.id);
            }
            route.baseGainDb = bus.gainDb;
            route.basePan = bus.pan;
            route.baseInputTrimDb = bus.inputTrimDb;
            route.baseMute = bus.mute;
            route.baseSends = route.sends;
            route.baseEffects = bus.effects;
            route.routeLatencySamples = routeEffectsLatencySamples(project, route.effects);
            route.returnBus = true;
            route.returnBuffer.setSize(routeBuf.getNumChannels(), routeBuf.getNumSamples(), false, false, true);
            route.returnBuffer.clear();
            nextReturnStates.push_back(std::move(route));
            nextMeterStates.emplace_back(bus.id);
        }

        std::map<Id, int> busInputLatency;
        std::map<Id, int> busOutputLatency;
        const auto routeSendsTo = [](const InstrumentRenderState& route, const Id& busId) {
            return std::any_of(route.sends.begin(), route.sends.end(), [&](const TrackSend& send) {
                return send.enabled && send.busId == busId;
            });
        };
        for (auto& bus : nextReturnStates)
        {
            int inputLatency = 0;
            for (const auto& track : nextRenderStates)
                if ((track.outputEnabled && track.outputBusId == bus.trackId) || routeSendsTo(track, bus.trackId))
                    inputLatency = juce::jmax(inputLatency, track.routeLatencySamples);
            for (const auto& group : nextGroupStates)
                if ((group.outputEnabled && group.outputBusId == bus.trackId) || routeSendsTo(group, bus.trackId))
                    inputLatency = juce::jmax(inputLatency, group.routeLatencySamples);
            for (const auto& source : nextReturnStates)
            {
                const auto found = busOutputLatency.find(source.trackId);
                if (found == busOutputLatency.end()) continue;
                if ((source.outputEnabled && source.outputBusId == bus.trackId) || routeSendsTo(source, bus.trackId))
                    inputLatency = juce::jmax(inputLatency, found->second);
            }
            busInputLatency[bus.trackId] = inputLatency;
            busOutputLatency[bus.trackId] = inputLatency + bus.routeLatencySamples;
        }

        int masterInputLatency = 0;
        for (const auto& track : nextRenderStates)
            if (track.outputEnabled && track.outputBusId.isEmpty() && track.parentTrackId.isEmpty())
                masterInputLatency = juce::jmax(masterInputLatency, track.routeLatencySamples);
        for (const auto& group : nextGroupStates)
            if (group.outputEnabled && group.outputBusId.isEmpty() && group.parentTrackId.isEmpty())
                masterInputLatency = juce::jmax(masterInputLatency, group.routeLatencySamples);
        for (const auto& bus : nextReturnStates)
            if (bus.outputEnabled && bus.outputBusId.isEmpty())
                masterInputLatency = juce::jmax(masterInputLatency, busOutputLatency[bus.trackId]);
        projectLatencySamples = masterInputLatency;

        const auto configureCompensation = [&](InstrumentRenderState& route, int sourceLatency) {
            const auto destination = route.outputBusId.isNotEmpty()
                ? busInputLatency.find(route.outputBusId)
                : busInputLatency.end();
            const int outputTargetLatency = destination != busInputLatency.end()
                ? destination->second
                : masterInputLatency;
            route.routeCompensationSamples = route.outputEnabled
                ? juce::jmax(0, outputTargetLatency - sourceLatency)
                : 0;
            route.sendCompensationSamples.clear();
            route.sendCompensationSamples.reserve(route.sends.size());
            for (const auto& send : route.sends)
            {
                const auto target = busInputLatency.find(send.busId);
                route.sendCompensationSamples.push_back(target == busInputLatency.end()
                    ? 0
                    : juce::jmax(0, target->second - sourceLatency));
            }
        };
        for (auto& route : nextRenderStates)
        {
            configureCompensation(route, route.routeLatencySamples);
            prepareRouteEffects(route);
        }
        for (auto& route : nextGroupStates)
        {
            configureCompensation(route, route.routeLatencySamples);
            prepareRouteEffects(route);
        }
        for (auto& route : nextReturnStates)
        {
            configureCompensation(route, busOutputLatency[route.trackId]);
            prepareRouteEffects(route);
        }

        const juce::ScopedLock lock(sampleLock);
        sampleInstruments = std::move(next);
        audioFileBuffers = std::move(nextAudioFiles);
        instrumentRenderStates = std::move(nextRenderStates);
        groupRenderStates = std::move(nextGroupStates);
        returnRenderStates = std::move(nextReturnStates);
        trackMeterStates = std::move(nextMeterStates);
        Project sequencerProject = project;
        for (const auto& bus : project.returnBuses)
        {
            for (const auto& lane : bus.automation)
                sequencerProject.automation.push_back({ bus.id, {}, lane.target, lane.points });
            for (const auto& effect : bus.effects)
                for (const auto& lane : effect.automation)
                    sequencerProject.automation.push_back({
                        bus.id,
                        {},
                        juce::String("effect.") + effect.id + "." + lane.target,
                        lane.points,
                    });
        }
        seq.setProject(sequencerProject);
        activeSampleVoices.clear();
        activeAudioClipVoices.clear();
        pendingNoteOffs.clear();
        pendingParameterAutomation.clear();
        blockRealtimeParameterEvents.clear();
        blockRouteParameterEvents.clear();
        realtimeParameterChanges.clear();
        defaultNoteAutomationContextCount = 0;
        monitoredMidiExpressionTargets = std::move(nextMidiExpressionTargets);
        clearNativeMidiExpressionStateLocked(retainedMidiExpressionInstrumentIds);
        synth.allNotesOff(0, false);
        for (auto& route : returnRenderStates)
            route.returnBuffer.clear();
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
                if (state.synth != nullptr
                    && state.trackId == trackId
                    && (instrumentId.isEmpty() || state.instrumentId == instrumentId))
                    return &state;
            }
        }

        return findInstrumentRenderState(instrumentId);
    }

    AudioEngine::InstrumentRenderState* AudioEngine::findTrackRouteState(const Id& trackId)
    {
        if (trackId.isEmpty()) return nullptr;
        for (auto& state : instrumentRenderStates)
        {
            if (state.trackId == trackId)
                return &state;
        }
        for (auto& state : groupRenderStates)
        {
            if (state.trackId == trackId)
                return &state;
        }
        return nullptr;
    }

    AudioEngine::InstrumentRenderState* AudioEngine::findGroupRenderState(const Id& trackId)
    {
        if (trackId.isEmpty()) return nullptr;
        for (auto& state : groupRenderStates)
        {
            if (state.trackId == trackId)
                return &state;
        }
        return nullptr;
    }

    AudioEngine::InstrumentRenderState* AudioEngine::findReturnBusRenderState(const Id& busId)
    {
        if (busId.isEmpty()) return nullptr;
        for (auto& state : returnRenderStates)
            if (state.trackId == busId) return &state;
        return nullptr;
    }

    AudioEngine::TrackMeterState* AudioEngine::findTrackMeterState(const Id& trackId) noexcept
    {
        if (trackId.isEmpty()) return nullptr;
        for (auto& state : trackMeterStates)
        {
            if (state.trackId == trackId)
                return &state;
        }
        return nullptr;
    }

    void AudioEngine::resetTrackMetersLocked() noexcept
    {
        masterMeterState.sumSquares = 0.0;
        masterMeterState.channelSumSquares.fill(0.0);
        masterMeterState.sampleCount = 0;
        masterMeterState.channelSampleCounts.fill(0);
        masterMeterState.blockPeak = 0.0f;
        masterMeterState.channelBlockPeaks.fill(0.0f);
        for (auto& state : trackMeterStates)
        {
            state.sumSquares = 0.0;
            state.channelSumSquares.fill(0.0);
            state.sampleCount = 0;
            state.channelSampleCounts.fill(0);
            state.blockPeak = 0.0f;
            state.channelBlockPeaks.fill(0.0f);
        }
    }

    void AudioEngine::prepareMasterLoudnessMeter(int channels)
    {
        auto& state = masterLoudnessMeterState;
        state.channelCount = juce::jlimit(1, 2, channels);
        const int momentarySamples = juce::jmax(1, (int) std::round(sampleRate * 0.4));
        state.momentaryPowerRing.assign((size_t) momentarySamples, 0.0);

        for (int channel = 0; channel < 2; ++channel)
        {
            state.shelfFilters[(size_t) channel] = makeLiveMeterBiquad<LiveMeterBiquadState>("highshelf",
                                                                                              sampleRate,
                                                                                              1681.9744509555319,
                                                                                              0.7071752369554196,
                                                                                              3.999843853973347);
            state.highpassFilters[(size_t) channel] = makeLiveMeterBiquad<LiveMeterBiquadState>("highpass",
                                                                                                 sampleRate,
                                                                                                 38.13547087602444,
                                                                                                 0.5003270373238773);
        }

        resetMasterLoudnessMeter();
    }

    void AudioEngine::resetMasterLoudnessMeter() noexcept
    {
        auto& state = masterLoudnessMeterState;
        state.momentaryWritePosition = 0;
        state.momentaryFilledSamples = 0;
        state.momentaryPowerSum = 0.0;
        std::fill(state.momentaryPowerRing.begin(), state.momentaryPowerRing.end(), 0.0);
        for (auto& filter : state.shelfFilters)
        {
            filter.x1 = filter.x2 = filter.y1 = filter.y2 = 0.0;
        }
        for (auto& filter : state.highpassFilters)
        {
            filter.x1 = filter.x2 = filter.y1 = filter.y2 = 0.0;
        }
        for (auto& window : state.truePeakWindow)
            window.fill(0.0f);
        state.truePeakWindowSize.fill(0);
        state.publishedRmsDbFS.store(-std::numeric_limits<float>::infinity(), std::memory_order_relaxed);
        state.publishedPeakDbFS.store(-std::numeric_limits<float>::infinity(), std::memory_order_relaxed);
        state.publishedTruePeakDbTP.store(-std::numeric_limits<float>::infinity(), std::memory_order_relaxed);
        state.publishedMomentaryLufs.store(-std::numeric_limits<float>::infinity(), std::memory_order_relaxed);
    }

    void AudioEngine::accumulateTrackMeterSampleLocked(const Id& trackId, float sample) noexcept
    {
        auto* state = findTrackMeterState(trackId);
        if (state == nullptr) return;

        const auto absSample = std::abs(sample);
        state->blockPeak = juce::jmax(state->blockPeak, absSample);
        state->channelBlockPeaks[0] = juce::jmax(state->channelBlockPeaks[0], absSample);
        state->channelSumSquares[0] += (double) sample * (double) sample;
        ++state->channelSampleCounts[0];
        state->sumSquares += (double) sample * (double) sample;
        ++state->sampleCount;
    }

    void AudioEngine::accumulateTrackMeterLocked(const Id& trackId,
                                                 juce::AudioBuffer<float>& buffer,
                                                 int startSample,
                                                 int numSamples,
                                                 float gainDb,
                                                 float pan) noexcept
    {
        auto* state = findTrackMeterState(trackId);
        if (state == nullptr) return;

        const auto gain = juce::Decibels::decibelsToGain(gainDb);
        const auto panGains = equalPowerPan(pan);
        const int channels = buffer.getNumChannels();
        for (int ch = 0; ch < channels; ++ch)
        {
            const float panGain = ch == 0 ? panGains.left : ch == 1 ? panGains.right : 1.0f;
            const float scale = gain * panGain;
            const auto* samples = buffer.getReadPointer(ch, startSample);
            for (int i = 0; i < numSamples; ++i)
            {
                const float sample = samples[i] * scale;
                const float absSample = std::abs(sample);
                state->blockPeak = juce::jmax(state->blockPeak, absSample);
                if (ch < 2)
                {
                    state->channelBlockPeaks[(size_t) ch] = juce::jmax(state->channelBlockPeaks[(size_t) ch], absSample);
                    state->channelSumSquares[(size_t) ch] += (double) sample * (double) sample;
                    ++state->channelSampleCounts[(size_t) ch];
                }
                state->sumSquares += (double) sample * (double) sample;
            }
            state->sampleCount += numSamples;
        }
    }

    void AudioEngine::publishTrackMetersLocked() noexcept
    {
        for (auto& state : trackMeterStates)
        {
            const float rms = state.sampleCount > 0
                ? std::sqrt((float) (state.sumSquares / (double) state.sampleCount))
                : 0.0f;
            state.publishedRms.store(juce::jlimit(0.0f, 1.0f, rms), std::memory_order_relaxed);
            state.publishedPeak.store(juce::jlimit(0.0f, 1.0f, state.blockPeak), std::memory_order_relaxed);
            for (size_t channel = 0; channel < state.publishedChannelRms.size(); ++channel)
            {
                const float channelRms = state.channelSampleCounts[channel] > 0
                    ? std::sqrt((float) (state.channelSumSquares[channel] / (double) state.channelSampleCounts[channel]))
                    : 0.0f;
                state.publishedChannelRms[channel].store(juce::jlimit(0.0f, 1.0f, channelRms), std::memory_order_relaxed);
                state.publishedChannelPeak[channel].store(juce::jlimit(0.0f, 1.0f, state.channelBlockPeaks[channel]), std::memory_order_relaxed);
            }
            state.sequence.fetch_add(1, std::memory_order_release);
        }
    }

    void AudioEngine::publishMasterMeter(int numSamples) noexcept
    {
        double sumSquares = 0.0;
        float peak = 0.0f;
        float truePeak = 0.0f;
        int sampleCount = 0;
        const int channels = mixBuf.getNumChannels();
        auto& loudness = masterLoudnessMeterState;
        const int meterChannels = juce::jlimit(1, 2, juce::jmin(channels, loudness.channelCount));
        for (int ch = 0; ch < channels; ++ch)
        {
            const auto* samples = mixBuf.getReadPointer(ch);
            for (int i = 0; i < numSamples; ++i)
            {
                const float sample = samples[i];
                peak = juce::jmax(peak, std::abs(sample));
                sumSquares += (double) sample * (double) sample;
                if (ch < 2)
                {
                    const float absSample = std::abs(sample);
                    masterMeterState.channelBlockPeaks[(size_t) ch] = juce::jmax(masterMeterState.channelBlockPeaks[(size_t) ch], absSample);
                    masterMeterState.channelSumSquares[(size_t) ch] += (double) sample * (double) sample;
                    ++masterMeterState.channelSampleCounts[(size_t) ch];
                }
            }
            sampleCount += numSamples;
        }

        if (!loudness.momentaryPowerRing.empty())
        {
            for (int i = 0; i < numSamples; ++i)
            {
                double weightedPower = 0.0;
                for (int ch = 0; ch < meterChannels; ++ch)
                {
                    const float sample = mixBuf.getSample(ch, i);
                    truePeak = juce::jmax(truePeak, pushTruePeakSample(loudness, ch, sample));
                    const auto weighted = processLiveMeterBiquad(loudness.highpassFilters[(size_t) ch],
                        processLiveMeterBiquad(loudness.shelfFilters[(size_t) ch], sample));
                    weightedPower += (double) weighted * (double) weighted;
                }

                const auto ringSize = (int) loudness.momentaryPowerRing.size();
                if (loudness.momentaryFilledSamples < ringSize)
                    ++loudness.momentaryFilledSamples;
                else
                    loudness.momentaryPowerSum -= loudness.momentaryPowerRing[(size_t) loudness.momentaryWritePosition];

                loudness.momentaryPowerRing[(size_t) loudness.momentaryWritePosition] = weightedPower;
                loudness.momentaryPowerSum += weightedPower;
                loudness.momentaryWritePosition = (loudness.momentaryWritePosition + 1) % ringSize;
            }
        }

        const float rms = sampleCount > 0
            ? std::sqrt((float) (sumSquares / (double) sampleCount))
            : 0.0f;
        masterMeterState.publishedRms.store(juce::jlimit(0.0f, 1.0f, rms), std::memory_order_relaxed);
        masterMeterState.publishedPeak.store(juce::jlimit(0.0f, 1.0f, peak), std::memory_order_relaxed);
        for (size_t channel = 0; channel < masterMeterState.publishedChannelRms.size(); ++channel)
        {
            const float channelRms = masterMeterState.channelSampleCounts[channel] > 0
                ? std::sqrt((float) (masterMeterState.channelSumSquares[channel] / (double) masterMeterState.channelSampleCounts[channel]))
                : 0.0f;
            masterMeterState.publishedChannelRms[channel].store(juce::jlimit(0.0f, 1.0f, channelRms), std::memory_order_relaxed);
            masterMeterState.publishedChannelPeak[channel].store(juce::jlimit(0.0f, 1.0f, masterMeterState.channelBlockPeaks[channel]), std::memory_order_relaxed);
        }
        loudness.publishedRmsDbFS.store(amplitudeToDb(rms), std::memory_order_relaxed);
        loudness.publishedPeakDbFS.store(amplitudeToDb(peak), std::memory_order_relaxed);
        loudness.publishedTruePeakDbTP.store(amplitudeToDb(juce::jmax(peak, truePeak)), std::memory_order_relaxed);
        loudness.publishedMomentaryLufs.store(
            loudness.momentaryFilledSamples > 0
                ? loudnessFromMeanSquare(loudness.momentaryPowerSum / (double) loudness.momentaryFilledSamples)
                : -std::numeric_limits<float>::infinity(),
            std::memory_order_relaxed);
        masterMeterState.sequence.fetch_add(1, std::memory_order_release);
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
        const bool hasGlideTarget = ev.glideTargetPitch >= 0 && ev.instrumentGlideMs > 0.0f && note != nullptr && note->curve.empty();
        if (note == nullptr || (note->automation.empty() && note->curve.empty() && !hasGlideTarget)) return;

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

        const auto midiPitchToHz = [](double pitch) noexcept
        {
            const double clampedPitch = juce::jlimit(0.0, 127.0, pitch);
            return (float) (440.0 * std::pow(2.0, (clampedPitch - 69.0) / 12.0));
        };

        const auto pushPitchChange = [&](double pitch,
                                         int samplesFromNoteStart,
                                         int rampSamples) noexcept
        {
            if (context.pitchEventCount >= (int) VoiceNoteAutomation::maxEvents) return;
            context.pitchEvents[(size_t) context.pitchEventCount] = {
                juce::jmax(0, samplesFromNoteStart),
                midiPitchToHz(pitch),
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
            if (context.eventCount >= (int) VoiceNoteAutomation::maxEvents) return;
            context.events[(size_t) context.eventCount] = makeRealtimeParameterChange(std::string_view {},
                                                                                      target,
                                                                                      value,
                                                                                      juce::jmax(0, samplesFromNoteStart),
                                                                                      juce::jmax(0, rampSamples));
            ++context.eventCount;
        };

        bool emittedInitialPitch = false;
        if (hasGlideTarget)
        {
            const int glideSamples = juce::jmax(1, (int) std::round((ev.instrumentGlideMs / 1000.0f) * sr));
            pushPitchChange((double) ev.glideTargetPitch, 0, glideSamples);
            emittedInitialPitch = true;
        }

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

    int AudioEngine::countActiveSynthVoices(juce::Synthesiser& targetSynth) noexcept
    {
        int active = 0;
        for (int voiceIndex = 0; voiceIndex < targetSynth.getNumVoices(); ++voiceIndex)
            if (auto* voice = targetSynth.getVoice(voiceIndex); voice != nullptr && voice->isVoiceActive())
                ++active;
        return active;
    }

    void AudioEngine::addRouteToMixLocked(InstrumentRenderState& routeState,
                                          juce::AudioBuffer<float>& route,
                                          int startSample,
                                          int numSamples) noexcept
    {
        if (routeState.routeCompensationSamples > 0 && routeState.compensationDelayState != nullptr)
            processDelayLineLocked(*routeState.compensationDelayState,
                                   route,
                                   startSample,
                                   numSamples,
                                   routeState.routeCompensationSamples);

        const auto gain = juce::Decibels::decibelsToGain(routeState.gainDb);
        const auto panGains = routeState.groupBus || routeState.returnBus
            ? stereoBalancePan(routeState.pan)
            : equalPowerPan(routeState.pan);
        const int routeChannels = route.getNumChannels();
        const int mixChannels = mixBuf.getNumChannels();

        for (int ch = 0; ch < mixChannels; ++ch)
        {
            const int sourceCh = juce::jmin(ch, routeChannels - 1);
            const float panGain = ch == 0 ? panGains.left : ch == 1 ? panGains.right : 1.0f;
            mixBuf.addFrom(ch, startSample, route, sourceCh, startSample, numSamples, gain * panGain);
        }
    }

    void AudioEngine::addRouteSendsLocked(InstrumentRenderState& routeState,
                                          juce::AudioBuffer<float>& route,
                                          int startSample,
                                          int numSamples) noexcept
    {
        if (routeState.sends.empty() || returnRenderStates.empty())
            return;

        const int routeChannels = route.getNumChannels();
        if (routeChannels <= 0 || numSamples <= 0)
            return;

        for (size_t sendIndex = 0; sendIndex < routeState.sends.size(); ++sendIndex)
        {
            const auto& send = routeState.sends[sendIndex];
            if (!send.enabled || send.busId.isEmpty() || send.gainDb <= -96.0f)
                continue;

            auto* bus = findReturnBusRenderState(send.busId);
            if (bus == nullptr)
                continue;
            if (bus->returnBuffer.getNumSamples() < startSample + numSamples)
                continue;

            const auto routeGainDb = send.preFader ? 0.0f : routeState.gainDb;
            const auto routePan = send.preFader ? 0.0f : routeState.pan;
            const float gain = juce::Decibels::decibelsToGain(juce::jlimit(-96.0f, 24.0f, routeGainDb + send.gainDb));
            const auto panGains = equalPowerPan(juce::jlimit(-1.0f, 1.0f, routePan + send.pan));
            const int busChannels = bus->returnBuffer.getNumChannels();

            const int delaySamples = sendIndex < routeState.sendCompensationSamples.size()
                ? routeState.sendCompensationSamples[sendIndex]
                : 0;
            auto* delay = sendIndex < routeState.sendCompensationStates.size()
                ? routeState.sendCompensationStates[sendIndex].get()
                : nullptr;
            if (delaySamples > 0 && delay != nullptr && delay->buffer.getNumSamples() > delaySamples)
            {
                const int capacity = delay->buffer.getNumSamples();
                for (int i = 0; i < numSamples; ++i)
                {
                    const int readPosition = (delay->writePosition - delaySamples + capacity) % capacity;
                    for (int ch = 0; ch < busChannels; ++ch)
                    {
                        const int sourceCh = juce::jmin(ch, routeChannels - 1);
                        const int delayCh = juce::jmin(ch, delay->buffer.getNumChannels() - 1);
                        delay->buffer.setSample(delayCh, delay->writePosition, route.getSample(sourceCh, startSample + i));
                        const float panGain = ch == 0 ? panGains.left : ch == 1 ? panGains.right : 1.0f;
                        bus->returnBuffer.addSample(ch, startSample + i,
                                                    delay->buffer.getSample(delayCh, readPosition) * gain * panGain);
                    }
                    delay->writePosition = (delay->writePosition + 1) % capacity;
                }
            }
            else
            {
                for (int ch = 0; ch < busChannels; ++ch)
                {
                    const int sourceCh = juce::jmin(ch, routeChannels - 1);
                    const float panGain = ch == 0 ? panGains.left : ch == 1 ? panGains.right : 1.0f;
                    bus->returnBuffer.addFrom(ch, startSample, route, sourceCh, startSample, numSamples, gain * panGain);
                }
            }
        }
    }

    void AudioEngine::addRouteToBusLocked(InstrumentRenderState& routeState,
                                          juce::AudioBuffer<float>& route,
                                          const Id& busId,
                                          int startSample,
                                          int numSamples) noexcept
    {
        auto* bus = findReturnBusRenderState(busId);
        if (bus == nullptr || bus->returnBuffer.getNumSamples() < startSample + numSamples)
            return; // Missing destinations are intentionally silent; never fall back to Master.
        if (routeState.routeCompensationSamples > 0 && routeState.compensationDelayState != nullptr)
            processDelayLineLocked(*routeState.compensationDelayState,
                                   route,
                                   startSample,
                                   numSamples,
                                   routeState.routeCompensationSamples);
        const auto gain = juce::Decibels::decibelsToGain(routeState.gainDb);
        const auto panGains = routeState.returnBus ? stereoBalancePan(routeState.pan) : equalPowerPan(routeState.pan);
        const int routeChannels = route.getNumChannels();
        for (int ch = 0; ch < bus->returnBuffer.getNumChannels(); ++ch)
        {
            const int sourceCh = juce::jmin(ch, routeChannels - 1);
            const float panGain = ch == 0 ? panGains.left : ch == 1 ? panGains.right : 1.0f;
            bus->returnBuffer.addFrom(ch, startSample, route, sourceCh, startSample, numSamples, gain * panGain);
        }
    }

    void AudioEngine::addRouteToOutputLocked(InstrumentRenderState& routeState,
                                             juce::AudioBuffer<float>& route,
                                             int startSample,
                                             int numSamples) noexcept
    {
        if (!routeState.outputEnabled || routeState.mute || !routeState.audible)
            return;
        if (routeState.outputBusId.isNotEmpty())
            addRouteToBusLocked(routeState, route, routeState.outputBusId, startSample, numSamples);
        else
            addRouteToMixLocked(routeState, route, startSample, numSamples);
    }

    void AudioEngine::addRouteToGroupLocked(InstrumentRenderState& routeState,
                                            juce::AudioBuffer<float>& route,
                                            int startSample,
                                            int numSamples) noexcept
    {
        auto* group = findGroupRenderState(routeState.parentTrackId);
        if (group == nullptr || group->groupBuffer.getNumSamples() < startSample + numSamples)
        {
            addRouteToMixLocked(routeState, route, startSample, numSamples);
            return;
        }

        if (routeState.routeCompensationSamples > 0 && routeState.compensationDelayState != nullptr)
            processDelayLineLocked(*routeState.compensationDelayState,
                                   route,
                                   startSample,
                                   numSamples,
                                   routeState.routeCompensationSamples);

        const auto gain = juce::Decibels::decibelsToGain(routeState.gainDb);
        const auto panGains = equalPowerPan(routeState.pan);
        const int routeChannels = route.getNumChannels();
        const int groupChannels = group->groupBuffer.getNumChannels();

        for (int ch = 0; ch < groupChannels; ++ch)
        {
            const int sourceCh = juce::jmin(ch, routeChannels - 1);
            const float panGain = ch == 0 ? panGains.left : ch == 1 ? panGains.right : 1.0f;
            group->groupBuffer.addFrom(ch, startSample, route, sourceCh, startSample, numSamples, gain * panGain);
        }
    }

    void AudioEngine::processGroupBusesLocked(int numSamples,
                                              int64_t* routeEffectTicks,
                                              RouteEffectWorkStats* routeEffectWork) noexcept
    {
        for (auto& group : groupRenderStates)
        {
            if (group.groupBuffer.getNumSamples() < numSamples)
                continue;

            processRouteAutomationLocked(group, group.groupBuffer, numSamples, routeEffectTicks, routeEffectWork);
        }
    }

    void AudioEngine::processReturnBusesLocked(int numSamples,
                                               int64_t* routeEffectTicks,
                                               RouteEffectWorkStats* routeEffectWork) noexcept
    {
        for (auto& bus : returnRenderStates)
        {
            if (bus.returnBuffer.getNumSamples() < numSamples)
                continue;

            processRouteAutomationLocked(bus, bus.returnBuffer, numSamples, routeEffectTicks, routeEffectWork);
        }
    }

        void AudioEngine::prepareRouteEffects(InstrumentRenderState& route)
        {
            route.filterStates.clear();
            route.reverbStates.clear();
            route.delayStates.clear();
            route.pluginLatencyStates.clear();
            route.bitcrushStates.clear();
            route.nonlinearStates.clear();
            route.chorusStates.clear();
            route.phaserStates.clear();
            route.compensationDelayState.reset();
            route.sendCompensationStates.clear();
            route.compressorStates.clear();
            route.filterStates.reserve(route.effects.size());
        route.reverbStates.reserve(route.effects.size());
            route.delayStates.reserve(route.effects.size());
            route.pluginLatencyStates.reserve(route.effects.size());
            route.bitcrushStates.reserve(route.effects.size());
            route.nonlinearStates.reserve(route.effects.size());
            route.chorusStates.reserve(route.effects.size());
            route.phaserStates.reserve(route.effects.size());
            route.compressorStates.reserve(route.effects.size());
            for (const auto& effect : route.effects)
            {
            if (effect.kind == TrackEffectKind::Lowpass || effect.kind == TrackEffectKind::Highpass)
            {
                auto filter = std::make_unique<juce::dsp::StateVariableTPTFilter<float>>();
                filter->prepare({ sampleRate, (juce::uint32) juce::jmax(1, routeBuf.getNumSamples()), 2 });
                filter->reset();
                route.filterStates.push_back(std::move(filter));
            }
            else
            {
                route.filterStates.push_back(nullptr);
            }

            if (effect.kind == TrackEffectKind::Reverb)
            {
                auto reverb = std::make_unique<juce::Reverb>();
                reverb->reset();
                route.reverbStates.push_back(std::move(reverb));
            }
            else
            {
                route.reverbStates.push_back(nullptr);
            }

            if (effect.kind == TrackEffectKind::Delay)
            {
                auto delay = std::make_unique<InstrumentRenderState::DelayEffectState>();
                const int channels = juce::jmax(2, routeBuf.getNumChannels());
                const int maxDelaySamples = juce::jmax(1, (int) std::ceil(sampleRate * 2.0));
                delay->buffer.setSize(channels, maxDelaySamples + 1);
                delay->buffer.clear();
                route.delayStates.push_back(std::move(delay));
            }
            else
            {
                route.delayStates.push_back(nullptr);
            }

            if (effect.kind == TrackEffectKind::Plugin && effect.latencySamples > 0)
            {
                auto delay = std::make_unique<InstrumentRenderState::DelayEffectState>();
                const int channels = juce::jmax(2, routeBuf.getNumChannels());
                const int maxDelaySamples = juce::jmax(1, effect.latencySamples);
                delay->buffer.setSize(channels, maxDelaySamples + 1);
                delay->buffer.clear();
                route.pluginLatencyStates.push_back(std::move(delay));
            }
            else
            {
                route.pluginLatencyStates.push_back(nullptr);
            }

                InstrumentRenderState::BitcrushEffectState bitcrushState;
                bitcrushState.heldSamples.assign((size_t) juce::jmax(1, routeBuf.getNumChannels()), 0.0f);
                route.bitcrushStates.push_back(std::move(bitcrushState));

                InstrumentRenderState::NonlinearEffectState nonlinearState;
                if (effect.kind == TrackEffectKind::Saturator || effect.kind == TrackEffectKind::Distortion)
                {
                    const int channels = juce::jmax(1, routeBuf.getNumChannels());
                    nonlinearState.previousInput.assign((size_t) channels, 0.0f);
                    nonlinearState.lowpass.assign((size_t) channels, 0.0f);
                }
                route.nonlinearStates.push_back(std::move(nonlinearState));

                if (effect.kind == TrackEffectKind::Chorus || effect.kind == TrackEffectKind::Flanger)
                {
                    auto chorus = std::make_unique<InstrumentRenderState::ChorusEffectState>();
                    const int channels = juce::jmax(2, routeBuf.getNumChannels());
                    const int maxDelaySamples = juce::jmax(8, (int) std::ceil(sampleRate * 0.08));
                chorus->buffer.setSize(channels, maxDelaySamples + 2);
                chorus->buffer.clear();
                route.chorusStates.push_back(std::move(chorus));
            }
            else
            {
                route.chorusStates.push_back(nullptr);
            }

            if (effect.kind == TrackEffectKind::Phaser)
            {
                auto phaser = std::make_unique<InstrumentRenderState::PhaserEffectState>();
                const int channels = juce::jmax(1, routeBuf.getNumChannels());
                phaser->x1.assign((size_t) channels, {});
                phaser->y1.assign((size_t) channels, {});
                phaser->feedback.assign((size_t) channels, 0.0f);
                route.phaserStates.push_back(std::move(phaser));
            }
            else
            {
                route.phaserStates.push_back(nullptr);
            }

            route.compressorStates.push_back({});
        }

        if (route.routeCompensationSamples > 0)
        {
            route.compensationDelayState = std::make_unique<InstrumentRenderState::DelayEffectState>();
            const int channels = juce::jmax(2, routeBuf.getNumChannels());
            route.compensationDelayState->buffer.setSize(channels, route.routeCompensationSamples + 1);
            route.compensationDelayState->buffer.clear();
        }
        route.sendCompensationStates.reserve(route.sends.size());
        for (size_t index = 0; index < route.sends.size(); ++index)
        {
            const int delaySamples = index < route.sendCompensationSamples.size()
                ? route.sendCompensationSamples[index]
                : 0;
            if (delaySamples <= 0)
            {
                route.sendCompensationStates.push_back(nullptr);
                continue;
            }
            auto delay = std::make_unique<InstrumentRenderState::DelayEffectState>();
            const int channels = juce::jmax(2, routeBuf.getNumChannels());
            delay->buffer.setSize(channels, delaySamples + 1);
            delay->buffer.clear();
            route.sendCompensationStates.push_back(std::move(delay));
        }
    }

    void AudioEngine::processDelayLineLocked(InstrumentRenderState::DelayEffectState& delay,
                                             juce::AudioBuffer<float>& buffer,
                                             int startSample,
                                             int numSamples,
                                             int delaySamples) noexcept
    {
        if (delaySamples <= 0 || delay.buffer.getNumSamples() <= delaySamples)
            return;

        const int delayBufferSamples = delay.buffer.getNumSamples();
        const int channels = buffer.getNumChannels();
        for (int i = 0; i < numSamples; ++i)
        {
            int readPosition = delay.writePosition - delaySamples;
            while (readPosition < 0)
                readPosition += delayBufferSamples;

            for (int ch = 0; ch < channels; ++ch)
            {
                const int delayCh = juce::jmin(ch, delay.buffer.getNumChannels() - 1);
                const float dry = buffer.getSample(ch, startSample + i);
                const float wet = delay.buffer.getSample(delayCh, readPosition);
                delay.buffer.setSample(delayCh, delay.writePosition, denormalSafe(dry));
                buffer.setSample(ch, startSample + i, denormalSafe(wet));
            }

            delay.writePosition = (delay.writePosition + 1) % delayBufferSamples;
        }
    }

    void AudioEngine::processRouteEffectsLocked(InstrumentRenderState& route,
                                                juce::AudioBuffer<float>& buffer,
                                                int startSample,
                                                int numSamples,
                                                RouteEffectWorkStats* workStats) noexcept
    {
        juce::ScopedNoDenormals noDenormals;
        if (route.effects.empty()) return;

        juce::dsp::AudioBlock<float> block(buffer);
        auto blockView = block.getSubBlock((size_t) startSample, (size_t) numSamples);

        for (size_t effectIndex = 0; effectIndex < route.effects.size(); ++effectIndex)
        {
            const auto& effect = route.effects[effectIndex];
            if (effect.bypassed) continue;

            const int64_t effectSampleWork = (int64_t) juce::jmax(0, buffer.getNumChannels())
                * (int64_t) juce::jmax(0, numSamples);
            if (workStats != nullptr)
                workStats->totalSamples += effectSampleWork;

            switch (effect.kind)
            {
                case TrackEffectKind::Lowpass:
                case TrackEffectKind::Highpass:
                {
                    if (effectIndex >= route.filterStates.size() || route.filterStates[effectIndex] == nullptr)
                        break;

                    if (workStats != nullptr)
                        workStats->filterSamples += effectSampleWork;

                    auto& filter = *route.filterStates[effectIndex];
                    const float cutoff = juce::jlimit(20.0f,
                                                      (float) (sampleRate * 0.45),
                                                      trackEffectParam(effect, "cutoffHz", effect.kind == TrackEffectKind::Lowpass ? 8000.0f : 80.0f));
                    const float resonance = juce::jlimit(0.05f, 1.0f, trackEffectParam(effect, "resonance", 0.0f) / 100.0f);
                    filter.setType(effect.kind == TrackEffectKind::Lowpass
                        ? juce::dsp::StateVariableTPTFilterType::lowpass
                        : juce::dsp::StateVariableTPTFilterType::highpass);
                    filter.setCutoffFrequency(cutoff);
                    filter.setResonance(0.707f + resonance * 8.0f);
                    juce::dsp::ProcessContextReplacing<float> context(blockView);
                    filter.process(context);
                    break;
                }
                case TrackEffectKind::Saturator:
                {
                    const bool oversampled = effectIndex < route.nonlinearStates.size()
                        && (int) route.nonlinearStates[effectIndex].previousInput.size() >= buffer.getNumChannels()
                        && (int) route.nonlinearStates[effectIndex].lowpass.size() >= buffer.getNumChannels();
                    if (workStats != nullptr)
                        workStats->nonlinearSamples += effectSampleWork * (oversampled ? 2 : 1);

                    const float drive = 1.0f + juce::jlimit(0.0f, 100.0f, trackEffectParam(effect, "drive", 20.0f)) / 100.0f * 12.0f;
                    const float mix = juce::jlimit(0.0f, 1.0f, trackEffectParam(effect, "mix", 100.0f) / 100.0f);
                    auto* nonlinearState = oversampled ? &route.nonlinearStates[effectIndex] : nullptr;
                    constexpr float downsampleAlpha = 0.72f;
                    for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
                    {
                        auto* samples = buffer.getWritePointer(ch, startSample);
                        for (int i = 0; i < numSamples; ++i)
                        {
                            const float dry = samples[i];
                            float wet = std::tanh(dry * drive);
                            if (nonlinearState != nullptr)
                            {
                                const float midpoint = 0.5f * (nonlinearState->previousInput[(size_t) ch] + dry);
                                const float wetMidpoint = std::tanh(midpoint * drive);
                                const float downsampled = 0.5f * (wetMidpoint + wet);
                                const float lowpassed = nonlinearState->lowpass[(size_t) ch]
                                    + downsampleAlpha * (downsampled - nonlinearState->lowpass[(size_t) ch]);
                                nonlinearState->previousInput[(size_t) ch] = dry;
                                nonlinearState->lowpass[(size_t) ch] = denormalSafe(lowpassed);
                                wet = lowpassed;
                            }
                            samples[i] = denormalSafe(dry + (wet - dry) * mix);
                        }
                    }
                    break;
                }
                case TrackEffectKind::Distortion:
                {
                    const bool oversampled = effectIndex < route.nonlinearStates.size()
                        && (int) route.nonlinearStates[effectIndex].previousInput.size() >= buffer.getNumChannels()
                        && (int) route.nonlinearStates[effectIndex].lowpass.size() >= buffer.getNumChannels();
                    if (workStats != nullptr)
                        workStats->nonlinearSamples += effectSampleWork * (oversampled ? 2 : 1);

                    const float drive = 1.0f + juce::jlimit(0.0f, 100.0f, trackEffectParam(effect, "drive", 55.0f)) / 100.0f * 40.0f;
                    const float shape = juce::jlimit(0.0f, 1.0f, trackEffectParam(effect, "shape", 35.0f) / 100.0f);
                    const float mix = juce::jlimit(0.0f, 1.0f, trackEffectParam(effect, "mix", 45.0f) / 100.0f);
                    const float outputTrim = juce::Decibels::decibelsToGain(-juce::jlimit(0.0f, 18.0f, trackEffectParam(effect, "trimDb", 6.0f)));
                    auto* nonlinearState = oversampled ? &route.nonlinearStates[effectIndex] : nullptr;
                    constexpr float downsampleAlpha = 0.72f;
                    for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
                    {
                        auto* samples = buffer.getWritePointer(ch, startSample);
                        for (int i = 0; i < numSamples; ++i)
                        {
                            const float dry = samples[i];
                            const float driven = dry * drive;
                            const float soft = std::tanh(driven);
                            const float hard = juce::jlimit(-1.0f, 1.0f, driven);
                            float wet = (soft + (hard - soft) * shape) * outputTrim;
                            if (nonlinearState != nullptr)
                            {
                                const float midpoint = 0.5f * (nonlinearState->previousInput[(size_t) ch] + dry);
                                const float midpointDriven = midpoint * drive;
                                const float midpointSoft = std::tanh(midpointDriven);
                                const float midpointHard = juce::jlimit(-1.0f, 1.0f, midpointDriven);
                                const float midpointWet = (midpointSoft + (midpointHard - midpointSoft) * shape) * outputTrim;
                                const float downsampled = 0.5f * (midpointWet + wet);
                                const float lowpassed = nonlinearState->lowpass[(size_t) ch]
                                    + downsampleAlpha * (downsampled - nonlinearState->lowpass[(size_t) ch]);
                                nonlinearState->previousInput[(size_t) ch] = dry;
                                nonlinearState->lowpass[(size_t) ch] = denormalSafe(lowpassed);
                                wet = lowpassed;
                            }
                            samples[i] = denormalSafe(dry + (wet - dry) * mix);
                        }
                    }
                    break;
                }
                case TrackEffectKind::Bitcrush:
                {
                    if (effectIndex >= route.bitcrushStates.size())
                        break;

                    if (workStats != nullptr)
                        workStats->nonlinearSamples += effectSampleWork;

                    auto& state = route.bitcrushStates[effectIndex];
                    const int bits = juce::jlimit(1, 16, (int) std::round(trackEffectParam(effect, "bits", 8.0f)));
                    const int holdSamples = juce::jlimit(1, 64, (int) std::round(1.0f + (100.0f - juce::jlimit(1.0f, 100.0f, trackEffectParam(effect, "rate", 50.0f))) / 100.0f * 63.0f));
                    const float mix = juce::jlimit(0.0f, 1.0f, trackEffectParam(effect, "mix", 35.0f) / 100.0f);
                    const float levels = (float) ((1 << bits) - 1);
                    const int channels = buffer.getNumChannels();
                    if ((int) state.heldSamples.size() < channels)
                        break;

                    for (int i = 0; i < numSamples; ++i)
                    {
                        if (state.holdCounter <= 0)
                        {
                            for (int ch = 0; ch < channels; ++ch)
                            {
                                const float dry = buffer.getSample(ch, startSample + i);
                                state.heldSamples[(size_t) ch] = std::round((juce::jlimit(-1.0f, 1.0f, dry) * 0.5f + 0.5f) * levels) / levels * 2.0f - 1.0f;
                            }
                            state.holdCounter = holdSamples;
                        }

                        for (int ch = 0; ch < channels; ++ch)
                        {
                            auto* samples = buffer.getWritePointer(ch, startSample);
                            const float dry = samples[i];
                            const float held = state.heldSamples[(size_t) ch];
                            samples[i] = dry + (held - dry) * mix;
                        }

                        --state.holdCounter;
                    }
                    break;
                }
                case TrackEffectKind::Reverb:
                {
                    if (effectIndex >= route.reverbStates.size() || route.reverbStates[effectIndex] == nullptr)
                        break;

                    if (workStats != nullptr)
                        workStats->delaySamples += effectSampleWork;

                    juce::Reverb::Parameters params;
                    const float mix = juce::jlimit(0.0f, 1.0f, trackEffectParam(effect, "mix", 20.0f) / 100.0f);
                    params.roomSize = juce::jlimit(0.0f, 1.0f, trackEffectParam(effect, "roomSize", 40.0f) / 100.0f);
                    params.damping = juce::jlimit(0.0f, 1.0f, trackEffectParam(effect, "damping", 35.0f) / 100.0f);
                    params.wetLevel = mix;
                    params.dryLevel = 1.0f - mix;
                    params.width = 1.0f;

                    auto& reverb = *route.reverbStates[effectIndex];
                    reverb.setParameters(params);
                    if (buffer.getNumChannels() >= 2)
                    {
                        reverb.processStereo(buffer.getWritePointer(0, startSample),
                                             buffer.getWritePointer(1, startSample),
                                             numSamples);
                    }
                    else if (buffer.getNumChannels() == 1)
                    {
                        reverb.processMono(buffer.getWritePointer(0, startSample), numSamples);
                    }
                    break;
                }
                case TrackEffectKind::Delay:
                {
                    if (effectIndex >= route.delayStates.size() || route.delayStates[effectIndex] == nullptr)
                        break;

                    auto& delay = *route.delayStates[effectIndex];
                    if (delay.buffer.getNumSamples() <= 1)
                        break;

                    if (workStats != nullptr)
                        workStats->delaySamples += effectSampleWork;

                    const int delaySamples = juce::jlimit(1,
                                                          delay.buffer.getNumSamples() - 1,
                                                          (int) std::round(trackEffectParam(effect, "timeMs", 250.0f) * 0.001f * (float) sampleRate));
                    const float feedback = juce::jlimit(0.0f, 0.95f, trackEffectParam(effect, "feedback", 25.0f) / 100.0f);
                    const float mix = juce::jlimit(0.0f, 1.0f, trackEffectParam(effect, "mix", 18.0f) / 100.0f);
                    const int delayBufferSamples = delay.buffer.getNumSamples();
                    const int routeChannels = buffer.getNumChannels();

                    for (int i = 0; i < numSamples; ++i)
                    {
                        int readPosition = delay.writePosition - delaySamples;
                        while (readPosition < 0)
                            readPosition += delayBufferSamples;

                        for (int ch = 0; ch < routeChannels; ++ch)
                        {
                            const int delayCh = juce::jmin(ch, delay.buffer.getNumChannels() - 1);
                            auto* samples = buffer.getWritePointer(ch, startSample);
                            const float dry = samples[i];
                            const float wet = delay.buffer.getSample(delayCh, readPosition);
                            delay.buffer.setSample(delayCh, delay.writePosition, denormalSafe(dry + wet * feedback));
                            samples[i] = denormalSafe(dry + (wet - dry) * mix);
                        }

                        delay.writePosition = (delay.writePosition + 1) % delayBufferSamples;
                    }
                    break;
                }
                case TrackEffectKind::Compressor:
                {
                    if (effectIndex >= route.compressorStates.size())
                        break;

                    if (workStats != nullptr)
                        workStats->nonlinearSamples += effectSampleWork;

                    auto& state = route.compressorStates[effectIndex];
                    const float thresholdDb = juce::jlimit(-60.0f, 0.0f, trackEffectParam(effect, "thresholdDb", -18.0f));
                    const float ratio = juce::jlimit(1.0f, 40.0f, trackEffectParam(effect, "ratio", 4.0f));
                    const float attackMs = juce::jlimit(0.1f, 200.0f, trackEffectParam(effect, "attackMs", 10.0f));
                    const float releaseMs = juce::jlimit(1.0f, 2000.0f, trackEffectParam(effect, "releaseMs", 120.0f));
                    const float makeupGain = juce::Decibels::decibelsToGain(juce::jlimit(-24.0f, 24.0f, trackEffectParam(effect, "makeupDb", 0.0f)));
                    const float mix = juce::jlimit(0.0f, 1.0f, trackEffectParam(effect, "mix", 100.0f) / 100.0f);
                    const float attackCoeff = std::exp(-1.0f / juce::jmax(1.0f, attackMs * 0.001f * (float) sampleRate));
                    const float releaseCoeff = std::exp(-1.0f / juce::jmax(1.0f, releaseMs * 0.001f * (float) sampleRate));

                    for (int i = 0; i < numSamples; ++i)
                    {
                        float detector = 0.0f;
                        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
                            detector = juce::jmax(detector, std::abs(buffer.getSample(ch, startSample + i)));

                        const float coeff = detector > state.envelope ? attackCoeff : releaseCoeff;
                        state.envelope = detector + coeff * (state.envelope - detector);

                        const float inputDb = juce::Decibels::gainToDecibels(juce::jmax(state.envelope, 0.000001f), -120.0f);
                        float gainReductionDb = 0.0f;
                        if (inputDb > thresholdDb)
                        {
                            const float compressedDb = thresholdDb + (inputDb - thresholdDb) / ratio;
                            gainReductionDb = compressedDb - inputDb;
                        }
                        const float compressorGain = juce::Decibels::decibelsToGain(gainReductionDb) * makeupGain;

                        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
                        {
                            auto* samples = buffer.getWritePointer(ch, startSample);
                            const float dry = samples[i];
                            const float wet = dry * compressorGain;
                            samples[i] = dry + (wet - dry) * mix;
                        }
                    }
                    break;
                }
                case TrackEffectKind::Chorus:
                case TrackEffectKind::Flanger:
                {
                    if (effectIndex >= route.chorusStates.size() || route.chorusStates[effectIndex] == nullptr)
                        break;

                    auto& chorus = *route.chorusStates[effectIndex];
                    if (chorus.buffer.getNumSamples() <= 8)
                        break;

                    if (workStats != nullptr)
                        workStats->delaySamples += effectSampleWork;

                    const bool flanger = effect.kind == TrackEffectKind::Flanger;
                    const float rateHz = juce::jlimit(0.02f, 12.0f, trackEffectParam(effect, "rateHz", flanger ? 0.28f : 0.8f));
                    const float depthMs = juce::jlimit(0.0f, flanger ? 8.0f : 25.0f, trackEffectParam(effect, "depthMs", flanger ? 2.0f : 8.0f));
                    const float baseDelayMs = juce::jlimit(flanger ? 0.1f : 1.0f,
                                                           flanger ? 15.0f : 35.0f,
                                                           trackEffectParam(effect, "delayMs", flanger ? 2.5f : 12.0f));
                    const float feedback = juce::jlimit(-0.85f, 0.85f, trackEffectParam(effect, "feedback", flanger ? 45.0f : 8.0f) / 100.0f);
                    const float mix = juce::jlimit(0.0f, 1.0f, trackEffectParam(effect, "mix", flanger ? 50.0f : 35.0f) / 100.0f);
                    const int delayBufferSamples = chorus.buffer.getNumSamples();
                    const int routeChannels = buffer.getNumChannels();
                    const float phaseIncrement = juce::MathConstants<float>::twoPi * rateHz / (float) sampleRate;

                    for (int i = 0; i < numSamples; ++i)
                    {
                        const float modulation = 0.5f + 0.5f * std::sin(chorus.phase);
                        const float delaySamples = (baseDelayMs + depthMs * modulation) * 0.001f * (float) sampleRate;
                        const int delayWhole = juce::jlimit(1, delayBufferSamples - 2, (int) std::floor(delaySamples));
                        const float frac = delaySamples - (float) delayWhole;
                        int readA = chorus.writePosition - delayWhole;
                        while (readA < 0)
                            readA += delayBufferSamples;
                        int readB = readA - 1;
                        while (readB < 0)
                            readB += delayBufferSamples;

                        for (int ch = 0; ch < routeChannels; ++ch)
                        {
                            const int chorusCh = juce::jmin(ch, chorus.buffer.getNumChannels() - 1);
                            auto* samples = buffer.getWritePointer(ch, startSample);
                            const float dry = samples[i];
                            const float wetA = chorus.buffer.getSample(chorusCh, readA);
                            const float wetB = chorus.buffer.getSample(chorusCh, readB);
                            const float wet = wetA + (wetB - wetA) * frac;
                            chorus.buffer.setSample(chorusCh, chorus.writePosition, denormalSafe(dry + wet * feedback));
                            samples[i] = denormalSafe(dry + (wet - dry) * mix);
                        }

                        chorus.writePosition = (chorus.writePosition + 1) % delayBufferSamples;
                        chorus.phase += phaseIncrement;
                        if (chorus.phase >= juce::MathConstants<float>::twoPi)
                            chorus.phase -= juce::MathConstants<float>::twoPi;
                    }
                    break;
                }
                case TrackEffectKind::Phaser:
                {
                    if (effectIndex >= route.phaserStates.size() || route.phaserStates[effectIndex] == nullptr)
                        break;

                    auto& phaser = *route.phaserStates[effectIndex];
                    const int routeChannels = buffer.getNumChannels();
                    if ((int) phaser.x1.size() < routeChannels
                        || (int) phaser.y1.size() < routeChannels
                        || (int) phaser.feedback.size() < routeChannels)
                        break;

                    if (workStats != nullptr)
                        workStats->delaySamples += effectSampleWork;

                    const float rateHz = juce::jlimit(0.02f, 12.0f, trackEffectParam(effect, "rateHz", 0.45f));
                    const float centerHz = juce::jlimit(80.0f,
                                                        (float) (sampleRate * 0.35),
                                                        trackEffectParam(effect, "centerHz", 900.0f));
                    const float depthOctaves = juce::jlimit(0.0f, 4.0f, trackEffectParam(effect, "depthOct", 1.8f));
                    const float feedbackAmount = juce::jlimit(-0.85f, 0.85f, trackEffectParam(effect, "feedback", 35.0f) / 100.0f);
                    const float mix = juce::jlimit(0.0f, 1.0f, trackEffectParam(effect, "mix", 45.0f) / 100.0f);
                    const float phaseIncrement = juce::MathConstants<float>::twoPi * rateHz / (float) sampleRate;

                    for (int i = 0; i < numSamples; ++i)
                    {
                        for (int ch = 0; ch < routeChannels; ++ch)
                        {
                            const float channelPhase = phaser.phase
                                + (ch == 1 ? juce::MathConstants<float>::halfPi : 0.0f);
                            const float modulation = std::sin(channelPhase);
                            const float cutoff = juce::jlimit(50.0f,
                                                              (float) (sampleRate * 0.45),
                                                              centerHz * std::pow(2.0f, modulation * depthOctaves));
                            const float tangent = std::tan(juce::MathConstants<float>::pi * cutoff / (float) sampleRate);
                            const float coefficient = juce::jlimit(-0.98f, 0.98f, (tangent - 1.0f) / (tangent + 1.0f));

                            auto* samples = buffer.getWritePointer(ch, startSample);
                            const float dry = samples[i];
                            float wet = denormalSafe(dry + phaser.feedback[(size_t) ch] * feedbackAmount);

                            auto& xStages = phaser.x1[(size_t) ch];
                            auto& yStages = phaser.y1[(size_t) ch];
                            for (int stage = 0; stage < InstrumentRenderState::PhaserEffectState::stageCount; ++stage)
                            {
                                const float input = wet;
                                wet = denormalSafe(coefficient * input + xStages[(size_t) stage] - coefficient * yStages[(size_t) stage]);
                                xStages[(size_t) stage] = input;
                                yStages[(size_t) stage] = wet;
                            }

                            phaser.feedback[(size_t) ch] = wet;
                            samples[i] = denormalSafe(dry + (wet - dry) * mix);
                        }

                        phaser.phase += phaseIncrement;
                        if (phaser.phase >= juce::MathConstants<float>::twoPi)
                            phaser.phase -= juce::MathConstants<float>::twoPi;
                    }
                    break;
                }
                case TrackEffectKind::Plugin:
                    // Plugin processors are represented in the chain today so
                    // projects can preserve unavailable/future hosts safely.
                    // Until a real-time-safe plugin bridge is registered, the
                    // placeholder only applies declared latency so alignment
                    // behavior is already exercised by native playback/export.
                    if (effect.latencySamples > 0
                        && effectIndex < route.pluginLatencyStates.size()
                        && route.pluginLatencyStates[effectIndex] != nullptr)
                    {
                        if (workStats != nullptr)
                            workStats->delaySamples += effectSampleWork;

                        processDelayLineLocked(*route.pluginLatencyStates[effectIndex],
                                               buffer,
                                               startSample,
                                               numSamples,
                                               effect.latencySamples);
                    }
                    break;
                case TrackEffectKind::Unknown:
                    break;
            }
        }

        clearDenormalSamples(buffer, startSample, numSamples);
    }

    void AudioEngine::processMasterChain(juce::AudioBuffer<float>& buffer, int numSamples) noexcept
    {
        juce::ScopedNoDenormals noDenormals;
        if (numSamples <= 0 || buffer.getNumChannels() <= 0)
            return;

        const float inputGain = juce::Decibels::decibelsToGain(juce::jlimit(-48.0f, 24.0f, masterChainSettings.inputGainDb));
        if (std::abs(inputGain - 1.0f) > 0.000001f)
            buffer.applyGain(0, numSamples, inputGain);

        if (masterChainSettings.compressorEnabled)
        {
            const float thresholdDb = juce::jlimit(-60.0f, 0.0f, masterChainSettings.compressorThresholdDb);
            const float ratio = juce::jlimit(1.0f, 40.0f, masterChainSettings.compressorRatio);
            const float attackMs = juce::jlimit(0.1f, 200.0f, masterChainSettings.compressorAttackMs);
            const float releaseMs = juce::jlimit(1.0f, 3000.0f, masterChainSettings.compressorReleaseMs);
            const float makeupGain = juce::Decibels::decibelsToGain(juce::jlimit(-24.0f, 24.0f, masterChainSettings.compressorMakeupDb));
            const float mix = juce::jlimit(0.0f, 1.0f, masterChainSettings.compressorMix / 100.0f);
            const float attackCoeff = std::exp(-1.0f / juce::jmax(1.0f, attackMs * 0.001f * (float) sampleRate));
            const float releaseCoeff = std::exp(-1.0f / juce::jmax(1.0f, releaseMs * 0.001f * (float) sampleRate));

            for (int i = 0; i < numSamples; ++i)
            {
                float detector = 0.0f;
                for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
                    detector = juce::jmax(detector, std::abs(buffer.getSample(ch, i)));

                const float coeff = detector > masterCompressorEnvelope ? attackCoeff : releaseCoeff;
                masterCompressorEnvelope = detector + coeff * (masterCompressorEnvelope - detector);

                const float inputDb = juce::Decibels::gainToDecibels(juce::jmax(masterCompressorEnvelope, 0.000001f), -120.0f);
                float gainReductionDb = 0.0f;
                if (inputDb > thresholdDb)
                {
                    const float compressedDb = thresholdDb + (inputDb - thresholdDb) / ratio;
                    gainReductionDb = compressedDb - inputDb;
                }

                const float compressorGain = juce::Decibels::decibelsToGain(gainReductionDb) * makeupGain;
                for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
                {
                    auto* samples = buffer.getWritePointer(ch);
                    const float dry = samples[i];
                    const float wet = dry * compressorGain;
                    samples[i] = denormalSafe(dry + (wet - dry) * mix);
                }
            }
        }
        else
        {
            masterCompressorEnvelope = 0.0f;
        }

        const float outputGain = juce::Decibels::decibelsToGain(juce::jlimit(-48.0f, 24.0f, masterChainSettings.outputGainDb));
        if (std::abs(outputGain - 1.0f) > 0.000001f)
            buffer.applyGain(0, numSamples, outputGain);
    }

    bool AudioEngine::applyRouteParameterLocked(InstrumentRenderState& route,
                                                const RouteParameterAutomationEvent& event) noexcept
    {
        const auto& target = event.parameterId;
        if (target == "track.gainDb" || target == "track.gain" || target == "bus.gainDb" || target == "bus.gain")
        {
            route.gainDb = juce::jlimit(-96.0f, 24.0f, event.value);
            return true;
        }

        if (target == "track.pan" || target == "bus.pan")
        {
            route.pan = juce::jlimit(-1.0f, 1.0f, event.value);
            return true;
        }

        if (target == "bus.inputTrimDb")
        {
            route.inputTrimDb = juce::jlimit(-96.0f, 24.0f, event.value);
            return true;
        }

        if (target == "bus.mute")
        {
            route.mute = event.value >= 0.5f;
            return true;
        }

        if (target.startsWith("send."))
        {
            const auto rest = target.substring(5);
            const auto busId = rest.upToFirstOccurrenceOf(".", false, false);
            const auto param = rest.fromFirstOccurrenceOf(".", false, false);
            for (auto& send : route.sends)
            {
                if (send.busId != busId) continue;
                if (param == "gainDb" || param == "gain") send.gainDb = juce::jlimit(-96.0f, 24.0f, event.value);
                else if (param == "pan") send.pan = juce::jlimit(-1.0f, 1.0f, event.value);
                else if (param == "enabled") send.enabled = event.value >= 0.5f;
                else return false;
                return true;
            }
            return false;
        }

        const bool singular = target.startsWith("effect.");
        const bool plural = target.startsWith("effects.");
        if (!singular && !plural)
            return false;

        const auto prefixLength = singular ? 7 : 8;
        const auto rest = target.substring(prefixLength);
        const auto effectId = rest.upToFirstOccurrenceOf(".", false, false);
        const auto param = rest.fromFirstOccurrenceOf(".", false, false);
        if (effectId.isEmpty() || param.isEmpty())
            return false;

        for (auto& effect : route.effects)
        {
            if (effect.id == effectId)
            {
                if (param == "bypass" || param == "bypassed")
                {
                    effect.bypassed = event.value >= 0.5f;
                    return true;
                }
                return setTrackEffectParam(effect, param, event.value);
            }
        }

        return false;
    }

    void AudioEngine::processRouteAutomationLocked(InstrumentRenderState& route,
                                                   juce::AudioBuffer<float>& buffer,
                                                   int numSamples,
                                                   int64_t* routeEffectTicks,
                                                   RouteEffectWorkStats* routeEffectWork) noexcept
    {
        int cursor = 0;
        while (cursor < numSamples)
        {
            for (const auto& event : blockRouteParameterEvents)
            {
                if (event.trackId == route.trackId && event.sampleOffset == cursor)
                    applyRouteParameterLocked(route, event);
            }

            int nextOffset = numSamples;
            for (const auto& event : blockRouteParameterEvents)
            {
                if (event.trackId == route.trackId && event.sampleOffset > cursor)
                    nextOffset = juce::jmin(nextOffset, event.sampleOffset);
            }

            const int chunkSamples = nextOffset - cursor;
            if (chunkSamples > 0)
            {
                if (route.returnBus && route.inputTrimDb != 0.0f)
                    buffer.applyGain(cursor, chunkSamples, juce::Decibels::decibelsToGain(route.inputTrimDb));
                const auto effectStartTicks = juce::Time::getHighResolutionTicks();
                processRouteEffectsLocked(route, buffer, cursor, chunkSamples, routeEffectWork);
                if (routeEffectTicks != nullptr)
                {
                    *routeEffectTicks += juce::jmax<int64_t>(
                        0,
                        juce::Time::getHighResolutionTicks() - effectStartTicks);
                }
                accumulateTrackMeterLocked(route.trackId, buffer, cursor, chunkSamples, route.gainDb, route.pan);
                if (!route.mute && route.audible)
                    addRouteSendsLocked(route, buffer, cursor, chunkSamples);
                if (route.parentTrackId.isNotEmpty() && route.outputEnabled && !route.mute && route.audible)
                    addRouteToGroupLocked(route, buffer, cursor, chunkSamples);
                else
                    addRouteToOutputLocked(route, buffer, cursor, chunkSamples);
            }

            cursor = nextOffset;
        }
    }

    bool AudioEngine::startSampleVoiceLocked(const Sequencer::TriggerEvent& ev)
    {
        if (findTrackRouteState(ev.trackId) == nullptr)
            return false;

        auto found = sampleInstruments.find(ev.instrumentId);
        if (found == sampleInstruments.end() || found->second.zones.empty()) return false;

        auto& instrument = found->second;
        const int zoneCount = (int) instrument.zones.size();
        const double noteLengthSeconds = sampleRate > 0.0 && ev.lengthSamples > 0
            ? (double) ev.lengthSamples / sampleRate
            : 0.0;
        const auto pitchVelocityMatches = [&ev](const SampleInstrument::Zone& zone) {
            return ev.pitch >= zone.loNote && ev.pitch <= zone.hiNote
                && ev.velocity >= zone.loVel && ev.velocity <= zone.hiVel;
        };
        const auto lengthBandMatches = [noteLengthSeconds](const SampleInstrument::Zone& zone) {
            return noteLengthSeconds > 0.0
                && zone.hiLengthSeconds > 0.0
                && noteLengthSeconds >= zone.loLengthSeconds
                && noteLengthSeconds <= zone.hiLengthSeconds;
        };
        const auto durationDistance = [noteLengthSeconds](const SampleInstrument::Zone& zone) {
            if (noteLengthSeconds <= 0.0 || zone.durationSeconds <= 0.0)
                return std::numeric_limits<double>::infinity();
            return std::abs(zone.durationSeconds - noteLengthSeconds);
        };
        const auto countWhere = [&instrument, zoneCount](const auto& predicate) {
            int count = 0;
            for (int i = 0; i < zoneCount; ++i)
                if (predicate(instrument.zones[(size_t) i])) ++count;
            return count;
        };
        const auto selectRoundRobin = [&instrument, zoneCount](const auto& predicate, int count) {
            if (count <= 0) return -1;
            const int targetMatch = instrument.nextIndex % count;
            int currentMatch = 0;
            for (int i = 0; i < zoneCount; ++i)
            {
                if (!predicate(instrument.zones[(size_t) i])) continue;
                if (currentMatch == targetMatch)
                {
                    instrument.nextIndex = (instrument.nextIndex + 1) % juce::jmax(1, count);
                    return i;
                }
                ++currentMatch;
            }
            return -1;
        };
        const auto selectClosestDuration = [&](const auto& basePredicate) {
            double bestDistance = std::numeric_limits<double>::infinity();
            for (int i = 0; i < zoneCount; ++i)
            {
                const auto& zone = instrument.zones[(size_t) i];
                if (!basePredicate(zone)) continue;
                bestDistance = juce::jmin(bestDistance, durationDistance(zone));
            }
            if (!std::isfinite(bestDistance)) return -1;
            const double epsilon = 0.003;
            const auto closePredicate = [&](const SampleInstrument::Zone& zone) {
                return basePredicate(zone) && std::abs(durationDistance(zone) - bestDistance) <= epsilon;
            };
            return selectRoundRobin(closePredicate, countWhere(closePredicate));
        };

        int candidateIndex = -1;
        const int lengthMatchCount = countWhere([&](const SampleInstrument::Zone& zone) {
            return pitchVelocityMatches(zone) && lengthBandMatches(zone);
        });
        if (lengthMatchCount > 0)
        {
            candidateIndex = selectRoundRobin([&](const SampleInstrument::Zone& zone) {
                return pitchVelocityMatches(zone) && lengthBandMatches(zone);
            }, lengthMatchCount);
        }
        if (candidateIndex < 0)
            candidateIndex = selectClosestDuration(pitchVelocityMatches);

        const int matchCount = countWhere(pitchVelocityMatches);
        if (candidateIndex < 0 && matchCount > 0)
        {
            candidateIndex = selectRoundRobin(pitchVelocityMatches, matchCount);
        }
        if (candidateIndex < 0)
        {
            const int fallbackLengthMatchCount = countWhere(lengthBandMatches);
            if (fallbackLengthMatchCount > 0)
                candidateIndex = selectRoundRobin(lengthBandMatches, fallbackLengthMatchCount);
        }
        if (candidateIndex < 0)
            candidateIndex = selectClosestDuration([](const SampleInstrument::Zone&) { return true; });
        if (candidateIndex < 0)
        {
            const auto anyZone = [](const SampleInstrument::Zone&) { return true; };
            candidateIndex = selectRoundRobin(anyZone, zoneCount);
        }
        if (candidateIndex < 0 || candidateIndex >= zoneCount) return false;

        const auto& zone = instrument.zones[(size_t) candidateIndex];
        const auto sample = zone.buffer;
        if (!sample) return false;

        const double pitchRate = juce::MidiMessage::getMidiNoteInHertz(ev.pitch)
            / juce::MidiMessage::getMidiNoteInHertz(juce::jlimit(0, 127, zone.rootNote));
        const double tuningRate = std::pow(2.0, zone.tuningCents / 1200.0);
        const float voiceGain = juce::Decibels::decibelsToGain(zone.volumeDb + ev.segmentGainDb);
        const auto msToSamples = [this](float ms) {
            return juce::jmax(0, (int) std::round((double) ms * sampleRate / 1000.0));
        };
        if (activeSampleVoices.size() >= maxActiveSampleVoices)
            activeSampleVoices.erase(activeSampleVoices.begin());
        const int sourceSamples = sample->audio.getNumSamples();
        const int zoneStart = juce::jlimit(0, juce::jmax(0, sourceSamples - 2), zone.startSample);
        const int zoneEnd = zone.endSample > zoneStart + 1
            ? juce::jlimit(zoneStart + 2, sourceSamples, zone.endSample)
            : sourceSamples;
        const bool loopEnabled = zone.loopEnabled
            && zone.loopEnd > zone.loopStart + 1
            && zone.loopStart >= zoneStart
            && zone.loopEnd <= zoneEnd;

        if (zone.chokeGroup > 0)
        {
            const int chokeFadeSamples = juce::jmax(1, msToSamples(8.0f));
            for (auto& voice : activeSampleVoices)
            {
                if (voice.trackId != ev.trackId
                    || voice.instrumentId != ev.instrumentId
                    || voice.chokeGroup != zone.chokeGroup
                    || voice.releaseRemainingSamples >= 0)
                {
                    continue;
                }

                voice.releaseSamples = chokeFadeSamples;
                voice.releaseRemainingSamples = chokeFadeSamples;
            }
        }

        activeSampleVoices.push_back({
            ev.trackId,
            ev.instrumentId,
            sample,
            (double) zoneStart,
            (sample->sourceSampleRate / sampleRate) * pitchRate * tuningRate,
            juce::jlimit(0.0f, 1.0f, ev.velocity / 127.0f) * 0.7f * voiceGain,
            juce::jlimit(-1.0f, 1.0f, zone.pan),
            ev.sampleOffset,
            zone.oneShot ? juce::jmax(1, zoneEnd - zoneStart) : juce::jmax(1, ev.lengthSamples),
            0,
            msToSamples(instrument.attackMs),
            msToSamples(instrument.releaseMs),
            -1,
            juce::jmax(8, juce::jmin(256, msToSamples(2.0f))),
            loopEnabled,
            loopEnabled ? zone.loopStart : 0,
            loopEnabled ? zone.loopEnd : 0,
            zone.oneShot,
            zone.chokeGroup,
            zoneEnd,
        });
        return true;
    }

    bool AudioEngine::startAudioClipVoiceLocked(const Sequencer::AudioClipEvent& ev)
    {
        if (findTrackRouteState(ev.trackId) == nullptr)
            return false;

        auto found = audioFileBuffers.find(ev.audioFileId);
        if (found == audioFileBuffers.end() || found->second == nullptr)
            return false;

        const auto sample = found->second;
        if (sample->audio.getNumSamples() <= 1 || sample->sourceSampleRate <= 0.0 || sampleRate <= 0.0)
            return false;

        const double tempo = juce::jmax(1.0, seq.getTempo());
        const double speed = juce::jmax(0.1, seq.getSpeed());
        const double sourceOffsetSeconds = ev.sourceOffsetBeats * 60.0 / tempo;
        const double sourcePosition = sourceOffsetSeconds * sample->sourceSampleRate;
        if (sourcePosition >= sample->audio.getNumSamples() - 1)
            return false;

        const double outputSamplesPerBeat = (sampleRate * 60.0 / tempo) / speed;
        const int clipTotalSamples = juce::jmax(1, (int) std::round(ev.clipLengthBeats * outputSamplesPerBeat));
        const int elapsedSamples = juce::jlimit(0, clipTotalSamples, (int) std::round(ev.clipOffsetBeats * outputSamplesPerBeat));
        const auto fades = normalizedFadeSamples(ev.fadeInBeats, ev.fadeOutBeats, outputSamplesPerBeat, clipTotalSamples);

        activeAudioClipVoices.push_back({
            ev.trackId,
            sample,
            juce::jmax(0.0, sourcePosition),
            (sample->sourceSampleRate / sampleRate) * speed,
            juce::Decibels::decibelsToGain(ev.segmentGainDb),
            ev.sampleOffset,
            ev.lengthSamples,
            elapsedSamples,
            clipTotalSamples,
            fades.in,
            fades.out,
        });
        return true;
    }

    void AudioEngine::renderSampleVoicesForRouteLocked(const Id& trackId,
                                                       juce::AudioBuffer<float>& route,
                                                       int numSamples)
    {
        const int outChannels = route.getNumChannels();
        size_t writeIndex = 0;
        for (size_t readIndex = 0; readIndex < activeSampleVoices.size(); ++readIndex)
        {
            auto& voice = activeSampleVoices[readIndex];
            const auto& sample = voice.sample;
            if (!sample || sample->audio.getNumSamples() <= 0)
                continue;

            if (voice.trackId != trackId)
            {
                if (writeIndex != readIndex)
                    activeSampleVoices[writeIndex] = std::move(voice);
                ++writeIndex;
                continue;
            }

            const int sourceChannels = sample->audio.getNumChannels();
            const int sourceSamples = sample->audio.getNumSamples();
            const int sourceEnd = voice.sampleEnd > 0
                ? juce::jlimit(1, sourceSamples, voice.sampleEnd)
                : sourceSamples;
            const int start = juce::jlimit(0, numSamples, voice.startOffset);
            const auto panGains = equalPowerPan(voice.pan);
            voice.startOffset = 0;
            bool finished = false;

            for (int outSample = start; outSample < numSamples; ++outSample)
            {
                if (voice.loopEnabled && voice.releaseRemainingSamples < 0 && voice.position >= (double) voice.loopEnd)
                    voice.position = (double) voice.loopStart + std::fmod(voice.position - (double) voice.loopStart,
                                                                          (double) juce::jmax(1, voice.loopEnd - voice.loopStart));

                const int sourceIndex = (int) voice.position;
                if (sourceIndex >= sourceEnd - 1) { finished = true; break; }

                if (!voice.oneShot && voice.remainingSamples <= 0 && voice.releaseRemainingSamples < 0)
                    voice.releaseRemainingSamples = voice.releaseSamples;

                const float attackGain = voice.attackSamples > 1
                    ? juce::jlimit(0.0f, 1.0f, (float) (voice.elapsedSamples + 1) / (float) voice.attackSamples)
                    : 1.0f;
                const float releaseGain = voice.releaseRemainingSamples >= 0
                    ? (voice.releaseSamples > 0
                        ? juce::jlimit(0.0f, 1.0f, (float) voice.releaseRemainingSamples / (float) voice.releaseSamples)
                        : 0.0f)
                    : 1.0f;
                const int samplesToEnd = juce::jmax(0, sourceEnd - 1 - sourceIndex);
                const float endFadeGain = samplesToEnd < voice.endFadeSamples
                    ? juce::jlimit(0.0f, 1.0f, (float) samplesToEnd / (float) voice.endFadeSamples)
                    : 1.0f;
                const float envelopeGain = attackGain * releaseGain * endFadeGain;
                if (envelopeGain <= 0.0f && voice.releaseRemainingSamples >= 0)
                {
                    finished = true;
                    break;
                }

                const float frac = (float) (voice.position - sourceIndex);
                for (int ch = 0; ch < outChannels; ++ch)
                {
                    const int sourceCh = juce::jmin(ch, sourceChannels - 1);
                    const float a = sample->audio.getSample(sourceCh, sourceIndex);
                    const float b = sample->audio.getSample(sourceCh, sourceIndex + 1);
                    const float panGain = ch == 0 ? panGains.left : ch == 1 ? panGains.right : 1.0f;
                    route.addSample(ch, outSample, (a + (b - a) * frac) * voice.gain * envelopeGain * panGain);
                }
                voice.position += voice.rate;
                if (voice.loopEnabled && voice.releaseRemainingSamples < 0 && voice.position >= (double) voice.loopEnd)
                    voice.position = (double) voice.loopStart + std::fmod(voice.position - (double) voice.loopStart,
                                                                          (double) juce::jmax(1, voice.loopEnd - voice.loopStart));
                ++voice.elapsedSamples;
                if (voice.releaseRemainingSamples >= 0)
                {
                    --voice.releaseRemainingSamples;
                    if (voice.releaseRemainingSamples <= 0)
                    {
                        finished = true;
                        break;
                    }
                }
                else
                {
                    --voice.remainingSamples;
                }
            }

            if (finished || voice.position >= sourceEnd - 1)
                continue;

            if (writeIndex != readIndex)
                activeSampleVoices[writeIndex] = std::move(voice);
            ++writeIndex;
        }
        activeSampleVoices.resize(writeIndex);
    }

    void AudioEngine::renderAudioClipVoicesForRouteLocked(const Id& trackId,
                                                          juce::AudioBuffer<float>& route,
                                                          int numSamples)
    {
        const int outChannels = route.getNumChannels();
        size_t writeIndex = 0;
        for (size_t readIndex = 0; readIndex < activeAudioClipVoices.size(); ++readIndex)
        {
            auto& voice = activeAudioClipVoices[readIndex];
            const auto& sample = voice.sample;
            if (!sample || sample->audio.getNumSamples() <= 0 || voice.remainingSamples <= 0)
                continue;

            if (voice.trackId != trackId)
            {
                if (writeIndex != readIndex)
                    activeAudioClipVoices[writeIndex] = std::move(voice);
                ++writeIndex;
                continue;
            }

            const int sourceChannels = sample->audio.getNumChannels();
            const int sourceSamples = sample->audio.getNumSamples();
            const int start = juce::jlimit(0, numSamples, voice.startOffset);
            voice.startOffset = 0;

            for (int outSample = start; outSample < numSamples && voice.remainingSamples > 0; ++outSample)
            {
                const int sourceIndex = (int) voice.position;
                if (sourceIndex >= sourceSamples - 1)
                {
                    voice.remainingSamples = 0;
                    break;
                }

                const float frac = (float) (voice.position - sourceIndex);
                float envelope = 1.0f;
                if (voice.fadeInSamples > 0 && voice.elapsedSamples < voice.fadeInSamples)
                    envelope *= juce::jlimit(0.0f, 1.0f, (float) voice.elapsedSamples / (float) voice.fadeInSamples);
                if (voice.fadeOutSamples > 0)
                {
                    const int samplesUntilClipEnd = juce::jmax(0, voice.totalSamples - voice.elapsedSamples);
                    if (samplesUntilClipEnd <= voice.fadeOutSamples)
                        envelope *= juce::jlimit(0.0f, 1.0f, (float) (samplesUntilClipEnd - 1) / (float) voice.fadeOutSamples);
                }
                const float gain = voice.gain * envelope;
                for (int ch = 0; ch < outChannels; ++ch)
                {
                    const int sourceCh = juce::jmin(ch, sourceChannels - 1);
                    const float a = sample->audio.getSample(sourceCh, sourceIndex);
                    const float b = sample->audio.getSample(sourceCh, sourceIndex + 1);
                    route.addSample(ch, outSample, (a + (b - a) * frac) * gain);
                }

                voice.position += voice.rate;
                --voice.remainingSamples;
                ++voice.elapsedSamples;
            }

            if (voice.remainingSamples <= 0 || voice.position >= sourceSamples - 1)
                continue;

            if (writeIndex != readIndex)
                activeAudioClipVoices[writeIndex] = std::move(voice);
            ++writeIndex;
        }
        activeAudioClipVoices.resize(writeIndex);
    }

    void AudioEngine::publishRenderTiming(int numSamples,
                                          int64_t scheduleTicks,
                                          int64_t synthTicks,
                                          int64_t voiceTicks,
                                          int64_t modulationTicks,
                                          int64_t samplesTicks,
                                          int64_t fxTicks,
                                          int64_t filterFxTicks,
                                          int64_t analyzerTicks,
                                          int64_t copyTicks,
                                          int64_t totalTicks,
                                          int activeSynthVoiceCount,
                                          int activeSampleVoiceCount,
                                          int activeAudioClipVoiceCount,
                                          int routeCount,
                                          int automationEventCount,
                                          RouteEffectWorkStats routeEffectWork) noexcept
    {
        renderTimingBlockSamples.store(numSamples, std::memory_order_relaxed);
        renderTimingScheduleTicks.store(scheduleTicks, std::memory_order_relaxed);
        renderTimingSynthTicks.store(synthTicks, std::memory_order_relaxed);
        renderTimingVoiceTicks.store(voiceTicks, std::memory_order_relaxed);
        renderTimingModulationTicks.store(modulationTicks, std::memory_order_relaxed);
        renderTimingSamplesTicks.store(samplesTicks, std::memory_order_relaxed);
        renderTimingFxTicks.store(fxTicks, std::memory_order_relaxed);
        renderTimingFilterFxTicks.store(filterFxTicks, std::memory_order_relaxed);
        renderTimingAnalyzerTicks.store(analyzerTicks, std::memory_order_relaxed);
        renderTimingCopyTicks.store(copyTicks, std::memory_order_relaxed);
        renderTimingTotalTicks.store(totalTicks, std::memory_order_relaxed);
        renderTimingActiveSynthVoices.store(activeSynthVoiceCount, std::memory_order_relaxed);
        renderTimingActiveSampleVoices.store(activeSampleVoiceCount, std::memory_order_relaxed);
        renderTimingActiveAudioClipVoices.store(activeAudioClipVoiceCount, std::memory_order_relaxed);
        renderTimingRouteCount.store(routeCount, std::memory_order_relaxed);
        renderTimingAutomationEventCount.store(automationEventCount, std::memory_order_relaxed);
        const auto voiceWork = InstrumentVoice::consumeRenderWorkStats();
        renderTimingVoiceRenderBlocks.store(voiceWork.voiceBlocks, std::memory_order_relaxed);
        renderTimingVoiceRenderSamples.store(voiceWork.voiceSamples, std::memory_order_relaxed);
        renderTimingOscillatorSamples.store(voiceWork.oscillatorSamples, std::memory_order_relaxed);
        renderTimingWavetableVoiceSamples.store(voiceWork.wavetableVoiceSamples, std::memory_order_relaxed);
        renderTimingAetherOscASamples.store(voiceWork.aetherOscASamples, std::memory_order_relaxed);
        renderTimingAetherOscBSamples.store(voiceWork.aetherOscBSamples, std::memory_order_relaxed);
        renderTimingAetherSubSamples.store(voiceWork.aetherSubSamples, std::memory_order_relaxed);
        renderTimingAetherNoiseSamples.store(voiceWork.aetherNoiseSamples, std::memory_order_relaxed);
        renderTimingFilterSamples.store(voiceWork.filterSamples, std::memory_order_relaxed);
        renderTimingFilterDriveSamples.store(voiceWork.filterDriveSamples, std::memory_order_relaxed);
        renderTimingFilterCoefficientUpdates.store(voiceWork.filterCoefficientUpdates, std::memory_order_relaxed);
        renderTimingFilterCutoffUpdates.store(voiceWork.filterCutoffUpdates, std::memory_order_relaxed);
        renderTimingFilterResonanceUpdates.store(voiceWork.filterResonanceUpdates, std::memory_order_relaxed);
        renderTimingModulationSamples.store(voiceWork.modulationSamples, std::memory_order_relaxed);
        renderTimingRealtimeRampSamples.store(voiceWork.realtimeRampSamples, std::memory_order_relaxed);
        renderTimingOscillatorRateCalculations.store(voiceWork.oscillatorRateCalculations, std::memory_order_relaxed);
        renderTimingWavetableFrequencyUpdates.store(voiceWork.wavetableFrequencyUpdates, std::memory_order_relaxed);
        renderTimingWavetablePositionUpdates.store(voiceWork.wavetablePositionUpdates, std::memory_order_relaxed);
        renderTimingRouteEffectSamples.store(routeEffectWork.totalSamples, std::memory_order_relaxed);
        renderTimingRouteFilterEffectSamples.store(routeEffectWork.filterSamples, std::memory_order_relaxed);
        renderTimingRouteNonlinearEffectSamples.store(routeEffectWork.nonlinearSamples, std::memory_order_relaxed);
        renderTimingRouteDelayEffectSamples.store(routeEffectWork.delaySamples, std::memory_order_relaxed);
        renderTimingSequence.fetch_add(1, std::memory_order_release);
    }

    void AudioEngine::audioDeviceAboutToStart(juce::AudioIODevice* dev)
    {
        const int block = dev->getCurrentBufferSizeSamples();
        const int channels = dev->getActiveOutputChannels().countNumberOfSetBits();
        prepareForOffline(dev->getCurrentSampleRate(), block, channels);
    }

    void AudioEngine::audioDeviceStopped() {}

    void AudioEngine::handleIncomingMidiMessage(juce::MidiInput*, const juce::MidiMessage& message)
    {
        handleMidiExpressionMessage(message);
    }

    void AudioEngine::audioDeviceIOCallbackWithContext(const float* const* inputChannels, int numInputChannels,
                                                       float* const* outputChannels, int numOutChannels,
                                                       int numSamples,
                                                       const juce::AudioIODeviceCallbackContext&)
    {
        juce::ScopedNoDenormals noDenormals;
        inputRecording.captureBlock(inputChannels, numInputChannels, numSamples);

        const auto blockStartTicks = juce::Time::getHighResolutionTicks();
        auto markTicks = [] { return juce::Time::getHighResolutionTicks(); };
        auto ticksBetween = [](int64_t start, int64_t end) { return juce::jmax<int64_t>(0, end - start); };

        mixBuf.setSize(juce::jmax(2, numOutChannels), numSamples, false, false, true);
        routeBuf.setSize(juce::jmax(2, numOutChannels), numSamples, false, false, true);
        mixBuf.clear();

        // 1. Advance the sequencer; collect MIDI events for this block.
        auto phaseStartTicks = markTicks();
        int64_t modulationTicks = 0;
        juce::MidiBuffer midi;
        {
            const juce::ScopedTryLock lock(sampleLock);
            if (lock.isLocked())
            {
                drainTransportCommandsLocked();
                blockRealtimeParameterEvents.clear();
                blockRouteParameterEvents.clear();
                defaultNoteAutomationContextCount = 0;
                resetTrackMetersLocked();
                const auto modulationStartTicks = markTicks();
                drainRealtimeParameterChangesLocked(numSamples);
                advancePendingParameterAutomationLocked(numSamples);
                modulationTicks += ticksBetween(modulationStartTicks, markTicks());
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
                    if (isRouteAutomationTarget(ev.parameterId))
                    {
                        if (ev.trackId.isEmpty() || blockRouteParameterEvents.size() >= blockRouteParameterEvents.capacity())
                            return;
                        blockRouteParameterEvents.push_back({
                            ev.trackId,
                            ev.parameterId,
                            ev.value,
                            ev.sampleOffset,
                            ev.rampSamples,
                        });
                        return;
                    }

                    if (blockRealtimeParameterEvents.size() >= blockRealtimeParameterEvents.capacity())
                        return;
                    blockRealtimeParameterEvents.push_back(
                        makeRealtimeParameterChange(ev.instrumentId.toRawUTF8(),
                                                    ev.parameterId.toRawUTF8(),
                                                    ev.value,
                                                    ev.sampleOffset,
                                                    ev.rampSamples));
                };

                seq.render(numSamples,
                           [&](const Sequencer::TriggerEvent& ev) {
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
                           },
                           pushParameterEvent,
                           [&](const Sequencer::AudioClipEvent& ev) {
                               startAudioClipVoiceLocked(ev);
                           });
                std::stable_sort(blockRouteParameterEvents.begin(),
                                 blockRouteParameterEvents.end(),
                                 [](const RouteParameterAutomationEvent& a, const RouteParameterAutomationEvent& b) {
                                     if (a.trackId == b.trackId)
                                         return a.sampleOffset < b.sampleOffset;
                                     return a.trackId < b.trackId;
                                 });
            }
            else
            {
                blockRealtimeParameterEvents.clear();
                blockRouteParameterEvents.clear();
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
        int64_t voiceTicks = 0;
        int64_t samplesTicks = 0;
        int64_t routeEffectTicks = 0;
        RouteEffectWorkStats routeEffectWork;
        int activeSynthVoiceCount = 0;
        int activeSampleVoiceCount = 0;
        int activeAudioClipVoiceCount = 0;
        int routeCount = 0;
        int automationEventCount = 0;
        {
            const juce::ScopedTryLock lock(sampleLock);
            if (lock.isLocked())
            {
                VoiceAutomationInbox::setPending(defaultNoteAutomationContexts.data(),
                                                 defaultNoteAutomationContextCount);
                auto voiceStartTicks = markTicks();
                renderSynthWithRealtimeParametersLocked(synth, mixBuf, midi, {}, numSamples);
                voiceTicks += ticksBetween(voiceStartTicks, markTicks());
                activeSynthVoiceCount += countActiveSynthVoices(synth);
                VoiceAutomationInbox::clearPending();
                for (auto& bus : returnRenderStates)
                    bus.returnBuffer.clear();
                for (auto& group : groupRenderStates)
                    group.groupBuffer.clear();
                for (auto& route : instrumentRenderStates)
                {
                    routeBuf.clear();
                    if (route.synth != nullptr)
                    {
                        VoiceAutomationInbox::setPending(route.noteAutomationContexts.data(),
                                                         route.noteAutomationContextCount);
                        voiceStartTicks = markTicks();
                        renderSynthWithRealtimeParametersLocked(*route.synth,
                                                                routeBuf,
                                                                route.midi,
                                                                route.instrumentId.toRawUTF8(),
                                                                numSamples);
                        voiceTicks += ticksBetween(voiceStartTicks, markTicks());
                        activeSynthVoiceCount += countActiveSynthVoices(*route.synth);
                        VoiceAutomationInbox::clearPending();
                    }

                    const auto routeSampleStartTicks = markTicks();
                    renderSampleVoicesForRouteLocked(route.trackId, routeBuf, numSamples);
                    renderAudioClipVoicesForRouteLocked(route.trackId, routeBuf, numSamples);
                    samplesTicks += ticksBetween(routeSampleStartTicks, markTicks());
                    const auto routeModulationStartTicks = markTicks();
                    const auto routeEffectTicksBefore = routeEffectTicks;
                    processRouteAutomationLocked(route, routeBuf, numSamples, &routeEffectTicks, &routeEffectWork);
                    const auto routeAutomationTicks = ticksBetween(routeModulationStartTicks, markTicks());
                    modulationTicks += juce::jmax<int64_t>(0, routeAutomationTicks - (routeEffectTicks - routeEffectTicksBefore));
                }
                processGroupBusesLocked(numSamples, &routeEffectTicks, &routeEffectWork);
                processReturnBusesLocked(numSamples, &routeEffectTicks, &routeEffectWork);
                activeSampleVoiceCount = (int) activeSampleVoices.size();
                activeAudioClipVoiceCount = (int) activeAudioClipVoices.size();
                routeCount = (int) instrumentRenderStates.size() + (int) groupRenderStates.size() + (int) returnRenderStates.size();
                automationEventCount = (int) blockRealtimeParameterEvents.size()
                    + (int) blockRouteParameterEvents.size()
                    + (int) pendingParameterAutomation.size();
                publishTrackMetersLocked();
            }
            else
            {
                VoiceAutomationInbox::clearPending();
                const auto voiceStartTicks = markTicks();
                synth.renderNextBlock(mixBuf, midi, 0, numSamples);
                voiceTicks += ticksBetween(voiceStartTicks, markTicks());
                activeSynthVoiceCount = countActiveSynthVoices(synth);
            }
        }
        const auto synthTicks = juce::jmax<int64_t>(0, ticksBetween(phaseStartTicks, markTicks()) - samplesTicks);

        if (inputMonitoringEnabled.load(std::memory_order_acquire)
            && inputChannels != nullptr
            && numInputChannels > 0)
        {
            const float gain = inputMonitoringGain.load(std::memory_order_relaxed);
            for (int ch = 0; ch < mixBuf.getNumChannels(); ++ch)
            {
                const auto* source = inputChannels[juce::jmin(ch, numInputChannels - 1)];
                if (source != nullptr)
                    mixBuf.addFrom(ch, 0, source, numSamples, gain);
            }
        }

        // 3. Master chain: legacy engine bitcrush, global mastering EQ,
        //    project-owned gain/dynamics, then the final safety limiter.
        phaseStartTicks = markTicks();
        bitcrush.process(mixBuf);
        masterEq.setCurrentBeat(seq.getPosition());
        masterEq.process(mixBuf);
        processMasterChain(mixBuf, numSamples);
        masterLimiter.process(mixBuf);
        publishMasterMeter(numSamples);
        const auto masterFxTicks = ticksBetween(phaseStartTicks, markTicks());
        const auto fxTicks = masterFxTicks + routeEffectTicks;
        const auto filterFxTicks = routeEffectTicks;
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
                            voiceTicks,
                            modulationTicks,
                            samplesTicks,
                            fxTicks,
                            filterFxTicks,
                            analyzerTicks,
                            copyTicks,
                            ticksBetween(blockStartTicks, markTicks()),
                            activeSynthVoiceCount,
                            activeSampleVoiceCount,
                            activeAudioClipVoiceCount,
                            routeCount,
                            automationEventCount,
                            routeEffectWork);

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

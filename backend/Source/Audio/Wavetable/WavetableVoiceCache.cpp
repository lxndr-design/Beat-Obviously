#include "WavetableVoiceCache.h"

#include "WavetableFactory.h"

#include <atomic>
#include <map>
#include <mutex>

namespace beat::WavetableVoiceCache
{
    namespace
    {
        std::atomic<int64_t> wavetableCacheHits { 0 };
        std::atomic<int64_t> wavetableCacheMisses { 0 };
        std::atomic<int> wavetableCacheSize { 0 };

        BasicWavetableShape basicShapeForBank(int bank) noexcept
        {
            switch (bank)
            {
                case 1: return BasicWavetableShape::Sine;
                case 2: return BasicWavetableShape::Square;
                case 3: return BasicWavetableShape::Triangle;
                case 4: return BasicWavetableShape::Pulse;
                case 0:
                default: return BasicWavetableShape::Saw;
            }
        }

        std::array<WavetableFactory::CustomFrame, 4> factoryCustomFrames(
            const InstrumentVoice::Params::WavetableConfig& config) noexcept
        {
            std::array<WavetableFactory::CustomFrame, 4> frames;
            for (size_t i = 0; i < frames.size(); ++i)
            {
                frames[i] = {
                    juce::jlimit(0.0f, 1.0f, config.customFrames[i].brightness),
                    juce::jlimit(0.0f, 1.0f, config.customFrames[i].even),
                    juce::jlimit(0.0f, 1.0f, config.customFrames[i].fold),
                    juce::jlimit(0.0f, 1.0f, config.customFrames[i].formant),
                    juce::jlimit(0.0f, 1.0f, config.customFrames[i].notch),
                    juce::jlimit(-1.0f, 1.0f, config.customFrames[i].skew),
                    juce::jlimit(-1.0f, 1.0f, config.customFrames[i].tilt),
                    juce::jlimit(0.0f, 1.0f, config.customFrames[i].focus),
                    juce::jlimit(-1.0f, 1.0f, config.customFrames[i].phase),
                };
                for (size_t partial = 0; partial < frames[i].partials.size(); ++partial)
                    frames[i].partials[partial] = juce::jlimit(0.0f, 1.0f, config.customFrames[i].partials[partial]);
            }
            return frames;
        }

        Wavetable createTableForConfig(const InstrumentVoice::Params::WavetableConfig& config)
        {
            const auto warpMode = config.warpMode == 1
                ? WavetableWarpMode::Fold
                : config.warpMode == 2
                    ? WavetableWarpMode::Pinch
                    : WavetableWarpMode::Shape;
            if (config.custom || config.bank == 5)
                return WavetableFactory::createCustom(factoryCustomFrames(config), config.warp, warpMode, config.smoothInterpolation, config.morph);

            return WavetableFactory::createBasic(basicShapeForBank(config.bank), config.warp, warpMode);
        }

        juce::String wavetableCacheKey(const InstrumentVoice::Params::WavetableConfig& config)
        {
            juce::String key;
            const bool custom = config.custom || config.bank == 5;
            key << "bank=" << config.bank
                << "|custom=" << (custom ? 1 : 0)
                << "|warp=" << juce::String(juce::jlimit(0.0f, 1.0f, config.warp), 4)
                << "|warpMode=" << juce::jlimit(0, 2, config.warpMode)
                << "|smooth=" << (config.smoothInterpolation ? 1 : 0)
                << "|morph=" << juce::String(juce::jlimit(0.0f, 1.0f, config.morph), 4);
            if (custom)
            {
                for (const auto& frame : config.customFrames)
                {
                    key << "|"
                        << juce::String(juce::jlimit(0.0f, 1.0f, frame.brightness), 4) << ","
                        << juce::String(juce::jlimit(0.0f, 1.0f, frame.even), 4) << ","
                        << juce::String(juce::jlimit(0.0f, 1.0f, frame.fold), 4) << ","
                        << juce::String(juce::jlimit(0.0f, 1.0f, frame.formant), 4) << ","
                        << juce::String(juce::jlimit(0.0f, 1.0f, frame.notch), 4) << ","
                        << juce::String(juce::jlimit(-1.0f, 1.0f, frame.skew), 4) << ","
                        << juce::String(juce::jlimit(-1.0f, 1.0f, frame.tilt), 4) << ","
                        << juce::String(juce::jlimit(0.0f, 1.0f, frame.focus), 4) << ","
                        << juce::String(juce::jlimit(-1.0f, 1.0f, frame.phase), 4);
                    for (const auto partial : frame.partials)
                        key << "," << juce::String(juce::jlimit(0.0f, 1.0f, partial), 3);
                }
            }
            return key;
        }
    }

    std::shared_ptr<const Wavetable> sharedTableForConfig(const InstrumentVoice::Params::WavetableConfig& config)
    {
        static std::mutex cacheMutex;
        static std::map<juce::String, std::shared_ptr<const Wavetable>> cache;
        constexpr size_t maxCachedTables = 64;

        const auto key = wavetableCacheKey(config);
        {
            const std::lock_guard<std::mutex> lock(cacheMutex);
            if (auto found = cache.find(key); found != cache.end())
            {
                wavetableCacheHits.fetch_add(1, std::memory_order_relaxed);
                wavetableCacheSize.store((int) cache.size(), std::memory_order_relaxed);
                return found->second;
            }
        }

        wavetableCacheMisses.fetch_add(1, std::memory_order_relaxed);
        auto table = std::make_shared<Wavetable>(createTableForConfig(config));

        const std::lock_guard<std::mutex> lock(cacheMutex);
        if (auto found = cache.find(key); found != cache.end())
        {
            wavetableCacheHits.fetch_add(1, std::memory_order_relaxed);
            wavetableCacheSize.store((int) cache.size(), std::memory_order_relaxed);
            return found->second;
        }

        cache[key] = table;
        while (cache.size() > maxCachedTables)
            cache.erase(cache.begin());
        wavetableCacheSize.store((int) cache.size(), std::memory_order_relaxed);
        return table;
    }

    VoiceStats::WavetableCache stats() noexcept
    {
        return {
            wavetableCacheHits.load(std::memory_order_relaxed),
            wavetableCacheMisses.load(std::memory_order_relaxed),
            wavetableCacheSize.load(std::memory_order_relaxed),
        };
    }
}

#pragma once

#include "../Realtime/SpscRingBuffer.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <limits>
#include <vector>

namespace beat
{
    /**
     * Control/worker-side source for a bounded sample page cache.
     *
     * Implementations may perform file I/O, but readFrames() must only be
     * called by setup code or a background worker. It is never called by
     * BoundedSamplePageCache::readStereoFrame().
     */
    class SamplePageLoader
    {
    public:
        virtual ~SamplePageLoader() = default;
        virtual int readFrames(int64_t firstFrame,
                               int frameCount,
                               float* left,
                               float* right) noexcept = 0;
    };

    struct SamplePageCacheTelemetry
    {
        uint64_t cacheHits { 0 };
        uint64_t cacheMisses { 0 };
        uint64_t underflows { 0 };
        uint64_t requestsAccepted { 0 };
        uint64_t requestsRejected { 0 };
        uint64_t requestsDeduplicated { 0 };
        uint64_t pagesLoaded { 0 };
        uint64_t pageLoadsFailed { 0 };
        uint64_t pageLoadsDeferred { 0 };
    };

    /**
     * Fixed shared cache for polyphonic long-sample playback.
     *
     * The audio callback performs bounded atomic scans and sample copies only.
     * Misses enqueue a fixed-size request for the single background consumer.
     * Each resident slot owns two preallocated banks: the worker writes only an
     * inactive bank with no readers, then publishes page identity and bank in a
     * single release-store. Callback readers pin one bank without waiting.
     *
     * This class deliberately does not own a thread or a file reader. Thread
     * lifecycle and file access stay outside the callback and can be shared by
     * several sample assets when the production connection is made.
     */
    class BoundedSamplePageCache final
    {
    public:
        static constexpr int pageFrames = 4096;
        static constexpr size_t residentPageCount = 16;
        static constexpr size_t requestCapacity = 64;
        static constexpr size_t pendingRequestCount = requestCapacity;

        struct StereoFrame
        {
            float left { 0.0f };
            float right { 0.0f };
        };

        BoundedSamplePageCache(SamplePageLoader& sourceLoader, int64_t sourceFrames)
            : loader(sourceLoader), totalFrames(std::max<int64_t>(0, sourceFrames))
        {
            for (auto& slot : slots)
                for (auto& bank : slot.banks)
                {
                    bank.left.resize(pageFrames, 0.0f);
                    bank.right.resize(pageFrames, 0.0f);
                }
            for (auto& pending : pendingRequests)
                pending.store(noPage, std::memory_order_relaxed);
        }

        BoundedSamplePageCache(const BoundedSamplePageCache&) = delete;
        BoundedSamplePageCache& operator=(const BoundedSamplePageCache&) = delete;

        bool isValid() const noexcept { return totalFrames > 0; }
        int64_t frameCount() const noexcept { return totalFrames; }

        /** Audio-callback entry point. Never waits, allocates, or invokes the loader. */
        bool readStereoFrame(int64_t frameIndex, StereoFrame& output) noexcept
        {
            output = {};
            if (frameIndex < 0 || frameIndex >= totalFrames)
            {
                underflows.fetch_add(1, std::memory_order_relaxed);
                return false;
            }

            const int64_t pageIndex = frameIndex / pageFrames;
            const int offset = (int) (frameIndex % pageFrames);
            for (auto& slot : slots)
            {
                const uint64_t firstDescriptor = slot.descriptor.load(std::memory_order_acquire);
                if (descriptorPage(firstDescriptor) != pageIndex)
                    continue;

                const size_t bankIndex = descriptorBank(firstDescriptor);
                auto& bank = slot.banks[bankIndex];
                bank.readers.fetch_add(1, std::memory_order_acquire);
                const uint64_t verifiedDescriptor = slot.descriptor.load(std::memory_order_acquire);
                if (verifiedDescriptor != firstDescriptor)
                {
                    bank.readers.fetch_sub(1, std::memory_order_release);
                    continue;
                }

                const int validFrames = bank.validFrames;
                if (offset < validFrames)
                {
                    output.left = bank.left[(size_t) offset];
                    output.right = bank.right[(size_t) offset];
                    slot.lastUse.store(useClock.fetch_add(1, std::memory_order_relaxed),
                                       std::memory_order_relaxed);
                    bank.readers.fetch_sub(1, std::memory_order_release);
                    cacheHits.fetch_add(1, std::memory_order_relaxed);
                    return true;
                }
                bank.readers.fetch_sub(1, std::memory_order_release);
                break;
            }

            cacheMisses.fetch_add(1, std::memory_order_relaxed);
            underflows.fetch_add(1, std::memory_order_relaxed);
            requestPage(pageIndex);
            return false;
        }

        /** Setup-only synchronous preload. Must not be called from the callback. */
        bool preloadFrame(int64_t frameIndex) noexcept
        {
            if (frameIndex < 0 || frameIndex >= totalFrames)
                return false;
            return loadPage(frameIndex / pageFrames);
        }

        /** Background-consumer entry point. Services at most one request. */
        bool serviceOneRequest() noexcept
        {
            int64_t pageIndex = noPage;
            if (!requests.pop(pageIndex))
                return false;
            const bool loaded = loadPage(pageIndex);
            clearPending(pageIndex);
            return loaded;
        }

        bool hasPendingRequest() const noexcept { return !requests.empty(); }

        bool isPageResident(int64_t pageIndex) const noexcept
        {
            for (const auto& slot : slots)
                if (descriptorPage(slot.descriptor.load(std::memory_order_acquire)) == pageIndex)
                    return true;
            return false;
        }

        SamplePageCacheTelemetry telemetry() const noexcept
        {
            return {
                cacheHits.load(std::memory_order_relaxed),
                cacheMisses.load(std::memory_order_relaxed),
                underflows.load(std::memory_order_relaxed),
                requestsAccepted.load(std::memory_order_relaxed),
                requestsRejected.load(std::memory_order_relaxed),
                requestsDeduplicated.load(std::memory_order_relaxed),
                pagesLoaded.load(std::memory_order_relaxed),
                pageLoadsFailed.load(std::memory_order_relaxed),
                pageLoadsDeferred.load(std::memory_order_relaxed),
            };
        }

    private:
        static constexpr int64_t noPage = -1;

        struct PageBank
        {
            std::vector<float> left;
            std::vector<float> right;
            std::atomic<uint32_t> readers { 0 };
            int validFrames { 0 };
        };

        struct ResidentSlot
        {
            std::array<PageBank, 2> banks;
            std::atomic<uint64_t> descriptor { 0 };
            std::atomic<uint64_t> lastUse { 0 };
        };

        static uint64_t makeDescriptor(int64_t pageIndex, size_t bankIndex,
                                       uint32_t generation) noexcept
        {
            const uint64_t pageAndBank = (static_cast<uint64_t>(pageIndex + 1) << 1u)
                | (uint64_t) (bankIndex & 1u);
            return (static_cast<uint64_t>(generation) << 32u) | pageAndBank;
        }

        static int64_t descriptorPage(uint64_t descriptor) noexcept
        {
            const uint32_t pageAndBank = (uint32_t) descriptor;
            return pageAndBank == 0 ? noPage : (int64_t) (pageAndBank >> 1u) - 1;
        }

        static size_t descriptorBank(uint64_t descriptor) noexcept
        {
            return (size_t) ((uint32_t) descriptor & 1u);
        }

        void requestPage(int64_t pageIndex) noexcept
        {
            for (const auto& pending : pendingRequests)
                if (pending.load(std::memory_order_acquire) == pageIndex)
                {
                    requestsDeduplicated.fetch_add(1, std::memory_order_relaxed);
                    return;
                }

            std::atomic<int64_t>* claimed = nullptr;
            for (auto& pending : pendingRequests)
            {
                int64_t expected = noPage;
                if (pending.compare_exchange_strong(expected, pageIndex,
                                                    std::memory_order_acq_rel,
                                                    std::memory_order_relaxed))
                {
                    claimed = &pending;
                    break;
                }
            }

            if (claimed == nullptr || !requests.push(pageIndex))
            {
                if (claimed != nullptr)
                    claimed->store(noPage, std::memory_order_release);
                requestsRejected.fetch_add(1, std::memory_order_relaxed);
                return;
            }
            requestsAccepted.fetch_add(1, std::memory_order_relaxed);
        }

        void clearPending(int64_t pageIndex) noexcept
        {
            for (auto& pending : pendingRequests)
            {
                int64_t expected = pageIndex;
                if (pending.compare_exchange_strong(expected, noPage,
                                                    std::memory_order_release,
                                                    std::memory_order_relaxed))
                    return;
            }
        }

        bool loadPage(int64_t pageIndex) noexcept
        {
            if (pageIndex < 0 || pageIndex > (totalFrames - 1) / pageFrames)
                return false;
            if (isPageResident(pageIndex))
                return true;

            ResidentSlot* selected = nullptr;
            uint64_t oldestUse = std::numeric_limits<uint64_t>::max();
            for (auto& slot : slots)
            {
                const uint64_t descriptor = slot.descriptor.load(std::memory_order_acquire);
                if (descriptor == 0)
                {
                    selected = &slot;
                    break;
                }
                const uint64_t use = slot.lastUse.load(std::memory_order_relaxed);
                if (use < oldestUse)
                {
                    oldestUse = use;
                    selected = &slot;
                }
            }
            if (selected == nullptr)
                return false;

            const uint64_t oldDescriptor = selected->descriptor.load(std::memory_order_acquire);
            const size_t writeBankIndex = 1u - descriptorBank(oldDescriptor);
            auto& bank = selected->banks[writeBankIndex];
            if (bank.readers.load(std::memory_order_acquire) != 0)
            {
                pageLoadsDeferred.fetch_add(1, std::memory_order_relaxed);
                return false;
            }

            std::fill(bank.left.begin(), bank.left.end(), 0.0f);
            std::fill(bank.right.begin(), bank.right.end(), 0.0f);
            const int64_t firstFrame = pageIndex * pageFrames;
            const int requestedFrames = (int) std::min<int64_t>(pageFrames, totalFrames - firstFrame);
            const int loadedFrames = loader.readFrames(firstFrame, requestedFrames,
                                                       bank.left.data(), bank.right.data());
            if (loadedFrames <= 0)
            {
                bank.validFrames = 0;
                pageLoadsFailed.fetch_add(1, std::memory_order_relaxed);
                return false;
            }

            bank.validFrames = std::min(loadedFrames, requestedFrames);
            selected->lastUse.store(useClock.fetch_add(1, std::memory_order_relaxed),
                                    std::memory_order_relaxed);
            const uint32_t generation = publishGeneration.fetch_add(1, std::memory_order_relaxed);
            selected->descriptor.store(makeDescriptor(pageIndex, writeBankIndex, generation),
                                       std::memory_order_release);
            pagesLoaded.fetch_add(1, std::memory_order_relaxed);
            return true;
        }

        SamplePageLoader& loader;
        const int64_t totalFrames;
        std::array<ResidentSlot, residentPageCount> slots;
        SpscRingBuffer<int64_t, requestCapacity> requests;
        std::array<std::atomic<int64_t>, pendingRequestCount> pendingRequests;
        std::atomic<uint64_t> useClock { 1 };
        std::atomic<uint32_t> publishGeneration { 1 };
        std::atomic<uint64_t> cacheHits { 0 };
        std::atomic<uint64_t> cacheMisses { 0 };
        std::atomic<uint64_t> underflows { 0 };
        std::atomic<uint64_t> requestsAccepted { 0 };
        std::atomic<uint64_t> requestsRejected { 0 };
        std::atomic<uint64_t> requestsDeduplicated { 0 };
        std::atomic<uint64_t> pagesLoaded { 0 };
        std::atomic<uint64_t> pageLoadsFailed { 0 };
        std::atomic<uint64_t> pageLoadsDeferred { 0 };
    };
}

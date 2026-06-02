#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <type_traits>
#include <utility>

namespace beat
{
    /**
     * Fixed-capacity single-producer/single-consumer queue.
     *
     * Designed for UI/control-thread -> audio-thread message passing where:
     * - capacity is known up front
     * - push is called from one producer thread
     * - pop is called from one consumer thread
     * - no heap allocation, locks, or blocking occur after construction
     */
    template <typename T, size_t Capacity>
    class SpscRingBuffer
    {
    public:
        static_assert(Capacity > 0, "SpscRingBuffer capacity must be greater than zero");
        static_assert(std::is_default_constructible_v<T>, "SpscRingBuffer values must be default constructible");

        bool push(const T& value) noexcept(std::is_nothrow_copy_assignable_v<T>)
        {
            const auto head = writeIndex.load(std::memory_order_relaxed);
            const auto next = increment(head);
            if (next == readIndex.load(std::memory_order_acquire))
                return false;

            buffer[head] = value;
            writeIndex.store(next, std::memory_order_release);
            return true;
        }

        bool push(T&& value) noexcept(std::is_nothrow_move_assignable_v<T>)
        {
            const auto head = writeIndex.load(std::memory_order_relaxed);
            const auto next = increment(head);
            if (next == readIndex.load(std::memory_order_acquire))
                return false;

            buffer[head] = std::move(value);
            writeIndex.store(next, std::memory_order_release);
            return true;
        }

        bool pop(T& out) noexcept(std::is_nothrow_move_assignable_v<T>)
        {
            const auto tail = readIndex.load(std::memory_order_relaxed);
            if (tail == writeIndex.load(std::memory_order_acquire))
                return false;

            out = std::move(buffer[tail]);
            readIndex.store(increment(tail), std::memory_order_release);
            return true;
        }

        void clear() noexcept
        {
            readIndex.store(writeIndex.load(std::memory_order_acquire), std::memory_order_release);
        }

        bool empty() const noexcept
        {
            return readIndex.load(std::memory_order_acquire) == writeIndex.load(std::memory_order_acquire);
        }

        bool full() const noexcept
        {
            return increment(writeIndex.load(std::memory_order_acquire)) == readIndex.load(std::memory_order_acquire);
        }

        size_t size() const noexcept
        {
            const auto head = writeIndex.load(std::memory_order_acquire);
            const auto tail = readIndex.load(std::memory_order_acquire);
            return head >= tail ? head - tail : storageSize - tail + head;
        }

        constexpr size_t capacity() const noexcept { return Capacity; }

    private:
        static constexpr size_t storageSize = Capacity + 1;

        static constexpr size_t increment(size_t value) noexcept
        {
            return (value + 1) % storageSize;
        }

        std::array<T, storageSize> buffer {};
        alignas(64) std::atomic<size_t> writeIndex { 0 };
        alignas(64) std::atomic<size_t> readIndex { 0 };
    };
}

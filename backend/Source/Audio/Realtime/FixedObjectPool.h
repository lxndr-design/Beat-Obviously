#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <type_traits>

namespace beat
{
    /**
     * Fixed-size object pool with lock-free slot acquisition.
     *
     * Objects are default-constructed with the pool and reused. Callers acquire
     * a pointer, mutate it, and release it when done. The pool never allocates
     * after construction and is suitable for bounded real-time work where
     * object lifetime can be explicit.
     */
    template <typename T, size_t Capacity>
    class FixedObjectPool
    {
    public:
        static_assert(Capacity > 0, "FixedObjectPool capacity must be greater than zero");
        static_assert(std::is_nothrow_default_constructible_v<T>, "FixedObjectPool values must be nothrow default constructible");
        static_assert(std::is_nothrow_copy_assignable_v<T>, "FixedObjectPool values must be nothrow copy assignable");

        FixedObjectPool() noexcept
        {
            for (auto& flag : inUse)
                flag.store(false, std::memory_order_relaxed);
        }

        T* tryAcquire() noexcept
        {
            for (size_t i = 0; i < Capacity; ++i)
            {
                bool expected = false;
                if (inUse[i].compare_exchange_strong(expected, true, std::memory_order_acq_rel, std::memory_order_relaxed))
                    return &objects[i];
            }
            return nullptr;
        }

        void release(T* object) noexcept
        {
            if (object == nullptr)
                return;

            const auto index = indexOf(object);
            if (index >= Capacity)
                return;

            objects[index] = T {};
            inUse[index].store(false, std::memory_order_release);
        }

        bool owns(const T* object) const noexcept
        {
            return indexOf(object) < Capacity;
        }

        size_t used() const noexcept
        {
            size_t count = 0;
            for (const auto& flag : inUse)
                if (flag.load(std::memory_order_acquire))
                    ++count;
            return count;
        }

        constexpr size_t capacity() const noexcept { return Capacity; }

    private:
        size_t indexOf(const T* object) const noexcept
        {
            if (object == nullptr)
                return Capacity;
            for (size_t i = 0; i < Capacity; ++i)
                if (object == &objects[i])
                    return i;
            return Capacity;
        }

        std::array<T, Capacity> objects {};
        std::array<std::atomic<bool>, Capacity> inUse {};
    };
}

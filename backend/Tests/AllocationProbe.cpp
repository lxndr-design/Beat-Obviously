#include "AllocationProbe.h"

#include <cstdlib>
#include <new>
#include <array>

namespace
{
    thread_local bool probeEnabled = false;
    thread_local size_t allocationCount = 0;
    thread_local std::array<void*, 64> allocationCallsites {};

    void recordAllocation(void* callsite) noexcept
    {
        if (probeEnabled)
        {
            if (allocationCount < allocationCallsites.size())
                allocationCallsites[allocationCount] = callsite;
            ++allocationCount;
        }
    }

    void* allocate(size_t size, void* callsite)
    {
        recordAllocation(callsite);
        if (void* memory = std::malloc(size == 0 ? 1 : size))
            return memory;
        throw std::bad_alloc();
    }

    void* allocateAligned(size_t size, size_t alignment, void* callsite)
    {
        recordAllocation(callsite);
        void* memory = nullptr;
        if (posix_memalign(&memory, alignment, size == 0 ? alignment : size) == 0)
            return memory;
        throw std::bad_alloc();
    }
}

void* operator new(size_t size) { return allocate(size, __builtin_return_address(0)); }
void* operator new[](size_t size) { return allocate(size, __builtin_return_address(0)); }
void* operator new(size_t size, const std::nothrow_t&) noexcept { try { return allocate(size, __builtin_return_address(0)); } catch (...) { return nullptr; } }
void* operator new[](size_t size, const std::nothrow_t&) noexcept { try { return allocate(size, __builtin_return_address(0)); } catch (...) { return nullptr; } }
void* operator new(size_t size, std::align_val_t alignment) { return allocateAligned(size, (size_t) alignment, __builtin_return_address(0)); }
void* operator new[](size_t size, std::align_val_t alignment) { return allocateAligned(size, (size_t) alignment, __builtin_return_address(0)); }
void* operator new(size_t size, std::align_val_t alignment, const std::nothrow_t&) noexcept { try { return allocateAligned(size, (size_t) alignment, __builtin_return_address(0)); } catch (...) { return nullptr; } }
void* operator new[](size_t size, std::align_val_t alignment, const std::nothrow_t&) noexcept { try { return allocateAligned(size, (size_t) alignment, __builtin_return_address(0)); } catch (...) { return nullptr; } }
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete[](void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, size_t) noexcept { std::free(memory); }
void operator delete[](void* memory, size_t) noexcept { std::free(memory); }
void operator delete(void* memory, std::align_val_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::align_val_t) noexcept { std::free(memory); }
void operator delete(void* memory, size_t, std::align_val_t) noexcept { std::free(memory); }
void operator delete[](void* memory, size_t, std::align_val_t) noexcept { std::free(memory); }

namespace beat::test
{
    void beginAllocationProbe() noexcept
    {
        allocationCount = 0;
        allocationCallsites.fill(nullptr);
        probeEnabled = true;
    }

    size_t endAllocationProbe() noexcept
    {
        probeEnabled = false;
        return allocationCount;
    }

    void* allocationProbeCallsite(size_t index) noexcept
    {
        return index < allocationCallsites.size() ? allocationCallsites[index] : nullptr;
    }
}

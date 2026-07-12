#pragma once

#include <cstdint>

namespace beat::test
{
    enum class RealtimeViolationKind : uint8_t
    {
        heapAllocation,
        blockingLock,
        fileOperation,
        lazyInitialization,
        containerGrowth,
    };

#if BEAT_REALTIME_SAFETY_TESTING
    void reportRealtimeSafetyViolation(RealtimeViolationKind kind, void* callsite) noexcept;
#else
    inline void reportRealtimeSafetyViolation(RealtimeViolationKind, void*) noexcept {}
#endif
}

#if BEAT_REALTIME_SAFETY_TESTING
 #define BEAT_REPORT_REALTIME_LAZY_INITIALIZATION() \
    ::beat::test::reportRealtimeSafetyViolation(::beat::test::RealtimeViolationKind::lazyInitialization, __builtin_return_address(0))
 #define BEAT_REPORT_REALTIME_CONTAINER_GROWTH() \
    ::beat::test::reportRealtimeSafetyViolation(::beat::test::RealtimeViolationKind::containerGrowth, __builtin_return_address(0))
#else
 #define BEAT_REPORT_REALTIME_LAZY_INITIALIZATION() do {} while (false)
 #define BEAT_REPORT_REALTIME_CONTAINER_GROWTH() do {} while (false)
#endif

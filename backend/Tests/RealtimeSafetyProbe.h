#pragma once

#include "../Source/Audio/RealtimeSafetyHooks.h"

#include <cstddef>

namespace beat::test
{
    struct RealtimeViolation
    {
        RealtimeViolationKind kind {};
        void* callsite { nullptr };
    };

    void prepareRealtimeSafetyInterposers() noexcept;
    void beginRealtimeSafetyProbe() noexcept;
    size_t endRealtimeSafetyProbe() noexcept;
    RealtimeViolation realtimeSafetyViolation(size_t index) noexcept;
    bool realtimeSafetyProbeActive() noexcept;
}

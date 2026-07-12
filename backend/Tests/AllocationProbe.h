#pragma once

#include <cstddef>

namespace beat::test
{
    void beginAllocationProbe() noexcept;
    size_t endAllocationProbe() noexcept;
    void* allocationProbeCallsite(size_t index) noexcept;
}

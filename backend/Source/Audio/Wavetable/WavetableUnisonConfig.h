#pragma once

#include <array>
#include <cstddef>

namespace beat::WavetableUnison
{
    inline constexpr int maxVoices = 16;
    inline constexpr std::size_t capacity = static_cast<std::size_t>(maxVoices);
    using PhaseArray = std::array<double, capacity>;
}

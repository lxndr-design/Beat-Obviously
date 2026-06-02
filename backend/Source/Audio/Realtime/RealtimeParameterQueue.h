#pragma once

#include "SpscRingBuffer.h"

#include <algorithm>
#include <array>
#include <cstddef>
#include <string_view>

namespace beat
{
    struct RealtimeParameterChange
    {
        static constexpr size_t instrumentIdCapacity = 64;
        static constexpr size_t parameterIdCapacity = 48;

        std::array<char, instrumentIdCapacity> instrumentId {};
        std::array<char, parameterIdCapacity> parameterId {};
        float value { 0.0f };
        int sampleOffset { 0 };
        int rampSamples { 0 };

        std::string_view instrumentIdView() const noexcept { return fixedStringView(instrumentId); }
        std::string_view parameterIdView() const noexcept { return fixedStringView(parameterId); }

    private:
        template <size_t N>
        static std::string_view fixedStringView(const std::array<char, N>& text) noexcept
        {
            size_t length = 0;
            while (length < N && text[length] != '\0')
                ++length;
            return { text.data(), length };
        }
    };

    inline RealtimeParameterChange makeRealtimeParameterChange(std::string_view instrumentId,
                                                               std::string_view parameterId,
                                                               float value,
                                                               int sampleOffset = 0,
                                                               int rampSamples = 0) noexcept
    {
        RealtimeParameterChange change;
        const auto copyFixed = []<size_t N>(std::array<char, N>& destination, std::string_view source)
        {
            destination.fill('\0');
            const size_t length = std::min(source.size(), N - 1);
            for (size_t i = 0; i < length; ++i)
                destination[i] = source[i];
        };

        copyFixed(change.instrumentId, instrumentId);
        copyFixed(change.parameterId, parameterId);
        change.value = value;
        change.sampleOffset = std::max(0, sampleOffset);
        change.rampSamples = std::max(0, rampSamples);
        return change;
    }

    template <size_t Capacity>
    class RealtimeParameterQueue
    {
    public:
        bool push(const RealtimeParameterChange& change) noexcept
        {
            return queue.push(change);
        }

        bool pop(RealtimeParameterChange& out) noexcept
        {
            return queue.pop(out);
        }

        void clear() noexcept { queue.clear(); }
        bool empty() const noexcept { return queue.empty(); }
        bool full() const noexcept { return queue.full(); }
        size_t size() const noexcept { return queue.size(); }
        constexpr size_t capacity() const noexcept { return queue.capacity(); }

    private:
        SpscRingBuffer<RealtimeParameterChange, Capacity> queue;
    };
}

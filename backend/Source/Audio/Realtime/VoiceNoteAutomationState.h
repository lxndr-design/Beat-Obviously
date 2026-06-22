#pragma once

#include "VoiceAutomationInbox.h"
#include "VoiceNoteAutomation.h"

#include <array>
#include <utility>

namespace beat
{
    struct VoiceNoteAutomationState
    {
        std::array<RealtimeParameterChange, VoiceNoteAutomation::maxEvents> events;
        std::array<VoiceNoteAutomation::PitchEvent, VoiceNoteAutomation::maxEvents> pitchEvents;
        int eventCount { 0 };
        int pitchEventCount { 0 };
        int nextEvent { 0 };
        int nextPitchEvent { 0 };
        int samplePosition { 0 };

        void loadPending(int midiNoteNumber) noexcept
        {
            nextEvent = 0;
            nextPitchEvent = 0;
            samplePosition = 0;
            VoiceAutomationInbox::consumeForNote(
                midiNoteNumber,
                events,
                eventCount,
                pitchEvents,
                pitchEventCount);
        }

        bool active() const noexcept
        {
            return pitchEventCount > 0 || eventCount > 0;
        }

        void advanceSample() noexcept
        {
            ++samplePosition;
        }

        template <typename ApplyPitch, typename ApplyParameter>
        void advance(ApplyPitch&& applyPitch, ApplyParameter&& applyParameter) noexcept
        {
            while (nextPitchEvent < pitchEventCount)
            {
                const auto& event = pitchEvents[(size_t) nextPitchEvent];
                if (event.sampleOffset > samplePosition)
                    break;
                applyPitch(event);
                ++nextPitchEvent;
            }

            while (nextEvent < eventCount)
            {
                const auto& event = events[(size_t) nextEvent];
                if (event.sampleOffset > samplePosition)
                    break;
                applyParameter(event);
                ++nextEvent;
            }
        }
    };
}

#pragma once

#include "VoiceNoteAutomation.h"

#include <array>

namespace beat::VoiceAutomationInbox
{
    void setPending(VoiceNoteAutomation::Context* contexts, int count) noexcept;
    void clearPending() noexcept;
    void consumeForNote(
        int midiNoteNumber,
        std::array<RealtimeParameterChange, VoiceNoteAutomation::maxEvents>& automationEvents,
        int& automationEventCount,
        std::array<VoiceNoteAutomation::PitchEvent, VoiceNoteAutomation::maxEvents>& pitchEvents,
        int& pitchEventCount) noexcept;
}

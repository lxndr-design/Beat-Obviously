#pragma once

#include "../InstrumentVoice.h"

#include <array>

namespace beat::VoiceAutomationInbox
{
    void setPending(InstrumentVoice::NoteAutomationContext* contexts, int count) noexcept;
    void clearPending() noexcept;
    void consumeForNote(
        int midiNoteNumber,
        std::array<RealtimeParameterChange, InstrumentVoice::maxNoteAutomationEvents>& automationEvents,
        int& automationEventCount,
        std::array<InstrumentVoice::NoteAutomationContext::PitchEvent, InstrumentVoice::maxNoteAutomationEvents>& pitchEvents,
        int& pitchEventCount) noexcept;
}

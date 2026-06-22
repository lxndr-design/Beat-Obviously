#include "VoiceAutomationInbox.h"

namespace beat::VoiceAutomationInbox
{
    namespace
    {
        thread_local InstrumentVoice::NoteAutomationContext* pendingNoteAutomationContexts = nullptr;
        thread_local int pendingNoteAutomationContextCount = 0;
    }

    void setPending(InstrumentVoice::NoteAutomationContext* contexts, int count) noexcept
    {
        pendingNoteAutomationContexts = contexts;
        pendingNoteAutomationContextCount = juce::jlimit(0, (int) InstrumentVoice::maxPendingNoteAutomationContexts, count);
    }

    void clearPending() noexcept
    {
        pendingNoteAutomationContexts = nullptr;
        pendingNoteAutomationContextCount = 0;
    }

    void consumeForNote(
        int midiNoteNumber,
        std::array<RealtimeParameterChange, InstrumentVoice::maxNoteAutomationEvents>& automationEvents,
        int& automationEventCount,
        std::array<InstrumentVoice::NoteAutomationContext::PitchEvent, InstrumentVoice::maxNoteAutomationEvents>& pitchEvents,
        int& pitchEventCount) noexcept
    {
        automationEventCount = 0;
        pitchEventCount = 0;

        if (pendingNoteAutomationContexts == nullptr || pendingNoteAutomationContextCount <= 0)
            return;

        for (int i = 0; i < pendingNoteAutomationContextCount; ++i)
        {
            auto& context = pendingNoteAutomationContexts[i];
            if (context.midiNoteNumber != midiNoteNumber)
                continue;

            automationEventCount = juce::jlimit(0, (int) InstrumentVoice::maxNoteAutomationEvents, context.eventCount);
            for (int eventIndex = 0; eventIndex < automationEventCount; ++eventIndex)
                automationEvents[(size_t) eventIndex] = context.events[(size_t) eventIndex];

            pitchEventCount = juce::jlimit(0, (int) InstrumentVoice::maxNoteAutomationEvents, context.pitchEventCount);
            for (int eventIndex = 0; eventIndex < pitchEventCount; ++eventIndex)
                pitchEvents[(size_t) eventIndex] = context.pitchEvents[(size_t) eventIndex];

            context.midiNoteNumber = -1;
            context.eventCount = 0;
            context.pitchEventCount = 0;
            return;
        }
    }
}

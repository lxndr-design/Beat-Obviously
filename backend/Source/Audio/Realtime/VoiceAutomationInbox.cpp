#include "VoiceAutomationInbox.h"

#include <juce_core/juce_core.h>

namespace beat::VoiceAutomationInbox
{
    namespace
    {
        thread_local VoiceNoteAutomation::Context* pendingNoteAutomationContexts = nullptr;
        thread_local int pendingNoteAutomationContextCount = 0;
    }

    void setPending(VoiceNoteAutomation::Context* contexts, int count) noexcept
    {
        pendingNoteAutomationContexts = contexts;
        pendingNoteAutomationContextCount = juce::jlimit(0, (int) VoiceNoteAutomation::maxPendingContexts, count);
    }

    void clearPending() noexcept
    {
        pendingNoteAutomationContexts = nullptr;
        pendingNoteAutomationContextCount = 0;
    }

    void consumeForNote(
        int midiNoteNumber,
        std::array<RealtimeParameterChange, VoiceNoteAutomation::maxEvents>& automationEvents,
        int& automationEventCount,
        std::array<VoiceNoteAutomation::PitchEvent, VoiceNoteAutomation::maxEvents>& pitchEvents,
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

            automationEventCount = juce::jlimit(0, (int) VoiceNoteAutomation::maxEvents, context.eventCount);
            for (int eventIndex = 0; eventIndex < automationEventCount; ++eventIndex)
                automationEvents[(size_t) eventIndex] = context.events[(size_t) eventIndex];

            pitchEventCount = juce::jlimit(0, (int) VoiceNoteAutomation::maxEvents, context.pitchEventCount);
            for (int eventIndex = 0; eventIndex < pitchEventCount; ++eventIndex)
                pitchEvents[(size_t) eventIndex] = context.pitchEvents[(size_t) eventIndex];

            context.midiNoteNumber = -1;
            context.eventCount = 0;
            context.pitchEventCount = 0;
            return;
        }
    }
}

#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include "Audio/AudioEngine.h"
#include "Persistence/Database.h"
#include "Ipc/MessageBridge.h"

/**
 * MainComponent — owns the audio engine, database, and the WebBrowserComponent
 * that hosts the Solid UI. Wires everything to the MessageBridge so the
 * frontend can drive the engine and receive events.
 */
class MainComponent : public juce::Component
{
public:
    MainComponent();
    ~MainComponent() override;

    void resized() override;
    void paint(juce::Graphics&) override;

    juce::var handleNativeRequest(const juce::String& kind, const juce::var& payload);
    void emitMenuCommand(const juce::String& command);
    void emitOpenProjectFile(const juce::String& path);
    std::function<void()> onFrontendShellReady;
    std::function<void()> onFrontendReady;

private:
    juce::WebBrowserComponent::Options createBrowserOptions();

    std::unique_ptr<beat::Database>      database;
    std::unique_ptr<beat::AudioEngine>   engine;
    std::unique_ptr<beat::MessageBridge> bridge;
    std::unique_ptr<juce::WebBrowserComponent> browser;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainComponent)
};

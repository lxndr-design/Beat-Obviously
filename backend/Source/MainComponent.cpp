#include "MainComponent.h"

namespace
{
    /** Where the embedded frontend lives. In dev, override via env var. */
    juce::URL resolveFrontendUrl()
    {
        if (auto devUrl = juce::SystemStats::getEnvironmentVariable(
                "BEAT_DEV_FRONTEND_URL", {});
            devUrl.isNotEmpty())
        {
            return juce::URL(devUrl);
        }

        // In Release builds, BinaryData ships the Vite-built dist/. We expose
        // it via a custom `beat://` scheme handler registered on the browser
        // component. For now, fall back to the dev server URL — wiring up the
        // BinaryData-backed scheme is a follow-up.
        return juce::URL("http://localhost:5173");
    }
}

MainComponent::MainComponent()
{
    // Persistence: SQLite under ~/Library/Application Support/Beat/beat.db
    auto dbPath = juce::File::getSpecialLocation(
                      juce::File::userApplicationDataDirectory)
                      .getChildFile("Beat")
                      .getChildFile("beat.db");
    database = std::make_unique<beat::Database>(dbPath);

    // Audio engine starts on its own thread.
    engine = std::make_unique<beat::AudioEngine>();
    engine->prepare();

    // Web browser hosting the React UI. JUCE 8 native integration enabled
    // so JS can call C++ via window.__BEAT_NATIVE__.request(...).
    auto options = juce::WebBrowserComponent::Options{}
                       .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
                       .withWinWebView2Options({})
                       .withNativeIntegrationEnabled();

    browser = std::make_unique<juce::WebBrowserComponent>(options);
    addAndMakeVisible(*browser);

    // The bridge wires native JS handlers to engine/database operations and
    // pumps inbound events back to JS.
    bridge = std::make_unique<beat::MessageBridge>(*engine, *database, *browser);
    bridge->install();

    browser->goToURL(resolveFrontendUrl().toString(true));

    setSize(1440, 900);
}

MainComponent::~MainComponent()
{
    // Tear down in reverse: stop bridge → stop engine → close db.
    bridge.reset();
    if (engine) engine->shutdown();
    engine.reset();
    database.reset();
}

void MainComponent::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colours::black);
}

void MainComponent::resized()
{
    if (browser) browser->setBounds(getLocalBounds());
}

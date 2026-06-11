#include "MainComponent.h"

#include <cstring>
#include <optional>
#include <vector>

namespace
{
    constexpr auto beatNativeBridgeScript = R"JS(
(function () {
  const backend = window.__JUCE__ && window.__JUCE__.backend;
  if (!backend || !backend.emitEvent || !backend.addEventListener) return;

  let nextPromiseId = 1;
  const pending = new Map();

  backend.addEventListener("__juce__complete", function (message) {
    const entry = pending.get(message.promiseId);
    if (!entry) return;
    pending.delete(message.promiseId);
    entry.resolve(message.result);
  });

  function getNativeFunction(name) {
    return function () {
      const params = Array.prototype.slice.call(arguments);
      const promiseId = nextPromiseId++;
      const result = new Promise(function (resolve, reject) {
        pending.set(promiseId, { resolve: resolve, reject: reject });
      });
      backend.emitEvent("__juce__invoke", {
        name: name,
        params: params,
        resultId: promiseId
      });
      return result;
    };
  }

  const requestNative = getNativeFunction("beatRequest");
  const subscribers = new Set();

  window.__BEAT_NATIVE__ = {
    request: function (kind, payload) {
      return requestNative(kind, payload || {});
    },
    subscribe: function (listener) {
      subscribers.add(listener);
      return function () { subscribers.delete(listener); };
    }
  };

  window.__BEAT_INBOUND__ = function (message) {
    const eventJson = typeof message === "string" ? message : JSON.stringify(message);
    subscribers.forEach(function (listener) { listener(eventJson); });
  };
})();
)JS";

    struct FrontendLaunchTarget
    {
        juce::URL url;
        bool isDevServer { false };
    };

    /** Where the embedded frontend lives. In dev, override via env var. */
    juce::File getBundledFrontendRoot()
    {
        auto executable = juce::File::getSpecialLocation(juce::File::currentExecutableFile);
       #if JUCE_MAC
        return executable.getParentDirectory()
                         .getParentDirectory()
                         .getChildFile("Resources")
                         .getChildFile("frontend");
       #else
        return executable.getParentDirectory().getChildFile("frontend");
       #endif
    }

    juce::String appendLaunchToken(juce::String url)
    {
        const auto separator = url.containsChar('?') ? "&" : "?";
        return url + separator + "beatLaunch=" + juce::String(juce::Time::currentTimeMillis());
    }

    bool devServerLooksLikeBeat(const juce::String& baseUrl)
    {
        auto trimmed = baseUrl.trim().trimCharactersAtEnd("/");
        if (trimmed.isEmpty())
            return false;

        const auto healthUrl = appendLaunchToken(trimmed + "/index.html");
        auto stream = juce::URL(healthUrl).createInputStream(
            juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
                .withConnectionTimeoutMs(450)
                .withNumRedirectsToFollow(1));

        if (stream == nullptr)
        {
            DBG("Beat frontend dev server not reachable: " << healthUrl);
            return false;
        }

        const auto html = stream->readEntireStreamAsString();
        const bool looksLikeBeat = html.contains("<title>Beat</title>") && html.contains("id=\"root\"");
        if (!looksLikeBeat)
            DBG("Port is occupied, but it is not serving the Beat frontend: " << healthUrl);
        return looksLikeBeat;
    }

    FrontendLaunchTarget resolveFrontendLaunchTarget(const juce::File& bundledRoot)
    {
        if (auto devUrl = juce::SystemStats::getEnvironmentVariable(
                "BEAT_DEV_FRONTEND_URL", {});
            devUrl.isNotEmpty())
        {
            if (devServerLooksLikeBeat(devUrl))
                return { juce::URL(appendLaunchToken(devUrl)), true };

            DBG("Ignoring BEAT_DEV_FRONTEND_URL because the dev server failed the Beat health check.");
        }

        if (bundledRoot.getChildFile("index.html").existsAsFile())
            return { juce::URL(juce::WebBrowserComponent::getResourceProviderRoot()), false };

        const juce::String defaultDevUrl("http://localhost:6174");
        if (devServerLooksLikeBeat(defaultDevUrl))
            return { juce::URL(appendLaunchToken(defaultDevUrl)), true };

        DBG("Beat frontend dev server is unavailable on http://localhost:6174 and no bundled frontend was found.");
        return { juce::URL(defaultDevUrl), true };
    }

    juce::String mimeForFile(const juce::File& file)
    {
        const auto ext = file.getFileExtension().toLowerCase();
        if (ext == ".html") return "text/html";
        if (ext == ".js") return "text/javascript";
        if (ext == ".css") return "text/css";
        if (ext == ".svg") return "image/svg+xml";
        if (ext == ".png") return "image/png";
        if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
        if (ext == ".webp") return "image/webp";
        if (ext == ".wav") return "audio/wav";
        if (ext == ".mp3") return "audio/mpeg";
        if (ext == ".ogg") return "audio/ogg";
        if (ext == ".flac") return "audio/flac";
        return "application/octet-stream";
    }

    std::optional<juce::WebBrowserComponent::Resource> frontendResourceFor(
        const juce::File& root,
        const juce::String& path)
    {
        if (!root.isDirectory()) return std::nullopt;

        auto cleanPath = path.upToFirstOccurrenceOf("?", false, false);
        if (cleanPath.isEmpty() || cleanPath == "/") cleanPath = "/index.html";
        cleanPath = cleanPath.trimCharactersAtStart("/");

        auto file = root.getChildFile(cleanPath);
        if (!file.existsAsFile())
            file = root.getChildFile("index.html");
        if (!file.existsAsFile()) return std::nullopt;

        juce::MemoryBlock block;
        if (!file.loadFileAsData(block)) return std::nullopt;

        std::vector<std::byte> bytes(block.getSize());
        std::memcpy(bytes.data(), block.getData(), block.getSize());
        return juce::WebBrowserComponent::Resource { std::move(bytes), mimeForFile(file) };
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

    browser = std::make_unique<juce::WebBrowserComponent>(createBrowserOptions());
    addAndMakeVisible(*browser);

    // The bridge wires native JS handlers to engine/database operations and
    // pumps inbound events back to JS.
    bridge = std::make_unique<beat::MessageBridge>(*engine, *database, *browser);
    bridge->onAppReady = [this]
    {
        if (onFrontendReady)
            onFrontendReady();
    };
    bridge->install();

    const auto launchTarget = resolveFrontendLaunchTarget(getBundledFrontendRoot());
    browser->goToURL(launchTarget.url.toString(true));
    if (launchTarget.isDevServer)
    {
        juce::Component::SafePointer<MainComponent> safeThis(this);
        juce::Timer::callAfterDelay(350, [safeThis, url = launchTarget.url]
        {
            if (safeThis != nullptr && safeThis->browser != nullptr)
                safeThis->browser->goToURL(url.toString(true));
        });
    }

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

juce::WebBrowserComponent::Options MainComponent::createBrowserOptions()
{
    const auto bundledRoot = getBundledFrontendRoot();
    auto options = juce::WebBrowserComponent::Options{}
                       .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
                       .withWinWebView2Options({})
                       .withNativeIntegrationEnabled()
                       .withUserScript(beatNativeBridgeScript)
                       .withNativeFunction(
                           "beatRequest",
                           [this](const juce::Array<juce::var>& args,
                                  juce::WebBrowserComponent::NativeFunctionCompletion complete)
                           {
                               const auto kind = args.size() > 0 ? args[0].toString() : juce::String();
                               const auto payload = args.size() > 1 ? args[1] : juce::var(new juce::DynamicObject());
                               complete(handleNativeRequest(kind, payload));
                           })
                       .withResourceProvider(
                           [bundledRoot](const juce::String& path)
                           {
                               return frontendResourceFor(bundledRoot, path);
                           });

    return options;
}

juce::var MainComponent::handleNativeRequest(const juce::String& kind, const juce::var& payload)
{
    if (!bridge)
    {
        juce::DynamicObject::Ptr response = new juce::DynamicObject();
        response->setProperty("ok", false);
        response->setProperty("error", "Bridge not ready");
        return juce::var(response.get());
    }

    return bridge->handleRequest(kind, payload);
}

void MainComponent::emitMenuCommand(const juce::String& command)
{
    if (!bridge) return;

    juce::DynamicObject::Ptr payload = new juce::DynamicObject();
    payload->setProperty("command", command);
    bridge->emit("native.menuCommand", juce::var(payload.get()));
}

void MainComponent::emitOpenProjectFile(const juce::String& path)
{
    if (!bridge || path.isEmpty()) return;

    juce::DynamicObject::Ptr payload = new juce::DynamicObject();
    payload->setProperty("path", path);
    bridge->emit("native.openProjectFile", juce::var(payload.get()));
}

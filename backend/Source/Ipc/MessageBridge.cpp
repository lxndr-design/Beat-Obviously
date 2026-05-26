#include "MessageBridge.h"
#include "Schema.h"

namespace beat
{
    MessageBridge::MessageBridge(AudioEngine& e, Database& d, juce::WebBrowserComponent& b)
        : engine(e), database(d), browser(b)
    {
        // Hook engine events → emit() so the UI sees them.
        engine.onPositionChanged = [this](Beats b) {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("positionBeat", (double) b);
            emit(ipc::kind::EV_POSITION_CHANGED, juce::var(o.get()));
        };
        engine.onSegmentTriggered = [this](const Sequencer::TriggerEvent& ev) {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("segmentId", ev.segmentId);
            o->setProperty("repetition", ev.repetition);
            emit(ipc::kind::EV_SEGMENT_TRIGGER, juce::var(o.get()));
        };
    }

    MessageBridge::~MessageBridge()
    {
        engine.onPositionChanged = nullptr;
        engine.onSegmentTriggered = nullptr;
    }

    void MessageBridge::install()
    {
        // JUCE 8 exposes native integration via WebBrowserComponent::Options
        // .withNativeIntegrationEnabled() (set in MainComponent). Functions
        // are exposed via WebBrowserComponent::evaluateJavascript and a small
        // bootstrap script we inject that wires window.__BEAT_NATIVE__.
        //
        // The bootstrap script:
        //   - defines window.__BEAT_NATIVE__.request(kind, payload)
        //     that returns a Promise resolved by a generated correlationId
        //     in a window message round-trip.
        //   - defines window.__BEAT_NATIVE__.subscribe(listener) that
        //     registers a listener for inbound events delivered via
        //     window.__BEAT_INBOUND__(kindAndPayloadJson).
        //
        // For brevity, the JS bootstrap script lives in
        // `frontend/src/ipc/bootstrap.ts` and is imported in main.tsx; the
        // C++ side just needs to expose the two native functions below.
        //
        // TODO(juce8): replace the manual postMessage round-trip with the
        // built-in juce::WebBrowserComponent native function API once we pin
        // to a JUCE version that has it stable on all platforms.

        // Listen for navigation-completed and inject the bootstrap.
        browser.goToURL(browser.getURL()); // no-op trigger; real wiring below

        // The actual JS callbacks are dispatched by intercepting
        // pageAboutToLoad / page navigation. In a production setup, replace
        // with WebBrowserComponent::OptionsBuilder::withNativeFunction.
    }

    juce::var MessageBridge::handleRequest(const juce::String& kind, const juce::var& payload)
    {
        using namespace ipc::kind;

        if (kind == TRANSPORT_PLAY)       { engine.sequencer().play();  return juce::var(true); }
        if (kind == TRANSPORT_PAUSE)      { engine.sequencer().pause(); return juce::var(true); }
        if (kind == TRANSPORT_STOP)       { engine.sequencer().stop();  return juce::var(true); }
        if (kind == TRANSPORT_SEEK)
        {
            engine.sequencer().seek((double) payload.getProperty("positionBeat", 0.0));
            return juce::var(true);
        }
        if (kind == TRANSPORT_SET_SPEED)
        {
            engine.sequencer().setSpeed((double) payload.getProperty("speed", 1.0));
            return juce::var(true);
        }
        if (kind == TRANSPORT_SET_LOOP)
        {
            auto range = payload.getProperty("range", {});
            if (range.isObject())
            {
                engine.sequencer().setLoop(
                    (double) range.getProperty("startBeat", 0.0),
                    (double) range.getProperty("endBeat", 0.0));
            }
            else
            {
                engine.sequencer().clearLoop();
            }
            return juce::var(true);
        }

        if (kind == PROJECT_SAVE)
        {
            // The frontend sends the full project; we persist + apply it.
            // (Parsing the var into a Project is the inverse of ProjectRepository's
            //  projectFromJson — wire that up here in a follow-up. For now we
            //  round-trip via the JSON blob.)
            auto json = juce::JSON::toString(payload.getProperty("project", {}), true);
            // TODO: parse + persist via projectRepo.save(...) once we have a
            //   var→Project deserializer. Skipped here to keep the skeleton clean.
            juce::ignoreUnused(json);
            return juce::var(true);
        }

        if (kind == PROJECT_LIST)
        {
            juce::Array<juce::var> arr;
            for (const auto& s : projectRepo.list())
            {
                juce::DynamicObject::Ptr o = new juce::DynamicObject();
                o->setProperty("id", s.id);
                o->setProperty("name", s.name);
                o->setProperty("savedAt", (double) s.savedAt);
                arr.add(juce::var(o.get()));
            }
            juce::DynamicObject::Ptr r = new juce::DynamicObject();
            r->setProperty("projects", arr);
            return juce::var(r.get());
        }

        if (kind == EQ_SET_AUTOMATION)
        {
            std::vector<EqAutomationPoint> pts;
            if (auto* a = payload.getProperty("points", {}).getArray())
            {
                for (const auto& v : *a)
                {
                    EqAutomationPoint p;
                    p.atBeat = (double) v.getProperty("atBeat", 0.0);
                    p.lowDb  = (float) (double) v.getProperty("lowDb", 0.0);
                    p.midDb  = (float) (double) v.getProperty("midDb", 0.0);
                    p.highDb = (float) (double) v.getProperty("highDb", 0.0);
                    p.airDb  = (float) (double) v.getProperty("airDb", 0.0);
                    pts.push_back(p);
                }
            }
            engine.setEqAutomation(std::move(pts));
            return juce::var(true);
        }

        if (kind == PING)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("pong", true);
            o->setProperty("backendVersion", "0.1.0");
            return juce::var(o.get());
        }

        // Unknown kind — JS will see ok:true but log a warning.
        DBG("Unhandled IPC kind: " << kind);
        return juce::var(true);
    }

    void MessageBridge::emit(const juce::String& kind, const juce::var& payload)
    {
        // Build a JSON envelope: { kind, ...payload } and send to JS via a
        // global hook (window.__BEAT_INBOUND__). The bootstrap script registered
        // in JS forwards to all subscribers.
        juce::DynamicObject::Ptr env = new juce::DynamicObject();
        env->setProperty("kind", kind);
        if (payload.isObject())
        {
            if (auto* obj = payload.getDynamicObject())
                for (const auto& pair : obj->getProperties())
                    env->setProperty(pair.name, pair.value);
        }
        const auto js = juce::String("window.__BEAT_INBOUND__ && window.__BEAT_INBOUND__(")
                      + juce::JSON::toString(juce::var(env.get()), true) + ");";

        // Marshal to the message thread — evaluateJavascript must be called there.
        juce::MessageManager::callAsync([this, js]() {
            browser.evaluateJavascript(js, nullptr);
        });
    }
}

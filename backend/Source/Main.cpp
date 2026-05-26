#include <juce_gui_basics/juce_gui_basics.h>
#include "MainComponent.h"

/**
 * Beat application entry point.
 *
 * Single window hosting the React UI in a WebBrowserComponent. The audio
 * engine is owned by MainComponent and runs on its own JUCE audio thread.
 */
class BeatApp : public juce::JUCEApplication
{
public:
    BeatApp() = default;

    const juce::String getApplicationName() override       { return "Beat"; }
    const juce::String getApplicationVersion() override    { return "0.1.0"; }
    bool moreThanOneInstanceAllowed() override             { return false; }

    void initialise(const juce::String&) override
    {
        mainWindow.reset(new MainWindow(getApplicationName()));
    }

    void shutdown() override
    {
        mainWindow = nullptr;
    }

    void systemRequestedQuit() override
    {
        quit();
    }

private:
    class MainWindow : public juce::DocumentWindow
    {
    public:
        explicit MainWindow(const juce::String& name)
            : DocumentWindow(name,
                             juce::Colours::black,
                             DocumentWindow::allButtons)
        {
            setUsingNativeTitleBar(true);
            setContentOwned(new MainComponent(), true);

            // Full-screen on first launch; resizable.
            setResizable(true, true);
            centreWithSize(1440, 900);
            setVisible(true);
        }

        void closeButtonPressed() override
        {
            JUCEApplication::getInstance()->systemRequestedQuit();
        }

        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainWindow)
    };

    std::unique_ptr<MainWindow> mainWindow;
};

START_JUCE_APPLICATION(BeatApp)

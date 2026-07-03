#include <juce_gui_basics/juce_gui_basics.h>
#include "MainComponent.h"

namespace
{
    namespace menuCommand
    {
        constexpr auto newProject   = "newProject";
        constexpr auto openProject  = "openProject";
        constexpr auto saveProject  = "saveProject";
        constexpr auto importAudio  = "importAudio";
        constexpr auto exportWav    = "exportWav";
        constexpr auto preferences  = "preferences";
    }

    enum MenuItemIds
    {
        menuNewProject = 1001,
        menuOpenProject,
        menuSaveProject,
        menuImportAudio,
        menuExportWav,
        menuPreferences,
        menuQuit,
    };

    juce::String findBeatProjectPathInCommandLine(const juce::String& commandLine)
    {
        juce::StringArray args;
        args.addTokens(commandLine, true);
        for (auto arg : args)
        {
            auto path = arg.unquoted().trim();
            if (path.endsWithIgnoreCase(".beat") && juce::File(path).existsAsFile())
                return path;
        }

        auto trimmed = commandLine.unquoted().trim();
        if (trimmed.endsWithIgnoreCase(".beat") && juce::File(trimmed).existsAsFile())
            return trimmed;

        return {};
    }

    class SquareWindowButton : public juce::Button
    {
    public:
        SquareWindowButton(const juce::String& name, int type)
            : juce::Button(name), buttonType(type)
        {
            setWantsKeyboardFocus(false);
        }

        void paintButton(juce::Graphics& g, bool highlighted, bool down) override
        {
            auto r = getLocalBounds().toFloat();
            auto fg = highlighted || down ? juce::Colours::black : juce::Colours::white;

            if (highlighted || down)
            {
                g.setColour(juce::Colours::white);
                g.fillRect(r);
            }
            g.setColour(fg);

            const auto c = r.getCentre();
            const auto s = juce::jmin(r.getWidth(), r.getHeight()) * 0.26f;

            if (buttonType == juce::DocumentWindow::closeButton)
            {
                g.drawLine(c.x - s, c.y - s, c.x + s, c.y + s, 1.6f);
                g.drawLine(c.x - s, c.y + s, c.x + s, c.y - s, 1.6f);
            }
            else if (buttonType == juce::DocumentWindow::minimiseButton)
            {
                g.drawLine(c.x - s, c.y, c.x + s, c.y, 1.8f);
            }
            else
            {
                g.drawLine(c.x - s, c.y, c.x + s, c.y, 1.5f);
                g.drawLine(c.x, c.y - s, c.x, c.y + s, 1.5f);
            }
        }

    private:
        int buttonType;
    };

    class BeatLookAndFeel : public juce::LookAndFeel_V4
    {
    public:
        BeatLookAndFeel()
        {
            setColour(juce::DocumentWindow::textColourId, juce::Colours::white);
            setColour(juce::ResizableWindow::backgroundColourId, juce::Colours::black);
        }

        juce::Button* createDocumentWindowButton(int buttonType) override
        {
            if (buttonType == juce::DocumentWindow::closeButton) return new SquareWindowButton("Close", buttonType);
            if (buttonType == juce::DocumentWindow::minimiseButton) return new SquareWindowButton("Minimise", buttonType);
            if (buttonType == juce::DocumentWindow::maximiseButton) return new SquareWindowButton("Maximise", buttonType);
            return nullptr;
        }

        void positionDocumentWindowButtons(
            juce::DocumentWindow&,
            int titleBarX,
            int titleBarY,
            int titleBarW,
            int titleBarH,
            juce::Button* minimiseButton,
            juce::Button* maximiseButton,
            juce::Button* closeButton,
            bool positionTitleBarButtonsOnLeft) override
        {
            const int buttonSize = titleBarH;
            constexpr int gap = 0;
            auto x = positionTitleBarButtonsOnLeft
                ? titleBarX
                : titleBarX + titleBarW - buttonSize;
            const auto y = titleBarY;

            auto place = [&](juce::Button* b)
            {
                if (b == nullptr) return;
                b->setBounds(x, y, buttonSize, buttonSize);
                x += positionTitleBarButtonsOnLeft ? buttonSize + gap : -(buttonSize + gap);
            };

            if (positionTitleBarButtonsOnLeft)
            {
                place(closeButton);
                place(minimiseButton);
                place(maximiseButton);
            }
            else
            {
                place(closeButton);
                place(maximiseButton);
                place(minimiseButton);
            }
        }

        void drawDocumentWindowTitleBar(
            juce::DocumentWindow& window,
            juce::Graphics& g,
            int w,
            int h,
            int titleSpaceX,
            int titleSpaceW,
            const juce::Image*,
            bool) override
        {
            g.fillAll(juce::Colours::black);
            g.setColour(juce::Colours::white.withAlpha(0.55f));
            g.drawLine(0.0f, static_cast<float>(h - 1), static_cast<float>(w), static_cast<float>(h - 1), 1.0f);
        }
    };

    class StartupSplash : public juce::Component,
                          private juce::Timer
    {
    public:
        StartupSplash()
        {
            setInterceptsMouseClicks(false, false);
            auto executable = juce::File::getSpecialLocation(juce::File::currentExecutableFile);
           #if JUCE_MAC
            auto resources = executable.getParentDirectory().getSiblingFile("Resources");
           #else
            auto resources = executable.getParentDirectory();
           #endif
            icon = juce::ImageFileFormat::loadFrom(resources.getChildFile("BeatIcon.png"));
            startTimerHz(60);
        }

        void paint(juce::Graphics& g) override
        {
            g.fillAll(juce::Colours::black.withAlpha(0.72f));

            auto panel = juce::Rectangle<int>(250, 250).withCentre(getLocalBounds().getCentre());
            g.setColour(juce::Colours::black);
            g.fillRect(panel);
            g.setColour(juce::Colours::white);
            g.drawRect(panel.toFloat().reduced(0.5f), 1.0f);

            const auto logoBounds = panel.withSizeKeepingCentre(76, 76).translated(0, -34);
            if (icon.isValid())
                g.drawImageWithin(icon, logoBounds.getX(), logoBounds.getY(), logoBounds.getWidth(), logoBounds.getHeight(),
                                  juce::RectanglePlacement::centred | juce::RectanglePlacement::onlyReduceInSize);
            else
            {
                g.setColour(juce::Colours::white);
                g.drawRect(logoBounds.toFloat(), 1.0f);
            }

            auto bar = juce::Rectangle<int>(150, 6).withCentre(panel.getCentre()).translated(0, 54);
            g.setColour(juce::Colours::white.withAlpha(0.45f));
            g.drawRect(bar.toFloat().reduced(0.5f), 1.0f);

            const auto phase = (float) ((juce::Time::getMillisecondCounter() % 1200) / 1200.0);
            const auto fillWidth = juce::jmax(12, (int) std::round((double) bar.getWidth() * (0.18 + 0.42 * phase)));
            const auto fillStart = bar.getX() + (int) std::round((double) (bar.getWidth() - fillWidth) * phase);
            g.setColour(juce::Colours::white);
            g.fillRect(juce::Rectangle<int>(fillStart, bar.getY(), fillWidth, bar.getHeight()));
        }

    private:
        void timerCallback() override { repaint(); }

        juce::Image icon;
    };
}

/**
 * Beat application entry point.
 *
 * Single window hosting the Solid UI in a WebBrowserComponent. The audio
 * engine is owned by MainComponent and runs on its own JUCE audio thread.
 */
class BeatApp : public juce::JUCEApplication,
                public juce::MenuBarModel
{
public:
    BeatApp() = default;

    const juce::String getApplicationName() override       { return "Beat"; }
    const juce::String getApplicationVersion() override    { return "0.2.0"; }
    bool moreThanOneInstanceAllowed() override             { return false; }

    void initialise(const juce::String& commandLine) override
    {
        juce::LookAndFeel::setDefaultLookAndFeel(&lookAndFeel);
       #if JUCE_MAC
        juce::MenuBarModel::setMacMainMenu(this);
       #endif
        mainWindow.reset(new MainWindow(getApplicationName(), findBeatProjectPathInCommandLine(commandLine)));
    }

    void shutdown() override
    {
        mainWindow = nullptr;
       #if JUCE_MAC
        juce::MenuBarModel::setMacMainMenu(nullptr);
       #endif
        juce::LookAndFeel::setDefaultLookAndFeel(nullptr);
    }

    void systemRequestedQuit() override
    {
        quit();
    }

    void anotherInstanceStarted(const juce::String& commandLine) override
    {
        const auto projectPath = findBeatProjectPathInCommandLine(commandLine);
        if (projectPath.isNotEmpty() && mainWindow)
            mainWindow->sendOpenProjectFile(projectPath);
    }

    juce::StringArray getMenuBarNames() override
    {
        return { "File", "Beat" };
    }

    juce::PopupMenu getMenuForIndex(int index, const juce::String&) override
    {
        juce::PopupMenu menu;
        if (index == 0)
        {
            menu.addItem(menuNewProject, "New Project");
            menu.addItem(menuOpenProject, "Open Project...");
            menu.addItem(menuSaveProject, "Save");
            menu.addSeparator();
            menu.addItem(menuImportAudio, "Import Audio...");
            menu.addItem(menuExportWav, "Export WAV...");
            menu.addSeparator();
            menu.addItem(menuQuit, "Quit Beat");
        }
        else if (index == 1)
        {
            menu.addItem(menuPreferences, "Preferences...");
        }
        return menu;
    }

    void menuItemSelected(int menuItemID, int) override
    {
        switch (menuItemID)
        {
            case menuNewProject:  sendCommandToFrontend(menuCommand::newProject); break;
            case menuOpenProject: sendCommandToFrontend(menuCommand::openProject); break;
            case menuSaveProject: sendCommandToFrontend(menuCommand::saveProject); break;
            case menuImportAudio: sendCommandToFrontend(menuCommand::importAudio); break;
            case menuExportWav:   sendCommandToFrontend(menuCommand::exportWav); break;
            case menuPreferences: sendCommandToFrontend(menuCommand::preferences); break;
            case menuQuit:        systemRequestedQuit(); break;
            default: break;
        }
    }

private:
    class MainWindow : public juce::DocumentWindow
    {
    public:
        explicit MainWindow(const juce::String& name, const juce::String& initialProjectPath)
            : DocumentWindow(name,
                             juce::Colours::black,
                             DocumentWindow::allButtons)
        {
            setUsingNativeTitleBar(false);
            setTitleBarHeight(36);
            setTitleBarButtonsRequired(DocumentWindow::allButtons, true);
            setContentOwned(new MainComponent(), true);
            if (auto* main = dynamic_cast<MainComponent*>(getContentComponent()))
            {
                main->onFrontendReady = [safeThis = juce::Component::SafePointer<MainWindow>(this)]
                {
                    if (safeThis != nullptr)
                        safeThis->hideStartupSplash();
                };
                if (initialProjectPath.isNotEmpty())
                {
                    main->onFrontendReady = [
                        safeThis = juce::Component::SafePointer<MainWindow>(this),
                        initialProjectPath
                    ]
                    {
                        if (safeThis == nullptr)
                            return;
                        safeThis->hideStartupSplash();
                        safeThis->sendOpenProjectFile(initialProjectPath);
                    };
                }
            }
            addAndMakeVisible(startupSplash);

            // Full-screen on first launch; resizable.
            setResizable(true, true);
            centreWithSize(1440, 900);
            setVisible(true);
            startupSplash.toFront(false);
            juce::Timer::callAfterDelay(6500, [safeThis = juce::Component::SafePointer<MainWindow>(this)]
            {
                if (safeThis != nullptr)
                    safeThis->hideStartupSplash();
            });
        }

        void resized() override
        {
            DocumentWindow::resized();
            startupSplash.setBounds(getLocalBounds());
        }

        void closeButtonPressed() override
        {
            JUCEApplication::getInstance()->systemRequestedQuit();
        }

        void sendCommand(const juce::String& command)
        {
            if (auto* main = dynamic_cast<MainComponent*>(getContentComponent()))
                main->emitMenuCommand(command);
        }

        void sendOpenProjectFile(const juce::String& path)
        {
            if (auto* main = dynamic_cast<MainComponent*>(getContentComponent()))
                main->emitOpenProjectFile(path);
        }

        void paintOverChildren(juce::Graphics& g) override
        {
            g.setColour(juce::Colours::white);
            g.drawRect(getLocalBounds().toFloat().reduced(0.5f), 1.0f);
        }

        void hideStartupSplash()
        {
            if (!startupSplash.isVisible())
                return;
            startupSplash.setVisible(false);
        }

    private:
        StartupSplash startupSplash;

        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainWindow)
    };

    void sendCommandToFrontend(const juce::String& command)
    {
        if (mainWindow)
            mainWindow->sendCommand(command);
    }

    BeatLookAndFeel lookAndFeel;
    std::unique_ptr<MainWindow> mainWindow;
};

START_JUCE_APPLICATION(BeatApp)

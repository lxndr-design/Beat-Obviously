#include <juce_gui_basics/juce_gui_basics.h>
#include "MainComponent.h"
#include "NativeWindowStyle.h"
#include "DiagnosticLog.h"

#include <array>
#include <cmath>

namespace
{
    namespace menuCommand
    {
        constexpr auto home         = "home";
        constexpr auto whatsNew     = "whatsNew";
        constexpr auto userGuide    = "userGuide";
        constexpr auto newProject   = "newProject";
        constexpr auto openProject  = "openProject";
        constexpr auto saveProject  = "saveProject";
        constexpr auto importAudio  = "importAudio";
        constexpr auto exportWav    = "exportWav";
        constexpr auto preferences  = "preferences";
        constexpr auto undo         = "undo";
        constexpr auto redo         = "redo";
        constexpr auto songInfo     = "songInfo";
    }

    enum MenuItemIds
    {
        menuNewProject = 1001,
        menuOpenProject,
        menuSaveProject,
        menuImportAudio,
        menuExportWav,
        menuPreferences,
        menuHome,
        menuWhatsNew,
        menuUserGuide,
        menuUndo,
        menuRedo,
        menuSongInfo,
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

    juce::String normalizeTheme(const juce::String& value)
    {
        const auto normalized = value.trim().toLowerCase();
        return normalized == "light" || normalized == "mellow" ? normalized : "dark";
    }

    juce::Colour themeBackgroundColour(const juce::String& theme)
    {
        const auto normalized = normalizeTheme(theme);
        if (normalized == "light") return juce::Colour(0xfff5f5f5);
        if (normalized == "mellow") return juce::Colour(0xff4a4a4a);
        return juce::Colours::black;
    }

    juce::Colour themeForegroundColour(const juce::String& theme)
    {
        return normalizeTheme(theme) == "light"
            ? juce::Colour(0xff1a1a1a)
            : juce::Colour(0xfff4f4f4);
    }

    juce::File nativeThemeFile()
    {
        return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
            .getChildFile("Beat")
            .getChildFile("ui-theme.txt");
    }

    juce::String loadNativeTheme()
    {
        const auto file = nativeThemeFile();
        return file.existsAsFile() ? normalizeTheme(file.loadFileAsString()) : juce::String("dark");
    }

    void persistNativeTheme(const juce::String& theme)
    {
        const auto file = nativeThemeFile();
        file.getParentDirectory().createDirectory();
        file.replaceWithText(normalizeTheme(theme));
    }

    class SquareWindowButton : public juce::Button,
                               private juce::Timer
    {
    public:
        SquareWindowButton(const juce::String& name, int type)
            : juce::Button(name), buttonType(type)
        {
            setWantsKeyboardFocus(false);
            startTimerHz(30);
        }

        void paintButton(juce::Graphics& g, bool, bool down) override
        {
            auto r = getLocalBounds().toFloat();
            const auto liveHover = isPointerActuallyOverButton();
            lastPointerHover = liveHover;
            const auto active = liveHover || down;
            const auto background = getLookAndFeel().findColour(juce::ResizableWindow::backgroundColourId);
            const auto foreground = getLookAndFeel().findColour(juce::DocumentWindow::textColourId);
            auto fg = active ? background : foreground;

            if (active)
            {
                g.setColour(foreground);
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
        bool isPointerActuallyOverButton() const
        {
            if (!isShowing())
                return false;
            const auto pointer = juce::Desktop::getInstance()
                .getMainMouseSource()
                .getScreenPosition()
                .roundToInt();
            return getScreenBounds().contains(pointer);
        }

        void timerCallback() override
        {
            const auto nextHover = isPointerActuallyOverButton();
            if (nextHover == lastPointerHover)
                return;
            lastPointerHover = nextHover;
            repaint();
        }

        int buttonType;
        bool lastPointerHover { false };
    };

    class BeatLookAndFeel : public juce::LookAndFeel_V4
    {
    public:
        BeatLookAndFeel()
        {
            setTheme("dark");
        }

        void setTheme(const juce::String& theme)
        {
            setColour(juce::DocumentWindow::textColourId, themeForegroundColour(theme));
            setColour(juce::ResizableWindow::backgroundColourId, themeBackgroundColour(theme));
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
            const auto background = window.findColour(juce::ResizableWindow::backgroundColourId);
            const auto foreground = window.findColour(juce::DocumentWindow::textColourId);
            g.fillAll(background);
            g.setColour(foreground.withAlpha(0.55f));
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
            const auto background = getLookAndFeel().findColour(juce::ResizableWindow::backgroundColourId);
            const auto foreground = getLookAndFeel().findColour(juce::DocumentWindow::textColourId);
            g.fillAll(background);

            const auto bounds = getLocalBounds();
            g.setColour(foreground.withAlpha(0.055f));
            for (int x = bounds.getX(); x < bounds.getRight(); x += 48)
                g.drawVerticalLine(x, (float) bounds.getY(), (float) bounds.getBottom());
            for (int y = bounds.getY(); y < bounds.getBottom(); y += 48)
                g.drawHorizontalLine(y, (float) bounds.getX(), (float) bounds.getRight());

            const int panelWidth = juce::jmin(420, juce::jmax(280, bounds.getWidth() - 36));
            const int panelHeight = juce::jmin(286, juce::jmax(230, bounds.getHeight() - 36));
            auto panel = juce::Rectangle<int>(panelWidth, panelHeight).withCentre(bounds.getCentre());
            g.setColour(foreground.withAlpha(0.08f));
            g.fillRect(panel.translated(10, 10));
            g.setColour(background);
            g.fillRect(panel);
            g.setColour(foreground);
            g.drawRect(panel.toFloat().reduced(0.5f), 1.0f);

            auto header = panel.reduced(12).withHeight(58);
            const auto logoBounds = header.removeFromLeft(58).reduced(4);
            if (icon.isValid())
                g.drawImageWithin(icon, logoBounds.getX(), logoBounds.getY(), logoBounds.getWidth(), logoBounds.getHeight(),
                                  juce::RectanglePlacement::centred | juce::RectanglePlacement::onlyReduceInSize);
            else
            {
                g.setColour(foreground);
                g.drawRect(logoBounds.toFloat(), 1.0f);
            }

            const auto phase = (float) ((juce::Time::getMillisecondCounter() % 1200) / 1200.0);
            g.setColour(foreground);
            g.setFont(juce::FontOptions(10.0f).withStyle("Bold"));
            g.drawText("NATIVE AUDIO WORKSPACE", header.withTrimmedLeft(12).withHeight(15), juce::Justification::topLeft);
            g.setFont(juce::FontOptions(24.0f).withStyle("Bold"));
            g.drawText("Beat", header.withTrimmedLeft(12).withTrimmedTop(14).withHeight(27), juce::Justification::centredLeft);
            g.setColour(foreground.withAlpha(0.62f));
            g.setFont(juce::FontOptions(12.0f));
            g.drawText("Preparing audio engine and interface", header.withTrimmedLeft(12).withTrimmedTop(41), juce::Justification::topLeft);

            auto motion = panel.reduced(12).withTrimmedTop(68).withHeight(88);
            g.setColour(foreground.withAlpha(0.24f));
            g.drawRect(motion.toFloat().reduced(0.5f), 1.0f);
            for (int index = 0; index <= 16; ++index)
            {
                const int x = motion.getX() + index * motion.getWidth() / 16;
                g.setColour(foreground.withAlpha(index % 4 == 0 ? 0.23f : 0.09f));
                g.drawVerticalLine(x, (float) motion.getY(), (float) motion.getBottom());
            }
            g.setColour(foreground.withAlpha(0.12f));
            g.drawHorizontalLine(motion.getCentreY(), (float) motion.getX(), (float) motion.getRight());

            constexpr int signalBars = 9;
            constexpr int signalWidth = 6;
            constexpr int signalGap = 4;
            const int signalSpan = signalBars * signalWidth + (signalBars - 1) * signalGap;
            const int signalStart = motion.getCentreX() - signalSpan / 2;
            for (int index = 0; index < signalBars; ++index)
            {
                const float wave = 0.5f + 0.5f * std::sin((phase * juce::MathConstants<float>::twoPi)
                    + (float) index * 0.92f);
                const int height = 14 + (int) std::round(wave * 44.0f);
                g.setColour(foreground.withAlpha(0.55f + wave * 0.45f));
                g.fillRect(signalStart + index * (signalWidth + signalGap), motion.getCentreY() - height / 2,
                           signalWidth, height);
            }
            const int playheadX = motion.getX() + (int) std::round(phase * (float) motion.getWidth());
            g.setColour(foreground);
            g.drawVerticalLine(playheadX, (float) motion.getY(), (float) motion.getBottom());

            auto status = panel.reduced(12).withTrimmedTop(164);
            g.setColour(foreground.withAlpha(0.62f));
            g.setFont(juce::FontOptions(10.0f).withStyle("Bold"));
            g.drawText("PREPARING SESSION", status.removeFromTop(18), juce::Justification::centredLeft);
            auto bar = status.removeFromTop(8);
            g.setColour(foreground.withAlpha(0.18f));
            g.fillRect(bar);
            const auto fillWidth = juce::jmax(18, (int) std::round((double) bar.getWidth() * 0.28));
            const auto fillStart = bar.getX() + (int) std::round((double) (bar.getWidth() - fillWidth) * phase);
            g.setColour(foreground);
            g.fillRect(fillStart, bar.getY(), fillWidth, bar.getHeight());

            status.removeFromTop(12);
            const std::array<juce::String, 3> stageLabels {{ "AUDIO ENGINE", "INSTRUMENTS", "INTERFACE" }};
            const int stageWidth = juce::jmax(1, (status.getWidth() - 12) / 3);
            for (int index = 0; index < 3; ++index)
            {
                auto stage = juce::Rectangle<int>(status.getX() + index * (stageWidth + 6), status.getY(), stageWidth, 34);
                g.setColour(foreground.withAlpha(0.4f));
                g.drawRect(stage.toFloat().reduced(0.5f), 1.0f);
                g.setColour(foreground.withAlpha(0.72f));
                g.setFont(juce::FontOptions(9.0f).withStyle("Bold"));
                g.drawText(stageLabels[(size_t) index], stage.reduced(6), juce::Justification::centredLeft);
            }
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
    const juce::String getApplicationVersion() override    { return "0.3.2"; }
    bool moreThanOneInstanceAllowed() override             { return false; }

    void initialise(const juce::String& commandLine) override
    {
        const auto logFile = beat::diagnostics::logFile();
        const auto logDirectory = logFile.getParentDirectory();
        logDirectory.createDirectory();
        diagnosticLogger = std::make_unique<juce::FileLogger>(
            logFile,
            "Beat diagnostic log",
            0);
        juce::Logger::setCurrentLogger(diagnosticLogger.get());
        beat::diagnostics::log("lifecycle", "application initialise version=" + getApplicationVersion()
            + " executable=" + juce::File::getSpecialLocation(juce::File::currentExecutableFile).getFullPathName()
            + " commandLine=" + commandLine);
        beat::diagnostics::ScopedDuration startup("lifecycle", "main window");
        juce::LookAndFeel::setDefaultLookAndFeel(&lookAndFeel);
       #if JUCE_MAC
        macApplicationMenu.clear();
        macApplicationMenu.addItem(menuHome, "Home");
        macApplicationMenu.addItem(menuWhatsNew, "What's New");
        macApplicationMenu.addItem(menuUserGuide, "User Guide");
        macApplicationMenu.addSeparator();
        macApplicationMenu.addItem(menuPreferences, "Settings...");
        juce::MenuBarModel::setMacMainMenu(this, &macApplicationMenu);
       #endif
        auto initialProjectPath = findBeatProjectPathInCommandLine(commandLine);
        if (initialProjectPath.isEmpty())
            initialProjectPath = pendingProjectPath;
        pendingProjectPath.clear();
        const auto initialTheme = loadNativeTheme();
        lookAndFeel.setTheme(initialTheme);
        mainWindow.reset(new MainWindow(getApplicationName(), initialProjectPath, initialTheme));
    }

    void shutdown() override
    {
        beat::diagnostics::log("lifecycle", "application shutdown started");
        mainWindow = nullptr;
       #if JUCE_MAC
        juce::MenuBarModel::setMacMainMenu(nullptr);
       #endif
        juce::LookAndFeel::setDefaultLookAndFeel(nullptr);
        beat::diagnostics::log("lifecycle", "application shutdown complete");
        juce::Logger::setCurrentLogger(nullptr);
        diagnosticLogger.reset();
    }

    void systemRequestedQuit() override
    {
        quit();
    }

    void anotherInstanceStarted(const juce::String& commandLine) override
    {
        const auto projectPath = findBeatProjectPathInCommandLine(commandLine);
        beat::diagnostics::log("lifecycle", "another instance commandLine=" + commandLine
            + " projectPath=" + projectPath);
        if (projectPath.isEmpty())
            return;

        if (mainWindow)
            mainWindow->sendOpenProjectFile(projectPath);
        else
            pendingProjectPath = projectPath;
    }

    juce::StringArray getMenuBarNames() override
    {
        return { "File", "Edit" };
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
        }
        else if (index == 1)
        {
            menu.addItem(menuUndo, "Undo");
            menu.addItem(menuRedo, "Redo");
            menu.addSeparator();
            menu.addItem(menuSongInfo, "Song Info...");
        }
        return menu;
    }

    void menuItemSelected(int menuItemID, int) override
    {
        switch (menuItemID)
        {
            case menuHome:        sendCommandToFrontend(menuCommand::home); break;
            case menuWhatsNew:    sendCommandToFrontend(menuCommand::whatsNew); break;
            case menuUserGuide:   sendCommandToFrontend(menuCommand::userGuide); break;
            case menuNewProject:  sendCommandToFrontend(menuCommand::newProject); break;
            case menuOpenProject: sendCommandToFrontend(menuCommand::openProject); break;
            case menuSaveProject: sendCommandToFrontend(menuCommand::saveProject); break;
            case menuImportAudio: sendCommandToFrontend(menuCommand::importAudio); break;
            case menuExportWav:   sendCommandToFrontend(menuCommand::exportWav); break;
            case menuPreferences: sendCommandToFrontend(menuCommand::preferences); break;
            case menuUndo:        sendCommandToFrontend(menuCommand::undo); break;
            case menuRedo:        sendCommandToFrontend(menuCommand::redo); break;
            case menuSongInfo:    sendCommandToFrontend(menuCommand::songInfo); break;
            case menuQuit:        systemRequestedQuit(); break;
            default: break;
        }
    }

private:
    class MainWindow : public juce::DocumentWindow
    {
    public:
        explicit MainWindow(const juce::String& name, const juce::String& initialProjectPath, const juce::String& initialTheme)
            : DocumentWindow(name,
                             themeBackgroundColour(initialTheme),
                             DocumentWindow::allButtons),
              pendingProjectPath(initialProjectPath)
        {
            setUsingNativeTitleBar(false);
            setTitleBarHeight(36);
            setTitleBarButtonsRequired(DocumentWindow::allButtons, true);
            setContentOwned(new MainComponent(), true);
            if (auto* main = dynamic_cast<MainComponent*>(getContentComponent()))
            {
                main->onFrontendShellReady = [safeThis = juce::Component::SafePointer<MainWindow>(this)]
                {
                    if (safeThis != nullptr)
                        safeThis->hideStartupSplash();
                };
                main->onFrontendReady = [safeThis = juce::Component::SafePointer<MainWindow>(this)]
                {
                    if (safeThis != nullptr)
                        safeThis->handleFrontendReady();
                };
                main->onThemeChanged = [safeThis = juce::Component::SafePointer<MainWindow>(this)](const juce::String& theme)
                {
                    if (safeThis != nullptr)
                        safeThis->applyTheme(theme);
                };
                main->onModalOpenChanged = [safeThis = juce::Component::SafePointer<MainWindow>(this)](bool open)
                {
                    if (safeThis != nullptr)
                    {
                        safeThis->modalOpen = open;
                        safeThis->repaint();
                    }
                };
            }
            addAndMakeVisible(&startupSplash);

            // Full-screen on first launch; resizable.
            setResizable(true, true);
            centreWithSize(1440, 900);
            setVisible(true);
            juce::MessageManager::callAsync([safeThis = juce::Component::SafePointer<MainWindow>(this)]
            {
                if (safeThis != nullptr)
                    beat::applyNativeWindowCornerRadius(*safeThis, 16.0f);
            });
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
            beat::applyNativeWindowCornerRadius(*this, 16.0f);
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
            if (path.isEmpty())
                return;

            if (!frontendReady)
            {
                pendingProjectPath = path;
                beat::diagnostics::log("project", "Finder open queued until frontend ready path=" + path);
                return;
            }

            setMinimised(false);
            setVisible(true);
            toFront(true);
            beat::diagnostics::log("project", "Finder open dispatched path=" + path);
            if (auto* main = dynamic_cast<MainComponent*>(getContentComponent()))
                main->emitOpenProjectFile(path);
        }

        void paintOverChildren(juce::Graphics& g) override
        {
            if (modalOpen)
            {
                g.setColour(juce::Colours::black.withAlpha(0.46f));
                g.fillRect(getLocalBounds().withHeight(getTitleBarHeight()));
            }
            g.setColour(findColour(juce::DocumentWindow::textColourId));
            g.drawRoundedRectangle(getLocalBounds().toFloat().reduced(0.5f), 16.0f, 1.0f);
        }

        void hideStartupSplash()
        {
            if (!startupSplash.isVisible())
                return;
            startupSplash.setVisible(false);
        }

    private:
        bool modalOpen { false };
        void applyTheme(const juce::String& theme)
        {
            const auto normalized = normalizeTheme(theme);
            persistNativeTheme(normalized);
            if (auto* beatLookAndFeel = dynamic_cast<BeatLookAndFeel*>(&getLookAndFeel()))
                beatLookAndFeel->setTheme(normalized);
            setBackgroundColour(themeBackgroundColour(normalized));
            sendLookAndFeelChange();
            repaint();
        }

        void handleFrontendReady()
        {
            frontendReady = true;
            hideStartupSplash();
            if (pendingProjectPath.isEmpty())
                return;

            const auto path = pendingProjectPath;
            pendingProjectPath.clear();
            sendOpenProjectFile(path);
        }

        StartupSplash startupSplash;
        juce::String pendingProjectPath;
        bool frontendReady { false };

        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainWindow)
    };

    void sendCommandToFrontend(const juce::String& command)
    {
        if (mainWindow)
            mainWindow->sendCommand(command);
    }

    BeatLookAndFeel lookAndFeel;
    juce::PopupMenu macApplicationMenu;
    std::unique_ptr<MainWindow> mainWindow;
    std::unique_ptr<juce::FileLogger> diagnosticLogger;
    juce::String pendingProjectPath;
};

START_JUCE_APPLICATION(BeatApp)

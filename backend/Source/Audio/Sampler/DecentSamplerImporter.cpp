#include "DecentSamplerImporter.h"

#include <juce_audio_formats/juce_audio_formats.h>

namespace beat
{
    namespace
    {
        juce::String sanitizeFileName(juce::String name)
        {
            name = name.trim();
            if (name.isEmpty())
                name = "Decent Sampler Import";

            juce::String sanitized;
            for (int index = 0; index < name.length(); ++index)
            {
                auto character = name[index];
                if (!juce::CharacterFunctions::isLetterOrDigit(character) && character != '-' && character != '_' && character != ' ')
                    character = '-';
                sanitized << character;
            }

            return sanitized.substring(0, 80);
        }

        bool isSafeZipEntryPath(juce::String path)
        {
            path = path.replaceCharacter('\\', '/').trim();
            if (path.isEmpty() || path.startsWithChar('/') || path.containsChar(':'))
                return false;

            juce::StringArray parts;
            parts.addTokens(path, "/", {});
            for (const auto& part : parts)
            {
                if (part == "." || part == "..")
                    return false;
            }

            return true;
        }

        juce::File resolveRelativeSamplePath(const juce::File& presetFile, juce::String path)
        {
            path = path.replaceCharacter('\\', '/').trim();
            if (path.isEmpty()) return {};

            juce::File file(path);
            if (path.startsWithChar('/') || path.contains(":")) return file;
            return presetFile.getParentDirectory().getChildFile(path);
        }

        juce::String firstStringAttribute(const juce::XmlElement& element, std::initializer_list<const char*> names)
        {
            for (const auto* name : names)
            {
                const auto value = element.getStringAttribute(name).trim();
                if (value.isNotEmpty()) return value;
            }
            return {};
        }

        int intAttribute(const juce::XmlElement& element, std::initializer_list<const char*> names, int fallback)
        {
            for (const auto* name : names)
            {
                if (element.hasAttribute(name))
                    return element.getIntAttribute(name, fallback);
            }
            return fallback;
        }

        double doubleAttribute(const juce::XmlElement& element, std::initializer_list<const char*> names, double fallback)
        {
            for (const auto* name : names)
            {
                if (element.hasAttribute(name))
                    return element.getDoubleAttribute(name, fallback);
            }
            return fallback;
        }

        bool boolAttribute(const juce::XmlElement& element, std::initializer_list<const char*> names, bool fallback)
        {
            for (const auto* name : names)
            {
                if (element.hasAttribute(name))
                    return element.getBoolAttribute(name, fallback);
            }
            return fallback;
        }

        bool stringAttributeMatches(const juce::XmlElement& element, std::initializer_list<const char*> names, std::initializer_list<const char*> values)
        {
            for (const auto* name : names)
            {
                if (!element.hasAttribute(name))
                    continue;

                const auto raw = element.getStringAttribute(name).trim().toLowerCase();
                for (const auto* value : values)
                {
                    if (raw == juce::String(value).toLowerCase())
                        return true;
                }
            }
            return false;
        }

        double sampleDurationSeconds(juce::AudioFormatManager& formatManager, const juce::File& file)
        {
            std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
            if (reader == nullptr || reader->sampleRate <= 0.0 || reader->lengthInSamples <= 0)
                return 0.0;

            return (double) reader->lengthInSamples / reader->sampleRate;
        }

        bool isDecentUiControl(const juce::XmlElement& element)
        {
            return element.hasTagName("labeled-knob")
                || element.hasTagName("slider")
                || element.hasTagName("button")
                || element.hasTagName("menu");
        }

        bool isLikelyUiImage(const juce::File& file)
        {
            if (!file.existsAsFile())
                return false;

            const auto name = file.getFileName().toLowerCase();
            if (!(name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".webp")))
                return false;

            return name.contains("bg")
                || name.contains("background")
                || name.contains("skin")
                || name.contains("ui")
                || name.contains("panel")
                || name.contains("interface");
        }

        juce::File findFallbackUiImage(const juce::File& presetFile)
        {
            juce::Array<juce::File> images;
            const auto root = presetFile.getParentDirectory();
            const auto resources = root.getChildFile("Resources");

            if (resources.isDirectory())
                resources.findChildFiles(images, juce::File::findFiles, true, "*.png;*.jpg;*.jpeg;*.webp");
            if (images.isEmpty())
                root.findChildFiles(images, juce::File::findFiles, true, "*.png;*.jpg;*.jpeg;*.webp");

            juce::File fallback;
            for (const auto& image : images)
            {
                const auto path = image.getFullPathName();
                if (path.containsIgnoreCase(juce::File::getSeparatorString() + "__MACOSX" + juce::File::getSeparatorString()))
                    continue;
                if (!fallback.existsAsFile())
                    fallback = image;
                if (isLikelyUiImage(image))
                    return image;
            }
            return fallback;
        }

        DecentSamplerUiBinding makeDecentUiBinding(const juce::XmlElement& element)
        {
            DecentSamplerUiBinding binding;
            binding.type = firstStringAttribute(element, { "type", "bindingType" });
            binding.level = firstStringAttribute(element, { "level", "bindingLevel" });
            binding.parameter = firstStringAttribute(element, { "parameter", "param", "bindingParameter" });
            binding.position = intAttribute(element, { "position", "bindingPosition", "index" }, -1);
            return binding;
        }

        DecentSamplerUiControl makeDecentUiControl(const juce::XmlElement& element)
        {
            DecentSamplerUiControl control;
            control.kind = element.getTagName();
            control.label = firstStringAttribute(element, { "label", "name", "text" });
            if (control.label.isEmpty())
                control.label = control.kind;

            control.x = doubleAttribute(element, { "x", "left" }, 0.0);
            control.y = doubleAttribute(element, { "y", "top" }, 0.0);
            control.width = doubleAttribute(element, { "width", "w" }, 0.0);
            control.height = doubleAttribute(element, { "height", "h" }, 0.0);
            control.minValue = doubleAttribute(element, { "minValue", "min", "minimum" }, 0.0);
            control.maxValue = doubleAttribute(element, { "maxValue", "max", "maximum" }, 1.0);
            control.value = doubleAttribute(element, { "value", "defaultValue", "default" }, control.minValue);

            for (auto* child = element.getFirstChildElement(); child != nullptr; child = child->getNextElement())
            {
                if (child->hasTagName("binding"))
                    control.bindings.push_back(makeDecentUiBinding(*child));
            }

            return control;
        }

        juce::String normalizedTrigger(const juce::String& raw)
        {
            const auto trigger = raw.trim().toLowerCase();
            if (trigger == "release" || trigger == "note_off" || trigger == "note-off" || trigger == "noteoff")
                return "release";
            if (trigger == "attack" || trigger == "note_on" || trigger == "note-on" || trigger == "noteon")
                return "attack";
            if (trigger == "first" || trigger == "legato")
                return trigger;
            return trigger.isNotEmpty() ? trigger : "attack";
        }

        void collectDecentSamples(const juce::XmlElement& element,
                                  const juce::File& presetFile,
                                  juce::AudioFormatManager& formatManager,
                                  DecentSamplerImport& preset,
                                  double inheritedVolumeDb = 0.0,
                                  int inheritedSeqPosition = 0,
                                  int inheritedChokeGroup = 0,
                                  juce::String inheritedTrigger = "attack")
        {
            if (element.hasTagName("group"))
            {
                inheritedVolumeDb += doubleAttribute(element, { "volume", "gain" }, 0.0);
                inheritedSeqPosition = intAttribute(element, { "seqPosition", "seq_position" }, inheritedSeqPosition);
                inheritedChokeGroup = juce::jmax(0, intAttribute(element, { "chokeGroup", "choke_group", "exclusiveGroup", "exclusive_group" }, inheritedChokeGroup));
                const auto groupTrigger = firstStringAttribute(element, { "trigger", "playbackMode", "playback_mode" });
                inheritedTrigger = normalizedTrigger(groupTrigger.isNotEmpty() ? groupTrigger : inheritedTrigger);
                if (inheritedTrigger == "attack" && element.getStringAttribute("name").containsIgnoreCase("release"))
                    inheritedTrigger = "release";
            }

            if (element.hasTagName("sample"))
            {
                const auto samplePath = firstStringAttribute(element, { "path", "file", "filename", "fileName", "sample" });
                const auto file = resolveRelativeSamplePath(presetFile, samplePath);
                if (file.existsAsFile())
                {
                    DecentSamplerSample sample;
                    sample.path = file.getFullPathName();
                    sample.name = file.getFileName();
                    const auto sampleTrigger = firstStringAttribute(element, { "trigger", "playbackMode", "playback_mode" });
                    sample.trigger = normalizedTrigger(sampleTrigger.isNotEmpty() ? sampleTrigger : inheritedTrigger);
                    sample.rootNote = intAttribute(element, { "rootNote", "root", "pitch_keycenter" }, 60);
                    sample.loNote = intAttribute(element, { "loNote", "loKey", "lokey" }, 0);
                    sample.hiNote = intAttribute(element, { "hiNote", "hiKey", "hikey" }, 127);
                    sample.loVel = intAttribute(element, { "loVel", "lovel" }, 0);
                    sample.hiVel = intAttribute(element, { "hiVel", "hivel" }, 127);
                    sample.volumeDb = inheritedVolumeDb + doubleAttribute(element, { "volume", "gain" }, 0.0);
                    sample.pan = doubleAttribute(element, { "pan" }, 0.0);
                    sample.tuning = doubleAttribute(element, { "tuning", "pitch" }, 0.0);
                    sample.seqPosition = intAttribute(element, { "seqPosition", "seq_position" }, inheritedSeqPosition);
                    sample.chokeGroup = juce::jmax(0, intAttribute(element, { "chokeGroup", "choke_group", "exclusiveGroup", "exclusive_group" }, inheritedChokeGroup));
                    sample.loopEnabled = boolAttribute(element, { "loopEnabled", "loop", "loop_enabled" }, false)
                        || stringAttributeMatches(element, { "loopMode", "loop_mode", "playbackMode", "trigger" }, { "loop", "loop_continuous", "loop_sustain", "sustain" });
                    sample.loopStart = juce::jmax(0, intAttribute(element, { "loopStart", "loop_start", "loopStartSample", "loop_start_sample" }, 0));
                    sample.loopEnd = juce::jmax(0, intAttribute(element, { "loopEnd", "loop_end", "loopEndSample", "loop_end_sample" }, 0));
                    sample.oneShot = boolAttribute(element, { "oneShot", "one_shot" }, false)
                        || stringAttributeMatches(element, { "trigger", "playbackMode", "loopMode", "loop_mode" }, { "one_shot", "oneshot", "one shot" });
                    sample.durationSeconds = sampleDurationSeconds(formatManager, file);
                    sample.loLengthSeconds = doubleAttribute(element, { "loLength", "lo_length", "loLengthSeconds", "lo_length_seconds", "minLength", "min_length" }, 0.0);
                    sample.hiLengthSeconds = doubleAttribute(element, { "hiLength", "hi_length", "hiLengthSeconds", "hi_length_seconds", "maxLength", "max_length" }, 0.0);
                    sample.startSample = juce::jmax(0, intAttribute(element, { "start", "startSample", "sampleStart", "offset" }, 0));
                    sample.endSample = juce::jmax(0, intAttribute(element, { "end", "endSample", "sampleEnd" }, 0));
                    if (sample.endSample > 0 && sample.startSample >= sample.endSample)
                    {
                        sample.startSample = 0;
                        sample.endSample = 0;
                    }

                    if (!preset.sampleUrls.contains(sample.path))
                        preset.sampleUrls.add(sample.path);
                    preset.samples.push_back(std::move(sample));
                }
            }

            for (auto* child = element.getFirstChildElement(); child != nullptr; child = child->getNextElement())
                collectDecentSamples(*child, presetFile, formatManager, preset, inheritedVolumeDb, inheritedSeqPosition, inheritedChokeGroup, inheritedTrigger);
        }

        void collectDecentUiControls(const juce::XmlElement& element,
                                     DecentSamplerImport& preset)
        {
            if (isDecentUiControl(element))
            {
                auto control = makeDecentUiControl(element);

                if (!preset.uiControls.contains(control.label))
                    preset.uiControls.add(control.label);
                preset.uiControlDetails.push_back(std::move(control));
            }

            for (auto* child = element.getFirstChildElement(); child != nullptr; child = child->getNextElement())
                collectDecentUiControls(*child, preset);
        }

        void collectDecentEffects(const juce::XmlElement& element,
                                  DecentSamplerImport& preset)
        {
            if (element.hasTagName("effects"))
            {
                int position = 0;
                for (auto* effectElement = element.getFirstChildElement(); effectElement != nullptr; effectElement = effectElement->getNextElement())
                {
                    if (!effectElement->hasTagName("effect"))
                        continue;

                    DecentSamplerEffect effect;
                    effect.type = firstStringAttribute(*effectElement, { "type", "kind" });
                    effect.position = intAttribute(*effectElement, { "position", "index" }, position);
                    effect.frequency = doubleAttribute(*effectElement, { "frequency", "cutoff", "cutoffHz" }, 0.0);
                    effect.resonance = doubleAttribute(*effectElement, { "resonance", "q" }, 0.0);
                    effect.wetLevel = doubleAttribute(*effectElement, { "wetLevel", "wet", "mix" }, 0.0);
                    effect.roomSize = doubleAttribute(*effectElement, { "roomSize", "room", "size" }, 0.0);
                    effect.damping = doubleAttribute(*effectElement, { "damping", "damp" }, 0.0);
                    if (effect.type.isNotEmpty())
                        preset.effects.push_back(std::move(effect));
                    ++position;
                }
            }

            for (auto* child = element.getFirstChildElement(); child != nullptr; child = child->getNextElement())
                collectDecentEffects(*child, preset);
        }
    }

    juce::File defaultDecentSamplerImportRoot()
    {
        auto root = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
            .getChildFile("Beat")
            .getChildFile("Imported Decent Sampler");
        root.createDirectory();
        return root;
    }

    juce::File findDecentSamplerPresetInFolder(const juce::File& folder)
    {
        juce::Array<juce::File> presets;
        folder.findChildFiles(presets, juce::File::findFiles, true, "*.dspreset");

        juce::File fallback;
        for (const auto& preset : presets)
        {
            if (!fallback.existsAsFile())
                fallback = preset;

            if (!preset.getFullPathName().containsIgnoreCase(juce::File::getSeparatorString() + "__MACOSX" + juce::File::getSeparatorString()))
                return preset;
        }

        return fallback;
    }

    juce::File extractDecentSamplerArchive(const juce::File& archiveFile, const juce::File& importRoot)
    {
        juce::ZipFile zip(archiveFile);
        if (zip.getNumEntries() <= 0)
            return {};

        for (int index = 0; index < zip.getNumEntries(); ++index)
        {
            if (const auto* entry = zip.getEntry(index))
            {
                if (!isSafeZipEntryPath(entry->filename))
                    return {};
            }
        }

        auto target = importRoot.getChildFile(sanitizeFileName(archiveFile.getFileNameWithoutExtension()) + "-" + juce::Uuid().toString().substring(0, 8));
        if (!target.createDirectory())
            return {};

        for (int index = 0; index < zip.getNumEntries(); ++index)
        {
            if (!zip.uncompressEntry(index, target, false))
            {
                target.deleteRecursively();
                return {};
            }
        }

        auto preset = findDecentSamplerPresetInFolder(target);
        if (!preset.existsAsFile())
            target.deleteRecursively();
        return preset;
    }

    juce::File resolveDecentSamplerPreset(const juce::File& selectedFile, const juce::File& importRoot)
    {
        if (selectedFile.hasFileExtension(".dspreset"))
            return selectedFile;

        if (selectedFile.hasFileExtension(".zip"))
            return extractDecentSamplerArchive(selectedFile, importRoot);

        if (selectedFile.isDirectory())
            return findDecentSamplerPresetInFolder(selectedFile);

        return {};
    }

    std::optional<DecentSamplerImport> parseDecentSamplerPreset(const juce::File& presetFile)
    {
        auto xml = juce::XmlDocument::parse(presetFile);
        if (xml == nullptr)
            return std::nullopt;

        DecentSamplerImport preset;
        preset.name = xml->getStringAttribute("name", presetFile.getFileNameWithoutExtension());
        preset.path = presetFile.getFullPathName();
        if (auto* ui = xml->getChildByName("ui"))
        {
            preset.uiWidth = ui->getIntAttribute("width", 0);
            preset.uiHeight = ui->getIntAttribute("height", 0);
            const auto uiImage = firstStringAttribute(*ui, { "bgImage", "backgroundImage", "image" });
            auto resolved = resolveRelativeSamplePath(presetFile, uiImage);
            if (resolved.existsAsFile())
                preset.uiImagePath = resolved.getFullPathName();
        }
        if (preset.uiImagePath.isEmpty())
        {
            auto fallbackImage = findFallbackUiImage(presetFile);
            if (fallbackImage.existsAsFile())
                preset.uiImagePath = fallbackImage.getFullPathName();
        }
        collectDecentUiControls(*xml, preset);
        collectDecentEffects(*xml, preset);
        juce::AudioFormatManager formatManager;
        formatManager.registerBasicFormats();
        collectDecentSamples(*xml, presetFile, formatManager, preset);

        if (preset.sampleUrls.isEmpty() || preset.samples.empty())
            return std::nullopt;

        return preset;
    }
}

#include "HybridSourceDocumentValidation.h"
#include <cmath>

namespace beat
{
    namespace
    {
        constexpr int sampleSlot1SchemaVersion = 5;
        constexpr int granularSlot2SchemaVersion = 1;
        constexpr int managedAssetSchemaVersion = 1;

        bool hasProperty(const juce::var& value, const juce::Identifier& property)
        {
            const auto* object = value.getDynamicObject();
            return object != nullptr && object->hasProperty(property);
        }

        bool isIntegralNumber(const juce::var& value)
        {
            if (value.isInt() || value.isInt64())
                return true;
            if (!value.isDouble())
                return false;
            const auto number = (double) value;
            return std::isfinite(number) && std::floor(number) == number;
        }

        void add(std::vector<HybridSourceDocumentDiagnostic>& diagnostics,
                 const juce::String& code,
                 const juce::String& path,
                 const juce::String& message)
        {
            diagnostics.push_back({ code, path, message });
        }

        bool validateVersion(const juce::var& value,
                             int currentVersion,
                             const juce::String& codePrefix,
                             const juce::String& path,
                             std::vector<HybridSourceDocumentDiagnostic>& diagnostics)
        {
            if (!hasProperty(value, "schemaVersion"))
                return true; // legacy version zero

            const auto version = value.getProperty("schemaVersion", {});
            if (!isIntegralNumber(version) || (double) version < 0.0)
            {
                add(diagnostics, codePrefix + ".schema-invalid", path + ".schemaVersion",
                    "schemaVersion must be a non-negative integer.");
                return false;
            }
            if ((double) version > (double) currentVersion)
            {
                add(diagnostics, codePrefix + ".schema-future", path + ".schemaVersion",
                    "schemaVersion " + version.toString() + " is newer than supported version "
                        + juce::String(currentVersion) + ".");
                return false;
            }
            return true;
        }

        void validateManagedSfz(const juce::var& slot,
                                const juce::String& path,
                                std::vector<HybridSourceDocumentDiagnostic>& diagnostics)
        {
            if (!hasProperty(slot, "managedSfz"))
                return;
            const auto managed = slot.getProperty("managedSfz", {});
            const auto managedPath = path + ".managedSfz";
            if (!managed.isObject())
            {
                add(diagnostics, "aether.sample-slot-1.managed-sfz.shape", managedPath,
                    "managedSfz must be an object when present.");
                return;
            }
            validateVersion(managed, managedAssetSchemaVersion,
                            "aether.sample-slot-1.managed-sfz", managedPath, diagnostics);
            const bool hasManagedContent = managed.getProperty("assetId", {}).toString().isNotEmpty()
                || managed.getProperty("manifestPath", {}).toString().isNotEmpty()
                || managed.getProperty("sourcePath", {}).toString().isNotEmpty();
            if (hasManagedContent
                && (managed.getProperty("assetId", {}).toString().isEmpty()
                    || managed.getProperty("manifestPath", {}).toString().isEmpty()
                    || managed.getProperty("sourcePath", {}).toString().isEmpty()))
                add(diagnostics, "aether.sample-slot-1.managed-sfz.fields-missing", managedPath,
                    "A non-empty managedSfz requires assetId, manifestPath, and sourcePath.");

            if (hasProperty(managed, "samplePaths"))
            {
                const auto* paths = managed.getProperty("samplePaths", {}).getArray();
                if (paths == nullptr)
                    add(diagnostics, "aether.sample-slot-1.managed-sfz.sample-paths-shape",
                        managedPath + ".samplePaths", "samplePaths must be an array when present.");
                else if (paths->size() > 256)
                    add(diagnostics, "aether.sample-slot-1.managed-sfz.sample-paths-capacity",
                        managedPath + ".samplePaths", "samplePaths exceeds the supported maximum of 256.");
                else
                    for (int index = 0; index < paths->size(); ++index)
                        if (!paths->getReference(index).isString() || paths->getReference(index).toString().isEmpty())
                            add(diagnostics, "aether.sample-slot-1.managed-sfz.sample-path-invalid",
                                managedPath + ".samplePaths[" + juce::String(index) + "]",
                                "Each sample path must be a non-empty string.");
            }
        }

        void validateSampleSlot(const juce::var& aether,
                                const juce::String& path,
                                std::vector<HybridSourceDocumentDiagnostic>& diagnostics)
        {
            if (!hasProperty(aether, "sampleSlot1"))
                return;
            const auto slot = aether.getProperty("sampleSlot1", {});
            const auto slotPath = path + ".sampleSlot1";
            if (!slot.isObject())
            {
                add(diagnostics, "aether.sample-slot-1.shape", slotPath,
                    "sampleSlot1 must be an object when present.");
                return;
            }
            validateVersion(slot, sampleSlot1SchemaVersion, "aether.sample-slot-1", slotPath, diagnostics);
            validateManagedSfz(slot, slotPath, diagnostics);

            const auto zones = slot.getProperty("zones", {});
            if (hasProperty(slot, "zones") && zones.getArray() == nullptr)
                add(diagnostics, "aether.sample-slot-1.zones-shape", slotPath + ".zones",
                    "zones must be an array when present.");
            else if (const auto* array = zones.getArray(); array != nullptr && array->size() > 8)
                add(diagnostics, "aether.sample-slot-1.zones-capacity", slotPath + ".zones",
                    "zones exceeds the supported maximum of 8; loading would discard entries.");
            else if (const auto* array = zones.getArray())
                for (int index = 0; index < array->size(); ++index)
                {
                    const auto& zone = array->getReference(index);
                    if (!zone.isObject() || zone.getProperty("audioFileId", {}).toString().isEmpty())
                        add(diagnostics, "aether.sample-slot-1.zone-shape",
                            slotPath + ".zones[" + juce::String(index) + "]",
                            "Each zone must be an object with a non-empty audioFileId.");
                }

            if ((bool) slot.getProperty("enabled", false))
            {
                const bool hasDirectSource = slot.getProperty("audioFileId", {}).toString().isNotEmpty();
                const bool hasZones = zones.getArray() != nullptr && !zones.getArray()->isEmpty();
                const auto managed = slot.getProperty("managedSfz", {});
                const bool hasManagedSource = managed.isObject()
                    && managed.getProperty("manifestPath", {}).toString().isNotEmpty();
                if (!hasDirectSource && !hasZones && !hasManagedSource)
                    add(diagnostics, "aether.sample-slot-1.source-missing", slotPath,
                        "Enabled sampleSlot1 has no direct, mapped, or managed source.");
            }
        }

        void validateGranularSlot(const juce::var& aether,
                                  const juce::String& path,
                                  std::vector<HybridSourceDocumentDiagnostic>& diagnostics)
        {
            if (!hasProperty(aether, "granularSlot2"))
                return;
            const auto slot = aether.getProperty("granularSlot2", {});
            const auto slotPath = path + ".granularSlot2";
            if (!slot.isObject())
            {
                add(diagnostics, "aether.granular-slot-2.shape", slotPath,
                    "granularSlot2 must be an object when present.");
                return;
            }
            validateVersion(slot, granularSlot2SchemaVersion, "aether.granular-slot-2", slotPath, diagnostics);

            const auto builtin = slot.getProperty("builtinSource", {}).toString();
            if (builtin.isNotEmpty() && builtin != "benchmark")
                add(diagnostics, "aether.granular-slot-2.builtin-unsupported", slotPath + ".builtinSource",
                    "builtinSource is not supported by this version.");

            const auto managed = slot.getProperty("managedAsset", {});
            if (hasProperty(slot, "managedAsset"))
            {
                const auto managedPath = slotPath + ".managedAsset";
                if (!managed.isObject())
                    add(diagnostics, "aether.granular-slot-2.managed-asset.shape", managedPath,
                        "managedAsset must be an object when present.");
                else
                {
                    validateVersion(managed, managedAssetSchemaVersion,
                                    "aether.granular-slot-2.managed-asset", managedPath, diagnostics);
                    const bool hasManagedContent = managed.getProperty("assetId", {}).toString().isNotEmpty()
                        || managed.getProperty("manifestPath", {}).toString().isNotEmpty()
                        || managed.getProperty("audioPath", {}).toString().isNotEmpty();
                    if (hasManagedContent
                        && (managed.getProperty("assetId", {}).toString().isEmpty()
                            || managed.getProperty("manifestPath", {}).toString().isEmpty()
                            || managed.getProperty("audioPath", {}).toString().isEmpty()))
                        add(diagnostics, "aether.granular-slot-2.managed-asset.fields-missing", managedPath,
                            "A non-empty managedAsset requires assetId, manifestPath, and audioPath.");
                }
            }

            if ((bool) slot.getProperty("enabled", false))
            {
                const bool hasManagedSource = managed.isObject()
                    && managed.getProperty("manifestPath", {}).toString().isNotEmpty();
                if (builtin.isEmpty() && !hasManagedSource)
                    add(diagnostics, "aether.granular-slot-2.source-missing", slotPath,
                        "Enabled granularSlot2 has no built-in or managed source.");
            }
        }

        void validateLumenConfig(const juce::var& lumen,
                                 const juce::String& path,
                                 std::vector<HybridSourceDocumentDiagnostic>& diagnostics)
        {
            if (!lumen.isObject())
            {
                add(diagnostics, "lumen.config.shape", path,
                    "A Lumen instrument requires an object-valued Lumen configuration.");
                return;
            }
            if (!validateVersion(lumen, 2, "lumen.config", path, diagnostics))
                return;
            const int configSchemaVersion = (int) lumen.getProperty("schemaVersion", 0);

            const auto requireThree = [&](const char* property, const char* code) -> const juce::Array<juce::var>*
            {
                const auto* array = lumen.getProperty(property, {}).getArray();
                if (array == nullptr || array->size() != 3)
                    add(diagnostics, code, path + "." + property,
                        juce::String(property) + " must contain exactly three entries.");
                return array != nullptr && array->size() == 3 ? array : nullptr;
            };
            const auto* sampleSlots = requireThree("sampleSlots", "lumen.sample-slots.capacity");
            const auto* sampleModes = requireThree("sampleModes", "lumen.sample-modes.capacity");
            const auto* granularSlots = requireThree("granularSlots", "lumen.granular-slots.capacity");
            const auto* granularModes = requireThree("granularModes", "lumen.granular-modes.capacity");
            const auto validateModes = [&](const juce::Array<juce::var>* modes,
                                           const char* property,
                                           const char* code)
            {
                if (modes == nullptr) return;
                for (int index = 0; index < modes->size(); ++index)
                    if (!modes->getReference(index).isBool())
                        add(diagnostics, code,
                            path + "." + property + "[" + juce::String(index) + "]",
                            "Each source mode must be a boolean.");
            };
            validateModes(sampleModes, "sampleModes", "lumen.sample-modes.type");
            validateModes(granularModes, "granularModes", "lumen.granular-modes.type");
            for (int index = 0; index < 3; ++index)
            {
                if (sampleSlots != nullptr)
                {
                    juce::DynamicObject::Ptr holder = new juce::DynamicObject();
                    holder->setProperty("sampleSlot1", sampleSlots->getReference(index));
                    validateSampleSlot(juce::var(holder.get()),
                        path + ".sampleSlots[" + juce::String(index) + "]", diagnostics);
                }
                if (granularSlots != nullptr)
                {
                    juce::DynamicObject::Ptr holder = new juce::DynamicObject();
                    holder->setProperty("granularSlot2", granularSlots->getReference(index));
                    validateGranularSlot(juce::var(holder.get()),
                        path + ".granularSlots[" + juce::String(index) + "]", diagnostics);
                }
            }

            const auto arpeggiator = lumen.getProperty("arpeggiator", {});
            const auto clip = lumen.getProperty("clip", {});
            if (!arpeggiator.isObject())
                add(diagnostics, "lumen.arpeggiator.shape", path + ".arpeggiator",
                    "arpeggiator must be an object.");
            const auto validateRate = [&](const juce::var& owner,
                                          const juce::String& ownerPath,
                                          const char* code)
            {
                const auto rate = owner.getProperty("rateDivision", {});
                if (!isIntegralNumber(rate)
                    || ((int) rate != 4 && (int) rate != 8
                        && (int) rate != 16 && (int) rate != 32))
                    add(diagnostics, code, ownerPath + ".rateDivision",
                        "rateDivision must be one of 4, 8, 16, or 32.");
            };
            if (arpeggiator.isObject())
                validateRate(arpeggiator, path + ".arpeggiator", "lumen.arpeggiator.rate");
            if (!clip.isObject())
            {
                add(diagnostics, "lumen.clip.shape", path + ".clip", "clip must be an object.");
                return;
            }
            validateRate(clip, path + ".clip", "lumen.clip.rate");
            const auto lengthValue = clip.getProperty("lengthSteps", {});
            if (!isIntegralNumber(lengthValue) || (int) lengthValue < 1 || (int) lengthValue > 32)
            {
                add(diagnostics, "lumen.clip.length", path + ".clip.lengthSteps",
                    "lengthSteps must be an integer from 1 through 32.");
            }
            else if (configSchemaVersion < 2)
            {
                const auto* steps = clip.getProperty("steps", {}).getArray();
                if (steps == nullptr || steps->size() != (int) lengthValue)
                    add(diagnostics, "lumen.clip.steps-capacity", path + ".clip.steps",
                        "steps must contain exactly lengthSteps entries.");
                else
                    for (int index = 0; index < steps->size(); ++index)
                        if (!steps->getReference(index).isObject())
                            add(diagnostics, "lumen.clip.step-shape",
                                path + ".clip.steps[" + juce::String(index) + "]",
                                "Each clip step must be an object.");
            }
            else
            {
                const auto* notes = clip.getProperty("notes", {}).getArray();
                if ((int) clip.getProperty("schemaVersion", 0) != 2)
                    add(diagnostics, "lumen.clip.schema", path + ".clip.schemaVersion",
                        "Polyphonic clips require schemaVersion 2.");
                if (notes == nullptr || notes->size() > 64)
                    add(diagnostics, "lumen.clip.notes-capacity", path + ".clip.notes",
                        "notes must contain at most 64 entries.");
                else
                    for (int index = 0; index < notes->size(); ++index)
                    {
                        const auto& note = notes->getReference(index);
                        const int startStep = (int) note.getProperty("startStep", -1);
                        const int pitchOffset = (int) note.getProperty("pitchOffset", 99);
                        const int noteLength = (int) note.getProperty("lengthSteps", 0);
                        const double velocity = (double) note.getProperty("velocity", 0.0);
                        if (!note.isObject() || startStep < 0 || startStep >= (int) lengthValue
                            || pitchOffset < -48 || pitchOffset > 48
                            || noteLength < 1 || noteLength > (int) lengthValue - startStep
                            || !std::isfinite(velocity) || velocity <= 0.0 || velocity > 1.0)
                            add(diagnostics, "lumen.clip.note-range",
                                path + ".clip.notes[" + juce::String(index) + "]",
                                "Each clip note must fit the bounded time, pitch, length, and velocity range.");
                    }
            }
            if (arpeggiator.isObject()
                && (bool) arpeggiator.getProperty("enabled", false)
                && (bool) clip.getProperty("enabled", false))
                add(diagnostics, "lumen.performance-mode.conflict", path,
                    "Arpeggiator and clip cannot both be enabled.");
        }
    }

    std::vector<HybridSourceDocumentDiagnostic> validateHybridSourceDocument(const juce::var& document)
    {
        std::vector<HybridSourceDocumentDiagnostic> diagnostics;
        const auto* instruments = document.getProperty("instruments", {}).getArray();
        if (instruments == nullptr)
            return diagnostics;

        for (int index = 0; index < instruments->size(); ++index)
        {
            const auto& instrument = instruments->getReference(index);
            const auto aether = instrument.getProperty("aether", {});
            if (aether.isObject())
            {
                const auto path = "instruments[" + juce::String(index) + "].aether";
                validateSampleSlot(aether, path, diagnostics);
                validateGranularSlot(aether, path, diagnostics);
            }
            const auto synthEngine = instrument.getProperty("synthEngine", {}).toString();
            if (synthEngine == "lumen" || synthEngine == "lumus")
            {
                const bool legacy = synthEngine == "lumus" && !instrument.hasProperty("lumen");
                validateLumenConfig(instrument.getProperty(legacy ? "lumus" : "lumen", {}),
                    "instruments[" + juce::String(index) + "]." + (legacy ? "lumus" : "lumen"), diagnostics);
            }
        }
        return diagnostics;
    }
}

#include "HybridSourceDocumentValidation.h"
#include <cmath>

namespace beat
{
    namespace
    {
        constexpr int sampleSlot1SchemaVersion = 5;
        constexpr int granularSlot2SchemaVersion = 1;
        constexpr int spectralSlot3SchemaVersion = 1;
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

        void validateSpectralSlot(const juce::var& aether,
                                  const juce::String& path,
                                  std::vector<HybridSourceDocumentDiagnostic>& diagnostics)
        {
            if (!hasProperty(aether, "spectralSlot3")) return;
            const auto slot = aether.getProperty("spectralSlot3", {});
            const auto slotPath = path + ".spectralSlot3";
            if (!slot.isObject())
            {
                add(diagnostics, "aether.spectral-slot-3.shape", slotPath,
                    "spectralSlot3 must be an object when present.");
                return;
            }
            validateVersion(slot, spectralSlot3SchemaVersion,
                "aether.spectral-slot-3", slotPath, diagnostics);
            const auto builtin = slot.getProperty("builtinSource", {}).toString();
            if (builtin.isNotEmpty() && builtin != "benchmark")
                add(diagnostics, "aether.spectral-slot-3.builtin-unsupported",
                    slotPath + ".builtinSource",
                    "builtinSource is not supported by this version.");
            const auto managed = slot.getProperty("managedAsset", {});
            if (hasProperty(slot, "managedAsset"))
            {
                const auto managedPath = slotPath + ".managedAsset";
                if (!managed.isObject())
                    add(diagnostics, "aether.spectral-slot-3.managed-asset.shape", managedPath,
                        "managedAsset must be an object when present.");
                else
                {
                    validateVersion(managed, managedAssetSchemaVersion,
                        "aether.spectral-slot-3.managed-asset", managedPath, diagnostics);
                    const bool hasContent = managed.getProperty("assetId", {}).toString().isNotEmpty()
                        || managed.getProperty("manifestPath", {}).toString().isNotEmpty()
                        || managed.getProperty("sourcePath", {}).toString().isNotEmpty()
                        || managed.getProperty("artifactPath", {}).toString().isNotEmpty();
                    if (hasContent
                        && (managed.getProperty("assetId", {}).toString().isEmpty()
                            || managed.getProperty("manifestPath", {}).toString().isEmpty()
                            || managed.getProperty("sourcePath", {}).toString().isEmpty()
                            || managed.getProperty("artifactPath", {}).toString().isEmpty()))
                        add(diagnostics, "aether.spectral-slot-3.managed-asset.fields-missing",
                            managedPath, "A non-empty managedAsset requires assetId, manifestPath, sourcePath, and artifactPath.");
                }
            }
            if ((bool) slot.getProperty("enabled", false)
                && builtin.isEmpty()
                && (!managed.isObject()
                    || managed.getProperty("manifestPath", {}).toString().isEmpty()))
                add(diagnostics, "aether.spectral-slot-3.source-missing", slotPath,
                    "Enabled spectralSlot3 has no built-in or managed source.");
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
            if (!aether.isObject())
                continue;
            const auto path = "instruments[" + juce::String(index) + "].aether";
            validateSampleSlot(aether, path, diagnostics);
            validateGranularSlot(aether, path, diagnostics);
            validateSpectralSlot(aether, path, diagnostics);
        }
        return diagnostics;
    }
}

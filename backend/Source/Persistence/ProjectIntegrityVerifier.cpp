#include "ProjectIntegrityVerifier.h"

#include "ProjectAssetPackage.h"

#include <map>
#include <functional>
#include <set>
#include <vector>

namespace beat
{
    namespace
    {
        constexpr int supportedSchemaVersion = 1;

        juce::String severityToString(ProjectIntegritySeverity severity)
        {
            switch (severity)
            {
                case ProjectIntegritySeverity::Info: return "info";
                case ProjectIntegritySeverity::Warning: return "warning";
                case ProjectIntegritySeverity::Error: return "error";
            }
            return "info";
        }

        bool isEphemeralAssetPath(const juce::String& path)
        {
            return path.startsWith("blob:") || path.startsWith("data:");
        }

        bool isUrlLikePath(const juce::String& path)
        {
            return path.contains("://") || isEphemeralAssetPath(path);
        }

        bool shouldSkipAssetExistenceCheck(const juce::String& path, const juce::String& policy = {})
        {
            return path.isEmpty()
                || path.startsWith("/samples/")
                || isUrlLikePath(path)
                || policy == "bundled"
                || policy == "plugin";
        }

        juce::String propertyPath(const juce::String& base, const juce::String& child)
        {
            return base.isEmpty() ? child : base + "." + child;
        }

        void addIssue(ProjectIntegrityReport& report,
                      ProjectIntegritySeverity severity,
                      const juce::String& code,
                      const juce::String& message,
                      const juce::String& path = {})
        {
            ProjectIntegrityIssue issue;
            issue.severity = severity;
            issue.code = code;
            issue.message = message;
            issue.path = path;
            report.issues.add(std::move(issue));
        }

        const juce::Array<juce::var>* arrayOf(const juce::var& value)
        {
            return value.getArray();
        }

        juce::String stringProperty(const juce::var& value, const juce::Identifier& key)
        {
            return value.getProperty(key, {}).toString();
        }

        double doubleProperty(const juce::var& value, const juce::Identifier& key, double fallback = 0.0)
        {
            const auto raw = value.getProperty(key, {});
            return raw.isDouble() || raw.isInt() || raw.isInt64() ? static_cast<double>(raw) : fallback;
        }

        bool hasProperty(const juce::var& value, const juce::Identifier& key)
        {
            const auto raw = value.getProperty(key, {});
            return !raw.isVoid();
        }

        bool trackKindIsGroup(const juce::var& value)
        {
            if (value.isString())
                return value.toString() == "group";
            return (int) value == 3;
        }

        struct TrackParentRef
        {
            juce::String id;
            juce::String parentId;
            juce::String path;
            bool group { false };
        };

        struct TrackFreezeRef
        {
            juce::String trackId;
            juce::String sourceTrackId;
            juce::String audioFileId;
            juce::String segmentId;
            juce::String path;
            juce::String trackAudioFileId;
        };

        struct AudioFileMetadata
        {
            juce::String id;
            double durationSeconds { 0.0 };
            bool hasDuration { false };
        };

        const AudioFileMetadata* findAudioFileMetadata(const std::vector<AudioFileMetadata>& metadata,
                                                       const juce::String& id)
        {
            for (const auto& audioFile : metadata)
                if (audioFile.id == id)
                    return &audioFile;
            return nullptr;
        }

        bool normalizedPathStartsWith(const juce::String& path, const juce::String& folder)
        {
            auto normalizedFolder = folder;
            if (!normalizedFolder.endsWithChar(juce::File::getSeparatorChar()))
                normalizedFolder += juce::String::charToString(juce::File::getSeparatorChar());
            return path == folder || path.startsWith(normalizedFolder);
        }

        void recordSidecarUsage(const juce::File& projectFile,
                                const juce::String& path,
                                juce::StringArray& usedSidecarFiles)
        {
            if (path.isEmpty())
                return;

            const auto sidecarRoot = projectSidecarFolderFor(projectFile);
            const auto resolvedPath = resolveProjectRelativePath(projectFile, path);
            const auto resolved = juce::File(resolvedPath);
            const auto sidecarRootPath = sidecarRoot.getFullPathName();
            const auto resolvedFullPath = resolved.getFullPathName();

            if (normalizedPathStartsWith(resolvedFullPath, sidecarRootPath)
                && !usedSidecarFiles.contains(resolvedFullPath))
            {
                usedSidecarFiles.add(resolvedFullPath);
            }
        }

        void verifyAssetPath(ProjectIntegrityReport& report,
                             const juce::File& projectFile,
                             const juce::String& path,
                             const juce::String& policy,
                             const juce::String& context,
                             juce::StringArray& usedSidecarFiles)
        {
            if (path.isEmpty())
            {
                addIssue(report,
                         ProjectIntegritySeverity::Error,
                         "asset.path.empty",
                         "Asset reference has no path.",
                         context);
                return;
            }

            if (shouldSkipAssetExistenceCheck(path, policy))
                return;

            const auto resolved = juce::File(resolveProjectRelativePath(projectFile, path));
            if (!resolved.existsAsFile())
            {
                addIssue(report,
                         ProjectIntegritySeverity::Error,
                         "asset.missing",
                         "Referenced asset does not exist: " + path,
                         context);
                return;
            }

            recordSidecarUsage(projectFile, path, usedSidecarFiles);
        }

        void verifyUniqueId(ProjectIntegrityReport& report,
                            juce::StringArray& ids,
                            const juce::String& id,
                            const juce::String& kind,
                            const juce::String& path)
        {
            if (id.isEmpty())
            {
                addIssue(report,
                         ProjectIntegritySeverity::Error,
                         kind + ".id.empty",
                         kind + " has no id.",
                         path);
                return;
            }

            if (ids.contains(id))
            {
                addIssue(report,
                         ProjectIntegritySeverity::Error,
                         kind + ".id.duplicate",
                         kind + " id is duplicated: " + id,
                         path);
                return;
            }

            ids.add(id);
        }

        void collectIds(const juce::var& arrayVar, juce::StringArray& ids)
        {
            if (const auto* array = arrayOf(arrayVar))
            {
                for (const auto& item : *array)
                {
                    const auto id = stringProperty(item, "id");
                    if (id.isNotEmpty() && !ids.contains(id))
                        ids.add(id);
                }
            }
        }

        void verifyEffectList(ProjectIntegrityReport& report,
                              const juce::var& effectsVar,
                              const juce::StringArray& pluginIds,
                              const juce::String& basePath)
        {
            const auto filtersVar = effectsVar.getProperty("filters", {});
            if (const auto* filters = arrayOf(filtersVar))
            {
                juce::StringArray effectIds;
                for (int effectIndex = 0; effectIndex < filters->size(); ++effectIndex)
                {
                    const auto& effect = filters->getReference(effectIndex);
                    const auto effectPath = propertyPath(basePath, "filters[" + juce::String(effectIndex) + "]");
                    verifyUniqueId(report, effectIds, stringProperty(effect, "id"), "effect", effectPath);

                    const auto pluginId = stringProperty(effect, "pluginId");
                    if (pluginId.isNotEmpty() && !pluginIds.contains(pluginId))
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Warning,
                                 "effect.plugin.missing",
                                 "Effect references a plugin not stored in this document: " + pluginId,
                                 propertyPath(effectPath, "pluginId"));
                    }
                }
            }
        }

        void verifyPluginAdapters(ProjectIntegrityReport& report,
                                  const juce::var& pluginsVar,
                                  const juce::StringArray& instrumentIds)
        {
            const auto* plugins = arrayOf(pluginsVar);
            if (plugins == nullptr)
                return;

            for (int pluginIndex = 0; pluginIndex < plugins->size(); ++pluginIndex)
            {
                const auto& plugin = plugins->getReference(pluginIndex);
                const auto associatedInstrumentId = stringProperty(plugin, "associatedInstrumentId");
                if (associatedInstrumentId.isNotEmpty() && !instrumentIds.contains(associatedInstrumentId))
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Warning,
                             "plugin.instrument.missing",
                             "Plugin references a sampler instrument not stored in this document: " + associatedInstrumentId,
                             "plugins[" + juce::String(pluginIndex) + "].associatedInstrumentId");
                }
            }
        }

        void verifyInstrumentAssets(ProjectIntegrityReport& report,
                                    const juce::File& projectFile,
                                    const juce::var& instrument,
                                    int instrumentIndex,
                                    juce::StringArray& usedSidecarFiles)
        {
            const auto basePath = "instruments[" + juce::String(instrumentIndex) + "]";

            const auto sampleUrl = stringProperty(instrument, "sampleUrl");
            if (sampleUrl.isNotEmpty())
            {
                verifyAssetPath(report,
                                projectFile,
                                sampleUrl,
                                {},
                                propertyPath(basePath, "sampleUrl"),
                                usedSidecarFiles);
            }

            const auto sampleUrlsVar = instrument.getProperty("sampleUrls", {});
            if (const auto* sampleUrls = arrayOf(sampleUrlsVar))
            {
                for (int i = 0; i < sampleUrls->size(); ++i)
                {
                    verifyAssetPath(report,
                                    projectFile,
                                    sampleUrls->getReference(i).toString(),
                                    {},
                                    propertyPath(basePath, "sampleUrls[" + juce::String(i) + "]"),
                                    usedSidecarFiles);
                }
            }

            const auto sampleMapVar = instrument.getProperty("sampleMap", {});
            if (const auto* sampleMap = arrayOf(sampleMapVar))
            {
                for (int i = 0; i < sampleMap->size(); ++i)
                {
                    const auto& zone = sampleMap->getReference(i);
                    const auto zonePath = propertyPath(basePath, "sampleMap[" + juce::String(i) + "]");
                    const auto path = stringProperty(zone, "path");
                    if (path.isNotEmpty())
                    {
                        verifyAssetPath(report,
                                        projectFile,
                                        path,
                                        {},
                                        propertyPath(zonePath, "path"),
                                        usedSidecarFiles);
                    }

                    const auto zoneSampleUrl = stringProperty(zone, "sampleUrl");
                    if (zoneSampleUrl.isNotEmpty())
                    {
                        verifyAssetPath(report,
                                        projectFile,
                                        zoneSampleUrl,
                                        {},
                                        propertyPath(zonePath, "sampleUrl"),
                                        usedSidecarFiles);
                    }
                }
            }
        }

        void verifyManifestAssets(ProjectIntegrityReport& report,
                                  const juce::File& projectFile,
                                  const juce::var& assetsVar,
                                  juce::StringArray& usedSidecarFiles)
        {
            if (assetsVar.isVoid())
                return;

            const auto* assets = arrayOf(assetsVar);
            if (assets == nullptr)
            {
                addIssue(report,
                         ProjectIntegritySeverity::Error,
                         "assets.invalid",
                         "Document assets manifest is not an array.",
                         "assets");
                return;
            }

            juce::StringArray assetIds;
            for (int i = 0; i < assets->size(); ++i)
            {
                const auto& asset = assets->getReference(i);
                const auto basePath = "assets[" + juce::String(i) + "]";
                verifyUniqueId(report, assetIds, stringProperty(asset, "id"), "asset", basePath);

                const auto kind = stringProperty(asset, "kind");
                if (kind != "audio" && kind != "sample" && kind != "plugin")
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Warning,
                             "asset.kind.unknown",
                             "Asset kind is not recognized: " + kind,
                             propertyPath(basePath, "kind"));
                }

                verifyAssetPath(report,
                                projectFile,
                                stringProperty(asset, "path"),
                                stringProperty(asset, "policy"),
                                propertyPath(basePath, "path"),
                                usedSidecarFiles);
            }
        }

        void verifyProjectGraph(ProjectIntegrityReport& report,
                                const juce::var& document,
                                const juce::StringArray& instrumentIds,
                                const juce::StringArray& audioFileIds,
                                const std::vector<AudioFileMetadata>& audioFileMetadata,
                                const juce::StringArray& pluginIds)
        {
            const auto projectVar = document.getProperty("project", {});
            if (projectVar.getDynamicObject() == nullptr)
            {
                addIssue(report,
                         ProjectIntegritySeverity::Error,
                         "project.missing",
                         "Document is missing project data.",
                         "project");
                return;
            }

            const auto tracksVar = projectVar.getProperty("tracks", {});
            const auto* tracks = arrayOf(tracksVar);
            if (tracks == nullptr)
            {
                addIssue(report,
                         ProjectIntegritySeverity::Error,
                         "tracks.invalid",
                         "Project tracks are missing or invalid.",
                         "project.tracks");
                return;
            }

            if (tracks->isEmpty())
            {
                addIssue(report,
                         ProjectIntegritySeverity::Error,
                         "tracks.empty",
                         "Project has no tracks.",
                         "project.tracks");
                return;
            }

            const double bpm = doubleProperty(projectVar, "bpm", 120.0);
            juce::StringArray returnBusIds;
            const auto returnBusesVar = projectVar.getProperty("returnBuses", {});
            if (const auto* returnBuses = arrayOf(returnBusesVar))
            {
                for (int busIndex = 0; busIndex < returnBuses->size(); ++busIndex)
                {
                    const auto& bus = returnBuses->getReference(busIndex);
                    const auto busPath = "project.returnBuses[" + juce::String(busIndex) + "]";
                    verifyUniqueId(report,
                                   returnBusIds,
                                   stringProperty(bus, "id"),
                                   "returnBus",
                                   busPath);
                    verifyEffectList(report,
                                     bus.getProperty("effects", {}),
                                     pluginIds,
                                     propertyPath(busPath, "effects"));
                }

                std::map<juce::String, juce::StringArray> busGraph;
                for (int busIndex = 0; busIndex < returnBuses->size(); ++busIndex)
                {
                    const auto& bus = returnBuses->getReference(busIndex);
                    const auto busId = stringProperty(bus, "id");
                    if (busId.isEmpty()) continue;
                    auto& destinations = busGraph[busId];
                    const auto outputBusId = stringProperty(bus, "outputBusId");
                    if ((bool) bus.getProperty("outputEnabled", true) && outputBusId.isNotEmpty())
                        destinations.addIfNotAlreadyThere(outputBusId);
                    if (const auto* sends = arrayOf(bus.getProperty("sends", {})))
                        for (const auto& send : *sends)
                            if ((bool) send.getProperty("enabled", true))
                                destinations.addIfNotAlreadyThere(stringProperty(send, "busId"));
                    for (const auto& destination : destinations)
                    {
                        if (destination.isEmpty()) continue;
                        if (!returnBusIds.contains(destination))
                            addIssue(report,
                                     ProjectIntegritySeverity::Warning,
                                     "audioBus.destination.missing",
                                     "Audio bus references a missing destination and will remain silent on that route: " + destination,
                                     "project.returnBuses[" + juce::String(busIndex) + "]");
                    }
                }

                std::map<juce::String, int> visitState;
                std::function<bool(const juce::String&)> visitBus = [&](const juce::String& busId) {
                    if (visitState[busId] == 1) return true;
                    if (visitState[busId] == 2) return false;
                    visitState[busId] = 1;
                    for (const auto& destination : busGraph[busId])
                        if (busGraph.find(destination) != busGraph.end() && visitBus(destination))
                            return true;
                    visitState[busId] = 2;
                    return false;
                };
                for (const auto& entry : busGraph)
                    if (visitBus(entry.first))
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Error,
                                 "audioBus.route.cycle",
                                 "Audio bus routing contains a feedback cycle. Cyclic buses will not be installed in the realtime graph.",
                                 "project.returnBuses");
                        break;
                    }
            }
            else if (!returnBusesVar.isVoid())
            {
                addIssue(report,
                         ProjectIntegritySeverity::Error,
                         "returnBuses.invalid",
                         "Project return buses are not an array.",
                         "project.returnBuses");
            }

            const auto recordingInput = projectVar.getProperty("recordingInput", {});
            if (recordingInput.isObject())
            {
                const auto inputChannelStart = doubleProperty(recordingInput, "inputChannelStart", 0.0);
                const auto inputChannelCount = doubleProperty(recordingInput, "inputChannelCount", 2.0);
                const auto calibrationSampleRate = doubleProperty(recordingInput, "calibrationSampleRate", 0.0);
                const auto measuredRoundTripSamples = doubleProperty(recordingInput, "measuredRoundTripSamples", 0.0);
                const auto reportedInputLatencySamples = doubleProperty(recordingInput, "reportedInputLatencySamples", 0.0);
                const auto reportedOutputLatencySamples = doubleProperty(recordingInput, "reportedOutputLatencySamples", 0.0);

                if (inputChannelStart < 0.0 || inputChannelCount <= 0.0)
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Warning,
                             "recording.input.channels.invalid",
                             "Recording input channel settings are invalid and will be clamped.",
                             "project.recordingInput");
                }

                if ((measuredRoundTripSamples > 0.0
                        || reportedInputLatencySamples > 0.0
                        || reportedOutputLatencySamples > 0.0)
                    && calibrationSampleRate <= 0.0)
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Warning,
                             "recording.calibration.sampleRate.missing",
                             "Recording latency calibration has sample counts but no calibration sample rate.",
                             "project.recordingInput.calibrationSampleRate");
                }

                if (measuredRoundTripSamples < 0.0
                    || reportedInputLatencySamples < 0.0
                    || reportedOutputLatencySamples < 0.0)
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Warning,
                             "recording.calibration.latency.invalid",
                             "Recording latency calibration has negative sample counts and will be clamped.",
                             "project.recordingInput");
                }
            }

            juce::StringArray trackIds;
            juce::StringArray segmentIds;
            std::vector<TrackParentRef> trackParentRefs;
            std::vector<TrackFreezeRef> trackFreezeRefs;
            for (int trackIndex = 0; trackIndex < tracks->size(); ++trackIndex)
            {
                const auto& track = tracks->getReference(trackIndex);
                const auto trackPath = "project.tracks[" + juce::String(trackIndex) + "]";
                const auto trackId = stringProperty(track, "id");
                verifyUniqueId(report, trackIds, trackId, "track", trackPath);
                const auto outputBusId = stringProperty(track, "outputBusId");
                if (outputBusId.isNotEmpty() && !returnBusIds.contains(outputBusId))
                    addIssue(report,
                             ProjectIntegritySeverity::Warning,
                             "track.output.bus.missing",
                             "Track primary output references a missing bus and will remain silent: " + outputBusId,
                             propertyPath(trackPath, "outputBusId"));
                trackParentRefs.push_back({
                    trackId,
                    stringProperty(track, "parentTrackId"),
                    trackPath,
                    trackKindIsGroup(track.getProperty("kind", {})),
                });

                const bool recordArmed = (bool) track.getProperty("recordArmed", false);
                const bool inputMonitoring = (bool) track.getProperty("inputMonitoring", false);
                if (recordArmed)
                {
                    const auto inputChannelStart = doubleProperty(track, "inputChannelStart", 0.0);
                    const auto inputChannelCount = doubleProperty(track, "inputChannelCount", 1.0);
                    if (inputChannelStart < 0.0 || inputChannelCount <= 0.0)
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Warning,
                                 "track.recording.channels.invalid",
                                 "Record-armed track has invalid input channel settings and will be clamped.",
                                 trackPath);
                    }
                }

                if (inputMonitoring && !recordArmed)
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Info,
                             "track.monitoring.unarmed",
                             "Track input monitoring is enabled but the track is not record-armed.",
                             propertyPath(trackPath, "inputMonitoring"));
                }

                const auto trackInstrumentId = stringProperty(track, "instrumentId");
                if (trackInstrumentId.isNotEmpty() && !instrumentIds.contains(trackInstrumentId))
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Warning,
                             "track.instrument.missing",
                             "Track references an instrument not stored in this document: " + trackInstrumentId,
                             propertyPath(trackPath, "instrumentId"));
                }

                const auto freezeSourceVar = track.getProperty("freezeSource", {});
                if (freezeSourceVar.isObject())
                {
                    const auto freezePath = propertyPath(trackPath, "freezeSource");
                    const auto sourceTrackId = stringProperty(freezeSourceVar, "sourceTrackId");
                    const auto freezeAudioFileId = stringProperty(freezeSourceVar, "audioFileId");
                    const auto freezeSegmentId = stringProperty(freezeSourceVar, "segmentId");
                    trackFreezeRefs.push_back({
                        trackId,
                        sourceTrackId,
                        freezeAudioFileId,
                        freezeSegmentId,
                        freezePath,
                        stringProperty(track, "audioFileId"),
                    });

                    if (sourceTrackId.isEmpty())
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Error,
                                 "track.freezeSource.source.empty",
                                 "Frozen bounce metadata has no source track target.",
                                 propertyPath(freezePath, "sourceTrackId"));
                    }
                    else if (sourceTrackId == trackId)
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Error,
                                 "track.freezeSource.source.self",
                                 "Frozen bounce metadata points back to the bounced track.",
                                 propertyPath(freezePath, "sourceTrackId"));
                    }

                    if (freezeAudioFileId.isEmpty())
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Error,
                                 "track.freezeSource.audio.empty",
                                 "Frozen bounce metadata has no rendered audio asset.",
                                 propertyPath(freezePath, "audioFileId"));
                    }
                    else if (stringProperty(track, "audioFileId").isNotEmpty()
                             && freezeAudioFileId != stringProperty(track, "audioFileId"))
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Warning,
                                 "track.freezeSource.audio.mismatch",
                                 "Frozen bounce metadata audio does not match the bounced track audio.",
                                 propertyPath(freezePath, "audioFileId"));
                    }
                }
                else if (!freezeSourceVar.isVoid())
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Error,
                             "track.freezeSource.invalid",
                             "Track freeze metadata is not an object.",
                             propertyPath(trackPath, "freezeSource"));
                }

                const auto sendsVar = track.getProperty("sends", {});
                if (const auto* sends = arrayOf(sendsVar))
                {
                    juce::StringArray sendBusIds;
                    for (int sendIndex = 0; sendIndex < sends->size(); ++sendIndex)
                    {
                        const auto& send = sends->getReference(sendIndex);
                        const auto sendPath = propertyPath(trackPath, "sends[" + juce::String(sendIndex) + "]");
                        const auto busId = stringProperty(send, "busId");
                        if (busId.isEmpty())
                        {
                            addIssue(report,
                                     ProjectIntegritySeverity::Error,
                                     "track.send.bus.empty",
                                     "Track send has no return bus target.",
                                     propertyPath(sendPath, "busId"));
                        }
                        else if (!returnBusIds.contains(busId))
                        {
                            addIssue(report,
                                     ProjectIntegritySeverity::Warning,
                                     "track.send.bus.missing",
                                     "Track send references a missing return bus: " + busId,
                                     propertyPath(sendPath, "busId"));
                        }
                        else if (sendBusIds.contains(busId))
                        {
                            addIssue(report,
                                     ProjectIntegritySeverity::Warning,
                                     "track.send.bus.duplicate",
                                     "Track has multiple sends to the same return bus: " + busId,
                                     sendPath);
                        }
                        sendBusIds.addIfNotAlreadyThere(busId);

                        if (doubleProperty(send, "gainDb", -96.0) < -120.0 || doubleProperty(send, "gainDb", -96.0) > 24.0)
                        {
                            addIssue(report,
                                     ProjectIntegritySeverity::Warning,
                                     "track.send.gain.invalid",
                                     "Track send gain is outside the supported range and will be clamped.",
                                     propertyPath(sendPath, "gainDb"));
                        }

                        if (doubleProperty(send, "pan", 0.0) < -1.0 || doubleProperty(send, "pan", 0.0) > 1.0)
                        {
                            addIssue(report,
                                     ProjectIntegritySeverity::Warning,
                                     "track.send.pan.invalid",
                                     "Track send pan is outside the supported range and will be clamped.",
                                     propertyPath(sendPath, "pan"));
                        }
                    }
                }
                else if (!sendsVar.isVoid())
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Error,
                             "track.sends.invalid",
                             "Track sends are not an array.",
                             propertyPath(trackPath, "sends"));
                }

                const auto effectsVar = track.getProperty("effects", {});
                const auto filtersVar = effectsVar.getProperty("filters", {});
                if (const auto* filters = arrayOf(filtersVar))
                {
                    juce::StringArray effectIds;
                    for (int effectIndex = 0; effectIndex < filters->size(); ++effectIndex)
                    {
                        const auto& effect = filters->getReference(effectIndex);
                        const auto effectPath = propertyPath(trackPath, "effects.filters[" + juce::String(effectIndex) + "]");
                        verifyUniqueId(report, effectIds, stringProperty(effect, "id"), "effect", effectPath);

                        const auto pluginId = stringProperty(effect, "pluginId");
                        if (pluginId.isNotEmpty() && !pluginIds.contains(pluginId))
                        {
                            addIssue(report,
                                     ProjectIntegritySeverity::Warning,
                                     "effect.plugin.missing",
                                     "Effect references a plugin not stored in this document: " + pluginId,
                                     propertyPath(effectPath, "pluginId"));
                        }
                    }
                }

                const auto segmentsVar = track.getProperty("segments", {});
                const auto* segments = arrayOf(segmentsVar);
                if (segments == nullptr)
                    continue;

                for (int segmentIndex = 0; segmentIndex < segments->size(); ++segmentIndex)
                {
                    const auto& segment = segments->getReference(segmentIndex);
                    const auto segmentPath = propertyPath(trackPath, "segments[" + juce::String(segmentIndex) + "]");
                    verifyUniqueId(report, segmentIds, stringProperty(segment, "id"), "segment", segmentPath);

                    const auto segmentTrackId = stringProperty(segment, "trackId");
                    if (segmentTrackId != trackId)
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Error,
                                 "segment.trackId.mismatch",
                                 "Segment trackId does not match its containing track.",
                                 propertyPath(segmentPath, "trackId"));
                    }

                    if (doubleProperty(segment, "startBeat") < 0.0)
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Error,
                                 "segment.start.invalid",
                                 "Segment starts before the project timeline.",
                                 propertyPath(segmentPath, "startBeat"));
                    }

                    if (doubleProperty(segment, "lengthBeats") <= 0.0)
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Error,
                                 "segment.length.invalid",
                                 "Segment length must be positive.",
                                 propertyPath(segmentPath, "lengthBeats"));
                    }

                    const auto payload = segment.getProperty("payload", {});
                    const auto payloadKind = stringProperty(payload, "kind");
                    const auto payloadAudioFileId = stringProperty(payload, "audioFileId");

                    const auto lengthBeats = doubleProperty(segment, "lengthBeats");
                    const auto sourceStartBeat = doubleProperty(segment, "sourceStartBeat", doubleProperty(payload, "sourceStartBeat", 0.0));
                    const auto fadeInBeats = doubleProperty(segment, "fadeInBeats", doubleProperty(payload, "fadeInBeats", 0.0));
                    const auto fadeOutBeats = doubleProperty(segment, "fadeOutBeats", doubleProperty(payload, "fadeOutBeats", 0.0));

                    if (sourceStartBeat < 0.0)
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Error,
                                 "segment.audio.sourceStart.invalid",
                                 "Segment source start must not be negative.",
                                 propertyPath(segmentPath, "sourceStartBeat"));
                    }

                    if (fadeInBeats < 0.0 || fadeOutBeats < 0.0)
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Error,
                                 "segment.fade.invalid",
                                 "Segment fades must not be negative.",
                                 propertyPath(segmentPath, "fadeInBeats"));
                    }
                    else if (lengthBeats > 0.0 && fadeInBeats + fadeOutBeats > lengthBeats + 0.000001)
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Warning,
                                 "segment.fade.exceedsLength",
                                 "Segment fade lengths exceed the segment length and will be clamped.",
                                 segmentPath);
                    }

                    const auto segmentInstrumentId = stringProperty(segment, "instrumentId");
                    if (segmentInstrumentId.isNotEmpty() && !instrumentIds.contains(segmentInstrumentId))
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Warning,
                                 "segment.instrument.missing",
                                 "Segment references an instrument not stored in this document: " + segmentInstrumentId,
                                 propertyPath(segmentPath, "instrumentId"));
                    }

                    if ((payloadKind == "audio" || payloadKind == "mixed")
                        && !audioFileIds.contains(payloadAudioFileId))
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Error,
                                 "segment.audioFile.missing",
                                 "Segment references an audio file not stored in this document.",
                                 propertyPath(segmentPath, "payload.audioFileId"));
                    }
                    else if ((payloadKind == "audio" || payloadKind == "mixed")
                             && bpm > 0.0
                             && lengthBeats > 0.0
                             && sourceStartBeat >= 0.0)
                    {
                        if (const auto* audioMetadata = findAudioFileMetadata(audioFileMetadata, payloadAudioFileId);
                            audioMetadata != nullptr && audioMetadata->hasDuration && audioMetadata->durationSeconds > 0.0)
                        {
                            const double audioLengthBeats = audioMetadata->durationSeconds * bpm / 60.0;
                            if (sourceStartBeat >= audioLengthBeats)
                            {
                                addIssue(report,
                                         ProjectIntegritySeverity::Error,
                                         "segment.audio.sourceStart.outOfRange",
                                         "Segment source start is beyond the referenced audio file.",
                                         propertyPath(segmentPath, "sourceStartBeat"));
                            }
                            else if (sourceStartBeat + lengthBeats > audioLengthBeats + 0.000001)
                            {
                                addIssue(report,
                                         ProjectIntegritySeverity::Warning,
                                         "segment.audio.trim.exceedsSource",
                                         "Segment extends beyond the referenced audio file and will render silence after the source ends.",
                                         segmentPath);
                            }
                        }
                    }

                    if (payloadKind == "drum")
                    {
                        const auto rowsVar = payload.getProperty("rows", {});
                        if (const auto* rows = arrayOf(rowsVar))
                        {
                            for (int rowIndex = 0; rowIndex < rows->size(); ++rowIndex)
                            {
                                const auto rowInstrumentId = stringProperty(rows->getReference(rowIndex), "instrumentId");
                                if (rowInstrumentId.isNotEmpty() && !instrumentIds.contains(rowInstrumentId))
                                {
                                    addIssue(report,
                                             ProjectIntegritySeverity::Warning,
                                             "drumRow.instrument.missing",
                                             "Drum row references an instrument not stored in this document: " + rowInstrumentId,
                                             propertyPath(segmentPath, "payload.rows[" + juce::String(rowIndex) + "].instrumentId"));
                                }
                            }
                        }
                    }
                }
            }

            std::map<juce::String, TrackParentRef> tracksById;
            for (const auto& trackRef : trackParentRefs)
            {
                if (trackRef.id.isNotEmpty() && tracksById.find(trackRef.id) == tracksById.end())
                    tracksById.emplace(trackRef.id, trackRef);
            }

            for (const auto& freezeRef : trackFreezeRefs)
            {
                if (freezeRef.sourceTrackId.isNotEmpty()
                    && tracksById.find(freezeRef.sourceTrackId) == tracksById.end())
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Error,
                             "track.freezeSource.source.missing",
                             "Frozen bounce source track is missing: " + freezeRef.sourceTrackId,
                             propertyPath(freezeRef.path, "sourceTrackId"));
                }

                if (freezeRef.audioFileId.isNotEmpty() && !audioFileIds.contains(freezeRef.audioFileId))
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Error,
                             "track.freezeSource.audio.missing",
                             "Frozen bounce audio asset is missing: " + freezeRef.audioFileId,
                             propertyPath(freezeRef.path, "audioFileId"));
                }

                if (freezeRef.segmentId.isNotEmpty() && !segmentIds.contains(freezeRef.segmentId))
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Warning,
                             "track.freezeSource.segment.missing",
                             "Frozen bounce segment metadata points to a missing segment: " + freezeRef.segmentId,
                             propertyPath(freezeRef.path, "segmentId"));
                }
            }

            for (const auto& trackRef : trackParentRefs)
            {
                if (trackRef.parentId.isEmpty())
                    continue;

                if (trackRef.parentId == trackRef.id)
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Error,
                             "track.parent.self",
                             "Track cannot route into itself as a parent group.",
                             propertyPath(trackRef.path, "parentTrackId"));
                    continue;
                }

                const auto parent = tracksById.find(trackRef.parentId);
                if (parent == tracksById.end())
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Error,
                             "track.parent.missing",
                             "Track references a missing parent group: " + trackRef.parentId,
                             propertyPath(trackRef.path, "parentTrackId"));
                    continue;
                }

                if (!parent->second.group)
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Error,
                             "track.parent.notGroup",
                             "Track parent is not a group track: " + trackRef.parentId,
                             propertyPath(trackRef.path, "parentTrackId"));
                    continue;
                }

                std::set<juce::String> seen;
                auto cursor = trackRef.parentId;
                while (cursor.isNotEmpty())
                {
                    if (cursor == trackRef.id || seen.find(cursor) != seen.end())
                    {
                        addIssue(report,
                                 ProjectIntegritySeverity::Error,
                                 "track.parent.cycle",
                                 "Track parent routing contains a cycle.",
                                 propertyPath(trackRef.path, "parentTrackId"));
                        break;
                    }

                    seen.insert(cursor);
                    const auto next = tracksById.find(cursor);
                    if (next == tracksById.end())
                        break;
                    cursor = next->second.parentId;
                }
            }
        }

        void verifySidecarOrphans(ProjectIntegrityReport& report,
                                  const juce::File& projectFile,
                                  const juce::StringArray& usedSidecarFiles)
        {
            const auto sidecarRoot = projectSidecarFolderFor(projectFile);
            if (!sidecarRoot.isDirectory())
                return;

            juce::Array<juce::File> sidecarFiles;
            sidecarRoot.findChildFiles(sidecarFiles, juce::File::findFiles, true);

            for (const auto& file : sidecarFiles)
            {
                const auto path = file.getFullPathName();
                if (!usedSidecarFiles.contains(path))
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Warning,
                             "asset.sidecar.orphan",
                             "Project sidecar contains an unused asset: " + file.getFileName(),
                             path);
                }
            }
        }
    }

    juce::var ProjectIntegrityIssue::toVar() const
    {
        juce::DynamicObject::Ptr object = new juce::DynamicObject();
        object->setProperty("severity", severityToString(severity));
        object->setProperty("code", code);
        object->setProperty("message", message);
        object->setProperty("path", path);
        return juce::var(object.get());
    }

    int ProjectIntegrityReport::errorCount() const
    {
        int count = 0;
        for (const auto& issue : issues)
            if (issue.severity == ProjectIntegritySeverity::Error)
                ++count;
        return count;
    }

    int ProjectIntegrityReport::warningCount() const
    {
        int count = 0;
        for (const auto& issue : issues)
            if (issue.severity == ProjectIntegritySeverity::Warning)
                ++count;
        return count;
    }

    bool ProjectIntegrityReport::ok() const
    {
        return errorCount() == 0;
    }

    juce::var ProjectIntegrityReport::toVar() const
    {
        juce::Array<juce::var> issueVars;
        for (const auto& issue : issues)
            issueVars.add(issue.toVar());

        juce::DynamicObject::Ptr object = new juce::DynamicObject();
        object->setProperty("ok", ok());
        object->setProperty("errorCount", errorCount());
        object->setProperty("warningCount", warningCount());
        object->setProperty("issues", issueVars);
        return juce::var(object.get());
    }

    bool hasFatalProjectDocumentIntegrityErrors(const ProjectIntegrityReport& report) noexcept
    {
        for (const auto& issue : report.issues)
        {
            if (issue.severity != ProjectIntegritySeverity::Error)
                continue;

            // Missing media can be shown to the user for relinking; structural graph/schema
            // errors should not hydrate into the editor.
            if (issue.code == "asset.missing")
                continue;

            return true;
        }

        return false;
    }

    bool repairProjectDocumentSegmentTrackIds(juce::var& document)
    {
        auto project = document.getProperty("project", {});
        if (!project.isObject())
            return false;

        auto tracks = project.getProperty("tracks", {});
        auto* trackArray = tracks.getArray();
        if (trackArray == nullptr)
            return false;

        bool changed = false;
        for (auto& track : *trackArray)
        {
            const auto trackId = track.getProperty("id", {}).toString();
            if (trackId.isEmpty())
                continue;

            auto segments = track.getProperty("segments", {});
            auto* segmentArray = segments.getArray();
            if (segmentArray == nullptr)
                continue;

            for (auto& segment : *segmentArray)
            {
                auto* object = segment.getDynamicObject();
                if (object == nullptr)
                    continue;

                if (segment.getProperty("trackId", {}).toString() != trackId)
                {
                    object->setProperty("trackId", trackId);
                    changed = true;
                }
            }
        }
        return changed;
    }

    ProjectIntegrityReport verifyProjectDocumentIntegrity(const juce::var& document,
                                                          const juce::File& projectFile)
    {
        ProjectIntegrityReport report;
        if (document.getDynamicObject() == nullptr)
        {
            addIssue(report,
                     ProjectIntegritySeverity::Error,
                     "document.invalid",
                     "Project document is not an object.",
                     {});
            return report;
        }

        const auto schemaVersion = static_cast<int>(doubleProperty(document, "schemaVersion", 0.0));
        if (schemaVersion != supportedSchemaVersion)
        {
            addIssue(report,
                     ProjectIntegritySeverity::Error,
                     "schema.unsupported",
                     "Project schema is unsupported: " + juce::String(schemaVersion),
                     "schemaVersion");
        }

        juce::StringArray usedSidecarFiles;
        juce::StringArray instrumentIds;
        juce::StringArray audioFileIds;
        std::vector<AudioFileMetadata> audioFileMetadata;
        juce::StringArray pluginIds;
        collectIds(document.getProperty("plugins", {}), pluginIds);

        const auto instrumentsVar = document.getProperty("instruments", {});
        if (const auto* instruments = arrayOf(instrumentsVar))
        {
            for (int i = 0; i < instruments->size(); ++i)
            {
                const auto& instrument = instruments->getReference(i);
                verifyUniqueId(report,
                               instrumentIds,
                               stringProperty(instrument, "id"),
                               "instrument",
                               "instruments[" + juce::String(i) + "]");
                verifyInstrumentAssets(report, projectFile, instrument, i, usedSidecarFiles);
                verifyEffectList(report,
                                 instrument.getProperty("effects", {}),
                                 pluginIds,
                                 "instruments[" + juce::String(i) + "].effects");
            }
        }
        else if (!instrumentsVar.isVoid())
        {
            addIssue(report,
                     ProjectIntegritySeverity::Error,
                     "instruments.invalid",
                     "Document instruments are not an array.",
                     "instruments");
        }

        verifyPluginAdapters(report,
                             document.getProperty("plugins", {}),
                             instrumentIds);

        const auto audioFilesVar = document.getProperty("audioFiles", {});
        if (const auto* audioFiles = arrayOf(audioFilesVar))
        {
            for (int i = 0; i < audioFiles->size(); ++i)
            {
                const auto& audioFile = audioFiles->getReference(i);
                const auto basePath = "audioFiles[" + juce::String(i) + "]";
                const auto audioFileId = stringProperty(audioFile, "id");
                verifyUniqueId(report, audioFileIds, audioFileId, "audioFile", basePath);
                verifyAssetPath(report,
                                projectFile,
                                stringProperty(audioFile, "path"),
                                {},
                                propertyPath(basePath, "path"),
                                usedSidecarFiles);

                AudioFileMetadata metadata;
                metadata.id = audioFileId;
                metadata.hasDuration = hasProperty(audioFile, "durationSeconds");
                metadata.durationSeconds = doubleProperty(audioFile, "durationSeconds", 0.0);
                if (metadata.hasDuration && metadata.durationSeconds <= 0.0)
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Warning,
                             "audioFile.duration.invalid",
                             "Audio file duration is missing or invalid.",
                             propertyPath(basePath, "durationSeconds"));
                }

                if (hasProperty(audioFile, "sampleRate") && doubleProperty(audioFile, "sampleRate", 0.0) <= 0.0)
                {
                    addIssue(report,
                             ProjectIntegritySeverity::Warning,
                             "audioFile.sampleRate.invalid",
                             "Audio file sample rate is missing or invalid.",
                             propertyPath(basePath, "sampleRate"));
                }
                audioFileMetadata.push_back(std::move(metadata));
            }
        }
        else if (!audioFilesVar.isVoid())
        {
            addIssue(report,
                     ProjectIntegritySeverity::Error,
                     "audioFiles.invalid",
                     "Document audioFiles are not an array.",
                     "audioFiles");
        }

        verifyManifestAssets(report, projectFile, document.getProperty("assets", {}), usedSidecarFiles);
        verifyProjectGraph(report, document, instrumentIds, audioFileIds, audioFileMetadata, pluginIds);
        verifySidecarOrphans(report, projectFile, usedSidecarFiles);
        return report;
    }
}

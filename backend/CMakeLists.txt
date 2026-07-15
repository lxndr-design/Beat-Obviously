juce_add_gui_app(Beat
    PRODUCT_NAME "Beat"
    COMPANY_NAME "Beat"
    BUNDLE_ID com.beat.app
    VERSION ${BEAT_VERSION}
    ICON_BIG "${CMAKE_CURRENT_SOURCE_DIR}/Assets/BeatIcon.png"
    ICON_SMALL "${CMAKE_CURRENT_SOURCE_DIR}/Assets/BeatIcon.png"
    NEEDS_WEB_BROWSER TRUE
)

juce_generate_juce_header(Beat)

find_package(SQLite3 REQUIRED)

target_sources(Beat PRIVATE
    Source/Main.cpp
    Source/MainComponent.cpp
    Source/MainComponent.h

    Source/Audio/AudioEngine.cpp
    Source/Audio/AudioEngine.h
    Source/Audio/AudioQuality.h
    Source/Audio/BeatSynthesiser.cpp
    Source/Audio/BeatSynthesiser.h
    Source/Audio/Sequencer.cpp
    Source/Audio/Sequencer.h
    Source/Audio/TrackModel.cpp
    Source/Audio/TrackModel.h
    Source/Audio/Transitions/VoiceTransition.h
    Source/Audio/VoiceAllocation.h
    Source/Audio/Envelope/EnvelopeShaper.h
    Source/Audio/InstrumentVoice.cpp
    Source/Audio/InstrumentVoice.h
    Source/Audio/Nodemap/NodemapGraph.cpp
    Source/Audio/Nodemap/NodemapGraph.h
    Source/Audio/Filter/DriveStage.h
    Source/Audio/Filter/FilterMath.h
    Source/Audio/Filter/FilterStage.h
    Source/Audio/Modulation/DynamicModulation.h
    Source/Audio/Modulation/Lfo.h
    Source/Audio/Oscillator/AetherTableStackRenderer.h
    Source/Audio/Oscillator/AetherSourceBusContext.h
    Source/Audio/Oscillator/BasicOscillator.h
    Source/Audio/Oscillator/VoiceAetherCache.h
    Source/Audio/Oscillator/VoiceMath.h
    Source/Audio/Oscillator/VoiceRenderStats.cpp
    Source/Audio/Oscillator/VoiceRenderStats.h
    Source/Audio/Oscillator/VoiceStats.h
    Source/Audio/Analysis/FftAnalyzer.cpp
    Source/Audio/Analysis/FftAnalyzer.h
    Source/Audio/Analysis/AudioFileAnalyzer.cpp
    Source/Audio/Analysis/AudioFileAnalyzer.h
    Source/Audio/Parameters/ParameterIds.h
    Source/Audio/Parameters/ParameterPolicy.h
    Source/Audio/Parameters/SynthPatchContract.cpp
    Source/Audio/Parameters/SynthPatchContract.h
    Source/Audio/Realtime/FixedObjectPool.h
    Source/Audio/Realtime/RealtimeParameterQueue.h
    Source/Audio/Realtime/RenderBudgets.h
    Source/Audio/Realtime/RealtimeRamp.h
    Source/Audio/Realtime/SpscRingBuffer.h
    Source/Audio/Realtime/VoiceAutomationInbox.cpp
    Source/Audio/Realtime/VoiceAutomationInbox.h
    Source/Audio/Realtime/VoiceNoteAutomation.h
    Source/Audio/Realtime/VoiceNoteAutomationState.h
    Source/Audio/Realtime/VoiceRealtimeRampState.h
    Source/Audio/Realtime/VoiceRealtimeParams.h
    Source/Audio/Recording/RecordingCalibration.cpp
    Source/Audio/Recording/RecordingCalibration.h
    Source/Audio/Recording/RecordingCapture.cpp
    Source/Audio/Recording/RecordingCapture.h
    Source/Audio/Recording/RecordingPlanner.cpp
    Source/Audio/Recording/RecordingPlanner.h
    Source/Audio/Recording/RecordingSessionPlanner.cpp
    Source/Audio/Recording/RecordingSessionPlanner.h
    Source/Audio/Rendering/TrackBouncePlanner.cpp
    Source/Audio/Rendering/TrackBouncePlanner.h
    Source/Audio/Sampler/DecentSamplerImporter.cpp
    Source/Audio/Sampler/DecentSamplerImporter.h
    Source/Audio/Sampler/SfzSubsetImporter.cpp
    Source/Audio/Sampler/SfzSubsetImporter.h
    Source/Audio/Sources/BoundedSamplePageCache.h
    Source/Audio/Sources/SampleStreamingSession.cpp
    Source/Audio/Sources/SampleStreamingSession.h
    Source/Audio/Sources/SampleSourceSlot.h
    Source/Audio/Sources/SourceSlot.h
    Source/Audio/Sources/SourceSlotRack.h
    Source/Audio/Wavetable/Wavetable.cpp
    Source/Audio/Wavetable/Wavetable.h
    Source/Audio/Wavetable/WavetableFactory.cpp
    Source/Audio/Wavetable/WavetableFactory.h
    Source/Audio/Wavetable/WavetableOscillator.cpp
    Source/Audio/Wavetable/WavetableOscillator.h
    Source/Audio/Wavetable/WavetableOscillatorBank.h
    Source/Audio/Wavetable/WavetableUnisonPlan.h
    Source/Audio/Wavetable/WavetableVoiceCache.cpp
    Source/Audio/Wavetable/WavetableVoiceCache.h
    Source/Audio/Effects/Bitcrush.cpp
    Source/Audio/Effects/Bitcrush.h
    Source/Audio/Effects/MasterEq.cpp
    Source/Audio/Effects/MasterEq.h
    Source/Audio/Effects/MasterLimiter.cpp
    Source/Audio/Effects/MasterLimiter.h
    Source/Audio/Effects/MasterDcBlocker.h
    Source/Audio/Effects/TrackEffectDefaults.cpp
    Source/Audio/Effects/TrackEffectDefaults.h

    Source/Persistence/Database.cpp
    Source/Persistence/Database.h
    Source/Persistence/AudioFileLibraryActions.cpp
    Source/Persistence/AudioFileLibraryActions.h
    Source/Persistence/ProjectRepository.cpp
    Source/Persistence/ProjectRepository.h
    Source/Persistence/InstrumentRepository.cpp
    Source/Persistence/InstrumentRepository.h
    Source/Persistence/ProjectAssetPackage.cpp
    Source/Persistence/ProjectAssetPackage.h
    Source/Persistence/ProjectDocumentBackup.cpp
    Source/Persistence/ProjectDocumentBackup.h
    Source/Persistence/ProjectIntegrityVerifier.cpp
    Source/Persistence/ProjectIntegrityVerifier.h

    Source/Ipc/MessageBridge.cpp
    Source/Ipc/MessageBridge.h
    Source/Ipc/Schema.h
)

target_compile_definitions(Beat PRIVATE
    JUCE_WEB_BROWSER=1
    JUCE_MODAL_LOOPS_PERMITTED=1
    JUCE_USE_CURL=1
    JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:Beat,JUCE_PRODUCT_NAME>"
    JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:Beat,JUCE_VERSION>"
)

if(APPLE)
    add_custom_command(TARGET Beat POST_BUILD
        COMMAND "${CMAKE_CURRENT_SOURCE_DIR}/../scripts/register-beat-document-type.sh"
                "$<TARGET_BUNDLE_DIR:Beat>/Contents/Info.plist"
        COMMENT "Registering Beat .beat document type in app bundle"
        VERBATIM
    )
endif()

target_link_libraries(Beat PRIVATE
    juce::juce_audio_basics
    juce::juce_audio_devices
    juce::juce_audio_formats
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_core
    juce::juce_data_structures
    juce::juce_dsp
    juce::juce_events
    juce::juce_graphics
    juce::juce_gui_basics
    juce::juce_gui_extra
    juce::juce_opengl
    SQLite3::SQLite3
)

target_compile_features(Beat PRIVATE cxx_std_20)

add_executable(BeatBackendStress
    Tests/RealtimeSafetyProbe.cpp
    Tests/RealtimeSafetyProbe.h
    Tests/BackendStress.cpp
    Source/Audio/AudioEngine.cpp
    Source/Audio/AudioEngine.h
    Source/Audio/AudioQuality.h
    Source/Audio/BeatSynthesiser.cpp
    Source/Audio/BeatSynthesiser.h
    Source/Audio/Effects/Bitcrush.cpp
    Source/Audio/Effects/Bitcrush.h
    Source/Audio/Effects/MasterEq.cpp
    Source/Audio/Effects/MasterEq.h
    Source/Audio/Effects/MasterLimiter.cpp
    Source/Audio/Effects/MasterLimiter.h
    Source/Audio/Effects/MasterDcBlocker.h
    Source/Audio/Effects/TrackEffectDefaults.cpp
    Source/Audio/Effects/TrackEffectDefaults.h
    Source/Audio/InstrumentVoice.cpp
    Source/Audio/InstrumentVoice.h
    Source/Audio/Nodemap/NodemapGraph.cpp
    Source/Audio/Nodemap/NodemapGraph.h
    Source/Audio/Filter/DriveStage.h
    Source/Audio/Filter/FilterMath.h
    Source/Audio/Filter/FilterStage.h
    Source/Audio/Modulation/DynamicModulation.h
    Source/Audio/Modulation/Lfo.h
    Source/Audio/Oscillator/AetherTableStackRenderer.h
    Source/Audio/Oscillator/AetherSourceBusContext.h
    Source/Audio/Oscillator/BasicOscillator.h
    Source/Audio/Oscillator/VoiceAetherCache.h
    Source/Audio/Oscillator/VoiceMath.h
    Source/Audio/Oscillator/VoiceRenderStats.cpp
    Source/Audio/Oscillator/VoiceRenderStats.h
    Source/Audio/Oscillator/VoiceStats.h
    Source/Audio/Sequencer.cpp
    Source/Audio/Sequencer.h
    Source/Audio/TrackModel.cpp
    Source/Audio/TrackModel.h
    Source/Audio/Transitions/VoiceTransition.h
    Source/Audio/VoiceAllocation.h
    Source/Audio/Envelope/EnvelopeShaper.h
    Source/Audio/Analysis/FftAnalyzer.cpp
    Source/Audio/Analysis/FftAnalyzer.h
    Source/Audio/Analysis/AudioFileAnalyzer.cpp
    Source/Audio/Analysis/AudioFileAnalyzer.h
    Source/Audio/Parameters/ParameterIds.h
    Source/Audio/Parameters/ParameterPolicy.h
    Source/Audio/Parameters/SynthPatchContract.cpp
    Source/Audio/Parameters/SynthPatchContract.h
    Source/Audio/Realtime/FixedObjectPool.h
    Source/Audio/Realtime/RealtimeParameterQueue.h
    Source/Audio/Realtime/RenderBudgets.h
    Source/Audio/Realtime/RealtimeRamp.h
    Source/Audio/Realtime/SpscRingBuffer.h
    Source/Audio/Realtime/VoiceAutomationInbox.cpp
    Source/Audio/Realtime/VoiceAutomationInbox.h
    Source/Audio/Realtime/VoiceNoteAutomation.h
    Source/Audio/Realtime/VoiceNoteAutomationState.h
    Source/Audio/Realtime/VoiceRealtimeRampState.h
    Source/Audio/Realtime/VoiceRealtimeParams.h
    Source/Audio/Recording/RecordingCalibration.cpp
    Source/Audio/Recording/RecordingCalibration.h
    Source/Audio/Recording/RecordingCapture.cpp
    Source/Audio/Recording/RecordingCapture.h
    Source/Audio/Recording/RecordingPlanner.cpp
    Source/Audio/Recording/RecordingPlanner.h
    Source/Audio/Recording/RecordingSessionPlanner.cpp
    Source/Audio/Recording/RecordingSessionPlanner.h
    Source/Audio/Rendering/TrackBouncePlanner.cpp
    Source/Audio/Rendering/TrackBouncePlanner.h
    Source/Audio/Sampler/DecentSamplerImporter.cpp
    Source/Audio/Sampler/DecentSamplerImporter.h
    Source/Audio/Sampler/SfzSubsetImporter.cpp
    Source/Audio/Sampler/SfzSubsetImporter.h
    Source/Audio/Sources/BoundedSamplePageCache.h
    Source/Audio/Sources/SampleStreamingSession.cpp
    Source/Audio/Sources/SampleStreamingSession.h
    Source/Audio/Sources/SampleSourceSlot.h
    Source/Audio/Sources/SourceSlot.h
    Source/Audio/Sources/SourceSlotRack.h
    Source/Audio/Wavetable/Wavetable.cpp
    Source/Audio/Wavetable/Wavetable.h
    Source/Audio/Wavetable/WavetableFactory.cpp
    Source/Audio/Wavetable/WavetableFactory.h
    Source/Audio/Wavetable/WavetableOscillator.cpp
    Source/Audio/Wavetable/WavetableOscillator.h
    Source/Audio/Wavetable/WavetableOscillatorBank.h
    Source/Audio/Wavetable/WavetableUnisonPlan.h
    Source/Audio/Wavetable/WavetableVoiceCache.cpp
    Source/Audio/Wavetable/WavetableVoiceCache.h
    Source/Persistence/ProjectAssetPackage.cpp
    Source/Persistence/ProjectAssetPackage.h
    Source/Persistence/ProjectDocumentBackup.cpp
    Source/Persistence/ProjectDocumentBackup.h
    Source/Persistence/ProjectIntegrityVerifier.cpp
    Source/Persistence/ProjectIntegrityVerifier.h
    Source/Persistence/Database.cpp
    Source/Persistence/Database.h
    Source/Persistence/AudioFileLibraryActions.cpp
    Source/Persistence/AudioFileLibraryActions.h
    Source/Persistence/ProjectRepository.cpp
    Source/Persistence/ProjectRepository.h
)

target_link_libraries(BeatBackendStress PRIVATE
    juce::juce_audio_basics
    juce::juce_audio_devices
    juce::juce_audio_formats
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_core
    juce::juce_dsp
    juce::juce_events
    SQLite3::SQLite3
)

target_compile_features(BeatBackendStress PRIVATE cxx_std_20)
target_compile_definitions(BeatBackendStress PRIVATE BEAT_REALTIME_SAFETY_TESTING=1)

add_executable(BeatAetherBaseline
    Tests/AetherBaseline.cpp
    Source/Audio/Wavetable/Wavetable.cpp
    Source/Audio/Wavetable/WavetableFactory.cpp
    Source/Audio/Wavetable/WavetableOscillator.cpp
)

target_link_libraries(BeatAetherBaseline PRIVATE
    juce::juce_audio_basics
    juce::juce_audio_formats
    juce::juce_core
    juce::juce_dsp
)

target_compile_features(BeatAetherBaseline PRIVATE cxx_std_20)

# In Release builds, copy the frontend dist/ into the app bundle and serve it
# with WebBrowserComponent::Options::withResourceProvider().
if(CMAKE_BUILD_TYPE STREQUAL "Release" AND BEAT_BUILD_FRONTEND)
    add_dependencies(Beat beat_frontend_build)

    if(APPLE)
        set(BEAT_FRONTEND_RESOURCE_DIR "$<TARGET_BUNDLE_CONTENT_DIR:Beat>/Resources/frontend")
    else()
        set(BEAT_FRONTEND_RESOURCE_DIR "$<TARGET_FILE_DIR:Beat>/frontend")
    endif()

    add_custom_command(TARGET Beat POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E remove_directory
            "${BEAT_FRONTEND_RESOURCE_DIR}"
        COMMAND ${CMAKE_COMMAND} -E make_directory
            "${BEAT_FRONTEND_RESOURCE_DIR}"
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${CMAKE_SOURCE_DIR}/frontend/dist"
            "${BEAT_FRONTEND_RESOURCE_DIR}"
        COMMENT "Refreshing Solid frontend in app bundle"
        VERBATIM
    )
endif()

if(APPLE)
    add_custom_command(TARGET Beat POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${CMAKE_CURRENT_SOURCE_DIR}/Assets/BeatIcon.icns"
            "$<TARGET_BUNDLE_CONTENT_DIR:Beat>/Resources/Icon.icns"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${CMAKE_CURRENT_SOURCE_DIR}/Assets/BeatIcon.png"
            "$<TARGET_BUNDLE_CONTENT_DIR:Beat>/Resources/BeatIcon.png"
        COMMAND "${CMAKE_SOURCE_DIR}/scripts/register-beat-document-type.sh"
            "$<TARGET_BUNDLE_CONTENT_DIR:Beat>/Info.plist"
        COMMENT "Copying Beat app icon and registering Beat document type"
        VERBATIM
    )
endif()

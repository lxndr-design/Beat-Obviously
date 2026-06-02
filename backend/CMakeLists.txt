juce_add_gui_app(Beat
    PRODUCT_NAME "Beat"
    COMPANY_NAME "Beat"
    BUNDLE_ID com.beat.app
    VERSION 0.1.0
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
    Source/Audio/Sequencer.cpp
    Source/Audio/Sequencer.h
    Source/Audio/TrackModel.cpp
    Source/Audio/TrackModel.h
    Source/Audio/InstrumentVoice.cpp
    Source/Audio/InstrumentVoice.h
    Source/Audio/Analysis/FftAnalyzer.cpp
    Source/Audio/Analysis/FftAnalyzer.h
    Source/Audio/Parameters/ParameterIds.h
    Source/Audio/Parameters/SynthPatchContract.cpp
    Source/Audio/Parameters/SynthPatchContract.h
    Source/Audio/Realtime/FixedObjectPool.h
    Source/Audio/Realtime/RealtimeParameterQueue.h
    Source/Audio/Realtime/SpscRingBuffer.h
    Source/Audio/Wavetable/Wavetable.cpp
    Source/Audio/Wavetable/Wavetable.h
    Source/Audio/Wavetable/WavetableFactory.cpp
    Source/Audio/Wavetable/WavetableFactory.h
    Source/Audio/Wavetable/WavetableOscillator.cpp
    Source/Audio/Wavetable/WavetableOscillator.h
    Source/Audio/Effects/Bitcrush.cpp
    Source/Audio/Effects/Bitcrush.h
    Source/Audio/Effects/MasterEq.cpp
    Source/Audio/Effects/MasterEq.h

    Source/Persistence/Database.cpp
    Source/Persistence/Database.h
    Source/Persistence/ProjectRepository.cpp
    Source/Persistence/ProjectRepository.h
    Source/Persistence/InstrumentRepository.cpp
    Source/Persistence/InstrumentRepository.h

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
    Tests/BackendStress.cpp
    Source/Audio/InstrumentVoice.cpp
    Source/Audio/InstrumentVoice.h
    Source/Audio/Sequencer.cpp
    Source/Audio/Sequencer.h
    Source/Audio/TrackModel.cpp
    Source/Audio/TrackModel.h
    Source/Audio/Analysis/FftAnalyzer.cpp
    Source/Audio/Analysis/FftAnalyzer.h
    Source/Audio/Parameters/ParameterIds.h
    Source/Audio/Parameters/SynthPatchContract.cpp
    Source/Audio/Parameters/SynthPatchContract.h
    Source/Audio/Realtime/FixedObjectPool.h
    Source/Audio/Realtime/RealtimeParameterQueue.h
    Source/Audio/Realtime/SpscRingBuffer.h
    Source/Audio/Wavetable/Wavetable.cpp
    Source/Audio/Wavetable/Wavetable.h
    Source/Audio/Wavetable/WavetableFactory.cpp
    Source/Audio/Wavetable/WavetableFactory.h
    Source/Audio/Wavetable/WavetableOscillator.cpp
    Source/Audio/Wavetable/WavetableOscillator.h
)

target_link_libraries(BeatBackendStress PRIVATE
    juce::juce_audio_basics
    juce::juce_core
    juce::juce_dsp
)

target_compile_features(BeatBackendStress PRIVATE cxx_std_20)

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
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${CMAKE_SOURCE_DIR}/frontend/dist"
            "${BEAT_FRONTEND_RESOURCE_DIR}"
        COMMENT "Copying React frontend into app bundle"
        VERBATIM
    )
endif()

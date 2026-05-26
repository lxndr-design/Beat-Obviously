juce_add_gui_app(Beat
    PRODUCT_NAME "Beat"
    COMPANY_NAME "Beat"
    BUNDLE_ID com.beat.app
    VERSION 0.1.0
    NEEDS_WEB_BROWSER TRUE
)

juce_generate_juce_header(Beat)

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
)

target_compile_features(Beat PRIVATE cxx_std_20)

# In Release builds, embed the frontend dist/ as binary data.
if(CMAKE_BUILD_TYPE STREQUAL "Release" AND BEAT_BUILD_FRONTEND)
    file(GLOB_RECURSE FRONTEND_DIST
        ${CMAKE_SOURCE_DIR}/frontend/dist/*
    )
    juce_add_binary_data(BeatWebAssets SOURCES ${FRONTEND_DIST})
    target_link_libraries(Beat PRIVATE BeatWebAssets)
    add_dependencies(BeatWebAssets beat_frontend_build)
endif()

cmake_minimum_required(VERSION 3.22)

project(Beat
    VERSION 0.1.0
    DESCRIPTION "Beat — a beat sequencing DAW"
    LANGUAGES CXX C
)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Single output dir for built artefacts (easier to find the .app)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

# Fetch JUCE
include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.4
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(JUCE)

# --- Frontend build integration ------------------------------------------
# In Release builds, the frontend is built into static files and embedded
# in the JUCE binary. In Debug builds, the webview points at the Vite dev
# server (set BEAT_DEV_FRONTEND_URL when launching).

option(BEAT_BUILD_FRONTEND "Build the React frontend and embed it" ON)

if(BEAT_BUILD_FRONTEND AND CMAKE_BUILD_TYPE STREQUAL "Release")
    find_program(NPM_EXECUTABLE npm REQUIRED)
    add_custom_target(beat_frontend_build ALL
        COMMAND ${NPM_EXECUTABLE} install
        COMMAND ${NPM_EXECUTABLE} run build
        WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}/frontend
        COMMENT "Building React frontend"
        VERBATIM
    )
endif()

add_subdirectory(backend)

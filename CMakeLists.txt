cmake_minimum_required(VERSION 3.22)

file(STRINGS "${CMAKE_SOURCE_DIR}/VERSION" BEAT_VERSION LIMIT_COUNT 1)
string(STRIP "${BEAT_VERSION}" BEAT_VERSION)

project(Beat
    VERSION ${BEAT_VERSION}
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

option(BEAT_BUILD_FRONTEND "Build the Solid frontend and embed it" ON)

if(BEAT_BUILD_FRONTEND AND CMAKE_BUILD_TYPE STREQUAL "Release")
    find_program(NPM_EXECUTABLE npm REQUIRED)
    add_custom_target(beat_frontend_build ALL
        COMMAND ${NPM_EXECUTABLE} install
        COMMAND ${NPM_EXECUTABLE} run build
        WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}/frontend
        COMMENT "Building Solid frontend"
        VERBATIM
    )
endif()

add_subdirectory(backend)

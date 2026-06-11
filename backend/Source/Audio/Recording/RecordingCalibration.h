#pragma once

#include "RecordingPlanner.h"

#include <optional>

namespace beat
{
    struct RecordingLatencyCalibrationSpec
    {
        double sampleRate { 44100.0 };
        int measuredRoundTripSamples { 0 };
        int reportedInputLatencySamples { 0 };
        int reportedOutputLatencySamples { 0 };
        int userAdjustmentSamples { 0 };
    };

    struct RecordingLatencyCalibration
    {
        int measuredRoundTripSamples { 0 };
        int reportedLatencySamples { 0 };
        int manualLatencySamples { 0 };
        int compensatedLatencySamples { 0 };
        double measuredRoundTripMs { 0.0 };
        double manualLatencyMs { 0.0 };
        double compensatedLatencyMs { 0.0 };
    };

    std::optional<RecordingLatencyCalibration> calculateRecordingLatencyCalibration(
        const RecordingLatencyCalibrationSpec& spec,
        juce::String* error = nullptr);

    std::optional<RecordingLatencyCalibration> calculateRecordingLatencyCalibration(
        const RecordingInputProfile& profile,
        juce::String* error = nullptr);

    std::optional<RecordedTakeSpec> applyRecordingLatencyCalibration(
        RecordedTakeSpec spec,
        const RecordingLatencyCalibration& calibration,
        juce::String* error = nullptr);
}

#include "RecordingCalibration.h"

#include <cmath>

namespace beat
{
    namespace
    {
        double samplesToMs(int samples, double sampleRate)
        {
            return (double) samples * 1000.0 / sampleRate;
        }
    }

    std::optional<RecordingLatencyCalibration> calculateRecordingLatencyCalibration(
        const RecordingLatencyCalibrationSpec& spec,
        juce::String* error)
    {
        const auto fail = [error](const juce::String& message) -> std::optional<RecordingLatencyCalibration>
        {
            if (error != nullptr)
                *error = message;
            return std::nullopt;
        };

        if (!std::isfinite(spec.sampleRate) || spec.sampleRate <= 0.0)
            return fail("Recording calibration sample rate is invalid.");
        if (spec.measuredRoundTripSamples < 0)
            return fail("Recording calibration measured latency is invalid.");
        if (spec.reportedInputLatencySamples < 0 || spec.reportedOutputLatencySamples < 0)
            return fail("Recording calibration reported latency is invalid.");

        const int reportedLatencySamples = spec.reportedInputLatencySamples
            + spec.reportedOutputLatencySamples;
        const int manualLatencySamples = spec.measuredRoundTripSamples
            - reportedLatencySamples
            + spec.userAdjustmentSamples;
        const int compensatedLatencySamples = reportedLatencySamples + manualLatencySamples;

        return RecordingLatencyCalibration {
            spec.measuredRoundTripSamples,
            reportedLatencySamples,
            manualLatencySamples,
            compensatedLatencySamples,
            samplesToMs(spec.measuredRoundTripSamples, spec.sampleRate),
            samplesToMs(manualLatencySamples, spec.sampleRate),
            samplesToMs(compensatedLatencySamples, spec.sampleRate),
        };
    }

    std::optional<RecordingLatencyCalibration> calculateRecordingLatencyCalibration(
        const RecordingInputProfile& profile,
        juce::String* error)
    {
        RecordingLatencyCalibrationSpec spec;
        spec.sampleRate = profile.calibrationSampleRate;
        spec.measuredRoundTripSamples = profile.measuredRoundTripSamples;
        spec.reportedInputLatencySamples = profile.reportedInputLatencySamples;
        spec.reportedOutputLatencySamples = profile.reportedOutputLatencySamples;
        spec.userAdjustmentSamples = profile.userLatencyAdjustmentSamples;
        return calculateRecordingLatencyCalibration(spec, error);
    }

    std::optional<RecordedTakeSpec> applyRecordingLatencyCalibration(
        RecordedTakeSpec spec,
        const RecordingLatencyCalibration& calibration,
        juce::String* error)
    {
        if (calibration.compensatedLatencySamples < 0)
        {
            if (error != nullptr)
                *error = "Recording calibration would create negative total latency.";
            return std::nullopt;
        }

        spec.compensateLatency = true;
        spec.inputLatencySamples = 0;
        spec.outputLatencySamples = 0;
        spec.manualLatencySamples = calibration.compensatedLatencySamples;
        return spec;
    }
}

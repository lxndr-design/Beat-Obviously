#pragma once

#include "SpectralArtifact.h"

#include <memory>

namespace beat
{
    // Beat-owned deterministic fixture generated and analyzed on the control thread.
    std::shared_ptr<const SpectralArtifact> sharedSpectralBenchmarkArtifact();
}

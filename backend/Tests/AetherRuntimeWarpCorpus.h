#pragma once

namespace beat::test
{
    // Test-only spectral corpus. This reproduces the documented runtime-warp
    // equations independently and never enters the production audio path.
    bool runAetherRuntimeWarpCorpus(const char* reportPath);
}

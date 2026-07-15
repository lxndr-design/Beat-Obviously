#include "SfzSourceSlot.h"

// The slot is header-defined so its fixed callback work remains visible to the
// optimiser. This translation unit keeps the production target compiling the
// complete disconnected implementation even before product routing is enabled.

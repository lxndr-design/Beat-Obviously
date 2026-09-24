#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

namespace beat
{
    /** Apply native clipping so the custom JUCE title bar and web surface share one rounded silhouette. */
    void applyNativeWindowCornerRadius(juce::Component& component, float radius);
}

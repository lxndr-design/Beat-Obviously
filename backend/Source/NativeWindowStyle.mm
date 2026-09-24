#include "NativeWindowStyle.h"

#if JUCE_MAC
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

namespace beat
{
    void applyNativeWindowCornerRadius(juce::Component& component, float radius)
    {
        auto* peer = component.getPeer();
        if (peer == nullptr)
            return;

        auto* view = static_cast<NSView*>(peer->getNativeHandle());
        if (view == nil)
            return;

        [view setWantsLayer:YES];
        view.layer.cornerRadius = radius;
        view.layer.masksToBounds = YES;

        NSWindow* window = view.window;
        if (window != nil)
        {
            window.opaque = NO;
            window.backgroundColor = NSColor.clearColor;
            window.hasShadow = YES;
        }
    }
}
#else
namespace beat
{
    void applyNativeWindowCornerRadius(juce::Component&, float) {}
}
#endif

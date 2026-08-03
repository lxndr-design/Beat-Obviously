#pragma once

#include <juce_graphics/juce_graphics.h>

namespace beat
{
    struct PdfPageRenderResult
    {
        juce::File file;
        juce::String error;
    };

    struct ScorePageRefinementResult
    {
        juce::File file;
        double detectedInterlinePixels = 0.0;
        double appliedScale = 1.0;
        juce::Rectangle<int> sourceCrop;
        juce::String error;
    };

    int pdfPageCount(const juce::File& pdf);
    PdfPageRenderResult renderPdfPageToPng(const juce::File& pdf,
                                           int oneBasedPageNumber,
                                           const juce::File& destination,
                                           double dpi);
    ScorePageRefinementResult refineScorePageForOcr(const juce::File& sourceImage,
                                                    const juce::File& destination,
                                                    double targetInterlinePixels = 20.0);
}

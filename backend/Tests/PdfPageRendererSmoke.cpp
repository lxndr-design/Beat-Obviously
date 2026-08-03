#include "../Source/Score/PdfPageRenderer.h"
#include <juce_graphics/juce_graphics.h>
#include <iostream>

int main(int argc, char** argv)
{
    if (argc < 2 || argc > 4)
    {
        std::cerr << "Usage: BeatPdfPageRendererSmoke /path/to/score.pdf [page] [output-directory]\n";
        return 2;
    }
    const juce::File source(argv[1]);
    const auto requestedPage = argc >= 3 ? juce::String(argv[2]).getIntValue() : 1;
    const auto pages = beat::pdfPageCount(source);
    if (pages <= 0)
    {
        std::cerr << "Could not read the PDF page tree\n";
        return 1;
    }
    const auto keepOutputs = argc == 4;
    const auto outputDirectory = keepOutputs ? juce::File(argv[3]) : juce::File("/private/tmp");
    if (keepOutputs && outputDirectory.createDirectory().failed())
    {
        std::cerr << "Could not create output directory\n";
        return 1;
    }
    const auto output = keepOutputs
        ? outputDirectory.getChildFile("raw-page.png")
        : outputDirectory.getNonexistentChildFile("beat-pdf-render-smoke", ".png", false);
    const auto rendered = beat::renderPdfPageToPng(source, requestedPage, output, 400.0);
    if (! rendered.file.existsAsFile())
    {
        std::cerr << rendered.error << "\n";
        return 1;
    }
    const auto image = juce::ImageFileFormat::loadFrom(rendered.file);
    if (! image.isValid() || image.getWidth() < 1000 || image.getHeight() < 1000)
    {
        std::cerr << "Rendered page is missing or unexpectedly small\n";
        return 1;
    }

    const auto refinedOutput = keepOutputs
        ? outputDirectory.getChildFile("refined-page.png")
        : outputDirectory.getNonexistentChildFile("beat-pdf-refine-smoke", ".png", false);
    const auto refined = beat::refineScorePageForOcr(rendered.file, refinedOutput);
    const auto refinedImage = juce::ImageFileFormat::loadFrom(refined.file);
    if (! keepOutputs)
    {
        rendered.file.deleteFile();
        refined.file.deleteFile();
    }
    if (! refinedImage.isValid() || refined.detectedInterlinePixels <= 0.0)
    {
        std::cerr << (refined.error.isNotEmpty() ? refined.error : "Refined page has no detectable staff spacing") << "\n";
        return 1;
    }
    std::cout << "PDF renderer passed: pages=" << pages
              << " page=" << requestedPage
              << " raw=" << image.getWidth() << "x" << image.getHeight()
              << " interline=" << refined.detectedInterlinePixels
              << " scale=" << refined.appliedScale
              << " refined=" << refinedImage.getWidth() << "x" << refinedImage.getHeight() << "\n";
    return 0;
}

#include "PdfPageRenderer.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <numeric>
#include <utility>
#include <vector>

#if JUCE_MAC
#include <CoreGraphics/CoreGraphics.h>
#include <ImageIO/ImageIO.h>
#endif

namespace beat
{
    namespace
    {
        std::vector<int> projectedStaffLineCenters(const juce::Image& image)
        {
            std::vector<int> centers;
            std::vector<int> peakRows;
            const auto stride = image.getWidth() > 2600 ? 3 : 2;
            const auto samplesPerRow = (image.getWidth() + stride - 1) / stride;
            const auto requiredDarkSamples = juce::jmax(16, static_cast<int>(std::round(samplesPerRow * 0.12)));
            for (int y = 0; y < image.getHeight(); ++y)
            {
                int dark = 0;
                for (int x = 0; x < image.getWidth(); x += stride)
                    if (image.getPixelAt(x, y).getRed() < 112 && ++dark >= requiredDarkSamples) break;
                if (dark >= requiredDarkSamples) peakRows.push_back(y);
            }

            for (size_t index = 0; index < peakRows.size();)
            {
                auto end = index + 1;
                while (end < peakRows.size() && peakRows[end] <= peakRows[end - 1] + 1) ++end;
                centers.push_back((peakRows[index] + peakRows[end - 1]) / 2);
                index = end;
            }
            return centers;
        }

        double estimateInterline(const std::vector<int>& centers)
        {
            std::array<int, 81> histogram {};
            for (size_t index = 1; index < centers.size(); ++index)
            {
                const auto distance = centers[index] - centers[index - 1];
                if (distance >= 4 && distance < static_cast<int>(histogram.size()))
                    ++histogram[static_cast<size_t>(distance)];
            }
            const auto best = std::max_element(histogram.begin() + 4, histogram.end());
            if (best == histogram.end() || *best < 4) return 0.0;
            return static_cast<double>(std::distance(histogram.begin(), best));
        }

        std::pair<int, int> grayscaleRange(const juce::Image& image, juce::Rectangle<int> crop)
        {
            std::array<int, 256> histogram {};
            int samples = 0;
            for (int y = crop.getY(); y < crop.getBottom(); y += 2)
            {
                for (int x = crop.getX(); x < crop.getRight(); x += 2)
                {
                    ++histogram[image.getPixelAt(x, y).getRed()];
                    ++samples;
                }
            }
            auto percentile = [&](double fraction)
            {
                const auto target = static_cast<int>(std::round(samples * fraction));
                int cumulative = 0;
                for (int value = 0; value < 256; ++value)
                {
                    cumulative += histogram[static_cast<size_t>(value)];
                    if (cumulative >= target) return value;
                }
                return 255;
            };
            auto low = percentile(0.01);
            auto high = percentile(0.995);
            if (high - low < 96) return {0, 255};
            return {low, high};
        }

        juce::Rectangle<int> notationCrop(const juce::Image& image,
                                          const std::vector<int>& lineCenters,
                                          double interline)
        {
            auto bounds = image.getBounds();
            if (lineCenters.size() >= 5 && interline > 0.0)
            {
                const auto margin = juce::jmax(24, static_cast<int>(std::round(interline * 4.0)));
                bounds.setY(juce::jmax(0, lineCenters.front() - margin));
                bounds.setBottom(juce::jmin(image.getHeight(), lineCenters.back() + margin));
            }

            int left = image.getWidth();
            int right = -1;
            for (int y = bounds.getY(); y < bounds.getBottom(); y += 2)
            {
                for (int x = 0; x < image.getWidth(); x += 2)
                {
                    if (image.getPixelAt(x, y).getRed() >= 224) continue;
                    left = juce::jmin(left, x);
                    right = juce::jmax(right, x);
                }
            }
            if (right > left)
            {
                const auto margin = juce::jmax(24, static_cast<int>(std::round(juce::jmax(10.0, interline) * 2.0)));
                bounds.setX(juce::jmax(0, left - margin));
                bounds.setRight(juce::jmin(image.getWidth(), right + margin));
            }
            return bounds;
        }
    }

#if JUCE_MAC
    namespace
    {
        struct PdfHandle
        {
            CGPDFDocumentRef value = nullptr;

            PdfHandle() = default;
            PdfHandle(const PdfHandle&) = delete;
            PdfHandle& operator=(const PdfHandle&) = delete;
            PdfHandle(PdfHandle&& other) noexcept
                : value(std::exchange(other.value, nullptr))
            {
            }
            PdfHandle& operator=(PdfHandle&& other) noexcept
            {
                if (this == &other) return *this;
                if (value != nullptr) CGPDFDocumentRelease(value);
                value = std::exchange(other.value, nullptr);
                return *this;
            }
            ~PdfHandle() { if (value != nullptr) CGPDFDocumentRelease(value); }
        };

        PdfHandle openPdf(const juce::File& file)
        {
            PdfHandle result;
            const auto path = file.getFullPathName().toRawUTF8();
            auto url = CFURLCreateFromFileSystemRepresentation(nullptr,
                                                               reinterpret_cast<const UInt8*>(path),
                                                               std::strlen(path),
                                                               false);
            if (url != nullptr)
            {
                result.value = CGPDFDocumentCreateWithURL(url);
                CFRelease(url);
            }
            return result;
        }
    }

    int pdfPageCount(const juce::File& pdf)
    {
        auto document = openPdf(pdf);
        return document.value == nullptr ? 0 : static_cast<int>(CGPDFDocumentGetNumberOfPages(document.value));
    }

    PdfPageRenderResult renderPdfPageToPng(const juce::File& pdf,
                                           int oneBasedPageNumber,
                                           const juce::File& destination,
                                           double dpi)
    {
        auto document = openPdf(pdf);
        if (document.value == nullptr) return {{}, "The PDF could not be opened by Core Graphics."};
        if (oneBasedPageNumber < 1 || oneBasedPageNumber > static_cast<int>(CGPDFDocumentGetNumberOfPages(document.value)))
            return {{}, "The requested PDF page is outside the document."};

        auto page = CGPDFDocumentGetPage(document.value, static_cast<size_t>(oneBasedPageNumber));
        if (page == nullptr) return {{}, "The requested PDF page could not be read."};
        const auto box = CGPDFPageGetBoxRect(page, kCGPDFCropBox);
        const auto scale = juce::jlimit(1.0, 12.0, dpi / 72.0);
        const auto width = static_cast<size_t>(std::ceil(box.size.width * scale));
        const auto height = static_cast<size_t>(std::ceil(box.size.height * scale));
        if (width == 0 || height == 0 || width > 12000 || height > 12000)
            return {{}, "The rendered PDF page dimensions are unsafe."};

        const auto directoryResult = destination.getParentDirectory().createDirectory();
        if (directoryResult.failed())
            return {{}, "Beat could not create the PDF page render directory: " + directoryResult.getErrorMessage()};
        auto colorSpace = CGColorSpaceCreateDeviceGray();
        auto context = CGBitmapContextCreate(nullptr, width, height, 8, width, colorSpace, kCGImageAlphaNone);
        CGColorSpaceRelease(colorSpace);
        if (context == nullptr) return {{}, "Beat could not allocate the PDF page raster."};

        CGContextSetGrayFillColor(context, 1.0, 1.0);
        CGContextFillRect(context, CGRectMake(0, 0, static_cast<CGFloat>(width), static_cast<CGFloat>(height)));
        CGContextScaleCTM(context, static_cast<CGFloat>(scale), static_cast<CGFloat>(scale));
        CGContextTranslateCTM(context, -box.origin.x, -box.origin.y);
        CGContextDrawPDFPage(context, page);

        auto image = CGBitmapContextCreateImage(context);
        CGContextRelease(context);
        if (image == nullptr) return {{}, "Beat could not create the rendered PDF image."};

        destination.deleteFile();
        if (! destination.create())
        {
            CGImageRelease(image);
            return {{}, "Beat could not create the PNG file."};
        }

        const auto path = destination.getFullPathName().toRawUTF8();
        auto url = CFURLCreateFromFileSystemRepresentation(nullptr,
                                                           reinterpret_cast<const UInt8*>(path),
                                                           std::strlen(path),
                                                           false);
        auto writer = url == nullptr ? nullptr : CGImageDestinationCreateWithURL(url, CFSTR("public.png"), 1, nullptr);
        if (url != nullptr) CFRelease(url);
        if (writer == nullptr)
        {
            CGImageRelease(image);
            destination.deleteFile();
            return {{}, "Beat could not create the PNG destination."};
        }
        CGImageDestinationAddImage(writer, image, nullptr);
        const auto written = CGImageDestinationFinalize(writer);
        CFRelease(writer);
        CGImageRelease(image);
        if (! written || destination.getSize() <= 0)
        {
            destination.deleteFile();
            return {{}, "Beat could not write the rendered PDF page."};
        }
        return {destination, {}};
    }
#else
    int pdfPageCount(const juce::File&) { return 0; }
    PdfPageRenderResult renderPdfPageToPng(const juce::File&, int, const juce::File&, double)
    {
        return {{}, "Adaptive PDF page rendering is currently available on macOS."};
    }
#endif

    ScorePageRefinementResult refineScorePageForOcr(const juce::File& sourceImage,
                                                    const juce::File& destination,
                                                    double targetInterlinePixels)
    {
        const auto image = juce::ImageFileFormat::loadFrom(sourceImage);
        if (! image.isValid()) return {{}, 0.0, 1.0, {}, "Beat could not read the rendered score page."};

        const auto lineCenters = projectedStaffLineCenters(image);
        const auto interline = estimateInterline(lineCenters);
        const auto crop = notationCrop(image, lineCenters, interline);
        if (crop.isEmpty()) return {{}, interline, 1.0, {}, "Beat could not locate notation on the rendered page."};

        const auto requestedScale = interline > 0.0 ? targetInterlinePixels / interline : 1.0;
        const auto scale = juce::jlimit(0.8, 1.8, requestedScale);
        const auto outputWidth = static_cast<int>(std::round(crop.getWidth() * scale));
        const auto outputHeight = static_cast<int>(std::round(crop.getHeight() * scale));
        if (outputWidth <= 0 || outputHeight <= 0 || outputWidth > 10000 || outputHeight > 10000)
            return {{}, interline, scale, crop, "The refined score page dimensions are unsafe."};

        const auto [blackPoint, whitePoint] = grayscaleRange(image, crop);
        juce::Image normalized(juce::Image::RGB, crop.getWidth(), crop.getHeight(), true);
        for (int y = 0; y < crop.getHeight(); ++y)
        {
            for (int x = 0; x < crop.getWidth(); ++x)
            {
                const auto sourceValue = static_cast<int>(image.getPixelAt(crop.getX() + x, crop.getY() + y).getRed());
                const auto mapped = juce::jlimit(0, 255,
                    static_cast<int>(std::round((sourceValue - blackPoint) * 255.0 / juce::jmax(1, whitePoint - blackPoint))));
                normalized.setPixelAt(x, y, juce::Colour(static_cast<juce::uint8>(mapped),
                                                          static_cast<juce::uint8>(mapped),
                                                          static_cast<juce::uint8>(mapped)));
            }
        }

        juce::Image refined(juce::Image::RGB, outputWidth, outputHeight, true);
        juce::Graphics graphics(refined);
        graphics.fillAll(juce::Colours::white);
        graphics.setImageResamplingQuality(juce::Graphics::highResamplingQuality);
        graphics.drawImage(normalized,
                           0, 0, refined.getWidth(), refined.getHeight(),
                           0, 0, normalized.getWidth(), normalized.getHeight());

        if (destination.getParentDirectory().createDirectory().failed())
            return {{}, interline, scale, crop, "Beat could not create the refined score image directory."};
        destination.deleteFile();
        juce::FileOutputStream output(destination);
        if (! output.openedOk()) return {{}, interline, scale, crop, "Beat could not create the refined score image."};
        juce::PNGImageFormat png;
        if (! png.writeImageToStream(refined, output))
        {
            destination.deleteFile();
            return {{}, interline, scale, crop, "Beat could not write the refined score image."};
        }
        output.flush();
        return {destination, interline, scale, crop, {}};
    }
}

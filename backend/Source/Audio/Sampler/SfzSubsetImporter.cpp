#include "SfzSubsetImporter.h"

#include <algorithm>
#include <cerrno>
#include <charconv>
#include <cmath>
#include <cstdlib>
#include <map>
#include <limits>
#include <set>
#include <string>

namespace beat
{
    namespace
    {
        struct Lexeme
        {
            enum class Kind { header, opcode } kind { Kind::opcode };
            juce::String name;
            juce::String value;
            int line { 1 };
            int column { 1 };
        };

        struct StoredValue
        {
            juce::String text;
            int line { 1 };
            int column { 1 };
        };

        using OpcodeMap = std::map<std::string, StoredValue>;

        bool isIdentifierCharacter(juce::juce_wchar character) noexcept
        {
            return juce::CharacterFunctions::isLetterOrDigit(character)
                || character == '_' || character == '-';
        }

        void advancePosition(juce::juce_wchar character, int& line, int& column) noexcept
        {
            if (character == '\n')
            {
                ++line;
                column = 1;
            }
            else
            {
                ++column;
            }
        }

        bool looksLikeOpcode(const juce::String& source, int start) noexcept
        {
            int index = start;
            if (index >= source.length() || !isIdentifierCharacter(source[index]))
                return false;
            while (index < source.length() && isIdentifierCharacter(source[index]))
                ++index;
            while (index < source.length() && (source[index] == ' ' || source[index] == '\t'))
                ++index;
            return index < source.length() && source[index] == '=';
        }

        std::vector<Lexeme> lex(const juce::String& source,
                                const SfzSubsetParseLimits& limits,
                                SfzSubsetImport& result)
        {
            std::vector<Lexeme> output;
            output.reserve(std::min<size_t>(limits.maximumOpcodes + 16, 4112));
            int index = 0;
            int line = 1;
            int column = 1;
            size_t opcodeCount = 0;

            const auto addError = [&](juce::String code, juce::String message,
                                      int errorLine, int errorColumn)
            {
                ++result.errorCount;
                if (result.diagnostics.size() < limits.maximumDiagnostics)
                    result.diagnostics.push_back({ SfzDiagnosticSeverity::error,
                        std::move(code), std::move(message), errorLine, errorColumn });
            };

            while (index < source.length())
            {
                while (index < source.length())
                {
                    if (source[index] == '/' && index + 1 < source.length()
                        && source[index + 1] == '/')
                    {
                        while (index < source.length() && source[index] != '\n')
                        {
                            advancePosition(source[index], line, column);
                            ++index;
                        }
                        continue;
                    }
                    if (!juce::CharacterFunctions::isWhitespace(source[index]))
                        break;
                    advancePosition(source[index], line, column);
                    ++index;
                }
                if (index >= source.length())
                    break;

                const int tokenLine = line;
                const int tokenColumn = column;
                if (source[index] == '<')
                {
                    advancePosition(source[index], line, column);
                    ++index;
                    const int nameStart = index;
                    while (index < source.length() && source[index] != '>' && source[index] != '\n')
                    {
                        advancePosition(source[index], line, column);
                        ++index;
                    }
                    if (index >= source.length() || source[index] != '>')
                    {
                        addError("sfz.syntax.header", "Unterminated SFZ header", tokenLine, tokenColumn);
                        break;
                    }
                    const auto name = source.substring(nameStart, index).trim().toLowerCase();
                    advancePosition(source[index], line, column);
                    ++index;
                    if (name.isEmpty())
                        addError("sfz.syntax.header", "Empty SFZ header", tokenLine, tokenColumn);
                    else
                        output.push_back({ Lexeme::Kind::header, name, {}, tokenLine, tokenColumn });
                    continue;
                }

                const int nameStart = index;
                while (index < source.length() && isIdentifierCharacter(source[index]))
                {
                    advancePosition(source[index], line, column);
                    ++index;
                }
                if (nameStart == index)
                {
                    addError("sfz.syntax.token", "Expected an opcode name or header", tokenLine, tokenColumn);
                    advancePosition(source[index], line, column);
                    ++index;
                    continue;
                }
                const auto name = source.substring(nameStart, index).trim().toLowerCase();
                while (index < source.length() && (source[index] == ' ' || source[index] == '\t'))
                {
                    advancePosition(source[index], line, column);
                    ++index;
                }
                if (index >= source.length() || source[index] != '=')
                {
                    addError("sfz.syntax.assignment", "Opcode '" + name + "' is missing '='",
                             tokenLine, tokenColumn);
                    while (index < source.length() && source[index] != '\n')
                    {
                        advancePosition(source[index], line, column);
                        ++index;
                    }
                    continue;
                }
                advancePosition(source[index], line, column);
                ++index;
                while (index < source.length() && (source[index] == ' ' || source[index] == '\t'))
                {
                    advancePosition(source[index], line, column);
                    ++index;
                }

                juce::String value;
                if (index < source.length() && (source[index] == '"' || source[index] == '\''))
                {
                    const auto quote = source[index];
                    advancePosition(source[index], line, column);
                    ++index;
                    bool closed = false;
                    while (index < source.length())
                    {
                        if (source[index] == quote)
                        {
                            advancePosition(source[index], line, column);
                            ++index;
                            closed = true;
                            break;
                        }
                        if (source[index] == '\n')
                            break;
                        if (source[index] == '\\' && index + 1 < source.length()
                            && (source[index + 1] == quote || source[index + 1] == '\\'))
                        {
                            advancePosition(source[index], line, column);
                            ++index;
                        }
                        value << source[index];
                        advancePosition(source[index], line, column);
                        ++index;
                    }
                    if (!closed)
                        addError("sfz.syntax.quote", "Unterminated quoted opcode value",
                                 tokenLine, tokenColumn);
                }
                else
                {
                    const int valueStart = index;
                    int valueEnd = index;
                    while (index < source.length())
                    {
                        if (source[index] == '\n' || source[index] == '\r')
                            break;
                        if (source[index] == '/' && index + 1 < source.length()
                            && source[index + 1] == '/')
                            break;
                        if (source[index] == '<')
                            break;
                        if (source[index] == ' ' || source[index] == '\t')
                        {
                            int lookahead = index;
                            while (lookahead < source.length()
                                   && (source[lookahead] == ' ' || source[lookahead] == '\t'))
                                ++lookahead;
                            if (lookahead < source.length()
                                && (source[lookahead] == '<' || looksLikeOpcode(source, lookahead)))
                                break;
                        }
                        advancePosition(source[index], line, column);
                        ++index;
                        valueEnd = index;
                    }
                    value = source.substring(valueStart, valueEnd).trim();
                }

                ++opcodeCount;
                if (opcodeCount > limits.maximumOpcodes)
                {
                    addError("sfz.limit.opcodes", "SFZ opcode limit exceeded", tokenLine, tokenColumn);
                    break;
                }
                if (value.isEmpty())
                    addError("sfz.syntax.value", "Opcode '" + name + "' has an empty value",
                             tokenLine, tokenColumn);
                else
                    output.push_back({ Lexeme::Kind::opcode, name, value, tokenLine, tokenColumn });
            }
            return output;
        }

        void addDiagnostic(SfzSubsetImport& result, const SfzSubsetParseLimits& limits,
                           SfzDiagnosticSeverity severity, juce::String code,
                           juce::String message, int line, int column)
        {
            if (severity == SfzDiagnosticSeverity::error)
                ++result.errorCount;
            else
                ++result.warningCount;
            if (result.diagnostics.size() < limits.maximumDiagnostics)
                result.diagnostics.push_back({ severity, std::move(code), std::move(message), line, column });
        }

        bool parseInteger(const StoredValue& stored, int64_t& output) noexcept
        {
            const auto text = stored.text.trim().toStdString();
            if (text.empty()) return false;
            const auto parsed = std::from_chars(text.data(), text.data() + text.size(), output);
            return parsed.ec == std::errc() && parsed.ptr == text.data() + text.size();
        }

        bool parseDouble(const StoredValue& stored, double& output) noexcept
        {
            const auto text = stored.text.trim().toStdString();
            if (text.empty()) return false;
            char* end = nullptr;
            errno = 0;
            output = std::strtod(text.c_str(), &end);
            return errno == 0 && end == text.c_str() + text.size() && std::isfinite(output);
        }

        bool parseNote(const StoredValue& stored, int& output) noexcept
        {
            int64_t numeric = 0;
            if (parseInteger(stored, numeric))
            {
                output = (int) numeric;
                return numeric >= 0 && numeric <= 127;
            }

            const auto text = stored.text.trim().toUpperCase();
            if (text.length() < 2 || text.length() > 4)
                return false;
            int semitone = -1;
            switch (text[0])
            {
                case 'C': semitone = 0; break;
                case 'D': semitone = 2; break;
                case 'E': semitone = 4; break;
                case 'F': semitone = 5; break;
                case 'G': semitone = 7; break;
                case 'A': semitone = 9; break;
                case 'B': semitone = 11; break;
                default: return false;
            }
            int octaveStart = 1;
            if (text[1] == '#')
            {
                ++semitone;
                octaveStart = 2;
            }
            else if (text[1] == 'B')
            {
                --semitone;
                octaveStart = 2;
            }
            const StoredValue octave { text.substring(octaveStart), stored.line, stored.column };
            int64_t octaveValue = 0;
            if (!parseInteger(octave, octaveValue))
                return false;
            const int midi = (int) ((octaveValue + 1) * 12 + semitone);
            if (midi < 0 || midi > 127)
                return false;
            output = midi;
            return true;
        }

        const StoredValue* findValue(const OpcodeMap& values, const char* name) noexcept
        {
            const auto found = values.find(name);
            return found != values.end() ? &found->second : nullptr;
        }

        bool isSafeRelativePath(juce::String path)
        {
            path = path.replaceCharacter('\\', '/').trim();
            if (path.isEmpty() || path.startsWithChar('/') || path.startsWithChar('~')
                || path.containsChar(':'))
                return false;
            juce::StringArray parts;
            parts.addTokens(path, "/", {});
            for (const auto& part : parts)
                if (part.isEmpty() || part == "." || part == "..")
                    return false;
            return true;
        }

        juce::String normalizedPath(juce::String path)
        {
            path = path.replaceCharacter('\\', '/').trim();
            while (path.contains("//"))
                path = path.replace("//", "/");
            return path;
        }

        bool assignInteger(const OpcodeMap& values, const char* name, int64_t minimum,
                           int64_t maximum, int64_t& destination, SfzSubsetImport& result,
                           const SfzSubsetParseLimits& limits)
        {
            const auto* stored = findValue(values, name);
            if (stored == nullptr) return true;
            int64_t parsed = 0;
            if (!parseInteger(*stored, parsed) || parsed < minimum || parsed > maximum)
            {
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error, "sfz.value.range",
                              "Opcode '" + juce::String(name) + "' is outside the supported range",
                              stored->line, stored->column);
                return false;
            }
            destination = parsed;
            return true;
        }

        bool assignDouble(const OpcodeMap& values, const char* name, double minimum,
                          double maximum, double& destination, SfzSubsetImport& result,
                          const SfzSubsetParseLimits& limits)
        {
            const auto* stored = findValue(values, name);
            if (stored == nullptr) return true;
            double parsed = 0.0;
            if (!parseDouble(*stored, parsed) || parsed < minimum || parsed > maximum)
            {
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error, "sfz.value.range",
                              "Opcode '" + juce::String(name) + "' is outside the supported range",
                              stored->line, stored->column);
                return false;
            }
            destination = parsed;
            return true;
        }

        void materializeRegion(const OpcodeMap& values, int sourceLine,
                               const juce::String& defaultPath,
                               SfzSubsetImport& result,
                               const SfzSubsetParseLimits& limits)
        {
            if (result.regions.size() >= limits.maximumRegions)
            {
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                              "sfz.limit.regions", "SFZ region limit exceeded", sourceLine, 1);
                return;
            }

            static const std::set<std::string> supported {
                "sample", "key", "lokey", "hikey", "pitch_keycenter", "lovel", "hivel",
                "tune", "volume", "pan", "offset", "end", "loop_mode", "loop_start",
                "loop_end", "group", "off_by", "seq_length", "seq_position", "trigger",
            };
            for (const auto& [name, stored] : values)
            {
                if (supported.count(name) == 0)
                {
                    ++result.ignoredOpcodeCount;
                    addDiagnostic(result, limits, SfzDiagnosticSeverity::warning,
                                  "sfz.opcode.unsupported",
                                  "Unsupported opcode '" + juce::String(name) + "' was ignored",
                                  stored.line, stored.column);
                }
            }

            SfzSubsetRegion region;
            region.sourceLine = sourceLine;
            const auto* sample = findValue(values, "sample");
            if (sample == nullptr || !isSafeRelativePath(sample->text))
            {
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                              sample == nullptr ? "sfz.region.sample-required" : "sfz.path.unsafe",
                              sample == nullptr ? "Every SFZ region requires a relative sample path"
                                                : "Absolute, URL, drive-qualified, and traversing sample paths are rejected",
                              sample != nullptr ? sample->line : sourceLine,
                              sample != nullptr ? sample->column : 1);
                return;
            }
            auto samplePath = normalizedPath(sample->text);
            if (defaultPath.isNotEmpty())
                samplePath = normalizedPath(defaultPath.trimCharactersAtEnd("/") + "/" + samplePath);
            if (!isSafeRelativePath(samplePath))
            {
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                              "sfz.path.unsafe", "Resolved sample path is unsafe",
                              sample->line, sample->column);
                return;
            }
            region.samplePath = samplePath;

            if (const auto* key = findValue(values, "key"))
            {
                int note = 0;
                if (!parseNote(*key, note))
                    addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                                  "sfz.note.invalid", "Opcode 'key' is not a valid MIDI note",
                                  key->line, key->column);
                else
                    region.rootNote = region.loNote = region.hiNote = note;
            }
            const auto assignNote = [&](const char* name, int& destination)
            {
                if (const auto* stored = findValue(values, name))
                {
                    int note = 0;
                    if (!parseNote(*stored, note))
                        addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                                      "sfz.note.invalid",
                                      "Opcode '" + juce::String(name) + "' is not a valid MIDI note",
                                      stored->line, stored->column);
                    else
                        destination = note;
                }
            };
            assignNote("lokey", region.loNote);
            assignNote("hikey", region.hiNote);
            assignNote("pitch_keycenter", region.rootNote);

            int64_t integer = region.loVelocity;
            assignInteger(values, "lovel", 0, 127, integer, result, limits);
            region.loVelocity = (int) integer;
            integer = region.hiVelocity;
            assignInteger(values, "hivel", 0, 127, integer, result, limits);
            region.hiVelocity = (int) integer;
            assignDouble(values, "tune", -1200.0, 1200.0, region.tuneCents, result, limits);
            assignDouble(values, "volume", -144.0, 24.0, region.volumeDb, result, limits);
            assignDouble(values, "pan", -100.0, 100.0, region.panPercent, result, limits);
            assignInteger(values, "offset", 0, std::numeric_limits<int64_t>::max(),
                          region.offsetFrames, result, limits);
            assignInteger(values, "end", 0, std::numeric_limits<int64_t>::max(),
                          region.endFrame, result, limits);
            assignInteger(values, "loop_start", 0, std::numeric_limits<int64_t>::max(),
                          region.loopStartFrame, result, limits);
            assignInteger(values, "loop_end", 0, std::numeric_limits<int64_t>::max(),
                          region.loopEndFrame, result, limits);
            integer = region.group;
            assignInteger(values, "group", 0, 65535, integer, result, limits);
            region.group = (int) integer;
            integer = region.offBy;
            assignInteger(values, "off_by", 0, 65535, integer, result, limits);
            region.offBy = (int) integer;
            integer = region.sequenceLength;
            assignInteger(values, "seq_length", 1, 128, integer, result, limits);
            region.sequenceLength = (int) integer;
            integer = region.sequencePosition;
            assignInteger(values, "seq_position", 1, 128, integer, result, limits);
            region.sequencePosition = (int) integer;

            if (const auto* loopMode = findValue(values, "loop_mode"))
            {
                const auto normalized = loopMode->text.trim().toLowerCase();
                if (normalized == "no_loop" || normalized == "one_shot"
                    || normalized == "loop_continuous" || normalized == "loop_sustain")
                    region.loopMode = normalized;
                else
                    addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                                  "sfz.loop-mode.unsupported", "Unsupported loop_mode value",
                                  loopMode->line, loopMode->column);
            }
            if (const auto* trigger = findValue(values, "trigger"))
            {
                const auto normalized = trigger->text.trim().toLowerCase();
                if (normalized == "attack" || normalized == "release")
                    region.trigger = normalized;
                else
                    addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                                  "sfz.trigger.unsupported", "Only attack and release triggers are supported",
                                  trigger->line, trigger->column);
            }

            if (region.loNote > region.hiNote || region.loVelocity > region.hiVelocity)
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                              "sfz.region.range", "Region key or velocity range is reversed",
                              sourceLine, 1);
            if (region.sequencePosition > region.sequenceLength)
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                              "sfz.region.sequence", "seq_position exceeds seq_length",
                              sourceLine, 1);
            if (region.endFrame > 0 && region.offsetFrames >= region.endFrame)
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                              "sfz.region.sample-range", "offset must be lower than end",
                              sourceLine, 1);
            if (region.loopMode.startsWith("loop_")
                && (region.loopEndFrame <= 0 || region.loopStartFrame >= region.loopEndFrame))
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                              "sfz.region.loop-range", "Looping regions require loop_start < loop_end",
                              sourceLine, 1);

            result.regions.push_back(std::move(region));
        }
    }

    bool SfzSubsetImport::hasErrors() const noexcept
    {
        return errorCount != 0;
    }

    SfzSubsetImport parseSfzSubsetText(const juce::String& source,
                                       const SfzSubsetParseLimits& limits)
    {
        SfzSubsetImport result;
        result.sourceName = "memory";
        if (source.getNumBytesAsUTF8() > limits.maximumSourceBytes)
        {
            addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                          "sfz.limit.source", "SFZ source-size limit exceeded", 1, 1);
            return result;
        }

        const auto lexemes = lex(source, limits, result);
        OpcodeMap control;
        OpcodeMap global;
        OpcodeMap group;
        OpcodeMap region;
        OpcodeMap* current = nullptr;
        juce::String currentHeader;
        bool ignoringSection = false;
        bool regionActive = false;
        int regionLine = 1;

        const auto finalizeRegion = [&]
        {
            if (!regionActive) return;
            auto defaultPath = juce::String();
            if (const auto* stored = findValue(control, "default_path"))
            {
                if (isSafeRelativePath(stored->text))
                    defaultPath = normalizedPath(stored->text);
                else
                    addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                                  "sfz.path.unsafe", "default_path must be a safe relative path",
                                  stored->line, stored->column);
            }
            result.defaultPath = defaultPath;
            materializeRegion(region, regionLine, defaultPath, result, limits);
            regionActive = false;
        };

        for (const auto& lexeme : lexemes)
        {
            if (lexeme.kind == Lexeme::Kind::header)
            {
                finalizeRegion();
                currentHeader = lexeme.name;
                ignoringSection = false;
                if (currentHeader == "control")
                    current = &control;
                else if (currentHeader == "global")
                    current = &global;
                else if (currentHeader == "group")
                {
                    group = global;
                    current = &group;
                }
                else if (currentHeader == "region")
                {
                    region = group.empty() ? global : group;
                    current = &region;
                    regionActive = true;
                    regionLine = lexeme.line;
                }
                else
                {
                    current = nullptr;
                    ignoringSection = true;
                    addDiagnostic(result, limits, SfzDiagnosticSeverity::warning,
                                  "sfz.header.unsupported",
                                  "Unsupported header <" + currentHeader + "> was ignored",
                                  lexeme.line, lexeme.column);
                }
                continue;
            }

            if (current == nullptr)
            {
                if (ignoringSection)
                {
                    ++result.ignoredOpcodeCount;
                    addDiagnostic(result, limits, SfzDiagnosticSeverity::warning,
                                  "sfz.opcode.unsupported-section",
                                  "Opcode '" + lexeme.name + "' belongs to an unsupported section and was ignored",
                                  lexeme.line, lexeme.column);
                }
                else
                {
                    addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                                  "sfz.opcode.orphan", "Opcode appears outside a supported header",
                                  lexeme.line, lexeme.column);
                }
                continue;
            }
            (*current)[lexeme.name.toStdString()] = { lexeme.value, lexeme.line, lexeme.column };
        }
        finalizeRegion();

        if (result.regions.empty() && !result.hasErrors())
            addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                          "sfz.region.required", "SFZ contains no supported regions", 1, 1);
        return result;
    }

    SfzSubsetImport parseSfzSubsetFile(const juce::File& file,
                                       const SfzSubsetParseLimits& limits)
    {
        SfzSubsetImport result;
        result.sourceName = file.getFileName();
        if (!file.existsAsFile())
        {
            addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                          "sfz.file.missing", "SFZ file does not exist", 1, 1);
            return result;
        }
        if (file.getSize() < 0 || file.getSize() > limits.maximumSourceBytes)
        {
            addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                          "sfz.limit.source", "SFZ source-size limit exceeded", 1, 1);
            return result;
        }
        result = parseSfzSubsetText(file.loadFileAsString(), limits);
        result.sourceName = file.getFileName();
        return result;
    }
}

#pragma once

#include <juce_core/juce_core.h>
#include <memory>

struct sqlite3;
struct sqlite3_stmt;

namespace beat
{
    /**
     * Database — thin RAII wrapper over sqlite3.
     *
     * JUCE does not bundle SQLite; on macOS we link the system libsqlite3
     * (already on the SDK), on Windows/Linux we'd vendor sqlite-amalgamation
     * via FetchContent (TODO when we add cross-platform CI).
     *
     * Owns the connection and runs migrations on construction.
     */
    class Database
    {
    public:
        explicit Database(const juce::File& path);
        ~Database();

        sqlite3* raw() { return db; }

        /** Run an SQL statement with no bound parameters. Returns false on error. */
        bool exec(const juce::String& sql);

        /** Last error message, or empty if none. */
        juce::String lastError() const;

    private:
        void migrate();

        sqlite3* db { nullptr };

        JUCE_DECLARE_NON_COPYABLE(Database)
    };

    /** Tiny statement helper used by the repositories. */
    class Statement
    {
    public:
        Statement(Database& db, const juce::String& sql);
        ~Statement();

        Statement& bind(int idx, const juce::String& text);
        Statement& bind(int idx, double value);
        Statement& bind(int idx, int value);
        Statement& bindNull(int idx);

        /** Step once. Returns true if a row is available. */
        bool step();

        juce::String columnText(int col) const;
        double       columnDouble(int col) const;
        int          columnInt(int col) const;

    private:
        sqlite3_stmt* stmt { nullptr };
        Database&     owner;

        JUCE_DECLARE_NON_COPYABLE(Statement)
    };
}

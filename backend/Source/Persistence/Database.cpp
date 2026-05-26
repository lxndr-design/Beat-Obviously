#include "Database.h"
#include <sqlite3.h>

namespace beat
{
    Database::Database(const juce::File& path)
    {
        path.getParentDirectory().createDirectory();
        if (sqlite3_open(path.getFullPathName().toRawUTF8(), &db) != SQLITE_OK)
        {
            DBG("sqlite open failed: " << sqlite3_errmsg(db));
        }
        exec("PRAGMA journal_mode=WAL;");
        exec("PRAGMA synchronous=NORMAL;");
        exec("PRAGMA foreign_keys=ON;");
        migrate();
    }

    Database::~Database()
    {
        if (db) sqlite3_close(db);
    }

    bool Database::exec(const juce::String& sql)
    {
        char* err = nullptr;
        const auto rc = sqlite3_exec(db, sql.toRawUTF8(), nullptr, nullptr, &err);
        if (rc != SQLITE_OK)
        {
            DBG("sqlite exec error: " << (err ? err : "(unknown)"));
            sqlite3_free(err);
            return false;
        }
        return true;
    }

    juce::String Database::lastError() const
    {
        return db ? juce::String::fromUTF8(sqlite3_errmsg(db)) : juce::String();
    }

    void Database::migrate()
    {
        // v1 schema. New migrations are additive — append, never edit history.
        exec(R"sql(
            CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
            INSERT OR IGNORE INTO schema_version VALUES (1);

            CREATE TABLE IF NOT EXISTS projects (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                bpm          REAL NOT NULL,
                length_beats REAL NOT NULL,
                saved_at     INTEGER NOT NULL,
                json_blob    TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS instruments (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                kind       TEXT NOT NULL,
                user_made  INTEGER NOT NULL,
                json_blob  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audio_files (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                path       TEXT NOT NULL,
                duration_s REAL NOT NULL,
                sample_rate INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_projects_saved_at ON projects(saved_at DESC);
        )sql");
    }

    // ---- Statement -------------------------------------------------------

    Statement::Statement(Database& db, const juce::String& sql)
        : owner(db)
    {
        if (sqlite3_prepare_v2(db.raw(), sql.toRawUTF8(), -1, &stmt, nullptr) != SQLITE_OK)
        {
            DBG("sqlite prepare failed: " << db.lastError());
        }
    }

    Statement::~Statement()
    {
        if (stmt) sqlite3_finalize(stmt);
    }

    Statement& Statement::bind(int idx, const juce::String& text)
    {
        sqlite3_bind_text(stmt, idx, text.toRawUTF8(), -1, SQLITE_TRANSIENT);
        return *this;
    }
    Statement& Statement::bind(int idx, double value)
    {
        sqlite3_bind_double(stmt, idx, value);
        return *this;
    }
    Statement& Statement::bind(int idx, int value)
    {
        sqlite3_bind_int(stmt, idx, value);
        return *this;
    }
    Statement& Statement::bindNull(int idx)
    {
        sqlite3_bind_null(stmt, idx);
        return *this;
    }

    bool Statement::step()
    {
        const auto rc = sqlite3_step(stmt);
        return rc == SQLITE_ROW;
    }

    juce::String Statement::columnText(int col) const
    {
        if (auto* p = (const char*) sqlite3_column_text(stmt, col))
            return juce::String::fromUTF8(p);
        return {};
    }
    double Statement::columnDouble(int col) const { return sqlite3_column_double(stmt, col); }
    int    Statement::columnInt(int col)    const { return sqlite3_column_int(stmt, col); }
}

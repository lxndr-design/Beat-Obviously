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
        const auto columnExists = [this](const juce::String& table, const juce::String& column)
        {
            sqlite3_stmt* stmt = nullptr;
            const auto sql = "PRAGMA table_info(" + table + ")";
            if (sqlite3_prepare_v2(db, sql.toRawUTF8(), -1, &stmt, nullptr) != SQLITE_OK)
                return false;
            bool found = false;
            while (sqlite3_step(stmt) == SQLITE_ROW)
            {
                const auto* name = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1));
                if (name != nullptr && column == juce::String::fromUTF8(name))
                {
                    found = true;
                    break;
                }
            }
            sqlite3_finalize(stmt);
            return found;
        };

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
                sample_rate INTEGER NOT NULL,
                bit_depth INTEGER NOT NULL DEFAULT 0,
                size_bytes REAL NOT NULL DEFAULT 0,
                imported_at REAL NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS recent_projects (
                path       TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                opened_at  INTEGER NOT NULL,
                size_bytes REAL NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_projects_saved_at ON projects(saved_at DESC);
            CREATE INDEX IF NOT EXISTS idx_recent_projects_opened_at ON recent_projects(opened_at DESC);
        )sql");

        if (! columnExists("audio_files", "size_bytes"))
            exec("ALTER TABLE audio_files ADD COLUMN size_bytes REAL NOT NULL DEFAULT 0;");
        if (! columnExists("audio_files", "imported_at"))
            exec("ALTER TABLE audio_files ADD COLUMN imported_at REAL NOT NULL DEFAULT 0;");
        if (! columnExists("audio_files", "bit_depth"))
            exec("ALTER TABLE audio_files ADD COLUMN bit_depth INTEGER NOT NULL DEFAULT 0;");
        if (! columnExists("audio_files", "left_peak_dbfs"))
            exec("ALTER TABLE audio_files ADD COLUMN left_peak_dbfs REAL;");
        if (! columnExists("audio_files", "right_peak_dbfs"))
            exec("ALTER TABLE audio_files ADD COLUMN right_peak_dbfs REAL;");
        if (! columnExists("audio_files", "true_peak_dbtp"))
            exec("ALTER TABLE audio_files ADD COLUMN true_peak_dbtp REAL;");
        if (! columnExists("audio_files", "rms_dbfs"))
            exec("ALTER TABLE audio_files ADD COLUMN rms_dbfs REAL;");
        if (! columnExists("audio_files", "crest_factor_db"))
            exec("ALTER TABLE audio_files ADD COLUMN crest_factor_db REAL;");
        if (! columnExists("audio_files", "dc_offset"))
            exec("ALTER TABLE audio_files ADD COLUMN dc_offset REAL;");
        if (! columnExists("audio_files", "clipping_count"))
            exec("ALTER TABLE audio_files ADD COLUMN clipping_count INTEGER NOT NULL DEFAULT 0;");
        if (! columnExists("audio_files", "clipping_ratio"))
            exec("ALTER TABLE audio_files ADD COLUMN clipping_ratio REAL;");
        if (! columnExists("audio_files", "stereo_correlation"))
            exec("ALTER TABLE audio_files ADD COLUMN stereo_correlation REAL;");
        if (! columnExists("audio_files", "integrated_lufs"))
            exec("ALTER TABLE audio_files ADD COLUMN integrated_lufs REAL;");
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
    bool   Statement::columnIsNull(int col) const { return sqlite3_column_type(stmt, col) == SQLITE_NULL; }
}

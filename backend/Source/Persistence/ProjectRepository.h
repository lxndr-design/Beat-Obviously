#pragma once

#include "Database.h"
#include "../Audio/TrackModel.h"
#include <vector>
#include <optional>

namespace beat
{
    /**
     * ProjectRepository — CRUD for Project rows.
     *
     * Projects are stored as JSON blobs alongside a few indexed columns
     * (name, bpm, saved_at). The blob is the source of truth; the columns
     * exist for cheap listing/sorting in the UI.
     *
     * Why JSON-in-SQLite vs. normalized: project shape evolves rapidly in
     * development; normalization would force migrations every time. Once
     * the model stabilizes, we can split out tracks/segments tables.
     */
    class ProjectRepository
    {
    public:
        explicit ProjectRepository(Database& db) : db(db) {}

        void save(const Project& p);
        std::optional<Project> load(const Id& id);
        /** Lightweight listing — id/name/saved_at only. */
        struct Summary { Id id; juce::String name; juce::int64 savedAt; };
        std::vector<Summary> list();
        void remove(const Id& id);

    private:
        Database& db;
    };
}

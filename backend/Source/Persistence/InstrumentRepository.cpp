#include "InstrumentRepository.h"

namespace beat
{
    void InstrumentRepository::save(const juce::String& id, const juce::String& json,
                                    const juce::String& name, const juce::String& kind, bool userMade)
    {
        Statement stmt(db, R"sql(
            INSERT INTO instruments(id, name, kind, user_made, json_blob)
            VALUES(?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              kind = excluded.kind,
              user_made = excluded.user_made,
              json_blob = excluded.json_blob
        )sql");
        stmt.bind(1, id);
        stmt.bind(2, name);
        stmt.bind(3, kind);
        stmt.bind(4, userMade ? 1 : 0);
        stmt.bind(5, json);
        stmt.step();
    }

    std::vector<InstrumentRepository::Row> InstrumentRepository::listAll()
    {
        std::vector<Row> out;
        Statement stmt(db, "SELECT id, json_blob FROM instruments ORDER BY name ASC");
        while (stmt.step()) out.push_back({ stmt.columnText(0), stmt.columnText(1) });
        return out;
    }

    void InstrumentRepository::remove(const juce::String& id)
    {
        Statement stmt(db, "DELETE FROM instruments WHERE id = ?");
        stmt.bind(1, id);
        stmt.step();
    }
}

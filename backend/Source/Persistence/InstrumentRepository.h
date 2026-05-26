#pragma once

#include "Database.h"
#include <juce_core/juce_core.h>
#include <vector>

namespace beat
{
    /**
     * InstrumentRepository — store user-created instruments verbatim as
     * JSON blobs. The frontend owns the instrument schema; the backend
     * just persists what it receives.
     */
    class InstrumentRepository
    {
    public:
        explicit InstrumentRepository(Database& db) : db(db) {}

        void save(const juce::String& id, const juce::String& jsonBlob, const juce::String& name,
                  const juce::String& kind, bool userMade);

        struct Row { juce::String id; juce::String json; };
        std::vector<Row> listAll();
        void remove(const juce::String& id);

    private:
        Database& db;
    };
}

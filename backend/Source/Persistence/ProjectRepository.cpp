#include "ProjectRepository.h"

namespace beat
{
    namespace
    {
        // Minimal JSON encoder for Project. juce::JSON handles var → string;
        // we build a juce::var tree and let it serialize.
        juce::var trackToVar(const Track& t)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("id",        t.id);
            o->setProperty("name",      t.name);
            o->setProperty("kind",      (int) t.kind);
            o->setProperty("instrumentId", t.instrumentId);
            o->setProperty("audioFileId",  t.audioFileId);
            o->setProperty("gainDb",    t.gainDb);
            o->setProperty("pan",       t.pan);
            o->setProperty("mute",      t.mute);
            o->setProperty("solo",      t.solo);

            juce::Array<juce::var> segArr;
            for (const auto& s : t.segments)
            {
                juce::DynamicObject::Ptr so = new juce::DynamicObject();
                so->setProperty("id",          s.id);
                so->setProperty("startBeat",   s.startBeat);
                so->setProperty("lengthBeats", s.lengthBeats);
                so->setProperty("repeats",     s.repeats);
                so->setProperty("layer",       s.layer);
                so->setProperty("muted",       s.muted);
                so->setProperty("kind",        (int) s.kind);
                so->setProperty("audioFileId", s.audioFileId);
                so->setProperty("audioGainDb", s.audioGainDb);

                juce::Array<juce::var> notesArr;
                for (const auto& n : s.notes)
                {
                    juce::DynamicObject::Ptr no = new juce::DynamicObject();
                    no->setProperty("pitch",      n.pitch);
                    no->setProperty("velocity",   n.velocity);
                    no->setProperty("startBeat",  n.startBeat);
                    no->setProperty("lengthBeats",n.lengthBeats);
                    notesArr.add(juce::var(no.get()));
                }
                so->setProperty("notes", notesArr);
                segArr.add(juce::var(so.get()));
            }
            o->setProperty("segments", segArr);
            return juce::var(o.get());
        }

        juce::String projectToJson(const Project& p)
        {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty("id",         p.id);
            o->setProperty("name",       p.name);
            o->setProperty("bpm",        p.bpm);
            o->setProperty("lengthBeats",p.lengthBeats);
            o->setProperty("tsNum",      p.timeSignatureNum);
            o->setProperty("tsDenom",    p.timeSignatureDenom);

            juce::Array<juce::var> trackArr;
            for (const auto& t : p.tracks) trackArr.add(trackToVar(t));
            o->setProperty("tracks", trackArr);

            juce::Array<juce::var> eqArr;
            for (const auto& e : p.eqAutomation)
            {
                juce::DynamicObject::Ptr eo = new juce::DynamicObject();
                eo->setProperty("atBeat", e.atBeat);
                eo->setProperty("lowDb",  e.lowDb);
                eo->setProperty("midDb",  e.midDb);
                eo->setProperty("highDb", e.highDb);
                eo->setProperty("airDb",  e.airDb);
                eqArr.add(juce::var(eo.get()));
            }
            o->setProperty("eqAutomation", eqArr);

            return juce::JSON::toString(juce::var(o.get()), true);
        }

        Project projectFromJson(const juce::String& json)
        {
            Project p;
            auto parsed = juce::JSON::parse(json);
            if (!parsed.isObject()) return p;

            p.id                 = parsed.getProperty("id", "").toString();
            p.name               = parsed.getProperty("name", "Untitled").toString();
            p.bpm                = (double) parsed.getProperty("bpm", 120.0);
            p.lengthBeats        = (double) parsed.getProperty("lengthBeats", 64.0);
            p.timeSignatureNum   = (int)    parsed.getProperty("tsNum", 4);
            p.timeSignatureDenom = (int)    parsed.getProperty("tsDenom", 4);

            if (auto* tracks = parsed.getProperty("tracks", {}).getArray())
            {
                for (const auto& tv : *tracks)
                {
                    Track t;
                    t.id    = tv.getProperty("id", "").toString();
                    t.name  = tv.getProperty("name", "").toString();
                    t.kind  = (TrackKind) (int) tv.getProperty("kind", 0);
                    t.instrumentId = tv.getProperty("instrumentId", "").toString();
                    t.audioFileId  = tv.getProperty("audioFileId", "").toString();
                    t.gainDb = (float) (double) tv.getProperty("gainDb", 0.0);
                    t.pan    = (float) (double) tv.getProperty("pan", 0.0);
                    t.mute   = (bool) tv.getProperty("mute", false);
                    t.solo   = (bool) tv.getProperty("solo", false);

                    if (auto* segs = tv.getProperty("segments", {}).getArray())
                    {
                        for (const auto& sv : *segs)
                        {
                            Segment s;
                            s.id          = sv.getProperty("id", "").toString();
                            s.trackId     = t.id;
                            s.startBeat   = (double) sv.getProperty("startBeat", 0.0);
                            s.lengthBeats = (double) sv.getProperty("lengthBeats", 4.0);
                            s.repeats     = (int) sv.getProperty("repeats", 0);
                            s.layer       = (int) sv.getProperty("layer", 0);
                            s.muted       = (bool) sv.getProperty("muted", false);
                            s.kind        = (SegmentPayloadKind) (int) sv.getProperty("kind", 1);
                            s.audioFileId = sv.getProperty("audioFileId", "").toString();
                            s.audioGainDb = (float) (double) sv.getProperty("audioGainDb", 0.0);

                            if (auto* notes = sv.getProperty("notes", {}).getArray())
                            {
                                for (const auto& nv : *notes)
                                {
                                    MidiNote n;
                                    n.pitch       = (int) nv.getProperty("pitch", 60);
                                    n.velocity    = (int) nv.getProperty("velocity", 100);
                                    n.startBeat   = (double) nv.getProperty("startBeat", 0.0);
                                    n.lengthBeats = (double) nv.getProperty("lengthBeats", 0.25);
                                    s.notes.push_back(n);
                                }
                            }
                            t.segments.push_back(std::move(s));
                        }
                    }
                    p.tracks.push_back(std::move(t));
                }
            }

            if (auto* eq = parsed.getProperty("eqAutomation", {}).getArray())
            {
                for (const auto& ev : *eq)
                {
                    EqAutomationPoint e;
                    e.atBeat = (double) ev.getProperty("atBeat", 0.0);
                    e.lowDb  = (float) (double) ev.getProperty("lowDb", 0.0);
                    e.midDb  = (float) (double) ev.getProperty("midDb", 0.0);
                    e.highDb = (float) (double) ev.getProperty("highDb", 0.0);
                    e.airDb  = (float) (double) ev.getProperty("airDb", 0.0);
                    p.eqAutomation.push_back(e);
                }
            }
            return p;
        }
    }

    void ProjectRepository::save(const Project& p)
    {
        Statement stmt(db, R"sql(
            INSERT INTO projects(id, name, bpm, length_beats, saved_at, json_blob)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              bpm = excluded.bpm,
              length_beats = excluded.length_beats,
              saved_at = excluded.saved_at,
              json_blob = excluded.json_blob
        )sql");
        stmt.bind(1, p.id);
        stmt.bind(2, p.name);
        stmt.bind(3, (double) p.bpm);
        stmt.bind(4, (double) p.lengthBeats);
        stmt.bind(5, (int) (juce::Time::currentTimeMillis() / 1000));
        stmt.bind(6, projectToJson(p));
        stmt.step();
    }

    std::optional<Project> ProjectRepository::load(const Id& id)
    {
        Statement stmt(db, "SELECT json_blob FROM projects WHERE id = ?");
        stmt.bind(1, id);
        if (!stmt.step()) return std::nullopt;
        return projectFromJson(stmt.columnText(0));
    }

    std::vector<ProjectRepository::Summary> ProjectRepository::list()
    {
        std::vector<Summary> out;
        Statement stmt(db, "SELECT id, name, saved_at FROM projects ORDER BY saved_at DESC");
        while (stmt.step())
        {
            out.push_back({ stmt.columnText(0), stmt.columnText(1), (juce::int64) stmt.columnInt(2) });
        }
        return out;
    }

    void ProjectRepository::remove(const Id& id)
    {
        Statement stmt(db, "DELETE FROM projects WHERE id = ?");
        stmt.bind(1, id);
        stmt.step();
    }
}

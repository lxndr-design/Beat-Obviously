# Beat Python runtime locks

These files capture the complete version sets verified for Beat's optional
local audio and score-recognition engines. Setup scripts require the named
macOS Python version and refuse an existing environment created by a different
interpreter.

Do not refresh a lock merely because a newer package exists. Update one engine
at a time, run its setup script, `pip check`, the corresponding Beat verifier,
and the relevant golden audio or score fixtures before committing the new set.
Core engine release freshness is checked by `npm run audit:dependencies`.

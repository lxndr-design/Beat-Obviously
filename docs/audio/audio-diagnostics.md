# Audio diagnostics

Beat writes a persistent native diagnostic log to:

`~/Library/Logs/Beat/Beat-debug.log`

Each entry includes a wall-clock timestamp and category. The log records:

- Application, main-window, database, audio-engine, bridge, and frontend readiness.
- Project file-load and engine-apply durations.
- Play, pause, stop, and restart request and acknowledgment times.
- A five-second playback heartbeat with callback load, position, voice count, and route count.
- Deadline overruns, automatic overload safety mutes, bounded note-off queue overflows, audio-callback lock misses, and message-thread stalls.
- Orderly application and audio-engine shutdown.

The audio callback only updates preallocated state and atomic counters. File logging is performed by the application/message thread so diagnostics cannot add filesystem work to the realtime callback.

The collapsed log button at the lower-left of the editor opens the in-app **Debug Log** viewer. It displays the newest 500 lines, refreshes once per second while open, remains pinned to the newest entry unless the user has scrolled upward, and provides explicit refresh and copy controls. The viewer reads a bounded 256 KiB tail on the application thread; it never performs file I/O on the realtime callback. The in-app Render Timing panel separately exposes deadline, automatic-mute, note-queue, and lock-miss counters under **Safety**.

Pause and Stop are hard silence boundaries. They atomically replace native device output with zeroes before trying to acquire project/runtime state, clear voices, samples, audio clips, queued note-offs, automation, route effects, and effect tails when that state becomes available, and cancel registered browser preview owners. Eight consecutive missed realtime callback deadlines trigger the same safety silence automatically. This automatic overload policy is disabled for offline rendering.

If Play appears unresponsive, the frontend waits at most 1.5 seconds for native acknowledgment, reports the failure in its console, and restores the non-playing UI state. The native log distinguishes a missing request, a slow acknowledgment, project-load contention, and callback overload.

For an unsafe or unexpectedly loud result, press Pause or Stop once, lower or disconnect monitoring, quit Beat, and retain `Beat-debug.log` before relaunching. Do not repeatedly replay the same project merely to obtain additional logs.

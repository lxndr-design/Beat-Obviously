import type { Id, ReturnBus, TrackSend } from "./types";

export interface AudioBusRoutingIssue {
  code: "audioBus.route.self" | "audioBus.route.cycle";
  busId: Id;
  destinationBusId: Id;
}

export function audioBusExists(buses: ReturnBus[], busId: Id | undefined): boolean {
  return !busId || buses.some((bus) => bus.id === busId);
}

export function audioBusDestinations(bus: ReturnBus): Id[] {
  const destinations: Id[] = [];
  if (bus.outputEnabled !== false && bus.outputBusId) destinations.push(bus.outputBusId);
  for (const send of bus.sends ?? []) {
    if (send.enabled && send.busId) destinations.push(send.busId);
  }
  return destinations;
}

export function validateAudioBusRouting(buses: ReturnBus[]): AudioBusRoutingIssue[] {
  const ids = new Set(buses.map((bus) => bus.id));
  const graph = new Map<Id, Id[]>();
  for (const bus of buses) {
    graph.set(bus.id, audioBusDestinations(bus).filter((destination) => ids.has(destination)));
  }

  const issues: AudioBusRoutingIssue[] = [];
  const visiting = new Set<Id>();
  const visited = new Set<Id>();
  const visit = (busId: Id): boolean => {
    if (visiting.has(busId)) return true;
    if (visited.has(busId)) return false;
    visiting.add(busId);
    let cyclic = false;
    for (const destination of graph.get(busId) ?? []) {
      if (destination === busId) {
        issues.push({ code: "audioBus.route.self", busId, destinationBusId: destination });
        cyclic = true;
      } else if (visit(destination)) {
        issues.push({ code: "audioBus.route.cycle", busId, destinationBusId: destination });
        cyclic = true;
      }
    }
    visiting.delete(busId);
    visited.add(busId);
    return cyclic;
  };
  for (const bus of buses) visit(bus.id);
  return dedupeIssues(issues);
}

export function canSetAudioBusOutput(buses: ReturnBus[], busId: Id, destinationBusId?: Id): boolean {
  if (!buses.some((bus) => bus.id === busId) || !audioBusExists(buses, destinationBusId)) return false;
  const next = buses.map((bus) => bus.id === busId ? { ...bus, outputBusId: destinationBusId } : bus);
  return validateAudioBusRouting(next).length === 0;
}

export function canSetAudioBusSend(
  buses: ReturnBus[],
  busId: Id,
  destinationBusId: Id,
  patch: Partial<TrackSend>,
): boolean {
  if (!destinationBusId || !buses.some((bus) => bus.id === busId) || !audioBusExists(buses, destinationBusId)) return false;
  const next = buses.map((bus) => {
    if (bus.id !== busId) return bus;
    const sends = [...(bus.sends ?? [])];
    const index = sends.findIndex((send) => send.busId === destinationBusId);
    const send: TrackSend = {
      gainDb: -12,
      pan: 0,
      enabled: true,
      preFader: false,
      ...(index >= 0 ? sends[index] : {}),
      ...patch,
      busId: destinationBusId,
    };
    if (index >= 0) sends[index] = send;
    else sends.push(send);
    return { ...bus, sends };
  });
  return validateAudioBusRouting(next).length === 0;
}

function dedupeIssues(issues: AudioBusRoutingIssue[]): AudioBusRoutingIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.busId}:${issue.destinationBusId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

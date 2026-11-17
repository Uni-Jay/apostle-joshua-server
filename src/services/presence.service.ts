/**
 * Who on the team is online for live chat. Admin dashboards ping every ~25 seconds while open;
 * someone counts as online for 70 seconds after their last ping, if they marked themselves available.
 * Kept in memory: after a server restart everyone shows offline until their dashboard pings again.
 */
const seen = new Map<number, { name: string; at: number; available: boolean }>();
const WINDOW = 70_000;

export function ping(id: number, name: string, available: boolean) { seen.set(id, { name, at: Date.now(), available }); }
export function goOffline(id: number) { seen.delete(id); }
export function onlineAgents(): string[] {
  const now = Date.now();
  return [...seen.values()].filter((v) => v.available && now - v.at < WINDOW).map((v) => v.name);
}

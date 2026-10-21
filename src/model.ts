export interface Adapter {
  id: string;
  name: string;
  description: string;
  admin: number;
  media: number;
  problem: number | null;
}
export interface Snapshot {
  adapters: Adapter[];
  selected: string | null;
  muted: boolean;
  elevated: boolean;
}
export type LinkState =
  "enabled" | "disabled" | "missing" | "unselected" | "unknown";
export function selectedAdapter(snapshot: Snapshot): Adapter | undefined {
  return snapshot.adapters.find((adapter) => adapter.id === snapshot.selected);
}
export function linkState(snapshot: Snapshot): LinkState {
  if (!snapshot.selected) return "unselected";
  const adapter = selectedAdapter(snapshot);
  if (!adapter) return "missing";
  if (adapter.problem === 22) return "disabled";
  if (adapter.problem !== null && adapter.problem !== 0) return "unknown";
  if (adapter.admin === 2) return "disabled";
  if (adapter.admin === 1) return "enabled";
  return "unknown";
}
export function canToggle(
  snapshot: Snapshot,
  armed: boolean,
  busy: boolean,
): boolean {
  const state = linkState(snapshot);
  return (
    armed &&
    !busy &&
    snapshot.elevated &&
    (state === "enabled" || state === "disabled")
  );
}
export function verifyResult(
  snapshot: Snapshot,
  id: string,
  enabled: boolean,
): boolean {
  return (
    snapshot.selected === id &&
    linkState(snapshot) === (enabled ? "enabled" : "disabled")
  );
}

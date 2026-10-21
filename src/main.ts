import { getCurrentWindow, invoke } from "./native.js";
import { backend, native } from "./backend.js";
import {
  canToggle,
  linkState,
  selectedAdapter,
  verifyResult,
  type Snapshot,
} from "./model.js";
import { play, setMuted } from "./sound.js";

const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let snapshot: Snapshot = {
  adapters: [],
  selected: null,
  muted: false,
  elevated: false,
};
let armed = false;
let busy = false;
let polling = false;
let stale = true;
let error = "";
let message = "";
let messageUntil = 0;
let armTimer: ReturnType<typeof setTimeout> | undefined;
document.body.dataset.preview = String(!native);
el("mode").textContent = native ? "LOCAL" : "DEMO";

function disarm(): void {
  armed = false;
  clearTimeout(armTimer);
  render();
}
function render(): void {
  const state = linkState(snapshot);
  const adapter = selectedAdapter(snapshot);
  const readOnly = native && !snapshot.elevated && !stale;
  el("mode").textContent = !native
    ? "DEMO"
    : snapshot.elevated
      ? "LOCAL"
      : "VIEW";
  document.body.classList.toggle("armed", armed);
  document.body.dataset.state = busy
    ? "busy"
    : error
      ? "error"
      : stale
        ? "unknown"
        : state;
  el("cover").setAttribute("aria-expanded", String(armed));
  el<HTMLButtonElement>("cover").disabled =
    busy ||
    polling ||
    stale ||
    readOnly ||
    !["enabled", "disabled"].includes(state);
  el<HTMLButtonElement>("trigger").disabled =
    stale || polling || !canToggle(snapshot, armed, busy);
  el("trigger").setAttribute(
    "aria-label",
    state === "disabled"
      ? "Restore selected Ethernet connection"
      : "Sever selected Ethernet connection",
  );
  el("button-label").textContent = readOnly
    ? "ADMIN REQUIRED"
    : state === "disabled"
      ? "RESTORE LINK"
      : "SEVER LINK";
  const blockedReason = busy
    ? "Windows is processing the adapter request."
    : stale
      ? "Adapter state is unverified. Rescan in CONFIG."
      : readOnly
        ? "Close the app, right-click the executable, and choose Run as administrator."
        : state === "unselected"
          ? "Select an Ethernet adapter in CONFIG first."
          : state === "missing"
            ? "The selected adapter is missing. Check CONFIG."
            : state === "unknown"
              ? "Windows cannot confirm the adapter state."
              : polling
                ? "Refreshing Windows adapter state."
                : !armed
                  ? "Lift the safety cover to arm the button."
                  : "";
  el("trigger").title =
    blockedReason || "Press to toggle the selected Ethernet adapter.";
  el("cover").title = el<HTMLButtonElement>("cover").disabled
    ? blockedReason
    : "Lift to arm the button.";
  el("cover-action").textContent = readOnly ? "RUN AS ADMIN" : "LIFT TO ARM";
  el("arm-label").textContent = armed
    ? "ARMED / AWAITING INPUT"
    : "SAFETY ENGAGED";
  el("disarm").hidden = !armed || busy;
  el("adapter-label").textContent =
    adapter?.name ??
    (snapshot.selected ? "TARGET MISSING" : "NO TARGET SELECTED");
  el("adapter-label").title = adapter?.description ?? "";
  const labels = {
    enabled: "ETHERNET LINK: ACTIVE",
    disabled: "CONNECTION SEVERED",
    missing: "TARGET NOT PRESENT",
    unselected: "SELECT TARGET ADAPTER",
    unknown: "STATE UNAVAILABLE",
  };
  el("status").textContent = busy
    ? message
    : error
      ? "OPERATION FAILED"
      : stale
        ? "STATUS UNVERIFIED"
        : Date.now() < messageUntil
          ? message
          : labels[state];
  el("detail").textContent =
    error ||
    (busy
      ? "Requesting Windows / verifying actual state"
      : stale
        ? "Rescan to establish the actual state"
        : state === "enabled"
          ? adapter?.media === 1
            ? "Adapter enabled · physical link detected"
            : "Adapter enabled · no physical link detected"
          : state === "disabled"
            ? "Administratively disabled · press to restore"
            : state === "missing"
              ? "Original adapter missing · no fallback selected"
              : state === "unknown"
                ? "Driver state unknown · operation inhibited"
                : "Open CONFIG to assign a physical adapter");
  el("detail").title = el("detail").textContent ?? "";
  if (!busy && !error && !stale && native && !snapshot.elevated) {
    if (state === "enabled" || state === "disabled") {
      el("status").textContent = "READ-ONLY / ADMIN REQUIRED";
      el("detail").textContent =
        state === "enabled"
          ? "Adapter enabled · Run as administrator to operate"
          : "Adapter disabled · Run as administrator to restore";
    } else {
      el("detail").textContent = "Read-only · Run as administrator to operate";
    }
    el("detail").title = el("detail").textContent ?? "";
  }
  el("mute").textContent = snapshot.muted ? "MUTE" : "SND";
  el("mute").setAttribute("aria-pressed", String(snapshot.muted));
  el("mute").setAttribute(
    "aria-label",
    snapshot.muted ? "Unmute sound" : "Mute sound",
  );
  el("privilege").textContent = native
    ? snapshot.elevated
      ? "Administrator session. Windows policy still applies."
      : "Read-only session. Close and explicitly Run as administrator to operate the button. This app never elevates itself."
    : "SIMULATION ONLY. No Windows adapter is modified.";
  el<HTMLSelectElement>("adapters").disabled = busy || polling;
  el<HTMLButtonElement>("refresh").disabled = busy || polling;
  el<HTMLButtonElement>("close").disabled = busy || polling;
  el("close").title =
    busy || polling ? "Waiting for Windows to finish" : "Close";
  setMuted(snapshot.muted);
}
function update(next: Snapshot): void {
  if (
    snapshot.selected !== next.selected ||
    linkState(snapshot) !== linkState(next)
  ) {
    armed = false;
    clearTimeout(armTimer);
    messageUntil = 0;
  }
  snapshot = next;
  stale = false;
  const select = el<HTMLSelectElement>("adapters");
  select.replaceChildren(
    new Option(
      snapshot.adapters.length
        ? "Select an adapter…"
        : "No eligible PCI Ethernet adapters found",
      "",
    ),
  );
  if (snapshot.selected && !selectedAdapter(snapshot))
    select.add(new Option("Selected adapter is missing", snapshot.selected));
  for (const adapter of snapshot.adapters)
    select.add(new Option(adapter.name, adapter.id));
  select.value = snapshot.selected ?? "";
  render();
}
function fail(reason: unknown): void {
  error = String(reason instanceof Error ? reason.message : reason);
  el("error-message").textContent = error;
  el("error-panel").hidden = false;
  disarm();
  play("failure");
  el("console").classList.remove("failure");
  void el("console").offsetWidth;
  el("console").classList.add("failure");
  render();
}
async function refresh(manual = false): Promise<void> {
  if (busy || polling) return;
  polling = true;
  render();
  try {
    update(await backend.snapshot());
    if (manual) {
      error = "";
      el("error-panel").hidden = true;
    }
  } catch (reason) {
    stale = true;
    armed = false;
    if (manual || !error) fail(reason);
  } finally {
    polling = false;
    render();
  }
}
function settings(open: boolean): void {
  el("settings").hidden = !open;
  el("settings-toggle").setAttribute("aria-expanded", String(open));
  if (open) {
    disarm();
    el("settings-close").focus({ preventScroll: true });
  } else el("settings-toggle").focus({ preventScroll: true });
}
el("cover").addEventListener("click", () => {
  if (busy || stale || polling) return;
  error = "";
  armed = true;
  play("cover");
  render();
  armTimer = setTimeout(disarm, 15000);
  // Focus after the hinged cover clears the control.
  setTimeout(() => {
    if (armed) el("trigger").focus({ preventScroll: true });
  }, 650);
});
el("disarm").addEventListener("click", disarm);
el("trigger").addEventListener("click", async () => {
  if (
    stale ||
    polling ||
    !canToggle(snapshot, armed, busy) ||
    !snapshot.selected
  )
    return;
  const id = snapshot.selected;
  const expectedEnabled = linkState(snapshot) === "enabled";
  busy = true;
  error = "";
  clearTimeout(armTimer);
  message = expectedEnabled
    ? "INITIATING DISCONNECTION"
    : "RESTORING CONNECTION";
  play("click");
  play("siren");
  render();
  try {
    const next = await backend.toggle(id, expectedEnabled);
    update(next);
    if (!verifyResult(next, id, !expectedEnabled))
      throw new Error(
        "Windows did not confirm the requested adapter state. Rescan before retrying.",
      );
    message = expectedEnabled ? "CONNECTION SEVERED" : "ETHERNET LINK RESTORED";
    messageUntil = Date.now() + 4000;
    play(expectedEnabled ? "sever" : "restore");
  } catch (reason) {
    stale = true;
    fail(reason);
  } finally {
    busy = false;
    disarm();
    await refresh();
  }
});
el("settings-toggle").addEventListener("click", () =>
  settings(el("settings").hidden),
);
el("settings-close").addEventListener("click", () => settings(false));
el("refresh").addEventListener("click", () => {
  void refresh(true);
});
el("error-dismiss").addEventListener("click", () => {
  el("error-panel").hidden = true;
});
el("error-rescan").addEventListener("click", () => {
  void refresh(true);
});
el("adapters").addEventListener("change", async () => {
  if (busy || polling) return;
  const id = el<HTMLSelectElement>("adapters").value;
  if (!id) {
    el<HTMLSelectElement>("adapters").value = snapshot.selected ?? "";
    render();
    return;
  }
  polling = true;
  disarm();
  try {
    update(await backend.select(id));
    error = "";
  } catch (reason) {
    fail(reason);
  } finally {
    polling = false;
    render();
  }
});
el("mute").addEventListener("click", async () => {
  const muted = !snapshot.muted;
  // Silence active oscillators immediately, even while Windows is working.
  snapshot.muted = muted;
  render();
  try {
    await backend.mute(muted);
  } catch (reason) {
    snapshot.muted = !muted;
    fail(reason);
  }
});
el("minimize").addEventListener("click", () => {
  disarm();
  if (native) void invoke("minimize_to_tray").catch(fail);
  else {
    message = "TRAY / DESKTOP APP ONLY";
    messageUntil = Date.now() + 3000;
    render();
  }
});
el("close").addEventListener("click", () => {
  if (native) void getCurrentWindow().close().catch(fail);
  else {
    message = "PREVIEW / CLOSE TAB";
    messageUntil = Date.now() + 3000;
    render();
  }
});
el("drag-region").addEventListener("pointerdown", (event) => {
  if (
    native &&
    event.button === 0 &&
    !(event.target as HTMLElement).closest("button")
  )
    void getCurrentWindow().startDragging().catch(fail);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    disarm();
    settings(false);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) disarm();
  else void refresh();
});
window.addEventListener("blur", () => {
  if (!busy) disarm();
});
await refresh();
if (!snapshot.selected) settings(true);
// Recursive timeout ensures there can never be a backlog of polls.
async function poll(): Promise<void> {
  await refresh();
  setTimeout(
    () => {
      void poll();
    },
    document.hidden ? 10000 : 3000,
  );
}
setTimeout(() => {
  void poll();
}, 3000);

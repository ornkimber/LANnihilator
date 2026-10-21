import { invoke, native } from "./native.js";
import type { Snapshot } from "./model.ts";
import { linkState } from "./model.js";

export { native };
// Browser preview is deliberately isolated from native adapter control.
const demo: Snapshot = {
  adapters: [
    {
      id: "demo-pci-ethernet",
      name: "Ethernet / SIMULATION",
      description: "Mock physical Ethernet controller",
      admin: 1,
      media: 1,
      problem: 0,
    },
  ],
  selected: null,
  muted: localStorage.getItem("demo-muted") === "true",
  elevated: true,
};
let demoBusy = false;
export const backend = {
  async snapshot(): Promise<Snapshot> {
    return native ? invoke("snapshot") : structuredClone(demo);
  },
  async select(id: string): Promise<Snapshot> {
    if (native) return invoke("select_adapter", { id });
    if (demoBusy) throw new Error("An operation is already in progress.");
    if (!demo.adapters.some((adapter) => adapter.id === id))
      throw new Error("Adapter not found.");
    demo.selected = id;
    return structuredClone(demo);
  },
  async toggle(id: string, expectedEnabled: boolean): Promise<Snapshot> {
    if (native) return invoke("toggle_adapter", { id, expectedEnabled });
    if (demoBusy) throw new Error("An operation is already in progress.");
    if (
      demo.selected !== id ||
      (linkState(demo) === "enabled") !== expectedEnabled
    )
      throw new Error("Adapter state changed. Please try again.");
    demoBusy = true;
    try {
      await new Promise((resolve) => setTimeout(resolve, 650));
      if (new URLSearchParams(location.search).has("fail"))
        throw new Error("SIMULATED: Windows rejected the operation.");
      demo.adapters[0].admin = expectedEnabled ? 2 : 1;
      demo.adapters[0].media = expectedEnabled ? 2 : 1;
      return structuredClone(demo);
    } finally {
      demoBusy = false;
    }
  },
  async mute(muted: boolean): Promise<void> {
    if (native) return invoke("set_mute", { muted });
    demo.muted = muted;
    localStorage.setItem("demo-muted", String(muted));
  },
};

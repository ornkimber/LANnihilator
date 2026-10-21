import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canToggle,
  linkState,
  selectedAdapter,
  verifyResult,
  type Snapshot,
} from "../src/model.ts";

const base = (): Snapshot => ({
  adapters: [
    {
      id: "stable-id",
      name: "Ethernet",
      description: "PCI Ethernet",
      admin: 1,
      media: 1,
      problem: 0,
    },
  ],
  selected: "stable-id",
  muted: false,
  elevated: true,
});
test("selection uses stable identity across a display name change", () => {
  const value = base();
  value.adapters[0].name = "Renamed Ethernet";
  assert.equal(selectedAdapter(value)?.id, "stable-id");
});
test("missing adapter never falls back to another adapter", () => {
  const value = base();
  value.adapters[0].id = "other";
  assert.equal(linkState(value), "missing");
  assert.equal(canToggle(value, true, false), false);
});
test("no selection means no operation, even with one adapter", () => {
  const value = base();
  value.selected = null;
  assert.equal(linkState(value), "unselected");
  assert.equal(canToggle(value, true, false), false);
});
test("unplugged Ethernet is still enabled", () => {
  const value = base();
  value.adapters[0].media = 2;
  assert.equal(linkState(value), "enabled");
  assert.equal(canToggle(value, true, false), true);
});
test("administratively disabled Ethernet is reversible", () => {
  const value = base();
  value.adapters[0].admin = 2;
  assert.equal(linkState(value), "disabled");
  assert.equal(canToggle(value, true, false), true);
});
test("unknown or faulty states inhibit operation", () => {
  const value = base();
  value.adapters[0].admin = 3;
  assert.equal(linkState(value), "unknown");
  assert.equal(canToggle(value, true, false), false);
  value.adapters[0].admin = 1;
  value.adapters[0].problem = 10;
  assert.equal(linkState(value), "unknown");
});
test("disarmed, busy and non-admin sessions cannot operate", () => {
  assert.equal(canToggle(base(), false, false), false);
  assert.equal(canToggle(base(), true, true), false);
  const value = base();
  value.elevated = false;
  assert.equal(canToggle(value, true, false), false);
});
test("success needs both the same target and the requested actual state", () => {
  assert.equal(verifyResult(base(), "stable-id", false), false);
  assert.equal(verifyResult(base(), "other", true), false);
  assert.equal(verifyResult(base(), "stable-id", true), true);
});
test("nullable driver-error metadata does not block known administrative states", () => {
  const value = base();
  value.adapters[0].problem = null;
  assert.equal(linkState(value), "enabled");
  assert.equal(canToggle(value, true, false), true);
  value.adapters[0].admin = 2;
  assert.equal(linkState(value), "disabled");
  assert.equal(verifyResult(value, "stable-id", false), true);
  value.adapters[0].admin = 0;
  assert.equal(linkState(value), "unknown");
  assert.equal(canToggle(value, true, false), false);
  value.adapters[0].admin = 2;
  value.adapters[0].problem = 10;
  assert.equal(linkState(value), "unknown");
  assert.equal(canToggle(value, true, false), false);
});

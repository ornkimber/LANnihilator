import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = readFileSync(
  new URL("../src-tauri/src/netadapter.ps1", import.meta.url),
  "utf8",
);
const id = "12345678-abcd-4000-8000-000000000001";
const fixture = (changes: Record<string, unknown> = {}) => ({
  InterfaceGuid: id,
  Name: "Renamed'; injected",
  InterfaceDescription: "Physical controller",
  HardwareInterface: true,
  Virtual: false,
  InterfaceType: 6,
  NdisPhysicalMedium: 14,
  PNPDeviceID: "PCI\\VEN_1234",
  InterfaceAdminStatus: 1,
  MediaConnectState: 2,
  ConfigManagerErrorCode: 0,
  AdminLocked: false,
  ...changes,
});

function run(
  devices: object[],
  options: {
    toggle?: boolean;
    enabled?: boolean;
    elevated?: boolean;
    confirm?: boolean;
    code?: number;
    target?: string;
    transitionReads?: number;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "brb-provider-"));
  const trace = join(directory, "mutations.json");
  const encoded = Buffer.from(JSON.stringify(devices)).toString("base64");
  const prelude = `
    $Action = '${options.toggle ? "toggle" : "read"}'
    $TargetGuid = '${options.target ?? id}'
    $ExpectedEnabled = $${options.enabled ?? true}
    $script:transitionReads = ${options.transitionReads ?? 0}
    $script:mutated = $false
    $script:devices = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
    function Get-CimInstance {
      param($Namespace, $ClassName)
      if ($script:mutated -and $script:transitionReads -gt 0) {
        $script:transitionReads--
        foreach ($device in $script:devices) {
          $copy = $device | Select-Object *
          $copy.InterfaceAdminStatus = 0
          $copy.ConfigManagerErrorCode = $null
          $copy
        }
      } else { $script:devices }
    }
    function Start-Sleep { param($Milliseconds) }
    function Invoke-CimMethod {
      param($InputObject, $MethodName)
      $script:mutated = $true
      @{ id = $InputObject.InterfaceGuid; method = $MethodName } | ConvertTo-Json | Set-Content -LiteralPath '${trace.replaceAll("'", "''")}'
      if ($${options.confirm ?? true}) {
        $InputObject.InterfaceAdminStatus = $(if ($MethodName -eq 'Disable') { 2 } else { 1 })
      }
      @{ ReturnValue = ${options.code ?? 0} }
    }
  `;
  // Replace ONLY privilege detection for deterministic tests; production code
  // always uses the actual Windows access token. No real cmdlets can be called.
  const body = script.replace(
    "$elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
    `$elevated = $${options.elevated ?? true}`,
  );
  try {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", prelude + body],
      { encoding: "utf8", timeout: 15000, windowsHide: true },
    );
    assert.ifError(result.error);
    const mutation = existsSync(trace)
      ? JSON.parse(readFileSync(trace, "utf8").replace(/^\uFEFF/, ""))
      : null;
    return { ...result, mutation };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const windows = { skip: process.platform !== "win32" };
test(
  "provider excludes Wi-Fi, USB, virtual Ethernet, Bluetooth and non-Ethernet PCI devices",
  windows,
  () => {
    const result = run([
      fixture(),
      fixture({ InterfaceType: 71, NdisPhysicalMedium: 9 }),
      fixture({ PNPDeviceID: "USB\\TETHER" }),
      fixture({ Virtual: true }),
      fixture({ HardwareInterface: false }),
      fixture({ NdisPhysicalMedium: 0 }),
    ]);
    assert.equal(result.status, 0, result.stderr);
    const response = JSON.parse(result.stdout);
    assert.equal(response.adapters.length, 1);
    assert.equal(response.adapters[0].name, "Renamed'; injected");
    assert.equal(response.adapters[0].admin, 1);
    assert.equal(response.adapters[0].media, 2);
    assert.equal(result.mutation, null);
  },
);
test(
  "disable and restore act only on exact GUID, and return verified state",
  windows,
  () => {
    for (const enabled of [true, false]) {
      const result = run(
        [
          fixture({ InterfaceAdminStatus: enabled ? 1 : 2 }),
          fixture({ InterfaceGuid: "00000000-0000-0000-0000-000000000000" }),
        ],
        { toggle: true, enabled },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.mutation, {
        id,
        method: enabled ? "Disable" : "Enable",
      });
      assert.equal(
        JSON.parse(result.stdout).adapters[0].admin,
        enabled ? 2 : 1,
      );
    }
  },
);
test(
  "missing, duplicate, stale, locked, faulty and non-admin targets cannot mutate",
  windows,
  () => {
    const cases: [object[], Parameters<typeof run>[1]][] = [
      [[], {}],
      [[fixture(), fixture()], {}],
      [[fixture({ InterfaceAdminStatus: 2 })], {}],
      [[fixture({ AdminLocked: true })], {}],
      [[fixture({ ConfigManagerErrorCode: 10 })], {}],
      [
        [fixture({ InterfaceAdminStatus: 2, ConfigManagerErrorCode: 10 })],
        { enabled: false },
      ],
      [
        [fixture({ InterfaceAdminStatus: 0, ConfigManagerErrorCode: null })],
        {},
      ],
      [[fixture()], { elevated: false }],
      [[fixture({ PNPDeviceID: "USB\\TETHER" })], {}],
    ];
    for (const [devices, options] of cases) {
      const result = run(devices, { toggle: true, ...options });
      assert.equal(result.status, 1, result.stdout);
      assert.equal(result.mutation, null, result.stderr);
    }
  },
);
test(
  "provider rejection and unconfirmed state never return success",
  windows,
  () => {
    for (const options of [
      { code: 5 },
      { confirm: false },
      { transitionReads: 99 },
    ]) {
      const result = run([fixture()], { toggle: true, ...options });
      assert.equal(result.status, 1);
      assert.ok(result.stderr.length > 0);
      assert.equal(result.stdout.trim(), "");
    }
  },
);
test(
  "nullable inherited driver-error field supports verified disable and restore",
  windows,
  () => {
    for (const enabled of [true, false]) {
      const result = run(
        [
          fixture({
            InterfaceAdminStatus: enabled ? 1 : 2,
            ConfigManagerErrorCode: null,
          }),
        ],
        { toggle: true, enabled },
      );
      assert.equal(result.status, 0, result.stderr);
      const adapter = JSON.parse(result.stdout).adapters[0];
      assert.equal(adapter.problem, null);
      assert.equal(adapter.admin, enabled ? 2 : 1);
      assert.equal(result.mutation.method, enabled ? "Disable" : "Enable");
    }
  },
);
test(
  "transient unknown state after a method call is retried before confirming",
  windows,
  () => {
    const result = run([fixture({ ConfigManagerErrorCode: null })], {
      toggle: true,
      transitionReads: 2,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).adapters[0].admin, 2);
    const unknown = run(
      [fixture({ InterfaceAdminStatus: 0, ConfigManagerErrorCode: null })],
      { toggle: true },
    );
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /admin=0, driver error=not reported/);
    assert.equal(unknown.mutation, null);
  },
);

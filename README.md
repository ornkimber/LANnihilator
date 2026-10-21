# LANnihilator

[![Windows CI](https://github.com/ornkimber/LANnihilator/actions/workflows/windows.yml/badge.svg)](https://github.com/ornkimber/LANnihilator/actions/workflows/windows.yml)

A miniature Windows emergency console for an extremely ordinary operation: enable or disable **one explicitly selected physical Ethernet adapter**. Tauri 2, Rust, vanilla TypeScript, CSS metalwork, and entirely synthesized sound. No frontend runtime dependencies.

## Run the offline demonstration

Requires **Node 22.16+** (Node 24 recommended). No package installation or internet connection is needed for the browser demo:

```powershell
npm run dev
```

Open **http://127.0.0.1:1420**. Select the simulation adapter in CONFIG, close settings, lift the cover, and press the button. Lift the cover again to restore. `?fail=1` simulates Windows rejection. DEMO is always labeled; it cannot call Windows adapter commands. Reloading resets its adapter state. Mute is remembered separately from native settings.

The local development server is only used during development. The installed application serves embedded assets and starts no HTTP server. Stop the development server with Ctrl+C. The server rebuilds source files on change; refresh the browser to see changes.

## Build the Windows application

Prerequisites:

- Windows 10/11 x64.
- Node 22.16+ and npm.
- Rust stable **MSVC** toolchain, including rustfmt and Clippy.
- Visual Studio 2022 Build Tools: **Desktop development with C++**, MSVC x64 tools, and Windows SDK.
- Microsoft Edge WebView2 Evergreen Runtime already installed. The installer deliberately does not download it. Provision it separately on offline machines.

```powershell
npm ci
npm run lint
npm test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
npm run build
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri dev
```

For the optimized executable and a per-user NSIS installer:

```powershell
npm run tauri build
```

Outputs:

- `src-tauri/target/release/lannihilator.exe`
- `src-tauri/target/release/bundle/nsis/*-setup.exe`

Builds require dependency downloads once; application operation never requires the internet. Both npm and Cargo lockfiles are committed. The Windows workflow uses those lockfiles, runs formatting, type checks, tests, Clippy and release packaging, and uploads both binaries.

## CI and releases

GitHub Actions checks pull requests and pushes to `main` on Windows Server 2022. It runs frontend validation, isolated adapter tests, Rust formatting, unit tests and Clippy, then builds the optimized x64 executable and per-user installer. Each successful run retains a `LANnihilator-windows-x64` download for 14 days, including SHA-256 checksums. You can also run it manually from the Actions tab.

To publish a release, update the version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`, then commit and push. Create a matching tag:

```powershell
git tag v0.1.3
git push origin v0.1.3
```

Use the actual version you committed. A tag with mismatched app versions fails before packaging. Once all checks and the Windows build pass, the workflow verifies checksums and publishes the executable, installer and `SHA256SUMS.txt` on GitHub Releases. Tags containing a hyphen produce prereleases. No additional repository secrets are required: only the release job receives write permission through GitHub's built-in token. Builds are unsigned and still require WebView2 to be installed separately.

### Optional local toolchain

If build tools are stored in the ignored `.tools` directory, dot-source `scripts/use-local-toolchain.ps1` to select them for the current shell. The helper validates the files and discovers compiler and SDK versions. It does not install tools or request elevation. A fresh clone needs the normal prerequisites above.

Build proxies can be supplied with the helper's optional `-ProxyUrl` parameter using your own HTTP listener. These settings affect only the current shell and its child processes.

## Operate

1. Launch normally to inspect adapters in read-only mode, or explicitly use Windows **Run as administrator** to enable operations. A normal launch shows **ADMIN REQUIRED** on the disabled button and **RUN AS ADMIN** on the cover. Hover text explains other blocked states. There is no automatic elevation, privileged helper, scheduled task, or service. Workspace file access does not imply the application has an administrator token.
2. Open **CONFIG**, choose the intended physical PCI Ethernet adapter, and close settings. Nothing is selected automatically, even if only one adapter exists.
3. Lift the safety cover. The button arms for 15 seconds, with pulsing red indication. Escape, focus loss, opening settings, or an externally observed state change disarms it.
4. Press to sever. Windows is called immediately, without waiting for the siren. The display reports success only after a fresh query confirms administrative disable.
5. Lift the cover and press **RESTORE LINK** to enable the same adapter again. Enabling does not imply a cable, DHCP lease, internet access, or a reachable remote host.

Wi-Fi is intentionally absent from the selector. If Ethernet and Wi-Fi are both connected, disabling Ethernet can leave internet access working through Wi-Fi. The button controls only the selected Ethernet adapter.

The small SND/MUTE button silences active audio immediately and persists the preference. The title region drags the always-on-top 320 × 440 frameless window. Position is remembered by Tauri's window-state plugin. The **minus** button minimizes to the Windows notification tray. Click its tray icon or choose **Show** to restore; right-click for **Quit**. **close** exits. Quit waits for a bounded provider request to finish before exiting. Minimizing keeps the app running; quitting leaves no app service running; it **does not change the adapter back automatically**.

## Adapter boundary and state verification

Rust embeds a fixed PowerShell script that calls the **local Windows NetAdapter CIM provider** (`root/StandardCimv2:MSFT_NetAdapter`). This uses Windows' supported management API, not localized shell-output parsing or adapter display names. PowerShell runs without profiles, without a visible window, with no execution-policy bypass, and only for each bounded provider request. Endpoint policy can reject it; the UI reports that failure rather than attempting a workaround.

An eligible device must have all of:

- `HardwareInterface = true`, `Virtual = false`;
- `InterfaceType = 6` (Ethernet), `NdisPhysicalMedium = 14` (802.3);
- a PCI PnP device ID.

This deliberately conservative scope excludes Wi-Fi, USB Ethernet and USB tethering, Bluetooth, VPNs, virtual switches, and drivers that cannot positively identify themselves as physical PCI 802.3. PCIe/Thunderbolt devices reporting that identity can qualify. The application does not change DNS, routing, proxy settings, firewall rules, or security software.

The selected interface GUID survives renames and is stored under the Tauri app configuration directory (`%APPDATA%\local.severance.bigredbutton\preferences.json`). A removed or missing adapter never falls back to another device. Driver reinstall/replacement can change the GUID and requires explicit reselection. Configuration corruption causes startup failure instead of silently picking a new target; move the damaged preferences file aside to reset selection.

Enabled state comes from `InterfaceAdminStatus`, with Configuration Manager error 22 also recognized as disabled. Some healthy drivers leave the inherited `ConfigManagerErrorCode` field null; snapshots preserve that null, and all three layers accept a known administrative state without inventing a driver fault. Explicit nonzero driver faults remain inhibited. Physical cable/link status is displayed separately. Every toggle revalidates identity, eligibility, privilege, policy lock, and the expected previous state, checks the CIM method's return code, then queries again to verify the new state. Brief unknown states during a driver transition are retried within the existing deadline, never counted as success. Rust independently verifies the returned result, and the UI checks target and requested state before displaying success. Unconfirmed-state errors include the last administrative and driver error values.

All adapter operations and polls are serialized in Rust and run on blocking workers, keeping the UI responsive. The provider process has an 18-second deadline and is killed and reaped on timeout. Killing the client cannot cancel a request already accepted by Windows: a timeout means **unconfirmed**, and a later poll can show the eventual state. Polls run every three seconds after the preceding poll completes, or ten seconds while the document is hidden. Failures never preserve an actionable stale state. The operation guard is per app process; avoid running multiple copies against the same adapter.

## Recovery through Windows

If the application fails or is unavailable:

1. Press **Win + R**, type **`ncpa.cpl`**, and press Enter.
2. Find the selected Ethernet adapter by its name and hardware description.
3. Right-click it and choose **Enable**. Accept Windows administrator approval if required.

If Windows or your organization prevents enabling it, contact your administrator. Recovery instructions are also available inside CONFIG.

## Tests and current verification

`npm test` needs only Node and Windows PowerShell. The provider tests replace enumeration and mutation with in-memory fixtures, so they cannot change real adapters. They verify target isolation, exclusion of other interface classes, renamed adapters, stale state, missing/duplicate targets, permissions, policy locks, faulty devices, failed method return codes, and absence of confirmation. The TypeScript model tests cover enabled-without-cable, administrative disable, missing selections and success validation. Rust has additional GUID-injection, selection and state tests.

Validation completed on Windows: 15 Node tests, six Rust unit tests, formatting, TypeScript checks, Clippy, frontend build, and Windows release packaging. Browser smoke tests covered configuration, the safety cover, simulated disable/restore, failure feedback, mute, and layout.

**Not yet verified:** a live elevated disable/enable cycle and installation on a clean Windows 10/11 machine. Tests use synthetic identifiers and mocked adapter mutations.

The frontend build uses Node's built-in TypeScript stripping and preserves ES modules. It does not replace type checking: `npm run lint` is a required release check. Sounds are quiet Web Audio oscillators; audio failure never blocks adapter control. Reduced-motion preferences suppress CSS animation. The application has a restrictive CSP, no remote assets, no shell plugin exposed to the webview, no analytics, and no runtime network requests.

## Source map

- `src/`: console controller, pure state model, native/mock boundary, sound synthesis and CSS.
- `src-tauri/src/`: provider runner, embedded CIM script, state/selection logic and persisted preferences.
- `tests/`: model and isolated Windows provider tests.
- `scripts/`: offline frontend builder/dev server and reproducible Windows icon generator.
- `.github/workflows/windows.yml`: Windows checks and release artifact packaging.

Native icon assets can be regenerated with `powershell -NoProfile -File scripts/generate-icon.ps1`.

use crate::model::{canonical_guid, Adapter};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Reading {
    pub adapters: Vec<Adapter>,
    pub elevated: bool,
}

#[cfg(windows)]
pub fn read(toggle: Option<(&str, bool)>) -> Result<Reading, String> {
    use std::{
        io::Read,
        os::windows::process::CommandExt,
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant},
    };
    let prelude = if let Some((id, enabled)) = toggle {
        let id = canonical_guid(id)?;
        format!("$Action = 'toggle'; $TargetGuid = '{id}'; $ExpectedEnabled = ${enabled};\n")
    } else {
        "$Action = 'read';\n".into()
    };
    let script = prelude + include_str!("netadapter.ps1");
    let root = std::env::var_os("SystemRoot").ok_or("Windows system directory unavailable")?;
    let executable =
        std::path::PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let mut child = Command::new(executable)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &script,
        ])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW; never use runas.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Cannot start local Windows adapter provider: {error}"))?;
    let mut stdout = child.stdout.take().ok_or("Provider stdout unavailable")?;
    let mut stderr = child.stderr.take().ok_or("Provider stderr unavailable")?;
    // Drain both pipes while the provider runs, preventing pipe-buffer deadlock.
    let output = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let errors = thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(18);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(40)),
            other => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = output.join();
                let _ = errors.join();
                return Err(match other {
                    Err(error) => format!("Windows provider failed: {error}. Rescan before retrying."),
                    _ => "Windows provider timed out. State is unconfirmed and may still change; rescan or recover via ncpa.cpl.".into(),
                });
            }
        }
    };
    let stdout = output
        .join()
        .map_err(|_| "Provider output worker failed")?
        .map_err(|error| error.to_string())?;
    let stderr = errors
        .join()
        .map_err(|_| "Provider error worker failed")?
        .map_err(|error| error.to_string())?;
    if !status.success() {
        let detail = String::from_utf8_lossy(&stderr);
        return Err(if detail.trim().is_empty() {
            "Windows rejected the operation. State is unconfirmed; rescan or use ncpa.cpl.".into()
        } else {
            detail.trim().chars().take(700).collect()
        });
    }
    let mut reading: Reading = serde_json::from_slice(&stdout).map_err(|error| {
        format!("Invalid Windows provider response; state is unconfirmed: {error}")
    })?;
    for adapter in &mut reading.adapters {
        adapter.id = canonical_guid(&adapter.id)?;
    }
    Ok(reading)
}

#[cfg(not(windows))]
pub fn read(_toggle: Option<(&str, bool)>) -> Result<Reading, String> {
    let _ = canonical_guid;
    Err("Native adapter control is available on Windows only.".into())
}

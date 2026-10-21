#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod adapter;
mod model;
mod tray;

use model::{canonical_guid, selected, Preferences, Snapshot};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Manager, State};

struct AppState {
    preferences: Mutex<Preferences>,
    operation: Mutex<()>,
    path: PathBuf,
    exiting: AtomicBool,
}

impl AppState {
    fn preferences(&self) -> Result<Preferences, String> {
        self.preferences
            .lock()
            .map(|value| value.clone())
            .map_err(|_| "Preferences lock failed".into())
    }
    fn update_preferences(&self, change: impl FnOnce(&mut Preferences)) -> Result<(), String> {
        let mut stored = self
            .preferences
            .lock()
            .map_err(|_| "Preferences lock failed")?;
        let mut preferences = stored.clone();
        change(&mut preferences);
        // Write a complete temporary file before replacing persisted preferences.
        let temporary = self.path.with_extension("tmp");
        let bytes = serde_json::to_vec_pretty(&preferences).map_err(|error| error.to_string())?;
        let mut file = std::fs::File::create(&temporary).map_err(|error| error.to_string())?;
        use std::io::Write;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| error.to_string())?;
        drop(file);
        std::fs::rename(&temporary, &self.path)
            .map_err(|error| format!("Could not save preferences: {error}"))?;
        *stored = preferences;
        Ok(())
    }
    fn snapshot(&self, reading: adapter::Reading) -> Result<Snapshot, String> {
        let preferences = self.preferences()?;
        Ok(Snapshot {
            adapters: reading.adapters,
            elevated: reading.elevated,
            selected: preferences.selected,
            muted: preferences.muted,
        })
    }
}

// Every provider access is serialized, including polls and selection changes.
// spawn_blocking keeps the webview and Tauri event loop responsive offline.
async fn provider_command<T: Send + 'static>(
    app: tauri::AppHandle,
    operation: impl FnOnce(&AppState) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state
            .operation
            .try_lock()
            .map_err(|_| "An adapter operation is already running")?;
        if state.exiting.load(Ordering::SeqCst) {
            return Err("Application is exiting".into());
        }
        operation(&state)
    })
    .await
    .map_err(|error| format!("Adapter worker failed: {error}"))?
}

#[tauri::command]
async fn snapshot(app: tauri::AppHandle) -> Result<Snapshot, String> {
    provider_command(app, |state| state.snapshot(adapter::read(None)?)).await
}

#[tauri::command]
async fn select_adapter(id: String, app: tauri::AppHandle) -> Result<Snapshot, String> {
    provider_command(app, move |state| {
        let id = canonical_guid(&id)?;
        let reading = adapter::read(None)?;
        selected(&reading.adapters, &id)?;
        state.update_preferences(|preferences| preferences.selected = Some(id))?;
        state.snapshot(reading)
    })
    .await
}

#[tauri::command]
async fn toggle_adapter(
    id: String,
    expected_enabled: bool,
    app: tauri::AppHandle,
) -> Result<Snapshot, String> {
    provider_command(app, move |state| {
        let id = canonical_guid(&id)?;
        if state.preferences()?.selected.as_deref() != Some(&id) {
            return Err("Target selection changed. Operation refused.".into());
        }
        let reading = adapter::read(Some((&id, expected_enabled)))?;
        if selected(&reading.adapters, &id)?.enabled() != Some(!expected_enabled) {
            return Err(
                "Windows did not confirm the requested state. Rescan before retrying.".into(),
            );
        }
        state.snapshot(reading)
    })
    .await
}

#[tauri::command]
fn set_mute(muted: bool, state: State<'_, AppState>) -> Result<(), String> {
    state.update_preferences(|preferences| preferences.muted = muted)
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .build(),
        )
        .setup(|app| {
            let directory = app.path().app_config_dir()?;
            std::fs::create_dir_all(&directory)?;
            let path = directory.join("preferences.json");
            let mut preferences: Preferences = if path.exists() {
                serde_json::from_slice(&std::fs::read(&path)?)?
            } else {
                Preferences::default()
            };
            if let Some(id) = &preferences.selected {
                preferences.selected = Some(canonical_guid(id)?);
            }
            app.manage(AppState {
                preferences: Mutex::new(preferences),
                operation: Mutex::new(()),
                path,
                exiting: AtomicBool::new(false),
            });
            tray::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                tray::quit(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            select_adapter,
            toggle_adapter,
            set_mute,
            tray::minimize_to_tray
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start the severance console");
}

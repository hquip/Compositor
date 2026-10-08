#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{collections::HashMap, fs, path::{Path, PathBuf}, sync::atomic::{AtomicBool, Ordering}};
use tauri::{Emitter, Manager, State};

struct EditorState { dirty: AtomicBool, closing: AtomicBool }
fn valid_asset(name: &str) -> bool {
    name.len() <= 160 && !name.is_empty() && name.bytes().all(|v| v.is_ascii_alphanumeric() || v == b'-' || v == b'.') && !name.starts_with('.')
}
fn read_checked(root: &Path, name: &str, limit: u64) -> Result<Vec<u8>, String> {
    if !valid_asset(name) { return Err("Invalid resource filename".into()); }
    let target = root.join(name); let info = fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
    if info.file_type().is_symlink() || !info.is_file() || info.len() > limit { return Err("Invalid or oversized resource".into()); }
    fs::read(target).map_err(|e| e.to_string())
}
#[tauri::command]
fn read_project(path: String) -> Result<Value, String> {
    let root = PathBuf::from(&path); let info = fs::symlink_metadata(&root).map_err(|e| e.to_string())?;
    if info.file_type().is_symlink() || !info.is_dir() || root.extension().and_then(|v| v.to_str()) != Some("comp") { return Err("Select a .comp project directory".into()); }
    let manifest: Value = serde_json::from_slice(&read_checked(&root, "manifest.json", 4 * 1024 * 1024)?).map_err(|e| e.to_string())?;
    if manifest["format"] != "com.compositor.project" || manifest["version"].as_u64().unwrap_or(0) > 17 { return Err("Unsupported Compositor project".into()); }
    let mut assets = HashMap::new(); let images = root.join("images"); let mut total = 0u64;
    if images.exists() {
        if fs::symlink_metadata(&images).map_err(|e| e.to_string())?.file_type().is_symlink() { return Err("Invalid image directory".into()); }
        for item in fs::read_dir(&images).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?; let name = item.file_name().to_string_lossy().into_owned();
            let bytes = read_checked(&images, &name, 512 * 1024 * 1024)?; total += bytes.len() as u64;
            if total > 1024 * 1024 * 1024 { return Err("Project exceeds the memory budget".into()); }
            assets.insert(name, STANDARD.encode(bytes));
        }
    }
    Ok(json!({"manifest": manifest, "assets": assets}))
}
#[tauri::command]
fn write_project(path: String, snapshot: Value) -> Result<(), String> {
    let target = PathBuf::from(path); let parent = target.parent().ok_or("Invalid project path")?;
    if target.extension().and_then(|v| v.to_str()) != Some("comp") || snapshot["manifest"]["format"] != "com.compositor.project" { return Err("Save to a .comp project directory".into()); }
    if target.exists() { let previous = read_project(target.to_string_lossy().into_owned())?; if previous["manifest"]["format"] != "com.compositor.project" { return Err("The destination is not a Compositor project".into()); } }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e|e.to_string())?.as_nanos();
    let temporary = parent.join(format!(".compositor-save-{stamp}")); let backup = parent.join(format!(".compositor-backup-{stamp}"));
    fs::create_dir_all(temporary.join("images")).map_err(|e| e.to_string())?;
    let result = (|| {
        let data = serde_json::to_vec_pretty(&snapshot["manifest"]).map_err(|e| e.to_string())?;
        if data.len() > 4 * 1024 * 1024 { return Err("Manifest exceeds its size limit".into()); }
        let assets = snapshot["assets"].as_object().ok_or("Missing project assets")?; let mut total = 0;
        for (name, value) in assets { if !valid_asset(name) { return Err("Invalid asset filename".into()); } let bytes = STANDARD.decode(value.as_str().ok_or("Invalid asset bytes")?).map_err(|e| e.to_string())?; total += bytes.len(); if bytes.len() > 512 * 1024 * 1024 || total > 1024 * 1024 * 1024 { return Err("Project exceeds the memory budget".into()); } fs::write(temporary.join("images").join(name), bytes).map_err(|e|e.to_string())?; }
        fs::write(temporary.join("manifest.json"), data).map_err(|e|e.to_string())?;
        if target.exists() { fs::rename(&target, &backup).map_err(|e|e.to_string())?; }
        if let Err(error) = fs::rename(&temporary, &target) { if backup.exists() { let _ = fs::rename(&backup, &target); } return Err(error.to_string()); }
        if backup.exists() { let _ = fs::remove_dir_all(&backup); } Ok(())
    })();
    if temporary.exists() { let _ = fs::remove_dir_all(&temporary); } result
}
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path); let info=fs::metadata(&path).map_err(|e|e.to_string())?;
    if !info.is_file() || info.len()>512*1024*1024 {return Err("Invalid or oversized file".into());}
    Ok(STANDARD.encode(fs::read(path).map_err(|e|e.to_string())?))
}
#[tauri::command]
fn write_file(path: String, data: String) -> Result<(), String> {
    let bytes=STANDARD.decode(data).map_err(|e|e.to_string())?; if bytes.len()>512*1024*1024{return Err("Export exceeds the file-size limit".into());}
    let target=PathBuf::from(path);if target.is_dir(){return Err("Select a file export destination".into());}
    let temporary=target.with_extension(format!("compositor-export-{}",std::process::id()));fs::write(&temporary,bytes).map_err(|e|e.to_string())?;
    fs::rename(&temporary,&target).map_err(|e|{let _=fs::remove_file(&temporary);e.to_string()})
}
#[tauri::command]
fn document_state(dirty: bool, state: State<EditorState>) { state.dirty.store(dirty, Ordering::SeqCst); }
#[tauri::command]
fn close_editor(window: tauri::WebviewWindow, state: State<EditorState>) -> Result<(), String> { state.closing.store(true, Ordering::SeqCst); window.close().map_err(|e|e.to_string()) }
fn main() {
    tauri::Builder::default().plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_clipboard_manager::init())
        .manage(EditorState { dirty: AtomicBool::new(false), closing: AtomicBool::new(false) })
        .invoke_handler(tauri::generate_handler![read_project, write_project, read_file, write_file, document_state, close_editor])
        .on_window_event(|window, event| { if let tauri::WindowEvent::CloseRequested { api, .. } = event { let state=window.state::<EditorState>(); if state.dirty.load(Ordering::SeqCst) && !state.closing.load(Ordering::SeqCst) { api.prevent_close(); let _=window.emit("editor-command", "close"); } } })
        .run(tauri::generate_context!()).expect("Could not start Compositor");
}

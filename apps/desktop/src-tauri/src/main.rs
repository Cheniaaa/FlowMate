#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime_host;
mod credentials;
mod private_channel;
mod native_resources;
mod windows;

use runtime_host::{Connection, RuntimeHost};
use std::{sync::{Arc, Mutex}, thread, time::Duration};
use credentials::{CredentialStore, SecretBinding, SecretStatus};
use tauri::{menu::{Menu, MenuEvent, MenuItem}, path::BaseDirectory, tray::TrayIconBuilder, Emitter, EventTarget, Manager};
use tauri_plugin_opener::OpenerExt;

trait TrayTarget {
    fn restore_main_window(&self) -> Result<(), String>;
    fn restore_quick_window(&self) -> Result<(), String>;
    fn open_model_settings(&self) -> Result<(), String>;
    fn stop_owned_runtime(&self) -> Result<(), String>;
    fn exit_application(&self);
}

fn dispatch_tray_action(target: &impl TrayTarget, id: &str) -> Result<(), String> {
    match id {
        "tray-show" => target.restore_main_window(),
        "tray-quick" | "tray-pending" => target.restore_quick_window(),
        "tray-settings" => target.open_model_settings(),
        "tray-exit" => { target.stop_owned_runtime()?; target.exit_application(); Ok(()) }
        _ => Err("unknown_tray_action".into()),
    }
}

impl TrayTarget for tauri::AppHandle {
    fn restore_main_window(&self) -> Result<(), String> {
        windows::show(self, "main")?;
        let window = self.get_webview_window("main").ok_or("main_window_missing")?;
        let state = self.state::<Mutex<RuntimeHost>>();
        let host = state.lock().map_err(|_| "host_unavailable")?;
        host.log.write(serde_json::json!({"event": "tray_window_restored",
            "entrypoint": "native-tray-menu-handler", "visible": window.is_visible().unwrap_or(false),
            "unminimized": !window.is_minimized().unwrap_or(true),
            "focused": window.is_focused().unwrap_or(false)}));
        Ok(())
    }
    fn restore_quick_window(&self) -> Result<(), String> { windows::show(self, "quick") }
    fn open_model_settings(&self) -> Result<(), String> { windows::open_settings(self, windows::SettingsSection::Models, false) }
    fn stop_owned_runtime(&self) -> Result<(), String> {
        self.state::<Mutex<RuntimeHost>>().lock().map_err(|_| "host_unavailable")?.stop();
        Ok(())
    }
    fn exit_application(&self) { self.exit(0); }
}

fn log_native_error<R: tauri::Runtime>(app: &tauri::AppHandle<R>, code: &str) {
    if let Some(state) = app.try_state::<Mutex<RuntimeHost>>() {
        if let Ok(host) = state.lock() { host.log.write(serde_json::json!({"event":"native_action_failed","code":code})); }
    }
}

fn publish_pending<R: tauri::Runtime>(app: &tauri::AppHandle<R>, pending: &MenuItem<R>, counts: Option<runtime_host::PendingCounts>) -> Result<(), String> {
    for label in windows::LABELS {
        app.emit_to(EventTarget::webview_window(label), "pending-counts", counts).map_err(|_| "window_event_failed")?;
    }
    let text = match counts {
        Some(counts) => format!("待输入 {} · 待审批 {}", counts.pending_questions, counts.pending_approvals),
        None => "待办数量：连接不可用".into(),
    };
    pending.set_text(&text).map_err(|_| "tray_update_failed")?;
    pending.set_enabled(counts.is_some_and(|counts| counts.pending_questions > 0 || counts.pending_approvals > 0)).map_err(|_| "tray_update_failed")?;
    app.tray_by_id("runtime-tray").ok_or("tray_missing")?.set_tooltip(Some(format!("FlowMate · {text}"))).map_err(|_| "tray_update_failed".into())
}

// 原生菜单统一进入此函数，不另造 show/exit 实现或 WebView 命令。
fn handle_tray_menu(app: &tauri::AppHandle, event: MenuEvent) {
    if app.tray_by_id("runtime-tray").is_none() { return; }
    if event.id().as_ref() == "tray-exit" {
        if let Ok(host) = app.state::<Mutex<RuntimeHost>>().lock() {
            host.log.write(serde_json::json!({"event": "tray_exit_requested",
                "entrypoint": "native-tray-menu-handler"}));
        }
    }
    if dispatch_tray_action(app, event.id().as_ref()).is_err() {
        if let Ok(host) = app.state::<Mutex<RuntimeHost>>().lock() {
            host.log.write(serde_json::json!({"event": "tray_action_failed"}));
        }
    }
}

fn checked_window<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, labels: &[&str]) -> Result<(), String> {
    let origin = window.url().map_err(|_| "invalid_window")?.origin().ascii_serialization();
    if !labels.contains(&window.label()) || !runtime_host::permitted_origin(&origin, cfg!(dev)) {
        return Err("forbidden_window".into());
    }
    Ok(())
}

fn checked_external_url(value: &str) -> Result<url::Url, String> {
    let (scheme, _) = value.split_once("://").ok_or("invalid_external_url")?;
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return Err("invalid_external_url".into());
    }
    let url = url::Url::parse(value).map_err(|_| "invalid_external_url")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("invalid_external_url".into());
    }
    Ok(url)
}

#[tauri::command]
fn open_external<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>, url: String) -> Result<(), String> {
    checked_window(&window, &["main", "quick"])?;
    let url = checked_external_url(&url)?;
    app.opener().open_url(url.as_str(), None::<&str>).map_err(|_| "external_open_failed".into())
}

#[tauri::command]
fn open_settings<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>, section: windows::SettingsSection) -> Result<(), String> {
    checked_window(&window, &["main", "quick"])?;
    windows::open_settings(&app, section, window.label() == "quick")
}

#[tauri::command]
fn take_settings_navigation<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>) -> Result<Option<windows::SettingsNavigation>, String> {
    checked_window(&window, &["main"])?;
    Ok(app.state::<Mutex<windows::Windows>>().lock().map_err(|_| "window_state_unavailable")?.take_settings_navigation())
}

#[tauri::command]
fn return_to_quick<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>) -> Result<(), String> {
    checked_window(&window, &["main"])?;
    windows::show(&app, "quick")
}

#[tauri::command]
fn window_settings<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>) -> Result<windows::WindowSettings, String> {
    checked_window(&window, &["main", "quick"])?;
    Ok(app.state::<Mutex<windows::Windows>>().lock().map_err(|_| "window_state_unavailable")?.settings())
}

#[tauri::command(rename_all = "snake_case")]
fn set_quick_pinned<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>, pinned: bool) -> Result<windows::WindowSettings, String> {
    checked_window(&window, &["main", "quick"])?;
    let result = app.state::<Mutex<windows::Windows>>().lock().map_err(|_| "window_state_unavailable")?.set_pin(&app, pinned);
    if result.is_ok() { windows::publish_settings(&app)?; }
    result
}

#[tauri::command(rename_all = "snake_case")]
fn set_ball_enabled<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>, enabled: bool) -> Result<windows::WindowSettings, String> {
    checked_window(&window, &["main", "quick"])?;
    let result = app.state::<Mutex<windows::Windows>>().lock().map_err(|_| "window_state_unavailable")?.set_ball(&app, enabled);
    if result.is_ok() { windows::publish_settings(&app)?; }
    result
}

#[tauri::command(rename_all = "snake_case")]
fn set_shortcut<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>, chord: Option<String>) -> Result<windows::WindowSettings, String> {
    checked_window(&window, &["main", "quick"])?;
    let result = app.state::<Mutex<windows::Windows>>().lock().map_err(|_| "window_state_unavailable")?.set_shortcut(&app, chord);
    windows::publish_settings(&app)?;
    result
}

#[tauri::command]
fn toggle_quick<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>) -> Result<(), String> {
    checked_window(&window, &["main", "quick", "ball"])?;
    windows::toggle_quick(&app)
}

#[tauri::command]
fn start_ball_drag<R: tauri::Runtime>(window: tauri::WebviewWindow<R>) -> Result<(), String> {
    checked_window(&window, &["ball"])?;
    window.start_dragging().map_err(|_| "drag_failed".into())
}

#[tauri::command(rename_all = "snake_case")]
fn show_workbench<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>, run_id: Option<String>) -> Result<(), String> {
    checked_window(&window, &["main", "quick", "ball"])?;
    if window.label() == "ball" && run_id.is_some() { return Err("forbidden_navigation".into()); }
    if run_id.as_ref().is_some_and(|id| uuid::Uuid::parse_str(id).is_err()) { return Err("invalid_run_id".into()); }
    app.state::<Mutex<windows::Windows>>().lock().map_err(|_| "window_state_unavailable")?.navigate(run_id);
    windows::show(&app, "main")?;
    app.emit_to(EventTarget::webview_window("main"), "workbench-navigation", ()).map_err(|_| "window_event_failed".into())
}

#[tauri::command]
fn take_workbench_navigation<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>) -> Result<Option<String>, String> {
    checked_window(&window, &["main"])?;
    Ok(app.state::<Mutex<windows::Windows>>().lock().map_err(|_| "window_state_unavailable")?.take_navigation())
}

#[tauri::command(rename_all = "snake_case")]
fn set_quick_form_active<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>, active: bool) -> Result<(), String> {
    checked_window(&window, &["quick"])?;
    app.state::<Mutex<windows::Windows>>().lock().map_err(|_| "window_state_unavailable")?.form_active(active);
    Ok(())
}

#[tauri::command]
fn pending_counts<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>) -> Result<Option<runtime_host::PendingCounts>, String> {
    checked_window(&window, &windows::LABELS)?;
    Ok(app.state::<Arc<Mutex<runtime_host::Notifications>>>().lock().map_err(|_| "host_unavailable")?.counts())
}

struct NativeDialog<R: tauri::Runtime>(tauri::AppHandle<R>);
impl<R: tauri::Runtime> NativeDialog<R> {
    fn begin(window: &tauri::WebviewWindow<R>, app: &tauri::AppHandle<R>) -> Result<Option<Self>, String> {
        if window.label() != "quick" { return Ok(None); }
        app.state::<Mutex<windows::Windows>>().lock().map_err(|_| "window_state_unavailable")?.begin_dialog();
        Ok(Some(Self(app.clone())))
    }
}
impl<R: tauri::Runtime> Drop for NativeDialog<R> {
    fn drop(&mut self) {
        match self.0.state::<Mutex<windows::Windows>>().lock() {
            Ok(mut state) => state.end_dialog(),
            Err(_) => log_native_error(&self.0, "window_state_unavailable"),
        }
    }
}

#[tauri::command]
fn runtime_connection<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>)
    -> Result<Connection, String> {
    checked_window(&window, &["main", "quick"])?;
    let host = app.try_state::<Mutex<RuntimeHost>>().ok_or("host_unavailable")?;
    let host = host.lock().map_err(|_| "host_unavailable")?;
    if host.channel().is_closed() { return Err("host_unavailable".into()); }
    Ok(host.connection.clone())
}

#[tauri::command]
fn stop_runtime<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>) -> Result<(), String> {
    checked_window(&window, &["main", "quick"])?;
    app.try_state::<Mutex<RuntimeHost>>().ok_or("host_unavailable")?.lock().map_err(|_| "host_unavailable")?.stop();
    app.exit(0);
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
fn save_credential<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>, binding: SecretBinding, value: String) -> Result<SecretStatus, String> {
    checked_window(&window, &["main"])?;
    app.try_state::<Arc<CredentialStore>>().ok_or("host_unavailable")?.save(&binding, &value).map_err(String::from)
}
#[tauri::command(rename_all = "snake_case")]
fn clear_credential<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>, secret_ref: String) -> Result<SecretStatus, String> {
    checked_window(&window, &["main"])?;
    app.try_state::<Arc<CredentialStore>>().ok_or("host_unavailable")?.clear(&secret_ref).map_err(String::from)
}
#[tauri::command(rename_all = "snake_case")]
fn credential_status<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>, secret_ref: String) -> Result<SecretStatus, String> {
    checked_window(&window, &["main"])?;
    app.try_state::<Arc<CredentialStore>>().ok_or("host_unavailable")?.status(&secret_ref).map_err(String::from)
}
#[tauri::command]
async fn select_resources<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>, scope: native_resources::Scope, kind: native_resources::SelectionKind) -> Result<native_resources::Selection, String> {
    checked_window(&window, &["main", "quick"])?;
    scope.validate()?;
    let channel = {
        let host = app.try_state::<Mutex<RuntimeHost>>().ok_or("host_unavailable")?;
        let host = host.lock().map_err(|_| "host_unavailable")?;
        host.channel()
    };
    let _dialog = NativeDialog::begin(&window, &app)?;
    native_resources::select(&window, channel, scope, kind).await
}
#[tauri::command]
async fn choose_export_target<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>, scope: native_resources::Scope) -> Result<native_resources::Selection, String> {
    checked_window(&window, &["main", "quick"])?;
    scope.validate()?;
    let channel = {
        let host = app.try_state::<Mutex<RuntimeHost>>().ok_or("host_unavailable")?;
        let host = host.lock().map_err(|_| "host_unavailable")?;
        host.channel()
    };
    let _dialog = NativeDialog::begin(&window, &app)?;
    native_resources::choose_export(&window, channel, scope).await
}

#[tauri::command]
async fn create_workspace_from_directory<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>,
    name: String, meta: native_resources::CommandMeta) -> Result<Option<native_resources::WorkspaceDirectoryResult>, String> {
    checked_window(&window, &["main"])?;
    let channel = {
        let host = app.try_state::<Mutex<RuntimeHost>>().ok_or("host_unavailable")?;
        let host = host.lock().map_err(|_| "host_unavailable")?;
        host.channel()
    };
    let commands = app.state::<Arc<native_resources::WorkspaceDirectories>>().inner().clone();
    commands.create(&window, &channel, name, meta).await
}

#[tauri::command]
async fn retry_workspace_from_directory<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>,
    name: String, meta: native_resources::CommandMeta) -> Result<native_resources::WorkspaceDirectoryResult, String> {
    checked_window(&window, &["main"])?;
    let channel = {
        let host = app.try_state::<Mutex<RuntimeHost>>().ok_or("host_unavailable")?;
        let host = host.lock().map_err(|_| "host_unavailable")?;
        host.channel()
    };
    let commands = app.state::<Arc<native_resources::WorkspaceDirectories>>().inner().clone();
    commands.retry(&channel, name, meta, Duration::from_secs(60)).await
}

#[tauri::command(rename_all = "snake_case")]
async fn check_workspace_directory_command<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, app: tauri::AppHandle<R>,
    command_id: String) -> Result<native_resources::WorkspaceDirectoryCommandStatus, String> {
    checked_window(&window, &["main"])?;
    let channel = {
        let host = app.try_state::<Mutex<RuntimeHost>>().ok_or("host_unavailable")?;
        let host = host.lock().map_err(|_| "host_unavailable")?;
        host.channel()
    };
    let commands = app.state::<Arc<native_resources::WorkspaceDirectories>>().inner().clone();
    commands.check(&channel, command_id, Duration::from_secs(60)).await
}

fn close_workspace_directory_commands<R: tauri::Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    if label == "main" { app.state::<Arc<native_resources::WorkspaceDirectories>>().clear(); }
}

fn main() {
    std::panic::set_hook(Box::new(|_| eprintln!("{{\"event\":\"internal_error\"}}")));
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .manage(Arc::new(native_resources::WorkspaceDirectories::default()))
        .invoke_handler(tauri::generate_handler![runtime_connection, stop_runtime, open_settings, take_settings_navigation, return_to_quick, save_credential,
            clear_credential, credential_status, select_resources, choose_export_target, open_external,
            window_settings, set_quick_pinned, set_shortcut, set_ball_enabled, toggle_quick, show_workbench,
            take_workbench_navigation, set_quick_form_active, pending_counts, start_ball_drag,
            create_workspace_from_directory, retry_workspace_from_directory, check_workspace_directory_command])
        .setup(|app| {
            let directory = app.path().app_data_dir()?.join("data-v2");
            let host = if cfg!(debug_assertions) {
                let python = std::env::var_os("FLOWMATE_DEV_PYTHON").ok_or("development_python_required")?;
                let root = std::env::var_os("FLOWMATE_DEV_ROOT").ok_or("development_root_required")?;
                let runtime = runtime_host::DevelopmentRuntime::new(python.into(), root.into())
                    .map_err(std::io::Error::other)?;
                RuntimeHost::start_development(&directory, &runtime, false, cfg!(dev))
            } else {
                let executable = app.path().resolve("runtime/flowmate-runtime.exe", BaseDirectory::Resource)?;
                RuntimeHost::start(&directory, &executable, false, cfg!(dev))
            }.map_err(std::io::Error::other)?;
            app.manage(host.credentials());
            app.manage(host.notifications());
            app.manage(Mutex::new(host));
            app.manage(Mutex::new(windows::Windows::load(&directory).map_err(std::io::Error::other)?));
            for config in &app.config().app.windows {
                let config = windows::window_config(config);
                let window = tauri::WebviewWindowBuilder::from_config(app, &config)?.center().prevent_overflow().build()?;
                if config.label == "ball" {
                    // CreateWindowEx 的首条 WM_GETMINMAXINFO 早于 Tao 装配约束；装配后应用同一客户区尺寸。
                    window.set_size(tauri::LogicalSize::new(config.width, config.height))?;
                }
            }
            {
                let state = app.state::<Mutex<windows::Windows>>();
                let mut state = state.lock().map_err(|_| "window_state_unavailable")?;
                state.restore(app.handle()).map_err(std::io::Error::other)?;
            }
            windows::publish_settings(app.handle()).map_err(std::io::Error::other)?;
            let show = MenuItem::with_id(app, "tray-show", "显示主窗口", true, None::<&str>)?;
            let quick = MenuItem::with_id(app, "tray-quick", "快捷助理", true, None::<&str>)?;
            let pending = MenuItem::with_id(app, "tray-pending", "待办数量：连接中", false, None::<&str>)?;
            let settings = MenuItem::with_id(app, "tray-settings", "设置", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "tray-exit", "退出应用", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quick, &pending, &settings, &exit])?;
            TrayIconBuilder::with_id("runtime-tray")
                .icon(app.default_window_icon().ok_or("tray_icon_missing")?.clone())
                .tooltip("FlowMate").menu(&menu).show_menu_on_left_click(true)
                .on_menu_event(handle_tray_menu).build(app)?;
            if let Ok(host) = app.state::<Mutex<RuntimeHost>>().lock() {
                host.log.write(serde_json::json!({"event": "tray_ready", "tray_id": "runtime-tray",
                    "menu_ids": ["tray-show", "tray-quick", "tray-pending", "tray-settings", "tray-exit"]}));
            }
            let handle = app.handle().clone();
            thread::spawn(move || loop {
                thread::sleep(Duration::from_millis(100));
                if let Some(state) = handle.try_state::<Mutex<RuntimeHost>>() {
                    let update = match state.lock() {
                        Ok(mut host) => if host.supervise() { Some(host.notifications().lock().unwrap().counts()) } else { None },
                        Err(_) => { log_native_error(&handle, "host_unavailable"); None }
                    };
                    if let Some(counts) = update {
                        if let Err(error) = publish_pending(&handle, &pending, counts) { log_native_error(&handle, &error); }
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                close_workspace_directory_commands(window.app_handle(), window.label());
                let result = if window.label() == "ball" {
                    let settings = window.state::<Mutex<windows::Windows>>().lock().map_err(|_| "window_state_unavailable".to_owned())
                        .and_then(|mut state| state.set_ball(window.app_handle(), false));
                    settings.and_then(|_| windows::publish_settings(window.app_handle()))
                } else { window.hide().map_err(|_| "hide_failed".to_owned()) };
                match result {
                    Ok(()) => if let Ok(host) = window.state::<Mutex<RuntimeHost>>().lock() {
                        host.log.write(serde_json::json!({"event": "window_hidden", "window": window.label()}));
                    },
                    Err(error) => log_native_error(window.app_handle(), &error),
                }
            }
            if window.label() == "quick" && matches!(event, tauri::WindowEvent::Focused(false)) {
                let hide = window.state::<Mutex<windows::Windows>>().lock().map(|state| state.hide_on_blur()).map_err(|_| "window_state_unavailable");
                match hide {
                    Ok(true) => if window.hide().is_err() { log_native_error(window.app_handle(), "hide_failed"); },
                    Ok(false) => (),
                    Err(_) => log_native_error(window.app_handle(), "window_state_unavailable"),
                }
            }
        })
        .build(tauri::generate_context!());
    match result {
        Ok(app) => app.run(|handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = handle.try_state::<Mutex<RuntimeHost>>() {
                    if let Ok(mut host) = state.lock() { host.stop(); }
                }
            }
        }),
        Err(_) => std::process::exit(2), // 不把令牌或输入反射到错误文本。
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn ipc_app() -> (tauri::App<tauri::test::MockRuntime>, Arc<CredentialStore>) {
        ipc_app_with_notifications(Arc::new(Mutex::new(runtime_host::Notifications::default())))
    }
    fn ipc_app_with_notifications(notifications: Arc<Mutex<runtime_host::Notifications>>) -> (tauri::App<tauri::test::MockRuntime>, Arc<CredentialStore>) {
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        let store = Arc::new(credentials::tests::store());
        let app = tauri::test::mock_builder().manage(store.clone())
            .manage(Arc::new(native_resources::WorkspaceDirectories::default()))
            .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
            .manage(Mutex::new(windows::Windows::load(&std::env::temp_dir().join("opencode").join(format!("flowmate-ipc-{}", uuid::Uuid::new_v4()))).unwrap()))
            .manage(notifications)
            .invoke_handler(tauri::generate_handler![runtime_connection, stop_runtime, open_settings, take_settings_navigation, return_to_quick, save_credential,
                clear_credential, credential_status, select_resources, choose_export_target, open_external,
                window_settings, set_quick_pinned, set_shortcut, set_ball_enabled, toggle_quick, show_workbench,
                take_workbench_navigation, set_quick_form_active, pending_counts, start_ball_drag,
                create_workspace_from_directory, retry_workspace_from_directory, check_workspace_directory_command])
            .build(context).unwrap();
        (app, store)
    }
    fn window(app: &tauri::App<tauri::test::MockRuntime>, label: &str) -> tauri::WebviewWindow<tauri::test::MockRuntime> {
        tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::External(local_origin().parse().unwrap())).build().unwrap()
    }
    fn local_origin() -> &'static str { if cfg!(dev) { "http://127.0.0.1:5173" } else { "http://tauri.localhost" } }
    fn ipc(window: &tauri::WebviewWindow<tauri::test::MockRuntime>, command: &str, body: serde_json::Value) -> Result<serde_json::Value, serde_json::Value> {
        ipc_at(window, command, body, local_origin())
    }
    fn ipc_at(window: &tauri::WebviewWindow<tauri::test::MockRuntime>, command: &str, body: serde_json::Value, origin: &str) -> Result<serde_json::Value, serde_json::Value> {
        tauri::test::get_ipc_response(window, tauri::webview::InvokeRequest {
            cmd: command.into(), callback: tauri::ipc::CallbackFn(0), error: tauri::ipc::CallbackFn(1),
            url: origin.parse().unwrap(), body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(), invoke_key: tauri::test::INVOKE_KEY.into(),
        }).map(|body| body.deserialize().unwrap())
    }

    #[test]
    fn t14_actual_ipc_credentials_and_settings_navigation_have_narrow_window_permissions() {
        let (app, _) = ipc_app();
        for label in ["main", "quick", "ball", "settings", "preview"] { window(&app, label); }
        for label in ["main", "quick", "ball", "settings", "preview"] {
            let candidate = app.get_webview_window(label).unwrap();
            // 无效边界值在 Credential Manager 调用前返回；本轮权限检查不访问任何凭据。
            let mut binding = credentials::tests::binding(); binding.connection_id = "invalid".into();
            for (command, body, expected) in [
                ("save_credential", serde_json::json!({"binding":binding,"value":""}), "invalid_binding"),
                ("clear_credential", serde_json::json!({"secret_ref":""}), "invalid_secret_ref"),
                ("credential_status", serde_json::json!({"secret_ref":""}), "invalid_secret_ref"),
            ] {
                let error = ipc(&candidate, command, body).unwrap_err();
                if label == "main" { assert_eq!(error, expected, "{command}"); }
                else { assert!(error.as_str().unwrap().contains("not allowed"), "{label} {command}: {error}"); }
            }
            for (command, body, allowed) in [
                ("open_settings", serde_json::json!({"section":"models"}), ["main", "quick"].contains(&label)),
                ("take_settings_navigation", serde_json::json!({}), label == "main"),
                ("return_to_quick", serde_json::json!({}), label == "main"),
            ] {
                let response = ipc(&candidate, command, body);
                if allowed { assert!(response.is_ok(), "{label} {command}: {response:?}"); }
                else { assert!(response.unwrap_err().as_str().unwrap().contains("not allowed"), "{label} {command}"); }
            }
        }
    }

    #[test]
    fn t14_settings_navigation_survives_a_late_listener_and_never_erases_quick_state() {
        use tauri::Listener;
        let (app, _) = ipc_app(); let main = window(&app, "main"); let quick = window(&app, "quick"); let ball = window(&app, "ball");
        ipc(&quick, "set_quick_form_active", serde_json::json!({"active":true})).unwrap();
        ipc(&quick, "open_settings", serde_json::json!({"section":"resources"})).unwrap();
        assert_eq!(ipc(&main, "take_settings_navigation", serde_json::json!({})).unwrap(), serde_json::json!({"section":"resources","from_quick":true}));
        assert_eq!(ipc(&main, "take_settings_navigation", serde_json::json!({})).unwrap(), serde_json::Value::Null);
        let payloads = Arc::new(Mutex::new(Vec::new())); let seen = payloads.clone();
        main.listen("settings-navigation", move |event| seen.lock().unwrap().push(event.payload().to_owned()));
        let unexpected = Arc::new(Mutex::new(0));
        for candidate in [&quick, &ball] {
            let seen = unexpected.clone(); candidate.listen("settings-navigation", move |_| *seen.lock().unwrap() += 1);
        }
        for section in ["windows", "assistant", "models"] {
            ipc(&quick, "open_settings", serde_json::json!({"section":section})).unwrap();
        }
        assert_eq!(*payloads.lock().unwrap(), ["null", "null", "null"]);
        assert_eq!(*unexpected.lock().unwrap(), 0);
        assert_eq!(ipc(&main, "take_settings_navigation", serde_json::json!({})).unwrap(), serde_json::json!({"section":"models","from_quick":true}));
        quick.hide().unwrap();
        ipc(&main, "return_to_quick", serde_json::json!({})).unwrap();
        assert!(quick.is_visible().unwrap());
        ipc(&main, "return_to_quick", serde_json::json!({})).unwrap();
        assert!(quick.is_visible().unwrap());
        assert_eq!(ipc(&main, "take_settings_navigation", serde_json::json!({})).unwrap(), serde_json::Value::Null);
        assert!(!app.state::<Mutex<windows::Windows>>().lock().unwrap().hide_on_blur());
        assert!(app.get_webview_window("quick").is_some());
        assert!(app.get_webview_window("settings").is_none());
        assert_eq!(app.webview_windows().len(), 3);
    }

    #[test]
    fn t14_settings_section_rejects_unknown_values_and_wrong_json_types() {
        let (app, _) = ipc_app(); let main = window(&app, "main"); window(&app, "settings");
        for section in [serde_json::json!("unknown"), serde_json::json!("Models"), serde_json::Value::Null,
            serde_json::json!(true), serde_json::json!(1), serde_json::json!(["models"]), serde_json::json!({"section":"models"})] {
            assert!(ipc(&main, "open_settings", serde_json::json!({"section":section})).is_err());
        }
        assert!(ipc(&main, "open_settings", serde_json::json!({})).is_err());
        assert_eq!(ipc(&main, "take_settings_navigation", serde_json::json!({})).unwrap(), serde_json::Value::Null);
    }

    #[test]
    fn t14_settings_and_credential_guards_reject_broadened_labels_and_remote_main() {
        let (app, _) = ipc_app();
        let permissions = serde_json::json!(["host-settings", "host-open-settings", "host-settings-navigation"]);
        app.add_capability(serde_json::json!({"identifier":"test-t14-labels","windows":["quick","ball","settings"],"permissions":permissions}).to_string()).unwrap();
        app.add_capability(serde_json::json!({"identifier":"test-t14-origin","windows":["main"],"remote":{"urls":["https://example.invalid"]},"permissions":permissions}).to_string()).unwrap();
        let remote = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::External("https://example.invalid".parse().unwrap())).build().unwrap();
        let mut binding = credentials::tests::binding(); binding.connection_id = "invalid".into();
        for (command, body) in [
            ("save_credential", serde_json::json!({"binding":binding,"value":""})),
            ("clear_credential", serde_json::json!({"secret_ref":""})), ("credential_status", serde_json::json!({"secret_ref":""})),
            ("take_settings_navigation", serde_json::json!({})), ("open_settings", serde_json::json!({"section":"models"})),
        ] {
            assert_eq!(ipc_at(&remote, command, body.clone(), "https://example.invalid").unwrap_err(), "forbidden_window", "{command}");
            for label in ["quick", "ball", "settings"] {
                let candidate = app.get_webview_window(label).unwrap_or_else(|| window(&app, label));
                if label == "quick" && command == "open_settings" { continue; }
                assert_eq!(ipc(&candidate, command, body.clone()).unwrap_err(), "forbidden_window", "{label} {command}");
            }
        }
    }

    #[test]
    fn external_url_policy_accepts_only_absolute_http_with_a_host() {
        for value in ["https://example.invalid/path?q=1", "http://127.0.0.1:8000/", "HTTPS://example.invalid/"] {
            assert!(checked_external_url(value).is_ok(), "{value}");
        }
        for value in ["//example.invalid", "/relative", "relative", "#fragment", "javascript:alert(1)",
            "file:///C:/secret", "data:text/html,evil", "mailto:test@example.invalid", "https:example.invalid", "https://", ""] {
            assert_eq!(checked_external_url(value).unwrap_err(), "invalid_external_url", "{value}");
        }
    }

    #[test]
    fn actual_ipc_external_links_reject_invalid_urls_and_non_product_windows() {
        let (app, _) = ipc_app();
        for label in ["main", "quick"] {
            let window = window(&app, label);
            for value in ["javascript:alert(1)", "file:///C:/secret", "//example.invalid", "https://"] {
                assert_eq!(ipc(&window, "open_external", serde_json::json!({"url":value})).unwrap_err(), "invalid_external_url", "{label}: {value}");
            }
        }
        for label in ["settings", "ball", "preview"] {
            let window = window(&app, label);
            let error = ipc(&window, "open_external", serde_json::json!({"url":"https://example.invalid"})).unwrap_err();
            assert!(error.as_str().unwrap().contains("not allowed"), "{label}: {error}");
        }
        for label in ["main", "quick", "settings", "ball", "preview"] {
            let window = app.get_webview_window(label).unwrap();
            for command in ["plugin:opener|open_url", "plugin:opener|open_path", "plugin:opener|reveal_item_in_dir"] {
                let error = ipc(&window, command, serde_json::json!({"url":"https://example.invalid", "path":"C:/secret"})).unwrap_err();
                assert!(error.as_str().unwrap().contains("not allowed"), "{label} {command}: {error}");
            }
        }
    }

    #[test]
    fn external_links_guard_rejects_broadened_label_and_remote_acl() {
        let (app, _) = ipc_app();
        app.add_capability(r#"{"identifier":"test-external-label","windows":["ball"],"permissions":["host-open-external"]}"#).unwrap();
        let ball = window(&app, "ball");
        assert_eq!(ipc(&ball, "open_external", serde_json::json!({"url":"https://example.invalid"})).unwrap_err(), "forbidden_window");
        app.add_capability(r#"{"identifier":"test-external-origin","windows":["main"],"remote":{"urls":["https://example.invalid"]},"permissions":["host-open-external"]}"#).unwrap();
        let remote = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::External("https://example.invalid".parse().unwrap())).build().unwrap();
        assert_eq!(ipc_at(&remote, "open_external", serde_json::json!({"url":"https://example.invalid"}), "https://example.invalid").unwrap_err(), "forbidden_window");
    }

    #[test]
    fn actual_ipc_settings_navigation_restores_hidden_main_without_creating_another_webview() {
        let context: tauri::Context<tauri::test::MockRuntime> = tauri::generate_context!();
        assert!(context.config().app.windows.iter().all(|config| !config.create),
            "WebView加载前须由setup完成Runtime装配，否则首个runtime_connection必然存在竞争");
        let (app, _) = ipc_app();
        let main = window(&app, "main");
        main.hide().unwrap();
        ipc(&main, "open_settings", serde_json::json!({"section":"models"})).unwrap();
        assert!(main.is_visible().unwrap());
        let quick = window(&app, "quick");
        ipc(&quick, "open_settings", serde_json::json!({"section":"assistant"})).unwrap();
        assert_eq!(ipc(&main, "take_settings_navigation", serde_json::json!({})).unwrap(), serde_json::json!({"section":"assistant","from_quick":true}));
        assert_eq!(app.webview_windows().len(), 2);
        assert!(app.get_webview_window("settings").is_none());
    }

    #[test]
    fn t11_product_windows_read_settings_and_aggregate_counts_without_ball_runtime_access() {
        let (app, _) = ipc_app();
        for label in ["main", "quick", "ball"] {
            let candidate = window(&app, label);
            let settings = ipc(&candidate, "window_settings", serde_json::json!({}));
            if label == "ball" { assert!(settings.unwrap_err().as_str().unwrap().contains("not allowed")); }
            else { assert_eq!(settings.unwrap(), serde_json::json!({"quick_pinned":false,"ball_enabled":false,"shortcut":null,"shortcut_error":null})); }
            assert_eq!(ipc(&candidate, "pending_counts", serde_json::json!({})).unwrap(), serde_json::Value::Null);
            if label == "ball" {
                for command in ["runtime_connection", "save_credential", "credential_status", "select_resources", "open_settings"] {
                    let error = ipc(&candidate, command, serde_json::json!({})).unwrap_err();
                    assert!(error.as_str().unwrap().contains("not allowed"), "{command}: {error}");
                }
            }
        }
    }

    #[test]
    fn t11_window_settings_guard_rejects_ball_even_with_broadened_acl() {
        let (app, _) = ipc_app();
        app.add_capability(r#"{"identifier":"test-ball-settings-read","windows":["ball"],"permissions":["host-window-read"]}"#).unwrap();
        let ball = window(&app, "ball");
        assert_eq!(ipc(&ball, "window_settings", serde_json::json!({})).unwrap_err(), "forbidden_window");
        assert_eq!(ipc(&ball, "pending_counts", serde_json::json!({})).unwrap(), serde_json::Value::Null);
    }

    #[test]
    fn t11_settings_events_only_wake_on_successful_settings_and_shortcut_errors() {
        use tauri::Listener;
        let (app, _) = ipc_app();
        for label in windows::LABELS { window(&app, label); }
        let directory = std::env::temp_dir().join("opencode").join(format!("flowmate-settings-event-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        *app.state::<Mutex<windows::Windows>>().lock().unwrap() = windows::Windows::load(&directory).unwrap();
        let payloads = Arc::new(Mutex::new(Vec::new())); let seen = payloads.clone();
        // 支持性Rust回归；JS Any/跨target实际投递另有 task-11-fix-round-1-events.mjs 真Wry证据。
        app.listen_any("window-settings-changed", move |event| seen.lock().unwrap().push(event.payload().to_owned()));
        let main = app.get_webview_window("main").unwrap();
        for (command, body, expected) in [
            ("set_quick_pinned", serde_json::json!({"pinned":true}), None),
            ("set_ball_enabled", serde_json::json!({"enabled":false}), None),
            ("set_shortcut", serde_json::json!({"chord":null}), None),
            ("set_shortcut", serde_json::json!({"chord":"not a shortcut"}), Some("invalid_shortcut")),
        ] {
            let response = ipc(&main, command, body);
            if let Some(error) = expected { assert_eq!(response.unwrap_err(), error); }
            else { assert!(response.is_ok(), "{command}: {response:?}"); }
            let received = std::mem::take(&mut *payloads.lock().unwrap());
            assert!(!received.is_empty(), "{command} must wake readers");
            assert!(received.iter().all(|payload| payload == "null"), "{command}: {received:?}");
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn settings_entry_guard_rejects_broadened_label_and_remote_acl() {
        let (app, _) = ipc_app();
        app.add_capability(r#"{"identifier":"test-settings-entry-label","windows":["preview"],"permissions":["host-open-settings"]}"#).unwrap();
        let preview = window(&app, "preview");
        assert_eq!(ipc(&preview, "open_settings", serde_json::json!({"section":"models"})).unwrap_err(), "forbidden_window");
        app.add_capability(r#"{"identifier":"test-settings-entry-origin","windows":["main"],"remote":{"urls":["https://example.invalid"]},"permissions":["host-open-settings"]}"#).unwrap();
        let remote = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::External("https://example.invalid".parse().unwrap())).build().unwrap();
        assert_eq!(ipc_at(&remote, "open_settings", serde_json::json!({"section":"models"}), "https://example.invalid").unwrap_err(), "forbidden_window");
    }

    #[test]
    fn actual_ipc_main_can_write_status_clear_but_no_window_can_read_or_unprotect() {
        let (app, store) = ipc_app(); let main = window(&app, "main");
        let binding = credentials::tests::binding();
        let _cleanup = credentials::tests::Cleanup(&store, binding.secret_ref.clone());
        let saved = ipc(&main, "save_credential", serde_json::json!({"binding":binding,"value":credentials::tests::KEY}));
        let _ = store.clear(&binding.secret_ref);
        assert_eq!(saved.unwrap(), serde_json::json!({"secret_ref":"public-test-ref","configured":true}));
        ipc(&main, "save_credential", serde_json::json!({"binding":binding,"value":credentials::tests::KEY})).unwrap();
        assert_eq!(ipc(&main, "credential_status", serde_json::json!({"secret_ref":binding.secret_ref})).unwrap()["configured"], true);
        assert_eq!(ipc(&main, "clear_credential", serde_json::json!({"secret_ref":binding.secret_ref})).unwrap()["configured"], false);
        for command in ["read_credential", "private_unprotect", "private.unprotect", "unprotect", "private_channel", "credential.resolve"] {
            let error = ipc(&main, command, serde_json::json!({})).unwrap_err();
            assert!(error.as_str().unwrap().contains("not allowed"), "{error}");
        }
    }

    #[test]
    fn actual_ipc_capabilities_reject_credential_commands_outside_main() {
        let (app, _) = ipc_app(); let mut binding = credentials::tests::binding(); binding.connection_id = "invalid".into();
        for label in ["quick", "ball", "settings", "preview"] {
            let window = window(&app, label);
            for (command, body) in [
                ("save_credential", serde_json::json!({"binding":binding,"value":""})),
                ("clear_credential", serde_json::json!({"secret_ref":""})),
                ("credential_status", serde_json::json!({"secret_ref":""})),
                ("private_unprotect", serde_json::json!({})),
            ] {
                let error = ipc(&window, command, body).unwrap_err();
                assert!(error.as_str().unwrap().contains("not allowed"), "{label} {command}: {error}");
            }
        }
    }

    #[test]
    fn actual_ipc_capabilities_limit_host_and_selection_commands_by_window() {
        let (app, _) = ipc_app();
        for label in ["main", "quick", "settings", "ball", "preview"] {
            let window = window(&app, label);
            for command in ["runtime_connection", "stop_runtime", "select_resources", "choose_export_target"] {
                let error = ipc(&window, command, serde_json::json!({"scope":{"workspace_id":"00000000-0000-4000-8000-000000000001"},"kind":"file"})).unwrap_err();
                let allowed = label == "main" || label == "quick";
                if allowed { assert_eq!(error, "host_unavailable", "{label}: {command}"); }
                else { assert!(error.as_str().unwrap().contains("not allowed"), "{label} {command}: {error}"); }
            }
        }
    }

    #[test]
    fn workspace_directory_commands_are_main_only_and_reach_the_owned_host() {
        let (app, _) = ipc_app();
        for label in ["main", "quick", "settings", "ball", "preview"] {
            let candidate = window(&app, label);
            for command in ["create_workspace_from_directory", "retry_workspace_from_directory", "check_workspace_directory_command"] {
                let error = ipc(&candidate, command, serde_json::json!({
                    "name":"目录项目", "meta":{"command_id":"00000000-0000-4000-8000-000000000003","expected_version":null},
                    "command_id":"00000000-0000-4000-8000-000000000003"
                })).unwrap_err();
                if label == "main" { assert_eq!(error, "host_unavailable", "{command}"); }
                else { assert!(error.as_str().unwrap().contains("not allowed"), "{label} {command}: {error}"); }
            }
        }
    }

    #[test]
    fn workspace_directory_guards_reject_broadened_quick_ball_and_remote_permissions() {
        let (app, _) = ipc_app();
        app.add_capability(r#"{"identifier":"test-directory-label","windows":["quick","ball"],"permissions":["host-workspace-directory"]}"#).unwrap();
        app.add_capability(r#"{"identifier":"test-directory-origin","windows":["main"],"remote":{"urls":["https://example.invalid"]},"permissions":["host-workspace-directory"]}"#).unwrap();
        let quick = window(&app, "quick"); let ball = window(&app, "ball");
        let remote = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::External("https://example.invalid".parse().unwrap())).build().unwrap();
        for command in ["create_workspace_from_directory", "retry_workspace_from_directory", "check_workspace_directory_command"] {
            let body = serde_json::json!({"name":"目录项目","meta":{"command_id":"00000000-0000-4000-8000-000000000003","expected_version":null},
                "command_id":"00000000-0000-4000-8000-000000000003"});
            assert_eq!(ipc(&quick, command, body.clone()).unwrap_err(), "forbidden_window");
            assert_eq!(ipc(&ball, command, body.clone()).unwrap_err(), "forbidden_window");
            assert_eq!(ipc_at(&remote, command, body, "https://example.invalid").unwrap_err(), "forbidden_window");
        }
    }

    #[test]
    fn workspace_directory_main_close_does_not_reset_quick_form_or_notifications() {
        let (app, _) = ipc_app(); let quick = window(&app, "quick");
        ipc(&quick, "set_quick_form_active", serde_json::json!({"active":true})).unwrap();
        close_workspace_directory_commands(app.handle(), "main");
        assert!(!app.state::<Mutex<windows::Windows>>().lock().unwrap().hide_on_blur());
        assert!(app.state::<Arc<Mutex<runtime_host::Notifications>>>().lock().unwrap().counts().is_none());
    }

    #[test]
    fn command_guards_reject_wrong_label_and_origin_even_if_acl_is_accidentally_broadened() {
        let (app, _) = ipc_app(); let mut binding = credentials::tests::binding(); binding.connection_id = "invalid".into();
        app.add_capability(r#"{"identifier":"test-broader-local","windows":["preview"],"permissions":["host-settings"]}"#).unwrap();
        let preview = window(&app, "preview");
        assert_eq!(ipc(&preview, "save_credential", serde_json::json!({"binding":binding,"value":credentials::tests::KEY})).unwrap_err(), "forbidden_window");
        app.add_capability(r#"{"identifier":"test-broader-remote","windows":["main"],"remote":{"urls":["https://example.invalid"]},"permissions":["host-settings"]}"#).unwrap();
        let remote = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::External("https://example.invalid".parse().unwrap())).build().unwrap();
        assert_eq!(ipc_at(&remote, "save_credential", serde_json::json!({"binding":binding,"value":credentials::tests::KEY}), "https://example.invalid").unwrap_err(), "forbidden_window");
    }

    #[test]
    fn t11_actual_ipc_acl_has_narrow_entry_settings_navigation_and_event_permissions() {
        let (app, _) = ipc_app();
        for label in windows::LABELS { window(&app, label); }
        window(&app, "settings");
        window(&app, "preview");
        for label in ["main", "quick", "settings", "ball", "preview"] {
            let candidate = app.get_webview_window(label).unwrap();
            for (command, body, allowed, expected) in [
                ("set_quick_pinned", serde_json::json!({"pinned":true}), ["main", "quick"].contains(&label), "window_settings_save_failed"),
                ("set_ball_enabled", serde_json::json!({"enabled":false}), ["main", "quick"].contains(&label), "window_settings_save_failed"),
                ("set_shortcut", serde_json::json!({"chord":"not a shortcut"}), ["main", "quick"].contains(&label), "invalid_shortcut"),
            ] {
                let error = ipc(&candidate, command, body).unwrap_err();
                if allowed { assert_eq!(error, expected, "{label} {command}"); }
                else { assert!(error.as_str().unwrap().contains("not allowed"), "{label} {command}: {error}"); }
            }
            for (command, body, allowed) in [
                ("toggle_quick", serde_json::json!({}), ["main", "quick", "ball"].contains(&label)),
                ("show_workbench", serde_json::json!({"run_id":null}), ["main", "quick", "ball"].contains(&label)),
                ("take_workbench_navigation", serde_json::json!({}), label == "main"),
                ("set_quick_form_active", serde_json::json!({"active":true}), label == "quick"),
                ("window_settings", serde_json::json!({}), ["main", "quick"].contains(&label)),
                ("pending_counts", serde_json::json!({}), windows::LABELS.contains(&label)),
            ] {
                let response = ipc(&candidate, command, body);
                if allowed { assert!(response.is_ok(), "{label} {command}: {response:?}"); }
                else { assert!(response.unwrap_err().as_str().unwrap().contains("not allowed"), "{label} {command}"); }
            }
            let response = ipc(&candidate, "plugin:event|listen", serde_json::json!({"event":"pending-counts","target":{"kind":"WebviewWindow","label":label},"handler":0}));
            if windows::LABELS.contains(&label) {
                let event_id = response.unwrap();
                ipc(&candidate, "plugin:event|unlisten", serde_json::json!({"event":"pending-counts","eventId":event_id})).unwrap();
            } else { assert!(response.unwrap_err().as_str().unwrap().contains("not allowed")); }
            for command in ["plugin:event|emit", "plugin:event|emit_to", "plugin:window|create", "plugin:window|show", "plugin:window|hide",
                "plugin:window|set_always_on_top", "plugin:window|start_dragging", "plugin:global-shortcut|register", "plugin:global-shortcut|unregister",
                "plugin:opener|open_url", "plugin:dialog|open", "plugin:fs|read_file"] {
                let error = ipc(&candidate, command, serde_json::json!({})).unwrap_err();
                assert!(error.as_str().unwrap().contains("not allowed"), "{label} {command}: {error}");
            }
        }
    }

    #[test]
    fn t11_command_guards_reject_broadened_preview_remote_and_ball_navigation_with_id() {
        let (app, _) = ipc_app();
        let permissions = serde_json::json!(["host-window-read","host-pending-counts","host-window-settings","host-window-entry","host-workbench-navigation","host-quick-form"]);
        app.add_capability(serde_json::json!({"identifier":"test-window-preview","windows":["preview"],"permissions":permissions}).to_string()).unwrap();
        app.add_capability(serde_json::json!({"identifier":"test-window-remote","windows":["main"],"remote":{"urls":["https://example.invalid"]},"permissions":permissions}).to_string()).unwrap();
        let preview = window(&app, "preview");
        let remote = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::External("https://example.invalid".parse().unwrap())).build().unwrap();
        for (command, body) in [
            ("window_settings", serde_json::json!({})), ("pending_counts", serde_json::json!({})),
            ("set_quick_pinned", serde_json::json!({"pinned":true})), ("set_ball_enabled", serde_json::json!({"enabled":true})),
            ("set_shortcut", serde_json::json!({"chord":null})), ("toggle_quick", serde_json::json!({})),
            ("show_workbench", serde_json::json!({"run_id":null})), ("take_workbench_navigation", serde_json::json!({})),
            ("set_quick_form_active", serde_json::json!({"active":true})),
        ] {
            assert_eq!(ipc(&preview, command, body.clone()).unwrap_err(), "forbidden_window", "{command}");
            assert_eq!(ipc_at(&remote, command, body, "https://example.invalid").unwrap_err(), "forbidden_window", "{command}");
        }
        let ball = window(&app, "ball");
        assert_eq!(ipc(&ball, "show_workbench", serde_json::json!({"run_id":"00000000-0000-4000-8000-000000000001"})).unwrap_err(), "forbidden_navigation");
        let quick = window(&app, "quick");
        assert_eq!(ipc(&quick, "show_workbench", serde_json::json!({"run_id":"not an id or message body"})).unwrap_err(), "invalid_run_id");
    }

    #[test]
    fn t11_actual_ipc_navigation_is_pending_until_main_claims_and_event_has_no_id_or_content() {
        use tauri::Listener;
        let (app, _) = ipc_app();
        let main = window(&app, "main"); let quick = window(&app, "quick"); let ball = window(&app, "ball");
        let first = "00000000-0000-4000-8000-000000000001";
        ipc(&quick, "show_workbench", serde_json::json!({"run_id":first})).unwrap();
        assert_eq!(ipc(&main, "take_workbench_navigation", serde_json::json!({})).unwrap(), first);
        let wakeups = Arc::new(Mutex::new(Vec::new())); let seen = wakeups.clone();
        main.listen("workbench-navigation", move |event| seen.lock().unwrap().push(event.payload().to_owned()));
        let unexpected = Arc::new(Mutex::new(0));
        for candidate in [&quick, &ball] {
            let seen = unexpected.clone(); candidate.listen("workbench-navigation", move |_| *seen.lock().unwrap() += 1);
        }
        let second = "00000000-0000-4000-8000-000000000002";
        ipc(&quick, "show_workbench", serde_json::json!({"run_id":second})).unwrap();
        assert_eq!(*wakeups.lock().unwrap(), ["null"]);
        assert_eq!(*unexpected.lock().unwrap(), 0);
        assert_eq!(ipc(&main, "take_workbench_navigation", serde_json::json!({})).unwrap(), second);
        assert_eq!(ipc(&main, "take_workbench_navigation", serde_json::json!({})).unwrap(), serde_json::Value::Null);
        ipc(&quick, "set_quick_form_active", serde_json::json!({"active":true})).unwrap();
        ipc(&quick, "toggle_quick", serde_json::json!({})).unwrap();
        assert!(!app.state::<Mutex<windows::Windows>>().lock().unwrap().hide_on_blur(), "显式隐藏不丢弃草稿状态");
        assert_eq!(app.webview_windows().len(), 3, "切窗不能创建第二个 WebView");
    }

    #[test]
    fn t11_native_dialog_guard_retains_quick_without_erasing_frontend_draft_state() {
        let (app, _) = ipc_app(); let quick = window(&app, "quick"); let main = window(&app, "main");
        assert!(NativeDialog::begin(&main, app.handle()).unwrap().is_none());
        let dialog = NativeDialog::begin(&quick, app.handle()).unwrap();
        assert!(!app.state::<Mutex<windows::Windows>>().lock().unwrap().hide_on_blur());
        ipc(&quick, "set_quick_form_active", serde_json::json!({"active":true})).unwrap();
        drop(dialog);
        assert!(!app.state::<Mutex<windows::Windows>>().lock().unwrap().hide_on_blur());
        ipc(&quick, "set_quick_form_active", serde_json::json!({"active":false})).unwrap();
        assert!(app.state::<Mutex<windows::Windows>>().lock().unwrap().hide_on_blur());
    }

    #[test]
    fn t11_ball_drag_ipc_is_ball_only_without_generic_window_permissions() {
        let (app, _) = ipc_app();
        for label in ["main", "quick", "settings", "preview", "ball"] {
            let candidate = window(&app, label);
            let response = ipc(&candidate, "start_ball_drag", serde_json::json!({}));
            if label == "ball" { assert_eq!(response.unwrap(), serde_json::Value::Null); }
            else { assert!(response.unwrap_err().as_str().unwrap().contains("not allowed"), "{label}"); }
            let error = ipc(&candidate, "plugin:window|start_dragging", serde_json::json!({"label":"main"})).unwrap_err();
            assert!(error.as_str().unwrap().contains("not allowed"), "{label}: {error}");
        }
    }

    #[test]
    fn t11_ball_drag_guard_rejects_broadened_label_and_remote() {
        let (app, _) = ipc_app();
        app.add_capability(r#"{"identifier":"test-ball-drag-label","windows":["preview"],"permissions":["host-ball-drag"]}"#).unwrap();
        let preview = window(&app, "preview");
        assert_eq!(ipc(&preview, "start_ball_drag", serde_json::json!({})).unwrap_err(), "forbidden_window");
        app.add_capability(r#"{"identifier":"test-ball-drag-origin","windows":["ball"],"remote":{"urls":["https://example.invalid"]},"permissions":["host-ball-drag"]}"#).unwrap();
        let remote = tauri::WebviewWindowBuilder::new(&app, "ball", tauri::WebviewUrl::External("https://example.invalid".parse().unwrap())).build().unwrap();
        assert_eq!(ipc_at(&remote, "start_ball_drag", serde_json::json!({}), "https://example.invalid").unwrap_err(), "forbidden_window");
    }

    #[test]
    fn t11_real_owned_host_is_shared_across_mock_ipc_restore_and_three_product_windows() {
        use std::path::Path;
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap();
        let directory = std::env::temp_dir().join("opencode").join(format!("flowmate-ipc-host-{}", uuid::Uuid::new_v4()));
        let runtime = runtime_host::DevelopmentRuntime::new(root.join(".venv/Scripts/python.exe"), root.to_owned()).unwrap();
        let host = runtime_host::tests::start_isolated_development(&directory, &runtime, cfg!(dev)).unwrap();
        let connection = serde_json::to_value(&host.connection).unwrap();
        let (app, _) = ipc_app_with_notifications(host.notifications()); app.manage(Mutex::new(host));
        for label in windows::LABELS { window(&app, label); }
        for label in ["main", "quick"] {
            let candidate = app.get_webview_window(label).unwrap();
            assert_eq!(ipc(&candidate, "runtime_connection", serde_json::json!({})).unwrap(), connection);
        }
        let ball = app.get_webview_window("ball").unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while ipc(&ball, "pending_counts", serde_json::json!({})).unwrap().is_null() {
            assert!(std::time::Instant::now() < deadline, "真实私有通知桥必须在启动后发送初始聚合");
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(ipc(&ball, "pending_counts", serde_json::json!({})).unwrap(), serde_json::json!({"pending_questions":0,"pending_approvals":0}));
        for _ in 0..3 {
            ipc(&ball, "toggle_quick", serde_json::json!({})).unwrap();
            ipc(&ball, "show_workbench", serde_json::json!({"run_id":null})).unwrap();
        }
        app.state::<Mutex<RuntimeHost>>().lock().unwrap().stop();
        let log = std::fs::read_to_string(directory.join("desktop-host.jsonl")).unwrap();
        assert_eq!(log.lines().filter(|line| line.contains("\"event\":\"host_ready\"")).count(), 1);
        assert!(log.contains("\"graceful\":true"));
        assert_eq!(app.webview_windows().len(), 3);
        drop(ball); drop(app);
        std::fs::remove_dir_all(directory).unwrap();
    }

    struct DesktopState {
        visible: bool,
        focused: bool,
        runtime_alive: bool,
        exited: bool,
        runtime_instances: u32,
        settings_requested: bool,
    }
    struct Desktop(RefCell<DesktopState>);

    impl TrayTarget for Desktop {
        fn open_model_settings(&self) -> Result<(), String> {
            self.0.borrow_mut().settings_requested = true;
            self.restore_main_window()
        }
        fn restore_quick_window(&self) -> Result<(), String> { self.0.borrow_mut().visible = true; Ok(()) }
        fn restore_main_window(&self) -> Result<(), String> {
            let mut state = self.0.borrow_mut();
            state.visible = true;
            state.focused = true;
            Ok(())
        }
        fn stop_owned_runtime(&self) -> Result<(), String> {
            self.0.borrow_mut().runtime_alive = false;
            Ok(())
        }
        fn exit_application(&self) {
            let mut state = self.0.borrow_mut();
            assert!(!state.runtime_alive, "exit must follow RuntimeHost stop");
            state.exited = true;
        }
    }

    #[test]
    fn hidden_window_recovers_and_exits_through_tray_actions() {
        let desktop = Desktop(RefCell::new(DesktopState {
            visible: false, focused: false, runtime_alive: true, exited: false, runtime_instances: 1, settings_requested: false,
        }));
        dispatch_tray_action(&desktop, "tray-show").unwrap();
        assert!(desktop.0.borrow().visible && desktop.0.borrow().focused);
        assert!(desktop.0.borrow().runtime_alive);
        assert_eq!(desktop.0.borrow().runtime_instances, 1);
        dispatch_tray_action(&desktop, "tray-exit").unwrap();
        assert!(desktop.0.borrow().exited);
        assert!(!desktop.0.borrow().runtime_alive);
    }

    #[test]
    fn unknown_tray_action_cannot_start_or_stop_anything() {
        let desktop = Desktop(RefCell::new(DesktopState {
            visible: false, focused: false, runtime_alive: true, exited: false, runtime_instances: 1, settings_requested: false,
        }));
        assert!(dispatch_tray_action(&desktop, "shell").is_err());
        assert!(!desktop.0.borrow().visible && desktop.0.borrow().runtime_alive);
        assert!(!desktop.0.borrow().exited);
    }

    #[test]
    fn t14_tray_settings_restores_main_without_restarting_runtime_and_exit_still_stops_first() {
        let desktop = Desktop(RefCell::new(DesktopState {
            visible: false, focused: false, runtime_alive: true, exited: false, runtime_instances: 1, settings_requested: false,
        }));
        dispatch_tray_action(&desktop, "tray-settings").unwrap();
        assert!(desktop.0.borrow().settings_requested);
        assert!(desktop.0.borrow().visible && desktop.0.borrow().focused);
        assert!(desktop.0.borrow().runtime_alive && !desktop.0.borrow().exited);
        assert_eq!(desktop.0.borrow().runtime_instances, 1);
        dispatch_tray_action(&desktop, "tray-exit").unwrap();
        assert!(desktop.0.borrow().exited && !desktop.0.borrow().runtime_alive);
    }
}

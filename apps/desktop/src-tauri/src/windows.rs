use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{Emitter, EventTarget, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const LABELS: [&str; 3] = ["main", "quick", "ball"];

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SettingsSection { Models, Assistant, Resources, Windows, Memory, Environments }

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
pub struct SettingsNavigation { pub section: SettingsSection, pub from_quick: bool }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkbenchTarget {
    Run { run_id: String },
    Task { task_id: String },
    Tasks { workspace_id: Option<String> },
    Assistants {},
    Memory {},
    Capabilities {},
    Mcp { server_id: Option<String>, workspace_id: Option<String> },
}

impl WorkbenchTarget {
    pub fn validate(&self) -> Result<(), String> {
        let id = match self {
            Self::Run { run_id } => Some(run_id),
            Self::Task { task_id } => Some(task_id),
            Self::Tasks { workspace_id } => workspace_id.as_ref(),
            Self::Mcp { server_id, .. } => server_id.as_ref(),
            Self::Assistants {} | Self::Memory {} | Self::Capabilities {} => None,
        };
        if let Self::Mcp { workspace_id: Some(id), .. } = self {
            if uuid::Uuid::parse_str(id).is_err() { return Err("invalid_navigation_id".into()); }
        }
        if id.is_some_and(|id| uuid::Uuid::parse_str(id).is_err()) { return Err("invalid_navigation_id".into()); }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct WorkbenchNavigation { pub target: Option<WorkbenchTarget>, pub from_quick: bool }

pub fn window_config(config: &tauri::utils::config::WindowConfig) -> tauri::utils::config::WindowConfig {
    let mut config = config.clone();
    if config.label == "ball" {
        // 不可缩放不等于绕过 Windows 的默认最小跟踪尺寸；用既有逻辑尺寸明确固定客户区。
        config.min_width = Some(config.width); config.max_width = Some(config.width);
        config.min_height = Some(config.height); config.max_height = Some(config.height);
    }
    config
}

#[derive(Clone, Default, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct Preferences {
    quick_pinned: bool,
    ball_enabled: bool,
    shortcut: Option<String>,
}

#[derive(Clone, Default, Debug, Serialize, PartialEq)]
pub struct WindowSettings {
    #[serde(flatten)]
    preferences: Preferences,
    shortcut_error: Option<String>,
}

pub trait SettingsEffects {
    fn pin_quick(&self, pinned: bool) -> Result<(), String>;
    fn enable_ball(&self, enabled: bool) -> Result<(), String>;
    fn register_shortcut(&self, chord: &str) -> Result<(), String>;
    fn unregister_shortcut(&self, chord: &str) -> Result<(), String>;
}

pub struct Windows {
    path: PathBuf,
    settings: WindowSettings,
    active_shortcut: Option<String>,
    form_active: bool,
    native_dialogs: usize,
    navigation: Option<WorkbenchNavigation>,
    settings_navigation: Option<SettingsNavigation>,
}

impl Windows {
    pub fn load(directory: &Path) -> Result<Self, String> {
        let path = directory.join("window-settings.json");
        let preferences = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "invalid_window_settings")?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Preferences::default(),
            Err(_) => return Err("window_settings_read_failed".into()),
        };
        Ok(Self { path, settings: WindowSettings { preferences, shortcut_error: None },
            active_shortcut: None, form_active: false, native_dialogs: 0, navigation: None, settings_navigation: None })
    }
    pub fn settings(&self) -> WindowSettings { self.settings.clone() }
    fn save(&self, preferences: &Preferences) -> Result<(), String> {
        let temporary = self.path.with_extension("json.tmp");
        let bytes = serde_json::to_vec(preferences).map_err(|_| "window_settings_save_failed")?;
        let result = (|| {
            use std::io::Write;
            let mut file = std::fs::File::create(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&temporary, &self.path)
        })();
        if result.is_err() {
            // 仅清理本次写入的临时文件，不覆盖旧配置。
            let _ = std::fs::remove_file(temporary);
            return Err("window_settings_save_failed".into());
        }
        Ok(())
    }
    pub fn set_pin(&mut self, effects: &impl SettingsEffects, pinned: bool) -> Result<WindowSettings, String> {
        let mut next = self.settings.preferences.clone(); next.quick_pinned = pinned;
        effects.pin_quick(pinned)?;
        if let Err(error) = self.save(&next) {
            effects.pin_quick(self.settings.preferences.quick_pinned).map_err(|_| "window_settings_rollback_failed")?;
            return Err(error);
        }
        self.settings.preferences = next; Ok(self.settings())
    }
    pub fn set_ball(&mut self, effects: &impl SettingsEffects, enabled: bool) -> Result<WindowSettings, String> {
        let mut next = self.settings.preferences.clone(); next.ball_enabled = enabled;
        effects.enable_ball(enabled)?;
        if let Err(error) = self.save(&next) {
            effects.enable_ball(self.settings.preferences.ball_enabled).map_err(|_| "window_settings_rollback_failed")?;
            return Err(error);
        }
        self.settings.preferences = next; Ok(self.settings())
    }
    fn replace_shortcut(&mut self, effects: &impl SettingsEffects, chord: Option<String>) -> Result<(), String> {
        if self.active_shortcut == chord { return Ok(()); }
        // 先尝试新组合；注册失败时旧绑定从未被注销，也不会抢占别的应用。
        if let Some(next) = &chord { effects.register_shortcut(next)?; }
        if let Some(previous) = &self.active_shortcut {
            if let Err(error) = effects.unregister_shortcut(previous) {
                if let Some(next) = &chord {
                    effects.unregister_shortcut(next).map_err(|_| "shortcut_rollback_failed")?;
                }
                return Err(error);
            }
        }
        self.active_shortcut = chord; Ok(())
    }
    pub fn set_shortcut(&mut self, effects: &impl SettingsEffects, chord: Option<String>) -> Result<WindowSettings, String> {
        let result = (|| {
            let chord = chord.map(|value| value.parse::<Shortcut>().map(|shortcut| shortcut.to_string())
                .map_err(|_| "invalid_shortcut".to_owned())).transpose()?;
            let previous = self.active_shortcut.clone();
            self.replace_shortcut(effects, chord.clone())?;
            let mut next = self.settings.preferences.clone(); next.shortcut = chord;
            if let Err(error) = self.save(&next) {
                self.replace_shortcut(effects, previous).map_err(|_| "shortcut_rollback_failed")?;
                return Err(error);
            }
            self.settings.preferences = next;
            Ok(())
        })();
        self.settings.shortcut_error = result.as_ref().err().cloned();
        result.map(|()| self.settings())
    }
    pub fn restore(&mut self, effects: &impl SettingsEffects) -> Result<(), String> {
        effects.pin_quick(self.settings.preferences.quick_pinned)?;
        effects.enable_ball(self.settings.preferences.ball_enabled)?;
        // 恢复冲突只改变展示错误，不能终止唯一 Runtime 或改写用户配置。
        self.settings.shortcut_error = self.replace_shortcut(effects, self.settings.preferences.shortcut.clone()).err();
        Ok(())
    }
    pub fn form_active(&mut self, active: bool) { self.form_active = active; }
    pub fn begin_dialog(&mut self) { self.native_dialogs += 1; }
    pub fn end_dialog(&mut self) { self.native_dialogs -= 1; }
    pub fn hide_on_blur(&self) -> bool { !self.settings.preferences.quick_pinned && !self.form_active && self.native_dialogs == 0 }
    pub fn navigate(&mut self, target: Option<WorkbenchTarget>, from_quick: bool) {
        self.navigation = if target.is_some() || from_quick { Some(WorkbenchNavigation { target, from_quick }) } else { None };
    }
    pub fn take_navigation(&mut self) -> Option<WorkbenchNavigation> { self.navigation.take() }
    pub fn navigate_settings(&mut self, section: SettingsSection, from_quick: bool) { self.settings_navigation = Some(SettingsNavigation { section, from_quick }); }
    pub fn take_settings_navigation(&mut self) -> Option<SettingsNavigation> { self.settings_navigation.take() }
}

pub fn shortcut_pressed(state: ShortcutState) -> bool { state == ShortcutState::Pressed }

impl<R: tauri::Runtime> SettingsEffects for tauri::AppHandle<R> {
    fn pin_quick(&self, pinned: bool) -> Result<(), String> {
        self.get_webview_window("quick").ok_or("quick_window_missing")?.set_always_on_top(pinned).map_err(|_| "pin_failed".into())
    }
    fn enable_ball(&self, enabled: bool) -> Result<(), String> {
        let ball = self.get_webview_window("ball").ok_or("ball_window_missing")?;
        if enabled { fit_visible_area(&ball)?; ball.show().map_err(|_| "show_failed".into()) }
        else { ball.hide().map_err(|_| "hide_failed".into()) }
    }
    fn register_shortcut(&self, chord: &str) -> Result<(), String> {
        self.global_shortcut().on_shortcut(chord, |app, _, event| {
            if shortcut_pressed(event.state) {
                if let Err(error) = toggle_quick(app) { super::log_native_error(app, &error); }
            }
        }).map_err(|_| "shortcut_registration_failed".into())
    }
    fn unregister_shortcut(&self, chord: &str) -> Result<(), String> {
        self.global_shortcut().unregister(chord).map_err(|_| "shortcut_unregister_failed".into())
    }
}

pub fn publish_settings<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    for label in LABELS {
        // JS 可监听任意 target；target 不是读取 ACL，事件只能唤醒授权窗口重新查询。
        app.emit_to(EventTarget::webview_window(label), "window-settings-changed", ()).map_err(|_| "window_event_failed")?;
    }
    Ok(())
}

pub fn show<R: tauri::Runtime>(app: &tauri::AppHandle<R>, label: &str) -> Result<(), String> {
    let window = app.get_webview_window(label).ok_or("product_window_missing")?;
    window.unminimize().map_err(|_| "unminimize_failed")?;
    fit_visible_area(&window)?;
    window.show().map_err(|_| "show_failed")?;
    window.set_focus().map_err(|_| "focus_failed".into())
}

pub fn open_settings<R: tauri::Runtime>(app: &tauri::AppHandle<R>, section: SettingsSection, from_quick: bool) -> Result<(), String> {
    app.state::<std::sync::Mutex<Windows>>().lock().map_err(|_| "window_state_unavailable")?.navigate_settings(section, from_quick);
    show(app, "main")?;
    // 业务 section 只由 main 领取；事件仅唤醒，晚注册 listener 不丢导航。
    app.emit_to(EventTarget::webview_window("main"), "settings-navigation", ()).map_err(|_| "window_event_failed".into())
}

pub fn toggle_quick<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let window = app.get_webview_window("quick").ok_or("quick_window_missing")?;
    if window.is_visible().map_err(|_| "window_visibility_failed")? {
        window.hide().map_err(|_| "hide_failed".into())
    } else { show(app, "quick") }
}

// monitor.work_area 与窗口尺寸均为物理像素，不混用逻辑 DPI；包含负坐标副屏和任务栏。
fn visible_geometry(position: tauri::PhysicalPosition<i32>, outer: tauri::PhysicalSize<u32>,
    inner: tauri::PhysicalSize<u32>, area: &tauri::PhysicalRect<i32, u32>) -> (tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>) {
    let width = outer.width.min(area.size.width);
    let height = outer.height.min(area.size.height);
    let size = tauri::PhysicalSize::new(inner.width.saturating_sub(outer.width - width), inner.height.saturating_sub(outer.height - height));
    let x = i64::from(position.x).clamp(i64::from(area.position.x), i64::from(area.position.x) + i64::from(area.size.width - width));
    let y = i64::from(position.y).clamp(i64::from(area.position.y), i64::from(area.position.y) + i64::from(area.size.height - height));
    (tauri::PhysicalPosition::new(x as i32, y as i32), size)
}

pub fn fit_visible_area<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Result<(), String> {
    let monitor = window.current_monitor().map_err(|_| "monitor_query_failed")?
        .or(window.primary_monitor().map_err(|_| "monitor_query_failed")?);
    // 无显示器会话没有可定位区域；之后的恢复入口仍会重新查询真实 monitor。
    if let Some(monitor) = monitor {
        let inner = window.inner_size().map_err(|_| "window_geometry_failed")?;
        let (position, size) = visible_geometry(window.outer_position().map_err(|_| "window_geometry_failed")?,
            window.outer_size().map_err(|_| "window_geometry_failed")?, inner, monitor.work_area());
        if size != inner { window.set_size(size).map_err(|_| "window_geometry_failed")?; }
        window.set_position(position).map_err(|_| "window_geometry_failed")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::HashSet};

    #[test]
    fn t14_only_main_quick_and_ball_have_native_window_configuration() {
        let context: tauri::Context<tauri::test::MockRuntime> = tauri::generate_context!();
        let labels: HashSet<&str> = context.config().app.windows.iter().map(|config| config.label.as_str()).collect();
        assert_eq!(labels, HashSet::from(["main", "quick", "ball"]));
        assert_eq!(LABELS.into_iter().collect::<HashSet<_>>(), labels);
        assert!(context.config().app.windows.iter().all(|config| !config.create));
    }

    #[test]
    fn fixed_ball_constraints_consume_configured_client_size_and_leave_other_windows_unchanged() {
        let context: tauri::Context<tauri::test::MockRuntime> = tauri::generate_context!();
        for original in &context.config().app.windows {
            let mut source = original.clone();
            // 改变配置输入，证明约束来自窗口配置，不是复制 CSS 或 Windows 最小跟踪尺寸。
            source.width += 13.0; source.height += 7.0;
            let actual = window_config(&source);
            if source.label == "ball" {
                assert_eq!(actual.min_width, Some(source.width));
                assert_eq!(actual.max_width, Some(source.width));
                assert_eq!(actual.min_height, Some(source.height));
                assert_eq!(actual.max_height, Some(source.height));
                let mut expected = source.clone();
                expected.min_width = Some(source.width); expected.max_width = Some(source.width);
                expected.min_height = Some(source.height); expected.max_height = Some(source.height);
                assert_eq!(serde_json::to_value(actual).unwrap(), serde_json::to_value(expected).unwrap());
            } else {
                assert_eq!(serde_json::to_value(actual).unwrap(), serde_json::to_value(source).unwrap());
            }
        }
    }

    #[derive(Default)]
    struct Desktop {
        pinned: RefCell<bool>, ball: RefCell<bool>, shortcuts: RefCell<HashSet<String>>,
        conflict: RefCell<Option<String>>,
    }
    impl SettingsEffects for Desktop {
        fn pin_quick(&self, pinned: bool) -> Result<(), String> { *self.pinned.borrow_mut() = pinned; Ok(()) }
        fn enable_ball(&self, enabled: bool) -> Result<(), String> { *self.ball.borrow_mut() = enabled; Ok(()) }
        fn register_shortcut(&self, chord: &str) -> Result<(), String> {
            if self.conflict.borrow().as_deref() == Some(chord) { return Err("shortcut_registration_failed".into()); }
            assert!(self.shortcuts.borrow_mut().insert(chord.into())); Ok(())
        }
        fn unregister_shortcut(&self, chord: &str) -> Result<(), String> {
            assert!(self.shortcuts.borrow_mut().remove(chord)); Ok(())
        }
    }
    fn fixture() -> (PathBuf, Windows, Desktop) {
        let directory = std::env::temp_dir().join("opencode").join(format!("flowmate-windows-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let windows = Windows::load(&directory).unwrap();
        (directory, windows, Desktop::default())
    }
    #[test]
    fn settings_persist_only_explicit_pin_ball_and_shortcut_and_restore_them() {
        let (directory, mut windows, desktop) = fixture();
        windows.restore(&desktop).unwrap();
        assert!(desktop.shortcuts.borrow().is_empty());
        windows.set_pin(&desktop, true).unwrap();
        windows.set_ball(&desktop, true).unwrap();
        windows.set_shortcut(&desktop, Some("Ctrl+Shift+K".into())).unwrap();
        assert!(*desktop.pinned.borrow() && *desktop.ball.borrow());
        let disk: serde_json::Value = serde_json::from_slice(&std::fs::read(&windows.path).unwrap()).unwrap();
        assert_eq!(disk.as_object().unwrap().len(), 3);
        let mut restored = Windows::load(&directory).unwrap();
        let restarted = Desktop::default(); restored.restore(&restarted).unwrap();
        assert_eq!(restored.settings(), windows.settings());
        assert!(*restarted.pinned.borrow() && *restarted.ball.borrow());
        assert_eq!(*restarted.shortcuts.borrow(), *desktop.shortcuts.borrow());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn shortcut_conflict_preserves_old_registration_and_saved_binding_and_exposes_error() {
        let (directory, mut windows, desktop) = fixture();
        windows.set_shortcut(&desktop, Some("Ctrl+Shift+K".into())).unwrap();
        let previous = windows.settings().preferences.shortcut;
        let conflict = "control+shift+KeyL".parse::<tauri_plugin_global_shortcut::Shortcut>().unwrap().to_string();
        *desktop.conflict.borrow_mut() = Some(conflict);
        assert_eq!(windows.set_shortcut(&desktop, Some("Ctrl+Shift+L".into())).unwrap_err(), "shortcut_registration_failed");
        assert_eq!(windows.settings().preferences.shortcut, previous);
        assert_eq!(windows.settings().shortcut_error.as_deref(), Some("shortcut_registration_failed"));
        assert_eq!(desktop.shortcuts.borrow().len(), 1);
        assert!(desktop.shortcuts.borrow().contains(previous.as_ref().unwrap()));
        assert_eq!(Windows::load(&directory).unwrap().settings.preferences.shortcut, previous);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn failed_save_rejects_and_restores_native_effects_instead_of_claiming_success() {
        let (directory, mut windows, desktop) = fixture();
        windows.set_shortcut(&desktop, Some("Ctrl+Shift+K".into())).unwrap();
        let previous = windows.settings().preferences;
        std::fs::remove_file(&windows.path).unwrap();
        std::fs::create_dir(&windows.path).unwrap();
        assert_eq!(windows.set_pin(&desktop, true).unwrap_err(), "window_settings_save_failed");
        assert!(!*desktop.pinned.borrow());
        assert_eq!(windows.set_ball(&desktop, true).unwrap_err(), "window_settings_save_failed");
        assert!(!*desktop.ball.borrow());
        assert_eq!(windows.set_shortcut(&desktop, Some("Ctrl+Shift+L".into())).unwrap_err(), "window_settings_save_failed");
        assert_eq!(windows.settings().preferences, previous);
        assert_eq!(desktop.shortcuts.borrow().len(), 1);
        assert!(desktop.shortcuts.borrow().contains(previous.shortcut.as_ref().unwrap()));
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn startup_shortcut_conflict_is_visible_and_retry_or_disable_is_explicit() {
        let (directory, mut windows, desktop) = fixture();
        windows.set_shortcut(&desktop, Some("Ctrl+Shift+K".into())).unwrap();
        let mut restarted = Windows::load(&directory).unwrap();
        let next = Desktop::default();
        *next.conflict.borrow_mut() = restarted.settings.preferences.shortcut.clone();
        restarted.restore(&next).unwrap();
        assert_eq!(restarted.settings.shortcut_error.as_deref(), Some("shortcut_registration_failed"));
        assert!(next.shortcuts.borrow().is_empty());
        *next.conflict.borrow_mut() = None;
        restarted.set_shortcut(&next, restarted.settings.preferences.shortcut.clone()).unwrap();
        assert!(restarted.settings.shortcut_error.is_none());
        restarted.set_shortcut(&next, None).unwrap();
        assert!(next.shortcuts.borrow().is_empty());
        assert!(Windows::load(&directory).unwrap().settings.preferences.shortcut.is_none());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn pin_forms_and_nested_native_dialogs_retain_quick_until_safe_blur() {
        let (directory, mut windows, desktop) = fixture();
        assert!(windows.hide_on_blur());
        windows.set_pin(&desktop, true).unwrap(); assert!(!windows.hide_on_blur());
        windows.set_pin(&desktop, false).unwrap();
        windows.form_active(true); assert!(!windows.hide_on_blur());
        windows.begin_dialog(); windows.begin_dialog(); windows.form_active(false);
        assert!(!windows.hide_on_blur());
        windows.end_dialog(); assert!(!windows.hide_on_blur());
        windows.end_dialog(); assert!(windows.hide_on_blur());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn navigation_is_latest_id_only_consumed_once_without_runtime_content() {
        let (directory, mut windows, _) = fixture();
        assert_eq!(windows.take_navigation(), None);
        windows.navigate(Some(WorkbenchTarget::Run { run_id: "00000000-0000-4000-8000-000000000001".into() }), false);
        windows.navigate(Some(WorkbenchTarget::Task { task_id: "00000000-0000-4000-8000-000000000002".into() }), true);
        assert_eq!(windows.take_navigation(), Some(WorkbenchNavigation { target: Some(WorkbenchTarget::Task { task_id: "00000000-0000-4000-8000-000000000002".into() }), from_quick: true }));
        assert_eq!(windows.take_navigation(), None);
        windows.navigate(Some(WorkbenchTarget::Tasks { workspace_id: None }), true);
        assert_eq!(windows.take_navigation(), Some(WorkbenchNavigation { target: Some(WorkbenchTarget::Tasks { workspace_id: None }), from_quick: true }));
        assert!(WorkbenchTarget::Task { task_id: "not-an-id".into() }.validate().is_err());
        assert!(serde_json::from_value::<WorkbenchTarget>(serde_json::json!({"kind":"tasks","workspace_id":null,"body":"private"})).is_err());
        windows.navigate(None, false); assert_eq!(windows.take_navigation(), None);
        windows.navigate(None, true);
        assert_eq!(windows.take_navigation(), Some(WorkbenchNavigation { target: None, from_quick: true }));
        let assistants: WorkbenchTarget = serde_json::from_value(serde_json::json!({"kind":"assistants"})).unwrap();
        assistants.validate().unwrap();
        windows.navigate(Some(assistants), true);
        assert_eq!(windows.take_navigation(), Some(WorkbenchNavigation { target: Some(WorkbenchTarget::Assistants {}), from_quick: true }));
        assert!(serde_json::from_value::<WorkbenchTarget>(serde_json::json!({"kind":"assistants","workspace_id":"extra"})).is_err());
        let library: WorkbenchTarget = serde_json::from_value(serde_json::json!({"kind":"capabilities"})).unwrap();
        library.validate().unwrap();
        windows.navigate(Some(library), true);
        assert_eq!(windows.take_navigation(), Some(WorkbenchNavigation { target: Some(WorkbenchTarget::Capabilities {}), from_quick: true }));
        assert!(serde_json::from_value::<WorkbenchTarget>(serde_json::json!({"kind":"capabilities","skill_versions":{"private":"body"}})).is_err());
        assert!(!windows.path.exists(), "导航不是业务事实的第二份持久副本");
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn t14_settings_navigation_is_one_shot_and_independent_of_quick_forms_and_run_navigation() {
        let (directory, mut windows, _) = fixture();
        windows.form_active(true);
        windows.navigate(Some(WorkbenchTarget::Run { run_id: "00000000-0000-4000-8000-000000000001".into() }), false);
        windows.navigate_settings(SettingsSection::Models, false);
        windows.navigate_settings(SettingsSection::Resources, true);
        assert_eq!(windows.take_settings_navigation(), Some(SettingsNavigation { section: SettingsSection::Resources, from_quick: true }));
        assert_eq!(windows.take_settings_navigation(), None);
        assert_eq!(windows.take_navigation(), Some(WorkbenchNavigation { target: Some(WorkbenchTarget::Run { run_id: "00000000-0000-4000-8000-000000000001".into() }), from_quick: false }));
        assert!(!windows.hide_on_blur());
        assert!(!windows.path.exists(), "设置导航不是第二份持久业务配置");
        assert_eq!(Windows::load(&directory).unwrap().take_settings_navigation(), None);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn t6_memory_navigation_and_settings_parse_without_record_content() {
        let (directory, mut windows, _) = fixture();
        let target: WorkbenchTarget = serde_json::from_value(serde_json::json!({"kind":"memory"})).unwrap();
        target.validate().unwrap();
        windows.form_active(true);
        windows.navigate(Some(target), true);
        let section: SettingsSection = serde_json::from_value(serde_json::json!("memory")).unwrap();
        windows.navigate_settings(section, true);
        assert_eq!(serde_json::to_value(windows.take_navigation()).unwrap(),
            serde_json::json!({"target":{"kind":"memory"},"from_quick":true}));
        assert_eq!(windows.take_navigation(), None);
        assert_eq!(serde_json::to_value(windows.take_settings_navigation()).unwrap(),
            serde_json::json!({"section":"memory","from_quick":true}));
        assert_eq!(windows.take_settings_navigation(), None);
        assert!(!windows.hide_on_blur());
        for value in [
            serde_json::json!({"kind":"memory","text":"private"}),
            serde_json::json!({"kind":"memory","workspace_id":"00000000-0000-4000-8000-000000000001"}),
            serde_json::json!({"kind":"memory","record_id":"private"}),
        ] {
            assert!(serde_json::from_value::<WorkbenchTarget>(value).is_err());
        }
        assert!(!windows.path.exists(), "记忆导航不复制记录、策略或草稿");
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn t10_environment_settings_navigation_preserves_origin() {
        let (directory, mut windows, _) = fixture();
        let section: SettingsSection = serde_json::from_value(serde_json::json!("environments")).unwrap();
        windows.navigate_settings(section, true);
        assert_eq!(serde_json::to_value(windows.take_settings_navigation()).unwrap(),
            serde_json::json!({"section":"environments","from_quick":true}));
        assert_eq!(windows.take_settings_navigation(), None);
        assert!(!windows.path.exists(), "运行环境导航不写入执行路径或环境值");
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn shortcut_events_toggle_only_on_pressed_never_on_released() {
        assert!(shortcut_pressed(ShortcutState::Pressed));
        assert!(!shortcut_pressed(ShortcutState::Released));
    }

    #[test]
    fn visible_geometry_uses_physical_work_area_including_negative_secondary_monitor_and_taskbar() {
        let area = tauri::PhysicalRect { position: tauri::PhysicalPosition::new(-2560, 40), size: tauri::PhysicalSize::new(2560, 1360) };
        let (position, size) = visible_geometry(tauri::PhysicalPosition::new(-3000, -100),
            tauri::PhysicalSize::new(1040, 1500), tauri::PhysicalSize::new(1000, 1440), &area);
        assert_eq!(position, tauri::PhysicalPosition::new(-2560, 40));
        assert_eq!(size, tauri::PhysicalSize::new(1000, 1300));
        let (position, size) = visible_geometry(tauri::PhysicalPosition::new(4000, 2400),
            tauri::PhysicalSize::new(1040, 750), tauri::PhysicalSize::new(1000, 690), &area);
        assert_eq!(position, tauri::PhysicalPosition::new(-1040, 650));
        assert_eq!(size, tauri::PhysicalSize::new(1000, 690));
    }
}

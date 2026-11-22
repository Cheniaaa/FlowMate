fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&[
        "runtime_connection", "stop_runtime", "open_settings", "take_settings_navigation", "return_to_quick", "select_resources", "choose_export_target",
        "select_skill_package", "choose_skill_export_target",
        "save_credential", "clear_credential", "credential_status",
        "open_external",
        "window_settings", "set_quick_pinned", "set_shortcut", "set_ball_enabled", "toggle_quick", "show_workbench",
        "take_workbench_navigation", "set_quick_form_active", "pending_counts", "start_ball_drag",
        "select_workspace_directory", "discard_workspace_directory_selection",
        "create_workspace_from_directory", "retry_workspace_from_directory", "check_workspace_directory_command",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("tauri_build_failed");
}

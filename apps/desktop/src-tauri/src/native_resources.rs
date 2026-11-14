use serde::{Deserialize, Serialize};
use std::{collections::HashMap, future::Future, path::PathBuf, sync::{Arc, Mutex}, time::Duration};
use crate::private_channel::Channel;
use tauri_plugin_dialog::{DialogExt, FilePath};

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(deny_unknown_fields)]
pub struct Scope { pub workspace_id: String, pub session_id: Option<String> }
impl Scope {
    pub fn validate(&self) -> Result<(), String> {
        if uuid::Uuid::parse_str(&self.workspace_id).is_err() || self.session_id.as_ref().is_some_and(|id| uuid::Uuid::parse_str(id).is_err()) {
            return Err("invalid_scope".into());
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SelectionKind { File, Directory }
#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResourceKind { File, Directory, Export }
#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceRef {
    pub id: String, pub scope: Scope, pub label: String, pub version: u64,
    pub kind: ResourceKind, pub source_version: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection { pub resources: Vec<ResourceRef> }

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandMeta { pub command_id: String, pub expected_version: Option<u64> }
impl CommandMeta {
    fn validate(&self) -> Result<(), String> {
        validate_command_id(&self.command_id)?;
        if self.expected_version == Some(0) { return Err("invalid_command_meta".into()); }
        Ok(())
    }
}
fn validate_command_id(command_id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(command_id).map(|_| ()).map_err(|_| "invalid_command_meta".into())
}

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Workspace {
    pub id: String, pub version: u64, pub name: String, pub directory_resource_id: Option<String>,
}
#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceDirectoryResult { pub workspace: Workspace, pub directory: ResourceRef }
impl WorkspaceDirectoryResult {
    fn validate(&self) -> Result<(), String> {
        if uuid::Uuid::parse_str(&self.workspace.id).is_err() || self.workspace.version == 0
            || self.workspace.directory_resource_id.as_deref() != Some(self.directory.id.as_str())
            || uuid::Uuid::parse_str(&self.directory.id).is_err() || self.directory.version == 0
            || self.directory.scope.workspace_id != self.workspace.id || self.directory.scope.session_id.is_some()
            || self.directory.kind != ResourceKind::Directory {
            return Err("invalid_workspace_directory_reply".into());
        }
        Ok(())
    }
}
#[derive(PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectoryCommandStatus { Confirmed, NotFound }
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceDirectoryCommandStatus {
    pub status: DirectoryCommandStatus, pub result: Option<WorkspaceDirectoryResult>,
}

#[derive(Clone, PartialEq)]
struct DirectoryInput { name: String, meta: CommandMeta }
#[derive(Clone)]
struct FrozenDirectory { input: DirectoryInput, path: String }
struct ActiveDirectory { token: Arc<()>, input: Option<DirectoryInput> }
#[derive(Default)]
struct DirectoryState {
    pending: HashMap<String, FrozenDirectory>,
    active: HashMap<String, ActiveDirectory>,
}
// 只属于 main 当前窗口生命周期；不记录已确认命令的历史 ID 或任何持久路径。
#[derive(Default)]
pub struct WorkspaceDirectories(Mutex<DirectoryState>);
struct DirectoryOperation { commands: Arc<WorkspaceDirectories>, command_id: String, token: Arc<()> }
impl WorkspaceDirectories {
    fn begin(self: &Arc<Self>, command_id: String, input: Option<&DirectoryInput>) -> Result<DirectoryOperation, String> {
        let mut state = self.0.lock().map_err(|_| "directory_state_unavailable")?;
        if let Some(input) = input {
            if state.pending.get(&command_id).is_some_and(|pending| pending.input != *input)
                || state.active.get(&command_id).and_then(|active| active.input.as_ref()).is_some_and(|active| active != input) {
                return Err("directory_command_conflict".into());
            }
        }
        if state.active.contains_key(&command_id) { return Err("directory_command_busy".into()); }
        let token = Arc::new(());
        state.active.insert(command_id.clone(), ActiveDirectory { token: token.clone(), input: input.cloned() });
        Ok(DirectoryOperation { commands: self.clone(), command_id, token })
    }

    pub fn clear(&self) {
        let mut state = self.0.lock().unwrap();
        state.pending.clear(); state.active.clear();
    }

    async fn create_with_picker<F, Fut>(self: &Arc<Self>, channel: &Channel, name: String, meta: CommandMeta, pick: F,
        timeout: Duration) -> Result<Option<WorkspaceDirectoryResult>, String>
        where F: FnOnce() -> Fut, Fut: Future<Output = Result<Option<PathBuf>, String>> {
        meta.validate()?;
        let input = DirectoryInput { name, meta };
        let operation = self.begin(input.meta.command_id.clone(), Some(&input))?;
        if let Some(result) = operation.status(channel, timeout).await?.result { return Ok(Some(result)); }
        if operation.frozen()?.is_none() {
            let Some(path) = pick().await? else { return Ok(None); };
            let path = path.to_str().ok_or("invalid_native_path")?.to_owned();
            operation.freeze(input, path)?;
        }
        operation.submit(channel, timeout).await.map(Some)
    }

    pub async fn create<R: tauri::Runtime>(self: &Arc<Self>, window: &tauri::WebviewWindow<R>, channel: &Channel,
        name: String, meta: CommandMeta) -> Result<Option<WorkspaceDirectoryResult>, String> {
        self.create_with_picker(channel, name, meta, || async {
            let (sender, receiver) = tokio::sync::oneshot::channel();
            window.dialog().file().set_parent(window).pick_folder(move |value| { let _ = sender.send(value); });
            receiver.await.map_err(|_| "dialog_failed")?.map(|value| value.into_path().map_err(|_| "invalid_native_path".into())).transpose()
        }, Duration::from_secs(60)).await
    }

    pub async fn retry(self: &Arc<Self>, channel: &Channel, name: String, meta: CommandMeta,
        timeout: Duration) -> Result<WorkspaceDirectoryResult, String> {
        meta.validate()?;
        let input = DirectoryInput { name, meta };
        let operation = self.begin(input.meta.command_id.clone(), Some(&input))?;
        if let Some(result) = operation.status(channel, timeout).await?.result { return Ok(result); }
        operation.submit(channel, timeout).await
    }

    pub async fn check(self: &Arc<Self>, channel: &Channel, command_id: String,
        timeout: Duration) -> Result<WorkspaceDirectoryCommandStatus, String> {
        validate_command_id(&command_id)?;
        self.begin(command_id, None)?.status(channel, timeout).await
    }
}
impl DirectoryOperation {
    fn is_active(&self, state: &DirectoryState) -> bool {
        state.active.get(&self.command_id).is_some_and(|active| Arc::ptr_eq(&active.token, &self.token))
    }
    fn frozen(&self) -> Result<Option<FrozenDirectory>, String> {
        let state = self.commands.0.lock().map_err(|_| "directory_state_unavailable")?;
        if !self.is_active(&state) { return Err("directory_selection_lost".into()); }
        Ok(state.pending.get(&self.command_id).cloned())
    }
    fn freeze(&self, input: DirectoryInput, path: String) -> Result<(), String> {
        let mut state = self.commands.0.lock().map_err(|_| "directory_state_unavailable")?;
        if !self.is_active(&state) { return Err("directory_selection_lost".into()); }
        state.pending.insert(self.command_id.clone(), FrozenDirectory { input, path });
        Ok(())
    }
    fn confirmed(&self) {
        let mut state = self.commands.0.lock().unwrap();
        if self.is_active(&state) { state.pending.remove(&self.command_id); }
    }
    async fn status(&self, channel: &Channel, timeout: Duration) -> Result<WorkspaceDirectoryCommandStatus, String> {
        let reply = channel.request("workspace.directory_command_status", serde_json::json!({"command_id":self.command_id}), timeout).await;
        if reply.as_ref().is_err_and(|error| error == "scope_deleted") { self.confirmed(); }
        let status: WorkspaceDirectoryCommandStatus = serde_json::from_value(reply?).map_err(|_| "invalid_workspace_directory_reply")?;
        match (&status.status, &status.result) {
            (DirectoryCommandStatus::Confirmed, Some(result)) => { result.validate()?; self.confirmed(); }
            (DirectoryCommandStatus::NotFound, None) => (),
            _ => return Err("invalid_workspace_directory_reply".into()),
        }
        Ok(status)
    }
    async fn submit(&self, channel: &Channel, timeout: Duration) -> Result<WorkspaceDirectoryResult, String> {
        let frozen = self.frozen()?.ok_or("directory_selection_lost")?;
        let reply = channel.request("workspace.create_from_directory", serde_json::json!({
            "name":frozen.input.name,"path":frozen.path,"meta":frozen.input.meta}), timeout).await;
        if reply.as_ref().is_err_and(|error| error == "scope_deleted") { self.confirmed(); }
        let result: WorkspaceDirectoryResult = serde_json::from_value(reply?).map_err(|_| "invalid_workspace_directory_reply")?;
        result.validate()?;
        self.confirmed();
        Ok(result)
    }
}
impl Drop for DirectoryOperation {
    fn drop(&mut self) {
        let mut state = self.commands.0.lock().unwrap();
        if self.is_active(&state) { state.active.remove(&self.command_id); }
    }
}

async fn register_paths(channel: &Channel, scope: Scope, kind: &str, paths: Vec<PathBuf>) -> Result<Selection, String> {
    scope.validate()?;
    if paths.is_empty() { return Ok(Selection { resources: Vec::new() }); }
    let paths: Vec<&str> = paths.iter().map(|path| path.to_str().ok_or("invalid_native_path")).collect::<Result<_, _>>()?;
    let result = channel.request("resource.register", serde_json::json!({"scope":scope,"kind":kind,"paths":paths}), Duration::from_secs(60)).await?;
    let selection: Selection = serde_json::from_value(result).map_err(|_| "invalid_resource_reply")?;
    if selection.resources.iter().any(|resource| resource.scope != scope || resource.version == 0 || uuid::Uuid::parse_str(&resource.id).is_err()) {
        return Err("invalid_resource_reply".into());
    }
    Ok(selection)
}

fn paths(values: Option<Vec<FilePath>>) -> Result<Vec<PathBuf>, String> {
    values.unwrap_or_default().into_iter().map(|path| path.into_path().map_err(|_| "invalid_native_path".into())).collect()
}

pub async fn select<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, channel: Channel, scope: Scope, kind: SelectionKind) -> Result<Selection, String> {
    scope.validate()?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let dialog = window.dialog().file().set_parent(window);
    match kind {
        SelectionKind::File => dialog.pick_files(move |values| { let _ = sender.send(paths(values)); }),
        SelectionKind::Directory => dialog.pick_folder(move |value| { let _ = sender.send(paths(value.map(|value| vec![value]))); }),
    }
    let paths = receiver.await.map_err(|_| "dialog_failed")??;
    register_paths(&channel, scope, match kind { SelectionKind::File => "file", SelectionKind::Directory => "directory" }, paths).await
}

pub async fn choose_export<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, channel: Channel, scope: Scope) -> Result<Selection, String> {
    scope.validate()?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window.dialog().file().set_parent(window).save_file(move |value| { let _ = sender.send(paths(value.map(|value| vec![value]))); });
    let paths = receiver.await.map_err(|_| "dialog_failed")??;
    register_paths(&channel, scope, "export", paths).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{io::{BufRead, BufReader, Write}, net::{TcpListener, TcpStream}, sync::Arc};

    fn scope() -> Scope { Scope { workspace_id: "00000000-0000-4000-8000-000000000001".into(), session_id: None } }

    fn meta() -> CommandMeta { CommandMeta { command_id: "00000000-0000-4000-8000-000000000003".into(), expected_version: None } }
    fn directory_result() -> serde_json::Value {
        json!({"workspace":{"id":scope().workspace_id,"version":1,"name":"目录项目","directory_resource_id":"00000000-0000-4000-8000-000000000002"},
            "directory":{"id":"00000000-0000-4000-8000-000000000002","scope":scope(),"label":"中文 目录","version":1,"kind":"directory","source_version":null}})
    }
    fn pair() -> (Channel, BufReader<TcpStream>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let peer = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        peer.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let (stream, _) = listener.accept().unwrap();
        (Channel::start(stream.try_clone().unwrap(), stream, Arc::new(|_, _| Err("unsupported_method")), Arc::new(|_, _| {}), Arc::new(|| {})), BufReader::new(peer))
    }
    fn receive(peer: &mut BufReader<TcpStream>, method: &str) -> serde_json::Value {
        let mut line = String::new(); peer.read_line(&mut line).unwrap();
        let frame: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(frame["protocol_version"], 2);
        assert!(frame["stream_seq"].as_u64().unwrap() > 0);
        assert_eq!(frame["method"], method);
        frame
    }
    fn reply(peer: &mut BufReader<TcpStream>, frame: &serde_json::Value, result: serde_json::Value) {
        writeln!(peer.get_mut(), "{}", json!({"protocol_version":2,"request_id":frame["request_id"],"kind":"reply","method":frame["method"],"result":result})).unwrap();
    }
    fn not_found(peer: &mut BufReader<TcpStream>) {
        let frame = receive(peer, "workspace.directory_command_status");
        assert_eq!(frame["params"], json!({"command_id":meta().command_id}));
        reply(peer, &frame, json!({"status":"not_found","result":null}));
    }
    const TEST_TIMEOUT: Duration = Duration::from_secs(2);

    #[test]
    fn workspace_directory_cancellation_does_not_create_or_retain_a_selection() {
        let (channel, mut peer) = pair();
        let worker = std::thread::spawn(move || { not_found(&mut peer); });
        let commands = Arc::new(WorkspaceDirectories::default());
        let result = tauri::async_runtime::block_on(commands.create_with_picker(&channel, "目录项目".into(), meta(), || async { Ok(None) }, TEST_TIMEOUT)).unwrap();
        assert!(result.is_none());
        assert!(commands.0.lock().unwrap().pending.is_empty());
        assert!(commands.0.lock().unwrap().active.is_empty());
        worker.join().unwrap(); channel.close();
    }

    #[test]
    fn workspace_directory_timeout_retries_the_identical_frozen_path_after_status() {
        let (channel, mut peer) = pair();
        let worker = std::thread::spawn(move || {
            not_found(&mut peer);
            let first = receive(&mut peer, "workspace.create_from_directory");
            assert_eq!(first["params"], json!({"name":"目录项目","path":"C:\\public-fixture\\中文 目录","meta":{"command_id":meta().command_id,"expected_version":null}}));
            // 不返回首次回包：让真实 Channel 的 deadline 触发，而非用业务错误模拟 timeout。
            not_found(&mut peer);
            let retry = receive(&mut peer, "workspace.create_from_directory");
            assert_eq!(retry["params"], first["params"]);
            reply(&mut peer, &retry, directory_result());
        });
        let commands = Arc::new(WorkspaceDirectories::default());
        let result = tauri::async_runtime::block_on(commands.create_with_picker(&channel, "目录项目".into(), meta(),
            || async { Ok(Some(PathBuf::from("C:\\public-fixture\\中文 目录"))) }, Duration::from_millis(100)));
        assert_eq!(result.unwrap_err(), "request_timeout");
        assert_eq!(commands.0.lock().unwrap().pending.len(), 1);
        let result = tauri::async_runtime::block_on(commands.retry(&channel, "目录项目".into(), meta(), TEST_TIMEOUT)).unwrap();
        assert_eq!(serde_json::to_value(result).unwrap(), directory_result());
        assert!(commands.0.lock().unwrap().pending.is_empty());
        worker.join().unwrap(); channel.close();
    }

    #[test]
    fn workspace_directory_lost_selection_can_be_checked_but_never_reselected_on_retry() {
        let (channel, mut peer) = pair();
        let worker = std::thread::spawn(move || {
            not_found(&mut peer);
            let frame = receive(&mut peer, "workspace.directory_command_status");
            reply(&mut peer, &frame, json!({"status":"confirmed","result":directory_result()}));
        });
        let commands = Arc::new(WorkspaceDirectories::default());
        assert_eq!(tauri::async_runtime::block_on(commands.retry(&channel, "目录项目".into(), meta(), TEST_TIMEOUT)).unwrap_err(), "directory_selection_lost");
        let result = tauri::async_runtime::block_on(commands.check(&channel, meta().command_id, TEST_TIMEOUT)).unwrap();
        assert_eq!(serde_json::to_value(result).unwrap(), json!({"status":"confirmed","result":directory_result()}));
        assert!(commands.0.lock().unwrap().pending.is_empty());
        worker.join().unwrap(); channel.close();
    }

    #[test]
    fn workspace_directory_confirmed_command_returns_original_without_picker_or_resend() {
        let (channel, mut peer) = pair();
        let worker = std::thread::spawn(move || {
            let frame = receive(&mut peer, "workspace.directory_command_status");
            reply(&mut peer, &frame, json!({"status":"confirmed","result":directory_result()}));
        });
        let commands = Arc::new(WorkspaceDirectories::default());
        let result = tauri::async_runtime::block_on(commands.create_with_picker(&channel, "目录项目".into(), meta(),
            || async { panic!("已确认命令不得再次选择目录"); }, TEST_TIMEOUT)).unwrap().unwrap();
        assert_eq!(serde_json::to_value(result).unwrap(), directory_result());
        worker.join().unwrap(); channel.close();
    }

    #[test]
    fn workspace_directory_payload_changes_and_overlapping_operations_are_rejected() {
        let commands = Arc::new(WorkspaceDirectories::default());
        let input = DirectoryInput { name: "目录项目".into(), meta: meta() };
        let operation = commands.begin(meta().command_id, Some(&input)).unwrap();
        operation.freeze(input.clone(), "C:\\public-fixture\\中文 目录".into()).unwrap();
        assert_eq!(commands.begin(meta().command_id, Some(&input)).err().unwrap(), "directory_command_busy");
        let changed = DirectoryInput { name: "改名".into(), ..input.clone() };
        assert_eq!(commands.begin(meta().command_id, Some(&changed)).err().unwrap(), "directory_command_conflict");
        drop(operation);
        let changed = DirectoryInput { meta: CommandMeta { expected_version: Some(2), ..meta() }, ..input };
        assert_eq!(commands.begin(meta().command_id, Some(&changed)).err().unwrap(), "directory_command_conflict");
        assert_eq!(commands.0.lock().unwrap().pending.len(), 1);
    }

    #[test]
    fn workspace_directory_window_close_releases_paths_and_invalidates_open_picker() {
        let commands = Arc::new(WorkspaceDirectories::default());
        let input = DirectoryInput { name: "目录项目".into(), meta: meta() };
        let operation = commands.begin(meta().command_id, Some(&input)).unwrap();
        operation.freeze(input.clone(), "C:\\public-fixture\\中文 目录".into()).unwrap();
        commands.clear();
        assert!(commands.0.lock().unwrap().pending.is_empty());
        assert_eq!(operation.freeze(input.clone(), "C:\\different".into()).unwrap_err(), "directory_selection_lost");
        let replacement = commands.begin(meta().command_id, Some(&input)).unwrap();
        drop(operation);
        assert_eq!(commands.0.lock().unwrap().active.len(), 1, "旧回调不能释放新窗口生命周期的在途项");
        drop(replacement);
    }

    #[test]
    fn workspace_directory_replies_must_match_the_workspace_directory_contract() {
        for invalid in [
            ("/workspace/id", json!("not-uuid")), ("/workspace/version", json!(0)),
            ("/workspace/directory_resource_id", json!("00000000-0000-4000-8000-000000000004")),
            ("/directory/scope/workspace_id", json!("00000000-0000-4000-8000-000000000004")),
            ("/directory/scope/session_id", json!("00000000-0000-4000-8000-000000000004")),
            ("/directory/kind", json!("file")), ("/directory/version", json!(0)), ("/directory/id", json!("not-uuid")),
        ] {
            let mut value = directory_result(); *value.pointer_mut(invalid.0).unwrap() = invalid.1;
            let value: WorkspaceDirectoryResult = serde_json::from_value(value).unwrap();
            assert_eq!(value.validate().unwrap_err(), "invalid_workspace_directory_reply", "{}", invalid.0);
        }
    }

    #[test]
    fn workspace_directory_deleted_command_clears_frozen_selection_without_resend() {
        let (channel, mut peer) = pair();
        let worker = std::thread::spawn(move || {
            let frame = receive(&mut peer, "workspace.directory_command_status");
            writeln!(peer.get_mut(), "{}", json!({"protocol_version":2,"request_id":frame["request_id"],"kind":"reply",
                "method":frame["method"],"error":{"code":"scope_deleted"}})).unwrap();
        });
        let commands = Arc::new(WorkspaceDirectories::default());
        let input = DirectoryInput { name: "目录项目".into(), meta: meta() };
        let operation = commands.begin(meta().command_id, Some(&input)).unwrap();
        operation.freeze(input, "C:\\public-fixture\\中文 目录".into()).unwrap();
        drop(operation);
        assert_eq!(tauri::async_runtime::block_on(commands.check(&channel, meta().command_id, TEST_TIMEOUT)).unwrap_err(), "scope_deleted");
        assert!(commands.0.lock().unwrap().pending.is_empty());
        worker.join().unwrap(); channel.close();
    }

    #[test]
    fn workspace_directory_inconsistent_status_does_not_discard_frozen_selection() {
        for status in [json!({"status":"confirmed","result":null}), json!({"status":"not_found","result":directory_result()})] {
            let (channel, mut peer) = pair();
            let worker = std::thread::spawn(move || {
                let frame = receive(&mut peer, "workspace.directory_command_status"); reply(&mut peer, &frame, status);
            });
            let commands = Arc::new(WorkspaceDirectories::default());
            let input = DirectoryInput { name: "目录项目".into(), meta: meta() };
            let operation = commands.begin(meta().command_id, Some(&input)).unwrap();
            operation.freeze(input, "C:\\public-fixture\\中文 目录".into()).unwrap();
            drop(operation);
            assert_eq!(tauri::async_runtime::block_on(commands.check(&channel, meta().command_id, TEST_TIMEOUT)).unwrap_err(), "invalid_workspace_directory_reply");
            assert_eq!(commands.0.lock().unwrap().pending.len(), 1);
            worker.join().unwrap(); channel.close();
        }
    }

    #[test]
    fn native_paths_register_over_private_channel_and_ui_only_receives_resource_refs() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let peer = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (stream, _) = listener.accept().unwrap();
        let channel = Channel::start(stream.try_clone().unwrap(), stream, Arc::new(|_, _| Err("unsupported_method")), Arc::new(|_, _| {}), Arc::new(|| {}));
        let worker = std::thread::spawn(move || {
            peer.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut peer = BufReader::new(peer); let mut line = String::new();
            peer.read_line(&mut line).unwrap();
            let frame: serde_json::Value = serde_json::from_str(&line).unwrap();
            assert_eq!(frame["method"], "resource.register");
            assert_eq!(frame["params"], json!({"scope":{"workspace_id":"00000000-0000-4000-8000-000000000001","session_id":null},"kind":"file","paths":["C:\\public-fixture\\选择.md"]}));
            writeln!(peer.get_mut(), "{}", json!({"protocol_version":2,"request_id":frame["request_id"],"kind":"reply","method":"resource.register","result":{"resources":[{"id":"00000000-0000-4000-8000-000000000002","scope":{"workspace_id":"00000000-0000-4000-8000-000000000001","session_id":null},"label":"选择.md","version":1,"kind":"file","source_version":null}]}})).unwrap();
        });
        let result = tauri::async_runtime::block_on(register_paths(&channel, scope(), "file", vec![PathBuf::from("C:\\public-fixture\\选择.md")]));
        let value = serde_json::to_value(result.unwrap()).unwrap();
        assert_eq!(value["resources"][0]["label"], "选择.md");
        assert!(value["resources"][0].get("paths").is_none());
        assert!(value["resources"][0].get("canonical_path").is_none());
        assert!(value.get("grant").is_none());
        worker.join().unwrap(); channel.close();
    }

    #[test]
    fn cancellation_is_empty_without_touching_closed_channel() {
        let channel = Channel::start(std::io::empty(), std::io::sink(), Arc::new(|_, _| Err("unsupported_method")), Arc::new(|_, _| {}), Arc::new(|| {}));
        channel.close();
        let result = tauri::async_runtime::block_on(register_paths(&channel, scope(), "export", vec![])).unwrap();
        assert!(result.resources.is_empty());
    }

    #[test]
    fn actual_python_native_selection_returns_full_resource_contract() {
        use std::{io::Read, path::Path, process::{Command, Stdio}, sync::mpsc};
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap();
        let cfg = std::fs::read_to_string(root.join(".venv/pyvenv.cfg")).unwrap();
        let home = cfg.lines().find_map(|line| line.strip_prefix("home = ")).unwrap();
        let directory = std::env::temp_dir().join("opencode").join(format!("flowmate-resource-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let source = directory.join("真实 资料.md");
        std::fs::write(&source, "# public document").unwrap();
        let project_directory = directory.join("项目 中文");
        std::fs::create_dir(&project_directory).unwrap();
        let mut script = format!("import sys\nsys.path[:0] = [{}, {}]\ndata_dir = {}\n",
            serde_json::to_string(root.join("packages").to_str().unwrap()).unwrap(),
            serde_json::to_string(root.join(".venv/Lib/site-packages").to_str().unwrap()).unwrap(),
            serde_json::to_string(directory.to_str().unwrap()).unwrap());
        script.push_str(r#"
import asyncio
from pathlib import Path
from flowmate.config import RuntimeConfig
from flowmate.contracts.base import CommandMeta
from flowmate.host.channel import HostChannel
from flowmate.host.protocol import HostEvent
from flowmate.host.resources import HostResources
from flowmate.host.stdio import open_stdio
from flowmate.persistence.store import Store
from flowmate.policy.service import PolicyService
from flowmate.settings import SettingsService
from flowmate.tools.files import NativeTextFiles
async def main():
    store = Store.open(Path(data_dir) / 'store')
    workspace = SettingsService(store).create_workspace('native fixture', CommandMeta())
    resources = HostResources(PolicyService(store), NativeTextFiles(), RuntimeConfig())
    create_count = 0
    async def create_without_reply(params):
        nonlocal create_count
        create_count += 1
        await resources.create_workspace_from_directory(params)
        await channel.event(HostEvent(request_id='directory-committed', method='ready',
            params={'directory_committed':True}))
        # 事务已提交但响应丢失；status 必须独立可用，不能再次发送创建请求。
        await asyncio.Event().wait()
    channel = HostChannel(*open_stdio(), handlers={
        'resource.register': resources.register,
        'workspace.create_from_directory': create_without_reply,
        'workspace.directory_command_status': resources.directory_command_status,
        'shutdown': lambda params: {'stopping':True}})
    await channel.start()
    await channel.event(HostEvent(request_id='scope-ready', method='ready',
        params={'scope':{'workspace_id':workspace.id,'session_id':None}}))
    await channel.wait_closed()
    await channel.close()
    with store.transaction(write=False) as tx:
        assert tx.execute('SELECT count(*) FROM grants').fetchone()[0] == 0
        assert tx.execute('SELECT count(*) FROM workspaces').fetchone()[0] == 2
        assert tx.execute('SELECT count(*) FROM resources').fetchone()[0] == 2
        assert create_count == 1
    store.close()
asyncio.run(main())
"#);
        let mut child = Command::new(Path::new(home).join("python.exe")).args(["-I", "-c", &script])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        let (send_scope, receive_scope) = mpsc::channel();
        let (send_commit, receive_commit) = mpsc::channel();
        let channel = Channel::start(child.stdout.take().unwrap(), child.stdin.take().unwrap(),
            Arc::new(|_, _| Err("unsupported_method")),
            Arc::new(move |method, params| {
                if method == "ready" && params.get("scope").is_some() { let _ = send_scope.send(params["scope"].clone()); }
                if method == "ready" && params["directory_committed"] == true { let _ = send_commit.send(()); }
            }), Arc::new(|| {}));
        let scope = serde_json::from_value(receive_scope.recv_timeout(Duration::from_secs(10)).unwrap()).unwrap();
        let result = tauri::async_runtime::block_on(register_paths(&channel, scope, "file", vec![source]));
        let commands = Arc::new(WorkspaceDirectories::default());
        let lost_reply = tauri::async_runtime::block_on(commands.create_with_picker(&channel, "目录项目".into(), meta(),
            || async { Ok(Some(project_directory)) }, Duration::from_millis(300)));
        if channel.is_closed() {
            let status = child.wait().unwrap();
            let mut stderr = String::new(); child.stderr.take().unwrap().read_to_string(&mut stderr).unwrap();
            panic!("Python fixture exited before confirmation: {status}; registration_error={:?}; creation={lost_reply:?}; stderr={stderr}", result.as_ref().err());
        }
        assert_eq!(lost_reply.unwrap_err(), "request_timeout");
        receive_commit.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(commands.0.lock().unwrap().pending.len(), 1);
        let confirmed = tauri::async_runtime::block_on(commands.check(&channel, meta().command_id, TEST_TIMEOUT)).unwrap();
        assert_eq!(confirmed.status, DirectoryCommandStatus::Confirmed);
        let created = confirmed.result.unwrap();
        assert_eq!(created.workspace.name, "目录项目");
        assert_eq!(created.directory.kind, ResourceKind::Directory);
        assert_eq!(created.directory.label, "项目 中文");
        assert!(commands.0.lock().unwrap().pending.is_empty());
        // 宿主内存冻结已释放后仍可核对原结果，不能因无冻结选择而新建。
        let retry = tauri::async_runtime::block_on(commands.retry(&channel, "目录项目".into(), meta(), TEST_TIMEOUT)).unwrap();
        assert_eq!(retry, created);
        let public = serde_json::to_string(&created).unwrap();
        assert!(!public.contains("canonical_path") && !public.contains(directory.to_str().unwrap()));
        let _ = tauri::async_runtime::block_on(channel.request("shutdown", json!({}), Duration::from_secs(5)));
        channel.close();
        let status = child.wait().unwrap();
        let mut stderr = String::new(); child.stderr.take().unwrap().read_to_string(&mut stderr).unwrap();
        std::fs::remove_dir_all(directory).unwrap();
        assert!(status.success(), "Python fixture failed: {stderr}");
        let value = serde_json::to_value(result.unwrap()).unwrap();
        assert_eq!(value["resources"][0]["kind"], "file");
        assert!(value["resources"][0]["source_version"].is_null());
        assert_eq!(value["resources"][0]["label"], "真实 资料.md");
        assert!(value["resources"][0].get("canonical_path").is_none());
    }
}

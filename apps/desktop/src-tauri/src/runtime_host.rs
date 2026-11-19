use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::{credentials::{self, CredentialStore, ProtectedValue, SecretBinding}, private_channel::{Channel, Handler}};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, Write},
    os::windows::{ffi::OsStringExt, io::{AsRawHandle, FromRawHandle, OwnedHandle}, process::CommandExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
    Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG},
    System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS},
    System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
    System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE},
};

#[cfg(test)]
#[path = "t13_native_integration.rs"]
mod t13_integration;

pub fn permitted_origin(origin: &str, development: bool) -> bool {
    origin == if development { "http://127.0.0.1:5173" } else { "http://tauri.localhost" }
}

pub struct DevelopmentRuntime {
    python: PathBuf,
    source_root: PathBuf,
    interpreter: PathBuf,
}

impl DevelopmentRuntime {
    pub fn new(python: PathBuf, source_root: PathBuf) -> Result<Self, &'static str> {
        if !python.is_absolute() || !source_root.is_absolute() { return Err("invalid_development_paths"); }
        let python = python.canonicalize().map_err(|_| "invalid_development_python")?;
        let source_root = source_root.canonicalize().map_err(|_| "invalid_development_root")?;
        if !source_root.join("packages/flowmate/__main__.py").is_file() { return Err("invalid_development_root"); }
        let venv = python.parent().and_then(Path::parent).ok_or("invalid_development_python")?;
        let cfg = std::fs::read_to_string(venv.join("pyvenv.cfg")).map_err(|_| "invalid_development_venv")?;
        let home = cfg.lines().find_map(|line| line.split_once('=').filter(|(key, _)| key.trim() == "home").map(|(_, value)| PathBuf::from(value.trim())))
            .filter(|path| path.is_absolute()).ok_or("invalid_development_venv")?;
        let interpreter = home.join("python.exe").canonicalize().map_err(|_| "invalid_development_interpreter")?;
        Ok(Self { python, source_root, interpreter })
    }
    fn configure(&self, command: &mut Command) {
        command.current_dir(&self.source_root).env("PYTHONPATH", self.source_root.join("packages"));
    }
    fn command(&self, directory: &Path) -> Command {
        let mut command = Command::new(&self.python);
        command.args(["-m", "flowmate", "runtime", "--data-dir"]).arg(directory);
        self.configure(&mut command);
        command
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct DiagnosticFrame { module: String, function: String, line: u32 }

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SafeDiagnostic { code: String, request_id: Option<String>, exception_type: Option<String>, frames: Vec<DiagnosticFrame> }

fn safe_name(value: &str, limit: usize, extra: &[u8]) -> bool {
    !value.is_empty() && value.len() <= limit
        && value.bytes().next().is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_' || extra.contains(&byte))
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || extra.contains(&byte))
}

impl SafeDiagnostic {
    fn log_value(self) -> Option<Value> {
        if self.code.is_empty() || self.code.len() > 96 || !self.code.as_bytes()[0].is_ascii_lowercase()
            || !self.code.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
            || self.request_id.as_ref().is_some_and(|id| id.is_empty() || id.len() > 128 || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'))
            || self.exception_type.as_ref().is_some_and(|name| !safe_name(name, 128, &[]))
            || self.frames.len() > 16 || self.frames.iter().any(|frame| !safe_name(&frame.module, 256, b".")
                || frame.module.starts_with('.') || !safe_name(&frame.function, 128, b"<>") || frame.line == 0 || frame.line > i32::MAX as u32) { return None; }
        let mut value = serde_json::to_value(self).ok()?;
        value["event"] = json!("runtime_diagnostic");
        Some(value)
    }
}

fn safe_diagnostic(line: &str) -> Option<Value> {
    serde_json::from_str::<SafeDiagnostic>(line).ok()?.log_value()
}

pub fn host_lock(directory: &Path) -> std::io::Result<File> {
    let file = OpenOptions::new().create(true).truncate(false).read(true).write(true)
        .open(directory.join("desktop-host.lock"))?;
    file.try_lock().map_err(std::io::Error::other)?;
    Ok(file)
}

#[derive(Clone)]
pub struct Log(Arc<Mutex<File>>);

impl Log {
    pub fn new(directory: &Path) -> std::io::Result<Self> {
        Ok(Self(Arc::new(Mutex::new(OpenOptions::new().create(true).append(true)
            .open(directory.join("desktop-host.jsonl"))?))))
    }
    pub fn write(&self, value: serde_json::Value) {
        if let Ok(mut file) = self.0.lock() {
            let _ = writeln!(file, "{}", value);
            let _ = file.flush();
        }
    }
}

struct Job(HANDLE);
// 句柄只在共享 Mutex<Option<Job>> 内转移/关闭；不向子进程继承。
unsafe impl Send for Job {}

impl Job {
    fn valid_development_pid(&self, launcher: &Child, pid: u32, interpreter: &Path) -> bool {
        // venv launcher 的子解释器不是 Child.id；仅开发入口允许这个精确关系。
        if pid == launcher.id() { return false; }
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if process.is_null() { return false; }
            let process = OwnedHandle::from_raw_handle(process);
            let mut member = 0;
            if IsProcessInJob(process.as_raw_handle(), self.0, &mut member) == 0 || member == 0 { return false; }
            let mut image = vec![0u16; 32768];
            let mut size = image.len() as u32;
            if QueryFullProcessImageNameW(process.as_raw_handle(), 0, image.as_mut_ptr(), &mut size) == 0 { return false; }
            let image = PathBuf::from(std::ffi::OsString::from_wide(&image[..size as usize]));
            if image.canonicalize().ok().as_deref() != Some(interpreter) { return false; }
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE { return false; }
            let snapshot = OwnedHandle::from_raw_handle(snapshot);
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of_val(&entry) as u32;
            let mut found = Process32FirstW(snapshot.as_raw_handle(), &mut entry);
            while found != 0 {
                if entry.th32ProcessID == pid { return entry.th32ParentProcessID == launcher.id(); }
                found = Process32NextW(snapshot.as_raw_handle(), &mut entry);
            }
            false
        }
    }
    fn new() -> std::io::Result<Self> {
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() { return Err(std::io::Error::last_os_error()); }
            let job = Self(handle);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(handle, JobObjectExtendedLimitInformation,
                &info as *const _ as *const _, std::mem::size_of_val(&info) as u32) == 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(job)
        }
    }
    fn assign(&self, child: &Child) -> std::io::Result<()> {
        if unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle()) } == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
}
impl Drop for Job {
    fn drop(&mut self) { unsafe { CloseHandle(self.0); } }
}

#[derive(Clone, Serialize)]
pub struct Connection { pub base_url: String, pub token: String, pub protocol_version: u32 }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Ready { port: u16, pid: u32, runtime_version: String }

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PendingCounts { pub pending_questions: u64, pub pending_approvals: u64, pub pending_actions: u64, pub unviewed_results: u64 }

#[derive(Default)]
pub struct Notifications { latest: Option<PendingCounts>, changed: bool }
impl Notifications {
    pub fn counts(&self) -> Option<PendingCounts> { self.latest }
    fn receive(&mut self, params: Value) -> Result<(), &'static str> {
        let counts = serde_json::from_value(params).map_err(|_| "invalid_notification_counts")?;
        if self.latest != Some(counts) { self.latest = Some(counts); self.changed = true; }
        Ok(())
    }
    fn clear(&mut self) { if self.latest.take().is_some() { self.changed = true; } }
    fn take_changed(&mut self) -> bool { std::mem::take(&mut self.changed) }
}

pub(crate) fn private_handler(store: Arc<CredentialStore>) -> Handler {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Resolve { binding: SecretBinding }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Protect { context: Value, plaintext_b64: String }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Unprotect { context: Value, value: ProtectedValue }
    Arc::new(move |method, params| {
        match method {
            "credential.resolve" => {
                let request: Resolve = serde_json::from_value(params).map_err(|_| "invalid_params")?;
                Ok(json!({"value":store.resolve_bound(&request.binding)?}))
            }
            "private.protect" => {
                let request: Protect = serde_json::from_value(params).map_err(|_| "invalid_params")?;
                let plaintext = STANDARD.decode(&request.plaintext_b64).map_err(|_| "invalid_params")?;
                serde_json::to_value(credentials::protect(&request.context, &plaintext)?).map_err(|_| "internal_error")
            }
            "private.unprotect" => {
                let request: Unprotect = serde_json::from_value(params).map_err(|_| "invalid_params")?;
                Ok(json!({"plaintext_b64":STANDARD.encode(credentials::unprotect(&request.context, &request.value)?)}))
            }
            "shutdown" if params.as_object().is_some_and(|map| map.is_empty()) => Ok(json!({"stopping":true})),
            _ => Err("unsupported_method"),
        }
    })
}

pub struct RuntimeHost {
    _lock: File,
    job: Arc<Mutex<Option<Job>>>,
    child: Child,
    channel: Channel,
    credentials: Arc<CredentialStore>,
    notifications: Arc<Mutex<Notifications>>,
    pub connection: Connection,
    pub log: Log,
    stopped: bool,
}

impl RuntimeHost {
    pub fn channel(&self) -> Channel { self.channel.clone() }
    pub fn credentials(&self) -> Arc<CredentialStore> { self.credentials.clone() }
    pub fn notifications(&self) -> Arc<Mutex<Notifications>> { self.notifications.clone() }
    pub fn start(directory: &Path, executable: &Path, diagnostics: bool, development: bool)
        -> Result<Self, String> {
        let mut command = Command::new(executable);
        command.args(["runtime", "--data-dir"]).arg(directory);
        Self::start_command(directory, executable, command, diagnostics, development, Arc::new(CredentialStore::default()), None)
    }

    pub fn start_development(directory: &Path, runtime: &DevelopmentRuntime, diagnostics: bool, development: bool)
        -> Result<Self, String> {
        Self::start_command(directory, &runtime.python, runtime.command(directory), diagnostics, development,
            Arc::new(CredentialStore::default()), Some(runtime))
    }

    fn start_command(directory: &Path, executable: &Path, mut command: Command, diagnostics: bool,
        development: bool, credentials: Arc<CredentialStore>, runtime: Option<&DevelopmentRuntime>) -> Result<Self, String> {
        std::fs::create_dir_all(directory).map_err(|_| "data_directory_failed")?;
        let lock = host_lock(directory).map_err(|_| "already_running")?;
        let log = Log::new(directory).map_err(|_| "log_failed")?;
        let start = Instant::now();
        let job = Job::new().map_err(|_| "job_create_failed")?;
        let mut random = [0u8; 32];
        if unsafe { BCryptGenRandom(std::ptr::null_mut(), random.as_mut_ptr(), 32,
                BCRYPT_USE_SYSTEM_PREFERRED_RNG) } < 0 { return Err("random_failed".into()); }
        let token: String = random.iter().map(|b| format!("{b:02x}")).collect();
        command.env_clear();
        for key in ["SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "USERPROFILE"] {
            if let Some(value) = std::env::var_os(key) { command.env(key, value); }
        }
        if let Some(runtime) = runtime { runtime.configure(&mut command); }
        else { command.current_dir(executable.parent().ok_or("invalid_resource")?); }
        let mut child = command.creation_flags(0x08000000).stdin(Stdio::piped()).stdout(Stdio::piped())
            .stderr(Stdio::piped()).spawn().map_err(|_| "runtime_spawn_failed")?;
        if job.assign(&child).is_err() {
            let _ = child.kill(); let _ = child.wait(); return Err("job_assign_failed".into());
        }
        // Runtime 还阻塞在首条启动消息；入 Job 后才允许创建原生后代。
        let control = child.stdin.take().ok_or("control_missing")?;
        let origin = if development { "http://127.0.0.1:5173" } else { "http://tauri.localhost" };
        let stderr = child.stderr.take().ok_or("stderr_missing")?;
        let output = log.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            loop {
                match crate::private_channel::read_frame(&mut reader) {
                    Ok(Some(bytes)) => if let Ok(line) = std::str::from_utf8(&bytes) {
                        if let Some(value) = safe_diagnostic(line) { output.write(value); }
                    },
                    Err("frame_too_large") => { if reader.skip_until(b'\n').is_err() { break; } }
                    _ => break,
                }
            }
        });
        let stdout = child.stdout.take().ok_or("stdout_missing")?;
        let (sender, receiver) = mpsc::channel();
        let job = Arc::new(Mutex::new(Some(job))); let job_on_close = job.clone();
        let notifications = Arc::new(Mutex::new(Notifications::default()));
        let received = notifications.clone(); let event_log = log.clone();
        let channel = Channel::start(stdout, control, private_handler(credentials.clone()),
            Arc::new(move |method, params| {
                if method == "ready" { let _ = sender.send(params); }
                else if method == "notifications.changed" {
                    if received.lock().unwrap().receive(params).is_err() { event_log.write(json!({"event":"invalid_notification_counts"})); }
                }
                else if method == "diagnostic" {
                    match serde_json::from_value::<SafeDiagnostic>(params).ok().and_then(SafeDiagnostic::log_value) {
                        Some(value) => event_log.write(value),
                        None => event_log.write(json!({"event":"invalid_diagnostic"})),
                    }
                }
            }),
            Arc::new(move || { job_on_close.lock().unwrap().take(); }));
        let connection = Connection { base_url: String::new(), token: token.clone(), protocol_version: 3 };
        // 构造后任何启动失败都会走 Drop，既释放实例锁也终止整个 Job。
        let mut host = Self { _lock: lock, job, child, channel, credentials, notifications, connection, log, stopped: false };
        host.channel.event("startup", json!({"token":token,"data_dir":directory.to_string_lossy(),
            "allowed_origins":[origin],"desktop_diagnostics":diagnostics}))?;
        let ready: Ready = serde_json::from_value(receiver.recv_timeout(Duration::from_secs(90))
            .map_err(|_| if host.channel.is_closed() { "runtime_ready_failed" } else { "runtime_ready_timeout" })?)
            .map_err(|_| "invalid_runtime_ready")?;
        let valid_pid = if let Some(runtime) = runtime {
            host.job.lock().unwrap().as_ref().is_some_and(|job| job.valid_development_pid(&host.child, ready.pid, &runtime.interpreter))
        } else { ready.pid == host.child.id() };
        if !valid_pid || ready.port == 0 || ready.runtime_version.is_empty() || host.channel.is_closed() {
            return Err("invalid_runtime_identity".into());
        }
        host.connection.base_url = format!("http://127.0.0.1:{}", ready.port);
        host.log.write(json!({"event": "host_ready", "host_pid": std::process::id(),
            "launcher_pid": host.child.id(), "runtime_pid": ready.pid,
            "startup_ms": start.elapsed().as_millis(), "executable": executable,
            "data_dir": directory, "allowed_origin": origin, "job_assigned_before_startup": true}));
        Ok(host)
    }

    pub fn supervise(&mut self) -> bool {
        if !self.stopped && matches!(self.child.try_wait(), Ok(Some(_))) {
            self.channel.close(); self.job.lock().unwrap().take(); self.stopped = true;
            self.log.write(json!({"event": "runtime_exited", "tree_job_closed": true}));
        }
        let mut notifications = self.notifications.lock().unwrap();
        if self.channel.is_closed() { notifications.clear(); }
        notifications.take_changed()
    }

    pub fn stop(&mut self) {
        if self.stopped { return; }
        if self.channel.shutdown().is_err() { self.channel.close(); }
        let deadline = Instant::now() + Duration::from_secs(8);
        let mut graceful = false;
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) { graceful = true; break; }
            thread::sleep(Duration::from_millis(20));
        }
        self.channel.close();
        self.job.lock().unwrap().take(); // KILL_ON_JOB_CLOSE 兜底整树，不是单 PID kill。
        let _ = self.child.wait();
        self.stopped = true;
        self.log.write(json!({"event": "host_stopped", "graceful": graceful, "tree_job_closed": true}));
    }
}
impl Drop for RuntimeHost { fn drop(&mut self) { self.stop(); } }

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn start_isolated_development(directory: &Path, runtime: &DevelopmentRuntime, development: bool) -> Result<RuntimeHost, String> {
        RuntimeHost::start_command(directory, &runtime.python, runtime.command(directory), false, development,
            Arc::new(crate::credentials::tests::store()), Some(runtime))
    }

    #[test]
    fn notification_snapshot_is_unknown_until_valid_event_and_coalesces_latest_counts() {
        let mut display = Notifications::default();
        assert_eq!(display.counts(), None); assert!(!display.take_changed());
        display.receive(json!({"pending_questions":2,"pending_approvals":1,"pending_actions":4,"unviewed_results":2})).unwrap();
        assert_eq!(display.counts(), Some(PendingCounts { pending_questions: 2, pending_approvals: 1, pending_actions: 4, unviewed_results: 2 }));
        display.receive(json!({"pending_questions":1,"pending_approvals":0,"pending_actions":1,"unviewed_results":0})).unwrap();
        assert!(display.take_changed()); assert!(!display.take_changed());
        assert_eq!(display.counts(), Some(PendingCounts { pending_questions: 1, pending_approvals: 0, pending_actions: 1, unviewed_results: 0 }));
        display.receive(json!({"pending_questions":1,"pending_approvals":0,"pending_actions":1,"unviewed_results":0})).unwrap();
        assert!(!display.take_changed());
        for params in [json!({"pending_questions":-1,"pending_approvals":0,"pending_actions":0,"unviewed_results":0}),
            json!({"pending_questions":0,"pending_approvals":0,"pending_actions":1.5,"unviewed_results":0}),
            json!({"pending_questions":0,"pending_approvals":0,"pending_actions":0,"unviewed_results":0,"run_id":"not-allowed"}),
            json!({"pending_questions":1,"pending_approvals":0}), json!({"pending_questions":1})] {
            assert_eq!(display.receive(params), Err("invalid_notification_counts"));
        }
        assert_eq!(serde_json::to_value(display.counts()).unwrap(), json!({"pending_questions":1,"pending_approvals":0,"pending_actions":1,"unviewed_results":0}));
        display.clear(); assert!(display.take_changed()); assert_eq!(display.counts(), None);
    }

    #[test]
    fn development_command_uses_explicit_venv_module_and_source_root() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap();
        let runtime = DevelopmentRuntime::new(root.join(".venv/Scripts/python.exe"), root.to_owned()).unwrap();
        let data = Path::new(r"C:\controlled data\FlowMate");
        let command = runtime.command(data);
        assert_eq!(command.get_program(), root.join(".venv/Scripts/python.exe").canonicalize().unwrap());
        assert_eq!(command.get_args().collect::<Vec<_>>(), ["-m", "flowmate", "runtime", "--data-dir", data.to_str().unwrap()]);
        assert_eq!(command.get_current_dir(), Some(root.canonicalize().unwrap().as_path()));
        assert_eq!(command.get_envs().find(|(key, _)| *key == "PYTHONPATH").unwrap().1.unwrap(), root.canonicalize().unwrap().join("packages"));
    }

    #[test]
    fn development_configuration_fails_without_explicit_valid_paths() {
        assert_eq!(DevelopmentRuntime::new(PathBuf::from("python.exe"), PathBuf::from(".")).err(), Some("invalid_development_paths"));
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap();
        assert_eq!(DevelopmentRuntime::new(root.join("missing/python.exe"), root.to_owned()).err(), Some("invalid_development_python"));
    }

    #[test]
    fn development_launcher_validates_job_parent_image_and_sanitized_environment() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap();
        let directory = std::env::temp_dir().join("opencode").join(format!("flowmate-m1-launcher-{}", uuid::Uuid::new_v4()));
        let source = directory.join("source");
        std::fs::create_dir_all(source.join("packages/flowmate")).unwrap();
        std::fs::write(source.join("packages/flowmate/__init__.py"), "").unwrap();
        std::fs::write(source.join("packages/flowmate/__main__.py"), r#"
import json, os, sys
startup = json.loads(sys.stdin.buffer.readline())
assert startup['method'] == 'startup'
assert set(startup['params']) == {'token', 'data_dir', 'allowed_origins', 'desktop_diagnostics'}
assert sys.argv[1:] == ['runtime', '--data-dir', startup['params']['data_dir']]
assert os.path.samefile(os.getcwd(), os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
assert 'FLOWMATE_TEST_INHERITED' not in os.environ
assert 'PATH' not in os.environ
assert startup['protocol_version'] == 3 and startup['stream_seq'] == 1
print(json.dumps(dict(protocol_version=3, stream_seq=1, request_id='fixture-counts', kind='event', method='notifications.changed', params=dict(pending_questions=2,pending_approvals=3,pending_actions=7,unviewed_results=4))), flush=True)
print(json.dumps(dict(protocol_version=3, stream_seq=2, request_id='fixture-ready', kind='event', method='ready', params=dict(port=31417, pid=os.getpid(), runtime_version='fixture-1'))), flush=True)
request = json.loads(sys.stdin.buffer.readline())
assert request['kind'] == 'request' and request['method'] == 'shutdown'
print(json.dumps(dict(protocol_version=3, request_id=request['request_id'], kind='reply', method='shutdown', result=dict(stopping=True))), flush=True)
"#).unwrap();
        let runtime = DevelopmentRuntime::new(root.join(".venv/Scripts/python.exe"), source.clone()).unwrap();
        let data = directory.join("data");
        let mut command = runtime.command(&data);
        command.env("FLOWMATE_TEST_INHERITED", "public-test-marker");
        let mut host = RuntimeHost::start_command(&data, &runtime.python, command, false, true,
            Arc::new(crate::credentials::tests::store()), Some(&runtime)).unwrap();
        assert_eq!(serde_json::to_value(&host.connection).unwrap()["protocol_version"], 3,
            "WebView API and private channel now both declare v2");
        assert_eq!(host.notifications().lock().unwrap().counts(), Some(PendingCounts { pending_questions: 2, pending_approvals: 3, pending_actions: 7, unviewed_results: 4 }));
        assert!(host.supervise()); assert!(!host.supervise());
        let logs = std::fs::read_to_string(data.join("desktop-host.jsonl")).unwrap();
        let ready: Value = serde_json::from_str(logs.lines().find(|line| line.contains("host_ready")).unwrap()).unwrap();
        let pid = ready["runtime_pid"].as_u64().unwrap() as u32;
        assert_ne!(pid, host.child.id(), "Windows venv launcher must not weaken release identity");
        let mut sibling = Command::new(&runtime.interpreter).args(["-c", "import sys; sys.stdin.buffer.read()"])
            .stdin(Stdio::piped()).creation_flags(0x08000000).spawn().unwrap();
        {
            let job = host.job.lock().unwrap(); let job = job.as_ref().unwrap();
            job.assign(&sibling).unwrap();
            assert!(!job.valid_development_pid(&host.child, sibling.id(), &runtime.interpreter), "same Job but not launcher child");
            assert!(!job.valid_development_pid(&host.child, std::process::id(), &runtime.interpreter), "outside owned Job");
            assert!(!job.valid_development_pid(&host.child, pid, &runtime.python), "wrong executable image");
            assert!(!job.valid_development_pid(&host.child, 0, &runtime.interpreter));
        }
        host.stop(); drop(host); sibling.wait().unwrap();
        let logs = std::fs::read_to_string(data.join("desktop-host.jsonl")).unwrap();
        assert!(logs.contains("\"graceful\":true"));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn debug_product_bootstrap_serves_authenticated_http_and_stops() {
        use std::{io::Read, net::TcpStream};
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap();
        let runtime = DevelopmentRuntime::new(root.join(".venv/Scripts/python.exe"), root.to_owned()).unwrap();
        let app_data = std::env::temp_dir().join("opencode").join(format!("flowmate-m1-product-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&app_data).unwrap();
        let legacy_database = app_data.join("flowmate.sqlite3");
        std::fs::write(&legacy_database, b"public-legacy-database-marker").unwrap();
        let directory = app_data.join("data-v3");
        let mut host = start_isolated_development(&directory, &runtime, true).unwrap();
        let address = host.connection.base_url.strip_prefix("http://").unwrap();
        for (authorization, expected) in [
            (format!("Authorization: Bearer {}\r\n", host.connection.token), "HTTP/1.1 200"),
            (String::new(), "HTTP/1.1 401"),
        ] {
            let mut stream = TcpStream::connect(address).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            write!(stream, "GET /v3/health HTTP/1.1\r\nHost: {address}\r\nOrigin: http://127.0.0.1:5173\r\n{authorization}Connection: close\r\n\r\n").unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            assert!(response.starts_with(expected), "{response}");
            if expected == "HTTP/1.1 200" {
                let body: Value = serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap();
                assert!(body["runtime_version"].as_str().is_some_and(|version| !version.is_empty()));
                assert_eq!(body["api_version"], 3);
                assert_eq!(body["schema_version"], 3);
            }
        }
        host.stop();
        assert!(host.child.try_wait().unwrap().unwrap().success());
        drop(host);
        let logs = std::fs::read_to_string(directory.join("desktop-host.jsonl")).unwrap();
        assert!(logs.contains("\"graceful\":true"));
        assert_eq!(std::fs::read(legacy_database).unwrap(), b"public-legacy-database-marker");
        std::fs::remove_dir_all(app_data).unwrap();
    }

    #[test]
    #[ignore = "requires the real .local/m2/runtime frozen runtime; explicit invocation fails if absent"]
    fn packaged_runtime_start_serves_health_and_stops_real_frozen_exe() {
        use std::{io::Read, net::TcpStream};
        use windows_sys::Win32::System::Threading::WaitForSingleObject;

        let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap();
        let executable = root.join(".local/m2/runtime/flowmate-runtime/flowmate-runtime.exe");
        assert!(executable.is_file(), "real frozen runtime is required: {}", executable.display());
        let directory = root.join(".local/m2/acceptance").join(format!("frozen-host-{}", uuid::Uuid::new_v4())).join("独立 数据");
        println!("frozen runtime: {}; evidence: {}", executable.display(), directory.display());
        // 现有产物只证明CLI接缝，不作为本次修改后的来源同源/最终分发证据。
        let mut host = RuntimeHost::start(&directory, &executable, false, false).unwrap();
        let logs = std::fs::read_to_string(directory.join("desktop-host.jsonl")).unwrap();
        let ready: Value = logs.lines().map(|line| serde_json::from_str::<Value>(line).unwrap())
            .find(|event| event["event"] == "host_ready").unwrap();
        assert_eq!(ready["launcher_pid"], host.child.id());
        assert_eq!(ready["runtime_pid"], host.child.id());
        assert_eq!(ready["job_assigned_before_startup"], true);
        assert_eq!(ready["allowed_origin"], "http://tauri.localhost");
        assert!(host.job.lock().unwrap().is_some());

        let address = host.connection.base_url.strip_prefix("http://").unwrap();
        let mut health = Vec::new();
        for (authorization, expected) in [
            (format!("Authorization: Bearer {}\r\n", host.connection.token), "HTTP/1.1 200"),
            (String::new(), "HTTP/1.1 401"),
        ] {
            let mut stream = TcpStream::connect(address).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            write!(stream, "GET /v3/health HTTP/1.1\r\nHost: {address}\r\nOrigin: http://tauri.localhost\r\n{authorization}Connection: close\r\n\r\n").unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            assert!(response.starts_with(expected), "{response}");
            if expected == "HTTP/1.1 200" {
                let body: Value = serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap();
                assert!(body["runtime_version"].as_str().is_some_and(|version| !version.is_empty()));
                assert_eq!(body["api_version"], 3);
                assert_eq!(body["schema_version"], 3);
            }
            health.push(response);
        }
        host.stop();
        assert!(host.child.try_wait().unwrap().unwrap().success());
        assert_eq!(unsafe { WaitForSingleObject(host.child.as_raw_handle(), 0) }, 0);
        assert!(host.job.lock().unwrap().is_none());
        assert!(host.channel.is_closed());
        let logs = std::fs::read_to_string(directory.join("desktop-host.jsonl")).unwrap();
        let stopped: Value = logs.lines().map(|line| serde_json::from_str::<Value>(line).unwrap())
            .find(|event| event["event"] == "host_stopped").unwrap();
        assert_eq!(stopped["graceful"], true);
        assert_eq!(stopped["tree_job_closed"], true);
        let evidence = json!({"driver":"actual-runtime-host-start", "executable":executable,
            "ready":ready, "health_responses":health, "stopped":stopped,
            "owned_process_exited":true, "job_released":true, "gui_started":false, "cloud_requests":0});
        std::fs::write(directory.join("runtime-host-result.json"), serde_json::to_vec_pretty(&evidence).unwrap()).unwrap();
        println!("owned PID {} exited; Job released; health 200/401; no GUI", host.child.id());
    }

    fn fixture(script: &str) -> (PathBuf, PathBuf, Command) {
        use base64::Engine;
        let directory = std::env::temp_dir().join("opencode").join(format!("flowmate-m1-rust-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let executable = PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut command = Command::new(&executable);
        let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
        command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", &base64::engine::general_purpose::STANDARD.encode(bytes)]);
        (directory, executable, command)
    }

    #[test]
    fn packaged_launch_rejects_descendant_ready_pid_even_with_development_origin() {
        let script = r#"
            $startup = [Console]::In.ReadLine() | ConvertFrom-Json
            $descendant = Start-Process -PassThru -WindowStyle Hidden -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList '-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 300'
            [Console]::WriteLine((@{protocol_version=3;stream_seq=1;request_id='wrong-ready';kind='event';method='ready';params=@{port=31418;pid=$descendant.Id;runtime_version='fixture-1'}} | ConvertTo-Json -Depth 8 -Compress))
            $shutdown = [Console]::In.ReadLine() | ConvertFrom-Json
            [Console]::WriteLine((@{protocol_version=3;request_id=$shutdown.request_id;kind='reply';method='shutdown';result=@{stopping=$true}} | ConvertTo-Json -Depth 8 -Compress))
        "#;
        let (directory, executable, command) = fixture(script);
        let error = RuntimeHost::start_command(&directory, &executable, command, false, true,
            Arc::new(crate::credentials::tests::store()), None).err().unwrap();
        assert_eq!(error, "invalid_runtime_identity");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn new_protocol_stdio_fixture_eof_fails_pending_and_kills_descendant() {
        use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_QUERY_LIMITED_INFORMATION};
        let script = r#"
            $ErrorActionPreference='Stop'
            $startup = [Console]::In.ReadLine() | ConvertFrom-Json
            if ($startup.protocol_version -ne 3 -or $startup.stream_seq -ne 1 -or $startup.kind -ne 'event' -or $startup.method -ne 'startup' -or -not $startup.params.token) { exit 3 }
            $descendant = Start-Process -PassThru -WindowStyle Hidden -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList '-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 300'
            [IO.File]::WriteAllText((Join-Path $startup.params.data_dir 'fixture-descendant.pid'),[string]$descendant.Id)
            [Console]::WriteLine((@{protocol_version=3;stream_seq=1;request_id='fixture-ready';kind='event';method='ready';params=@{port=31415;pid=$PID;runtime_version='fixture-1'}} | ConvertTo-Json -Depth 8 -Compress))
            [Console]::In.ReadLine() | Out-Null
            exit 0
        "#;
        let (directory, executable, command) = fixture(script);
        let mut host = RuntimeHost::start_command(&directory, &executable, command, false, false,
            Arc::new(crate::credentials::tests::store()), None).unwrap();
        assert_eq!(host.connection.base_url, "http://127.0.0.1:31415");
        let pid: u32 = std::fs::read_to_string(directory.join("fixture-descendant.pid")).unwrap().parse().unwrap();
        let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        assert!(!process.is_null());
        let channel = host.channel();
        let result = tauri::async_runtime::block_on(channel.request("resource.register", json!({}), Duration::from_secs(5)));
        assert_eq!(result.unwrap_err(), "channel_closed");
        assert_eq!(unsafe { WaitForSingleObject(process, 5000) }, 0);
        unsafe { CloseHandle(process); }
        host.stop(); drop(host);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn stderr_allowlist_does_not_persist_nested_secrets_or_error_bodies() {
        let diagnostic = json!({"code":"api_internal_error","request_id":"request-1","exception_type":"ValueError",
            "frames":[{"module":"flowmate.api.app","function":"unexpected","line":48}]});
        let mut expected = diagnostic.clone(); expected["event"] = json!("runtime_diagnostic");
        assert_eq!(safe_diagnostic(&diagnostic.to_string()), Some(expected));
        assert_eq!(safe_diagnostic(r#"{"event":"runtime_ready","value":{"secret":"public-test-key-not-a-secret"},"error":"private-state-marker"}"#), None);
        assert_eq!(safe_diagnostic(r#"{"event":"public-test-key-not-a-secret","code":"private-state-marker"}"#), None);
        for (field, value) in [("message", json!("public-test-key-not-a-secret")), ("locals", json!({"prompt":"raw-body"})),
            ("frames", json!([{"module":"C:\\secret.py","function":"unsafe","line":1}])),
            ("frames", json!([{"module":"flowmate.api.app","function":"unexpected","line":0}])),
            ("frames", json!(vec![json!({"module":"flowmate.api.app","function":"unexpected","line":1});17]))] {
            let mut invalid = diagnostic.clone(); invalid[field] = value;
            assert_eq!(safe_diagnostic(&invalid.to_string()), None, "{field}");
        }
    }

    #[test]
    fn stop_sends_shutdown_request_and_allows_reply_before_tree_close() {
        let script = r#"
            $startup = [Console]::In.ReadLine() | ConvertFrom-Json
            [Console]::WriteLine((@{protocol_version=3;stream_seq=1;request_id='ready';kind='event';method='ready';params=@{port=31415;pid=$PID;runtime_version='fixture-1'}} | ConvertTo-Json -Depth 8 -Compress))
            $shutdown = [Console]::In.ReadLine() | ConvertFrom-Json
            if ($shutdown.kind -ne 'request' -or $shutdown.method -ne 'shutdown') { exit 4 }
            [Console]::WriteLine((@{protocol_version=3;request_id=$shutdown.request_id;kind='reply';method='shutdown';result=@{stopping=$true}} | ConvertTo-Json -Depth 8 -Compress))
            [Console]::Out.Flush()
            [IO.File]::WriteAllText((Join-Path $startup.params.data_dir 'shutdown-replied'),'true')
        "#;
        let (directory, executable, command) = fixture(script);
        let mut host = RuntimeHost::start_command(&directory, &executable, command, false, false,
            Arc::new(crate::credentials::tests::store()), None).unwrap();
        host.stop();
        assert_eq!(std::fs::read_to_string(directory.join("shutdown-replied")).unwrap(), "true");
        drop(host); std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn python_hostchannel_stdio_resolves_dpapi_and_nested_requests_without_secret_logs() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap();
        let cfg = std::fs::read_to_string(root.join(".venv/pyvenv.cfg")).unwrap();
        let home = cfg.lines().find_map(|line| line.strip_prefix("home = ")).unwrap();
        // venv 的 python.exe 在 Windows 是 launcher；base executable 才与 ready.pid 相同。
        let executable = Path::new(home).join("python.exe");
        let directory = std::env::temp_dir().join("opencode").join(format!("flowmate-m1-cross-{}", uuid::Uuid::new_v4()));
        let binding = crate::credentials::tests::binding();
        let store = Arc::new(crate::credentials::tests::store());
        let _cleanup = crate::credentials::tests::Cleanup(&store, binding.secret_ref.clone());
        store.save(&binding, crate::credentials::tests::KEY).unwrap();
        let mut script = format!("import sys\nsys.path[:0] = [{}, {}]\nbinding_json = {}\n",
            serde_json::to_string(&root.join("packages").to_str().unwrap()).unwrap(),
            serde_json::to_string(&root.join(".venv/Lib/site-packages").to_str().unwrap()).unwrap(),
            serde_json::to_string(&serde_json::to_string(&binding).unwrap()).unwrap());
        script.push_str(r#"
import asyncio, json, os
from flowmate.host.channel import HostChannel
from flowmate.host.diagnostics import make_diagnostic
from flowmate.host.stdio import open_stdio
from flowmate.host.protocol import HostEvent, ModelSecretBinding, decode_frame
from flowmate.host.secrets import HostSecrets
from flowmate.contracts.base import DomainError
async def main():
    startup = decode_frame(sys.stdin.buffer.readline(), 16*1024*1024)
    assert startup.method == 'startup'
    assert startup.protocol_version == 3 and startup.stream_seq == 1
    assert set(startup.params) == {'token','data_dir','allowed_origins','desktop_diagnostics'}
    binding = ModelSecretBinding.model_validate_json(binding_json)
    async def register(params):
        assert params == {'scope':{'workspace_id':binding.connection_id,'session_id':None},'kind':'file','paths':[]}
        try:
            await secrets.resolve(binding)
        except DomainError as error:
            assert error.code == 'credential_missing'
        else:
            raise AssertionError('credential cache survived clear')
        return {'resources':[]}
    reader, writer = open_stdio()
    channel = HostChannel(reader, writer, handlers={'resource.register':register,'shutdown':lambda params:{'stopping':True}})
    await channel.start()
    secrets = HostSecrets(channel)
    assert await secrets.resolve(binding) == b'public-test-key-not-a-secret'
    assert await asyncio.gather(*(secrets.resolve(binding) for _ in range(8))) == [b'public-test-key-not-a-secret'] * 8
    ctx = {'run_id':'public-run','identity':{'source':'public','parts':[1,2]}}
    protected = await secrets.protect(ctx,b'public-private-state-marker')
    assert await secrets.unprotect(ctx,protected) == b'public-private-state-marker'
    try:
        await secrets.unprotect({'run_id':'wrong','identity':ctx['identity']},protected)
    except DomainError as error:
        assert error.code == 'private_unprotect_failed'
    else:
        raise AssertionError('wrong context decrypted')
    sys.stderr.write(json.dumps({'event':'runtime_ready','value':{'secret':'public-test-key-not-a-secret'},'error':'public-private-state-marker'})+'\n')
    sys.stderr.flush()
    try:
        raise ValueError('public-test-key-not-a-secret prompt raw-body')
    except ValueError as error:
        await channel.diagnostic(make_diagnostic('fixture_failed', error, request_id='fixture-diagnostic'))
    await channel.event(HostEvent(request_id='bad-diagnostic', method='diagnostic', params={'code':'fixture_failed','message':'public-test-key-not-a-secret'}))
    await channel.event(HostEvent(request_id='python_ready',method='ready',params={'port':31416,'pid':os.getpid(),'runtime_version':'public-test-key-not-a-secret'}))
    await channel.wait_closed()
    await channel.close()
asyncio.run(main())
"#);
        let mut command = Command::new(&executable); command.args(["-I", "-c", &script]);
        let mut host = RuntimeHost::start_command(&directory, &executable, command, false, false, store.clone(), None).unwrap();
        assert_eq!(host.connection.base_url, "http://127.0.0.1:31416");
        store.clear(&binding.secret_ref).unwrap();
        let channel = host.channel();
        assert_eq!(tauri::async_runtime::block_on(channel.request("resource.register", json!({
            "scope":{"workspace_id":binding.connection_id,"session_id":null},"kind":"file","paths":[]}), Duration::from_secs(5))).unwrap(), json!({"resources":[]}));
        host.stop(); drop(host);
        let logs = std::fs::read_to_string(directory.join("desktop-host.jsonl")).unwrap();
        assert!(logs.contains("runtime_diagnostic"));
        let diagnostic: Value = logs.lines().map(|line| serde_json::from_str::<Value>(line).unwrap())
            .find(|value| value["event"] == "runtime_diagnostic").unwrap();
        assert_eq!(diagnostic["request_id"], "fixture-diagnostic");
        assert_eq!(diagnostic["exception_type"], "ValueError");
        assert_eq!(diagnostic["frames"][0]["module"], "__main__");
        assert_eq!(diagnostic["frames"][0]["function"], "main");
        assert!(diagnostic["frames"][0]["line"].as_u64().unwrap() > 0);
        assert!(logs.contains("invalid_diagnostic"));
        assert!(!logs.contains(crate::credentials::tests::KEY));
        assert!(!logs.contains("public-private-state-marker"));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn origins_are_exact_and_build_specific() {
        assert!(permitted_origin("http://tauri.localhost", false));
        assert!(!permitted_origin("http://127.0.0.1:5173", false));
        assert!(permitted_origin("http://127.0.0.1:5173", true));
        assert!(!permitted_origin("https://example.com", true));
        assert!(!permitted_origin("http://tauri.localhost.evil", false));
    }

    #[test]
    fn host_lock_is_separate_from_runtime_lock() {
        let dir = std::env::temp_dir().join(format!("flowmate-host-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = host_lock(&dir).unwrap();
        assert!(host_lock(&dir).is_err());
        assert!(!dir.join("runtime.lock").exists());
        drop(first);
        assert!(host_lock(&dir).is_ok());
        std::fs::remove_dir_all(dir).unwrap();
    }
}

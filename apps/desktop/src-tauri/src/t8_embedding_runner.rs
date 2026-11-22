//! 仅测试/验收可达的批处理入口；原宿主继续拥有全部管道、凭据、Job和退出。
use super::*;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
#[serde(tag = "phase", deny_unknown_fields)]
enum BatchFrame {
    #[serde(rename = "ready")]
    Ready { batch: String, pid: u32, runtime_version: String },
    #[serde(rename = "completed")]
    Completed { batch: String, pid: u32, runtime_version: String,
        status: String, report_file: String, report_sha256: String },
}

fn read_report(path: &Path, declared_sha256: &str) -> Result<Value, String> {
    let bytes = std::fs::read(path).map_err(|_| "embedding_report_missing")?;
    if format!("{:x}", Sha256::digest(&bytes)) != declared_sha256 {
        return Err("embedding_report_sha256_mismatch".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "embedding_report_invalid".into())
}

fn run_batch(root: &Path, config: &Path, output: &Path, execution: &str,
    approved_plan: Option<&Path>, store: Arc<CredentialStore>) -> Result<Value, String> {
    let runtime = DevelopmentRuntime::new(root.join(".venv/Scripts/python.exe"), root.to_owned())?;
    let directory = output.join("data-v4");
    let mut command = Command::new(&runtime.python);
    command.args(["-B", "-X", "utf8", "-m", "scripts.m3.embedding_runner"]);
    command.arg("--config").arg(config)
        .arg("--output").arg(output).args(["--execution", execution]);
    if let Some(plan) = approved_plan { command.args(["--phase", "execute", "--approved-plan"]).arg(plan); }
    let (mut host, receiver) = RuntimeHost::launch_command(
        &directory, &runtime.python, command, false, store, Some(&runtime))?;
    let ready = receiver.recv_timeout(Duration::from_secs(90)).map_err(|_| "embedding_ready_timeout")?;
    let BatchFrame::Ready { batch, pid, runtime_version } =
        serde_json::from_value(ready).map_err(|_| "invalid_embedding_ready")? else { return Err("invalid_embedding_ready".into()); };
    if batch != "embedding_acceptance" || !host.valid_identity(pid, &runtime_version, Some(&runtime)) {
        return Err("invalid_runtime_identity".into());
    }
    host.log.write(json!({"event":"embedding_batch_ready", "runtime_pid":pid,
        "runtime_version":runtime_version, "job_assigned_before_startup":true, "http_started":false}));
    let completed = receiver.recv_timeout(Duration::from_secs(if execution == "offline_http" { 90 } else { 1800 }))
        .map_err(|_| if host.channel.is_closed() { "embedding_batch_disconnected" } else { "embedding_completion_timeout" })?;
    let BatchFrame::Completed { batch, pid: completed_pid, runtime_version: completed_version,
        status, report_file, report_sha256 } =
        serde_json::from_value(completed).map_err(|_| "invalid_embedding_completion")? else {
            return Err("invalid_embedding_completion".into());
        };
    if batch != "embedding_acceptance" || completed_pid != pid || completed_version != runtime_version
        || !matches!(status.as_str(), "planned" | "completed" | "failed")
        || !matches!(report_file.as_str(), "plan.json" | "embedding-report.json" | "runner-error.json")
        || report_sha256.len() != 64 || !report_sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalid_embedding_completion".into());
    }
    let report = read_report(&output.join(&report_file), &report_sha256)?;
    host.log.write(json!({"event":"embedding_batch_completed", "runtime_pid":pid, "status":status,
        "report_file":report_file, "report_sha256":report_sha256}));
    host.stop();
    if !host.child.try_wait().map_err(|_| "embedding_exit_failed")?.is_some_and(|code| code.success())
        || host.job.lock().unwrap().is_some() || !host.channel.is_closed() {
        return Err("embedding_exit_failed".into());
    }
    drop(host);
    if status == "failed" { return Err(format!("embedding_batch_failed: {}", report["failure"]["code"])); }
    Ok(report)
}

struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); }
}

#[test]
fn embedding_batch_offline_native_uses_bound_credentials_and_sends_no_generation() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap();
    let output = root.join(".local/m3/T8-runner").join(format!("native-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&output).unwrap();
    let server_dir = output.join("server");
    let runtime = DevelopmentRuntime::new(root.join(".venv/Scripts/python.exe"), root.to_owned()).unwrap();
    let server_script = format!("import sys,runpy\nsys.path[:0]=[{}, {}, {}]\nrunpy.run_module('tests.m3.test_embedding_runner',run_name='__main__')",
        serde_json::to_string(root.to_str().unwrap()).unwrap(),
        serde_json::to_string(root.join("packages").to_str().unwrap()).unwrap(),
        serde_json::to_string(root.join(".venv/Lib/site-packages").to_str().unwrap()).unwrap());
    let _server = Server(Command::new(&runtime.interpreter)
        .current_dir(root).args(["-B", "-X", "utf8", "-c", &server_script])
        .arg(&server_dir).stdout(Stdio::null()).stderr(File::create(output.join("server-stderr.log")).unwrap())
        .spawn().unwrap());
    let deadline = Instant::now() + Duration::from_secs(20);
    while !server_dir.join("ready.json").exists() {
        assert!(Instant::now() < deadline, "本机合成embedding服务未启动: {}", output.display());
        thread::sleep(Duration::from_millis(20));
    }
    let endpoint: Value = serde_json::from_slice(&std::fs::read(server_dir.join("ready.json")).unwrap()).unwrap();
    let store = Arc::new(crate::credentials::tests::store());
    let mut binding = crate::credentials::tests::binding();
    binding.connection_id = uuid::Uuid::new_v4().to_string();
    binding.secret_ref = uuid::Uuid::new_v4().to_string();
    binding.connection_version = 7;
    binding.endpoint = endpoint["endpoint"].as_str().unwrap().into();
    let _cleanup = crate::credentials::tests::Cleanup(&store, binding.secret_ref.clone());
    let limits = json!({"max_model_requests":1,"max_steps":16,"max_tasks":2,
        "max_total_tokens":100000,"max_cost_units":"100000000"});
    let config = json!({
        "connections":[{"id":binding.connection_id,"version":7,"display_name":"本机离线fixture",
            "protocol":"openai_compatible","endpoint":binding.endpoint,"secret_ref":binding.secret_ref}],
        "embedding_profile":{"id":uuid::Uuid::new_v4().to_string(),"display_name":"本机合成向量",
            "provider":"openai","connection_id":binding.connection_id,"model_id":"offline-embedding-fixture",
            "dimensions":3,"request_dimensions":true,"pricing":{"input_per_million":"0.1"}},
        "query_model":{"id":uuid::Uuid::new_v4().to_string(),"connection_id":binding.connection_id,
            "model_id":"offline-generation-never-sent","context_window_tokens":16384,"max_output_tokens":1024},
        "document_limits":limits,"query_limits":limits,
    });
    let config_file = output.join("metadata.json");
    std::fs::write(&config_file, serde_json::to_vec_pretty(&config).unwrap()).unwrap();
    let batch = output.join("acceptance");
    let plan = run_batch(root, &config_file, &batch, "offline_http", None, store.clone()).unwrap();
    assert_eq!(plan["execution_plan"]["hard_request_ceiling"], 74);
    assert!(!server_dir.join("calls.jsonl").exists(), "准备计划不可解析凭据/外发");
    store.save(&binding, crate::credentials::tests::KEY).unwrap();
    let report = run_batch(root, &config_file, &batch, "offline_http", Some(&batch.join("plan.json")), store.clone()).unwrap();
    assert_eq!(report["embedding_requests"], 74);
    assert_eq!(report["document_requests"], 22);
    assert_eq!(report["query_requests"], 52);
    assert_eq!(report["generation_requests"], 0);
    assert_eq!(report["quality_evidence"], false);
    assert_eq!(report["real_embedding_gate_met"], false);
    assert_eq!(report["source_stable"], true);
    assert_eq!(std::fs::read_to_string(server_dir.join("calls.jsonl")).unwrap().lines().count(), 74);
    let log = std::fs::read_to_string(batch.join("data-v4/desktop-host.jsonl")).unwrap();
    assert!(log.contains("\"graceful\":true") && log.contains("\"http_started\":false"));
    assert!(!log.contains(crate::credentials::tests::KEY));
    assert!(!std::fs::read_to_string(batch.join("embedding-report.json")).unwrap().contains("secret_ref"));
    // 清除后原绑定不再可解析；仅本测试随机槽，Cleanup删除自身墓碑。
    store.clear(&binding.secret_ref).unwrap();
    assert_eq!(store.resolve(&binding).unwrap_err(), "credential_missing");
    println!("T8 offline native 74 embedding / 0 generation; evidence={}", output.display());
}

#[test]
fn embedding_batch_report_sha_mismatch_is_rejected_before_json_parsing() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap();
    let directory = root.join(".local/m3/T8-runner").join(format!("report-integrity-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let report = directory.join("embedding-report.json");
    // hashlib.sha256(b'{"status":"completed"}\n')，独立固定向量。
    let declared = "5bdc4bb3ad85eaa994ae27ea899eaf219ba54b9a9f598282dcc0f2fecc6b7514";
    std::fs::write(&report, b"{\"status\":\"completed\"}\n").unwrap();
    assert_eq!(read_report(&report, declared).unwrap()["status"], "completed");
    for changed in [b"{\"status\":\"failed\"}".as_slice(), b"not JSON".as_slice()] {
        std::fs::write(&report, changed).unwrap();
        assert_eq!(read_report(&report, declared).unwrap_err(), "embedding_report_sha256_mismatch");
    }
}

#[test]
fn embedding_batch_ready_cannot_satisfy_product_http_ready() {
    let batch = json!({"batch":"embedding_acceptance","phase":"ready",
        "pid":std::process::id(),"runtime_version":"fixture"});
    assert!(serde_json::from_value::<Ready>(batch.clone()).is_err());
    assert!(matches!(serde_json::from_value::<BatchFrame>(batch), Ok(BatchFrame::Ready { .. })));
    for frame in [
        json!({"batch":"embedding_acceptance","phase":"ready","pid":1,"runtime_version":"v","port":1}),
        json!({"batch":"embedding_acceptance","phase":"other","pid":1,"runtime_version":"v"}),
    ] { assert!(serde_json::from_value::<BatchFrame>(frame).is_err()); }
}

#[test]
#[ignore = "explicit metadata only; defaults to plan, paid execution requires an approved saved plan path"]
fn embedding_acceptance_from_explicit_metadata() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap();
    let config = PathBuf::from(std::env::var_os("FLOWMATE_T8_CONFIG").expect("non-secret metadata path required"));
    let output = PathBuf::from(std::env::var_os("FLOWMATE_T8_OUTPUT").expect("isolated T8 output path required"));
    let approved = std::env::var_os("FLOWMATE_T8_APPROVED_PLAN").map(PathBuf::from);
    let report = run_batch(root, &config, &output, "real", approved.as_deref(), Arc::new(CredentialStore::default())).unwrap();
    println!("T8 {}: {}", if approved.is_some() { "executed" } else { "planned" }, output.display());
    if approved.is_some() { assert_eq!(report["real_embedding_gate_met"], true, "retrieval gate not met; inspect report"); }
}

// 独立问答验收：只追加cfg(test)入口，不改变原embedding驱动或产品启动方式。
fn answer_python(root: &Path, module: &str) -> Result<Command, String> {
    let runtime = DevelopmentRuntime::new(root.join(".venv/Scripts/python.exe"), root.to_owned())?;
    let script = format!("import sys,runpy\nsys.path[:0]=[{}, {}, {}]\nrunpy.run_module({},run_name='__main__')",
        serde_json::to_string(root.to_str().unwrap()).unwrap(),
        serde_json::to_string(root.join("packages").to_str().unwrap()).unwrap(),
        serde_json::to_string(root.join(".venv/Lib/site-packages").to_str().unwrap()).unwrap(),
        serde_json::to_string(module).unwrap());
    let mut command = Command::new(&runtime.interpreter);
    command.current_dir(root).args(["-B", "-X", "utf8", "-c", &script]);
    Ok(command)
}

fn answer_archive(root: &Path, output: &Path, exit_code: i32) -> Result<Value, String> {
    let result = answer_python(root, "scripts.m3.answer_acceptance")?
        .arg("archive").arg("--output").arg(output).arg("--driver-exit-code").arg(exit_code.to_string())
        .stdin(Stdio::null()).output().map_err(|_| "answer_archive_spawn_failed")?;
    if !result.status.success() {
        std::fs::write(output.join("archive-stderr.log"), result.stderr).map_err(|_| "answer_archive_log_failed")?;
        return Err("answer_archive_failed".into());
    }
    let receipt: Value = serde_json::from_slice(&result.stdout).map_err(|_| "answer_archive_receipt_invalid")?;
    let digest = receipt["report_sha256"].as_str().ok_or("answer_archive_receipt_invalid")?;
    read_report(&output.join("answer-report.json"), digest)
}

fn answer_execute(root: &Path, output: &Path, config: &Path, executable: &Path, plan: &Path,
    test_store: Option<Arc<CredentialStore>>) -> Result<(Value, String), String> {
    let stderr = OpenOptions::new().create_new(true).write(true).open(output.join("driver-stderr.log"))
        .map_err(|_| "answer_driver_evidence_exists")?;
    let mut driver = Server(answer_python(root, "scripts.m3.answer_acceptance")?
        .arg("drive").arg("--output").arg(output).arg("--config").arg(config)
        .arg("--runtime").arg(executable).arg("--plan").arg(plan).arg("--execute")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(stderr).spawn()
        .map_err(|_| "answer_driver_spawn_failed")?);
    let mut lines = BufReader::new(driver.0.stdout.take().ok_or("answer_driver_stdout_missing")?);
    let mut checked = String::new();
    lines.read_line(&mut checked).map_err(|_| "answer_preflight_failed")?;
    let receipt: Value = serde_json::from_str(&checked).map_err(|_| "answer_preflight_failed")?;
    if receipt["phase"] != "checked" { return Err("answer_preflight_failed".into()); }
    // 只有专用库确认没有任何旧用户Run/派发后，才允许产品scheduler启动。
    let directory = output.join("data-v4");
    let host = if let Some(store) = test_store {
        let mut command = Command::new(executable);
        command.args(["runtime", "--data-dir"]).arg(&directory);
        RuntimeHost::start_command(&directory, executable, command, false, store, None)
    } else {
        RuntimeHost::start(&directory, executable, false)
    };
    let mut host = match host {
        Ok(host) => host,
        Err(_) => {
            let _ = driver.0.kill();
            let _ = driver.0.wait();
            answer_archive(root, output, 2)?;
            return Err("answer_host_start_failed".into());
        }
    };
    let token = host.connection.token.clone();
    let driven = (|| -> Result<i32, String> {
        let mut input = driver.0.stdin.take().ok_or("answer_driver_stdin_missing")?;
        // API token只经过匿名stdin；不进入argv、环境、文件或诊断。
        serde_json::to_writer(&mut input, &host.connection).map_err(|_| "answer_connection_write_failed")?;
        input.write_all(b"\n").map_err(|_| "answer_connection_write_failed")?;
        input.flush().map_err(|_| "answer_connection_write_failed")?;
        drop(input);
        Ok(driver.0.wait().map_err(|_| "answer_driver_wait_failed")?.code().unwrap_or(2))
    })();
    host.stop();
    let exit_ok = host.child.try_wait().map_err(|_| "answer_host_exit_failed")?.is_some_and(|code| code.success())
        && host.job.lock().unwrap().is_none() && host.channel.is_closed();
    drop(host);
    // 即使driver/模型失败，退出后仍从生产账本保存所有实际消息、usage和派发事实。
    let report = answer_archive(root, output, *driven.as_ref().unwrap_or(&2))?;
    driven?;
    if !exit_ok { return Err("answer_host_exit_failed".into()); }
    Ok((report, token))
}

#[test]
fn answer_acceptance_offline_frozen_sdk_answers_no_answers_and_budget() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap();
    let executable = root.join(".local/m3/m3-2bea4110/preview/runtime/flowmate-runtime.exe");
    assert!(executable.is_file(), "explicit existing M3 candidate is required");
    for scenario in ["answers", "budget"] {
        let stage = root.join(".local/m3/T8-answer").join(format!("native-{scenario}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&stage).unwrap();
        let server_dir = stage.join("server");
        let _server = Server(answer_python(root, "tests.m3.test_answer_acceptance").unwrap()
            .arg(&server_dir).arg(scenario).stdout(Stdio::null())
            .stderr(File::create(stage.join("server-stderr.log")).unwrap()).spawn().unwrap());
        let deadline = Instant::now() + Duration::from_secs(20);
        while !server_dir.join("ready.json").exists() {
            assert!(Instant::now() < deadline, "local answer SSE fixture did not start");
            thread::sleep(Duration::from_millis(20));
        }
        let service: Value = serde_json::from_slice(&std::fs::read(server_dir.join("ready.json")).unwrap()).unwrap();
        let store = Arc::new(crate::credentials::tests::store());
        let mut binding = crate::credentials::tests::binding();
        binding.connection_id = uuid::Uuid::new_v4().to_string();
        binding.secret_ref = uuid::Uuid::new_v4().to_string();
        binding.protocol = crate::credentials::ModelProtocol::OpenaiResponses;
        binding.endpoint = service["endpoint"].as_str().unwrap().into();
        let _cleanup = crate::credentials::tests::Cleanup(&store, binding.secret_ref.clone());
        let config = stage.join("metadata.json");
        std::fs::write(&config, json!({
            "connections":[{"id":binding.connection_id,"display_name":"本机问答SSE",
                "protocol":"openai_responses","endpoint":binding.endpoint,"secret_ref":binding.secret_ref}],
            "query_model":{"id":uuid::Uuid::new_v4().to_string(),"connection_id":binding.connection_id,
                "model_id":"answer-offline-fixture","context_window_tokens":32768,"max_output_tokens":8192,
                "capabilities":{"tools":true}}
        }).to_string()).unwrap();
        let output = stage.join("acceptance");
        let prepared = answer_python(root, "scripts.m3.answer_acceptance").unwrap().arg("prepare")
            .arg("--output").arg(&output).arg("--config").arg(&config).arg("--runtime").arg(&executable)
            .args(["--execution", "offline_http"]).stdout(Stdio::null())
            .stderr(File::create(stage.join("prepare-stderr.log")).unwrap()).status().unwrap();
        assert!(prepared.success(), "offline preparation failed: {}", stage.display());
        assert!(!server_dir.join("calls.jsonl").exists());
        store.save(&binding, crate::credentials::tests::KEY).unwrap();
        let (report, token) = answer_execute(root, &output, &config, &executable, &output.join("plan.json"), Some(store.clone())).unwrap();
        assert_eq!(report["embedding_requests"], 0);
        assert_eq!(report["semantic_judgment"], Value::Null);
        assert_eq!(report["execution_constraints_met"], true);
        assert_eq!(report["source_stable"], true);
        assert!(report["unknown_cost_requests"].as_u64().unwrap() > 0);
        if scenario == "answers" {
            assert_eq!(report["status"], "completed");
            assert_eq!(report["generation_requests"], 22);
            let results = report["results"].as_array().unwrap();
            assert!(results[..4].iter().all(|row| row["citations"].as_array().unwrap().len() == 1
                && row["citations"][0]["identity_valid"] == true && row["citations"][0]["scope_match"] == true));
            assert!(results[4..].iter().all(|row| row["citations"].as_array().unwrap().is_empty()));
            assert!(results.iter().all(|row| row["budget"]["limits"]["max_model_requests"] == 4
                && row["budget"]["limits"]["max_steps"] == 16
                && row["run"]["config"]["model_profile"]["protocol"] == "openai_responses"
                && row["source_checks"].as_array().unwrap().iter().all(|check|
                    check["identity_valid"] == true && check["scope_match"] == true)
                && !row["source_checks"].as_array().unwrap().is_empty()));
        } else {
            assert_eq!(report["status"], "failed");
            assert_eq!(report["generation_requests"], 4);
            assert_eq!(report["results"][0]["run"]["state"], "failed");
        }
        assert_eq!(std::fs::read_to_string(server_dir.join("calls.jsonl")).unwrap().lines().count() as u64,
            report["generation_requests"].as_u64().unwrap());
        let report_path = output.join("answer-report.json");
        let before = std::fs::read(&report_path).unwrap();
        let rejected = answer_python(root, "scripts.m3.answer_acceptance").unwrap().arg("drive")
            .arg("--output").arg(&output).arg("--config").arg(&config).arg("--runtime").arg(&executable)
            .arg("--plan").arg(output.join("plan.json")).arg("--execute").stdin(Stdio::null()).output().unwrap();
        assert!(!rejected.status.success());
        assert_eq!(std::fs::read(&report_path).unwrap(), before);
        for path in [report_path, output.join("summary.md"), output.join("driver-stderr.log"),
            output.join("data-v4/desktop-host.jsonl"), output.join("data-v4/flowmate.sqlite3")] {
            let bytes = std::fs::read(&path).unwrap();
            assert!(!bytes.windows(token.len()).any(|part| part == token.as_bytes()), "API token leaked");
            assert!(!bytes.windows(crate::credentials::tests::KEY.len())
                .any(|part| part == crate::credentials::tests::KEY.as_bytes()), "provider key leaked");
        }
        println!("T8 answer {scenario}: {}; evidence={}", report["status"], stage.display());
    }
}

#[test]
#[ignore = "real answer generation: explicit execute switch and prepared plan are required"]
fn answer_acceptance_from_explicit_metadata() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap();
    assert_eq!(std::env::var("FLOWMATE_T8_ANSWER_EXECUTE").as_deref(), Ok("1"), "explicit batch execution required");
    let output = PathBuf::from(std::env::var_os("FLOWMATE_T8_ANSWER_OUTPUT").expect("isolated answer output required"));
    let config = PathBuf::from(std::env::var_os("FLOWMATE_T8_ANSWER_CONFIG").expect("non-secret model metadata required"));
    let executable = PathBuf::from(std::env::var_os("FLOWMATE_T8_ANSWER_RUNTIME").expect("explicit frozen runtime required"));
    let plan = PathBuf::from(std::env::var_os("FLOWMATE_T8_ANSWER_PLAN").expect("prepared plan path required"));
    let (report, _) = answer_execute(root, &output, &config, &executable, &plan, None).unwrap();
    println!("T8 actual answers: status={}, generation={}, embedding={}; review={}",
        report["status"], report["generation_requests"], report["embedding_requests"], output.join("summary.md").display());
    assert_eq!(report["execution_constraints_met"], true);
    assert_eq!(report["status"], "completed", "inspect archived failed runs; never auto-retry");
}

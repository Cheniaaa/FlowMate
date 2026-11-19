//! 受控本机 API/组件 → 产品 Python → 真实私有 Channel → Rust 凭据。
use super::*;
use std::{io::Read, net::TcpStream};

struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); }
}

fn request(host: &RuntimeHost, method: &str, path: &str, body: Value) -> (u16, Value) {
    let address = host.connection.base_url.strip_prefix("http://").unwrap();
    let body = if method == "GET" { String::new() } else { body.to_string() };
    let mut stream = TcpStream::connect(address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(40))).unwrap();
    write!(stream, "{method} /v3{path} HTTP/1.1\r\nHost: {address}\r\nOrigin: http://127.0.0.1:5173\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        host.connection.token, body.len()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    let (headers, body) = response.split_once("\r\n\r\n").unwrap();
    let status = headers.split_whitespace().nth(1).unwrap().parse().unwrap();
    (status, serde_json::from_str(body).unwrap())
}

#[test]
fn t13_components_reach_product_api_and_real_private_credentials() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap();
    let directory = std::env::temp_dir().join("opencode").join(format!("flowmate-t13-native-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let server_dir = directory.join("server");
    std::fs::create_dir_all(&server_dir).unwrap();
    let _server = Server(Command::new(root.join(".venv/Scripts/python.exe"))
        .arg(root.join("tests/m2/mcp_auth_server.py")).arg(&server_dir)
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap());
    let ready = server_dir.join("ready.json");
    let deadline = Instant::now() + Duration::from_secs(15);
    while !ready.exists() {
        assert!(Instant::now() < deadline, "受控 MCP 服务未就绪");
        thread::sleep(Duration::from_millis(20));
    }
    let endpoint: Value = serde_json::from_slice(&std::fs::read(ready).unwrap()).unwrap();
    let binding: SecretBinding = serde_json::from_value(json!({
        "kind":"mcp", "server_id":uuid::Uuid::new_v4().to_string(), "config_revision":1,
        "transport":"http", "destination":{"command":null,"args":[],"cwd":null,"url":endpoint["url"]},
        "purpose":"http_token","env_name":null,"secret_ref":uuid::Uuid::new_v4().to_string(),
    })).unwrap();
    let wire = serde_json::to_value(&binding).unwrap();
    let store = Arc::new(crate::credentials::tests::store());
    let _cleanup = crate::credentials::tests::Cleanup(&store, wire["secret_ref"].as_str().unwrap().to_owned());
    store.save_bound(&binding, "synthetic-private-token").unwrap();
    let runtime = DevelopmentRuntime::new(root.join(".venv/Scripts/python.exe"), root.to_owned()).unwrap();
    let data = directory.join("runtime");
    let mut host = RuntimeHost::start_command(&data, &runtime.python, runtime.command(&data),
        false, true, store.clone(), Some(&runtime)).unwrap();
    let config = json!({
        "id":wire["server_id"],"revision":1,"display_name":"Native authenticated MCP",
        "scope":{"kind":"user_global","workspace_id":null,"session_id":null},
        "transport":"http","command":null,"args":[],"cwd":null,"env_refs":{},
        "url":endpoint["url"],"credential_ref":wire["secret_ref"],"enabled":true,
    });
    let save = json!({"meta":{"command_id":uuid::Uuid::new_v4().to_string(),"expected_version":null},
        "data":{"config":config,"confirmed":true}});
    assert_eq!(request(&host, "POST", "/capabilities/mcp", save.clone()).0, 200);
    assert_eq!(request(&host, "POST", "/capabilities/mcp", save).0, 200);
    let path = format!("/capabilities/mcp/{}", wire["server_id"].as_str().unwrap());
    assert_eq!(request(&host, "GET", &path, Value::Null).1["state"], "saved");
    let fixture = directory.join("ui.json");
    std::fs::write(&fixture, json!({"connection":host.connection,"config":config}).to_string()).unwrap();
    let output = Command::new("node").current_dir(root.join("apps/desktop"))
        .args(["node_modules/vitest/vitest.mjs", "run", "integration/T13NativeIntegration.test.tsx",
            "--configLoader", "runner", "--no-cache", "--maxWorkers", "1"])
        .env("FLOWMATE_T13_NATIVE_FIXTURE", &fixture).output().unwrap();
    std::fs::write(directory.join("ui-output.txt"), [&output.stdout[..], &output.stderr[..]].concat()).unwrap();
    assert!(output.status.success(), "联合组件验收失败，见 {}", directory.join("ui-output.txt").display());
    let connected = request(&host, "GET", &path, Value::Null);
    assert_eq!(connected.1["state"], "connected");
    assert_eq!(connected.1["catalog"]["tools"][0]["name"], "echo");
    // 经同一私有处理器拒绝变更绑定；不读取实际秘密。
    let mut wrong = wire.clone(); wrong["config_revision"] = json!(2);
    assert!(store.resolve_bound(&serde_json::from_value(wrong).unwrap()).is_err());
    store.clear(wire["secret_ref"].as_str().unwrap()).unwrap();
    let failed = request(&host, "POST", &format!("{path}/discover"), json!({
        "command_id":uuid::Uuid::new_v4().to_string(),"expected_version":1,
    }));
    assert_eq!(failed.0, 200);
    assert_eq!(failed.1["state"], "failed");
    assert!(!server_dir.join("calls").exists(), "管理流程不得发 tools/call");
    host.stop();
    assert!(host.child.try_wait().unwrap().unwrap().success());
    drop(host);
    let log = std::fs::read_to_string(data.join("desktop-host.jsonl")).unwrap();
    assert!(log.contains("\"graceful\":true"));
    assert!(!log.contains("synthetic-private-token"));
    let database = std::fs::read(data.join("flowmate.sqlite3")).unwrap();
    assert!(!database.windows(23).any(|slice| slice == b"synthetic-private-token"));
    std::fs::remove_file(fixture).unwrap(); // 合成 API token 不进入交付证据。
    println!("T13 real API/private/combined UI verified; evidence={}", directory.display());
}

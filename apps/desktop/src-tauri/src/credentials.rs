use serde::{Deserialize, Serialize};
use serde_json::Value;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{collections::BTreeMap, sync::Mutex};
use windows_sys::Win32::{
    Foundation::{GetLastError, LocalFree, ERROR_NOT_FOUND},
    Security::{
        Credentials::{CredFree, CredReadW, CredWriteW, CREDENTIALW,
            CRED_MAX_CREDENTIAL_BLOB_SIZE, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC},
        Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN},
    },
};

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ModelProtocol { OpenaiCompatible, OpenaiResponses, Anthropic }

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelSecretBinding {
    pub connection_id: String,
    pub connection_version: u64,
    pub protocol: ModelProtocol,
    pub endpoint: String,
    pub secret_ref: String,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct McpDestination {
    pub command: Option<String>,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub url: Option<String>,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum McpTransport { Stdio, Http }

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum McpPurpose { Env, HttpToken }

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct McpSecretBinding {
    pub server_id: String,
    pub config_revision: u64,
    pub transport: McpTransport,
    pub destination: McpDestination,
    pub purpose: McpPurpose,
    pub env_name: Option<String>,
    pub secret_ref: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SecretBinding { Model(ModelSecretBinding), Mcp(McpSecretBinding) }

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SecretStatus {
    pub secret_ref: String,
    pub configured: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedValue {
    pub format_version: u32,
    pub protected_b64: String,
}

// 同一进程的凭据读写共享完整操作边界，包含保存/清除的预读和写入。
static CREDENTIAL_ACCESS: Mutex<()> = Mutex::new(());

pub struct CredentialStore { prefix: String }
impl Default for CredentialStore {
    fn default() -> Self { Self { prefix: "FlowMate.ModelConnection.v1/".into() } }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record { binding: Value, value: Option<String> }

impl ModelSecretBinding {
    fn validate(&self) -> Result<(), &'static str> {
        if self.connection_version == 0 || uuid::Uuid::parse_str(&self.connection_id).is_err() {
            return Err("invalid_binding");
        }
        let url = url::Url::parse(&self.endpoint).map_err(|_| "invalid_binding")?;
        let authority = self.endpoint.split_once("://").map(|(_, rest)| rest.split('/').next().unwrap_or(""));
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
            || !url.username().is_empty() || url.password().is_some() || url.query().is_some()
            || url.fragment().is_some() || url.port() == Some(0)
            || self.endpoint.chars().any(char::is_whitespace) || self.endpoint.contains('\\')
            || authority.is_none_or(|value| value.contains('@')) {
            return Err("invalid_binding");
        }
        Ok(())
    }
    fn same_destination(&self, other: &Self) -> bool {
        // version 是保存审计值；同一目的地的轮换不能阻断旧 Run。
        self.connection_id == other.connection_id && self.protocol == other.protocol
            && self.endpoint == other.endpoint && self.secret_ref == other.secret_ref
    }
}

impl McpSecretBinding {
    fn validate(&self) -> Result<(), &'static str> {
        if self.config_revision == 0 || uuid::Uuid::parse_str(&self.server_id).is_err() {
            return Err("invalid_binding");
        }
        let destination = &self.destination;
        match self.transport {
            McpTransport::Http => {
                if destination.command.is_some() || !destination.args.is_empty() || destination.cwd.is_some()
                    || self.purpose != McpPurpose::HttpToken || self.env_name.is_some() {
                    return Err("invalid_binding");
                }
                // 与模型现有 URL 边界相同，但 MCP 的 revision 匹配单独严格处理。
                ModelSecretBinding { connection_id: self.server_id.clone(), connection_version: self.config_revision,
                    protocol: ModelProtocol::OpenaiCompatible, endpoint: destination.url.clone().ok_or("invalid_binding")?,
                    secret_ref: self.secret_ref.clone() }.validate()
            }
            McpTransport::Stdio => {
                if destination.command.as_ref().is_none_or(|value| value.trim().is_empty() || value.contains('\0'))
                    || destination.url.is_some() || self.purpose != McpPurpose::Env
                    || self.env_name.as_ref().is_none_or(|value| value.is_empty() || value.contains(['=', '\0']))
                    || destination.args.iter().any(|value| value.contains('\0'))
                    || destination.cwd.as_ref().is_some_and(|value| value.contains('\0')) {
                    return Err("invalid_binding");
                }
                Ok(())
            }
        }
    }
}

impl CredentialStore {
    fn target(&self, secret_ref: &str) -> Result<Vec<u16>, &'static str> {
        if secret_ref.is_empty() || secret_ref.chars().count() > 256 {
            return Err("invalid_secret_ref");
        }
        // Credential Manager 的 target 大小写不敏感；十六进制编码保留 opaque ref 的大小写身份。
        let encoded: String = secret_ref.as_bytes().iter().map(|byte| format!("{byte:02x}")).collect();
        Ok(format!("{}{encoded}", self.prefix).encode_utf16().chain(Some(0)).collect())
    }
    fn read(&self, target: &[u16]) -> Result<Option<Record>, &'static str> {
        let mut credential = std::ptr::null_mut();
        unsafe {
            if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) == 0 {
                return if GetLastError() == ERROR_NOT_FOUND { Ok(None) } else { Err("credential_read_failed") };
            }
            let allocation = CredentialAllocation(credential);
            let value = &*allocation.0;
            if value.CredentialBlobSize == 0 || value.CredentialBlobSize > CRED_MAX_CREDENTIAL_BLOB_SIZE || value.CredentialBlob.is_null() {
                return Err("credential_invalid");
            }
            let blob = std::slice::from_raw_parts(value.CredentialBlob, value.CredentialBlobSize as usize);
            let mut plaintext = dpapi(false, blob, &target_bytes(target))?;
            let result = serde_json::from_slice(&plaintext).map_err(|_| "credential_invalid");
            erase(&mut plaintext);
            result.map(Some)
        }
    }
    pub fn save(&self, binding: &ModelSecretBinding, value: &str) -> Result<SecretStatus, &'static str> {
        binding.validate()?;
        let target = self.target(&binding.secret_ref)?;
        if value.is_empty() { return Err("credential_empty"); }
        if value.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize { return Err("credential_too_large"); }
        let _guard = CREDENTIAL_ACCESS.lock().map_err(|_| "credential_unavailable")?;
        if self.read(&target)?.is_some_and(|record|
            !serde_json::from_value::<ModelSecretBinding>(record.binding)
                .is_ok_and(|stored| stored.same_destination(binding))) {
            return Err("credential_binding_mismatch");
        }
        // 模型记录保持原格式；wire 的 kind 不写入旧模型记录，不迁移或猜测数据。
        let record = Record { binding: serde_json::to_value(binding).map_err(|_| "invalid_binding")?, value: Some(value.into()) };
        self.write(&target, &record)?;
        Ok(SecretStatus { secret_ref: binding.secret_ref.clone(), configured: true })
    }
    fn write(&self, target: &[u16], record: &Record) -> Result<(), &'static str> {
        let mut plaintext = serde_json::to_vec(record).map_err(|_| "credential_invalid")?;
        let protected = dpapi(true, &plaintext, &target_bytes(target));
        erase(&mut plaintext);
        let mut protected = protected?;
        if protected.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize { return Err("credential_too_large"); }
        let credential = CREDENTIALW { Type: CRED_TYPE_GENERIC, TargetName: target.as_ptr().cast_mut(),
            CredentialBlobSize: protected.len() as u32, CredentialBlob: protected.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE, ..unsafe { std::mem::zeroed() } };
        if unsafe { CredWriteW(&credential, 0) } == 0 { return Err("credential_write_failed"); }
        Ok(())
    }
    pub fn resolve(&self, binding: &ModelSecretBinding) -> Result<String, &'static str> {
        binding.validate()?;
        let target = self.target(&binding.secret_ref)?;
        let _guard = CREDENTIAL_ACCESS.lock().map_err(|_| "credential_unavailable")?;
        let record = self.read(&target)?.ok_or("credential_missing")?;
        if !serde_json::from_value::<ModelSecretBinding>(record.binding)
            .is_ok_and(|stored| stored.same_destination(binding)) { return Err("credential_binding_mismatch"); }
        record.value.ok_or("credential_missing")
    }
    pub fn save_bound(&self, binding: &SecretBinding, value: &str) -> Result<SecretStatus, &'static str> {
        let SecretBinding::Mcp(mcp) = binding else {
            let SecretBinding::Model(model) = binding else { unreachable!() };
            return self.save(model, value);
        };
        mcp.validate()?;
        if value.is_empty() { return Err("credential_empty"); }
        if value.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize { return Err("credential_too_large"); }
        let target = self.target(&mcp.secret_ref)?;
        let expected = serde_json::to_value(binding).map_err(|_| "invalid_binding")?;
        let _guard = CREDENTIAL_ACCESS.lock().map_err(|_| "credential_unavailable")?;
        if self.read(&target)?.is_some_and(|record| record.binding != expected) {
            return Err("credential_binding_mismatch");
        }
        self.write(&target, &Record { binding: expected, value: Some(value.into()) })?;
        Ok(SecretStatus { secret_ref: mcp.secret_ref.clone(), configured: true })
    }
    pub fn resolve_bound(&self, binding: &SecretBinding) -> Result<String, &'static str> {
        match binding {
            SecretBinding::Model(model) => self.resolve(model),
            SecretBinding::Mcp(mcp) => {
                mcp.validate()?;
                let target = self.target(&mcp.secret_ref)?;
                let expected = serde_json::to_value(binding).map_err(|_| "invalid_binding")?;
                let _guard = CREDENTIAL_ACCESS.lock().map_err(|_| "credential_unavailable")?;
                let record = self.read(&target)?.ok_or("credential_missing")?;
                if record.binding != expected { return Err("credential_binding_mismatch"); }
                record.value.ok_or("credential_missing")
            }
        }
    }
    pub fn status(&self, secret_ref: &str) -> Result<SecretStatus, &'static str> {
        let target = self.target(secret_ref)?;
        let _guard = CREDENTIAL_ACCESS.lock().map_err(|_| "credential_unavailable")?;
        let record = self.read(&target)?;
        if record.as_ref().is_some_and(|record| record.binding["secret_ref"].as_str() != Some(secret_ref)) { return Err("credential_invalid"); }
        Ok(SecretStatus { secret_ref: secret_ref.into(), configured: record.is_some_and(|record| record.value.is_some()) })
    }
    pub fn clear(&self, secret_ref: &str) -> Result<SecretStatus, &'static str> {
        let target = self.target(secret_ref)?;
        let _guard = CREDENTIAL_ACCESS.lock().map_err(|_| "credential_unavailable")?;
        if let Some(mut record) = self.read(&target)? {
            if record.binding["secret_ref"].as_str() != Some(secret_ref) { return Err("credential_invalid"); }
            // 删除密钥内容但保留非秘密 binding 墓碑，重启后也不能把旧 ref 带去新 endpoint。
            if record.value.take().is_some() { self.write(&target, &record)?; }
        }
        Ok(SecretStatus { secret_ref: secret_ref.into(), configured: false })
    }
}

struct CredentialAllocation(*mut CREDENTIALW);
impl Drop for CredentialAllocation { fn drop(&mut self) { unsafe { CredFree(self.0.cast()); } } }

fn target_bytes(target: &[u16]) -> Vec<u8> { target.iter().flat_map(|unit| unit.to_le_bytes()).collect() }

fn erase(bytes: &mut [u8]) {
    for byte in bytes { unsafe { std::ptr::write_volatile(byte, 0); } }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}

fn dpapi(encrypt: bool, input: &[u8], entropy: &[u8]) -> Result<Vec<u8>, &'static str> {
    let failure = if encrypt { "private_protect_failed" } else { "private_unprotect_failed" };
    let input = CRYPT_INTEGER_BLOB { cbData: input.len().try_into().map_err(|_| failure)?, pbData: input.as_ptr().cast_mut() };
    let entropy = CRYPT_INTEGER_BLOB { cbData: entropy.len().try_into().map_err(|_| failure)?, pbData: entropy.as_ptr().cast_mut() };
    let mut output: CRYPT_INTEGER_BLOB = unsafe { std::mem::zeroed() };
    unsafe {
        let result = if encrypt {
            CryptProtectData(&input, std::ptr::null(), &entropy, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        } else {
            CryptUnprotectData(&input, std::ptr::null_mut(), &entropy, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        };
        if result == 0 { return Err(failure); }
        let bytes = if output.cbData == 0 { Vec::new() } else {
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
        };
        if !output.pbData.is_null() {
            if !encrypt { erase(std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize)); }
            LocalFree(output.pbData.cast());
        }
        Ok(bytes)
    }
}

fn canonical_context(context: &Value) -> Result<Vec<u8>, &'static str> {
    fn ordered(value: &Value) -> Value {
        match value {
            Value::Object(map) => {
                let sorted: BTreeMap<_, _> = map.iter().map(|(key, value)| (key.clone(), ordered(value))).collect();
                Value::Object(sorted.into_iter().collect())
            }
            Value::Array(values) => Value::Array(values.iter().map(ordered).collect()),
            value => value.clone(),
        }
    }
    if !context.is_object() { return Err("invalid_private_context"); }
    serde_json::to_vec(&ordered(context)).map_err(|_| "invalid_private_context")
}

pub fn protect(context: &Value, plaintext: &[u8]) -> Result<ProtectedValue, &'static str> {
    let bytes = dpapi(true, plaintext, &canonical_context(context)?)?;
    Ok(ProtectedValue { format_version: 1, protected_b64: STANDARD.encode(bytes) })
}
pub fn unprotect(context: &Value, value: &ProtectedValue) -> Result<Vec<u8>, &'static str> {
    if value.format_version != 1 { return Err("private_version_unsupported"); }
    let bytes = STANDARD.decode(&value.protected_b64).map_err(|_| "private_unprotect_failed")?;
    dpapi(false, &bytes, &canonical_context(context)?)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use super::ModelSecretBinding as SecretBinding;
    use serde_json::json;
    pub(crate) const KEY: &str = "public-test-key-not-a-secret";

    pub(crate) fn store() -> CredentialStore {
        CredentialStore { prefix: format!("FlowMate.M1.Tests.{}/{}/", std::process::id(), uuid::Uuid::new_v4()) }
    }
    pub(crate) fn binding() -> SecretBinding {
        SecretBinding { connection_id: "00000000-0000-4000-8000-000000000001".into(),
            connection_version: 1, protocol: ModelProtocol::OpenaiCompatible,
            endpoint: "https://example.invalid/v1".into(), secret_ref: "public-test-ref".into() }
    }
    pub(crate) struct Cleanup<'a>(pub(crate) &'a CredentialStore, pub(crate) String);
    impl Drop for Cleanup<'_> {
        fn drop(&mut self) {
            assert!(self.0.prefix.starts_with("FlowMate.M1.Tests."));
            let target = self.0.target(&self.1).unwrap();
            let _guard = CREDENTIAL_ACCESS.lock().unwrap();
            let removed = unsafe { windows_sys::Win32::Security::Credentials::CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
            if removed == 0 && !std::thread::panicking() { assert_eq!(unsafe { GetLastError() }, ERROR_NOT_FOUND); }
        }
    }

    #[test]
    fn connection_binding_is_shared_by_models_but_not_connections() {
        let store = store();
        // 模型不参与凭据绑定；不同模型 Run 只提交各自固定的连接修订。
        let first: SecretBinding = serde_json::from_value(json!({
            "connection_id":"00000000-0000-4000-8000-000000000001", "connection_version":1,
            "protocol":"openai_compatible", "endpoint":"https://example.invalid/v1", "secret_ref":"public-test-ref"
        })).expect("connection binding must accept the shared-connection contract");
        let _cleanup = Cleanup(&store, first.secret_ref.clone());
        store.save(&first, KEY).unwrap();
        let reopened = CredentialStore { prefix: store.prefix.clone() };
        let mut second_payload = serde_json::to_value(&first).unwrap();
        second_payload["connection_version"] = json!(2);
        let second: SecretBinding = serde_json::from_value(second_payload.clone()).unwrap();
        assert_eq!(reopened.resolve(&second).unwrap(), KEY);
        reopened.save(&second, "public-test-key-rotated").unwrap();
        assert_eq!(store.resolve(&first).unwrap(), "public-test-key-rotated");
        second_payload["connection_id"] = json!("00000000-0000-4000-8000-000000000002");
        let foreign: SecretBinding = serde_json::from_value(second_payload).unwrap();
        assert_eq!(store.resolve(&foreign).unwrap_err(), "credential_binding_mismatch");
        assert_eq!(store.save(&foreign, KEY).unwrap_err(), "credential_binding_mismatch");
    }

    #[test]
    fn destination_change_cannot_rebind_ref() {
        let store = store();
        let payload = json!({
            "connection_id":"00000000-0000-4000-8000-000000000001", "connection_version":1,
            "protocol":"openai_compatible", "endpoint":"https://example.invalid/v1", "secret_ref":"public-test-ref"
        });
        let original: SecretBinding = serde_json::from_value(payload.clone()).expect("connection binding must accept protocol");
        let _cleanup = Cleanup(&store, original.secret_ref.clone());
        store.save(&original, KEY).unwrap();
        for (field, value) in [("protocol", "anthropic"), ("endpoint", "https://another.invalid/v1")] {
            let mut changed = payload.clone(); changed[field] = json!(value);
            let changed: SecretBinding = serde_json::from_value(changed).unwrap();
            assert_eq!(store.resolve(&changed).unwrap_err(), "credential_binding_mismatch");
            assert_eq!(store.save(&changed, KEY).unwrap_err(), "credential_binding_mismatch");
            store.clear(&original.secret_ref).unwrap();
            let reopened = CredentialStore { prefix: store.prefix.clone() };
            assert_eq!(reopened.save(&changed, KEY).unwrap_err(), "credential_binding_mismatch");
            assert_eq!(reopened.resolve(&original).unwrap_err(), "credential_missing");
            reopened.save(&original, KEY).unwrap();
        }
    }

    #[test]
    fn credential_target_uses_connection_namespace_without_accessing_system_credentials() {
        let target = CredentialStore::default().target("opaque/ref").unwrap();
        assert_eq!(String::from_utf16(&target[..target.len() - 1]).unwrap(),
            "FlowMate.ModelConnection.v1/6f70617175652f726566");
    }

    #[test]
    fn real_credential_roundtrip_rotation_and_immediate_clear() {
        let store = store(); let binding = binding();
        let _cleanup = Cleanup(&store, binding.secret_ref.clone());
        assert!(!store.status(&binding.secret_ref).unwrap().configured);
        assert!(store.save(&binding, KEY).unwrap().configured);
        assert_eq!(store.resolve(&binding).unwrap(), KEY);
        let mut newer = binding.clone(); newer.connection_version = 2;
        store.save(&newer, "public-test-key-rotated").unwrap();
        assert_eq!(store.resolve(&binding).unwrap(), "public-test-key-rotated");
        assert!(!store.clear(&binding.secret_ref).unwrap().configured);
        assert_eq!(store.resolve(&binding).unwrap_err(), "credential_missing");
    }

    #[test]
    fn existing_reference_cannot_be_rebound_to_another_destination_or_connection() {
        let store = store(); let binding = binding();
        let _cleanup = Cleanup(&store, binding.secret_ref.clone());
        store.save(&binding, KEY).unwrap();
        for field in ["endpoint", "connection_id", "protocol"] {
            let mut other = binding.clone();
            if field == "endpoint" { other.endpoint = "https://other.invalid/v1".into(); }
            else if field == "connection_id" { other.connection_id = "00000000-0000-4000-8000-000000000002".into(); }
            else { other.protocol = ModelProtocol::Anthropic; }
            assert_eq!(store.resolve(&other).unwrap_err(), "credential_binding_mismatch");
            assert_eq!(store.save(&other, KEY).unwrap_err(), "credential_binding_mismatch");
        }
    }

    #[test]
    fn cleared_reference_keeps_destination_binding_across_store_restart() {
        let store = store(); let binding = binding();
        let _cleanup = Cleanup(&store, binding.secret_ref.clone());
        store.save(&binding, KEY).unwrap(); store.clear(&binding.secret_ref).unwrap();
        let reopened = CredentialStore { prefix: store.prefix.clone() };
        let mut changed = binding.clone(); changed.endpoint = "https://another.invalid/v1".into();
        assert_eq!(reopened.save(&changed, KEY).unwrap_err(), "credential_binding_mismatch");
        assert_eq!(reopened.resolve(&binding).unwrap_err(), "credential_missing");
        assert!(!reopened.status(&binding.secret_ref).unwrap().configured);
        reopened.save(&binding, KEY).unwrap();
        assert_eq!(reopened.resolve(&binding).unwrap(), KEY);
    }

    #[test]
    fn rejects_invalid_binding_and_platform_oversize_without_writing() {
        let store = store(); let binding = binding();
        let _cleanup = Cleanup(&store, binding.secret_ref.clone());
        for endpoint in ["file:///tmp/key", "https://user:pass@example.invalid", "https://example.invalid/?key=x", "https://example.invalid/#x",
            "https://example.invalid:0/v1", "https://example.invalid /v1", "https://example.invalid\\v1"] {
            let mut invalid = binding.clone(); invalid.endpoint = endpoint.into();
            assert_eq!(store.save(&invalid, KEY).unwrap_err(), "invalid_binding");
        }
        let mut invalid = binding.clone(); invalid.connection_version = 0;
        assert_eq!(store.save(&invalid, KEY).unwrap_err(), "invalid_binding");
        invalid = binding.clone(); invalid.connection_id = "not-uuid".into();
        assert_eq!(store.save(&invalid, KEY).unwrap_err(), "invalid_binding");
        assert_eq!(store.save(&binding, &"x".repeat(2561)).unwrap_err(), "credential_too_large");
        assert_eq!(store.save(&binding, &"x".repeat(2400)).unwrap_err(), "credential_too_large");
        assert!(!store.status(&binding.secret_ref).unwrap().configured);
    }

    #[test]
    fn dpapi_binds_full_context_and_canonicalizes_nested_objects() {
        let context = json!({"run_id":"run-a", "nested":{"z":1,"a":["part",2]}});
        let protected = protect(&context, b"public-private-state-marker").unwrap();
        assert_eq!(protected.format_version, 1);
        assert!(!protected.protected_b64.contains("public-private-state-marker"));
        assert_eq!(unprotect(&json!({"nested":{"a":["part",2],"z":1},"run_id":"run-a"}), &protected).unwrap(), b"public-private-state-marker");
        assert_eq!(unprotect(&json!({"run_id":"run-b","nested":{"z":1,"a":["part",2]}}), &protected).unwrap_err(), "private_unprotect_failed");
        assert!(protect(&json!([]), b"x").is_err());
        assert_eq!(unprotect(&json!({}), &protect(&json!({}), b"").unwrap()).unwrap(), b"");
    }

    #[test]
    fn opaque_secret_refs_do_not_alias_by_windows_target_case_folding() {
        let store = store(); let lower = binding(); let mut upper = lower.clone();
        upper.secret_ref = lower.secret_ref.to_uppercase();
        let _lower_cleanup = Cleanup(&store, lower.secret_ref.clone());
        let _upper_cleanup = Cleanup(&store, upper.secret_ref.clone());
        store.save(&lower, KEY).unwrap(); store.save(&upper, "public-second-key").unwrap();
        assert_eq!(store.resolve(&lower).unwrap(), KEY);
        assert_eq!(store.resolve(&upper).unwrap(), "public-second-key");
    }

    #[test]
    fn repeated_clear_reopen_and_save_preserve_last_confirmed_value() {
        let store = store(); let binding = binding();
        let _cleanup = Cleanup(&store, binding.secret_ref.clone());
        for sequence in 0..64 {
            let reopened = CredentialStore { prefix: store.prefix.clone() };
            let value = format!("public-lifecycle-value-{sequence}");
            reopened.save(&binding, &value).unwrap();
            assert_eq!(store.resolve(&binding).unwrap(), value, "save iteration {sequence}");
            store.clear(&binding.secret_ref).unwrap();
            assert_eq!(reopened.resolve(&binding).unwrap_err(), "credential_missing");
            assert!(!reopened.status(&binding.secret_ref).unwrap().configured);
            reopened.save(&binding, &value).unwrap();
            assert_eq!(store.resolve(&binding).unwrap(), value, "resave iteration {sequence}");
        }
    }

    fn mcp_binding() -> Value {
        json!({"kind":"mcp", "server_id":"00000000-0000-4000-8000-000000000002",
            "config_revision":1, "transport":"http",
            "destination":{"command":null,"args":[],"cwd":null,"url":"http://127.0.0.1:9000/mcp"},
            "purpose":"http_token","env_name":null,"secret_ref":"synthetic-mcp-ref"})
    }

    #[test]
    fn concurrent_stores_preserve_same_destination_values_and_tombstones() {
        let start = std::sync::Barrier::new(4);
        std::thread::scope(|scope| {
            for worker in 0_usize..4 {
                let start = &start;
                scope.spawn(move || {
                    let store = store();
                    let binding = if worker.is_multiple_of(2) {
                        crate::credentials::SecretBinding::Model(binding())
                    } else {
                        serde_json::from_value(mcp_binding()).unwrap()
                    };
                    let reference = match &binding {
                        crate::credentials::SecretBinding::Model(value) => value.secret_ref.clone(),
                        crate::credentials::SecretBinding::Mcp(value) => value.secret_ref.clone(),
                    };
                    let _cleanup = Cleanup(&store, reference.clone());
                    start.wait();
                    for _ in 0..16 {
                        store.save_bound(&binding, KEY).unwrap();
                        assert!(store.resolve_bound(&binding).unwrap() == KEY);
                        store.clear(&reference).unwrap();
                        let reopened = CredentialStore { prefix: store.prefix.clone() };
                        let record = {
                            let _guard = CREDENTIAL_ACCESS.lock().unwrap();
                            reopened.read(&reopened.target(&reference).unwrap())
                        }.unwrap().expect("tombstone_missing");
                        assert!(record.value.is_none(), "tombstone_has_value");
                        assert!(!reopened.status(&reference).unwrap().configured);
                        assert!(matches!(reopened.resolve_bound(&binding), Err("credential_missing")));
                    }
                });
            }
        });
    }

    #[test]
    fn mcp_binding_has_no_model_fallback_and_pins_full_revision() {
        let store = store();
        let payload = mcp_binding();
        let binding: crate::credentials::SecretBinding = serde_json::from_value(payload.clone()).unwrap();
        let _cleanup = Cleanup(&store, "synthetic-mcp-ref".into());
        store.save_bound(&binding, KEY).unwrap();
        assert_eq!(store.resolve_bound(&binding).unwrap(), KEY);
        for (field, value) in [
            ("config_revision", json!(2)), ("server_id", json!(uuid::Uuid::new_v4().to_string())),
            ("destination", json!({"command":null,"args":[],"cwd":null,"url":"http://127.0.0.1:9001/mcp"})),
        ] {
            let mut changed = payload.clone(); changed[field] = value;
            let changed: crate::credentials::SecretBinding = serde_json::from_value(changed).unwrap();
            assert_eq!(store.resolve_bound(&changed).unwrap_err(), "credential_binding_mismatch");
            assert_eq!(store.save_bound(&changed, KEY).unwrap_err(), "credential_binding_mismatch");
        }
        let model: crate::credentials::SecretBinding = serde_json::from_value(json!({
            "kind":"model", "connection_id":"00000000-0000-4000-8000-000000000001",
            "connection_version":1,"protocol":"openai_compatible",
            "endpoint":"http://127.0.0.1:9000/mcp","secret_ref":"synthetic-mcp-ref"
        })).unwrap();
        assert_eq!(store.resolve_bound(&model).unwrap_err(), "credential_binding_mismatch");
        assert_eq!(store.save_bound(&model, KEY).unwrap_err(), "credential_binding_mismatch");
        store.clear("synthetic-mcp-ref").unwrap();
        assert_eq!(store.resolve_bound(&binding).unwrap_err(), "credential_missing");
    }

    #[test]
    fn model_record_encoding_is_unchanged_and_wire_requires_explicit_kind() {
        let store = store();
        let model = binding();
        let _cleanup = Cleanup(&store, model.secret_ref.clone());
        store.save(&model, KEY).unwrap();
        let record = {
            let _guard = CREDENTIAL_ACCESS.lock().unwrap();
            store.read(&store.target(&model.secret_ref).unwrap())
        }.unwrap().unwrap();
        let stored = serde_json::to_value(record).unwrap();
        assert!(stored["binding"].get("kind").is_none());
        assert!(serde_json::from_value::<crate::credentials::SecretBinding>(stored["binding"].clone()).is_err());
    }
}

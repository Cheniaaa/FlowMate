use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, io::{BufRead, BufReader, Read, Write},
    sync::{atomic::{AtomicBool, AtomicU64, Ordering}, mpsc, Arc, Mutex}, time::{Duration, Instant}};
use tokio::sync::oneshot;

pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
pub type Handler = Arc<dyn Fn(&str, Value) -> Result<Value, &'static str> + Send + Sync>;
pub type EventHandler = Arc<dyn Fn(&str, Value) + Send + Sync>;

#[derive(Clone)]
pub struct Channel(Arc<Inner>);
struct Pending { method: String, reply: oneshot::Sender<Result<Value, String>>, deadline: Instant }
struct WriteFrame { value: Value, delivered: mpsc::Sender<()> }
struct Inner {
    writer: Mutex<Option<mpsc::SyncSender<WriteFrame>>>,
    pending: Mutex<HashMap<String, Pending>>,
    inflight: Mutex<HashSet<String>>,
    closed: AtomicBool,
    sequence: AtomicU64,
    prefix: String,
    on_close: Arc<dyn Fn() + Send + Sync>,
}
struct PendingGuard { inner: Arc<Inner>, id: String }
impl Drop for PendingGuard {
    fn drop(&mut self) { self.inner.pending.lock().unwrap().remove(&self.id); }
}

impl Inner {
    fn fail(&self, code: &str) {
        if self.closed.swap(true, Ordering::SeqCst) { return; }
        self.writer.lock().unwrap().take();
        // 不依赖 RuntimeHost 全局锁；EOF 时立即关闭 Job，所有 pending 在此后失败完成。
        (self.on_close)();
        for (_, pending) in self.pending.lock().unwrap().drain() { let _ = pending.reply.send(Err(code.into())); }
    }
    fn send(&self, mut frame: Value) -> Result<mpsc::Receiver<()>, String> {
        if self.closed.load(Ordering::SeqCst) { return Err("channel_closed".into()); }
        // 提前验证最大序号编码后的帧大小；实际序号只能在writer出队时分配。
        if frame["kind"] != "reply" { frame["stream_seq"] = json!(u64::MAX); }
        let bytes = serde_json::to_vec(&frame).map_err(|_| "invalid_frame")?;
        if bytes.len() >= MAX_FRAME_BYTES { return Err("frame_too_large".into()); }
        let (delivered, receipt) = mpsc::channel();
        let sent = self.writer.lock().unwrap().as_ref().ok_or("channel_closed")?.try_send(WriteFrame { value: frame, delivered });
        match sent {
            Ok(()) => Ok(receipt),
            Err(mpsc::TrySendError::Full(_)) => Err("channel_busy".into()),
            Err(mpsc::TrySendError::Disconnected(_)) => { self.fail("channel_closed"); Err("channel_closed".into()) }
        }
    }
    fn id(&self) -> String { format!("{}-{}", self.prefix, self.sequence.fetch_add(1, Ordering::Relaxed)) }
}

enum Frame {
    Request { id: String, seq: u64, method: String, params: Value },
    Reply { id: String, method: String, result: Result<Value, String> },
    Event { seq: u64, method: String, params: Value },
}

fn safe_code(code: &str) -> bool {
    code.as_bytes().first().is_some_and(u8::is_ascii_lowercase) && code.len() <= 96
        && code.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

struct UniqueValue(Value);
impl<'de> serde::Deserialize<'de> for UniqueValue {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = UniqueValue;
            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result { formatter.write_str("JSON without duplicate keys") }
            fn visit_map<M: serde::de::MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut value = serde_json::Map::new();
                while let Some((key, item)) = map.next_entry::<String, UniqueValue>()? {
                    if value.insert(key, item.0).is_some() { return Err(serde::de::Error::custom("duplicate_key")); }
                }
                Ok(UniqueValue(Value::Object(value)))
            }
            fn visit_seq<S: serde::de::SeqAccess<'de>>(self, mut sequence: S) -> Result<Self::Value, S::Error> {
                let mut values = Vec::new();
                while let Some(value) = sequence.next_element::<UniqueValue>()? { values.push(value.0); }
                Ok(UniqueValue(Value::Array(values)))
            }
            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Self::Value, E> { Ok(UniqueValue(Value::String(value.into()))) }
            fn visit_string<E: serde::de::Error>(self, value: String) -> Result<Self::Value, E> { Ok(UniqueValue(Value::String(value))) }
            fn visit_bool<E: serde::de::Error>(self, value: bool) -> Result<Self::Value, E> { Ok(UniqueValue(Value::Bool(value))) }
            fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Self::Value, E> { Ok(UniqueValue(Value::Number(value.into()))) }
            fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Self::Value, E> { Ok(UniqueValue(Value::Number(value.into()))) }
            fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Self::Value, E> {
                serde_json::Number::from_f64(value).map(|number| UniqueValue(Value::Number(number))).ok_or_else(|| E::custom("invalid_number"))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> { Ok(UniqueValue(Value::Null)) }
        }
        deserializer.deserialize_any(Visitor)
    }
}

fn decode(bytes: &[u8]) -> Result<Frame, &'static str> {
    if bytes.len() >= MAX_FRAME_BYTES { return Err("frame_too_large"); }
    let value = serde_json::from_slice::<UniqueValue>(bytes).map_err(|_| "invalid_frame")?.0;
    let object = value.as_object().ok_or("invalid_frame")?;
    let id = object.get("request_id").and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 128 && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'))
        .ok_or("invalid_frame")?.to_owned();
    let method = object.get("method").and_then(Value::as_str).filter(|v| !v.is_empty()).ok_or("invalid_frame")?.to_owned();
    if object.get("protocol_version").and_then(Value::as_u64) != Some(2) { return Err("invalid_frame"); }
    let kind = object.get("kind").and_then(Value::as_str).ok_or("invalid_frame")?;
    let allowed: &[&str] = match kind {
        "request" | "event" => &["protocol_version", "request_id", "stream_seq", "kind", "method", "params"],
        "reply" => &["protocol_version", "request_id", "kind", "method", "result", "error"],
        _ => return Err("invalid_frame"),
    };
    if object.keys().any(|key| !allowed.contains(&key.as_str())) { return Err("invalid_frame"); }
    match kind {
        "request" | "event" => {
            let seq = object.get("stream_seq").and_then(Value::as_u64).filter(|seq| *seq > 0).ok_or("invalid_frame")?;
            let params = object.get("params").filter(|value| value.is_object()).ok_or("invalid_frame")?.clone();
            Ok(if kind == "request" { Frame::Request { id, seq, method, params } } else { Frame::Event { seq, method, params } })
        }
        _ => {
            let result = match (object.get("result"), object.get("error")) {
                (Some(result), None) => Ok(result.clone()),
                (None, Some(error)) => {
                    let error = error.as_object().filter(|map| map.len() == 1).ok_or("invalid_frame")?;
                    let code = error.get("code").and_then(Value::as_str).filter(|code| safe_code(code)).ok_or("invalid_frame")?;
                    Err(code.into())
                }
                _ => return Err("invalid_frame"),
            };
            Ok(Frame::Reply { id, method, result })
        }
    }
}

pub(crate) fn read_frame(reader: &mut impl BufRead) -> Result<Option<Vec<u8>>, &'static str> {
    let mut bytes = Vec::new();
    loop {
        let available = reader.fill_buf().map_err(|_| "channel_closed")?;
        if available.is_empty() { return if bytes.is_empty() { Ok(None) } else { Err("incomplete_frame") }; }
        let newline = available.iter().position(|&byte| byte == b'\n');
        let count = newline.unwrap_or(available.len());
        if bytes.len() + count >= MAX_FRAME_BYTES { return Err("frame_too_large"); }
        bytes.extend_from_slice(&available[..count]);
        reader.consume(count + usize::from(newline.is_some()));
        if newline.is_some() { return Ok(Some(bytes)); }
    }
}

impl Channel {
    pub fn start(reader: impl Read + Send + 'static, mut writer: impl Write + Send + 'static,
        handler: Handler, events: EventHandler, closed: Arc<dyn Fn() + Send + Sync>) -> Self {
        let (tx, rx) = mpsc::sync_channel::<WriteFrame>(64);
        let inner = Arc::new(Inner { writer: Mutex::new(Some(tx)), pending: Mutex::new(HashMap::new()),
            inflight: Mutex::new(HashSet::new()), closed: AtomicBool::new(false),
            sequence: AtomicU64::new(0), prefix: uuid::Uuid::new_v4().to_string(), on_close: closed });
        let weak = Arc::downgrade(&inner);
        std::thread::spawn(move || {
            let mut sequence = 0u64;
            while let Ok(mut frame) = rx.recv() {
                let Some(inner) = weak.upgrade() else { break };
                if inner.closed.load(Ordering::SeqCst) { break; }
                if frame.value["kind"] == "request" {
                    let pending = inner.pending.lock().unwrap();
                    let id = frame.value["request_id"].as_str().unwrap();
                    if !pending.get(id).is_some_and(|value| !value.reply.is_closed() && Instant::now() < value.deadline) { continue; }
                }
                if frame.value["kind"] != "reply" {
                    let Some(next) = sequence.checked_add(1) else { inner.fail("sequence_exhausted"); break; };
                    sequence = next;
                    frame.value["stream_seq"] = json!(sequence);
                }
                let mut bytes = serde_json::to_vec(&frame.value).unwrap();
                bytes.push(b'\n');
                if writer.write_all(&bytes).and_then(|_| writer.flush()).is_err() { inner.fail("channel_closed"); break; }
                let _ = frame.delivered.send(());
            }
        });
        let manager = inner.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(reader);
            let mut high_water = 0;
            while !manager.closed.load(Ordering::SeqCst) {
                let frame = match read_frame(&mut reader) {
                    Ok(Some(bytes)) => match decode(&bytes) { Ok(frame) => frame, Err(code) => { manager.fail(code); break; } },
                    Ok(None) => { manager.fail("channel_closed"); break; }
                    Err(code) => { manager.fail(code); break; }
                };
                let seq = match &frame { Frame::Request { seq, .. } | Frame::Event { seq, .. } => Some(*seq), _ => None };
                if let Some(seq) = seq {
                    if seq <= high_water { manager.fail("invalid_stream_seq"); break; }
                    high_water = seq;
                }
                match frame {
                    Frame::Reply { id, method, result } => {
                        let pending = manager.pending.lock().unwrap().remove(&id);
                        if let Some(pending) = pending {
                            if pending.method != method {
                                manager.fail("invalid_reply_method");
                                let _ = pending.reply.send(Err("invalid_reply_method".into()));
                                break;
                            }
                            let _ = pending.reply.send(result);
                        } // 超时/未知 reply 只丢弃，绝不执行 request handler。
                    }
                    Frame::Event { method, params, .. } => {
                        events(&method, params);
                        if method == "shutdown" { manager.fail("channel_closed"); break; }
                    }
                    Frame::Request { id, method, params, .. } => {
                        let mut inflight = manager.inflight.lock().unwrap();
                        let duplicate = inflight.contains(&id);
                        if duplicate {
                            drop(inflight);
                            manager.fail("invalid_request_id"); break;
                        }
                        if inflight.len() >= 64 { drop(inflight); manager.fail("request_limit"); break; }
                        inflight.insert(id.clone()); drop(inflight);
                        let inner = manager.clone(); let handler = handler.clone(); let diagnostics = events.clone();
                        std::thread::spawn(move || {
                            if !inner.closed.load(Ordering::SeqCst) {
                                let result = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handler(&method, params))) {
                                    Ok(result) => result,
                                    Err(_) => {
                                        diagnostics("diagnostic", json!({"code":"host_handler_failed","request_id":id,"exception_type":"Panic","frames":[]}));
                                        Err("internal_error")
                                    }
                                };
                                let shutdown = method == "shutdown" && result.is_ok();
                                let mut frame = json!({"protocol_version":2,"request_id":id,"kind":"reply","method":method});
                                match result {
                                    Ok(value) => frame["result"] = value,
                                    Err(code) => frame["error"] = json!({"code":if safe_code(code) { code } else { "internal_error" }}),
                                }
                                match inner.send(frame) {
                                    Ok(receipt) if shutdown => {
                                        // 在 worker 等待串行 writer 的 flush，不占 reader 或 RuntimeHost 锁。
                                        let _ = receipt.recv_timeout(Duration::from_secs(2));
                                        inner.fail("channel_closed");
                                    }
                                    Ok(_) => {}
                                    Err(code) if code == "frame_too_large" => {
                                        if inner.send(json!({"protocol_version":2,"request_id":id,"kind":"reply","method":method,"error":{"code":"frame_too_large"}})).is_err() {
                                            inner.fail("channel_closed");
                                        }
                                    }
                                    Err(_) => inner.fail("channel_closed"),
                                }
                            }
                            inner.inflight.lock().unwrap().remove(&id);
                        });
                    }
                }
            }
        });
        Self(inner)
    }
    pub async fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        if method.is_empty() || !params.is_object() { return Err("invalid_frame".into()); }
        let id = self.0.id(); let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.0.pending.lock().unwrap();
            if self.is_closed() { return Err("channel_closed".into()); }
            if pending.len() >= 64 { return Err("channel_busy".into()); }
            pending.insert(id.clone(), Pending { method: method.into(), reply: tx, deadline: Instant::now() + timeout });
        }
        let _guard = PendingGuard { inner: self.0.clone(), id: id.clone() };
        self.0.send(json!({"protocol_version":2,"request_id":id,"kind":"request","method":method,"params":params}))?;
        tokio::time::timeout(timeout, rx).await.map_err(|_| "request_timeout".to_string())?
            .map_err(|_| "channel_closed".to_string())?
    }
    pub fn event(&self, method: &str, params: Value) -> Result<(), String> {
        if method.is_empty() || !params.is_object() { return Err("invalid_frame".into()); }
        self.0.send(json!({"protocol_version":2,"request_id":self.0.id(),"kind":"event","method":method,"params":params})).map(|_| ())
    }
    pub fn shutdown(&self) -> Result<(), String> {
        // 固定的停机通知仍是 request，Python 会先写 reply 再停机。
        // pending 在独立任务中校验回包，同步 stop 不会持全局 host 锁等待 RPC。
        if self.is_closed() { return Err("channel_closed".into()); }
        let channel = self.clone();
        tauri::async_runtime::spawn(async move {
            if channel.request("shutdown", json!({}), Duration::from_secs(8)).await.is_err() { channel.close(); }
        });
        Ok(())
    }
    pub fn close(&self) { self.0.fail("channel_closed"); }
    pub fn is_closed(&self) -> bool { self.0.closed.load(Ordering::SeqCst) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{io::{BufRead, BufReader}, net::{TcpListener, TcpStream}, sync::{atomic::{AtomicUsize, Ordering}, mpsc}};

    #[test]
    fn wire_rejects_duplicate_json_keys_and_counts_delimiter_in_limit() {
        assert!(decode(br#"{"protocol_version":2,"stream_seq":1,"request_id":"one","kind":"request","method":"credential.resolve","params":{"binding":{},"binding":{}}}"#).is_err());
        let mut reader = std::io::Cursor::new(vec![b'x'; MAX_FRAME_BYTES]);
        assert_eq!(read_frame(&mut reader).unwrap_err(), "frame_too_large");
    }

    #[test]
    fn wire_rejects_extra_fields_wrong_types_and_error_bodies() {
        for value in [
            json!({"protocol_version":true,"request_id":"x","kind":"request","method":"credential.resolve","params":{}}),
            json!({"protocol_version":2,"stream_seq":1,"request_id":"x","kind":"request","method":"credential.resolve","params":[],"secret":"x"}),
            json!({"protocol_version":2,"request_id":"x","kind":"reply","method":"credential.resolve","result":null,"error":{"code":"failed"}}),
            json!({"protocol_version":2,"request_id":"x","kind":"reply","method":"credential.resolve","error":{"code":"failed","message":"public-test-key-not-a-secret"}}),
        ] { assert!(decode(&serde_json::to_vec(&value).unwrap()).is_err()); }
    }

    fn pair(handler: Handler) -> (Channel, TcpStream, Arc<AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let peer = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (stream, _) = listener.accept().unwrap();
        let closes = Arc::new(AtomicUsize::new(0)); let count = closes.clone();
        let socket_on_close = stream.try_clone().unwrap();
        let channel = Channel::start(stream.try_clone().unwrap(), stream, handler,
            Arc::new(|_, _| {}), Arc::new(move || { count.fetch_add(1, Ordering::SeqCst); let _ = socket_on_close.shutdown(std::net::Shutdown::Both); }));
        peer.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        (channel, peer, closes)
    }
    fn read(peer: &mut BufReader<TcpStream>) -> Value {
        let mut line = String::new(); peer.read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap()
    }
    fn send(peer: &mut impl Write, frame: Value) { writeln!(peer, "{frame}").unwrap(); peer.flush().unwrap(); }
    fn request(id: &str, method: &str) -> Value {
        json!({"protocol_version":2,"stream_seq":1,"request_id":id,"kind":"request","method":method,"params":{}})
    }

    #[test]
    fn v2_writer_assigns_shared_sequence_to_dequeued_request_and_event() {
        let (channel, peer, _) = pair(Arc::new(|_, _| Ok(Value::Null)));
        channel.event("startup", json!({})).unwrap();
        let mut peer = BufReader::new(peer);
        let event = read(&mut peer);
        assert_eq!(event["protocol_version"], 2);
        assert_eq!(event["stream_seq"], 1);
        let task = tauri::async_runtime::spawn({ let channel = channel.clone(); async move {
            channel.request("resource.register", json!({}), Duration::from_secs(3)).await
        }});
        let request = read(&mut peer);
        assert_eq!(request["stream_seq"], 2);
        send(peer.get_mut(), json!({"protocol_version":2,"request_id":request["request_id"],"kind":"reply","method":request["method"],"result":true}));
        assert_eq!(tauri::async_runtime::block_on(task).unwrap().unwrap(), true);
        channel.close();
    }

    #[test]
    fn memory_stream_survives_65537_incoming_and_outgoing_events_with_bounded_state() {
        struct Tail(mpsc::Receiver<()>);
        impl Read for Tail {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> { let _ = self.0.recv(); Ok(0) }
        }
        struct Capture(Arc<AtomicUsize>);
        impl Write for Capture {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                let frame: Value = serde_json::from_slice(bytes).unwrap();
                let expected = self.0.fetch_add(1, Ordering::SeqCst) + 1;
                assert_eq!(frame["stream_seq"], expected as u64);
                assert_eq!(frame["protocol_version"], 2);
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        let mut input = Vec::new();
        for sequence in 1..=65537 {
            writeln!(&mut input, "{}", json!({"protocol_version":2,"stream_seq":sequence,"request_id":"reusable-event-id","kind":"event","method":"ready","params":{}})).unwrap();
        }
        let incoming = Arc::new(AtomicUsize::new(0)); let received = incoming.clone();
        let outgoing = Arc::new(AtomicUsize::new(0));
        let (complete, completed) = mpsc::channel(); let (close, closed) = mpsc::channel();
        let channel = Channel::start(std::io::Cursor::new(input).chain(Tail(closed)), Capture(outgoing.clone()),
            Arc::new(|_, _| Ok(Value::Null)), Arc::new(move |_, _| {
                if received.fetch_add(1, Ordering::SeqCst) + 1 == 65537 { complete.send(()).unwrap(); }
            }), Arc::new(move || { let _ = close.send(()); }));
        completed.recv_timeout(Duration::from_secs(10)).unwrap();
        assert!(!channel.is_closed(), "累计接收数不能关闭连接");
        for _ in 0..65537 {
            channel.0.send(json!({"protocol_version":2,"request_id":"reusable-event-id","kind":"event","method":"ready","params":{}}))
                .unwrap().recv_timeout(Duration::from_secs(3)).unwrap();
        }
        assert_eq!(incoming.load(Ordering::SeqCst), 65537);
        assert_eq!(outgoing.load(Ordering::SeqCst), 65537);
        assert!(channel.0.pending.lock().unwrap().is_empty());
        assert!(channel.0.inflight.lock().unwrap().is_empty());
        assert!(!channel.is_closed()); channel.close();
    }

    #[test]
    fn concurrent_events_are_sequenced_by_actual_writer_queue_order() {
        let (channel, peer, _) = pair(Arc::new(|_, _| Ok(Value::Null)));
        let mut tasks = Vec::new();
        for index in 0..32 {
            let channel = channel.clone();
            tasks.push(std::thread::spawn(move || channel.event("ready", json!({"index":index})).unwrap()));
        }
        for task in tasks { task.join().unwrap(); }
        let mut peer = BufReader::new(peer); let mut indices = HashSet::new();
        for sequence in 1..=32 {
            let frame = read(&mut peer);
            assert_eq!(frame["stream_seq"], sequence);
            assert!(indices.insert(frame["params"]["index"].as_u64().unwrap()));
        }
        assert_eq!(indices.len(), 32); channel.close();
    }

    #[test]
    fn duplicate_and_reverse_sequences_share_request_event_high_water() {
        for second in [1, 2] {
            let effects = Arc::new(AtomicUsize::new(0)); let seen = effects.clone();
            let (channel, mut peer, _) = pair(Arc::new(move |_, _| { seen.fetch_add(1, Ordering::SeqCst); Ok(Value::Null) }));
            send(&mut peer, json!({"protocol_version":2,"stream_seq":2,"request_id":"first","kind":"event","method":"ready","params":{}}));
            let mut next = request("second", "private.protect"); next["stream_seq"] = json!(second);
            send(&mut peer, next);
            let mut byte = [0]; assert_eq!(peer.read(&mut byte).unwrap(), 0);
            assert!(channel.is_closed()); assert_eq!(effects.load(Ordering::SeqCst), 0);
        }
    }

    #[test]
    fn fresh_connection_resets_both_sequence_directions() {
        for _ in 0..2 {
            let (channel, peer, _) = pair(Arc::new(|_, _| Ok(json!(true))));
            channel.event("startup", json!({})).unwrap();
            let mut peer = BufReader::new(peer);
            assert_eq!(read(&mut peer)["stream_seq"], 1);
            send(peer.get_mut(), request("first", "private.protect"));
            let reply = read(&mut peer);
            assert_eq!(reply["result"], true);
            assert!(reply.get("stream_seq").is_none()); channel.close();
        }
    }

    #[test]
    fn in_flight_inbound_id_cannot_repeat_even_with_a_new_sequence() {
        let effects = Arc::new(AtomicUsize::new(0)); let counter = effects.clone();
        let (entered, started) = mpsc::channel(); let (release, wait) = mpsc::channel();
        let wait = Mutex::new(wait);
        let (channel, mut peer, _) = pair(Arc::new(move |_, _| {
            counter.fetch_add(1, Ordering::SeqCst); entered.send(()).unwrap(); wait.lock().unwrap().recv().unwrap(); Ok(Value::Null)
        }));
        send(&mut peer, request("same", "private.protect"));
        started.recv_timeout(Duration::from_secs(3)).unwrap();
        let mut second = request("same", "private.protect"); second["stream_seq"] = json!(2); send(&mut peer, second);
        let mut byte = [0]; assert_eq!(peer.read(&mut byte).unwrap(), 0);
        assert!(channel.is_closed()); assert_eq!(effects.load(Ordering::SeqCst), 1); release.send(()).unwrap();
    }

    #[test]
    fn cancelled_and_expired_queued_requests_are_skipped_without_sequence_gaps() {
        struct Gate { entered: Option<mpsc::Sender<()>>, release: mpsc::Receiver<()>, output: mpsc::Sender<Value> }
        impl Write for Gate {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                if let Some(entered) = self.entered.take() { entered.send(()).unwrap(); self.release.recv().unwrap(); }
                self.output.send(serde_json::from_slice(bytes).unwrap()).unwrap();
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let _peer = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (reader, _) = listener.accept().unwrap(); let close_reader = reader.try_clone().unwrap();
        let (entered, started) = mpsc::channel(); let (release, blocked) = mpsc::channel(); let (output, frames) = mpsc::channel();
        let channel = Channel::start(reader, Gate { entered: Some(entered), release: blocked, output },
            Arc::new(|_, _| Ok(Value::Null)), Arc::new(|_, _| {}), Arc::new(move || { let _ = close_reader.shutdown(std::net::Shutdown::Both); }));
        channel.event("startup", json!({})).unwrap(); started.recv_timeout(Duration::from_secs(3)).unwrap();
        tauri::async_runtime::block_on(async {
            // 只poll一次入队，再drop尚未发送的future，触发PendingGuard。
            let mut cancelled = Box::pin(channel.request("cancelled", json!({}), Duration::from_secs(3)));
            std::future::poll_fn(|context| {
                assert!(std::future::Future::poll(cancelled.as_mut(), context).is_pending());
                std::task::Poll::Ready(())
            }).await;
        });
        assert_eq!(tauri::async_runtime::block_on(channel.request("expired", json!({}), Duration::from_millis(10))).unwrap_err(), "request_timeout");
        channel.event("ready", json!({})).unwrap(); release.send(()).unwrap();
        let first = frames.recv_timeout(Duration::from_secs(3)).unwrap(); let last = frames.recv_timeout(Duration::from_secs(3)).unwrap();
        assert_eq!(first["method"], "startup"); assert_eq!(first["stream_seq"], 1);
        assert_eq!(last["method"], "ready"); assert_eq!(last["stream_seq"], 2);
        assert!(channel.0.pending.lock().unwrap().is_empty()); channel.close();
    }

    #[test]
    fn wire_requires_positive_sequences_and_forbids_v1_or_reply_sequences() {
        for sequence in [json!(0), json!(-1), json!(true), json!(1.5), Value::Null, json!("1")] {
            let mut frame = request("invalid", "private.protect"); frame["stream_seq"] = sequence;
            assert!(decode(&serde_json::to_vec(&frame).unwrap()).is_err());
        }
        let mut old = request("old", "private.protect"); old["protocol_version"] = json!(1);
        assert!(decode(&serde_json::to_vec(&old).unwrap()).is_err());
        assert!(decode(br#"{"protocol_version":2,"request_id":"missing","kind":"event","method":"ready","params":{}}"#).is_err());
        assert!(decode(br#"{"protocol_version":2,"stream_seq":1,"request_id":"reply","kind":"reply","method":"private.protect","result":null}"#).is_err());
    }

    #[test]
    fn interleaved_replies_keep_identity_while_inbound_request_is_serviced() {
        let (channel, peer, _) = pair(Arc::new(|method, _| Ok(json!({"handled":method}))));
        assert!(channel.event("startup", json!({})).is_ok());
        let worker = std::thread::spawn(move || {
            let mut peer = BufReader::new(peer);
            assert_eq!(read(&mut peer)["kind"], "event");
            let a = read(&mut peer); let b = read(&mut peer);
            send(peer.get_mut(), request("python-1", "private.protect"));
            assert_eq!(read(&mut peer)["result"]["handled"], "private.protect");
            for frame in [b, a] {
                send(peer.get_mut(), json!({"protocol_version":2,"request_id":frame["request_id"],"kind":"reply","method":frame["method"],"result":frame["method"]}));
            }
        });
        tauri::async_runtime::block_on(async {
            let a = tauri::async_runtime::spawn({ let channel = channel.clone(); async move { channel.request("resource.first", json!({}), Duration::from_secs(3)).await } });
            let b = tauri::async_runtime::spawn({ let channel = channel.clone(); async move { channel.request("resource.second", json!({}), Duration::from_secs(3)).await } });
            assert_eq!(a.await.unwrap().unwrap(), "resource.first");
            assert_eq!(b.await.unwrap().unwrap(), "resource.second");
        });
        worker.join().unwrap();
    }

    #[test]
    fn duplicate_inbound_request_does_not_repeat_side_effect() {
        let effects = Arc::new(AtomicUsize::new(0)); let counter = effects.clone();
        let (channel, peer, _) = pair(Arc::new(move |_, _| { counter.fetch_add(1, Ordering::SeqCst); Ok(Value::Null) }));
        assert!(channel.event("startup", json!({})).is_ok());
        let mut peer = BufReader::new(peer); read(&mut peer);
        send(peer.get_mut(), request("same", "credential.resolve"));
        assert!(read(&mut peer).get("result").is_some());
        send(peer.get_mut(), request("same", "credential.resolve"));
        let mut line = String::new();
        assert_eq!(peer.read_line(&mut line).unwrap(), 0);
        assert!(channel.is_closed());
        assert_eq!(effects.load(Ordering::SeqCst), 1);
        channel.close();
    }

    #[test]
    fn eof_completes_pending_and_invokes_tree_close_once() {
        let (channel, peer, closes) = pair(Arc::new(|_, _| Ok(Value::Null)));
        assert!(channel.event("startup", json!({})).is_ok());
        let worker = std::thread::spawn(move || { let mut peer = BufReader::new(peer); read(&mut peer); read(&mut peer); });
        let result = tauri::async_runtime::block_on(channel.request("resource.register", json!({}), Duration::from_secs(3)));
        assert_eq!(result.unwrap_err(), "channel_closed");
        worker.join().unwrap(); channel.close();
        assert!(channel.is_closed()); assert_eq!(closes.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn mismatched_reply_fails_closed_and_unknown_reply_cannot_execute() {
        let effects = Arc::new(AtomicUsize::new(0)); let counter = effects.clone();
        let (channel, peer, _) = pair(Arc::new(move |_, _| { counter.fetch_add(1, Ordering::SeqCst); Ok(Value::Null) }));
        assert!(channel.event("startup", json!({})).is_ok());
        let worker = std::thread::spawn(move || {
            let mut peer = BufReader::new(peer); read(&mut peer); let pending = read(&mut peer);
            send(peer.get_mut(), json!({"protocol_version":2,"request_id":"unknown","kind":"reply","method":"credential.resolve","result":"ignored"}));
            send(peer.get_mut(), json!({"protocol_version":2,"request_id":pending["request_id"],"kind":"reply","method":"wrong","result":null}));
        });
        assert_eq!(tauri::async_runtime::block_on(channel.request("resource.register", json!({}), Duration::from_secs(3))).unwrap_err(), "invalid_reply_method");
        worker.join().unwrap(); assert_eq!(effects.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn timeout_late_reply_is_ignored_and_next_request_succeeds() {
        let (channel, peer, _) = pair(Arc::new(|_, _| Ok(Value::Null)));
        assert!(channel.event("startup", json!({})).is_ok());
        let (release, wait) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let mut peer = BufReader::new(peer); read(&mut peer); let old = read(&mut peer);
            wait.recv().unwrap();
            send(peer.get_mut(), json!({"protocol_version":2,"request_id":old["request_id"],"kind":"reply","method":old["method"],"result":"late"}));
            let next = read(&mut peer);
            send(peer.get_mut(), json!({"protocol_version":2,"request_id":next["request_id"],"kind":"reply","method":next["method"],"result":"next"}));
        });
        tauri::async_runtime::block_on(async {
            assert_eq!(channel.request("first", json!({}), Duration::from_millis(50)).await.unwrap_err(), "request_timeout");
            release.send(()).unwrap();
            assert_eq!(channel.request("next", json!({}), Duration::from_secs(3)).await.unwrap(), "next");
        });
        worker.join().unwrap(); channel.close();
    }

    #[test]
    fn inbound_shutdown_reply_is_written_before_pending_fail_and_disconnect() {
        let (channel, peer, _) = pair(Arc::new(|_, _| Ok(json!({"stopping":true}))));
        channel.event("startup", json!({})).unwrap();
        let mut peer = BufReader::new(peer); read(&mut peer);
        send(peer.get_mut(), request("stop-1", "shutdown"));
        assert_eq!(read(&mut peer)["result"], json!({"stopping":true}));
        assert_eq!(tauri::async_runtime::block_on(channel.request("resource.register", json!({}), Duration::from_secs(1))).unwrap_err(), "channel_closed");
    }

    #[test]
    fn oversize_private_result_returns_only_safe_error_without_dropping_channel() {
        let (channel, peer, _) = pair(Arc::new(|_, _| Ok(json!("x".repeat(MAX_FRAME_BYTES)))));
        channel.event("startup", json!({})).unwrap();
        let mut peer = BufReader::new(peer); read(&mut peer);
        send(peer.get_mut(), request("oversize", "private.protect"));
        let mut line = String::new(); peer.read_line(&mut line).unwrap();
        assert!(!line.is_empty(), "oversize results must return an explicit bounded error");
        let reply: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(reply, json!({"protocol_version":2,"request_id":"oversize","kind":"reply","method":"private.protect","error":{"code":"frame_too_large"}}));
        assert!(!channel.is_closed()); channel.close();
    }

    #[test]
    fn saturated_writer_fails_fast_and_close_does_not_wait_for_writer() {
        struct Gate { entered: Option<mpsc::Sender<()>>, release: mpsc::Receiver<()> }
        impl Write for Gate {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                if let Some(entered) = self.entered.take() { entered.send(()).unwrap(); self.release.recv().unwrap(); }
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let _peer = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (reader, _) = listener.accept().unwrap(); let close_reader = reader.try_clone().unwrap();
        let (entered, started) = mpsc::channel(); let (release, blocked) = mpsc::channel();
        let channel = Channel::start(reader, Gate { entered: Some(entered), release: blocked }, Arc::new(|_, _| Ok(Value::Null)),
            Arc::new(|_, _| {}), Arc::new(move || { let _ = release.send(()); let _ = close_reader.shutdown(std::net::Shutdown::Both); }));
        channel.event("startup", json!({})).unwrap(); started.recv_timeout(Duration::from_secs(3)).unwrap();
        for _ in 0..64 { channel.event("ready", json!({})).unwrap(); }
        assert_eq!(channel.event("ready", json!({})).unwrap_err(), "channel_busy");
        assert_eq!(tauri::async_runtime::block_on(channel.request("resource.register", json!({}), Duration::from_secs(3))).unwrap_err(), "channel_busy");
        channel.close();
        assert_eq!(tauri::async_runtime::block_on(channel.request("resource.register", json!({}), Duration::from_secs(3))).unwrap_err(), "channel_closed");
    }

    #[test]
    fn shutdown_notification_still_checks_corresponding_reply_method() {
        let (channel, peer, _) = pair(Arc::new(|_, _| Ok(Value::Null)));
        channel.shutdown().unwrap();
        let worker = std::thread::spawn(move || {
            let mut peer = BufReader::new(peer); let shutdown = read(&mut peer); let other = read(&mut peer);
            let shutdown = if shutdown["method"] == "shutdown" { shutdown } else { other };
            send(peer.get_mut(), json!({"protocol_version":2,"request_id":shutdown["request_id"],"kind":"reply","method":"wrong","result":null}));
            // 维持连接，证明失败由错误 method 而不是 EOF 触发。
            let mut line = String::new(); let _ = peer.read_line(&mut line);
        });
        let error = tauri::async_runtime::block_on(channel.request("resource.register", json!({}), Duration::from_secs(1))).unwrap_err();
        assert_eq!(error, "invalid_reply_method");
        assert!(channel.is_closed()); worker.join().unwrap();
    }
}

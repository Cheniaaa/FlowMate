"""单reader/串行writer的双向请求通道。"""

import asyncio
import inspect
from contextlib import suppress

from pydantic import ValidationError

from flowmate.contracts.base import DomainError, identifier
from flowmate.host.diagnostics import SafeDiagnostic, make_diagnostic, write_diagnostic
from flowmate.host.protocol import HostError, HostEvent, HostReply, decode_frame, encode_frame


class HostChannel:
    def __init__(self, reader, writer, *, handlers=None, events=None, on_disconnect=None,
                 timeout_seconds=30, max_frame_bytes=16 * 1024 * 1024):
        self.reader = reader
        self.writer = writer
        self.handlers = dict(handlers or {})
        self.events = dict(events or {})
        self.on_disconnect = on_disconnect
        self.timeout_seconds = timeout_seconds
        self.max_frame_bytes = max_frame_bytes
        if timeout_seconds <= 0 or max_frame_bytes < 1:
            raise ValueError("通道超时和帧上限必须为正数")
        self._pending = {}
        self._inflight = set()
        self._send_seq = 0
        self._receive_seq = 0
        self._queue = asyncio.Queue(maxsize=64)
        self._writes = set()
        self._workers = set()
        self._reader_task = None
        self._writer_task = None
        self._closed = asyncio.Event()
        self._reason = None

    async def start(self):
        if self._closed.is_set():
            raise DomainError("host_disconnected", "宿主通道已经关闭")
        if self._reader_task is None:
            self._reader_task = asyncio.create_task(self._read())
            self._writer_task = asyncio.create_task(self._write())

    async def _send(self, frame):
        if self._reader_task is None or self._closed.is_set():
            raise DomainError("host_disconnected", "宿主通道不可用")
        encode_frame(frame, self.max_frame_bytes)
        delivered = asyncio.get_running_loop().create_future()
        self._writes.add(delivered)
        try:
            try:
                self._queue.put_nowait((frame, delivered))
            except asyncio.QueueFull:
                raise DomainError("host_busy", "宿主写队列已满") from None
            await delivered
        finally:
            self._writes.discard(delivered)
            if not delivered.done():
                delivered.cancel()
            elif not delivered.cancelled():
                delivered.exception()

    async def _write(self):
        try:
            while True:
                frame, delivered = await self._queue.get()
                if delivered.done():
                    continue
                sequenced = not isinstance(frame, HostReply)
                if sequenced:
                    if self._send_seq == 2**64 - 1:
                        raise DomainError("host_sequence_exhausted", "宿主通道序号耗尽")
                    frame = frame.model_copy(update={"stream_seq": self._send_seq + 1})
                try:
                    data = encode_frame(frame, self.max_frame_bytes)
                except DomainError as error:
                    delivered.set_exception(error)
                    continue
                if sequenced:
                    self._send_seq += 1
                self.writer.write(data)
                await self.writer.drain()
                if not delivered.done():
                    delivered.set_result(None)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            write_diagnostic(make_diagnostic("host_write_failed", error))
            await self._terminate("host_disconnected", notify=True)

    async def _read(self):
        try:
            while data := await self.reader.readline():
                frame = decode_frame(data, self.max_frame_bytes)
                if isinstance(frame, HostReply):
                    pending = self._pending.get(frame.request_id)
                    if pending is None:
                        continue
                    method, future = pending
                    if method != frame.method:
                        raise DomainError("host_reply_mismatch", "宿主回包方法不一致")
                    if not future.done():
                        future.set_result(frame)
                else:
                    if frame.stream_seq <= self._receive_seq:
                        raise DomainError("host_sequence_invalid", "宿主消息序号重复或逆序")
                    self._receive_seq = frame.stream_seq
                    if not isinstance(frame, HostEvent) and frame.request_id in self._inflight:
                        raise DomainError("host_request_reused", "宿主请求身份重复")
                    if len(self._workers) >= 64:
                        raise DomainError("host_busy", "宿主在途处理已满")
                    if not isinstance(frame, HostEvent):
                        self._inflight.add(frame.request_id)
                    worker = asyncio.create_task(self._handle(frame))
                    self._workers.add(worker)
                    worker.add_done_callback(self._workers.discard)
            await self._terminate("host_disconnected", notify=True)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            code = error.code if isinstance(error, DomainError) else "host_frame_invalid"
            write_diagnostic(make_diagnostic("host_read_failed", error))
            await self._terminate(code, notify=True)

    async def _handle(self, frame):
        try:
            await self._dispatch(frame)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            write_diagnostic(make_diagnostic("host_dispatch_failed", error, request_id=frame.request_id))
            await self._terminate("host_handler_failed", notify=True)
        finally:
            if not isinstance(frame, HostEvent):
                self._inflight.discard(frame.request_id)

    async def _dispatch(self, frame):
        event = isinstance(frame, HostEvent)
        handler = (self.events if event else self.handlers).get(frame.method)
        try:
            if handler is None:
                raise DomainError("host_method_unsupported", "宿主方法未装配")
            result = handler(frame.params)
            if inspect.isawaitable(result):
                result = await result
            if event:
                return
            reply = HostReply(request_id=frame.request_id, method=frame.method, result=result)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            code = error.code if isinstance(error, DomainError) else "host_handler_failed"
            if not isinstance(error, DomainError):
                await self.diagnostic(make_diagnostic(code, error, request_id=frame.request_id))
            if event:
                await self._terminate("host_event_failed", notify=True)
                return
            try:
                safe_error = HostError(code=code)
            except ValidationError:
                safe_error = HostError(code="host_handler_failed")
            reply = HostReply(request_id=frame.request_id, method=frame.method, error=safe_error)
        try:
            await self._send(reply)
            if frame.method == "shutdown" and reply.error is None:
                await self._terminate("host_shutdown", notify=True)
        except DomainError:
            await self._terminate("host_disconnected", notify=True)

    async def request(self, request, *, timeout_seconds=None):
        if self._closed.is_set() or self._reader_task is None:
            raise DomainError("host_disconnected", "宿主通道不可用")
        if request.request_id in self._pending:
            raise DomainError("host_request_reused", "宿主请求身份仍在使用")
        if len(self._pending) >= 64:
            raise DomainError("host_busy", "宿主在途请求已满")
        future = asyncio.get_running_loop().create_future()
        self._pending[request.request_id] = (request.method, future)
        try:
            timeout = self.timeout_seconds if timeout_seconds is None else timeout_seconds
            async with asyncio.timeout(timeout):
                await self._send(request)
                return await future
        except TimeoutError:
            raise DomainError("host_timeout", "等待宿主响应超时") from None
        finally:
            self._pending.pop(request.request_id, None)
            if not future.done():
                future.cancel()
            elif not future.cancelled():
                future.exception()

    async def event(self, event):
        await self._send(event)

    async def diagnostic(self, diagnostic: SafeDiagnostic):
        try:
            await self.event(HostEvent(request_id=identifier(), method="diagnostic", params=diagnostic.model_dump(mode="json")))
        except DomainError:
            # 诊断仍须保留；只处理通道边界失败，不吞调用者的未知程序错误。
            write_diagnostic(diagnostic)

    async def _terminate(self, code, *, notify=False):
        if self._closed.is_set():
            return
        self._reason = code
        self._closed.set()
        for _, future in self._pending.values():
            if not future.done():
                future.set_exception(DomainError(code, "宿主通道关闭，操作未获确认"))
        for future in self._writes:
            if not future.done():
                future.set_exception(DomainError(code, "宿主通道写入关闭"))
        current = asyncio.current_task()
        for task in [self._reader_task, self._writer_task, *self._workers]:
            if task is not None and task is not current:
                task.cancel()
        self.writer.close()
        if notify and self.on_disconnect is not None:
            try:
                result = self.on_disconnect()
                if inspect.isawaitable(result):
                    await result
            except Exception as error:
                write_diagnostic(make_diagnostic("host_shutdown_failed", error))
                self._reason = "host_shutdown_failed"

    async def close(self):
        tasks = [task for task in [self._reader_task, self._writer_task, *self._workers]
                 if task is not None and task is not asyncio.current_task()]
        await self._terminate("host_disconnected")
        await asyncio.gather(*tasks, return_exceptions=True)
        with suppress(OSError, DomainError):
            await self.writer.wait_closed()

    async def wait_closed(self):
        await self._closed.wait()

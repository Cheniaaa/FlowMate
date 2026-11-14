"""Windows匿名管道适配；不让阻塞stdin占用asyncio线程池或解释器缓冲锁。"""

import asyncio
import os
import queue
import sys
import threading

from flowmate.contracts.base import DomainError


class _Reader:
    def __init__(self, loop, fd, max_frame_bytes):
        self.loop = loop
        self.fd = fd
        self.limit = max_frame_bytes
        self.queue = asyncio.Queue(maxsize=8)
        self.stopped = threading.Event()
        self.delivery = None
        threading.Thread(target=self._run, name="host-stdin", daemon=True).start()

    def _deliver(self, value):
        if self.stopped.is_set():
            return False
        coroutine = self.queue.put(value)
        try:
            self.delivery = asyncio.run_coroutine_threadsafe(coroutine, self.loop)
        except RuntimeError:
            coroutine.close()
            return False
        try:
            self.delivery.result()
            return not self.stopped.is_set()
        except Exception:
            return False

    def _run(self):
        buffer = bytearray()
        try:
            while not self.stopped.is_set():
                chunk = os.read(self.fd, min(65536, self.limit + 1))
                if not chunk:
                    self._deliver(DomainError("host_frame_invalid") if buffer else b"")
                    return
                buffer.extend(chunk)
                while (end := buffer.find(b"\n")) != -1:
                    if end + 1 > self.limit:
                        self._deliver(DomainError("host_frame_too_large"))
                        return
                    line = bytes(buffer[:end + 1])
                    del buffer[:end + 1]
                    if not self._deliver(line):
                        return
                if len(buffer) > self.limit:
                    self._deliver(DomainError("host_frame_too_large"))
                    return
        except OSError:
            self._deliver(b"")

    async def readline(self):
        item = await self.queue.get()
        if isinstance(item, Exception):
            raise item
        return item

    def close(self):
        self.stopped.set()
        if self.delivery is not None:
            self.delivery.cancel()
        # 宿主关闭管道产生EOF；若本地shutdown先到，raw os.read线程为daemon，
        # 不等待持有阻塞I/O的线程，也不碰sys.stdin的BufferedReader锁。


class _Writer:
    def __init__(self, loop, fd, reader):
        self.loop = loop
        self.fd = fd
        self.reader = reader
        self.queue = queue.Queue(maxsize=1)
        self.pending = None
        self.closed = False
        threading.Thread(target=self._run, name="host-stdout", daemon=True).start()

    @staticmethod
    def _complete(future, error):
        if not future.done():
            if error is None:
                future.set_result(None)
            else:
                future.set_exception(DomainError("host_disconnected", "宿主写管道关闭"))

    def _run(self):
        while True:
            item = self.queue.get()
            if item is None or self.closed:
                return
            data, future = item
            error = None
            try:
                view = memoryview(data)
                while view:
                    count = os.write(self.fd, view)
                    if count <= 0:
                        raise OSError("pipe closed")
                    view = view[count:]
            except OSError as caught:
                error = caught
            try:
                self.loop.call_soon_threadsafe(self._complete, future, error)
            except RuntimeError:
                return

    def write(self, data):
        if self.closed or (self.pending is not None and not self.pending.done()):
            raise DomainError("host_disconnected", "宿主串行写管道不可用")
        self.pending = self.loop.create_future()
        self.queue.put_nowait((data, self.pending))

    async def drain(self):
        if self.pending is not None:
            await self.pending

    def close(self):
        self.closed = True
        self.reader.close()
        if self.pending is not None and not self.pending.done():
            self.pending.cancel()
        try:
            self.queue.put_nowait(None)
        except queue.Full:
            pass

    async def wait_closed(self):
        # 线程只承载原生管道I/O；不保活Runtime，不拥有应用任务。
        return None


def open_stdio(*, max_frame_bytes=16 * 1024 * 1024):
    loop = asyncio.get_running_loop()
    reader = _Reader(loop, sys.stdin.fileno(), max_frame_bytes)
    return reader, _Writer(loop, sys.stdout.fileno(), reader)

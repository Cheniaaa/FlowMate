"""有界异步进程入口；不持有 Store，不解释或构造脚本。"""

import asyncio
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime

from flowmate.processes.contracts import (
    DEFAULT_MAX_PROCESSES,
    ProcessResult,
    ProcessSpec,
)

_start_authorization = ContextVar("process_start_authorization", default=None)


class ProcessRunner:
    def __init__(self, max_processes: int = DEFAULT_MAX_PROCESSES):
        self._slots = asyncio.Semaphore(max_processes)

    @staticmethod
    @contextmanager
    def authorize_start(check):
        """调用者提供同步围栏；槽位等待结束后、创建进程前消费最新事实。"""
        token = _start_authorization.set(check)
        try:
            yield
        finally:
            _start_authorization.reset(token)

    async def run(self, spec: ProcessSpec, cancel: asyncio.Event) -> ProcessResult:
        aborted = asyncio.Event()
        execution = asyncio.create_task(self._run(spec, cancel, aborted))
        try:
            return await asyncio.shield(execution)
        except asyncio.CancelledError:
            aborted.set()
            # 调用协程取消也必须等清理完成；重复 cancel 不能中断清理。
            while not execution.done():
                try:
                    await asyncio.shield(execution)
                except asyncio.CancelledError:
                    continue
            execution.result()
            raise

    async def _run(
        self, spec: ProcessSpec, cancel: asyncio.Event, aborted: asyncio.Event,
    ) -> ProcessResult:
        started_at = datetime.now(UTC)
        loop = asyncio.get_running_loop()
        deadline = loop.time() + (spec.deadline - started_at).total_seconds()
        requested_cancel = asyncio.create_task(cancel.wait())
        caller_cancel = asyncio.create_task(aborted.wait())
        slot = asyncio.create_task(self._slots.acquire())
        process = None
        exit_code = None
        reason = "exited"
        try:
            await asyncio.wait(
                {slot, requested_cancel, caller_cancel},
                timeout=max(0, deadline - loop.time()),
                return_when=asyncio.FIRST_COMPLETED,
            )
            if cancel.is_set() or aborted.is_set():
                reason = "cancelled"
            elif loop.time() >= deadline:
                reason = "timed_out"
            else:
                # Windows 能力缺失直接失败，不为非 Windows 或缺绑定提供降级后端。
                from flowmate.processes.windows import POLL_INTERVAL_SECONDS, WindowsProcess

                check = _start_authorization.get()
                if check is not None:
                    check(spec)
                process = WindowsProcess(spec)
                while True:
                    progress = process.drain()
                    exit_code = process.exit_code()
                    if exit_code is not None:
                        break
                    if cancel.is_set() or aborted.is_set():
                        reason = "cancelled"
                        break
                    if loop.time() >= deadline:
                        reason = "timed_out"
                        break
                    await asyncio.sleep(0 if progress else POLL_INTERVAL_SECONDS)
        finally:
            try:
                if process is not None:
                    try:
                        await process.finish()
                        if exit_code is None:
                            exit_code = process.exit_code()
                    finally:
                        process.close()
            finally:
                for task in (slot, requested_cancel, caller_cancel):
                    task.cancel()
                await asyncio.gather(slot, requested_cancel, caller_cancel, return_exceptions=True)
                if not slot.cancelled() and slot.result():
                    self._slots.release()
        return ProcessResult(
            exit_code=exit_code,
            termination_reason=reason,
            stdout=bytes(process.stdout.data) if process else b"",
            stderr=bytes(process.stderr.data) if process else b"",
            truncated=(process.stdout.truncated or process.stderr.truncated) if process else False,
            started_at=started_at,
            finished_at=datetime.now(UTC),
            process_identity=process.identity if process else None,
        )

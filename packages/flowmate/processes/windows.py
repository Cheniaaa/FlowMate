"""pywin32 公开 API 适配；不包含 shell 或业务任务逻辑。"""

import asyncio
import subprocess
import threading
from contextlib import ExitStack
from datetime import UTC

import pywintypes
import win32api
import win32con
import win32event
import win32file
import win32job
import win32pipe
import win32process
import winerror

from flowmate.processes.contracts import ProcessIdentity, ProcessSpec

POLL_INTERVAL_SECONDS = 0.01
PIPE_READ_SIZE = 64 * 1024

# pywin32 312 不支持 STARTUPINFOEX；所有本模块启动共享继承窗口。
# 其他采用 bInheritHandles=True 的宿主启动点也必须持有此锁。
PROCESS_CREATION_LOCK = threading.Lock()


class _PipeCapture:
    def __init__(self, handle, limit: int):
        self.handle = handle
        self.limit = limit
        self.data = bytearray()
        self.truncated = False
        self.eof = False

    def drain(self) -> bool:
        if self.eof:
            return False
        try:
            _, available, _ = win32pipe.PeekNamedPipe(self.handle, 0)
            if not available:
                return False
            _, chunk = win32file.ReadFile(self.handle, min(available, PIPE_READ_SIZE))
        except pywintypes.error as error:
            if error.winerror != winerror.ERROR_BROKEN_PIPE:
                raise
            self.eof = True
            return False
        remaining = self.limit - len(self.data)
        self.data.extend(chunk[:remaining])
        self.truncated |= len(chunk) > remaining
        return True


class WindowsProcess:
    """拥有一次执行的 Job、根进程及父端管道；创建时保持同步原子区间。"""

    def __init__(self, spec: ProcessSpec):
        self._handles = ExitStack()
        try:
            # 此绑定用空字符串创建匿名 Job；None 名称会被 pywin32 312 拒绝。
            self.job = win32job.CreateJobObject(None, "")
            self._handles.callback(self.job.Close)
            limits = win32job.QueryInformationJobObject(
                self.job, win32job.JobObjectExtendedLimitInformation,
            )
            limits["BasicLimitInformation"]["LimitFlags"] = (
                win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            )
            win32job.SetInformationJobObject(
                self.job, win32job.JobObjectExtendedLimitInformation, limits,
            )
            with ExitStack() as child_handles:
                stdin_read, stdin_write = win32pipe.CreatePipe(None, 0)
                child_handles.callback(stdin_read.Close)
                # 写端在创建前关闭，子进程一开始即读到 EOF。
                stdin_write.Close()
                stdout_read, stdout_write = win32pipe.CreatePipe(None, 0)
                self._handles.callback(stdout_read.Close)
                child_handles.callback(stdout_write.Close)
                stderr_read, stderr_write = win32pipe.CreatePipe(None, 0)
                self._handles.callback(stderr_read.Close)
                child_handles.callback(stderr_write.Close)
                self.stdout = _PipeCapture(stdout_read, spec.stdout_limit)
                self.stderr = _PipeCapture(stderr_read, spec.stderr_limit)
                startup = win32process.STARTUPINFO()
                startup.dwFlags = win32con.STARTF_USESTDHANDLES
                startup.hStdInput = stdin_read
                startup.hStdOutput = stdout_write
                startup.hStdError = stderr_write
                with PROCESS_CREATION_LOCK:
                    try:
                        for handle in (stdin_read, stdout_write, stderr_write):
                            win32api.SetHandleInformation(
                                handle, win32con.HANDLE_FLAG_INHERIT,
                                win32con.HANDLE_FLAG_INHERIT,
                            )
                        process, thread, pid, _ = win32process.CreateProcess(
                            spec.environment.executable_path,
                            subprocess.list2cmdline([
                                spec.environment.executable_path, *spec.argv,
                            ]),
                            None, None, True,
                            win32process.CREATE_SUSPENDED | win32process.CREATE_NO_WINDOW,
                            dict(spec.environment.env),
                            spec.cwd,
                            startup,
                        )
                    finally:
                        # 在下一次创建前关闭所有可继承副本，杜绝并行 attempt 互持管道。
                        child_handles.close()
                self.process = process
                self._handles.callback(process.Close)
                try:
                    win32job.AssignProcessToJobObject(self.job, process)
                    self.identity = ProcessIdentity(
                        pid=pid,
                        created_at=win32process.GetProcessTimes(process)["CreationTime"].astimezone(
                            UTC,
                        ),
                    )
                    win32process.ResumeThread(thread)
                except BaseException:
                    # 根仍在暂停状态，归属失败不能执行任何脚本代码。
                    win32process.TerminateProcess(process, 1)
                    win32event.WaitForSingleObject(process, win32event.INFINITE)
                    raise
                finally:
                    thread.Close()
        except BaseException:
            self._handles.close()
            raise

    def drain(self) -> bool:
        stdout_progress = self.stdout.drain()
        stderr_progress = self.stderr.drain()
        return stdout_progress or stderr_progress

    def exit_code(self) -> int | None:
        if win32event.WaitForSingleObject(self.process, 0) == win32event.WAIT_OBJECT_0:
            return win32process.GetExitCodeProcess(self.process)
        return None

    async def finish(self) -> None:
        """先终止全部成员，再等真实终止与管道 EOF；超量数据继续排空。"""
        win32job.TerminateJobObject(self.job, 1)
        while win32job.QueryInformationJobObject(
            self.job, win32job.JobObjectBasicAccountingInformation,
        )["ActiveProcesses"]:
            self.drain()
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
        while not (self.stdout.eof and self.stderr.eof):
            progress = self.drain()
            await asyncio.sleep(0 if progress else POLL_INTERVAL_SECONDS)

    def close(self) -> None:
        self._handles.close()

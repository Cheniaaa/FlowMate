"""只提取可定位的异常元数据，不读取正文、locals或文件绝对路径。"""

import sys

from pydantic import Field

from flowmate.contracts.base import Contract


class DiagnosticFrame(Contract):
    module: str = Field(min_length=1, max_length=256, pattern=r"^[A-Za-z_][A-Za-z0-9_.]*$")
    function: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z_<>][A-Za-z0-9_<>]*$")
    line: int = Field(ge=1, le=2**31 - 1)


class SafeDiagnostic(Contract):
    code: str = Field(min_length=1, max_length=96, pattern=r"^[a-z][a-z0-9_]*$")
    request_id: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    exception_type: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    frames: list[DiagnosticFrame] = Field(default_factory=list, max_length=16)


def make_diagnostic(code: str, error: BaseException | None = None, *, request_id: str | None = None) -> SafeDiagnostic:
    frames = []
    traceback = error.__traceback__ if error is not None else None
    while traceback is not None:
        frame = traceback.tb_frame
        frames.append(DiagnosticFrame(module=frame.f_globals["__name__"],
            function=frame.f_code.co_name, line=traceback.tb_lineno))
        if len(frames) > 16:
            del frames[0]
        traceback = traceback.tb_next
    return SafeDiagnostic(code=code, request_id=request_id,
        exception_type=type(error).__name__ if error is not None else None, frames=frames)


def write_diagnostic(diagnostic: SafeDiagnostic) -> None:
    """仅用于通道不可用或尚未建立时；Rust按同一严格Schema读取stderr。"""
    sys.stderr.write(diagnostic.model_dump_json() + "\n")
    sys.stderr.flush()

"""FlowMate产品命令入口；stdout仅用于私有宿主协议。"""

import argparse
import asyncio
from pathlib import Path

from flowmate import __version__


class _ArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        from flowmate.contracts.base import DomainError

        # argparse默认错误会回显参数；路径和控制输入不进入诊断日志。
        raise DomainError("runtime_arguments_invalid", "命令行参数无效")


def main() -> None:
    try:
        parser = _ArgumentParser(prog="flowmate")
        parser.add_argument("--version", action="version", version=__version__)
        commands = parser.add_subparsers(dest="command")
        runtime = commands.add_parser("runtime")
        runtime.add_argument("--data-dir", type=Path, required=True)
        args = parser.parse_args()
        if args.command is None:
            parser.print_help()
            return
        from flowmate.bootstrap import serve_runtime

        asyncio.run(serve_runtime(args.data_dir))
    except Exception as error:
        from flowmate.contracts.base import DomainError, identifier
        from flowmate.host.diagnostics import make_diagnostic, write_diagnostic

        safe_codes = {"runtime_arguments_invalid", "startup_invalid", "startup_timeout",
            "startup_data_dir_mismatch", "already_running", "host_disconnected",
            "http_startup_failed", "shutdown_timeout", "blocked_incompatible"}
        code = error.code if isinstance(error, DomainError) and error.code in safe_codes else "internal_error"
        write_diagnostic(make_diagnostic(code, error, request_id=identifier()))
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()

"""唯一产品Runtime的可信装配；控制输入只来自私有宿主管道。"""

import asyncio
import os
import socket
from collections.abc import Mapping
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Literal
from urllib.parse import urlsplit

from pydantic import Field, ValidationError, field_validator

from flowmate import __version__
from flowmate.agents.checkpoint import register_control_tools
from flowmate.agents.executor import AgentExecutor
from flowmate.artifacts.store import ArtifactStore
from flowmate.config import RuntimeConfig
from flowmate.context.builder import ContextBuilder
from flowmate.contracts.base import Contract, DomainError, identifier
from flowmate.host.channel import HostChannel
from flowmate.host.diagnostics import make_diagnostic
from flowmate.host.notifications import publish_notifications
from flowmate.host.protocol import HostEvent
from flowmate.host.resources import HostResources
from flowmate.host.secrets import HostSecrets
from flowmate.host.skills import SkillHost
from flowmate.host.stdio import open_stdio
from flowmate.memory.maintenance import MemoryMaintenance, register_maintenance_tools
from flowmate.memory.provider import SQLiteMemoryProvider
from flowmate.memory.service import MemoryService
from flowmate.memory.tools import register_memory_tools
from flowmate.models.direct import ModelGateway
from flowmate.models.private_state import SDK_VERSION, PrivateStateCodec
from flowmate.persistence.store import Store
from flowmate.plugins.host import PluginHost, PluginManifest, SlotSpec
from flowmate.policy.approvals import ApprovalService
from flowmate.policy.lifecycle import ScopeLifecycle
from flowmate.policy.service import PolicyService
from flowmate.processes.environments import EnvironmentService
from flowmate.processes.runner import ProcessRunner
from flowmate.runtime.scheduler import Scheduler
from flowmate.runtime.service import RunService, RuntimeCatalog
from flowmate.runtime.transitions import utc_now
from flowmate.settings import SettingsService
from flowmate.skills.execution.service import SkillExecutionService
from flowmate.skills.execution.tools import register_script_tool
from flowmate.skills.export_publication import SkillExports
from flowmate.skills.native_files import NativeSkillFiles
from flowmate.skills.service import SkillService
from flowmate.skills.tools import register_skill_tools
from flowmate.tools.builtin import register_builtin_tools
from flowmate.tools.catalog import ToolCatalog
from flowmate.tools.files import NativeTextFiles
from flowmate.tools.gateway import ToolExecutor, ToolGateway

if TYPE_CHECKING:
    from flowmate.api.streams import EventStream
    from flowmate.integrations.configuration import McpConfiguration
    from flowmate.integrations.tools import McpTools
    from flowmate.runtime.tasks import TaskService


# WHATWG Fetch §2.9（含Chromium的受限端口），loopback同样受限：
# https://fetch.spec.whatwg.org/#port-blocking
_FETCH_BLOCKED_PORTS = frozenset({
    0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
    101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
    389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601,
    636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000,
    6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
})


@contextmanager
def _instance_lock(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    # OS锁随进程退出释放；保留文件，避免unlink让并发进程锁住不同inode。
    with (directory / "runtime.lock").open("a+b") as lock:
        if lock.seek(0, 2) == 0:
            lock.write(b"\0")
            lock.flush()
        lock.seek(0)
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise DomainError("already_running", "此数据目录已有Runtime") from None
        try:
            yield
        finally:
            lock.seek(0)
            if os.name == "nt":
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock, fcntl.LOCK_UN)


@dataclass
class _Provider:
    """无后台资源的内置服务适配现有插件生命周期；服务通过依赖表和slot实际消费。"""

    service: object

    async def start(self):
        pass

    async def drain(self):
        pass

    async def stop(self):
        pass

    async def dispose(self):
        pass


class _AgentProvider(_Provider):
    def __init__(self, agent, scheduler, catalog):
        super().__init__(agent)
        self.scheduler = scheduler
        self.catalog = catalog

    async def start(self):
        agent, scheduler = self.service, self.scheduler
        scheduler.executors["builtin.agent"] = agent
        scheduler.executors["builtin.tool"] = agent.tools

        async def drive_tool(ctx, activity, cancel, before_send):
            driver = agent.tools.drive if scheduler.task(ctx.task_id).kind == "tool" else agent.drive_tool
            return await driver(ctx, activity, cancel, before_send)

        scheduler.register_driver("model", agent.drive_model)
        scheduler.register_driver("tool", drive_tool)
        scheduler.configure_context(agent.compaction)
        await scheduler.start(catalog=self.catalog)

    async def drain(self):
        # 回执/恢复依赖其他provider及Store，Host逆序先排空Agent的调度工作。
        await self.scheduler.stop()


@dataclass
class Runtime:
    store: Store
    settings: SettingsService
    service: RunService
    policy: PolicyService
    lifecycle: ScopeLifecycle
    approvals: ApprovalService
    artifacts: ArtifactStore
    catalog: ToolCatalog
    scheduler: Scheduler
    tasks: "TaskService"
    plugins: PluginHost
    config: RuntimeConfig
    streams: "EventStream"
    host_resources: HostResources
    skills: SkillService
    skill_host: SkillHost
    environments: EnvironmentService
    script_execution: SkillExecutionService
    memory: MemoryService
    maintenance: MemoryMaintenance
    mcp: "McpConfiguration" = field(init=False)
    mcp_tools: "McpTools" = field(init=False)
    _resources: ExitStack = field(repr=False)
    _lifecycle: asyncio.Lock = field(default_factory=asyncio.Lock, init=False, repr=False)
    _started: bool = field(default=False, init=False, repr=False)
    _closed: bool = field(default=False, init=False, repr=False)

    @property
    def agent(self) -> AgentExecutor:
        return self.plugins.resolve("agent_executor").service

    @property
    def delivery(self):
        return self.scheduler.delivery

    async def start(self) -> None:
        async with self._lifecycle:
            if self._closed:
                raise DomainError("runtime_closed", "已停止的Runtime不能重新启动")
            if self._started:
                return
            await asyncio.to_thread(self.lifecycle.collect_content)
            await self.plugins.start()
            self._started = True

    async def stop(self) -> None:
        async with self._lifecycle:
            if self._closed:
                return
            try:
                # 回执/恢复仍需要Store，必须先停止并排空所有调度任务。
                await self.plugins.stop()
            finally:
                self._closed = True
                self._resources.close()


def build_runtime(
    data_dir: Path, host: HostChannel, *, overrides: Mapping[str, object] | None = None,
) -> Runtime:
    """先获得目录独占权再打开Store；不启动或接管调用方的HostChannel。"""
    selected = dict(overrides) if overrides is not None else {}
    if (selected.keys() - {"model", "config", "clock", "context"}
            or ("config" in selected and not isinstance(selected["config"], RuntimeConfig))
            or ("clock" in selected and not callable(selected["clock"]))
            or ("model" in selected and not callable(getattr(selected["model"], "stream", None)))
            or ("context" in selected and not callable(getattr(selected["context"], "build", None)))):
        raise DomainError("runtime_override_invalid", "Runtime测试装配选项无效")
    config = selected.get("config", RuntimeConfig())
    clock = selected.get("clock", utc_now)
    directory = Path(data_dir).resolve()
    with ExitStack() as resources:
        resources.enter_context(_instance_lock(directory))
        store = Store.open(directory)
        resources.callback(store.close)
        settings = SettingsService(store)
        settings.default_agent()
        settings.default_workspace()
        policy = PolicyService(store, clock=clock)
        approvals = ApprovalService(store, clock=clock, ttl_seconds=config.approval_ttl_seconds)
        files = NativeTextFiles(config.max_file_bytes, config.allowed_text_extensions,
            max_read_chars=config.max_read_chars, max_batch_files=config.max_batch_files,
            max_page_size=config.max_page_size)
        artifacts = ArtifactStore(store, policy, files, config=config)
        memory = MemoryService(store, SQLiteMemoryProvider(store), policy, artifacts=artifacts, clock=clock)
        skills = SkillService(store)
        environments = EnvironmentService(store, ProcessRunner())
        scheduler = Scheduler(store, {}, config, clock=clock)
        script_execution = SkillExecutionService(skills, environments, policy, files, artifacts, scheduler)
        skill_files = NativeSkillFiles()
        skill_exports = SkillExports(skill_files, store.path.parent / "skill-export-recovery")
        lifecycle = ScopeLifecycle(store, policy, artifacts, skill_exports=skill_exports)
        resources.callback(lifecycle.collect_content)
        catalog = ToolCatalog()
        register_builtin_tools(catalog, policy, files, artifacts, config)
        register_control_tools(catalog)
        register_memory_tools(catalog, memory)
        register_skill_tools(catalog, skills)
        register_script_tool(catalog, script_execution)
        secrets = HostSecrets(host)
        codec = PrivateStateCodec(store, secrets, policy)
        scheduler.configure_tools(policy, artifacts)
        scheduler.configure_models(codec)
        scheduler.configure_tasks(catalog)
        # API模块延迟导入，--version和无效私有启动不依赖HTTP装配。
        from flowmate.api.streams import EventStream

        streams = EventStream(store)
        resources.callback(streams.close)
        plugins = PluginHost()
        plugins.register(PluginManifest(plugin_id="builtin.memory", version=__version__,
            provides=(SlotSpec(name="memory_provider", exclusive=True),)),
            lambda config, dependencies: _Provider(memory.provider))
        plugins.register(PluginManifest(plugin_id="builtin.tools", version=__version__,
            provides=(SlotSpec(name="tool_executor", exclusive=True),)),
            lambda config, dependencies: _Provider(ToolExecutor(ToolGateway(catalog, policy, approvals, scheduler))))
        plugins.register(PluginManifest(plugin_id="builtin.model", version=f"{__version__}+sdk.{SDK_VERSION}",
            provides=(SlotSpec(name="model_gateway", exclusive=True),)),
            lambda config, dependencies: _Provider(selected["model"] if "model" in selected else
                ModelGateway(policy, secrets, private_state=codec, clock=clock, catalog=catalog)))
        plugins.register(PluginManifest(plugin_id="builtin.context", version=__version__,
            provides=(SlotSpec(name="context_builder", exclusive=True),), requires=("builtin.tools", "builtin.model", "builtin.memory")),
            lambda config, dependencies: _Provider(selected["context"] if "context" in selected else ContextBuilder(store, policy,
                estimate=dependencies["builtin.model"].service.estimate, memory=memory, maintenance=maintenance,
                artifacts=artifacts, skills=skills)))
        plugins.register(PluginManifest(plugin_id="builtin.agent", version=__version__,
            provides=(SlotSpec(name="agent_executor", exclusive=True),),
            requires=("builtin.tools", "builtin.model", "builtin.context")),
            lambda config, dependencies: _AgentProvider(AgentExecutor(store, catalog,
                dependencies["builtin.model"].service, dependencies["builtin.tools"].service,
                policy=policy, artifacts=artifacts,
                context=dependencies["builtin.context"].service, clock=clock, emit_delta=streams.publish,
                emit_reasoning_delta=streams.publish_reasoning, maintenance=maintenance),
                scheduler, service.catalog.snapshot()))
        service = RunService(store, RuntimeCatalog(tools=catalog.snapshot(), plugins=plugins.snapshot(),
            agent_executor_id="builtin.agent", tool_catalog=catalog), clock=clock, policy=policy)
        maintenance = MemoryMaintenance(store, memory, policy, service, clock=clock)
        register_maintenance_tools(catalog, maintenance)
        service.catalog.tools = catalog.snapshot()
        scheduler.configure_maintenance(maintenance)
        scheduler.configure_followups(service)
        skill_host = SkillHost(skills, policy, skill_files, skill_exports, config)
        runtime = Runtime(store=store, settings=settings, service=service, policy=policy, lifecycle=lifecycle,
            approvals=approvals, artifacts=artifacts, catalog=catalog, scheduler=scheduler,
            plugins=plugins, config=config, streams=streams, tasks=scheduler.tasks,
            host_resources=HostResources(policy, files, config), skills=skills, skill_host=skill_host,
            environments=environments, script_execution=script_execution,
            memory=memory, maintenance=maintenance,
            _resources=resources.pop_all())
        from flowmate.integrations.bootstrap import register_mcp

        register_mcp(runtime, host, limits=config.mcp_limits)
        return runtime


class _Startup(Contract):
    token: str = Field(min_length=16, max_length=256, repr=False)
    data_dir: str = Field(min_length=1)
    allowed_origins: list[str]
    # M0诊断入口不能在产品Runtime中启用。
    desktop_diagnostics: Literal[False] = False

    @field_validator("allowed_origins")
    @classmethod
    def exact_origins(cls, values):
        for value in values:
            parsed = urlsplit(value)
            if (parsed.scheme not in {"http", "https", "tauri"} or not parsed.hostname
                    or parsed.path or parsed.query or parsed.fragment or parsed.username is not None
                    or parsed.password is not None or "*" in value
                    or "\\" in value or any(char.isspace() for char in value)):
                raise ValueError("exact origin required")
            parsed.port
        return values


async def _serve_http(runtime, host, startup, disconnected):
    import uvicorn

    from flowmate.api.app import create_app
    from flowmate.api.auth import ConnectionPolicy

    ready = asyncio.Event()

    class ControlledServer(uvicorn.Server):
        async def startup(self, sockets=None):
            try:
                await super().startup(sockets=sockets)
            except SystemExit:
                raise DomainError("http_startup_failed", "HTTP服务未就绪") from None
            if self.started:
                ready.set()

    with ExitStack() as rejected, ExitStack() as selected:
        # 留住被拒socket，避免OS重复分配；尝试次数由受限端口数量限定。
        for _ in range(len(_FETCH_BLOCKED_PORTS) + 1):
            bound = selected.enter_context(socket.socket(socket.AF_INET, socket.SOCK_STREAM))
            bound.bind(("127.0.0.1", 0))
            port = bound.getsockname()[1]
            if port not in _FETCH_BLOCKED_PORTS:
                break
            rejected.enter_context(selected.pop_all())
        else:
            raise DomainError("http_startup_failed", "未分配到浏览器可用的HTTP端口")
        # 选中socket由selected持有；HTTP装配前释放所有被拒端口。
        rejected.close()
        app = create_app(runtime, ConnectionPolicy(token=startup.token,
            allowed_origins=startup.allowed_origins, bound_host=f"127.0.0.1:{port}"), host=host)
        server = ControlledServer(uvicorn.Config(app, host="127.0.0.1", port=0,
            access_log=False, proxy_headers=False, server_header=False, lifespan="on",
            timeout_graceful_shutdown=3, timeout_keep_alive=1,
            log_config={"version": 1, "disable_existing_loggers": False,
                "handlers": {"null": {"class": "logging.NullHandler"}},
                "loggers": {name: {"handlers": ["null"], "level": "CRITICAL", "propagate": False}
                    for name in ("uvicorn", "uvicorn.error", "uvicorn.access")}}))
        bound.listen(128)
        bound.setblocking(False)
        # 端口0分配的同一socket一直持有并交给Uvicorn，绝不按port重绑。
        serving = asyncio.create_task(server.serve(sockets=[bound]))
        listening = asyncio.create_task(ready.wait())
        closing = asyncio.create_task(disconnected.wait())
        scheduler_failed = asyncio.create_task(runtime.scheduler.wait_failed())
        notifying = None
        try:
            done, _ = await asyncio.wait({serving, listening, closing, scheduler_failed}, timeout=10,
                                          return_when=asyncio.FIRST_COMPLETED)
            if scheduler_failed in done:
                scheduler_failed.result()
            if closing in done:
                raise DomainError("host_disconnected", "HTTP就绪前宿主已退出")
            if serving in done:
                serving.result()
            if listening not in done or not server.started:
                raise DomainError("http_startup_failed", "HTTP服务未就绪")
            await host.event(HostEvent(request_id=identifier(), method="ready", params={
                "pid": os.getpid(), "port": port, "runtime_version": __version__,
            }))
            notifying = asyncio.create_task(publish_notifications(runtime.store, host))
            done, _ = await asyncio.wait({serving, closing, notifying, scheduler_failed},
                                         return_when=asyncio.FIRST_COMPLETED)
            if scheduler_failed in done:
                scheduler_failed.result()
            if notifying in done and closing not in done:
                notifying.result()
            if serving in done:
                serving.result()
        finally:
            if notifying is not None:
                notifying.cancel()
                await asyncio.gather(notifying, return_exceptions=True)
            server.should_exit = True
            try:
                await asyncio.wait_for(asyncio.shield(serving), 5)
            except TimeoutError:
                serving.cancel()
                await asyncio.gather(serving, return_exceptions=True)
                raise DomainError("shutdown_timeout", "HTTP服务未及时停止") from None
            finally:
                listening.cancel()
                closing.cancel()
                scheduler_failed.cancel()
                await asyncio.gather(listening, closing, scheduler_failed, return_exceptions=True)


async def serve_runtime(data_dir: Path) -> None:
    """CLI唯一私有控制入口；先等startup，失败时不创建产品数据目录。"""
    loop = asyncio.get_running_loop()
    startup_future = loop.create_future()
    disconnected = asyncio.Event()

    def accept_startup(params):
        if startup_future.done():
            raise DomainError("startup_invalid", "startup不可重复")
        try:
            startup_future.set_result(_Startup.model_validate(params))
        except ValidationError:
            startup_future.set_exception(DomainError("startup_invalid", "私有启动参数无效"))

    reader, writer = open_stdio()
    host = HostChannel(reader, writer, events={"startup": accept_startup},
        handlers={"shutdown": lambda _: {}}, on_disconnect=disconnected.set)
    runtime = None
    closing = asyncio.create_task(disconnected.wait())
    try:
        await host.start()
        done, _ = await asyncio.wait({startup_future, closing}, timeout=10,
                                     return_when=asyncio.FIRST_COMPLETED)
        if startup_future not in done:
            code = "host_disconnected" if closing in done else "startup_timeout"
            raise DomainError(code, "未收到有效的私有启动事件")
        startup = startup_future.result()
        if disconnected.is_set():
            raise DomainError("host_disconnected", "宿主已退出")
        directory = Path(data_dir).resolve()
        if directory != Path(startup.data_dir).resolve():
            raise DomainError("startup_data_dir_mismatch", "私有启动与命令行目录不一致")
        runtime = build_runtime(directory, host)
        host.handlers["resource.register"] = runtime.host_resources.register
        host.handlers["skills.register"] = runtime.skill_host.register
        host.handlers["workspace.create_from_directory"] = runtime.host_resources.create_workspace_from_directory
        host.handlers["workspace.directory_command_status"] = runtime.host_resources.directory_command_status
        await runtime.start()
        await _serve_http(runtime, host, startup, disconnected)
    except Exception as error:
        if not isinstance(error, DomainError):
            await host.diagnostic(make_diagnostic("runtime_failed", error, request_id=identifier()))
        raise
    finally:
        closing.cancel()
        if not startup_future.done():
            startup_future.cancel()
        elif not startup_future.cancelled():
            startup_future.exception()
        try:
            if runtime is not None:
                await runtime.stop()
        finally:
            await host.close()
            await asyncio.gather(closing, return_exceptions=True)

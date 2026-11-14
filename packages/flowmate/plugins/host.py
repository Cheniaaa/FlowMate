"""可信插件注册及生命周期；不提供代码发现或安全沙箱。"""

import asyncio
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from graphlib import CycleError, TopologicalSorter
from types import MappingProxyType
from typing import Protocol

from pydantic import BaseModel, Field, JsonValue

from flowmate.contracts.base import Contract, DomainError, Name


class SlotSpec(Contract):
    name: Name
    exclusive: bool = False


class PluginManifest(Contract):
    plugin_id: Name
    version: Name
    api_version: int = Field(default=1, ge=1, strict=True)
    config_schema: dict[str, JsonValue] = Field(default_factory=dict)
    provides: tuple[SlotSpec, ...] = ()
    requires: tuple[Name, ...] = ()
    resources: tuple[Name, ...] = ()
    capabilities: tuple[Name, ...] = ()


class Plugin(Protocol):
    """插件拥有自身监听器/后台任务；dispose释放它们，不递归调用Host生命周期。"""

    async def start(self) -> None: ...

    async def drain(self) -> None: ...

    async def stop(self) -> None: ...

    async def dispose(self) -> None: ...


class PluginFactory(Protocol):
    """同步创建；失败返回前由factory自行清理，长耗时初始化放在start。"""

    def __call__(
        self, config: BaseModel | None, dependencies: Mapping[str, Plugin],
    ) -> Plugin: ...


@dataclass(frozen=True)
class _Registration:
    manifest: PluginManifest
    factory: PluginFactory
    config_model: type[BaseModel] | None
    config: dict[str, JsonValue]


class PluginHost:
    """单次启动的可信装配；不替换活跃版本，不承担Run状态或权限检查。"""

    def __init__(self) -> None:
        self._registrations: dict[str, _Registration] = {}
        self._instances: dict[str, Plugin] = {}
        self._state = "new"
        self._drained = False
        self._lifecycle_lock = asyncio.Lock()

    def register(
        self, manifest: PluginManifest, factory: PluginFactory, *,
        config_model: type[BaseModel] | None = None,
        config: Mapping[str, JsonValue] | None = None,
    ) -> None:
        """显式注册；非空Schema/配置必须配同一BaseModel生成的Schema与校验器。"""
        if self._state != "new":
            raise DomainError("plugin_registry_frozen")
        if manifest.plugin_id in self._registrations:
            raise DomainError("plugin_duplicate", related_ids=(manifest.plugin_id,))
        self._registrations[manifest.plugin_id] = _Registration(
            manifest.model_copy(deep=True), factory, config_model,
            deepcopy(dict(config)) if config is not None else {},
        )

    async def start(self) -> None:
        async with self._lifecycle_lock:
            if self._state == "running":
                return
            if self._state != "new":
                raise DomainError("plugin_host_closed")
            order, configs = self._preflight()
            self._state = "starting"
            for plugin_id in order:
                registration = self._registrations[plugin_id]
                dependencies = MappingProxyType({
                    required: self._instances[required]
                    for required in registration.manifest.requires
                })
                try:
                    instance = registration.factory(configs[plugin_id], dependencies)
                    # start可能只完成一部分；先登记对象，异常时仍须释放。
                    self._instances[plugin_id] = instance
                    await instance.start()
                except BaseException as error:
                    failures = [(plugin_id, error), *await self._shutdown()]
                    self._raise_failures("plugin_start_failed", failures)
            self._state = "running"

    async def drain(self) -> None:
        """停止新resolve；逆序排空全部插件，单个失败不能中断其余插件。"""
        async with self._lifecycle_lock:
            if self._state in ("drained", "stopped"):
                return
            if self._state != "running":
                raise DomainError("plugin_host_not_running")
            self._state = "draining"
            failures = await self._release_phase("drain")
            self._drained = True
            self._state = "drained"
            self._raise_failures("plugin_drain_failed", failures)

    async def stop(self) -> None:
        """隐含drain，再逆序stop/dispose；所有回调最多尝试一次。"""
        async with self._lifecycle_lock:
            if self._state == "stopped":
                return
            failures = await self._shutdown()
            self._raise_failures("plugin_stop_failed", failures)

    def resolve(self, slot: str, plugin_id: str | None = None) -> Plugin:
        """一个插件的所有slot返回同一生命周期对象；多提供者必须显式选择。"""
        if self._state != "running":
            raise DomainError("plugin_host_not_running")
        providers = [
            identity for identity, registration in self._registrations.items()
            if any(provided.name == slot for provided in registration.manifest.provides)
        ]
        if plugin_id is not None:
            providers = [identity for identity in providers if identity == plugin_id]
        if not providers:
            raise DomainError("plugin_slot_missing")
        if len(providers) > 1:
            raise DomainError("plugin_slot_ambiguous", related_ids=tuple(providers))
        return self._instances[providers[0]]

    def snapshot(self) -> dict[str, str]:
        """只返回已注册插件版本副本，不混入Profile/工具等其他配置。"""
        return {
            plugin_id: registration.manifest.version
            for plugin_id, registration in self._registrations.items()
        }

    def _preflight(self) -> tuple[tuple[str, ...], dict[str, BaseModel | None]]:
        graph = {}
        slots: dict[str, list[tuple[str, SlotSpec]]] = {}
        configs = {}
        for plugin_id, registration in self._registrations.items():
            manifest = registration.manifest
            if manifest.api_version != 1:
                raise DomainError("plugin_api_unsupported", related_ids=(plugin_id,))
            for required in manifest.requires:
                if required not in self._registrations:
                    raise DomainError("plugin_dependency_missing", related_ids=(plugin_id, required))
            graph[plugin_id] = manifest.requires
            for provided in manifest.provides:
                slots.setdefault(provided.name, []).append((plugin_id, provided))
            configs[plugin_id] = self._validate_config(registration)
        for providers in slots.values():
            if len(providers) > 1 and any(slot.exclusive for _, slot in providers):
                raise DomainError(
                    "plugin_slot_conflict", related_ids=tuple(identity for identity, _ in providers),
                )
        try:
            order = tuple(TopologicalSorter(graph).static_order())
        except CycleError as error:
            raise DomainError(
                "plugin_dependency_cycle", related_ids=tuple(dict.fromkeys(error.args[1])),
            ) from None
        return order, configs

    @staticmethod
    def _validate_config(registration: _Registration) -> BaseModel | None:
        manifest = registration.manifest
        model = registration.config_model
        if model is None:
            if manifest.config_schema or registration.config:
                raise DomainError("plugin_config_model_required", related_ids=(manifest.plugin_id,))
            return None
        try:
            schema = model.model_json_schema()
        except Exception:
            raise DomainError("plugin_config_invalid", related_ids=(manifest.plugin_id,)) from None
        if manifest.config_schema != schema:
            raise DomainError("plugin_config_schema_mismatch", related_ids=(manifest.plugin_id,))
        try:
            return model.model_validate(registration.config, strict=True, extra="forbid")
        except Exception:
            # 不传播Pydantic或自定义校验器的输入/异常正文。
            raise DomainError("plugin_config_invalid", related_ids=(manifest.plugin_id,)) from None

    async def _release_phase(self, phase: str) -> list[tuple[str, BaseException]]:
        failures = []
        for plugin_id, instance in reversed(self._instances.items()):
            try:
                await getattr(instance, phase)()
            except BaseException as error:
                # CancelledError同样不能跳过其他资源，完成全部释放尝试后再传播。
                failures.append((plugin_id, error))
        return failures

    async def _shutdown(self) -> list[tuple[str, BaseException]]:
        self._state = "stopping"
        failures = []
        if not self._drained:
            failures.extend(await self._release_phase("drain"))
            self._drained = True
        failures.extend(await self._release_phase("stop"))
        failures.extend(await self._release_phase("dispose"))
        self._instances.clear()
        self._state = "stopped"
        return failures

    @staticmethod
    def _raise_failures(code: str, failures: list[tuple[str, BaseException]]) -> None:
        for _, error in failures:
            if not isinstance(error, Exception):
                raise error
        if failures:
            raise DomainError(code, related_ids=tuple(dict.fromkeys(identity for identity, _ in failures)))

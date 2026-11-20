"""管理操作对 T12 manager 的接线；保存先排空，发现才连接。"""

import asyncio
from copy import deepcopy

from flowmate.contracts.base import DomainError
from flowmate.integrations.configuration import connection_identity
from flowmate.integrations.mcp import McpManager


class McpManagedConnections:
    def __init__(self, *, current, credentials, limits):
        self.current = current
        self.credentials = credentials
        self.limits = limits
        self._connections = {}
        self._configs = {}
        self._identities = {}
        self._locks = {}
        self._blocked = set()
        self._disposed = False
        self._accepting = True

    def _lock(self, server_id):
        return self._locks.setdefault(server_id, asyncio.Lock())

    async def invalidate(self, server_id):
        self._blocked.add(server_id)
        async with self._lock(server_id):
            manager = self._connections.pop(server_id, None)
            self._configs.pop(server_id, None)
            self._identities.pop(server_id, None)
            if manager is not None:
                await manager.dispose()

    async def reconfigure(self, config):
        config = config.model_copy(deep=True)
        async with self._lock(config.id):
            if self._disposed:
                raise DomainError("mcp_disposed", "MCP 管理器已释放")
            self.credentials.check(config)
            if not self._accepting:
                raise DomainError("mcp_draining", "MCP 已停止新派发")
            identity = connection_identity(config)
            manager = self._connections.get(config.id)
            if manager is not None and (
                manager.status(config.id) != "connected" or self._configs[config.id] != config
                or self._identities[config.id] != identity
            ):
                await manager.dispose()
                self._connections.pop(config.id)
                self._configs.pop(config.id)
                self._identities.pop(config.id, None)
                manager = None
            if manager is None:
                self._identities[config.id] = identity
                manager = McpManager([config], limits=self.limits,
                    environment=self.credentials.environment, http_client=self.credentials.http_client)
                self._connections[config.id] = manager
                self._configs[config.id] = config
                await manager.start()
            self._blocked.discard(config.id)

    async def discover(self, server_id):
        async with self._lock(server_id):
            config = self.current(server_id)
            self.credentials.check(config)
            if not self._accepting or config != self._configs[server_id]:
                raise DomainError("blocked_incompatible", "MCP 连接不属于当前配置")
            return await self._connections[server_id].discover(server_id)

    def catalog(self, server_id):
        """仅取当前管理连接的目录；不重连、重新发现或解析秘密。"""
        if not self._accepting or server_id in self._blocked or server_id not in self._connections:
            raise DomainError("blocked_incompatible", "须先显式连接并发现当前 MCP 配置")
        config = self.current(server_id)
        self.credentials.check(config)
        if config != self._configs[server_id]:
            raise DomainError("blocked_incompatible", "MCP 连接不属于当前配置")
        return self._connections[server_id].catalog(server_id)

    async def call(self, server_id, catalog_hash, tool_name, arguments, cancel=None, *, before_send=None):
        arguments = deepcopy(arguments)
        if not self._accepting or server_id in self._blocked or server_id not in self._connections:
            raise DomainError("blocked_incompatible", "须显式连接并发现当前 MCP 配置")
        async with self._lock(server_id):
            if server_id in self._blocked:
                raise DomainError("blocked_incompatible", "MCP 配置正在改变")
            config = self.current(server_id)
            self.credentials.check(config)
            if config != self._configs[server_id]:
                raise DomainError("blocked_incompatible", "MCP 连接不属于当前配置")
            if connection_identity(config) != self._identities[server_id]:
                raise DomainError("mcp_connection_trust_changed", "本机程序或参数文件已改变，请重新核对连接")
            if config.transport == "stdio":
                # 已运行进程的环境不能热替换；调用前复核引用仍可解析。
                await self.credentials.environment(config)
            return await self._connections[server_id].call(
                server_id, catalog_hash, tool_name, arguments, cancel, before_send=before_send,
            )

    def status(self, server_id):
        manager = self._connections.get(server_id)
        return manager.status(server_id) if manager is not None else "saved"

    async def start(self):
        if self._disposed:
            raise DomainError("mcp_disposed", "MCP 管理器已释放")
        self._accepting = True

    async def drain(self):
        self._accepting = False
        self._blocked.update(self._connections)
        for lock in tuple(self._locks.values()):
            async with lock:
                pass

    async def stop(self):
        await self.drain()
        results = await asyncio.gather(
            *(self.invalidate(server_id) for server_id in tuple(self._connections)),
            return_exceptions=True,
        )
        failures = [result for result in results if isinstance(result, Exception)]
        if failures:
            raise ExceptionGroup("MCP 连接释放失败", failures)

    async def dispose(self):
        self._disposed = True
        await self.stop()

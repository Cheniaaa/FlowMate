"""在既有 PluginHost 装配 MCP 管理及已信任配置的自动发现。"""

import asyncio

from flowmate import __version__
from flowmate.contracts.events import NewEvent
from flowmate.host.secrets import HostSecrets
from flowmate.integrations.configuration import McpConfiguration, connection_identity
from flowmate.integrations.configuration_contracts import McpNotice
from flowmate.integrations.contracts import McpCatalog, McpServerConfig
from flowmate.integrations.credentials import McpCredentials
from flowmate.integrations.managed import McpManagedConnections
from flowmate.integrations.tools import McpTools
from flowmate.plugins.host import PluginManifest, SlotSpec


class _McpProvider:
    def __init__(self, configuration, publisher):
        self.service = configuration
        self.publisher = publisher
        self.reconnection = None

    async def start(self):
        await self.service.manager.start()
        configs = self.service.reconnect_snapshot()
        self._restore_catalogs(configs)
        self.service.reconnection = asyncio.create_task(self.service.reconnect(
            publisher=self.publisher, configs=configs))
        self.reconnection = self.service.reconnection

    def _restore_catalogs(self, configs):
        for config in configs:
            if not config.enabled or config.connection_identity is None:
                continue
            try:
                if connection_identity(config) != config.connection_identity:
                    continue
            except OSError:
                self.service._failed_connection(config, "mcp_connection_trust_changed")
                continue
            with self.service.store.transaction() as tx:
                row = tx.execute("SELECT document FROM mcp_catalogs WHERE server_id=? "
                    "AND json_extract(document,'$.config_revision')=? ORDER BY rowid DESC LIMIT 1",
                    (config.id, config.revision)).fetchone()
                if row is None:
                    continue
                catalog = McpCatalog.model_validate_json(row[0])
                names = self.service.effective_tool_names(tx, config, catalog)
                if names is None:
                    continue
                self.publisher.publish(McpServerConfig.model_validate(config.model_dump(
                    include=McpServerConfig.model_fields.keys())), catalog, names, tx=tx)
                self.service.manager.restored[config.id] = (config.revision, config.connection_identity)

    async def drain(self):
        task = self.reconnection
        if task is not None:
            if not task.done():
                task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await self.service.manager.drain()

    async def stop(self):
        await self.drain()
        await self.service.manager.stop()

    async def dispose(self):
        await self.drain()
        await self.service.manager.dispose()


def register_mcp(runtime, host, *, limits):
    def changed(tx, config):
        restored = configuration.manager.restored.get(config.id)
        # 连接失败不等于用户撤销能力。保留本次启动核实过的目录供普通聊天固定；
        # 实际调用仍由失败的当前连接拒绝。保存新修订、停用和发现新目录照常失效。
        if not (config.enabled and restored is not None and restored[0] == config.revision
                and configuration.manager.status(config.id) == "failed"):
            runtime.mcp_tools.invalidate(tx, config.id, config.revision)
        tx.append_event(NewEvent(kind="mcp.changed", workspace_id=config.scope.workspace_id,
            payload=McpNotice(server_id=config.id, config_revision=config.revision, scope=config.scope)))

    configuration = McpConfiguration(runtime.store, changed=changed)
    credentials = McpCredentials(HostSecrets(host), current=configuration.get,
        request_timeout_seconds=limits.request_timeout_seconds)
    configuration.manager = McpManagedConnections(
        current=configuration.get, credentials=credentials, limits=limits,
    )
    runtime.mcp_tools = McpTools(runtime.catalog, runtime.service.catalog, configuration.manager,
        runtime.store, artifacts=runtime.artifacts)
    runtime.plugins.register(PluginManifest(
        plugin_id="builtin.mcp", version=__version__, requires=("builtin.tools",),
        provides=(SlotSpec(name="mcp_manager", exclusive=True),),
    ), lambda config, dependencies: _McpProvider(configuration, runtime.mcp_tools))
    runtime.mcp = configuration
    runtime.service.catalog.plugins = runtime.plugins.snapshot()
    return configuration

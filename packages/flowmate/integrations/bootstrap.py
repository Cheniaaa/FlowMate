"""在既有 PluginHost 装配 MCP 管理及已信任配置的自动发现。"""

import asyncio

from flowmate import __version__
from flowmate.contracts.events import NewEvent
from flowmate.host.secrets import HostSecrets
from flowmate.integrations.configuration import McpConfiguration
from flowmate.integrations.configuration_contracts import McpNotice
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
        self.service.reconnection = asyncio.create_task(self.service.reconnect(
            publisher=self.publisher, configs=configs))
        self.reconnection = self.service.reconnection

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
        runtime.mcp_tools.invalidate(tx, config.id, config.revision)
        tx.append_event(NewEvent(kind="mcp.changed", workspace_id=config.scope.workspace_id,
            payload=McpNotice(server_id=config.id, config_revision=config.revision, scope=config.scope)))

    configuration = McpConfiguration(runtime.store, changed=changed)
    credentials = McpCredentials(HostSecrets(host), current=configuration.get,
        request_timeout_seconds=limits.request_timeout_seconds)
    configuration.manager = McpManagedConnections(
        current=configuration.get, credentials=credentials, limits=limits,
    )
    runtime.mcp_tools = McpTools(runtime.catalog, runtime.service.catalog, configuration.manager, runtime.store)
    runtime.plugins.register(PluginManifest(
        plugin_id="builtin.mcp", version=__version__, requires=("builtin.tools",),
        provides=(SlotSpec(name="mcp_manager", exclusive=True),),
    ), lambda config, dependencies: _McpProvider(configuration, runtime.mcp_tools))
    runtime.mcp = configuration
    runtime.service.catalog.plugins = runtime.plugins.snapshot()
    return configuration

"""MCP SDK 连接适配；仅在启用连接时加载可选 SDK。"""

import asyncio
import hashlib
import json
import os
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass, field

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError, ValidationError
from jsonschema.validators import validator_for
from referencing import Registry, Resource
from referencing.exceptions import Unresolvable
from referencing.jsonschema import DRAFT202012, UnknownDialect

from flowmate.contracts.base import DomainError
from flowmate.integrations.contracts import (
    McpCallFailure,
    McpCallResult,
    McpCatalog,
    McpServerConfig,
    McpToolDefinition,
)


def _json_bytes(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False,
    ).encode("utf-8")


def _validator(schema):
    # 显式空 Registry 不提供网络 retrieve；仅文档内片段引用可用。
    def check_refs(resource):
        if isinstance(resource.contents, dict):
            for key in {"$ref", "$dynamicRef", "$recursiveRef"}:
                item = resource.contents.get(key)
                if key in resource.contents and (
                    not isinstance(item, str) or not item.startswith("#")
                ):
                    raise SchemaError("仅支持文档内引用")
        # 由 dialect 枚举子 Schema，const/enum 中的普通数据不作 Schema 解释。
        for child in resource.subresources():
            check_refs(child)

    validator = validator_for(schema, default=Draft202012Validator)
    if "$schema" in schema and validator_for(schema, default=None) is None:
        raise SchemaError("未支持的 Schema dialect")
    validator.check_schema(schema)
    try:
        check_refs(Resource.from_contents(schema, default_specification=DRAFT202012))
    except UnknownDialect:
        raise SchemaError("未支持的子 Schema dialect") from None
    return validator(schema, registry=Registry())


@dataclass
class _Connection:
    config: McpServerConfig
    state: str = "saved"
    accepting: bool = True
    client: object = None
    catalog: McpCatalog | None = None
    failure: DomainError | None = None
    incompatible: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    close: asyncio.Event = field(default_factory=asyncio.Event)
    idle: asyncio.Event = field(default_factory=asyncio.Event)
    active: int = 0
    owner: asyncio.Task | None = None

    def __post_init__(self):
        self.idle.set()


class McpManager:
    """只管理连接/协议；审批、Task、Artifact 与来源登记由调用宿主负责。

    environment(config) -> await dict[str, str]：只解析 env_refs 的可信宿主。
    http_client(config) -> await 未进入的 httpx2.AsyncClient：宿主绑定目的地及凭据；
    本模块进入并关闭 client，不接收明文 token 配置。
    """

    def __init__(self, configs, *, limits, environment=None, http_client=None):
        self.limits = limits
        self._environment = environment
        self._http_client = http_client
        self._connections = {
            config.id: _Connection(config.model_copy(deep=True)) for config in configs
        }
        self._lifecycle = asyncio.Lock()
        self._started = False
        self._accepting = False
        self._disposed = False

    async def _own(self, connection):
        """AnyIO SDK 的所有 context 在此同一任务内完整进入/退出。"""
        connected = False
        http = None
        try:
            async with AsyncExitStack() as stack:
                from mcp.client import Client

                config = connection.config
                if config.transport == "stdio":
                    from mcp.client.stdio import StdioServerParameters, stdio_client

                    if config.env_refs and self._environment is None:
                        raise DomainError("mcp_credentials_required", "需要可信宿主解析环境引用")
                    env = await self._environment(config.model_copy(deep=True)) if self._environment else {}
                    if set(env) != set(config.env_refs):
                        raise DomainError("mcp_environment_invalid", "环境与已批准引用不匹配")
                    # SDK 默认必要变量 + 显式 env；stderr 丢弃，避免无界日志和秘密泄露。
                    errlog = stack.enter_context(open(os.devnull, "w"))
                    transport = stdio_client(StdioServerParameters(
                        command=config.command, args=config.args, cwd=config.cwd, env=env,
                    ), errlog=errlog)
                else:
                    import httpx2
                    from mcp.client.streamable_http import streamable_http_client

                    if config.credential_ref and self._http_client is None:
                        raise DomainError("mcp_credentials_required", "需要可信宿主绑定 HTTP 凭据")
                    http = (
                        await self._http_client(config.model_copy(deep=True)) if self._http_client
                        else httpx2.AsyncClient(
                            trust_env=False, follow_redirects=False,
                            timeout=self.limits.request_timeout_seconds,
                        )
                    )
                    await stack.enter_async_context(http)
                    transport = streamable_http_client(config.url, http_client=http)
                async with asyncio.timeout(self.limits.request_timeout_seconds):
                    connection.client = await stack.enter_async_context(Client(
                        transport, read_timeout_seconds=self.limits.request_timeout_seconds,
                    ))
                connection.state = "connected"
                connected = True
                connection.ready.set()
                await connection.close.wait()
        except Exception as exc:
            # 连接失败是集成边界的可观察状态；不向公开错误传递 SDK 异常正文。
            connection_error = False
            if http is not None and http.is_closed:
                # 固定 SDK 会在 HTTP 断连后退出 task group 时再次抛出请求错误。
                # 只有全部属于网络请求错误且 client 已关闭，才分类为连接失败。
                if isinstance(exc, ExceptionGroup):
                    _, other = exc.split(httpx2.RequestError)
                    connection_error = other is None
                else:
                    connection_error = isinstance(exc, httpx2.RequestError)
            cleanup_failed = connected and not connection_error
            connection.failure = (
                exc if isinstance(exc, DomainError)
                else DomainError(
                    "mcp_cleanup_failed" if cleanup_failed else "mcp_connection_failed",
                    "MCP 清理失败" if cleanup_failed else "MCP 连接失败",
                )
            )
            connection.state = "failed"
        finally:
            connection.client = None
            connection.ready.set()

    async def _activate(self, connection):
        if not connection.config.enabled:
            connection.state = "stopped"
            return
        connection.state = "connecting"
        connection.owner = asyncio.create_task(self._own(connection))
        await connection.ready.wait()
        if connection.failure is not None:
            await connection.owner
            return
        try:
            await self._discover(connection)
        except DomainError as exc:
            connection.failure = exc
            connection.state = "failed"
            await self._close(connection)

    async def _close(self, connection):
        connection.close.set()
        if connection.owner is not None:
            await connection.owner
        connection.catalog = None
        if connection.failure is not None and connection.failure.code == "mcp_cleanup_failed":
            raise connection.failure

    async def start(self):
        async with self._lifecycle:
            if self._disposed:
                raise DomainError("mcp_disposed", "MCP 管理器已释放")
            if self._started:
                return
            self._connections = {
                key: _Connection(value.config) for key, value in self._connections.items()
            }
            await asyncio.gather(*(self._activate(c) for c in self._connections.values()))
            self._started = True
            self._accepting = True

    @asynccontextmanager
    async def _operation(self, server_id):
        if not self._accepting:
            raise DomainError("mcp_draining", "MCP 已停止接收新操作")
        connection = self._connections.get(server_id)
        if connection is None:
            raise DomainError("mcp_unavailable", "未装配该 MCP 服务器")
        if not connection.accepting:
            raise DomainError("mcp_draining", "该 MCP 连接正在排空")
        if connection.failure is not None:
            raise connection.failure
        if connection.state != "connected":
            raise DomainError("mcp_unavailable", "该 MCP 连接不可用")
        connection.active += 1
        connection.idle.clear()
        try:
            async with connection.lock:
                if not self._accepting or not connection.accepting:
                    raise DomainError("mcp_draining", "连接排空期间不再派发等待中的操作")
                yield connection
        finally:
            connection.active -= 1
            if connection.active == 0:
                connection.idle.set()

    async def _discover(self, connection):
        tools = []
        names = set()
        cursors = set()
        cursor = None
        size = 0
        try:
            for _ in range(self.limits.max_pages):
                page = await connection.client.list_tools(cursor=cursor, cache_mode="refresh")
                size += len(_json_bytes(page.model_dump(mode="json", by_alias=True)))
                if size > self.limits.max_catalog_bytes:
                    raise DomainError("mcp_catalog_too_large", "MCP 目录超过接收上限")
                for tool in page.tools:
                    if tool.name in names:
                        raise DomainError("mcp_catalog_invalid", "MCP 目录包含重名工具")
                    names.add(tool.name)
                    unavailable = None
                    try:
                        _validator(tool.input_schema)
                        if tool.output_schema is not None:
                            _validator(tool.output_schema)
                    except SchemaError:
                        unavailable = "mcp_schema_unsupported"
                    tools.append(McpToolDefinition(
                        name=tool.name, description=tool.description,
                        input_schema=tool.input_schema, output_schema=tool.output_schema,
                        annotations=(
                            tool.annotations.model_dump(mode="json", by_alias=True)
                            if tool.annotations is not None else None
                        ),
                        unavailable_reason=unavailable,
                    ))
                cursor = page.next_cursor
                if cursor is None:
                    break
                if cursor in cursors:
                    raise DomainError("mcp_catalog_invalid", "MCP 分页游标重复")
                cursors.add(cursor)
            else:
                raise DomainError("mcp_catalog_too_large", "MCP 分页超过接收上限")
            tools.sort(key=lambda tool: tool.name)
            payload = {
                "server_id": connection.config.id,
                "config_revision": connection.config.revision,
                "tools": [tool.model_dump(mode="json") for tool in tools],
            }
            catalog = McpCatalog(
                server_id=connection.config.id, config_revision=connection.config.revision,
                tools=tuple(tools), content_hash=hashlib.sha256(_json_bytes(payload)).hexdigest(),
            )
            connection.catalog = catalog
            return catalog
        except DomainError:
            # 无法复核时旧快照也不可再派发。
            connection.catalog = None
            raise
        except Exception:
            connection.catalog = None
            raise DomainError("mcp_discovery_failed", "MCP 目录发现失败") from None

    async def discover(self, server_id):
        async with self._operation(server_id) as connection:
            catalog = await self._discover(connection)
            connection.incompatible = False
            return catalog.model_copy(deep=True)

    def catalog(self, server_id):
        """读取当前连接已完整发现的目录，不执行网络操作。"""
        connection = self._connections.get(server_id)
        if (not self._accepting or connection is None or not connection.accepting
                or connection.state != "connected" or connection.catalog is None or connection.incompatible):
            raise DomainError("blocked_incompatible", "须先显式连接并发现当前 MCP 配置")
        return connection.catalog.model_copy(deep=True)

    async def call(self, server_id, catalog_hash, tool_name, arguments, cancel=None, *, before_send=None):
        try:
            # 在锁等待和网络等待之前固定实际参数。
            arguments = json.loads(_json_bytes(arguments))
            if not isinstance(arguments, dict):
                raise ValueError
        except (ValueError, TypeError):
            raise DomainError("tool_arguments_invalid", "工具参数必须为 JSON object") from None
        async with self._operation(server_id) as connection:
            if connection.incompatible:
                raise DomainError("blocked_incompatible", "固定目录已不兼容，须显式重新发现")
            if cancel is not None and cancel.is_set():
                raise DomainError("mcp_call_cancelled", "调用尚未发送即已取消")
            catalog = await self._discover(connection)
            if catalog.content_hash != catalog_hash:
                raise DomainError("blocked_incompatible", "固定目录或连接版本已变化")
            tool = next((tool for tool in catalog.tools if tool.name == tool_name), None)
            if tool is None:
                raise DomainError("mcp_tool_unavailable", "固定目录中不存在该工具")
            if tool.unavailable_reason is not None:
                raise DomainError(tool.unavailable_reason, "该工具的 Schema 尚不受支持")
            try:
                _validator(tool.input_schema).validate(arguments)
            except (ValidationError, Unresolvable, ValueError, TypeError):
                raise DomainError("tool_arguments_invalid", "工具参数不符合声明 Schema") from None
            if cancel is not None and cancel.is_set():
                raise DomainError("mcp_call_cancelled", "调用尚未发送即已取消")
            return await self._call_once(connection, catalog, tool, arguments, cancel, before_send)

    async def _call_once(self, connection, catalog, tool, arguments, cancel, before_send=None):
        from mcp import types
        from mcp.client.session import UnexpectedClaimedResult
        from mcp.shared.exceptions import MCPError
        from pydantic import ValidationError as ModelValidationError

        async def send():
            # 目录刷新和任务排队均已结束，紧贴协议发送再次授权。
            if cancel is not None and cancel.is_set():
                raise DomainError("mcp_call_cancelled", "调用尚未发送即已取消")
            if before_send is not None:
                before_send()
            return await connection.client.session.call_tool(tool.name, arguments, allow_input_required=True)

        call = asyncio.create_task(send())
        cancelled = asyncio.create_task(cancel.wait()) if cancel is not None else None
        try:
            if cancelled is not None:
                await asyncio.wait([call, cancelled], return_when=asyncio.FIRST_COMPLETED)
                if not call.done():
                    call.cancel()
                    await asyncio.gather(call, return_exceptions=True)
                    raise McpCallFailure("mcp_call_uncertain", "调用已发送，取消后结果未知", confirmed=False)
            result = await call
        except MCPError as exc:
            if exc.code == types.HEADER_MISMATCH:
                connection.incompatible = True
                raise McpCallFailure(
                    "blocked_incompatible", "服务器拒绝固定目录，须新目录及新 Run", confirmed=True,
                ) from None
            uncertain = exc.code in {types.CONNECTION_CLOSED, types.REQUEST_TIMEOUT}
            raise McpCallFailure(
                "mcp_call_uncertain" if uncertain else "mcp_protocol_error",
                "MCP 调用结果未知" if uncertain else "MCP 协议调用失败",
                confirmed=not uncertain,
            ) from None
        except UnexpectedClaimedResult:
            raise McpCallFailure(
                "mcp_result_unsupported", "尚不支持该扩展结果", confirmed=True,
            ) from None
        except ModelValidationError:
            raise McpCallFailure(
                "mcp_result_unsupported", "服务端结果不符合当前协议", confirmed=True,
            ) from None
        except RuntimeError:
            # 此路径固定会话已连接并已列出工具；SDK 此处校验 output Schema。
            raise McpCallFailure(
                "tool_result_invalid", "工具结果不符合声明 Schema", confirmed=True,
            ) from None
        except asyncio.CancelledError:
            call.cancel()
            await asyncio.gather(call, return_exceptions=True)
            raise
        finally:
            if cancelled is not None:
                cancelled.cancel()
                await asyncio.gather(cancelled, return_exceptions=True)
        if not isinstance(result, types.CallToolResult) or result.result_type != "complete":
            raise McpCallFailure("mcp_result_unsupported", "尚不支持该协议结果", confirmed=True)
        if len(_json_bytes(result.model_dump(mode="json", by_alias=True))) > self.limits.max_result_bytes:
            raise McpCallFailure("mcp_result_too_large", "工具结果超过接收上限", confirmed=True)
        if any(not isinstance(item, types.TextContent) for item in result.content):
            raise McpCallFailure("mcp_result_unsupported", "尚不支持二进制或资源内容", confirmed=True)
        return McpCallResult(
            server_id=catalog.server_id, config_revision=catalog.config_revision,
            catalog_hash=catalog.content_hash, tool_name=tool.name,
            texts=tuple(item.text for item in result.content),
            structured_content=result.structured_content, is_error=result.is_error,
        )

    async def reconfigure(self, config):
        config = config.model_copy(deep=True)
        async with self._lifecycle:
            if self._disposed:
                raise DomainError("mcp_disposed", "MCP 管理器已释放")
            old = self._connections.get(config.id)
            if old is not None:
                if config == old.config:
                    return
                if config.revision <= old.config.revision:
                    raise DomainError("mcp_revision_conflict", "连接变更必须增加配置版本")
                old.accepting = False
                await old.idle.wait()
                await self._close(old)
            connection = _Connection(config)
            self._connections[config.id] = connection
            if self._started:
                await self._activate(connection)

    async def drain(self):
        self._accepting = False
        await asyncio.gather(*(c.idle.wait() for c in self._connections.values()))

    async def stop(self):
        async with self._lifecycle:
            await self._stop()

    async def _stop(self):
        await self.drain()
        results = await asyncio.gather(
            *(self._close(c) for c in self._connections.values()), return_exceptions=True,
        )
        for connection in self._connections.values():
            if connection.failure is None:
                connection.state = "stopped"
        self._started = False
        failures = [result for result in results if isinstance(result, Exception)]
        if len(failures) == 1:
            raise failures[0]
        if failures:
            raise ExceptionGroup("MCP 清理失败", failures)

    async def dispose(self):
        async with self._lifecycle:
            if self._disposed:
                return
            await self._stop()
            self._disposed = True

    def status(self, server_id):
        return self._connections[server_id].state

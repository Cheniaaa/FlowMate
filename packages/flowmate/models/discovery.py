"""按宿主绑定凭据只读发现型号；只缓存完成分页的成功目录。"""

import asyncio
import hashlib
import json
from contextlib import asynccontextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from urllib.parse import urljoin, urlsplit

import httpx2
from pydantic import ValidationError

from flowmate.contracts.base import Contract, DomainError
from flowmate.contracts.settings import (
    DiscoveredModel,
    MetadataSource,
    ModelConnection,
    ModelDiscoveryResult,
    ResolvedModelProfile,
)
from flowmate.host.protocol import ModelSecretBinding
from flowmate.models.endpoints import resolve_model_endpoint
from flowmate.models.wire import strict_json


class _CatalogCache(Contract):
    identity: str
    items: list[DiscoveredModel]
    fetched_at: str


_resolution_records = ContextVar("model_discovery_records", default=None)
_resolution_credentials = ContextVar("model_resolution_credentials", default=None)


def credential_identity(connection: ModelConnection | ResolvedModelProfile, key: str) -> str:
    """目录与真实发送共用不含明文的当前凭据身份。"""
    connection_id = connection.id if isinstance(connection, ModelConnection) else connection.connection_id
    return hashlib.sha256(json.dumps([connection_id, connection.protocol, connection.endpoint,
        connection.secret_ref, key], ensure_ascii=False).encode()).hexdigest()


def current_credential_identity(connection: ModelConnection) -> str | None:
    identities = _resolution_credentials.get()
    if identities is None:
        return None
    binding = (connection.id, connection.version, connection.protocol, connection.endpoint, connection.secret_ref)
    return identities.get(binding)


def current_discovered_model(connection, model_id: str) -> DiscoveredModel | None:
    """同步事务只消费本次异步入口已核验凭据的声明，不直接信任磁盘目录。"""
    records = _resolution_records.get()
    if records is None:
        return None
    key = (connection.id, connection.version, connection.protocol, connection.endpoint, connection.secret_ref)
    return records.get(key, {}).get(model_id)


class ModelDiscovery:
    def __init__(self, settings, secrets, *, transport=None):
        self.settings = settings
        self.secrets = secrets
        self.transport = transport
        self.directory = settings.store.path.parent / "model-catalog"
        self._lock = asyncio.Lock()

    @staticmethod
    def _identity(connection, key):
        return credential_identity(connection, key)

    async def _key(self, connection):
        binding = ModelSecretBinding(connection_id=connection.id,
            connection_version=connection.version, protocol=connection.protocol,
            endpoint=connection.endpoint, secret_ref=connection.secret_ref)
        return (await self.secrets.resolve(binding)).decode("utf-8")

    @asynccontextmanager
    async def resolution_scope(self, model_id: str, *, include_members: bool = False):
        """只读本地已成功目录，核验实际凭据；不在开始任务时发目录 HTTP 请求。"""
        with self.settings.store.transaction(write=False) as tx:
            model_ids = {model_id}
            if include_members:
                for row in tx.execute("SELECT r.document FROM agent_profiles p JOIN agent_revisions r "
                        "ON r.profile_id=p.id AND r.version=p.current_version "
                        "WHERE json_extract(r.document,'$.delegatable')=1"):
                    profile = json.loads(row[0])
                    model_ids.add(profile["default_model_profile_id"])
            connections = {}
            for id in model_ids:
                model = tx.get_profile("model", id)
                connections[model.connection_id] = tx.get_connection(model.connection_id)
        records, identities = {}, {}
        for connection in connections.values():
            path = self.directory / f"{connection.id}.json"
            if connection.secret_ref is None:
                continue
            try:
                key = await self._key(connection)
            except DomainError:
                continue  # 没有本次凭据证明，解析器继续使用官方目录或本地预算。
            binding = (connection.id, connection.version, connection.protocol, connection.endpoint, connection.secret_ref)
            identity = self._identity(connection, key)
            del key
            identities[binding] = identity
            if not path.exists():
                continue  # 能力观察独立于目录是否存在。
            cache = _CatalogCache.model_validate_json(path.read_bytes())
            if cache.identity != identity:
                continue
            records[binding] = {item.model_id: item for item in cache.items}
        token = _resolution_records.set(records)
        credential_token = _resolution_credentials.set(identities)
        try:
            yield
        finally:
            _resolution_credentials.reset(credential_token)
            _resolution_records.reset(token)

    async def refresh(self, connection_id: str) -> ModelDiscoveryResult:
        # 串行刷新避免同一连接的旧请求覆盖更新凭据后的目录。
        async with self._lock:
            connection = self.settings.get_connection(connection_id)
            common = {"connection_id": connection.id, "connection_version": connection.version}
            if connection.secret_ref is None:
                return ModelDiscoveryResult(**common, status="authentication_error",
                    message="请在此连接保存 API Key 后刷新型号列表")
            try:
                key = await self._key(connection)
            except DomainError:
                return ModelDiscoveryResult(**common, status="authentication_error",
                    message="无法使用此连接的系统凭据，请重新保存 API Key")
            # 包含实际凭据身份；同 ref 轮换也不能展示前一身份的目录。明文不落盘或返回 UI。
            identity = self._identity(connection, key)
            path = self.directory / f"{connection.id}.json"
            cached = _CatalogCache.model_validate_json(path.read_bytes()) if path.exists() else None
            if cached is not None and cached.identity != identity:
                cached = None
            address = resolve_model_endpoint(connection.protocol, connection.endpoint)
            headers = {"Accept": "application/json"}
            if address.protocol == "anthropic":
                headers.update({"x-api-key": key, "anthropic-version": "2023-06-01"})
            else:
                headers["Authorization"] = "Bearer " + key
            try:
                async with httpx2.AsyncClient(transport=self.transport, timeout=20,
                        follow_redirects=False, trust_env=False) as client:
                    items = None
                    for url in address.catalog_urls:
                        response = await client.get(url, headers=headers)
                        if response.status_code in {404, 405}:
                            continue
                        items = await self._pages(client, url, response, headers, address.protocol)
                        break
                if items is None:
                    status, message = "unavailable", "此服务未提供型号列表；可从提供方目录选择可尝试的型号，或手填别名"
                else:
                    # 配置改变后不能把先前凭据的结果当作当前连接结果。
                    if self.settings.get_connection(connection.id) != connection:
                        raise DomainError("connection_changed", "连接已修改，请刷新当前连接的型号列表")
                    fetched_at = datetime.now(UTC).isoformat()
                    value = _CatalogCache(identity=identity, items=items, fetched_at=fetched_at)
                    self.directory.mkdir(parents=True, exist_ok=True)
                    temporary = path.with_suffix(".tmp")
                    temporary.write_text(value.model_dump_json(), encoding="utf-8")
                    temporary.replace(path)
                    return ModelDiscoveryResult(**common, status="ready", items=items,
                        fetched_at=fetched_at, message="已读取此连接的型号列表")
            except DomainError as error:
                status = "authentication_error" if error.code == "model_catalog_auth" else "error"
                message = error.safe_message
            except (httpx2.TransportError, ValueError, ValidationError, UnicodeError):
                status, message = "error", "无法读取型号列表，请检查服务地址或稍后刷新"
            return ModelDiscoveryResult(**common, status=status, message=message,
                items=cached.items if cached else [], cached=cached is not None,
                fetched_at=cached.fetched_at if cached else None)

    @staticmethod
    async def _pages(client, url, response, headers, protocol):
        items, seen = {}, {str(response.request.url)}
        while True:
            if response.status_code in {401, 403}:
                raise DomainError("model_catalog_auth", "认证或权限不足，请检查此连接的 API Key")
            if not response.is_success:
                raise DomainError("model_catalog_http", "无法读取型号列表，请检查此连接或稍后刷新")
            body = strict_json(response.text)
            if not isinstance(body, dict) or not isinstance(body.get("data"), list):
                raise ValueError("invalid model catalog")
            for entry in body["data"]:
                if not isinstance(entry, dict):
                    raise ValueError("invalid model entry")
                item = ModelDiscovery._model(entry, protocol, str(response.request.url))
                # 不改写服务器 ID，包括代理提供的 GPT / Claude 别名。
                if item.model_id != entry["id"]:
                    raise ValueError("model ID must not be normalized")
                items[item.model_id] = item
            next_link = body.get("next") or response.links.get("next", {}).get("url")
            if next_link:
                if not isinstance(next_link, str):
                    raise ValueError("invalid next link")
                next_url = httpx2.URL(urljoin(str(response.request.url), next_link))
            elif body.get("has_more") is True:
                cursor = body.get("last_id")
                if not isinstance(cursor, str) or not cursor:
                    raise ValueError("missing pagination cursor")
                next_url = response.request.url.copy_set_param(
                    "after_id" if protocol == "anthropic" else "after", cursor)
            else:
                if body.get("has_more") not in (None, False):
                    raise ValueError("invalid pagination marker")
                return list(items.values())
            expected, following = urlsplit(url), urlsplit(str(next_url))
            if ((following.scheme, following.netloc, following.path)
                    != (expected.scheme, expected.netloc, expected.path)
                    or following.fragment or str(next_url) in seen):
                raise ValueError("pagination escaped configured catalog or repeated a page")
            seen.add(str(next_url))
            response = await client.get(next_url, headers=headers)

    @staticmethod
    def _model(entry, protocol, source_url):
        # 只接收具有明确语义的字段。max_tokens 在 Messages 目录中表示最大输出。
        total = entry.get("context_window_tokens", entry.get("context_window", entry.get("context_length")))
        output = entry.get("max_output_tokens")
        if output is None and protocol == "anthropic":
            output = entry.get("max_tokens")
        capabilities = entry.get("capabilities")
        if capabilities is None:
            capabilities = {}
        if not isinstance(capabilities, dict):
            raise ValueError("invalid capabilities")
        declared = {}
        for field, aliases in (("tools", ("tools",)), ("vision", ("vision", "image_input")),
                               ("thinking", ("thinking",)), ("structured_output", ("structured_output", "structured_outputs"))):
            for alias in aliases:
                if alias in capabilities:
                    value = capabilities[alias]
                    declared[field] = value.get("supported") if isinstance(value, dict) else value
                    break
        values = {"model_id": entry.get("id"),
            "display_name": entry.get("display_name") or entry.get("name"),
            "canonical_id": entry.get("canonical_id"),
            "context_window_tokens": total, "max_input_tokens": entry.get("max_input_tokens"),
            "max_output_tokens": output, "capabilities": declared}
        source = MetadataSource(kind="service", source=urlsplit(source_url)._replace(query="", fragment="").geturl(),
            verified_at=datetime.now(UTC).isoformat(), note="当前连接经绑定凭据认证后返回的本站声明")
        sources = {field: source for field in ("canonical_id", "context_window_tokens",
            "max_input_tokens", "max_output_tokens") if values[field] is not None}
        sources.update({f"capabilities.{field}": source for field, value in values["capabilities"].items()
            if value is not None})
        return DiscoveredModel(**values, metadata_sources=sources)

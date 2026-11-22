"""Embedding适配边界；只返回派发与供应商事实，业务结算属于Runtime。"""

import asyncio
import hashlib
import json
import math
import re
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Literal, Protocol

import httpx2

from flowmate.contracts.base import Contract, DomainError, Id
from flowmate.contracts.execution import (
    ActivitySnapshot,
    DispatchRequest,
    ExecutionContext,
    ReservationEstimate,
    RunSnapshot,
    ScopeDependency,
    TaskSnapshot,
    Usage,
)
from flowmate.contracts.pricing import PricingSnapshot
from flowmate.contracts.settings import ModelConnection
from flowmate.host.diagnostics import make_diagnostic, write_diagnostic
from flowmate.host.protocol import ModelSecretBinding
from flowmate.knowledge.contracts import EmbeddingProfile
from flowmate.models.endpoints import resolve_model_endpoint
from flowmate.models.pricing import calculate_units, estimate_request
from flowmate.runtime.transitions import check_dispatch, load, utc_now


class ResolvedEmbeddingProfile(Contract):
    profile: EmbeddingProfile
    connection: ModelConnection | None = None
    local_model_path: str | None = None
    pricing: PricingSnapshot | None = None


@dataclass(frozen=True)
class EmbeddingResult:
    vectors: list[list[float]] | None = None
    usage: Usage = field(default_factory=Usage)
    provider_request_id: str | None = None
    confirmed: bool = False
    sent: bool = False
    error: str | None = None
    actual_units: int | None = None


class EmbeddingProvider(Protocol):
    def available(self) -> bool: ...

    async def embed(self, texts: list[str], *, kind: Literal["query", "document"],
        profile: ResolvedEmbeddingProfile, ctx: ExecutionContext, attempt_id: Id,
        dependencies: list[ScopeDependency], cancel: asyncio.Event, before_send) -> EmbeddingResult: ...


def embedding_endpoint(connection: ModelConnection) -> str:
    endpoint = resolve_model_endpoint(connection.protocol, connection.endpoint)
    if connection.protocol == "anthropic" or endpoint.protocol == "anthropic":
        raise DomainError("embedding_protocol_unsupported", "此连接不支持embedding")
    return endpoint.base_url.rstrip("/") + "/embeddings"


def _check(policy, clock, ctx, attempt_id, dependencies, cancel, destination, *, initial=False):
    if cancel.is_set():
        raise DomainError("cancelled", "Embedding已取消")
    with policy.store.transaction(write=False) as tx:
        activity = load(tx, ActivitySnapshot, ctx.activity_id)
        run, task = load(tx, RunSnapshot, ctx.run_id), load(tx, TaskSnapshot, ctx.task_id)
        if (activity.run_id != ctx.run_id or activity.task_id != ctx.task_id
                or activity.attempt_id != attempt_id
                or activity.intent.operation not in {"embedding.query", "embedding.document"}):
            raise DomainError("embedding_binding_mismatch", "Embedding不属于当前活动")
        if initial and activity.state != "prepared":
            raise DomainError("already_dispatched", "Embedding活动不能重复发送")
        check_dispatch(tx, run, task, clock())
        authorized = _authorize(policy, tx, ctx, dependencies, destination)
        deadline = min(run.deadline_at, task.deadline_at) if task.deadline_at else run.deadline_at
        return authorized, deadline


def _authorize(policy, tx, ctx, dependencies, destination):
    policy.check_run_sources(tx, ctx, dependencies)
    decision = policy.check_tx(tx, ctx, dependencies,
        "embedding_send" if destination else "read", destination)
    if not decision.allowed:
        raise DomainError(decision.reason or "grant_required", "Embedding输入缺少有效资料许可",
            related_ids=tuple(decision.missing_grants))
    return decision.dependencies


def _vectors(values, count, dimensions):
    if not isinstance(values, list) or len(values) != count:
        raise DomainError("invalid_response", "Embedding数量与输入不一致")
    for vector in values:
        if (not isinstance(vector, list) or len(vector) != dimensions or any(
                type(value) not in {int, float} or not math.isfinite(value) for value in vector)):
            raise DomainError("invalid_response", "Embedding向量维度或数值无效")
    return [[float(value) for value in vector] for vector in values]


class _EmbeddingTransport(httpx2.AsyncBaseTransport):
    def __init__(self, transport, *, destination, profile, ctx, attempt_id, dependencies,
            headers, before_send, check):
        self.transport, self.destination, self.profile = transport, destination, profile
        self.ctx, self.attempt_id, self.dependencies = ctx, attempt_id, dependencies
        self.headers, self.before_send, self.check = headers, before_send, check
        self.sent = self.complete = False
        self.status = self.request_id = self.body = None

    async def handle_async_request(self, request):
        if self.sent:
            raise DomainError("model_retry_forbidden", "Embedding活动不能自动重发")
        body = await request.aread()
        if request.method != "POST" or str(request.url) != self.destination:
            raise DomainError("model_endpoint_mismatch", "Embedding目的地与固定连接不一致")
        self.check()
        digest = hashlib.sha256(request.method.encode() + b"\n" + str(request.url).encode() + b"\n" + body).hexdigest()
        request.headers.clear()
        request.headers.update(self.headers)
        request.headers["host"] = request.url.netloc.decode("ascii")
        request.headers["content-length"] = str(len(body))
        permit = self.before_send(DispatchRequest(activity_id=self.ctx.activity_id, attempt_id=self.attempt_id,
            request_digest=digest, estimate=estimate_request(body, 0, self.profile.pricing),
            source_dependencies=self.dependencies,
            pricing_snapshot=self.profile.pricing.model_dump(mode="json") if self.profile.pricing else None))
        if (permit.activity_id, permit.attempt_id, permit.request_digest) != (
                self.ctx.activity_id, self.attempt_id, digest):
            raise DomainError("dispatch_permit_invalid", "Embedding许可与完整请求不一致")
        self.sent = True
        response = await self.transport.handle_async_request(request)
        self.status = response.status_code
        request_id = response.headers.get("x-request-id") or response.headers.get("request-id")
        if request_id and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", request_id):
            self.request_id = request_id
        try:
            content = await response.aread()
            self.complete = True
            self.body = content
            return httpx2.Response(response.status_code, headers=response.headers, content=content)
        finally:
            await response.aclose()

    async def aclose(self):
        await self.transport.aclose()


class OpenAIEmbeddingProvider:
    def available(self):
        return True

    def __init__(self, policy, secrets, *, transport=None, clock=utc_now):
        self.policy, self.secrets, self.transport, self.clock = policy, secrets, transport, clock

    async def embed(self, texts, *, kind, profile, ctx, attempt_id, dependencies, cancel, before_send):
        from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI

        guard = client = watcher = None
        vectors, error = None, None
        usage, actual, confirmed = Usage(output_tokens=0), None, False
        outer = asyncio.current_task()
        try:
            connection = profile.connection
            destination = embedding_endpoint(connection)
            # 固定本次实际使用的grant epoch，派发及回执前复核不得替换已撤许可。
            dependencies, deadline = _check(self.policy, self.clock, ctx, attempt_id, dependencies, cancel,
                destination, initial=True)
            if connection.secret_ref is None:
                raise DomainError("credential_missing", "Embedding连接尚未配置凭据")
            key = (await self.secrets.resolve(ModelSecretBinding(connection_id=connection.id,
                connection_version=connection.version, protocol=connection.protocol, endpoint=connection.endpoint,
                secret_ref=connection.secret_ref))).decode("utf-8")
            headers = {}

            def dispatch(request):
                return before_send(request, authorize=lambda tx: _authorize(
                    self.policy, tx, ctx, dependencies, destination))

            guard = _EmbeddingTransport(self.transport or httpx2.AsyncHTTPTransport(retries=0),
                destination=destination, profile=profile, ctx=ctx, attempt_id=attempt_id,
                dependencies=dependencies, headers=headers, before_send=dispatch,
                check=lambda: _check(self.policy, self.clock, ctx, attempt_id, dependencies, cancel, destination))
            timeout = min(profile.profile.request_timeout_seconds, (deadline - self.clock()).total_seconds())
            client = httpx2.AsyncClient(transport=guard, timeout=timeout, follow_redirects=False, trust_env=False)
            sdk = AsyncOpenAI(api_key=key, base_url=destination.removesuffix("/embeddings"),
                admin_api_key="", organization="", project="", webhook_secret="",
                max_retries=0, http_client=client)
            headers.update({name: value for name, value in (sdk.default_headers | sdk.auth_headers).items()
                if name.lower() in {"accept", "content-type", "authorization"}})

            async def interrupt():
                await cancel.wait()
                outer.cancel()

            watcher = asyncio.create_task(interrupt())
            prefix = profile.profile.query_prefix if kind == "query" else profile.profile.document_prefix
            async with asyncio.timeout(timeout):
                await sdk.embeddings.create(input=[prefix + text for text in texts],
                    model=profile.profile.model_id, encoding_format="float",
                    **({"dimensions": profile.profile.dimensions} if profile.profile.request_dimensions else {}))
        except asyncio.CancelledError:
            if not cancel.is_set():
                raise
            outer.uncancel()
            error = "cancelled"
        except DomainError as exc:
            error = exc.code
        except (APITimeoutError, httpx2.TimeoutException, TimeoutError):
            error = "model_timeout"
        except (APIConnectionError, httpx2.TransportError):
            error = "model_connection_failed"
        except APIStatusError as exc:
            error = {401: "model_authentication_failed", 403: "model_permission_denied",
                429: "model_rate_limited"}.get(exc.status_code, "model_provider_error")
        except (ValueError, TypeError, AttributeError, KeyError, OverflowError):
            error = "invalid_response"
        finally:
            if watcher is not None:
                watcher.cancel()
                with suppress(asyncio.CancelledError):
                    await watcher
            if client is not None:
                try:
                    await client.aclose()
                except (httpx2.TransportError, OSError, RuntimeError) as exc:
                    write_diagnostic(make_diagnostic("model_cleanup_failed", exc, request_id=ctx.activity_id))
                    error = error or "model_cleanup_failed"
        if guard is not None and guard.complete:
            confirmed = 200 <= guard.status < 300 or guard.status in {400, 401, 403, 404, 405, 413, 422, 429}
            try:
                body = json.loads(guard.body)
                reported = body.get("usage") or {}
                if "prompt_tokens" in reported:
                    count = reported["prompt_tokens"]
                    if type(count) is not int or not 0 <= count <= 9007199254740991:
                        raise DomainError("invalid_response", "Embedding用量不是有效整数")
                    usage = Usage(input_tokens=count, output_tokens=0, source="provider_wire", status="known")
                    if profile.pricing is not None:
                        actual = calculate_units(profile.pricing, {"input_tokens": count, "output_tokens": 0})
                if error is None:
                    if body["model"] != (profile.profile.model_revision or profile.profile.model_id):
                        raise DomainError("invalid_response", "Embedding返回了不同模型")
                    rows = body["data"]
                    if not isinstance(rows, list) or len(rows) != len(texts):
                        raise DomainError("invalid_response", "Embedding数量与输入不一致")
                    indexes = [row["index"] for row in rows]
                    if any(type(index) is not int for index in indexes) or set(indexes) != set(range(len(texts))):
                        raise DomainError("invalid_response", "Embedding索引重复、遗漏或越界")
                    vectors = _vectors([row["embedding"] for row in sorted(rows, key=lambda row: row["index"])],
                        len(texts), profile.profile.dimensions)
            except (ValueError, TypeError, AttributeError, KeyError, OverflowError, DomainError):
                error = error or "invalid_response"
        if vectors is not None:
            try:
                _check(self.policy, self.clock, ctx, attempt_id, dependencies, cancel, destination)
            except DomainError as exc:
                vectors, error = None, exc.code
        sent = guard is not None and guard.sent
        return EmbeddingResult(vectors=vectors, usage=usage, provider_request_id=guard.request_id if guard else None,
            confirmed=confirmed or not sent, sent=sent, error=error, actual_units=actual if sent else 0)


class FastEmbedProvider:
    def __init__(self, policy, *, clock=utc_now):
        self.policy, self.clock = policy, clock

    def available(self):
        import importlib.util

        return importlib.util.find_spec("fastembed") is not None

    async def embed(self, texts, *, kind, profile, ctx, attempt_id, dependencies, cancel, before_send):
        started = False
        work = watcher = None
        vectors = error = None
        external_cancel = False
        outer = asyncio.current_task()
        try:
            dependencies, deadline = _check(self.policy, self.clock, ctx, attempt_id, dependencies,
                cancel, None, initial=True)
            try:
                from fastembed import TextEmbedding
            except ImportError:
                raise DomainError("knowledge_embedding_unavailable", "本地embedding依赖未安装") from None
            prefix = profile.profile.query_prefix if kind == "query" else profile.profile.document_prefix
            inputs = [prefix + text for text in texts]
            digest = hashlib.sha256(json.dumps({"profile": profile.profile.id,
                "revision": profile.profile.revision, "kind": kind, "input": inputs},
                ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
            permit = before_send(DispatchRequest(activity_id=ctx.activity_id, attempt_id=attempt_id,
                request_digest=digest, estimate=ReservationEstimate(estimated_units=0),
                source_dependencies=dependencies),
                authorize=lambda tx: _authorize(self.policy, tx, ctx, dependencies, None))
            if (permit.activity_id, permit.attempt_id, permit.request_digest) != (ctx.activity_id, attempt_id, digest):
                raise DomainError("dispatch_permit_invalid", "本地embedding许可与活动不一致")
            started = True

            def compute():
                model = TextEmbedding(model_name=profile.profile.model_id, local_files_only=True,
                    specific_model_path=profile.local_model_path)
                return [list(map(float, vector)) for vector in model.embed(inputs, parallel=None)]

            async def interrupt():
                await cancel.wait()
                outer.cancel()

            timeout = min(profile.profile.request_timeout_seconds, (deadline - self.clock()).total_seconds())
            watcher = asyncio.create_task(interrupt())
            work = asyncio.create_task(asyncio.to_thread(compute))
            async with asyncio.timeout(timeout):
                values = await asyncio.shield(work)
            _check(self.policy, self.clock, ctx, attempt_id, dependencies, cancel, None)
            vectors = _vectors(values, len(texts), profile.profile.dimensions)
        except asyncio.CancelledError:
            external_cancel = not cancel.is_set()
            outer.uncancel()
            error = "cancelled"
        except DomainError as exc:
            error = exc.code
        except TimeoutError:
            error = "model_timeout"
        except (ValueError, OSError, RuntimeError):
            error = "knowledge_embedding_unavailable"
        finally:
            if watcher is not None:
                watcher.cancel()
                with suppress(asyncio.CancelledError):
                    await watcher
            if work is not None:
                # Python线程不能中断；包括重复取消在内，Runtime释放槽位前必须等到退出。
                while not work.done():
                    try:
                        await asyncio.shield(work)
                    except asyncio.CancelledError:
                        external_cancel |= not cancel.is_set()
                        outer.uncancel()
                    except (ValueError, OSError, RuntimeError):
                        break
                failure = work.exception()
                if failure is not None:
                    write_diagnostic(make_diagnostic("knowledge_embedding_unavailable", failure,
                        request_id=ctx.activity_id))
        if external_cancel:
            raise asyncio.CancelledError
        return EmbeddingResult(vectors=vectors, confirmed=True, sent=started, error=error, actual_units=0,
            usage=Usage(output_tokens=0, source="local"))

"""完整出站wire许可与SSE用量证据；不持久化原始网络消息。"""

import hashlib
import json
import re

import httpx2
from pydantic import TypeAdapter, ValidationError

from flowmate.contracts.base import CallId, DomainError
from flowmate.contracts.execution import DispatchRequest, Usage
from flowmate.models.endpoints import resolve_model_endpoint
from flowmate.models.pricing import estimate_request


def strict_json(text):
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError("duplicate JSON key")
            value[key] = item
        return value
    def constant(_):
        raise ValueError("non-finite JSON")
    return json.loads(text, object_pairs_hook=pairs, parse_constant=constant)


class WireEvidence:
    def __init__(self, protocol):
        self.protocol = protocol
        self.buffer = b""
        self._skip_lf = False
        self._data = []
        self._event_bytes = 0
        self.raw_input = self.output = None
        self.cache_read = None
        self.cache_write = None
        self.cache_write_1h = self.cache_write_5m = None if protocol == "anthropic" else 0
        self.price_context = {}
        self.terminal = False
        self.request_id = None
        self.call_ids = {}
        self.item_ids = {}
        self.call_id_conflict = False
        self.response_status = None
        self.response_complete = False

    @staticmethod
    def _count(value):
        if type(value) is not int or not 0 <= value <= 9007199254740991:
            raise DomainError("invalid_response", "模型用量不是有效整数")
        return value

    def feed(self, chunk):
        self.buffer += chunk
        while self.buffer:
            if self._skip_lf:
                if self.buffer.startswith(b"\n"):
                    self.buffer = self.buffer[1:]
                self._skip_lf = False
            boundary = re.search(br"[\r\n]", self.buffer)
            if boundary is None:
                break
            line = self.buffer[:boundary.start()]
            self._skip_lf = boundary.group() == b"\r"
            self.buffer = self.buffer[boundary.end():]
            self._event_bytes += len(line)
            if self._event_bytes > 1048576:
                raise DomainError("invalid_response", "模型流帧超限")
            if not line:
                data, self._data = self._data, []
                self._event_bytes = 0
                if data:
                    self._event(b"\n".join(data))
            elif line == b"data" or line.startswith(b"data:"):
                value = line[5:]
                self._data.append(value[1:] if value.startswith(b" ") else value)
        if len(self.buffer) + self._event_bytes > 1048576:
            raise DomainError("invalid_response", "模型流帧超限")

    def _event(self, value):
        if value == b"[DONE]":
            if self.protocol == "openai_compatible":
                self.terminal = True
            return
        if not value:
            return
        try:
            event = strict_json(value.decode("utf-8"))
            if self.protocol == "openai_compatible":
                for choice in event.get("choices") or []:
                    for call in (choice.get("delta") or {}).get("tool_calls") or []:
                        key = (choice["index"], call["index"])
                        previous = self.call_ids.setdefault(key, None)
                        call_id = call.get("id")
                        # SDK把非空ID作为完整身份更新，参数片段上的省略/null/空串不改变身份。
                        if call_id is not None and call_id != "":
                            if not isinstance(call_id, str) or previous is not None and call_id != previous:
                                self.call_id_conflict = True
                            elif previous is None:
                                self.call_ids[key] = call_id
                usage = event.get("usage") or {}
                if "prompt_tokens" in usage:
                    self.raw_input = self._count(usage["prompt_tokens"])
                if "completion_tokens" in usage:
                    self.output = self._count(usage["completion_tokens"])
                details = usage.get("prompt_tokens_details") or {}
                if details.get("cached_tokens") is not None:
                    self.cache_read = self._count(details["cached_tokens"])
                if details.get("cache_write_tokens") is not None:
                    self.cache_write = self._count(details["cache_write_tokens"])
                tier = event.get("service_tier")
            elif self.protocol == "openai_responses":
                kind = event.get("type")
                if kind in {"response.output_item.added", "response.output_item.done"}:
                    item = event["item"]
                    if item.get("type") == "function_call":
                        self._responses_call(event["output_index"], item)
                terminal = kind in {"response.completed", "response.incomplete", "response.failed"}
                response = event.get("response") or {}
                if terminal:
                    for index, item in enumerate(response.get("output") or []):
                        if item.get("type") == "function_call":
                            self._responses_call(index, item)
                    usage = response.get("usage") or {}
                    if "input_tokens" in usage:
                        self.raw_input = self._count(usage["input_tokens"])
                    if "output_tokens" in usage:
                        self.output = self._count(usage["output_tokens"])
                    details = usage.get("input_tokens_details") or {}
                    if "cached_tokens" in details:
                        self.cache_read = self._count(details["cached_tokens"])
                    if "cache_write_tokens" in details:
                        self.cache_write = self._count(details["cache_write_tokens"])
                    self.terminal = True
                tier = response.get("service_tier")
            else:
                kind = event.get("type")
                if kind == "content_block_start" and (event.get("content_block") or {}).get("type") == "tool_use":
                    self.call_ids[event["index"]] = event["content_block"].get("id")
                usage = ((event.get("message") or {}).get("usage") if kind == "message_start"
                         else event.get("usage")) or {}
                if usage.get("input_tokens") is not None:
                    self.raw_input = self._count(usage["input_tokens"])
                if "output_tokens" in usage and kind == "message_delta":
                    self.output = self._count(usage["output_tokens"])
                if usage.get("cache_read_input_tokens") is not None:
                    self.cache_read = self._count(usage["cache_read_input_tokens"])
                if usage.get("cache_creation_input_tokens") is not None:
                    count = self._count(usage["cache_creation_input_tokens"])
                    if count != self.cache_write:
                        self.cache_write_5m = self.cache_write_1h = None if count else 0
                    self.cache_write = count
                creation = usage.get("cache_creation")
                if creation is not None:
                    self.cache_write_5m = (self._count(creation["ephemeral_5m_input_tokens"])
                                          if "ephemeral_5m_input_tokens" in creation else None)
                    self.cache_write_1h = (self._count(creation["ephemeral_1h_input_tokens"])
                                           if "ephemeral_1h_input_tokens" in creation else None)
                    if (usage.get("cache_creation_input_tokens") is None
                            and self.cache_write_5m is not None and self.cache_write_1h is not None):
                        self.cache_write = self.cache_write_5m + self.cache_write_1h
                tier = usage.get("service_tier")
                self.terminal |= kind == "message_stop"
            if tier is not None:
                if not isinstance(tier, str):
                    raise ValueError("invalid tier")
                self.price_context = {"processing" if tier == "batch" else "service_tier": tier}
        except (ValueError, TypeError, AttributeError, KeyError):
            raise DomainError("invalid_response", "模型流数据无效") from None

    def _responses_call(self, index, item):
        identity = (item.get("id"), item.get("call_id"))
        previous = self.item_ids.setdefault(index, identity)
        if previous != identity:
            self.call_id_conflict = True
        self.call_ids.setdefault(index, item.get("call_id"))

    def check_call_ids(self, sdk_ids):
        # SDK可能给缺失/空ID生成默认值；只能接受wire中真实出现且未改写的身份。
        ids = list(self.call_ids.values())
        try:
            TypeAdapter(list[CallId]).validate_python(ids)
        except ValidationError:
            raise DomainError("invalid_response", "模型工具调用缺少有效身份") from None
        if self.call_id_conflict or len(ids) != len(set(ids)) or ids != sdk_ids:
            raise DomainError("invalid_response", "模型工具调用身份无法唯一配对")

    def usage(self):
        total = self.raw_input
        if total is not None and self.protocol == "anthropic":
            # Messages 的 input_tokens 只含非缓存输入，需要缓存分项才能还原总量。
            total = (total + self.cache_read + self.cache_write
                     if self.cache_read is not None and self.cache_write is not None else None)
        known = (total is not None and self.output is not None and self.cache_write_1h is not None
                 and self.cache_write_5m is not None)
        if total is not None and (self.cache_read or 0) + (self.cache_write or 0) > total:
            raise DomainError("invalid_response", "模型缓存用量不一致")
        if self.cache_write_1h is not None and self.cache_write is not None and self.cache_write_1h > self.cache_write:
            raise DomainError("invalid_response", "模型缓存用量不一致")
        if (self.protocol == "anthropic" and self.cache_write is not None
                and self.cache_write_1h is not None and self.cache_write_5m is not None
                and self.cache_write_1h + self.cache_write_5m != self.cache_write):
            raise DomainError("invalid_response", "模型缓存TTL分类与总量不一致")
        return Usage(input_tokens=total, output_tokens=self.output, cached_input_tokens=self.cache_read,
            cache_read_reported=True if self.cache_read is not None else None,
            cache_write_tokens=self.cache_write, cache_write_1h_tokens=self.cache_write_1h,
            source="provider_wire", status="known" if known else "unknown")


class ObservedStream(httpx2.AsyncByteStream):
    def __init__(self, source, evidence):
        self.source = source
        self.evidence = evidence

    async def __aiter__(self):
        async for chunk in self.source:
            self.evidence.feed(chunk)
            yield chunk
        self.evidence.response_complete = True

    async def aclose(self):
        await self.source.aclose()
        self.evidence.buffer = b""


class GuardTransport(httpx2.AsyncBaseTransport):
    def __init__(self, transport, *, profile, ctx, attempt_id, max_output_tokens,
                 pricing, headers, dependencies, before_send, check, evidence):
        self.transport = transport
        self.profile = profile
        self.ctx = ctx
        self.attempt_id = attempt_id
        self.max_output_tokens = max_output_tokens
        self.pricing = pricing
        self.headers = headers
        self.dependencies = dependencies
        self.before_send = before_send
        self.check = check
        self.evidence = evidence
        self.sent = False

    async def handle_async_request(self, request):
        if self.sent:
            raise DomainError("model_retry_forbidden", "同一模型活动不能自动重发")
        body = await request.aread()
        endpoint = resolve_model_endpoint(self.profile.protocol, self.profile.endpoint).operation_url
        if request.method != "POST" or str(request.url) != endpoint:
            raise DomainError("model_endpoint_mismatch", "模型请求目的地与配置不一致")
        self.check()
        estimate = estimate_request(body, self.max_output_tokens, self.pricing)
        if estimate.input_estimate > self.profile.input_budget(self.max_output_tokens):
            raise DomainError("context_limit", "完整模型请求超出上下文预算，请缩小范围")
        digest = hashlib.sha256(request.method.encode() + b"\n" + str(request.url).encode() + b"\n" + body).hexdigest()
        beta = request.headers.get("anthropic-beta") if self.profile.protocol == "anthropic" else None
        request.headers.clear()
        request.headers.update(self.headers)
        request.headers["host"] = request.url.netloc.decode("ascii")
        request.headers["content-length"] = str(len(body))
        if beta:
            request.headers["anthropic-beta"] = beta
        permit = self.before_send(DispatchRequest(activity_id=self.ctx.activity_id, attempt_id=self.attempt_id,
            request_digest=digest, estimate=estimate,
            source_dependencies=self.dependencies,
            pricing_snapshot=self.pricing.model_dump(mode="json") if self.pricing else None))
        if (permit.activity_id, permit.attempt_id, permit.request_digest) != (
                self.ctx.activity_id, self.attempt_id, digest):
            raise DomainError("dispatch_permit_invalid", "模型发送许可与完整wire不一致")
        self.sent = True
        response = await self.transport.handle_async_request(request)
        self.evidence.response_status = response.status_code
        request_id = response.headers.get("x-request-id") or response.headers.get("request-id")
        if request_id and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", request_id):
            self.evidence.request_id = request_id
        return httpx2.Response(response.status_code, headers=response.headers,
                               stream=ObservedStream(response.stream, self.evidence))

    async def aclose(self):
        await self.transport.aclose()

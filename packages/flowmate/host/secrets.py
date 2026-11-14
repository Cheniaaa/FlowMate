"""凭据和DPAPI包装；只通过私有HostChannel，不持久缓存明文。"""

import base64
import binascii

from pydantic import Field, ValidationError

from flowmate.contracts.base import Contract, DomainError, identifier
from flowmate.host.protocol import HostRequest, ProtectedValue


class _SecretValue(Contract):
    value: str = Field(min_length=1, repr=False)


class _PrivateValue(Contract):
    plaintext_b64: str = Field(repr=False)


def _context(ctx):
    return ctx.model_dump(mode="json") if isinstance(ctx, Contract) else dict(ctx)


class HostSecrets:
    def __init__(self, channel):
        self.channel = channel

    async def _request(self, method, params, model):
        reply = await self.channel.request(HostRequest(request_id=identifier(), method=method, params=params))
        if reply.error is not None:
            raise DomainError(reply.error.code, "宿主私有操作未完成")
        try:
            return model.model_validate(reply.result)
        except ValidationError:
            raise DomainError("host_result_invalid", "宿主私有结果无效") from None

    async def resolve(self, binding):
        result = await self._request("credential.resolve", {"binding": binding.model_dump(mode="json")},
                                     _SecretValue)
        return result.value.encode("utf-8")

    async def protect(self, ctx, plaintext):
        if not isinstance(plaintext, bytes):
            raise DomainError("private_value_invalid", "私有内容须为bytes")
        return await self._request("private.protect", {"context": _context(ctx),
            "plaintext_b64": base64.b64encode(plaintext).decode("ascii")}, ProtectedValue)

    async def unprotect(self, ctx, value):
        result = await self._request("private.unprotect", {"context": _context(ctx),
            "value": value.model_dump(mode="json")}, _PrivateValue)
        try:
            return base64.b64decode(result.plaintext_b64, validate=True)
        except (ValueError, binascii.Error):
            raise DomainError("host_result_invalid", "宿主私有结果编码无效") from None

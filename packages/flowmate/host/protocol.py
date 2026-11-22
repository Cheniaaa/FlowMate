"""有界JSON行协议；值与错误表示不进入公开契约或日志。"""

import json
from typing import Annotated, Literal

from pydantic import Field, JsonValue, ValidationError, model_validator

from flowmate.contracts.base import Contract, DomainError, Id, Version
from flowmate.contracts.settings import Endpoint, ModelProtocol

Method = Literal["credential.resolve", "private.protect", "private.unprotect", "resource.register", "skills.register",
                 "workspace.create_from_directory", "workspace.directory_command_status",
                 "knowledge.expand_directory", "shutdown"]


class HostRequest(Contract):
    protocol_version: Literal[4] = 4
    request_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    # 本地DTO的初值由串行writer覆盖；wire解码仍要求显式正整数。
    stream_seq: int = Field(default=1, ge=1, le=2**64 - 1)
    kind: Literal["request"] = "request"
    method: Method
    params: dict[str, JsonValue] = Field(default_factory=dict, repr=False)


class HostError(Contract):
    code: str = Field(pattern=r"^[a-z][a-z0-9_]{0,95}$")


class HostReply(Contract):
    protocol_version: Literal[4] = 4
    request_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    kind: Literal["reply"] = "reply"
    method: Method
    result: JsonValue = Field(default=None, repr=False)
    error: HostError | None = None

    @model_validator(mode="after")
    def result_or_error(self):
        if ("result" in self.model_fields_set) == ("error" in self.model_fields_set):
            raise ValueError("reply requires exactly one result or error")
        if "error" in self.model_fields_set and self.error is None:
            raise ValueError("error cannot be null")
        return self


class HostEvent(Contract):
    protocol_version: Literal[4] = 4
    request_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    stream_seq: int = Field(default=1, ge=1, le=2**64 - 1)
    kind: Literal["event"] = "event"
    method: Literal["startup", "ready", "notifications.changed", "diagnostic"]
    params: dict[str, JsonValue] = Field(default_factory=dict, repr=False)


class ModelSecretBinding(Contract):
    kind: Literal["model"] = "model"
    connection_id: Id
    connection_version: Version
    protocol: ModelProtocol
    endpoint: Endpoint
    secret_ref: str = Field(min_length=1, max_length=256)


class McpDestination(Contract):
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    cwd: str | None = None
    url: Endpoint | None = None


class McpSecretBinding(Contract):
    kind: Literal["mcp"] = "mcp"
    server_id: Id
    config_revision: Version
    transport: Literal["stdio", "http"]
    destination: McpDestination
    purpose: Literal["env", "http_token"]
    env_name: str | None = None
    secret_ref: str = Field(min_length=1, max_length=256)

    @model_validator(mode="after")
    def check_destination(self):
        destination = self.destination
        if self.transport == "http":
            if (not destination.url or destination.command is not None or destination.args
                    or destination.cwd is not None or self.purpose != "http_token" or self.env_name is not None):
                raise ValueError("HTTP 凭据须绑定确切 URL")
        elif (not destination.command or destination.url is not None or self.purpose != "env"
                or not self.env_name or "=" in self.env_name or "\x00" in self.env_name):
            raise ValueError("stdio 凭据须绑定命令、参数、目录及环境变量名")
        return self


SecretBinding = Annotated[ModelSecretBinding | McpSecretBinding, Field(discriminator="kind")]


class ProtectedValue(Contract):
    format_version: Literal[1] = 1
    protected_b64: str = Field(min_length=1, repr=False)


def encode_frame(frame, max_bytes):
    value = frame.model_dump(mode="json")
    if isinstance(frame, HostReply):
        value.pop("error" if frame.error is None else "result")
    try:
        data = (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode()
    except (ValueError, TypeError, RecursionError):
        raise DomainError("host_frame_invalid", "私有消息编码无效") from None
    if len(data) > max_bytes:
        raise DomainError("host_frame_too_large", "私有消息超出配置上限")
    return data


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _invalid_constant(_):
    raise ValueError("invalid JSON constant")


def decode_frame(data, max_bytes):
    if len(data) > max_bytes:
        raise DomainError("host_frame_too_large", "私有消息超出配置上限")
    try:
        if not data.endswith(b"\n") or b"\n" in data[:-1]:
            raise ValueError("machine frame requires a single complete line")
        value = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_object,
                           parse_constant=_invalid_constant)
        if not isinstance(value, dict) or value.get("protocol_version") != 4:
            raise ValueError("invalid frame envelope")
        if type(value["protocol_version"]) is not int:
            raise ValueError("invalid protocol version type")
        if value["kind"] in {"request", "event"} and "stream_seq" not in value:
            raise ValueError("missing stream sequence")
        model = {"request": HostRequest, "reply": HostReply, "event": HostEvent}[value["kind"]]
        return model.model_validate(value)
    except (ValueError, TypeError, KeyError, RecursionError, ValidationError):
        raise DomainError("host_frame_invalid", "私有消息格式无效") from None

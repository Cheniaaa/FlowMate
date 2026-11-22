"""模型地址的唯一解析入口；发现、SDK 和出站核对共享此结果。"""

from dataclasses import dataclass
from urllib.parse import urlsplit

from flowmate.contracts.settings import ModelProtocol


@dataclass(frozen=True)
class ModelEndpoint:
    protocol: ModelProtocol
    base_url: str
    operation_url: str
    catalog_urls: tuple[str, ...]

    @property
    def sdk_operation_url(self) -> str:
        # 锁定的 Messages SDK 固定追加 /v1/messages；与用户明确选择的操作路径分别保存。
        return self.base_url + "/v1/messages" if self.protocol == "anthropic" else self.operation_url.rstrip("/")


def resolve_model_endpoint(protocol: ModelProtocol, endpoint: str) -> ModelEndpoint:
    """接受基础地址或完整操作 URL；base_url 可直接交给相应 SDK。"""
    base = endpoint.rstrip("/")
    explicit_operation = None
    for suffix, inferred in (("/chat/completions", "openai_compatible"),
                             ("/responses", "openai_responses"), ("/messages", "anthropic")):
        if urlsplit(base).path.endswith(suffix):
            base = base[:-len(suffix)]
            protocol = inferred
            explicit_operation = endpoint
            break
    if protocol == "anthropic":
        base = base.removesuffix("/v1")
        operation = explicit_operation or base + "/v1/messages"
        catalogs = (base + "/v1/models", base + "/models")
    else:
        # 只有根地址补标准版本；自定义前缀保持用户指定的基础路径。
        if explicit_operation is None and not urlsplit(base).path:
            base += "/v1"
        operation = explicit_operation or base + ("/responses" if protocol == "openai_responses" else "/chat/completions")
        alternate = base.removesuffix("/v1") if base.endswith("/v1") else base + "/v1"
        catalogs = (base + "/models", alternate + "/models")
    return ModelEndpoint(protocol, base, operation, catalogs)

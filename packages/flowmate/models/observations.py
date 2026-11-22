"""从真实投影与回执提取能力事实；独立版本化记录不保存消息或凭据。

真实发送的凭据指纹参与身份；同步读取只消费异步 scope 本次核验的指纹。
附加数据库使用调用者的提交/回滚。观察事实不是 Scheduler 的运行状态；
主库使用 WAL 时，不依赖跨数据库崩溃原子性来推进任务。
"""

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path

from flowmate.contracts.execution import (
    ActivityReceipt,
    ModelMessage,
    ReasoningPart,
    TextPart,
    ToolCallPart,
)
from flowmate.contracts.settings import ModelConnection, ResolvedModelProfile
from flowmate.models.contracts import ModelRequest
from flowmate.models.tool_names import wire_names
from flowmate.models.wire import strict_json
from flowmate.persistence.store import UnitOfWork

ObservedCapabilities = dict[str, tuple[bool, str]]


def _binding(profile: ModelConnection | ResolvedModelProfile, credential_id: str) -> str:
    connection_id = profile.id if isinstance(profile, ModelConnection) else profile.connection_id
    version = profile.version if isinstance(profile, ModelConnection) else profile.connection_version
    return hashlib.sha256(json.dumps([connection_id, version, profile.protocol,
        profile.endpoint, profile.secret_ref, credential_id],
        ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def _database(tx: UnitOfWork, *, create: bool) -> bool:
    databases = {row[1]: row[2] for row in tx.execute("PRAGMA database_list")}
    if "model_observations" not in databases:
        path = Path(databases["main"]).parent / "model-observations-v1.sqlite3"
        if not create and not path.exists():
            return False
        tx.execute("ATTACH DATABASE ? AS model_observations", (str(path),))
    if create:
        tx.execute("CREATE TABLE IF NOT EXISTS model_observations.facts ("
            "binding TEXT NOT NULL, model_id TEXT NOT NULL, capability TEXT NOT NULL, "
            "supported INTEGER NOT NULL CHECK(supported IN (0,1)), observed_at TEXT NOT NULL, "
            "PRIMARY KEY(binding,model_id,capability))")
        return True
    # 首次写入的事务回滚后，SQLite 文件存在但表也已回滚。
    return tx.execute("SELECT 1 FROM model_observations.sqlite_master "
        "WHERE type='table' AND name='facts'").fetchone() is not None


def _image(content, protocol: str) -> bool:
    if not isinstance(content, list):
        return False
    for part in content:
        if not isinstance(part, dict):
            continue
        kind = part.get("type")
        if protocol == "openai_compatible" and kind == "image_url" and part.get("image_url", {}).get("url"):
            return True
        if protocol == "openai_responses" and kind == "input_image" and (
                part.get("image_url") or part.get("file_id")):
            return True
        if protocol == "anthropic":
            if kind == "image" and (part.get("source", {}).get("data") or part.get("source", {}).get("url")):
                return True
            if kind == "tool_result" and _image(part.get("content"), protocol):
                return True
    return False


def _projected_image(body: dict, protocol: str) -> bool:
    for message in body.get("input" if protocol == "openai_responses" else "messages", []):
        if not isinstance(message, dict):
            continue
        if message.get("role") in {"user", "system", "developer"} and _image(message.get("content"), protocol):
            return True
        if (protocol == "openai_responses" and message.get("type") == "function_call_output"
                and _image(message.get("output"), protocol)):
            return True
    return False


def _called_tools(body: dict, request: ModelRequest, response: ModelMessage, wire_call_ids: list[str]) -> bool:
    calls = [part for part in response.parts if isinstance(part, ToolCallPart)]
    ids = [part.call_id for part in calls]
    if not ids or ids != wire_call_ids or len(set(ids)) != len(ids) or not all(call.strip() for call in ids):
        return False
    names = wire_names(tool.name for tool in request.tools)
    offered = {tool.get("function", {}).get("name") if request.profile.protocol == "openai_compatible"
        else tool.get("name") for tool in body.get("tools", [])}
    return all(isinstance(part.arguments, dict) and part.name in names and names[part.name] in offered for part in calls)


def _rejected(body: dict, protocol: str, rejection: dict) -> dict[str, bool]:
    # OpenAI SDK 已剥除 error 外层，Anthropic 保留完整响应。
    error = rejection.get("error", rejection)
    if not isinstance(error, dict) or not isinstance(error.get("code"), str) or error["code"] not in {
            "unsupported_parameter", "unknown_parameter", "unsupported_feature"}:
        return {}
    parameter = error.get("param")
    if not isinstance(parameter, str):
        return {}
    fields = {"tools": "tools", "thinking": "thinking", "reasoning": "thinking",
        "response_format": "structured_output", "text.format": "structured_output",
        "output_config.format": "structured_output", "max_tokens": "max_tokens",
        "max_completion_tokens": "max_completion_tokens"}
    if parameter in fields:
        value = body
        for component in parameter.split("."):
            if not isinstance(value, dict) or component not in value:
                return {}
            value = value[component]
        return {fields[parameter]: False}
    # 总 messages/input 字段的拒绝不能说明图片不受支持。
    parameter = re.sub(r"\[(\d+)\]", r".\1", parameter)
    if re.fullmatch(r"(messages|input)\.\d+\.content\.\d+\.(image_url|image|source(\.data)?)", parameter):
        if _projected_image(body, protocol):
            return {"vision": False}
    return {}


class ModelObservations:
    @staticmethod
    def read(tx: UnitOfWork, connection: ModelConnection, model_id: str) -> ObservedCapabilities:
        """同一配置事务读取当前绑定；只读查询不会创建记录文件。"""
        from flowmate.models.discovery import current_credential_identity

        credential_id = current_credential_identity(connection)
        if credential_id is None or connection.secret_ref is None or not _database(tx, create=False):
            return {}
        return {row[0]: (bool(row[1]), row[2]) for row in tx.execute(
            "SELECT capability,supported,observed_at FROM model_observations.facts "
            "WHERE binding=? AND model_id=?", (_binding(connection, credential_id), model_id))}

    @staticmethod
    def record(
        tx: UnitOfWork, request: ModelRequest, receipt: ActivityReceipt, *,
        projection_body: bytes, sent: bool, credential_identity: str,
        response_status: int | None = None,
        response_complete: bool = False, rejection: dict | None = None,
        wire_call_ids: list[str] | None = None,
        observed_at: str | None = None,
    ) -> None:
        """仅接受已发送 wire 投影；完整字段拒绝与成功回执分别提取事实。

        tools 要求当前响应的调用与真实 wire ID、发送的工具定义一一配对。
        历史工具对可能来自其他模型，不能证明当前模型会调用工具。
        400/422 只接受机器可判定的明确字段拒绝，不从任意错误文字猜能力。
        """
        if not sent or request.profile.secret_ref is None:
            return
        body = strict_json(projection_body)
        facts = {}
        if (receipt.confirmed and receipt.error is None and receipt.result is not None
                and (response_status is None or 200 <= response_status < 300)):
            response = ModelMessage.model_validate(receipt.result)
            if response.role != "assistant" or not response.parts:
                return
            if any(isinstance(part, TextPart) and part.text for part in response.parts):
                facts["text"] = True
            if any(isinstance(part, ReasoningPart) and part.text for part in response.parts):
                facts["thinking"] = True
            if _called_tools(body, request, response, wire_call_ids or []):
                facts["tools"] = True
            if _projected_image(body, request.profile.protocol):
                facts["vision"] = True
            if request.output_schema is not None and not any(isinstance(part, ToolCallPart) for part in response.parts):
                # 成功回执已由网关校验原生 Schema；仍核对实际发送的模式，普通 JSON 文本不算。
                if request.profile.protocol == "openai_compatible":
                    native = body.get("response_format", {})
                    schema = native.get("json_schema", {}).get("schema")
                else:
                    native = body.get("text" if request.profile.protocol == "openai_responses"
                        else "output_config", {}).get("format", {})
                    schema = native.get("schema")
                if native.get("type") == "json_schema" and schema is not None:
                    facts["structured_output"] = True
        elif response_complete and response_status in {400, 422} and isinstance(rejection, dict):
            facts = _rejected(body, request.profile.protocol, rejection)
        if not facts:
            return
        timestamp = datetime.fromisoformat(observed_at).astimezone(UTC).isoformat() if observed_at else datetime.now(UTC).isoformat()
        _database(tx, create=True)
        for capability, supported in facts.items():
            tx.execute("INSERT INTO model_observations.facts VALUES (?,?,?,?,?) "
                "ON CONFLICT(binding,model_id,capability) DO UPDATE SET "
                "supported=excluded.supported,observed_at=excluded.observed_at "
                "WHERE excluded.observed_at>facts.observed_at",
                (_binding(request.profile, credential_identity), request.profile.model_id, capability, int(supported), timestamp))

"""工具回执的媒体投影；本地历史保留原调用与产物身份。"""

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import ArtifactRef, ToolResultPart


def tool_content(ctx, part: ToolResultPart, profile, artifacts, *, activity_id, operation):
    from pydantic_ai.messages import BinaryContent

    result = part.result
    if (not operation.startswith("mcp.") or not isinstance(result, dict) or "server_id" not in result
            or not any(item["type"] == "image" for item in result.get("content", ()))):
        if part.error:
            return {"error": part.error, **({"result": result} if result is not None else {})}
        return result
    if result.get("call_id") != part.call_id:
        raise DomainError("invalid_messages", "图片结果与原工具调用不一致")
    content = []
    for item in result["content"]:
        if item["type"] == "image":
            if profile.capabilities.vision is False:
                raise DomainError("vision_model_required", "当前型号只支持文本，请选择视觉模型继续")
            if artifacts is None:
                raise DomainError("artifact_unavailable", "图片产物服务未装配")
            expected = ArtifactRef.model_validate(item["artifact"])
            if expected.activity_id != activity_id:
                raise DomainError("invalid_messages", "图片产物不属于原工具调用")
            ref = artifacts.reference(ctx, expected.id,
                artifact_version=expected.version, content_hash=expected.content_hash)
            if ref != expected or ref.media_type != item["media_type"]:
                raise DomainError("artifact_corrupt", "图片产物与原工具回执不一致")
            artifacts._allow(artifacts.policy.check(ctx, ref.dependencies, "read", artifact_id=ref.id))
            content.append(BinaryContent(artifacts._bytes(ref), media_type=ref.media_type,
                identifier=ref.id))
        elif item["type"] in {"text", "notice"}:
            content.append(item["text"])
        else:
            content.append(item)
    if result.get("structured_content") is not None:
        content.append({"structured_content": result["structured_content"]})
    if result.get("truncated") is True:
        references = {key: result[key] for key in ("artifact_id", "structured_artifact_id", "total_chars") if key in result}
        if references:
            content.append(references)
    if part.error:
        content.append({"error": part.error})
    return content

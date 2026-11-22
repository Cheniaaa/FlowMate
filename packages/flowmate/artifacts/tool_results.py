"""工具回执投影到模型消息及其发布产物的格式。"""

import json

from flowmate.contracts.execution import TextSlice


def receipt_json(result):
    return json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def tool_result_bytes(result):
    return len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def mcp_receipt_text(result):
    return "\n\n".join(result["texts"])


def tool_result_projection(operation, result, *, is_mcp):
    """返回消息字段和仍需绑定发布引用的正文。"""
    preview = {"kind": "artifact_preview", "truncated": True}
    documents = {}
    if is_mcp:
        preview.update({key: result[key] for key in ("server_id", "tool_name", "call_id")})
        body = mcp_receipt_text(result)
        structured = result["structured_content"]
        short_body = tool_result_bytes(result["texts"]) <= 1024
        if body and not short_body:
            documents["artifact_id"] = (body, "text/plain")
        if structured is not None:
            if tool_result_bytes(structured) > 1024:
                documents["structured_artifact_id"] = (receipt_json(structured), "application/json")
            else:
                preview["structured_content"] = structured
        if "content" in result:
            # 保持媒体顺序和现有引用，不复制二进制数据。
            remaining = len(body) if short_body else 512
            ordered = []
            for item in result["content"]:
                if item["type"] in {"text", "notice"}:
                    text = item["text"][:remaining]
                    remaining -= len(text)
                    if text:
                        ordered.append({**item, "text": text})
                else:
                    ordered.append(item)
            preview.update(content=ordered, texts=[
                item["text"] for item in ordered if item["type"] in {"text", "notice"}
            ])
        elif short_body:
            preview["texts"] = result["texts"]
    elif operation == "files.read_text":
        documents["artifact_id"] = (TextSlice.model_validate(result).text, "text/plain")
    elif isinstance(result, str):
        documents["artifact_id"] = (result, "text/plain")
    else:
        documents["artifact_id"] = (receipt_json(result), "application/json")
    if "artifact_id" in documents:
        text, _ = documents["artifact_id"]
        preview.update(preview=text[:1024], total_chars=len(text))
    return preview, documents

"""图片的本地输入预留；服务回执中的用量仍是结算依据。"""

import base64
import json
import math

from flowmate.images import image_size


def image_input_budget(body):
    """移除真正图片字段中的 Base64；按像素块预留，不声称供应商精确 token。"""
    if b"base64" not in body:
        return len(body) + 1024, "utf8_wire_budget"
    images = 0
    reserve = 0

    def image(encoded):
        nonlocal images, reserve
        width, height = image_size(base64.b64decode(encoded, validate=True))
        # 未知网关没有可靠 tokenizer：每 32×32 像素块预留 4，加每图 1024 余量。
        # 这是可解释的本地裁剪策略，不是供应商 token 数，也不是费用硬上界。
        reserve += 1024 + 4 * math.ceil(width / 32) * math.ceil(height / 32)
        images += 1
        return ""

    def strip(value):
        if isinstance(value, dict):
            if value.get("type") in {"image_url", "input_image"}:
                value = dict(value)
                target = value.get("image_url")
                if isinstance(target, dict) and target.get("url", "").startswith("data:image/"):
                    target = dict(target)
                    target["url"] = image(target["url"].split(",", 1)[1])
                    value["image_url"] = target
                elif isinstance(target, str) and target.startswith("data:image/"):
                    value["image_url"] = image(target.split(",", 1)[1])
                return value
            if value.get("type") == "image" and isinstance(value.get("source"), dict):
                source = value["source"]
                if source.get("type") == "base64" and source.get("media_type") in {"image/png", "image/jpeg"}:
                    return {**value, "source": {**source, "data": image(source["data"])}}
            return {key: strip(item) for key, item in value.items()}
        if isinstance(value, list):
            return [strip(item) for item in value]
        return value

    stripped = strip(json.loads(body))
    if not images:
        return len(body) + 1024, "utf8_wire_budget"
    return len(json.dumps(stripped, ensure_ascii=False, separators=(",", ":")).encode()) + reserve + 1024, "local_image_reserve"

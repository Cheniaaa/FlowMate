"""内部工具身份与厂商wire名称映射。"""

import re

from flowmate.contracts.base import DomainError


def wire_names(names):
    result, owners = {}, {}
    for name in names:
        wire = name.replace(".", "__")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", wire):
            raise DomainError("tool_name_unsupported", "工具名称不能用于当前模型协议")
        if wire in owners and owners[wire] != name:
            raise DomainError("tool_name_conflict", "工具名称映射发生冲突")
        owners[wire] = name
        result[name] = wire
    return result

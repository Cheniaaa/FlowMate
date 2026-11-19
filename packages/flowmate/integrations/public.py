"""目录的公共用户投影；扩展注解不进入 UI 或可信策略。"""

from flowmate.integrations.contracts import McpCatalog


def public_catalog(catalog: McpCatalog) -> McpCatalog:
    hints = {"readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"}
    return catalog.model_copy(update={"tools": tuple(
        tool.model_copy(update={"annotations": {
            key: value for key, value in tool.annotations.items()
            if key in hints and type(value) is bool
        } if tool.annotations is not None else None}) for tool in catalog.tools
    )})

"""知识能力以普通只读工具进入现有调用、错误回填和权限链。"""

import asyncio

from flowmate.contracts.base import DomainError
from flowmate.knowledge.contracts import (
    KnowledgeListRequest,
    KnowledgeReadRequest,
    KnowledgeResult,
    KnowledgeSearchRequest,
)
from flowmate.policy.contracts import ToolInvocation
from flowmate.tools.catalog import ToolOutcome, ToolSpec


def register_knowledge_tools(catalog, knowledge):
    async def sources(ctx, args, cancel):
        result = knowledge.list_for_task(ctx, KnowledgeListRequest.model_validate(args))
        return outcome(ctx, result, cancel)

    async def search(ctx, args, cancel):
        from flowmate.contracts.execution import ActivitySnapshot
        from flowmate.runtime.transitions import load

        with knowledge.store.transaction(write=False) as tx:
            activity = load(tx, ActivitySnapshot, ctx.activity_id)
        invocation = ToolInvocation.model_validate(activity.intent.arguments)
        binding = knowledge.prepare_search(ctx, invocation.call_id, KnowledgeSearchRequest.model_validate(args))
        vector, error = knowledge.embedding.query_result(binding) if knowledge.embedding else (None, None)
        result = await asyncio.to_thread(knowledge.search, ctx, binding, query_vector=vector, vector_error=error)
        return outcome(ctx, result, cancel)

    async def read(ctx, args, cancel):
        result = await asyncio.to_thread(knowledge.read, ctx, KnowledgeReadRequest.model_validate(args))
        return outcome(ctx, result, cancel)

    def outcome(ctx, result, cancel):
        if cancel.is_set():
            raise DomainError("tool_cancelled", "知识读取已取消")
        return ToolOutcome(result=result.model_dump(mode="json"),
            dependencies=knowledge.result_dependencies(ctx, result))

    for name, model, handler, description in (
        ("knowledge.list_sources", KnowledgeListRequest, sources, "列出当前任务获准使用的项目资料与处理状态。"),
        ("knowledge.search", KnowledgeSearchRequest, search,
            "检索项目资料并返回可核对的原文证据。根任务及成员合计首次一次、最多三次补查。空结果可改写问题补查。"),
        ("knowledge.read", KnowledgeReadRequest, read,
            "按来源ID读取准确版本的原文。可指定已有证据ID精读，offset以字符计，不接受路径。"),
    ):
        catalog.register(ToolSpec(name=name, version="1", description=description,
            input_schema=model.model_json_schema(mode="validation"),
            result_schema=KnowledgeResult.model_json_schema(mode="serialization"),
            background_supported=True, cancellation="cooperative", retry_class="read_only"),
            handler, input_model=model, result_model=KnowledgeResult)

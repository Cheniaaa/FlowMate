"""普通候选和当前用户明确提出的长期写入建议使用同一来源契约。"""

from uuid import UUID, uuid5

from flowmate.contracts.base import CommandMeta, DomainError
from flowmate.memory.contracts import MemoryProposal, MemoryProposalReceipt, MemoryRememberReceipt
from flowmate.tools.catalog import ToolOutcome, ToolSpec


def register_memory_tools(catalog, memory):
    async def propose(ctx, args, cancel):
        if cancel.is_set():
            raise DomainError("tool_cancelled", "记忆提案已取消")
        record = memory.propose(ctx, args, CommandMeta(command_id=str(uuid5(UUID(ctx.activity_id), "memory.propose"))))
        # 工具结果仅回本次实际提出的主张，不加载其他记忆或授予发送许可。
        return ToolOutcome(result=MemoryProposalReceipt(id=record.id, revision=record.revision,
            status=record.status).model_dump(mode="json"))

    catalog.register(ToolSpec(name="memory.propose", version="1",
        input_schema=MemoryProposal.model_json_schema(mode="validation"),
        result_schema=MemoryProposalReceipt.model_json_schema(mode="serialization"),
        background_supported=False, cancellation="cooperative", retry_class="idempotent"),
        propose, input_model=MemoryProposal, result_model=MemoryProposalReceipt)

    async def remember(ctx, args, cancel):
        if cancel.is_set():
            raise DomainError("tool_cancelled", "记忆操作已取消")
        from flowmate.memory.intent import stage
        return ToolOutcome(result=stage(memory, ctx, args).model_dump(mode="json"))

    catalog.register(ToolSpec(name="memory.remember", version="1", description=(
        "仅用于当前用户明确请求长期记住或纠正的内容。宿主核对真实用户原话、范围和当前记录。"
        "一次性要求无需调用。写入在本轮完成时落盘。"),
        input_schema=MemoryProposal.model_json_schema(mode="validation"),
        result_schema=MemoryRememberReceipt.model_json_schema(mode="serialization"),
        background_supported=False, cancellation="cooperative", retry_class="idempotent"),
        remember, input_model=MemoryProposal, result_model=MemoryRememberReceipt)

"""普通工具目录注册；继续使用既有 Gateway 与 Task/Activity。"""

from flowmate.skills.execution.contracts import RunSkillScript, ScriptExecutionResult
from flowmate.tools.catalog import ToolSpec


def register_script_tool(catalog, execution):
    async def run(ctx, args, cancel):
        return await execution.run(ctx, RunSkillScript.model_validate(args), cancel)

    def resolve(tx, ctx, args):
        return execution.resolve_dependencies(tx, ctx, RunSkillScript.model_validate(args))

    catalog.register(ToolSpec(
        name="skills.run_script", version="1",
        input_schema=RunSkillScript.model_json_schema(),
        result_schema=ScriptExecutionResult.model_json_schema(mode="serialization"),
        background_supported=True, cancellation="best_effort", retry_class="never",
        required_purposes=["read", "local_process_send"], requires_approval=True,
    ), run, input_model=RunSkillScript, result_model=ScriptExecutionResult,
        resolve_dependencies=resolve)

"""运行环境设置只使用显式安全投影，不暴露执行配置或私有绑定。"""

from fastapi import APIRouter, Response

from flowmate.api.contracts import Command, Page
from flowmate.api.queries import _page
from flowmate.api.routes import body
from flowmate.contracts.base import Id
from flowmate.processes.contracts import (
    ExecutionEnvironment,
    ExecutionEnvironmentCommandStatus,
    ExecutionEnvironmentView,
    SaveExecutionEnvironment,
)


def router(runtime):
    route = APIRouter(prefix="/v3/settings/execution-environments")

    @route.get("", response_model=Page[ExecutionEnvironmentView])
    async def listing(response: Response, limit: int = 100, cursor: str | None = None):
        environments = runtime.environments
        response.headers["Cache-Control"] = "no-store"
        with environments.store.transaction(write=False) as tx:
            return _page(tx, ExecutionEnvironmentView, "execution_environments",
                "SELECT id,document FROM execution_environments", [], limit=limit, cursor=cursor,
                decode=lambda row: environments._view(
                    ExecutionEnvironment.model_validate_json(row["document"])))

    @route.put("", response_model=ExecutionEnvironmentView)
    async def save(response: Response, command=body(Command[SaveExecutionEnvironment])):
        response.headers["Cache-Control"] = "no-store"
        return runtime.environments.save_view(command.data, command.meta)

    @route.get("/commands/{id}", response_model=ExecutionEnvironmentCommandStatus)
    async def status(id: Id, response: Response):
        response.headers["Cache-Control"] = "no-store"
        return runtime.environments.command_status(id)

    @route.get("/{id}", response_model=ExecutionEnvironmentView)
    async def get(id: Id, response: Response):
        response.headers["Cache-Control"] = "no-store"
        return runtime.environments.get_view(id)

    @route.post("/{id}/probe", response_model=ExecutionEnvironmentView)
    async def probe(id: Id, response: Response):
        environments = runtime.environments
        response.headers["Cache-Control"] = "no-store"
        await environments.probe(id)
        return environments.get_view(id)

    return route

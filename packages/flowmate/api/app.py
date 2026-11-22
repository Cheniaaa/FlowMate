"""HTTP出口不拥有运行状态。"""

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException

from flowmate.api.auth import Authentication
from flowmate.api.contracts import ErrorBody, ErrorEnvelope
from flowmate.api.routes import router
from flowmate.contracts.base import DomainError, identifier
from flowmate.host.diagnostics import make_diagnostic


def create_app(runtime, connection_policy, *, host):
    app = FastAPI(docs_url=None, redoc_url=None)
    app.add_middleware(Authentication, policy=connection_policy)
    app.include_router(router(runtime))
    from flowmate.api.memory import router as memory_router
    app.include_router(memory_router(runtime))
    from flowmate.api.capabilities import router as capabilities_router
    app.include_router(capabilities_router(runtime))
    from flowmate.api.mcp import router as mcp_router
    app.include_router(mcp_router(runtime.mcp, publisher=runtime.mcp_tools))
    from flowmate.api.execution_environments import router as environments_router
    from flowmate.api.skill_execution import router as script_router
    app.include_router(environments_router(runtime))
    app.include_router(script_router(runtime))
    from flowmate.api.knowledge import router as knowledge_router
    app.include_router(knowledge_router(runtime))

    def failure(code, message, status, *, retryable=False, related_ids=()):
        return JSONResponse(ErrorEnvelope(error=ErrorBody(code=code, safe_message=message,
            retryable=retryable, related_ids=list(related_ids))).model_dump(mode="json"), status_code=status)

    @app.exception_handler(DomainError)
    async def domain_error(request, error):
        status = 404 if error.code == "not_found" else 410 if error.code == "snapshot_required" else 409
        return failure(error.code, error.safe_message, status, retryable=error.retryable, related_ids=error.related_ids)

    @app.exception_handler(RequestValidationError)
    @app.exception_handler(ValidationError)
    async def invalid(request, error):
        return failure("invalid_request", "请求不符合公开契约", 422)

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        return failure("not_found" if error.status_code == 404 else "http_error", "请求未完成", error.status_code)

    @app.exception_handler(Exception)
    async def unexpected(request, error):
        request_id = identifier()
        await host.diagnostic(make_diagnostic("api_internal_error", error, request_id=request_id))
        return failure("internal_error", "操作未完成", 500)

    return app

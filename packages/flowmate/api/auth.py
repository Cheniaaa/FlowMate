"""本机连接凭据和浏览器来源边界。"""

from dataclasses import dataclass
from secrets import compare_digest

from starlette.responses import JSONResponse, Response

from flowmate.api.contracts import ErrorBody, ErrorEnvelope


@dataclass(frozen=True)
class ConnectionPolicy:
    token: str
    allowed_origins: list[str]
    bound_host: str


class Authentication:
    def __init__(self, app, policy):
        self.app = app
        self.policy = policy

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {key.decode().lower(): value.decode() for key, value in scope["headers"]}
        origin = headers.get("origin")
        code = None
        if headers.get("host") != self.policy.bound_host:
            code = "forbidden_host"
        elif origin not in self.policy.allowed_origins:
            code = "forbidden_origin"
        elif scope["method"] != "OPTIONS" and not compare_digest(
                headers.get("authorization", ""), "Bearer " + self.policy.token):
            code = "unauthorized"
        if code:
            response = JSONResponse(ErrorEnvelope(error=ErrorBody(code=code,
                safe_message="本机连接验证失败")).model_dump(mode="json"), status_code=401 if code == "unauthorized" else 403)
            await response(scope, receive, send)
            return
        cors = [(b"access-control-allow-origin", origin.encode()), (b"vary", b"Origin")]
        if scope["method"] == "OPTIONS":
            await Response(status_code=204, headers={"Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
                "Access-Control-Allow-Headers": "Authorization,Content-Type", "Vary": "Origin"})(scope, receive, send)
            return
        async def authorized_send(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message.get("headers", []), *cors]}
            await send(message)
        await self.app(scope, receive, authorized_send)

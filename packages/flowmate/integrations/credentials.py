"""可信宿主的 MCP 凭据引用接线，不持久缓存秘密。"""

from flowmate.contracts.base import DomainError
from flowmate.host.protocol import McpDestination, McpSecretBinding


class McpCredentials:
    def __init__(self, secrets, *, current, request_timeout_seconds=30.0):
        self.secrets = secrets
        self.current = current
        self.request_timeout_seconds = request_timeout_seconds

    def check(self, config):
        current = self.current(config.id)
        if current != config or not current.enabled:
            raise DomainError("blocked_incompatible", "MCP 配置或许可已改变")

    @staticmethod
    def binding(config, *, env_name=None):
        return McpSecretBinding(
            server_id=config.id, config_revision=config.revision, transport=config.transport,
            destination=McpDestination(command=config.command, args=config.args, cwd=config.cwd, url=config.url),
            purpose="env" if env_name is not None else "http_token", env_name=env_name,
            secret_ref=config.env_refs[env_name] if env_name is not None else config.credential_ref,
        )

    async def environment(self, config):
        self.check(config)
        env = {
            name: (await self.secrets.resolve(self.binding(config, env_name=name))).decode("utf-8")
            for name in config.env_refs
        }
        self.check(config)
        return env

    async def http_client(self, config, *, transport=None):
        import httpx2

        self.check(config)
        credentials = self

        class BoundAuth(httpx2.Auth):
            async def async_auth_flow(self, request):
                try:
                    credentials.check(config)
                    if request.url != httpx2.URL(config.url):
                        raise DomainError("credential_binding_changed", "认证目的地与固定 URL 不符")
                    if config.credential_ref is not None:
                        token = (await credentials.secrets.resolve(credentials.binding(config))).decode("utf-8")
                        credentials.check(config)
                        request.headers["Authorization"] = f"Bearer {token}"
                except DomainError:
                    # SDK 的 HTTP task group 仅把 RequestError 识别为传输失败；
                    # 不把宿主异常原文或配置值带入其日志/退出异常。
                    raise httpx2.RequestError("MCP authentication unavailable", request=request) from None
                yield request

        return httpx2.AsyncClient(
            auth=BoundAuth(), trust_env=False, follow_redirects=False,
            timeout=self.request_timeout_seconds, transport=transport,
        )

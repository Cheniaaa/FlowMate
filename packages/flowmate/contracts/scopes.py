"""来源作用域；本机用户身份只由 Store 决定。"""

from typing import Literal

from pydantic import model_validator

from flowmate.contracts.base import Contract, Id


class ScopeRef(Contract):
    kind: Literal["user_global", "workspace", "session"]
    workspace_id: Id | None = None
    session_id: Id | None = None

    @model_validator(mode="after")
    def check_identity(self):
        if ((self.kind == "user_global" and (self.workspace_id is not None or self.session_id is not None))
                or (self.kind == "workspace" and (self.workspace_id is None or self.session_id is not None))
                or (self.kind == "session" and (self.workspace_id is None or self.session_id is None))):
            raise ValueError("作用域类型与身份不匹配")
        return self

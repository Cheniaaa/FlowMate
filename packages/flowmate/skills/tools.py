"""Skill 指导读取与待用户确认的包候选。"""

import base64
import binascii
from typing import Literal
from uuid import UUID, uuid5

from pydantic import Field, model_validator

from flowmate.contracts.base import CommandMeta, Contract, DomainError, Id
from flowmate.skills.contracts import ContentHash, SkillFileSlice
from flowmate.skills.packages import SkillPackageError, import_directory
from flowmate.tools.catalog import ToolOutcome, ToolSpec


class SkillRead(Contract):
    skill_id: Id
    content_hash: ContentHash
    relative_path: str = Field(min_length=1, max_length=1024)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=2000, ge=1, le=16000)


class SkillFileInput(Contract):
    encoding: Literal["utf-8", "base64"]
    content: str


class SkillProposal(Contract):
    directory_name: str = Field(min_length=1)
    files: dict[str, SkillFileInput] = Field(min_length=1)
    skill_id: Id | None = None
    base_hash: ContentHash | None = None

    @model_validator(mode="after")
    def base_identity(self):
        if (self.skill_id is None) != (self.base_hash is None):
            raise ValueError("编辑候选须同时绑定 Skill 与基础版本")
        return self


class SkillProposalReceipt(Contract):
    id: Id
    staging_ref: Id
    skill_id: Id
    content_hash: ContentHash
    status: Literal["candidate"] = "candidate"


def register_skill_tools(catalog, skills):
    def uses(tx, ctx, args):
        if args.get("skill_id") is None:
            return {"read": []}
        version = skills.reference(ctx, args["skill_id"],
            args["content_hash"] if "content_hash" in args else args["base_hash"], tx=tx)
        return {"read": skills.dependencies(tx, version)}

    async def read(ctx, args, cancel):
        if cancel.is_set():
            raise DomainError("tool_cancelled", "Skill 读取已取消")
        return skills.read(ctx, args["skill_id"], args["content_hash"], args["relative_path"],
            offset=args["offset"], limit=args["limit"])

    async def propose(ctx, args, cancel):
        if cancel.is_set():
            raise DomainError("tool_cancelled", "Skill 候选生成已取消")
        try:
            package = import_directory(args["directory_name"], {path:
                value["content"].encode("utf-8") if value["encoding"] == "utf-8"
                else base64.b64decode(value["content"], validate=True) for path, value in args["files"].items()})
        except (UnicodeError, binascii.Error):
            raise DomainError("skill_package_invalid", "候选文件编码无效") from None
        except SkillPackageError as error:
            raise DomainError(error.code, str(error)) from None
        candidate = skills.stage_generated(ctx, package, CommandMeta(command_id=str(
            uuid5(UUID(ctx.activity_id), "skills.propose"))), skill_id=args["skill_id"], base_hash=args["base_hash"])
        return ToolOutcome(result=SkillProposalReceipt(id=candidate.id, staging_ref=candidate.staging_ref,
            skill_id=candidate.skill_id, content_hash=candidate.content_hash).model_dump(mode="json"),
            dependencies=candidate.dependencies)

    for name, model, result, handler, retry in (
        ("skills.read", SkillRead, SkillFileSlice, read, "read_only"),
        ("skills.propose", SkillProposal, SkillProposalReceipt, propose, "idempotent"),
    ):
        catalog.register(ToolSpec(name=name, version="1",
            input_schema=model.model_json_schema(mode="validation"),
            result_schema=result.model_json_schema(mode="serialization"),
            background_supported=False, cancellation="cooperative", retry_class=retry,
            required_purposes=["read"]), handler, input_model=model, result_model=result,
            resolve_dependencies=uses)

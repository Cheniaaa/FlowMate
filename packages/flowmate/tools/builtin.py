"""内置文本工具装配。"""

import asyncio
from dataclasses import asdict
from typing import Literal

from pydantic import Field, create_model

from flowmate.contracts.base import Contract, Count, DomainError, Id, Version
from flowmate.contracts.execution import (
    ArtifactRef,
    Checkpoint,
    ExportReceipt,
    ModelMessage,
    ScopeDependency,
    SourceObservation,
    TextSlice,
)
from flowmate.policy.contracts import NativeSelection, ResourceRef
from flowmate.tools.catalog import ToolOutcome, ToolSpec
from flowmate.tools.files import FileAnchor


class ResourcePage(Contract):
    items: list[ResourceRef]
    next_cursor: str | None


class InspectedFile(Contract):
    resource_id: Id
    source_version: str
    size_bytes: Count
    line_count: Count


class BatchResult(Contract):
    items: list[InspectedFile]


class ExportInput(Contract):
    artifact_id: Id
    artifact_version: Version
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    target_ref: Id
    expected_target_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


def context_dependencies(tx, ctx):
    """保守继承当前Task已提交消息；实际上下文裁剪由ContextBuilder负责。"""
    dependencies = list(ctx.scope_dependencies)
    for row in tx.execute("SELECT document FROM messages WHERE task_id=? ORDER BY rowid", (ctx.task_id,)):
        dependencies.extend(ModelMessage.model_validate_json(row[0]).source_dependencies)
    from flowmate.agents.checkpoint import content_dependencies
    from flowmate.runtime.transitions import load
    return content_dependencies(load(tx, Checkpoint, ctx.task_id), dependencies)


def _anchor(resource):
    if resource.kind not in {"file", "directory"}:
        raise DomainError("file_resource_invalid", "此资源不是可读文本来源")
    return FileAnchor(resource.canonical_path, resource.file_identity, resource.kind)


def _observed(resource, result):
    observation = SourceObservation(resource_id=resource.id, expected_version=resource.version,
                                     source_version=result.source_version)
    epoch = resource.version + (resource.source_version != result.source_version)
    return observation, ScopeDependency(scope_id=resource.id, epoch=epoch)


def register_builtin_tools(catalog, policy, files, artifacts, config):
    list_input = create_model("ListFilesInput", __base__=Contract, resource_id=(Id, ...),
        cursor=(str | None, None), limit=(int, Field(default=config.default_page_size,
                                                   ge=1, le=config.max_page_size)))
    read_input = create_model("ReadTextInput", __base__=Contract, resource_id=(Id, ...),
        source_version=(str | None, Field(default=None, pattern=r"^[0-9a-f]{64}$")),
        offset=(Count, 0), limit=(int, Field(default=config.max_read_chars, ge=1, le=config.max_read_chars)))
    batch_input = create_model("InspectBatchInput", __base__=Contract,
        resource_ids=(list[Id], Field(min_length=1, max_length=config.max_batch_files)))
    create_input = create_model("CreateTextInput", __base__=Contract,
        text=(str, Field(max_length=config.max_file_bytes)),
        media_type=(Literal["text/plain", "text/markdown"], "text/markdown"))
    artifact_input = create_model("ReadArtifactInput", __base__=Contract, artifact_id=(Id, ...),
        offset=(Count, 0), limit=(int, Field(default=config.max_read_chars, ge=1, le=config.max_read_chars)))

    def resources(tx, ctx, args):
        ids = args["resource_ids"] if "resource_ids" in args else [args["resource_id"]]
        return {"read": [ScopeDependency(scope_id=record.id, epoch=record.version)
                         for id in ids for record in [policy.resource(ctx, id, tx=tx)]]}

    def history(tx, ctx, args):
        return {"read": context_dependencies(tx, ctx)}

    def artifact_sources(tx, ctx, args):
        return {"read": artifacts.reference(ctx, args["artifact_id"], tx=tx).dependencies}

    def export_sources(tx, ctx, args):
        result = {"read": artifacts.reference(ctx, args["artifact_id"], tx=tx,
            artifact_version=args["artifact_version"], content_hash=args["content_hash"]).dependencies}
        target = policy.resource(ctx, args["target_ref"], tx=tx)
        if target.kind != "export":
            raise DomainError("export_target_invalid", "导出目标须来自原生保存选择")
        result["export"] = [ScopeDependency(scope_id=target.id, epoch=target.version)]
        return result

    async def list_files(ctx, args, cancel):
        resource = policy.resource(ctx, args["resource_id"])
        page = await asyncio.to_thread(files.list_files, _anchor(resource), cursor=args["cursor"],
                                        limit=args["limit"], cancel=cancel.is_set)
        refs = [policy.register_child(ctx, resource.id, NativeSelection(scope=resource.scope,
            kind=entry.anchor.kind, canonical_path=entry.anchor.canonical_path,
            file_identity=entry.anchor.identity)) for entry in page.items]
        return ToolOutcome(result=ResourcePage(items=refs, next_cursor=page.next_cursor).model_dump(mode="json"))

    async def read_text(ctx, args, cancel):
        resource = policy.resource(ctx, args["resource_id"])
        result = await asyncio.to_thread(files.read_text, _anchor(resource),
            source_version=args["source_version"], offset=args["offset"], limit=args["limit"], cancel=cancel.is_set)
        observation, dependency = _observed(resource, result)
        return ToolOutcome(result=TextSlice(**{key: value for key, value in asdict(result).items()
            if key in TextSlice.model_fields}).model_dump(mode="json"),
            dependencies=[dependency], source_observations=[observation])

    async def inspect_batch(ctx, args, cancel):
        records = [policy.resource(ctx, id) for id in args["resource_ids"]]
        results = await asyncio.to_thread(files.inspect_batch, [_anchor(record) for record in records],
                                          cancel=cancel.is_set)
        observations, dependencies, entries = [], [], []
        for record, result in zip(records, results, strict=True):
            observation, dependency = _observed(record, result)
            observations.append(observation)
            dependencies.append(dependency)
            entries.append(InspectedFile(resource_id=record.id, source_version=result.source_version,
                                          size_bytes=result.size_bytes, line_count=result.line_count))
        return ToolOutcome(result=BatchResult(items=entries).model_dump(mode="json"),
                            dependencies=dependencies, source_observations=observations)

    async def create_text(ctx, args, cancel):
        with policy.store.transaction(write=False) as tx:
            dependencies = context_dependencies(tx, ctx)
        staged = await asyncio.to_thread(artifacts.stage_text, ctx, args["text"], args["media_type"], dependencies)
        return ToolOutcome(result=staged.ref.model_dump(mode="json"), dependencies=staged.ref.dependencies,
                            staged_artifacts=[staged])

    async def read_artifact(ctx, args, cancel):
        result = await asyncio.to_thread(artifacts.read, ctx, args["artifact_id"], args["offset"], args["limit"])
        return ToolOutcome(result=result.model_dump(mode="json"))

    async def export_artifact(ctx, args, cancel):
        selection = policy.resource(ctx, args["target_ref"])
        result = await asyncio.to_thread(artifacts.export, ctx, args["artifact_id"], selection,
            args["expected_target_hash"], artifact_version=args["artifact_version"], content_hash=args["content_hash"])
        return ToolOutcome(result=result.model_dump(mode="json"))

    def register(name, handler, input_model, result_model, resolver, *, background=False,
                 approval=False, visible=True, purposes=("read",), retry="read_only", version="1"):
        catalog.register(ToolSpec(name=name, version=version, input_schema=input_model.model_json_schema(),
            result_schema=result_model.model_json_schema(mode="serialization"),
            background_supported=background, cancellation="cooperative" if retry == "read_only" else "best_effort",
            retry_class=retry, required_purposes=list(purposes), requires_approval=approval,
            model_visible=visible), handler, input_model=input_model, result_model=result_model,
            resolve_dependencies=resolver)

    register("files.list", list_files, list_input, ResourcePage, resources)
    register("files.read_text", read_text, read_input, TextSlice, resources)
    register("files.inspect_batch", inspect_batch, batch_input, BatchResult, resources, background=True)
    register("artifacts.create_text", create_text, create_input, ArtifactRef, history, retry="idempotent")
    register("artifacts.read", read_artifact, artifact_input, TextSlice, artifact_sources)
    register("artifacts.export", export_artifact, ExportInput, ExportReceipt, export_sources,
             approval=True, visible=False, purposes=("read", "export"), retry="never", version="2")

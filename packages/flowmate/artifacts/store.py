"""产物内容先暂存，引用只在Activity回执事务发布。"""

import hashlib
import os
from pathlib import Path

from flowmate.config import RuntimeConfig
from flowmate.contracts.base import DomainError, identifier
from flowmate.contracts.execution import (
    ActivitySnapshot,
    ArtifactRef,
    ExportReceipt,
    RunSnapshot,
    RuntimeChange,
    ScopeDependency,
    StagedArtifact,
    TextSlice,
)
from flowmate.runtime.transitions import check_scopes, context_for, emit, load
from flowmate.tools.export_publication import ExportPublication
from flowmate.tools.files import ExportTarget, FileAnchor


class ArtifactStore:
    def __init__(self, store, policy, files, *, config=None):
        self.store = store
        self.policy = policy
        self.files = files
        self.config = config or RuntimeConfig()
        self.publication = ExportPublication(store, files, store.path.parent / "export-recovery")
        self.root = store.path.parent / "artifacts" / "blobs"
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, content_hash):
        return self.root / (content_hash + ".blob")

    def _bytes(self, ref):
        try:
            with self._path(ref.content_hash).open("rb") as handle:
                data = handle.read(self.config.max_file_bytes + 1)
        except FileNotFoundError:
            raise DomainError("artifact_missing", "产物内容缺失") from None
        if (len(data) > self.config.max_file_bytes
                or hashlib.sha256(data).hexdigest() != ref.content_hash):
            raise DomainError("artifact_corrupt", "产物内容校验失败")
        return data

    @staticmethod
    def _allow(decision):
        if not decision.allowed:
            raise DomainError(decision.reason or "grant_required", "产物来源授权不可用")
        return decision.dependencies

    def stage_text(self, ctx, text, media_type, dependencies):
        if ctx.activity_id is None:
            raise DomainError("activity_required", "产物必须属于实际Activity")
        if not isinstance(text, str) or media_type not in {"text/plain", "text/markdown"}:
            raise DomainError("artifact_type_invalid", "只支持文本产物")
        data = text.encode("utf-8")
        if len(data) > self.config.max_file_bytes:
            raise DomainError("artifact_too_large", "产物超过配置大小限制")
        # 暂存与回收共享写事务：引用提交前的有效内容不能被孤儿回收误删。
        with self.store.transaction() as tx:
            source_ids = {item.scope_id for item in [*ctx.scope_dependencies, *dependencies]}
            self.policy.check_run_sources(tx, ctx, dependencies)
            checked = self._allow(self.policy.check_tx(tx, ctx, dependencies, "read"))
            # 保留实际来源与使用的grant；授权检查临时展开的资源不是产物正文来源。
            dependencies = [item for item in checked if item.scope_id in source_ids or tx.execute(
                "SELECT 1 FROM grants WHERE id=?", (item.scope_id,)).fetchone()]
            ref = ArtifactRef(content_hash=hashlib.sha256(data).hexdigest(), task_id=ctx.task_id,
                              activity_id=ctx.activity_id, dependencies=dependencies, media_type=media_type)
            target = self._path(ref.content_hash)
            tx.execute("INSERT INTO artifact_staging VALUES (?,?,?,?,?)", (ref.id, ref.content_hash,
                ctx.workspace_id, ctx.session_id, ctx.activity_id))
            if target.exists():
                self._bytes(ref)
            else:
                temporary = self.root / (identifier() + ".tmp")
                try:
                    with temporary.open("xb") as handle:
                        handle.write(data)
                        handle.flush()
                        os.fsync(handle.fileno())
                    os.replace(temporary, target)
                finally:
                    temporary.unlink(missing_ok=True)
        return StagedArtifact(ref=ref, blob_path=str(target), media_type=media_type)

    def publish(self, tx, staged):
        ref = staged.ref
        if Path(staged.blob_path) != self._path(ref.content_hash) or staged.media_type != ref.media_type:
            raise DomainError("artifact_stage_invalid", "产物暂存引用不一致")
        ctx = context_for(tx, ref.task_id).model_copy(update={"activity_id": ref.activity_id})
        activity = load(tx, ActivitySnapshot, ref.activity_id)
        if activity.task_id != ref.task_id or activity.state != "dispatched":
            raise DomainError("artifact_stage_invalid", "产物不属于当前已派发活动")
        self.policy.check_run_sources(tx, ctx, ref.dependencies)
        self._allow(self.policy.check_tx(tx, ctx, ref.dependencies, "read"))
        self._bytes(ref)
        existing = tx.execute("SELECT document FROM artifacts WHERE id=?", (ref.id,)).fetchone()
        if existing:
            if ArtifactRef.model_validate_json(existing[0]) != ref:
                raise DomainError("artifact_conflict", "同一产物身份不能更改内容或来源")
            return ref
        run = load(tx, RunSnapshot, ctx.run_id)
        emit(tx, run, ctx.task_id, "artifact.published", RuntimeChange(artifacts=[ref]))
        tx.execute("DELETE FROM artifact_staging WHERE id=?", (ref.id,))
        return ref

    def reference(self, ctx, artifact_id, *, tx=None, for_user=False):
        if tx is None:
            with self.store.transaction(write=False) as tx:
                return self.reference(ctx, artifact_id, tx=tx, for_user=for_user)
        actual = context_for(tx, ctx.task_id)
        if actual != ctx.model_copy(update={"activity_id": None}):
            raise DomainError("owner_mismatch", "产物访问上下文归属不一致")
        check_scopes(tx, ctx.scope_dependencies)
        row = tx.execute("SELECT run_id,document FROM artifacts WHERE id=?", (artifact_id,)).fetchone()
        if row is None:
            raise DomainError("artifact_not_found", "产物引用不存在")
        owner = load(tx, RunSnapshot, row[0])
        if (owner.workspace_id, owner.session_id) != (ctx.workspace_id, ctx.session_id):
            raise DomainError("artifact_scope_mismatch", "产物不在当前上下文范围")
        ref = ArtifactRef.model_validate_json(row[1])
        if not for_user:
            self.policy.check_run_sources(tx, ctx, ref.dependencies, source_run_id=owner.id)
        return ref

    def read(self, ctx, artifact_id, offset=0, limit=40000, *, for_user=False):
        if type(offset) is not int or offset < 0 or type(limit) is not int or not (
            1 <= limit <= self.config.max_read_chars
        ):
            raise DomainError("artifact_range_invalid", "产物读取范围无效")
        ref = self.reference(ctx, artifact_id, for_user=for_user)
        if not for_user:
            self._allow(self.policy.check(ctx, ref.dependencies, "read"))
        text = self._bytes(ref).decode("utf-8")
        if offset > len(text):
            raise DomainError("artifact_range_invalid", "产物读取位置超出内容")
        end = min(len(text), offset + limit)
        return TextSlice(text=text[offset:end], start=offset, end=end,
                         total_chars=len(text), source_version=ref.content_hash)

    def export(self, ctx, artifact_id, selection, expected_target_hash=None):
        ref = self.reference(ctx, artifact_id)
        self._allow(self.policy.check(ctx, ref.dependencies, "read"))
        selection = self.policy.resource(ctx, selection.id)
        if selection.kind != "export" or selection.export_target is None:
            raise DomainError("export_target_invalid", "导出需要可信保存选择")
        self._allow(self.policy.check(ctx, [ScopeDependency(scope_id=selection.id,
                                                            epoch=selection.version)], "export"))
        with self.store.transaction(write=False) as tx:
            activity = load(tx, ActivitySnapshot, ctx.activity_id)
            if activity.task_id != ctx.task_id or activity.state != "dispatched":
                raise DomainError("export_not_dispatched", "导出必须经过工具派发入口")
        info = selection.export_target
        target = ExportTarget(parent=FileAnchor(info.parent_path, info.parent_identity, "directory"),
                              name=info.name, identity=info.target_identity, content_hash=info.content_hash)
        result = self.publication.publish(ctx, target, self._bytes(ref).decode("utf-8"),
                                          expected_target_hash=expected_target_hash)
        return ExportReceipt(activity_id=ctx.activity_id, target_ref=selection.id,
                              content_hash=result.content_hash,
                              state="applied" if result.confirmed else "uncertain")

    def validate_output(self, tx, ctx, artifact_ids):
        for artifact_id in artifact_ids:
            ref = self.reference(ctx, artifact_id, tx=tx)
            self._allow(self.policy.check_tx(tx, ctx, ref.dependencies, "read"))
            self._bytes(ref)

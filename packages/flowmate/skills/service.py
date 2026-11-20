"""唯一 Skill 管理写入口；普通包读取不运行代码或授予执行许可。"""

import base64
import hashlib
import json
import os
import shutil
import unicodedata

from pydantic import TypeAdapter

from flowmate.contracts.base import CommandMeta, DomainError, Id, identifier
from flowmate.contracts.execution import (
    TERMINAL,
    ActivitySnapshot,
    Checkpoint,
    ScopeDependency,
)
from flowmate.contracts.scopes import ScopeRef
from flowmate.policy.contracts import ResourceRecord, ResourceRef
from flowmate.policy.service import PolicyService, _owner, _scope
from flowmate.runtime.transitions import check_scopes, load
from flowmate.skills.contracts import (
    ContentHash,
    SkillBinding,
    SkillCandidate,
    SkillCandidateDeletion,
    SkillDeletion,
    SkillFile,
    SkillFileSlice,
    SkillNotice,
    SkillRecord,
    SkillResolution,
    SkillSource,
    SkillSummary,
    SkillVersion,
    SkillView,
)
from flowmate.skills.packages import (
    SkillPackage,
    SkillPackageError,
    export_zip,
    import_directory,
    import_zip,
)
from flowmate.tools.catalog import ToolOutcome

IDENTIFIER = TypeAdapter(Id)
HASH = TypeAdapter(ContentHash)


def _merge(dependencies):
    result = {}
    for item in dependencies:
        if item.scope_id in result and result[item.scope_id] != item:
            raise DomainError("source_version_conflict", "Skill 来源修订不一致")
        result[item.scope_id] = item
    return list(result.values())


class SkillService:
    def __init__(self, store, *, changed=None):
        self.store = store
        self.root = store.path.parent / "skills"
        # 集成者在同一事务内发送无正文的 SkillNotice；stage 不修改公共事件契约。
        self.changed = changed

    @staticmethod
    def _scope(tx, scope):
        scope = ScopeRef.model_validate(scope.model_dump())
        if scope.kind == "session":
            raise DomainError("invalid_scope", "Skill 只支持个人或项目范围")
        _scope(tx, scope)
        id = scope.workspace_id or tx.execute(
            "SELECT user_scope_id FROM local_identity WHERE singleton=1").fetchone()[0]
        return ScopeDependency(scope_id=id, epoch=tx.execute(
            "SELECT epoch FROM scopes WHERE id=?", (id,)).fetchone()[0])

    @staticmethod
    def _within(origin, target):
        if origin.kind != "user_global" and origin != target:
            raise DomainError("scope_mismatch", "项目 Skill 或来源不能扩大至其它范围")

    @classmethod
    def _record(cls, tx, skill_id, scope, *, deleted=False):
        IDENTIFIER.validate_python(skill_id)
        cls._scope(tx, scope)
        row = tx.execute("SELECT document FROM skills WHERE id=?", (skill_id,)).fetchone()
        if row is None:
            raise DomainError("not_found", "Skill 不存在")
        record = SkillRecord.model_validate_json(row[0])
        cls._within(record.scope, scope)
        cls._scope(tx, record.scope)
        if record.status == "deleted" and not deleted:
            raise DomainError("skill_deleted", "Skill 已隐私删除")
        return record

    @staticmethod
    def _check_source(tx, version):
        check_scopes(tx, version.dependencies)
        source = version.source
        if isinstance(version, SkillCandidate) and source.resource_id is not None:
            row = tx.execute("SELECT document FROM resources WHERE id=?", (source.resource_id,)).fetchone()
            if row is None:
                raise DomainError("scope_revoked", "Skill 的导入来源已不可用")
            resource = ResourceRecord.model_validate_json(row[0])
            _scope(tx, resource.scope)
            if (resource.version, resource.source_version) != (source.resource_version, source.source_version):
                raise DomainError("source_version_conflict", "Skill 的导入来源已经修订")
        if isinstance(version, SkillCandidate) and source.activity_id is not None:
            activity = load(tx, ActivitySnapshot, source.activity_id)
            if (activity.task_id != source.task_id or activity.run_id != source.run_id
                    or activity.attempt_id != source.attempt_id
                    or activity.state not in {"dispatched", "succeeded"}):
                raise DomainError("skill_generation_invalid", "生成来源已不再是原确认活动")

    @classmethod
    def _version(cls, tx, skill_id, content_hash, scope):
        HASH.validate_python(content_hash)
        record = cls._record(tx, skill_id, scope)
        check_scopes(tx, [ScopeDependency(scope_id=skill_id, epoch=tx.execute(
            "SELECT epoch FROM scopes WHERE id=?", (skill_id,)).fetchone()[0])])
        row = tx.execute("SELECT document FROM skill_versions WHERE skill_id=? AND content_hash=?",
            (skill_id, content_hash)).fetchone()
        if row is None:
            raise DomainError("skill_version_missing", "固定的 Skill 版本缺失，不能自动换版")
        version = SkillVersion.model_validate_json(row[0])
        cls._check_source(tx, version)
        return record, version

    def _command(self, operation, parameters, meta, model, apply, *, replay=None):
        meta = CommandMeta.model_validate(meta.model_dump())
        encoded = json.dumps({"operation": operation, "parameters": parameters,
            "expected_version": meta.expected_version}, sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, allow_nan=False)
        fingerprint = hashlib.sha256(encoded.encode()).hexdigest()
        with self.store.transaction() as tx:
            previous = tx.previous_command(meta.command_id)
            if previous is not None:
                if previous["request_hash"] != fingerprint:
                    raise DomainError("command_conflict", "同一 Skill 命令不能更改参数")
                result = model.model_validate_json(previous["response"])
                if replay is not None:
                    replay(tx, result)
                return result
            result = apply(tx)
            tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)", (meta.command_id, fingerprint,
                result.model_dump_json(), result.scope.workspace_id, None))
            return result

    @staticmethod
    def _write(path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.parent / f"{identifier()}.tmp"
        try:
            with temporary.open("xb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        except OSError:
            raise DomainError("skill_storage_failed", "Skill 快照写入失败") from None
        finally:
            temporary.unlink(missing_ok=True)

    def _candidate_path(self, staging_ref):
        IDENTIFIER.validate_python(staging_ref)
        return self.root / "candidates" / staging_ref

    def _candidate(self, tx, staging_ref, scope):
        self._scope(tx, scope)
        if tx.execute("SELECT 1 FROM commands WHERE json_extract(response,'$.staging_ref')=? "
                "AND json_extract(response,'$.discarded')=1", (staging_ref,)).fetchone():
            raise DomainError("skill_candidate_missing", "候选已经清除")
        path = self._candidate_path(staging_ref) / "candidate.json"
        try:
            candidate = SkillCandidate.model_validate_json(path.read_bytes())
        except FileNotFoundError:
            raise DomainError("skill_candidate_missing", "候选不存在或已清除") from None
        self._within(candidate.scope, scope)
        self._scope(tx, candidate.scope)
        self._check_source(tx, candidate)
        return candidate

    def candidate(self, staging_ref, scope):
        with self.store.transaction(write=False) as tx:
            return self._candidate(tx, staging_ref, scope)

    @staticmethod
    def _package(directory_name, files):
        try:
            return import_directory(directory_name, files)
        except SkillPackageError as error:
            raise DomainError(error.code, str(error)) from None

    def _stage(self, package: SkillPackage, scope, source, meta, *, skill_id, base_hash, extra=(), validate=None):
        # 格式/原生入口已构造冻结的 SkillPackage；磁盘快照仍由 _load_package 核对。
        parameters = {"scope": scope.model_dump(mode="json"), "source": source.model_dump(mode="json"),
            "content_hash": package.content_hash, "directory_name": package.directory_name,
            "skill_id": skill_id, "base_hash": base_hash}

        def apply(tx):
            if meta.expected_version is not None:
                raise DomainError("version_conflict", "暂存只核对 base_hash，不修改管理修订")
            dependency = self._scope(tx, scope)
            dependencies = [dependency, *extra]
            if validate is not None:
                validate(tx)
            id = skill_id or identifier()
            if skill_id is None:
                if base_hash is not None:
                    raise DomainError("version_conflict", "新 Skill 不能携带旧版本")
            else:
                record = self._record(tx, id, scope)
                if record.scope != scope or record.current_hash != base_hash:
                    raise DomainError("version_conflict", "Skill 已更新，请基于当前版本编辑")
                _, base = self._version(tx, id, base_hash, scope)
                dependencies.extend(base.dependencies)
            dependencies = _merge(dependencies)
            check_scopes(tx, dependencies)
            fields = package.frontmatter
            candidate = SkillCandidate(skill_id=id, content_hash=package.content_hash,
                directory_name=package.directory_name, name=unicodedata.normalize("NFKC", package.name.strip()),
                description=package.description,
                metadata=dict(fields.get("metadata", {})), license=fields.get("license"),
                compatibility=fields.get("compatibility"), allowed_tools=fields.get("allowed-tools"),
                files=[SkillFile(path=path, size_bytes=len(raw), content_hash=package.file_hashes[path])
                    for path, raw in sorted(package.files.items())],
                source=source, scope=scope, dependencies=dependencies, base_hash=base_hash)
            path = self._candidate_path(candidate.staging_ref)
            self._write(path / "package.zip", export_zip(package))
            self._write(path / "candidate.json", candidate.model_dump_json().encode())
            return candidate

        return self._command("skill.stage", parameters, meta, SkillCandidate, apply,
            replay=lambda tx, result: self._candidate(tx, result.staging_ref, scope))

    def stage_user(self, directory_name, files, scope, meta, *, skill_id=None, base_hash=None):
        source = SkillSource(kind="user_edited" if skill_id else "user_created",
            command_id=meta.command_id, base_hash=base_hash)
        return self._stage(self._package(directory_name, files), scope, source, meta,
            skill_id=skill_id, base_hash=base_hash)

    def stage_import(self, package, selection, scope, meta, *, skill_id=None, base_hash=None):
        selection = ResourceRef.model_validate(selection.model_dump())

        def validate(tx):
            row = tx.execute("SELECT document FROM resources WHERE id=?", (selection.id,)).fetchone()
            if row is None:
                raise DomainError("scope_revoked", "原生选择已经失效")
            record = ResourceRecord.model_validate_json(row[0])
            actual = ResourceRef.model_validate(record.model_dump(include=set(ResourceRef.model_fields)))
            if actual != selection or actual.kind not in {"file", "directory"}:
                raise DomainError("source_version_conflict", "须使用原生层实际读取的选择修订")
            _scope(tx, actual.scope)

        source = SkillSource(kind="external", command_id=meta.command_id, base_hash=base_hash,
            resource_id=selection.id, resource_version=selection.version, source_version=selection.source_version)
        return self._stage(package, scope, source, meta, skill_id=skill_id, base_hash=base_hash,
            extra=[ScopeDependency(scope_id=selection.id, epoch=selection.version)], validate=validate)

    def stage_generated(self, ctx, package, meta, *, skill_id=None, base_hash=None):
        with self.store.transaction(write=False) as tx:
            run, task = _owner(tx, ctx)
            if ctx.activity_id is None:
                raise DomainError("skill_generation_invalid", "生成候选须来自真实已派发工具活动")
            activity = load(tx, ActivitySnapshot, ctx.activity_id)
            if (activity.state not in {"dispatched", "succeeded"} or activity.intent.operation != "skills.propose"
                    or run.state in TERMINAL or task.state in TERMINAL):
                raise DomainError("skill_generation_invalid", "生成候选须来自真实已派发工具活动")
            # 用户管理候选不能成为私有成员正文的新公开通道。
            if task.id != run.root_task_id or task.binding.execution_session_id != run.interaction_session_id:
                raise DomainError("skill_candidate_private", "私有成员须先通过原交付链向主任务交付")
            checkpoint = Checkpoint.model_validate_json(tx.execute(
                "SELECT document FROM checkpoints WHERE task_id=?", (task.id,)).fetchone()[0])
            dependencies = [*ctx.scope_dependencies, *activity.intent.dependencies,
                *checkpoint.output_dependencies, *[ScopeDependency.model_validate(item)
                    for item in checkpoint.context_manifest.get("source_dependencies", [])]]
            source = SkillSource(kind="generated", command_id=meta.command_id, base_hash=base_hash,
                run_id=run.id, task_id=task.id, activity_id=activity.id, attempt_id=activity.attempt_id)
        scope = ScopeRef(kind="workspace", workspace_id=ctx.workspace_id)
        return self._stage(package, scope, source, meta, skill_id=skill_id, base_hash=base_hash,
            extra=dependencies, validate=lambda tx: self._check_generation(tx, ctx, activity.attempt_id))

    @staticmethod
    def _check_generation(tx, ctx, attempt_id):
        run, task = _owner(tx, ctx)
        activity = load(tx, ActivitySnapshot, ctx.activity_id)
        if (activity.attempt_id != attempt_id or activity.state != "dispatched"
                or run.state in TERMINAL or task.state in TERMINAL):
            raise DomainError("skill_generation_invalid", "生成来源已改变")

    def _load_package(self, path, version):
        try:
            package = import_zip(path.read_bytes(), directory_name=version.directory_name)
        except FileNotFoundError:
            raise DomainError("skill_version_missing", "Skill 快照文件缺失") from None
        except SkillPackageError:
            raise DomainError("skill_content_corrupt", "Skill 快照校验失败") from None
        if package.content_hash != version.content_hash:
            raise DomainError("skill_content_corrupt", "Skill 快照与固定版本不符")
        return package

    def publish(self, candidate, meta, *, confirmed_hash=None):
        candidate = SkillCandidate.model_validate(candidate.model_dump())
        if confirmed_hash != candidate.content_hash:
            raise DomainError("skill_confirmation_required", "须由用户确认此候选的具体内容版本")

        def apply(tx):
            actual = self._candidate(tx, candidate.staging_ref, candidate.scope)
            if actual != candidate:
                raise DomainError("skill_candidate_invalid", "候选身份或内容已经改变")
            row = tx.execute("SELECT document FROM skills WHERE id=?", (candidate.skill_id,)).fetchone()
            if row is None:
                if candidate.base_hash is not None or meta.expected_version is not None:
                    raise DomainError("version_conflict", "新 Skill 发布不接受已有修订")
                record = SkillRecord(skill_id=candidate.skill_id,
                    current_hash=candidate.content_hash, scope=candidate.scope)
            else:
                record = self._record(tx, candidate.skill_id, candidate.scope)
                if record.revision != meta.expected_version or record.current_hash != candidate.base_hash:
                    raise DomainError("version_conflict", "Skill 已更新，请重新核对当前版本")
                record = record.model_copy(update={"current_hash": candidate.content_hash,
                    "revision": record.revision + 1})
            version = SkillVersion.model_validate(candidate.model_dump(include=set(SkillVersion.model_fields)))
            if candidate.source.kind == "external":
                # 用户确认导入的是独立副本；更新仍继承旧版派生依赖，不能洗掉生成来源。
                dependencies = [self._scope(tx, candidate.scope)]
                if candidate.base_hash is not None:
                    _, base = self._version(tx, candidate.skill_id, candidate.base_hash, candidate.scope)
                    dependencies.extend(base.dependencies)
                version = version.model_copy(update={"dependencies": _merge(dependencies)})
            package = self._load_package(self._candidate_path(candidate.staging_ref) / "package.zip", version)
            previous = tx.execute("SELECT document FROM skill_versions WHERE skill_id=? AND content_hash=?",
                (version.skill_id, version.content_hash)).fetchone()
            if previous is not None:
                version = SkillVersion.model_validate_json(previous[0])
                self._check_source(tx, version)
            else:
                self._write(self.root / "versions" / version.skill_id / f"{version.content_hash}.zip",
                    export_zip(package))
            tx.execute("INSERT INTO skills VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET "
                "current_hash=excluded.current_hash,document=excluded.document",
                (record.skill_id, record.current_hash, record.model_dump_json()))
            if previous is None:
                tx.execute("INSERT INTO skill_versions VALUES (?,?,?)",
                    (version.skill_id, version.content_hash, version.model_dump_json()))
            tx.execute("INSERT OR IGNORE INTO scopes(id,kind,workspace_id) VALUES (?,'skill',?)",
                (record.skill_id, record.scope.workspace_id))
            self._notice(tx, record)
            return version

        return self._command("skill.publish", {"candidate": candidate.model_dump(mode="json"),
            "confirmed_hash": confirmed_hash}, meta, SkillVersion, apply,
            replay=lambda tx, result: self._version(tx, result.skill_id, result.content_hash, result.scope))

    def _notice(self, tx, record):
        notice = self._emit_notice(tx, record)
        if self.changed is not None:
            self.changed(tx, notice)

    @staticmethod
    def _emit_notice(tx, record):
        from flowmate.contracts.events import NewEvent
        from flowmate.policy.lifecycle import invalidate_skill
        notice = SkillNotice(skill_id=record.skill_id, scope=record.scope,
            revision=record.revision, status=record.status)
        tx.append_event(NewEvent(kind="skill.changed", workspace_id=record.scope.workspace_id, payload=notice))
        if record.status == "deleted":
            invalidate_skill(tx, record.skill_id)
        return notice

    def get(self, skill_id, scope):
        with self.store.transaction(write=False) as tx:
            return self._record(tx, skill_id, scope)

    def package(self, skill_id, content_hash, scope):
        """仅管理/原生导出入口；调用者已获管理读取权，不用于模型路由。"""
        with self.store.transaction(write=False) as tx:
            _, version = self._version(tx, skill_id, content_hash, scope)
            return self._load_package(self.root / "versions" / skill_id / f"{content_hash}.zip", version)

    def read_candidate(self, staging_ref, scope, relative_path, *, offset=0, limit=2000):
        with self.store.transaction(write=False) as tx:
            candidate = self._candidate(tx, staging_ref, scope)
            package = self._load_package(self._candidate_path(staging_ref) / "package.zip", candidate)
            return self._slice(package, candidate, relative_path, offset, limit)

    def read_user(self, skill_id, content_hash, scope, relative_path, *, offset=0, limit=2000):
        with self.store.transaction(write=False) as tx:
            _, version = self._version(tx, skill_id, content_hash, scope)
            package = self._load_package(self.root / "versions" / skill_id / f"{content_hash}.zip", version)
            return self._slice(package, version, relative_path, offset, limit)

    def set_binding(self, binding, meta):
        binding = SkillBinding.model_validate(binding.model_dump())

        def apply(tx):
            record = self._record(tx, binding.skill_id, binding.scope)
            scope_id = self._scope(tx, binding.scope).scope_id
            row = tx.execute("SELECT document FROM skill_bindings WHERE skill_id=? AND scope_id=?",
                (binding.skill_id, scope_id)).fetchone()
            previous = SkillBinding.model_validate_json(row[0]) if row else None
            occupied = tx.execute("SELECT skill_id,scope_id FROM skill_bindings WHERE id=?",
                (binding.id,)).fetchone()
            if occupied is not None and tuple(occupied) != (binding.skill_id, scope_id):
                raise DomainError("skill_binding_conflict", "绑定身份不能移动到另一 Skill 或范围")
            if (meta.expected_version != (previous.revision if previous else None)
                    or previous is not None and previous.id != binding.id):
                raise DomainError("version_conflict", "Skill 绑定已改变")
            if binding.environment_id is not None:
                environment = tx.execute("SELECT revision FROM execution_environments WHERE id=?",
                    (binding.environment_id,)).fetchone()
                if environment is None or environment[0] != binding.environment_revision:
                    raise DomainError("environment_version_conflict", "运行环境修订不存在或已改变")
            changed = binding.model_copy(update={"revision": previous.revision + 1 if previous else 1})
            tx.execute("INSERT INTO skill_bindings VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                "enabled=excluded.enabled,environment_id=excluded.environment_id,document=excluded.document",
                (changed.id, changed.skill_id, scope_id, int(changed.enabled),
                 changed.environment_id, changed.model_dump_json()))
            self._notice(tx, record)
            return changed
        return self._command("skill.bind", binding.model_dump(mode="json"), meta, SkillBinding, apply,
            replay=lambda tx, result: self._record(tx, result.skill_id, result.scope))

    def _binding(self, tx, skill_id, scope):
        ids = [self._scope(tx, scope).scope_id]
        if scope.kind == "workspace":
            ids.append(self._scope(tx, ScopeRef(kind="user_global")).scope_id)
        for scope_id in ids:
            row = tx.execute("SELECT document FROM skill_bindings WHERE skill_id=? AND scope_id=?",
                (skill_id, scope_id)).fetchone()
            if row:
                return SkillBinding.model_validate_json(row[0])
        return None

    @staticmethod
    def _summary(version):
        return SkillSummary(skill_id=version.skill_id, content_hash=version.content_hash,
            name=version.name, description=version.description)

    def resolve(self, scope, versions, *, tx=None):
        """接纳入口；调用者须在 Run/成员快照持久化 versions 与全部 dependencies。"""
        if tx is None:
            with self.store.transaction(write=False) as tx:
                return self.resolve(scope, versions, tx=tx)
        dependencies = [self._scope(tx, scope)]
        if len(versions) > 200:
            raise DomainError("skill_selection_invalid", "Skill 选择超过上限")
        pins, entries = {}, []
        for id, content_hash in versions.items():
            record = self._record(tx, id, scope)
            _, version = self._version(tx, id, content_hash if content_hash is not None else record.current_hash, scope)
            binding = self._binding(tx, id, scope)
            if binding is None or not binding.enabled:
                raise DomainError("skill_disabled", "Skill 未在当前范围启用")
            dependencies.extend([*version.dependencies, ScopeDependency(scope_id=id, epoch=tx.execute(
                "SELECT epoch FROM scopes WHERE id=?", (id,)).fetchone()[0])])
            pins[id] = version.content_hash
            entries.append(self._summary(version))
        return SkillResolution(versions=pins, dependencies=_merge(dependencies), entries=entries)

    def reference(self, ctx, skill_id, content_hash, *, tx=None):
        """按真实 Run/Task 的固定来源读取；停用 binding 不使既有 pin 换版。"""
        if tx is None:
            with self.store.transaction(write=False) as tx:
                return self.reference(ctx, skill_id, content_hash, tx=tx)
        run, task = _owner(tx, ctx)
        if (task.binding.sources.skill_versions.get(skill_id) != content_hash
                or run.sources.skill_versions.get(skill_id) != content_hash):
            raise DomainError("skill_not_selected", "Skill 不在真实任务的固定版本集合")
        check_scopes(tx, ctx.scope_dependencies)
        if run.state in TERMINAL or task.state in TERMINAL:
            raise DomainError("owner_inactive", "任务已结束")
        version = self._version(tx, skill_id, content_hash,
            ScopeRef(kind="workspace", workspace_id=ctx.workspace_id))[1]
        PolicyService.check_run_sources(tx, ctx, [*version.dependencies, ScopeDependency(
            scope_id=skill_id, epoch=tx.execute("SELECT epoch FROM scopes WHERE id=?", (skill_id,)).fetchone()[0])])
        return version

    def catalog(self, ctx, *, tx=None):
        if tx is None:
            with self.store.transaction(write=False) as tx:
                return self.catalog(ctx, tx=tx)
        _, task = _owner(tx, ctx)
        return [self._summary(self.reference(ctx, id, hash, tx=tx))
            for id, hash in task.binding.sources.skill_versions.items()]

    @staticmethod
    def dependencies(tx, version):
        return _merge([*version.dependencies, ScopeDependency(scope_id=version.skill_id,
            epoch=tx.execute("SELECT epoch FROM scopes WHERE id=?", (version.skill_id,)).fetchone()[0])])

    @staticmethod
    def _slice(package, version, relative_path, offset, limit):
        if (type(offset) is not int or offset < 0 or type(limit) is not int
                or not 1 <= limit <= 16000):
            raise DomainError("skill_range_invalid", "节选须在 1 至 16000 之间，位置须为非负整数")
        if (not isinstance(relative_path, str) or relative_path.startswith("/")
                or "\\" in relative_path or ".." in relative_path.split("/")):
            raise DomainError("skill_path_invalid", "只能读取已登记的包内相对文件")
        if relative_path not in package.files:
            raise DomainError("skill_file_missing", "包内没有此文件")
        raw = package.files[relative_path]
        try:
            content, encoding = raw.decode("utf-8"), "utf-8"
        except UnicodeError:
            content, encoding = raw, "base64"
        if offset > len(content):
            raise DomainError("skill_range_invalid", "节选位置超过文件内容")
        end = min(len(content), offset + limit)
        value = content[offset:end]
        return SkillFileSlice(skill_id=version.skill_id, content_hash=version.content_hash,
            path=relative_path, file_hash=package.file_hashes[relative_path], encoding=encoding,
            content=value if encoding == "utf-8" else base64.b64encode(value).decode("ascii"),
            start=offset, end=end, total=len(content))

    def read(self, ctx, skill_id, content_hash, relative_path, *, offset=0, limit=2000, tx=None):
        if tx is None:
            with self.store.transaction(write=False) as tx:
                return self.read(ctx, skill_id, content_hash, relative_path, offset=offset, limit=limit, tx=tx)
        version = self.reference(ctx, skill_id, content_hash, tx=tx)
        package = self._load_package(self.root / "versions" / skill_id / f"{content_hash}.zip", version)
        value = self._slice(package, version, relative_path, offset, limit)
        return ToolOutcome(result=value.model_dump(mode="json"), dependencies=_merge([
            *ctx.scope_dependencies, *version.dependencies, ScopeDependency(scope_id=skill_id,
                epoch=tx.execute("SELECT epoch FROM scopes WHERE id=?", (skill_id,)).fetchone()[0])]))

    def list(self, scope, query="", *, limit=100, cursor=None):
        # 复用既有有水位的 keyset 投影，不新增分页协议或复制原文。
        from flowmate.api.queries import _page
        with self.store.transaction(write=False) as tx:
            self._scope(tx, scope)
            sql = ("SELECT s.id,s.document,v.document AS version_document FROM skills s "
                "JOIN skill_versions v ON v.skill_id=s.id AND v.content_hash=s.current_hash "
                "WHERE json_extract(s.document,'$.status')='active' "
                "AND (json_extract(s.document,'$.scope.kind')='user_global' "
                "OR json_extract(s.document,'$.scope.workspace_id')=?) "
                "AND NOT EXISTS (SELECT 1 FROM json_each(v.document,'$.dependencies') dep "
                "LEFT JOIN scopes fence ON fence.id=json_extract(dep.value,'$.scope_id') "
                "WHERE fence.id IS NULL OR fence.status<>'active' "
                "OR fence.epoch<>json_extract(dep.value,'$.epoch')) "
                "AND (instr(lower(json_extract(v.document,'$.name')),?)>0 "
                "OR instr(lower(json_extract(v.document,'$.description')),?)>0)")
            if not isinstance(query, str) or len(query) > 1024:
                raise DomainError("invalid_query", "搜索文字须在 1024 字符以内")
            def decode(row):
                version = SkillVersion.model_validate_json(row["version_document"])
                try:
                    self._check_source(tx, version)
                    readiness = "content_available"
                except DomainError as error:
                    if error.code not in {"scope_revoked", "source_version_conflict", "not_found", "skill_generation_invalid"}:
                        raise
                    readiness = "source_unavailable"
                return SkillView(version=version, binding=self._binding(tx, version.skill_id, scope),
                    readiness=readiness)
            key = f"skills:{scope.model_dump_json()}:{query}"
            return _page(tx, SkillView, key, sql, [scope.workspace_id, query.lower(), query.lower()],
                limit=limit, cursor=cursor, decode=decode)

    @classmethod
    def _tombstone(cls, tx, record, *, notify=None):
        skill_id = record.skill_id
        record = record.model_copy(update={"status": "deleted", "revision": record.revision + 1})
        tx.execute("UPDATE scopes SET epoch=epoch+1,status='deleted' WHERE id=?", (skill_id,))
        tx.execute("UPDATE skills SET document=? WHERE id=?", (record.model_dump_json(), skill_id))
        tx.execute("UPDATE skill_versions SET document=json_object('skill_id',skill_id,"
            "'content_hash',content_hash,'deleted',json('true')) WHERE skill_id=?", (skill_id,))
        tx.execute("DELETE FROM skill_execution_permissions WHERE skill_id=?", (skill_id,))
        tx.execute("DELETE FROM skill_bindings WHERE skill_id=?", (skill_id,))
        tx.execute("INSERT OR IGNORE INTO deleted_commands SELECT command_id,request_hash FROM commands "
            "WHERE json_extract(response,'$.skill_id')=?", (skill_id,))
        tx.execute("DELETE FROM commands WHERE json_extract(response,'$.skill_id')=?", (skill_id,))
        tx.execute("UPDATE cleanup_state SET wal_pending=1 WHERE singleton=1")
        (notify or cls._emit_notice)(tx, record)
        return SkillDeletion(skill_id=skill_id, scope=record.scope, revision=record.revision)

    def delete(self, skill_id, scope, meta):
        def apply(tx):
            record = self._record(tx, skill_id, scope)
            if meta.expected_version != record.revision:
                raise DomainError("version_conflict", "Skill 已改变，请重新核对")
            return self._tombstone(tx, record, notify=self._notice)
        result = self._command("skill.delete", {"skill_id": skill_id, "scope": scope.model_dump(mode="json")},
            meta, SkillDeletion, apply)
        self.cleanup_deleted()
        return result

    def discard(self, staging_ref, scope, meta):
        IDENTIFIER.validate_python(staging_ref)
        def apply(tx):
            candidate = self._candidate(tx, staging_ref, scope)
            if meta.expected_version is not None:
                raise DomainError("version_conflict", "候选没有可变管理修订")
            tx.execute("INSERT OR IGNORE INTO deleted_commands SELECT command_id,request_hash FROM commands "
                "WHERE json_extract(response,'$.staging_ref')=?", (staging_ref,))
            tx.execute("DELETE FROM commands WHERE json_extract(response,'$.staging_ref')=?", (staging_ref,))
            return SkillCandidateDeletion(skill_id=candidate.skill_id, staging_ref=staging_ref, scope=candidate.scope)
        result = self._command("skill.discard", {"staging_ref": staging_ref, "scope": scope.model_dump(mode="json")},
            meta, SkillCandidateDeletion, apply)
        self.cleanup_deleted()
        return result

    @classmethod
    def invalidate_sources(cls, tx):
        """生命周期的同事务接线点；只清理仍继承被撤销来源的版本及候选命令。"""
        notices = []
        for row in tx.execute("SELECT document FROM skills WHERE json_extract(document,'$.status')='active'").fetchall():
            record = SkillRecord.model_validate_json(row[0])
            versions = [SkillVersion.model_validate_json(row[0]) for row in tx.execute(
                "SELECT document FROM skill_versions WHERE skill_id=?", (record.skill_id,))]
            try:
                cls._scope(tx, record.scope)
                for version in versions:
                    check_scopes(tx, version.dependencies)
            except DomainError as error:
                if error.code not in {"scope_revoked", "not_found"}:
                    raise
                notices.append(cls._tombstone(tx, record))
        for row in tx.execute("SELECT command_id,request_hash,response FROM commands WHERE "
                "json_type(response,'$.staging_ref')='text' "
                "AND json_type(response,'$.discarded') IS NULL").fetchall():
            candidate = SkillCandidate.model_validate_json(row["response"])
            try:
                cls._scope(tx, candidate.scope)
                cls._check_source(tx, candidate)
            except DomainError as error:
                if error.code not in {"scope_revoked", "source_version_conflict", "not_found", "skill_generation_invalid"}:
                    raise
                tx.execute("INSERT OR IGNORE INTO deleted_commands VALUES (?,?)",
                    (row["command_id"], row["request_hash"]))
                tx.execute("DELETE FROM commands WHERE command_id=?", (row["command_id"],))
        return notices

    def cleanup_deleted(self):
        """围栏已提交后清理；启动或删除丢响应重放可再次调用，失败不伪报清理完成。"""
        try:
            # 与暂存/发布共用写锁，避免清理尚未提交但正在发布的文件。
            with self.store.transaction() as tx:
                self.invalidate_sources(tx)
                live = {}
                for row in tx.execute("SELECT v.skill_id,v.content_hash FROM skill_versions v "
                        "JOIN skills s ON s.id=v.skill_id WHERE json_extract(s.document,'$.status')='active'"):
                    live.setdefault(row[0], set()).add(f"{row[1]}.zip")
                versions = self.root / "versions"
                if versions.exists():
                    for path in versions.iterdir():
                        if path.name not in live:
                            shutil.rmtree(path)
                        else:
                            for file in path.iterdir():
                                if file.name not in live[path.name]:
                                    file.unlink()
                references = {row[0] for row in tx.execute("SELECT json_extract(response,'$.staging_ref') "
                    "FROM commands WHERE json_type(response,'$.staging_ref')='text' "
                    "AND json_type(response,'$.discarded') IS NULL")}
                candidates = self.root / "candidates"
                if candidates.exists():
                    for path in candidates.iterdir():
                        if path.name not in references:
                            shutil.rmtree(path)
        except OSError:
            raise DomainError("skill_cleanup_failed", "读取已封锁，私有 Skill 文件仍待清理") from None

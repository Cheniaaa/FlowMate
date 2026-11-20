"""能力库原生选择与管理保存；文件路径只来自私有登记记录。"""

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import ScopeDependency
from flowmate.host.resources import HostResources
from flowmate.policy.contracts import ResourceRecord, ResourceRef
from flowmate.policy.service import _scope
from flowmate.runtime.transitions import check_scopes
from flowmate.tools.files import ExportTarget, FileAnchor


class SkillHost:
    def __init__(self, skills, policy, files, publications, config):
        self.skills, self.policy, self.files, self.publications = skills, policy, files, publications
        self.resources = HostResources(policy, files, config)

    async def register(self, params):
        if params.get("kind") == "binary_export":
            raise DomainError("native_selection_kind", "Skill 包保存需要 ZIP 目标")
        return await self.resources.register(params)

    def _selection(self, resource_id, scope, kinds):
        with self.policy.store.transaction(write=False) as tx:
            _scope(tx, scope)
            row = tx.execute("SELECT document FROM resources WHERE id=?", (resource_id,)).fetchone()
            if row is None:
                raise DomainError("not_found", "原生选择不存在")
            resource = ResourceRecord.model_validate_json(row[0])
            if (resource.scope.kind != "workspace"
                    or scope.kind == "workspace" and resource.scope.workspace_id != scope.workspace_id
                    or scope.kind == "session" or resource.kind not in kinds):
                raise DomainError("scope_mismatch", "选择不属于当前项目或操作")
            _scope(tx, resource.scope)
            check_scopes(tx, [ScopeDependency(scope_id=resource.id, epoch=resource.version)])
            return resource

    def stage_import(self, command):
        data = command.data
        resource = self._selection(data.selection_id, data.scope, {"file", "directory"})
        package = self.files.read_package(FileAnchor(
            resource.canonical_path, resource.file_identity, resource.kind))
        selection = ResourceRef.model_validate(resource.model_dump(include=set(ResourceRef.model_fields)))
        return self.skills.stage_import(package, selection, data.scope, command.meta,
            skill_id=data.skill_id, base_hash=data.base_hash)

    def save(self, command):
        # 与目标删除共用journal锁；写事务同时围住来源接纳，不能读出包后跨越来源删除发布。
        with self.publications.operation_guard(), self.policy.store.transaction():
            data = command.data
            resource = self._selection(data.target_ref, data.scope, {"export"})
            package = self.skills.package(data.skill_id, data.content_hash, data.scope)
            info = resource.export_target
            target = ExportTarget(FileAnchor(info.parent_path, info.parent_identity, "directory"),
                                  info.name, info.target_identity, info.content_hash)
            return self.publications.save(package, target, command_id=command.meta.command_id,
                skill_id=data.skill_id, target_ref=resource.id,
                expected_target_hash=data.confirmed_target_hash)

    def _authorize_command(self, command_id, scope):
        command = next((item for item in self.publications.commands()
                        if item.command_id == command_id), None)
        if command is None:
            raise DomainError("skill_export_not_found", "保存命令不存在")
        self._selection(command.target_ref, scope, {"export"})
        return command

    def inspect(self, command_id, scope):
        with self.publications.operation_guard():
            self._authorize_command(command_id, scope)
            return self.publications.inspect(command_id)

    def restore(self, command_id, scope):
        with self.publications.operation_guard():
            self._authorize_command(command_id, scope)
            return self.publications.restore(command_id)

    def finalize(self, command_id, scope):
        with self.publications.operation_guard():
            self._authorize_command(command_id, scope)
            return self.publications.finalize(command_id)

    def release(self, command_id, scope):
        with self.publications.operation_guard():
            self._authorize_command(command_id, scope)
            return self.publications.release(command_id)

    def exports(self, scope, *, skill_id=None):
        with self.publications.operation_guard():
            with self.policy.store.transaction(write=False) as tx:
                _scope(tx, scope)
                selected = {row["id"] for row in tx.execute(
                    "SELECT id FROM resources WHERE session_id IS NULL"
                    + (" AND workspace_id=?" if scope.kind == "workspace" else ""),
                    (scope.workspace_id,) if scope.kind == "workspace" else ())}
            result = []
            for item in self.publications.commands():
                if item.target_ref in selected and (skill_id is None or item.skill_id == skill_id):
                    self._selection(item.target_ref, scope, {"export"})
                    result.append(self.publications.inspect(item.command_id))
            return result

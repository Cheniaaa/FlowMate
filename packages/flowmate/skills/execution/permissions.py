"""版本级本机执行许可；与内容启用和资料发送授权分别保存。"""

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import RunSnapshot
from flowmate.contracts.scopes import ScopeRef
from flowmate.runtime.transitions import load, stop_run
from flowmate.skills.execution.contracts import SkillExecutionPermission


class SkillExecutionPermissions:
    def __init__(self, skills, environments):
        self.skills, self.environments, self.store = skills, environments, skills.store

    def save(self, command, meta):
        command = SkillExecutionPermission.model_validate(command.model_dump())

        def apply(tx):
            if command.scope.kind == "session":
                raise DomainError("invalid_scope", "执行许可只支持个人或项目范围")
            self.skills._version(tx, command.skill_id, command.content_hash, command.scope)
            environment = self.environments.get(command.environment_id, command.environment_revision)
            if command.status == "active" and environment.status != "probed":
                raise DomainError("environment_not_probed", "请先完成环境版本检测")
            row = tx.execute("SELECT document FROM skill_execution_permissions WHERE id=?",
                (command.id,)).fetchone()
            current = SkillExecutionPermission.model_validate_json(row[0]) if row else None
            if meta.expected_version != (current.revision if current else None):
                raise DomainError("version_conflict", "执行许可已改变，请刷新")
            if current is not None and current.model_dump(exclude={"revision", "status"}) != (
                    command.model_dump(exclude={"revision", "status"})):
                raise DomainError("permission_identity_changed", "许可身份不能更改")
            scope_id = self.skills._scope(tx, command.scope).scope_id
            duplicate = tx.execute("SELECT id FROM skill_execution_permissions WHERE skill_id=? "
                "AND content_hash=? AND environment_id=? AND environment_revision=? AND scope_id=?",
                (command.skill_id, command.content_hash, command.environment_id,
                 command.environment_revision, scope_id)).fetchone()
            if duplicate is not None and duplicate["id"] != command.id:
                raise DomainError("version_conflict", "此版本已有许可，请更新已读取的记录")
            saved = command.model_copy(update={"revision": current.revision + 1 if current else 1})
            tx.execute("INSERT INTO skill_execution_permissions VALUES (?,?,?,?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET document=excluded.document",
                (saved.id, saved.skill_id, saved.content_hash, saved.environment_id,
                 saved.environment_revision, scope_id, saved.model_dump_json()))
            if saved.status == "revoked":
                self._stop(tx, saved)
            return saved
        return self.skills._command("skill.execution_permission.save", command.model_dump(mode="json"),
            meta, SkillExecutionPermission, apply)

    def list(self, skill_id, content_hash, scope):
        with self.store.transaction(write=False) as tx:
            self.skills._version(tx, skill_id, content_hash, scope)
            scope_id = self.skills._scope(tx, scope).scope_id
            rows = tx.execute("SELECT document FROM skill_execution_permissions WHERE skill_id=? "
                "AND content_hash=? AND scope_id=? ORDER BY id", (skill_id, content_hash, scope_id))
            return [SkillExecutionPermission.model_validate_json(row[0]) for row in rows]

    def revoke(self, id, meta):
        def apply(tx):
            row = tx.execute("SELECT document FROM skill_execution_permissions WHERE id=?", (id,)).fetchone()
            if row is None:
                raise DomainError("not_found", "执行许可不存在")
            current = SkillExecutionPermission.model_validate_json(row[0])
            self.skills._scope(tx, current.scope)
            if meta.expected_version != current.revision:
                raise DomainError("version_conflict", "执行许可已改变，请刷新")
            revoked = current if current.status == "revoked" else current.model_copy(update={
                "revision": current.revision + 1, "status": "revoked",
            })
            tx.execute("UPDATE skill_execution_permissions SET document=? WHERE id=?",
                (revoked.model_dump_json(), id))
            self._stop(tx, revoked)
            return revoked
        return self.skills._command("skill.execution_permission.revoke", {"id": id},
            meta, SkillExecutionPermission, apply)

    def require(self, tx, ctx, args):
        scope = ScopeRef(kind="workspace", workspace_id=ctx.workspace_id)
        self.skills._scope(tx, scope)
        binding = self.skills._binding(tx, args.skill_id, scope)
        if binding is None or (binding.environment_id, binding.environment_revision) != (
                args.environment_id, args.environment_revision):
            raise DomainError("skill_environment_binding_changed", "脚本环境不属于当前明确绑定")
        scope_ids = [ctx.workspace_id, self.skills._scope(tx, ScopeRef(kind="user_global")).scope_id]
        for scope_id in scope_ids:
            row = tx.execute("SELECT document FROM skill_execution_permissions WHERE skill_id=? "
                "AND content_hash=? AND environment_id=? AND environment_revision=? AND scope_id=?",
                (args.skill_id, args.content_hash, args.environment_id, args.environment_revision,
                 scope_id)).fetchone()
            if row is not None:
                permission = SkillExecutionPermission.model_validate_json(row[0])
                if permission.status == "active":
                    return permission
                break
        raise DomainError("execution_permission_required", "此 Skill 版本和环境尚无独立执行许可")

    @staticmethod
    def _stop(tx, permission):
        # 匹配真实持久工具意图，复用既有 stop_run 围栏和 Scheduler 的 cancel 传播。
        rows = tx.execute("SELECT DISTINCT run_id FROM activities WHERE state IN ('prepared','dispatched') "
            "AND json_extract(document,'$.intent.operation')='skills.run_script' "
            "AND json_extract(document,'$.intent.arguments.arguments.skill_id')=? "
            "AND json_extract(document,'$.intent.arguments.arguments.content_hash')=? "
            "AND json_extract(document,'$.intent.arguments.arguments.environment_id')=? "
            "AND json_extract(document,'$.intent.arguments.arguments.environment_revision')=?",
            (permission.skill_id, permission.content_hash, permission.environment_id,
             permission.environment_revision)).fetchall()
        for row in rows:
            run = load(tx, RunSnapshot, row["run_id"])
            if (permission.scope.workspace_id not in {None, run.workspace_id}
                    or run.state in {"completed", "failed", "cancelled"}):
                continue
            if permission.scope.kind == "user_global" and tx.execute(
                    "SELECT 1 FROM skill_execution_permissions WHERE skill_id=? AND content_hash=? "
                    "AND environment_id=? AND environment_revision=? AND scope_id=? "
                    "AND json_extract(document,'$.status')='active'",
                    (permission.skill_id, permission.content_hash, permission.environment_id,
                     permission.environment_revision, run.workspace_id)).fetchone():
                # 项目独立许可优先；撤销个人许可不能撤销其它 scope 的实际许可。
                continue
            stop_run(tx, run, "interrupted", "execution_permission_revoked")

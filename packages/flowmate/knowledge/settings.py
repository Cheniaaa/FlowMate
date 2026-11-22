"""知识配置固定修订；项目切换先接纳重建，成功后才发布active。"""

from pydantic import Field

from flowmate.contracts.base import CommandMeta, Contract, DomainError, identifier
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import RunLimits, RunSnapshot, ScopeDependency
from flowmate.contracts.scopes import ScopeRef
from flowmate.knowledge.contracts import (
    EmbeddingProfile,
    EmbeddingProfileRef,
    KnowledgeNotice,
    KnowledgeSettings,
)
from flowmate.knowledge.embedding import ResolvedEmbeddingProfile, embedding_endpoint
from flowmate.knowledge.ingestion_contracts import KnowledgeJob
from flowmate.models.pricing import resolve_pricing
from flowmate.policy.contracts import GrantCommand, ResourceRecord
from flowmate.policy.lifecycle import _fingerprint, _replay
from flowmate.runtime.transitions import admission_generations, check_scopes, load, stop_run


class SetProjectKnowledge(Contract):
    embedding_profile: EmbeddingProfileRef | None
    grants: list[GrantCommand] = Field(default_factory=list)


class EmbeddingProfileView(Contract):
    profile: EmbeddingProfile
    destination: str | None
    local_runtime_available: bool | None


class KnowledgeSettingsService:
    def __init__(self, knowledge):
        self.knowledge, self.store = knowledge, knowledge.store

    def profiles(self):
        with self.store.transaction(write=False) as tx:
            return [EmbeddingProfile.model_validate_json(row[0]) for row in tx.execute(
                "SELECT document FROM embedding_profiles p WHERE revision="
                "(SELECT max(revision) FROM embedding_profiles WHERE id=p.id) ORDER BY rowid")]

    @staticmethod
    def resolve_tx(tx, reference):
        row = tx.execute("SELECT resolved FROM embedding_profiles WHERE id=? AND revision=?",
            (reference.id, reference.revision)).fetchone()
        if row is None:
            raise DomainError("embedding_profile_missing", "所选检索模型配置不存在")
        return ResolvedEmbeddingProfile.model_validate_json(row[0])

    def resolve(self, reference):
        with self.store.transaction(write=False) as tx:
            return self.resolve_tx(tx, reference)

    def save_profile(self, profile, meta):
        fingerprint = _fingerprint("knowledge.profile.save", profile.model_dump(mode="json"), meta)
        with self.store.transaction() as tx:
            previous = _replay(tx, meta, fingerprint, EmbeddingProfile)
            if previous is not None:
                return previous
            current = tx.execute("SELECT max(revision) FROM embedding_profiles WHERE id=?", (profile.id,)).fetchone()[0]
            if meta.expected_version != current:
                raise DomainError("version_conflict", "检索模型配置已改变，请读取当前版本")
            profile = profile.model_copy(update={"revision": (current or 0) + 1})
            connection, local_path, pricing = None, None, None
            if profile.provider == "openai":
                connection = tx.get_connection(profile.connection_id)
                embedding_endpoint(connection)
                # embedding没有生成输出；复用既有计价规则解析，不构造生成ModelProfile。
                pricing = resolve_pricing(profile, connection=connection, input_only=True)
            else:
                row = tx.execute("SELECT document FROM resources WHERE id=?", (profile.local_resource_id,)).fetchone()
                if row is None:
                    raise DomainError("embedding_model_directory_missing", "请先选择本地模型目录")
                resource = ResourceRecord.model_validate_json(row[0])
                if resource.kind != "directory":
                    raise DomainError("embedding_model_directory_invalid", "本地模型必须选择目录")
                check_scopes(tx, [ScopeDependency(scope_id=resource.id, epoch=resource.version)])
                anchor = self.knowledge.files.capture(resource.canonical_path)
                if anchor.identity != resource.file_identity:
                    raise DomainError("file_identity_changed", "模型目录已变化，请重新选择")
                local_path = anchor.canonical_path
            resolved = ResolvedEmbeddingProfile(profile=profile, connection=connection,
                local_model_path=local_path, pricing=pricing)
            tx.execute("INSERT INTO embedding_profiles VALUES (?,?,?,?)",
                (profile.id, profile.revision, profile.model_dump_json(), resolved.model_dump_json()))
            tx.append_event(NewEvent(kind="knowledge.changed", causation_id=meta.command_id,
                payload=KnowledgeNotice(workspace_id=None, profile_revisions={profile.id: profile.revision})))
            tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)",
                (meta.command_id, fingerprint, profile.model_dump_json(), None, None))
            return profile

    def set_project(self, workspace_id, request, meta):
        fingerprint = _fingerprint("knowledge.settings.save",
            {"workspace_id": workspace_id, **request.model_dump(mode="json")}, meta)
        with self.store.transaction() as tx:
            previous = _replay(tx, meta, fingerprint, KnowledgeSettings)
            if previous is not None:
                return previous
            current = self.knowledge.settings_tx(tx, workspace_id)
            if meta.expected_version != current.revision:
                raise DomainError("version_conflict", "项目资料设置已改变，请读取当前版本")
            resolved = self.resolve_tx(tx, request.embedding_profile) if request.embedding_profile else None
            destination = (embedding_endpoint(resolved.connection)
                if resolved is not None and resolved.connection is not None else None)
            scope = ScopeRef(kind="workspace", workspace_id=workspace_id)
            for grant in request.grants:
                if (grant.scope != scope or destination is None or grant.destination != destination
                        or grant.purposes != ["embedding_send"]
                        or not (grant.knowledge_scopes or grant.knowledge_source_ids)
                        or grant.resource_ids or grant.memory_scopes or grant.mcp_versions or grant.mcp_queries):
                    raise DomainError("knowledge_grant_invalid", "资料设置只能授权本项目所选检索模型的用途和目的地")
                self.knowledge.policy.grant(grant, CommandMeta(), tx=tx)
            changed = current
            prior_job = (KnowledgeJob.model_validate_json(tx.execute(
                "SELECT document FROM knowledge_jobs WHERE id=?", (current.rebuild_job_id,)).fetchone()[0])
                if current.rebuild_job_id else None)
            retry = prior_job is not None and prior_job.status in {"failed", "cancelled"}
            if request.embedding_profile != current.desired_profile or retry:
                if prior_job is not None and prior_job.status in {"queued", "running"}:
                    from flowmate.knowledge.ingestion import _save_job

                    if prior_job.status == "running":
                        stop_run(tx, load(tx, RunSnapshot, prior_job.task.run_id),
                            "cancelled", "knowledge_rebuild_superseded")
                    else:
                        _save_job(tx, prior_job.model_copy(update={"revision": prior_job.revision + 1,
                            "status": "cancelled", "reason": "knowledge_rebuild_superseded"}))
                job = KnowledgeJob(id=identifier(), command_id=meta.command_id, workspace_id=workspace_id,
                    kind="rebuild", target_profile=request.embedding_profile, target_generation=identifier(),
                    admission_generations=admission_generations(tx, workspace_id, None), limits=RunLimits())
                tx.execute("INSERT INTO knowledge_jobs VALUES (?,?,?,?,?)",
                    (job.id, workspace_id, None, job.status, job.model_dump_json()))
                changed = current.model_copy(update={"revision": current.revision + 1,
                    "desired_profile": request.embedding_profile, "rebuild_job_id": job.id})
                tx.execute("UPDATE knowledge_settings SET document=? WHERE workspace_id=?",
                    (changed.model_dump_json(), workspace_id))
                tx.append_event(NewEvent(kind="knowledge.changed", workspace_id=workspace_id,
                    causation_id=meta.command_id, payload=KnowledgeNotice(workspace_id=workspace_id,
                        settings_revision=changed.revision, job_revisions={job.id: job.revision})))
            tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)",
                (meta.command_id, fingerprint, changed.model_dump_json(), workspace_id, None))
            return changed

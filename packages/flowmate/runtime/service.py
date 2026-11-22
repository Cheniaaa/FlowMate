"""Run命令入口；配置快照、根任务、预算与初始outbox同时提交。"""

import hashlib
import json
from datetime import timedelta

from flowmate.contracts.base import DomainError, identifier
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    TERMINAL,
    ActivitySnapshot,
    AdmissionFence,
    ArtifactRef,
    BudgetAllocation,
    BudgetGroupSnapshot,
    BudgetSnapshot,
    CatalogVersions,
    Checkpoint,
    ConfigSnapshot,
    MessageReceipt,
    ModelMessage,
    OutboxItem,
    PendingUserCommand,
    Question,
    RunLimits,
    RunSnapshot,
    RuntimeChange,
    ScopeDependency,
    SourceSelection,
    StopAllReceipt,
    TaskExecutionBinding,
    TaskSnapshot,
    TextPart,
    ToolResultPart,
    WaitRecord,
)
from flowmate.contracts.scopes import ScopeRef
from flowmate.runtime.leases import acquire_session
from flowmate.runtime.transitions import (
    admission_generations,
    bump,
    check_admission,
    check_scopes,
    context_for,
    emit,
    load,
    pending_outbox,
    stop_run,
    utc_now,
)
from flowmate.settings import SettingsService


class RuntimeCatalog:
    def __init__(self, tools=None, plugins=None, *, agent_executor_id="builtin.agent", tool_catalog=None):
        self.tools = tools or {}
        self.plugins = plugins or {}
        self.agent_executor_id = agent_executor_id
        self.tool_catalog = tool_catalog

    def snapshot(self):
        if self.tool_catalog is not None:
            return self.tool_catalog.execution_snapshot().model_copy(update={
                "plugins": dict(self.plugins), "agent_executor_id": self.agent_executor_id})
        return CatalogVersions(tools=self.tools, plugins=self.plugins,
                               agent_executor_id=self.agent_executor_id)

    def require_available(self, saved: CatalogVersions, *, tx=None) -> None:
        from flowmate.runtime.recovery import require_catalog_available
        require_catalog_available(self.snapshot(), saved, tx=tx)


class RunService:
    def __init__(self, store, catalog, *, clock=None, policy=None, prepare_inputs=None, scheduler=None):
        from flowmate.policy.service import PolicyService
        self.store = store
        self.catalog = catalog
        self.clock = clock or utc_now
        self.policy = policy if policy is not None else PolicyService(store, clock=self.clock)
        self.prepare_inputs = prepare_inputs
        self.scheduler = scheduler

    def _command(self, operation, parameters, meta, model, apply):
        encoded = json.dumps({"operation": operation, "parameters": parameters,
                              "expected_version": meta.expected_version}, sort_keys=True,
                             separators=(",", ":"), allow_nan=False)
        request_hash = hashlib.sha256(encoded.encode()).hexdigest()
        with self.store.transaction() as tx:
            row = tx.previous_command(meta.command_id)
            if row is not None:
                if row["request_hash"] != request_hash:
                    raise DomainError("command_conflict", "同一命令不能更改参数")
                return model.model_validate_json(row["response"])
            result, run = apply(tx)
            workspace_id = (tx.execute("SELECT workspace_id FROM sessions WHERE id=?",
                (run.session_id,)).fetchone()[0] if isinstance(run, PendingUserCommand) else run.workspace_id)
            tx.execute("INSERT INTO commands VALUES (?, ?, ?, ?, ?)",
                       (meta.command_id, request_hash, result.model_dump_json(),
                          workspace_id,
                         run.session_id if isinstance(run, PendingUserCommand) else run.interaction_session_id))
            return result

    @staticmethod
    def _check_version(run, meta):
        if meta.expected_version != run.version:
            raise DomainError("version_conflict", "运行状态已改变，请读取当前版本")

    def start(self, command, meta, *, mcp_server_id=None):
        def apply(tx):
            if tx.execute("SELECT 1 FROM pending_user_commands WHERE session_id=? AND state='queued'",
                          (command.session_id,)).fetchone():
                raise DomainError("session_busy", "请先处理已接收的用户输入")
            pending = self._receive(tx, command, meta, mcp_server_id=mcp_server_id)
            run = self._start_tx(tx, pending)
            return run, run
        parameters = command.model_dump(mode="json")
        if mcp_server_id is not None:
            parameters["mcp_server_id"] = mcp_server_id
        return self._command("run.start", parameters, meta, RunSnapshot, apply)

    @staticmethod
    def _session_file_candidates(tx, session_id, *, include_queue):
        if include_queue:
            for row in tx.execute(
                "SELECT p.document,e.event_id FROM pending_user_commands p JOIN events e "
                "ON e.session_id=p.session_id AND json_extract(e.document,'$.causation_id')=p.command_id "
                "AND json_extract(e.document,'$.kind')='command.queued' "
                "WHERE p.session_id=? AND p.state='queued' ORDER BY p.sequence DESC", (session_id,),
            ):
                pending = PendingUserCommand.model_validate_json(row["document"])
                for id in pending.start.sources.resource_ids:
                    if id in pending.file_inputs:
                        yield (id, pending.file_inputs[id], pending.config.model_profile,
                            pending.command_id, row["event_id"])
        for row in tx.execute(
            "SELECT r.document,e.event_id FROM runs r JOIN events e ON e.run_id=r.id AND e.seq=1 "
            "WHERE r.interaction_session_id=? AND r.execution_session_id=? AND r.kind='user' "
            "AND json_extract(r.document,'$.vision_source_run_id') IS NULL "
            "AND (r.state='completed' OR NOT EXISTS(SELECT 1 FROM pending_user_commands p "
            "WHERE p.command_id=json_extract(e.document,'$.causation_id') AND p.session_id=r.interaction_session_id "
            "AND p.state='applied' AND json_extract(p.document,'$.run_id')=r.id)) "
            "AND (json_array_length(r.document,'$.attached_file_ids') > 0 OR "
            "(json_extract(r.document,'$.attached_file_ids') IS NULL "
            "AND EXISTS(SELECT 1 FROM json_each(r.document,'$.file_inputs')))) ORDER BY r.rowid DESC",
            (session_id, session_id),
        ):
            previous = RunSnapshot.model_validate_json(row["document"])
            attached = previous.attached_file_ids if previous.attached_file_ids is not None else previous.file_inputs
            for id in attached:
                if id in previous.file_inputs:
                    yield id, previous.file_inputs[id], previous.config.model_profile, None, row["event_id"]

    def _session_files(self, tx, session, profile, command, explicit, *, include_queue):
        workspace_id, session_id = session["workspace_id"], session["id"]
        sources = command.sources
        pins = {id: pin.model_copy(update={"inheritance_grants": self.policy.file_inheritance_grants(
            tx, workspace_id, session_id, id, pin, profile.endpoint)}) for id, pin in explicit.items()}
        adoptions = command.session_file_adoptions
        predecessors = {}
        if not command.inherit_session_files:
            missing = tuple(id for id, pin in pins.items() if not pin.inheritance_grants)
            if missing:
                raise DomainError("grant_required", "所选文件缺少当前接收方的发送授权", related_ids=missing)
            if adoptions:
                predecessors = self._verify_session_adoptions(tx, workspace_id, command, pins,
                    include_queue=include_queue)
            return pins, predecessors
        if sources.resource_ids:
            return pins, predecessors
        seen_paths = set()
        moved, changed = [], []
        for id, pin, previous_profile, predecessor, event_id in self._session_file_candidates(
                tx, session_id, include_queue=include_queue):
            resource = tx.execute("SELECT canonical_path FROM resources WHERE id=?", (id,)).fetchone()
            if resource is None or resource[0] in seen_paths:
                continue
            seen_paths.add(resource[0])
            grants = self.policy.file_inheritance_grants(
                tx, workspace_id, session_id, id, pin, previous_profile.endpoint,
                admitted_event_id=event_id, excluded=sources.excluded_source_ids)
            if not grants:
                continue
            if self.policy.file_pin_invalid_reason(tx, id, pin, admitted_event_id=event_id):
                changed.append(id)
            elif (not self.policy.same_model_recipient(previous_profile, profile)
                    or previous_profile.endpoint != profile.endpoint):
                moved.append(id)
            else:
                pins[id] = pin.model_copy(update={"inheritance_grants": grants})
                if predecessor is not None:
                    predecessors[id] = predecessor
            if len(pins) + len(moved) + len(changed) >= 200:
                break
        if changed:
            raise DomainError("file_source_changed", "会话文件版本已改变，请重新选择文件或只发文字",
                related_ids=tuple(changed))
        if moved:
            raise DomainError("session_file_recipient_changed", "会话文件的接收方已改变，请选择只发文字或确认采用所选文件",
                related_ids=tuple(moved))
        return pins, predecessors

    def _verify_session_adoptions(self, tx, workspace_id, command, current_pins, *, include_queue):
        remaining = dict(command.session_file_adoptions)
        predecessors = {}
        for id, prior, profile, predecessor, event_id in self._session_file_candidates(
                tx, command.session_id, include_queue=include_queue):
            if id not in remaining:
                continue
            grants = self.policy.file_inheritance_grants(
                tx, workspace_id, command.session_id, id, prior, profile.endpoint,
                admitted_event_id=event_id, excluded=command.sources.excluded_source_ids)
            if not grants:
                break
            current = current_pins[id]
            if (prior.source_version != remaining[id] or current.source_version != prior.source_version
                    or current.file_identity != prior.file_identity
                    or self.policy.file_pin_invalid_reason(tx, id, prior, admitted_event_id=event_id)):
                raise DomainError("file_source_changed", "原会话文件已改变，请重新选择文件",
                    related_ids=(id,))
            if predecessor is not None:
                predecessors[id] = predecessor
            del remaining[id]
            if not remaining:
                return predecessors
        raise DomainError("grant_required", "原会话文件或原授权已失效，请重新选择文件")

    def continue_vision(self, run_id, profile_id, meta, *, expected=None):
        from flowmate.runtime.vision import continue_vision

        def apply(tx):
            run = continue_vision(self, tx, load(tx, RunSnapshot, run_id), profile_id, meta, expected=expected)
            return run, run
        return self._command("run.continue_vision", {"run_id": run_id, "model_profile_id": profile_id,
            "expected": expected.model_dump(mode="json") if expected else None},
            meta, RunSnapshot, apply)

    def _receive(self, tx, command, meta, *, mcp_server_id=None, file_inputs=None, include_queue=False):
        from flowmate.models.pricing import pricing_reason, resolve_pricing
        from flowmate.policy.contracts import ResourceRecord
        from flowmate.runtime.tasks import result_input

        if meta.expected_version is not None:
            raise DomainError("version_conflict", "新建命令不接受已有版本")
        session = tx.execute("SELECT * FROM sessions WHERE id=?", (command.session_id,)).fetchone()
        if session is None or session["kind"] != "interaction":
            raise DomainError("not_found", "交互会话不存在")
        if session["archived"]:
            raise DomainError("session_archived", "请先明确取消归档，再提交会话任务")
        if command.limits.max_tasks < 1:
            raise DomainError("task_limit", "预算不允许创建根任务")
        dependencies = []
        for id in (session["workspace_id"], session["id"]):
            row = tx.execute("SELECT epoch FROM scopes WHERE id=?", (id,)).fetchone()
            if row is None:
                raise DomainError("scope_revoked", "会话范围不存在")
            dependencies.append(ScopeDependency(scope_id=id, epoch=row[0]))
        check_scopes(tx, dependencies)
        from flowmate.skills.service import SkillService
        SkillService(self.store).resolve(ScopeRef(kind="workspace", workspace_id=session["workspace_id"]),
            command.sources.skill_versions, tx=tx)
        profile = SettingsService.resolve_model(tx, command.model_profile_id, selection=command.model_selection)
        if command.reasoning_effort is not None:
            if command.reasoning_effort not in (profile.capabilities.reasoning_efforts or ()):
                raise DomainError("reasoning_effort_unsupported", "所选连接上的模型不支持此推理强度")
            profile = profile.model_copy(update={"reasoning_effort": command.reasoning_effort})
        if profile.capabilities.tools is False and (mcp_server_id is not None or command.sources.skill_versions):
            raise DomainError("unsupported_capability", "当前模型不支持工具调用，无法使用所选 MCP 或 Skill；请选择支持工具的模型")
        pricing = resolve_pricing(profile)
        catalog = self.catalog.snapshot()
        if catalog.mcp_tools:
            from flowmate.integrations.tools import configured_server
            servers = (configured_server(tx, server_id) for server_id in
                {binding.server_id for binding in catalog.mcp_tools.values()})
            available = {server.id for server in servers
                if server.enabled and server.scope.workspace_id in {None, session["workspace_id"]}}
            selected = {name: binding for name, binding in catalog.mcp_tools.items() if binding.server_id in available}
            catalog = catalog.model_copy(update={"mcp_tools": selected,
                "tools": {name: version for name, version in catalog.tools.items()
                    if name not in catalog.mcp_tools or name in selected}})
        if mcp_server_id is not None:
            from flowmate.integrations.admission import require_ready
            require_ready(tx, catalog, session["workspace_id"], mcp_server_id)
        config = ConfigSnapshot(agent_profile=tx.get_profile("agent", command.agent_profile_id),
            model_profile=profile, model_pricing=pricing,
            pricing_unknown_reason=pricing_reason(profile) if pricing is None else None,
            catalog=catalog.model_copy(update={"tools": {
                name: version for name, version in catalog.tools.items() if name != "agent.finish"}}))
        config = config.model_copy(update={
            "members": SettingsService.resolve_members(tx, config.catalog, command.sources.skill_versions),
        })
        available_knowledge = self.policy.authorized_knowledge_sources(tx, session["workspace_id"])
        chosen_knowledge = command.sources.knowledge_source_ids or available_knowledge
        if not set(chosen_knowledge) <= set(available_knowledge):
            raise DomainError("resource_selection_invalid", "所选知识来源不属于当前获准项目范围")
        command = command.model_copy(update={"sources": command.sources.model_copy(update={
            "knowledge_source_ids": sorted(set(chosen_knowledge) - set(command.sources.excluded_source_ids))})})
        if len(command.sources.resource_ids) != len(set(command.sources.resource_ids)) or len(command.sources.resource_ids) > 200:
            raise DomainError("resource_selection_invalid", "资料选择重复或超限")
        if command.session_file_adoptions and (command.inherit_session_files or command.model_selection is None
                or not command.session_file_adoptions.keys() <= set(command.sources.resource_ids)):
            raise DomainError("resource_selection_invalid", "确认原附件须明确选中文件及接收方")
        for resource_id in command.sources.resource_ids:
            row = tx.execute("SELECT document FROM resources WHERE id=?", (resource_id,)).fetchone()
            resource = ResourceRecord.model_validate_json(row[0]) if row else None
            if (resource is None or resource.scope.workspace_id != session["workspace_id"]
                    or resource.scope.session_id not in {None, session["id"]} or resource.kind == "export"):
                raise DomainError("resource_selection_invalid", "所选资料不属于当前会话")
        memory_scopes = command.sources.memory_scopes
        if len({scope.model_dump_json() for scope in memory_scopes}) != len(memory_scopes):
            raise DomainError("memory_selection_invalid", "记忆范围不能重复")
        from flowmate.policy.service import _scope
        for scope in memory_scopes:
            if scope.kind == "session" or scope.workspace_id not in {None, session["workspace_id"]}:
                raise DomainError("memory_selection_invalid", "记忆范围不属于当前项目或本机用户")
            _scope(tx, scope)
        selected = result_input(tx, command.source_result, command.session_id) if command.source_result else None
        predecessors = {}
        if file_inputs is None:
            file_inputs = (self.prepare_inputs(tx, command.sources, session["workspace_id"], session["id"])
                 if self.prepare_inputs is not None else {})
            if not command.session_file_adoptions.keys() <= file_inputs.keys():
                raise DomainError("resource_selection_invalid", "确认原附件须选择已固定的普通文件")
            file_inputs, predecessors = self._session_files(
                tx, session, profile, command, file_inputs, include_queue=include_queue)
        return PendingUserCommand(command_id=meta.command_id, session_id=command.session_id, start=command,
             file_inputs=file_inputs, session_file_predecessors=predecessors,
            created_seq=tx.execute("SELECT coalesce(max(sequence),0)+1 FROM pending_user_commands WHERE session_id=?",
                (command.session_id,)).fetchone()[0], config=config, scope_dependencies=dependencies,
            admission_generations=admission_generations(tx, session["workspace_id"], session["id"]),
            deadline_at=self.clock() + timedelta(seconds=command.limits.deadline_seconds), input_result=selected)

    @staticmethod
    def _queued_file_is_applied(tx, pending, id, pin, predecessor):
        row = tx.execute(
            "SELECT r.document FROM pending_user_commands p JOIN runs r "
            "ON r.id=json_extract(p.document,'$.run_id') "
            "WHERE p.command_id=? AND p.session_id=? AND p.sequence<? "
            "AND p.state='applied' AND r.state='completed' AND r.interaction_session_id=p.session_id",
            (predecessor, pending.session_id, pending.created_seq),
        ).fetchone()
        if row is None:
            return False
        run = RunSnapshot.model_validate_json(row[0])
        original = run.file_inputs.get(id)
        return (original is not None and id in (run.attached_file_ids if run.attached_file_ids is not None
                else run.file_inputs) and original.file_identity == pin.file_identity
                and original.source_version == pin.source_version)

    def _start_tx(self, tx, pending, *, kind="user", origin=None, additional_result_inputs=(), queued=False):
        command, config = pending.start, pending.config
        workspace_id = tx.execute("SELECT workspace_id FROM sessions WHERE id=?", (pending.session_id,)).fetchone()[0]
        check_scopes(tx, pending.scope_dependencies)
        if tx.execute("SELECT archived FROM sessions WHERE id=?", (pending.session_id,)).fetchone()[0]:
            raise DomainError("session_archived", "归档会话不能应用输入")
        if self.clock() >= pending.deadline_at:
            raise DomainError("deadline_exceeded", "接收时的授权期限已过")
        self.catalog.require_available(config.catalog, tx=tx)
        from flowmate.skills.service import SkillService
        # 排队接收的丛集和 hash 不变；新 Run 应用时只复核实际版本及绑定存续。
        SkillService(self.store).resolve(ScopeRef(kind="workspace", workspace_id=workspace_id),
            command.sources.skill_versions, tx=tx)
        attached = [id for id in command.sources.resource_ids if id in pending.file_inputs]
        file_inputs = pending.file_inputs
        sources = command.sources
        if kind == "user" and origin is None:
            profile = config.model_profile
            attached_ids = set(attached)
            file_inputs, confirmed_ids = {}, []
            for id, pin in pending.file_inputs.items():
                predecessor = pending.session_file_predecessors.get(id)
                if predecessor is not None and not self._queued_file_is_applied(tx, pending, id, pin, predecessor):
                    if id in command.session_file_adoptions:
                        raise DomainError("grant_required", "原排队文件未能生效，请重新选择文件")
                    continue
                if id in attached_ids and command.inherit_session_files:
                    file_inputs[id] = pin
                elif self.policy.file_inheritance_grants(tx, workspace_id, pending.session_id,
                        id, pin, profile.endpoint, excluded=sources.excluded_source_ids):
                    file_inputs[id] = pin
                    confirmed_ids.append(id)
                elif id in attached_ids:
                    raise DomainError("grant_required", "所选文件缺少仍有效的读取和发送授权")
            inherited_ids = [id for id in file_inputs if id not in attached_ids]
            if queued and inherited_ids:
                admitted_event_id = tx.execute(
                    "SELECT event_id FROM events WHERE session_id=? "
                    "AND json_extract(document,'$.kind')='command.queued' "
                    "AND json_extract(document,'$.causation_id')=?",
                    (pending.session_id, pending.command_id),
                ).fetchone()[0]
                changed = tuple(id for id in inherited_ids if self.policy.file_pin_invalid_reason(
                    tx, id, file_inputs[id], admitted_event_id=admitted_event_id))
                if changed:
                    raise DomainError("file_source_changed", "会话文件版本已改变，请重新选择文件或只发文字",
                        related_ids=changed)
            if queued and command.session_file_adoptions:
                adoption_sources = sources.model_copy(update={"resource_ids": list(command.session_file_adoptions)})
                current_pins = self.prepare_inputs(tx, adoption_sources, workspace_id, pending.session_id)
                self._verify_session_adoptions(tx, workspace_id, command, current_pins, include_queue=False)
            if confirmed_ids:
                current_connection = tx.get_connection(profile.connection_id)
                if (not self.policy.same_model_recipient(profile, current_connection)
                        or profile.endpoint != current_connection.endpoint):
                    raise DomainError("session_file_recipient_changed", "会话文件的接收方已改变，请重新确认",
                        related_ids=tuple(confirmed_ids))
            sources = sources.model_copy(update={"resource_ids":
                list(dict.fromkeys([*sources.resource_ids, *file_inputs]))})
        run = RunSnapshot(id=identifier(), workspace_id=workspace_id,
            interaction_session_id=pending.session_id, execution_session_id=pending.session_id,
            root_task_id=identifier(), budget_id=identifier(),
            budget_group_id=origin.budget_group_id if origin else identifier(), kind=kind,
            config=config, scope_dependencies=pending.scope_dependencies, sources=sources,
            file_inputs=file_inputs, attached_file_ids=attached if kind == "user" and origin is None else None,
            allow_managed=command.allow_managed, allow_follow_up=command.allow_follow_up,
            admission_generations=pending.admission_generations, deadline_at=pending.deadline_at)
        check_admission(tx, run)
        acquire_session(tx, pending.session_id, run.id)
        task = TaskSnapshot(id=run.root_task_id, run_id=run.id, kind="agent",
            binding=TaskExecutionBinding(execution_session_id=run.execution_session_id,
                interaction_session_id=run.interaction_session_id, config=config, sources=run.sources,
                file_inputs=run.file_inputs,
                delegation_depth=0, input_result=pending.input_result,
                additional_result_inputs=list(additional_result_inputs)),
            executor_id=config.catalog.agent_executor_id, created_seq=1)
        budget = BudgetSnapshot(id=run.budget_id, run_id=run.id, limits=command.limits,
            task_count=0 if origin else 1)
        groups, allocations = [], []
        if origin:
            from flowmate.runtime.budget import BudgetService
            allocations = [BudgetService().allocate(tx, origin.id, run.id, command.limits)]
        else:
            groups = [BudgetGroupSnapshot(id=run.budget_group_id, limits=command.limits, deadline_at=run.deadline_at)]
            allocations = [BudgetAllocation(run_id=run.id, group_id=run.budget_group_id, limits=command.limits)]
        checkpoint = Checkpoint(task_id=task.id, phase="ready_model", message_boundary=1,
            config_versions=config.catalog.plugins)
        emit(tx, run, task.id, "run.started", RuntimeChange(runs=[run], tasks=[task], budgets=[budget],
            checkpoints=[checkpoint], budget_groups=groups, budget_allocations=allocations,
            messages=[ModelMessage(role="user", parts=[TextPart(text=command.text)],
                source_dependencies=run.scope_dependencies)],
            outbox=[OutboxItem(run_id=run.id, task_id=task.id, operation="step")]), pending.command_id)
        if kind == "user":
            self._name_session(tx, run, command.text, pending.command_id)
        if origin:
            from flowmate.runtime.budget import BudgetService
            BudgetService().count(tx, run.id, "task_count")
        if pending.input_result:
            from flowmate.runtime.tasks import consume_selected_result
            consume_selected_result(tx, context_for(tx, task.id), self.policy)
        return run

    def _name_session(self, tx, run, text, command_id):
        session = SettingsService.derive_session_title(tx, run.interaction_session_id, text, command_id)
        if session is not None and self.scheduler is not None:
            from flowmate.runtime.naming import queue_title

            queue_title(tx, self.scheduler, workspace_id=run.workspace_id, session_id=session.id,
                goal=text, kind="session", target_id=session.id, version=session.version,
                agent=run.config.agent_profile, catalog=run.config.catalog, after_run_id=run.id)

    def suggest_project_title(self, workspace_id, meta):
        from flowmate.runtime.naming import queue_title

        def apply(tx):
            workspace = SettingsService._workspace(tx, workspace_id)
            if workspace.version != meta.expected_version:
                raise DomainError("version_conflict", "项目名称或目录已改变")
            run = queue_title(tx, self.scheduler, workspace_id=workspace_id, session_id=None,
                goal=workspace.name, kind="project", target_id=meta.command_id, version=workspace.version,
                agent=SettingsService._default_agent(tx), catalog=self.catalog.snapshot())
            if run is None:
                raise DomainError("title_model_unavailable", "该项目没有可用的标题模型或预算")
            return run, run

        return self._command("naming.project", {"workspace_id": workspace_id}, meta, RunSnapshot, apply)

    def start_knowledge_import(self, tx, job, config):
        from flowmate.contracts.execution import TaskHandle
        from flowmate.contracts.settings import Session
        from flowmate.knowledge.contracts import SourceVersion
        from flowmate.knowledge.embedding import embedding_endpoint
        from flowmate.knowledge.ingestion import KnowledgeImportState
        from flowmate.knowledge.settings import KnowledgeSettingsService

        if job.kind == "rebuild":
            active = [SourceVersion.model_validate_json(row[0]) for row in tx.execute(
                "SELECT v.document FROM knowledge_sources k JOIN knowledge_versions v "
                "ON v.source_id=k.id AND v.version=json_extract(k.document,'$.active_version') "
                "JOIN scopes s ON s.id=k.id WHERE k.workspace_id=? AND k.status='active' "
                "AND s.status='active' ORDER BY k.rowid", (job.workspace_id,))]
            source_versions = [source for source in active if self.policy.knowledge_grant(
                tx, job.workspace_id, source.source_id, "read") is not None]
        else:
            source_versions = [SourceVersion.model_validate_json(tx.execute(
                "SELECT document FROM knowledge_versions WHERE source_id=? AND version=?",
                (job.source_id, job.source_version)).fetchone()[0])]
        profile = KnowledgeSettingsService.resolve_tx(tx, job.target_profile) if job.target_profile else None
        ids, source_dependencies, destination_dependencies = {job.workspace_id}, {}, {}
        for source in source_versions:
            grant = self.policy.knowledge_grant(tx, job.workspace_id, source.source_id, "read")
            if grant is None:
                raise DomainError("grant_required", "导入来源的读取许可已失效")
            source_dependencies[source.source_id] = [
                ScopeDependency(scope_id=source.source_id, epoch=tx.execute(
                    "SELECT epoch FROM scopes WHERE id=?", (source.source_id,)).fetchone()[0]),
                ScopeDependency(scope_id=grant.id, epoch=grant.epoch)]
            if job.kind == "import":
                ids.update((source.source_id, grant.id))
            elif grant.knowledge_scopes or len(grant.knowledge_source_ids) > 1:
                ids.add(grant.id)
            if profile is not None and profile.connection is not None:
                send = self.policy.knowledge_grant(tx, job.workspace_id, source.source_id,
                    "embedding_send", embedding_endpoint(profile.connection))
                if send is not None:
                    dependency = ScopeDependency(scope_id=send.id, epoch=send.epoch)
                    destination_dependencies[send.id] = dependency
                    source_dependencies[source.source_id].append(dependency)
        dependencies = [ScopeDependency(scope_id=id, epoch=tx.execute(
            "SELECT epoch FROM scopes WHERE id=?", (id,)).fetchone()[0]) for id in sorted(ids)]
        check_scopes(tx, dependencies)
        session = Session(workspace_id=job.workspace_id, title="资料处理", kind="execution", agent_profile_id=None)
        tx.append_event(NewEvent(kind="session.created", workspace_id=job.workspace_id,
            session_id=session.id, payload=session))
        group = BudgetGroupSnapshot(id=identifier(), limits=job.limits,
            deadline_at=self.clock() + timedelta(seconds=job.limits.deadline_seconds))
        sources = SourceSelection(knowledge_source_ids=[source.source_id for source in source_versions])
        run = RunSnapshot(id=identifier(), workspace_id=job.workspace_id, interaction_session_id=None,
            execution_session_id=session.id, root_task_id=identifier(), budget_id=identifier(),
            budget_group_id=group.id, kind="knowledge", config=config, sources=sources,
            scope_dependencies=dependencies, admission_generations=job.admission_generations,
            deadline_at=group.deadline_at)
        check_admission(tx, run)
        task = TaskSnapshot(id=run.root_task_id, run_id=run.id, kind="tool",
            executor_id="knowledge.import", created_seq=1,
            binding=TaskExecutionBinding(execution_session_id=session.id, interaction_session_id=None,
                config=config, sources=sources, delegation_depth=0))
        state = KnowledgeImportState(job_id=job.id, generation=job.target_generation,
            sources=source_versions, source_dependencies=source_dependencies,
            destination_dependencies=list(destination_dependencies.values()), profile=profile)
        phase = ("knowledge.publish" if not source_versions else
            "knowledge.parse" if profile is not None else "knowledge.index")
        emit(tx, run, task.id, "run.started", RuntimeChange(runs=[run], tasks=[task],
            budget_groups=[group], budgets=[BudgetSnapshot(id=run.budget_id, run_id=run.id, limits=job.limits)],
            budget_allocations=[BudgetAllocation(run_id=run.id, group_id=group.id, limits=job.limits)],
            checkpoints=[Checkpoint(task_id=task.id, phase=phase,
                context_manifest={"knowledge_import": state.model_dump(mode="json")})],
            outbox=[OutboxItem(run_id=run.id, task_id=task.id, operation="step")]), job.command_id)
        return TaskHandle(run_id=run.id, task_id=task.id, lifetime="managed")

    def start_maintenance_tx(self, tx, origin, config, limits, sources, dependencies, state, meta):
        """明确确认可建独立维护预算；自动/未确认只分配原组，不接管聊天lease。"""
        from flowmate.contracts.execution import TaskHandle, TaskSubmission
        from flowmate.contracts.settings import Session
        from flowmate.runtime.budget import BudgetService
        confirmed = state.input.authorization.budget_confirmation is not None
        file_inputs = {id: pin for id, pin in origin.file_inputs.items() if id in sources.resource_ids}
        group = (BudgetGroupSnapshot(id=identifier(), limits=limits, task_count=0,
            deadline_at=self.clock() + timedelta(seconds=limits.deadline_seconds)) if confirmed
            else load(tx, BudgetGroupSnapshot, origin.budget_group_id))
        session = Session(workspace_id=origin.workspace_id, title="记忆整理",
            agent_profile_id=config.agent_profile.id, kind="execution")
        tx.append_event(NewEvent(kind="session.created", workspace_id=session.workspace_id,
            session_id=session.id, payload=session))
        run = RunSnapshot(id=identifier(), workspace_id=origin.workspace_id,
            interaction_session_id=origin.interaction_session_id, execution_session_id=session.id,
            root_task_id=identifier(), budget_id=identifier(), budget_group_id=group.id,
            kind="maintenance", config=config, sources=sources, file_inputs=file_inputs,
            scope_dependencies=dependencies,
            admission_generations=(admission_generations(tx, origin.workspace_id, origin.interaction_session_id)
                                   if confirmed else origin.admission_generations),
            deadline_at=min(group.deadline_at, self.clock() + timedelta(seconds=limits.deadline_seconds)))
        check_admission(tx, run)
        allocation = (BudgetAllocation(group_id=group.id, run_id=run.id, limits=limits) if confirmed
            else BudgetService().allocate(tx, origin.id, run.id, limits))
        task = TaskSnapshot(id=run.root_task_id, run_id=run.id, kind="agent",
            origin_task_id=origin.root_task_id, executor_id=config.catalog.agent_executor_id,
            binding=TaskExecutionBinding(execution_session_id=session.id,
                interaction_session_id=run.interaction_session_id, config=config,
                sources=sources, file_inputs=file_inputs, delegation_depth=0), created_seq=1)
        handle = TaskHandle(run_id=run.id, task_id=task.id, lifetime="managed")
        submission = TaskSubmission(handle=handle, command_id=meta.command_id,
            origin_run_id=origin.id, origin_task_id=origin.root_task_id, lifetime="managed",
            args_hash=hashlib.sha256(state.model_dump_json().encode()).hexdigest())
        checkpoint = Checkpoint(task_id=task.id, phase="ready_model", message_boundary=1,
            context_manifest={"memory_maintenance": state.model_dump(mode="json")})
        emit(tx, run, task.id, "run.started", RuntimeChange(runs=[run], tasks=[task],
            budgets=[BudgetSnapshot(id=run.budget_id, run_id=run.id, limits=limits, task_count=0)],
            budget_groups=[group] if confirmed else [],
            budget_allocations=[allocation], submissions=[submission], checkpoints=[checkpoint],
            messages=[ModelMessage(role="user", parts=[TextPart(
                text="仅从本次固定来源提取待审记忆，调用memory.extract提交完整批次；不要执行其他任务。")],
                source_dependencies=dependencies)],
            outbox=[OutboxItem(run_id=run.id, task_id=task.id, operation="step")]), meta.command_id)
        BudgetService().count(tx, run.id, "task_count")
        return handle

    def enqueue_user(self, command, meta, *, mcp_server_id=None):
        from flowmate.contracts.execution import StartRun
        from flowmate.runtime.followups import request_yield

        command = StartRun.model_validate(command.model_dump())
        def apply(tx):
            pending = self._receive(tx, command, meta, mcp_server_id=mcp_server_id, include_queue=True)
            row = tx.execute("SELECT r.document FROM session_leases l JOIN runs r ON r.id=l.run_id "
                "WHERE l.session_id=?", (command.session_id,)).fetchone()
            if row:
                active = RunSnapshot.model_validate_json(row[0])
                if active.kind != "follow_up":
                    raise DomainError("steering_required", "普通用户运行期间请使用steering")
            workspace_id = tx.execute("SELECT workspace_id FROM sessions WHERE id=?",
                (pending.session_id,)).fetchone()[0]
            tx.append_event(NewEvent(kind="command.queued", workspace_id=workspace_id,
                session_id=pending.session_id, causation_id=meta.command_id,
                payload=RuntimeChange(pending_commands=[pending])))
            if row:
                request_yield(tx, active.id, "yield_to_user")
            return pending, pending
        parameters = command.model_dump(mode="json")
        if mcp_server_id is not None:
            parameters["mcp_server_id"] = mcp_server_id
        return self._command("run.enqueue_user", parameters, meta, PendingUserCommand, apply)

    def cancel(self, run_id, meta):
        def apply(tx):
            run = load(tx, RunSnapshot, run_id)
            self._check_version(run, meta)
            run = stop_run(tx, run, "cancelled", "user_cancelled")
            return run, run
        return self._command("run.cancel", {"run_id": run_id}, meta, RunSnapshot, apply)

    def stop_all(self,scope,meta):
        scope=ScopeRef.model_validate(scope.model_dump())
        if scope.kind == "user_global":
            raise DomainError("invalid_scope","停止全部须明确项目或会话范围")
        fingerprint=hashlib.sha256(json.dumps({"scope":scope.model_dump(mode="json"),
            "expected_version":meta.expected_version,"operation":"stop_all"},sort_keys=True).encode()).hexdigest()
        with self.store.transaction() as tx:
            previous=tx.previous_command(meta.command_id)
            if previous is not None:
                if previous["request_hash"] != fingerprint:
                    raise DomainError("command_conflict","同一命令不能改变停止范围")
                return StopAllReceipt.model_validate_json(previous["response"])
            from flowmate.policy.service import _scope
            _scope(tx,scope)
            if scope.kind == "session" and tx.execute(
                    "SELECT kind FROM sessions WHERE id=?",(scope.session_id,)).fetchone()[0] != "interaction":
                raise DomainError("invalid_scope","停止全部只接受交互会话范围")
            id=scope.session_id or scope.workspace_id
            current=admission_generations(tx,scope.workspace_id,scope.session_id)[id]
            if current != meta.expected_version:
                raise DomainError("version_conflict","准入代次已变化，请刷新")
            fence=AdmissionFence(scope=scope,generation=current+1)
            tx.append_event(NewEvent(kind="admission.stopped",workspace_id=scope.workspace_id,
                session_id=scope.session_id,causation_id=meta.command_id,
                payload=RuntimeChange(admission_fences=[fence])))
            if scope.kind == "workspace":
                from flowmate.knowledge.service import KnowledgeService
                KnowledgeService.cancel_pending(tx, scope.workspace_id, meta.command_id)
            column="interaction_session_id" if scope.kind == "session" else "workspace_id"
            from flowmate.runtime.followups import close_intents
            sessions = [id] if scope.kind == "session" else [row[0] for row in tx.execute(
                "SELECT id FROM sessions WHERE workspace_id=? AND kind='interaction'", (id,))]
            for session_id in sessions:
                close_intents(tx, session_id=session_id, reason="stop_all")
            runs=[RunSnapshot.model_validate_json(row[0]) for row in tx.execute(
                f"SELECT document FROM runs WHERE {column}=? AND state NOT IN ('completed','failed','cancelled')",
                (id,)).fetchall()]
            for run in runs:
                if run.kind != "follow_up":
                    stop_run(tx,run,"cancelled","stop_all")
            result=StopAllReceipt(scope=scope,generation=fence.generation,
                cancelled_run_ids=[run.id for run in runs if run.kind != "follow_up"])
            tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)",
                (meta.command_id,fingerprint,result.model_dump_json(),scope.workspace_id,scope.session_id))
            return result

    def resume(self, run_id, meta, *, retry_readonly=False):
        from flowmate.runtime.budget import BudgetService
        from flowmate.runtime.recovery import check_resume, resume_candidates, skip_uncertain_query

        def apply(tx):
            run = load(tx, RunSnapshot, run_id)
            self._check_version(run, meta)
            if run.kind == "follow_up" and run.reason == "yield_to_user":
                if retry_readonly:
                    raise DomainError("resume_blocked", "当前没有可重新发起的只读查询")
                from flowmate.contracts.execution import FollowUpIntent
                from flowmate.runtime.followups import FollowUpService
                row = tx.execute("SELECT document FROM follow_up_intents WHERE json_extract(document,'$.run_id')=?",
                    (run.id,)).fetchone()
                intent = FollowUpIntent.model_validate_json(row[0])
                FollowUpService(self.store, self)._resume(tx, intent, run)
                changed = load(tx, RunSnapshot, run.id)
                return changed, changed
            whole_run = run.state in {"interrupted", "blocked_incompatible"}
            selected = resume_candidates(tx, run)
            uncertain_query, retry_grant = check_resume(tx, run, selected, catalog=self.catalog.snapshot(),
                policy=self.policy, now=self.clock())
            if retry_readonly:
                if retry_grant is None:
                    raise DomainError("resume_blocked", "当前没有可重新发起的只读查询")
                BudgetService().count(tx, run.id, "steps")
            checkpoints, messages = [], []
            tasks, items, activities = [], [], []
            root_state = "running" if whole_run else run.state
            for task in selected:
                checkpoint = load(tx, Checkpoint, task.id)
                if uncertain_query is not None and task.id == uncertain_query.task_id:
                    if retry_readonly:
                        fresh = ActivitySnapshot(id=identifier(), attempt_id=identifier(), run_id=run.id,
                            task_id=task.id, intent=uncertain_query.intent.model_copy(update={"origin": "user"}))
                        activities.append(fresh)
                        items.append(OutboxItem(run_id=run.id, task_id=task.id, activity_id=fresh.id, operation="activity"))
                        checkpoint = bump(checkpoint, pending_activity_ids=[
                            fresh.id if id == uncertain_query.id else id for id in checkpoint.pending_activity_ids],
                            context_manifest={**checkpoint.context_manifest, "mcp_requery": {
                                "activity_id": fresh.id, "original_activity_id": uncertain_query.id,
                                "grant": retry_grant.model_dump(mode="json")}})
                    else:
                        message, checkpoint = skip_uncertain_query(tx, uncertain_query, checkpoint)
                        messages.append(message)
                    checkpoints.append(checkpoint)
                state = task.state if task.state.startswith("waiting_") else "running"
                waits = [WaitRecord.model_validate_json(item[0]) for item in tx.execute(
                    "SELECT document FROM waits WHERE owner_task_id=?", (task.id,))]
                current_waits = [wait for wait in waits if wait.id in checkpoint.wait_ids]
                questions = [Question.model_validate_json(item[0]) for item in tx.execute(
                    "SELECT document FROM questions WHERE task_id=? AND status='pending'", (task.id,))]
                if any(question.id in checkpoint.wait_ids for question in questions):
                    state = "waiting_user"
                elif any(wait.state == "pending" for wait in current_waits) or checkpoint.phase == "joining":
                    state = "waiting_children"
                elif current_waits or state == "waiting_user":
                    state = "running"
                tasks.append(bump(task, state=state, reason=None))
                if task.id == run.root_task_id:
                    root_state = state
                items.extend(pending_outbox(tx, task.id))
                if state == "running":
                    # 已准备但未派发的活动保留身份；已提交结果不再次执行。
                    prepared = tx.execute("SELECT id FROM activities WHERE task_id=? AND state='prepared'",
                                          (task.id,)).fetchall()
                    items.extend(OutboxItem(run_id=run.id, task_id=task.id, activity_id=item[0],
                                            operation="activity") for item in prepared)
                    if not prepared and not (retry_readonly and task.id == run.root_task_id):
                        items.append(OutboxItem(run_id=run.id, task_id=task.id, operation="step"))
            root_selected = any(task.id == run.root_task_id for task in selected)
            changed = bump(run, state=root_state, reason=None if root_selected or whole_run else run.reason)
            if whole_run and run.execution_session_id == run.interaction_session_id:
                acquire_session(tx,run.interaction_session_id,run.id)
            emit(tx, changed, run.root_task_id, "run.resumed",
                 RuntimeChange(runs=[changed], tasks=tasks, outbox=items,
                               checkpoints=checkpoints, messages=messages, activities=activities), meta.command_id)
            return changed, changed
        operation = "run.retry_readonly" if retry_readonly else "run.resume"
        return self._command(operation, {"run_id": run_id}, meta, RunSnapshot, apply)

    def steer(self, run_id, text, meta):
        if not isinstance(text, str) or not text.strip():
            raise DomainError("invalid_command", "补充要求不能为空")
        def apply(tx):
            run = load(tx, RunSnapshot, run_id)
            self._check_version(run, meta)
            if run.state in TERMINAL:
                raise DomainError("run_terminal", "已结束运行不能接收补充要求")
            task = load(tx, TaskSnapshot, run.root_task_id)
            if task.kind != "agent":
                raise DomainError("steering_unsupported", "独立工具运行不接收补充要求，请在完成后发送新消息")
            check_scopes(tx, run.scope_dependencies)
            message = ModelMessage(role="user", parts=[TextPart(text=text)],
                                   source_dependencies=run.scope_dependencies, origin="steering")
            changed = bump(run)
            emit(tx, changed, run.root_task_id, "run.steered",
                 RuntimeChange(runs=[changed], tasks=[bump(task)], messages=[message]), meta.command_id)
            if run.kind == "user":
                self._name_session(tx, run, text, meta.command_id)
            return MessageReceipt(message_id=message.id, run_id=run.id, version=changed.version), changed
        return self._command("run.steer", {"run_id": run_id, "text": text},
                             meta, MessageReceipt, apply)

    def snapshot(self, run_id):
        with self.store.transaction(write=False) as tx:
            return load(tx, RunSnapshot, run_id)

    def export_artifact(self, artifact_id, target_ref, expected_target_hash, meta):
        from flowmate.policy.contracts import ResourceRecord, ToolInvocation
        from flowmate.policy.service import PolicyService

        def apply(tx):
            row = tx.execute("SELECT run_id,document FROM artifacts WHERE id=?", (artifact_id,)).fetchone()
            if row is None:
                raise DomainError("not_found", "产物不存在")
            artifact = ArtifactRef.model_validate_json(row[1])
            if meta.expected_version != artifact.version:
                raise DomainError("version_conflict", "产物版本已改变")
            owner = load(tx, RunSnapshot, row[0])
            if owner.interaction_session_id is not None and tx.execute(
                    "SELECT archived FROM sessions WHERE id=?", (owner.interaction_session_id,)).fetchone()[0]:
                raise DomainError("session_archived","归档会话不能提交新的导出运行")
            row = tx.execute("SELECT document FROM resources WHERE id=?", (target_ref,)).fetchone()
            target = ResourceRecord.model_validate_json(row[0]) if row else None
            if (target is None or target.kind != "export" or target.scope.workspace_id != owner.workspace_id
                    or target.scope.session_id not in {None, owner.interaction_session_id}):
                raise DomainError("export_target_invalid", "导出目标须由当前范围的原生保存选择产生")
            check_scopes(tx, [*owner.scope_dependencies, *artifact.dependencies])
            versions = self.catalog.snapshot()
            if "artifacts.export" not in versions.tools:
                raise DomainError("tool_unavailable", "导出工具未装配")
            run = RunSnapshot(id=identifier(), workspace_id=owner.workspace_id,
                interaction_session_id=owner.interaction_session_id, execution_session_id=owner.interaction_session_id,
                root_task_id=identifier(), budget_id=identifier(),budget_group_id=identifier(),
                scope_dependencies=owner.scope_dependencies,
                sources=SourceSelection(resource_ids=PolicyService.resource_closure(tx, artifact.dependencies,
                    source_run_id=owner.id,source_task_id=artifact.task_id)),
                config=owner.config.model_copy(update={"catalog": versions}),
                deadline_at=self.clock() + timedelta(seconds=RunLimits().deadline_seconds))
            run=run.model_copy(update={"admission_generations":
                admission_generations(tx,run.workspace_id,run.interaction_session_id)})
            limits = RunLimits(max_model_requests=0,max_tasks=1)
            acquire_session(tx,run.interaction_session_id,run.id)
            task = TaskSnapshot(id=run.root_task_id, run_id=run.id, kind="tool",
                binding=TaskExecutionBinding(execution_session_id=run.execution_session_id,
                    interaction_session_id=run.interaction_session_id,config=run.config,
                    sources=run.sources,delegation_depth=0),executor_id="builtin.tool", created_seq=1)
            call = ToolInvocation(call_id=meta.command_id, name="artifacts.export", version=versions.tools["artifacts.export"],
                arguments={"artifact_id": artifact.id, "artifact_version": artifact.version,
                    "content_hash": artifact.content_hash, "target_ref": target_ref, "expected_target_hash": expected_target_hash})
            emit(tx, run, task.id, "run.started", RuntimeChange(runs=[run], tasks=[task],
                budget_groups=[BudgetGroupSnapshot(id=run.budget_group_id,limits=limits,deadline_at=run.deadline_at)],
                budget_allocations=[BudgetAllocation(run_id=run.id,group_id=run.budget_group_id,limits=limits)],
                budgets=[BudgetSnapshot(id=run.budget_id, run_id=run.id, limits=RunLimits(max_model_requests=0, max_tasks=1))],
                checkpoints=[Checkpoint(task_id=task.id, tool_call=call.model_dump(mode="json"), tool_origin="user")],
                outbox=[OutboxItem(run_id=run.id, task_id=task.id, operation="step")]), meta.command_id)
            return run, run
        return self._command("artifact.export", {"artifact_id": artifact_id, "target_ref": target_ref,
            "expected_target_hash": expected_target_hash}, meta, RunSnapshot, apply)

    def answer(self, question_id, answer, meta):
        from jsonschema.exceptions import ValidationError

        from flowmate.agents.checkpoint import answer_validator
        from flowmate.config import MAX_ANSWER_TEXT_BYTES

        def apply(tx):
            question = load(tx, Question, question_id)
            if meta.expected_version != question.version:
                raise DomainError("version_conflict", "问题版本已改变")
            run = load(tx, RunSnapshot, question.run_id)
            task = load(tx, TaskSnapshot, question.task_id)
            checkpoint = load(tx, Checkpoint, task.id)
            if (run.state in {"interrupted", "blocked_incompatible", *TERMINAL}
                    or task.id == run.root_task_id and run.state != "waiting_user"
                    or task.state != "waiting_user" or question.status != "pending"
                    or question.id not in checkpoint.wait_ids or question.call_id not in checkpoint.pending_call_ids):
                raise DomainError("question_inactive", "问题当前不接受回答")
            check_scopes(tx, [*run.scope_dependencies, *question.dependencies])
            if self.clock() >= run.deadline_at:
                raise DomainError("deadline_exceeded", "问题所属运行已过期")
            values, text_bytes = [answer], 0
            while values:
                value = values.pop()
                if isinstance(value, str):
                    text_bytes += len(value.encode("utf-8"))
                elif isinstance(value, dict):
                    values.extend(value.values())
                elif isinstance(value, list):
                    values.extend(value)
                if text_bytes > MAX_ANSWER_TEXT_BYTES:
                    raise DomainError("answer_too_large", "回答文本总量不能超过8KiB")
            try:
                answer_validator(question.answer_schema).validate(answer)
            except ValidationError:
                raise DomainError("answer_invalid", "回答不符合问题Schema") from None
            message = ModelMessage(role="tool", origin="answer", parts=[ToolResultPart(
                call_id=question.call_id, origin_message_id=question.message_id, result=answer)], source_dependencies=question.dependencies)
            pending = [id for id in checkpoint.pending_call_ids if id != question.call_id]
            changed = bump(run, state="running", reason=None) if task.id == run.root_task_id else run
            emit(tx, changed, task.id, "question.answered", RuntimeChange(
                runs=[changed] if task.id == run.root_task_id else [],
                tasks=[bump(task, state="running", reason=None)], messages=[message],
                questions=[bump(question, status="answered", answer_message_id=message.id)],
                checkpoints=[bump(checkpoint, pending_call_ids=pending,
                    wait_ids=[id for id in checkpoint.wait_ids if id != question.id],
                    phase="dispatch_tools" if pending else "ready_model",
                    message_boundary=checkpoint.message_boundary + 1)],
                outbox=[OutboxItem(run_id=run.id, task_id=task.id, operation="step")]), meta.command_id)
            return changed, changed
        return self._command("run.answer", {"question_id": question_id, "answer": answer}, meta, RunSnapshot, apply)

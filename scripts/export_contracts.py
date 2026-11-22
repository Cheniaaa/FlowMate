"""从真实公共DTO根导出Schema；--check只比较。"""

import argparse
import json
from pathlib import Path

from flowmate.api import capabilities as capabilities
from flowmate.api import contracts as api
from flowmate.api.knowledge import KnowledgeSourceView
from flowmate.contracts.base import CommandMeta
from flowmate.contracts.execution import (
    AdmissionFence,
    AgentResult,
    ArtifactRef,
    BudgetAllocation,
    BudgetGroupSnapshot,
    BudgetSnapshot,
    ExportReceipt,
    FollowUpIntent,
    JoinFact,
    MessageReceipt,
    PendingUserCommand,
    Question,
    ResolvedMember,
    ResultConsumption,
    ResultInput,
    RunSnapshot,
    SessionInboxEntry,
    SourceSelection,
    StopAllReceipt,
    SubmitTask,
    TaskExecutionBinding,
    TaskHandle,
    TaskResult,
    TaskSnapshot,
    TaskSubmission,
    TextSlice,
    WaitRecord,
)
from flowmate.contracts.publication import PublicationView
from flowmate.contracts.scopes import ScopeRef
from flowmate.contracts.settings import (
    AgentProfile,
    ModelCandidate,
    ModelConnection,
    ModelDiscoveryResult,
    ModelProfile,
    ModelResolution,
    ProviderPreset,
    Session,
    Workspace,
)
from flowmate.contracts.workspaces import WorkspaceDirectoryView
from flowmate.integrations.configuration_contracts import (
    McpConfiguredServer,
    McpImportPreview,
    McpImportRequest,
    McpSave,
    McpSelectTools,
    McpServerView,
    McpToolSelection,
)
from flowmate.knowledge.contracts import (
    EmbeddingProfile,
    Evidence,
    EvidencePage,
    KnowledgeNotice,
    KnowledgeResult,
    KnowledgeSettings,
    KnowledgeSource,
    SourceVersion,
)
from flowmate.knowledge.ingestion_contracts import (
    KnowledgeCancel,
    KnowledgeImportReceipt,
    KnowledgeImportRequest,
    KnowledgeJob,
    KnowledgeSourceAction,
)
from flowmate.knowledge.settings import EmbeddingProfileView, SetProjectKnowledge
from flowmate.memory.contracts import (
    CreateMemory,
    MemoryDecision,
    MemoryEvidenceExcerpt,
    MemoryEvidenceView,
    MemoryGrantCommand,
    MemoryPolicy,
    MemoryRecord,
)
from flowmate.memory.maintenance_contracts import (
    MemoryMaintenanceNotice,
    MemoryMaintenanceRequest,
    MemorySourceBoundary,
)
from flowmate.policy.contracts import (
    Approval,
    DataUseGrant,
    DeletionReceipt,
    GrantCommand,
    ResourceCoverage,
    ResourceCoverageRequest,
    ResourceRef,
    ScopeState,
)
from flowmate.processes.contracts import (
    ExecutionEnvironmentCommandStatus,
    ExecutionEnvironmentView,
    SaveExecutionEnvironment,
)
from flowmate.skills.contracts import (
    SkillBinding,
    SkillCandidate,
    SkillCandidateDeletion,
    SkillFileSlice,
    SkillRecord,
    SkillResolution,
    SkillSummary,
    SkillVersion,
    SkillView,
)
from flowmate.skills.execution.contracts import SkillExecutionPermission, SkillScriptSettings
from flowmate.skills.export_publication import SkillExportReceipt
from flowmate.tools.catalog import ToolSpec
from pydantic import TypeAdapter

REQUESTS = {
    "ResourceCoverageRequest": ResourceCoverageRequest,
    "SaveSkillExecutionPermissionCommand": api.Command[SkillExecutionPermission],
    "McpSaveCommand": api.Command[McpSave],
    "McpSelectToolsCommand": api.Command[McpSelectTools],
    "McpImportRequest": McpImportRequest,
    "SaveExecutionEnvironmentCommand": api.Command[SaveExecutionEnvironment],
    "StageSkillCommand": capabilities.StageSkillCommand,
    "ImportSkillCommand": capabilities.ImportSkillCommand,
    "PublishSkillCommand": capabilities.PublishSkillCommand,
    "BindSkillCommand": api.Command[SkillBinding],
    "ResolveSkills": capabilities.ResolveSkills,
    "SaveSkillExportCommand": capabilities.SaveSkillExportCommand,
    "SkillScopeRequest": capabilities.SkillScopeRequest,
    "DiscardSkillCandidateCommand": api.Command[capabilities.SkillScopeRequest],
    "CommandMeta": CommandMeta,
    "CreateWorkspaceCommand": api.Command[api.CreateWorkspace],
    "SetWorkspaceDirectoryCommand": api.Command[api.SetWorkspaceDirectory],
    "CreateSessionCommand": api.Command[api.CreateSession],
    "RenameCommand": api.Command[api.Rename],
    "SaveTitlePolicyCommand": api.Command[api.SaveTitlePolicy],
    "SaveAgentCommand": api.Command[AgentProfile], "SaveModelCommand": api.Command[ModelProfile],
    "SaveConnectionCommand": api.Command[ModelConnection],
    "StartRunCommand": api.Command[api.StartRequest], "SteeringCommand": api.Command[api.Steering],
    "VisionContinueCommand": api.Command[api.VisionContinue],
    "AnswerCommand": api.Command[api.Answer], "ApprovalCommand": api.Command[api.ApprovalDecision],
    "GrantRequest": api.Command[GrantCommand], "ExportCommand": api.Command[api.ExportRequest],
    "SubmitTaskCommand": api.Command[SubmitTask],
    "ArchiveSessionCommand": api.Command[api.ArchiveSession],
    "CreateMemoryCommand": api.Command[CreateMemory],
    "MemoryDecisionCommand": api.Command[MemoryDecision],
    "SaveMemoryPolicyCommand": api.Command[MemoryPolicy],
    "MemoryGrantRequest": api.Command[MemoryGrantCommand],
    "SubmitMemoryMaintenanceCommand": api.Command[MemoryMaintenanceRequest],
    "KnowledgeImportCommand": api.Command[KnowledgeImportRequest],
    "KnowledgeCancelCommand": api.Command[KnowledgeCancel],
    "KnowledgeSourceActionCommand": api.Command[KnowledgeSourceAction],
    "SaveEmbeddingProfileCommand": api.Command[EmbeddingProfile],
    "SetProjectKnowledgeCommand": api.Command[SetProjectKnowledge],
}
RESPONSES = {model.__name__: model for model in [
    api.TitlePolicy,
    ResourceCoverage,
    SkillExecutionPermission, SkillScriptSettings, ExecutionEnvironmentView, ExecutionEnvironmentCommandStatus,
    McpConfiguredServer, McpImportPreview, McpServerView, McpToolSelection,
    SkillBinding, SkillCandidate, SkillFileSlice, SkillRecord, SkillResolution,
    SkillSummary, SkillVersion, SkillView, SkillExportReceipt, SkillCandidateDeletion,
    api.Health, api.ErrorEnvelope, Workspace, Session, AgentProfile, ModelProfile, ModelConnection, RunSnapshot,
    MessageReceipt, Approval, DataUseGrant, ResourceRef, TextSlice, ExportReceipt, api.ActivityView,
    TaskSnapshot, Question, BudgetSnapshot, ArtifactRef, api.WorkspaceSnapshot, api.RunDetail,
    api.SessionContext, api.SessionContextUsage,
    BudgetGroupSnapshot, BudgetAllocation, TaskSubmission,
    SessionInboxEntry, AdmissionFence, StopAllReceipt, api.TaskCenterItem, api.PendingAction,
    TaskHandle, TaskResult, WaitRecord, ResultConsumption, JoinFact,SourceSelection,TaskExecutionBinding,ScopeRef,
    ScopeState, DeletionReceipt, PublicationView, api.CommandStatus, api.WorkspaceDirectoryResult, ModelResolution,
    api.NavigationView, api.RunCostSummary, api.ContextUsageSummary, api.RunFeedback, WorkspaceDirectoryView, ModelDiscoveryResult,
    AgentResult, ResolvedMember, api.MemberLane, FollowUpIntent, PendingUserCommand, ResultInput,
    MemoryRecord, MemoryPolicy, MemorySourceBoundary, MemoryMaintenanceNotice, MemoryEvidenceExcerpt,
    KnowledgeNotice, KnowledgeSettings, KnowledgeSource, KnowledgeSourceView, SourceVersion, KnowledgeJob, KnowledgeImportReceipt,
    Evidence, EvidencePage, KnowledgeResult, EmbeddingProfile, EmbeddingProfileView,
]}
RESPONSES.update(PublicEvent=api.PublicEvent, StreamEvent=api.StreamEvent, ModelMessage=api.MessageView)
RESPONSES["PublicationList"] = list[PublicationView]
RESPONSES["SkillPage"] = api.Page[SkillView]
RESPONSES["KnowledgeSourcePage"] = api.Page[KnowledgeSourceView]
RESPONSES["KnowledgeJobPage"] = api.Page[KnowledgeJob]
RESPONSES["EmbeddingProfilePage"] = api.Page[EmbeddingProfile]
RESPONSES["McpServerPage"] = api.Page[McpServerView]
RESPONSES["ExecutionEnvironmentPage"] = api.Page[ExecutionEnvironmentView]
RESPONSES["SkillExportReceiptList"] = list[SkillExportReceipt]
RESPONSES["MemberLaneList"] = list[api.MemberLane]
RESPONSES["ToolSpecList"] = list[ToolSpec]
RESPONSES["ProviderPresetList"] = list[ProviderPreset]
RESPONSES["ModelCandidateList"] = list[ModelCandidate]
RESPONSES["InboxPage"] = api.Page[api.InboxItem]
RESPONSES["TaskCenterPage"] = api.Page[api.TaskCenterItem]
RESPONSES["SessionResultPage"] = api.Page[SessionInboxEntry]
RESPONSES["PendingUserCommandPage"] = api.Page[PendingUserCommand]
RESPONSES["SessionRunPage"] = api.SessionRunPage
RESPONSES["FollowUpIntentPage"] = api.Page[FollowUpIntent]
RESPONSES["RunFeedbackPage"] = api.Page[api.RunFeedback]
RESPONSES["MemoryRecordPage"] = api.Page[MemoryRecord]
RESPONSES["MemoryEvidencePage"] = api.Page[MemoryEvidenceView]
RESPONSES["MemoryMaintenancePage"] = api.Page[MemoryMaintenanceNotice]
RESPONSES.update({name + "Page": api.Page[model] for name, model in {
    "Workspace": Workspace, "Session": Session, "AgentProfile": AgentProfile, "ModelProfile": ModelProfile,
    "ModelConnection": ModelConnection,
    "Run": RunSnapshot, "Task": TaskSnapshot, "Activity": api.ActivityView, "Message": api.MessageView,
    "Artifact": ArtifactRef, "Question": Question, "Approval": Approval, "Resource": ResourceRef,
    "Grant": DataUseGrant,
    "Trace": api.TraceItem, "Wait": WaitRecord, "Consumption": ResultConsumption, "Join": JoinFact,
}.items()})


def _remove_discriminator(value):
    if isinstance(value, dict):
        return {key: _remove_discriminator(item) for key, item in value.items() if key != "discriminator"}
    if isinstance(value, list):
        return [_remove_discriminator(item) for item in value]
    return value


def schemas():
    roots = {}
    for mode, models in (("validation", REQUESTS), ("serialization", RESPONSES)):
        for name, model in models.items():
            schema = _remove_discriminator(TypeAdapter(model).json_schema(mode=mode))
            schema.update(title=name, **{"$schema": "https://json-schema.org/draft/2020-12/schema"})
            roots[name] = {"mode": mode, "schema": schema}
    return {"schema_version": 3, "roots": roots}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    target = Path(__file__).parents[1] / "apps/desktop/src/generated/contracts.schema.json"
    content = json.dumps(schemas(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.check:
        if not target.exists() or target.read_text(encoding="utf-8") != content:
            raise SystemExit("public_contracts_drift")
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()

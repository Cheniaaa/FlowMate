"""Embedding事实接入已有Activity；适配器不拥有调度和预算提交。"""

import json

from flowmate.contracts.execution import (
    ActivityIntent,
    ActivityReceipt,
    ActivitySnapshot,
    ReceiptCommit,
    StepDecision,
)
from flowmate.knowledge.embedding import ResolvedEmbeddingProfile, embedding_endpoint


class EmbeddingRuntime:
    def __init__(self, knowledge, settings, providers):
        self.knowledge, self.settings, self.providers = knowledge, settings, providers
        self.store = knowledge.store

    def profile_view(self, reference):
        from flowmate.knowledge.settings import EmbeddingProfileView

        resolved = self.settings.resolve(reference)
        return EmbeddingProfileView(profile=resolved.profile,
            destination=embedding_endpoint(resolved.connection) if resolved.connection else None,
            local_runtime_available=self.providers[resolved.profile.provider].available()
            if resolved.profile.provider == "fastembed" else None)

    @staticmethod
    def _query_activity(tx, binding):
        row = tx.execute("SELECT document FROM activities WHERE task_id=? AND "
            "json_extract(document,'$.intent.operation')='embedding.query' AND "
            "json_extract(document,'$.intent.arguments.search_id')=? ORDER BY rowid DESC LIMIT 1",
            (binding.task_id, binding.id)).fetchone()
        return ActivitySnapshot.model_validate_json(row[0]) if row else None

    def prepare_query(self, ctx, call_id, request, dependencies, *, origin_message_id=None):
        binding = self.knowledge.prepare_search(ctx, call_id, request, origin_message_id=origin_message_id)
        if request.mode == "bm25" or binding.embedding_profile is None or not binding.sources:
            return None
        with self.store.transaction(write=False) as tx:
            saved = tx.execute("SELECT result FROM knowledge_searches WHERE id=?", (binding.id,)).fetchone()
            if saved["result"] is not None or self._query_activity(tx, binding) is not None:
                return None
            profile = self.settings.resolve_tx(tx, binding.embedding_profile)
        return StepDecision(kind="activity", intent=ActivityIntent(
            kind="model" if profile.profile.provider == "openai" else "tool", origin="runtime",
            operation="embedding.query", arguments={"search_id": binding.id, "texts": [request.query],
                "profile": profile.model_dump(mode="json")}, dependencies=dependencies))

    def query_result(self, binding):
        with self.store.transaction(write=False) as tx:
            activity = self._query_activity(tx, binding)
        if activity is None:
            return None, None
        if activity.embedding_query_abandoned:
            return None, "knowledge_vector_unknown"
        receipt = activity.receipt
        if receipt.error is not None:
            return None, receipt.error
        return receipt.result["vectors"][0], None

    async def drive(self, ctx, activity, cancel, before_send):
        profile = ResolvedEmbeddingProfile.model_validate_json(json.dumps(activity.intent.arguments["profile"]))
        dependencies = activity.intent.dependencies

        def dispatch(request, **kwargs):
            nonlocal dependencies
            permit = before_send(request, **kwargs)
            # 记录实际派发事务核验的许可，不在返回时重读可能已被删除的业务记录。
            dependencies = permit.scope_epochs
            return permit

        outcome = await self.providers[profile.profile.provider].embed(
            activity.intent.arguments["texts"], kind=activity.intent.operation.removeprefix("embedding."),
            profile=profile, ctx=ctx, attempt_id=activity.attempt_id,
            dependencies=activity.intent.dependencies, cancel=cancel, before_send=dispatch)
        receipt = ActivityReceipt(activity_id=activity.id, attempt_id=activity.attempt_id,
            confirmed=outcome.confirmed,
            result={"vectors": outcome.vectors} if outcome.vectors is not None and outcome.error is None else None,
            error=outcome.error, usage=outcome.usage, actual_units=outcome.actual_units,
            provider_request_id=outcome.provider_request_id, source_dependencies=dependencies)
        return receipt, lambda checkpoint: ReceiptCommit(checkpoint=checkpoint,
            next_decision=StepDecision(kind="continue"))

CREATE TABLE model_connections (
    id TEXT PRIMARY KEY,
    current_version INTEGER NOT NULL CHECK (current_version > 0),
    FOREIGN KEY (id, current_version) REFERENCES connection_revisions(connection_id, version)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE connection_revisions (
    connection_id TEXT NOT NULL REFERENCES model_connections(id),
    version INTEGER NOT NULL CHECK (version > 0),
    document TEXT NOT NULL,
    PRIMARY KEY (connection_id, version)
);
CREATE TABLE model_profiles (
    id TEXT PRIMARY KEY,
    current_version INTEGER NOT NULL CHECK (current_version > 0),
    connection_id TEXT NOT NULL REFERENCES model_connections(id),
    model_id TEXT NOT NULL,
    UNIQUE (connection_id, model_id),
    FOREIGN KEY (id, current_version) REFERENCES model_revisions(profile_id, version)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE model_revisions (
    profile_id TEXT NOT NULL REFERENCES model_profiles(id),
    version INTEGER NOT NULL CHECK (version > 0),
    document TEXT NOT NULL,
    PRIMARY KEY (profile_id, version)
);
CREATE TABLE agent_profiles (
    id TEXT PRIMARY KEY,
    current_version INTEGER NOT NULL CHECK (current_version > 0),
    FOREIGN KEY (id, current_version) REFERENCES agent_revisions(profile_id, version)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE agent_revisions (
    profile_id TEXT NOT NULL REFERENCES agent_profiles(id),
    version INTEGER NOT NULL CHECK (version > 0),
    default_model_profile_id TEXT REFERENCES model_profiles(id),
    document TEXT NOT NULL,
    PRIMARY KEY (profile_id, version)
);
CREATE TABLE assistant_identity (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    profile_id TEXT NOT NULL REFERENCES agent_profiles(id)
);
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL CHECK (version > 0),
    name TEXT NOT NULL,
    directory_resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL
);
CREATE TABLE workspace_identity (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL CHECK (version > 0),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    title TEXT NOT NULL,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id),
    kind TEXT NOT NULL CHECK (kind IN ('interaction','execution')),
    archived INTEGER NOT NULL CHECK (archived IN (0,1)),
    document TEXT NOT NULL
);
CREATE INDEX sessions_workspace ON sessions(workspace_id, id);
CREATE TABLE events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    seq INTEGER,
    workspace_id TEXT,
    session_id TEXT,
    event_version INTEGER NOT NULL,
    document TEXT NOT NULL,
    UNIQUE (run_id, seq)
);
CREATE INDEX events_workspace ON events(workspace_id, event_id);
CREATE INDEX events_session ON events(session_id, event_id);
CREATE TABLE commands (
    command_id TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    response TEXT NOT NULL,
    workspace_id TEXT,
    session_id TEXT
);
CREATE TABLE scopes (
    id TEXT PRIMARY KEY,
    epoch INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    kind TEXT NOT NULL CHECK (kind IN ('user_global','workspace','session','resource','grant','memory','skill','mcp')),
    workspace_id TEXT,
    session_id TEXT
);
CREATE TABLE local_identity (
    singleton INTEGER PRIMARY KEY CHECK (singleton=1),
    user_scope_id TEXT NOT NULL UNIQUE REFERENCES scopes(id)
);
CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    interaction_session_id TEXT REFERENCES sessions(id),
    execution_session_id TEXT NOT NULL REFERENCES sessions(id),
    root_task_id TEXT NOT NULL REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED,
    budget_id TEXT NOT NULL REFERENCES budgets(id) DEFERRABLE INITIALLY DEFERRED,
    budget_group_id TEXT NOT NULL REFERENCES budget_groups(id) DEFERRABLE INITIALLY DEFERRED,
    kind TEXT NOT NULL CHECK (kind IN ('user','managed','follow_up','maintenance')),
    state TEXT NOT NULL,
    document TEXT NOT NULL
);
CREATE INDEX runs_session ON runs(interaction_session_id, id);
CREATE INDEX runs_workspace ON runs(workspace_id, id);
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    parent_task_id TEXT REFERENCES tasks(id),
    origin_task_id TEXT REFERENCES tasks(id),
    execution_session_id TEXT NOT NULL REFERENCES sessions(id),
    interaction_session_id TEXT REFERENCES sessions(id),
    state TEXT NOT NULL,
    document TEXT NOT NULL
);
CREATE INDEX tasks_run ON tasks(run_id, id);
CREATE TABLE session_leases (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    run_id TEXT UNIQUE REFERENCES runs(id) DEFERRABLE INITIALLY DEFERRED,
    generation INTEGER NOT NULL CHECK (generation>0)
);
CREATE TABLE pending_user_commands (
    command_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence>0),
    state TEXT NOT NULL CHECK (state IN ('queued','applied','cancelled')),
    document TEXT NOT NULL,
    UNIQUE(session_id,sequence)
);
CREATE TABLE budget_groups (
    id TEXT PRIMARY KEY,
    document TEXT NOT NULL
);
CREATE TABLE budget_allocations (
    run_id TEXT PRIMARY KEY REFERENCES runs(id) DEFERRABLE INITIALLY DEFERRED,
    budget_group_id TEXT NOT NULL REFERENCES budget_groups(id),
    document TEXT NOT NULL
);
CREATE TABLE budgets (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    document TEXT NOT NULL
);
CREATE TABLE activities (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    state TEXT NOT NULL,
    document TEXT NOT NULL
);
CREATE INDEX activities_task ON activities(task_id, state);
CREATE INDEX activities_run ON activities(run_id, id);
CREATE TABLE checkpoints (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id),
    document TEXT NOT NULL
);
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    execution_session_id TEXT NOT NULL REFERENCES sessions(id),
    document TEXT NOT NULL,
    event_id INTEGER NOT NULL REFERENCES events(event_id),
    event_index INTEGER NOT NULL,
    UNIQUE (event_id, event_index)
);
CREATE INDEX messages_run ON messages(run_id, event_id, event_index);
CREATE INDEX messages_session ON messages(execution_session_id,event_id,event_index);

CREATE TABLE task_submissions (
    command_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    origin_run_id TEXT NOT NULL REFERENCES runs(id),
    origin_task_id TEXT NOT NULL REFERENCES tasks(id),
    args_hash TEXT NOT NULL,
    document TEXT NOT NULL
);
CREATE INDEX task_submissions_run ON task_submissions(run_id);
CREATE TABLE waits (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    owner_task_id TEXT NOT NULL REFERENCES tasks(id),
    target_task_id TEXT NOT NULL REFERENCES tasks(id),
    state TEXT NOT NULL,
    continuation_id TEXT NOT NULL,
    document TEXT NOT NULL,
    UNIQUE(owner_task_id, continuation_id)
);
CREATE INDEX waits_target ON waits(target_task_id, state);
CREATE INDEX waits_run ON waits(run_id, state);
CREATE TABLE consumptions (
    id TEXT PRIMARY KEY,
    consumer_run_id TEXT NOT NULL REFERENCES runs(id),
    consumer_task_id TEXT NOT NULL REFERENCES tasks(id),
    execution_session_id TEXT NOT NULL REFERENCES sessions(id),
    target_task_id TEXT NOT NULL REFERENCES tasks(id),
    result_version INTEGER NOT NULL,
    document TEXT NOT NULL,
    UNIQUE(consumer_task_id, execution_session_id, target_task_id, result_version)
);
CREATE INDEX consumptions_run ON consumptions(consumer_run_id, id);
CREATE TABLE joins (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    root_task_id TEXT NOT NULL REFERENCES tasks(id),
    child_task_id TEXT NOT NULL REFERENCES tasks(id),
    child_result_version INTEGER NOT NULL,
    event_id INTEGER NOT NULL REFERENCES events(event_id),
    document TEXT NOT NULL,
    UNIQUE(root_task_id, child_task_id, child_result_version)
);
CREATE INDEX joins_run ON joins(run_id, id);
CREATE TABLE outbox (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    activity_id TEXT REFERENCES activities(id),
    operation TEXT NOT NULL,
    state TEXT NOT NULL,
    document TEXT NOT NULL
);
CREATE INDEX outbox_pending ON outbox(state, run_id);
CREATE UNIQUE INDEX task_pending_step ON outbox(task_id)
    WHERE operation = 'step' AND state = 'pending';
CREATE TABLE resources (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    session_id TEXT REFERENCES sessions(id),
    parent_resource_id TEXT REFERENCES resources(id),
    canonical_path TEXT NOT NULL,
    document TEXT NOT NULL
);
CREATE INDEX resources_scope ON resources(workspace_id, session_id);
CREATE UNIQUE INDEX resource_child_identity ON resources(parent_resource_id, canonical_path,
    json_extract(document,'$.kind'), json_extract(document,'$.file_identity'))
    WHERE parent_resource_id IS NOT NULL;
CREATE TABLE grants (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id),
    session_id TEXT REFERENCES sessions(id),
    status TEXT NOT NULL,
    document TEXT NOT NULL
);
CREATE INDEX grants_scope ON grants(workspace_id, session_id, status);
CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    activity_id TEXT NOT NULL REFERENCES activities(id),
    call_id TEXT NOT NULL,
    status TEXT NOT NULL,
    document TEXT NOT NULL
);
CREATE INDEX approvals_activity ON approvals(activity_id, call_id, status);
CREATE INDEX approvals_run ON approvals(run_id, id);
CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    activity_id TEXT NOT NULL REFERENCES activities(id),
    content_hash TEXT NOT NULL,
    document TEXT NOT NULL
);
CREATE INDEX artifacts_run ON artifacts(run_id, id);
CREATE INDEX artifacts_content ON artifacts(content_hash);
CREATE TABLE private_states (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    run_id TEXT NOT NULL REFERENCES runs(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    activity_id TEXT NOT NULL REFERENCES activities(id),
    public_message_id TEXT NOT NULL REFERENCES messages(id) DEFERRABLE INITIALLY DEFERRED,
    document TEXT NOT NULL
);
CREATE UNIQUE INDEX private_state_message ON private_states(public_message_id);
CREATE TABLE questions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    message_id TEXT NOT NULL REFERENCES messages(id),
    call_id TEXT NOT NULL,
    status TEXT NOT NULL,
    document TEXT NOT NULL,
    UNIQUE(message_id, call_id)
);
CREATE INDEX questions_pending ON questions(run_id, status);
CREATE TABLE accounting_budgets (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE,
    document TEXT NOT NULL
);
CREATE TABLE accounting_activities (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    budget_id TEXT NOT NULL REFERENCES accounting_budgets(id),
    document TEXT NOT NULL
);
CREATE INDEX accounting_run ON accounting_activities(run_id);
CREATE TABLE content_cleanup (
    content_hash TEXT PRIMARY KEY,
    last_error TEXT
);
CREATE TABLE artifact_staging (
    id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    activity_id TEXT NOT NULL
);
CREATE INDEX artifact_staging_content ON artifact_staging(content_hash);
CREATE TABLE cleanup_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    wal_pending INTEGER NOT NULL
);
INSERT INTO cleanup_state VALUES (1, 0);
CREATE TABLE deleted_commands (
    command_id TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL
);
CREATE TABLE delivery_outbox (
    id TEXT PRIMARY KEY,
    source_event_id INTEGER NOT NULL REFERENCES events(event_id),
    target_session_id TEXT NOT NULL REFERENCES sessions(id),
    state TEXT NOT NULL,
    document TEXT NOT NULL,
    UNIQUE(source_event_id,target_session_id)
);
CREATE TABLE delivery_reservations (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED,
    target_session_id TEXT NOT NULL REFERENCES sessions(id),
    released INTEGER NOT NULL CHECK(released IN (0,1)),
    document TEXT NOT NULL
);
CREATE INDEX delivery_capacity ON delivery_reservations(target_session_id,released);
CREATE TABLE admission_fences (
    scope_id TEXT PRIMARY KEY REFERENCES scopes(id),
    generation INTEGER NOT NULL CHECK(generation>0),
    document TEXT NOT NULL
);
CREATE TABLE session_inbox (
    id TEXT PRIMARY KEY,
    source_event_id INTEGER NOT NULL REFERENCES events(event_id),
    target_session_id TEXT NOT NULL REFERENCES sessions(id),
    state TEXT NOT NULL,
    document TEXT NOT NULL,
    UNIQUE(source_event_id,target_session_id)
);
CREATE TABLE follow_up_intents (
    id TEXT PRIMARY KEY,
    source_result_id TEXT NOT NULL,
    target_session_id TEXT NOT NULL REFERENCES sessions(id),
    policy_version INTEGER NOT NULL CHECK (policy_version>0),
    document TEXT NOT NULL,
    UNIQUE(source_result_id,target_session_id,policy_version)
);
CREATE TABLE memory_records (
    id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scopes(id),
    current_revision INTEGER NOT NULL CHECK (current_revision>0),
    document TEXT NOT NULL,
    FOREIGN KEY(id,current_revision) REFERENCES memory_revisions(record_id,revision)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE memory_revisions (
    record_id TEXT NOT NULL REFERENCES memory_records(id),
    revision INTEGER NOT NULL CHECK (revision>0),
    document TEXT NOT NULL,
    PRIMARY KEY(record_id,revision)
);
CREATE TABLE memory_candidates (
    id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scopes(id),
    source_version TEXT NOT NULL,
    policy_version INTEGER NOT NULL CHECK (policy_version>0),
    normalized_claim TEXT NOT NULL,
    document TEXT NOT NULL,
    UNIQUE(scope_id,source_version,policy_version,normalized_claim)
);
CREATE TABLE memory_policies (
    scope_id TEXT PRIMARY KEY REFERENCES scopes(id),
    document TEXT NOT NULL
);
CREATE TABLE context_summaries (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    start_boundary INTEGER NOT NULL CHECK (start_boundary>=0),
    end_boundary INTEGER NOT NULL CHECK (end_boundary>start_boundary),
    activity_id TEXT NOT NULL REFERENCES activities(id),
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    artifact_version INTEGER NOT NULL CHECK (artifact_version>0),
    document TEXT NOT NULL,
    UNIQUE(task_id,start_boundary,end_boundary,activity_id)
);
CREATE TABLE skills (
    id TEXT PRIMARY KEY,
    current_hash TEXT NOT NULL,
    document TEXT NOT NULL,
    FOREIGN KEY(id,current_hash) REFERENCES skill_versions(skill_id,content_hash)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE skill_versions (
    skill_id TEXT NOT NULL REFERENCES skills(id),
    content_hash TEXT NOT NULL,
    document TEXT NOT NULL,
    PRIMARY KEY(skill_id,content_hash)
);
CREATE TABLE execution_environments (
    id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL CHECK (revision>0),
    kind TEXT NOT NULL,
    document TEXT NOT NULL
);
CREATE TABLE skill_bindings (
    id TEXT PRIMARY KEY,
    skill_id TEXT NOT NULL REFERENCES skills(id),
    scope_id TEXT NOT NULL REFERENCES scopes(id),
    enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
    environment_id TEXT REFERENCES execution_environments(id),
    document TEXT NOT NULL,
    UNIQUE(skill_id,scope_id)
);
CREATE TABLE skill_execution_permissions (
    id TEXT PRIMARY KEY,
    skill_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    environment_id TEXT NOT NULL REFERENCES execution_environments(id),
    environment_revision INTEGER NOT NULL CHECK (environment_revision>0),
    scope_id TEXT NOT NULL REFERENCES scopes(id),
    document TEXT NOT NULL,
    FOREIGN KEY(skill_id,content_hash) REFERENCES skill_versions(skill_id,content_hash),
    UNIQUE(skill_id,content_hash,environment_id,environment_revision,scope_id)
);
CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    config_revision INTEGER NOT NULL CHECK (config_revision>0),
    document TEXT NOT NULL
);
CREATE TABLE mcp_catalogs (
    server_id TEXT NOT NULL REFERENCES mcp_servers(id),
    catalog_hash TEXT NOT NULL,
    document TEXT NOT NULL,
    PRIMARY KEY(server_id,catalog_hash)
);

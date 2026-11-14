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
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id)
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
    status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    root_task_id TEXT NOT NULL REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED,
    budget_id TEXT NOT NULL REFERENCES budgets(id) DEFERRABLE INITIALLY DEFERRED,
    state TEXT NOT NULL,
    document TEXT NOT NULL
);
CREATE UNIQUE INDEX session_active_run ON runs(session_id)
    WHERE state NOT IN ('completed', 'failed', 'cancelled');
CREATE INDEX runs_session ON runs(session_id, id);
CREATE INDEX runs_workspace ON runs(workspace_id, id);
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    parent_task_id TEXT REFERENCES tasks(id),
    state TEXT NOT NULL,
    document TEXT NOT NULL
);
CREATE INDEX tasks_run ON tasks(run_id, id);
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
    document TEXT NOT NULL,
    event_id INTEGER NOT NULL REFERENCES events(event_id),
    event_index INTEGER NOT NULL,
    UNIQUE (event_id, event_index)
);
CREATE INDEX messages_run ON messages(run_id, event_id, event_index);

CREATE TABLE task_submissions (
    command_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
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
    run_id TEXT NOT NULL REFERENCES runs(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    target_task_id TEXT NOT NULL REFERENCES tasks(id),
    result_version INTEGER NOT NULL,
    document TEXT NOT NULL,
    UNIQUE(task_id, target_task_id, result_version)
);
CREATE INDEX consumptions_run ON consumptions(run_id, id);
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
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
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

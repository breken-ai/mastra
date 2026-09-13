# Neon MCP local validation

This runbook validates the OSS `connect()` contract from a local process while the Neon credential remains in Nango and Platform. It covers the protocol adapter, live discovery, a safe live tool call, session cleanup, and analytics.

## What the request path should look like

```text
local Mastra app
  |  Mastra Platform bearer token
  v
/v2/connections/:connectionId/mcp
  |  caller auth removed; connection selected server-side
  v
Nango proxy
  |  Neon OAuth/API credential injected outside the app
  v
https://mcp.neon.tech/mcp
```

Responses return through the same path. Platform counts `integration_mcp_tool_calls_total` by integration, tool, and outcome. It does not log or label tool arguments and results.

## 1. Run the offline checks

In the Platform worktree:

```bash
pnpm --filter @platform/connections test
pnpm --filter @platform/integration-routes test
pnpm --filter @platform/integration-routes build
pnpm --filter @platform/integrations build
```

The route suite verifies authentication stripping, MCP header forwarding, session propagation, SSE passthrough, response-size limits, redirect rejection, safe analytics, discovery filtering, and denial before the vendor call.

In the Mastra OSS worktree:

```bash
pnpm --filter @mastra/mcp build:lib
pnpm --filter @mastra/connect test
pnpm --filter @mastra/connect build:lib
```

The Connect suite verifies initialization, `notifications/initialized`, `tools/list`, `tools/call`, flat namespacing, `allowTools`, session reuse, explicit disconnect, URL locking, access-token redaction, and the credential-tool exclusion list.

## 2. Prepare one real Neon connection

Use a development or staging Platform environment with real Nango connectivity.

1. Confirm the public Platform catalog contains `neon` with `capabilities.mcp: true`.
2. Connect Neon through the Platform UI and wait until the connection is `active`.
3. Attach that connection to the project used for validation.
4. If the project has multiple active Neon connections, copy the intended Platform connection ID.
5. Confirm the Nango connection has `mcp_server_url` set to `https://mcp.neon.tech/mcp`. Platform supplies this server-owned value during connect and reconnect sessions.

Do not export a Neon API key, Neon OAuth token, database URL, or PostgreSQL password into the application shell.

## 3. Discover the live catalog locally

From the Mastra OSS repository root:

```bash
export MASTRA_PROJECT_ID='your-platform-project-id'
export MASTRA_PLATFORM_ACCESS_TOKEN='your-platform-access-token'
export MASTRA_INTEGRATIONS_API_URL='https://your-integrations-environment.example'
# Required only when the project has more than one active Neon connection:
export MASTRA_NEON_CONNECTION_ID='your-platform-connection-id'

pnpm --filter @mastra/connect validate:neon-mcp
```

The command prints the names of all currently discovered safe Neon tools. It fails when no Neon tools are available, when `neon_list_projects` or `neon_run_sql` is missing, or when any blocked credential-producing tool reaches the process.

The exact count can change when Neon updates its official server. Review additions before allowing them in production agents. The expected blocked set is:

```text
neon_get_connection_string
neon_create_postgres_role
neon_reset_postgres_role_password
neon_create_credential
neon_rotate_credential
neon_presign_storage_object
```

## 4. Execute a safe live call

```bash
NEON_MCP_VALIDATE_READ=1 pnpm --filter @mastra/connect validate:neon-mcp
```

This performs `neon_list_projects` through `connect()`, Platform, Nango, and the official Neon MCP server. It prints only completion status, not the provider response.

If it fails, check the Platform connection status, project attachment, Nango connection logs, and whether the Neon grant has expired. A `404` from the MCP route usually means the connection is not visible to the project token, is not active, or its integration is not enabled for MCP.

## 5. Verify analytics and secret handling

After the live read:

1. Query `integration_mcp_tool_calls_total{integration_id="neon",tool_name="list_projects",outcome="success"}` and confirm it increased by one.
2. Inspect the `Integration MCP proxy completed` log entry. It should contain organization, user, Platform connection ID, integration ID, method, tool name, outcome, status, latency, and byte counts.
3. Confirm the log does not contain request arguments, result rows, Platform bearer tokens, Neon tokens, connection strings, or passwords.
4. Stop the validator normally and confirm its final MCP `DELETE` reaches the Platform route. The OSS protocol test also makes this deterministic without relying on vendor logs.

## 6. Validate writes deliberately

The live catalog includes write-capable tools such as SQL, migrations, branch management, recovery, and role deletion. Test them only in a disposable Neon project and restrict `allowTools` to the operation being tested.

For SQL, start with a temporary branch and an idempotent fixture. Exercise the returned `neon_run_sql` tool from a small local script or agent, confirm Platform records the tool name and outcome, and remove the fixture. Tools marked destructive by Neon require Mastra tool approval. Missing or ambiguous annotations also require approval.

Do not use a credential-returning operation as a write test. Platform intentionally makes those tool names unavailable.

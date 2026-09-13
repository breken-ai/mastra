# Platform connection tools

`@mastra/connect` exposes tools backed by connections attached to a Mastra Platform project. Provider credentials stay in the platform connection. Tool traffic passes through Platform so calls can be authorized, audited, and counted without logging arguments or results.

## Neon, Resend, and incident.io

Attach a connection to your project using integration ID `neon`, `resend`, or `incident-io`. Configure the Platform project ID and access token, then pass the resolver to your agent's `tools` option:

```ts
import { connect } from '@mastra/connect';

const tools = connect({
  projectId: process.env.MASTRA_PROJECT_ID,
  client: { accessToken: process.env.MASTRA_PLATFORM_ACCESS_TOKEN },
  integrations: {
    neon: { allowTools: ['neon_list_projects', 'neon_run_sql'] },
    resend: { allowTools: ['resend_send_email', 'resend_get_email'] },
    'incident-io': { allowTools: ['incident_io_list_incidents', 'incident_io_list_follow_ups'] },
  },
});
```

The resolver discovers active project connections. Where multiple connections match, select one with `MASTRA_NEON_CONNECTION_ID`, `MASTRA_RESEND_CONNECTION_ID`, or `MASTRA_INCIDENT_IO_CONNECTION_ID`, or the integration's `connectionId` option. The `integrations` entries configure individual providers; they do not disable other attached providers. Set `disabled: true` on providers you want to exclude.

| Provider    | Tool source                                     | Scope                                                                                                                                        |
| ----------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Neon        | Official Neon MCP server, discovered at runtime | Project and branch management, SQL reads and writes, schema, migrations, diagnostics, recovery, roles, storage, functions, and observability |
| Resend      | Generated HTTP tools                            | Send/get/list/cancel emails; create/get/list/verify domains                                                                                  |
| incident.io | Generated HTTP tools                            | List/get/create incidents; list/get/create/update follow-ups; list/get actions; list severities and statuses                                 |

## Neon MCP

`connect()` keeps the same flat dynamic-tool contract. It discovers the official Neon MCP catalog through `/v2/connections/:connectionId/mcp` and namespaces each result as `neon_<tool-name>`. It reuses the MCP session across refreshes and closes sessions when the connection changes, is detached, or `disconnect()` is called.

The application sends only its Mastra Platform token. The transport is locked to the selected Platform connection URL. Platform removes caller authentication before Nango injects the Neon credential, proxies every protocol request to Neon's official server, and records bounded `integrationId`, tool name, and outcome dimensions. Tool arguments and results are not metric dimensions or log fields.

Neon's official catalog can change independently of this package. Use `allowTools` to give an agent the smallest useful subset. Tools with `destructiveHint: true`, or without an explicit non-destructive hint, require tool approval.

The following upstream tools are removed from discovery and rejected by Platform because their result contains a password, bearer credential, or presigned capability URL:

- `get_connection_string`
- `create_postgres_role`
- `reset_postgres_role_password`
- `create_credential`
- `rotate_credential`
- `presign_storage_object`

Project and branch creation remain available because the official Neon server sanitizes connection strings and role passwords from those results.

See the [Neon MCP local validation runbook](./NEON_MCP_LOCAL_VALIDATION.md) for offline protocol tests and a live check from a local application process.

## Generated HTTP providers

Resend and incident.io use checked-in tools generated from their provider contracts. Tool inputs preserve provider field names. Mutations put their JSON request payload under `body`.

```json
{
  "idempotency_key": "welcome-user-123",
  "body": {
    "from": "Team <team@example.com>",
    "to": ["reader@example.com"],
    "subject": "Welcome",
    "text": "Thanks for joining."
  }
}
```

Resend requires a verified sending domain and a key authorized for the operation. A sending-only key cannot list domains or access other account resources. Reuse the idempotency key when retrying the same send. Mastra's proxy runtime does not automatically retry POST requests.

List tools return one provider page and preserve its response envelope. When `next_cursor` is present, pass it as `after` for Resend and incident.io. Preserve filters and sort options between pages.

## Template provenance

Resend and incident.io are generated from integration-template contributions [#667](https://github.com/NangoHQ/integration-templates/pull/667) and [#668](https://github.com/NangoHQ/integration-templates/pull/668). Until they land upstream, the maintainer generator pins the combined contribution revision in `rhysbalevicius/integration-templates`. Each provider manifest records the repository, exact commit, and generated file checksums. Neon is discovered from its official MCP server and has no checked-in provider manifest.

See [maintainer generation commands](./scripts/README.md) and [third-party notices](./NOTICE.md). Generated-provider tests use OpenAPI examples and synthetic fixtures. The Neon tests exercise the MCP lifecycle with a protocol-faithful Platform gateway; the live runbook validates a real connection.

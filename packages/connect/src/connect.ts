import { MCPClient } from '@mastra/mcp';

import type { ConnectClientOptions, ProjectConnection, ResolvedClient } from './client.js';
import { listProjectConnections, platformMcpTransport, resolveClient } from './client.js';
import { MastraConnectError } from './errors.js';
import type { McpProviderRegistration, ProviderRegistration } from './registry.js';
import { PROVIDERS } from './registry.js';
import { applyAllowTools } from './toolset.js';

export interface ConnectIntegrationOptions {
  /** Pin a specific connection id (bypasses env-var fallback and single-active-connection resolution). */
  connectionId?: string;
  /** Restrict the returned toolset to these tool keys. Unknown names throw at build time. */
  allowTools?: string[];
  /** Exclude this provider entirely, even if a connection exists. */
  disabled?: boolean;
}

export interface ConnectOptions {
  /** Platform project whose connections to discover. Falls back to MASTRA_PROJECT_ID. */
  projectId?: string;
  /** Optional per-provider overrides keyed by integrationId. */
  integrations?: Record<string, ConnectIntegrationOptions>;
  client?: ConnectClientOptions;
  /** How long a resolved snapshot stays fresh, in milliseconds. Default 30_000. `0` revalidates every resolution. */
  ttlMs?: number;
}

// Keep the public resolver type structural so linked/local package builds do not
// bind consumers to the exact @mastra/core type instance used to build Connect.
type ResolvedConnectTools = Record<string, { id: string }>;

/**
 * Live tool resolver returned by `connect()`. Pass it straight to an agent's
 * dynamic `tools` argument: Mastra calls it per generate/stream, so project
 * integrations attached or detached on the platform are reflected without
 * restarting the server. Call it directly (`await tools()`) when you need the
 * current flat tool record.
 */
export interface ConnectTools {
  (ctx?: { requestContext?: unknown; mastra?: unknown }): Promise<ResolvedConnectTools>;
  /** Drops the cached snapshot; the next resolution fetches fresh from the platform. */
  invalidate(): void;
  /** Fetches tools from the platform now and updates the cache. Rejects if the platform fetch fails. */
  refresh(): Promise<ResolvedConnectTools>;
  /** Closes MCP transports owned by this resolver and clears its cached snapshot. */
  disconnect(): Promise<void>;
}

interface NormalizedRequest {
  registration: ProviderRegistration;
  options: ConnectIntegrationOptions;
}

const DEFAULT_TTL_MS = 30_000;
/** Minimum wait after a failed platform fetch before another background revalidation. */
const FAILURE_COOLDOWN_MS = 30_000;
let nextResolverId = 0;

/**
 * Returns a live toolset resolver over the project's Platform connections.
 * Providers are discovered from the shipped `PROVIDERS` registry. Tools from
 * every registered provider with a matching project connection are merged into
 * one flat record (matched by `integrationId`). The resolver serves a cached snapshot,
 * revalidating from the platform every `ttlMs`, so integrations attached
 * to (or detached from) the project are picked up (or dropped) without a
 * restart.
 *
 * Configuration errors (missing project id, bad ttlMs, unknown provider in
 * `integrations`) throw here — at call time — so they surface at startup.
 * Expected provider absence is silently skipped. Actionable per-integration
 * problems during resolution (needs re-auth or ambiguity) are downgraded to
 * warn-and-skip so one bad integration never takes down the whole toolset.
 */
export function connect(options: ConnectOptions = {}): ConnectTools {
  const projectId = options.projectId?.trim() || process.env.MASTRA_PROJECT_ID?.trim();
  if (!projectId) {
    throw new MastraConnectError('missing_project_id', 'Missing project id: set MASTRA_PROJECT_ID or pass projectId.');
  }
  if (options.ttlMs !== undefined && (!Number.isFinite(options.ttlMs) || options.ttlMs < 0)) {
    throw new MastraConnectError(
      'invalid_options',
      `Invalid ttlMs (${options.ttlMs}): expected a finite number of milliseconds >= 0.`,
    );
  }
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  const client = resolveClient(options.client);
  const resolverId = ++nextResolverId;
  const mcpClients = new Map<string, { connectionId: string; client: MCPClient }>();
  const requests = buildRequests(options.integrations);

  let cache: { snapshot: ResolvedConnectTools; fetchedAt: number } | undefined;
  let inflight: Promise<ResolvedConnectTools> | undefined;
  let lastFailureAt: number | undefined;

  /** Fetches a fresh snapshot, deduplicating concurrent calls. Rejects on failure. */
  const refresh = (): Promise<ResolvedConnectTools> => {
    if (!inflight) {
      inflight = (async () => {
        try {
          const connections = await listProjectConnections(client, projectId);
          const snapshot = await mapTools(connections, requests, options, client, mcpClients, resolverId);
          cache = { snapshot, fetchedAt: Date.now() };
          lastFailureAt = undefined;
          return snapshot;
        } catch (error) {
          lastFailureAt = Date.now();
          throw error;
        } finally {
          inflight = undefined;
        }
      })();
    }
    return inflight;
  };

  const resolve = async (): Promise<ResolvedConnectTools> => {
    if (cache && Date.now() - cache.fetchedAt < ttlMs) {
      return cache.snapshot;
    }
    if (cache) {
      // Stale: serve the snapshot now and revalidate in the background,
      // swallowing (but warning about) fetch failures. During a sustained
      // platform outage the cooldown keeps this to one request per window
      // instead of one per agent call.
      const staleSnapshot = cache.snapshot;
      const inCooldown = lastFailureAt !== undefined && Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS;
      if (!inCooldown) {
        const staleFetchedAt = cache.fetchedAt;
        void refresh().catch((error: unknown) => {
          console.warn(
            `[@mastra/connect] Keeping cached tools (fetched ${Date.now() - staleFetchedAt}ms ago); platform refresh failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      }
      return staleSnapshot;
    }
    return refresh();
  };

  return Object.assign(resolve, {
    invalidate: (): void => {
      cache = undefined;
    },
    refresh,
    disconnect: async (): Promise<void> => {
      cache = undefined;
      const clients = Array.from(mcpClients.values(), entry => entry.client);
      mcpClients.clear();
      await Promise.allSettled(clients.map(mcp => mcp.disconnect()));
    },
  });
}

function buildRequests(integrations: ConnectOptions['integrations']): NormalizedRequest[] {
  const overrides = integrations ?? {};
  for (const integrationId of Object.keys(overrides)) {
    if (!PROVIDERS.some(p => p.integrationId === integrationId)) {
      throw new MastraConnectError(
        'invalid_options',
        `Unknown provider '${integrationId}' in integrations option. Known providers: ${
          PROVIDERS.map(p => p.integrationId).join(', ') || '(none shipped in this package build)'
        }.`,
      );
    }
  }
  const requests: NormalizedRequest[] = [];
  for (const registration of PROVIDERS) {
    const options = overrides[registration.integrationId] ?? {};
    if (options.disabled) continue;
    requests.push({ registration, options });
  }
  return requests;
}

/** Maps one platform connection list snapshot to a flat tool record, downgrading per-provider failures to warn+skip. */
async function mapTools(
  connections: ProjectConnection[],
  requests: NormalizedRequest[],
  options: ConnectOptions,
  client: ResolvedClient,
  mcpClients: Map<string, { connectionId: string; client: MCPClient }>,
  resolverId: number,
): Promise<ResolvedConnectTools> {
  const byIntegrationId = groupByIntegrationId(connections);
  const activeMcpIntegrations = new Set<string>();
  const result: ResolvedConnectTools = {};
  for (const request of requests) {
    const integrationId = request.registration.integrationId;
    try {
      const candidates = byIntegrationId.get(integrationId) ?? [];
      if (candidates.length === 0) continue;
      const connectionId = resolveProviderConnection(request, candidates);
      if (!connectionId) continue; // warned + skipped
      if (request.registration.transport === 'mcp') {
        activeMcpIntegrations.add(integrationId);
        Object.assign(
          result,
          await discoverMcpTools({
            registration: request.registration,
            connectionId,
            allowTools: request.options.allowTools,
            client,
            mcpClients,
            resolverId,
          }),
        );
      } else {
        Object.assign(
          result,
          request.registration.createTools({
            connectionId,
            allowTools: request.options.allowTools,
            client: options.client,
          }),
        );
      }
    } catch (error) {
      console.warn(
        `[@mastra/connect] Skipping ${integrationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const staleClients = Array.from(mcpClients.entries()).filter(
    ([integrationId]) => !activeMcpIntegrations.has(integrationId),
  );
  for (const [integrationId] of staleClients) mcpClients.delete(integrationId);
  await Promise.allSettled(staleClients.map(([, entry]) => entry.client.disconnect()));
  return result;
}

async function discoverMcpTools(input: {
  registration: McpProviderRegistration;
  connectionId: string;
  allowTools?: string[];
  client: ResolvedClient;
  mcpClients: Map<string, { connectionId: string; client: MCPClient }>;
  resolverId: number;
}): Promise<ResolvedConnectTools> {
  const { registration, connectionId, allowTools, client, mcpClients, resolverId } = input;
  let entry = mcpClients.get(registration.integrationId);
  if (entry?.connectionId !== connectionId) {
    if (entry) await entry.client.disconnect();
    const transport = platformMcpTransport(client, connectionId);
    entry = {
      connectionId,
      client: new MCPClient({
        id: `mastra-connect-${resolverId}-${registration.integrationId}-${connectionId}`,
        servers: {
          [registration.integrationId]: {
            ...transport,
            // Registered MCP providers use server-owned, pinned upstreams, so their
            // annotations are trusted for approval UX. Missing hints take the safe path.
            requireToolApproval: ({ annotations }) => annotations?.destructiveHint !== false,
          },
        },
      }),
    };
    mcpClients.set(registration.integrationId, entry);
  }

  const discovery = await entry.client.listToolsWithErrors();
  const error = discovery.errors[registration.integrationId];
  if (error) throw new Error(`MCP tool discovery failed: ${error}`);
  const excluded = new Set(registration.excludedTools?.map(toolName => `${registration.integrationId}_${toolName}`));
  const safeTools = Object.fromEntries(Object.entries(discovery.tools).filter(([toolName]) => !excluded.has(toolName)));
  return applyAllowTools(safeTools, allowTools) as ResolvedConnectTools;
}

function groupByIntegrationId(connections: ProjectConnection[]): Map<string, ProjectConnection[]> {
  const byIntegrationId = new Map<string, ProjectConnection[]>();
  for (const connection of connections) {
    const list = byIntegrationId.get(connection.integrationId) ?? [];
    list.push(connection);
    byIntegrationId.set(connection.integrationId, list);
  }
  return byIntegrationId;
}

function readEnvConnectionId(registration: ProviderRegistration): string | undefined {
  return process.env[registration.envVar]?.trim() || undefined;
}

/**
 * Resolves the connection to use for one provider, per the contract:
 * option/env var wins; else a single active connection; anything else
 * (ambiguity, needs_reauth, no usable candidate) warns and skips so one bad
 * integration never takes down the whole toolset resolution. A needs_reauth
 * connection is never silently mapped.
 */
function resolveProviderConnection(request: NormalizedRequest, candidates: ProjectConnection[]): string | undefined {
  const integrationId = request.registration.integrationId;
  const directed = request.options.connectionId?.trim() || readEnvConnectionId(request.registration);
  if (directed) {
    const match = candidates.find(connection => connection.id === directed);
    if (!match) {
      console.warn(
        `[@mastra/connect] Skipping ${integrationId}: pinned connection ${directed} is not attached to this project.`,
      );
      return undefined;
    }
    if (match.status === 'needs_reauth') {
      console.warn(`[@mastra/connect] Skipping ${integrationId}: connection ${directed} needs re-auth.`);
      return undefined;
    }
    if (match.status !== 'active') {
      console.warn(
        `[@mastra/connect] Skipping ${integrationId}: connection ${directed} is not active (status '${match.status}').`,
      );
      return undefined;
    }
    return directed;
  }

  const active = candidates.filter(connection => connection.status === 'active');
  if (active.length === 1) return active[0]!.id;
  if (active.length === 0) {
    console.warn(
      `[@mastra/connect] Skipping ${integrationId}: no active connections (found ${candidates.length} in other states).`,
    );
    return undefined;
  }
  console.warn(
    `[@mastra/connect] Skipping ${integrationId}: ${active.length} active connections; pin one with connectionId or ${request.registration.envVar}.`,
  );
  return undefined;
}

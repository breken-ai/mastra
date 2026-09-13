import { RequestContext } from '@mastra/core/request-context';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { platformMcpTransport, resolveClient } from '../client.js';
import { connect } from '../connect.js';

const PLATFORM_TOKEN = 'platform-token';
const CONNECTION_ID = 'neo_01K2E7Q11BCDEFGHJKMNPQRSTV';
const MCP_PATH = `/v2/connections/${CONNECTION_ID}/mcp`;

function requestBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body === 'string') return JSON.parse(init.body) as Record<string, unknown>;
  if (init?.body instanceof Uint8Array) {
    return JSON.parse(new TextDecoder().decode(init.body)) as Record<string, unknown>;
  }
  throw new Error(`Unexpected MCP request body: ${String(init?.body)}`);
}

function createGatewayFetch() {
  const protocolRequests: Array<{ body: Record<string, unknown>; headers: Headers; method: string }> = [];
  let initializeCount = 0;
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/v2/projects/project-1/connections') {
      return Response.json({
        connections: [
          {
            id: CONNECTION_ID,
            integrationId: 'neon',
            status: 'active',
            connectedByUserId: 'user-1',
            connectedAt: '2026-09-13T00:00:00.000Z',
            createdAt: '2026-09-13T00:00:00.000Z',
            accountLabel: 'Neon test account',
          },
        ],
      });
    }
    if (url.pathname !== MCP_PATH) return new Response('not found', { status: 404 });
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });

    const body = requestBody(init);
    const headers = new Headers(init?.headers);
    protocolRequests.push({ body, headers, method: init?.method ?? 'GET' });
    const method = body.method;
    if (method === 'initialize') {
      initializeCount += 1;
      const params = body.params as { protocolVersion?: string };
      return Response.json(
        {
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: params.protocolVersion ?? '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'Neon MCP Server', version: '1.0.0' },
          },
        },
        { headers: { 'mcp-session-id': 'neon-session-1' } },
      );
    }
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (method === 'tools/list') {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          tools: [
            {
              name: 'list_projects',
              description: 'List Neon projects',
              inputSchema: { type: 'object', properties: {}, additionalProperties: false },
              annotations: { readOnlyHint: true, destructiveHint: false },
            },
            {
              name: 'run_sql',
              description: 'Run SQL in a Neon database',
              inputSchema: {
                type: 'object',
                properties: { sql: { type: 'string' } },
                required: ['sql'],
                additionalProperties: false,
              },
              annotations: { readOnlyHint: false, destructiveHint: true },
            },
            {
              name: 'get_connection_string',
              description: 'Return a PostgreSQL URI containing a role password',
              inputSchema: { type: 'object', properties: {}, additionalProperties: false },
              annotations: { readOnlyHint: true, destructiveHint: false },
            },
          ],
        },
      });
    }
    if (method === 'tools/call') {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ rows: [{ answer: 42 }] }) }],
        },
      });
    }
    return new Response(null, { status: 202 });
  });
  return { fetchMock, protocolRequests, getInitializeCount: () => initializeCount };
}

const resolvers: Array<ReturnType<typeof connect>> = [];
afterEach(async () => {
  await Promise.all(resolvers.splice(0).map(resolver => resolver.disconnect()));
});

describe('Neon MCP provider', () => {
  it('keeps connect() unchanged while discovering and executing official MCP tools through Platform', async () => {
    const gateway = createGatewayFetch();
    const tools = connect({
      projectId: 'project-1',
      client: {
        accessToken: PLATFORM_TOKEN,
        baseUrl: 'https://integrations.example.test',
        fetch: gateway.fetchMock,
      },
    });
    resolvers.push(tools);

    const discovered = await tools();
    expect(Object.keys(discovered).sort()).toEqual(['neon_list_projects', 'neon_run_sql']);
    expect(discovered).not.toHaveProperty('neon_get_connection_string');
    const runSql = discovered.neon_run_sql as typeof discovered.neon_run_sql & {
      execute: (input: unknown, context: { requestContext: RequestContext }) => Promise<unknown>;
    };
    await runSql.execute({ sql: 'select 42 as answer' }, { requestContext: new RequestContext() });

    const methods = gateway.protocolRequests.map(request => request.body.method);
    expect(methods).toContain('initialize');
    expect(methods).toContain('tools/list');
    expect(methods).toContain('tools/call');
    const toolCall = gateway.protocolRequests.find(request => request.body.method === 'tools/call')!;
    expect(toolCall.body).toMatchObject({
      method: 'tools/call',
      params: { name: 'run_sql', arguments: { sql: 'select 42 as answer' } },
    });
    for (const request of gateway.protocolRequests) {
      expect(request.headers.get('authorization')).toBe(`Bearer ${PLATFORM_TOKEN}`);
      expect(request.headers.get('accept')).toContain('application/json');
      expect(JSON.stringify(request.body)).not.toContain('api_key');
    }
    expect(gateway.protocolRequests.some(request => request.headers.get('mcp-session-id') === 'neon-session-1')).toBe(
      true,
    );
  });

  it('applies allowTools to namespaced MCP tools', async () => {
    const gateway = createGatewayFetch();
    const tools = connect({
      projectId: 'project-1',
      integrations: { neon: { allowTools: ['neon_list_projects'] } },
      client: {
        accessToken: PLATFORM_TOKEN,
        baseUrl: 'https://integrations.example.test',
        fetch: gateway.fetchMock,
      },
    });
    resolvers.push(tools);

    await expect(tools()).resolves.toEqual(
      expect.objectContaining({ neon_list_projects: expect.objectContaining({ id: expect.any(String) }) }),
    );
    expect(Object.keys(await tools())).toEqual(['neon_list_projects']);
  });

  it('reuses one MCP session across refreshes and closes it explicitly', async () => {
    const gateway = createGatewayFetch();
    const tools = connect({
      projectId: 'project-1',
      client: {
        accessToken: PLATFORM_TOKEN,
        baseUrl: 'https://integrations.example.test',
        fetch: gateway.fetchMock,
      },
    });
    resolvers.push(tools);

    await tools();
    await tools.refresh();
    expect(gateway.getInitializeCount()).toBe(1);
    await tools.disconnect();
    await tools();
    expect(gateway.getInitializeCount()).toBe(2);
  });

  it('locks the transport to its Platform connection URL and redacts token-bearing network errors', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error(`failed with ${PLATFORM_TOKEN}`));
    const client = resolveClient({
      accessToken: PLATFORM_TOKEN,
      baseUrl: 'https://integrations.example.test',
      fetch: fetchMock,
    });
    const transport = platformMcpTransport(client, CONNECTION_ID);

    await expect(transport.fetch('https://attacker.example/mcp')).rejects.toMatchObject({ code: 'invalid_options' });
    await expect(transport.fetch(transport.url)).rejects.toThrow('failed with [REDACTED]');
  });
});

import { RequestContext } from '@mastra/core/request-context';
import { describe, expect, it, vi } from 'vitest';

import { PROVIDERS } from '../index.js';

function toolsWith(fetchMock: ReturnType<typeof vi.fn>) {
  return PROVIDERS.find(provider => provider.integrationId === 'neon')!.createTools({
    connectionId: 'connection',
    client: {
      baseUrl: 'https://platform.example.test',
      accessToken: 'platform-token',
      fetch: fetchMock as unknown as typeof fetch,
    },
  });
}

const result = {
  rows: [{ query_id: '42', total_exec_time: 123 }],
  row_count: 1,
  affected_rows: 1,
  command: 'SELECT',
  truncated: false,
};

describe('Neon SQL diagnostic tools', () => {
  it('runs EXPLAIN through the read-only Platform executor and gates ANALYZE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ results: [result] }));
    const tools = toolsWith(fetchMock);
    const explain = tools.neon_explain_query!;

    expect(typeof explain.requireApproval).toBe('function');
    expect(await (explain.requireApproval as (input: { analyze: boolean }) => boolean)({ analyze: false })).toBe(false);
    expect(await (explain.requireApproval as (input: { analyze: boolean }) => boolean)({ analyze: true })).toBe(true);

    await explain.execute!(
      {
        project_id: 'summer-unit-12345678',
        sql: 'select * from widgets where id = $1',
        parameters: [1],
        analyze: false,
        buffers: false,
        timeout_ms: 5_000,
        max_rows: 100,
      },
      { requestContext: new RequestContext() },
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.mode).toBe('read');
    expect(body.statements).toEqual([
      {
        sql: 'EXPLAIN (FORMAT JSON, ANALYZE false, BUFFERS false) select * from widgets where id = $1',
        parameters: [1],
      },
    ]);
  });

  it('rejects buffer analysis unless ANALYZE is enabled', () => {
    const tools = toolsWith(vi.fn());
    const schema = tools.neon_explain_query!.inputSchema;

    expect(
      schema.safeParse({
        project_id: 'summer-unit-12345678',
        sql: 'select 1',
        analyze: false,
        buffers: true,
      }).success,
    ).toBe(false);
  });

  it('uses a fixed pg_stat_statements query with bounded parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ results: [result] }));
    const tools = toolsWith(fetchMock);

    await expect(
      tools.neon_list_slow_queries!.execute!(
        {
          project_id: 'summer-unit-12345678',
          min_calls: 5,
          limit: 10,
          timeout_ms: 5_000,
        },
        { requestContext: new RequestContext() },
      ),
    ).resolves.toEqual({
      queries: result.rows,
      truncated: false,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.mode).toBe('read');
    expect(body.max_rows).toBe(10);
    expect(body.statements[0].sql).toContain('FROM pg_stat_statements');
    expect(body.statements[0].parameters).toEqual([5, 10]);
  });
});

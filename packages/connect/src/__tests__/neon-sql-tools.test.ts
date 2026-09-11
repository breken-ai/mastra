import { RequestContext } from '@mastra/core/request-context';
import { describe, expect, it, vi } from 'vitest';

import { PROVIDERS } from '../index.js';

const statementResult = {
  rows: [{ id: 1 }],
  row_count: 1,
  affected_rows: 1,
  command: 'SELECT',
  truncated: false,
};

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

describe('Neon SQL and schema tools', () => {
  it('sends parameterized reads to the Platform executor without requesting credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ results: [statementResult] }));
    const tools = toolsWith(fetchMock);

    await expect(
      tools.neon_query!.execute!(
        {
          project_id: 'summer-unit-12345678',
          sql: 'select * from widgets where id = $1',
          parameters: [1],
          timeout_ms: 5_000,
          max_rows: 25,
        },
        { requestContext: new RequestContext() },
      ),
    ).resolves.toEqual(statementResult);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://platform.example.test/v2/connections/connection/neon/sql');
    expect(String(url)).not.toContain('credentials');
    expect(JSON.parse(String(init.body))).toEqual({
      project_id: 'summer-unit-12345678',
      mode: 'read',
      statements: [{ sql: 'select * from widgets where id = $1', parameters: [1] }],
      timeout_ms: 5_000,
      max_rows: 25,
    });
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer platform-token');
  });

  it('marks writes and transactions for approval and sends write mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ results: [statementResult] }));
    const tools = toolsWith(fetchMock);

    expect(tools.neon_execute!.requireApproval).toBe(true);
    expect(tools.neon_transaction!.requireApproval).toBe(true);

    await tools.neon_execute!.execute!(
      {
        project_id: 'summer-unit-12345678',
        sql: 'update widgets set name = $1 where id = $2',
        parameters: ['new', 1],
        timeout_ms: 10_000,
        max_rows: 100,
      },
      { requestContext: new RequestContext() },
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toMatchObject({
      mode: 'write',
      statements: [
        {
          sql: 'update widgets set name = $1 where id = $2',
          parameters: ['new', 1],
        },
      ],
    });
  });

  it('uses fixed, parameterized catalog queries for table inspection', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              ...statementResult,
              rows: [{ table_schema: 'public', table_name: 'widgets', table_type: 'BASE TABLE' }],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          results: [
            { ...statementResult, rows: [{ column_name: 'id' }] },
            { ...statementResult, rows: [{ constraint_name: 'widgets_pkey' }] },
            { ...statementResult, rows: [{ index_name: 'widgets_pkey' }] },
          ],
        }),
      );
    const tools = toolsWith(fetchMock);

    await tools.neon_list_tables!.execute!(
      {
        project_id: 'summer-unit-12345678',
        schema_name: 'public',
        timeout_ms: 10_000,
        max_rows: 100,
      },
      { requestContext: new RequestContext() },
    );
    await expect(
      tools.neon_describe_table!.execute!(
        {
          project_id: 'summer-unit-12345678',
          schema_name: 'public',
          table_name: 'widgets',
          timeout_ms: 10_000,
          max_rows: 100,
        },
        { requestContext: new RequestContext() },
      ),
    ).resolves.toMatchObject({
      columns: [{ column_name: 'id' }],
      constraints: [{ constraint_name: 'widgets_pkey' }],
      indexes: [{ index_name: 'widgets_pkey' }],
    });

    const listBody = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(listBody.statements[0].parameters).toEqual(['public']);
    const describeBody = JSON.parse(String(fetchMock.mock.calls[1]![1].body));
    expect(describeBody.statements).toHaveLength(3);
    expect(describeBody.statements[1].sql).toContain('tc.table_catalog = kcu.table_catalog');
    expect(describeBody.statements[1].sql).toContain('tc.table_schema = kcu.table_schema');
    expect(describeBody.statements[1].sql).toContain('tc.table_name = kcu.table_name');
    expect(
      describeBody.statements.every(
        (statement: { parameters: unknown[] }) => statement.parameters.join(',') === 'public,widgets',
      ),
    ).toBe(true);
  });

  it('applies allowTools after merging generated and extension tools', () => {
    const fetchMock = vi.fn();
    const provider = PROVIDERS.find(entry => entry.integrationId === 'neon')!;

    expect(
      Object.keys(
        provider.createTools({
          connectionId: 'connection',
          allowTools: ['neon_query', 'neon_list_projects'],
          client: { accessToken: 'token', fetch: fetchMock as unknown as typeof fetch },
        }),
      ),
    ).toEqual(['neon_query', 'neon_list_projects']);
  });
});

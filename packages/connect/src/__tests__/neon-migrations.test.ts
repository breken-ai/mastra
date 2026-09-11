import { RequestContext } from '@mastra/core/request-context';
import { describe, expect, it, vi } from 'vitest';

import { PROVIDERS } from '../index.js';

const migration = {
  migration_id: '123e4567-e89b-42d3-a456-426614174000',
  project_id: 'summer-unit-12345678',
  parent_branch_id: 'br-parent-12345678',
  temporary_branch_id: 'br-migration-12345678',
  temporary_branch_name: 'mastra-migration-123e4567-e89b-42d3-a456-426614174000',
  statements: [{ sql: 'alter table widgets add column name text', parameters: [] }],
  timeout_ms: 10_000,
  max_rows: 100,
  prepared_at: '2026-09-11T00:00:00.000Z',
  expires_at: '2026-09-12T00:00:00.000Z',
};

const statementResult = {
  rows: [],
  row_count: 0,
  affected_rows: 1,
  command: 'ALTER',
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

describe('Neon migration tools', () => {
  it('prepares migrations through the credential-safe Platform endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        migration,
        validation_results: [statementResult],
      }),
    );
    const tools = toolsWith(fetchMock);

    expect(tools.neon_prepare_migration!.requireApproval).toBe(true);
    await expect(
      tools.neon_prepare_migration!.execute!(
        {
          project_id: migration.project_id,
          parent_branch_id: migration.parent_branch_id,
          statements: migration.statements,
          timeout_ms: 10_000,
          max_rows: 100,
          ttl_seconds: 86_400,
        },
        { requestContext: new RequestContext() },
      ),
    ).resolves.toEqual({
      migration,
      validation_results: [statementResult],
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://platform.example.test/v2/connections/connection/neon/migrations/prepare');
    expect(String(url)).not.toContain('/proxy');
    expect(String(url)).not.toContain('credentials');
    expect(JSON.parse(String(init.body))).toEqual({
      project_id: migration.project_id,
      parent_branch_id: migration.parent_branch_id,
      statements: migration.statements,
      timeout_ms: 10_000,
      max_rows: 100,
      ttl_seconds: 86_400,
    });
  });

  it('requires an explicit apply-or-discard decision when completing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        applied: true,
        already_applied: false,
        temporary_branch_deleted: true,
        results: [statementResult],
      }),
    );
    const tools = toolsWith(fetchMock);

    expect(tools.neon_complete_migration!.requireApproval).toBe(true);
    const schema = tools.neon_complete_migration!.inputSchema;
    expect(schema.safeParse({ migration }).success).toBe(false);

    await expect(
      tools.neon_complete_migration!.execute!(
        { migration, apply_changes: true },
        { requestContext: new RequestContext() },
      ),
    ).resolves.toEqual({
      applied: true,
      already_applied: false,
      temporary_branch_deleted: true,
      results: [statementResult],
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://platform.example.test/v2/connections/connection/neon/migrations/complete');
    expect(JSON.parse(String(init.body))).toEqual({ migration, apply_changes: true });
  });
});

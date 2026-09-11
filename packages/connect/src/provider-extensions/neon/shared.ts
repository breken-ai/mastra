import { z } from 'zod';

import { executeNeonSql, resolveClient, type NeonSqlRequest, type NeonSqlResponse } from '../../client.js';
import type { ProviderToolsOptions } from '../../toolset.js';
import { resolveConnectionId } from '../../toolset.js';

export const NEON_CONNECTION_ENV_VAR = 'MASTRA_NEON_CONNECTION_ID';

export const neonTargetShape = {
  project_id: z
    .string()
    .regex(/^[a-z0-9-]{1,60}$/)
    .describe('The Neon project ID'),
  branch_id: z
    .string()
    .regex(/^[a-z0-9-]{1,60}$/)
    .optional()
    .describe('The branch to query; Neon uses the default branch when omitted'),
  endpoint_id: z.string().trim().min(1).max(255).optional().describe('A specific compute endpoint'),
  database_name: z.string().trim().min(1).max(255).optional().describe('The database name'),
  role_name: z.string().trim().min(1).max(255).optional().describe('The PostgreSQL role'),
};

export const neonSqlParameterSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export const neonSqlStatementSchema = z.object({
  sql: z.string().trim().min(1).max(100_000).describe('One parameterized PostgreSQL statement'),
  parameters: z
    .array(neonSqlParameterSchema)
    .max(100)
    .default([])
    .describe('Values bound to $1, $2, and subsequent placeholders'),
});

export const neonSqlLimitsShape = {
  timeout_ms: z.number().int().min(100).max(30_000).default(10_000),
  max_rows: z.number().int().min(1).max(1_000).default(100),
};

export const rowSchema = z.record(z.string(), z.unknown());

type NeonTarget = Pick<NeonSqlRequest, 'project_id' | 'branch_id' | 'endpoint_id' | 'database_name' | 'role_name'>;

export function neonTarget(input: NeonTarget): NeonTarget {
  return {
    project_id: input.project_id,
    branch_id: input.branch_id,
    endpoint_id: input.endpoint_id,
    database_name: input.database_name,
    role_name: input.role_name,
  };
}

export async function runNeonSql(
  options: ProviderToolsOptions | undefined,
  input: Omit<NeonSqlRequest, 'mode' | 'statements' | 'timeout_ms' | 'max_rows'>,
  execution: Pick<NeonSqlRequest, 'mode' | 'statements' | 'timeout_ms' | 'max_rows'>,
): Promise<NeonSqlResponse> {
  const connectionId = resolveConnectionId(NEON_CONNECTION_ENV_VAR, options?.connectionId);
  return executeNeonSql(resolveClient(options?.client), connectionId, { ...input, ...execution });
}

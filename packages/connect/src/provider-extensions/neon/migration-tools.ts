import type { ToolsInput } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import {
  completeNeonMigration,
  neonCompleteMigrationResponseSchema,
  neonMigrationSchema,
  neonPrepareMigrationResponseSchema,
  prepareNeonMigration,
  resolveClient,
} from '../../client.js';
import type { ProviderToolsOptions } from '../../toolset.js';
import { resolveConnectionId } from '../../toolset.js';
import { NEON_CONNECTION_ENV_VAR, neonSqlLimitsShape, neonSqlStatementSchema, neonTargetShape } from './shared.js';

const prepareMigrationInputSchema = z.object({
  project_id: neonTargetShape.project_id,
  parent_branch_id: z
    .string()
    .regex(/^[a-z0-9-]{1,60}$/)
    .describe('The production branch that the temporary migration branch copies'),
  database_name: neonTargetShape.database_name,
  role_name: neonTargetShape.role_name,
  statements: z
    .array(neonSqlStatementSchema)
    .min(1)
    .max(25)
    .describe('Migration statements to validate atomically on the temporary branch'),
  timeout_ms: neonSqlLimitsShape.timeout_ms,
  max_rows: neonSqlLimitsShape.max_rows,
  ttl_seconds: z
    .number()
    .int()
    .min(300)
    .max(604_800)
    .default(86_400)
    .describe('How long Neon retains the temporary branch before automatic expiry'),
});

const completeMigrationInputSchema = z.object({
  migration: neonMigrationSchema.describe('The exact migration object returned by neon_prepare_migration'),
  apply_changes: z
    .boolean()
    .describe('Apply the validated statements to the parent branch; false discards the temporary branch'),
});

function connection(options?: ProviderToolsOptions) {
  return {
    id: resolveConnectionId(NEON_CONNECTION_ENV_VAR, options?.connectionId),
    client: resolveClient(options?.client),
  };
}

export function createNeonMigrationTools(options?: ProviderToolsOptions): ToolsInput {
  return {
    neon_prepare_migration: createTool({
      id: 'neon_prepare_migration',
      description:
        'Create an expiring Neon branch, run migration statements there atomically, and return a credential-free migration object for review.',
      inputSchema: prepareMigrationInputSchema,
      outputSchema: neonPrepareMigrationResponseSchema,
      requireApproval: true,
      execute: async input => {
        const resolved = connection(options);
        return prepareNeonMigration(resolved.client, resolved.id, input);
      },
    }),
    neon_complete_migration: createTool({
      id: 'neon_complete_migration',
      description:
        'Apply a prepared Neon migration once to its verified parent branch, or discard it, then clean up the temporary branch.',
      inputSchema: completeMigrationInputSchema,
      outputSchema: neonCompleteMigrationResponseSchema,
      requireApproval: true,
      execute: async input => {
        const resolved = connection(options);
        return completeNeonMigration(resolved.client, resolved.id, input);
      },
    }),
  };
}

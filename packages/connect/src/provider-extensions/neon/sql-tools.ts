import type { ToolsInput } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { neonSqlStatementResultSchema } from '../../client.js';
import type { ProviderToolsOptions } from '../../toolset.js';
import {
  neonSqlLimitsShape,
  neonSqlStatementSchema,
  neonTarget,
  neonTargetShape,
  rowSchema,
  runNeonSql,
} from './shared.js';

const queryInputSchema = z.object({
  ...neonTargetShape,
  sql: neonSqlStatementSchema.shape.sql,
  parameters: neonSqlStatementSchema.shape.parameters,
  ...neonSqlLimitsShape,
});

const executeInputSchema = queryInputSchema;

const transactionInputSchema = z.object({
  ...neonTargetShape,
  statements: z.array(neonSqlStatementSchema).min(1).max(25),
  ...neonSqlLimitsShape,
});

const transactionOutputSchema = z.object({
  results: z.array(neonSqlStatementResultSchema),
});

const listTablesInputSchema = z.object({
  ...neonTargetShape,
  schema_name: z.string().trim().min(1).max(63).optional(),
  ...neonSqlLimitsShape,
});

const listTablesOutputSchema = z.object({ tables: z.array(rowSchema), truncated: z.boolean() });

const describeTableInputSchema = z.object({
  ...neonTargetShape,
  schema_name: z.string().trim().min(1).max(63).default('public'),
  table_name: z.string().trim().min(1).max(63),
  ...neonSqlLimitsShape,
});

const describeTableOutputSchema = z.object({
  columns: z.array(rowSchema),
  constraints: z.array(rowSchema),
  indexes: z.array(rowSchema),
  truncated: z.boolean(),
});

export function createNeonSqlTools(options?: ProviderToolsOptions): ToolsInput {
  return {
    neon_query: createTool({
      id: 'neon_query',
      description:
        'Run one parameterized PostgreSQL query against a Neon database in a read-only transaction. The database credential stays in Mastra Platform.',
      inputSchema: queryInputSchema,
      outputSchema: neonSqlStatementResultSchema,
      execute: async input => {
        const response = await runNeonSql(options, neonTarget(input), {
          mode: 'read',
          statements: [{ sql: input.sql, parameters: input.parameters }],
          timeout_ms: input.timeout_ms,
          max_rows: input.max_rows,
        });
        return response.results[0]!;
      },
    }),
    neon_execute: createTool({
      id: 'neon_execute',
      description:
        'Execute one parameterized PostgreSQL write or DDL statement against a Neon database. The database credential stays in Mastra Platform.',
      inputSchema: executeInputSchema,
      outputSchema: neonSqlStatementResultSchema,
      requireApproval: true,
      execute: async input => {
        const response = await runNeonSql(options, neonTarget(input), {
          mode: 'write',
          statements: [{ sql: input.sql, parameters: input.parameters }],
          timeout_ms: input.timeout_ms,
          max_rows: input.max_rows,
        });
        return response.results[0]!;
      },
    }),
    neon_transaction: createTool({
      id: 'neon_transaction',
      description:
        'Execute up to 25 parameterized PostgreSQL statements atomically against a Neon database. The transaction rolls back if any statement fails.',
      inputSchema: transactionInputSchema,
      outputSchema: transactionOutputSchema,
      requireApproval: true,
      execute: async input =>
        runNeonSql(options, neonTarget(input), {
          mode: 'write',
          statements: input.statements,
          timeout_ms: input.timeout_ms,
          max_rows: input.max_rows,
        }),
    }),
    neon_list_tables: createTool({
      id: 'neon_list_tables',
      description: 'List user tables and views in a Neon PostgreSQL database.',
      inputSchema: listTablesInputSchema,
      outputSchema: listTablesOutputSchema,
      execute: async input => {
        const response = await runNeonSql(options, neonTarget(input), {
          mode: 'read',
          statements: [
            {
              sql: `SELECT table_schema, table_name, table_type
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND ($1::text IS NULL OR table_schema = $1)
ORDER BY table_schema, table_name`,
              parameters: [input.schema_name ?? null],
            },
          ],
          timeout_ms: input.timeout_ms,
          max_rows: input.max_rows,
        });
        const result = response.results[0]!;
        return { tables: result.rows, truncated: result.truncated };
      },
    }),
    neon_describe_table: createTool({
      id: 'neon_describe_table',
      description: 'Describe a Neon PostgreSQL table, including columns, constraints, and indexes.',
      inputSchema: describeTableInputSchema,
      outputSchema: describeTableOutputSchema,
      execute: async input => {
        const response = await runNeonSql(options, neonTarget(input), {
          mode: 'read',
          statements: [
            {
              sql: `SELECT ordinal_position, column_name, data_type, udt_name,
       is_nullable = 'YES' AS is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = $1 AND table_name = $2
ORDER BY ordinal_position`,
              parameters: [input.schema_name, input.table_name],
            },
            {
              sql: `SELECT tc.constraint_name, tc.constraint_type,
       array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
FROM information_schema.table_constraints AS tc
LEFT JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_catalog = kcu.constraint_catalog
 AND tc.constraint_schema = kcu.constraint_schema
 AND tc.constraint_name = kcu.constraint_name
WHERE tc.table_schema = $1 AND tc.table_name = $2
GROUP BY tc.constraint_name, tc.constraint_type
ORDER BY tc.constraint_name`,
              parameters: [input.schema_name, input.table_name],
            },
            {
              sql: `SELECT indexname AS index_name, indexdef AS definition
FROM pg_indexes
WHERE schemaname = $1 AND tablename = $2
ORDER BY indexname`,
              parameters: [input.schema_name, input.table_name],
            },
          ],
          timeout_ms: input.timeout_ms,
          max_rows: input.max_rows,
        });
        return {
          columns: response.results[0]!.rows,
          constraints: response.results[1]!.rows,
          indexes: response.results[2]!.rows,
          truncated: response.results.some(result => result.truncated),
        };
      },
    }),
  };
}

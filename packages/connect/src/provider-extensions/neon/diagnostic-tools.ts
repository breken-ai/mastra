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

const explainQueryInputSchema = z
  .object({
    ...neonTargetShape,
    sql: neonSqlStatementSchema.shape.sql.describe('The query to explain'),
    parameters: neonSqlStatementSchema.shape.parameters,
    analyze: z.boolean().default(false).describe('Execute the query and include actual timing; may be expensive'),
    buffers: z.boolean().default(false).describe('Include buffer usage; requires analyze=true'),
    ...neonSqlLimitsShape,
  })
  .refine(input => !input.buffers || input.analyze, {
    message: 'buffers=true requires analyze=true',
    path: ['buffers'],
  });

const listSlowQueriesInputSchema = z.object({
  ...neonTargetShape,
  min_calls: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  timeout_ms: neonSqlLimitsShape.timeout_ms,
});

const listSlowQueriesOutputSchema = z.object({
  queries: z.array(rowSchema),
  truncated: z.boolean(),
});

export function createNeonDiagnosticTools(options?: ProviderToolsOptions): ToolsInput {
  return {
    neon_explain_query: createTool({
      id: 'neon_explain_query',
      description:
        'Explain a parameterized PostgreSQL query on Neon. Set analyze=true to execute it and include actual timing; execution remains read-only.',
      inputSchema: explainQueryInputSchema,
      outputSchema: neonSqlStatementResultSchema,
      requireApproval: input => input.analyze,
      execute: async input => {
        const response = await runNeonSql(options, neonTarget(input), {
          mode: 'read',
          statements: [
            {
              sql: `EXPLAIN (FORMAT JSON, ANALYZE ${input.analyze}, BUFFERS ${input.buffers}) ${input.sql}`,
              parameters: input.parameters,
            },
          ],
          timeout_ms: input.timeout_ms,
          max_rows: input.max_rows,
        });
        return response.results[0]!;
      },
    }),
    neon_list_slow_queries: createTool({
      id: 'neon_list_slow_queries',
      description:
        'List the PostgreSQL statements with the highest total execution time from pg_stat_statements on Neon.',
      inputSchema: listSlowQueriesInputSchema,
      outputSchema: listSlowQueriesOutputSchema,
      execute: async input => {
        const response = await runNeonSql(options, neonTarget(input), {
          mode: 'read',
          statements: [
            {
              sql: `SELECT queryid::text AS query_id, calls, rows,
       total_exec_time, mean_exec_time, min_exec_time, max_exec_time, query
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND calls >= $1
ORDER BY total_exec_time DESC
LIMIT $2`,
              parameters: [input.min_calls, input.limit],
            },
          ],
          timeout_ms: input.timeout_ms,
          max_rows: input.limit,
        });
        const result = response.results[0]!;
        return { queries: result.rows, truncated: result.truncated };
      },
    }),
  };
}

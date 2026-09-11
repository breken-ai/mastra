import type { ToolsInput } from '@mastra/core/agent';

import type { ProviderToolsOptions } from '../../toolset.js';
import { createNeonDiagnosticTools } from './diagnostic-tools.js';
import { createNeonMigrationTools } from './migration-tools.js';
import { createNeonSqlTools } from './sql-tools.js';

export function createNeonExtensionTools(options?: ProviderToolsOptions): ToolsInput {
  return {
    ...createNeonDiagnosticTools(options),
    ...createNeonMigrationTools(options),
    ...createNeonSqlTools(options),
  };
}

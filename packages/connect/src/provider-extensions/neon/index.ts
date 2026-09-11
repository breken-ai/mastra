import type { ToolsInput } from '@mastra/core/agent';

import type { ProviderToolsOptions } from '../../toolset.js';
import { createNeonSqlTools } from './sql-tools.js';

export function createNeonExtensionTools(options?: ProviderToolsOptions): ToolsInput {
  return {
    ...createNeonSqlTools(options),
  };
}

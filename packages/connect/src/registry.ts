import type { ToolsInput } from '@mastra/core/agent';

import { MCP_PROVIDERS } from './mcp-providers.js';
import { PROVIDERS as GENERATED_PROVIDERS } from './providers/index.js';
import type { ProviderToolsOptions } from './toolset.js';

interface ProviderRegistrationBase {
  /** Platform catalog id used to match project connections. */
  integrationId: string;
  /** Fallback connection-id environment variable when more than one active connection exists. */
  envVar: string;
}

/** A provider whose checked-in tools call the Platform HTTP proxy. */
export interface ProxyProviderRegistration extends ProviderRegistrationBase {
  transport?: 'proxy';
  createTools: (options?: ProviderToolsOptions) => ToolsInput;
}

/** A provider whose tools are discovered from an MCP server through Platform. */
export interface McpProviderRegistration extends ProviderRegistrationBase {
  transport: 'mcp';
  /** Upstream tools whose results would expose credentials or capability URLs. */
  excludedTools?: readonly string[];
}

export type ProviderRegistration = ProxyProviderRegistration | McpProviderRegistration;

/**
 * Providers with shipped toolsets. Generated HTTP providers and MCP-backed
 * providers share the same connection resolution contract, so `connect()` can
 * merge them into one flat record.
 */
export const PROVIDERS: readonly ProviderRegistration[] = [...GENERATED_PROVIDERS, ...MCP_PROVIDERS];

export function findRegistration(integrationId: string): ProviderRegistration | undefined {
  return PROVIDERS.find(p => p.integrationId === integrationId);
}

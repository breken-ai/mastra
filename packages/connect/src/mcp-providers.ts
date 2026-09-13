import type { McpProviderRegistration } from './registry.js';

/**
 * Providers whose tool catalogs are discovered from their official MCP server
 * through the Mastra Platform connection gateway.
 */
export const MCP_PROVIDERS: readonly McpProviderRegistration[] = [
  {
    integrationId: 'neon',
    envVar: 'MASTRA_NEON_CONNECTION_ID',
    transport: 'mcp',
    excludedTools: [
      'get_connection_string',
      'create_postgres_role',
      'reset_postgres_role_password',
      'create_credential',
      'rotate_credential',
      'presign_storage_object',
    ],
  },
];

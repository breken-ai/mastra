import { RequestContext } from '@mastra/core/request-context';

import { connect } from '../src/connect.js';
import { MCP_PROVIDERS } from '../src/mcp-providers.js';
import { PROVIDERS } from '../src/registry.js';

const REQUIRED_TOOLS = ['neon_list_projects', 'neon_run_sql'] as const;
const neon = MCP_PROVIDERS.find(provider => provider.integrationId === 'neon');

if (!neon) {
  throw new Error('The Neon MCP provider is not registered.');
}

const integrations = Object.fromEntries(
  PROVIDERS.map(provider => [provider.integrationId, { disabled: provider.integrationId !== 'neon' }]),
);
const resolver = connect({ integrations });

try {
  const tools = await resolver.refresh();
  const names = Object.keys(tools)
    .filter(name => name.startsWith('neon_'))
    .sort();

  if (names.length === 0) {
    throw new Error('No Neon tools were discovered. Check the project connection and Platform MCP gateway.');
  }
  for (const required of REQUIRED_TOOLS) {
    if (!tools[required]) throw new Error(`Neon discovery did not include required tool ${required}.`);
  }
  for (const excluded of neon.excludedTools ?? []) {
    const namespaced = `neon_${excluded}`;
    if (tools[namespaced]) {
      throw new Error(`Credential-bearing tool ${namespaced} was exposed to the application process.`);
    }
  }

  console.log(`Discovered ${names.length} safe Neon tools through Mastra Platform.`);
  console.log(names.join('\n'));

  if (process.env.NEON_MCP_VALIDATE_READ === '1') {
    const listProjects = tools.neon_list_projects as {
      execute?: (input: unknown, context: { requestContext: RequestContext }) => Promise<unknown>;
    };
    if (!listProjects.execute) throw new Error('neon_list_projects is missing its execute function.');
    await listProjects.execute({}, { requestContext: new RequestContext() });
    console.log('neon_list_projects completed through the Platform proxy.');
  } else {
    console.log('Set NEON_MCP_VALIDATE_READ=1 to execute the safe neon_list_projects live check.');
  }
} finally {
  await resolver.disconnect();
}

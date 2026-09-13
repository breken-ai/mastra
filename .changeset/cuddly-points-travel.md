---
'@mastra/connect': minor
---

Added runtime discovery of the official Neon MCP tool catalog through Mastra Platform. Neon credentials stay outside the application process, while Platform proxies and measures tool calls. Credential-producing tools are excluded.

```ts
import { connect } from '@mastra/connect';

const tools = connect({
  integrations: {
    neon: { allowTools: ['neon_list_projects', 'neon_run_sql'] },
  },
});
```

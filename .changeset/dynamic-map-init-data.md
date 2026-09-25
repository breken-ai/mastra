---
'@mastra/core': patch
---

Fixed saving dynamic workflows that map a value from the workflow input with `{ initData: true, path: '...' }`. `toStorableGraph` dropped the `initData` source, so saving failed with "Path mappings must reference exactly one of initData or step" and a rehydrated workflow crashed at run time. The source is now kept, so the saved workflow runs the same as the original. Fixes [#24982](https://github.com/mastra-ai/mastra/issues/24982).

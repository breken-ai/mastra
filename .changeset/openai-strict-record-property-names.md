---
'@mastra/schema-compat': patch
---

Fixed OpenAI structured output failing for schemas with a `z.record()` field. The strict-mode schema no longer includes `propertyNames`, which OpenAI rejects with "'propertyNames' is not permitted". Tool schemas already dropped it.

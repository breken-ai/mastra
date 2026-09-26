---
'@mastra/inngest': patch
---

Fixed failed Inngest workflow runs showing `[object Object]` as the error on the workflow trace span. The span now records the step error's real message.

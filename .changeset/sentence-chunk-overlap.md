---
'@mastra/rag': patch
---

Fixed the `sentence` chunking strategy with `overlap`. It could return a chunk that only repeated the previous chunk's overlap sentences, and a chunk larger than `maxSize` when the overlap plus the next sentence did not fit. Overlap is now trimmed so every chunk stays within `maxSize`, and overlap alone is never returned as its own chunk.

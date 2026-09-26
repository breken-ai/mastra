import { Mastra } from '@mastra/core/mastra';
import { Inngest } from 'inngest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { InngestExecutionEngine } from './execution-engine';
import { init } from './index';

describe('InngestWorkflow workflow span', () => {
  it('keeps the message of a serialized step error on the workflow span', async () => {
    const inngest = new Inngest({ id: 'workflow-span-error-tests', baseUrl: 'http://localhost:4199' });
    const { createWorkflow, createStep } = init(inngest);
    const step1 = createStep({
      id: 'step1',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({}),
    });
    const workflow = createWorkflow({
      id: 'span-error-workflow',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
    })
      .then(step1)
      .commit();

    const spanError = vi.fn();
    const observability = {
      startSpan: vi.fn(() => ({ exportSpan: () => ({ id: 'span-1', traceId: 'trace-1' }) })),
      rebuildSpan: vi.fn(() => ({ error: spanError, end: vi.fn() })),
      flush: vi.fn(async () => {}),
    };
    const mastra = new Mastra({ logger: false, workflows: { spanErrorWorkflow: workflow } });
    vi.spyOn(mastra.observability, 'getSelectedInstance').mockReturnValue(observability as any);

    // A failed step result carries a serialized error (`SerializedError`), not an `Error` instance.
    const execute = vi.spyOn(InngestExecutionEngine.prototype, 'execute').mockResolvedValue({
      status: 'failed',
      steps: {},
      state: {},
      error: { name: 'Error', message: 'step output size is greater than the limit' },
    } as any);
    const lifecycle = vi
      .spyOn(InngestExecutionEngine.prototype as any, 'invokeLifecycleCallbacksInternal')
      .mockResolvedValue(undefined);
    const step = { run: vi.fn(async (_id: string, fn: () => unknown) => fn()) };

    try {
      await workflow
        .getFunction()
        .fn({ event: { data: { inputData: {}, runId: 'span-error-run' } }, step, attempt: 0 } as any)
        .catch(() => undefined);
    } finally {
      execute.mockRestore();
      lifecycle.mockRestore();
    }

    expect(spanError).toHaveBeenCalledTimes(1);
    expect(spanError.mock.calls[0][0].error.message).toBe('step output size is greater than the limit');
  });
});

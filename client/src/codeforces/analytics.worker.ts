/**
 * Web Worker for heavy analytics computation (§C — "worker when >500 subs").
 * Receives a WorkerRequest, runs computeAnalytics, posts back a WorkerResponse.
 *
 * Vite handles the ES worker bundle when imported with `new Worker(url, {type:'module'})`.
 * No Vue imports — this file must remain a plain TS module.
 */
import { computeAnalytics } from './analytics.ts';
import type { WorkerRequest, WorkerResponse } from './types.ts';

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type !== 'compute') return;
  try {
    const result = computeAnalytics(msg.submissions);
    const response: WorkerResponse = { type: 'result', result };
    self.postMessage(response);
  } catch (err) {
    const response: WorkerResponse = {
      type: 'error',
      message: err instanceof Error ? err.message : 'Analytics computation failed.',
    };
    self.postMessage(response);
  }
};

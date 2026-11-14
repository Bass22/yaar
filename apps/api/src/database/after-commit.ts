import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** Work that waits for the request's transaction to be committed: what must never run for a write rolled back. */
export type AfterCommitTask = () => Promise<void>;
export type AfterCommitRequest = { afterCommit?: AfterCommitTask[] };

/**
 * `@AfterCommit() later`: `later(task)` runs the task once the transaction of the request is
 * committed (Y.2a: a notification never tells of a write that did not happen). After the answer,
 * out of the request: a failing task changes nothing for the caller.
 */
export const AfterCommit = createParamDecorator((_data: unknown, context: ExecutionContext): ((task: AfterCommitTask) => void) => {
  const request = context.switchToHttp().getRequest<AfterCommitRequest>();
  const tasks = request.afterCommit;
  if (tasks === undefined) throw new Error('AfterCommit used on a route without a tenant transaction.');
  return (task) => tasks.push(task);
});

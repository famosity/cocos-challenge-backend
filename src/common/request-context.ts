import { AsyncLocalStorage } from 'node:async_hooks';

export const REQUEST_ID_HEADER = 'X-Request-Id';

type RequestStore = {
  requestId: string;
};

export const requestContext = new AsyncLocalStorage<RequestStore>();

export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

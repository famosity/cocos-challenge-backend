import { AsyncLocalStorage } from 'node:async_hooks';
export const requestContext = new AsyncLocalStorage();
export function currentRequestId() {
    return requestContext.getStore()?.requestId;
}
//# sourceMappingURL=request-context.js.map
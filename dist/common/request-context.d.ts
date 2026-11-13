import { AsyncLocalStorage } from 'node:async_hooks';
type RequestStore = {
    requestId: string;
};
export declare const requestContext: AsyncLocalStorage<RequestStore>;
export declare function currentRequestId(): string | undefined;
export {};

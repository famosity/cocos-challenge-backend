import { type FieldError } from './app-error.js';
export type ErrorBody = {
    statusCode: number;
    code: string;
    message: string;
    requestId: string;
    details?: FieldError[];
};
export declare function toErrorBody(exception: unknown, requestId: string): ErrorBody;

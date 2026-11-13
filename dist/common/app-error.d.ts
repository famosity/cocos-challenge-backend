export type FieldError = {
    field: string;
    message: string;
};
export declare class AppError extends Error {
    readonly statusCode: number;
    readonly code: string;
    readonly details?: FieldError[] | undefined;
    constructor(statusCode: number, code: string, message: string, details?: FieldError[] | undefined);
}

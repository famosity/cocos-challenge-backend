import type { LoggerService } from '@nestjs/common';
export declare class JsonLogger implements LoggerService {
    log(message: unknown, context?: string): void;
    error(message: unknown, stack?: string, context?: string): void;
    warn(message: unknown, context?: string): void;
    debug(message: unknown, context?: string): void;
    verbose(message: unknown, context?: string): void;
    private write;
}

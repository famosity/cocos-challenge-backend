export class JsonLogger {
    log(message, context) {
        this.write('info', message, context);
    }
    error(message, stack, context) {
        this.write('error', message, context, stack);
    }
    warn(message, context) {
        this.write('warn', message, context);
    }
    debug(message, context) {
        this.write('debug', message, context);
    }
    verbose(message, context) {
        this.write('verbose', message, context);
    }
    write(level, message, context, stack) {
        const line = typeof message === 'string' && message.startsWith('{')
            ? message
            : JSON.stringify({ level, message, context, stack });
        process.stdout.write(line.endsWith('\n') ? line : `${line}\n`);
    }
}
//# sourceMappingURL=json-logger.js.map
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { JsonLogger } from './common/json-logger.js';
async function bootstrap() {
    const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
    await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
//# sourceMappingURL=main.js.map
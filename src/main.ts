import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { JsonLogger } from './common/json-logger.js';
import { loadEnvFile } from './load-env.js';

loadEnvFile();

async function bootstrap() {
  const logger = new JsonLogger();
  const app = await NestFactory.create(AppModule, { logger });
  await app.listen(process.env.PORT ?? 3000);
  logger.log(`Listening on ${await app.getUrl()}`, 'Bootstrap');
}
await bootstrap();

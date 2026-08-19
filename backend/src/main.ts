import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { getCorsOrigin } from './common/cors-origins.util';
import { CorsIoAdapter } from './common/cors-io.adapter';
import { ActivityLogMiddleware } from './activity-log/activity-log.middleware';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // Audit capture, FIRST — before the global prefix and before every guard,
    // so a 401/403 (the highest-value audit event there is) still produces a
    // row. It emits on response 'finish', so it adds no latency, and it is
    // inert unless ACTIVITY_LOG_ENABLED=true.
    app.use(
        app.get(ActivityLogMiddleware).use.bind(app.get(ActivityLogMiddleware)),
    );

    // Lets the audit writer flush its buffer on SIGTERM/SIGINT instead of
    // losing it — PM2 restarts on every deploy.
    app.enableShutdownHooks();

    app.setGlobalPrefix('api');

    // CORS allowlist driven by CORS_ORIGINS (see common/cors-origins.util.ts).
    app.enableCors({
        origin: getCorsOrigin(),
        credentials: true,
    });
    // Apply the same allowlist to socket.io (websocket) handshakes.
    app.useWebSocketAdapter(new CorsIoAdapter(app));
    app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, transform: true }),
    );

    const config = new DocumentBuilder()
        .setTitle('Rough Foodie API')
        .setDescription('Multi-tenant POS & Online Ordering – Phase 1')
        .setVersion('1.0')
        .addBearerAuth()
        .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document);

    // await app.listen(process.env.PORT ?? 3001);
    await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
void bootstrap();

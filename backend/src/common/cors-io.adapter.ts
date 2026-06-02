import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { getCorsOrigin } from './cors-origins.util';

/**
 * Socket.IO adapter that applies the shared CORS allowlist to the websocket
 * handshake. Unlike the @WebSocketGateway({ cors }) decorator (which is
 * evaluated at import time, before .env is loaded), createIOServer runs during
 * app initialization — after ConfigModule has populated process.env — so
 * CORS_ORIGINS is honored here.
 */
export class CorsIoAdapter extends IoAdapter {
    constructor(app: INestApplicationContext) {
        super(app);
    }

    createIOServer(port: number, options?: ServerOptions): unknown {
        return super.createIOServer(port, {
            ...options,
            cors: {
                origin: getCorsOrigin(),
                credentials: true,
            },
        });
    }
}

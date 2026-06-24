import {
    OnGatewayConnection,
    OnGatewayInit,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { NotificationsService } from './notifications.service';

/**
 * Staff-facing notifications socket. Unlike the phone-verified rider tracking
 * gateway, this one authenticates the staff JWT from the handshake and joins the
 * socket to a per-user room `user:{id}`. The service emits to these rooms.
 *
 * CORS is applied server-wide via CorsIoAdapter (main.ts).
 */
@WebSocketGateway({ namespace: '/notifications' })
export class NotificationsGateway
    implements OnGatewayInit, OnGatewayConnection
{
    private readonly logger = new Logger(NotificationsGateway.name);

    @WebSocketServer()
    server: Server;

    constructor(
        private readonly jwtService: JwtService,
        private readonly notificationsService: NotificationsService,
    ) {}

    afterInit(server: Server) {
        this.notificationsService.bindServer(server);
        this.logger.log('Notifications WebSocket gateway initialized');
    }

    handleConnection(client: Socket) {
        const token = this.extractToken(client);
        if (!token) {
            client.emit('notifications:error', { code: 'NO_TOKEN' });
            client.disconnect();
            return;
        }
        try {
            const payload = this.jwtService.verify<{ sub: number }>(token);
            const userId = Number(payload?.sub);
            if (!Number.isInteger(userId) || userId <= 0) {
                throw new Error('Invalid subject');
            }
            void client.join(`user:${userId}`);
            (client.data as { userId?: number }).userId = userId;
            client.emit('notifications:ready', { userId });
        } catch {
            client.emit('notifications:error', { code: 'INVALID_TOKEN' });
            client.disconnect();
        }
    }

    private extractToken(client: Socket): string | null {
        const auth = client.handshake.auth as { token?: string } | undefined;
        if (auth?.token) return auth.token.replace(/^Bearer\s+/i, '');
        const header = client.handshake.headers.authorization;
        if (typeof header === 'string') {
            return header.replace(/^Bearer\s+/i, '');
        }
        return null;
    }
}

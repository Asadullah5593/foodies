import {
    ConnectedSocket,
    MessageBody,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RiderOrderLocationService } from './rider-order-location.service';
import { RiderLocationEventsService } from './rider-location-events.service';

type TrackJoinPayload = {
    orderId?: number | string;
    phone?: string;
};

@WebSocketGateway({
    namespace: '/tracking',
    cors: {
        origin: true,
        credentials: true,
    },
})
export class RiderLocationGateway implements OnGatewayInit {
    private readonly logger = new Logger(RiderLocationGateway.name);

    @WebSocketServer()
    server: Server;

    constructor(
        private readonly locationService: RiderOrderLocationService,
        private readonly eventsService: RiderLocationEventsService,
    ) {}

    afterInit(server: Server) {
        this.eventsService.bindServer(server);
        this.logger.log('Rider location WebSocket gateway initialized');
    }

    @SubscribeMessage('track:join')
    async handleTrackJoin(
        @MessageBody() body: TrackJoinPayload,
        @ConnectedSocket() client: Socket,
    ) {
        const orderId = Number(body?.orderId);
        const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
        if (!Number.isInteger(orderId) || orderId <= 0 || !phone) {
            client.emit('track:error', {
                code: 'INVALID_PAYLOAD',
                message: 'orderId and phone are required',
            });
            return;
        }

        try {
            await this.locationService.verifyCustomerCanTrack(orderId, phone);
            const latest = await this.locationService.getLatestForCustomerPhone(
                orderId,
                phone,
            );
            const room = `order:${orderId}`;
            await client.join(room);
            client.emit('track:joined', { orderId, latest });
        } catch {
            client.emit('track:error', {
                code: 'FORBIDDEN_TRACKING',
                message: 'Unable to subscribe to rider tracking for this order',
            });
        }
    }
}

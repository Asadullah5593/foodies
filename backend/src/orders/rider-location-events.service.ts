import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

export type RiderLocationUpdatePayload = {
    orderId: number;
    latitude: number;
    longitude: number;
    recorded_at: string;
};

@Injectable()
export class RiderLocationEventsService {
    private readonly logger = new Logger(RiderLocationEventsService.name);
    private server: Server | null = null;

    bindServer(server: Server) {
        this.server = server;
    }

    emitLocationUpdate(payload: RiderLocationUpdatePayload) {
        if (!this.server) return;
        const room = `order:${payload.orderId}`;
        this.server.to(room).emit('location:update', payload);
        this.logger.debug(
            `Emitted location:update for order ${payload.orderId} to room ${room}`,
        );
    }
}

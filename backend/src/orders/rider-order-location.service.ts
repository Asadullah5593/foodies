import {
    Injectable,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { RiderOrderLocation } from '../entities/rider-order-location.entity';
import { normalizePakistaniPhone } from '../utils/phone';
import { RiderLocationEventsService } from './rider-location-events.service';

const TERMINAL_DELIVERY_STATUSES = ['delivered', 'delivery_failed'];

@Injectable()
export class RiderOrderLocationService {
    constructor(
        @InjectRepository(Order)
        private readonly orderRepo: Repository<Order>,
        @InjectRepository(RiderOrderLocation)
        private readonly locationRepo: Repository<RiderOrderLocation>,
        private readonly riderLocationEvents: RiderLocationEventsService,
    ) {}

    private parseCoordinate(value: unknown, name: string): number {
        const n =
            typeof value === 'number'
                ? value
                : value != null
                  ? Number(value)
                  : NaN;
        if (!Number.isFinite(n)) {
            throw new BadRequestException(`${name} must be a valid number`);
        }
        return n;
    }

    async recordForRider(
        orderId: number,
        riderUserId: number,
        latitude: unknown,
        longitude: unknown,
    ): Promise<{
        latitude: number;
        longitude: number;
        recorded_at: string;
    }> {
        const lat = this.parseCoordinate(latitude, 'latitude');
        const lng = this.parseCoordinate(longitude, 'longitude');
        if (lat < -90 || lat > 90) {
            throw new BadRequestException(
                'latitude must be between -90 and 90',
            );
        }
        if (lng < -180 || lng > 180) {
            throw new BadRequestException(
                'longitude must be between -180 and 180',
            );
        }

        const order = await this.orderRepo.findOne({
            where: { id: orderId, riderId: riderUserId },
        });
        if (!order) throw new NotFoundException('Order not found');

        const status = order.deliveryStatus ?? '';
        if (TERMINAL_DELIVERY_STATUSES.includes(status)) {
            throw new BadRequestException(
                'Cannot record location for a completed or failed delivery',
            );
        }

        const row = this.locationRepo.create({
            orderId,
            latitude: lat,
            longitude: lng,
        });
        const saved = await this.locationRepo.save(row);
        const payload = {
            orderId,
            latitude: Number(saved.latitude),
            longitude: Number(saved.longitude),
            recorded_at: saved.createdAt.toISOString(),
        };
        this.riderLocationEvents.emitLocationUpdate(payload);
        return {
            latitude: payload.latitude,
            longitude: payload.longitude,
            recorded_at: payload.recorded_at,
        };
    }

    async verifyCustomerCanTrack(orderId: number, customerPhone: string) {
        const normalized = normalizePakistaniPhone(
            typeof customerPhone === 'string' ? customerPhone.trim() : '',
        );
        if (!normalized) {
            throw new BadRequestException('Valid phone is required');
        }

        const order = await this.orderRepo.findOne({ where: { id: orderId } });
        if (!order) throw new NotFoundException('Order not found');
        if (order.customerPhone !== normalized) {
            throw new NotFoundException('Order not found');
        }

        return order;
    }

    async getLatestForCustomerPhone(
        orderId: number,
        customerPhone: string,
    ): Promise<{
        latitude: number | null;
        longitude: number | null;
        recorded_at: string | null;
    }> {
        await this.verifyCustomerCanTrack(orderId, customerPhone);

        const latest = await this.locationRepo.findOne({
            where: { orderId },
            order: { createdAt: 'DESC' },
        });

        if (!latest) {
            return {
                latitude: null,
                longitude: null,
                recorded_at: null,
            };
        }

        return {
            latitude: Number(latest.latitude),
            longitude: Number(latest.longitude),
            recorded_at: latest.createdAt.toISOString(),
        };
    }
}

import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { AttendanceStation } from '../entities/attendance-station.entity';

export type StationRequest = Request & {
    station?: { id: number; tenantId: number; branchId: number; label: string };
};

/**
 * Authenticates the attendance station by its device token, with no user logged
 * in — the whole point being that staff without accounts can clock themselves
 * in and nobody has to leave an admin session open on a shared screen.
 *
 * Fails closed on a missing, unknown or deactivated token. The token grants
 * exactly one capability, recording a punch at its own branch; it is not a login
 * and cannot read anything.
 */
@Injectable()
export class StationAuthGuard implements CanActivate {
    constructor(
        @InjectRepository(AttendanceStation)
        private readonly stations: Repository<AttendanceStation>,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<StationRequest>();
        const header = request.headers['x-station-token'];
        const token = (
            Array.isArray(header) ? header[0] : (header ?? '')
        ).toString();

        if (!token) {
            throw new UnauthorizedException('This device is not registered');
        }

        const station = await this.stations.findOne({
            where: { token, isActive: true },
            relations: ['branch'],
        });
        if (!station) {
            // Same message whether the token is unknown or revoked, so a
            // revoked device cannot be distinguished from a wrong one.
            throw new UnauthorizedException('This device is not registered');
        }

        request.station = {
            id: station.id,
            tenantId: station.tenantId,
            branchId: station.branchId,
            label: station.label,
        };
        return true;
    }
}

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { CustomersService } from '../customers/customers.service';
import { getJwtSecret } from './jwt-secret.util';

@Injectable()
export class CustomerJwtStrategy extends PassportStrategy(
    Strategy,
    'customer-jwt',
) {
    constructor(private customersService: CustomersService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: getJwtSecret(),
        });
    }

    async validate(payload: { sub: number; type?: string }) {
        if (payload.type !== 'customer') {
            throw new UnauthorizedException('Invalid token');
        }
        const customer = await this.customersService.findById(payload.sub);
        if (!customer) {
            throw new UnauthorizedException('Customer not found');
        }
        return customer;
    }
}

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';
import { getJwtSecret } from './jwt-secret.util';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private authService: AuthService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: getJwtSecret(),
        });
    }

    async validate(payload: { sub: number; email: string }) {
        const user = await this.authService.findById(payload.sub);
        if (!user) {
            throw new UnauthorizedException();
        }
        return {
            id: user.id,
            tenantId: user.tenant_id,
            isSuperAdmin: user.is_super_admin === true,
            isRider: user.is_rider === true,
        };
    }
}

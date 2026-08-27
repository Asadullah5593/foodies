import {
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Body,
    Param,
    Query,
    Req,
    BadRequestException,
    NotFoundException,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiTags,
    ApiConsumes,
    ApiBody,
    ApiOperation,
    ApiQuery,
    ApiParam,
    ApiBearerAuth,
    ApiOkResponse,
} from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { BrandsService } from '../brands/brands.service';
import { BranchesService } from '../branches/branches.service';
import { MenuService } from '../menu/menu.service';
import { OrdersService } from '../orders/orders.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { CustomersService } from '../customers/customers.service';
import { PaymentsService } from '../payments/payments.service';
import { BankCardsService } from '../bank-cards/bank-cards.service';
import { normalizeOrderBody } from '../orders/legacy-deal-payload';
import { CustomerJwtAuthGuard } from '../auth/customer-jwt-auth.guard';
import { OptionalCustomerJwtAuthGuard } from '../auth/optional-customer-jwt-auth.guard';
import { OtpService } from '../otp/otp.service';
import { CartService } from '../cart/cart.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import { Branch } from '../entities/branch.entity';
import { Customer } from '../entities/customer.entity';
import { Voucher } from '../entities/voucher.entity';
import { Discount } from '../entities/discount.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CampaignsService } from '../campaigns/campaigns.service';
import { RegisterDto } from './dto/register.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { MediaStorageService } from '../media/media-storage.service';
import { MAX_UPLOAD_FILE_BYTES } from '../upload/upload.constants';
import { RatingsService } from '../ratings/ratings.service';
import { BannersService } from '../banners/banners.service';
import { PromotionsService } from '../promotions/promotions.service';
import { FirebaseService } from '../firebase/firebase.service';

type BranchWithBrands = Branch & {
    branchBrands: Array<{ brand: { tenantId: number } }>;
};

/** Phone OTP purposes the consumer SMS endpoints accept. */
const PHONE_OTP_PURPOSES = ['phone_verification', 'password_reset'] as const;
/**
 * How long a successful `phone_verification` OTP lets a register call through
 * (gives the user time to fill the signup form after entering the code).
 */
const PHONE_VERIFICATION_WINDOW_MS = 30 * 60 * 1000;

@ApiTags('Consumer')
@Controller('public/consumer')
export class ConsumerController {
    private readonly logger = new Logger(ConsumerController.name);

    constructor(
        private brandsService: BrandsService,
        private branchesService: BranchesService,
        private bankCardsService: BankCardsService,
        private menuService: MenuService,
        private ordersService: OrdersService,
        private loyaltyService: LoyaltyService,
        private customersService: CustomersService,
        private paymentsService: PaymentsService,
        private jwtService: JwtService,
        private otpService: OtpService,
        private cartService: CartService,
        private mailService: MailService,
        private smsService: SmsService,
        private mediaStorage: MediaStorageService,
        private ratingsService: RatingsService,
        @InjectRepository(Branch) private branchRepo: Repository<Branch>,
        private bannersService: BannersService,
        private promotionsService: PromotionsService,
        private campaignsService: CampaignsService,
        @InjectRepository(Voucher) private voucherRepo: Repository<Voucher>,
        @InjectRepository(Discount) private discountRepo: Repository<Discount>,
        private firebaseService: FirebaseService,
    ) {}

    /** Resolve tenant id from branch (for customer-scoped APIs). */
    private async getTenantIdFromBranch(branchId: number): Promise<number> {
        const branch = (await this.branchRepo.findOne({
            where: { id: branchId },
            relations: ['branchBrands', 'branchBrands.brand'],
        })) as BranchWithBrands | null;
        if (!branch?.branchBrands?.length)
            throw new NotFoundException('Branch not found');
        const tenantId = branch.branchBrands[0]?.brand?.tenantId ?? null;
        if (tenantId == null) throw new NotFoundException('Branch not found');
        return tenantId;
    }

    /** Resolve tenant id from brand (e.g. for register when user selected a brand). */
    private async getTenantIdFromBrand(brandId: number): Promise<number> {
        const brand = await this.brandsService.findOnePublic(brandId);
        return (brand as { tenant_id: number }).tenant_id;
    }

    private resolveOrderSourceFromRequest(req: {
        headers?: Record<string, string | string[] | undefined>;
    }): 'consumer_app' | 'consumer_web' | 'kiosk' {
        const headerVal = req?.headers?.['x-client-platform'];
        const raw = Array.isArray(headerVal) ? headerVal[0] : headerVal;
        const platform = (raw ?? '').toString().trim().toLowerCase();
        if (platform === 'kiosk') return 'kiosk';
        return platform === 'web' || platform === 'consumer_web'
            ? 'consumer_web'
            : 'consumer_app';
    }

    private async resolveCartCustomerOrThrow(phone: string) {
        const customer = await this.customersService.findConsumerByPhone(
            phone.trim(),
            this.getTenantIdFromEnv(),
        );
        if (!customer) {
            throw new NotFoundException(
                'Customer not found. Please login or register before using cart.',
            );
        }
        return customer;
    }

    /**
     * Parse required latitude/longitude (+ optional radius_km hard cap) for location-based
     * consumer endpoints. Throws 400 when lat/lng are missing or not finite numbers. When
     * radius_km is omitted the cap defaults to 100000 km (each branch's own deliveryRadiusKm
     * governs visibility). Mirrors the parsing used by the /branches "near me" route.
     */
    private parseLatLng(
        latitudeParam: string,
        longitudeParam: string,
        radiusKmParam?: string,
    ): { lat: number; lng: number; maxRadiusKm: number } {
        const lat =
            latitudeParam != null && latitudeParam !== ''
                ? +latitudeParam
                : NaN;
        const lng =
            longitudeParam != null && longitudeParam !== ''
                ? +longitudeParam
                : NaN;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            throw new BadRequestException(
                'latitude and longitude are required',
            );
        }
        const maxRadiusKm =
            radiusKmParam != null && radiusKmParam !== ''
                ? +radiusKmParam || 100000
                : 100000;
        return { lat, lng, maxRadiusKm };
    }

    /** Distinct brand ids across a set of nearby branches (from findNearbyWithBrands). */
    private collectNearbyBrandIds(
        nearby: Array<{
            branch: { branchBrands?: Array<{ brandId: number }> };
        }>,
    ): number[] {
        const ids = new Set<number>();
        for (const { branch } of nearby) {
            for (const bb of branch.branchBrands ?? []) ids.add(bb.brandId);
        }
        return [...ids];
    }

    /** Tenant-scoped consumer web: infer tenant id from env (TENANT_ID). */
    private getTenantIdFromEnv(): number {
        const raw = process.env.TENANT_ID;
        const tenantId = raw != null && raw.trim() !== '' ? Number(raw) : NaN;
        if (!Number.isFinite(tenantId) || tenantId <= 0) {
            throw new BadRequestException(
                'TENANT_ID is not configured on the server',
            );
        }
        return tenantId;
    }

    /**
     * Parse a `brand_ids` query param into a deduped list of positive integers.
     * Accepts comma-separated (`brand_ids=1,2,3`) or repeated (`brand_ids=1&brand_ids=2`).
     */
    private parseBrandIds(param?: string | string[]): number[] {
        const raw = Array.isArray(param)
            ? param.flatMap((v) => v.split(','))
            : (param ?? '').split(',');
        const ids = raw
            .map((v) => Number(v.trim()))
            .filter((n) => Number.isInteger(n) && n > 0);
        return Array.from(new Set(ids));
    }

    @Get('brands')
    @ApiOperation({
        summary: 'List brands (optional: filter by branch_id, search by name)',
    })
    @ApiQuery({
        name: 'branch_id',
        required: false,
        example: '1',
        description: 'Return only brands at this branch',
    })
    @ApiQuery({
        name: 'search',
        required: false,
        example: 'peri',
        description: 'Filter brands by name (case-insensitive)',
    })
    listBrands(
        @Query('branch_id') branchIdParam: string,
        @Query('search') searchParam: string,
    ) {
        const branchId =
            branchIdParam != null && branchIdParam !== ''
                ? +branchIdParam
                : null;
        const search =
            searchParam != null && searchParam.trim() !== ''
                ? searchParam.trim()
                : undefined;
        if (branchId != null && Number.isFinite(branchId)) {
            return this.brandsService.findAllPublicByBranchId(branchId, search);
        }
        return this.brandsService.findAllPublic(search);
    }

    @Get('nearby/brands')
    @ApiOperation({
        summary:
            'List brands available near a location (consumer app). One row per (brand, branch).',
    })
    @ApiQuery({ name: 'latitude', required: true, example: '31.5204' })
    @ApiQuery({ name: 'longitude', required: true, example: '74.3587' })
    @ApiQuery({
        name: 'radius_km',
        required: false,
        example: '10',
        description:
            'Optional hard cap. When omitted each branch’s own delivery radius governs visibility.',
    })
    @ApiQuery({
        name: 'search',
        required: false,
        example: 'peri',
        description: 'Filter brands by name (case-insensitive)',
    })
    async listNearbyBrands(
        @Query('latitude') latitudeParam: string,
        @Query('longitude') longitudeParam: string,
        @Query('radius_km') radiusKmParam: string,
        @Query('search') searchParam: string,
    ) {
        const { lat, lng, maxRadiusKm } = this.parseLatLng(
            latitudeParam,
            longitudeParam,
            radiusKmParam,
        );
        const search =
            searchParam != null && searchParam.trim() !== ''
                ? searchParam.trim()
                : undefined;
        const nearby = await this.branchesService.findNearbyWithBrands(
            lat,
            lng,
            maxRadiusKm,
        );
        return this.brandsService.findPublicNearbyRows(nearby, search);
    }

    @Get('tenant/brands')
    @ApiOperation({
        summary:
            'List brands for the configured tenant (consumer web; tenant inferred from TENANT_ID)',
    })
    @ApiQuery({
        name: 'search',
        required: false,
        example: 'peri',
        description: 'Filter brands by name (case-insensitive)',
    })
    listTenantBrands(@Query('search') searchParam: string) {
        const tenantId = this.getTenantIdFromEnv();
        const search =
            searchParam != null && searchParam.trim() !== ''
                ? searchParam.trim()
                : undefined;
        return this.brandsService.findAllPublicByTenantId(tenantId, search);
    }

    @Get('brands/:id')
    getBrandById(@Param('id') id: string) {
        return this.brandsService.findOnePublic(+id);
    }

    @Get('branches')
    @ApiOperation({
        summary:
            'List branches (optional: brand_id, or lat/lng/radius_km for near me)',
    })
    @ApiQuery({ name: 'brand_id', required: false, example: '1' })
    @ApiQuery({ name: 'latitude', required: false, example: '31.5204' })
    @ApiQuery({ name: 'longitude', required: false, example: '74.3587' })
    @ApiQuery({ name: 'radius_km', required: false, example: '10' })
    listBranches(
        @Query('brand_id') brandId: string,
        @Query('latitude') latitudeParam: string,
        @Query('longitude') longitudeParam: string,
        @Query('radius_km') radiusKmParam: string,
    ) {
        const lat =
            latitudeParam != null && latitudeParam !== ''
                ? +latitudeParam
                : null;
        const lng =
            longitudeParam != null && longitudeParam !== ''
                ? +longitudeParam
                : null;
        if (
            lat != null &&
            lng != null &&
            Number.isFinite(lat) &&
            Number.isFinite(lng)
        ) {
            // Optional hard cap from the client. When omitted, each branch's own
            // deliveryRadiusKm governs visibility (no extra cap).
            const maxRadiusKm =
                radiusKmParam != null && radiusKmParam !== ''
                    ? +radiusKmParam || 100000
                    : 100000;
            return this.branchesService.findAllWithinRadius(
                lat,
                lng,
                maxRadiusKm,
            );
        }
        return this.branchesService.findAll(brandId ? +brandId : undefined);
    }

    /**
     * Customer register: name, phone, password, confirm_password (email optional).
     * Requires a prior SMS phone-verification OTP (see `auth/send-otp` +
     * `auth/verify-phone-otp` with purpose `phone_verification`). The new
     * customer is assigned the deployment's tenant (TENANT_ID env) at creation.
     */
    @Post('register')
    @ApiOperation({
        summary: 'Register a new customer (phone must be verified)',
    })
    @ApiBody({
        type: RegisterDto,
        examples: {
            default: {
                summary: 'Register',
                value: {
                    name: 'John Doe',
                    phone: '03001234567',
                    email: 'john@example.com',
                    password: 'secret123',
                    confirm_password: 'secret123',
                },
            },
        },
    })
    async register(
        @Body() dto: RegisterDto,
        @Req()
        req: { headers?: Record<string, string | string[] | undefined> },
    ) {
        if (dto.password !== dto.confirm_password) {
            throw new BadRequestException(
                'password and confirm_password do not match',
            );
        }
        // Phone verification is gated behind CONSUMER_REQUIRE_PHONE_OTP so it can be
        // turned off while SMS (Amazon SNS) is unavailable. Unset/false ⇒ skip the OTP
        // requirement and let registration through; set to true once SNS is live to
        // enforce the send-otp → verify-phone-otp → register flow. Either way, the stored
        // phone_verified flag reflects whether an OTP was actually confirmed.
        const requireOtp = ['true', '1'].includes(
            (process.env.CONSUMER_REQUIRE_PHONE_OTP ?? '').trim().toLowerCase(),
        );
        const verified = await this.otpService.wasRecentlyVerified(
            dto.phone,
            'phone_verification',
            PHONE_VERIFICATION_WINDOW_MS,
        );
        if (requireOtp && !verified) {
            throw new BadRequestException(
                'Phone number not verified. Request and confirm an OTP first.',
            );
        }
        const customer = await this.customersService.createForConsumer(
            this.getTenantIdFromEnv(),
            {
                phone: dto.phone,
                name: dto.name,
                email: dto.email,
                password: dto.password,
                phoneVerified: verified,
            },
            // Same header the order flow reads: absent/anything-but-web ⇒ the
            // mobile app, so the app needs no change to be tagged correctly.
            this.resolveOrderSourceFromRequest(req),
        );
        return {
            id: customer.id,
            tenant_id: customer.tenantId ?? null,
            phone: customer.phone,
            name: customer.name,
            email: customer.email ?? null,
            loyalty_points_balance: customer.loyaltyPointsBalance,
        };
    }

    /**
     * Customer login: phone + password only. `customers.phone` is NOT NULL and
     * unique per tenant, so every account is reachable this way; email is
     * profile data, not a credential.
     */
    @Post('auth/login')
    @ApiOperation({ summary: 'Customer login (phone + password)' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['phone', 'password'],
            properties: {
                phone: { type: 'string', example: '03001234567' },
                password: { type: 'string' },
            },
            example: { phone: '03001234567', password: 'secret123' },
        },
    })
    async customerLogin(@Body() dto: { phone?: string; password: string }) {
        const phone = typeof dto?.phone === 'string' ? dto.phone.trim() : '';
        const password = typeof dto?.password === 'string' ? dto.password : '';
        if (!password || !phone) {
            throw new BadRequestException('phone and password are required');
        }
        const customer = await this.customersService.validateCustomerByPhone(
            phone,
            password,
            this.getTenantIdFromEnv(),
        );
        const token = this.jwtService.sign({
            sub: customer.id,
            type: 'customer',
            tenantId: customer.tenantId,
        });
        return {
            token,
            customer: {
                id: customer.id,
                tenant_id: customer.tenantId ?? null,
                phone: customer.phone,
                name: customer.name,
                email: customer.email ?? null,
                loyalty_points_balance: customer.loyaltyPointsBalance,
            },
        };
    }

    /** Customer logout (stateless; client should discard token). */
    @Post('auth/logout')
    logout() {
        return { message: 'Logged out successfully' };
    }

    /** Permanently delete the logged-in customer account (App Store requirement). */
    @Delete('auth/account')
    @UseGuards(CustomerJwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Delete customer account permanently',
        description:
            'Irreversible. Requires customer JWT, current password, and `confirm: true`. ' +
            'Removes login profile, cart, loyalty balance/history, and ratings tied to the account. ' +
            'Past orders remain for business records but are no longer linked to this customer id.',
    })
    @ApiBody({
        type: DeleteAccountDto,
        examples: {
            default: {
                summary: 'Confirm deletion',
                value: {
                    password: 'secret123',
                    confirm: true,
                },
            },
        },
    })
    @ApiOkResponse({
        description: 'Account deleted; client must discard the JWT.',
        schema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    example: 'Account deleted successfully',
                },
            },
        },
    })
    async deleteAccount(
        @Req() req: { user: Customer },
        @Body() dto: DeleteAccountDto,
    ) {
        const { profileImageUrl } =
            await this.customersService.deleteConsumerAccount(
                req.user.id,
                dto.password,
            );
        if (profileImageUrl) {
            await this.mediaStorage.deleteManagedObjectByUrl(
                profileImageUrl,
                'customer-profiles',
            );
        }
        return { message: 'Account deleted successfully' };
    }

    /** Forgot password: create OTP and send it to the customer's email. */
    @Post('auth/forgot-password')
    @ApiOperation({ summary: 'Request password reset OTP' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['email'],
            properties: { email: { type: 'string' } },
            example: { email: 'john@example.com' },
        },
    })
    async forgotPassword(@Body() dto: { email: string }) {
        const email =
            typeof dto?.email === 'string'
                ? dto.email.trim().toLowerCase()
                : '';
        if (!email) throw new NotFoundException('email is required');
        const customer = await this.customersService.findByEmail(email);
        if (!customer) {
            this.logger.log(
                `Forgot password: no customer found for email ${email}`,
            );
            return {
                message: 'If an account exists, a code was sent to your email',
            };
        }
        const { code } = await this.otpService.create(email, 'password_reset');
        this.logger.log(`Forgot password: sending OTP to ${email}`);
        await this.mailService.sendPasswordResetOtp(email, code);
        return {
            message: 'If an account exists, a code was sent to your email',
        };
    }

    /** Verify OTP and optionally set new password (for password reset). */
    @Post('auth/verify-otp')
    @ApiOperation({ summary: 'Verify OTP and set new password' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['email', 'code'],
            properties: {
                email: { type: 'string' },
                code: { type: 'string' },
                new_password: { type: 'string' },
            },
            example: {
                email: 'john@example.com',
                code: '123456',
                new_password: 'newSecret123',
            },
        },
    })
    async verifyOtp(
        @Body() dto: { email: string; code: string; new_password?: string },
    ) {
        const email = typeof dto?.email === 'string' ? dto.email.trim() : '';
        const code = typeof dto?.code === 'string' ? dto.code.trim() : '';
        if (!email || !code)
            throw new NotFoundException('email and code are required');
        await this.otpService.verifyAndUse(email, code, 'password_reset');
        const customer = await this.customersService.findByEmail(email);
        if (customer && dto.new_password) {
            await this.customersService.setPassword(
                customer.id,
                dto.new_password,
            );
        }
        return { message: 'OTP verified successfully' };
    }

    /**
     * Send an SMS OTP to a phone number.
     * - `phone_verification`: required before `register` (signup).
     * - `password_reset`: only sent when a consumer account exists, but the
     *   response is generic either way to avoid phone-number enumeration.
     */
    // Both SMS-OTP endpoints below are disabled (Amazon SNS sandbox) and only
    // throw; their async signatures and bodies are preserved so re-enabling is a
    // pure uncomment. Lint would otherwise flag the now-awaitless async methods
    // and the unused `dto` params.
    /* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
    @Post('auth/send-otp')
    @ApiOperation({ summary: 'Send an SMS OTP (phone verification or reset)' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['phone', 'purpose'],
            properties: {
                phone: { type: 'string', example: '03001234567' },
                purpose: {
                    type: 'string',
                    enum: [...PHONE_OTP_PURPOSES],
                },
            },
            example: { phone: '03001234567', purpose: 'phone_verification' },
        },
    })
    async sendOtp(@Body() dto: { phone: string; purpose: string }) {
        // —— Amazon SNS SMS OTP DISABLED (SNS stuck in the SMS sandbox) ——
        // Phone verification and password reset now run through Firebase Phone
        // Auth on the client, verified server-side by:
        //   • POST auth/firebase/verify-phone   (signup phone verification)
        //   • POST auth/firebase/reset-password (password reset)
        // The SNS implementation below is intentionally KEPT (not removed) as a
        // fallback — to restore it, delete this throw and uncomment the body.
        throw new BadRequestException(
            'SMS OTP is disabled. Phone verification and password reset now use Firebase Phone Auth.',
        );
        /*
        const purpose =
            typeof dto?.purpose === 'string' ? dto.purpose.trim() : '';
        if (!PHONE_OTP_PURPOSES.includes(purpose as never)) {
            throw new BadRequestException(
                "purpose must be 'phone_verification' or 'password_reset'",
            );
        }
        // Normalizes + validates Pakistani format (throws 400 if invalid).
        const phone = this.customersService.validateAndNormalizePhone(
            dto?.phone ?? '',
        );

        if (purpose === 'password_reset') {
            const customer = await this.customersService.findConsumerByPhone(
                phone,
                this.getTenantIdFromEnv(),
            );
            if (!customer) {
                this.logger.log(
                    `send-otp(password_reset): no consumer for ${phone}`,
                );
                return {
                    message: 'If the number is registered, a code was sent',
                };
            }
        }

        const { code } = await this.otpService.createForPhone(phone, purpose);
        await this.smsService.sendOtp(phone, code);
        return {
            message:
                purpose === 'password_reset'
                    ? 'If the number is registered, a code was sent'
                    : 'A verification code was sent',
        };
        */
    }

    /**
     * Verify an SMS OTP. For `password_reset`, `new_password` is required and is
     * set on the matching consumer account once the code checks out.
     */
    @Post('auth/verify-phone-otp')
    @ApiOperation({ summary: 'Verify an SMS OTP (optionally reset password)' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['phone', 'code', 'purpose'],
            properties: {
                phone: { type: 'string', example: '03001234567' },
                code: { type: 'string', example: '123456' },
                purpose: { type: 'string', enum: [...PHONE_OTP_PURPOSES] },
                new_password: {
                    type: 'string',
                    description: 'Required when purpose is password_reset',
                },
            },
            example: {
                phone: '03001234567',
                code: '123456',
                purpose: 'phone_verification',
            },
        },
    })
    async verifyPhoneOtp(
        @Body()
        dto: {
            phone: string;
            code: string;
            purpose: string;
            new_password?: string;
        },
    ) {
        // —— Amazon SNS SMS OTP DISABLED (SNS stuck in the SMS sandbox) ——
        // Superseded by Firebase Phone Auth (auth/firebase/verify-phone and
        // auth/firebase/reset-password). The SNS verify implementation below is
        // intentionally KEPT (not removed) as a fallback — to restore it, delete
        // this throw and uncomment the body.
        throw new BadRequestException(
            'SMS OTP is disabled. Phone verification and password reset now use Firebase Phone Auth.',
        );
        /*
        const purpose =
            typeof dto?.purpose === 'string' ? dto.purpose.trim() : '';
        if (!PHONE_OTP_PURPOSES.includes(purpose as never)) {
            throw new BadRequestException(
                "purpose must be 'phone_verification' or 'password_reset'",
            );
        }
        const phone = typeof dto?.phone === 'string' ? dto.phone.trim() : '';
        const code = typeof dto?.code === 'string' ? dto.code.trim() : '';
        if (!phone || !code) {
            throw new BadRequestException('phone and code are required');
        }
        // Validate before consuming the code so a missing password doesn't burn it.
        if (purpose === 'password_reset' && !dto.new_password) {
            throw new BadRequestException(
                'new_password is required for password reset',
            );
        }

        await this.otpService.verifyForPhone(phone, code, purpose);

        if (purpose === 'password_reset') {
            const customer = await this.customersService.findConsumerByPhone(
                phone,
                this.getTenantIdFromEnv(),
            );
            if (!customer) throw new NotFoundException('Customer not found');
            await this.customersService.setPassword(
                customer.id,
                dto.new_password as string,
            );
        }
        return { message: 'OTP verified successfully' };
        */
    }
    /* eslint-enable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */

    /**
     * Firebase Phone Auth — signup phone verification.
     *
     * The app completes SMS OTP with Firebase on the client, then posts the
     * resulting Firebase ID token here. We verify the token server-side (must be
     * a phone sign-in from our Firebase project), normalize the verified E.164
     * number to our stored `03XXXXXXXXX` form, and record it as verified so the
     * unchanged `register` flow lets the signup through (within its 30-min
     * window). Auth stays phone + password; Firebase is only the OTP channel.
     */
    @Post('auth/firebase/verify-phone')
    @ApiOperation({
        summary: 'Verify a phone number via a Firebase Phone Auth ID token',
    })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['id_token'],
            properties: {
                id_token: {
                    type: 'string',
                    description:
                        'Firebase ID token from client-side phone sign-in',
                },
            },
        },
    })
    async firebaseVerifyPhone(@Body() dto: { id_token?: string }) {
        const { phoneNumber } = await this.firebaseService.verifyPhoneIdToken(
            dto?.id_token ?? '',
        );
        // Firebase returns E.164 (+92...); normalize to our stored 03... form so
        // it matches numbers submitted to register and never duplicates.
        const phone =
            this.customersService.validateAndNormalizePhone(phoneNumber);
        await this.otpService.markPhoneVerified(phone, 'phone_verification');
        return { message: 'Phone verified successfully', phone };
    }

    /**
     * Firebase Phone Auth — password reset.
     *
     * The app proves ownership of the phone via Firebase phone sign-in, then
     * posts the ID token plus the new password. We verify the token, match the
     * consumer by normalized phone (scoped to this deployment's tenant), and set
     * the new password. No session is issued — the user logs in normally after.
     */
    @Post('auth/firebase/reset-password')
    @ApiOperation({
        summary: 'Reset password via a Firebase Phone Auth ID token',
    })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['id_token', 'new_password'],
            properties: {
                id_token: {
                    type: 'string',
                    description:
                        'Firebase ID token from client-side phone sign-in',
                },
                new_password: { type: 'string' },
            },
        },
    })
    async firebaseResetPassword(
        @Body() dto: { id_token?: string; new_password?: string },
    ) {
        const newPassword =
            typeof dto?.new_password === 'string' ? dto.new_password : '';
        // Validate the password before verifying the token so a bad request is
        // cheap and no work is wasted.
        if (!newPassword.trim()) {
            throw new BadRequestException('new_password is required');
        }
        const { phoneNumber } = await this.firebaseService.verifyPhoneIdToken(
            dto?.id_token ?? '',
        );
        const phone =
            this.customersService.validateAndNormalizePhone(phoneNumber);
        const customer = await this.customersService.findConsumerByPhone(
            phone,
            this.getTenantIdFromEnv(),
        );
        if (!customer) {
            throw new NotFoundException(
                'No account found for this phone number',
            );
        }
        await this.customersService.setPassword(customer.id, newPassword);
        return { message: 'Password reset successfully' };
    }

    /** Get current customer profile (requires customer JWT). */
    @Get('profile/me')
    @UseGuards(CustomerJwtAuthGuard)
    getProfileMe(@Req() req: { user: Customer }) {
        const customer = req.user;
        return {
            id: customer.id,
            tenant_id: customer.tenantId ?? null,
            phone: customer.phone,
            name: customer.name,
            email: customer.email ?? null,
            loyalty_points_balance: customer.loyaltyPointsBalance,
            profile_image_url: customer.profileImageUrl ?? null,
            latitude:
                customer.latitude != null ? Number(customer.latitude) : null,
            longitude:
                customer.longitude != null ? Number(customer.longitude) : null,
        };
    }

    /** Update customer location (requires customer JWT). */
    @Put('location')
    @UseGuards(CustomerJwtAuthGuard)
    @ApiOperation({ summary: 'Update customer location (lat/lng)' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['latitude', 'longitude'],
            properties: {
                latitude: { type: 'number', example: 31.5204 },
                longitude: { type: 'number', example: 74.3587 },
            },
            example: { latitude: 31.5204, longitude: 74.3587 },
        },
    })
    async updateLocation(
        @Req() req: { user: Customer },
        @Body() dto: { latitude: number; longitude: number },
    ) {
        const lat =
            typeof dto.latitude === 'number'
                ? dto.latitude
                : Number(dto.latitude);
        const lng =
            typeof dto.longitude === 'number'
                ? dto.longitude
                : Number(dto.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            throw new BadRequestException(
                'latitude and longitude must be valid numbers',
            );
        }
        await this.customersService.updateLocation(req.user.id, lat, lng);
        return { message: 'Location updated', latitude: lat, longitude: lng };
    }

    /** Upload profile image (requires customer JWT). */
    @Post('profile/avatar')
    @UseGuards(CustomerJwtAuthGuard)
    @UseInterceptors(
        FileInterceptor('file', {
            limits: { fileSize: MAX_UPLOAD_FILE_BYTES },
        }),
    )
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: { file: { type: 'string', format: 'binary' } },
        },
    })
    async uploadProfileImage(
        @Req() req: { user: Customer },
        @UploadedFile()
        file: {
            originalname?: string;
            mimetype?: string;
            buffer?: Buffer;
        },
    ) {
        if (!file || !file.buffer)
            throw new BadRequestException('No file uploaded');
        const allowed = /^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/i.test(
            file.mimetype || '',
        );
        if (!allowed)
            throw new BadRequestException('Only image files are allowed');
        const { url } = await this.mediaStorage.uploadImage(
            file,
            'customer-profiles',
        );
        const customer = req.user;
        const oldProfileImageUrl =
            (customer as { profileImageUrl?: string }).profileImageUrl ?? null;
        await this.customersService.update(customer.id, customer.tenantId, {
            profile_image_url: url,
        });
        if (oldProfileImageUrl && oldProfileImageUrl !== url) {
            await this.mediaStorage.deleteManagedObjectByUrl(
                oldProfileImageUrl,
                'customer-profiles',
            );
        }
        return { url };
    }

    /** Get customer profile by phone (no tenant linkage). */
    @Get('profile')
    @ApiOperation({ summary: 'Get profile by phone and branch' })
    @ApiQuery({ name: 'phone', required: true, example: '03001234567' })
    @ApiQuery({ name: 'branch_id', required: true, example: '1' })
    async getProfile(
        @Query('phone') phone: string,
        @Query('branch_id') branchIdParam: string,
    ) {
        const branchId = branchIdParam ? +branchIdParam : undefined;
        if (!branchId || !phone?.trim())
            throw new NotFoundException('branch_id and phone are required');
        const customer = await this.customersService.findConsumerByPhone(
            phone.trim(),
            this.getTenantIdFromEnv(),
        );
        if (!customer) throw new NotFoundException('Customer not found');
        return {
            id: customer.id,
            tenant_id: customer.tenantId ?? null,
            phone: customer.phone,
            name: customer.name,
            loyalty_points_balance: customer.loyaltyPointsBalance,
            profile_image_url: customer.profileImageUrl ?? null,
        };
    }

    /** Update customer profile (name, email). */
    @Patch('profile')
    @ApiOperation({ summary: 'Update profile by phone and branch' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['phone', 'branch_id'],
            properties: {
                phone: { type: 'string' },
                branch_id: { type: 'number' },
                name: { type: 'string' },
                email: { type: 'string' },
            },
            example: {
                phone: '03001234567',
                branch_id: 1,
                name: 'John Doe',
                email: 'john@example.com',
            },
        },
    })
    async updateProfile(
        @Body()
        dto: {
            phone: string;
            branch_id: number;
            name?: string;
            email?: string | null;
        },
    ) {
        if (!dto.phone?.trim() || !dto.branch_id)
            throw new NotFoundException('phone and branch_id are required');
        const customer = await this.customersService.findConsumerByPhone(
            dto.phone.trim(),
            this.getTenantIdFromEnv(),
        );
        if (!customer) throw new NotFoundException('Customer not found');
        const updated = await this.customersService.update(customer.id, null, {
            name: dto.name,
            email: dto.email,
        });
        return {
            id: updated.id,
            tenant_id: updated.tenantId ?? null,
            phone: updated.phone,
            name: updated.name,
            email: updated.email ?? null,
            loyalty_points_balance: updated.loyaltyPointsBalance,
            profile_image_url: updated.profileImageUrl ?? null,
        };
    }

    @Get('bank-cards')
    @ApiOperation({
        summary:
            'Bank cards with a live offer at this branch. Only cards that discount something are listed.',
    })
    @ApiQuery({ name: 'branch_id', required: true, example: '1' })
    @ApiQuery({
        name: 'brand_id',
        required: false,
        description: 'Only cards whose offer covers this brand',
    })
    async bankCardOffers(
        @Query('branch_id') branchIdParam: string,
        @Query('brand_id') brandIdParam?: string,
    ) {
        const branchId = Number(branchIdParam);
        if (!Number.isFinite(branchId) || branchId <= 0)
            throw new BadRequestException('branch_id is required');
        const tenantId = await this.getTenantIdFromBranch(branchId);
        const brandId = Number(brandIdParam);
        return this.bankCardsService.publicOffers(
            tenantId,
            Number.isFinite(brandId) && brandId > 0 ? brandId : null,
        );
    }

    @Get('bank-cards/detect')
    @ApiOperation({
        summary:
            'Identify which offer card a number belongs to, from its BIN. Send ONLY the first 6-8 digits — never a full card number.',
    })
    @ApiQuery({ name: 'branch_id', required: true, example: '1' })
    @ApiQuery({ name: 'bin', required: true, example: '401234' })
    @ApiQuery({ name: 'brand_id', required: false })
    async detectBankCard(
        @Query('branch_id') branchIdParam: string,
        @Query('bin') bin: string,
        @Query('brand_id') brandIdParam?: string,
    ) {
        const branchId = Number(branchIdParam);
        if (!Number.isFinite(branchId) || branchId <= 0)
            throw new BadRequestException('branch_id is required');
        const tenantId = await this.getTenantIdFromBranch(branchId);
        const brandId = Number(brandIdParam);
        return this.bankCardsService.detectByBin(
            tenantId,
            bin,
            Number.isFinite(brandId) && brandId > 0 ? brandId : null,
        );
    }

    @Get('menu')
    @ApiOperation({
        summary:
            'Get branch menu (optional: filter by brand_id, search by item/category name)',
    })
    @ApiQuery({ name: 'branch_id', required: true, example: '1' })
    @ApiQuery({ name: 'brand_id', required: false, example: '1' })
    @ApiQuery({
        name: 'search',
        required: false,
        example: 'burger',
        description:
            'Filter menu items by name, description or category (case-insensitive)',
    })
    @ApiQuery({
        name: 'order_type',
        required: false,
        example: 'delivery',
        description:
            'Optional but recommended. When set, only menu items available for this channel are returned. Use the same values as POST /orders `order_type`: `delivery`, `pickup` (consumer), or `takeaway` (POS alias for pickup), `dine_in`. Each item also includes `available_for_order_types` when omitted.',
    })
    getMenu(
        @Query('branch_id') branchIdParam: string,
        @Query('brand_id') brandIdParam: string,
        @Query('search') searchParam: string,
        @Query('order_type') orderTypeParam: string,
    ) {
        const branchId = branchIdParam ? +branchIdParam : undefined;
        if (!branchId) throw new NotFoundException('branch_id is required');
        const brandId =
            brandIdParam != null && brandIdParam !== ''
                ? +brandIdParam
                : undefined;
        const search =
            searchParam != null && searchParam.trim() !== ''
                ? searchParam.trim()
                : undefined;
        const orderType =
            orderTypeParam != null && orderTypeParam.trim() !== ''
                ? orderTypeParam.trim()
                : undefined;
        return this.menuService.getBranchMenu(branchId, {
            brandId:
                brandId != null && Number.isFinite(brandId)
                    ? brandId
                    : undefined,
            search,
            orderType,
            channel: 'app',
        });
    }

    @Get('tenant/menu')
    @ApiOperation({
        summary:
            'Get brand menu for the configured tenant (consumer web; no branch_id/order_type)',
    })
    @ApiQuery({ name: 'brand_id', required: true, example: '1' })
    @ApiQuery({
        name: 'search',
        required: false,
        example: 'burger',
        description:
            'Filter menu items by name, description or category (case-insensitive)',
    })
    getTenantBrandMenu(
        @Query('brand_id') brandIdParam: string,
        @Query('search') searchParam: string,
    ) {
        const tenantId = this.getTenantIdFromEnv();
        const brandId = brandIdParam ? +brandIdParam : undefined;
        if (!brandId) throw new NotFoundException('brand_id is required');
        const search =
            searchParam != null && searchParam.trim() !== ''
                ? searchParam.trim()
                : undefined;
        return this.menuService.getTenantBrandMenu(tenantId, brandId, {
            search,
        });
    }

    @Get('tenant/menu/search')
    @ApiOperation({
        summary:
            'Tenant-wide menu search across all brands (consumer header autocomplete)',
    })
    @ApiQuery({ name: 'q', required: true, example: 'burger' })
    @ApiQuery({ name: 'limit', required: false, example: '8' })
    searchTenantMenu(
        @Query('q') qParam: string,
        @Query('limit') limitParam: string,
    ) {
        const tenantId = this.getTenantIdFromEnv();
        const q = qParam?.trim();
        if (!q || q.length < 2) return [];
        const parsed = limitParam ? parseInt(limitParam, 10) : 8;
        const limit = Math.min(
            Math.max(Number.isFinite(parsed) ? parsed : 8, 1),
            20,
        );
        return this.menuService.searchTenantMenu(tenantId, q, limit);
    }

    @Get('tenant/menu/items/:id')
    @ApiOperation({
        summary:
            'Get a single menu item for tenant consumer web (includes gallery; no branch_id)',
    })
    @ApiQuery({ name: 'brand_id', required: true, example: '1' })
    getTenantMenuItem(
        @Param('id') id: string,
        @Query('brand_id') brandIdParam: string,
    ) {
        const tenantId = this.getTenantIdFromEnv();
        const brandId = brandIdParam ? +brandIdParam : undefined;
        if (!brandId) throw new NotFoundException('brand_id is required');
        return this.menuService.getTenantMenuItem(tenantId, brandId, +id);
    }

    @Get('categories')
    getCategories(@Query('brand_id') brandIdParam: string) {
        const brandId = brandIdParam ? +brandIdParam : undefined;
        if (!brandId) throw new NotFoundException('brand_id is required');
        return this.menuService.getCategories(brandId, null);
    }

    /**
     * Consumer (brand-first): list unique categories pooled across a set of brands.
     * Dedupes by name and reports how many of the given brands offer each. Example item:
     * { key: "milkshakes", name: "Milkshakes", brandCount: 3 }
     */
    @Get('categories/global')
    @ApiOperation({
        summary:
            'List unique categories pooled across a set of brands (consumer app, brand-first)',
    })
    @ApiQuery({
        name: 'brand_ids',
        required: true,
        example: '1,2,3',
        description:
            'Brand ids to pool categories across. Comma-separated (brand_ids=1,2,3) or repeated (brand_ids=1&brand_ids=2).',
    })
    async getGlobalCategories(
        @Query('brand_ids') brandIdsParam: string | string[],
    ) {
        const brandIds = this.parseBrandIds(brandIdsParam);
        if (brandIds.length === 0) {
            throw new BadRequestException(
                'brand_ids is required (comma-separated or repeated)',
            );
        }
        return this.menuService.getConsumerCategoriesForBrandIds(brandIds);
    }

    /**
     * Consumer (brand-first): for a category key (e.g. "milkshakes"), list which of the
     * given brands offer it.
     */
    @Get('categories/:categoryKey/brands')
    @ApiOperation({
        summary:
            'List which of a set of brands offer a given category (consumer app, brand-first)',
    })
    @ApiParam({
        name: 'categoryKey',
        example: 'milkshakes',
        description: 'Category key from /categories/global (lowercased name)',
    })
    @ApiQuery({
        name: 'brand_ids',
        required: true,
        example: '1,2,3',
        description:
            'Brand ids to search. Comma-separated (brand_ids=1,2,3) or repeated (brand_ids=1&brand_ids=2).',
    })
    async getBrandsForCategory(
        @Param('categoryKey') categoryKey: string,
        @Query('brand_ids') brandIdsParam: string | string[],
    ) {
        const brandIds = this.parseBrandIds(brandIdsParam);
        if (brandIds.length === 0) {
            throw new BadRequestException(
                'brand_ids is required (comma-separated or repeated)',
            );
        }
        const matchingBrandIds =
            await this.menuService.getConsumerBrandIdsForCategoryKey(
                brandIds,
                categoryKey,
            );
        return this.brandsService.findAllPublicByIds(matchingBrandIds);
    }

    /**
     * Consumer: unique categories across the brands available near a location. Same shape as
     * /categories/global, but the brand set comes from branches in range of lat/lng instead of
     * a single branch_id.
     */
    @Get('nearby/categories')
    @ApiOperation({
        summary:
            'List unique categories across brands available near a location (consumer app)',
    })
    @ApiQuery({ name: 'latitude', required: true, example: '31.5204' })
    @ApiQuery({ name: 'longitude', required: true, example: '74.3587' })
    @ApiQuery({ name: 'radius_km', required: false, example: '10' })
    async getNearbyCategories(
        @Query('latitude') latitudeParam: string,
        @Query('longitude') longitudeParam: string,
        @Query('radius_km') radiusKmParam: string,
    ) {
        const { lat, lng, maxRadiusKm } = this.parseLatLng(
            latitudeParam,
            longitudeParam,
            radiusKmParam,
        );
        const nearby = await this.branchesService.findNearbyWithBrands(
            lat,
            lng,
            maxRadiusKm,
        );
        const brandIds = this.collectNearbyBrandIds(nearby);
        return this.menuService.getConsumerCategoriesForBrandIds(brandIds);
    }

    /**
     * Consumer: for a given category key, brands offering it that are available near a location.
     * One row per (brand, branch), mirroring /nearby/brands.
     */
    @Get('nearby/categories/:categoryKey/brands')
    @ApiOperation({
        summary:
            'List brands offering a category available near a location (consumer app). One row per (brand, branch).',
    })
    @ApiParam({
        name: 'categoryKey',
        example: 'milkshakes',
        description: 'Category key from /nearby/categories (lowercased name)',
    })
    @ApiQuery({ name: 'latitude', required: true, example: '31.5204' })
    @ApiQuery({ name: 'longitude', required: true, example: '74.3587' })
    @ApiQuery({ name: 'radius_km', required: false, example: '10' })
    async getNearbyBrandsForCategory(
        @Param('categoryKey') categoryKey: string,
        @Query('latitude') latitudeParam: string,
        @Query('longitude') longitudeParam: string,
        @Query('radius_km') radiusKmParam: string,
    ) {
        const { lat, lng, maxRadiusKm } = this.parseLatLng(
            latitudeParam,
            longitudeParam,
            radiusKmParam,
        );
        const nearby = await this.branchesService.findNearbyWithBrands(
            lat,
            lng,
            maxRadiusKm,
        );
        const brandIds = this.collectNearbyBrandIds(nearby);
        const withCat =
            await this.menuService.getConsumerBrandIdsForCategoryKey(
                brandIds,
                categoryKey,
            );
        return this.brandsService.findPublicNearbyRows(
            nearby,
            undefined,
            new Set(withCat),
        );
    }

    @Get('menu/items/:id')
    @ApiOperation({ summary: 'Get menu item detail' })
    @ApiQuery({ name: 'branch_id', required: true, example: '1' })
    @ApiQuery({
        name: 'order_type',
        required: false,
        example: 'pickup',
        description:
            'Optional but recommended. If the item is not available for this order channel, returns 404. Align with checkout `order_type`.',
    })
    getMenuItemDetail(
        @Param('id') id: string,
        @Query('branch_id') branchIdParam: string,
        @Query('order_type') orderTypeParam: string,
    ) {
        const branchId = branchIdParam ? +branchIdParam : undefined;
        if (!branchId) throw new NotFoundException('branch_id is required');
        const orderType =
            orderTypeParam != null && orderTypeParam.trim() !== ''
                ? orderTypeParam.trim()
                : undefined;
        return this.menuService.getPublicMenuItemDetail(
            +id,
            branchId,
            orderType,
        );
    }

    @Post('orders/quote')
    @UseGuards(OptionalCustomerJwtAuthGuard)
    @ApiOperation({
        summary:
            'Quote an order before placing it. For delivery, returns delivery_options[] (Saver/Standard/Priority with fee + ETA). Returns 422 if the drop-off is outside the branch delivery radius.',
    })
    // Without this the endpoint renders as "No parameters" in Swagger and its
    // Execute button posts an empty body — which is how it looked broken.
    @ApiBody({
        schema: {
            type: 'object',
            required: ['branch_id', 'order_type', 'items'],
            properties: {
                branch_id: { type: 'number' },
                order_type: {
                    type: 'string',
                    enum: ['delivery', 'pickup', 'takeaway', 'dine_in'],
                },
                items: {
                    type: 'array',
                    description:
                        'A PLAIN line sends menu_item_id. A DEAL line sends ' +
                        'deal_menu_item_id plus one components entry per slot ' +
                        '— never menu_item_id, which is refused.',
                    items: {
                        type: 'object',
                        properties: {
                            menu_item_id: { type: 'number' },
                            deal_menu_item_id: { type: 'number' },
                            quantity: { type: 'number' },
                            variant_id: { type: 'number' },
                            components: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        slot_index: { type: 'number' },
                                        menu_item_id: { type: 'number' },
                                        variant_id: { type: 'number' },
                                    },
                                },
                            },
                        },
                    },
                },
                discount_code: { type: 'string' },
                customer_phone: { type: 'string' },
                loyalty_points_to_redeem: { type: 'number' },
                latitude: { type: 'number' },
                longitude: { type: 'number' },
                delivery_tier: { type: 'string' },
            },
        },
        examples: {
            plain: {
                summary: 'Two ordinary items',
                value: {
                    branch_id: 10,
                    order_type: 'pickup',
                    items: [
                        { menu_item_id: 2422, variant_id: 1537, quantity: 1 },
                    ],
                },
            },
            deal: {
                summary: 'A deal (BOGO) — one component per slot',
                description:
                    'A deal has no price of its own; this is what returns the ' +
                    'real figure to show in the cart.',
                value: {
                    branch_id: 10,
                    order_type: 'pickup',
                    items: [
                        {
                            deal_menu_item_id: 2514,
                            quantity: 1,
                            components: [
                                {
                                    slot_index: 0,
                                    menu_item_id: 2422,
                                    variant_id: 1537,
                                },
                                {
                                    slot_index: 1,
                                    menu_item_id: 2423,
                                    variant_id: 1538,
                                },
                            ],
                        },
                    ],
                },
            },
        },
    })
    async quoteOrder(
        @Req()
        req: {
            user?: Customer | null;
            headers?: Record<string, string | string[] | undefined>;
        },
        @Body()
        dto: {
            branch_id: number;
            order_type: string;
            items: {
                menu_item_id?: number;
                deal_menu_item_id?: number;
                components?: {
                    slot_index: number;
                    menu_item_id: number;
                    variant_id?: number;
                    quantity?: number;
                }[];
                quantity: number;
                variant_id?: number;
                addons?: { addon_id: number; quantity?: number }[];
                modifiers?: { modifier_id: number; quantity?: number }[];
            }[];
            discount_code?: string;
            customer_phone?: string;
            loyalty_points_to_redeem?: number;
            latitude?: number;
            longitude?: number;
            delivery_tier?: string;
        },
    ) {
        // An empty POST used to reach getTenantIdFromBranch(undefined) and come
        // back as a bare 500 — which is exactly what Swagger's Execute sends.
        // Name what is missing instead; every other failure here already does.
        const missing = (['branch_id', 'order_type', 'items'] as const).filter(
            (k) => dto?.[k] == null,
        );
        if (missing.length) {
            throw new BadRequestException(
                `Missing required field(s): ${missing.join(', ')}. ` +
                    `Send { branch_id, order_type, items: [...] }.`,
            );
        }
        if (!Array.isArray(dto.items) || dto.items.length === 0) {
            throw new BadRequestException('items must be a non-empty array.');
        }
        // The shipped app sends deals as `deal_items`; translate before
        // anything reads dto.items. See legacy-deal-payload.ts.
        normalizeOrderBody(dto, '/public/consumer/orders/quote');
        const tenantId = await this.getTenantIdFromBranch(dto.branch_id);
        const source = this.resolveOrderSourceFromRequest(req);
        return this.ordersService.quote(dto, tenantId, source);
    }

    @Post('orders')
    @UseGuards(OptionalCustomerJwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Place order' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['branch_id', 'order_type', 'items'],
            properties: {
                branch_id: { type: 'number' },
                order_type: {
                    type: 'string',
                    description:
                        "Must match each line item's `available_for_order_types` from the menu. Typical values: `delivery`, `pickup` (website), `takeaway` (POS; treated like pickup), `dine_in`. Ordering an item that does not support this channel returns 400.",
                    enum: ['delivery', 'pickup', 'takeaway', 'dine_in'],
                },
                customer_name: { type: 'string' },
                customer_phone: { type: 'string' },
                delivery_address: { type: 'string' },
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            menu_item_id: { type: 'number' },
                            quantity: { type: 'number' },
                            variant_id: { type: 'number' },
                            addons: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        addon_id: { type: 'number' },
                                        quantity: { type: 'number' },
                                    },
                                },
                            },
                            modifiers: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        modifier_id: { type: 'number' },
                                        quantity: { type: 'number' },
                                    },
                                },
                            },
                            notes: { type: 'string' },
                            deal_menu_item_id: {
                                type: 'number',
                                description:
                                    'DEAL lines only. Send this INSTEAD of menu_item_id when the ' +
                                    'menu item carries a "deal" object, together with one ' +
                                    'components entry per slot. A deal sent as a plain ' +
                                    'menu_item_id is rejected: it records none of the ' +
                                    "customer's choices, so it cannot be prepared.",
                            },
                            components: {
                                type: 'array',
                                description:
                                    "DEAL lines only. One entry per slot of the menu item's " +
                                    '"deal".slots — slot_index from the slot, menu_item_id the ' +
                                    "choice made in it (for a fixed slot, that slot's own item).",
                                items: {
                                    type: 'object',
                                    properties: {
                                        slot_index: { type: 'number' },
                                        menu_item_id: { type: 'number' },
                                        quantity: { type: 'number' },
                                        variant_id: { type: 'number' },
                                        addons: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    addon_id: {
                                                        type: 'number',
                                                    },
                                                    quantity: {
                                                        type: 'number',
                                                    },
                                                },
                                            },
                                        },
                                        modifiers: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    modifier_id: {
                                                        type: 'number',
                                                    },
                                                    quantity: {
                                                        type: 'number',
                                                    },
                                                },
                                            },
                                        },
                                        notes: { type: 'string' },
                                    },
                                },
                            },
                        },
                    },
                },
                notes: { type: 'string' },
                discount_code: { type: 'string' },
                loyalty_points_to_redeem: {
                    type: 'number',
                    description:
                        'Points to redeem (requires customer_phone; supported for consumer_app and consumer_web)',
                },
                customer_id: {
                    type: 'number',
                    description:
                        'Optional registered customer id; must match customer_phone for this tenant',
                },
                latitude: {
                    type: 'number',
                    description: 'Optional drop-off latitude (e.g. map picker)',
                },
                longitude: {
                    type: 'number',
                    description: 'Optional drop-off longitude',
                },
                branch_latitude: {
                    type: 'number',
                    description:
                        'Optional branch latitude snapshot (from client)',
                },
                branch_longitude: {
                    type: 'number',
                    description:
                        'Optional branch longitude snapshot (from client)',
                },
            },
            example: {
                branch_id: 1,
                order_type: 'delivery',
                customer_name: 'John Doe',
                customer_phone: '03001234567',
                customer_id: 42,
                delivery_address: '123 Main St',
                latitude: 24.8607,
                longitude: 67.0011,
                branch_latitude: 24.8611,
                branch_longitude: 67.0022,
                items: [
                    {
                        menu_item_id: 5,
                        quantity: 2,
                        variant_id: 3,
                        addons: [{ addon_id: 1, quantity: 1 }],
                        modifiers: [{ modifier_id: 7, quantity: 1 }],
                        notes: 'No onions',
                    },
                    {
                        // A DEAL: no menu_item_id — one component per slot of
                        // the item's "deal".slots (slot 0 fixed, slots 1-2 the
                        // customer's picks).
                        deal_menu_item_id: 2586,
                        quantity: 1,
                        components: [
                            { slot_index: 0, menu_item_id: 2515, quantity: 1 },
                            { slot_index: 1, menu_item_id: 2601, quantity: 1 },
                            { slot_index: 2, menu_item_id: 2773, quantity: 1 },
                        ],
                    },
                ],
                notes: '',
                discount_code: 'SAVE10',
                loyalty_points_to_redeem: 50,
            },
        },
    })
    async placeOrder(
        @Req()
        req: {
            user?: Customer | null;
            headers?: Record<string, string | string[] | undefined>;
        },
        @Body()
        dto: {
            branch_id: number;
            order_type: string;
            customer_name?: string;
            customer_phone?: string;
            delivery_address?: string;
            /**
             * A line is EITHER a plain menu item OR a deal. The plain shape is
             * unchanged; a deal sends `deal_menu_item_id` plus one `components`
             * entry per slot of the item's published `deal` object, and is
             * rejected if sent as a plain `menu_item_id` (it would record none
             * of the customer's choices).
             */
            items: Array<
                | {
                      menu_item_id: number;
                      quantity: number;
                      variant_id?: number;
                      addons?: { addon_id: number; quantity?: number }[];
                      modifiers?: { modifier_id: number; quantity?: number }[];
                      notes?: string;
                  }
                | {
                      deal_menu_item_id: number;
                      quantity: number;
                      components: Array<{
                          slot_index: number;
                          menu_item_id: number;
                          quantity: number;
                          variant_id?: number;
                          addons?: { addon_id: number; quantity?: number }[];
                          modifiers?: {
                              modifier_id: number;
                              quantity?: number;
                          }[];
                          notes?: string;
                      }>;
                  }
            >;
            notes?: string;
            discount_code?: string;
            loyalty_points_to_redeem?: number;
            customer_id?: number;
            latitude?: number;
            longitude?: number;
            branch_latitude?: number;
            branch_longitude?: number;
            /** Chosen delivery tier ('saver'|'standard'|'priority') for tier-enabled brands. */
            delivery_tier?: string;
            /** Optional idempotency key so a retried/double-tapped placement is deduped. */
            idempotency_key?: string;
        },
    ) {
        // Same shim as quote: the shipped app sends deals as `deal_items`.
        // Placement matters more than the quote — without this the deal is
        // refused by the plain-deal guard, or worse, priced at zero.
        normalizeOrderBody(dto, '/public/consumer/orders');
        const tenantId = await this.getTenantIdFromBranch(dto.branch_id);
        const source = this.resolveOrderSourceFromRequest(req);
        return this.ordersService.createOrder(
            dto,
            tenantId,
            null,
            source,
            req.user?.id ?? null,
            null,
            dto.idempotency_key ?? null,
        );
    }

    @Get('orders')
    @ApiOperation({ summary: 'Get order history' })
    @ApiQuery({ name: 'phone', required: true, example: '03001234567' })
    @ApiQuery({ name: 'branch_id', required: false, example: '1' })
    @ApiQuery({ name: 'tenant_id', required: false })
    @ApiQuery({ name: 'limit', required: false })
    async getOrderHistory(
        @Req()
        req: { headers?: Record<string, string | string[] | undefined> },
        @Query('phone') phone: string,
        @Query('branch_id') branchIdParam: string,
        @Query('tenant_id') tenantIdParam: string,
        @Query('limit') limitParam: string,
    ) {
        if (!phone?.trim()) throw new NotFoundException('phone is required');
        const options: {
            branchId?: number;
            tenantId?: number;
            limit?: number;
            sources?: Array<'consumer_app' | 'consumer_web' | 'kiosk'>;
        } = {};
        if (branchIdParam) options.branchId = +branchIdParam;
        if (tenantIdParam) options.tenantId = +tenantIdParam;
        if (limitParam) options.limit = +limitParam;
        options.sources = [this.resolveOrderSourceFromRequest(req)];

        const orders = await this.ordersService.findByCustomerPhone(
            phone.trim(),
            options,
        );

        let resolvedTenantId: number | null = null;
        if (options.tenantId != null && Number.isFinite(options.tenantId)) {
            resolvedTenantId = options.tenantId;
        } else if (
            options.branchId != null &&
            Number.isFinite(options.branchId)
        ) {
            resolvedTenantId = await this.getTenantIdFromBranch(
                options.branchId,
            );
        } else if (orders.length > 0) {
            const firstBranchId =
                (orders[0] as { branch_id?: number | null }).branch_id ?? null;
            if (firstBranchId != null && Number.isFinite(firstBranchId)) {
                resolvedTenantId =
                    await this.getTenantIdFromBranch(firstBranchId);
            }
        }

        // Only the shared APP wallet is relevant to consumer order history;
        // consumer_web earns no loyalty so its balance is always 0.
        const loyaltyPointsBalance =
            resolvedTenantId != null && options.sources?.[0] === 'consumer_app'
                ? await this.loyaltyService.getAppWalletBalance(
                      resolvedTenantId,
                      phone.trim(),
                  )
                : 0;

        return orders.map((o) => ({
            ...o,
            loyalty_points_balance: loyaltyPointsBalance,
        }));
    }

    @Post('orders/:id/ratings/rider')
    @UseGuards(CustomerJwtAuthGuard)
    @ApiBearerAuth()
    @ApiTags('Consumer – Rate RIDER (delivery)')
    @ApiOperation({
        operationId: 'consumer_rateRiderForOrder',
        summary: 'Submit / update RIDER star rating (not brand)',
        description:
            'Use this endpoint only to rate the **assigned delivery rider** after `delivery_status` is `delivered`. ' +
            'Path `id` is the **order id** (same as GET /public/consumer/orders/:id). Body requires `stars` (1–5) and allows optional `comment`. ' +
            'Does not update public brand scores. For restaurant/brand stars use **POST .../ratings/brand** instead.',
    })
    @ApiParam({
        name: 'id',
        description:
            '**Order id** (numeric). Identifies which order you are rating. Not a rider user id or brand id.',
        example: 1001,
        type: Number,
    })
    @ApiBody({
        description:
            'Rider star rating (1–5). Optional `comment` is trimmed; empty string clears on update. Max 500 characters.',
        examples: {
            starsOnly: {
                summary: 'Stars only',
                value: { stars: 5 },
            },
            withComment: {
                summary: 'Stars + optional comment',
                value: { stars: 4, comment: 'Friendly and on time' },
            },
        },
        schema: {
            type: 'object',
            required: ['stars'],
            properties: {
                stars: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 5,
                    example: 5,
                    description: 'Star rating for the delivery rider (1–5).',
                },
                comment: {
                    type: 'string',
                    nullable: true,
                    maxLength: 500,
                    description:
                        'Optional feedback about the rider for this order (not shown on public brand menus).',
                },
            },
        },
    })
    @ApiOkResponse({
        description:
            'Upserted rider rating row (same shape as GET .../ratings `rider_rating`).',
        schema: {
            type: 'object',
            required: [
                'id',
                'order_id',
                'customer_id',
                'rider_user_id',
                'stars',
                'order_item_ids',
            ],
            properties: {
                id: { type: 'integer', example: 1 },
                order_id: { type: 'integer', example: 1001 },
                customer_id: { type: 'integer', example: 42 },
                rider_user_id: { type: 'integer', example: 55 },
                stars: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
                comment: {
                    type: 'string',
                    nullable: true,
                    description:
                        'Customer comment if provided; otherwise null.',
                },
                order_item_ids: {
                    type: 'array',
                    items: { type: 'integer' },
                    example: [101, 102],
                },
                created_at: {
                    type: 'string',
                    format: 'date-time',
                    nullable: true,
                },
                updated_at: {
                    type: 'string',
                    format: 'date-time',
                    nullable: true,
                },
            },
        },
    })
    async rateRiderForOrder(
        @Param('id') id: string,
        @Req() req: { user: Customer },
        @Body() body: { stars: number; comment?: string },
    ) {
        return this.ratingsService.upsertRiderRating(
            +id,
            req.user,
            body?.stars,
            body?.comment,
        );
    }

    @Post('orders/:id/ratings/brand')
    @UseGuards(CustomerJwtAuthGuard)
    @ApiBearerAuth()
    @ApiTags('Consumer – Rate BRAND / order')
    @ApiOperation({
        operationId: 'consumer_rateBrandForOrder',
        summary:
            'Submit / update BRAND (restaurant) star rating for this order',
        description:
            'Use this endpoint to rate the **food / brand experience** for this order; averages appear on public brand APIs. ' +
            'Path `id` is the **order id** (same as GET /public/consumer/orders/:id). Body requires `stars` (1–5); optional `comment` (string, max 500 chars) is stored with this brand rating only. ' +
            '**Single-brand order:** omit `brand_id` (server infers the brand). ' +
            '**Multi-brand order (e.g. food court):** send **one request per brand** — same order `id` each time, with `brand_id` set to that brand and `stars` for that brand only (2 brands ⇒ 2 POSTs). ' +
            'Use **GET .../orders/:id/ratings** to see which brands you already rated. ' +
            'This is **not** the rider rating — use **POST .../ratings/rider** for the driver.',
    })
    @ApiParam({
        name: 'id',
        description:
            '**Order id** (numeric). Identifies which order you are rating. Not a brand id alone (use body `brand_id` only when needed).',
        example: 1001,
        type: Number,
    })
    @ApiBody({
        description:
            'One brand per request. For multiple brands on the same order, call this endpoint repeatedly with the same order id.',
        examples: {
            singleBrand: {
                summary: 'Single-brand order',
                value: { stars: 5 },
            },
            singleBrandWithComment: {
                summary: 'Single-brand with optional comment',
                value: { stars: 5, comment: 'Food was great!' },
            },
            multiBrandFirst: {
                summary: 'Multi-brand — rate first brand',
                value: { stars: 5, brand_id: 12 },
            },
            multiBrandSecond: {
                summary: 'Multi-brand — rate second brand (second POST)',
                value: { stars: 4, brand_id: 34, comment: 'Slow service' },
            },
        },
        schema: {
            type: 'object',
            required: ['stars'],
            properties: {
                stars: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 5,
                    example: 5,
                },
                brand_id: {
                    type: 'integer',
                    minimum: 1,
                    description:
                        'Required when the order has line items from more than one brand. Must match a brand on that order.',
                    example: 12,
                },
                comment: {
                    type: 'string',
                    nullable: true,
                    maxLength: 500,
                    description:
                        'Optional free-text feedback for this brand on this order (not shown on public brand aggregates).',
                },
            },
        },
    })
    @ApiOkResponse({
        description:
            'Upserted brand rating row for this `(order_id, brand_id)` (same shape as entries in GET .../ratings `brand_ratings`).',
        schema: {
            type: 'object',
            required: [
                'id',
                'order_id',
                'brand_id',
                'customer_id',
                'stars',
                'order_item_ids',
            ],
            properties: {
                id: { type: 'integer', example: 1 },
                order_id: { type: 'integer', example: 1001 },
                brand_id: { type: 'integer', example: 12 },
                customer_id: { type: 'integer', example: 42 },
                stars: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
                comment: {
                    type: 'string',
                    nullable: true,
                    description:
                        'Customer comment if provided; otherwise null.',
                },
                order_item_ids: {
                    type: 'array',
                    items: { type: 'integer' },
                    example: [101],
                },
                created_at: {
                    type: 'string',
                    format: 'date-time',
                    nullable: true,
                },
                updated_at: {
                    type: 'string',
                    format: 'date-time',
                    nullable: true,
                },
            },
        },
    })
    async rateBrandForOrder(
        @Param('id') id: string,
        @Req() req: { user: Customer },
        @Body() body: { stars: number; brand_id?: number; comment?: string },
    ) {
        return this.ratingsService.upsertBrandRating(
            +id,
            req.user,
            body?.stars,
            body?.brand_id,
            body?.comment,
        );
    }

    @Get('orders/:id/ratings')
    @UseGuards(CustomerJwtAuthGuard)
    @ApiBearerAuth()
    @ApiTags('Consumer – Read my ratings')
    @ApiOperation({
        operationId: 'consumer_getMyRatingsForOrder',
        summary: 'Read my rider + brand rating rows for this order',
        description:
            'Returns `rider_rating` (one object or null) and `brand_ratings` (array). Path `id` is the **order id**. ' +
            'Each row may include `comment` when the customer submitted optional text with rider or brand ratings.',
    })
    @ApiParam({
        name: 'id',
        description:
            '**Order id** (numeric) for which to load your submitted ratings.',
        example: 1001,
        type: Number,
    })
    @ApiOkResponse({
        description:
            '`rider_rating` is a single object or null. `brand_ratings` is an array (one row per brand you rated on this order). Each row may include `comment`.',
        schema: {
            type: 'object',
            required: ['rider_rating', 'brand_ratings'],
            properties: {
                rider_rating: {
                    type: 'object',
                    nullable: true,
                    description:
                        'Your rider rating for this order, or null if not submitted.',
                    properties: {
                        id: { type: 'integer' },
                        order_id: { type: 'integer' },
                        customer_id: { type: 'integer' },
                        rider_user_id: { type: 'integer' },
                        stars: { type: 'integer', minimum: 1, maximum: 5 },
                        comment: {
                            type: 'string',
                            nullable: true,
                            description:
                                'Optional text submitted with the rider rating.',
                        },
                        order_item_ids: {
                            type: 'array',
                            items: { type: 'integer' },
                        },
                        created_at: {
                            type: 'string',
                            format: 'date-time',
                            nullable: true,
                        },
                        updated_at: {
                            type: 'string',
                            format: 'date-time',
                            nullable: true,
                        },
                    },
                },
                brand_ratings: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'integer' },
                            order_id: { type: 'integer' },
                            brand_id: { type: 'integer' },
                            customer_id: { type: 'integer' },
                            stars: { type: 'integer', minimum: 1, maximum: 5 },
                            comment: {
                                type: 'string',
                                nullable: true,
                                description:
                                    'Optional text submitted with this brand rating.',
                            },
                            order_item_ids: {
                                type: 'array',
                                items: { type: 'integer' },
                            },
                            created_at: {
                                type: 'string',
                                format: 'date-time',
                                nullable: true,
                            },
                            updated_at: {
                                type: 'string',
                                format: 'date-time',
                                nullable: true,
                            },
                        },
                    },
                },
            },
        },
    })
    async getMyRatingsForOrder(
        @Param('id') id: string,
        @Req() req: { user: Customer },
    ) {
        return this.ratingsService.getMyRatingsForOrder(+id, req.user);
    }

    @Get('orders/:id/status')
    async getOrderStatus(@Param('id') id: string) {
        const order = await this.ordersService.findOne(+id);
        return {
            id: order.id,
            order_number: order.order_number,
            status: order.status,
            total_amount: order.total_amount,
        };
    }

    @Get('orders/:id/payments')
    async getOrderPayments(
        @Param('id') id: string,
        @Query('phone') phone: string,
    ) {
        if (!phone?.trim()) throw new NotFoundException('phone is required');
        const order = await this.ordersService.findOneByCustomerPhone(
            +id,
            phone.trim(),
        );
        return { payments: order.payments };
    }

    @Get('orders/:id')
    async getOrderDetails(
        @Param('id') id: string,
        @Query('phone') phone: string,
    ) {
        if (!phone?.trim()) throw new NotFoundException('phone is required');
        return this.ordersService.findOneByCustomerPhone(+id, phone.trim());
    }

    @Patch('orders/:id/cancel')
    @ApiOperation({ summary: 'Cancel order' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['phone'],
            properties: { phone: { type: 'string' } },
            example: { phone: '03001234567' },
        },
    })
    async cancelOrder(
        @Param('id') id: string,
        @Body() body: { phone: string },
    ) {
        const phone = body?.phone ?? (body as { phone?: string }).phone;
        if (!phone?.trim()) throw new NotFoundException('phone is required');
        return this.ordersService.cancelByCustomerPhone(+id, phone.trim());
    }

    @Post('orders/:id/pay')
    @ApiOperation({ summary: 'Create payment for order' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['phone', 'payment_method', 'amount'],
            properties: {
                phone: { type: 'string' },
                payment_method: { type: 'string' },
                amount: { type: 'number' },
                reference_number: { type: 'string' },
            },
            example: {
                phone: '03001234567',
                payment_method: 'cash',
                amount: 2500,
                reference_number: 'REF123',
            },
        },
    })
    async createPayment(
        @Param('id') id: string,
        @Body()
        dto: {
            phone: string;
            payment_method: string;
            amount: number;
            reference_number?: string;
        },
    ) {
        if (!dto.phone?.trim())
            throw new NotFoundException('phone is required');
        await this.ordersService.findOneByCustomerPhone(+id, dto.phone.trim());
        const payment = await this.paymentsService.processPayment(
            +id,
            dto.payment_method,
            dto.amount,
            dto.reference_number,
        );
        return {
            id: payment.id,
            order_id: payment.orderId,
            payment_method: payment.paymentMethod,
            amount: Number(payment.amount),
            status: payment.status,
            reference_number: payment.referenceNumber ?? null,
        };
    }

    /**
     * Get a loyalty wallet balance by phone. `wallet_type` selects the shared
     * APP wallet (default) or a brand-scoped POS wallet; `brand_id` (optional)
     * names the brand for POS wallets and for display/conversion settings,
     * defaulting to the branch's first brand. `branch_id` identifies the tenant.
     */
    @Get('loyalty/balance')
    @ApiOperation({ summary: 'Get loyalty balance' })
    @ApiQuery({ name: 'branch_id', required: true, example: '1' })
    @ApiQuery({ name: 'phone', required: true, example: '03001234567' })
    @ApiQuery({
        name: 'wallet_type',
        required: false,
        enum: ['app', 'pos'],
        example: 'app',
    })
    @ApiQuery({ name: 'brand_id', required: false, example: '1' })
    async getLoyaltyBalance(
        @Query('branch_id') branchIdParam: string,
        @Query('phone') phone: string,
        @Query('wallet_type') walletTypeParam?: string,
        @Query('brand_id') brandIdParam?: string,
    ) {
        const branchId = branchIdParam ? +branchIdParam : undefined;
        if (!branchId || !phone?.trim())
            throw new NotFoundException('branch_id and phone are required');
        const branch = (await this.branchRepo.findOne({
            where: { id: branchId },
            relations: ['branchBrands', 'branchBrands.brand'],
        })) as BranchWithBrands | null;
        if (!branch?.branchBrands?.length)
            throw new NotFoundException('Branch not found');
        const tenantId = branch.branchBrands[0]?.brand?.tenantId ?? null;
        if (tenantId == null) throw new NotFoundException('Branch not found');
        const walletType: 'pos' | 'app' =
            walletTypeParam === 'pos' ? 'pos' : 'app';
        const brandId = brandIdParam
            ? +brandIdParam
            : (branch.branchBrands[0]?.brand?.id ?? null);
        const result = await this.loyaltyService.getWalletBalance(
            tenantId,
            phone.trim(),
            walletType,
            brandId,
        );
        return (
            result ?? {
                balance: 0,
                displayName: 'Reward Points',
                spendPerPoint: 1000,
                cashValuePerPoint: 10,
                minOrderToEarn: 1,
                minOrderToRedeem: 1,
            }
        );
    }

    @Get('cart')
    @ApiOperation({ summary: 'Get cart' })
    @ApiQuery({ name: 'phone', required: true, example: '03001234567' })
    @ApiQuery({ name: 'branch_id', required: true, example: '1' })
    async getCart(
        @Query('phone') phone: string,
        @Query('branch_id') branchIdParam: string,
    ) {
        if (!phone?.trim() || !branchIdParam)
            throw new NotFoundException('phone and branch_id are required');
        const customer = await this.resolveCartCustomerOrThrow(phone);
        return this.cartService.getCart(customer.id, +branchIdParam);
    }

    @Post('cart/items')
    @ApiOperation({ summary: 'Add item to cart' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['phone', 'branch_id', 'menu_item_id', 'quantity'],
            properties: {
                phone: { type: 'string' },
                branch_id: { type: 'number' },
                menu_item_id: { type: 'number' },
                quantity: { type: 'number' },
                variant_id: { type: 'number' },
                addons: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            addon_id: { type: 'number' },
                            quantity: { type: 'number' },
                        },
                    },
                },
                modifiers: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            modifier_id: { type: 'number' },
                            quantity: { type: 'number' },
                        },
                    },
                },
                notes: { type: 'string' },
            },
            example: {
                phone: '03001234567',
                branch_id: 1,
                menu_item_id: 5,
                quantity: 2,
                variant_id: 3,
                addons: [{ addon_id: 1, quantity: 1 }],
                modifiers: [{ modifier_id: 7, quantity: 1 }],
                notes: 'No ice',
            },
        },
    })
    async addCartItem(
        @Body()
        dto: {
            phone: string;
            branch_id: number;
            menu_item_id: number;
            quantity: number;
            variant_id?: number;
            addons?: { addon_id: number; quantity?: number }[];
            modifiers?: { modifier_id: number; quantity?: number }[];
            notes?: string;
        },
    ) {
        if (!dto.phone?.trim() || !dto.branch_id)
            throw new NotFoundException('phone and branch_id are required');
        const customer = await this.resolveCartCustomerOrThrow(dto.phone);
        return this.cartService.addItem(customer.id, dto.branch_id, {
            menu_item_id: dto.menu_item_id,
            quantity: dto.quantity,
            variant_id: dto.variant_id,
            addons: dto.addons,
            modifiers: dto.modifiers,
            notes: dto.notes,
        });
    }

    @Patch('cart/items/:id')
    @ApiOperation({ summary: 'Update cart item details' })
    @ApiQuery({ name: 'phone', required: true, example: '03001234567' })
    @ApiQuery({ name: 'branch_id', required: true, example: '1' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                quantity: { type: 'number' },
                variant_id: { type: 'number', nullable: true },
                addons: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            addon_id: { type: 'number' },
                            quantity: { type: 'number' },
                        },
                    },
                },
                modifiers: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            modifier_id: { type: 'number' },
                            quantity: { type: 'number' },
                        },
                    },
                },
                notes: { type: 'string', nullable: true },
            },
            example: {
                quantity: 3,
                variant_id: 2,
                addons: [{ addon_id: 1, quantity: 1 }],
                modifiers: [{ modifier_id: 7, quantity: 1 }],
                notes: 'Less spicy',
            },
        },
    })
    async updateCartItem(
        @Param('id') id: string,
        @Query('phone') phone: string,
        @Query('branch_id') branchIdParam: string,
        @Body()
        body: {
            quantity?: number;
            variant_id?: number | null;
            addons?: { addon_id: number; quantity?: number }[] | null;
            modifiers?: { modifier_id: number; quantity?: number }[] | null;
            notes?: string | null;
        },
    ) {
        if (!phone?.trim() || !branchIdParam)
            throw new NotFoundException('phone and branch_id are required');
        const customer = await this.resolveCartCustomerOrThrow(phone);
        return this.cartService.updateItem(+id, customer.id, body ?? {});
    }

    @Delete('cart/items/:id')
    async removeCartItem(
        @Param('id') id: string,
        @Query('phone') phone: string,
        @Query('branch_id') branchIdParam: string,
    ) {
        if (!phone?.trim() || !branchIdParam)
            throw new NotFoundException('phone and branch_id are required');
        const customer = await this.resolveCartCustomerOrThrow(phone);
        return this.cartService.removeItem(+id, customer.id);
    }

    @Delete('cart')
    async clearCart(
        @Query('phone') phone: string,
        @Query('branch_id') branchIdParam: string,
    ) {
        if (!phone?.trim() || !branchIdParam)
            throw new NotFoundException('phone and branch_id are required');
        const customer = await this.resolveCartCustomerOrThrow(phone);
        return this.cartService.clearCart(customer.id, +branchIdParam);
    }

    // ─── CMS Banners ─────────────────────────────────────────────────────────

    @Get('banners')
    @ApiOperation({
        summary: 'List active banners (tenant resolved from server TENANT_ID)',
    })
    async getActiveBanners() {
        const tenantId = this.getTenantIdFromEnv();
        return this.bannersService.findActiveForTenant(tenantId);
    }

    // ─── Customer Promotions ─────────────────────────────────────────────────

    @Get('promotions')
    @UseGuards(CustomerJwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'List promotions assigned to the authenticated customer',
    })
    @ApiQuery({ name: 'status', required: false, example: 'pending' })
    async getMyPromotions(
        @Req() req: { user: Customer },
        @Query('status') status?: string,
    ) {
        return this.promotionsService.getCustomerPromotions(
            req.user.id,
            status,
        );
    }

    @Post('promotions/:id/claim')
    @UseGuards(CustomerJwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Claim a pending promotion and receive a coupon code',
    })
    @ApiParam({ name: 'id', description: 'CustomerPromotion id' })
    async claimPromotion(
        @Req() req: { user: Customer },
        @Param('id') id: string,
    ) {
        return this.promotionsService.claimPromotion(+id, req.user.id);
    }

    // ─── Campaigns & Vouchers (mobile app) ───────────────────────────────────

    @Get('campaigns/feed')
    @ApiOperation({ summary: 'Active campaigns + banners for the mobile app' })
    async getCampaignFeed(
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        const tenantId = this.getTenantIdFromEnv();
        return this.campaignsService.feed(
            tenantId,
            new Date(),
            limit ? Math.max(1, Math.min(100, +limit)) : 50,
            offset ? Math.max(0, +offset) : 0,
        );
    }

    @Get('campaigns/items/:id')
    @ApiOperation({ summary: 'Resolve a campaign item (deep-link target)' })
    async getCampaignItem(@Param('id') id: string) {
        const tenantId = this.getTenantIdFromEnv();
        return this.campaignsService.feedItemById(+id, tenantId);
    }

    @Get('vouchers/mine')
    @UseGuards(CustomerJwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: "The authenticated customer's active vouchers" })
    async getMyVouchers(@Req() req: { user: Customer }) {
        const now = new Date();
        const rows = await this.voucherRepo.find({
            where: { customerId: req.user.id, status: 'active' as never },
            order: { grantedAt: 'DESC' },
        });
        const offerIds = [...new Set(rows.map((v) => v.offerId))];
        const offers = offerIds.length
            ? await this.discountRepo.find({ where: { id: In(offerIds) } })
            : [];
        const byId = new Map(offers.map((o) => [o.id, o]));
        return rows
            .filter((v) => !v.expiresAt || v.expiresAt >= now)
            .map((v) => {
                const o = byId.get(v.offerId);
                return {
                    id: v.id,
                    reference: `VCH-${v.id}`,
                    // Opaque QR token — the app renders this as a QR on the
                    // voucher card. It is NOT the coupon code; safe to expose to
                    // the voucher's own holder.
                    qr_token: v.qrToken,
                    title: o?.name ?? 'Voucher',
                    type: o?.type ?? null,
                    value: o != null ? Number(o.value) : null,
                    min_order_amount:
                        o?.minOrderAmount != null
                            ? Number(o.minOrderAmount)
                            : null,
                    per_customer_limit:
                        (o as { perCustomerLimit?: number | null } | undefined)
                            ?.perCustomerLimit ?? null,
                    uses: v.uses,
                    expires_at: v.expiresAt?.toISOString() ?? null,
                };
            });
    }

    @Get('vouchers/resolve')
    @ApiOperation({
        summary: 'Resolve a scanned voucher QR token to an applyable code',
    })
    @ApiQuery({ name: 'token', required: true })
    async resolveVoucher(@Query('token') token: string) {
        const tenantId = this.getTenantIdFromEnv();
        if (!token?.trim()) throw new NotFoundException('Voucher not found');
        const v = await this.voucherRepo.findOne({
            where: { qrToken: token.trim(), tenantId },
        });
        if (!v) throw new NotFoundException('Voucher not found');
        const now = new Date();
        const valid =
            v.status === 'active' && (!v.expiresAt || v.expiresAt >= now);
        const offer = await this.discountRepo.findOne({
            where: { id: v.offerId },
        });
        return {
            valid,
            voucher_id: v.id,
            code: valid ? (offer?.code ?? null) : null,
            title: offer?.name ?? null,
        };
    }
}

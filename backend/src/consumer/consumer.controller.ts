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
    ConflictException,
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
import { CustomerJwtAuthGuard } from '../auth/customer-jwt-auth.guard';
import { OptionalCustomerJwtAuthGuard } from '../auth/optional-customer-jwt-auth.guard';
import { OtpService } from '../otp/otp.service';
import { CartService } from '../cart/cart.service';
import { MailService } from '../mail/mail.service';
import { Branch } from '../entities/branch.entity';
import { Customer } from '../entities/customer.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RegisterDto } from './dto/register.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { MediaStorageService } from '../media/media-storage.service';
import { MAX_UPLOAD_FILE_BYTES } from '../upload/upload.constants';
import { RatingsService } from '../ratings/ratings.service';

type BranchWithBrands = Branch & {
    branchBrands: Array<{ brand: { tenantId: number } }>;
};

@ApiTags('Consumer')
@Controller('public/consumer')
export class ConsumerController {
    private readonly logger = new Logger(ConsumerController.name);

    constructor(
        private brandsService: BrandsService,
        private branchesService: BranchesService,
        private menuService: MenuService,
        private ordersService: OrdersService,
        private loyaltyService: LoyaltyService,
        private customersService: CustomersService,
        private paymentsService: PaymentsService,
        private jwtService: JwtService,
        private otpService: OtpService,
        private cartService: CartService,
        private mailService: MailService,
        private mediaStorage: MediaStorageService,
        private ratingsService: RatingsService,
        @InjectRepository(Branch) private branchRepo: Repository<Branch>,
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
        );
        if (!customer) {
            throw new NotFoundException(
                'Customer not found. Please login or register before using cart.',
            );
        }
        return customer;
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
            const radiusKm =
                (radiusKmParam != null && radiusKmParam !== ''
                    ? +radiusKmParam
                    : 10) || 10;
            return this.branchesService.findAllWithinRadius(lat, lng, radiusKm);
        }
        return this.branchesService.findAll(brandId ? +brandId : undefined);
    }

    /** Customer register: name, email, phone, password, confirm_password (all required). No tenant linkage. */
    @Post('register')
    @ApiOperation({ summary: 'Register a new customer' })
    @ApiBody({
        type: RegisterDto,
        examples: {
            default: {
                summary: 'Register',
                value: {
                    name: 'John Doe',
                    email: 'john@example.com',
                    phone: '03001234567',
                    password: 'secret123',
                    confirm_password: 'secret123',
                },
            },
        },
    })
    async register(@Body() dto: RegisterDto) {
        if (dto.password !== dto.confirm_password) {
            throw new BadRequestException(
                'password and confirm_password do not match',
            );
        }
        const customer = await this.customersService.createForConsumer(null, {
            phone: dto.phone,
            name: dto.name,
            email: dto.email,
            password: dto.password,
        });
        return {
            id: customer.id,
            tenant_id: customer.tenantId ?? null,
            phone: customer.phone,
            name: customer.name,
            email: customer.email ?? null,
            loyalty_points_balance: customer.loyaltyPointsBalance,
        };
    }

    /** One-time tenant linking: called after first branch selection. */
    @Post('customers/sync-tenant')
    @UseGuards(CustomerJwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Link logged-in customer to tenant (one-time) using branch_id',
    })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['branch_id'],
            properties: {
                branch_id: { type: 'number', example: 10 },
                phone: {
                    type: 'string',
                    example: '03001234567',
                    description:
                        'Optional safety check: must match the logged-in customer phone when provided',
                },
            },
        },
    })
    async syncTenant(
        @Req() req: { user: Customer },
        @Body() body: { branch_id: number; phone?: string },
    ) {
        const branchId = Number(body?.branch_id);
        if (!Number.isFinite(branchId) || branchId <= 0) {
            throw new BadRequestException('branch_id is required');
        }
        if (body?.phone?.trim()) {
            const reqPhone = (req.user.phone ?? '').trim();
            if (reqPhone && reqPhone !== body.phone.trim()) {
                throw new BadRequestException(
                    'phone does not match logged-in customer',
                );
            }
        }

        const tenantId = await this.getTenantIdFromBranch(branchId);
        try {
            const updated = await this.customersService.syncTenantForCustomer(
                req.user.id,
                tenantId,
            );
            const token = this.jwtService.sign({
                sub: updated.id,
                type: 'customer',
                tenantId: updated.tenantId,
            });
            return {
                token,
                customer: {
                    id: updated.id,
                    tenant_id: updated.tenantId ?? null,
                    phone: updated.phone,
                    name: updated.name,
                    email: updated.email ?? null,
                    loyalty_points_balance: updated.loyaltyPointsBalance,
                },
            };
        } catch (e) {
            // normalize known conflict into a consistent message
            if (e instanceof ConflictException) throw e;
            throw e;
        }
    }

    /** Customer login (email + password). Returns JWT and customer. */
    @Post('auth/login')
    @ApiOperation({ summary: 'Customer login' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['email', 'password'],
            properties: {
                email: { type: 'string' },
                password: { type: 'string' },
            },
            example: { email: 'john@example.com', password: 'secret123' },
        },
    })
    async customerLogin(@Body() dto: { email: string; password: string }) {
        const email = typeof dto?.email === 'string' ? dto.email.trim() : '';
        const password = typeof dto?.password === 'string' ? dto.password : '';
        if (!email || !password)
            throw new NotFoundException('email and password are required');
        const customer = await this.customersService.validateCustomer(
            email,
            password,
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
     * Consumer: list unique categories across the brands actually present at the branch.
     * Categories of other brands of the same tenant (not linked to this branch) are excluded.
     * Example response item:
     * { key: "milkshakes", name: "Milkshakes", brandCount: 3 }
     */
    @Get('categories/global')
    @ApiOperation({
        summary:
            "List unique categories across the brands present at a branch (consumer app)",
    })
    @ApiQuery({ name: 'branch_id', required: true, example: '1' })
    async getGlobalCategories(@Query('branch_id') branchIdParam: string) {
        const branchId = branchIdParam ? +branchIdParam : undefined;
        if (!branchId) throw new NotFoundException('branch_id is required');
        // Validates the branch exists (throws NotFound otherwise).
        await this.getTenantIdFromBranch(branchId);
        return this.menuService.getConsumerCategoriesForBranch(branchId);
    }

    /**
     * Consumer: for a given category key (e.g. "milkshakes"), list brands that offer it for the branch's tenant.
     */
    @Get('categories/:categoryKey/brands')
    @ApiOperation({
        summary: 'List brands for a given category (consumer app)',
    })
    @ApiParam({
        name: 'categoryKey',
        example: 'milkshakes',
        description: 'Category key from /categories/global (lowercased name)',
    })
    @ApiQuery({ name: 'branch_id', required: true, example: '1' })
    async getBrandsForCategory(
        @Param('categoryKey') categoryKey: string,
        @Query('branch_id') branchIdParam: string,
    ) {
        const branchId = branchIdParam ? +branchIdParam : undefined;
        if (!branchId) throw new NotFoundException('branch_id is required');
        // Validates the branch exists (throws NotFound otherwise).
        await this.getTenantIdFromBranch(branchId);
        const brandIds =
            await this.menuService.getConsumerBrandIdsForCategoryKeyAtBranch(
                branchId,
                categoryKey,
            );
        return this.brandsService.findAllPublicByIds(brandIds);
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
            items: {
                menu_item_id: number;
                quantity: number;
                variant_id?: number;
                addons?: { addon_id: number; quantity?: number }[];
                modifiers?: { modifier_id: number; quantity?: number }[];
                notes?: string;
            }[];
            notes?: string;
            discount_code?: string;
            loyalty_points_to_redeem?: number;
            customer_id?: number;
            latitude?: number;
            longitude?: number;
            branch_latitude?: number;
            branch_longitude?: number;
        },
    ) {
        const tenantId = await this.getTenantIdFromBranch(dto.branch_id);
        const source = this.resolveOrderSourceFromRequest(req);
        return this.ordersService.createOrder(
            dto,
            tenantId,
            null,
            source,
            req.user?.id ?? null,
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

        const loyalty =
            resolvedTenantId != null
                ? await this.loyaltyService.getBalanceByPhone(
                      resolvedTenantId,
                      phone.trim(),
                  )
                : null;
        const loyaltyPointsBalance = loyalty?.balance ?? 0;

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
        description: 'Upserted rider rating row (same shape as GET .../ratings `rider_rating`).',
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
                    description: 'Customer comment if provided; otherwise null.',
                },
                order_item_ids: {
                    type: 'array',
                    items: { type: 'integer' },
                    example: [101, 102],
                },
                created_at: { type: 'string', format: 'date-time', nullable: true },
                updated_at: { type: 'string', format: 'date-time', nullable: true },
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
                    description: 'Customer comment if provided; otherwise null.',
                },
                order_item_ids: {
                    type: 'array',
                    items: { type: 'integer' },
                    example: [101],
                },
                created_at: { type: 'string', format: 'date-time', nullable: true },
                updated_at: { type: 'string', format: 'date-time', nullable: true },
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
                    description: 'Your rider rating for this order, or null if not submitted.',
                    properties: {
                        id: { type: 'integer' },
                        order_id: { type: 'integer' },
                        customer_id: { type: 'integer' },
                        rider_user_id: { type: 'integer' },
                        stars: { type: 'integer', minimum: 1, maximum: 5 },
                        comment: {
                            type: 'string',
                            nullable: true,
                            description: 'Optional text submitted with the rider rating.',
                        },
                        order_item_ids: {
                            type: 'array',
                            items: { type: 'integer' },
                        },
                        created_at: { type: 'string', format: 'date-time', nullable: true },
                        updated_at: { type: 'string', format: 'date-time', nullable: true },
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
                                description: 'Optional text submitted with this brand rating.',
                            },
                            order_item_ids: {
                                type: 'array',
                                items: { type: 'integer' },
                            },
                            created_at: { type: 'string', format: 'date-time', nullable: true },
                            updated_at: { type: 'string', format: 'date-time', nullable: true },
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

    /** Get loyalty balance by phone (branch_id identifies tenant via branch’s brand). */
    @Get('loyalty/balance')
    @ApiOperation({ summary: 'Get loyalty balance' })
    @ApiQuery({ name: 'branch_id', required: true, example: '1' })
    @ApiQuery({ name: 'phone', required: true, example: '03001234567' })
    async getLoyaltyBalance(
        @Query('branch_id') branchIdParam: string,
        @Query('phone') phone: string,
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
        const result = await this.loyaltyService.getBalanceByPhone(
            tenantId,
            phone.trim(),
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
}

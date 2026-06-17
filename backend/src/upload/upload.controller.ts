import {
    Controller,
    Post,
    UseInterceptors,
    UploadedFile,
    Body,
    BadRequestException,
    UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { MediaStorageService } from '../media/media-storage.service';
import { MAX_UPLOAD_FILE_BYTES } from './upload.constants';

@ApiTags('Admin – Upload')
@Controller('admin')
export class UploadController {
    constructor(private readonly mediaStorage: MediaStorageService) {}

    @Post('upload')
    @UseGuards(JwtAuthGuard, RoleAccessGuard)
    @UseInterceptors(
        FileInterceptor('file', {
            limits: { fileSize: MAX_UPLOAD_FILE_BYTES },
        }),
    )
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary' },
                folder: {
                    type: 'string',
                    enum: ['brands', 'menu-items', 'customer-profiles', 'misc', 'banners', 'promotions'],
                },
            },
        },
    })
    async upload(
        @UploadedFile()
        file: {
            originalname?: string;
            mimetype?: string;
            buffer?: Buffer;
        },
        @Body()
        body: { folder?: string },
    ) {
        if (!file || !file.buffer)
            throw new BadRequestException('No file uploaded');
        const allowed = /^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/i.test(
            file.mimetype || '',
        );
        if (!allowed)
            throw new BadRequestException('Only image files are allowed');
        const folder = (body?.folder || 'misc').trim().toLowerCase();
        const allowedFolders = new Set([
            'brands',
            'menu-items',
            'customer-profiles',
            'misc',
            'banners',
            'promotions',
        ]);
        if (!allowedFolders.has(folder)) {
            throw new BadRequestException(
                'Invalid folder. Allowed: brands, menu-items, customer-profiles, misc, banners, promotions',
            );
        }
        const result = await this.mediaStorage.uploadImage(file, folder);
        return {
            url: result.url,
            ...(result.variants ? { variants: result.variants } : {}),
        };
    }
}

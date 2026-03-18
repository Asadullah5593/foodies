import {
    Controller,
    Post,
    Get,
    Param,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
    UseGuards,
    StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { join } from 'path';
import { existsSync, mkdirSync, createReadStream, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';

const UPLOAD_DIR = join(process.cwd(), 'uploads');

function ensureUploadDir() {
    if (!existsSync(UPLOAD_DIR)) {
        mkdirSync(UPLOAD_DIR, { recursive: true });
    }
}

@ApiTags('Admin – Upload')
@Controller('admin')
export class UploadController {
    @Post('upload')
    @UseGuards(JwtAuthGuard, RoleAccessGuard)
    @UseInterceptors(
        FileInterceptor('file', {
            limits: { fileSize: 5 * 1024 * 1024 },
        }),
    )
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: { file: { type: 'string', format: 'binary' } },
        },
    })
    upload(
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
        ensureUploadDir();
        const ext =
            file.originalname && file.originalname.includes('.')
                ? file.originalname
                      .slice(file.originalname.lastIndexOf('.'))
                      .toLowerCase()
                : '.png';
        const safe = ext.match(/^\.(png|jpe?g|gif|webp|svg)$/) ? ext : '.png';
        const filename = randomBytes(8).toString('hex') + safe;
        const path = join(UPLOAD_DIR, filename);
        writeFileSync(path, file.buffer);
        const url = `/api/admin/upload/file/${filename}`;
        return { url };
    }

    /** Public: no auth required so <img src="..."> can load without sending Bearer token */
    @Get('upload/file/:filename')
    serveFile(@Param('filename') filename: string): StreamableFile {
        const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '');
        const path = join(UPLOAD_DIR, safe);
        if (!existsSync(path)) throw new BadRequestException('File not found');
        const ext = safe.includes('.')
            ? safe.slice(safe.lastIndexOf('.')).toLowerCase()
            : '';
        const mime: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
        };
        const stream = createReadStream(path);
        return new StreamableFile(stream, {
            type: mime[ext] || 'application/octet-stream',
        });
    }
}

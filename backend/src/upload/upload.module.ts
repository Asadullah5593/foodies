import { Module } from '@nestjs/common';
import { RoleAccessModule } from '../auth/role-access.module';
import { MediaModule } from '../media/media.module';
import { UploadController } from './upload.controller';

@Module({
    imports: [RoleAccessModule, MediaModule],
    controllers: [UploadController],
})
export class UploadModule {}

import { Module } from '@nestjs/common';
import { RoleAccessModule } from '../auth/role-access.module';
import { UploadController } from './upload.controller';

@Module({
    imports: [RoleAccessModule],
    controllers: [UploadController],
})
export class UploadModule {}

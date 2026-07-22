import { Module } from '@nestjs/common';
import { ImageOptimizeService } from './image-optimize.service';
import { MediaStorageService } from './media-storage.service';
import { MediaCleanupService } from './media-cleanup.service';

@Module({
    providers: [ImageOptimizeService, MediaStorageService, MediaCleanupService],
    exports: [MediaStorageService, MediaCleanupService],
})
export class MediaModule {}

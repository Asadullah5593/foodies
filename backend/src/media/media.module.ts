import { Module } from '@nestjs/common';
import { ImageOptimizeService } from './image-optimize.service';
import { MediaStorageService } from './media-storage.service';

@Module({
    providers: [ImageOptimizeService, MediaStorageService],
    exports: [MediaStorageService],
})
export class MediaModule {}

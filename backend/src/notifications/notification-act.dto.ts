import { IsOptional, IsString } from 'class-validator';

export class ActNotificationDto {
    /** The catalog action key that was performed (e.g. 'accept', 'reject'). */
    @IsOptional()
    @IsString()
    action_key?: string;
}

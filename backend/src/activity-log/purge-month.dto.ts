import { IsString, Matches, MinLength } from 'class-validator';

export class PurgeMonthDto {
    /** The month to archive and drop, e.g. "2026-01". */
    @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
    month: string;

    /**
     * The caller's OWN password, re-entered. Destroying audit history should
     * not be possible from a session someone left open.
     */
    @IsString()
    @MinLength(1)
    password: string;
}

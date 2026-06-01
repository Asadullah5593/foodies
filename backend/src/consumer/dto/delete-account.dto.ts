import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean, IsNotEmpty, IsString } from 'class-validator';

export class DeleteAccountDto {
    @ApiProperty({
        example: 'secret123',
        description: 'Current account password (confirms identity)',
    })
    @IsString()
    @IsNotEmpty()
    password: string;

    @ApiProperty({
        example: true,
        description:
            'Must be true to acknowledge permanent deletion of your account and associated loyalty data',
    })
    @IsBoolean()
    @Equals(true, { message: 'confirm must be true to delete your account' })
    confirm: boolean;
}

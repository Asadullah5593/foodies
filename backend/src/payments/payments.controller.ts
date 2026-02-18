import { Controller } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController {
    constructor(private service: PaymentsService) {}
}

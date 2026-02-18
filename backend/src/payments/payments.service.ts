import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../entities/payment.entity';
import { Order } from '../entities/order.entity';

@Injectable()
export class PaymentsService {
    constructor(
        @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
        @InjectRepository(Order) private orderRepo: Repository<Order>,
    ) {}

    async processPayment(
        orderId: number,
        paymentMethod: string,
        amount: number,
        referenceNumber?: string,
    ) {
        const order = await this.orderRepo.findOne({ where: { id: orderId } });
        if (!order) throw new NotFoundException('Order not found');

        const payment = await this.paymentRepo.save(
            this.paymentRepo.create({
                orderId,
                paymentMethod,
                amount,
                referenceNumber: referenceNumber ?? null,
                status: 'completed',
                processedAt: new Date(),
            }),
        );

        if (amount >= Number(order.totalAmount)) {
            order.status = 'accepted';
            await this.orderRepo.save(order);
        }

        return payment;
    }
}

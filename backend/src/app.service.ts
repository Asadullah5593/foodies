import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
    getInfo() {
        return {
            message: 'Restaurant Management System API',
            version: '1.0.0',
            status: 'operational',
        };
    }

    getTest() {
        return {
            test: 'ok',
            time: new Date().toISOString(),
        };
    }
}

# Login Credentials

## Test Users

All users are part of **Demo Restaurant Group** and have access to **Main Branch (BR001)**.

### 👑 Owner
- **Email**: `owner@demo.com`
- **Password**: `owner123`
- **Permissions**: Full access to all features

### 👔 Manager  
- **Email**: `manager@demo.com`
- **Password**: `manager123`
- **Permissions**: Branch management, menu, orders, reports

### 💰 Cashier
- **Email**: `cashier@demo.com`
- **Password**: `cashier123`
- **Permissions**: POS operations, orders, payments, shifts

### 👨‍🍳 Kitchen
- **Email**: `kitchen@demo.com`
- **Password**: `kitchen123`
- **Permissions**: KOT viewing

## Quick Login Test

1. Start Laravel: `php artisan serve`
2. Start React: `cd frontend && npm run dev`
3. Visit: http://localhost:3000/login
4. Use any credentials above to login

## Password Pattern

All passwords follow: `{role}123`

Example: Owner = `owner123`, Manager = `manager123`

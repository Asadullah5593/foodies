# Rough Foodie - POS System Usage Guide

**Note:** The backend is now **NestJS** (no longer Laravel). API paths and behavior are the same. See [QUICK_START.md](QUICK_START.md) and [START_SERVERS.md](START_SERVERS.md) for setup.

## System Overview

This is a **multi-tenant Point of Sale (POS) system** with a NestJS API and React frontend. The system follows a hierarchical structure:

```
Tenant → Brand → Branch → Users
```

- **Tenant**: Top-level organization (e.g., "Food Group Inc")
- **Brand**: Restaurant brand under a tenant (e.g., "Burger Palace", "Pizza Express")
- **Branch**: Physical location of a brand (e.g., "Downtown Branch", "Mall Branch")
- **Users**: Staff members assigned to branches with specific roles

## Database Setup

The NestJS backend uses TypeORM with SQLite (sql.js). On first run it creates the database and tables automatically.

To seed a demo tenant and user (owner@demo.com / owner123), run once after the backend has started at least once:

```bash
cd backend
npm run seed
```

## System Architecture

### Data Hierarchy
1. **Tenants** - Multi-tenant support for different organizations
2. **Brands** - Restaurant brands belonging to tenants
3. **Branches** - Physical locations of brands
4. **Users** - Staff members with roles and branch assignments
5. **Menu Items** - Products with variants and addons
6. **Orders** - Customer orders with items, variants, addons
7. **Payments** - Payment processing for orders
8. **Shifts** - Staff shift management
9. **KOT (Kitchen Order Tickets)** - Kitchen printing system

## API Endpoints

### Base URL
```
http://localhost/api
```

### Authentication Endpoints

#### 1. Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password"
}
```

**Response:**
```json
{
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "user@example.com",
    "tenant_id": 1
  },
  "token": "1|xxxxxxxxxxxxx"
}
```

#### 2. Get Current User
```http
GET /api/auth/user
Authorization: Bearer {token}
```

#### 3. Logout
```http
POST /api/auth/logout
Authorization: Bearer {token}
```

### POS Endpoints (Protected - Requires Authentication)

#### 1. Get Menu for Branch
```http
GET /api/pos/menu?branch_id=1
Authorization: Bearer {token}
```

**Response:**
```json
{
  "categories": [...],
  "items": [...],
  "variants": [...],
  "addons": [...]
}
```

#### 2. Create Order
```http
POST /api/pos/orders
Authorization: Bearer {token}
Content-Type: application/json

{
  "branch_id": 1,
  "order_type": "dine_in",
  "table_number": "5",
  "customer_name": "John Doe",
  "customer_phone": "+1234567890",
  "items": [
    {
      "menu_item_id": 1,
      "quantity": 2,
      "variant_id": 1,
      "addons": [1, 2]
    }
  ],
  "notes": "No onions"
}
```

**Order Types:**
- `dine_in` - Customer dining in
- `takeaway` - Takeaway order
- `pickup` - Pickup order

#### 3. Get Order
```http
GET /api/pos/orders/{id}
Authorization: Bearer {token}
```

#### 4. Pay for Order
```http
POST /api/pos/orders/{id}/pay
Authorization: Bearer {token}
Content-Type: application/json

{
  "payment_method": "cash",
  "amount": 25.50,
  "notes": "Paid in full"
}
```

## Setting Up Test Data

### Option 1: Using Tinker (Recommended for Quick Setup)

```bash
php artisan tinker
```

Then run:

```php
// Create a Tenant
$tenant = \App\Models\Tenant::create([
    'name' => 'Food Group Inc',
    'slug' => 'food-group',
    'status' => 'active'
]);

// Create a Brand
$brand = \App\Models\Brand::create([
    'tenant_id' => $tenant->id,
    'name' => 'Burger Palace',
    'slug' => 'burger-palace',
    'status' => 'active'
]);

// Create a Branch
$branch = \App\Models\Branch::create([
    'brand_id' => $brand->id,
    'name' => 'Downtown Branch',
    'code' => 'DT001',
    'address' => '123 Main St',
    'phone' => '+1234567890',
    'email' => 'downtown@burgerpalace.com',
    'status' => 'active'
]);

// Create a User
$user = \App\Models\User::create([
    'name' => 'John Doe',
    'email' => 'john@example.com',
    'password' => bcrypt('password'),
    'tenant_id' => $tenant->id,
    'status' => 'active'
]);

// Assign user to branch
$user->branches()->attach($branch->id);

// Assign role
$user->assignRole('cashier');
```

### Option 2: Create a Seeder

You can create a seeder file to automate this process:

```bash
php artisan make:seeder TestDataSeeder
```

## Testing the System

### 1. Start the Development Server
```bash
php artisan serve
```

The API will be available at: `http://localhost:8000/api`

### 2. Test Authentication

Using cURL:
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"password"}'
```

Using Postman/Insomnia:
- Method: POST
- URL: `http://localhost:8000/api/auth/login`
- Body (JSON):
  ```json
  {
    "email": "john@example.com",
    "password": "password"
  }
  ```

### 3. Test POS Endpoints

After getting the token from login:

```bash
# Get menu
curl -X GET http://localhost:8000/api/pos/menu?branch_id=1 \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Create order
curl -X POST http://localhost:8000/api/pos/orders \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "branch_id": 1,
    "order_type": "dine_in",
    "table_number": "5",
    "items": [
      {
        "menu_item_id": 1,
        "quantity": 2
      }
    ]
  }'
```

## Key Features

1. **Multi-Tenancy**: Support for multiple organizations
2. **Role-Based Access Control**: Using Spatie Permissions
3. **Branch Management**: Multiple locations per brand
4. **Menu Management**: Items with variants and addons
5. **Order Processing**: Full order lifecycle management
6. **Payment Processing**: Multiple payment methods
7. **Kitchen Integration**: KOT (Kitchen Order Tickets) system
8. **Shift Management**: Staff shift tracking
9. **Tenant Scoping**: Automatic data isolation per tenant

## Environment Configuration

Make sure your `.env` file is properly configured:

```env
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=foodies
DB_USERNAME=postgres
DB_PASSWORD=test123

APP_URL=http://localhost
SANCTUM_STATEFUL_DOMAINS=localhost:3000,localhost:5173
```

## Frontend

**This is an API-only backend.** There is no custom frontend included in this project. 

### What You'll See

When you visit `http://127.0.0.1:8000/`, you'll see the default Laravel welcome page. This is just a placeholder.

### How to Use This System

You have three options:

1. **Use API Testing Tools** (Recommended for testing):
   - Use **Postman** or **Insomnia** to test API endpoints
   - Use **cURL** from command line
   - Use **Thunder Client** (VS Code extension)

2. **Build a Separate Frontend**:
   - Create a React, Vue, or Next.js application
   - Point it to `http://localhost:8000/api`
   - The frontend will consume these REST APIs

3. **Create a Simple Frontend in Laravel**:
   - You can build Blade templates or use Inertia.js
   - This would be a separate development task

### Testing the API

Since there's no frontend, you'll need to test the API directly. See the "Testing the System" section below for examples.

## Next Steps

1. **Create Test Data**: Use Tinker or create seeders to populate initial data
2. **Test API Endpoints**: Use Postman/Insomnia to test the API endpoints
3. **Set Up Frontend** (Optional): Build a separate frontend application (React/Vue) to consume these APIs
4. **Configure Permissions**: Adjust roles and permissions as needed
5. **Add Menu Items**: Create menu categories, items, variants, and addons
6. **Test Order Flow**: Create orders, process payments, test kitchen integration

## Troubleshooting

### Migration Issues
If you encounter migration errors:
```bash
php artisan migrate:fresh
php artisan db:seed
```

### Permission Issues
If roles/permissions aren't working:
```bash
php artisan permission:cache-reset
php artisan db:seed --class=PermissionSeeder
php artisan db:seed --class=RoleSeeder
```

### Token Issues
If authentication fails:
- Check `SANCTUM_STATEFUL_DOMAINS` in `.env`
- Ensure `APP_KEY` is set: `php artisan key:generate`
- Clear config cache: `php artisan config:clear`

## Support

For issues or questions, check:
- Laravel Documentation: https://laravel.com/docs
- Spatie Permissions: https://spatie.be/docs/laravel-permission
- Laravel Sanctum: https://laravel.com/docs/sanctum

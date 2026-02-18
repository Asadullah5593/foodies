# Restaurant Management System - Setup Guide

## Backend Setup (Laravel)

1. **Install Dependencies**
```bash
composer install
```

2. **Configure Environment**
- Copy `.env.example` to `.env` if not exists
- Update database credentials in `.env`:
```
DB_CONNECTION=pgsql
DB_DATABASE=foodies
DB_USERNAME=postgres
DB_PASSWORD=test123
```

3. **Generate Application Key**
```bash
php artisan key:generate
```

4. **Run Migrations**
```bash
php artisan migrate
```

5. **Seed Permissions and Roles**
```bash
php artisan db:seed
```

6. **Start Laravel Server**
```bash
php artisan serve
```
Backend will run on http://localhost:8000

## Frontend Setup (React)

1. **Navigate to Frontend Directory**
```bash
cd frontend
```

2. **Install Dependencies**
```bash
npm install
```

3. **Start Development Server**
```bash
npm run dev
```
Frontend will run on http://localhost:3000

## API Testing

Test the API endpoint:
```bash
curl http://localhost:8000/api/
```

You should see:
```json
{
  "message": "Restaurant Management System API",
  "version": "1.0.0",
  "status": "operational"
}
```

## Troubleshooting

### API Returns 404
- Ensure Laravel server is running: `php artisan serve`
- Check routes: `php artisan route:list --path=api`
- Verify API routes are in `routes/api.php`

### CORS Issues
- Check `config/cors.php` allows your frontend origin
- Ensure `supports_credentials` is set to `true` if using cookies

### Database Connection Issues
- Verify PostgreSQL is running
- Check database credentials in `.env`
- Ensure database "foodies" exists

## Default Routes

- **Backend API**: http://localhost:8000/api
- **Frontend**: http://localhost:3000
- **Admin Login**: http://localhost:3000/login
- **Admin Dashboard**: http://localhost:3000/admin/dashboard
- **POS Orders**: http://localhost:3000/pos/orders

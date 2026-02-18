# Testing Guide

## User Credentials

### Owner (Full Access)
- Email: `owner@demo.com`
- Password: `owner123`

### Manager
- Email: `manager@demo.com`
- Password: `manager123`

### Cashier
- Email: `cashier@demo.com`
- Password: `cashier123`

### Kitchen
- Email: `kitchen@demo.com`
- Password: `kitchen123`

## Testing Steps

1. **Start Backend**
   ```bash
   php artisan serve
   ```

2. **Start Frontend**
   ```bash
   cd frontend
   npm run dev
   ```

3. **Login**
   - Go to http://localhost:3000/login
   - Use any of the credentials above
   - You should be redirected to the dashboard

4. **Test API Directly**
   ```bash
   # Login
   curl -X POST http://localhost:8000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"owner@demo.com","password":"owner123"}'
   
   # Save the token from response, then:
   curl http://localhost:8000/api/auth/user \
     -H "Authorization: Bearer YOUR_TOKEN_HERE"
   ```

## Troubleshooting

### CSRF Token Mismatch (419)
- Fixed: Removed stateful middleware, using token-based auth
- If still occurs, clear cache: `php artisan config:clear`

### Login Fails
- Check user exists: `php artisan tinker` then `User::where('email', 'owner@demo.com')->first()`
- Verify password: Should be hashed with bcrypt
- Check user status: Must be 'active'

### React Router Warnings
- Fixed: Added future flags in BrowserRouter
- Warnings should no longer appear

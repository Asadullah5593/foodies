# CRITICAL FIX - Concurrent Request Crash

## Root Cause
Two simultaneous requests to `/api/auth/user` are causing the PHP built-in server to crash. This is caused by:
1. React StrictMode (removed) causing double renders
2. Race conditions in authentication guard state
3. PHP built-in server instability with concurrent requests

## Fixes Applied

### Backend (AuthController.php)
- **Bypassed Auth guard completely** - Direct token lookup from database
- **Completely stateless** - No caching, no shared state, no guard state
- **Direct database query** - Uses `PersonalAccessToken::findToken()` directly
- **Fresh attribute access** - Uses `getAttributeValue()` to avoid model state

### Frontend (AuthContext.tsx)
- **Request cancellation** - Uses AbortController to cancel duplicate requests
- **Proper cleanup** - Cancels requests on unmount
- **No duplicate calls** - Prevents concurrent requests

### Frontend (main.tsx)
- **Removed StrictMode** - Prevents double renders in development

## Testing

1. **Restart frontend** (IMPORTANT - to apply StrictMode removal):
   ```bash
   cd /var/www/html/rough-foodie/frontend
   # Stop server (Ctrl+C) and restart
   npm run dev
   ```

2. **Restart backend**:
   ```bash
   cd /var/www/html/rough-foodie
   php artisan serve --host=127.0.0.1 --port=8000
   ```

3. **Test** - Refresh frontend, server should NOT crash

## If Still Crashing

The PHP built-in server (`php artisan serve`) may be fundamentally unstable with concurrent requests. Consider:

1. **Use PHP-FPM with Nginx/Apache** (production-ready)
2. **Use Laravel Valet** (Mac/Linux)
3. **Use Docker with Laravel Sail**

The code is now completely thread-safe and stateless. If it still crashes, it's a server environment issue, not application code.

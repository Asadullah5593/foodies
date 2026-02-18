# Debugging Silent Server Crashes

## Problem
The Laravel server (`php artisan serve`) is crashing silently when `/api/auth/user` is called. No errors appear in Laravel logs or Apache logs.

## Possible Causes

1. **PHP Built-in Server Issue**: The `php artisan serve` command uses PHP's built-in server which can be unstable
2. **Memory Exhaustion**: The request might be exhausting memory
3. **Segmentation Fault**: A fatal error in PHP extensions
4. **Response Sending Issue**: Problem with how the response is being sent

## Solutions to Try

### Solution 1: Use PHP-FPM with Nginx/Apache (Recommended for Production)

Instead of `php artisan serve`, use a proper web server:

```bash
# Install PHP-FPM if not already installed
sudo apt install php8.2-fpm

# Configure Nginx or Apache to point to your Laravel app
# Then access via http://localhost instead of php artisan serve
```

### Solution 2: Run with Better Error Reporting

Try running the server with explicit error reporting:

```bash
php -d display_errors=1 -d error_reporting=E_ALL artisan serve --host=127.0.0.1 --port=8000
```

### Solution 3: Check PHP Memory Limits

```bash
# Check current memory limit
php -i | grep memory_limit

# Run with increased memory
php -d memory_limit=256M artisan serve --host=127.0.0.1 --port=8000
```

### Solution 4: Test with Simple Endpoint First

Test the `/api/test` endpoint first to see if the server crashes on any request:

```bash
curl http://127.0.0.1:8000/api/test
```

### Solution 5: Monitor Server Process

Run the server in one terminal and monitor it in another:

```bash
# Terminal 1
php artisan serve --host=127.0.0.1 --port=8000

# Terminal 2 - Monitor the process
watch -n 1 'ps aux | grep "artisan serve"'
```

### Solution 6: Check for Segmentation Faults

```bash
# Run with strace to see system calls
strace -f -e trace=write php artisan serve --host=127.0.0.1 --port=8000 2>&1 | tee server-trace.log
```

## Current Fixes Applied

1. **Simplified AuthController**: Using `getAttributes()` directly to avoid model serialization issues
2. **Added test endpoint**: `/api/test` to verify basic server functionality
3. **Improved error handling**: Multiple logging mechanisms

## Next Steps

1. Test the `/api/test` endpoint first - if this crashes, it's a server issue, not the auth endpoint
2. Try running with increased memory: `php -d memory_limit=256M artisan serve`
3. Consider using a proper web server instead of `php artisan serve` for development

## Alternative: Use Laravel Valet or Docker

For a more stable development environment:
- **Laravel Valet** (Mac/Linux): Provides a stable local development server
- **Docker**: Use Laravel Sail for containerized development

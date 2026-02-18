# Troubleshooting ERR_CONNECTION_REFUSED

## Problem
Frontend can't connect to backend - getting `ERR_CONNECTION_REFUSED` even though both servers appear to be running.

## Root Cause
The Laravel backend server is **not actually running** or **not binding correctly** to port 8000.

## Solution

### Step 1: Verify Backend is NOT Running
Check if port 8000 is listening:
```bash
ss -tuln | grep 8000
# OR
lsof -i :8000
```

If you see no output, the server is **not running**.

### Step 2: Start Laravel Backend Correctly

**In Terminal 1** (Backend):
```bash
cd /var/www/html/rough-foodie
php artisan serve --host=127.0.0.1 --port=8000
```

**Expected output:**
```
INFO  Server running on [http://127.0.0.1:8000].
```

**IMPORTANT:** 
- Keep this terminal open and running
- Don't close it or press Ctrl+C
- If you see any errors, read them carefully

### Step 3: Verify Backend is Running

**In a NEW terminal**, test the connection:
```bash
curl http://127.0.0.1:8000/api/
```

**Expected response:**
```json
{
  "message": "Restaurant Management System API",
  "version": "1.0.0",
  "status": "operational"
}
```

If you get `Connection refused`, the server is still not running.

### Step 4: Start Frontend

**In Terminal 2** (Frontend):
```bash
cd /var/www/html/rough-foodie/frontend
npm run dev
```

**Expected output:**
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

### Step 5: Verify Both Servers

Check both ports are listening:
```bash
ss -tuln | grep -E ':(3000|8000)'
```

You should see:
```
tcp   LISTEN  0  128  127.0.0.1:8000  *:*
tcp   LISTEN  0  128  127.0.0.1:3000  *:*
```

## Common Issues

### Issue 1: Port Already in Use
**Error:** `Address already in use`

**Solution:**
```bash
# Find what's using port 8000
lsof -i :8000
# OR
ss -tuln | grep 8000

# Kill the process (replace PID with actual process ID)
kill -9 <PID>

# Or use a different port
php artisan serve --host=127.0.0.1 --port=8001
```

### Issue 2: Permission Denied
**Error:** `Permission denied`

**Solution:**
```bash
# Check file permissions
ls -la /var/www/html/rough-foodie

# If needed, fix ownership
sudo chown -R $USER:$USER /var/www/html/rough-foodie
```

### Issue 3: PHP Not Found
**Error:** `php: command not found`

**Solution:**
```bash
# Check PHP installation
which php
php --version

# If not installed, install PHP
sudo apt update
sudo apt install php php-cli php-fpm php-mysql php-pgsql php-mbstring php-xml php-curl
```

### Issue 4: Database Connection Error
**Error:** Database connection fails when starting server

**Solution:**
1. Check PostgreSQL is running:
   ```bash
   sudo systemctl status postgresql
   ```

2. Verify `.env` has correct database credentials:
   ```bash
   cat /var/www/html/rough-foodie/.env | grep DB_
   ```

3. Test database connection:
   ```bash
   cd /var/www/html/rough-foodie
   php artisan tinker
   # Then in tinker: DB::connection()->getPdo();
   ```

### Issue 5: Server Starts But Immediately Stops
**Error:** Server starts then exits

**Solution:**
1. Check Laravel logs:
   ```bash
   tail -f /var/www/html/rough-foodie/storage/logs/laravel.log
   ```

2. Clear cache and config:
   ```bash
   php artisan config:clear
   php artisan cache:clear
   php artisan route:clear
   ```

3. Check for syntax errors:
   ```bash
   php artisan route:list
   ```

## Verification Checklist

Before reporting issues, verify:

- [ ] Backend terminal shows: `Server running on [http://127.0.0.1:8000]`
- [ ] `curl http://127.0.0.1:8000/api/` returns JSON response
- [ ] `ss -tuln | grep 8000` shows port 8000 listening
- [ ] Frontend terminal shows: `Local: http://localhost:3000/`
- [ ] `ss -tuln | grep 3000` shows port 3000 listening
- [ ] Browser console shows API calls (not connection errors)
- [ ] CORS is configured in `config/cors.php`

## Quick Test Script

Run this to verify everything:
```bash
#!/bin/bash
echo "Checking backend..."
if curl -s http://127.0.0.1:8000/api/ > /dev/null; then
    echo "✅ Backend is running"
else
    echo "❌ Backend is NOT running"
    echo "Start it with: cd /var/www/html/rough-foodie && php artisan serve --host=127.0.0.1 --port=8000"
fi

echo "Checking frontend..."
if curl -s http://127.0.0.1:3000 > /dev/null; then
    echo "✅ Frontend is running"
else
    echo "❌ Frontend is NOT running"
    echo "Start it with: cd /var/www/html/rough-foodie/frontend && npm run dev"
fi

echo "Checking ports..."
ss -tuln | grep -E ':(3000|8000)' && echo "✅ Ports are listening" || echo "❌ Ports not listening"
```

## Still Not Working?

1. **Check Laravel logs:**
   ```bash
   tail -50 /var/www/html/rough-foodie/storage/logs/laravel.log
   ```

2. **Check browser console** for specific error messages

3. **Verify environment variables:**
   ```bash
   cat /var/www/html/rough-foodie/frontend/.env
   ```

4. **Test with explicit host binding:**
   ```bash
   php artisan serve --host=127.0.0.1 --port=8000
   ```

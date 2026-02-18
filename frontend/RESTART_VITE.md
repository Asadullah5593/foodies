# Important: Restart Vite Dev Server

After changing `.env` file, you **MUST** restart the Vite dev server for changes to take effect.

## Steps:

1. **Stop the current Vite server** (Press `Ctrl+C` in the terminal running `npm run dev`)

2. **Restart it**:
   ```bash
   cd /var/www/html/rough-foodie/frontend
   npm run dev
   ```

## What Changed:

- Fixed double slash in API URL (`//api` → `/api`)
- Updated API URL to use `127.0.0.1:3001` to match NestJS backend
- Environment variable is now properly configured

## Verify:

After restarting, check the browser console - you should see API calls going to `http://127.0.0.1:3001/api/...`.

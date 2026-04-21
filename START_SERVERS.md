# How to Start the Application

## Start Servers

### Option 1: From project root (admin frontend + backend)

```bash
npm run dev
```

### Option 1B: From project root (consumer web + backend)

```bash
npm run dev:consumer
```

### Option 1C: From project root (all three apps)

```bash
npm run dev:all
```

### Option 2: Separate terminals

**Terminal 1 – NestJS Backend**
```bash
cd backend
npm run start:dev
```
Backend runs on: http://127.0.0.1:3001 (API at http://127.0.0.1:3001/api)

**Terminal 2 – Admin React Frontend**
```bash
cd frontend
npm run dev
```
Frontend runs on: http://localhost:3000

**Terminal 3 – Consumer Web (Next.js)**
```bash
cd consumer-web
npm run dev
```
Consumer web runs on: http://localhost:3002

## First-time setup: PostgreSQL and seed demo user

1. Ensure PostgreSQL is running. Create a database (e.g. `createdb foodies`) and set `DB_*` in `backend/.env`.
2. Start the backend once so TypeORM creates the tables.
3. In another terminal, from the `backend` folder, run:
   ```bash
   cd backend
   npm run seed
   ```
4. This creates a tenant and user: **owner@demo.com** / **owner123**

## Test connection

```bash
curl http://localhost:3001/api/
```

Expected response:
```json
{
  "message": "Restaurant Management System API",
  "version": "1.0.0",
  "status": "operational"
}
```

## Login credentials (after seed)

- **Owner**: owner@demo.com / owner123

(You can create more users via the Admin → Users page after logging in.)

## Troubleshooting

### ERR_CONNECTION_REFUSED
- Ensure the NestJS backend is running: `cd backend && npm run start:dev`
- Test: `curl http://127.0.0.1:3001/api/`
- Frontend expects the API at `http://127.0.0.1:3001/api` by default (set `VITE_API_URL` in frontend if your backend uses another URL/port).
- Consumer web expects the API at `http://127.0.0.1:3001/api` by default (set `NEXT_PUBLIC_API_BASE_URL` in `consumer-web/.env.local` if needed).

### EADDRINUSE on backend port 3001
- This means another backend process is already running.
- Find and stop it:
  ```bash
  lsof -i :3001
  kill -9 <PID>
  ```
- Then restart backend once: `cd backend && npm run start:dev`

### Token / refresh
- The auth token is stored in `localStorage` and persists across refreshes.

### Admin pages
- Use the top navigation or go to:
  - http://localhost:3000/admin/tenants
- http://localhost:3000/admin/brands
- http://localhost:3000/admin/branches
- http://localhost:3000/admin/users

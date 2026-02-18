# Quick Start Guide

## Prerequisites

- Node.js 18+
- npm

## Install

```bash
npm run install:all
```

## Start Backend (NestJS)

```bash
cd backend
npm run start:dev
```

Backend runs on: http://localhost:3001 (API at http://localhost:3001/api)

## Start Frontend (React)

```bash
cd frontend
npm install   # First time only
npm run dev
```

Frontend runs on: http://localhost:3000

## Start Both

From project root:

```bash
npm run dev
```

## Test API

```bash
curl http://localhost:3001/api/

# Expected response:
# {
#   "message": "Restaurant Management System API",
#   "version": "1.0.0",
#   "status": "operational"
# }
```

## First-Time Setup

1. **PostgreSQL**: Ensure PostgreSQL is running and create a database (e.g. `foodies`). Set `DB_*` in `backend/.env`.
2. Start the backend once so TypeORM runs migrations and creates tables.
3. Run `cd backend && npm run seed` to create demo tenant and user **owner@demo.com** / **owner123**.

## Migrations (NestJS / TypeORM)

- Migrations run automatically when the backend starts (`migrationsRun: true`). Schema is managed by migrations only (`synchronize: false`).
- **CLI** (from `backend/`):
  - `npm run migration:run` — build and run pending migrations
  - `npm run migration:revert` — revert the last migration
  - `npm run migration:show` — list migration status

## If You See Database Schema Errors

If the backend fails with errors like **"column brandId of relation menu_categories contains null values"** (or similar), the database schema is out of sync. Use a clean database:

1. **Option A – Drop and recreate the database**
   ```bash
   # In psql or your DB tool:
   DROP DATABASE foodies;
   CREATE DATABASE foodies;
   ```
   Then start the backend again; the initial migration will create all tables.

2. **Option B – Revert and re-run migrations**
   ```bash
   cd backend
   npm run migration:revert   # repeat until no migrations left, if needed)
   npm run start:dev        # runs migrations on startup
   ```
   If the DB had tables from an old setup (e.g. Laravel), Option A is more reliable.

## Access Application

- **Frontend**: http://localhost:3000
- **Login Page**: http://localhost:3000/login
- **API Root**: http://localhost:3001/api/

## Environment

- Copy `backend/.env.example` to `backend/.env`. Set `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` for PostgreSQL; `PORT=3001` for backend.
- Frontend uses `VITE_API_URL` (default `http://127.0.0.1:3001/api`) to talk to the backend.

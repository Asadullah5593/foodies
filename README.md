# Restaurant Management System MVP

Multi-tenant restaurant management with **NestJS** backend and **React** frontend.

## Features

- Multi-tenant (Tenant → Brands → Branches)
- Admin panel: tenants, brands, branches, users, menu (categories, items, addons, variants), branch menu, discounts, shifts, orders, reports
- POS: branch menu, create orders, payments
- JWT authentication

## Tech stack

### Backend
- NestJS 11
- TypeORM (PostgreSQL)
- JWT (Passport)
- bcrypt, class-validator

### Frontend
- React 18 + TypeScript
- Vite
- React Router
- TanStack Query
- Axios

## Quick start

### Prerequisites
- Node.js 18+
- npm

### Install

```bash
npm run install:all
```

### Run

```bash
# Start backend + frontend
npm run dev
```

- Backend: http://localhost:3001 (API: http://localhost:3001/api)
- Frontend: http://localhost:3000

### Prerequisites
- PostgreSQL running; create a database (e.g. `foodies`) and set `DB_*` in `backend/.env`.

### Seed demo user

After the backend has run once (so tables exist):

```bash
cd backend
npm run seed
```

Then log in with **owner@demo.com** / **owner123**.

## Project layout

- `backend/` – NestJS API (auth, tenants, brands, branches, users, menu, orders, payments, discounts, shifts, reports)
- `frontend/` – React SPA (admin + POS)

## Environment

- **Backend**: copy `backend/.env.example` to `backend/.env`. Set PostgreSQL: `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`. Backend port: `PORT=3001`.
- **Frontend**: optional `VITE_API_URL` (default `http://127.0.0.1:3001/api`).

## Docs

- [QUICK_START.md](QUICK_START.md) – install and run
- [START_SERVERS.md](START_SERVERS.md) – how to start backend/frontend and seed
- [USAGE_GUIDE.md](USAGE_GUIDE.md) – usage and flows

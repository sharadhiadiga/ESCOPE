# ReachInbox - Full-Stack Email Scheduling & Sending System

A production-quality email scheduling system inspired by ReachInbox.

## Tech Stack
- **Backend:** Node.js, Express.js, TypeScript, PostgreSQL, BullMQ, Redis, Nodemailer (Ethereal), Elasticsearch, Google OAuth, Slack OAuth
- **Frontend:** React, TypeScript, Vite, Tailwind CSS
- **Infrastructure:** Docker & Docker Compose for PostgreSQL, Redis, and Elasticsearch

## Folder Structure
```
ESCOPE/
├── backend/            # Express API & BullMQ Worker
│   ├── src/
│   │   ├── config/     # Environment & App Config
│   │   ├── controllers/# Route Controllers
│   │   ├── db/         # Database Connections & Migrations
│   │   ├── integrations/# OAuth & External APIs (Slack/Google/Ethereal)
│   │   ├── middleware/ # Express Middleware
│   │   ├── models/     # Data Models / Queries
│   │   ├── queues/     # BullMQ Queue definitions
│   │   ├── routes/     # Express API Routes
│   │   ├── services/   # Business Logic
│   │   ├── types/      # TypeScript Types
│   │   ├── utils/      # Helpers & Utilities
│   │   ├── workers/    # BullMQ Worker Handlers
│   │   ├── app.ts      # Express App Setup
│   │   ├── server.ts   # Express Server Entrypoint
│   │   └── worker.ts   # BullMQ Worker Entrypoint
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
├── frontend/           # Vite React App
│   ├── src/
│   │   ├── api/        # Axios/Fetch API Clients
│   │   ├── components/ # Reusable UI Components
│   │   ├── context/    # React Contexts
│   │   ├── hooks/      # Custom React Hooks
│   │   ├── layouts/    # Page Layout Components
│   │   ├── pages/      # Page Views
│   │   ├── services/   # Frontend Services
│   │   ├── types/      # TypeScript Types
│   │   ├── utils/      # UI Helpers & Utilities
│   │   ├── App.tsx     # Root App Shell
│   │   ├── main.tsx    # React Entrypoint
│   │   └── index.css   # Tailwind & Global Styles
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   ├── vite.config.ts
│   └── tsconfig.json
├── docker-compose.yml  # Local services (PostgreSQL, Redis, Elasticsearch)
├── README.md
└── .gitignore
```

## Setup & Running Instructions

### 1. Start Infrastructure (Docker Compose)
```bash
docker-compose up -d
```
This spins up:
- **PostgreSQL:** `localhost:5432`
- **Redis:** `localhost:6379`
- **Elasticsearch:** `localhost:9200`

### 2. Backend Setup & Run
```bash
cd backend
npm install
npm run dev
```
Express server runs on `http://localhost:5000`
Health check: `http://localhost:5000/health`

To start the BullMQ worker:
```bash
cd backend
npm run worker
```

### 3. Frontend Setup & Run
```bash
cd frontend
npm install
npm run dev
```
Vite dev server runs on `http://localhost:5173` with reverse proxy to `http://localhost:5000`.

## Phase 2 — Database Architecture & Persistence

### 1. Database & ORM Stack
- **Database Engine:** PostgreSQL (running on `localhost:5432`)
- **ORM & Migration Tool:** Prisma ORM (`@prisma/client` & `prisma` CLI v5.22.0)
- **Environment Variable:** `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/reachinbox`

### 2. Schema Overview
The relational schema models five core entities connected via strict foreign key relationships and cascade deletion rules:

- **`User` (`users`):** Tenant entity identified by UUID and unique email. Supports future Google OAuth (`googleId`).
- **`EmailAccount` (`email_accounts`):** Sender SMTP configurations linked to a User (`User 1:N EmailAccounts`). Credentials excluded from standard API queries.
- **`Campaign` (`campaigns`):** Parent campaign/schedule configuration holding email subject, body, launch `startAt`, `delayBetweenEmailsMs`, `hourlyLimit`, and status (`DRAFT`, `SCHEDULED`, `PROCESSING`, `COMPLETED`, `CANCELLED`, `FAILED`).
- **`ScheduledEmail` (`scheduled_emails`):** Individual scheduled emails attached to a campaign (`Campaign 1:N ScheduledEmails`). Includes unique `idempotencyKey`, `scheduledAt`, `sentAt`, `status`, `attemptCount`, and `queueJobId`.
- **`DeliveryLog` (`delivery_logs`):** Granular delivery audit log for every execution event (`ScheduledEmail 1:N DeliveryLogs`).

### 3. Database Indexes & Constraints
- **Unique Constraints:** `users.email`, `users.googleId`, `scheduled_emails.idempotencyKey`
- **Indexes:** 
  - `users`: `email`
  - `email_accounts`: `userId`, `email`
  - `campaigns`: `userId`, `status`, `startAt`
  - `scheduled_emails`: `campaignId`, `recipientEmail`, `scheduledAt`, `status`, `sentAt`, `queueJobId`, `idempotencyKey`
  - `delivery_logs`: `scheduledEmailId`, `eventType`, `createdAt`

### 4. Running Migrations & Generating ORM Client
To run migrations and apply schema changes:
```bash
cd backend
npm run prisma:migrate
```

To regenerate the Prisma Client:
```bash
cd backend
npm run prisma:generate
```

### 5. Verifying Database Connectivity & Tests
Run the comprehensive database integration test suite (connection, CRUD, unique constraints, relationships, and status updates):
```bash
cd backend
npm test
```

Verify live backend health with database status:
```bash
curl http://localhost:5000/health
```
Expected output:
```json
{
  "status": "ok",
  "timestamp": "2026-09-26T19:39:03.418Z",
  "uptime": 26.3,
  "service": "reachinbox-backend",
  "env": "development",
  "db": "connected"
}
```

## Phase 3 — Real Google OAuth Authentication

### 1. Google Cloud Console Configuration
To enable real Google OAuth login locally or in production:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) -> APIs & Services -> Credentials.
2. Create an **OAuth 2.0 Client ID** (Web application).
3. Set **Authorized JavaScript Origins**:
   - `http://localhost:5173`
   - `http://localhost:5000`
4. Set **Authorized Redirect URIs**:
   - `http://localhost:5000/auth/google/callback`
   - `http://localhost:5000/api/auth/google/callback`
5. Copy the generated Client ID and Client Secret into `backend/.env`:
   ```env
   GOOGLE_CLIENT_ID=your_actual_google_client_id
   GOOGLE_CLIENT_SECRET=your_actual_google_client_secret
   GOOGLE_CALLBACK_URL=http://localhost:5000/auth/google/callback
   SESSION_SECRET=a_random_secure_session_secret_string
   FRONTEND_URL=http://localhost:5173
   ```

### 2. OAuth Authentication Flow
- **Initiate Login:** Frontend navigates user to `http://localhost:5000/auth/google`.
- **Scopes Requested:** `openid`, `email`, `profile`.
- **Callback Handling:** Passport receives profile, extracts `googleId`, `email`, `name`, and `avatarUrl`.
- **User Record Resolution:**
  1. Searches PostgreSQL `users` table for `googleId`.
  2. If not found, searches by `email`. If user exists, links `googleId`.
  3. If user doesn't exist, creates a new `User` record.
- **Session Cookie:** Sets HTTP-only `connect.sid` cookie (`maxAge: 24h`, `sameSite: lax`).
- **Redirect:** Redirects user to `http://localhost:5173/dashboard`.

### 3. API Endpoints
- `GET /auth/google` — Triggers Google OAuth 2.0 redirect.
- `GET /auth/google/callback` — Handles Google OAuth callback and session creation.
- `GET /auth/me` — Returns authenticated user profile (`401` if unauthenticated).
- `POST /auth/logout` — Destroys express session and clears cookie (`connect.sid`).

### 4. Running Integration & Auth Tests
```bash
cd backend
npm test
```
Runs `tests/db.test.ts`, `tests/auth.test.ts`, and `tests/scheduling.test.ts` covering 19 automated verification suites.

## Phase 4 — Email Scheduling & BullMQ Engine Architecture

### 1. Architecture Overview
The email scheduling engine decoupled API request handling from job execution using PostgreSQL persistence and Redis-backed BullMQ delayed queues:

```
[ Frontend / API ] ──(Auth & Validate)──> [ PostgreSQL ] ──(QUEUED Record)
                                              │
                                  (Enqueue Delayed Job)
                                              │
                                              ▼
                                    [ Redis / BullMQ ] ──(email-scheduling)
                                              │
                                    (Delayed Trigger)
                                              │
                                              ▼
                                    [ Standalone Worker ] ──(State & Log)──> [ PostgreSQL ]
                                              │
                                      (Mock Delivery)
                                              ▼
                                    [ Email Provider ]
```

### 2. BullMQ Queue & Worker Architecture
- **Queue Name:** `email-scheduling`
- **Redis Connection:** Configured via `REDIS_URL` (`redis://localhost:6379`) with `maxRetriesPerRequest: null`.
- **Worker Process:** Separate standalone process (`npm run worker`) with configurable concurrency (`WORKER_CONCURRENCY=5`).
- **Delayed Execution:** Delay calculated as `delay = Math.max(0, new Date(scheduledAt).getTime() - Date.now())`. No Node.js memory timers or cron loops are used.
- **Restart Persistence:** Scheduled jobs remain in Redis and PostgreSQL across server or worker process restarts. When the worker resumes, pending delayed jobs trigger at their exact `scheduledAt` timestamp.

### 3. Idempotency & State Transitions
- **Deterministic Job IDs:** BullMQ job IDs follow `email_{scheduledEmailId}`.
- **Deterministic Idempotency Key:** `idempotency_{campaignId}_{recipientEmail}_{scheduledAtTimestamp}`. Duplicate scheduling attempts return existing records without creating duplicate DB records or Redis jobs.
- **Atomic State Transitions:**
  - `SCHEDULED` / `QUEUED` ➔ `PROCESSING` (Atomic DB update `where: { status: { notIn: ['SENT', 'PROCESSING'] } }`)
  - `PROCESSING` ➔ `SENT` (On delivery completion, sets `sentAt`)
  - `PROCESSING` ➔ `FAILED` (On delivery failure, sets `errorMessage`)
- **Audit Trails:** Every state change creates a `DeliveryLog` entry (`QUEUED`, `PROCESSING`, `SENT`, `FAILED`).

### 4. API Specification

#### `POST /api/emails/schedule` (Authenticated)
**Request Header:** Cookie session (`connect.sid`) or credentials included.

**Request Body:**
```json
{
  "campaignId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "recipientEmail": "lead@example.com",
  "recipientName": "Jane Doe",
  "subject": "Exclusive Demo Invitation",
  "body": "Hi Jane, let's schedule a call.",
  "scheduledAt": "2026-09-27T02:30:00.000Z"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "scheduledEmailId": "fab6c7b6-102b-4321-a571-ddf3a5b98bf4",
    "queueJobId": "email_fab6c7b6-102b-4321-a571-ddf3a5b98bf4",
    "scheduledAt": "2026-09-27T02:30:00.000Z",
    "status": "QUEUED",
    "isDuplicate": false
  }
}
```

### 5. Running API & Worker Processes

Start Express API server:
```bash
cd backend
npm run dev
```

Start Standalone BullMQ Worker process:
```bash
cd backend
npm run worker
```

Run Full Automated Test Suite (Database, Auth & Scheduling):
```bash
cd backend
npm test
```




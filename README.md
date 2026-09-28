# ESCOPE — Full-Stack Email Scheduler

ESCOPE is a full-stack email scheduling platform that allows users to create email campaigns, schedule emails for multiple recipients, control sending rates, track delivery status, and search emails.

The application is built using React, TypeScript, Express.js, PostgreSQL, Redis, BullMQ, Elasticsearch, and Ethereal Email.

---

## Tech Stack

### Backend
- Node.js
- TypeScript
- Express.js
- PostgreSQL
- Prisma ORM
- Redis
- BullMQ
- Nodemailer
- Ethereal Email
- Elasticsearch

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS

### Authentication & Integrations
- Google OAuth 2.0
- Slack OAuth 2.0
- Slack rate-limit notifications
- BullMQ Dashboard (`@bull-board/express`)

---

## 1. How to Run the Backend

### Prerequisites

Make sure the following are installed:
- Node.js (v18+)
- npm
- Docker & Docker Desktop
- Git

Docker is used to run infrastructure dependencies:
- PostgreSQL (`localhost:5432`)
- Redis (`localhost:6379`)
- Elasticsearch (`localhost:9200`)

---

### Step 1 — Start Infrastructure

From the project root:

```bash
docker compose up -d
```

Check the running containers:

```bash
docker compose ps
```

The following services should be running:
- PostgreSQL
- Redis
- Elasticsearch

---

### Step 2 — Install Backend Dependencies

```bash
cd backend
npm install
```

---

### Step 3 — Configure Environment Variables

Create the environment file from example:

```bash
cp .env.example .env
```

Configure the required values in `backend/.env`.

The required environment variables are documented in `backend/.env.example`. These include configuration for:
- PostgreSQL (`DATABASE_URL`)
- Redis (`REDIS_URL`)
- Elasticsearch (`ELASTICSEARCH_NODE`)
- Google OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
- Slack OAuth (`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`)
- Session security (`SESSION_SECRET`)
- Worker concurrency (`WORKER_CONCURRENCY`)
- Email delivery (Ethereal SMTP credentials)

---

### Step 4 — Setup Database

Run Prisma migrations:

```bash
npx prisma migrate deploy
```

Generate Prisma Client:

```bash
npx prisma generate
```

---

### Step 5 — Start Express Backend

```bash
npm run dev
```

The backend server runs on:
`http://localhost:5000`

Health check endpoint:
`http://localhost:5000/health`

---

### Step 6 — Start BullMQ Worker

Open another terminal window:

```bash
cd backend
npm run worker
```

The worker runs separately from the Express server and processes scheduled email jobs from the BullMQ queue.

---

## 2. How to Run the Frontend

Open another terminal window:

```bash
cd frontend
npm install
```

Start the development server:

```bash
npm run dev
```

The frontend runs on:
`http://localhost:5173`

Open `http://localhost:5173` in your browser and sign in using Google OAuth.

---

## 3. Ethereal Email Setup

ESCOPE uses Ethereal Email as the SMTP service for email delivery during development and testing.

Ethereal provides a test SMTP server where sent emails can be previewed without sending real emails to external recipients.

### Create an Ethereal Account

1. Create an account at: `https://ethereal.email/`
2. After creating the account, obtain the SMTP credentials provided by Ethereal.

Typical SMTP configuration:
- **Host:** `smtp.ethereal.email`
- **Port:** `587`
- **Security:** STARTTLS

Configure the SMTP credentials using the environment variables documented in `backend/.env.example`:

```env
ETHEREAL_USER=your_ethereal_username
ETHEREAL_PASS=your_ethereal_password
```

> **Note:** Do not commit `.env` or SMTP passwords to Git. The repository excludes environment files through `.gitignore`.

---

## 4. Architecture Overview

ESCOPE uses PostgreSQL as the persistent source of truth and Redis/BullMQ for asynchronous email processing.

```
                  ┌──────────────────┐
                  │   React Frontend │
                  └────────┬─────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │ Express Backend  │
                  └────────┬─────────┘
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
      ┌────────────┐ ┌────────────┐ ┌──────────────┐
      │ PostgreSQL │ │ Redis +    │ │ Elasticsearch │
      │            │ │ BullMQ     │ │              │
      │ Persistence│ │ Queue      │ │ Search       │
      └────────────┘ └─────┬──────┘ └──────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │ BullMQ Worker│
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Ethereal SMTP│
                    └──────────────┘
```

---

## 5. How Scheduling Works

When a user creates a campaign:

1. The frontend sends campaign details and recipient leads to the backend.
2. The backend validates the campaign inputs and recipient email list.
3. A `Campaign` record is stored in PostgreSQL.
4. Individual `ScheduledEmail` records are created for each recipient with unique `idempotencyKey` values.
5. A BullMQ job is enqueued for every scheduled email.
6. BullMQ uses delayed jobs (`delay` calculated from `startAt` timestamp and inter-email offsets) to execute emails at the exact configured time.
7. The BullMQ worker picks up jobs when their execution delay expires.
8. The worker executes atomic rate-limit checks via Redis before sending.
9. The email is transmitted through the configured Ethereal SMTP account via Nodemailer.
10. Email statuses (`SENT`, `FAILED`, `RESCHEDULED`) and `DeliveryLog` entries are updated in PostgreSQL.
11. The email is indexed in Elasticsearch for instant full-text search.

### Pipeline Flow:

```
Campaign
   │
   ▼
PostgreSQL
   │
   ▼
BullMQ Delayed Job
   │
   ▼
Worker
   │
   ▼
Rate Limit Check
   │
   ▼
Ethereal SMTP
   │
   ▼
Delivery Status
```

> **Note:** The system does **not** use cron, node-cron, or OS cron for email scheduling. All timing is driven by native BullMQ delayed jobs.

---

## 6. Persistence and Restart Safety

Scheduled emails are stored in PostgreSQL before they are enqueued into BullMQ.

PostgreSQL acts as the persistent source of truth for all scheduled email records. BullMQ stores asynchronous delayed jobs in Redis.

When the backend or worker process restarts:
1. On boot, the application checks PostgreSQL for any scheduled emails with status `QUEUED` or `SCHEDULED` that lack active queue jobs.
2. The application automatically re-hydrates missing jobs back into BullMQ.

Therefore, scheduled emails remain completely safe across server and worker process restarts.

```
PostgreSQL
    │
    │ persisted scheduled emails
    ▼
BullMQ / Redis
    │
    │ delayed jobs
    ▼
Worker
```

The system also uses unique idempotency keys (`idempotency_{campaignId}_{recipientEmail}`) and deterministic BullMQ job IDs (`email_{scheduledEmailId}`) to prevent duplicate email delivery under all circumstances.

---

## 7. Rate Limiting

ESCOPE supports two configurable sending controls:

### Minimum Delay Between Emails
Each campaign defines the minimum delay between individual email sends (e.g. `delayBetweenEmailsMs = 2000` for 2 seconds).

The scheduler offsets delayed job enqueuing so that emails are sent with the exact configured spacing.

### Hourly Rate Limit
Each campaign defines an hourly rate limit (e.g. `hourlyLimit = 200` emails/hour).

Redis is used to maintain sliding window rate-limit state. The rate limiter uses atomic Redis operations so that multiple concurrent worker processes cannot bypass the configured limit simultaneously.

When the hourly limit is hit:

```
Job
 │
 ▼
Rate Limit Check
 │
 ├── Allowed ───────► Send Email
 │
 └── Limit Reached
          │
          ▼
      Reschedule
          │
          ▼
     Try Again Later
```

When rate limits are exceeded, jobs are automatically **rescheduled** into BullMQ with a calculated delay rather than being dropped. A `RESCHEDULED` event is also recorded in `DeliveryLog` and a notification is sent to the user's connected Slack workspace.

---

## 8. Worker Concurrency

BullMQ workers support configurable concurrency via the `WORKER_CONCURRENCY` environment variable (default: `WORKER_CONCURRENCY=5`).

This allows multiple email jobs to be processed concurrently across worker threads. The shared atomic Redis rate limiter ensures that increasing worker concurrency never breaches configured sending limits.

```
                 BullMQ Worker
              Concurrency = 5
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
     Job 1         Job 2         Job 3
       │             │             │
       └─────────────┼─────────────┘
                     ▼
              Redis Rate Limiter
                     │
                     ▼
                 SMTP Send
```

---

## 9. Features Implemented

### Backend
- **Scheduler:** BullMQ-based email scheduler with native delayed jobs, configurable campaign start times, and inter-email delays. Zero cron dependencies.
- **Persistence:** PostgreSQL database managed via Prisma ORM for campaigns, scheduled emails, delivery logs, and users.
- **Restart Safety:** Automatic recovery of unqueued scheduled emails on worker/server boot.
- **Idempotency:** Unique DB idempotency keys, deterministic job IDs (`email_{scheduledEmailId}`), and atomic status transitions (`QUEUED` $\to$ `PROCESSING` $\to$ `SENT`).
- **Rate Limiting:** Sliding window rate limiter using atomic Redis scripts. Automatic job rescheduling when hourly limits are reached.
- **Concurrency:** Configurable BullMQ worker concurrency safe across multiple worker processes.
- **Email Delivery:** Nodemailer transport with Ethereal SMTP integration, multiple sender account support, and status tracking.
- **Search:** Elasticsearch integration supporting full-text search across subject, body, recipient email, and recipient name with strict user isolation.
- **Integrations:** Google OAuth 2.0, Slack OAuth 2.0, Slack tenant-aware rate-limit alerts, and `@bull-board/express` queue dashboard.

---

## 10. Frontend Features

- **Login:** Google OAuth 2.0 login button with authenticated user state management.
- **Dashboard:** Modern, email-client layout displaying user profile header, scheduled email list, sent email list, search bar, metrics counters, and infrastructure health monitor.
- **Compose Campaign:** Modal composer supporting campaign naming, sender selection, email subject, body, CSV lead file upload, multiline text lead input, client-side lead validation, start time picker, inter-email delay, and hourly rate limit setting.
- **Email Tables:** Compact, light-themed email client list views for Scheduled and Sent emails with recipient avatars, subject preview, campaign tags, status badges, and timestamp displays.
- **Search UI:** Wide debounced search bar querying Elasticsearch backend with fallback handling.
- **UI States:** Loading spinners, empty state views, clean error banners, and direct links to the BullMQ Dashboard.

---

## 11. BullMQ Dashboard

ESCOPE includes a live BullMQ queue monitoring dashboard accessible at:

`http://localhost:5000/admin/queues`

The dashboard provides real-time visibility into:
- Waiting jobs
- Active jobs
- Completed jobs
- Failed jobs
- Delayed jobs
- Paused jobs

The dashboard route is protected by session authentication (`requireAuth`).

---

## 12. Important URLs

| Service | URL |
| :--- | :--- |
| **Frontend Web App** | `http://localhost:5173` |
| **Backend API** | `http://localhost:5000` |
| **Backend Health Check** | `http://localhost:5000/health` |
| **BullMQ Queue Dashboard** | `http://localhost:5000/admin/queues` |
| **Elasticsearch Node** | `http://localhost:9200` |

---

## 13. Project Structure

```
ESCOPE/
│
├── backend/
│   ├── prisma/
│   │   └── schema.prisma
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── queues/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── workers/
│   │   ├── app.ts
│   │   └── server.ts
│   ├── tests/
│   ├── .env.example
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── types/
│   │   ├── App.tsx
│   │   ├── index.css
│   │   └── main.tsx
│   ├── .env.example
│   └── package.json
│
├── docker-compose.yml
├── .gitignore
└── README.md
```

---

## 14. Testing

### Backend TypeScript Check
```bash
cd backend
npx tsc --noEmit
```

### Backend Automated Test Suite
```bash
cd backend
npm test
```
*Executes 54 automated integration & unit tests across 9 test suites.*

### Frontend Production Build
```bash
cd frontend
npm run build
```

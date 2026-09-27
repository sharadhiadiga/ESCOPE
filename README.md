3. Add a **README** that includes:
    - How to run **backend** (Express, Redis, DB, BullMQ worker)
    - How to run **frontend**
    - How to set up **Ethereal Email** and env variables
    - Architecture overview:
        - How scheduling works
        - How persistence on restart is handled
        - How rate limiting & concurrency are implemented
    - List of **features implemented**, mapped to:
        - Backend: scheduler, persistence, rate limiting, concurrency
        - Frontend: login, dashboard, compose, tables, etc.
     
Check the containers:

docker compose ps

The following services should be running:

PostgreSQL
Redis
Elasticsearch
Step 2 — Install Backend Dependencies
cd backend
npm install
Step 3 — Configure Environment Variables

Create the environment file:

cp .env.example .env

Configure the required values in:

backend/.env

The required environment variables are documented in:

backend/.env.example

These include configuration for:

PostgreSQL
Redis
Elasticsearch
Google OAuth
Slack OAuth
Session security
Worker concurrency
Email delivery
Step 4 — Setup Database

Run Prisma migrations:

npx prisma migrate deploy

Generate Prisma Client:

npx prisma generate
Step 5 — Start Express Backend
npm run dev

The backend runs on:

http://localhost:5000

Health check:

http://localhost:5000/health
Step 6 — Start BullMQ Worker

Open another terminal:

cd backend
npm run worker

The worker runs separately from the Express server and processes scheduled
email jobs from the BullMQ queue.

2. How to Run the Frontend

Open another terminal:

cd frontend
npm install

Start the development server:

npm run dev

The frontend runs on:

http://localhost:5173

Open the URL in your browser and sign in using Google OAuth.

3. Ethereal Email Setup

ESCOPE uses Ethereal Email as the SMTP service for email delivery during
development and testing.

Ethereal provides a test SMTP server where sent emails can be previewed
without sending real emails to external recipients.

Create an Ethereal Account

Create an account at:

https://ethereal.email/

After creating the account, obtain the SMTP credentials provided by
Ethereal.

Typical SMTP configuration:

Host: smtp.ethereal.email
Port: 587
Security: STARTTLS

Configure the SMTP credentials using the environment variables documented
in:

backend/.env.example

Do not commit .env or SMTP passwords to Git.

The repository already excludes environment files through .gitignore.

4. Architecture Overview

ESCOPE uses PostgreSQL as the persistent source of truth and Redis/BullMQ
for asynchronous email processing.

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
5. How Scheduling Works

When a user creates a campaign:

The frontend sends the campaign details to the backend.
The backend validates the campaign and recipient list.
A campaign is stored in PostgreSQL.
Individual scheduled email records are created for each recipient.
A BullMQ job is created for every email.
BullMQ uses delayed jobs to execute emails at the configured time.
The BullMQ worker picks up the jobs when they become available.
The worker checks rate limits before sending.
The email is sent through the configured SMTP account.
The email status and delivery logs are updated in PostgreSQL.
The email is indexed in Elasticsearch for searching.

Example:

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

The system does not use cron, node-cron, or Agenda for scheduling.

6. Persistence and Restart Safety

Scheduled emails are stored in PostgreSQL before they are processed.

PostgreSQL acts as the source of truth for scheduled email records.

BullMQ stores the asynchronous jobs in Redis.

When the backend/worker restarts, the application checks the database for
scheduled emails that still require queue processing and restores missing
jobs to BullMQ.

Therefore, scheduled emails are not dependent only on the process remaining
running.

PostgreSQL
    │
    │ persisted scheduled emails
    ▼
BullMQ / Redis
    │
    │ delayed jobs
    ▼
Worker

The system also uses unique idempotency keys and deterministic BullMQ job
IDs to prevent duplicate scheduling.

7. Rate Limiting

ESCOPE supports two configurable sending controls.

Minimum Delay Between Emails

Each campaign can define the minimum delay between individual emails.

For example:

Delay between emails = 2 seconds

The scheduler offsets the jobs so that emails are processed with the
configured spacing.

Hourly Rate Limit

Each campaign can also define an hourly sending limit.

For example:

Hourly limit = 200 emails

Redis is used to maintain the rate-limit state.

The rate limiter uses atomic Redis operations so that multiple worker
processes cannot bypass the configured limit simultaneously.

When the hourly limit is reached:

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

Jobs are delayed and rescheduled rather than dropped.

A delivery log is also created for the rescheduling event.

8. Worker Concurrency

BullMQ workers support configurable concurrency.

The concurrency can be configured through the environment configuration.

Example:

WORKER_CONCURRENCY=5

This allows multiple jobs to be processed concurrently.

The Redis rate limiter still controls the overall sending rate, ensuring
that increasing worker concurrency does not bypass the configured limits.

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
9. Features Implemented
Backend
Scheduler
BullMQ-based email scheduler
Delayed email jobs
Configurable campaign start time
Configurable delay between emails
No cron-based scheduling
Persistence
PostgreSQL database
Prisma ORM
Campaign persistence
Scheduled email persistence
Delivery logs
Restart-safe queue recovery
Database-backed source of truth
Idempotency
Unique idempotency keys
Deterministic BullMQ job IDs
Atomic email status transitions
Prevents duplicate email delivery
Rate Limiting
Configurable hourly sending limit
Configurable delay between emails
Redis-based rate limiter
Atomic rate-limit checks
Automatic rescheduling when limits are reached
Delivery logs for rescheduled emails
Concurrency
BullMQ worker
Configurable worker concurrency
Multiple jobs can be processed concurrently
Shared Redis rate limiter keeps sending limits safe across workers
Email Delivery
Nodemailer SMTP integration
Ethereal Email
Multiple sender accounts
Delivery status tracking
Failed email handling
Search
Elasticsearch integration
Search by recipient
Search by subject
Search by email body
User-level search isolation
Integrations
Google OAuth
Slack OAuth
Slack rate-limit notifications
BullMQ monitoring dashboard
10. Frontend Features
Login
Google OAuth login
Authenticated dashboard
User name, email, and avatar
Logout
Dashboard
Scheduled email count
Sent email count
Email search
Infrastructure health information
BullMQ Dashboard access
Compose Campaign
Campaign name
Sender email account selection
Email subject
Email body
CSV lead upload
Multiline lead input
Email validation
Invalid lead detection
Start date/time
Delay between emails
Hourly sending limit
Email Tables
Scheduled Emails

Displays:

Recipient
Subject
Email preview
Campaign
Status
Scheduled time
Sent Emails

Displays:

Recipient
Subject
Email preview
Campaign
Status
Sent time
Search

Users can search emails by:

Recipient
Subject
Body

Search uses Elasticsearch on the backend.

UI States

The frontend includes:

Loading states
Empty states
Error states
Status badges
Refresh controls
Responsive layout
11. BullMQ Dashboard

ESCOPE includes a BullMQ monitoring dashboard.

Open:

http://localhost:5000/admin/queues

The dashboard provides visibility into:

Waiting jobs
Active jobs
Completed jobs
Failed jobs
Delayed jobs
Paused jobs

This allows the email processing pipeline to be monitored in real time.

12. Important URLs
Service	URL
Frontend	http://localhost:5173
Backend	http://localhost:5000
Backend Health	http://localhost:5000/health
BullMQ Dashboard	http://localhost:5000/admin/queues
Elasticsearch	http://localhost:9200
13. Project Structure
ESCOPE/
│
├── backend/
│   ├── prisma/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── queues/
│   │   ├── routes/
│   │   ├── services/
│   │   └── workers/
│   ├── tests/
│   ├── .env.example
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── types/
│   │   └── App.tsx
│   └── package.json
│
├── docker-compose.yml
├── .gitignore
└── README.md
14. Testing

Backend TypeScript check:

cd backend
npx tsc --noEmit

Backend tests:

npm test

Frontend production build:

cd frontend
npm run build

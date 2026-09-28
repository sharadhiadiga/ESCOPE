import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import session from 'express-session';
import passport, { configurePassport } from './config/passport';
import { env } from './config/env';
import { prisma } from './db';
import authRoutes from './routes/auth.routes';
import emailSchedulingRoutes from './routes/emailScheduling.routes';
import emailAccountRoutes from './routes/emailAccount.routes';
import slackRoutes from './routes/slack.routes';
import { setupBullBoard } from './config/bullBoard';
import { requireAuth } from './middleware/auth';

const app: Express = express();

// Trust Railway/reverse proxy headers for HTTPS session cookies
app.set('trust proxy', 1);

// Middleware
const frontendUrlNormalized = env.FRONTEND_URL.replace(/\/$/, '');
const isProduction = env.NODE_ENV === 'production';

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const cleanOrigin = origin.replace(/\/$/, '');
      if (
        cleanOrigin === frontendUrlNormalized ||
        cleanOrigin === 'http://localhost:5173' ||
        cleanOrigin === 'http://localhost:3000'
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Configuration
app.use(
  session({
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Initialize Passport
configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// Mount Bull Board Queue Dashboard (Protected by requireAuth)
const bullBoardAdapter = setupBullBoard();
app.use('/admin/queues', requireAuth, bullBoardAdapter.getRouter());

// Mount Routes
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/emails', emailSchedulingRoutes);
app.use('/emails', emailSchedulingRoutes);
app.use('/api/email-accounts', emailAccountRoutes);
app.use('/email-accounts', emailAccountRoutes);
app.use('/api/slack', slackRoutes);
app.use('/slack', slackRoutes);

// Health Check Endpoint
app.get('/health', async (_req: Request, res: Response) => {
  let dbStatus = 'disconnected';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = 'error';
  }

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'reachinbox-backend',
    env: env.NODE_ENV,
    db: dbStatus,
  });
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'reachinbox-backend-api',
  });
});

// Centralized Error Handling Middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({
    error: {
      message: err.message || 'Internal Server Error',
    },
  });
});

export default app;

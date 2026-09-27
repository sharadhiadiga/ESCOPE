import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import session from 'express-session';
import passport, { configurePassport } from './config/passport';
import { env } from './config/env';
import { prisma } from './db';
import authRoutes from './routes/auth.routes';
import emailSchedulingRoutes from './routes/emailScheduling.routes';

const app: Express = express();

// Middleware
app.use(
  cors({
    origin: env.FRONTEND_URL,
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
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Initialize Passport
configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// Mount Routes
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/emails', emailSchedulingRoutes);
app.use('/emails', emailSchedulingRoutes);

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

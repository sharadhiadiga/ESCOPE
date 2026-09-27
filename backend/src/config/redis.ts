import Redis from 'ioredis';
import { env } from './env';

export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Mandatory requirement for BullMQ
  enableReadyCheck: false,
});

redisConnection.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

export default redisConnection;

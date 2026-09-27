import { env } from './config/env';
import { createEmailWorker } from './workers/email.worker';
import { redisConnection } from './config/redis';
import { prisma } from './db';

console.log(`🤖 ReachInbox BullMQ Worker Process initializing...`);
console.log(`⚡ Concurrency setting: ${env.WORKER_CONCURRENCY}`);
console.log(`⏱️  Min Delay setting: ${env.MIN_DELAY_BETWEEN_EMAILS_MS} ms`);
console.log(`📊 Max Emails per Hour: ${env.MAX_EMAILS_PER_HOUR}`);

const worker = createEmailWorker();
console.log(`🚀 BullMQ Worker listening on queue "email-scheduling"...`);

const gracefulShutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}, closing worker gracefully...`);
  try {
    await worker.close();
    console.log('Worker closed.');
    await redisConnection.quit();
    console.log('Redis connection closed.');
    await prisma.$disconnect();
    console.log('Prisma disconnected.');
    process.exit(0);
  } catch (err) {
    console.error('Error during worker shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

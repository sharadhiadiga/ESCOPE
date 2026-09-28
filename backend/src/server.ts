import app from './app';
import { env } from './config/env';
import { ElasticsearchService } from './services/elasticsearch.service';

const PORT = env.PORT;

const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 ReachInbox Backend API running on port ${PORT} (${HOST})`);
  console.log(`🏥 Health check available at /health`);

  ElasticsearchService.initializeIndex().catch((err) => {
    console.warn('[Elasticsearch] Non-blocking startup initialization error:', err?.message || err);
  });
});

const gracefulShutdown = () => {
  console.log('Received shutdown signal, closing server gracefully...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

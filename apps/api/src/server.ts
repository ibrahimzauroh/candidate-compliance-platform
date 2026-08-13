import { createApp } from './app.js';
import { loadEnvironment } from './config/load-environment.js';

loadEnvironment();

const port = Number.parseInt(process.env.API_PORT ?? '4000', 10);
const app = createApp();

const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, closing HTTP server`);
  server.close((error) => {
    if (error) {
      console.error('Failed to close HTTP server', error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

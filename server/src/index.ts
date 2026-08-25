import { createApp } from './app.ts';
import { prisma } from './db.ts';
import { env } from './env.ts';

const app = createApp();

// Binds every interface, so a phone on the same Wi-Fi can reach the dev server by
// LAN IP. `localhost` in the app's EXPO_PUBLIC_API_URL would only work in a simulator.
const server = app.listen(env.PORT, () => {
  console.log(`[server] listening on port ${env.PORT} (${env.NODE_ENV})`);
});

let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, draining…`);

    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });

    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

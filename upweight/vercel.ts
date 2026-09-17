import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',
  crons: [
    // Hourly. Roughly 720 Jev calls a day, fixed regardless of traffic.
    { path: '/api/cron/score', schedule: '0 * * * *' },
  ],
};

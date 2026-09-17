import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',
  crons: [
    /*
     * Daily, not hourly, because Hobby accounts cap Vercel Cron at one run per day.
     *
     * Hourly refresh is still the intent, and it is driven by .github/workflows/refresh.yml
     * instead, which hits this same endpoint with the same bearer token and has no such
     * limit. This entry stays as a backstop: GitHub disables workflows on repositories
     * with no activity for 60 days, and without it a quiet month would silently stop the
     * refresh with nothing to notice it.
     */
    { path: '/api/cron/score', schedule: '0 9 * * *' },
  ],
};

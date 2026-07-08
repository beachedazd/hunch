import type { Config } from '@netlify/functions';
import { runPolymarketSync } from './lib/polymarket.ts';

// Hourly scheduled run of the Polymarket -> hunch sync (resolution pass
// then import pass). See polymarket-sync.mts for the on-demand equivalent
// and netlify/functions/lib/polymarket.ts for the shared implementation.

export default async (): Promise<Response> => {
  const summary = await runPolymarketSync();

  console.log(
    `polymarket-sync-cron: imported=${summary.imported.length} resolved=${summary.resolved.length} ` +
      `skipped=${summary.skipped} errors=${summary.errors.length}`
  );

  if (summary.errors.length > 0) {
    console.error('polymarket-sync-cron errors:', summary.errors.join(' | '));
  }

  return new Response('ok');
};

export const config: Config = { schedule: '@hourly' };

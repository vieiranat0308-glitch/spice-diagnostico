import { Redis } from '@upstash/redis';

export const LEAD_IDS_KEY = 'spice:lead-ids';
export const leadKey = (id) => `spice:lead:${id}`;

export function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

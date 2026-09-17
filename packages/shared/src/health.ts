import { z } from 'zod';

import { dataEnvelope } from './envelope.js';

/** `GET /v1/health` dan `GET /v1/health/ready` → `200 {"data":{"status":"ok"}}` (kontrak §1.1). */
export const healthStatusSchema = z.object({ status: z.literal('ok') });
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const healthResponseSchema = dataEnvelope(healthStatusSchema);
export type HealthResponse = z.infer<typeof healthResponseSchema>;

import { Queue } from 'bullmq'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = { url: REDIS_URL }

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 50,
}

export const notifQueue = new Queue('telegram-notifications', {
  connection,
  defaultJobOptions,
})

export const webhookQueue = new Queue('telegram-webhooks', {
  connection,
  defaultJobOptions,
})

export const fulfillmentQueue = new Queue('fulfillment-jobs', {
  connection,
  defaultJobOptions,
})

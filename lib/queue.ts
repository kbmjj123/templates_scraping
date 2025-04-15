import { Queue as MqQueue, Worker, QueueEvents } from 'bullmq'
import Redis from 'ioredis'
import dotenv from 'dotenv'

dotenv.config({
	path: '.env.local'
})

export class Queue {
  private connection: Redis.Redis
  public queue: MqQueue
  constructor(redisUrl: string) {
    this.connection = new Redis.default(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
			connectTimeout: 20000,
     	retryStrategy: (times) => Math.min(times * 100, 3000)
    })
    this.queue = new MqQueue('template-scan', { 
      connection: this.connection 
    })
  }

  public add(name: string, data: any, opts?: any) {
    return this.queue.add(name, data, opts)
  }

  public async setupWorker(processor: (job: any) => Promise<void>) {
    new Worker('template-scan', processor, { 
      connection: this.connection,
      concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '3')
    })
    
    new QueueEvents('template-scan', { 
      connection: this.connection 
    })
  }

  public getConnection() {
    return this.connection
  }
}
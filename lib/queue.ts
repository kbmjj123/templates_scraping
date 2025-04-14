import { Queue as MqQueue, Worker, QueueEvents } from 'bullmq'
import IORedis from 'ioredis'

export class Queue {
  private connection: IORedis
  public queue: MqQueue

  constructor(redisUrl: string) {
    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    })
    
    this.queue = new MqQueue('template-scan', { 
      connection: this.connection 
    })
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
}
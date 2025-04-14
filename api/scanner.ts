import { Database } from '../lib/db'
import { Queue } from '../lib/queue'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 初始化队列
  const queue = new Queue(process.env.REDIS_URL!)
  const db = new Database()
  
  try {
    const templates = await db.query<{ id: number; repo_url: string }>(`
      SELECT id, repo_url FROM templates 
      WHERE last_scanned < NOW() - INTERVAL '7 days'
      LIMIT 10
    `)

    templates.rows.forEach(t => {
      queue.queue.add('scan-template', t) // 这里使用 queue.queue 而不是直接使用 queue，因为 queue 是一个实例，而不是一个队列对象
      // queue.add('scan-template', t)
    })

    res.json({ 
      message: `${templates.rows.length} jobs added`,
      jobs: templates.rows
    })
  } catch (error) {
    console.error(error)
    // 由于 error 的类型为 unknown，需要先判断是否为 Error 类型
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown error occurred' });
    }
  }
}
import { Database } from '../lib/db.js'
import { Queue } from '../lib/queue.js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async (req: VercelRequest, res: VercelResponse) => {
  console.info('开始请求了！')
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 初始化队列
  const queue = new Queue(process.env.REDIS_URL!)
  const db = new Database()
  
  try {
    const templates = await db.query<{ id: number; visit_link: string }>()
    console.info(templates)

    templates.rows.forEach((t: { id: number; visit_link: string }) => {
      queue.add('scan-template', t) // 直接使用queue对象添加任务
    })

    res.json({ 
      message: `${templates.rows.length} jobs added`,
      jobs: templates.rows
    })
  } catch (error) {
    console.error(error)
    // 由于 error 的类型为 unknown，需要先判断是否为 Error 类型
    console.log(error)
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown error occurred' });
    }
  }
}
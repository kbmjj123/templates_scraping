import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({
	path: '.env.local'
})
export class Database {
  private supabase: ReturnType<typeof createClient>

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }

  async query<T = any>(): Promise<{ rows: T[] }> {
    const { data: templates, error } = await this.supabase
      .from('templates')
      .select('id, visit_link')
      // .lt('last_scanned', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      // .or('last_scanned.is.null')
      // .limit(20)
    
    if (error) {
      console.error('Query failed:', error.message);
      throw error;
    }
    // 对 data 进行类型断言，确保它符合 T[] 类型
    return { rows: templates as T[] }
  }

  async updateTemplate(id: number, data: any) {
    const { error } = await this.supabase
      .from('templates')
      .update(data)
      .eq('id', id)
    
    if (error) throw error
  }
}

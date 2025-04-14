import { createClient } from '@supabase/supabase-js'

export class Database {
  private supabase: ReturnType<typeof createClient>

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }

  async query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
    const { data, error } = await this.supabase.rpc('query', {
      sql,
      params
    })
    
    if (error) throw error
    // 对 data 进行类型断言，确保它符合 T[] 类型
    return { rows: data as T[] }
  }

  async updateTemplate(id: number, data: TemplateUpdateData) {
    const { error } = await this.supabase
      .from('templates')
      .update({
        tech_stack: data.tech_stack,
        stars: data.stars,
        forks: data.forks,
        last_commit: data.last_commit,
        risk_score: data.risk_score,
        risk_factors: data.risk_factors
      })
      .eq('id', id)
    
    if (error) throw error
  }
}

interface TemplateUpdateData {
  tech_stack: object
  stars: number
  forks: number
  last_commit: Date
  risk_score: number
  risk_factors: string[]
}
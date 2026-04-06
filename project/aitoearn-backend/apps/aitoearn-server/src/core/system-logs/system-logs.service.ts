import { Injectable } from '@nestjs/common'
import { InjectConnection } from '@nestjs/mongoose'
import { Connection } from 'mongoose'

@Injectable()
export class SystemLogsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async getLogs(query: { limit?: string; level?: string; search?: string; page?: string }) {
    const limit = query.limit ? Number(query.limit) : 50
    const page = query.page ? Number(query.page) : 1
    const skip = (page - 1) * limit
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match: Record<string, any> = {}
    
    if (query.level && query.level !== 'all') {
      match['level'] = query.level
    }
    
    if (query.search) {
      match['message'] = { $regex: query.search, $options: 'i' }
    }

    const collection = this.connection.collection('logs')
    const total = await collection.countDocuments(match)
    const items = await collection.find(match).sort({ timestamp: -1 }).skip(skip).limit(limit).toArray()

    return {
      items,
      total,
      limit,
      page,
    }
  }
}

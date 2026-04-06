import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger'
import { SystemLogsService } from './system-logs.service'

@ApiTags('System Logs')
@Controller('system-logs')
export class SystemLogsController {
  constructor(private readonly systemLogsService: SystemLogsService) {}

  @ApiOperation({ summary: 'Get System Logs' })
  @ApiQuery({ name: 'page', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: String })
  @ApiQuery({ name: 'level', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @Get()
  async getLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('level') level?: string,
    @Query('search') search?: string,
  ) {
    return this.systemLogsService.getLogs({ page, limit, level, search })
  }
}

import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ChatModule } from '../chat'
import { DriveExplorerController } from './drive-explorer.controller'
import { DriveImportRecord, DriveImportRecordSchema } from './drive-import-record.schema'
import { DriveExplorerService } from './drive-explorer.service'

@Module({
  imports: [
    ChatModule,
    MongooseModule.forFeature([{ name: DriveImportRecord.name, schema: DriveImportRecordSchema }]),
  ],
  controllers: [DriveExplorerController],
  providers: [DriveExplorerService],
})
export class DriveExplorerModule {}

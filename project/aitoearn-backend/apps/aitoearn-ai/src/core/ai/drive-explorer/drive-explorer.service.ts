import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { AitoearnServerClientService } from '@yikart/aitoearn-server-client'
import { AssetsService } from '@yikart/assets'
import { AppException, ResponseCode, UserType } from '@yikart/common'
import { AssetType, MaterialStatus, MaterialType, MediaType } from '@yikart/mongodb'
import type { Model } from 'mongoose'
import mime from 'mime-types'
import { config } from '../../../config'
import { ChatService } from '../chat/chat.service'
import { BrowseDriveDto, CreateDriveImportDto, PreviewDriveImportDto } from './drive-explorer.dto'
import { DriveImportRecord } from './drive-import-record.schema'
import type { DriveBrowseItemVo, DriveBrowseVo, DriveImportItemVo, DriveImportStatusVo, DrivePreviewItemVo, DrivePreviewVo } from './drive-explorer.vo'

type MediaKind = 'video' | 'img'

interface ParsedMetadata {
  status: 'found' | 'missing' | 'invalid'
  metadataPath?: string
  title?: string
  desc?: string
  tags: string[]
}

interface DriveImportJob {
  jobId: string
  userId: string
  groupId: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  total: number
  processed: number
  created: number
  skipped: number
  failed: number
  createdAt: string
  updatedAt: string
  items: DriveImportItemVo[]
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'])
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

@Injectable()
export class DriveExplorerService {
  private readonly jobs = new Map<string, DriveImportJob>()

  constructor(
    private readonly assetsService: AssetsService,
    private readonly serverClient: AitoearnServerClientService,
    private readonly chatService: ChatService,
    @InjectModel(DriveImportRecord.name)
    private readonly driveImportRecordModel: Model<DriveImportRecord>,
  ) {}

  async browse(_userId: string, dto: BrowseDriveDto): Promise<DriveBrowseVo> {
    const targetPath = await this.validateAbsolutePath(dto.path)

    const dirents = await readdir(targetPath, { withFileTypes: true })
    const items: DriveBrowseItemVo[] = []

    for (const dirent of dirents) {
      const fullPath = path.join(targetPath, dirent.name)

      if (dirent.isDirectory()) {
        items.push({
          name: dirent.name,
          path: fullPath,
          kind: 'directory',
        })
        continue
      }

      if (!dirent.isFile()) {
        continue
      }

      const mediaType = this.detectMediaType(dirent.name)
      if (!mediaType) {
        continue
      }
      if (dto.mediaType !== 'all' && dto.mediaType !== mediaType) {
        continue
      }

      const fileStat = await stat(fullPath)
      const metadataPath = this.getMetadataPath(fullPath)
      let hasMetadataJson = false
      try {
        await access(metadataPath)
        hasMetadataJson = true
      }
      catch {
        hasMetadataJson = false
      }

      items.push({
        name: dirent.name,
        path: fullPath,
        kind: 'file',
        mediaType,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        hasMetadataJson,
        metadataPath: hasMetadataJson ? metadataPath : undefined,
      })
    }

    const sorted = items.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === 'directory' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    const offset = this.parseCursor(dto.cursor)
    const pageSize = dto.pageSize ?? 50
    const paged = sorted.slice(offset, offset + pageSize)
    const nextOffset = offset + pageSize

    return {
      path: targetPath,
      cursor: String(offset),
      nextCursor: nextOffset < sorted.length ? String(nextOffset) : undefined,
      total: sorted.length,
      list: paged,
    }
  }

  async preview(userId: string, dto: PreviewDriveImportDto): Promise<DrivePreviewVo> {
    await this.ensureGroupBelongsToUser(userId, dto.groupId)

    const items: DrivePreviewItemVo[] = []
    let validCount = 0
    let duplicateCount = 0

    for (const inputPath of dto.paths) {
      const item = await this.buildPreviewItem(userId, inputPath)
      if (item.valid) {
        validCount++
      }
      if (item.duplicate) {
        duplicateCount++
      }
      items.push(item)
    }

    return {
      groupId: dto.groupId,
      total: items.length,
      validCount,
      duplicateCount,
      list: items,
    }
  }

  async createImportJob(userId: string, dto: CreateDriveImportDto): Promise<{ jobId: string }> {
    await this.ensureGroupBelongsToUser(userId, dto.groupId)

    const jobId = randomUUID()
    const now = new Date().toISOString()
    const job: DriveImportJob = {
      jobId,
      userId,
      groupId: dto.groupId,
      status: 'queued',
      total: dto.paths.length,
      processed: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      createdAt: now,
      updatedAt: now,
      items: [],
    }

    this.jobs.set(jobId, job)
    void this.runImportJob(jobId, dto.paths)

    return { jobId }
  }

  getImportStatus(userId: string, jobId: string): DriveImportStatusVo {
    const job = this.jobs.get(jobId)
    if (!job || job.userId !== userId) {
      throw new AppException(ResponseCode.AiLogNotFound, 'Import job not found')
    }

    return {
      ...job,
      items: [...job.items],
    }
  }

  async getThumbnailStream(_userId: string, sourcePath: string): Promise<{
    stream: ReturnType<typeof createReadStream>
    mimeType: string
    fileSize: number
  }> {
    const absPath = await this.validateAbsolutePath(sourcePath)
    const fileStat = await stat(absPath)
    if (!fileStat.isFile()) {
      throw new AppException(ResponseCode.ValidationFailed, 'Path must be a file')
    }

    const mediaType = this.detectMediaType(absPath)
    if (mediaType !== 'img') {
      throw new AppException(ResponseCode.ValidationFailed, 'Thumbnail only available for image files')
    }

    return {
      stream: createReadStream(absPath),
      mimeType: this.detectMimeType(absPath),
      fileSize: fileStat.size,
    }
  }

  private async runImportJob(jobId: string, sourcePaths: string[]): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job) {
      return
    }

    job.status = 'running'
    job.updatedAt = new Date().toISOString()

    try {
      for (const sourcePath of sourcePaths) {
        const result = await this.importSingle(job.userId, job.groupId, sourcePath)
        job.items.push(result)

        job.processed += 1
        if (result.status === 'created') {
          job.created += 1
        }
        else if (result.status === 'skipped_duplicate') {
          job.skipped += 1
        }
        else {
          job.failed += 1
        }

        job.updatedAt = new Date().toISOString()
      }

      job.status = 'completed'
      job.updatedAt = new Date().toISOString()
    }
    catch {
      job.status = 'failed'
      job.updatedAt = new Date().toISOString()
    }
  }

  private async importSingle(userId: string, groupId: string, sourcePath: string): Promise<DriveImportItemVo> {
    try {
      const absPath = await this.validateAbsolutePath(sourcePath)
      const fileStat = await stat(absPath)
      if (!fileStat.isFile()) {
        return { path: sourcePath, status: 'failed', reason: 'Not a file' }
      }

      const mediaType = this.detectMediaType(absPath)
      if (!mediaType) {
        return { path: sourcePath, status: 'failed', reason: 'Unsupported media type' }
      }

      const checksum = await this.computeFileChecksum(absPath)
      const duplicate = await this.driveImportRecordModel.findOne({ userId, checksum }).lean().exec()
      if (duplicate) {
        return { path: sourcePath, status: 'skipped_duplicate', reason: 'Duplicate file checksum' }
      }

      const metadata = await this.readMetadataForMedia(absPath)
      const filename = path.basename(absPath)

      const upload = await this.assetsService.uploadFromStream(
        userId,
        createReadStream(absPath),
        {
          type: AssetType.UserMedia,
          mimeType: this.detectMimeType(filename),
          filename,
          size: fileStat.size,
        },
      )

      const title = metadata.title?.trim() || path.parse(filename).name
      const desc = metadata.desc?.trim()
        || await this.generateAutoCaption({
          userId,
          title,
          mediaType,
          tags: metadata.tags,
        })
        || `Imported from drive: ${path.parse(filename).name}`

      const material = await this.serverClient.content.createMaterial({
        userId,
        userType: UserType.User,
        groupId,
        coverUrl: mediaType === 'img' ? upload.asset.path : undefined,
        mediaList: [{ url: upload.asset.path, type: mediaType === 'video' ? MediaType.VIDEO : MediaType.IMG }],
        title,
        desc,
        topics: metadata.tags,
        option: {
          source: {
            kind: 'drive',
            path: absPath,
            checksum,
            metadataPath: metadata.metadataPath,
          },
          autoCaption: true,
        },
        type: mediaType === 'video' ? MaterialType.VIDEO : MaterialType.ARTICLE,
        status: MaterialStatus.SUCCESS,
      })

      await this.driveImportRecordModel.create({
        userId,
        sourcePath: absPath,
        checksum,
        fileSize: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        materialId: material.id || (material as any)._id,
      })

      return {
        path: sourcePath,
        status: 'created',
        materialId: material.id || (material as any)._id,
      }
    }
    catch (error: any) {
      return {
        path: sourcePath,
        status: 'failed',
        reason: error?.message || 'Import failed',
      }
    }
  }

  private async ensureGroupBelongsToUser(userId: string, groupId: string): Promise<void> {
    const group = await this.serverClient.content.getGroupInfo(groupId)
    if (!group || group.userId !== userId) {
      throw new AppException(ResponseCode.MaterialGroupNotFound)
    }
  }

  private async buildPreviewItem(userId: string, sourcePath: string): Promise<DrivePreviewItemVo> {
    try {
      const absPath = await this.validateAbsolutePath(sourcePath)
      const fileStat = await stat(absPath)
      if (!fileStat.isFile()) {
        return this.invalidPreview(sourcePath, 'Not a file')
      }

      const mediaType = this.detectMediaType(absPath)
      if (!mediaType) {
        return this.invalidPreview(sourcePath, 'Unsupported media type')
      }

      const checksum = await this.computeFileChecksum(absPath)
      const duplicate = await this.driveImportRecordModel.exists({ userId, checksum })
      const metadata = await this.readMetadataForMedia(absPath)
      const fallbackTitle = path.parse(path.basename(absPath)).name

      return {
        path: absPath,
        name: path.basename(absPath),
        mediaType,
        size: fileStat.size,
        title: metadata.title?.trim() || fallbackTitle,
        desc: metadata.desc?.trim() || `Imported from drive: ${fallbackTitle}`,
        tags: metadata.tags,
        jsonStatus: metadata.status,
        metadataPath: metadata.metadataPath,
        duplicate: !!duplicate,
        valid: true,
      }
    }
    catch (error: any) {
      return this.invalidPreview(sourcePath, error?.message || 'Invalid file path')
    }
  }

  private invalidPreview(sourcePath: string, reason: string): DrivePreviewItemVo {
    return {
      path: sourcePath,
      name: path.basename(sourcePath),
      mediaType: 'video',
      size: 0,
      title: '',
      desc: '',
      tags: [],
      jsonStatus: 'missing',
      duplicate: false,
      valid: false,
      reason,
    }
  }

  private async validateAbsolutePath(inputPath: string): Promise<string> {
    if (!path.isAbsolute(inputPath)) {
      throw new AppException(ResponseCode.ValidationFailed, 'Path must be absolute')
    }

    const fileStat = await stat(inputPath)
    if (!fileStat) {
      throw new AppException(ResponseCode.ValidationFailed, 'Path not found')
    }

    return inputPath
  }

  private detectMediaType(filePath: string): MediaKind | undefined {
    const ext = path.extname(filePath).toLowerCase()
    if (VIDEO_EXTENSIONS.has(ext)) {
      return 'video'
    }
    if (IMAGE_EXTENSIONS.has(ext)) {
      return 'img'
    }
    return undefined
  }

  private getMetadataPath(mediaPath: string): string {
    const parsed = path.parse(mediaPath)
    return path.join(parsed.dir, `${parsed.name}.json`)
  }

  private async readMetadataForMedia(mediaPath: string): Promise<ParsedMetadata> {
    const metadataPath = this.getMetadataPath(mediaPath)

    try {
      await access(metadataPath)
    }
    catch {
      return { status: 'missing', tags: [] }
    }

    try {
      const raw = await readFile(metadataPath, 'utf-8')
      const parsed: any = JSON.parse(raw)

      const tags = this.normalizeTags(parsed.tags)
      const title = this.pickString(parsed.title, parsed.name)
      const desc = this.pickString(parsed.desc, parsed.description, parsed.caption)

      return {
        status: 'found',
        metadataPath,
        title,
        desc,
        tags,
      }
    }
    catch {
      return {
        status: 'invalid',
        metadataPath,
        tags: [],
      }
    }
  }

  private pickString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
    return undefined
  }

  private normalizeTags(input: unknown): string[] {
    if (Array.isArray(input)) {
      return input
        .map(item => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean)
        .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
    }

    if (typeof input === 'string' && input.trim()) {
      return input
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
    }

    return []
  }

  private detectMimeType(filename: string): string {
    const detected = mime.lookup(filename)
    if (typeof detected === 'string' && detected) {
      return detected
    }
    return 'application/octet-stream'
  }

  private parseCursor(cursor?: string): number {
    if (!cursor) {
      return 0
    }
    const offset = Number.parseInt(cursor, 10)
    if (!Number.isFinite(offset) || offset < 0) {
      return 0
    }
    return offset
  }

  private async computeFileChecksum(filePath: string): Promise<string> {
    const hash = createHash('sha256')
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath)
      stream.on('data', chunk => hash.update(chunk))
      stream.on('end', () => resolve())
      stream.on('error', reject)
    })
    return hash.digest('hex')
  }

  private async generateAutoCaption(params: {
    userId: string
    title: string
    mediaType: MediaKind
    tags: string[]
  }): Promise<string | undefined> {
    try {
      const model = config.ai.models.chat[0]?.name
      if (!model) {
        return undefined
      }

      const tagsText = params.tags.length > 0 ? params.tags.join(' ') : 'none'
      const prompt = [
        'Create one concise social media caption in English.',
        'Requirements: 1 sentence, maximum 140 characters, no markdown, no emoji flood.',
        `Media type: ${params.mediaType}`,
        `Title/context: ${params.title}`,
        `Tags/hints: ${tagsText}`,
      ].join('\n')

      const response = await this.chatService.chatCompletion({
        model,
        messages: [
          { role: 'system', content: 'You are a social media copywriter.' },
          { role: 'user', content: prompt },
        ],
        maxTokens: 120,
        temperature: 0.7,
      }, params.userId)

      return this.extractChatText(response?.content)
    }
    catch {
      return undefined
    }
  }

  private extractChatText(content: unknown): string | undefined {
    if (typeof content === 'string' && content.trim()) {
      return content.trim()
    }

    if (Array.isArray(content)) {
      for (const item of content) {
        if (typeof item === 'string' && item.trim()) {
          return item.trim()
        }
        if (item && typeof item === 'object') {
          const maybeText = (item as { text?: unknown }).text
          if (typeof maybeText === 'string' && maybeText.trim()) {
            return maybeText.trim()
          }
        }
      }
    }

    return undefined
  }
}

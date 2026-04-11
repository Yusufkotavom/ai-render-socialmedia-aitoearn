import { GenerateContentResponse, GenerateContentResponseUsageMetadata } from '@google/genai'
import { BaseMessage, ChatMessage } from '@langchain/core/messages'
import { OpenAIClient } from '@langchain/openai'
import { Injectable, Logger } from '@nestjs/common'
import { AssetsService } from '@yikart/assets'
import { AppException, CreditsType, getErrorMessage, ResponseCode, UserType } from '@yikart/common'
import { CreditsHelperService } from '@yikart/helpers'
import { AiLogChannel, AiLogRepository, AiLogStatus, AiLogType, AssetType, UserRepository } from '@yikart/mongodb'
import OpenAI from 'openai'
import { from, merge, Observable } from 'rxjs'
import { catchError, concatMap, ignoreElements, last, share } from 'rxjs/operators'
import { GeminiService } from '../libs/gemini/gemini.service'
import { OpenaiService } from '../libs/openai'
import { ModelsConfigService } from '../models-config'
import { calculatePricingPoints, ChatPricing, isFlatPricing, TokenUsageDetails } from '../pricing/pricing-calculator'
import {
  ChatCompletionDto,
  ChatModelsQueryDto,
  ChatStreamProxyDto,
  UserChatCompletionDto,
  UserClaudeChatProxyDto,
  UserGeminiGenerateContentDto,
} from './chat.dto'

const LEGACY_MODEL_ALIASES: Record<string, string> = {
  'gpt-5.1-all': 'openai/gpt-5.4',
  'gpt-5': 'openai/gpt-5.4-mini',
  'llama-3.3-70b-versatile': 'groq/llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile': 'groq/llama-3.1-70b-versatile',
  'mixtral-8x7b-32768': 'groq/mixtral-8x7b-32768',
  'gemini-3.1-pro-preview': 'google/gemini-3.1-pro-preview',
  'gemini-3-flash-preview': 'google/gemini-3-flash-preview',
  'gemini-2.5-flash': 'google/gemini-2.5-flash',
  'gemini-3.1-flash-image-preview': 'google/gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview': 'google/gemini-3-pro-image-preview',
  'claude-opus-4-5-20251101': 'anthropic/claude-opus-4.5',
  'claude-opus-4-6': 'anthropic/claude-opus-4.6',
  'claude-sonnet-4-5-20250929': 'anthropic/claude-sonnet-4.6',
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name)

  constructor(
    private readonly userRepo: UserRepository,
    private readonly openaiService: OpenaiService,
    private readonly creditsHelper: CreditsHelperService,
    private readonly aiLogRepo: AiLogRepository,
    private readonly modelsConfigService: ModelsConfigService,
    private readonly assetsService: AssetsService,
    private readonly geminiService: GeminiService,
  ) {}

  /**
   * 处理 content 中的 base64 图片，上传并替换 URL
   */
  private async processBase64Images(content: string | unknown[], model: string, userId: string): Promise<string | unknown[]> {
    if (typeof content === 'string') {
      const base64ImageRegex = /data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)/g
      const matches = Array.from(content.matchAll(base64ImageRegex))

      if (matches.length > 0) {
        let processedContent = content
        for (let i = matches.length - 1; i >= 0; i--) {
          const match = matches[i]
          const fullMatch = match[0]
          const matchIndex = match.index!
          const imageTypeName = match[1]
          const imageData = match[2]
          const mimeType = imageTypeName === 'jpg' ? 'jpeg' : imageTypeName
          const fullMimeType = `image/${mimeType}`
          const buffer = Buffer.from(imageData, 'base64')
          const result = await this.assetsService.uploadFromBuffer(userId, buffer, {
            type: AssetType.AiChatImage,
            mimeType: fullMimeType,
          }, model)
          const url = this.assetsService.buildUrl(result.asset.path)

          const before = processedContent.substring(0, matchIndex)
          const after = processedContent.substring(matchIndex + fullMatch.length)
          processedContent = `${before}${url}${after}`
        }
        return processedContent
      }
    }
    return content
  }

  /**
   * 处理 AIMessageChunk 的 content 中的 base64 图片
   */
  private async processAIMessageChunkContent(
    content: string | unknown[] | undefined,
    model: string,
    userId: string,
  ): Promise<string | unknown[] | undefined> {
    if (!content) {
      return content
    }
    if (typeof content === 'string') {
      return await this.processBase64Images(content, model, userId) as string
    }
    if (Array.isArray(content)) {
      return await Promise.all(
        content.map(async (item) => {
          if (typeof item === 'object' && item !== null && 'text' in item && typeof item.text === 'string') {
            return {
              ...item,
              text: await this.processBase64Images(item.text, model, userId) as string,
            }
          }
          return item
        }),
      )
    }
    return content
  }

  private extractTextContent(content: unknown): string {
    if (typeof content === 'string') {
      return content
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') {
            return part
          }
          if (typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string') {
            return part.text
          }
          return ''
        })
        .join('\n')
    }

    return ''
  }

  private sanitizeGatewayApiKey(gatewayApiKey?: string): string | undefined {
    const trimmed = gatewayApiKey?.trim()
    return trimmed ? trimmed : undefined
  }

  public resolveModelAlias(model: string): string {
    const normalized = model.trim().toLowerCase()
    if (!normalized) {
      return model
    }
    return LEGACY_MODEL_ALIASES[normalized] || model.trim()
  }

  async chatCompletion(request: ChatCompletionDto, userId: string) {
    const { messages, model, gatewayApiKey, ...params } = request
    const resolvedModel = this.resolveModelAlias(model)

    const langchainMessages: BaseMessage[] = messages.map((message) => {
      return new ChatMessage(message)
    })

    this.logger.log({
      model: resolvedModel,
      route: 'gateway-openai-compatible',
      hasCustomGatewayApiKey: Boolean(gatewayApiKey),
    }, 'Chat completion routing')

    const result = await this.openaiService.createChatCompletion({
      model: resolvedModel,
      messages: langchainMessages,
      ...params,
      apiKey: this.sanitizeGatewayApiKey(gatewayApiKey),
      modalities: params.modalities as OpenAIClient.Chat.ChatCompletionModality[],
    })

    const usage = result.usage_metadata
    if (!usage) {
      throw new AppException(ResponseCode.AiCallFailed, { error: 'Missing usage metadata' })
    }

    // 处理返回的 content 中的 base64 图片
    result.content = await this.processAIMessageChunkContent(result.content, resolvedModel, userId) as typeof result.content

    return {
      model: resolvedModel,
      usage,
      ...result,
    }
  }

  /**
   * 扣减用户Credits
   * @param userId 用户ID
   * @param amount 扣减Credits数量
   * @param description Credits变动描述
   * @param metadata 额外信息
   */
  async deductUserPoints(
    userId: string,
    amount: number,
    description: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.creditsHelper.deductCredits({
      userId,
      amount,
      type: CreditsType.AiService,
      description,
      metadata,
    })
  }

  /**
   * 检查用户余额是否足够
   * @param userId 用户ID
   * @param userType 用户类型
   * @param pricing 价格配置
   */
  private async checkUserBalance(userId: string, userType: UserType, pricing: ChatPricing): Promise<void> {
    if (userType === UserType.User) {
      const balance = await this.creditsHelper.getBalance(userId)
      if (balance < 0) {
        throw new AppException(ResponseCode.UserCreditsInsufficient)
      }
      if (isFlatPricing(pricing)) {
        const price = Number(pricing.price)
        if (balance < price) {
          throw new AppException(ResponseCode.UserCreditsInsufficient)
        }
      }
    }
  }

  /**
   * 处理完成逻辑：扣减积分和记录日志
   * @param params 参数
   * @param userId 用户ID
   * @param userType 用户类型
   * @param modelConfig 模型配置，包含 name 和 pricing
   * @param startedAt 开始时间
   * @param usage token 使用情况
   * @param result 响应结果
   * @returns 计算出的积分
   */
  private async handleCompletion(
    params: ChatCompletionDto,
    userId: string,
    userType: UserType,
    modelConfig: { name: string, pricing: ChatPricing },
    startedAt: Date,
    usage: { input_tokens?: number, output_tokens?: number, total_tokens?: number, input_token_details?: TokenUsageDetails, output_token_details?: TokenUsageDetails },
    result: { model: string, usage: typeof usage },
  ): Promise<number> {
    const points = calculatePricingPoints(modelConfig.pricing, usage)

    this.logger.debug({
      points,
      usage,
      modelConfig,
    })

    if (userType === UserType.User) {
      await this.deductUserPoints(
        userId,
        points,
        modelConfig.name,
        usage,
      )
    }

    const duration = Date.now() - startedAt.getTime()

    await this.aiLogRepo.create({
      userId,
      userType,
      model: params.model,
      channel: AiLogChannel.NewApi,
      startedAt,
      duration,
      type: AiLogType.Chat,
      points,
      request: params as unknown as Record<string, unknown>,
      response: result,
      status: AiLogStatus.Success,
    })

    return points
  }

  async userChatCompletion({ userId, userType, ...params }: UserChatCompletionDto) {
    const resolvedModel = this.resolveModelAlias(params.model)
    const modelConfig = (await this.getChatModelConfig({ userId, userType })).find((m: { name: string }) => m.name === resolvedModel)
    if (!modelConfig) {
      throw new AppException(ResponseCode.InvalidModel)
    }

    await this.checkUserBalance(userId, userType, modelConfig.pricing)

    const startedAt = new Date()

    const result = await this.chatCompletion({
      ...params,
      model: resolvedModel,
    }, userId)

    const { usage } = result

    const points = await this.handleCompletion(
      {
        ...params,
        model: resolvedModel,
      },
      userId,
      userType,
      modelConfig,
      startedAt,
      usage,
      result,
    )

    return {
      ...result,
      usage: {
        ...usage,
        points,
      },
    }
  }

  /**
   * 获取聊天模型参数
   * @param _data 查询参数，包含可选的 userId 和 userType，可用于后续个性化模型推荐
   */
  async getChatModelConfig(_data: ChatModelsQueryDto) {
    return this.modelsConfigService.config.chat
  }

  private async processChunkContent(
    chunk: OpenAI.Chat.ChatCompletionChunk,
    model: string,
    userId: string,
  ): Promise<OpenAI.Chat.ChatCompletionChunk> {
    const choice = chunk.choices[0]
    if (!choice?.delta?.content) {
      return chunk
    }

    const content = choice.delta.content
    const processedContent = await this.processBase64Images(content, model, userId)
    if (processedContent !== content) {
      return {
        ...chunk,
        choices: [{
          ...choice,
          delta: {
            ...choice.delta,
            content: processedContent as string,
          },
        }],
      }
    }
    return chunk
  }

  async proxyChatStream(
    params: ChatStreamProxyDto & { userId: string, userType: UserType },
  ): Promise<Observable<OpenAI.Chat.ChatCompletionChunk>> {
    const { userId, userType, model, gatewayApiKey, ...body } = params
    const resolvedModel = this.resolveModelAlias(model)

    const modelConfig = (await this.getChatModelConfig({ userId, userType }))
      .find(m => m.name === resolvedModel)
    if (!modelConfig) {
      throw new AppException(ResponseCode.InvalidModel)
    }

    await this.checkUserBalance(userId, userType, modelConfig.pricing)

    const startedAt = new Date()

    const stream = await this.openaiService.createRawStream({
      ...body,
      model: resolvedModel,
      stream: true,
      stream_options: { include_usage: true },
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming, {
      apiKey: this.sanitizeGatewayApiKey(gatewayApiKey),
    })

    const stream$ = from(stream as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>).pipe(share())

    const contentStream$ = stream$.pipe(
      concatMap(chunk => this.processChunkContent(chunk, resolvedModel, userId)),
    )

    const billingStream$ = stream$.pipe(
      last(),
      concatMap(async (lastChunk) => {
        if (lastChunk.usage) {
          const usage = lastChunk.usage
          const finalUsage = {
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
          }
          await this.handleCompletion(
            { model: resolvedModel, gatewayApiKey } as ChatCompletionDto,
            userId,
            userType,
            modelConfig,
            startedAt,
            finalUsage,
            { model: resolvedModel, usage: finalUsage },
          )
        }
      }),
      ignoreElements(),
    )

    return merge(contentStream$, billingStream$).pipe(
      catchError((error) => {
        this.logger.error(`Proxy stream error: ${getErrorMessage(error)}`)
        throw error
      }),
    )
  }

  /**
   * Claude 流式对话（兼容入口，统一走 gateway OpenAI-compatible 流）
   */
  async proxyClaudeChatStream({ userId, userType, ...params }: UserClaudeChatProxyDto): Promise<Observable<OpenAI.Chat.ChatCompletionChunk>> {
    const resolvedModel = this.resolveModelAlias(params.model)
    const modelConfig = (await this.getChatModelConfig({ userId, userType })).find((m: { name: string }) => m.name === resolvedModel)
    if (!modelConfig) {
      throw new AppException(ResponseCode.InvalidModel)
    }

    await this.checkUserBalance(userId, userType, modelConfig.pricing)

    const startedAt = new Date()

    const stream = await this.openaiService.createRawStream({
      model: resolvedModel,
      messages: params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: params.max_tokens,
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming, {
      apiKey: this.sanitizeGatewayApiKey(params.gatewayApiKey),
    })

    const stream$ = from(stream as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>).pipe(
      share(),
    )

    const contentStream$ = stream$.pipe(
      concatMap(chunk => this.processChunkContent(chunk, resolvedModel, userId)),
    )

    const completeStream$ = stream$.pipe(
      last(),
      concatMap(async (lastChunk) => {
        if (!lastChunk.usage) {
          return
        }
        const usage = {
          input_tokens: lastChunk.usage.prompt_tokens,
          output_tokens: lastChunk.usage.completion_tokens,
          total_tokens: lastChunk.usage.total_tokens,
        }

        await this.handleCompletion(
          { model: resolvedModel, messages: params.messages as ChatCompletionDto['messages'], gatewayApiKey: params.gatewayApiKey },
          userId,
          userType,
          modelConfig,
          startedAt,
          usage,
          { model: resolvedModel, usage },
        )
      }),
      ignoreElements(),
    )

    return merge(contentStream$, completeStream$).pipe(
      catchError((error) => {
        this.logger.error(`Error in proxyClaudeChatStream: ${getErrorMessage(error)}`)
        throw error
      }),
    )
  }

  /**
   * Gemini generateContent（通用内容生成，支持视频/音频/图片分析）
   * 带用户计费
   */
  async userGeminiGenerateContent(request: UserGeminiGenerateContentDto) {
    const { userId, userType, model, gatewayApiKey, ...params } = request
    const resolvedModel = this.resolveModelAlias(model)

    const modelConfig = (await this.getChatModelConfig({ userId, userType }))
      .find(m => m.name === resolvedModel)
    if (!modelConfig) {
      throw new AppException(ResponseCode.InvalidModel)
    }

    await this.checkUserBalance(userId, userType, modelConfig.pricing)

    const startedAt = new Date()

    const isTextOnlyRequest = params.contents.every(content =>
      content.parts.every(part => 'text' in part),
    )

    if (isTextOnlyRequest) {
      const messages: ChatCompletionDto['messages'] = []
      for (const content of params.contents) {
        const text = content.parts
          .map(part => ('text' in part ? part.text : ''))
          .filter(Boolean)
          .join('\n')
          .trim()
        if (!text) {
          continue
        }
        messages.push({
          role: content.role === 'model' ? 'assistant' : 'user',
          content: text,
        })
      }

      if (messages.length === 0) {
        throw new AppException(ResponseCode.AiCallFailed, { error: 'No valid text content in Gemini request' })
      }

      const completion = await this.chatCompletion({
        model: resolvedModel,
        gatewayApiKey,
        messages,
        temperature: params.config?.temperature,
        topP: params.config?.topP,
        maxTokens: params.config?.maxOutputTokens,
      }, userId)

      const text = this.extractTextContent(completion.content)
      const usage = completion.usage || {}

      await this.handleCompletion(
        { model: resolvedModel, messages, gatewayApiKey },
        userId,
        userType,
        modelConfig,
        startedAt,
        usage,
        { model: resolvedModel, usage },
      )

      const response = {
        text,
        candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: {
          promptTokenCount: usage.input_tokens || 0,
          candidatesTokenCount: usage.output_tokens || 0,
          totalTokenCount: usage.total_tokens || 0,
        },
      }

      return response as unknown as GenerateContentResponse
    }

    let result: GenerateContentResponse | undefined
    let usage: GenerateContentResponseUsageMetadata | undefined

    const responses = await this.geminiService.generateContentStream({
      model: resolvedModel,
      contents: params.contents,
      config: params.config,
    })

    for await (const chunk of responses) {
      this.logger.debug({ chunk }, 'Received chunk from Gemini')
      usage = chunk.usageMetadata

      if (!result) {
        result = chunk
      }
      else {
        const existingParts = result.candidates?.[0]?.content?.parts || []
        const newParts = chunk.candidates?.[0]?.content?.parts || []
        if (result.candidates?.[0]?.content) {
          result.candidates[0].content.parts = [...existingParts, ...newParts]
        }
        result.usageMetadata = chunk.usageMetadata
      }
    }

    this.logger.debug({ result }, 'Received result from Gemini')

    const inputTokenDetails = this.extractGeminiTokenDetails((usage as unknown as Record<string, unknown>)?.['promptTokensDetails'])
    const outputTokenDetails = this.extractGeminiTokenDetails((usage as unknown as Record<string, unknown>)?.['candidatesTokensDetails'])

    const finalUsage = {
      input_tokens: usage?.promptTokenCount || 0,
      output_tokens: usage?.candidatesTokenCount || 0,
      total_tokens: usage?.totalTokenCount || 0,
      input_token_details: inputTokenDetails,
      output_token_details: outputTokenDetails,
    }

    await this.handleCompletion(
      { model: resolvedModel, messages: [], gatewayApiKey },
      userId,
      userType,
      modelConfig,
      startedAt,
      finalUsage,
      { model: resolvedModel, usage: finalUsage },
    )

    return result!
  }

  private extractGeminiTokenDetails(details: unknown): TokenUsageDetails | undefined {
    if (!Array.isArray(details)) {
      return undefined
    }

    const result: TokenUsageDetails = {}
    for (const item of details) {
      if (typeof item !== 'object' || item == null) {
        continue
      }

      const detail = item as Record<string, unknown>
      const rawModality = detail['modality']
      const rawTokenCount = detail['tokenCount']
      if (typeof rawModality !== 'string' || typeof rawTokenCount !== 'number' || rawTokenCount <= 0) {
        continue
      }

      const modality = rawModality.toLowerCase()
      if (modality.includes('text')) {
        result.text = (result.text || 0) + rawTokenCount
      }
      else if (modality.includes('image')) {
        result.image = (result.image || 0) + rawTokenCount
      }
      else if (modality.includes('audio')) {
        result.audio = (result.audio || 0) + rawTokenCount
      }
      else if (modality.includes('video')) {
        result.video = (result.video || 0) + rawTokenCount
      }
    }

    return Object.keys(result).length > 0 ? result : undefined
  }
}

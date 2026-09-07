import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common'
import type {
  AnswerResponse,
  MyQuestionsResponse,
  ProductQuestionResponse,
  QuestionListResponse,
  SellerQuestionsResponse,
} from '@shopping/shared'
import {
  createQuestionRequestSchema,
  productIdSchema,
  questionListQueryParamsSchema,
  sellerIdSchema,
  sellerQuestionsQueryParamsSchema,
  writeAnswerRequestSchema,
} from '@shopping/shared'
import { z } from 'zod'

import { OptionalPrincipal, Principal } from '../auth/principal.decorator.js'
import { PublicEndpoint } from '../auth/public-endpoint.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { QuestionService } from './question.service.js'

const questionIdSchema = z.uuid()

/**
 * 상품 문의 (TASK-0088).
 *
 * ## 목록에 퍼미션이 없다
 *
 * **공개 문의는 상품 정보의 일부**이고, 퍼미션으로 가리면 그 화면이 로그인 벽 뒤로
 * 들어간다. 비공개 문의를 가리는 것은 퍼미션이 아니라 **질의의 조건**이 한다 —
 * 퍼미션은 「이 사람이 이런 일을 할 수 있는가」를 말하지 「이 행이 이 사람에게
 * 보이는가」를 말하지 못한다.
 *
 * ## 라우트 순서
 *
 * `me/questions` 와 `seller-questions` 는 `questions/:id` 와 마디가 달라 부딪히지
 * 않는다.
 */
@Controller({ version: '1' })
export class QuestionController {
  constructor(private readonly questions: QuestionService) {}

  /** 이 상품의 문의 (F2 · F6). 남의 비공개 문의는 **줄 자체가 오지 않는다.** */
  @Get('products/:id/questions')
  @PublicEndpoint()
  byProduct(
    @OptionalPrincipal() principal: RequestPrincipal | null,
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<QuestionListResponse> {
    return this.questions.byProduct(
      parseInput(productIdSchema, id, 'id'),
      parseInput(questionListQueryParamsSchema, query),
      principal?.userId ?? null,
    )
  }

  /** 문의를 남긴다 (F1). */
  @Post('products/:id/questions')
  @RequirePermission('question.write')
  async ask(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ProductQuestionResponse> {
    const productId = parseInput(productIdSchema, id, 'id')
    const request = parseInput(createQuestionRequestSchema, body)

    return { question: await this.questions.ask(principal.userId, productId, request) }
  }

  /** 내가 남긴 문의 (F7). 비공개든 아니든 전부 내 것이다. */
  @Get('me/questions')
  @RequirePermission('question.write')
  mine(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<MyQuestionsResponse> {
    return this.questions.mine(principal.userId, parseInput(questionListQueryParamsSchema, query))
  }

  /**
   * 이 스토어의 상품에 달린 문의 (F5).
   *
   * **판매자는 비공개 문의도 본다.** 자기 상품에 대한 물음이고, 답할 사람이 읽지
   * 못하면 비공개 문의라는 것이 성립하지 않는다.
   */
  @Get('seller-questions')
  @RequirePermission('question.answer')
  bySeller(
    @Principal() principal: RequestPrincipal,
    @Query('sellerId') sellerId: string,
    @Query() query: unknown,
  ): Promise<SellerQuestionsResponse> {
    return this.questions.bySeller(
      principal,
      parseInput(sellerIdSchema, sellerId, 'sellerId'),
      parseInput(sellerQuestionsQueryParamsSchema, query),
    )
  }

  /** 답한다 — **쓰거나 고친다** (F3). 문의당 답변은 하나다. */
  @Put('questions/:id/answer')
  @RequirePermission('question.answer')
  answer(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AnswerResponse> {
    const questionId = parseInput(questionIdSchema, id, 'id')
    const { content } = parseInput(writeAnswerRequestSchema, body)

    return this.questions.answer(principal, questionId, content)
  }

  /** 답변을 지운다. 문의는 남는다. */
  @Delete('questions/:id/answer')
  @RequirePermission('question.answer')
  @HttpCode(204)
  removeAnswer(@Principal() principal: RequestPrincipal, @Param('id') id: string): Promise<void> {
    return this.questions.removeAnswer(principal, parseInput(questionIdSchema, id, 'id'))
  }
}

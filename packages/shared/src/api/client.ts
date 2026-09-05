/// <reference lib="dom" />
// `dom` rather than `@types/node`: this file is the one place in the workspace
// that both a browser bundle and the Node runtime execute, and the WHATWG
// globals it needs (fetch, Response, RequestInit, AbortSignal, URL) exist in
// both. Depending on the Node types instead would tie the package to a runtime
// it must stay neutral about.

import type { z } from 'zod'

import { apiErrorSchema } from '../api-error.js'
import type { HealthResponse } from '../health.js'
import { healthResponseSchema } from '../health.js'
import { ApiClientError } from './api-client-error.js'
import type { AppId } from './app-id.js'
import { APP_ID_HEADER } from './app-id.js'
import type {
  AttributeListQuery,
  AttributeListResponse,
  AttributeResponse,
  CreateAttributeRequest,
  UpdateAttributeRequest,
} from './attributes.js'
import { attributeListResponseSchema, attributeResponseSchema } from './attributes.js'
import type {
  CategoryListResponse,
  CategoryResponse,
  CategoryTreeQuery,
  CategoryTreeResponse,
  CreateCategoryRequest,
  MoveCategoryRequest,
  ReorderCategoriesRequest,
  UpdateCategoryRequest,
} from './categories.js'
import {
  categoryListResponseSchema,
  categoryResponseSchema,
  categoryTreeResponseSchema,
} from './categories.js'
import type {
  CreateProductRequest,
  ProductBulkStatusRequest,
  ProductBulkStatusResponse,
  ProductListQuery,
  ProductListResponse,
  ProductDetailResponse,
  ProductPublishRequest,
  ProductResponse,
  SellerProductListQuery,
  SellerProductListResponse,
  SellerVariantListResponse,
  UpdateProductRequest,
} from './products.js'
import {
  productBulkStatusResponseSchema,
  productDetailResponseSchema,
  productListResponseSchema,
  productResponseSchema,
  sellerProductListResponseSchema,
  sellerVariantListResponseSchema,
} from './products.js'
import type { StorefrontSellerResponse } from './sellers.js'
import { storefrontSellerResponseSchema } from './sellers.js'
import type {
  StockAdjustRequest,
  StockAdjustResponse,
  StockLedgerQuery,
  StockLedgerResponse,
} from './stock.js'
import { stockAdjustResponseSchema, stockLedgerResponseSchema } from './stock.js'
import type { PresignUploadRequest, PresignUploadResponse } from './uploads.js'
import { presignUploadResponseSchema } from './uploads.js'

/** Every route is versioned; `v1` is the only version in existence today. */
export const API_PATH_PREFIX = '/api/v1'

/**
 * Correlation id header, written by the API on every response and listed in its
 * CORS `exposedHeaders` so a browser can read it back.
 *
 * Declared here rather than in `apps/api` because both ends need the same
 * string and only one of them can own it — the same reason {@link APP_ID_HEADER}
 * lives in this package.
 */
export const REQUEST_ID_HEADER = 'x-request-id'

/** Long enough for a cold API, short enough that a page never hangs on it. */
export const DEFAULT_TIMEOUT_MS = 5_000

/** The shape of `fetch` the client uses, so tests can pass a stub. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface ApiClientOptions {
  /** Origin of the API, e.g. `http://localhost:4000`. Path segments are ignored. */
  readonly baseUrl: string
  /** Identifies the calling app on every request. See {@link APP_ID_HEADER}. */
  readonly appId: AppId
  readonly pathPrefix?: string
  readonly timeoutMs?: number
  readonly fetch?: FetchLike
}

export interface ApiRequestOptions<TResult> {
  /** Path below the version prefix, e.g. `/health`. */
  readonly path: string
  /** Parsed against the response body; a mismatch is a `malformed_response`. */
  readonly schema: z.ZodType<TResult>
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  readonly body?: unknown
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export interface ApiCallOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export interface ApiClient {
  readonly appId: AppId
  /** Normalised origin, useful in error messages and health panels. */
  readonly baseUrl: string
  request: <TResult>(options: ApiRequestOptions<TResult>) => Promise<TResult>
  getHealth: (options?: ApiCallOptions) => Promise<HealthResponse>
  /**
   * The category tree, nested (TASK-0028).
   *
   * A method per endpoint rather than a bare {@link ApiClient.request} call at
   * every use site: the schema is then named once, and gate C1 — "no app
   * redefines a response type" — holds because there is nothing left to
   * redefine.
   */
  getCategoryTree: (
    query?: CategoryTreeQuery,
    options?: ApiCallOptions,
  ) => Promise<CategoryTreeResponse>
  /**
   * The storefront's tree — active categories, no sign-in (TASK-0042 4.2).
   *
   * Takes no query at all. `GET /categories` accepts `includeInactive` and this
   * deliberately cannot: the whole reason the API has two routes is that a
   * shopper must not be able to ask for retired categories, and a client method
   * that offered the parameter would invite somebody to add it back.
   */
  getStorefrontCategoryTree: (options?: ApiCallOptions) => Promise<CategoryTreeResponse>
  createCategory: (
    body: CreateCategoryRequest,
    options?: ApiCallOptions,
  ) => Promise<CategoryResponse>
  updateCategory: (
    id: number,
    body: UpdateCategoryRequest,
    options?: ApiCallOptions,
  ) => Promise<CategoryResponse>
  moveCategory: (
    id: number,
    body: MoveCategoryRequest,
    options?: ApiCallOptions,
  ) => Promise<CategoryResponse>
  reorderCategories: (
    body: ReorderCategoriesRequest,
    options?: ApiCallOptions,
  ) => Promise<CategoryListResponse>
  deleteCategory: (id: number, options?: ApiCallOptions) => Promise<CategoryResponse>
  /**
   * The attribute definitions that apply to one category (TASK-0030).
   *
   * Ancestors' definitions are part of the answer unless the caller asks
   * otherwise — that is what inheritance means, and a form built from this list
   * needs them. Each entry says whether it is `inherited`, so a screen knows
   * which rows it may edit here.
   */
  getAttributes: (
    query: AttributeListQuery,
    options?: ApiCallOptions,
  ) => Promise<AttributeListResponse>
  createAttribute: (
    body: CreateAttributeRequest,
    options?: ApiCallOptions,
  ) => Promise<AttributeResponse>
  updateAttribute: (
    id: number,
    body: UpdateAttributeRequest,
    options?: ApiCallOptions,
  ) => Promise<AttributeResponse>
  deleteAttribute: (id: number, options?: ApiCallOptions) => Promise<AttributeResponse>
  /**
   * A page of listings, newest first (TASK-0032).
   *
   * Summaries rather than whole products: a console page shows twenty rows and
   * the variants of twenty products are a payload nobody renders. Paging is by
   * `nextCursor`, which is the last id — ids are UUIDv7 and therefore already
   * in creation order.
   */
  getProducts: (query?: ProductListQuery, options?: ApiCallOptions) => Promise<ProductListResponse>
  getProduct: (id: string, options?: ApiCallOptions) => Promise<ProductResponse>
  /**
   * Creates a listing whole — product, images, axes, choices and every variant
   * — because a product without variants has no price and no SKU, and letting
   * that state exist would put a branch for it in every reader downstream.
   */
  createProduct: (body: CreateProductRequest, options?: ApiCallOptions) => Promise<ProductResponse>
  updateProduct: (
    id: string,
    body: UpdateProductRequest,
    options?: ApiCallOptions,
  ) => Promise<ProductResponse>
  /**
   * Puts a listing on sale, and takes it off again (TASK-0113).
   *
   * Separate from `updateProduct` even though the same transition can be
   * written as `{ status }`, because publishing is where the category's
   * required attributes stop being optional: a draft may be incomplete and a
   * listing a buyer can see may not. An editor's 저장 and its 판매 시작 are two
   * intentions, and a screen that sends them as one request cannot tell a
   * person which of the two was refused.
   */
  publishProduct: (
    id: string,
    body: ProductPublishRequest,
    options?: ApiCallOptions,
  ) => Promise<ProductResponse>
  unpublishProduct: (
    id: string,
    body: ProductPublishRequest,
    options?: ApiCallOptions,
  ) => Promise<ProductResponse>
  /** Retires a listing. The row and its variants survive for order history. */
  deleteProduct: (id: string, options?: ApiCallOptions) => Promise<ProductResponse>
  /**
   * One listing as a shopper sees it — no sign-in, `ACTIVE` only (TASK-0043 4.1).
   *
   * A different route from {@link ApiClient.getProduct}, not a flag on it: that
   * one answers for whoever is signed in and will hand a seller their own draft.
   * This one has no caller to answer for.
   */
  getStorefrontProduct: (id: string, options?: ApiCallOptions) => Promise<ProductDetailResponse>
  /**
   * One store as a shopper sees it — no sign-in, `ACTIVE` only (TASK-0044 4.2).
   *
   * Carries the brand's name, picture and paragraph, and nothing about the
   * application behind it. A different shape from the review console's, on
   * purpose: that one is an operator's view of a decision.
   */
  getStorefrontSeller: (id: string, options?: ApiCallOptions) => Promise<StorefrontSellerResponse>
  /**
   * The seller console's own catalogue page (TASK-0115).
   *
   * Always the caller's store — there is no `sellerId` to pass, because the
   * console has exactly one. Each row carries the aggregates a management
   * screen decides from (total stock, the cheapest variant, whether stock is
   * running out) and none of the variants themselves: twenty listings' worth of
   * combinations is a payload nobody renders.
   */
  getSellerProducts: (
    query?: SellerProductListQuery,
    options?: ApiCallOptions,
  ) => Promise<SellerProductListResponse>
  /** Every live variant of one listing, with its combination already spelled out. */
  getSellerProductVariants: (
    id: string,
    options?: ApiCallOptions,
  ) => Promise<SellerVariantListResponse>
  /**
   * Takes several listings off sale, or puts them back (TASK-0115).
   *
   * All or nothing: the ownership of every id is checked before the first row
   * is written, and the whole change runs in one transaction, so a request
   * carrying somebody else's id changes nothing rather than changing the ones
   * that came before it.
   */
  changeProductStatuses: (
    body: ProductBulkStatusRequest,
    options?: ApiCallOptions,
  ) => Promise<ProductBulkStatusResponse>
  /**
   * Copies a listing — options, variants, gallery, attribute values — as a
   * `DRAFT` with no stock (TASK-0115).
   *
   * The stock is not copied on purpose: a level that appeared without a
   * movement is a level the ledger cannot explain, and that invariant would be
   * false from the copy's first row.
   */
  duplicateProduct: (id: string, options?: ApiCallOptions) => Promise<ProductResponse>
  /**
   * Records one movement against a variant's stock (TASK-0115).
   *
   * A **delta**, never a level: "재고를 17로" overwrites whatever sold between
   * the read and the save, while "+5 입고" is right whenever it is processed
   * (D-024). The answer carries the balance afterwards and the movement's
   * position, which is also the cursor of {@link ApiClient.getVariantLedger}.
   */
  adjustVariantStock: (
    id: string,
    body: StockAdjustRequest,
    options?: ApiCallOptions,
  ) => Promise<StockAdjustResponse>
  /**
   * One variant's stock history, newest first (TASK-0036).
   *
   * The answer carries the current stock **and** the ledger's own sum, so that
   * a screen showing both makes a broken ledger visible rather than merely
   * present. Paging is by `nextCursor`, which is a `seq`: new movements always
   * take a larger one, so a page the reader has already passed is the only
   * place an insert can land.
   */
  getVariantLedger: (
    id: string,
    query?: StockLedgerQuery,
    options?: ApiCallOptions,
  ) => Promise<StockLedgerResponse>
  /**
   * Asks for one presigned upload (TASK-0011).
   *
   * The answer is a URL the caller PUTs the file at directly; nothing here
   * uploads anything. Whatever `headers` and `contentLength` come back with have
   * to be reproduced exactly on that PUT — they are signed into the URL.
   */
  presignUpload: (
    body: PresignUploadRequest,
    options?: ApiCallOptions,
  ) => Promise<PresignUploadResponse>
}

/** `?rootId=3&includeInactive=true`, or an empty string when nothing is set. */
function categoryTreeSearch(query: CategoryTreeQuery): string {
  const params = new URLSearchParams()

  if (query.rootId !== undefined) params.set('rootId', String(query.rootId))
  if (query.includeInactive !== undefined) {
    params.set('includeInactive', String(query.includeInactive))
  }

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/** `?categoryId=3&includeInherited=false`, always carrying the category. */
function attributeListSearch(query: AttributeListQuery): string {
  const params = new URLSearchParams({ categoryId: String(query.categoryId) })

  if (query.includeInherited !== undefined) {
    params.set('includeInherited', String(query.includeInherited))
  }

  return `?${params.toString()}`
}

/** `?sellerId=…&status=ACTIVE&limit=20&cursor=…`, or empty when nothing is set. */
function productListSearch(query: ProductListQuery): string {
  const params = new URLSearchParams()

  if (query.sellerId !== undefined) params.set('sellerId', query.sellerId)
  if (query.categoryId !== undefined) params.set('categoryId', String(query.categoryId))
  if (query.status !== undefined) params.set('status', query.status)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/** `?status=ACTIVE&stock=low&q=티셔츠&…`, or empty when nothing is set. */
function sellerProductListSearch(query: SellerProductListQuery): string {
  const params = new URLSearchParams()

  if (query.status !== undefined) params.set('status', query.status)
  if (query.categoryId !== undefined) params.set('categoryId', String(query.categoryId))
  if (query.stock !== undefined) params.set('stock', query.stock)
  if (query.q !== undefined) params.set('q', query.q)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/** `?limit=20&cursor=7`, or an empty string when nothing is set. */
function stockLedgerSearch(query: StockLedgerQuery): string {
  const params = new URLSearchParams()

  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', String(query.cursor))

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

function normaliseBaseUrl(baseUrl: string): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new TypeError(`API base URL is not a valid absolute URL: "${baseUrl}"`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`API base URL must be http(s): "${baseUrl}"`)
  }
  return url.origin
}

function buildUrl(baseUrl: string, prefix: string, path: string): string {
  return `${baseUrl}${prefix}${path.startsWith('/') ? path : `/${path}`}`
}

/** Turns whatever `fetch` rejected with into one of the client's kinds. */
function classifyTransportFailure(
  error: unknown,
  url: string,
  callerAborted: boolean,
): ApiClientError {
  const name = error instanceof Error ? error.name : ''

  if (name === 'TimeoutError' || (name === 'AbortError' && !callerAborted)) {
    return new ApiClientError({
      kind: 'timeout',
      message: `Request to ${url} timed out`,
      cause: error,
    })
  }
  if (name === 'AbortError') {
    return new ApiClientError({
      kind: 'aborted',
      message: `Request to ${url} was aborted`,
      cause: error,
    })
  }
  // Includes a browser CORS rejection, which is indistinguishable from an
  // unreachable host by design.
  return new ApiClientError({ kind: 'network', message: `Cannot reach ${url}`, cause: error })
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') return undefined

  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new ApiClientError({
      kind: 'malformed_response',
      message: `Response from ${response.url} is not JSON`,
      status: response.status,
      cause: error,
    })
  }
}

/**
 * The correlation id the API put on the response.
 *
 * `null` rather than `undefined` from the header itself; the caller turns a
 * missing header into an omitted property so that `requestId` stays absent
 * instead of becoming the string "null".
 */
function requestIdOf(response: Response): string | undefined {
  return response.headers.get(REQUEST_ID_HEADER) ?? undefined
}

function httpFailure(response: Response, body: unknown): ApiClientError {
  const parsed = apiErrorSchema.safeParse(body)
  const requestId = requestIdOf(response)

  return new ApiClientError({
    kind: 'http',
    message: parsed.success
      ? `${response.status} ${parsed.data.error.code}: ${parsed.data.error.message}`
      : `${response.status} ${response.statusText} from ${response.url}`,
    status: response.status,
    ...(parsed.success ? { body: parsed.data } : {}),
    ...(requestId === undefined ? {} : { requestId }),
  })
}

/**
 * Builds the API client for one app.
 *
 * There is deliberately no module level singleton: each app constructs its own
 * with its own {@link AppId}, which is what keeps "shop, seller and admin are
 * three separate sessions" (DECISIONS 2장) true in code rather than by
 * convention. `credentials: 'include'` then sends only the cookies of the
 * origin the call was made from, so a browser tab logged into seller carries
 * nothing of shop.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = normaliseBaseUrl(options.baseUrl)
  const prefix = options.pathPrefix ?? API_PATH_PREFIX
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init))

  async function request<TResult>({
    path,
    schema,
    method = 'GET',
    body,
    signal,
    timeoutMs,
  }: ApiRequestOptions<TResult>): Promise<TResult> {
    const url = buildUrl(baseUrl, prefix, path)
    const deadline = AbortSignal.timeout(timeoutMs ?? defaultTimeoutMs)
    const hasBody = body !== undefined

    let response: Response
    try {
      response = await doFetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          [APP_ID_HEADER]: options.appId,
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(body) } : {}),
        // Cookies are per origin and carry the session of this app alone.
        credentials: 'include',
        // Liveness data is never reused; Next.js would otherwise cache it.
        cache: 'no-store',
        signal: signal === undefined ? deadline : AbortSignal.any([deadline, signal]),
      })
    } catch (error) {
      throw classifyTransportFailure(error, url, signal?.aborted ?? false)
    }

    const payload = await readJson(response)
    if (!response.ok) throw httpFailure(response, payload)

    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      const requestId = requestIdOf(response)

      throw new ApiClientError({
        kind: 'malformed_response',
        message: `Response from ${url} does not match its schema: ${parsed.error.message}`,
        status: response.status,
        ...(requestId === undefined ? {} : { requestId }),
      })
    }
    return parsed.data
  }

  return {
    appId: options.appId,
    baseUrl,
    request,
    getHealth: (callOptions = {}) =>
      request({ path: '/health', schema: healthResponseSchema, ...callOptions }),

    getCategoryTree: (query = {}, callOptions = {}) =>
      request({
        path: `/categories${categoryTreeSearch(query)}`,
        schema: categoryTreeResponseSchema,
        ...callOptions,
      }),

    getStorefrontCategoryTree: (callOptions = {}) =>
      request({
        path: '/categories/tree',
        schema: categoryTreeResponseSchema,
        ...callOptions,
      }),

    getStorefrontSeller: (id, callOptions = {}) =>
      request({
        path: `/sellers/${encodeURIComponent(id)}`,
        schema: storefrontSellerResponseSchema,
        ...callOptions,
      }),

    getStorefrontProduct: (id, callOptions = {}) =>
      request({
        path: `/products/${encodeURIComponent(id)}/detail`,
        schema: productDetailResponseSchema,
        ...callOptions,
      }),

    createCategory: (body, callOptions = {}) =>
      request({
        path: '/categories',
        method: 'POST',
        body,
        schema: categoryResponseSchema,
        ...callOptions,
      }),

    updateCategory: (id, body, callOptions = {}) =>
      request({
        path: `/categories/${String(id)}`,
        method: 'PATCH',
        body,
        schema: categoryResponseSchema,
        ...callOptions,
      }),

    moveCategory: (id, body, callOptions = {}) =>
      request({
        path: `/categories/${String(id)}/move`,
        method: 'POST',
        body,
        schema: categoryResponseSchema,
        ...callOptions,
      }),

    reorderCategories: (body, callOptions = {}) =>
      request({
        path: '/categories/reorder',
        method: 'POST',
        body,
        schema: categoryListResponseSchema,
        ...callOptions,
      }),

    deleteCategory: (id, callOptions = {}) =>
      request({
        path: `/categories/${String(id)}`,
        method: 'DELETE',
        schema: categoryResponseSchema,
        ...callOptions,
      }),

    getAttributes: (query, callOptions = {}) =>
      request({
        path: `/attributes${attributeListSearch(query)}`,
        schema: attributeListResponseSchema,
        ...callOptions,
      }),

    createAttribute: (body, callOptions = {}) =>
      request({
        path: '/attributes',
        method: 'POST',
        body,
        schema: attributeResponseSchema,
        ...callOptions,
      }),

    updateAttribute: (id, body, callOptions = {}) =>
      request({
        path: `/attributes/${String(id)}`,
        method: 'PATCH',
        body,
        schema: attributeResponseSchema,
        ...callOptions,
      }),

    deleteAttribute: (id, callOptions = {}) =>
      request({
        path: `/attributes/${String(id)}`,
        method: 'DELETE',
        schema: attributeResponseSchema,
        ...callOptions,
      }),

    getProducts: (query = {}, callOptions = {}) =>
      request({
        path: `/products${productListSearch(query)}`,
        schema: productListResponseSchema,
        ...callOptions,
      }),

    getProduct: (id, callOptions = {}) =>
      request({ path: `/products/${id}`, schema: productResponseSchema, ...callOptions }),

    createProduct: (body, callOptions = {}) =>
      request({
        path: '/products',
        method: 'POST',
        body,
        schema: productResponseSchema,
        ...callOptions,
      }),

    updateProduct: (id, body, callOptions = {}) =>
      request({
        path: `/products/${id}`,
        method: 'PATCH',
        body,
        schema: productResponseSchema,
        ...callOptions,
      }),

    publishProduct: (id, body, callOptions = {}) =>
      request({
        path: `/products/${id}/publish`,
        method: 'POST',
        body,
        schema: productResponseSchema,
        ...callOptions,
      }),

    unpublishProduct: (id, body, callOptions = {}) =>
      request({
        path: `/products/${id}/unpublish`,
        method: 'POST',
        body,
        schema: productResponseSchema,
        ...callOptions,
      }),

    deleteProduct: (id, callOptions = {}) =>
      request({
        path: `/products/${id}`,
        method: 'DELETE',
        schema: productResponseSchema,
        ...callOptions,
      }),

    getSellerProducts: (query = {}, callOptions = {}) =>
      request({
        path: `/seller/products${sellerProductListSearch(query)}`,
        schema: sellerProductListResponseSchema,
        ...callOptions,
      }),

    getSellerProductVariants: (id, callOptions = {}) =>
      request({
        path: `/seller/products/${id}/variants`,
        schema: sellerVariantListResponseSchema,
        ...callOptions,
      }),

    changeProductStatuses: (body, callOptions = {}) =>
      request({
        path: '/seller/products/status',
        method: 'POST',
        body,
        schema: productBulkStatusResponseSchema,
        ...callOptions,
      }),

    duplicateProduct: (id, callOptions = {}) =>
      request({
        path: `/seller/products/${id}/duplicate`,
        method: 'POST',
        body: {},
        schema: productResponseSchema,
        ...callOptions,
      }),

    adjustVariantStock: (id, body, callOptions = {}) =>
      request({
        path: `/variants/${id}/stock-adjustments`,
        method: 'POST',
        body,
        schema: stockAdjustResponseSchema,
        ...callOptions,
      }),

    getVariantLedger: (id, query = {}, callOptions = {}) =>
      request({
        path: `/variants/${id}/ledger${stockLedgerSearch(query)}`,
        schema: stockLedgerResponseSchema,
        ...callOptions,
      }),

    presignUpload: (body, callOptions = {}) =>
      request({
        path: '/uploads/presign',
        method: 'POST',
        body,
        schema: presignUploadResponseSchema,
        ...callOptions,
      }),
  }
}

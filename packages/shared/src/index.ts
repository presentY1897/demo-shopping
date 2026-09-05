export {
  apiErrorSchema,
  apiFieldErrorSchema,
  httpErrorCodeSchema,
  isApiErrorBody,
  isApiFieldError,
} from './api-error.js'
export type { ApiErrorBody, ApiFieldError, HttpErrorCode } from './api-error.js'
export { domainErrorCodes, isDomainErrorCode, userFacingErrorCodes } from './api/error-codes.js'
export type { DomainErrorCode, UserFacingErrorCode } from './api/error-codes.js'
export { healthDependencyKeys, healthResponseSchema, healthStatusSchema } from './health.js'
export type { HealthDependencyKey, HealthResponse, HealthStatus } from './health.js'
export {
  ApiClientError,
  ApiConfigurationError,
  apiErrorKinds,
  isApiClientError,
} from './api/api-client-error.js'
export type { ApiClientErrorInit, ApiErrorKind } from './api/api-client-error.js'
export {
  apiFailure,
  apiFailureReasons,
  failureMessage,
  hasCode,
  quotableRequestId,
} from './api/api-failure.js'
export type { ApiFailure, ApiFailureReason } from './api/api-failure.js'
export {
  attributeFilterSchema,
  facetCountsSchema,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_SUGGEST_LIMIT,
  searchFilterSchema,
  searchFiltersResponseSchema,
  searchHitSchema,
  searchQuerySchema,
  searchResponseSchema,
  searchSorts,
  searchSortSchema,
  searchSuggestResponseSchema,
  searchTermSchema,
} from './api/search.js'
export type {
  AttributeFilter,
  FacetCounts,
  SearchFilter,
  SearchFiltersResponse,
  SearchHit,
  SearchQuery,
  SearchResponse,
  SearchSort,
  SearchSuggestResponse,
} from './api/search.js'
export { errorMessage, firstFieldError, interpolate, paramsOf } from './api/error-messages.js'
export type { ErrorMessages, ErrorParams } from './api/error-messages.js'
export { APP_ID_HEADER, appIds, isAppId } from './api/app-id.js'
export type { AppId } from './api/app-id.js'
export {
  API_PATH_PREFIX,
  createApiClient,
  DEFAULT_TIMEOUT_MS,
  REQUEST_ID_HEADER,
} from './api/client.js'
export type {
  ApiCallOptions,
  ApiClient,
  ApiClientOptions,
  ApiRequestOptions,
  FetchLike,
} from './api/client.js'
export {
  ATTRIBUTE_KEY_PATTERN,
  ATTRIBUTE_MAX_OPTIONS,
  ATTRIBUTE_TEXT_MAX_LENGTH,
  attributeDefinitionSchema,
  attributeIdSchema,
  attributeKeySchema,
  attributeLabelSchema,
  attributeListQueryParamsSchema,
  attributeListQuerySchema,
  attributeListResponseSchema,
  attributeOptionSchema,
  attributeOptionsSchema,
  attributeResponseSchema,
  attributeTypeHasOptions,
  attributeTypes,
  attributeTypeSchema,
  attributeTypesWithOptions,
  attributeValueSchema,
  attributeValuesSchema,
  createAttributeRequestSchema,
  effectiveAttributeSchema,
  optionIssues,
  updateAttributeRequestSchema,
} from './api/attributes.js'
export type {
  AttributeDefinition,
  AttributeListQuery,
  AttributeListResponse,
  AttributeResponse,
  AttributeType,
  AttributeValue,
  AttributeValues,
  CreateAttributeRequest,
  EffectiveAttribute,
  UpdateAttributeRequest,
} from './api/attributes.js'
export {
  createProductRequestSchema,
  LOW_STOCK_THRESHOLD,
  optionNameSchema,
  optionValueMetaSchema,
  optionValueSchema,
  PRODUCT_BULK_STATUS_MAX,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_LIST_DEFAULT_LIMIT,
  PRODUCT_LIST_MAX_LIMIT,
  PRODUCT_MAX_IMAGES,
  PRODUCT_MAX_OPTION_VALUES,
  PRODUCT_MAX_OPTIONS,
  PRODUCT_MAX_PRICE,
  PRODUCT_MAX_PURCHASE_QUANTITY,
  PRODUCT_MAX_STOCK,
  PRODUCT_MAX_VARIANTS,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_SEARCH_MAX_LENGTH,
  priceSchema,
  productBulkStatusRequestSchema,
  productBulkStatusResponseSchema,
  productDescriptionSchema,
  productIdSchema,
  productImageInputSchema,
  productImageSchema,
  productListQueryParamsSchema,
  productListQuerySchema,
  productListResponseSchema,
  productNameSchema,
  productOptionInputSchema,
  productOptionSchema,
  productOptionValueSchema,
  productPublishRequestSchema,
  productDetailResponseSchema,
  productResponseSchema,
  productSchema,
  productSearchSchema,
  productStatuses,
  productStatusSchema,
  productSummarySchema,
  productVariantInputSchema,
  productVariantSchema,
  purchaseLimitSchema,
  sellerProductListItemSchema,
  sellerProductListQueryParamsSchema,
  sellerProductListQuerySchema,
  sellerProductListResponseSchema,
  sellerSettableStatuses,
  sellerStockFilters,
  sellerStockFilterSchema,
  sellerVariantListResponseSchema,
  sellerVariantSchema,
  SKU_PATTERN,
  SKU_PREFIX_PATTERN,
  skuPrefixSchema,
  skuSchema,
  stockSchema,
  updateProductRequestSchema,
  variantDefaultsSchema,
  variantIdSchema,
} from './api/products.js'
export type {
  CreateProductRequest,
  OptionValueMeta,
  Product,
  ProductBulkStatusRequest,
  ProductBulkStatusResponse,
  ProductImage,
  ProductImageInput,
  ProductListQuery,
  ProductListResponse,
  ProductOption,
  ProductOptionInput,
  ProductOptionValue,
  ProductPublishRequest,
  ProductDetailResponse,
  ProductResponse,
  ProductStatus,
  ProductSummary,
  ProductVariant,
  ProductVariantInput,
  SellerProductListItem,
  SellerProductListQuery,
  SellerProductListResponse,
  SellerStockFilter,
  SellerVariant,
  SellerVariantListResponse,
  UpdateProductRequest,
  VariantDefaults,
} from './api/products.js'
export {
  sellerStockAdjustTypes,
  sellerStockAdjustTypeSchema,
  STOCK_LEDGER_DEFAULT_LIMIT,
  STOCK_LEDGER_MAX_LIMIT,
  STOCK_MAX_MOVEMENT,
  STOCK_REASON_MAX_LENGTH,
  stockAdjustRequestSchema,
  stockAdjustResponseSchema,
  stockLedgerEntrySchema,
  stockLedgerQueryParamsSchema,
  stockLedgerQuerySchema,
  stockLedgerResponseSchema,
  stockLedgerTypes,
  stockLedgerTypeSchema,
  stockMovementQuantitySchema,
  stockReasonSchema,
  stockReconciliationFaults,
  stockRefTypes,
  stockRefTypeSchema,
  variantStockSchema,
} from './api/stock.js'
export type {
  SellerStockAdjustType,
  StockAdjustRequest,
  StockAdjustResponse,
  StockLedgerEntry,
  StockLedgerQuery,
  StockLedgerResponse,
  StockLedgerType,
  StockReconciliationFault,
  StockRefType,
  VariantStock,
} from './api/stock.js'
export {
  CATEGORY_MAX_DEPTH,
  categoryIdSchema,
  categoryListResponseSchema,
  categoryNameSchema,
  categoryNodeSchema,
  categoryResponseSchema,
  categorySlugSchema,
  categoryTreeNodeSchema,
  categoryTreeQueryParamsSchema,
  categoryTreeQuerySchema,
  categoryTreeResponseSchema,
  createCategoryRequestSchema,
  moveCategoryRequestSchema,
  reorderCategoriesRequestSchema,
  updateCategoryRequestSchema,
} from './api/categories.js'
export type {
  CategoryListResponse,
  CategoryNode,
  CategoryResponse,
  CategoryTreeNode,
  CategoryTreeQuery,
  CategoryTreeResponse,
  CreateCategoryRequest,
  MoveCategoryRequest,
  ReorderCategoriesRequest,
  UpdateCategoryRequest,
} from './api/categories.js'
export { healthEntries } from './api/health-entries.js'
export {
  presignedUploadSchema,
  presignUploadRequestSchema,
  presignUploadResponseSchema,
  productImageKeyPattern,
  productImageKeySchema,
  UPLOAD_MAX_BYTES,
  UPLOAD_URL_TTL_SECONDS,
  uploadContentTypes,
  uploadContentTypeSchema,
  uploadFilenameSchema,
  uploadImageExtensions,
  uploadImageFormats,
  uploadPurposes,
  uploadPurposeSchema,
  uploadSizeSchema,
} from './api/uploads.js'
export type {
  PresignedUpload,
  PresignUploadRequest,
  PresignUploadResponse,
  UploadContentType,
  UploadPurpose,
} from './api/uploads.js'
export type { HealthEntry } from './api/health-entries.js'
export {
  buildOauthRedirect,
  googleAuthorizeQuerySchema,
  LOGIN_PATH,
  OAUTH_RESULT_PARAMS,
  oauthFailureReasons,
  oauthNotices,
  oauthOutcomes,
  oauthResultSchema,
  parseOauthResult,
} from './api/google-auth.js'
export type {
  GoogleAuthorizeQuery,
  OauthFailureReason,
  OauthNotice,
  OauthOutcome,
  OauthResult,
} from './api/google-auth.js'

export { sessionFailureReasons, sessionResponseSchema } from './api/session.js'
export type { SessionFailureReason, SessionResponse } from './api/session.js'

export {
  DEMO_ACCOUNT_TTL_HOURS,
  DEMO_ISSUE_LIMIT,
  DEMO_ISSUE_WINDOW_SECONDS,
  demoAccountSchema,
  demoIssueRequestSchema,
  demoIssueResponseSchema,
  demoRoles,
  demoRoleSchema,
  demoStatusResponseSchema,
} from './api/demo.js'
export type {
  DemoAccount,
  DemoIssueRequest,
  DemoIssueResponse,
  DemoRole,
  DemoStatusResponse,
} from './api/demo.js'

export { grantRoleRequestSchema, userRolesResponseSchema } from './api/user-roles.js'
export type { GrantRoleRequest, UserRolesResponse } from './api/user-roles.js'

export {
  addressCreateRequestSchema,
  addressLabelSchema,
  addressLineSchema,
  addressListResponseSchema,
  addressResponseSchema,
  addressSchema,
  addressUpdateRequestSchema,
  DEFAULT_USER_PREFERENCE,
  displayDensities,
  displayDensitySchema,
  phoneSchema,
  postalCodeSchema,
  profileNameSchema,
  profileResponseSchema,
  profileSchema,
  profileUpdateRequestSchema,
  recipientNameSchema,
  userPreferenceResponseSchema,
  userPreferenceSchema,
  userPreferenceUpdateRequestSchema,
  withdrawalResponseSchema,
} from './api/profile.js'
export type {
  Address,
  AddressCreateRequest,
  AddressListResponse,
  AddressResponse,
  AddressUpdateRequest,
  DisplayDensity,
  Profile,
  ProfileResponse,
  ProfileUpdateRequest,
  UserPreference,
  UserPreferenceResponse,
  UserPreferenceUpdateRequest,
  WithdrawalResponse,
} from './api/profile.js'
export {
  brandNameAvailabilityQuerySchema,
  brandNameAvailabilityResponseSchema,
  SELLER_BRAND_NAME_MAX_LENGTH,
  SELLER_BRAND_NAME_MIN_LENGTH,
  SELLER_INTRODUCTION_MAX_LENGTH,
  SELLER_REVIEW_LIST_DEFAULT_LIMIT,
  SELLER_REVIEW_LIST_MAX_LIMIT,
  SELLER_STATUS_REASON_MAX_LENGTH,
  sellerApplicationRequestSchema,
  sellerBrandNameSchema,
  sellerDecisionRequestSchema,
  sellerIdSchema,
  sellerIntroductionSchema,
  sellerLogoUrlSchema,
  sellerReasonedDecisionRequestSchema,
  sellerResponseSchema,
  storefrontSellerResponseSchema,
  storefrontSellerSchema,
  sellerReviewListQueryParamsSchema,
  sellerReviewListQuerySchema,
  sellerReviewListResponseSchema,
  sellerSchema,
  sellerSlugSchema,
  sellerStatuses,
  sellerStatusReasonSchema,
  sellerStatusSchema,
  sellerStoreUpdateRequestSchema,
} from './api/sellers.js'
export type {
  BrandNameAvailabilityQuery,
  BrandNameAvailabilityResponse,
  Seller,
  SellerApplicationRequest,
  SellerDecisionRequest,
  SellerReasonedDecisionRequest,
  SellerResponse,
  StorefrontSeller,
  StorefrontSellerResponse,
  SellerReviewListQuery,
  SellerReviewListResponse,
  SellerStatus,
  SellerStoreUpdateRequest,
} from './api/sellers.js'
export {
  authorizePermission,
  authorizeResource,
  canAccessResource,
  canPerform,
  denialReasons,
  grantedScopes,
  scopeAdmits,
} from './auth/authorize.js'
export type { AccessDecision, AuthorizationSubject, DenialReason } from './auth/authorize.js'
export { renderPermissionMatrix } from './auth/permission-matrix.js'
export {
  isPermission,
  isReadPermission,
  permissionAction,
  permissionResource,
  permissions,
} from './auth/permissions.js'
export type { Permission } from './auth/permissions.js'
export { platformOwnership, resourceScopes } from './auth/resource-scope.js'
export type { ResourceOwnership, ResourceScope } from './auth/resource-scope.js'
export { rolePermissions } from './auth/role-permissions.js'
export type { PermissionGrant } from './auth/role-permissions.js'
export { isRole, roleSchema, roles } from './auth/roles.js'
export type { Role } from './auth/roles.js'

export {
  CHOSUNG_MIN_LENGTH,
  chosungOf,
  classifyHangulQuery,
  decomposeChar,
  decomposeHangul,
  hangulIndexFields,
  hangulQueryFor,
} from './hangul.js'
export type { HangulQueryKind } from './hangul.js'

export {
  addCartItemRequestSchema,
  CART_ITEM_MAX_QUANTITY,
  CART_MAX_ITEMS,
  cartGroupSchema,
  cartItemNoticeSchema,
  cartItemSchema,
  cartQuantitySchema,
  cartResponseSchema,
  mergeCartRequestSchema,
  removeCartItemsRequestSchema,
  updateCartItemRequestSchema,
} from './api/cart.js'
export type {
  AddCartItemRequest,
  CartGroup,
  CartItem,
  CartItemNotice,
  CartResponse,
  MergeCartRequest,
  RemoveCartItemsRequest,
  UpdateCartItemRequest,
} from './api/cart.js'

export { allocate } from './pricing/allocate.js'
export type { AllocationShare } from './pricing/allocate.js'
export { calculateOrder } from './pricing/calculate.js'
export { quoteRefund } from './pricing/refund.js'
export type { RefundQuote } from './pricing/refund.js'
export {
  discountBearers,
  discountScopes,
  discountTypes,
  pricingDiscountSchema,
  pricingItemSchema,
  shippingPolicySchema,
  wonSchema,
} from './pricing/types.js'
export type {
  DiscountBearer,
  DiscountScope,
  DiscountType,
  PricedItem,
  PricedOrder,
  PricedSellerOrder,
  PricingDiscount,
  PricingInput,
  PricingItem,
  ShippingPolicy,
} from './pricing/types.js'

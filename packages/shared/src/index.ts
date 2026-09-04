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
export { ApiClientError, apiErrorKinds, isApiClientError } from './api/api-client-error.js'
export type { ApiClientErrorInit, ApiErrorKind } from './api/api-client-error.js'
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
  optionNameSchema,
  optionValueMetaSchema,
  optionValueSchema,
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
  priceSchema,
  productDescriptionSchema,
  productIdSchema,
  productImageSchema,
  productListQueryParamsSchema,
  productListQuerySchema,
  productListResponseSchema,
  productNameSchema,
  productOptionSchema,
  productOptionValueSchema,
  productResponseSchema,
  productSchema,
  productStatuses,
  productStatusSchema,
  productSummarySchema,
  productVariantSchema,
  purchaseLimitSchema,
  sellerSettableStatuses,
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
  ProductImage,
  ProductListQuery,
  ProductListResponse,
  ProductOption,
  ProductOptionValue,
  ProductResponse,
  ProductStatus,
  ProductSummary,
  ProductVariant,
  UpdateProductRequest,
  VariantDefaults,
} from './api/products.js'
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
export { grantRoleRequestSchema, userRolesResponseSchema } from './api/user-roles.js'
export type { GrantRoleRequest, UserRolesResponse } from './api/user-roles.js'
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

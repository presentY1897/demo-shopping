export { apiErrorSchema, httpErrorCodeSchema, isApiErrorBody } from './api-error.js'
export type { ApiErrorBody, HttpErrorCode } from './api-error.js'
export { healthDependencyKeys, healthResponseSchema, healthStatusSchema } from './health.js'
export type { HealthDependencyKey, HealthResponse, HealthStatus } from './health.js'
export { ApiClientError, apiErrorKinds, isApiClientError } from './api/api-client-error.js'
export type { ApiClientErrorInit, ApiErrorKind } from './api/api-client-error.js'
export { APP_ID_HEADER, appIds, isAppId } from './api/app-id.js'
export type { AppId } from './api/app-id.js'
export { API_PATH_PREFIX, createApiClient, DEFAULT_TIMEOUT_MS } from './api/client.js'
export type {
  ApiCallOptions,
  ApiClient,
  ApiClientOptions,
  ApiRequestOptions,
  FetchLike,
} from './api/client.js'
export { healthEntries } from './api/health-entries.js'
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

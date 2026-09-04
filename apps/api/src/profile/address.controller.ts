import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import type { AddressListResponse, AddressResponse } from '@shopping/shared'
import { addressCreateRequestSchema, addressUpdateRequestSchema } from '@shopping/shared'
import { z } from 'zod'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { AddressService } from './address.service.js'

/** Ids are UUIDv7; anything else is a bad request, not a database error. */
const addressIdSchema = z.uuid()

/**
 * The address book, always the caller's own (TASK-0111).
 *
 * `:id` names an **address**, never an account — the account is `/me`. So the
 * only thing an identifier here can reach is a row the service then checks
 * belongs to the caller, and a foreign id is a 403 rather than an edit.
 *
 * Reading needs `user.read`, every change needs `profile.write`. There is no
 * `address.*` permission: a saved address is part of one's own account, and a
 * separate permission would be one more thing to remember to grant without
 * meaning anything different (TASK-0105 4장 — 퍼미션은 닫힌 목록이다).
 */
@Controller({ path: 'me/addresses', version: '1' })
export class AddressController {
  constructor(private readonly addresses: AddressService) {}

  @Get()
  @RequirePermission('user.read')
  list(@Principal() principal: RequestPrincipal): Promise<AddressListResponse> {
    return this.addresses.list(principal)
  }

  @Post()
  @RequirePermission('profile.write')
  create(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<AddressResponse> {
    return this.addresses.create(principal, parseInput(addressCreateRequestSchema, body))
  }

  @Patch(':id')
  @RequirePermission('profile.write')
  update(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AddressResponse> {
    return this.addresses.update(
      principal,
      parseInput(addressIdSchema, id, 'id'),
      parseInput(addressUpdateRequestSchema, body),
    )
  }

  @Delete(':id')
  @RequirePermission('profile.write')
  remove(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<AddressResponse> {
    return this.addresses.remove(principal, parseInput(addressIdSchema, id, 'id'))
  }

  /**
   * Promotion, as its own endpoint rather than a field on the update.
   *
   * 200 and not 201: nothing is created, and the answer is the address that is
   * now the default. `POST` because it is neither idempotent in its effect on
   * the *other* rows nor a description of this one — it moves a flag that
   * exactly one address in the account may hold.
   */
  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('profile.write')
  makeDefault(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<AddressResponse> {
    return this.addresses.makeDefault(principal, parseInput(addressIdSchema, id, 'id'))
  }
}

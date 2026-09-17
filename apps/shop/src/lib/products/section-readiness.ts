'use client'

import { createContext } from 'react'

/**
 * Where the home's wake-up stands, as a product row needs to know it
 * (TASK-0143 4.3).
 *
 * - `pending` — still asking. A row that has nothing to show yet says nothing
 *   about it: the gate is the one explaining the wait, and the flip to `ready`
 *   is what makes the row read again
 * - `ready` — the API is up and so is search. A failure now is a failure
 * - `failed` — the budget ended first. Nobody is going to ask again unless the
 *   visitor does, so a row with nothing to show has to say so
 */
export type SectionReadinessState = 'pending' | 'ready' | 'failed'

// Sections outside the home gate can fetch immediately.
export const SectionReadiness = createContext<SectionReadinessState>('ready')

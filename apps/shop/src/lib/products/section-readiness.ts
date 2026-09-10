'use client'

import { createContext } from 'react'

// Sections outside the home gate can fetch immediately.
export const SectionReadiness = createContext(true)

import { Logger } from '@nestjs/common'

// The exception filter and the health indicator log on purpose. In a unit test
// that output is noise, and a wall of stack traces hides the actual failure.
Logger.overrideLogger(false)

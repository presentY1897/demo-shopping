#!/usr/bin/env node
// Blocks `npm install` / `yarn install`. Runs as the root `preinstall` script,
// so it must not depend on anything that is not already installed.

const agent = process.env.npm_config_user_agent ?? ''
const manager = agent.split('/')[0] || 'unknown'

if (manager !== 'pnpm') {
  console.error(
    [
      '',
      `이 저장소는 pnpm 전용입니다. (감지된 패키지 매니저: ${manager})`,
      '',
      '  corepack enable',
      '  pnpm install',
      '',
      'npm / yarn 으로 설치하면 워크스페이스 링크와 잠금 파일이 깨집니다.',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

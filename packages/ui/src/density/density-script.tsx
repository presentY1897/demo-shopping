/**
 * The script that decides the first paint.
 *
 * The server cannot know which density this visitor picked — localStorage is not
 * sent with the request — so the markup ships `DEFAULT_DENSITY` and this script
 * corrects it. It has to run *before* the first paint, which is why it is an
 * inline blocking script in `<head>` rather than an effect: an effect runs after
 * paint, and the visitor would watch the page reflow from standard to maximal on
 * every single navigation.
 *
 * The correction changes an attribute the server already rendered, so the
 * `<html>` element carries `suppressHydrationWarning` in the layout. That is
 * scoped to that one element's own attributes and does not hide anything else.
 */

import {
  DEFAULT_DENSITY,
  DENSITY_ATTRIBUTE,
  DENSITY_STORAGE_KEY,
  type DensityLevel,
} from './density'

/**
 * Source of the boot script, as a string, so it can be executed in a test rather
 * than reviewed by eye.
 *
 * @param serverDensity The signed-in shopper's stored preference
 *   (`UserPreference`, M04). When present it beats localStorage and is mirrored
 *   into it, so the next anonymous visit on this device agrees with the account.
 */
export function densityBootScript(serverDensity: DensityLevel | null = null): string {
  const server = serverDensity === null ? 'null' : String(serverDensity)

  // Written as one expression with short names because it is parsed and run on
  // the critical path of every page load, and it is never read by a bundler.
  return [
    '(function(){',
    'var e=document.documentElement,s=',
    server,
    ',v=null;',
    'try{v=window.localStorage.getItem(',
    JSON.stringify(DENSITY_STORAGE_KEY),
    ')}catch(_){}',
    'var n=s===null?Number(v):s;',
    'if(n!==1&&n!==2&&n!==3)n=',
    String(DEFAULT_DENSITY),
    ';',
    'e.setAttribute(',
    JSON.stringify(DENSITY_ATTRIBUTE),
    ',String(n));',
    'if(s!==null){try{window.localStorage.setItem(',
    JSON.stringify(DENSITY_STORAGE_KEY),
    ',String(s))}catch(_){}}',
    '})()',
  ].join('')
}

interface DensityScriptProps {
  readonly serverDensity?: DensityLevel | null
}

/**
 * Renders the boot script. Belongs in the root layout's `<head>`, above the
 * content, and only in `apps/shop` — the console apps pin their density in the
 * markup and have nothing to correct.
 */
export function DensityScript({ serverDensity = null }: DensityScriptProps) {
  // The only interpolated value is a number this module produced, so there is
  // no string from outside the process anywhere in this markup.
  return <script dangerouslySetInnerHTML={{ __html: densityBootScript(serverDensity) }} />
}

import { IGDB_PLATFORM_CODES, PLATFORM_TABLE } from './platforms.generated.js'

/**
 * Platform shortcodes as they appear in a list item's `tags`, in filter order
 * (10.24c). The table itself is the owner's `config/platforms.csv`, generated
 * into `platforms.generated.ts`; this module is the one place a tag is read
 * against it. Shared and browser-safe (no Node builtins): the facet derivation,
 * the platform chip and popover, the IGDB importer and the list checker all use it.
 *
 * `multi` is a claim, not a platform: the same content everywhere, platforms unnamed.
 */

const MULTI = { code: 'MULTI', name: 'Multi-platform' }

/** Lower-cased code → full name. For the order, read `PLATFORM_ORDER`. */
export const PLATFORMS: Readonly<Record<string, string>> = Object.fromEntries([
  ...PLATFORM_TABLE.map(({ code, name }) => [code.toLowerCase(), name] as const),
  ['multi', MULTI.name] as const,
])

/**
 * The table's own filter order — an unknown code sorts after all of these.
 * Built from the table, never from `Object.keys(PLATFORMS)`: an object lists
 * number-like keys (2600, 5200, 7800) first, whatever order they were added in.
 */
export const PLATFORM_ORDER: readonly string[] = [...PLATFORM_TABLE.map(({ code }) => code.toLowerCase()), 'multi']

const CODES: Readonly<Record<string, string>> = Object.fromEntries([
  ...PLATFORM_TABLE.map(({ code }) => [code.toLowerCase(), code] as const),
  ['multi', MULTI.code] as const,
])

/**
 * Tags written before the table existed, read as today's codes: the prototype's
 * 28 codes that the owner's table spells differently (PC is WIN, NDS is DS…) and
 * the IGDB abbreviations the importer stored as plain text until 10.24c
 * (GENESIS/MEGADRIVE is GEN). Read-time only, so nothing in a database is
 * rewritten. Built once from the importer's old output against the new table;
 * none of these keys is a code in the table (a test checks).
 */
export const LEGACY_PLATFORM_TAGS: Readonly<Record<string, string>> = {
  "64dd": "N64",
  "acorn archimedes": "ACORN",
  "acorn electron": "ELK",
  "acpc": "CPC",
  "amiga": "AMI",
  "amiga cd32": "AMI",
  "analogueelectronics": "ANAL",
  "android": "AND",
  "apcw": "PCW",
  "apple][": "AP2",
  "arcade": "COIN",
  "arduboy": "ABOY",
  "astrocade": "ASTR",
  "atari-st": "ST",
  "atari2600": "2600",
  "atari5200": "5200",
  "atari7800": "7800",
  "atari8bit": "A8",
  "bbcmicro": "BBCM",
  "blackberry": "BBOS",
  "browser": "WEB",
  "c+4": "C16",
  "call-a-computer": "CAC",
  "cdccyber70": "CDCC",
  "colecovision": "COL",
  "cpet": "PET",
  "donner30": "ANAL",
  "evercade": "ECADE",
  "famicom": "NES",
  "fds": "NES",
  "gamate": "GMT",
  "game gear": "GG",
  "gc": "GCN",
  "gear vr": "VR",
  "genesis/megadrive": "GEN",
  "handheld": "HAND",
  "imlac-pds1": "PDS1",
  "intellivision": "INTV",
  "jaguar": "JAG",
  "linux": "LIN",
  "lynx": "LNX",
  "meta quest 2": "VR",
  "meta quest 3": "VR",
  "microcomputer": "MC",
  "microvision": "MBMV",
  "mobile": "CELL",
  "nds": "DS",
  "neogeoaes": "AES",
  "neogeomvs": "MVS",
  "new 3ds": "3DS",
  "oculus vr": "VR",
  "odyssey": "ODY",
  "pc": "WIN",
  "pdp-7": "PDP7",
  "pdp-8": "PDP8",
  "philips cdi": "CDI",
  "playdate": "PDT",
  "psvr": "VR",
  "psvr2": "VR",
  "saturn": "SAT",
  "sdssigma7": "SDSS",
  "sega cd": "SCD",
  "sega32": "32X",
  "sfam": "SNES",
  "sg1000": "SG1K",
  "steam vr": "VR",
  "supergrafx": "PCE2",
  "switch": "NSW",
  "switch 2": "NSW2",
  "ti-99": "TI99",
  "turbografx16": "PCE",
  "vectrex": "VEC",
  "vic-20": "VIC",
  "virtualboy": "VB",
  "win phone": "WINP",
  "wonderswan": "WS",
  "zxs": "ZX",
}

/** A tag as the key it counts under: lower-cased, and an old code read as today's. */
export function platformKey(tag: string): string {
  const key = tag.trim().toLowerCase()
  const legacy = LEGACY_PLATFORM_TAGS[key]
  return legacy ? legacy.toLowerCase() : key
}

/** A tag as it is shown: the code as the table writes it, or an unknown tag in capitals. */
export function platformCode(tag: string): string {
  const key = platformKey(tag)
  return CODES[key] ?? tag.trim().toUpperCase()
}

/** A tag's full name, or null for a code the table does not know. */
export function platformName(tag: string): string | null {
  return PLATFORMS[platformKey(tag)] ?? null
}

/** The code for an IGDB platform id; undefined for one the table does not list. */
export function igdbPlatformCode(id: number): string | undefined {
  return IGDB_PLATFORM_CODES[id]
}

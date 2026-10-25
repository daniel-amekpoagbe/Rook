import { hostOf, newEntry, type Entry, type EntryType } from './vault'

export type ImportSource = 'chrome' | '1password' | 'bitwarden' | 'rook'

export interface ImportResult {
  source: ImportSource
  entries: Entry[]
  skipped: number
  warnings: string[]
}

export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
  chrome: 'Chrome',
  '1password': '1Password',
  bitwarden: 'Bitwarden',
  rook: 'Rook CSV',
}

type EntryFields = Partial<
  Pick<Entry, 'title' | 'username' | 'password' | 'url' | 'notes' | 'totp' | 'card' | 'identity'>
>

interface CsvTable {
  headers: string[]
  rows: string[][]
}

interface BitwardenFolder {
  id?: string
  name?: string
}

interface BitwardenUri {
  uri?: string
}

interface BitwardenLogin {
  username?: string
  password?: string
  totp?: string
  uris?: BitwardenUri[]
}

interface BitwardenCard {
  cardholderName?: string
  number?: string
  expMonth?: string
  expYear?: string
  code?: string
  pin?: string
}

interface BitwardenIdentity {
  firstName?: string
  middleName?: string
  lastName?: string
  email?: string
  phone?: string
  address1?: string
  address2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
}

interface BitwardenField {
  name?: string
  value?: string
}

interface BitwardenItem {
  type?: number | string
  name?: string
  notes?: string
  favorite?: boolean
  folderId?: string
  fields?: BitwardenField[]
  login?: BitwardenLogin
  card?: BitwardenCard
  identity?: BitwardenIdentity
}

interface BitwardenJson {
  encrypted?: boolean
  folders?: BitwardenFolder[]
  items?: BitwardenItem[]
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

function clean(value: string | undefined | null, max: number): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

function pick(map: Record<string, string>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = map[normalizeHeader(key)]
    if (value && value.trim()) return value
  }
  return undefined
}

function bool(value: string | undefined): boolean {
  return /^(1|true|yes|y)$/i.test(value?.trim() ?? '')
}

function splitTags(value: string | undefined, separator: 'space' | 'list'): string[] {
  if (!value?.trim()) return []
  const parts = separator === 'space' ? value.split(/\s+/) : value.split(/[,;]+/)
  return [
    ...new Set(
      parts
        .map((part) => part.trim().slice(0, 50))
        .filter(Boolean),
    ),
  ].slice(0, 30)
}

function totpSecret(value: string | undefined): string | undefined {
  const raw = clean(value, 200)
  if (!raw) return undefined
  if (!raw.toLowerCase().startsWith('otpauth://')) return raw
  try {
    return clean(new URL(raw).searchParams.get('secret') ?? undefined, 200)
  } catch {
    return undefined
  }
}

function mapType(value: string | undefined): EntryType | null {
  const type = value?.trim().toLowerCase() ?? ''
  if (!type) return null
  if (type === '1' || type === 'login' || type === 'password' || type === 'website') return 'login'
  if (type === '2' || type.includes('note')) return 'note'
  if (type === '3' || type.includes('card')) return 'card'
  if (type === '4' || type.includes('identity')) return 'identity'
  return null
}

function bitwardenType(value: number | string | undefined): EntryType | null {
  return mapType(value === undefined ? undefined : String(value))
}

function fallbackTitle(type: EntryType): string {
  return type === 'login'
    ? 'Imported login'
    : type === 'note'
      ? 'Imported note'
      : type === 'card'
        ? 'Imported card'
        : 'Imported identity'
}

function hasContent(map: Record<string, string>): boolean {
  return [
    'title',
    'name',
    'username',
    'password',
    'url',
    'website',
    'notes',
    'note',
    'loginuri',
    'loginusername',
    'loginpassword',
  ].some((key) => Boolean(pick(map, key)))
}

function fieldsFromMap(map: Record<string, string>, type: EntryType): EntryFields {
  const url = clean(pick(map, 'url', 'website', 'loginuri'), 2000)
  return {
    title: clean(pick(map, 'title', 'name'), 200) ?? hostOf(url) ?? fallbackTitle(type),
    username: clean(pick(map, 'username', 'loginusername'), 300),
    password: clean(pick(map, 'password', 'loginpassword'), 2000),
    url,
    notes: clean(pick(map, 'notes', 'note'), 20000),
    totp: totpSecret(pick(map, 'otpauth', 'otp', 'logintotp', 'totp')),
  }
}

function makeEntry(
  type: EntryType,
  fields: EntryFields,
  tags: string[] = [],
  favorite = false,
): Entry {
  const entry = newEntry(type, fields)
  entry.tags = tags
  entry.favorite = favorite
  return entry
}

function skippedWarning(skipped: number): string[] {
  return skipped > 0
    ? [`Skipped ${skipped} empty or unsupported row${skipped === 1 ? '' : 's'}.`]
    : []
}

export function parseCsv(text: string): CsvTable {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field)
      field = ''
      if (row.some((value) => value.trim() !== '')) rows.push(row)
      row = []
    } else if (character !== '\r') {
      field += character
    }
  }

  row.push(field)
  if (row.some((value) => value.trim() !== '')) rows.push(row)

  const [headerRow, ...dataRows] = rows
  if (!headerRow) throw new Error('The import file is empty.')

  const headers = headerRow.map((header) => header.replace(/^\uFEFF/, '').trim())
  return {
    headers,
    rows: dataRows.map((dataRow) => headers.map((_, index) => dataRow[index] ?? '')),
  }
}

function rowMap(headers: string[], row: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  headers.forEach((header, index) => {
    const key = normalizeHeader(header)
    if (key) map[key] = row[index] ?? ''
  })
  return map
}

function isEncryptedBackup(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const object = value as Record<string, unknown>
  return (
    typeof object.format === 'string' &&
    typeof object.ciphertext === 'string' &&
    typeof object.nonce === 'string' &&
    typeof object.kdf === 'object'
  )
}

function isBitwardenJson(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const object = value as Record<string, unknown>
  return Array.isArray(object.items)
}

export function detectImportSource(text: string): ImportSource {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('The import file is empty.')

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('That JSON file could not be parsed.')
    }
    if (isEncryptedBackup(parsed)) {
      throw new Error('That is an encrypted Rook backup. Use "Import backup" instead.')
    }
    if (isBitwardenJson(parsed)) return 'bitwarden'
    throw new Error('Unrecognized JSON import. Rook supports Bitwarden JSON and Rook encrypted backups.')
  }

  const { headers } = parseCsv(text)
  const keys = new Set(headers.map(normalizeHeader))
  if (
    keys.has('type') &&
    keys.has('title') &&
    keys.has('username') &&
    keys.has('password') &&
    keys.has('totp') &&
    keys.has('tags')
  ) {
    return 'rook'
  }
  if (
    keys.has('type') &&
    keys.has('name') &&
    (keys.has('loginuri') || keys.has('loginusername') || keys.has('loginpassword'))
  ) {
    return 'bitwarden'
  }
  if (keys.has('name') && keys.has('url') && keys.has('username') && keys.has('password')) {
    return 'chrome'
  }
  if (
    keys.has('title') &&
    (keys.has('url') || keys.has('website')) &&
    keys.has('username') &&
    keys.has('password')
  ) {
    return '1password'
  }
  if (keys.has('title') && keys.has('notes')) return '1password'
  throw new Error('Unrecognized CSV import. Supported: Chrome, 1Password, Bitwarden, and Rook CSV.')
}

function importChrome(text: string): ImportResult {
  const { headers, rows } = parseCsv(text)
  const entries: Entry[] = []
  let skipped = 0

  for (const row of rows) {
    const map = rowMap(headers, row)
    if (!hasContent(map)) {
      skipped += 1
      continue
    }
    const url = clean(pick(map, 'url'), 2000)
    entries.push(
      makeEntry('login', {
        title: clean(pick(map, 'name', 'title'), 200) ?? hostOf(url) ?? 'Imported login',
        username: clean(pick(map, 'username'), 300),
        password: clean(pick(map, 'password'), 2000),
        url,
        notes: clean(pick(map, 'note', 'notes'), 20000),
      }),
    )
  }

  return { source: 'chrome', entries, skipped, warnings: skippedWarning(skipped) }
}

function importOnePassword(text: string): ImportResult {
  const { headers, rows } = parseCsv(text)
  const entries: Entry[] = []
  let skipped = 0

  for (const row of rows) {
    const map = rowMap(headers, row)
    if (!hasContent(map)) {
      skipped += 1
      continue
    }
    const type =
      mapType(pick(map, 'type')) ??
      (pick(map, 'username', 'password', 'url', 'website') ? 'login' : 'note')
    const fields = fieldsFromMap(map, type)

    if (type === 'card') {
      fields.card = {
        number: clean(pick(map, 'cardnumber', 'number'), 40),
        holder: clean(pick(map, 'cardholder', 'cardholdername', 'holder'), 200),
        expiry: clean(pick(map, 'expiry', 'expiration'), 20),
        cvv: clean(pick(map, 'cvv', 'securitycode'), 10),
        pin: clean(pick(map, 'pin'), 20),
      }
    }
    if (type === 'identity') {
      fields.identity = {
        fullName: clean(pick(map, 'fullname', 'name'), 200),
        email: clean(pick(map, 'email'), 300),
        phone: clean(pick(map, 'phone'), 50),
        address: clean(pick(map, 'address'), 1000),
      }
    }

    entries.push(
      makeEntry(
        type,
        fields,
        splitTags(pick(map, 'tags'), 'list'),
        bool(pick(map, 'favorite')),
      ),
    )
  }

  return { source: '1password', entries, skipped, warnings: skippedWarning(skipped) }
}

function importBitwardenCsv(text: string): ImportResult {
  const { headers, rows } = parseCsv(text)
  const entries: Entry[] = []
  let skipped = 0

  for (const row of rows) {
    const map = rowMap(headers, row)
    if (!hasContent(map)) {
      skipped += 1
      continue
    }
    const type = mapType(pick(map, 'type')) ?? 'login'
    entries.push(
      makeEntry(
        type,
        fieldsFromMap(map, type),
        splitTags(pick(map, 'folder'), 'list'),
        bool(pick(map, 'favorite')),
      ),
    )
  }

  return { source: 'bitwarden', entries, skipped, warnings: skippedWarning(skipped) }
}

function customFields(value: BitwardenField[] | undefined): string | undefined {
  if (!Array.isArray(value)) return undefined
  const lines = value
    .map((field) => {
      if (!field || typeof field !== 'object') return ''
      const name = clean(field.name, 100)
      const fieldValue = clean(field.value, 500)
      return name && fieldValue ? `${name}: ${fieldValue}` : ''
    })
    .filter(Boolean)
  return lines.length > 0 ? lines.join('\n') : undefined
}

function cardExpiry(month: string | undefined, year: string | undefined): string | undefined {
  const cleanedMonth = clean(month, 2)
  const cleanedYear = clean(year, 4)
  if (!cleanedMonth || !cleanedYear) return undefined
  const shortYear = cleanedYear.length > 2 ? cleanedYear.slice(-2) : cleanedYear.padStart(2, '0')
  return clean(`${cleanedMonth.padStart(2, '0')}/${shortYear}`, 20)
}

function importBitwardenJson(text: string): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That Bitwarden JSON file could not be parsed.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('That JSON file does not look like a Bitwarden export.')
  }

  const root = parsed as BitwardenJson
  if (root.encrypted) {
    throw new Error('That Bitwarden export is encrypted. Export an unencrypted JSON or CSV instead.')
  }
  if (!Array.isArray(root.items)) {
    throw new Error('That JSON file does not look like a Bitwarden export.')
  }

  const folders = new Map(
    (root.folders ?? [])
      .map((folder) => [folder.id, clean(folder.name, 50)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1])),
  )
  const entries: Entry[] = []
  let skipped = 0

  for (const item of root.items) {
    const type = bitwardenType(item?.type)
    if (!type) {
      skipped += 1
      continue
    }

    const folder = item.folderId ? folders.get(item.folderId) : undefined
    const tags = folder ? [folder] : []
    const favorite = item.favorite === true
    const notes = [clean(item.notes, 20000), customFields(item.fields)].filter(Boolean).join('\n\n') || undefined

    if (type === 'login') {
      const login = item.login ?? {}
      const uris = Array.isArray(login.uris)
        ? login.uris.map((uri) => clean(uri?.uri, 2000)).filter(Boolean) as string[]
        : []
      const extraUrls = uris.slice(1)
      const loginNotes =
        [notes, extraUrls.length > 0 ? `Other URLs:\n${extraUrls.join('\n')}` : undefined]
          .filter(Boolean)
          .join('\n\n') || undefined

      entries.push(
        makeEntry(
          'login',
          {
            title: clean(item.name, 200) ?? hostOf(uris[0]) ?? 'Imported login',
            username: clean(login.username, 300),
            password: clean(login.password, 2000),
            url: uris[0],
            totp: totpSecret(login.totp),
            notes: loginNotes,
          },
          tags,
          favorite,
        ),
      )
      continue
    }

    if (type === 'note') {
      entries.push(
        makeEntry(
          'note',
          { title: clean(item.name, 200) ?? 'Imported note', notes },
          tags,
          favorite,
        ),
      )
      continue
    }

    if (type === 'card') {
      const card = item.card ?? {}
      entries.push(
        makeEntry(
          'card',
          {
            title: clean(item.name, 200) ?? 'Imported card',
            notes,
            card: {
              number: clean(card.number, 40),
              holder: clean(card.cardholderName, 200),
              expiry: cardExpiry(card.expMonth, card.expYear),
              cvv: clean(card.code, 10),
              pin: clean(card.pin, 20),
            },
          },
          tags,
          favorite,
        ),
      )
      continue
    }

    const identity = item.identity ?? {}
    const fullName =
      [identity.firstName, identity.middleName, identity.lastName]
        .map((part) => clean(part, 100))
        .filter(Boolean)
        .join(' ') || undefined
    const address =
      [
        identity.address1,
        identity.address2,
        identity.city,
        identity.state,
        identity.postalCode,
        identity.country,
      ]
        .map((part) => clean(part, 200))
        .filter(Boolean)
        .join(', ') || undefined

    entries.push(
      makeEntry(
        'identity',
        {
          title: clean(item.name, 200) ?? clean(fullName, 200) ?? 'Imported identity',
          notes,
          identity: {
            fullName: clean(fullName, 200),
            email: clean(identity.email, 300),
            phone: clean(identity.phone, 50),
            address: clean(address, 1000),
          },
        },
        tags,
        favorite,
      ),
    )
  }

  return { source: 'bitwarden', entries, skipped, warnings: skippedWarning(skipped) }
}

function importRookCsv(text: string): ImportResult {
  const { headers, rows } = parseCsv(text)
  const entries: Entry[] = []
  let skipped = 0

  for (const row of rows) {
    const map = rowMap(headers, row)
    if (!hasContent(map)) {
      skipped += 1
      continue
    }
    const type = mapType(pick(map, 'type')) ?? 'login'
    entries.push(
      makeEntry(
        type,
        fieldsFromMap(map, type),
        splitTags(pick(map, 'tags'), 'space'),
        bool(pick(map, 'favorite')),
      ),
    )
  }

  return { source: 'rook', entries, skipped, warnings: skippedWarning(skipped) }
}

export function parseImportText(text: string): ImportResult {
  const source = detectImportSource(text)
  if (source === 'chrome') return importChrome(text)
  if (source === '1password') return importOnePassword(text)
  if (source === 'rook') return importRookCsv(text)
  if (text.trim().startsWith('{')) return importBitwardenJson(text)
  return importBitwardenCsv(text)
}

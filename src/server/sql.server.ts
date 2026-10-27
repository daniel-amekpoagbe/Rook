import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import pg from 'pg'
import { SCHEMA_SQL } from './schema'

export type SqlDialect = 'sqlite' | 'postgres'

export interface SqlResult {
  changes: number
}

/**
 * Small async SQL surface shared by the local SQLite database and the
 * production PostgreSQL database. Queries use `?` placeholders; the
 * PostgreSQL adapter rewrites them to `$1`, `$2`, and so on.
 */
export interface SqlDatabase {
  readonly dialect: SqlDialect
  all<T>(sql: string, params?: unknown[]): Promise<T[]>
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>
  run(sql: string, params?: unknown[]): Promise<SqlResult>
  exec(sql: string): Promise<void>
  transaction<T>(fn: (tx: SqlDatabase) => Promise<T>): Promise<T>
}

class Mutex {
  private tail = Promise.resolve()

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

class SqliteDatabase implements SqlDatabase {
  readonly dialect = 'sqlite' as const
  private readonly mutex = new Mutex()

  constructor(private readonly db: DatabaseSync) {}

  all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.mutex.run(async () => this.db.prepare(sql).all(...(params as never[])) as T[])
  }

  get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.mutex.run(
      async () => this.db.prepare(sql).get(...(params as never[])) as T | undefined,
    )
  }

  run(sql: string, params: unknown[] = []): Promise<SqlResult> {
    return this.mutex.run(async () => {
      const result = this.db.prepare(sql).run(...(params as never[]))
      return { changes: Number(result.changes) }
    })
  }

  exec(sql: string): Promise<void> {
    return this.mutex.run(async () => {
      this.db.exec(sql)
    })
  }

  transaction<T>(fn: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    return this.mutex.run(async () => {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn(new SqliteTransaction(this.db))
        this.db.exec('COMMIT')
        return result
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    })
  }
}

/** Transaction-scoped handle that deliberately bypasses the connection mutex. */
class SqliteTransaction implements SqlDatabase {
  readonly dialect = 'sqlite' as const

  constructor(private readonly db: DatabaseSync) {}

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[]
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined
  }

  async run(sql: string, params: unknown[] = []): Promise<SqlResult> {
    const result = this.db.prepare(sql).run(...(params as never[]))
    return { changes: Number(result.changes) }
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql)
  }

  transaction<T>(_fn: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    throw new Error('NESTED_TRANSACTION')
  }
}

function toPgSql(sql: string): string {
  let index = 0
  let output = ''
  let quote: "'" | '"' | null = null

  for (let i = 0; i < sql.length; i += 1) {
    const character = sql[i]
    if (quote) {
      output += character
      if (character === quote) {
        if (sql[i + 1] === quote) {
          output += sql[i + 1]
          i += 1
        } else {
          quote = null
        }
      }
      continue
    }

    if (character === "'" || character === '"') {
      quote = character
      output += character
      continue
    }

    if (character === '?') {
      index += 1
      output += `$${index}`
      continue
    }

    output += character
  }

  return output
}

class PostgresDatabase implements SqlDatabase {
  readonly dialect = 'postgres' as const

  constructor(
    private readonly queryable: {
      query: (
        text: string,
        values?: unknown[],
      ) => Promise<{ rows: unknown[]; rowCount: number | null }>
    },
  ) {}

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.queryable.query(toPgSql(sql), params)
    return result.rows as T[]
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.all<T>(sql, params)
    return rows[0]
  }

  async run(sql: string, params: unknown[] = []): Promise<SqlResult> {
    const result = await this.queryable.query(toPgSql(sql), params)
    return { changes: result.rowCount ?? 0 }
  }

  async exec(sql: string): Promise<void> {
    await this.queryable.query(sql)
  }

  async transaction<T>(fn: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    if (!(this.queryable instanceof pg.Pool)) {
      throw new Error('NESTED_TRANSACTION')
    }
    const client = await this.queryable.connect()
    const tx = new PostgresDatabase(client)
    try {
      await client.query('BEGIN')
      const result = await fn(tx)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

let databasePromise: Promise<SqlDatabase> | null = null
let schemaPromise: Promise<void> | null = null

const SSL_QUERY_PARAMS = [
  'sslmode',
  'ssl',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'uselibpqcompat',
]

/**
 * Build pg pool options explicitly. `pg` lets query parameters in the
 * connection string override the options object, so an `sslmode=disable` (or
 * `sslmode=no-verify`) in the URL would silently undo ROOK_DATABASE_SSL. Remove
 * those parameters and derive the TLS setting ourselves.
 */
function postgresPoolOptions(connectionString: string): {
  connectionString: string
  ssl?: { rejectUnauthorized: boolean }
} {
  let url: URL | null = null
  try {
    url = new URL(connectionString)
  } catch {
    // pg also accepts keyword/value strings; leave those untouched.
  }

  let urlSsl: boolean | undefined
  let urlNoVerify = false
  if (url) {
    const mode = url.searchParams.get('sslmode')?.toLowerCase()
    const sslParam = url.searchParams.get('ssl')?.toLowerCase()
    if (mode === 'disable') urlSsl = false
    else if (mode) urlSsl = true
    else if (sslParam === 'true' || sslParam === '1') urlSsl = true
    else if (sslParam === 'false' || sslParam === '0') urlSsl = false
    urlNoVerify = mode === 'no-verify'

    for (const key of SSL_QUERY_PARAMS) url.searchParams.delete(key)
  }

  const enabled =
    process.env.ROOK_DATABASE_SSL === undefined
      ? urlSsl
      : process.env.ROOK_DATABASE_SSL === 'true'
  const rejectUnauthorized =
    process.env.ROOK_DATABASE_SSL_REJECT_UNAUTHORIZED === 'false'
      ? false
      : !urlNoVerify

  return {
    connectionString: url ? url.toString() : connectionString,
    ssl: enabled ? { rejectUnauthorized } : undefined,
  }
}

async function createDatabase(): Promise<SqlDatabase> {
  const connectionString = process.env.ROOK_DATABASE_URL
  if (connectionString) {
    // PostgreSQL returns BIGINT values as strings by default. The schema uses
    // BIGINT only for millisecond timestamps, which are safely within the
    // JavaScript safe-integer range.
    pg.types.setTypeParser(20, (value) => Number(value))
    const pool = new pg.Pool({
      ...postgresPoolOptions(connectionString),
      max: Number(process.env.ROOK_DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: Number(
        process.env.ROOK_DATABASE_CONNECT_TIMEOUT_MS ?? 15_000,
      ),
      allowExitOnIdle: true,
    })
    return new PostgresDatabase(pool)
  }

  if (process.env.VERCEL && process.env.ROOK_ALLOW_EPHEMERAL_SQLITE !== 'true') {
    throw new Error(
      'ROOK_DATABASE_URL is required on Vercel; the local SQLite fallback is not durable.',
    )
  }

  const { DatabaseSync } = await import('node:sqlite')
  const dataDir =
    process.env.ROOK_DATA_DIR ??
    process.env.KEYNEST_DATA_DIR ??
    join(process.cwd(), 'data')
  mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(join(dataDir, 'rook.db'))
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  return new SqliteDatabase(db)
}

export function getSql(): Promise<SqlDatabase> {
  if (!databasePromise) {
    databasePromise = createDatabase().catch((error) => {
      // Let the next request retry a transient connection or filesystem error.
      databasePromise = null
      throw error
    })
  }
  return databasePromise
}

async function migrate(sql: SqlDatabase): Promise<void> {
  await sql.exec(SCHEMA_SQL)

  if (sql.dialect === 'postgres') {
    // WebAuthn signature counters are unsigned 32-bit values and can exceed
    // PostgreSQL's signed 32-bit INTEGER range.
    await sql.exec('ALTER TABLE passkeys ALTER COLUMN counter TYPE BIGINT')
  }
}

export function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = await getSql()
      await migrate(sql)
    })().catch((error) => {
      // A cold database or a transient connection failure should not poison
      // every later request in this SSR instance.
      schemaPromise = null
      throw error
    })
  }
  return schemaPromise
}

export function isUniqueViolation(error: unknown): boolean {
  const message = String(error).toLowerCase()
  return message.includes('unique') || message.includes('duplicate key')
}

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createSessionToken } from '../worker/src/auth.ts';

export function createMockD1(dbPath = ':memory:') {
  const sqlite = new DatabaseSync(dbPath);
  return {
    sqlite,
    async exec(sql) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
    prepare(query) {
      function createStatement(boundValues = []) {
        const sanitized = boundValues.map((v) => {
          if (v === undefined) return null;
          if (typeof v === 'boolean') return v ? 1 : 0;
          return v;
        });
        return {
          bind(...values) {
            return createStatement(values);
          },
          async first(colName) {
            const stmt = sqlite.prepare(query);
            const row = stmt.get(...sanitized);
            if (!row) return null;
            if (colName) return row[colName] ?? null;
            return row;
          },
          async all() {
            const stmt = sqlite.prepare(query);
            const results = stmt.all(...sanitized);
            return { results, success: true, meta: { changes: 0 } };
          },
          async run() {
            const stmt = sqlite.prepare(query);
            const res = stmt.run(...sanitized);
            return {
              results: [],
              success: true,
              meta: {
                changes: Number(res.changes || 0),
                last_row_id: Number(res.lastInsertRowid || 0),
              },
            };
          },
          async raw(options) {
            const stmt = sqlite.prepare(query);
            const results = stmt.all(...sanitized);
            const rows = results.map((r) => Object.values(r));
            if (options && options.columnNames && results.length > 0) {
              return [Object.keys(results[0]), ...rows];
            }
            return rows;
          },
        };
      }
      return createStatement([]);
    },
    async batch(statements) {
      const results = [];
      sqlite.exec('BEGIN TRANSACTION');
      try {
        for (const s of statements) {
          results.push(await s.run());
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

export async function initMockD1WithSchema(schemaPath = null) {
  const d1 = createMockD1(':memory:');
  const actualPath = schemaPath || path.resolve(process.cwd(), 'worker/schema.sql');
  const ddl = fs.readFileSync(actualPath, 'utf-8');
  await d1.exec(ddl);
  return d1;
}

export function createMockR2Bucket() {
  const store = new Map();
  return {
    _store: store,
    async put(key, value, options = {}) {
      let buffer;
      if (typeof value === 'string') {
        buffer = Buffer.from(value, 'utf-8');
      } else if (Buffer.isBuffer(value)) {
        buffer = value;
      } else if (value instanceof Uint8Array) {
        buffer = Buffer.from(value);
      } else if (value instanceof ArrayBuffer) {
        buffer = Buffer.from(value);
      } else if (value && typeof value.getReader === 'function') {
        const reader = value.getReader();
        const chunks = [];
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          chunks.push(chunk);
        }
        buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      } else if (value && typeof value.arrayBuffer === 'function') {
        const ab = await value.arrayBuffer();
        buffer = Buffer.from(ab);
      } else {
        throw new Error('Unsupported value type for R2 mock put');
      }

      const hash = crypto.createHash('md5').update(buffer).digest('hex');
      const now = new Date();
      const obj = {
        key,
        size: buffer.length,
        etag: hash,
        httpEtag: `"${hash}"`,
        httpMetadata: options.httpMetadata || {},
        customMetadata: options.customMetadata || {},
        uploaded: now,
        _data: buffer,
      };

      store.set(key, obj);
      return {
        key: obj.key,
        size: obj.size,
        etag: obj.etag,
        httpEtag: obj.httpEtag,
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata,
        uploaded: obj.uploaded,
      };
    },

    async get(key) {
      const obj = store.get(key);
      if (!obj) return null;

      const buffer = obj._data;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(buffer));
          controller.close();
        },
      });

      return {
        key: obj.key,
        size: obj.size,
        etag: obj.etag,
        httpEtag: obj.httpEtag,
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata,
        uploaded: obj.uploaded,
        body: stream,
        async arrayBuffer() {
          return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        },
        async text() {
          return buffer.toString('utf-8');
        },
        async json() {
          return JSON.parse(buffer.toString('utf-8'));
        },
        async blob() {
          return new Blob([buffer], { type: obj.httpMetadata?.contentType || 'application/octet-stream' });
        },
      };
    },

    async head(key) {
      const obj = store.get(key);
      if (!obj) return null;
      return {
        key: obj.key,
        size: obj.size,
        etag: obj.etag,
        httpEtag: obj.httpEtag,
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata,
        uploaded: obj.uploaded,
      };
    },

    async delete(keys) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) {
        store.delete(k);
      }
    },

    async list(options = {}) {
      const prefix = options.prefix || '';
      const limit = options.limit || 1000;
      const objects = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(prefix)) {
          objects.push({
            key: v.key,
            size: v.size,
            etag: v.etag,
            httpEtag: v.httpEtag,
            httpMetadata: v.httpMetadata,
            customMetadata: v.customMetadata,
            uploaded: v.uploaded,
          });
          if (objects.length >= limit) break;
        }
      }
      return { objects, truncated: false };
    },
  };
}

export async function createTestWorkerEnv(options = {}) {
  const d1 = await initMockD1WithSchema();
  const r2 = createMockR2Bucket();
  const env = {
    DB: d1,
    IMAGES_BUCKET: r2,
    SESSION_SECRET: options.sessionSecret || 'test-worker-session-secret-key-1234567890',
    GOOGLE_CLIENT_ID: options.googleClientId || 'test-client-id.apps.googleusercontent.com',
    ALLOW_MOCK_AUTH: 'true',
    ...options.env,
  };
  return { env, d1, r2 };
}

export async function createTestSessionToken(payload, secret = 'test-worker-session-secret-key-1234567890', expiresInSeconds = 7 * 86400) {
  let expSec = expiresInSeconds;
  if (payload && typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    expSec = payload.exp - Math.floor(Date.now() / 1000);
  }
  const res = await createSessionToken(payload, secret, expSec);
  return res.token;
}

export function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

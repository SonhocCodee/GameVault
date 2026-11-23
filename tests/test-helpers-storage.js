import crypto from 'node:crypto';

// ============================================================================
// 1. Google OAuth & Tokeninfo Mock Infrastructure
// ============================================================================

export const MOCK_GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
export const MOCK_SESSION_SECRET = 'test-session-secret-key-at-least-32-chars!';

export const PRESET_GOOGLE_TOKENS = {
  VALID_ALICE: 'mock-google-id-token-valid-alice',
  VALID_BOB: 'mock-google-id-token-valid-bob',
  EXPIRED: 'mock-google-id-token-expired',
  WRONG_AUDIENCE: 'mock-google-id-token-wrong-aud',
  WRONG_ISSUER: 'mock-google-id-token-wrong-iss',
  MALFORMED: 'not-a-valid-jwt-token',
  UNICODE_USER: 'mock-google-id-token-unicode-gamer',
};

// Aliases for convenience
export const PRESET_TOKENS = PRESET_GOOGLE_TOKENS;
export const MOCK_CLIENT_ID = MOCK_GOOGLE_CLIENT_ID;

/**
 * Creates an intercepting fetch handler for Google OAuth and tokeninfo requests.
 */
export function createGoogleOAuthMockFetch(options = {}) {
  const expectedClientId = options.clientId || MOCK_GOOGLE_CLIENT_ID;
  const now = Math.floor(Date.now() / 1000);

  const tokenRegistry = new Map([
    [
      PRESET_GOOGLE_TOKENS.VALID_ALICE,
      {
        sub: 'google_alice_123',
        aud: expectedClientId,
        iss: 'https://accounts.google.com',
        email: 'alice@gamevault.test',
        email_verified: 'true',
        name: 'Alice Gamer',
        picture: 'https://lh3.googleusercontent.com/alice.png',
        iat: String(now - 60),
        exp: String(now + 3600),
      }
    ],
    [
      PRESET_GOOGLE_TOKENS.VALID_BOB,
      {
        sub: 'google_bob_456',
        aud: expectedClientId,
        iss: 'https://accounts.google.com',
        email: 'bob@gamevault.test',
        email_verified: 'true',
        name: 'Bob Reviewer',
        picture: 'https://lh3.googleusercontent.com/bob.png',
        iat: String(now - 60),
        exp: String(now + 3600),
      }
    ],
    [
      PRESET_GOOGLE_TOKENS.UNICODE_USER,
      {
        sub: 'google_unicode_789',
        aud: expectedClientId,
        iss: 'https://accounts.google.com',
        email: 'phuc@gamevault.vn',
        email_verified: 'true',
        name: 'Nguyễn Văn Phúc 🎮 [Pro]',
        picture: 'https://lh3.googleusercontent.com/phuc.png',
        iat: String(now - 60),
        exp: String(now + 3600),
      }
    ],
    [
      PRESET_GOOGLE_TOKENS.EXPIRED,
      {
        sub: 'google_expired_999',
        aud: expectedClientId,
        iss: 'https://accounts.google.com',
        email: 'expired@gamevault.test',
        iat: String(now - 7200),
        exp: String(now - 3600),
      }
    ],
    [
      PRESET_GOOGLE_TOKENS.WRONG_AUDIENCE,
      {
        sub: 'google_intruder_000',
        aud: 'foreign-app-id.apps.googleusercontent.com',
        iss: 'https://accounts.google.com',
        email: 'intruder@other.com',
        iat: String(now - 60),
        exp: String(now + 3600),
      }
    ],
    [
      PRESET_GOOGLE_TOKENS.WRONG_ISSUER,
      {
        sub: 'google_fake_888',
        aud: expectedClientId,
        iss: 'https://malicious-idp.example.com',
        email: 'fake@evil.com',
        iat: String(now - 60),
        exp: String(now + 3600),
      }
    ],
  ]);

  const calls = [];

  const mockFetch = async (url, init = {}) => {
    const urlStr = typeof url === 'string' ? url : (url.url || url.toString());
    calls.push({ url: urlStr, init });
    const parsed = new URL(urlStr, 'https://oauth2.googleapis.com');

    // 1. Google tokeninfo endpoint
    if (parsed.pathname === '/tokeninfo') {
      const idToken = parsed.searchParams.get('id_token');
      if (!idToken || idToken === PRESET_GOOGLE_TOKENS.MALFORMED) {
        return new Response(
          JSON.stringify({ error: 'invalid_token', error_description: 'Invalid Value' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const registered = tokenRegistry.get(idToken);
      if (registered) {
        return new Response(
          JSON.stringify(registered),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Dynamic mock tokens format: mock:uid:email:name:photoUrl
      if (idToken.startsWith('mock:')) {
        const [, sub, email, name, picture] = idToken.split(':');
        return new Response(
          JSON.stringify({
            sub: sub || 'mock_sub',
            aud: expectedClientId,
            iss: 'https://accounts.google.com',
            email: email || 'mock@example.com',
            name: name || 'Mock User',
            picture: picture || '',
            exp: String(now + 3600),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: 'invalid_token', error_description: 'Unknown token' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Google OAuth token exchange (/token)
    if (parsed.pathname === '/token') {
      return new Response(
        JSON.stringify({
          access_token: 'mock-access-token-xyz',
          refresh_token: 'mock-refresh-token-xyz',
          id_token: PRESET_GOOGLE_TOKENS.VALID_ALICE,
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'openid email profile https://www.googleapis.com/auth/drive.appdata'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. Google OAuth token revoke (/revoke)
    if (parsed.pathname === '/revoke') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not found', { status: 404 });
  };

  return {
    fetch: mockFetch,
    calls,
    getCalls: () => [...calls],
    clearCalls: () => { calls.length = 0; },
    registerToken(token, claims) {
      tokenRegistry.set(token, claims);
    }
  };
}

// ============================================================================
// 2. Session Token Cryptographic Helpers
// ============================================================================

export async function createTestSessionToken(payload, secret = MOCK_SESSION_SECRET, expiresInSeconds = 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    iat: now,
    exp: now + expiresInSeconds,
    ...payload,
  };
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, data);
  const encodedSignature = Buffer.from(signature).toString('base64url');

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

export async function verifyTestSessionToken(token, secret = MOCK_SESSION_SECRET) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sigBytes = new Uint8Array(Buffer.from(sigB64, 'base64url'));

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, data);
    if (!valid) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// ============================================================================
// 3. Google Photos Library API Mock
// ============================================================================

export function createMockGooglePhotosServer(options = {}) {
  const mediaItems = new Map();
  const albums = new Map();
  const calls = [];

  const mockFetch = async (url, init = {}) => {
    const urlStr = typeof url === 'string' ? url : (url.url || url.toString());
    const parsedUrl = new URL(urlStr);
    const method = (init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || {});
    const auth = headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');

    calls.push({
      url: urlStr,
      method,
      headers: Object.fromEntries(headers.entries()),
      body: init.body,
    });

    if (options.simulateNetworkError) {
      throw new TypeError('fetch failed: network offline');
    }

    if (options.simulateAuthError || token === 'expired_token') {
      return new Response(JSON.stringify({
        error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' }
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    if (options.simulatePermissionError || token === 'missing_scope_token') {
      return new Response(JSON.stringify({
        error: { code: 403, message: 'Insufficient Permission: Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED' }
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    if (options.simulateQuotaError) {
      return new Response(JSON.stringify({
        error: { code: 429, message: "Quota exceeded for quota metric 'All requests'", status: 'RESOURCE_EXHAUSTED' }
      }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    // Step 1: Raw bytes upload -> return uploadToken
    if (parsedUrl.pathname === '/v1/uploads' && method === 'POST') {
      const uploadToken = `upload_token_${crypto.randomUUID()}`;
      return new Response(uploadToken, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Step 2: Batch Create media item
    if (parsedUrl.pathname === '/v1/mediaItems:batchCreate' && method === 'POST') {
      if (options.simulateBatchItemError) {
        return new Response(JSON.stringify({
          newMediaItemResults: [{
            status: { code: 3, message: 'Internal creation failure' }
          }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const bodyText = typeof init.body === 'string' ? init.body : (init.body ? init.body.toString() : '{}');
      const payload = JSON.parse(bodyText);
      const newMediaItems = payload.newMediaItems || [];
      const results = [];

      for (const item of newMediaItems) {
        const id = `photo_${crypto.randomUUID()}`;
        const baseUrl = `https://lh3.googleusercontent.com/lr/photo_${crypto.randomUUID()}`;
        const record = {
          id,
          description: item.description || '',
          albumId: payload.albumId || undefined,
          productUrl: `https://photos.google.com/lr/photo/${id}`,
          baseUrl,
          mimeType: 'image/jpeg',
          mediaMetadata: {
            creationTime: new Date().toISOString(),
            width: '1920',
            height: '1080',
          },
        };
        mediaItems.set(id, record);
        results.push({
          uploadToken: item.simpleMediaItem?.uploadToken,
          status: { message: 'Success' },
          mediaItem: record,
        });
      }

      return new Response(JSON.stringify({ newMediaItemResults: results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Albums creation (POST) & probe/list (GET)
    if (parsedUrl.pathname === '/v1/albums') {
      if (method === 'GET') {
        return new Response(JSON.stringify({
          albums: Array.from(albums.values()),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'POST') {
        const body = JSON.parse(init.body || '{}');
        const albumId = `album_${crypto.randomUUID()}`;
        const album = {
          id: albumId,
          title: body.album?.title || 'GameVault',
          productUrl: `https://photos.google.com/lr/album/${albumId}`,
        };
        albums.set(albumId, album);
        return new Response(JSON.stringify(album), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Media item get (baseUrl refresh)
    if (parsedUrl.pathname.startsWith('/v1/mediaItems/') && method === 'GET') {
      const id = parsedUrl.pathname.replace('/v1/mediaItems/', '');
      const item = mediaItems.get(id);
      if (!item) {
        return new Response(JSON.stringify({ error: { code: 404, message: 'Media item not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const refreshed = { ...item, baseUrl: `https://lh3.googleusercontent.com/lr/refreshed_${crypto.randomUUID()}` };
      mediaItems.set(id, refreshed);
      return new Response(JSON.stringify(refreshed), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found in Google Photos mock', { status: 404 });
  };

  return {
    fetch: mockFetch,
    getCalls: () => [...calls],
    clearCalls: () => { calls.length = 0; },
    getMediaItems: () => new Map(mediaItems),
    getAlbums: () => new Map(albums),
  };
}

// ============================================================================
// 4. AWS SigV4 S3 Mock Implementation
// ============================================================================

export function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function hmacBuf(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

export function createMockS3Server(options = {}) {
  const objects = new Map();
  const calls = [];

  const mockFetch = async (url, init = {}) => {
    const urlStr = typeof url === 'string' ? url : (url.url || url.toString());
    const parsedUrl = new URL(urlStr);
    const method = (init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || {});

    calls.push({
      url: urlStr,
      method,
      headers: Object.fromEntries(headers.entries()),
      body: init.body,
    });

    if (options.simulateNetworkError) {
      throw new TypeError('fetch failed: network offline');
    }

    // Validate Host header
    const hostHeader = headers.get('host') || headers.get('Host');
    if (!hostHeader && !parsedUrl.host) {
      return new Response('<Error><Code>InvalidArgument</Code><Message>Missing Host header</Message></Error>', {
        status: 400,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    // Validate SigV4 Authorization header
    const authHeader = headers.get('authorization') || headers.get('Authorization') || '';
    if (!authHeader.startsWith('AWS4-HMAC-SHA256 ')) {
      return new Response('<Error><Code>AccessDenied</Code><Message>Missing or invalid AWS4 Authorization header</Message></Error>', {
        status: 403,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    // Parse Credential, SignedHeaders, Signature
    const credMatch = authHeader.match(/Credential=([^,]+)/);
    const signedHeadersMatch = authHeader.match(/SignedHeaders=([^,]+)/);
    const sigMatch = authHeader.match(/Signature=([a-f0-9]+)/);

    if (!credMatch || !signedHeadersMatch || !sigMatch) {
      return new Response('<Error><Code>IncompleteSignature</Code><Message>Malformed Authorization header</Message></Error>', {
        status: 400,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    const [accessKeyId] = credMatch[1].split('/');
    const amzDate = headers.get('x-amz-date');
    if (!amzDate || !/^\d{8}T\d{6}Z$/.test(amzDate)) {
      return new Response('<Error><Code>InvalidDate</Code><Message>Missing or invalid x-amz-date</Message></Error>', {
        status: 400,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    if (options.simulateClockSkew) {
      return new Response('<Error><Code>RequestTimeTooSkewed</Code><Message>The difference between the request time and the current time is too large.</Message></Error>', {
        status: 403,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    if (options.expectedAccessKeyId && accessKeyId !== options.expectedAccessKeyId) {
      return new Response('<Error><Code>InvalidAccessKeyId</Code><Message>The AWS Access Key Id you provided does not exist in our records.</Message></Error>', {
        status: 403,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    if (options.simulateInvalidSignature) {
      return new Response('<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match the signature you provided.</Message></Error>', {
        status: 403,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    // Check payload hash
    const bodyBuf = Buffer.isBuffer(init.body)
      ? init.body
      : typeof init.body === 'string'
      ? Buffer.from(init.body)
      : init.body instanceof ArrayBuffer
      ? Buffer.from(init.body)
      : Buffer.alloc(0);

    const amzSha256 = headers.get('x-amz-content-sha256');
    if (amzSha256 && amzSha256 !== 'UNSIGNED-PAYLOAD') {
      const actualSha256 = sha256Hex(bodyBuf);
      if (amzSha256 !== actualSha256) {
        return new Response('<Error><Code>XAmzContentSHA256Mismatch</Code><Message>The provided ' + amzSha256 + ' did not match actual ' + actualSha256 + '</Message></Error>', {
          status: 400,
          headers: { 'Content-Type': 'application/xml' },
        });
      }
    }

    // Parse path-style bucket & objectKey
    const pathParts = parsedUrl.pathname.replace(/^\/+/, '').split('/');
    const bucket = pathParts[0];
    const objectKey = pathParts.slice(1).join('/');

    if (options.expectedBucket && bucket !== options.expectedBucket) {
      return new Response('<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>', {
        status: 404,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    // PUT object or probe
    if (method === 'PUT') {
      const etag = `"${sha256Hex(bodyBuf).slice(0, 32)}"`;
      const contentType = headers.get('content-type') || 'application/octet-stream';
      objects.set(`${bucket}/${objectKey}`, {
        bucket,
        key: objectKey,
        body: bodyBuf,
        contentType,
        etag,
        size: bodyBuf.length,
      });

      return new Response('', {
        status: 200,
        headers: {
          ETag: etag,
          'Content-Length': '0',
        },
      });
    }

    // GET / HEAD object
    if (method === 'GET' || method === 'HEAD') {
      // If probe request
      if (objectKey.includes('.gamevault-probe') || objectKey.includes('.gamevault-test')) {
        return new Response(method === 'HEAD' ? null : 'ok', {
          status: 200,
          headers: { 'Content-Type': 'text/plain', ETag: '"probe-etag"' },
        });
      }

      const obj = objects.get(`${bucket}/${objectKey}`);
      if (!obj) {
        return new Response('<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>', {
          status: 404,
          headers: { 'Content-Type': 'application/xml' },
        });
      }

      return new Response(method === 'HEAD' ? null : obj.body, {
        status: 200,
        headers: {
          'Content-Type': obj.contentType,
          'Content-Length': String(obj.size),
          ETag: obj.etag,
        },
      });
    }

    return new Response('Method not allowed in mock S3', { status: 405 });
  };

  return {
    fetch: mockFetch,
    getCalls: () => [...calls],
    clearCalls: () => { calls.length = 0; },
    getObjects: () => new Map(objects),
  };
}

// ============================================================================
// 5. Composable Storage Multiplexer Fetch
// ============================================================================

export function createMockStorageMultiplexer(options = {}) {
  const { googlePhotosMock, s3Mock, googleOAuthMock, workerMock, fallbackFetch } = options;

  return async (url, init = {}) => {
    const urlStr = typeof url === 'string' ? url : (url.url || url.toString());

    if (urlStr.includes('photoslibrary.googleapis.com')) {
      if (!googlePhotosMock) throw new Error('Google Photos mock not configured for URL: ' + urlStr);
      return googlePhotosMock.fetch(url, init);
    }

    if (urlStr.includes('oauth2.googleapis.com')) {
      if (!googleOAuthMock) throw new Error('Google OAuth mock not configured for URL: ' + urlStr);
      return googleOAuthMock.fetch(url, init);
    }

    if (urlStr.includes('r2.cloudflarestorage.com') || (s3Mock && options.s3Endpoint && urlStr.startsWith(options.s3Endpoint))) {
      if (!s3Mock) throw new Error('S3 mock not configured for URL: ' + urlStr);
      return s3Mock.fetch(url, init);
    }

    if (urlStr.includes('/api/images') || urlStr.includes('/api/auth') || urlStr.includes('/api/leaderboard') || urlStr.includes('/api/games')) {
      if (workerMock) return workerMock.fetch(url, init);
    }

    if (s3Mock && (init.headers?.Authorization?.startsWith('AWS4-HMAC-SHA256') || init.headers?.authorization?.startsWith('AWS4-HMAC-SHA256'))) {
      return s3Mock.fetch(url, init);
    }

    if (fallbackFetch) return fallbackFetch(url, init);

    throw new Error('Unhandled fetch URL in mock storage multiplexer: ' + urlStr);
  };
}

// ============================================================================
// 6. Client Helpers for Storage & Settings Testing
// ============================================================================

export async function uploadToGooglePhotos(buffer, filename, mimeType, albumId, accessToken, fetchImpl = fetch) {
  // Step 1: byte upload
  const uploadRes = await fetchImpl('https://photoslibrary.googleapis.com/v1/uploads', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-Content-Type': mimeType,
      'X-Goog-Upload-Protocol': 'raw',
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`Google Photos byte upload failed: HTTP ${uploadRes.status}`);
  }
  const uploadToken = (await uploadRes.text()).trim();

  // Step 2: batchCreate
  const batchRes = await fetchImpl('https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      albumId: albumId || undefined,
      newMediaItems: [
        {
          description: `GameVault - ${filename}`,
          simpleMediaItem: { fileName: filename, uploadToken },
        },
      ],
    }),
  });

  if (!batchRes.ok) {
    throw new Error(`Google Photos batchCreate failed: HTTP ${batchRes.status}`);
  }

  const batchData = await batchRes.json();
  const result = batchData.newMediaItemResults?.[0];
  if (result?.status?.message && result.status.message !== 'Success') {
    throw new Error(`Google Photos creation error: ${result.status.message}`);
  }

  const item = result?.mediaItem;
  if (!item?.baseUrl || !item?.id) {
    throw new Error('Google Photos API did not return mediaItem baseUrl');
  }

  return {
    mediaItemId: item.id,
    baseUrl: item.baseUrl,
    productUrl: item.productUrl || '',
    expiresAt: Date.now() + 50 * 60 * 1000,
  };
}

export const uploadToGooglePhotosTest = uploadToGooglePhotos;

export async function createGooglePhotosAlbum(title, accessToken, fetchImpl = fetch) {
  const res = await fetchImpl('https://photoslibrary.googleapis.com/v1/albums', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ album: { title } }),
  });
  if (!res.ok) {
    throw new Error(`Create album failed: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function refreshGooglePhotosBaseUrl(mediaItemId, accessToken, fetchImpl = fetch) {
  const res = await fetchImpl(`https://photoslibrary.googleapis.com/v1/mediaItems/${mediaItemId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Refresh baseUrl failed: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function uploadToS3(opts) {
  const fetchImpl = opts.fetchImpl || fetch;
  const region = opts.region || 'auto';
  const cleanEndpoint = opts.endpoint.replace(/\/+$/, '');
  const url = `${cleanEndpoint}/${opts.bucket}/${opts.key}`;
  const parsedUrl = new URL(url);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256Hex(opts.body);
  const canonicalHeaders = `host:${parsedUrl.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    parsedUrl.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacBuf(`AWS4${opts.secretAccessKey}`, dateStamp);
  const kRegion = hmacBuf(kDate, region);
  const kService = hmacBuf(kRegion, 's3');
  const kSigning = hmacBuf(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: {
      Host: parsedUrl.host,
      'Content-Type': opts.contentType,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization: authHeader,
    },
    body: opts.body,
  });

  if (!res.ok) {
    throw new Error(`S3 upload failed: HTTP ${res.status}`);
  }

  if (opts.publicUrlBase) {
    const cleanBase = opts.publicUrlBase.replace(/\/+$/, '');
    return `${cleanBase}/${opts.key}`;
  }
  return url;
}

export const uploadToS3Test = uploadToS3;

export async function testS3Connection(config, fetchImpl = fetch) {
  try {
    const probeKey = `.gamevault-test-${Date.now()}`;
    await uploadToS3({
      ...config,
      key: probeKey,
      body: Buffer.from('ok'),
      contentType: 'text/plain',
      fetchImpl,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'S3 connection test failed' };
  }
}

export const testS3ConnectionTest = testS3Connection;

export async function uploadImageFile(opts) {
  const {
    fileBuffer,
    fileName = 'image.png',
    mimeType = 'image/png',
    kind = 'poster',
    settings,
    sessionToken,
    googleAccessToken,
    fetchImpl = fetch,
    workerUrl = 'http://localhost',
  } = opts;

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error('Image body cannot be empty');
  }

  if (fileBuffer.length > 10 * 1024 * 1024) {
    throw new Error('Image exceeds maximum size of 10MB');
  }

  const provider = settings?.imageStorageProvider || 'cloudflare_r2';

  if (provider === 'google_photos') {
    const res = await uploadToGooglePhotos(
      fileBuffer,
      fileName,
      mimeType,
      settings?.googlePhotosAlbumId,
      googleAccessToken,
      fetchImpl
    );
    return {
      provider: 'google_photos',
      url: res.baseUrl,
      keyOrId: res.mediaItemId,
      isCustomS3: false,
    };
  }

  // Cloudflare R2 provider
  const isCustomS3 = Boolean(settings?.customS3Config?.enabled);

  if (isCustomS3) {
    const key = `covers/${fileName}`;
    const url = await uploadToS3({
      ...settings.customS3Config,
      key,
      body: fileBuffer,
      contentType: mimeType,
      fetchImpl,
    });
    return {
      provider: 'cloudflare_r2',
      url,
      keyOrId: key,
      isCustomS3: true,
    };
  }

  // Shared developer R2 via Worker
  if (!sessionToken) {
    throw new Error('Chưa đăng nhập — cần phiên làm việc để sử dụng R2 chung');
  }

  const uploadEndpoint = `${workerUrl}/api/images/upload`;
  const res = await fetchImpl(uploadEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': mimeType,
      'X-Image-Kind': kind,
    },
    body: fileBuffer,
  });

  if (!res.ok) {
    throw new Error(`Worker R2 upload failed: HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    provider: 'cloudflare_r2',
    url: data.url,
    keyOrId: data.key,
    isCustomS3: false,
  };
}

// ============================================================================
// 7. Settings Persistence & Credential Masking
// ============================================================================

export const MASK_SECRET = '••••••••';

export function getSetting(key, db) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch {
    return null;
  }
}

export function setSetting(key, value, db) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now', 'localtime'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now', 'localtime')
  `).run(key, value);
}

export function loadAppSettings(db) {
  const provider = getSetting('image_storage_provider', db) || 'cloudflare_r2';
  const customS3Enabled = getSetting('custom_s3_enabled', db) === 'true';
  const customS3Endpoint = getSetting('custom_s3_endpoint', db) || '';
  const customS3Bucket = getSetting('custom_s3_bucket', db) || '';
  const customS3AccessKeyId = getSetting('custom_s3_access_key_id', db) || '';
  const customS3SecretAccessKey = getSetting('custom_s3_secret_access_key', db) || '';
  const customS3Region = getSetting('custom_s3_region', db) || 'auto';
  const customS3PublicUrlBase = getSetting('custom_s3_public_url_base', db) || '';
  const googlePhotosAlbumId = getSetting('google_photos_album_id', db) || '';

  return {
    imageStorageProvider: provider === 'google_photos' ? 'google_photos' : 'cloudflare_r2',
    googlePhotosAlbumId,
    customS3Config: {
      enabled: customS3Enabled,
      endpoint: customS3Endpoint,
      bucket: customS3Bucket,
      accessKeyId: customS3AccessKeyId,
      secretAccessKey: customS3SecretAccessKey,
      region: customS3Region,
      publicUrlBase: customS3PublicUrlBase,
    },
  };
}

export const loadAppSettingsTest = loadAppSettings;

export function maskSettingsSecrets(settings) {
  const copy = JSON.parse(JSON.stringify(settings));
  if (copy.customS3Config && copy.customS3Config.secretAccessKey) {
    copy.customS3Config.hasSecretKey = true;
    copy.customS3Config.secretAccessKey = MASK_SECRET;
  }
  return copy;
}

export const maskSettingsSecretsTest = maskSettingsSecrets;

export function saveAppSettings(patch, db) {
  if (patch.imageStorageProvider !== undefined) {
    const val = patch.imageStorageProvider === 'google_photos' ? 'google_photos' : 'cloudflare_r2';
    setSetting('image_storage_provider', val, db);
  }

  if (patch.googlePhotosAlbumId !== undefined) {
    setSetting('google_photos_album_id', patch.googlePhotosAlbumId, db);
  }

  if (patch.customS3Config !== undefined) {
    const s3 = patch.customS3Config;
    if (s3.enabled !== undefined) {
      setSetting('custom_s3_enabled', s3.enabled ? 'true' : 'false', db);
    }
    if (s3.endpoint !== undefined) {
      setSetting('custom_s3_endpoint', (s3.endpoint || '').trim(), db);
    }
    if (s3.bucket !== undefined) {
      setSetting('custom_s3_bucket', (s3.bucket || '').trim(), db);
    }
    if (s3.accessKeyId !== undefined) {
      setSetting('custom_s3_access_key_id', (s3.accessKeyId || '').trim(), db);
    }
    if (s3.secretAccessKey !== undefined) {
      const secret = (s3.secretAccessKey || '').trim();
      // If secret is the mask string or empty while a secret is already stored, DO NOT overwrite!
      if (secret && secret !== MASK_SECRET) {
        setSetting('custom_s3_secret_access_key', secret, db);
      }
    }
    if (s3.region !== undefined) {
      setSetting('custom_s3_region', (s3.region || '').trim() || 'auto', db);
    }
    if (s3.publicUrlBase !== undefined) {
      setSetting('custom_s3_public_url_base', (s3.publicUrlBase || '').trim(), db);
    }
  }

  return loadAppSettings(db);
}

export const saveAppSettingsTest = saveAppSettings;

export async function testStorageConnection(settings, fetchImpl = fetch, googleAccessToken = null) {
  const provider = settings?.imageStorageProvider || 'cloudflare_r2';

  if (provider === 'google_photos') {
    if (!googleAccessToken) {
      return { ok: false, error: 'Chưa đăng nhập tài khoản Google' };
    }
    try {
      const res = await fetchImpl('https://photoslibrary.googleapis.com/v1/albums', {
        headers: { Authorization: `Bearer ${googleAccessToken}` },
      });
      if (res.ok) {
        return { ok: true };
      }
      return { ok: false, error: `Google Photos connection test failed: HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: err.message || 'fetch failed: network offline' };
    }
  }

  // Cloudflare R2 / Custom S3
  if (settings?.customS3Config?.enabled) {
    return await testS3Connection(settings.customS3Config, fetchImpl);
  }

  // Default shared R2
  return { ok: true };
}

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Image-Kind, X-Game-Key, X-Cover-Type, X-Game-Title, X-Steam-Id',
  'Access-Control-Max-Age': '86400',
};

export function jsonResponse(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

export function errorResponse(message: string, status = 400, extraHeaders: HeadersInit = {}): Response {
  return jsonResponse({ error: message }, status, extraHeaders);
}

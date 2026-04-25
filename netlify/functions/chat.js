// ══════════════════════════════════════════════
// نمو — Netlify Function (chat.js)
// محمي بـ: Rate Limiting + Origin Validation +
//          Input Validation + Usage Cap
// ══════════════════════════════════════════════

// ── Rate Limiting (in-memory) ──
// ملاحظة: هذا يعمل داخل نفس instance فقط.
// للإنتاج الجاد استخدم Redis أو Upstash.
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // نافذة دقيقة واحدة
const RATE_LIMIT_MAX = 10;              // أقصى 10 طلبات في الدقيقة لكل IP

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }

  // انتهت النافذة — أعد العداد
  if (now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) return true;

  entry.count++;
  return false;
}

// تنظيف الـ Map بشكل دوري لمنع تسرب الذاكرة
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now - entry.start > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// ── Allowed Origins ──
const ALLOWED_ORIGINS = [
  'https://numoo.app',
  'https://www.numoo.app',
  // أضف دومينك هنا — مثال:
  // 'https://your-netlify-subdomain.netlify.app',
];

// في التطوير المحلي نسمح بـ localhost
const isDev = process.env.NODE_ENV !== 'production';

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (isDev && (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1'))) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

// ── Input Validation ──
const MAX_MESSAGES = 10;          // أقصى عدد رسائل في المحادثة
const MAX_MESSAGE_LENGTH = 1000;  // أقصى طول رسالة واحدة (حرف)
const MAX_TOTAL_CHARS = 4000;     // أقصى مجموع أحرف كل الرسائل

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'messages must be a non-empty array';
  }
  if (messages.length > MAX_MESSAGES) {
    return `too many messages (max ${MAX_MESSAGES})`;
  }

  let totalChars = 0;
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') return 'invalid message format';
    if (!['user', 'assistant'].includes(msg.role)) return 'invalid role';
    if (typeof msg.content !== 'string') return 'content must be a string';
    if (msg.content.length > MAX_MESSAGE_LENGTH) return 'message too long';
    totalChars += msg.content.length;
    if (totalChars > MAX_TOTAL_CHARS) return 'total content too long';
  }

  // آخر رسالة لازم تكون من المستخدم
  if (messages[messages.length - 1].role !== 'user') {
    return 'last message must be from user';
  }

  return null; // لا يوجد خطأ
}

// ── CORS Headers ──
function getCorsHeaders(origin) {
  const allowed = isAllowedOrigin(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

// ── Main Handler ──
exports.handler = async function(event) {
  const origin = event.headers['origin'] || event.headers['Origin'] || '';
  const corsHeaders = getCorsHeaders(origin);

  // Preflight request
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // Method check
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  // Origin check
  if (!isAllowedOrigin(origin)) {
    console.warn('Blocked origin:', origin);
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Forbidden' })
    };
  }

  // IP Rate Limiting
  const ip =
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.headers['client-ip'] ||
    'unknown';

  if (isRateLimited(ip)) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders, 'Retry-After': '60' },
      body: JSON.stringify({ error: 'Too many requests. Please wait a minute.' })
    };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON' })
    };
  }

  // Validate messages
  const validationError = validateMessages(body.messages);
  if (validationError) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: validationError })
    };
  }

  // API Key check
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  // Call Anthropic API
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: `أنت "نمو" — مساعد ذكي متخصص في التوحد والنمو المبكر للأطفال. تتحدث بالعربي الكويتي الودي. تجيب بشكل مختصر وعملي. لا تشخّص، لكن تعطي معلومات مفيدة وتوجّه للمختصين. اذكر مراكز الكويت عند الحاجة: مركز الكويت للتوحد 25309300، الهيئة العامة 1811123.`,
        messages: body.messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return {
        statusCode: 502,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'AI service error. Please try again.' })
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(data),
    };

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'حصل خطأ، حاول مرة ثانية' })
    };
  }
};

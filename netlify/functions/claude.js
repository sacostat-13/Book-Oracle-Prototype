// Anthropic Claude proxy.
// The client POSTs { prompt, systemPrompt } to /.netlify/functions/claude;
// we add the Anthropic API key from env and forward to api.anthropic.com.
//
// Required env var (set in Netlify → Site → Environment variables):
//   ANTHROPIC_API_KEY

export async function handler(event) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY env var is not set' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }
  const { prompt, systemPrompt, maxTokens = 2000, model = 'claude-sonnet-4-5' } = body;
  if (!prompt) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing prompt' }),
    };
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system:
          systemPrompt ||
          'You are a literary book recommendation expert with deep knowledge of horror, gothic, literary fiction, and Latin American literature.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const text = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Upstream request failed', detail: String(e) }),
    };
  }
}

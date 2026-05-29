// Calls Anthropic's API directly from the browser.
// NOTE: This pattern only works in environments that proxy/authorize the call
// (e.g. inside Claude's artifact runner). For a public deployment you should
// move this behind a Netlify Function or Supabase Edge Function that holds
// the API key server-side.
export async function callClaude(prompt, systemPrompt) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system:
          systemPrompt ||
          'You are a literary book recommendation expert with deep knowledge of horror, gothic, literary fiction, and Latin American literature.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) throw new Error('API request failed');
    const data = await response.json();
    return data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  } catch (e) {
    console.error('Claude API error:', e);
    return null;
  }
}

export function parseJSONResponse(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/[\[\{][\s\S]*[\]\}]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return null;
  }
}

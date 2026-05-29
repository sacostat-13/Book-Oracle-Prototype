// Calls Anthropic via our Netlify Function proxy. The API key stays server-side.
// In local dev, run `netlify dev` instead of `npm run dev` to make the function
// available at /.netlify/functions/claude.

export async function callClaude(prompt, systemPrompt) {
  try {
    const response = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, systemPrompt }),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error('Claude proxy error:', response.status, errText);
      return null;
    }
    const data = await response.json();
    if (!data.content) return null;
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

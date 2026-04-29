const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

const systemPrompt = `You are Numoo, an Arabic-first autism awareness assistant for families in Kuwait.
Your role:
- Provide supportive, clear, parent-friendly guidance in Arabic unless the user asks for English.
- Do not diagnose autism or claim certainty.
- Explain observable developmental indicators and suggest safe next steps.
- Encourage clinical evaluation by qualified specialists when there are red flags.
- For urgent medical, safety, self-harm, abuse, or emergency concerns, advise contacting local emergency services or a qualified clinician immediately.
- Be concise, warm, and practical.
- Never ask for unnecessary identifying details about the child.
- If asked about Numoo results, say Numoo is an awareness screening prototype inspired by published screening criteria, not a clinical diagnosis.`;

function buildTranscript(messages){
  return messages
    .map(m => `${m.role === 'user' ? 'Parent' : 'Numoo'}: ${m.content}`)
    .join('\n');
}

function cleanMessages(messages){
  if(!Array.isArray(messages)) return [];
  return messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map(m => ({ role: m.role, content: m.content.slice(0, 1600) }));
}

function extractText(data){
  if(typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for(const item of data.output || []){
    for(const part of item.content || []){
      if(part.type === 'output_text' && part.text) chunks.push(part.text);
      if(part.type === 'text' && part.text) chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

async function callOpenAI(messages){
  const input = 'Conversation so far:\n' + buildTranscript(messages) + '\n\nRespond as Numoo to the latest parent message.';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      instructions: systemPrompt,
      input,
      temperature: 0.35,
      max_output_tokens: 550,
      store: false
    })
  });

  const data = await response.json();
  if(!response.ok) throw new Error(data.error?.message || 'OpenAI request failed');
  return extractText(data);
}

async function callGemini(messages){
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      generationConfig: { temperature: 0.35, maxOutputTokens: 550 }
    })
  });

  const data = await response.json();
  if(!response.ok) throw new Error(data.error?.message || 'Gemini request failed');
  return (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n').trim();
}

async function callAnthropic(messages){
  const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({

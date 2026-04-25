exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `أنت "نمو" — مساعد ذكي متخصص في التوحد والنمو المبكر للأطفال. تتحدث بالعربي الكويتي الودي. تجيب بشكل مختصر وعملي. لا تشخّص، لكن تعطي معلومات مفيدة وتوجّه للمختصين. اذكر مراكز الكويت عند الحاجة: مركز الكويت للتوحد 25309300، الهيئة العامة 1811123.`,
        messages: body.messages
      })
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(data)
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'حصل خطأ' })
    };
  }
};

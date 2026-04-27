const createModelClient = ({
  aiBaseUrl,
  aiApiKey,
  aiModel,
  temperature = 0.4
}) => {
  const normalizedBaseUrl = String(aiBaseUrl || '').replace(/\/+$/, '');

  const assertConfigured = () => {
    if (!normalizedBaseUrl || !aiApiKey || !aiModel) {
      throw new Error('AI_BASE_URL / AI_API_KEY / AI_MODEL 未配置');
    }
  };

  const callAiChat = async (messages, tools) => {
    assertConfigured();

    const response = await fetch(`${normalizedBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiApiKey}`
      },
      body: JSON.stringify({
        model: aiModel,
        messages,
        tools,
        tool_choice: 'auto',
        temperature
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI 请求失败: ${response.status} ${text}`);
    }

    const data = await response.json();
    const message = data?.choices?.[0]?.message;
    if (!message) {
      throw new Error('AI 响应格式异常');
    }
    return message;
  };

  const callAiChatStream = async (messages, tools) => {
    assertConfigured();

    const response = await fetch(`${normalizedBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiApiKey}`
      },
      body: JSON.stringify({
        model: aiModel,
        messages,
        tools,
        tool_choice: 'auto',
        temperature,
        stream: true
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI 请求失败: ${response.status} ${text}`);
    }

    return response.body;
  };

  return {
    callAiChat,
    callAiChatStream
  };
};

module.exports = {
  createModelClient
};

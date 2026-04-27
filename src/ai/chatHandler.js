const createAiChatHandler = ({
  buildPromptContext,
  normalizeAiMode,
  getAiTools,
  aiAgentGraph,
  deriveMemoryPatch,
  upsertUserMemory
}) => async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const mode = normalizeAiMode(req.body?.mode);
    const promptContext = typeof req.body?.context === 'object' && req.body?.context !== null
      ? req.body.context
      : {};
    const inputMessages = Array.isArray(req.body?.messages) ? req.body.messages : null;
    const singleMessage = typeof req.body?.message === 'string' ? req.body.message : '';
    const userMessages = inputMessages && inputMessages.length > 0
      ? inputMessages
      : (singleMessage ? [{ role: 'user', content: singleMessage }] : []);
    const latestUserMessage = [...userMessages]
      .reverse()
      .find((msg) => msg?.role === 'user' && typeof msg?.content === 'string')
      ?.content || '';

    if (userMessages.length === 0) {
      send({ type: 'error', message: '缺少 messages 或 message' });
      res.end();
      return;
    }

    const systemPrompt = await buildPromptContext(mode, req.user.id, promptContext);
    const conversation = [
      { role: 'system', content: systemPrompt },
      ...userMessages
    ];
    const availableTools = await getAiTools(req.user.id);

    const finalState = await aiAgentGraph.invoke({
      conversation,
      availableTools,
      pendingToolCalls: [],
      usedTools: [],
      mode,
      userId: req.user.id,
      sendEvent: send,
      stepCount: 0,
      finalText: '',
      structuredReport: null,
      finalStatus: 'pending'
    });

    if (finalState?.finalStatus === 'completed') {
      try {
        const patchFacts = deriveMemoryPatch({ mode, promptContext, latestUserMessage });
        if (Object.keys(patchFacts).length > 0) {
          await upsertUserMemory(req.user.id, { patchFacts });
        }
      } catch (memoryError) {
        console.error('Memory update error:', memoryError);
      }
    }

    if (mode === 'interviewer') {
      send({
        type: 'done',
        usedTools: Array.isArray(finalState?.usedTools) ? finalState.usedTools : [],
        structuredReport: finalState?.structuredReport || null
      });
    } else {
      send({
        type: 'done',
        usedTools: Array.isArray(finalState?.usedTools) ? finalState.usedTools : []
      });
    }
    res.end();
  } catch (error) {
    console.error('AI chat error:', error);
    send({ type: 'error', message: error.message || 'AI 服务不可用' });
    res.end();
  }
};

module.exports = {
  createAiChatHandler
};

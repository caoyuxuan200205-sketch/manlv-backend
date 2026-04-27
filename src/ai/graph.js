const { StateGraph, START, END } = require('@langchain/langgraph');

const parseToolCallArguments = (rawArgs) => {
  if (typeof rawArgs !== 'string' || !rawArgs.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawArgs);
  } catch (error) {
    return {};
  }
};

const createAiAgentGraph = ({
  maxSteps,
  callAiChat,
  callAiChatStream,
  runAiTool,
  extractInterviewStructuredReport
}) => {
  const graph = new StateGraph({
    channels: {
      conversation: {
        value: (current, update) => current.concat(update),
        default: () => []
      },
      availableTools: {
        value: (_, update) => update,
        default: () => []
      },
      pendingToolCalls: {
        value: (_, update) => update,
        default: () => []
      },
      usedTools: {
        value: (current, update) => current.concat(update),
        default: () => []
      },
      mode: {
        value: (_, update) => update,
        default: () => 'advisor'
      },
      userId: {
        value: (_, update) => update,
        default: () => null
      },
      sendEvent: {
        value: (_, update) => update,
        default: () => null
      },
      stepCount: {
        value: (_, update) => update,
        default: () => 0
      },
      finalText: {
        value: (_, update) => update,
        default: () => ''
      },
      structuredReport: {
        value: (_, update) => update,
        default: () => null
      },
      finalStatus: {
        value: (_, update) => update,
        default: () => 'pending'
      }
    }
  });

  const agentNode = async (state) => {
    const assistantMessage = await callAiChat(state.conversation, state.availableTools);
    const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];

    if (toolCalls.length === 0) {
      return {
        pendingToolCalls: [],
        stepCount: state.stepCount + 1,
        finalStatus: 'stream_ready'
      };
    }

    return {
      conversation: [{
        role: 'assistant',
        content: assistantMessage.content || '',
        tool_calls: assistantMessage.tool_calls || undefined
      }],
      pendingToolCalls: toolCalls,
      stepCount: state.stepCount + 1,
      finalStatus: 'tool_pending'
    };
  };

  const toolsNode = async (state) => {
    const toolMessages = [];
    const usedTools = [];

    for (const toolCall of state.pendingToolCalls) {
      const name = toolCall?.function?.name;
      const parsedArgs = parseToolCallArguments(toolCall?.function?.arguments || '{}');

      if (typeof state.sendEvent === 'function') {
        state.sendEvent({ type: 'thinking', tool: name });
        state.sendEvent({ type: 'tool_start', tool: name });
      }

      const result = await runAiTool(name, parsedArgs, state.userId);
      if (typeof state.sendEvent === 'function') {
        state.sendEvent({ type: 'tool_result', tool: name, ok: result.ok });
      }
      usedTools.push({ name, ok: result.ok });
      toolMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result, null, 2)
      });
    }

    return {
      conversation: toolMessages,
      usedTools,
      pendingToolCalls: [],
      finalStatus: 'tool_complete'
    };
  };

  const streamNode = async (state) => {
    const stream = await callAiChatStream(state.conversation, state.availableTools);
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let fullText = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.replace('data:', '').trim();
        if (raw === '[DONE]') continue;

        try {
          const parsed = JSON.parse(raw);
          const text = parsed.choices?.[0]?.delta?.content || '';
          if (!text) continue;

          fullText += text;
          if (state.mode !== 'interviewer' && typeof state.sendEvent === 'function') {
            state.sendEvent({ type: 'text', content: text });
          }
        } catch (error) {
          // ignore malformed stream chunks
        }
      }
    }

    if (state.mode === 'interviewer') {
      const { displayText, report } = extractInterviewStructuredReport(fullText);
      if (displayText && typeof state.sendEvent === 'function') {
        state.sendEvent({ type: 'text', content: displayText });
      }

      return {
        finalText: displayText || '',
        structuredReport: report,
        finalStatus: 'completed'
      };
    }

    return {
      finalText: fullText,
      finalStatus: 'completed'
    };
  };

  const maxStepsNode = async (state) => {
    if (typeof state.sendEvent === 'function') {
      state.sendEvent({ type: 'text', content: '已达到工具调用上限，请缩小问题范围后重试。' });
    }

    return {
      finalStatus: 'max_steps'
    };
  };

  return graph
    .addNode('agent', agentNode)
    .addNode('tools', toolsNode)
    .addNode('stream', streamNode)
    .addNode('max_steps', maxStepsNode)
    .addEdge(START, 'agent')
    .addConditionalEdges(
      'agent',
      (state) => {
        if (Array.isArray(state.pendingToolCalls) && state.pendingToolCalls.length > 0) {
          return 'tools';
        }
        return 'stream';
      },
      {
        tools: 'tools',
        stream: 'stream'
      }
    )
    .addConditionalEdges(
      'tools',
      (state) => (state.stepCount >= maxSteps ? 'max_steps' : 'agent'),
      {
        max_steps: 'max_steps',
        agent: 'agent'
      }
    )
    .addEdge('stream', END)
    .addEdge('max_steps', END)
    .compile();
};

module.exports = {
  createAiAgentGraph
};

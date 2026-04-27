const createPromptRuntime = ({
  prisma,
  getMcpToolSummaryText,
  prompts
}) => {
  const normalizeAiMode = (value) => {
    const mode = typeof value === 'string' ? value.trim().toLowerCase() : 'advisor';
    if (mode === 'interview' || mode === 'interviewer') return 'interviewer';
    return 'advisor';
  };

  const getAiSystemPrompt = (mode) => (
    mode === 'interviewer' ? prompts.interviewer : prompts.advisor
  );

  const aiPromptVariables = {
    advisor: ['major', 'interview_list', 'current_city', 'mood_state', 'resume_summary'],
    interviewer: ['school_name', 'major_name', 'interview_city', 'interview_type', 'difficulty', 'resume_content']
  };

  const fillTemplateVariables = (template, variables, allowedKeys) => {
    let result = template;
    for (const key of allowedKeys) {
      const value = variables?.[key];
      const safeValue = value === undefined || value === null || value === '' ? '未提供' : String(value);
      result = result.replaceAll(`{${key}}`, safeValue);
    }
    return result;
  };

  const formatInterviewList = (interviews) => {
    if (!Array.isArray(interviews) || interviews.length === 0) return '暂无已录入面试';
    return interviews
      .map((item) => {
        const date = item?.date ? new Date(item.date) : null;
        const dateText = date && !Number.isNaN(date.getTime())
          ? date.toLocaleDateString('zh-CN')
          : '日期未定';
        return `${item.school || '院校未定'} / ${item.major || '专业未定'} / ${item.city || '城市未定'} / ${dateText} / ${item.type || '类型未定'}`;
      })
      .join('\n');
  };

  const normalizeMemoryFacts = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const output = {};
    const entries = Object.entries(value).slice(0, 30);
    for (const [rawKey, rawVal] of entries) {
      const key = String(rawKey || '').trim();
      if (!key) continue;

      if (typeof rawVal === 'string') {
        const v = rawVal.trim();
        if (!v) continue;
        output[key] = v.slice(0, 200);
        continue;
      }

      if (typeof rawVal === 'number' || typeof rawVal === 'boolean') {
        output[key] = rawVal;
        continue;
      }

      if (Array.isArray(rawVal)) {
        const arr = rawVal
          .filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
          .map((item) => (typeof item === 'string' ? item.trim() : item))
          .filter((item) => item !== '')
          .slice(0, 8);
        if (arr.length > 0) output[key] = arr;
      }
    }
    return output;
  };

  const formatMemoryFactsForPrompt = (facts) => {
    const normalized = normalizeMemoryFacts(facts);
    const entries = Object.entries(normalized);
    if (entries.length === 0) return '- 未记录';

    return entries
      .map(([key, val]) => {
        const text = Array.isArray(val) ? val.join('、') : String(val);
        return `- ${key}: ${text}`;
      })
      .join('\n');
  };

  const buildMemorySummaryText = (memoryFacts = {}) => {
    const normalized = normalizeMemoryFacts(memoryFacts);
    const keyMap = [
      ['preferred_name', '称呼'],
      ['major', '专业'],
      ['goal_school', '目标院校'],
      ['interview_city', '面试城市'],
      ['interview_type', '面试类型'],
      ['mood_state', '状态']
    ];

    const parts = keyMap
      .map(([key, label]) => {
        const val = normalized[key];
        if (val === undefined || val === null || val === '') return null;
        return `${label}：${Array.isArray(val) ? val.join('、') : val}`;
      })
      .filter(Boolean);

    return parts.length > 0 ? parts.join('；') : '';
  };

  const deriveMemoryPatch = ({ mode, promptContext, latestUserMessage }) => {
    const patch = {};
    const ctx = promptContext && typeof promptContext === 'object' ? promptContext : {};
    const upsert = (key, value) => {
      if (typeof value !== 'string') return;
      const text = value.trim();
      if (!text || text === '未提供') return;
      patch[key] = text.slice(0, 200);
    };

    if (mode === 'interviewer') {
      upsert('goal_school', ctx.school_name);
      upsert('major', ctx.major_name);
      upsert('interview_city', ctx.interview_city);
      upsert('interview_type', ctx.interview_type);
      upsert('difficulty', ctx.difficulty);
    } else {
      upsert('major', ctx.major);
      upsert('current_city', ctx.current_city);
      upsert('mood_state', ctx.mood_state);
      upsert('resume_summary', ctx.resume_summary);
    }

    const latest = typeof latestUserMessage === 'string' ? latestUserMessage.trim() : '';
    if (latest) {
      const preferredNameMatch = latest.match(/(?:我叫|我是)\s*([^\s，。,.！!？?\n]{1,20})/);
      if (preferredNameMatch?.[1]) patch.preferred_name = preferredNameMatch[1];

      const majorMatch = latest.match(/(?:我的?专业(?:是|为)?|专业方向(?:是|为)?)[：:\s]*([^\n，。,.]{2,30})/);
      if (majorMatch?.[1]) patch.major = majorMatch[1].trim();

      if (/焦虑|紧张|好慌|来不及|压力大/.test(latest)) patch.mood_state = '焦虑/紧张';
      if (/不紧张|轻松|稳住|还不错|不错|状态好|好多了|缓过来了/.test(latest)) patch.mood_state = '积极/稳定';
    }

    return normalizeMemoryFacts(patch);
  };

  const mergeMemoryFacts = (existingFacts, patchFacts) => ({
    ...normalizeMemoryFacts(existingFacts),
    ...normalizeMemoryFacts(patchFacts)
  });

  const upsertUserMemory = async (userId, { summary, patchFacts }) => {
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { memorySummary: true, memoryFacts: true }
    });

    const mergedFacts = mergeMemoryFacts(current?.memoryFacts, patchFacts);
    const finalSummary = typeof summary === 'string' && summary.trim()
      ? summary.trim().slice(0, 600)
      : buildMemorySummaryText(mergedFacts);

    return prisma.user.update({
      where: { id: userId },
      data: {
        memorySummary: finalSummary || null,
        memoryFacts: Object.keys(mergedFacts).length > 0 ? mergedFacts : null
      },
      select: { memorySummary: true, memoryFacts: true, updatedAt: true }
    });
  };

  const buildPromptContext = async (mode, userId, requestContext = {}) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { major: true, memorySummary: true, memoryFacts: true }
    });
    const interviews = await prisma.interview.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      take: 5
    });

    const baseContext = {
      major: user?.major || '未提供',
      interview_list: formatInterviewList(interviews),
      current_city: interviews[0]?.city || '未提供',
      mood_state: '未提供',
      resume_summary: '未提供',
      school_name: '未提供',
      major_name: user?.major || '未提供',
      interview_city: interviews[0]?.city || '未提供',
      interview_type: interviews[0]?.type || '未提供',
      difficulty: '中级',
      resume_content: '未提供'
    };

    const mergedContext = { ...baseContext, ...(requestContext || {}) };
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
    const currentYear = now.getFullYear();
    const previousYear = currentYear - 1;

    const basePromptTemplate = getAiSystemPrompt(mode);
    let mcpToolBlock = '';
    try {
      const mcpToolSummary = await getMcpToolSummaryText(userId);
      if (mcpToolSummary) {
        mcpToolBlock = `# 当前可用 MCP 工具\n${mcpToolSummary}\n\n`;
      }
    } catch (error) {
      console.error('读取 MCP 工具摘要失败:', error);
    }

    const dateHeader = `# 当前运行环境\n- 当前日期：${dateStr}\n- 时间参考规则：在处理“今年”、“去年”、“最新”、“夏令营”等时间敏感词汇时，必须以此日期为准判断。${currentYear} 年是当前年份，${previousYear} 年是去年。\n\n${mcpToolBlock}`;
    const filledPrompt = fillTemplateVariables(
      basePromptTemplate,
      mergedContext,
      aiPromptVariables[mode] || []
    );
    const basePrompt = `${dateHeader}${filledPrompt}`;

    const memorySummary = (user?.memorySummary || '').trim() || buildMemorySummaryText(user?.memoryFacts);
    const memoryFactsText = formatMemoryFactsForPrompt(user?.memoryFacts);
    const memoryBlock = `\n\n# 长期记忆（来自历史对话）\n- 记忆摘要：${memorySummary || '未记录'}\n- 关键事实：\n${memoryFactsText}\n\n# 记忆使用规则\n- 若用户本轮未否认，优先沿用长期记忆\n- 发现新信息与旧记忆冲突时，以用户本轮最新明确陈述为准，并在后续写回记忆`;

    return `${basePrompt}${memoryBlock}`;
  };

  const extractInterviewStructuredReport = (content) => {
    const text = typeof content === 'string' ? content.trim() : '';
    if (!text) {
      return { displayText: '', report: null };
    }

    let displayText = text;
    let jsonText = null;

    const fencedJsonMatch = text.match(/(?:##\s*第二部分：JSON 版[\s\S]*?)?```json\s*([\s\S]*?)\s*```/i);
    if (fencedJsonMatch) {
      jsonText = fencedJsonMatch[1];
      displayText = text.replace(fencedJsonMatch[0], '').trim();
    } else {
      const jsonSectionIndex = text.search(/##\s*第二部分：JSON 版/i);
      if (jsonSectionIndex !== -1) {
        const sectionText = text.slice(jsonSectionIndex);
        const objectMatch = sectionText.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          jsonText = objectMatch[0];
          displayText = text.slice(0, jsonSectionIndex).trim();
        }
      } else {
        const trailingJsonMatch = text.match(/\{\s*"total_score"[\s\S]*\}\s*$/);
        if (trailingJsonMatch) {
          jsonText = trailingJsonMatch[0];
          displayText = text.slice(0, trailingJsonMatch.index).trim();
        }
      }
    }

    let report = null;
    if (jsonText) {
      try {
        report = JSON.parse(jsonText);
      } catch (error) {
        report = null;
      }
    }

    return {
      displayText: displayText || text,
      report
    };
  };

  return {
    normalizeAiMode,
    normalizeMemoryFacts,
    buildMemorySummaryText,
    deriveMemoryPatch,
    upsertUserMemory,
    buildPromptContext,
    extractInterviewStructuredReport
  };
};

module.exports = {
  createPromptRuntime
};

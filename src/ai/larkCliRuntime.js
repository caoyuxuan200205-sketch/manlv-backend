const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const createLarkCliRuntime = ({
  cwd
}) => {
  const cliCandidates = [
    path.join(cwd, 'node_modules', '@larksuite', 'cli', 'bin', 'lark-cli.exe'),
    path.join(cwd, 'node_modules', '.bin', 'lark-cli.cmd'),
    'lark-cli'
  ];

  const resolveCliPath = () => {
    for (const candidate of cliCandidates) {
      if (candidate === 'lark-cli') return candidate;
      if (fs.existsSync(candidate)) return candidate;
    }
    return 'lark-cli';
  };

  const cliPath = resolveCliPath();

  const parseJsonOutput = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  };

  const runCli = async (args, { timeoutMs = 30000, json = true } = {}) => {
    try {
      const { stdout, stderr } = await execFileAsync(
        cliPath,
        args,
        {
          cwd,
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 1024 * 1024 * 8
        }
      );

      const stdoutText = String(stdout || '').trim();
      const stderrText = String(stderr || '').trim();
      return {
        ok: true,
        stdout: stdoutText,
        stderr: stderrText,
        data: json ? parseJsonOutput(stdoutText) : stdoutText
      };
    } catch (error) {
      const stdoutText = String(error?.stdout || '').trim();
      const stderrText = String(error?.stderr || '').trim();
      let parsed = null;
      if (json && stdoutText) {
        try {
          parsed = parseJsonOutput(stdoutText);
        } catch (e) {
          parsed = null;
        }
      }
      return {
        ok: false,
        stdout: stdoutText,
        stderr: stderrText,
        data: parsed,
        error: error.message || 'lark-cli 执行失败'
      };
    }
  };

  const getAuthStatus = async () => {
    const result = await runCli(['auth', 'status'], { json: true });
    if (!result.ok) {
      return {
        ok: false,
        error: result.stderr || result.stdout || result.error || '获取 lark-cli 登录状态失败'
      };
    }

    return {
      ok: true,
      data: result.data
    };
  };

  const startAuthLogin = async ({ recommend = true, domains = ['docs', 'drive'] } = {}) => {
    const args = ['auth', 'login', '--no-wait', '--json'];
    if (recommend) {
      args.push('--recommend');
    } else if (Array.isArray(domains) && domains.length > 0) {
      args.push('--domain', domains.join(','));
    }

    const result = await runCli(args, { json: true, timeoutMs: 30000 });
    if (!result.ok) {
      return {
        ok: false,
        error: result.stderr || result.stdout || result.error || '启动 lark-cli 登录失败'
      };
    }

    return {
      ok: true,
      data: result.data || result.stdout
    };
  };

  const withAuthContext = async (runner) => {
    const result = await runner();
    if (result.ok) return result;

    const authStatus = await getAuthStatus().catch(() => ({ ok: false }));
    return {
      ok: false,
      error: result.error,
      authStatus: authStatus.ok ? authStatus.data : null,
      raw: {
        stdout: result.stdout || '',
        stderr: result.stderr || ''
      }
    };
  };

  const searchDocs = async ({ query = '', pageSize = 10 } = {}) => withAuthContext(async () => {
    const args = [
      'docs',
      '+search',
      '--as', 'user',
      '--format', 'json',
      '--page-size', String(pageSize)
    ];
    if (query) {
      args.push('--query', query);
    }

    const result = await runCli(args, { json: true });
    if (!result.ok) {
      return {
        ok: false,
        error: result.stderr || result.stdout || result.error || '搜索飞书文档失败',
        stdout: result.stdout,
        stderr: result.stderr
      };
    }

    return {
      ok: true,
      data: result.data
    };
  });

  const fetchDoc = async ({ doc, apiVersion = 'v2', limit, offset } = {}) => withAuthContext(async () => {
    if (!doc) {
      return { ok: false, error: 'doc 参数缺失' };
    }

    const args = [
      'docs',
      '+fetch',
      '--as', 'user',
      '--format', 'json',
      '--api-version', String(apiVersion),
      '--doc', String(doc)
    ];
    if (limit !== undefined) args.push('--limit', String(limit));
    if (offset !== undefined) args.push('--offset', String(offset));

    const result = await runCli(args, { json: true, timeoutMs: 45000 });
    if (!result.ok) {
      return {
        ok: false,
        error: result.stderr || result.stdout || result.error || '读取飞书文档失败',
        stdout: result.stdout,
        stderr: result.stderr
      };
    }

    return {
      ok: true,
      data: result.data
    };
  });

  const createDoc = async ({
    content,
    docFormat = 'xml',
    apiVersion = 'v2',
    parentToken,
    parentPosition
  } = {}) => withAuthContext(async () => {
    if (!content || typeof content !== 'string') {
      return { ok: false, error: 'content 参数缺失或格式错误' };
    }
    if (parentToken && parentPosition) {
      return { ok: false, error: 'parentToken 与 parentPosition 不能同时传入' };
    }

    const args = [
      'docs',
      '+create',
      '--as', 'user',
      '--api-version', String(apiVersion),
      '--content', String(content)
    ];

    if (docFormat) args.push('--doc-format', String(docFormat));
    if (parentToken) args.push('--parent-token', String(parentToken));
    if (parentPosition) args.push('--parent-position', String(parentPosition));

    const result = await runCli(args, { json: true, timeoutMs: 45000 });
    if (!result.ok) {
      return {
        ok: false,
        error: result.stderr || result.stdout || result.error || '创建飞书文档失败',
        stdout: result.stdout,
        stderr: result.stderr
      };
    }

    return {
      ok: true,
      data: result.data
    };
  });

  const updateDoc = async ({
    doc,
    command,
    content,
    docFormat = 'xml',
    apiVersion = 'v2',
    pattern,
    blockId,
    srcBlockIds,
    revisionId
  } = {}) => withAuthContext(async () => {
    if (!doc || typeof doc !== 'string') {
      return { ok: false, error: 'doc 参数缺失或格式错误' };
    }
    if (!command || typeof command !== 'string') {
      return { ok: false, error: 'command 参数缺失或格式错误' };
    }

    const args = [
      'docs',
      '+update',
      '--as', 'user',
      '--api-version', String(apiVersion),
      '--doc', String(doc),
      '--command', String(command)
    ];

    if (docFormat) args.push('--doc-format', String(docFormat));
    if (content !== undefined) args.push('--content', String(content));
    if (pattern !== undefined) args.push('--pattern', String(pattern));
    if (blockId !== undefined) args.push('--block-id', String(blockId));
    if (srcBlockIds !== undefined) args.push('--src-block-ids', String(srcBlockIds));
    if (revisionId !== undefined) args.push('--revision-id', String(revisionId));

    const result = await runCli(args, { json: true, timeoutMs: 45000 });
    if (!result.ok) {
      return {
        ok: false,
        error: result.stderr || result.stdout || result.error || '更新飞书文档失败',
        stdout: result.stdout,
        stderr: result.stderr
      };
    }

    return {
      ok: true,
      data: result.data
    };
  });

  const getCalendarAgenda = async ({
    start,
    end,
    calendarId = 'primary',
    format = 'json'
  } = {}) => withAuthContext(async () => {
    const args = [
      'calendar',
      '+agenda',
      '--as', 'user',
      '--calendar-id', String(calendarId),
      '--format', String(format)
    ];

    if (start) args.push('--start', String(start));
    if (end) args.push('--end', String(end));

    const result = await runCli(args, { json: format === 'json', timeoutMs: 45000 });
    if (!result.ok) {
      return {
        ok: false,
        error: result.stderr || result.stdout || result.error || '查询飞书日程失败',
        stdout: result.stdout,
        stderr: result.stderr
      };
    }

    return {
      ok: true,
      data: result.data
    };
  });

  const findCreatedCalendarEvent = async ({
    eventId,
    start,
    end,
    calendarId = 'primary'
  } = {}) => {
    if (!eventId || !start || !end) return null;

    const agendaResult = await getCalendarAgenda({
      start: String(start).slice(0, 10),
      end: String(end).slice(0, 10),
      calendarId,
      format: 'json'
    });
    if (!agendaResult?.ok) return null;

    const events = Array.isArray(agendaResult?.data?.data) ? agendaResult.data.data : [];
    return events.find((item) => item?.event_id === eventId) || null;
  };

  const createCalendarEvent = async ({
    summary,
    start,
    end,
    description,
    attendeeIds,
    calendarId = 'primary',
    rrule,
    dryRun = false
  } = {}) => withAuthContext(async () => {
    if (!start || typeof start !== 'string') {
      return { ok: false, error: 'start 参数缺失或格式错误' };
    }
    if (!end || typeof end !== 'string') {
      return { ok: false, error: 'end 参数缺失或格式错误' };
    }

    const args = [
      'calendar',
      '+create',
      '--as', 'user',
      '--calendar-id', String(calendarId),
      '--start', String(start),
      '--end', String(end)
    ];

    if (summary) args.push('--summary', String(summary));
    if (description) args.push('--description', String(description));
    if (Array.isArray(attendeeIds) && attendeeIds.length > 0) {
      args.push('--attendee-ids', attendeeIds.join(','));
    } else if (typeof attendeeIds === 'string' && attendeeIds.trim()) {
      args.push('--attendee-ids', attendeeIds.trim());
    }
    if (rrule) args.push('--rrule', String(rrule));
    if (dryRun) args.push('--dry-run');

    const result = await runCli(args, { json: true, timeoutMs: 45000 });
    if (!result.ok) {
      return {
        ok: false,
        error: result.stderr || result.stdout || result.error || '创建飞书日程失败',
        stdout: result.stdout,
        stderr: result.stderr
      };
    }

    const createdEventId = result?.data?.data?.event_id;
    const matchedEvent = await findCreatedCalendarEvent({
      eventId: createdEventId,
      start,
      end,
      calendarId
    });

    if (matchedEvent && result?.data?.data) {
      result.data.data = {
        ...result.data.data,
        app_link: matchedEvent.app_link || null,
        organizer_calendar_id: matchedEvent.organizer_calendar_id || null,
        vchat: matchedEvent.vchat || null
      };
    }

    return {
      ok: true,
      data: result.data
    };
  });

  const listDriveFiles = async ({
    folderToken = '',
    orderBy = 'EditedTime',
    direction = 'DESC',
    pageSize = 20,
    pageAll = false,
    pageLimit = 3
  } = {}) => withAuthContext(async () => {
    const params = {
      folder_token: folderToken,
      order_by: orderBy,
      direction: direction,
      page_size: pageSize
    };

    const args = [
      'drive',
      'files',
      'list',
      '--as', 'user',
      '--format', 'json',
      '--params', JSON.stringify(params)
    ];

    if (pageAll) {
      args.push('--page-all', '--page-limit', String(pageLimit));
    }

    const result = await runCli(args, { json: true, timeoutMs: 45000 });
    if (!result.ok) {
      return {
        ok: false,
        error: result.stderr || result.stdout || result.error || '读取飞书云盘文件列表失败',
        stdout: result.stdout,
        stderr: result.stderr
      };
    }

    return {
      ok: true,
      data: result.data
    };
  });

  return {
    getCliPath: () => cliPath,
    getAuthStatus,
    startAuthLogin,
    searchDocs,
    fetchDoc,
    createDoc,
    updateDoc,
    getCalendarAgenda,
    createCalendarEvent,
    listDriveFiles
  };
};

module.exports = {
  createLarkCliRuntime
};

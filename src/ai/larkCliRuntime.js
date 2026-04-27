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
    listDriveFiles
  };
};

module.exports = {
  createLarkCliRuntime
};

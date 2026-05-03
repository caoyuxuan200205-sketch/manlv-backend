const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const isLinux = process.platform === 'linux';
const installScriptUrl = 'https://mat1.gtimg.com/qqcdn/qqnews/cli/hub/tencent-news/setup.sh';
const binaryName = 'tencent-news-cli';
const defaultInstallRoot = isLinux
  ? path.resolve(process.cwd(), '.tencent-news-cli')
  : path.join(os.homedir(), '.tencent-news-cli');
const installRoot = process.env.TENCENT_NEWS_INSTALL || defaultInstallRoot;
const installedCliPath = path.join(installRoot, 'bin', binaryName);
const envCliPath = String(process.env.TENCENT_NEWS_CLI_PATH || '').trim();

const looksLikeWindowsPath = (value) => /^[a-zA-Z]:[\\/]/.test(value);

const resolveExistingCliPath = () => {
  if (!envCliPath) return installedCliPath;
  if (isLinux && looksLikeWindowsPath(envCliPath)) {
    console.log(`[tencent-news] ignore windows CLI path on linux: ${envCliPath}`);
    return installedCliPath;
  }
  return envCliPath;
};

const existingCliPath = resolveExistingCliPath();

if (!isLinux) {
  console.log('[tencent-news] skip install: current platform is not linux');
  process.exit(0);
}

try {
  execFileSync(existingCliPath, ['help'], { stdio: 'ignore' });
  console.log(`[tencent-news] CLI already available at ${existingCliPath}`);
  process.exit(0);
} catch (error) {
  // Continue to installation path when CLI is missing or not executable.
}

fs.mkdirSync(installRoot, { recursive: true });

console.log(`[tencent-news] installing CLI to ${installRoot}`);
execFileSync('sh', ['-c', `curl -fsSL ${installScriptUrl} | sh`], {
  stdio: 'inherit',
  env: {
    ...process.env,
    TENCENT_NEWS_INSTALL: installRoot
  }
});

execFileSync(installedCliPath, ['help'], { stdio: 'ignore' });
console.log(`[tencent-news] CLI installed successfully at ${installedCliPath}`);

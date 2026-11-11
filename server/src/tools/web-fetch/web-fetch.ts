import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { errorMessage } from "../../lib/text.js";
import type {
  WebFetchInput,
  WebFetchRenderMode,
  WebFetchResult,
} from "./types.js";

const REQUEST_TIMEOUT_MS = 10_000;
const BROWSER_TIMEOUT_MS = 30_000;
const BROWSER_VIRTUAL_TIME_BUDGET_MS = 15_000;
const BROWSER_MAX_BUFFER = 32 * 1024 * 1024;
const MAX_CONTENT_LENGTH = 20_000;
const AUTO_BROWSER_MIN_CONTENT_LENGTH = 80;

function validateUrl(rawUrl: string): URL {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("无效的 URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("仅允许 HTTP 或 HTTPS 地址");
  }

  if (url.username || url.password) {
    throw new Error("URL 不允许包含用户名或密码");
  }

  const hostname = url.hostname.toLowerCase();

  // 拦截常见的本机地址和私有 IPv4 地址。
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname === "0.0.0.0"
  ) {
    throw new Error("不允许访问本机或私有网络地址");
  }

  return url;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);

  return match?.[1]
    ?.replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTENT_LENGTH);
}

/** 直接请求并解析原始 HTML；不执行页面 JS。 */
async function fetchViaHttp(url: URL): Promise<WebFetchResult> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: "manual",
    headers: {
      "User-Agent": "openai-agent-lab/1.0",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  // 不自动跟随重定向，避免跳转到未经校验的目标地址。
  if (response.status >= 300 && response.status < 400) {
    throw new Error("暂不支持网页重定向");
  }

  if (!response.ok) {
    throw new Error(`网页请求失败：HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(`不支持的网页类型：${contentType || "未知类型"}`);
  }

  const html = await response.text();

  return {
    url: url.href,
    status: response.status,
    title: extractTitle(html),
    content: extractText(html),
    renderMode: "http",
  };
}

function chromeCandidates(): string[] {
  const candidates: Array<string | undefined> = [
    process.env.CHROME_PATH?.trim(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ];

  if (process.platform === "win32") {
    const programFiles = process.env.PROGRAMFILES;
    const programFilesX86 = process.env["PROGRAMFILES(X86)"];
    const localAppData = process.env.LOCALAPPDATA;

    candidates.push(
      programFiles
        ? join(programFiles, "Google", "Chrome", "Application", "chrome.exe")
        : undefined,
      programFilesX86
        ? join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe")
        : undefined,
      localAppData
        ? join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
        : undefined,
    );
  }

  return [
    ...new Set(
      candidates.filter((candidate): candidate is string => Boolean(candidate)),
    ),
  ];
}

let cachedChromePath: string | null | undefined;

/** 查找 Chrome/Chromium：优先 CHROME_PATH，其次常见安装路径和 PATH。 */
function resolveChromePath(): string | null {
  if (cachedChromePath !== undefined) {
    return cachedChromePath;
  }

  for (const candidate of chromeCandidates()) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (existsSync(candidate)) {
        cachedChromePath = candidate;
        return candidate;
      }
      continue;
    }

    try {
      const locator = process.platform === "win32" ? "where" : "which";
      const output = execFileSync(locator, [candidate], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
      });
      const found = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);

      if (found) {
        cachedChromePath = found;
        return found;
      }
    } catch {
      // 当前候选不存在，继续尝试下一个
    }
  }

  cachedChromePath = null;
  return null;
}

let cachedChromeMajor: string | undefined;

/** 读取本机 Chrome 主版本号，用于生成不带 HeadlessChrome 标记的 User-Agent。 */
function chromeMajorVersion(chromePath: string): string {
  if (cachedChromeMajor) {
    return cachedChromeMajor;
  }

  try {
    const output = execFileSync(chromePath, ["--version"], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    cachedChromeMajor = output.match(/(\d+)\./)?.[1] ?? "131";
  } catch {
    cachedChromeMajor = "131";
  }

  return cachedChromeMajor;
}

function browserUserAgent(chromePath: string): string {
  const platform =
    process.platform === "win32"
      ? "Windows NT 10.0; Win64; x64"
      : process.platform === "linux"
        ? "X11; Linux x86_64"
        : "Macintosh; Intel Mac OS X 10_15_7";

  return [
    `Mozilla/5.0 (${platform})`,
    "AppleWebKit/537.36 (KHTML, like Gecko)",
    `Chrome/${chromeMajorVersion(chromePath)}.0.0.0`,
    "Safari/537.36",
  ].join(" ");
}

type ChromeExecError = NodeJS.ErrnoException & { killed?: boolean };

function runChrome(chromePath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      chromePath,
      args,
      {
        encoding: "utf8",
        maxBuffer: BROWSER_MAX_BUFFER,
        timeout: BROWSER_TIMEOUT_MS,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }

        if ((error as ChromeExecError).killed) {
          reject(
            new Error(`浏览器渲染超时（${BROWSER_TIMEOUT_MS / 1000} 秒）`),
          );
          return;
        }

        const detail = stderr
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(-3)
          .join(" | ");

        reject(
          new Error(
            `浏览器渲染失败：${errorMessage(error)}${detail ? `（${detail}）` : ""}`,
          ),
        );
      },
    );
  });
}

/** 超时后 execFile 只会杀掉主进程，这里按临时 profile 路径清理残留的 Chrome 子进程。 */
function killChromeProcesses(profileDir: string): void {
  if (process.platform === "win32") {
    return;
  }

  try {
    execFileSync("pkill", ["-f", profileDir], {
      stdio: "ignore",
      timeout: 2_000,
    });
  } catch {
    // 没有匹配进程时 pkill 返回非 0，忽略即可
  }
}

/**
 * 用无头 Chrome 执行页面 JS，再解析渲染后的 DOM。
 *
 * 注意：浏览器会执行页面里的脚本并加载子资源，`validateUrl` 只能校验入口地址。
 * 不要把 browser/auto 模式直接暴露给不可信用户；生产环境应配合容器或网络层隔离。
 */
async function fetchViaBrowser(url: URL): Promise<WebFetchResult> {
  const chromePath = resolveChromePath();

  if (!chromePath) {
    throw new Error(
      "未找到 Chrome/Chromium，无法使用浏览器渲染。请安装 Chrome，或通过 CHROME_PATH 指定可执行文件。",
    );
  }

  const profileDir = await mkdtemp(join(tmpdir(), "openai-agent-lab-chrome-"));

  const args = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-agent=${browserUserAgent(chromePath)}`,
    "--lang=zh-CN",
    "--accept-lang=zh-CN,zh;q=0.9,en;q=0.8",
    `--user-data-dir=${profileDir}`,
    `--virtual-time-budget=${BROWSER_VIRTUAL_TIME_BUDGET_MS}`,
    "--dump-dom",
    url.href,
  ];

  // 容器内以 root 运行时 Chrome 沙箱可能不可用；仅在显式开启时关闭。
  if (process.env.CHROME_NO_SANDBOX === "1") {
    args.unshift("--no-sandbox");
  }

  try {
    const html = await runChrome(chromePath, args);

    if (!html.trim()) {
      throw new Error("浏览器渲染结果为空");
    }

    return {
      url: url.href,
      status: 200,
      title: extractTitle(html),
      content: extractText(html),
      renderMode: "browser",
    };
  } finally {
    killChromeProcesses(profileDir);
    await rm(profileDir, { recursive: true, force: true }).catch(() => {
      // 临时目录清理失败不影响抓取结果
    });
  }
}

/** 先走轻量 HTTP；正文为空或过短时，自动回退到浏览器渲染。 */
async function fetchAuto(url: URL): Promise<WebFetchResult> {
  let httpResult: WebFetchResult | null = null;
  let httpError: unknown;

  try {
    httpResult = await fetchViaHttp(url);
  } catch (error) {
    httpError = error;
  }

  if (
    httpResult &&
    httpResult.content.trim().length >= AUTO_BROWSER_MIN_CONTENT_LENGTH
  ) {
    return httpResult;
  }

  try {
    return await fetchViaBrowser(url);
  } catch (browserError) {
    // HTTP 虽然成功但正文为空，说明拿到的是 JS 空壳；此时返回空结果没有意义。
    if (httpResult?.content.trim()) {
      return httpResult;
    }

    throw new Error(
      `HTTP 抓取失败：${errorMessage(httpError)}；浏览器渲染失败：${errorMessage(browserError)}`,
    );
  }
}

/**
 * 获取指定网页的标题和文本内容。
 *
 * 默认 `auto`：先做 HTTP 请求，正文为空或过短时自动回退到浏览器渲染。
 * 需要强制指定方式时传 `render: "http"` 或 `render: "browser"`。
 */
export async function webFetch(input: WebFetchInput): Promise<WebFetchResult> {
  const url = validateUrl(input.url);
  const mode: WebFetchRenderMode = input.render ?? "auto";

  switch (mode) {
    case "http":
      return fetchViaHttp(url);
    case "browser":
      return fetchViaBrowser(url);
    case "auto":
      return fetchAuto(url);
    default:
      throw new Error(`不支持的抓取方式：${String(mode)}`);
  }
}

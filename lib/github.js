/**
 * GitHub 安装来源的解析与远端 commit 查询。
 *
 * pnpm 的插件依赖可能是这几种写法：`github:owner/repo`、`git+https://github.com/owner/repo.git`、
 * `https://github.com/owner/repo`、`git@github.com:owner/repo.git`，都可以带 `#ref`。
 * 本模块只回答两个问题：这条 spec 指向哪个 GitHub 仓库、`#ref` 是什么；
 * 以及这个 ref 现在在远端对应哪个 commit（钉死 40 位 commit 的不问网络）。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** `github:owner/repo`，可带 `#ref`。 */
const SHORTHAND = /^github:([^/\s#]+)\/([^/\s#]+?)(?:#(.*))?$/i
/** `https://github.com/owner/repo(.git)`、`git+https://…`，可带 `#ref`。 */
const HTTPS = /^(?:git\+)?https?:\/\/github\.com\/([^/\s#]+)\/([^/\s#]+?)(?:\.git)?(?:#(.*))?$/i
/** `git@github.com:owner/repo(.git)`，可带 `#ref`。 */
const SCP = /^git@github\.com:([^/\s#]+)\/([^/\s#]+?)(?:\.git)?(?:#(.*))?$/i

const SHA = /^[0-9a-f]{40}$/i
const PUSH_TIMEOUT_MS = 20_000

/**
 * 把一条依赖 spec 解析成 GitHub 仓库信息。
 * @param {unknown} spec 依赖记录值，例如 `github:owner/repo#v1.2.3`。
 * @returns {{ owner: string, repo: string, ref: string|undefined, pinned: boolean, repoUrl: string }|null}
 *   不是 github.com 来源（本地路径、npm 包、其他 Git 主机）时返回 null。
 */
export function parseGithubSpec(spec) {
  if (typeof spec !== 'string') return null
  const text = spec.trim()
  if (text === '') return null
  let match = SHORTHAND.exec(text) ?? HTTPS.exec(text) ?? SCP.exec(text)
  if (match === null) return null
  const owner = match[1]
  const repo = match[2]
  if (owner === undefined || repo === undefined || owner === '' || repo === '') return null
  const ref = match[3] === undefined || match[3] === '' ? undefined : match[3].trim()
  return {
    owner,
    repo,
    ref,
    pinned: ref !== undefined && SHA.test(ref),
    repoUrl: `https://github.com/${owner}/${repo}.git`,
  }
}

/** 短 commit 展示：取前 7 位；没有就返回 null。 */
export function shortSha(sha) {
  return typeof sha === 'string' && sha.length >= 7 ? sha.slice(0, 7) : null
}

/**
 * 默认的 git 执行器。失败不抛异常，统一折成 `{ code, stdout, stderr }`，
 * 由调用方决定这是「检查失败」还是「远端没有这个 ref」。
 * @param {string[]} args git 参数。
 * @param {{ cwd?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export async function runGit(args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? PUSH_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        // 检查只读远端：不允许 git 弹凭据提示把宿主卡住。
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
      },
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const code = typeof error?.code === 'number' ? error.code : 1
    return {
      code,
      stdout: typeof error?.stdout === 'string' ? error.stdout : '',
      stderr: typeof error?.stderr === 'string' && error.stderr !== '' ? error.stderr : String(error?.message ?? error),
    }
  }
}

/** 把 `git ls-remote` 的输出折成 `{ ref, sha }` 列表。 */
export function parseLsRemote(output) {
  const refs = []
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const match = /^([0-9a-f]{40})\t(.+)$/.exec(line.trim())
    if (match !== null) refs.push({ sha: match[1], ref: match[2] })
  }
  return refs
}

/**
 * 求一个来源当前在远端对应的 commit。
 * @param {{ repoUrl: string, ref?: string, pinned: boolean }} source 解析后的来源。
 * @param {typeof runGit} [git] 可注入的 git 执行器，测试用。
 * @returns {Promise<{ commit: string, mode: 'head'|'ref'|'pinned' }>}
 * @throws {Error} git 不可用、网络失败、或远端没有这个 ref。
 */
export async function resolveRemoteCommit(source, git = runGit) {
  if (source.pinned) return { commit: source.ref.toLowerCase(), mode: 'pinned' }
  const args = ['ls-remote', source.repoUrl]
  if (source.ref !== undefined) {
    args.push(`refs/tags/${source.ref}`, `refs/tags/${source.ref}^{}`, `refs/heads/${source.ref}`)
  } else {
    args.push('HEAD')
  }
  const result = await git(args)
  if (result.code !== 0) {
    const detail = result.stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? `git 退出码 ${result.code}`
    throw new Error(`读远端失败：${detail}`)
  }
  const refs = parseLsRemote(result.stdout)
  if (source.ref === undefined) {
    const head = refs.find((entry) => entry.ref === 'HEAD')
    if (head === undefined) throw new Error('远端没有返回 HEAD')
    return { commit: head.sha, mode: 'head' }
  }
  // 轻量标签没有 `^{}` 行；附注标签优先取 peel 后的 commit。
  const candidates = [
    `refs/tags/${source.ref}^{}`,
    `refs/tags/${source.ref}`,
    `refs/heads/${source.ref}`,
    source.ref,
  ]
  for (const candidate of candidates) {
    const found = refs.find((entry) => entry.ref === candidate)
    if (found !== undefined) return { commit: found.sha, mode: 'ref' }
  }
  throw new Error(`远端没有 ref ${source.ref}`)
}

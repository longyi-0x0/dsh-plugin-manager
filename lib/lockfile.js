/**
 * 从 pnpm 锁文件里读出某个依赖实际安装的 commit。
 *
 * profile 的锁文件是 pnpm lockfile v9：根 importer 的依赖项有 `specifier` 与 `version`，
 * GitHub 来源的 `github:` spec 在 version 里记成
 * `https://codeload.github.com/owner/repo/tar.gz/<sha>`；通用 git 来源记成带 `#<sha>` 的地址。
 * 只需要这两行，所以这里用行解析，不给插件引入 YAML 依赖——`link:` 的小包没有自己的 node_modules。
 */

const SHA = /(?<![0-9a-f])([0-9a-f]{40})(?![0-9a-f])/i
const DEPENDENCY_FIELDS = new Set(['dependencies', 'devDependencies', 'optionalDependencies'])

/** 去掉 YAML 单/双引号包裹的键。 */
function unquote(key) {
  const text = key.trim()
  if (text.length >= 2 && ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"')))) {
    return text.slice(1, -1)
  }
  return text
}

/** 从 version 值里取 40 位 commit；不是 git 地址（npm 版本号、link 路径）时返回 null。 */
export function shaOfValue(value) {
  const match = SHA.exec(String(value ?? ''))
  return match === null ? null : match[1].toLowerCase()
}

/**
 * 读 importer 里 `name` 这一项安装的 commit。
 *
 * profile 的 workspace 设置了 `packages: ['.']`，pnpm 有时把根 importer 的键写成
 * 相对路径而不是 `.`（桌面 profile 是 `.`），所以这里不认 importer 的键，只看它下面的依赖项。
 * @param {string} lockText pnpm-lock.yaml 全文。
 * @param {string} name 依赖名。
 * @returns {string|null} 小写 40 位 commit；锁文件里没有、或不是 git 来源时为 null。
 */
export function installedCommit(lockText, name) {
  if (typeof lockText !== 'string' || lockText === '' || typeof name !== 'string' || name === '') return null
  const lines = lockText.split(/\r?\n/)
  const packagesAt = lines.findIndex((line) => /^packages:\s*$/.test(line))
  const limit = packagesAt === -1 ? lines.length : packagesAt

  /** 当前是否位于某个 importer 的依赖字段里。 */
  let inImporter = false
  let field = null
  for (let index = 0; index < limit; index += 1) {
    const line = lines[index]
    // importer 键（缩进 2，例如 `  .:` 或 `  ../../profiles/x:`）。
    const importerMatch = /^ {2}(\S.*?):\s*$/.exec(line)
    if (importerMatch !== null) {
      inImporter = true
      field = null
      continue
    }
    const fieldMatch = /^ {4}([A-Za-z][\w]*):\s*$/.exec(line)
    if (fieldMatch !== null) {
      field = inImporter && DEPENDENCY_FIELDS.has(fieldMatch[1]) ? fieldMatch[1] : null
      continue
    }
    if (line.trim() === '' || line.startsWith('#')) continue
    const dependencyMatch = /^ {6}(.+?):\s*$/.exec(line)
    if (field !== null && dependencyMatch !== null) {
      if (unquote(dependencyMatch[1]) !== name) continue
      for (let cursor = index + 1; cursor < limit; cursor += 1) {
        const valueLine = lines[cursor]
        const versionMatch = /^ {8}version:\s*(.+?)\s*$/.exec(valueLine)
        if (versionMatch !== null) return shaOfValue(versionMatch[1])
        // 越过 8 空格缩进就不再属于这一项。
        if (!/^ {8}/.test(valueLine)) break
      }
      return null
    }
  }
  return null
}

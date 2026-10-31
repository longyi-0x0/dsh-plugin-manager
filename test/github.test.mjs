import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseGithubSpec, parseLsRemote, resolveRemoteCommit, runGit, shortSha } from '../lib/github.js'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

test('parseGithubSpec：认 GitHub 缩写、https、git+https 与 scp 地址', () => {
  assert.deepEqual(parseGithubSpec('github:owner/repo'), {
    owner: 'owner',
    repo: 'repo',
    ref: undefined,
    pinned: false,
    repoUrl: 'https://github.com/owner/repo.git',
  })
  assert.equal(parseGithubSpec('github:owner/repo#v1.2.3').ref, 'v1.2.3')
  assert.equal(parseGithubSpec('github:owner/repo#v1.2.3').pinned, false)
  assert.equal(parseGithubSpec(`github:owner/repo#${SHA_A}`).pinned, true)

  assert.equal(parseGithubSpec('https://github.com/owner/repo').repoUrl, 'https://github.com/owner/repo.git')
  assert.equal(parseGithubSpec('https://github.com/owner/repo.git').repo, 'repo')
  assert.equal(parseGithubSpec('git+https://github.com/owner/repo.git#main').ref, 'main')
  assert.equal(parseGithubSpec('git@github.com:owner/repo.git').repoUrl, 'https://github.com/owner/repo.git')
})

test('parseGithubSpec：非 github.com 来源一律不认', () => {
  assert.equal(parseGithubSpec('dsh-pet'), null)
  assert.equal(parseGithubSpec('dsh-pet@^0.3.8'), null)
  assert.equal(parseGithubSpec('link:C:/work/plugin'), null)
  assert.equal(parseGithubSpec('git+https://gitcode.com/owner/repo.git'), null)
  assert.equal(parseGithubSpec('github:'), null)
  assert.equal(parseGithubSpec(undefined), null)
})

test('shortSha：取前 7 位，缺失给占位', () => {
  assert.equal(shortSha(SHA_A), 'aaaaaaa')
  assert.equal(shortSha(null), null)
  assert.equal(shortSha('abc'), null)
})

test('parseLsRemote：只收 40 位 commit 的行', () => {
  const refs = parseLsRemote(`${SHA_A}\tHEAD\n${SHA_B}\trefs/heads/main\nnot-a-ref\n`)
  assert.deepEqual(refs, [
    { sha: SHA_A, ref: 'HEAD' },
    { sha: SHA_B, ref: 'refs/heads/main' },
  ])
})

test('resolveRemoteCommit：无 ref 用 HEAD，钉住 commit 不访问网络', async () => {
  const asked = []
  const git = async (args) => {
    asked.push(args)
    return { code: 0, stdout: `${SHA_A}\tHEAD\n`, stderr: '' }
  }
  assert.deepEqual(await resolveRemoteCommit({ repoUrl: 'https://github.com/o/r.git', pinned: false }, git), {
    commit: SHA_A,
    mode: 'head',
  })
  assert.deepEqual(asked[0], ['ls-remote', 'https://github.com/o/r.git', 'HEAD'])

  asked.length = 0
  assert.deepEqual(await resolveRemoteCommit({ repoUrl: 'https://github.com/o/r.git', ref: SHA_A, pinned: true }, git), {
    commit: SHA_A,
    mode: 'pinned',
  })
  assert.equal(asked.length, 0, '钉死的 commit 不该再问远端')
})

test('resolveRemoteCommit：附注标签优先取 peel 后的 commit，其次分支', async () => {
  const git = async () => ({
    code: 0,
    stdout: [`${SHA_A}\trefs/tags/v1`, `${SHA_B}\trefs/tags/v1^{}`, `c`.repeat(40) + '\trefs/heads/main'].join('\n'),
    stderr: '',
  })
  assert.deepEqual(await resolveRemoteCommit({ repoUrl: 'https://github.com/o/r.git', ref: 'v1', pinned: false }, git), {
    commit: SHA_B,
    mode: 'ref',
  })
  assert.deepEqual(await resolveRemoteCommit({ repoUrl: 'https://github.com/o/r.git', ref: 'main', pinned: false }, git), {
    commit: 'c'.repeat(40),
    mode: 'ref',
  })
})

test('resolveRemoteCommit：远端没有这个 ref、或 git 失败时抛错', async () => {
  const empty = async () => ({ code: 0, stdout: `${SHA_A}\tHEAD\n`, stderr: '' })
  await assert.rejects(() => resolveRemoteCommit({ repoUrl: 'https://github.com/o/r.git', ref: 'nope', pinned: false }, empty), /远端没有 ref nope/)

  const failed = async () => ({ code: 128, stdout: '', stderr: 'fatal: could not read from remote\n' })
  await assert.rejects(() => resolveRemoteCommit({ repoUrl: 'https://github.com/o/r.git', pinned: false }, failed), /读远端失败：fatal: could not read from remote/)
})

test('runGit：命令失败折成结果，不抛异常', async () => {
  const result = await runGit(['ls-remote', 'https://example.invalid/none/none.git'], { timeoutMs: 5000 })
  assert.equal(result.code !== 0, true)
  assert.equal(typeof result.stderr, 'string')
})

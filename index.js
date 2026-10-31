/**
 * dsh-plugin-manager 宿主入口。
 *
 * 挂一行、注册四条只读/变更接口；检查与更新的全部业务逻辑在 lib/engine.js。
 * 依赖清单与更新动作都走 DSH 自己的 pluginManager 服务，不自己碰 pnpm 与 profile 文件，
 * 这样兼容性检查、组合包对账与 HMR 重组仍然由 DSH 负责。
 */

import { createEngine } from './lib/engine.js'
import { registerRoutes } from './lib/routes.js'

export const name = 'dsh-plugin-manager'

/** webServer 用来挂接口；pluginManager 是卸载/重装的唯一入口；profileContext 提供 profile 目录。 */
export const inject = ['webServer', 'pluginManager', 'profileContext']

export function apply(ctx) {
  const profileDir = ctx.profileContext?.dir
  if (typeof profileDir !== 'string' || profileDir === '') {
    ctx.logger?.warn?.('dsh-plugin-manager: 当前宿主没有 profile 目录，插件不启用')
    return
  }
  const engine = createEngine({
    profileDir,
    manager: ctx.pluginManager,
    logger: ctx.logger,
  })
  ctx.effect(() => registerRoutes(ctx, engine), 'dsh-plugin-manager: routes')
  ctx.logger?.info?.(`dsh-plugin-manager: 检查范围 ${profileDir}`)
}

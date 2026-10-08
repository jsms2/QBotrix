// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

import dayjs from 'dayjs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const resolved = createRequire(import.meta.url).resolve('dayjs')
if (!resolved.startsWith(path.join(root, 'node_modules') + path.sep)) {
  throw new Error('示例必须从插件自己的 node_modules 加载 dayjs')
}

export default {
  name: 'independent-dependencies-example',
  setup({ registerCommand, logger }) {
    logger.info('dayjs 已从本插件的 node_modules 加载')
    registerCommand({
      name: '日期', description: '使用插件独立 dayjs 依赖显示日期', scopes: ['c2c', 'group'],
      async handler(_args, reply) { await reply(`今天是 **${dayjs().format('YYYY-MM-DD')}**`) },
    })
  },
}

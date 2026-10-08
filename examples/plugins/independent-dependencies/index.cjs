// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

'use strict'

const path = require('node:path')
const dayjs = require('dayjs')
if (!require.resolve('dayjs').startsWith(path.join(__dirname, 'node_modules') + path.sep)) {
  throw new Error('示例必须从插件自己的 node_modules 加载 dayjs')
}

module.exports = {
  name: 'independent-dependencies-example',
  setup({ registerCommand, logger }) {
    logger.info('dayjs 已从本插件的 node_modules 加载')
    registerCommand({
      name: '日期', description: '使用插件独立 dayjs 依赖显示日期', scopes: ['c2c', 'group'],
      async handler(_args, reply) { await reply(`今天是 **${dayjs().format('YYYY-MM-DD')}**`) },
    })
  },
}

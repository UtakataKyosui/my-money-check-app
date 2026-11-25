import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleNodeRequest } from '../../server/nodeAdapter.js';
import { handleNotionQuery } from '../../server/notionCore.js';

// 最初の呼び出しで Notion を最大 3 回直列に呼ぶ（各 10 秒でタイムアウト）ため余裕を持たせる
export const config = { maxDuration: 30 };

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  await handleNodeRequest(req, res, (request) => handleNotionQuery(request));
}

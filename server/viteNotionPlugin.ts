/**
 * `npm run dev` と `vite preview` で /api/notion/query を本番と同じコアで処理する Vite プラグイン。
 * このファイルは vite.config.ts からのみ読み込まれ、ブラウザのバンドルには含まれない。
 */
import type { Connect, Plugin } from 'vite';
import { handleNodeRequest } from './nodeAdapter.js';

export const NOTION_QUERY_PATH = '/api/notion/query';

function createMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const pathname = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (pathname !== NOTION_QUERY_PATH) {
      next();
      return;
    }
    void handleNodeRequest(req, res, async (request) => {
      // 遅延 import: 他のリクエストでは Notion SDK を読み込まない
      const { handleNotionQuery } = await import('./notionCore.js');
      return handleNotionQuery(request);
    });
  };
}

export function notionRelayPlugin(): Plugin {
  return {
    name: 'notion-relay',
    configureServer(server) {
      server.middlewares.use(createMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createMiddleware());
    },
  };
}

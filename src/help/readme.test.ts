import { describe, expect, it } from 'vitest';
import readme from '../../README.md?raw';
import { NOTION_SPECS } from '../lib/notion';

/** 表の1行（`| … |`）のうち、プロパティ名を `名前` の形で含む行 */
function rowsFor(name: string): string[] {
  return readme.split('\n').filter((line) => line.startsWith('|') && line.includes(`\`${name}\``));
}

describe('README のNotionデータ形式の表は NOTION_SPECS と一致している', () => {
  for (const spec of NOTION_SPECS) {
    describe(spec.title, () => {
      it('銀行・カードの見出しが載っている', () => {
        expect(readme).toContain(spec.title);
      });

      for (const property of spec.properties) {
        const name = property.name ?? spec.recommendedTitleName;
        const label = property.name === null ? `${name}（タイトル型の推奨名）` : name;

        it(`${label}: 必須/任意の別と、許容する型名が同じ行に載っている`, () => {
          const rows = rowsFor(name);
          expect(rows.length).toBeGreaterThan(0);
          const flag = property.required ? '必須' : '任意';
          const other = property.required ? '任意' : '必須';
          // 同名のプロパティが銀行・カードの両方にあっても、どちらかの表の行が一致すればよい
          const match = rows.find(
            (row) => row.includes(`| ${flag} |`) && !row.includes(`| ${other} |`) && property.types.every((t) => row.includes(`\`${t}\``)),
          );
          expect(match, `${name} の行: ${rows.join('\n')}`).toBeDefined();
        });
      }
    });
  }

  it('設定手順・構成・トークンの扱い・デプロイ時の注意・プライバシーの節がある', () => {
    for (const heading of ['データソース（CSV / Notion）', 'Notionの設定手順', '構成', 'トークンの扱い', 'デプロイ時の注意', 'プライバシー']) {
      expect(readme).toMatch(new RegExp(`^#{2,4} ${heading.replace(/[()（）/]/g, '\\$&')}$`, 'm'));
    }
    expect(readme).toContain('/api/notion/query');
    expect(readme).toContain('x-notion-token');
    expect(readme).toContain('@tanstack/react-query');
    expect(readme).toContain('@notionhq/client');
  });
});

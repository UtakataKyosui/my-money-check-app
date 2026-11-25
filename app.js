import { decodeCsv, readStatement } from './csv.js';

const input = document.querySelector('#files');
const messages = document.querySelector('#messages');

function showStatement(statement, filename) {
  const section = document.querySelector(`#${statement.type}`);
  const table = section.querySelector('table');
  const head = document.createElement('thead');
  const heading = document.createElement('tr');
  for (const column of statement.columns) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = column;
    heading.append(cell);
  }
  head.append(heading);
  const body = document.createElement('tbody');
  for (const row of statement.rows) {
    const line = document.createElement('tr');
    for (const value of row) {
      const cell = document.createElement('td');
      cell.textContent = value;
      line.append(cell);
    }
    body.append(line);
  }
  table.replaceChildren(head, body);
  for (const [key, total] of Object.entries(statement.totals)) {
    section.querySelector(`[data-total="${key}"]`).textContent = `${total.toLocaleString('ja-JP')}円`;
  }
  section.querySelector('.filename').textContent = filename;
  section.querySelector('.count').textContent = `${statement.rows.length.toLocaleString('ja-JP')}件`;
  section.querySelector('.content').hidden = false;
  section.querySelector('.clear').hidden = false;
}

input.addEventListener('change', async () => {
  const files = Array.from(input.files);
  input.disabled = true;
  messages.replaceChildren();
  for (const file of files) {
    const message = document.createElement('p');
    try {
      const statement = readStatement(decodeCsv(await file.arrayBuffer()));
      showStatement(statement, file.name);
      message.textContent = `${file.name} を読み込みました。`;
    } catch (error) {
      message.textContent = `${file.name}: ${error.message || 'ファイルを読み込めませんでした。'}`;
    }
    messages.append(message);
  }
  input.value = '';
  input.disabled = false;
});

document.querySelectorAll('.clear').forEach((button) => {
  button.addEventListener('click', () => {
    const section = button.closest('section');
    section.querySelector('table').replaceChildren();
    section.querySelector('.filename').textContent = 'CSVは読み込まれていません。';
    section.querySelector('.content').hidden = true;
    button.hidden = true;
  });
});

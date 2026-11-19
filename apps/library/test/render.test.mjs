import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { renderIndex, renderNotFound, validate } from '../render.mjs';

const data = JSON.parse(await readFile(new URL('../games.json', import.meta.url), 'utf8'));

test('games.json is valid', () => {
  assert.deepEqual(validate(data), []);
});

test('the library lists every game with its link, in both languages', () => {
  const html = renderIndex(data);
  for (const game of data.games) {
    assert.ok(html.includes(`href="${game.url}"`), game.id);
    assert.ok(html.includes(game.tagline.es) && html.includes(game.tagline.en), game.id);
  }
  assert.ok(html.includes('href="/cardcraft-castles/"'));
});

test('text from games.json is escaped', () => {
  const game = { ...data.games[0], id: 'x', title: '<b>&</b>' };
  const html = renderIndex({ games: [game] });
  assert.ok(html.includes('&lt;b&gt;&amp;&lt;/b&gt;'));
  assert.ok(!html.includes('<b>&</b>'));
});

test('validate catches broken entries', () => {
  const problems = validate({ games: [{ id: 'Bad Id', url: 'javascript:alert(1)' }] });
  assert.ok(problems.some((p) => p.includes('"id"')));
  assert.ok(problems.some((p) => p.includes('"url"')));
  assert.ok(problems.some((p) => p.includes('tagline.es')));
});

test('the 404 page links back to the library', () => {
  assert.ok(renderNotFound().includes('href="/"'));
});

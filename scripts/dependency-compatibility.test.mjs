import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import matter from 'gray-matter';
import katex from 'katex';

const require = createRequire(import.meta.url);
const matterRequire = createRequire(require.resolve('gray-matter/package.json'));

test('Markdown front matter still parses and round-trips with patched dependencies', () => {
  const parsed = matter('---\ntitle: Release notes\ntags:\n  - linkedin\n  - desktop\npublish: true\n---\n# Update\n');
  assert.deepEqual(parsed.data, { title: 'Release notes', tags: ['linkedin', 'desktop'], publish: true });
  const roundTrip = matter(matter.stringify(parsed.content, parsed.data));
  assert.deepEqual(roundTrip.data, parsed.data);
  assert.equal(roundTrip.content.trim(), '# Update');
});

test('the legacy YAML CLI remains compatible with the argparse security override', () => {
  const yamlCli = matterRequire.resolve('js-yaml/bin/js-yaml.js');
  const run = (...args) => execFileSync(process.execPath, [yamlCli, ...args], {
    input: 'title: Release notes\nplatforms:\n  - windows\n  - macos\n  - linux\n',
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  assert.match(run('--help'), /usage:[\s\S]*--compact/i);
  assert.deepEqual(JSON.parse(run('-')), { title: 'Release notes', platforms: ['windows', 'macos', 'linux'] });
});

test('the patched math renderer retains the API used by Markdown diagrams', () => {
  const markup = katex.renderToString('x^2 + \\frac{1}{2}', { throwOnError: true, trust: false });
  assert.match(markup, /class="katex"/);
  assert.match(markup, /<math/);
});

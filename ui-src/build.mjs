#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hubRoot = path.resolve(__dirname, '..');

const built = await esbuild.build({
  entryPoints: [path.join(__dirname, 'app.mjs')],
  bundle: true,
  format: 'esm',
  minify: true,
  charset: 'utf8',
  write: false,
  target: ['es2022'],
});

const jsCode = built.outputFiles[0].text;
const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const html = template.replace('/* __INLINE_BUNDLE__ */', () => jsCode);

fs.mkdirSync(path.join(hubRoot, 'ui'), { recursive: true });
const outPath = path.join(hubRoot, 'ui', 'panel.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log(`Built ${outPath} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);

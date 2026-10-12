// e2e용 정적 서버: Vercel 정적 배포처럼 존재하는 파일을 먼저 제공하고, REWRITE=1이면 vercel.json rewrites를 적용한다(없으면 404).
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const root = process.env.ROOT_DIR || 'dist';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const rules = process.env.REWRITE ? JSON.parse(readFileSync('vercel.json', 'utf8')).rewrites : [];
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = join(root, p === '/' ? 'index.html' : p);
  if (!(existsSync(f) && statSync(f).isFile())) {
    const hit = rules.find((r) => new RegExp('^' + r.source.replace(/^\//, '\/') + '$').test(p));
    if (!hit) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('404: NOT_FOUND'); return; }
    f = join(root, hit.destination);
  }
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f));
}).listen(Number(process.env.PORT || 4177));

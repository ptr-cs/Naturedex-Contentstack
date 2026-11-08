import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist');
const index = process.argv.indexOf('--port');
const port = Number(index === -1 ? process.env.PORT || 4321 : process.argv[index + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.geojson':'application/geo+json', '.ttf':'font/ttf', '.xml':'application/xml; charset=utf-8', '.txt':'text/plain; charset=utf-8' };
await stat(resolve(root, 'index.html')).catch(() => { throw new Error('Run npm run build before preview.'); });
const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(400); res.end(); return; }
    let info = await stat(file).catch(() => null);
    if (!info && !extname(file)) { file = resolve(file, 'index.html'); info = await stat(file).catch(() => null); }
    else if (info?.isDirectory()) { file = resolve(file, 'index.html'); info = await stat(file).catch(() => null); }
    const found = info?.isFile();
    if (!found) file = resolve(root, '404.html');
    const data = await readFile(file);
    res.writeHead(found ? 200 : 404, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(400); res.end('Bad request'); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Naturedex preview: http://127.0.0.1:${port}\n`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));

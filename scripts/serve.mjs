import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve(process.cwd());
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.wasm': 'application/wasm',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
};

createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        let file = resolve(root, `.${pathname}`);
        if (file !== root && !file.startsWith(root + sep)) throw new Error('Invalid path');
        if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
        const body = await readFile(file);
        response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
        response.end(body);
    } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
    }
}).listen(8000, '127.0.0.1', () => console.log('ΚΟΣΜΟΣ running at http://127.0.0.1:8000'));

import { cp, mkdir, writeFile } from 'node:fs/promises';

await mkdir(new URL('../dist/build/', import.meta.url), { recursive: true });
await Promise.all([
    cp(new URL('../index.html', import.meta.url), new URL('../dist/index.html', import.meta.url)),
    cp(new URL('../qlaw-wasm.js', import.meta.url), new URL('../dist/qlaw-wasm.js', import.meta.url)),
    cp(new URL('../build/release.wasm', import.meta.url), new URL('../dist/build/release.wasm', import.meta.url)),
    cp(new URL('../README.md', import.meta.url), new URL('../dist/README.md', import.meta.url)),
    writeFile(new URL('../dist/.nojekyll', import.meta.url), '')
]);

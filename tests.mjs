import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(Boolean);
assert.ok(inlineScripts.length > 0);
assert.match(html, /cdn\.jsdelivr\.net\/npm\/three-globe@2\.31\.1\/example\/img\/earth-blue-marble\.jpg/);
assert.match(html, /1 - lon \/ lonBands - this\.TEXTURE_LON_OFFSET \/ 360/);
assert.doesNotMatch(html, /float noise\(|float terrain\s*=|TEXTURE_LON_OFFSET\) % 360/);
new Function(inlineScripts.at(-1));

const bytes = await readFile(new URL('./build/release.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, { env: { abort() {} } });
const qlaw = instance.exports;

qlaw.init(0.5, 1000, 3000, 7000, 0.01, 0.2, 0.3, 0.4, 1, 1, 1, 1, 1, 60, 86400);
const count = qlaw.run(7000, 0.01, 0.2, 0.3, 0.4, 0.5);
assert.ok(count >= 1);
assert.equal(qlaw.getResultOk(), 1);
assert.equal(qlaw.getResultT(), 0);
assert.equal(qlaw.getResultFuel(), 0);
assert.ok(Math.abs(qlaw.calcImpulsiveDv(7000, 7000, 0.2, 0.2)) < 1e-12);

qlaw.init(0.5, 1000, 3000, 7100, 0.01, 0.2, 0.3, 0.4, 1, 1, 1, 1, 1, 60, 3600);
qlaw.run(7000, 0.01, 0.2, 0.3, 0.4, 0.5);
assert.ok(Number.isFinite(qlaw.getResultDv()));
assert.ok(qlaw.getResultDv() >= 0);
assert.ok(qlaw.getResultFuel() >= 0);
assert.ok(qlaw.getTrajM(qlaw.getTrajCount() - 1) > 0);

qlaw.init(0.5, 1000, 3000, 42164, 0.001, 0, 0, 0, 1, 1, 1, 0, 0, 60, 180 * 86400);
const leoGeoCount = qlaw.run(7000, 0.01, 28.5 * Math.PI / 180, 0, 0, 0);
const leoGeoLast = leoGeoCount - 1;
assert.equal(qlaw.getResultOk(), 1);
assert.ok(Math.abs(qlaw.getTrajA(leoGeoLast) - 42164) <= 10);
assert.ok(Math.abs(qlaw.getTrajE(leoGeoLast) - 0.001) <= 0.001);
assert.ok(Math.abs(qlaw.getTrajI(leoGeoLast)) <= 0.001);
assert.ok(qlaw.getResultT() > 150 * 86400 && qlaw.getResultT() < 180 * 86400);
assert.ok(qlaw.getResultDv() > 5 && qlaw.getResultDv() < 7);

console.log('Q-law WASM regression tests passed');

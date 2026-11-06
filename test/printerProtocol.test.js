import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCrc8, buildCommandPacket, encodeLineRunLength, packLineLeastSignificantBitFirst, buildPrintJob, PRINTER_LINE_WIDTH_PIXELS,
} from '../src/printerProtocol.js';
import { sendPrintJobPaced } from '../src/printJobSender.js';
import { ditherImageDataFloydSteinberg } from '../src/printableBitmap.js';

const toHex = (bytes) => Buffer.from(bytes).toString('hex');

test('packets are framed with crc8 and FF trailer', () => {
  assert.equal(calculateCrc8([0x33]), 0x99);
  assert.equal(toHex(buildCommandPacket(0xa3, [0x00])), '5178a30001000000ff');
});

test('lines run-length encode, with 127-pixel max runs', () => {
  assert.deepEqual(encodeLineRunLength(new Uint8Array(PRINTER_LINE_WIDTH_PIXELS)), [127, 127, 127, 3]);
  assert.deepEqual(encodeLineRunLength([1, 1, 1, 0, 0, 0, 0, 0]), [0x83, 0x05]);
  assert.equal(packLineLeastSignificantBitFirst([1, 0, 0, 0, 0, 0, 0, 1])[0], 0x81);
});

test('noisy lines fall back to raw packets; job starts with settings, ends with status query', () => {
  const checkerPixels = Uint8Array.from({ length: PRINTER_LINE_WIDTH_PIXELS }, (_, pixelIndex) => pixelIndex & 1);
  const printJobHex = toHex(buildPrintJob({ blackPixels: checkerPixels, heightInPixels: 1 }));
  assert.ok(printJobHex.startsWith(toHex(buildCommandPacket(0xa4, [0x33]))));
  assert.ok(printJobHex.includes('5178a2003000'));
  assert.ok(printJobHex.endsWith(toHex(buildCommandPacket(0xa3, [0x00]))));
});

test('sender delivers every byte in order and is throttled after the head start', async () => {
  const printJobBytes = Uint8Array.from({ length: 6096 }, (_, byteIndex) => byteIndex & 0xff);
  const receivedChunks = [];
  const sendStartTime = performance.now();
  await sendPrintJobPaced(async (chunkBytes) => receivedChunks.push(Uint8Array.from(chunkBytes)), printJobBytes, { sendRateBytesPerSecond: 10000 });
  const elapsedMilliseconds = performance.now() - sendStartTime;
  assert.deepEqual(Buffer.concat(receivedChunks), Buffer.from(printJobBytes));
  assert.ok(elapsedMilliseconds >= 180, `2000 bytes past the 4096 head start at 10 KB/s should take ~200ms, took ${elapsedMilliseconds}`);
});

test('rejects heat energy that does not fit its 2-byte field', () => {
  assert.throws(() => buildPrintJob({ blackPixels: new Uint8Array(0), heightInPixels: 0, heatEnergy: 99999 }), RangeError);
  assert.throws(() => buildPrintJob({ blackPixels: new Uint8Array(0), heightInPixels: 0, heatEnergy: Number.NaN }), RangeError);
});

test('sender never writes more than the link allows', async () => {
  const chunkLengths = [];
  await sendPrintJobPaced(async (chunkBytes) => chunkLengths.push(chunkBytes.length), new Uint8Array(500), { writeChunkSizeBytes: 20 });
  assert.ok(chunkLengths.every((chunkLength) => chunkLength <= 20));
  assert.equal(chunkLengths.reduce((total, chunkLength) => total + chunkLength, 0), 500);
});

test('dithering: white stays white, black stays black, 50% gray is about half black', () => {
  const createSolidImageData = (grayValue) => ({ width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(grayValue) });
  const countBlack = (blackPixels) => blackPixels.reduce((total, pixel) => total + pixel, 0);
  assert.equal(countBlack(ditherImageDataFloydSteinberg(createSolidImageData(255))), 0);
  assert.equal(countBlack(ditherImageDataFloydSteinberg(createSolidImageData(0))), 256);
  const grayBlackCount = countBlack(ditherImageDataFloydSteinberg(createSolidImageData(128)));
  assert.ok(grayBlackCount > 100 && grayBlackCount < 156, `got ${grayBlackCount}`);
});

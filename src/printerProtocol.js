// "Cat printer" command protocol (X6h / TinyPrint and the wider 51 78 family).
// Packet: 51 78 [commandId] 00 [payloadLength LE16] [payload] [crc8(payload)] FF
// Pure: no I/O, runs in browser and Node.

export const PRINTER_LINE_WIDTH_PIXELS = 384;
const PRINTER_LINE_WIDTH_BYTES = PRINTER_LINE_WIDTH_PIXELS / 8;
const PRINT_SPEED = 10;
const SPEED_REFRESH_EVERY_LINES = 200;

const COMMAND_BLACKENING = 0xa4;
const COMMAND_HEAT_ENERGY = 0xaf;
const COMMAND_PRINT_MODE = 0xbe;
const COMMAND_PRINT_SPEED = 0xbd;
const COMMAND_LINE_RUN_LENGTH = 0xbf;
const COMMAND_LINE_RAW = 0xa2;
const COMMAND_FEED_PAPER = 0xa1;
const COMMAND_DEVICE_STATE = 0xa3;

export const DEFAULT_HEAT_ENERGY = 9500; // what the TinyPrint app sends

// CRC-8, polynomial 0x07, initial value 0
export const calculateCrc8 = (bytes) => {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
};

export const buildCommandPacket = (commandId, payload) => {
  const payloadBytes = Uint8Array.from(payload);
  return Uint8Array.of(
    0x51, 0x78, commandId, 0x00,
    payloadBytes.length & 0xff, payloadBytes.length >> 8,
    ...payloadBytes,
    calculateCrc8(payloadBytes), 0xff,
  );
};

const encodeUint16LittleEndian = (value) => [value & 0xff, (value >> 8) & 0xff];

// Each byte = (color << 7) | runLength (1..127). 1 = black.
export const encodeLineRunLength = (linePixels) => {
  const encodedRuns = [];
  let runStartIndex = 0;
  while (runStartIndex < linePixels.length) {
    const runColor = linePixels[runStartIndex];
    let runEndIndex = runStartIndex;
    while (runEndIndex < linePixels.length && linePixels[runEndIndex] === runColor) runEndIndex++;
    for (let remainingLength = runEndIndex - runStartIndex; remainingLength > 0; remainingLength -= 127) {
      encodedRuns.push((runColor << 7) | Math.min(remainingLength, 127));
    }
    runStartIndex = runEndIndex;
  }
  return encodedRuns;
};

export const packLineLeastSignificantBitFirst = (linePixels) => {
  const packedBytes = new Uint8Array(PRINTER_LINE_WIDTH_BYTES);
  linePixels.forEach((pixel, pixelIndex) => {
    if (pixel) packedBytes[pixelIndex >> 3] |= 1 << (pixelIndex & 7);
  });
  return packedBytes;
};

const concatenateByteArrays = (byteArrays) => {
  const combinedBytes = new Uint8Array(byteArrays.reduce((total, bytes) => total + bytes.length, 0));
  let writeOffset = 0;
  for (const bytes of byteArrays) {
    combinedBytes.set(bytes, writeOffset);
    writeOffset += bytes.length;
  }
  return combinedBytes;
};

// blackPixels: Uint8Array of PRINTER_LINE_WIDTH_PIXELS * heightInPixels, 1 = burn.
export const buildPrintJob = ({ blackPixels, heightInPixels, heatEnergy = DEFAULT_HEAT_ENERGY, trailingFeedLines = 100 }) => {
  if (!Number.isInteger(heatEnergy) || heatEnergy < 0 || heatEnergy > 0xffff) {
    throw new RangeError(`heatEnergy must be an integer from 0 to 65535, got ${heatEnergy}`); // sent as 2 bytes
  }
  const packets = [
    buildCommandPacket(COMMAND_BLACKENING, [0x33]), // level 3 of 1..5
    buildCommandPacket(COMMAND_HEAT_ENERGY, encodeUint16LittleEndian(heatEnergy)),
    buildCommandPacket(COMMAND_PRINT_MODE, [0x00]), // 0 = image, 1 = text
    buildCommandPacket(COMMAND_PRINT_SPEED, [PRINT_SPEED]),
  ];
  for (let lineIndex = 0; lineIndex < heightInPixels; lineIndex++) {
    const lineStart = lineIndex * PRINTER_LINE_WIDTH_PIXELS;
    const linePixels = blackPixels.subarray(lineStart, lineStart + PRINTER_LINE_WIDTH_PIXELS);
    const runLengthEncodedLine = encodeLineRunLength(linePixels);
    packets.push(runLengthEncodedLine.length <= PRINTER_LINE_WIDTH_BYTES
      ? buildCommandPacket(COMMAND_LINE_RUN_LENGTH, runLengthEncodedLine)
      : buildCommandPacket(COMMAND_LINE_RAW, packLineLeastSignificantBitFirst(linePixels)));
    if ((lineIndex + 1) % SPEED_REFRESH_EVERY_LINES === 0) {
      packets.push(buildCommandPacket(COMMAND_PRINT_SPEED, [PRINT_SPEED]));
    }
  }
  packets.push(buildCommandPacket(COMMAND_FEED_PAPER, encodeUint16LittleEndian(trailingFeedLines)));
  packets.push(buildCommandPacket(COMMAND_DEVICE_STATE, [0x00]));
  return concatenateByteArrays(packets);
};

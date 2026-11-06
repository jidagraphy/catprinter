import { DEFAULT_PRINTER_NAME_PREFIXES } from './catPrinter.js';

import { MAXIMUM_WRITE_CHUNK_SIZE_BYTES } from './printJobSender.js';

const WRITE_CHARACTERISTIC_UUID = 'ae01';
const SMALLEST_BLUETOOTH_WRITE_SIZE_BYTES = 20; // guaranteed by every BLE link (default MTU 23 - 3)
const DEFAULT_SCAN_TIMEOUT_MILLISECONDS = 10000;

// noble is imported lazily: loading it touches the Bluetooth stack, which commands like
// `catprinter text --preview` should never do.
const loadNoble = async () => (await import('@stoprocent/noble')).default;

const getAdvertisedName = (peripheral) => peripheral.advertisement?.localName ?? '';

// Scans until isWantedPeripheral returns true or the timeout passes. Returns the match or null.
const scanForPeripheral = async (noble, isWantedPeripheral, scanTimeoutMilliseconds) => {
  await noble.waitForPoweredOnAsync(5000);
  const scanTimeoutId = setTimeout(() => noble.stopScanning(), scanTimeoutMilliseconds);
  try {
    for await (const peripheral of noble.discoverAsync()) {
      if (isWantedPeripheral(peripheral)) return peripheral;
    }
    return null;
  } finally {
    clearTimeout(scanTimeoutId);
    await noble.stopScanningAsync();
  }
};

export const listNearbyBluetoothDevices = async ({ scanTimeoutMilliseconds = 5000 } = {}) => {
  const noble = await loadNoble();
  const devicesById = new Map();
  await scanForPeripheral(noble, (peripheral) => {
    const advertisedName = getAdvertisedName(peripheral);
    if (advertisedName) devicesById.set(peripheral.id, { name: advertisedName, id: peripheral.id, signalStrength: peripheral.rssi });
    return false; // keep scanning until the timeout
  }, scanTimeoutMilliseconds);
  noble.stop();
  return [...devicesById.values()];
};

export const connectNodeBluetoothPrinter = async ({
  namePrefixes = DEFAULT_PRINTER_NAME_PREFIXES,
  scanTimeoutMilliseconds = DEFAULT_SCAN_TIMEOUT_MILLISECONDS,
} = {}) => {
  const noble = await loadNoble();
  const printerPeripheral = await scanForPeripheral(
    noble,
    (peripheral) => namePrefixes.some((namePrefix) => getAdvertisedName(peripheral).startsWith(namePrefix)),
    scanTimeoutMilliseconds,
  );
  if (!printerPeripheral) {
    noble.stop();
    throw new Error(`No printer named ${namePrefixes.join('/')}… found. Is it on, and not connected to another device?`);
  }

  await printerPeripheral.connectAsync();
  const { characteristics } = await printerPeripheral.discoverSomeServicesAndCharacteristicsAsync([], [WRITE_CHARACTERISTIC_UUID]);
  const writeCharacteristic = characteristics.find((characteristic) => characteristic.uuid === WRITE_CHARACTERISTIC_UUID);
  if (!writeCharacteristic) throw new Error('Printer write characteristic (ae01) not found.');

  // noble's mtu: on macOS already the max write length, on Linux the ATT MTU (3 bytes of header).
  // Subtracting 3 everywhere is safe either way; unknown → the 20-byte minimum every link supports.
  const maximumWriteSizeBytes = printerPeripheral.mtu
    ? Math.min(MAXIMUM_WRITE_CHUNK_SIZE_BYTES, printerPeripheral.mtu - 3)
    : SMALLEST_BLUETOOTH_WRITE_SIZE_BYTES;

  // noble's write-without-response resolves when the data is merely queued (and on macOS ignores a full
  // queue), so the CLI would disconnect before anything was sent. Writes with response wait for the
  // printer's acknowledgement: real backpressure, nothing dropped.
  const isWritingWithResponse = writeCharacteristic.properties.includes('write');

  return {
    printerName: getAdvertisedName(printerPeripheral),
    maximumWriteSizeBytes,
    writeMode: isWritingWithResponse ? 'with-response' : 'without-response',
    writeChunk: (chunkBytes) => writeCharacteristic.writeAsync(Buffer.from(chunkBytes), !isWritingWithResponse),
    disconnect: async () => {
      await printerPeripheral.disconnectAsync();
      noble.stop();
    },
  };
};

import { createRequire } from 'node:module';
import { DEFAULT_PRINTER_NAME_PREFIXES } from './catPrinter.js';
import { MAXIMUM_WRITE_CHUNK_SIZE_BYTES } from './printJobSender.js';

const WRITE_CHARACTERISTIC_UUID = 'ae01';
const SMALLEST_BLUETOOTH_WRITE_SIZE_BYTES = 20; // guaranteed by every BLE link (default MTU 23 - 3)
const DEFAULT_SCAN_TIMEOUT_MILLISECONDS = 10000;

const isPackageInstalled = (packageName) => {
  try {
    createRequire(import.meta.url).resolve(packageName);
    return true;
  } catch {
    return false;
  }
};

// Linux has two ways in:
// - BlueZ over D-Bus (preferred): no special privileges, and doesn't fight bluetoothd for the adapter.
//   Needs the dbus-next package, which isn't a dependency because it drags in node-gyp 7, and that
//   breaks noble's own native build on Node 24. Users install it with --ignore-scripts.
// - Raw HCI sockets (noble's default): needs cap_net_raw on node, and can collide with bluetoothd.
// NOBLE_BINDINGS still overrides the choice.
const shouldUseBlueZ = () => process.platform === 'linux' && !process.env.NOBLE_BINDINGS && isPackageInstalled('dbus-next');

// noble is imported lazily: loading it touches the Bluetooth stack, which commands like
// `catprinter text --preview` should never do.
const loadNoble = async () => {
  const nobleModule = await import('@stoprocent/noble');
  return shouldUseBlueZ() ? nobleModule.withBindings('dbus') : nobleModule.default;
};

const LINUX_PERMISSION_HINT = 'On Linux, either install dbus-next (`npm install dbus-next --ignore-scripts`) '
  + 'to go through BlueZ, or give node raw Bluetooth access: '
  + '`sudo setcap cap_net_raw+eip "$(readlink -f "$(which node)")"`.';

const waitForBluetoothPoweredOn = async (noble) => {
  try {
    await noble.waitForPoweredOnAsync(5000);
  } catch (poweredOnError) {
    if (process.platform !== 'linux') throw poweredOnError;
    throw new Error(`Bluetooth adapter not available. ${LINUX_PERMISSION_HINT}`, { cause: poweredOnError });
  }
};

const getAdvertisedName = (peripheral) => peripheral.advertisement?.localName ?? '';

// Scans until isWantedPeripheral returns true or the timeout passes. Returns the match or null.
// Duplicates are allowed on purpose: on Linux a device's name often arrives in a later packet (the scan
// response), and a no-duplicates scan reports each device only once, often before its name is known.
const scanForPeripheral = async (noble, isWantedPeripheral, scanTimeoutMilliseconds) => {
  await waitForBluetoothPoweredOn(noble);
  let handleDiscoveredPeripheral;
  try {
    return await new Promise((resolve, reject) => {
      const scanTimeoutId = setTimeout(() => resolve(null), scanTimeoutMilliseconds);
      handleDiscoveredPeripheral = (peripheral) => {
        if (!isWantedPeripheral(peripheral)) return;
        clearTimeout(scanTimeoutId);
        resolve(peripheral);
      };
      noble.on('discover', handleDiscoveredPeripheral);
      noble.startScanningAsync([], true).catch(reject);
    });
  } finally {
    noble.removeListener('discover', handleDiscoveredPeripheral);
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

  // macOS: noble's write-without-response resolves when the data is merely queued (ignoring a full queue),
  // so the CLI would disconnect before anything was sent. Acknowledged writes give real backpressure there.
  // On Linux noble's HCI layer does its own flow control, and acknowledged writes would crawl (one round
  // trip per chunk), so use them only when they're the sole option.
  const supportsWriteWithResponse = writeCharacteristic.properties.includes('write');
  const supportsWriteWithoutResponse = writeCharacteristic.properties.includes('writeWithoutResponse');
  const isWritingWithResponse = supportsWriteWithResponse && (process.platform === 'darwin' || !supportsWriteWithoutResponse);

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

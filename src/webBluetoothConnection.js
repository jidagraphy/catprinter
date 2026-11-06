import { DEFAULT_PRINTER_NAME_PREFIXES } from './catPrinter.js';

const PRINTER_SERVICE_UUIDS = [0xae30, 0xaf30];
const WRITE_CHARACTERISTIC_UUID = 0xae01;

const findCharacteristicInServices = async (services, characteristicUuid) => {
  for (const service of services) {
    try {
      return await service.getCharacteristic(characteristicUuid);
    } catch {
      // not in this service, try the next
    }
  }
  return null;
};

// Must be called from a user gesture (click). Chrome/Edge show their device picker.
export const connectWebBluetoothPrinter = async ({ namePrefixes = DEFAULT_PRINTER_NAME_PREFIXES } = {}) => {
  if (!navigator.bluetooth) throw new Error('Web Bluetooth is not available. Use Chrome or Edge.');

  const bluetoothDevice = await navigator.bluetooth.requestDevice({
    filters: namePrefixes.map((namePrefix) => ({ namePrefix })),
    optionalServices: PRINTER_SERVICE_UUIDS,
  });
  const gattServer = await bluetoothDevice.gatt.connect();
  const writeCharacteristic = await findCharacteristicInServices(await gattServer.getPrimaryServices(), WRITE_CHARACTERISTIC_UUID);
  if (!writeCharacteristic) throw new Error('Printer write characteristic (ae01) not found.');

  return {
    printerName: bluetoothDevice.name,
    bluetoothDevice, // listen for 'gattserverdisconnected' on this
    writeChunk: (chunkBytes) => writeCharacteristic.writeValueWithoutResponse(chunkBytes),
    disconnect: async () => bluetoothDevice.gatt.disconnect(),
  };
};

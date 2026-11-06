// `import ... from 'catprinter'` in Node lands here. Uses noble (Bluetooth) + @napi-rs/canvas.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createCatPrinter } from './catPrinter.js';
import { connectNodeBluetoothPrinter, listNearbyBluetoothDevices } from './nodeBluetoothConnection.js';
import { createPrintableBitmapRenderer } from './printableBitmap.js';

// imageSource: file path, http(s) URL, or Buffer.
// ponytail: EXIF rotation is not applied in Node; rotate phone photos first if they print sideways.
export const { renderText, renderImage } = createPrintableBitmapRenderer({ createCanvas, loadImage });

export const connectPrinter = async (connectionOptions) => createCatPrinter(
  await connectNodeBluetoothPrinter(connectionOptions),
  { renderText, renderImage },
);

export { listNearbyBluetoothDevices };
export { buildPrintJob, PRINTER_LINE_WIDTH_PIXELS } from './printerProtocol.js';

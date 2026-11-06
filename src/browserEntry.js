// `import ... from 'catprinter'` in a browser (or bundler) lands here. Uses Web Bluetooth + <canvas>.
import { createCatPrinter } from './catPrinter.js';
import { connectWebBluetoothPrinter } from './webBluetoothConnection.js';
import { createPrintableBitmapRenderer } from './printableBitmap.js';

const createBrowserCanvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });

// imageSource: File/Blob, a URL string, or anything createImageBitmap accepts. EXIF rotation is honoured.
const loadBrowserImage = async (imageSource) => createImageBitmap(
  typeof imageSource === 'string' ? await (await fetch(imageSource)).blob() : imageSource,
);

export const { renderText, renderImage } = createPrintableBitmapRenderer({
  createCanvas: createBrowserCanvas,
  loadImage: loadBrowserImage,
});

// Must be called from a click: the browser shows its Bluetooth device picker.
export const connectPrinter = async (connectionOptions) => createCatPrinter(
  await connectWebBluetoothPrinter(connectionOptions),
  { renderText, renderImage },
);

export { buildPrintJob, PRINTER_LINE_WIDTH_PIXELS } from './printerProtocol.js';

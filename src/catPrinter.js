// The printer object both entry points hand out. Platform-agnostic: it gets a Bluetooth connection
// ({ printerName, writeChunk, maximumWriteSizeBytes?, disconnect }) and a bitmap renderer ({ renderText, renderImage }).
import { buildPrintJob, DEFAULT_HEAT_ENERGY } from './printerProtocol.js';
import { sendPrintJobPaced } from './printJobSender.js';

export const DEFAULT_PRINTER_NAME_PREFIXES = ['X6h', 'X6H', 'x6h'];

export const createCatPrinter = (bluetoothConnection, printableBitmapRenderer) => {
  const printBitmap = async ({ blackPixels, heightInPixels }, {
    heatEnergy = DEFAULT_HEAT_ENERGY, sendRateBytesPerSecond, onProgress,
  } = {}) => {
    const printJobBytes = buildPrintJob({ blackPixels, heightInPixels, heatEnergy });
    await sendPrintJobPaced(bluetoothConnection.writeChunk, printJobBytes, {
      writeChunkSizeBytes: bluetoothConnection.maximumWriteSizeBytes,
      sendRateBytesPerSecond,
      onProgress,
    });
    return {
      heightInPixels,
      jobSizeBytes: printJobBytes.length,
      writeChunkSizeBytes: bluetoothConnection.maximumWriteSizeBytes,
      writeMode: bluetoothConnection.writeMode,
    };
  };

  return {
    ...bluetoothConnection,
    printBitmap,
    printText: (text, options = {}) => printBitmap(printableBitmapRenderer.renderText(text, options), options),
    printImage: async (imageSource, options = {}) => printBitmap(await printableBitmapRenderer.renderImage(imageSource, options), options),
  };
};

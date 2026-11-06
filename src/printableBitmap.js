// Turns images and text into the printer's 1-bit bitmap.
// Works with any Canvas 2D implementation (browser canvas, @napi-rs/canvas in Node),
// passed in as createCanvas(width, height).
import { PRINTER_LINE_WIDTH_PIXELS } from './printerProtocol.js';

const DEFAULT_FONT_FAMILY = 'ui-monospace, Menlo, "DejaVu Sans Mono", monospace';
const DEFAULT_FONT_SIZE_PIXELS = 28;

const createWhitePrinterWidthCanvas = (createCanvas, heightInPixels) => {
  const canvas = createCanvas(PRINTER_LINE_WIDTH_PIXELS, Math.max(1, Math.round(heightInPixels)));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
};

const drawImageOnPrinterWidthCanvas = (createCanvas, image) => {
  const canvas = createWhitePrinterWidthCanvas(createCanvas, image.height * (PRINTER_LINE_WIDTH_PIXELS / image.width));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const wrapTextToLines = (context, text, maximumLineWidth) => text.split('\n').flatMap((paragraph) => {
  const wrappedLines = [];
  let currentLine = '';
  for (const word of paragraph.split(' ')) {
    const candidateLine = currentLine ? `${currentLine} ${word}` : word;
    if (currentLine && context.measureText(candidateLine).width > maximumLineWidth) {
      wrappedLines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidateLine;
    }
  }
  return [...wrappedLines, currentLine];
});

const drawTextOnPrinterWidthCanvas = (createCanvas, text, {
  fontSizePixels = DEFAULT_FONT_SIZE_PIXELS,
  fontFamily = DEFAULT_FONT_FAMILY,
} = {}) => {
  const textFont = `${fontSizePixels}px ${fontFamily}`;
  const lineHeightPixels = Math.round(fontSizePixels * 1.25);
  const measuringContext = createWhitePrinterWidthCanvas(createCanvas, 1).getContext('2d');
  measuringContext.font = textFont;
  const textLines = wrapTextToLines(measuringContext, text, PRINTER_LINE_WIDTH_PIXELS - 8);

  const canvas = createWhitePrinterWidthCanvas(createCanvas, textLines.length * lineHeightPixels + 8);
  const context = canvas.getContext('2d');
  context.font = textFont;
  context.fillStyle = '#000000';
  context.textBaseline = 'top';
  textLines.forEach((textLine, lineIndex) => context.fillText(textLine, 4, 4 + lineIndex * lineHeightPixels));
  return canvas;
};

// Floyd-Steinberg on raw RGBA ImageData. Returns 1 = black pixels, and overwrites imageData with the
// dithered result so it doubles as a preview. brightnessOffset (-100..100) compensates for thermal
// paper printing darker than a screen.
export const ditherImageDataFloydSteinberg = (imageData, brightnessOffset = 0) => {
  const { data: rgbaPixels, width, height } = imageData;
  const pixelCount = width * height;
  const grayscaleValues = new Float32Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    const rgbaIndex = pixelIndex * 4;
    grayscaleValues[pixelIndex] = 0.299 * rgbaPixels[rgbaIndex] + 0.587 * rgbaPixels[rgbaIndex + 1]
      + 0.114 * rgbaPixels[rgbaIndex + 2] + brightnessOffset;
  }

  const blackPixels = new Uint8Array(pixelCount);
  const spreadError = (x, y, error, weight) => {
    if (x >= 0 && x < width && y < height) grayscaleValues[y * width + x] += error * weight;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = y * width + x;
      const isBlack = grayscaleValues[pixelIndex] < 128;
      const quantizationError = grayscaleValues[pixelIndex] - (isBlack ? 0 : 255);
      blackPixels[pixelIndex] = isBlack ? 1 : 0;
      spreadError(x + 1, y, quantizationError, 7 / 16);
      spreadError(x - 1, y + 1, quantizationError, 3 / 16);
      spreadError(x, y + 1, quantizationError, 5 / 16);
      spreadError(x + 1, y + 1, quantizationError, 1 / 16);
      rgbaPixels.fill(isBlack ? 0 : 255, pixelIndex * 4, pixelIndex * 4 + 3);
      rgbaPixels[pixelIndex * 4 + 3] = 255;
    }
  }
  return blackPixels;
};

// A "printable bitmap" is { blackPixels, heightInPixels, previewCanvas }: everything the printer
// needs, plus the dithered canvas for showing or saving a preview.
const ditherCanvasToPrintableBitmap = (canvas, brightnessOffset) => {
  const context = canvas.getContext('2d');
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const blackPixels = ditherImageDataFloydSteinberg(imageData, brightnessOffset);
  context.putImageData(imageData, 0, 0);
  return { blackPixels, heightInPixels: canvas.height, previewCanvas: canvas };
};

// Binds the drawing helpers to one platform's canvas implementation.
export const createPrintableBitmapRenderer = ({ createCanvas, loadImage }) => ({
  renderText: (text, { brightness = 0, fontSizePixels, fontFamily } = {}) => ditherCanvasToPrintableBitmap(
    drawTextOnPrinterWidthCanvas(createCanvas, text, { fontSizePixels, fontFamily }), brightness),
  renderImage: async (imageSource, { brightness = 0 } = {}) => ditherCanvasToPrintableBitmap(
    drawImageOnPrinterWidthCanvas(createCanvas, await loadImage(imageSource)), brightness),
});

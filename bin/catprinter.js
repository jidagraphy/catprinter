#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectPrinter, renderText, renderImage, listNearbyBluetoothDevices } from '../src/nodeEntry.js';

const USAGE = `catprinter: print to a Bluetooth "cat" thermal printer (X6h / TinyPrint)

Usage:
  catprinter text <words...>      print text (no words, or "-", reads stdin)
  catprinter image <path|url>     print an image, dithered to black and white
  catprinter scan                 list nearby Bluetooth devices and their names
  catprinter serve                start the web interface on localhost

Options:
  --preview <file.png>   save what would print as a PNG instead of printing (no printer needed)
  --brightness <n>       -100..100, default 0. Raise if prints come out too dark
  --heat <n>             print darkness / heat energy, default 9500
  --font-size <px>       text size, default 28 (paper is 384px wide)
  --name <prefix>        printer name prefix, repeatable, default X6h
  --port <n>             port for serve, default 5179
  --json                 machine-readable output on stdout
  -h, --help             show this help

Examples:
  catprinter text "good morning"
  echo "buy milk" | catprinter text
  catprinter image cat.jpg --brightness 20
  catprinter text "hello" --preview hello.png --json`;

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    preview: { type: 'string' },
    brightness: { type: 'string', default: '0' },
    heat: { type: 'string' },
    'font-size': { type: 'string' },
    name: { type: 'string', multiple: true },
    port: { type: 'string', default: '5179' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const [commandName, ...commandArguments] = positionals;

const reportResult = (result, humanMessage) => {
  console.log(options.json ? JSON.stringify({ ok: true, ...result }) : humanMessage);
};

const exitWithError = (errorMessage, exitCode = 1) => {
  if (options.json) console.log(JSON.stringify({ ok: false, error: errorMessage }));
  else console.error(`catprinter: ${errorMessage}`);
  process.exit(exitCode);
};

const readAllStandardInput = async () => {
  const inputChunks = [];
  for await (const inputChunk of process.stdin) inputChunks.push(inputChunk);
  return Buffer.concat(inputChunks).toString('utf8').replace(/\n$/, '');
};

const readTextToPrint = async () => {
  const shouldReadStandardInput = commandArguments.length === 0 || (commandArguments.length === 1 && commandArguments[0] === '-');
  if (shouldReadStandardInput && process.stdin.isTTY) exitWithError('no text given. Pass words or pipe text in.', 2);
  const textToPrint = shouldReadStandardInput ? await readAllStandardInput() : commandArguments.join(' ');
  // An empty pipe (e.g. a script whose output came up empty) must not waste paper on a blank print.
  if (textToPrint.trim() === '') exitWithError('text is empty, nothing to print.', 2);
  return textToPrint;
};

// Numeric flags are validated here so typos fail loudly instead of printing a blank page.
const parseNumberOption = (optionName, minimumValue, maximumValue) => {
  const rawValue = options[optionName];
  if (rawValue === undefined) return undefined;
  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue < minimumValue || parsedValue > maximumValue) {
    exitWithError(`--${optionName} must be a whole number from ${minimumValue} to ${maximumValue}, got "${rawValue}".`, 2);
  }
  return parsedValue;
};

const brightness = parseNumberOption('brightness', -100, 100);
const heatEnergy = parseNumberOption('heat', 0, 65535);
const fontSizePixels = parseNumberOption('font-size', 6, 384);
const serverPort = parseNumberOption('port', 1, 65535);

const renderingOptions = { brightness, ...(fontSizePixels && { fontSizePixels }) };

const printOrPreviewBitmap = async (printableBitmap) => {
  if (options.preview) {
    await writeFile(options.preview, await printableBitmap.previewCanvas.encode('png'));
    reportResult({ previewPath: options.preview, heightInPixels: printableBitmap.heightInPixels },
      `Saved preview to ${options.preview} (${printableBitmap.heightInPixels} lines)`);
    return;
  }
  const printer = await connectPrinter(options.name ? { namePrefixes: options.name } : {});
  try {
    const printResult = await printer.printBitmap(printableBitmap, heatEnergy !== undefined ? { heatEnergy } : {});
    reportResult({ printerName: printer.printerName, ...printResult },
      `Printed ${printResult.heightInPixels} lines on ${printer.printerName}`);
  } finally {
    await printer.disconnect();
  }
};

const serveWebInterface = () => {
  const packageRootDirectory = fileURLToPath(new URL('..', import.meta.url));
  const servedDirectories = ['web', 'src'].map((directoryName) => join(packageRootDirectory, directoryName) + sep);
  const contentTypesByExtension = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

  const webServer = createServer(async (request, response) => {
    const requestPath = new URL(request.url, 'http://localhost').pathname;
    if (requestPath === '/') {
      response.writeHead(302, { location: '/web/' }).end();
      return;
    }
    const requestedFilePath = resolve(packageRootDirectory, `.${requestPath.endsWith('/') ? `${requestPath}index.html` : requestPath}`);
    if (!servedDirectories.some((servedDirectory) => requestedFilePath.startsWith(servedDirectory))) {
      response.writeHead(404).end('not found');
      return;
    }
    try {
      const fileContents = await readFile(requestedFilePath);
      response.writeHead(200, { 'content-type': contentTypesByExtension[extname(requestedFilePath)] ?? 'application/octet-stream' }).end(fileContents);
    } catch {
      response.writeHead(404).end('not found');
    }
  });

  // localhost only: Web Bluetooth needs a secure context, and localhost counts as one.
  webServer.listen(serverPort, '127.0.0.1', () => {
    reportResult({ url: `http://localhost:${serverPort}/` }, `catprinter web interface: http://localhost:${serverPort}/  (open in Chrome or Edge)`);
  });
};

const runCommand = async () => {
  if (options.help || !commandName) {
    console.log(USAGE);
    return;
  }
  if (commandName === 'text') return printOrPreviewBitmap(renderText(await readTextToPrint(), renderingOptions));
  if (commandName === 'image') {
    if (!commandArguments[0]) exitWithError('image needs a file path or URL.', 2);
    return printOrPreviewBitmap(await renderImage(commandArguments[0], renderingOptions));
  }
  if (commandName === 'scan') {
    const nearbyDevices = await listNearbyBluetoothDevices();
    reportResult({ devices: nearbyDevices }, nearbyDevices.map((device) => `${device.name}  (${device.id}, ${device.signalStrength} dBm)`).join('\n') || 'No named devices found.');
    return;
  }
  if (commandName === 'serve') return serveWebInterface();
  exitWithError(`unknown command "${commandName}". Run catprinter --help.`, 2);
};

try {
  await runCommand();
  // noble keeps Bluetooth handles open after disconnect; exit explicitly once a print/scan is done.
  if (commandName !== 'serve') process.exit(0);
} catch (commandError) {
  exitWithError(commandError.message);
}

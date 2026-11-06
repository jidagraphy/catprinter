# catprinter

Print to cheap Bluetooth "cat" thermal printers (X6h, sold with the **TinyPrint** app) from Node or the browser. No vendor app, no cloud.

```bash
npm install catprinter
```

```js
import { connectPrinter } from 'catprinter';

const printer = await connectPrinter();   // finds the X6h and connects
await printer.printText('hello from my own code');
await printer.printImage('./cat.jpg');    // dithered to black and white
await printer.disconnect();
```

The same import works in Node and in the browser (via Web Bluetooth). It also comes with a [CLI](#cli) and a [web interface](#web-interface).

## API

| | |
|---|---|
| `connectPrinter({ namePrefixes, scanTimeoutMilliseconds })` | Connect. Node scans for the printer; the browser shows its device picker. |
| `printer.printText(text, options)` | Print text, wrapped to the paper width. |
| `printer.printImage(source, options)` | Print an image. Node: file path, URL or Buffer. Browser: `File`, `Blob` or URL. |
| `printer.printBitmap(printableBitmap, options)` | Print something from `renderText` / `renderImage`. |
| `printer.disconnect()` | |
| `renderText(text, options)`, `renderImage(source, options)` | Render without printing. Returns `{ blackPixels, heightInPixels, previewCanvas }`. |
| `listNearbyBluetoothDevices()` | Node only. |

| Option | Default | |
|---|---|---|
| `brightness` | `0` | -100..100. Raise it if prints come out too dark. |
| `heatEnergy` | `9500` | How dark the printer burns. |
| `fontSizePixels` | `28` | The paper is 384px wide. |
| `fontFamily` | monospace | |
| `onProgress` | | `(ratio) => {}` |

To preview before printing, render first and then print the same bitmap:

```js
const printableBitmap = await renderImage(file, { brightness: 10 });
document.body.append(printableBitmap.previewCanvas);
await printer.printBitmap(printableBitmap);
```

**Browser:** call `connectPrinter()` from a click. Chrome and Edge only; Safari has no Web Bluetooth.
**macOS + Node:** run from a terminal that has Bluetooth permission (allow the prompt once). Launched from an app without it, Node is killed by macOS.
**Linux + Node:** experimental, not yet confirmed to print. On a Raspberry Pi 4 the onboard Bluetooth found and connected to the X6h, then dropped the link within a second. If you try it: `npm install dbus-next --ignore-scripts` makes catprinter go through BlueZ (no root needed), and BlueZ may need `ControllerMode = le` in `/etc/bluetooth/main.conf` to avoid connecting over Classic Bluetooth.

## CLI

```bash
npx catprinter text "good morning"
echo "buy milk" | npx catprinter text
npx catprinter image cat.jpg --brightness 20
npx catprinter text "dry run" --preview out.png   # save a PNG instead of printing
```

| Command | |
|---|---|
| `text <words...>` | Print text. With no words, or `-`, reads stdin. |
| `image <path\|url>` | Print an image. |
| `scan` | List nearby Bluetooth devices. |
| `serve` | Start the web interface. |

Options: `--preview <file.png>`, `--brightness <n>`, `--heat <n>`, `--font-size <px>`, `--name <prefix>`, `--port <n>`, `--json`.
Exit codes: `0` ok, `1` printer error, `2` bad usage.

## Web interface

```bash
npx catprinter serve   # → http://localhost:5179
```

Open it in Chrome or Edge, connect, drop in a photo or type text, check the preview and print.

## Supported printers

| Model | |
|---|---|
| X6h | ✅ Tested |
| GB01–03, MX05–10, YT01 and other `51 78`-protocol printers | Probably works, untested. Use `namePrefixes` / `--name`. |

If you try another model, an issue saying whether it worked is very welcome.

## How it works

The printer takes packets over Bluetooth LE (characteristic `ae01`):

```
51 78 [command] 00 [length LE16] [payload] [CRC-8] FF
```

A print is a few settings packets (`A4` blackening, `AF` heat, `BD` speed), then one packet per 384-pixel line (`BF` run-length encoded, or `A2` raw), then `A1` paper feed.

The X6h never asks the sender to slow down, so a fast sender overflows its buffer and the print stops partway. catprinter sends the first 4 KB at full speed, then 4000 B/s (`sendRateBytesPerSecond` to tune).

## Development

```bash
npm install
npm test
node bin/catprinter.js text "hi" --preview hi.png
```

## Credits

Protocol details came from these projects. No code was copied.

- [dejniel/timini-print](https://github.com/dejniel/timini-print): the X6h profile and RLE line format
- [nazarovmi/tinyprint-x6h](https://github.com/nazarovmi/tinyprint-x6h): the X6h characteristic and packet framing
- [NaitLee/Cat-Printer](https://github.com/NaitLee/Cat-Printer): the original cat-printer reverse engineering

## License

MIT

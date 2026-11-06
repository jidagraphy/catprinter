// Streams a print job to the printer at a pace it can keep up with. Transport-agnostic:
// writeChunk is whatever sends bytes over Web Bluetooth or Node Bluetooth.
//
// The X6h sends no "buffer full" notifications, so we pace ourselves.
// Unthrottled, Chrome pushed ~33 KB/s and the printer silently dropped everything past its buffer.
// A head start fills the buffer so printing doesn't stutter, then we send at roughly the printer's speed.

// Chunks must fit the Bluetooth link's maximum write size (larger writes aren't guaranteed to
// arrive whole). Each connection reports its own limit; this is the ceiling.
export const MAXIMUM_WRITE_CHUNK_SIZE_BYTES = 180;
const MINIMUM_DELAY_BETWEEN_CHUNKS_MILLISECONDS = 4;
const UNTHROTTLED_HEAD_START_BYTES = 4096;
// ponytail: calibrated by hand on an X6h. Lower = stuttering print, higher = long prints overflow and cut off.
export const DEFAULT_SEND_RATE_BYTES_PER_SECOND = 4000;

const waitMilliseconds = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const sendPrintJobPaced = async (writeChunk, printJobBytes, {
  writeChunkSizeBytes = MAXIMUM_WRITE_CHUNK_SIZE_BYTES,
  sendRateBytesPerSecond = DEFAULT_SEND_RATE_BYTES_PER_SECOND,
  onProgress = () => {},
} = {}) => {
  const sendStartTime = performance.now();
  for (let chunkStart = 0; chunkStart < printJobBytes.length; chunkStart += writeChunkSizeBytes) {
    await writeChunk(printJobBytes.subarray(chunkStart, chunkStart + writeChunkSizeBytes));
    const bytesSentSoFar = Math.min(printJobBytes.length, chunkStart + writeChunkSizeBytes);
    const throttledBytesSoFar = Math.max(0, bytesSentSoFar - UNTHROTTLED_HEAD_START_BYTES);
    const earliestAllowedElapsedMilliseconds = (throttledBytesSoFar / sendRateBytesPerSecond) * 1000;
    const elapsedMilliseconds = performance.now() - sendStartTime;
    await waitMilliseconds(Math.max(MINIMUM_DELAY_BETWEEN_CHUNKS_MILLISECONDS, earliestAllowedElapsedMilliseconds - elapsedMilliseconds));
    onProgress(bytesSentSoFar / printJobBytes.length);
  }
  // When the last byte leaves, the printer is still burning roughly a head start's worth of buffer.
  // Wait it out so callers can disconnect (or exit) without cutting the print short.
  // ponytail: estimate from the calibrated rate; read the printer's status reply if this ever proves too short.
  const bufferedBytesEstimate = Math.min(printJobBytes.length, UNTHROTTLED_HEAD_START_BYTES);
  await waitMilliseconds((bufferedBytesEstimate / sendRateBytesPerSecond) * 1000);
};

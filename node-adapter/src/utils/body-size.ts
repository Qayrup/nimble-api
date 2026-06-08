export function calcBodySize(body: unknown): number {
  if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
  if (Buffer.isBuffer(body)) return body.byteLength;
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (body instanceof FormData) {
    let size = 0;
    body.forEach((value: FormDataEntryValue) => {
      if (typeof value === 'string') {
        size += Buffer.byteLength(value, 'utf8');
      } else {
        // value is File (extends Blob)
        size += (value as Blob).size;
      }
    });
    return size;
  }
  return 0;
}

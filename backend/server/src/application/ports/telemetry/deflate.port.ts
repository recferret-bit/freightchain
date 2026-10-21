/** Raw inflate for a v2.1 batch stream. The application layer does not import zlib. */
export abstract class DeflatePort {
  abstract inflateRaw(data: Buffer): Buffer;
}

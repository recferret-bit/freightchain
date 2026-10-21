/** Content hashing (the recording chain). A port so the domain and the handlers stay free of node:crypto. */
export abstract class HasherPort {
  /** lowercase hex SHA-256 of the UTF-8 text */
  abstract sha256Hex(text: string): string;
  /** 32-byte SHA-256 binary digest of buffer / Uint8Array / text */
  abstract sha256(data: Uint8Array | Buffer | string): Buffer;
  /** lowercase hex HMAC-SHA256. `key` is raw bytes (the ride session key), not hex and not base64. */
  abstract hmacSha256Hex(key: Uint8Array | Buffer, message: string): string;
}

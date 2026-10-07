/** Content hashing (the recording chain). A port so the domain and the handlers stay free of node:crypto. */
export abstract class HasherPort {
  /** lowercase hex SHA-256 of the UTF-8 text */
  abstract sha256Hex(text: string): string;
}

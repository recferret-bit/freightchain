export abstract class EntropyPort {
  abstract uuid(): string;
  /** `bytes` random bytes as lowercase hex */
  abstract hex(bytes: number): string;
  /** a random 31-bit road seed (fits a PostgreSQL integer) */
  abstract seed31(): number;
}

/** The answer to an uploaded batch. `stored: false` = this seq was already stored (a re-send, harmless). */
export interface BatchReceiptDto {
  seq: number;
  stored: boolean;
  hashOk: boolean;
}

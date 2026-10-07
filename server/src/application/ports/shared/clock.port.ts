/** The only source of "now": every timestamp the server writes comes from here (tests drive it; the database's own now() is never used). */
export abstract class ClockPort {
  abstract now(): Date;
}

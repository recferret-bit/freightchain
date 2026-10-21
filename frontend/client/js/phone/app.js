/* One installed phone application. Screens, hits and keys are the subclass's job.
   The OS never asks an app for the right answer — apps only draw what the server already revealed as pictures. */

export class PhoneApp {
  constructor({ id, label, color, dock = false }) {
    this.id = id;
    this.label = label;
    this.color = color;
    this.dock = dock;
    this.screen = 'root';
  }

  onOpen() {}
  onClose() {}

  /** Pop an inner screen. Return true when the app stayed open. */
  back() { if (this.screen !== 'root') { this.screen = 'root'; return true; } return false; }

  paint() {}
  hits() { return []; }
  onPress() { return false; }
  onKey() { return false; }
}

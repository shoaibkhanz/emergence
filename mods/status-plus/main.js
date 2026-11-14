// status-plus: the status bar (bar.js) in the layout, and the System popup (popup.js) when the bar opens this mod as
// a popup with props { popup: true, tab }. One mod for both, so they share lib.js.

import { View } from "gpui-kit";
import { props } from "herdr";
import { Bar } from "./bar.js";
import { Popup } from "./popup.js";

export default class StatusPlus extends View {
  init(_props, cx) {
    this.face = props()?.popup ? new Popup(cx) : new Bar(cx);
  }

  render(cx) {
    return this.face.render(cx);
  }

  async close(cx) {
    await this.face.dismissed?.(cx);
  }
}

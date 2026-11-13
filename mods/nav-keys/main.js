// ctrl-h/j/k/l: Herdr moves focus, except where the focused terminal runs
// (n)vim: there the key goes to the editor. Leaving the editor at its edge needs
// a mapping in it that this repo doesn't ship: move between splits and, at the
// edge, run `herdr-app do pane.go --direction <dir>`. Without one the keys stay in (n)vim.
//
// A mod only receives key commands while shown. The emergence layout shows it in
// a 0px block with props {resident: true}; elsewhere the bound keys fail, unless
// `herdr-app do mod.open --name nav-keys` makes a 1px frameless window that Herdr
// reopens on every start (`keep`). Where a layout hosts it, that window closes itself
// for good: an invisible window takes presses (and drags when pressed), and once
// dragged over a panel it swallowed its clicks.
import { View, div } from "gpui-kit";
import { run, hc, panes, focused, nextCommand, props, openOverlay, closeOverlay, layout } from "herdr";

const hosted = (n) => n?.content?.mod === "nav-keys" || (n?.children ?? []).some(hosted);

const KEY = { left: "h", down: "j", up: "k", right: "l" };
const EDITORS = ["nvim", "vim"];

export default class NavKeys extends View {
  init(_props, cx) {
    const p = props();
    if (p && !p.resident) {
      openOverlay({
        mod: "nav-keys", props: { resident: true }, kind: "window", frame: "none",
        key: "nav-keys", keep: true, width: 1, height: 1, at: { x: 0, y: 0 },
      });
      closeOverlay(p.overlay);
      return;
    }
    if (p?.overlay && hosted(layout())) return closeOverlay(p.overlay);
    cx.spawn(async () => {
      for (;;) {
        const dir = await nextCommand();
        const f = focused();
        const pane = f && panes().find((p) => p.pane === f.pane);
        if (pane && pane.terminal && EDITORS.includes(pane.program.key)) {
          await hc(["keys", pane.terminal, `ctrl+${KEY[dir]}`]);
        } else {
          run("pane.go", { direction: dir });
        }
      }
    });
  }

  render() {
    return div();
  }
}

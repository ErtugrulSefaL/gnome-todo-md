// Version shims for the Shell APIs whose shape changed between supported releases. Every shim detects the API itself (feature detection) rather than comparing a version number, so no per-release table is needed.

// PopupSubMenu.open()/close() take an `animate` boolean up to GNOME 50 and an options object (`{animate}`) from 51 on. A defaulted parameter keeps Function.length at 0, so the arity separates the two shapes.
export function popupArgs(menu, method, animate) {
    return menu[method].length === 0 ? {animate} : animate;
}

// A vertical box: `orientation` does not exist before 48 and `vertical` is gone from
// 51 on, so neither can go into an St.BoxLayout constructor across 46-51. Build the
// box plain and apply the setter that exists. NO gi import in this module: the unit
// suite loads it without the Shell's typelibs.
export function setVerticalOrientation(box, orientation) {
    if (box.set_orientation !== undefined) {
        box.set_orientation(orientation);
    } else {
        box.set_vertical(true);
    }
}

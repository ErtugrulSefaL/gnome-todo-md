/*
 * Version shims for the Shell APIs whose shape changed between the supported
 * releases. Every shim detects the API itself (feature detection) rather than
 * comparing a version number, so it needs no per-release table to maintain.
 */

/**
 * PopupSubMenu.open()/close() take an `animate` boolean up to GNOME 50 and an
 * options object (`{animate}`) from 51 on. A defaulted parameter keeps
 * Function.length at 0, so the arity separates the two shapes.
 *
 * @param {object} menu a PopupSubMenu
 * @param {'open'|'close'} method the method about to be called
 * @param {boolean} animate whether the transition should be animated
 * @returns {boolean|object} the argument that method expects
 */
export function popupArgs(menu, method, animate) {
    return menu[method].length === 0 ? {animate} : animate;
}

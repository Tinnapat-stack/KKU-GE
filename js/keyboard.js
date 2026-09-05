// Getting the bottom nav out of the way while the on-screen keyboard is up.
//
// iOS Safari positions a `position: fixed` element against the layout viewport,
// which the keyboard does not shrink. So while the keyboard is open and the page
// is scrolled, Safari stops repainting the nav where it belongs: it visibly tears
// loose and floats up over the keyboard and over Safari's own toolbar, landing
// back into place only once the scroll settles. Nothing in the stylesheet can fix
// that, because the browser is drawing the element somewhere the page never asked
// for.
//
// The nav is also useless at that moment — it sits behind the keyboard — so it is
// simply taken off screen until the keyboard closes. Nothing to tear loose, nothing
// to float. This is what most native-feeling web apps do, for the same reason.

const KEY_HEIGHT = 120; // a keyboard is at least this tall; a URL bar is not

let pending = false;

function editableFocused() {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

// The keyboard is the only thing that takes a large bite out of the visual viewport
// while a field has focus. Checking both keeps a desktop browser, where a focused
// field means no keyboard at all, from ever hiding the nav.
function viewportShrunk() {
  const vv = window.visualViewport;
  if (!vv) return false;
  return window.innerHeight - vv.height > KEY_HEIGHT;
}

function update() {
  pending = false;
  const open = editableFocused() && (window.visualViewport ? viewportShrunk() : true);
  document.body.classList.toggle('keyboard-open', open);
}

// Several of these events fire together as the keyboard slides in, so the work is
// collapsed into one pass per frame.
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(update);
}

export function initKeyboard() {
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', () => {
    // Focus moves through the body for a frame when it passes between two fields,
    // and hiding then showing the nav in between would flicker.
    setTimeout(schedule, 60);
  });

  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', schedule);
    // Scrolling with the keyboard open is exactly when Safari misplaces the nav, so
    // the state is confirmed on every scroll of the visual viewport too.
    vv.addEventListener('scroll', schedule);
  }

  window.addEventListener('orientationchange', () => setTimeout(schedule, 250));
}

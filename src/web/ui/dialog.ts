/**
 * One accessible dialog behavior for every overlay (seal, shortcuts, phone sheets):
 * focus moves into the dialog when it opens, Tab stays inside it, Escape closes it, and focus returns to the
 * control that opened it. The app shell is made `inert` while any dialog is open (see App), so background
 * controls cannot be reached, and the global shortcuts ignore keys while a dialog is open.
 */
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0);
}

/** Open dialogs, innermost last: only the top one handles Escape and Tab. */
const stack: object[] = [];

export function anyDialogOpen(): boolean {
  return stack.length > 0;
}

export function useDialog(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const opener = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const me = {};
    stack.push(me);
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // wait a frame so the dialog is mounted (it may animate in)
    const raf = requestAnimationFrame(() => {
      const root = ref.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(root)[0] ?? root;
      first.focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current;
      if (!root || stack[stack.length - 1] !== me) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables(root);
      if (!els.length) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = els[0]!;
      const last = els[els.length - 1]!;
      const inside = root.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    // capture phase: the dialog sees Escape and Tab before the app's global shortcuts
    window.addEventListener("keydown", onKey, true);
    return () => {
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey, true);
      const back = opener.current;
      opener.current = null;
      if (back && document.contains(back)) requestAnimationFrame(() => back.focus({ preventScroll: true }));
    };
  }, [open, ref]);
}

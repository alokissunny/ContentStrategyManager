import { useEffect } from 'react';

/* Lock page scroll while a modal is open so the content behind can't move or be
 * interacted with. Ported from the reference's components/ui — the one hook the
 * ReferenceIntake modal needs, kept self-contained here. */
export function useBodyScrollLock() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.dataset.modals = String((+document.body.dataset.modals || 0) + 1);
    document.body.classList.add('has-modal');
    return () => {
      document.body.style.overflow = prev;
      const n = (+document.body.dataset.modals || 1) - 1;
      if (n > 0) document.body.dataset.modals = String(n);
      else {
        delete document.body.dataset.modals;
        document.body.classList.remove('has-modal');
      }
    };
  }, []);
}

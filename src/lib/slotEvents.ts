export const SLOT_REPLACE_EVENT = 'imago:replace-slot';

export function requestSlotReplacement(slotId: string) {
  window.dispatchEvent(new CustomEvent(SLOT_REPLACE_EVENT, { detail: { slotId } }));
}

import type { Observable } from 'rxjs';

/** What the update needs of the page: whether it is seen, whether a gesture is open, and reloading it. */
export type UpdatePage = {
  readonly visible: () => boolean;
  readonly busy: () => boolean;
  readonly onVisibilityChange: (listener: () => void) => void;
  readonly reload: () => void;
};

/** The part of Angular's `SwUpdate` used here. */
export type VersionUpdates = {
  readonly versionUpdates: Observable<{ readonly type: string }>;
  readonly checkForUpdate: () => Promise<boolean>;
};

/**
 * The silent update (Z.5; decision of 2026-11-08): a new version downloaded in the background is
 * taken by reloading the page when nobody uses it — hidden, or coming back to the foreground —,
 * never while a gesture is open, without any message. At opening, the service worker already
 * serves the new version; this covers the phone that keeps the application alive for days.
 */
export function watchForUpdates(updates: VersionUpdates, page: UpdatePage): void {
  let ready = false;
  const applyIfIdle = (): void => {
    if (ready && !page.busy()) page.reload();
  };
  updates.versionUpdates.subscribe((event) => {
    if (event.type !== 'VERSION_READY') return;
    ready = true;
    if (!page.visible()) applyIfIdle();
  });
  page.onVisibilityChange(() => {
    if (page.visible()) void updates.checkForUpdate().catch(() => false);
    applyIfIdle();
  });
}

/** A gesture is open: a sheet is up (count, read-back, photo), or the cursor is in a field. */
export function busyIn(document: Document): boolean {
  if (document.querySelector('.sheet.on') !== null) return true;
  const focused = document.activeElement;
  return focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || focused instanceof HTMLSelectElement;
}

import '../entrypoints/options/style.css';
import { mountManager } from '../entrypoints/options/manager';
import { getStore, upsertNote } from '../src/core/storage';

const app = document.querySelector<HTMLDivElement>('#app');
if (app !== null) {
  const heading = document.createElement('p');
  heading.textContent =
    'xNotes demo mode — the real notes manager running against a localStorage shim. Nothing leaves this browser.';
  const mount = document.createElement('div');
  app.append(heading, mount);
  void (async () => {
    const store = await getStore();
    if (Object.keys(store.notes).length === 0) {
      await upsertNote(
        'jack',
        'This is a demo note. In the real extension, notes are added from X profiles.',
        'teal',
      );
    }
    mountManager(mount);
  })();
}

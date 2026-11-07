// Closing, Escape and navigation always cancel; only the explicit button accepts.
export function createBudgetConfirmation(dialog) {
  let resolve = null;
  const finish = accepted => {
    const done = resolve;
    resolve = null;
    done?.(accepted);
  };
  dialog.addEventListener('close', () => finish(dialog.returnValue === 'confirm'));
  dialog.addEventListener('cancel', () => {
    dialog.returnValue = 'cancel';
  });
  return {
    request() {
      if (resolve) return Promise.resolve(false);
      return new Promise((done, reject) => {
        resolve = done;
        dialog.returnValue = 'cancel';
        try {
          dialog.showModal();
        } catch (error) {
          resolve = null;
          reject(error);
        }
      });
    },
    cancel() {
      dialog.returnValue = 'cancel';
      if (dialog.open) dialog.close('cancel');
    },
    get active() {
      return !!resolve;
    },
  };
}

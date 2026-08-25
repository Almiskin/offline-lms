/**
 * @jest-environment jsdom
 */
// Loads app.js into jsdom to test openFormModal() as real DOM behavior,
// not just a syntax check. app.js's bottom-of-file bootstrap code (which
// wires real buttons, Router, Auth, etc.) throws when it runs here since
// none of that exists in this isolated test — that's expected and caught;
// what matters is that the function *declarations* earlier in the file
// (which are hoisted) are defined and behave correctly before that point.
const fs = require('fs');
const path = require('path');

function loadAppJsFunctions() {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  try {
    // Indirect eval (via window.eval) runs in global/window scope, so the
    // function declarations in app.js attach to `window` instead of being
    // scoped to this helper function.
    // eslint-disable-next-line no-eval
    window.eval(appJs);
  } catch (e) {
    // expected — see comment above
  }
  return { openFormModal: window.openFormModal, escapeHtml: window.escapeHtml };
}

describe('openFormModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    loadAppJsFunctions();
  });

  it('renders the title, fields, pre-filled values, and submit label', () => {
    openFormModal({
      title: 'Edit Course',
      submitLabel: 'Save Changes',
      fields: [
        { name: 'title', label: 'Course title', value: 'Intro to CS', required: true },
        { name: 'description', label: 'Description', type: 'textarea', value: 'A course' },
      ],
    });

    expect(document.querySelector('.modal-overlay')).not.toBeNull();
    expect(document.querySelector('.modal-box h3').textContent).toBe('Edit Course');
    expect(document.getElementById('modal-field-title').value).toBe('Intro to CS');
    expect(document.getElementById('modal-field-description').tagName).toBe('TEXTAREA');
    expect(document.getElementById('modal-field-description').value).toBe('A course');
    expect(document.querySelector('.modal-actions button[type=submit]').textContent).toBe('Save Changes');
  });

  it('resolves with the (possibly edited) field values on submit and removes the overlay', async () => {
    const promise = openFormModal({
      title: 'Edit Course',
      fields: [{ name: 'title', label: 'Course title', value: 'Old Title' }],
    });

    document.getElementById('modal-field-title').value = 'New Title';
    document.getElementById('modal-form').dispatchEvent(new Event('submit', { cancelable: true }));

    const result = await promise;
    expect(result).toEqual({ title: 'New Title' });
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('resolves with null and removes the overlay when Cancel is clicked', async () => {
    const promise = openFormModal({ title: 'Add Module', fields: [{ name: 'moduleTitle', label: 'Module title' }] });
    document.getElementById('modal-cancel-btn').click();
    const result = await promise;
    expect(result).toBeNull();
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('resolves with null when the backdrop (not the box) is clicked', async () => {
    const promise = openFormModal({ title: 'Test', fields: [{ name: 'x', label: 'X' }] });
    const overlay = document.querySelector('.modal-overlay');
    const clickEvent = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(clickEvent, 'target', { value: overlay });
    overlay.dispatchEvent(clickEvent);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('escapes HTML in the title and field values instead of injecting it', async () => {
    const promise = openFormModal({
      title: '<script>alert(1)</script>',
      fields: [{ name: 'y', label: 'Y', value: '<b>bold</b>' }],
    });
    expect(document.querySelector('.modal-box h3').innerHTML).toContain('&lt;script&gt;');
    expect(document.querySelector('.modal-box h3').innerHTML).not.toContain('<script>');
    document.getElementById('modal-cancel-btn').click();
    await promise;
  });
});

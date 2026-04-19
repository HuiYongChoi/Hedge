export function stringifyClipboardValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export async function copyTextToClipboard(value: unknown): Promise<boolean> {
  const text = stringifyClipboardValue(value);
  if (!text) return false;

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea fallback for HTTP deployments.
    }
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.top = '-1000px';
  textArea.style.left = '-1000px';
  textArea.style.opacity = '0';

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, textArea.value.length);

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}

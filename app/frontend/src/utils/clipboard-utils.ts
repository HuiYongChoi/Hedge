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

  return copyTextWithClipboardEvent(text);
}

function copyTextWithClipboardEvent(text: string): boolean {
  let didSetClipboardData = false;
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.setAttribute('aria-hidden', 'true');
  textArea.style.position = 'fixed';
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.width = '1px';
  textArea.style.height = '1px';
  textArea.style.opacity = '0';
  textArea.style.pointerEvents = 'none';

  const handleCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
    didSetClipboardData = true;
  };

  document.addEventListener('copy', handleCopy);
  document.body.appendChild(textArea);
  textArea.focus({ preventScroll: true });
  textArea.select();
  textArea.setSelectionRange(0, textArea.value.length);

  try {
    const commandSucceeded = document.execCommand('copy');
    return commandSucceeded && didSetClipboardData;
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', handleCopy);
    document.body.removeChild(textArea);
  }
}

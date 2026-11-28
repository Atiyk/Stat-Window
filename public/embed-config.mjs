const DEFAULT_HEIGHT = 850;

// Fixed origin and channel: publishers only control the validated dimensions.
export function embedCode(height = DEFAULT_HEIGHT, maxWidth = null) {
  if (!Number.isInteger(height) || height < 600 || height > 1400) {
    throw new RangeError('Height must be a whole number from 600 to 1,400');
  }
  if (maxWidth !== null && (!Number.isInteger(maxWidth) || maxWidth < 320 || maxWidth > 1440)) {
    throw new RangeError('Maximum width must be a whole number from 320 to 1,440');
  }
  const url = 'https://www.statwindow.app/?utm_source=embed&amp;utm_medium=referral&amp;utm_campaign=organic';
  const maxWidthStyle = maxWidth === null ? '' : `;max-width:${maxWidth}px`;
  return `<iframe\n  src="${url}"\n  title="Stat Window — daily NBA trivia"\n  width="100%"\n  height="${height}"\n  loading="lazy"\n  style="border:0;display:block${maxWidthStyle}"\n  allow="clipboard-write; web-share">\n</iframe>\n<p><a href="${url}" target="_blank" rel="noopener noreferrer">Play Stat Window in a new tab</a></p>`;
}

function setup() {
  const controls = document.getElementById('embed-controls');
  const height = document.getElementById('embed-height');
  const maxWidth = document.getElementById('embed-max-width');
  const code = document.getElementById('embed-code');
  const previewOptions = document.getElementById('embed-preview-options');
  const preview = document.getElementById('embed-preview');
  const size = document.getElementById('embed-size');
  const copy = document.getElementById('embed-copy');
  const status = document.getElementById('embed-copy-status');
  const heightNote = document.getElementById('embed-height-note');
  const widthNote = document.getElementById('embed-width-note');
  const reset = document.getElementById('embed-reset');

  function update() {
    const h = height.valueAsNumber;
    const w = maxWidth.value === '' ? null : maxWidth.valueAsNumber;
    const heightValid = height.validity.valid;
    const widthValid = maxWidth.validity.valid;
    for (const field of [height, maxWidth]) {
      if (field.validity.valid) field.removeAttribute('aria-invalid');
      else field.setAttribute('aria-invalid', 'true');
    }
    heightNote.textContent = heightValid
      ? '600–1,400 px. Shorter frames may scroll.'
      : 'Enter a whole number from 600 to 1,400.';
    widthNote.textContent = widthValid
      ? '320–1,440 px. Leave blank to fill the column.'
      : 'Enter a whole number from 320 to 1,440, or leave blank.';
    copy.disabled = !heightValid || !widthValid;
    status.textContent = copy.disabled ? 'The code shows your last valid settings.' : '';
    if (copy.disabled) return;
    code.value = embedCode(h, w);
    preview.style.setProperty('--embed-preview-width', w === null ? '100%' : `${w}px`);
    preview.style.height = `${Math.round(h / 4)}px`;
    size.textContent = `${w === null ? 'Available width' : `Up to ${w} px wide`} · ${h} px high`;
  }

  controls.hidden = false;
  previewOptions.hidden = false;
  copy.hidden = false;
  height.addEventListener('input', update);
  maxWidth.addEventListener('input', update);
  reset.addEventListener('click', () => {
    height.value = String(DEFAULT_HEIGHT);
    maxWidth.value = '';
    update();
  });
  for (const radio of previewOptions.querySelectorAll('input[name=embed-width]')) {
    radio.addEventListener('change', () => {
      if (radio.checked) preview.dataset.width = radio.value;
    });
  }
  copy.addEventListener('click', async () => {
    const value = code.value;
    try {
      await navigator.clipboard.writeText(value);
      status.textContent = code.value === value && !copy.disabled
        ? 'Embed code copied.'
        : 'Earlier code copied. Copy again after updating your settings.';
    } catch {
      code.focus();
      code.select();
      status.textContent = 'Code selected. Copy it using your browser or keyboard.';
    }
  });
  update();
}

if (typeof document !== 'undefined') setup();

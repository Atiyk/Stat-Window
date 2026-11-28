// Fixed origin and channel: no publisher IDs, HTML injection, or external requests.
export function embedCode(height=850){
  if(!Number.isInteger(height)||height<600||height>1400)throw new RangeError('Height must be a whole number between 600 and 1400');
  const url='https://www.statwindow.app/?utm_source=embed&amp;utm_medium=referral&amp;utm_campaign=organic';
  return `<iframe\n  src="${url}"\n  title="Stat Window — daily NBA trivia"\n  width="100%"\n  height="${height}"\n  loading="lazy"\n  style="border:0;display:block"\n  allow="clipboard-write; web-share">\n</iframe>\n<p><a href="${url}" target="_blank" rel="noopener noreferrer">Play Stat Window in a new tab</a></p>`;
}

if (typeof document !== 'undefined') {
  const controls=document.getElementById('embed-controls');
  const height=document.getElementById('embed-height');
  const code=document.getElementById('embed-code');
  const preview=document.getElementById('embed-preview');
  const size=document.getElementById('embed-size');
  const copy=document.getElementById('embed-copy');
  const status=document.getElementById('embed-copy-status');
  const note=document.getElementById('embed-height-note');
  const reset=document.getElementById('embed-reset');
  if (controls && height && code && preview && size && copy && status && note && reset) {
    function update() {
      try {
        const n=height.valueAsNumber;
        code.value=embedCode(n);
        preview.style.height=Math.round(n/2)+'px';
        size.textContent='Responsive width · '+n+' px high (height shown at half scale)';
        height.removeAttribute('aria-invalid');
        note.textContent='Choose 600–1,400 px. Short frames may require scrolling.';
        copy.disabled=false;
        status.textContent='';
      } catch {
        height.setAttribute('aria-invalid','true');
        note.textContent='Enter a whole number from 600 to 1,400. Code still shows the last valid height.';
        copy.disabled=true;
        status.textContent='';
      }
    }
    controls.hidden=false;copy.hidden=false;
    height.addEventListener('input',update);
    reset.addEventListener('click',()=>{height.value='850';update();});
    for (const radio of document.querySelectorAll('input[name=embed-width]')) radio.addEventListener('change',()=>{if(radio.checked)preview.dataset.width=radio.value==='mobile'?'mobile':'desktop';});
    copy.addEventListener('click',async()=>{
      const value=code.value;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(value);
        status.textContent=code.value===value&&!copy.disabled?'Embed code copied.':'Earlier code copied; copy again after your changes.';
      } catch {
        code.focus();code.select();
        status.textContent='Code selected. Copy it using your browser or keyboard.';
      }
    });
    update();
  }
}

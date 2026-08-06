(() => {
  const downloadUrl = 'https://github.com/yangdozze/yangdozze.github.io/releases/download/v0.3.3/WaveDropStudio-Setup-v0.3.3-Windows-x64.exe';
  const downloadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/></svg>';
  const icons = [
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.5V6.5A2.5 2.5 0 0 1 6.5 4h7L20 10.5v7A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5Z"/><path d="M13 4v7h7M8 16h8"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/><circle cx="17" cy="18" r="3"/><path d="m18.8 20.2 2.2 2.2"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h11M12 5l7 7-7 7"/><path d="M5 5v14"/></svg>'
  ];

  document.querySelectorAll('.feature-card').forEach((card, i) => {
    if (card.querySelector('.feature-icon')) return;
    const icon = document.createElement('div');
    icon.className = 'feature-icon';
    icon.innerHTML = icons[i] || icons[0];
    card.appendChild(icon);
  });

  const actions = document.querySelector('.hero-actions');
  if (actions && !actions.querySelector('.download-button')) {
    const button = document.createElement('a');
    button.href = downloadUrl;
    button.className = 'button primary download-button';
    button.setAttribute('download', 'WaveDropStudio-Setup-v0.3.3-Windows-x64.exe');
    button.innerHTML = downloadIcon + '<span>Download for Windows</span>';
    actions.prepend(button);

    const meta = document.createElement('span');
    meta.className = 'download-meta';
    meta.innerHTML = '<strong>v0.3.3</strong> · Windows 10/11 x64 · 222 MB';
    actions.insertAdjacentElement('afterend', meta);
  }

  const nav = document.querySelector('.site-header nav');
  if (nav && !nav.querySelector('.header-download')) {
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.className = 'header-download';
    a.setAttribute('download', 'WaveDropStudio-Setup-v0.3.3-Windows-x64.exe');
    a.innerHTML = downloadIcon + '<span>Download</span>';
    nav.appendChild(a);
  }

  const panel = document.querySelector('.youtube-panel');
  if (panel && !document.querySelector('.download-strip')) {
    const strip = document.createElement('section');
    strip.className = 'download-strip';
    strip.innerHTML = '<div><h3>Ready to publish your next beat?</h3><p>Download the complete Windows installer with FFmpeg and YouTube support included.</p></div><a class="button primary download-button" download href="' + downloadUrl + '">' + downloadIcon + '<span>Download WaveDrop Studio</span></a>';
    panel.insertAdjacentElement('afterend', strip);
  }
})();

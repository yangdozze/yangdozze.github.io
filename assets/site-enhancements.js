(() => {
  const APP_NAME = 'WaveDrop Studio';
  const downloadUrl = 'https://github.com/yangdozze/yangdozze.github.io/releases/download/v0.3.3/WaveDropStudio-Setup-v0.3.3-Windows-x64.exe';
  const fileName = 'WaveDropStudio-Setup-v0.3.3-Windows-x64.exe';
  const purposeCopy = 'WaveDrop Studio is a Windows desktop application for independent beatmakers. Its purpose is to turn user-provided beat audio and cover artwork into a YouTube-ready video, prepare release metadata, and let the user upload the finished video to the user\'s own YouTube channel after explicit review and approval.';
  const downloadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/></svg>';
  const icons = [
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.5V6.5A2.5 2.5 0 0 1 6.5 4h7L20 10.5v7A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5Z"/><path d="M13 4v7h7M8 16h8"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/><circle cx="17" cy="18" r="3"/><path d="m18.8 20.2 2.2 2.2"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h11M12 5l7 7-7 7"/><path d="M5 5v14"/></svg>'
  ];

  let scheduled = false;

  function ensureMeta() {
    document.title = APP_NAME;

    let appName = document.querySelector('meta[name="application-name"]');
    if (!appName) {
      appName = document.createElement('meta');
      appName.name = 'application-name';
      document.head.appendChild(appName);
    }
    appName.content = APP_NAME;

    let description = document.querySelector('meta[name="description"]');
    if (!description) {
      description = document.createElement('meta');
      description.name = 'description';
      document.head.appendChild(description);
    }
    description.content = 'WaveDrop Studio is a Windows desktop application for beatmakers that creates YouTube-ready videos from user-provided audio and cover art, prepares release metadata, and uploads only to the user’s own YouTube channel after explicit user approval.';
  }

  function ensureVerificationPurpose(hero) {
    let panel = document.querySelector('#google-oauth-app-purpose');
    if (!panel && hero) {
      panel = document.createElement('section');
      panel.id = 'google-oauth-app-purpose';
      panel.className = 'youtube-panel verification-purpose';
      panel.innerHTML = '<div><span class="panel-kicker">Application purpose</span><h2>WaveDrop Studio — application purpose</h2><p><strong>Application name: WaveDrop Studio.</strong> ' + purposeCopy + '</p><p><strong>Google / YouTube data use:</strong> WaveDrop Studio uses Google OAuth so the user can authorize their own YouTube channel. The requested <code>youtube.upload</code> scope is used only to upload the user-selected video after the user reviews the title, description, tags and privacy setting and explicitly clicks Upload or Publish. WaveDrop Studio does not upload videos automatically and does not use this permission to access unrelated YouTube content.</p><p>OAuth authorization tokens are stored locally on the user\'s device. See the <a href="privacy.html">Privacy Policy</a> for details about Google user data.</p></div><ol><li><b>1</b><span><strong>Create</strong>Combine user-provided beat audio and cover art.</span></li><li><b>2</b><span><strong>Review</strong>Review video metadata and publishing settings.</span></li><li><b>3</b><span><strong>Authorize</strong>Connect the user\'s own YouTube channel with Google OAuth.</span></li><li><b>4</b><span><strong>Publish</strong>Upload only after an explicit user action.</span></li></ol>';
      hero.insertAdjacentElement('afterend', panel);
    }
  }

  function ensureEnhancements() {
    scheduled = false;
    ensureMeta();

    const hero = document.querySelector('.hero');
    if (hero) {
      const heading = hero.querySelector('h1');
      if (heading) heading.textContent = APP_NAME;

      if (heading && !hero.querySelector('.hero-tagline')) {
        const tagline = document.createElement('p');
        tagline.className = 'hero-tagline';
        tagline.textContent = 'From finished beat to published video.';
        heading.insertAdjacentElement('afterend', tagline);
      }

      const copyCandidates = [...hero.querySelectorAll('.hero-copy')].filter((el) => !el.classList.contains('hero-tagline'));
      const mainCopy = copyCandidates.find((el) => /WaveDrop Studio is a Windows desktop/i.test(el.textContent || '')) || copyCandidates[copyCandidates.length - 1];
      if (mainCopy) mainCopy.textContent = purposeCopy;

      ensureVerificationPurpose(hero);
    }

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
      button.setAttribute('download', fileName);
      button.setAttribute('aria-label', 'Download WaveDrop Studio v0.3.3 for Windows');
      button.innerHTML = downloadIcon + '<span>Download for Windows</span>';
      actions.prepend(button);
    }

    if (actions && !document.querySelector('.download-meta')) {
      const meta = document.createElement('span');
      meta.className = 'download-meta';
      meta.innerHTML = '<strong>Latest release v0.3.3</strong><span>Windows 10/11 x64 · 222 MB</span>';
      actions.insertAdjacentElement('afterend', meta);
    }

    const nav = document.querySelector('.site-header nav');
    if (nav && !nav.querySelector('.header-download')) {
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.className = 'header-download';
      link.setAttribute('download', fileName);
      link.innerHTML = downloadIcon + '<span>Download</span>';
      nav.appendChild(link);
    }

    const purposePanel = document.querySelector('#google-oauth-app-purpose') || document.querySelector('#about-wavedrop-studio') || document.querySelector('.youtube-panel');
    if (purposePanel && !document.querySelector('.download-strip')) {
      const strip = document.createElement('section');
      strip.className = 'download-strip';
      strip.innerHTML = '<div><span class="release-badge">Latest · v0.3.3</span><h3>WaveDrop Studio for Windows</h3><p>Complete x64 installer with FFmpeg and YouTube publishing support.</p></div><a class="button primary download-button" download="' + fileName + '" href="' + downloadUrl + '">' + downloadIcon + '<span>Download installer</span></a>';
      purposePanel.insertAdjacentElement('afterend', strip);
    }
  }

  function scheduleEnhancements() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(ensureEnhancements);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureEnhancements, { once: true });
  } else {
    ensureEnhancements();
  }

  window.addEventListener('load', ensureEnhancements, { once: true });
  [100, 250, 500, 800, 1200, 1800, 2500, 3500, 5000].forEach((delay) => setTimeout(ensureEnhancements, delay));

  const observer = new MutationObserver(scheduleEnhancements);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();

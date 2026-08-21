// ===== Echo Music 官网脚本 =====
(function () {
  'use strict';

  // ---------- 中英双语 ----------
  const I18N = {
    zh: {
      navDownload: '下载',
      heroEyebrow: '专为本地音乐而生的播放器',
      heroTitle: '你的音乐，<br/>另一种聆听方式。',
      heroSub: '本地扫描 · AI 歌词翻译 · AI DJ 无缝混音<br/>一切都在你的电脑上，无需联网，无需账号。',
      heroCta: '下载 Windows 版',
      heroCta2: '了解三大亮点',
      scrollHint: '向下滑动',
      featEyebrow: '三大亮点',
      featTitle: '为听歌这件事，重新发明。',
      featSub: '每一处细节，都为「纯粹听歌」而生。',
      f1Title: '本地音乐扫描',
      f1Desc: '自动扫描你电脑里的每一首 MP3，按专辑、歌手、流派整理成你的私人音乐图书馆。不上传、不联网，数据永远属于你。',
      f1p1: '双击即用，无需注册',
      f1p2: '专辑曲目自动按原版顺序归位',
      f1p3: '液态玻璃界面，专辑库一目了然',
      f2Title: 'AI 歌词翻译',
      f2Desc: '实时同步的歌词逐行滚动，DeepSeek AI 自动翻译成中文对照显示。听懂每一句，不止旋律。',
      f2p1: '逐行高亮，中英对照',
      f2p2: '全屏播放页，封面左歌词右',
      f2p3: '支持居中无歌词的专注模式',
      f3Title: 'AI DJ 无缝混音',
      f3Desc: '节拍锁定、乐句对齐、调性匹配——AI DJ 在鼓点中让歌曲自然相融，过渡没有停顿、没有突兀，像一场永不落幕的私人现场。',
      f3p1: 'BPM 与调性智能匹配',
      f3p2: '16 拍乐句对齐，变速不变调',
      f3p3: 'Smart Reorder 一键重排播放顺序',
      dlEyebrow: '免费 · 本地 · 隐私无忧',
      dlTitle: '现在下载',
      dlSub: '仅支持 Windows · 免费 · 无需注册',
      dlMeta: '安装包约 60 MB · 支持 Windows 10 / 11',
      dlBtn: '下载 Echo Music',
      step1: '点击上方按钮下载安装包',
      step2: '双击运行，或解压到任意文件夹',
      step3: '打开 Echo Music，开始聆听',
      ctEyebrow: '反馈与建议',
      ctTitle: '联系作者',
      ctSub: '任何问题、想法或希望加入的功能，欢迎随时告诉我。',
      qrText: '微信二维码',
      wechatLabel: '微信号',
      wechatId: 'a17841655745',
      ctTip: '扫描二维码或搜索微信号，即可联系我',
      csEyebrow: '即将推出',
      csTitle: '下一步，已经在路上。',
      csSub: 'Echo Music 正在变得更好。',
      csTag: '即将推出',
      cs1Title: '全网音乐账号互联',
      cs1Desc: '连接你的全网音乐账号，歌单与收藏随心同步。',
      cs2Title: 'AI DJ 丝滑过渡，更上一层楼',
      cs2Desc: '更聪明的节拍与调性算法，混音过渡再进化。',
      dsText: 'AI 歌词翻译由 DeepSeek 驱动 · 需要 API Key？',
      dsBtn: '前往获取',
      footerTag: '你的音乐，另一种聆听方式。',
      footerNote: '本地播放 · 免费 · 仅支持 Windows'
    },
    en: {
      navDownload: 'Download',
      heroEyebrow: 'A music player made for local music',
      heroTitle: 'Your music.<br/>A different way to listen.',
      heroSub: 'Local scanning · AI lyric translation · Seamless AI DJ mixing<br/>Everything on your computer. No cloud, no account.',
      heroCta: 'Download for Windows',
      heroCta2: 'Explore the features',
      scrollHint: 'Scroll to explore',
      featEyebrow: 'Three highlights',
      featTitle: 'Rebuilt for listening.',
      featSub: 'Every detail, designed for pure listening.',
      f1Title: 'Local Music Scanning',
      f1Desc: 'Automatically scans every MP3 on your computer and organizes them into a private library by album, artist and genre. Nothing is uploaded. Your music stays yours.',
      f1p1: 'Double-click to run, no sign-up',
      f1p2: 'Album tracks automatically in original order',
      f1p3: 'Liquid-glass interface, albums at a glance',
      f2Title: 'AI Lyric Translation',
      f2Desc: 'Line-by-line synced lyrics with DeepSeek AI translating to Chinese in real time. Understand every word — not just the melody.',
      f2p1: 'Highlighted lines, bilingual view',
      f2p2: 'Fullscreen player, cover left lyrics right',
      f2p3: 'Focus mode: centered cover, no lyrics',
      f3Title: 'AI DJ Seamless Mixing',
      f3Desc: 'Beat-locked, phrase-aligned, key-matched — the AI DJ blends songs naturally in the beat. No pauses, no abrupt cuts, just an endless private set.',
      f3p1: 'Smart BPM & key matching',
      f3p2: '16-beat phrase alignment, pitch preserved',
      f3p3: 'Smart Reorder rearranges your queue',
      dlEyebrow: 'Free · Local · Private',
      dlTitle: 'Download now',
      dlSub: 'Windows only · Free · No sign-up',
      dlMeta: '~60 MB installer · Windows 10 / 11',
      dlBtn: 'Download Echo Music',
      step1: 'Click the button above to download',
      step2: 'Run the installer, or unzip anywhere',
      step3: 'Open Echo Music and start listening',
      ctEyebrow: 'Feedback',
      ctTitle: 'Contact the author',
      ctSub: 'Questions, ideas or feature requests — I would love to hear from you.',
      qrText: 'WeChat QR Code',
      wechatLabel: 'WeChat ID',
      wechatId: 'a17841655745',
      ctTip: 'Scan the QR code or search the WeChat ID to reach me',
      csEyebrow: 'Coming Soon',
      csTitle: "What's next, already on the way.",
      csSub: 'Echo Music keeps getting better.',
      csTag: 'Coming Soon',
      cs1Title: 'Connect All Your Music Accounts',
      cs1Desc: 'Sync playlists and favorites across every music platform.',
      cs2Title: 'AI DJ Transitions, Taken Further',
      cs2Desc: 'Smarter beat & key algorithms for even smoother mixing.',
      dsText: 'AI lyrics translation is powered by DeepSeek · Need an API Key?',
      dsBtn: 'Get one now',
      footerTag: 'Your music. A different way to listen.',
      footerNote: 'Local playback · Free · Windows only'
    }
  };

  let lang = localStorage.getItem('echo_web_lang') || 'zh';
  if (lang !== 'zh' && lang !== 'en') lang = 'zh';

  function applyLang() {
    const dict = I18N[lang];
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.getElementById('lang-btn').textContent = lang === 'zh' ? 'EN' : '中文';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      if (dict[key] != null) {
        if (dict[key].indexOf('<') >= 0) el.innerHTML = dict[key];
        else el.textContent = dict[key];
      }
    });
  }
  document.getElementById('lang-btn').addEventListener('click', () => {
    lang = lang === 'zh' ? 'en' : 'zh';
    localStorage.setItem('echo_web_lang', lang);
    applyLang();
  });
  applyLang();

  // ---------- 滚动浮现（苹果风丝滑展开） ----------
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  // ---------- 鼠标跟随光效 ----------
  const glow = document.getElementById('hero-glow');
  const root = document.documentElement;
  let raf = 0;
  document.addEventListener('mousemove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const x = e.clientX, y = e.clientY;
      root.style.setProperty('--mx', (x / window.innerWidth * 100).toFixed(1) + '%');
      root.style.setProperty('--my', (y / window.innerHeight * 100).toFixed(1) + '%');
      if (glow) {
        glow.style.left = x + 'px';
        glow.style.top = y + 'px';
        glow.style.transform = 'translate(-50%, -50%) scale(1)';
      }
    });
  }, { passive: true });

  // ---------- 顶栏滚动阴影 ----------
  const nav = document.getElementById('nav');
  window.addEventListener('scroll', () => {
    nav.style.borderBottomColor = window.scrollY > 10 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)';
  }, { passive: true });

  // ---------- 下载按钮 ----------
  // 安装包地址：本地预览可填文件路径，上线后填正式下载链接
  // 安装包直链待定（GitHub 恢复或网盘后填入）
  const DOWNLOAD_URL = '';
  document.getElementById('dl-btn').addEventListener('click', (e) => {
    if (DOWNLOAD_URL) return; // 跳转
    e.preventDefault();
    const tip = document.createElement('div');
    tip.className = 'dl-tip';
    tip.textContent = lang === 'zh' ? '安装包正在准备中，请稍后再试' : 'The installer is being prepared, please try again later';
    document.body.appendChild(tip);
    setTimeout(() => tip.remove(), 2600);
  });
})();

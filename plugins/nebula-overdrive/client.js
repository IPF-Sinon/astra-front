/* 星云超载扩展包 · 客户端渲染钩子（由 ModSandbox 用 new Function 激活） */
(function () {
  var CFG = (typeof config === 'object' && config) ? config : {};
  var accent = CFG.customAccent || '#22d3ee';

  api.addStyle(
    '@keyframes nebulaPulse{0%{opacity:.25;transform:scale(1)}50%{opacity:.65;transform:scale(1.06)}100%{opacity:.25;transform:scale(1)}}' +
    '.nebula-ring{animation:nebulaPulse 2.6s ease-in-out infinite;pointer-events:none}'
  );

  api.onRenderPlanet(function (ctx, pl, t) {
    if (!ctx || !pl) return;
    var r = (pl.r || 60) * 1.08;
    ctx.save();
    ctx.globalAlpha = 0.28 + 0.12 * Math.sin((t || 0) / 700);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pl.x, pl.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });

  api.onRenderHud(function (ctx, state) {
    if (!ctx || !state) return;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = accent;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText('NEBULA OVERDRIVE ×' + (CFG.speedMultiplier || 1), 14, 18);
    ctx.restore();
  });
})();

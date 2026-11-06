'use strict';
/*
 * 星云超载扩展包 · 共享规则层（服务端/客户端均可读取的纯常量与规则修正函数）
 * 说明：服务端会把本文件原文随 hello 下发；运行期只读取 config.speedMultiplier，
 * 不直接执行插件代码，从而保持服务端安全边界。
 */
const SPEED_MULTIPLIER = 1.15;

function applySpeedMultiplier(baseSpeed) {
  const n = Number(baseSpeed);
  return Number.isFinite(n) ? n * SPEED_MULTIPLIER : baseSpeed;
}

function rulePatches() {
  return {
    fleetSpeedMultiplier: SPEED_MULTIPLIER,
    label: '星云超载'
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SPEED_MULTIPLIER, applySpeedMultiplier, rulePatches };
}

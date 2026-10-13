/** Dependency-free, decorative SVGs. Nearby text labels every icon. */
const ICONS: Record<string, string> = {
  apple: '<path fill="currentColor" stroke="none" d="M17.05 12.54c.03 3.15 2.76 4.2 2.79 4.22-.03.07-.44 1.5-1.44 2.98-.87 1.28-1.77 2.56-3.2 2.59-1.4.03-1.85-.83-3.46-.83-1.6 0-2.1.8-3.43.86-1.38.05-2.43-1.38-3.3-2.65-1.78-2.6-3.15-7.35-1.32-10.55A5.14 5.14 0 0 1 8.06 6.5c1.37-.03 2.67.92 3.5.92.84 0 2.4-1.14 4.06-.98.7.03 2.65.28 3.9 2.1-.1.06-2.5 1.46-2.47 4ZM14.41 4.7c.73-.88 1.23-2.1 1.1-3.32-1.05.04-2.33.7-3.08 1.58-.68.79-1.28 2.04-1.12 3.24 1.17.1 2.35-.6 3.1-1.5Z"/>',
  windows: '<path fill="currentColor" stroke="none" d="m2 4 9-1.3V11H2Zm10.3-1.5L22 1v10h-9.7ZM2 12.3h9v8.3L2 19.3Zm10.3 0H22v10.6l-9.7-1.5Z"/>',
  linux: '<path d="M8 10c0-2-1-3.5.5-5.5S15.5 2 16 5c.4 2-.3 3.1.5 5 1.2 2 3.5 5.2 2 8-1.8 3.5-11.2 3.5-13 0C4 15.2 6.8 12 8 10Z"/><path fill="currentColor" stroke="none" d="M9 6h1v2H9zm5 0h1v2h-1z"/><path d="m10 9 2-1 2 1-2 2Zm-4 8-3 3 5 1 1-3m9-1 3 3-5 1-1-3M9 12c-1 2-1 4 0 5m6-5c1 2 1 4 0 5"/>',
  terminal: '<path d="m5 6 5 6-5 6m8 0h6"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  "arrow-down": '<path d="M12 4v16m-6-6 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4"/>',
  github: '<path d="M9 19c-4.3 1.3-4.3-2.2-6-2.7m12 5v-3.8c0-1 .1-1.5-.5-2 3-.3 6.2-1.5 6.2-6.8 0-1.5-.5-2.7-1.4-3.6.2-.4.6-1.8-.1-3.5 0 0-1.2-.4-3.7 1.4a12.8 12.8 0 0 0-6.7 0C6.3 1.2 5.1 1.6 5.1 1.6c-.7 1.7-.3 3.1-.1 3.5a5 5 0 0 0-1.4 3.6c0 5.3 3.2 6.5 6.2 6.8-.4.4-.8 1.1-.8 2.1v4.6"/>',
};

export function installIcon(name: string): string {
  const paths = ICONS[name];
  if (!paths) throw new Error(`Unknown installation icon: ${name}`);
  return `<svg class="install-icon" data-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

export function decorateInstall(body: string): string {
  return body.replace(/<span data-icon="([\w-]+)"><\/span>/g, (_, name: string) => installIcon(name));
}

export const INSTALL_CSS = `
.install-page {
  --muted: #a6a6b8; --text: #f1f0f8; --top-h: 68px;
  background: radial-gradient(ellipse 65% 600px at 50% -140px, #31234388, transparent), #0d0d12;
}
.install-page .top { padding-inline: max(24px, calc((100vw - 1080px) / 2)); height: var(--top-h); }
.install-page .brand { font-size: 17px; letter-spacing: -.025em; }
.install-page .brand img { width: 28px; height: 28px; border-radius: 8px; }
.install-top-links { display: flex; align-items: center; gap: 24px; font-size: 13px; }
.install-top-links a { color: #c6c5d3; display: inline-flex; align-items: center; gap: 7px; }
.install-icon { width: 20px; height: 20px; flex: 0 0 auto; display: inline-block; vertical-align: middle; }
.install-top-links .install-icon { width: 17px; height: 17px; }
.install-main { max-width: 1080px; padding: 0 24px; margin: 0 auto; }
.install-page article h1, .install-page article h2, .install-page article h3 { border: 0; padding: 0; color: var(--text); background: none; letter-spacing: -.035em; }
.install-page article .anchor { display: none; }
.install-page article p { color: var(--muted); }
.install-page article strong { color: #e6e5ef; font-weight: 550; }
.install-page article a { color: #c7b7ff; }
.install-hero { padding: 54px 0 48px; text-align: center; }
.install-app-icon { width: 78px; height: 78px; display: grid; place-items: center; margin: 0 auto 24px; border: 1px solid #ffffff21; border-radius: 23px; background: linear-gradient(145deg, #ffffff10, #9e75ef08); box-shadow: 0 12px 48px #a077ff18, inset 0 1px #ffffff15; }
.install-app-icon img { width: 60px; height: 60px; border-radius: 17px; }
.install-page .install-eyebrow { font-size: 10px; letter-spacing: .19em; font-weight: 600; color: #b2a3d2; margin: 0 0 10px; }
.install-page .install-hero h1 { font-size: clamp(38px, 5.5vw, 58px); line-height: 1.1; font-weight: 650; margin: 0 0 18px; letter-spacing: -.055em; }
.install-hero > p:not(.install-eyebrow) { font-size: 15px; line-height: 1.8; }
.install-badges { display: flex; justify-content: center; gap: 18px; flex-wrap: wrap; margin: 22px 0 0; color: #bcbaca; font-size: 11px; }
.install-badges > span { display: inline-flex; gap: 6px; align-items: center; }
.install-badges .install-icon { width: 14px; height: 14px; color: #ac9ed6; }
.install-jumps { margin: 24px auto 0; display: inline-flex; border: 1px solid #ffffff16; border-radius: 10px; padding: 4px; background: #ffffff04; gap: 4px; }
.install-page .install-jumps a { display: flex; align-items: center; gap: 10px; font-size: 12px; padding: 8px 14px; border-radius: 6px; color: #c3c0d0; }
.install-jumps a:first-child { background: #ffffff0c; }
.install-jumps a:hover { text-decoration: none; background: #ffffff14; }
.install-jumps .install-icon { width: 12px; height: 12px; }
.install-page .desktop-section > h2 { font-size: 20px; margin: 0 0 4px; }
.desktop-section > p { font-size: 13px; margin: 0 0 20px; }
.platform-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; align-items: start; }
.platform-card { min-width: 0; padding: 25px 22px 16px; border: 1px solid #ffffff18; border-radius: 18px; background: linear-gradient(155deg, #ffffff08, #ffffff02); box-shadow: inset 0 1px #ffffff05, 0 8px 30px #00000010; }
.platform-mac { background: linear-gradient(145deg, #b399ff10, #ffffff02); border-color: #bfa1ff30; }
.platform-icon { height: 36px; margin-bottom: 16px; }
.platform-icon .install-icon { width: 32px; height: 32px; }
.platform-mac .platform-icon { color: #ddd1fa; }
.platform-windows .platform-icon { color: #8dbaf1; }
.platform-linux .platform-icon { color: #e6c694; }
.install-page .platform-card h3 { font-size: 21px; margin: 0 0 4px; }
.platform-card > p { font-size: 12px; margin: 0 0 22px; }
.platform-action p { margin: 0; }
.install-page .platform-action a { width: 100%; display: flex; align-items: center; justify-content: center; min-height: 43px; background: #f0edf8; border: 1px solid #ffffff60; border-radius: 9px; color: #24202f; font-size: 12px; font-weight: 600; box-shadow: 0 2px 6px #00000018; transition: background .15s, transform .15s; }
.install-page .platform-action a:hover { background: white; text-decoration: none; transform: translateY(-1px); }
.platform-card > .platform-format { font-size: 10px; margin: 11px 0 16px; text-align: center; color: #aaa6b9; line-height: 1.6; min-height: 32px; }
.platform-format span { padding: 0 3px; }
.platform-card .platform-alternative { display: block; font-size: 10px; min-height: 21px; margin: 0 0 12px; color: #aaa6b9; }
.platform-alternative .install-icon { width: 13px; height: 13px; margin-right: 4px; }
.platform-details { font-size: 11px; padding-top: 12px; border-top: 1px solid #ffffff0d; }
.install-page summary { cursor: pointer; color: #c6c1d4; }
.platform-details summary { font-size: 11px; }
.platform-details p { margin-bottom: 3px; line-height: 1.7; }
.install-page article .platform-details code { font-size: 10px; overflow-wrap: anywhere; }
.release-note { display: flex; align-items: flex-start; gap: 8px; margin: 15px 2px 28px; }
.install-page .release-note p { font-size: 11px; line-height: 1.8; margin: 0; color: #918c9f; }
.release-note .install-icon { width: 14px; height: 14px; margin-top: 3px; color: #918c9f; }
.install-page article .release-note code { font-size: 10px; white-space: nowrap; }
.homebrew-panel { padding: 22px 24px 16px; border: 1px solid #ffffff13; border-radius: 16px; background: #ffffff03; }
.install-section-label { display: flex; align-items: center; gap: 8px; color: #b3a5d0; font-size: 10px; font-weight: 600; letter-spacing: .12em; }
.install-section-label .install-icon { width: 15px; height: 15px; }
.install-page .homebrew-panel h3 { font-size: 17px; margin: 10px 0 0; }
.homebrew-panel > p { font-size: 12px; margin: 2px 0 10px; }
.install-page article pre { border-radius: 10px; background: #09090d; border-color: #ffffff12; padding: 19px 92px 19px 20px; margin: 14px 0 12px; overflow: visible; }
.install-page article pre code { display: block; white-space: pre-wrap; overflow-wrap: anywhere; color: #ded6f1; font-size: 12px; line-height: 1.8; }
.install-page pre .copy { top: 12px; right: 10px; font-size: 10px; padding: 7px 10px; border-radius: 6px; color: #d0c8e2; background: #ffffff09; min-height: 32px; }
.install-disclosure { margin-top: 12px; font-size: 12px; }
.install-disclosure summary { font-size: 11px; }
.prerequisites-note { display: flex; gap: 10px; padding: 18px 3px; font-size: 12px; }
.prerequisites-note > .install-icon { width: 16px; height: 16px; margin-top: 3px; color: #8a819d; }
.prerequisites-note p { margin: 0; line-height: 1.8; }
.server-section { margin-top: 35px; padding: 30px; border: 1px solid #8e80bd28; border-radius: 20px; background: radial-gradient(ellipse at 0 0, #9b83dc0e, transparent 70%), #ffffff02; }
.install-page .server-section > h2 { font-size: 28px; margin: 16px 0 3px; }
.server-section > h2 + p { color: #e5dff1; font-size: 17px; margin: 0 0 5px; letter-spacing: -.015em; }
.server-section .server-description { font-size: 13px; margin-top: 5px; }
.server-steps { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 28px; }
.server-step { min-width: 0; }
.step-number { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid #ffffff18; background: #ffffff05; border-radius: 8px; font: 10px ui-monospace, monospace; color: #bdb1d5; }
.install-page .server-step h3 { font-size: 16px; margin: 12px 0 8px; }
.server-step p { font-size: 12px; line-height: 1.8; }
.install-page .server-step pre { padding: 46px 16px 16px; }
.server-security { display: flex; align-items: flex-start; gap: 12px; border: 1px solid #d9b77720; background: #d9b77707; padding: 14px 16px; border-radius: 10px; margin-top: 22px; }
.server-security > .install-icon { color: #c8ad7b; width: 18px; height: 18px; margin-top: 3px; }
.server-security p { margin: 0; font-size: 11px; line-height: 1.8; }
.install-page .server-security strong { color: #d8c29c; }
.server-section > p:last-child { font-size: 11px; margin: 14px 0 0; }
.install-next { display: flex; align-items: center; gap: 18px; padding: 38px 3px; }
.next-icon { width: 42px; height: 42px; flex: 0 0 auto; display: grid; place-items: center; border: 1px solid #b998fa22; border-radius: 13px; background: #b998fa07; color: #c1a7ed; }
.install-page .install-next h2 { font-size: 19px; margin: 0 0 3px; }
.install-next p { font-size: 12px; margin: 3px 0; }
.install-footer { display: flex; justify-content: space-between; gap: 20px; padding: 22px 0 30px; border-top: 1px solid #ffffff0c; font-size: 11px; color: #827e91; }
.install-footer a { color: #a7a0b8; }
.install-skip { position: absolute; left: 16px; top: -100px; z-index: 100; padding: 8px 16px; background: #24202f; color: white; border-radius: 8px; }
.install-skip:focus { top: 12px; }
@media (max-width: 850px) {
  .platform-card { padding: 22px 16px 16px; }
  .platform-card > p { font-size: 11px; }
  .platform-card > .platform-format, .platform-card .platform-alternative { font-size: 10px; }
}
@media (max-width: 680px) {
  .install-page { --top-h: 60px; }
  .install-page .top { padding-inline: 20px; }
  .install-top-links { gap: 15px; font-size: 12px; }
  .install-main { padding: 0 20px; }
  .install-hero { padding: 38px 0; }
  .install-app-icon { width: 65px; height: 65px; border-radius: 19px; margin-bottom: 20px; }
  .install-app-icon img { width: 50px; height: 50px; }
  .install-hero > p:not(.install-eyebrow) { font-size: 13px; }
  .install-badges { gap: 12px; font-size: 10px; }
  .platform-grid { grid-template-columns: 1fr; gap: 12px; }
  .platform-card { position: relative; padding: 22px 20px 16px; }
  .platform-icon { position: absolute; right: 22px; top: 24px; margin: 0; }
  .platform-card > p { font-size: 12px; }
  .platform-card > .platform-format { min-height: 0; margin-bottom: 12px; }
  .platform-card .platform-alternative { min-height: 0; }
  .platform-action { margin-top: 22px; }
  .install-page .platform-action a { min-height: 46px; font-size: 13px; }
  .homebrew-panel { padding: 20px 16px 16px; }
  .install-page article pre { padding: 46px 14px 16px; }
  .install-page article pre code { font-size: 11px; }
  .install-page summary { min-height: 32px; padding-block: 6px; }
  .server-section { padding: 24px 18px; margin-top: 22px; }
  .server-steps { grid-template-columns: 1fr; gap: 22px; }
  .server-step + .server-step { border-top: 1px solid #ffffff0c; padding-top: 22px; }
  .server-security { padding: 12px; }
  .install-next { align-items: flex-start; gap: 12px; padding: 30px 0; }
  .install-footer { font-size: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .install-page .platform-action a { transition: none; }
}
`;

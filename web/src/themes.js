export const themes = {
 'midnight-snack': {id:'midnight-snack',accent:'#793a30',paper:'#eee1ce',stage:'餐台',label:'深夜食堂',line:'夜深了，食物有了自己的打算。',note:'今日菜单 · 有点不寻常',symbol:'碗',frequency:420},
 'working-animals': {id:'working-animals',accent:'#455954',paper:'#dce3d9',stage:'工位',label:'打工动物',line:'认真上班，也认真等你下班。',note:'今日值班 · 各有本领',symbol:'班',frequency:660},
 'weird-appliances': {id:'weird-appliances',accent:'#526076',paper:'#e0e3e8',stage:'陈列台',label:'怪奇家电',line:'电器一切正常，只是有点自己的想法。',note:'通电营业 · 请勿见怪',symbol:'电',frequency:240},
 'vintage-toys': {id:'vintage-toys',accent:'#8b4e37',paper:'#eee0c4',stage:'木质玩具台',label:'旧梦玩具',line:'发条转动，旧时光轻轻醒来。',note:'旧梦玩具 · 轻拧发条',symbol:'玩',frequency:784}
};
export const themeFor = id => themes[id] || themes['midnight-snack'];
export const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function motif(id) {
 const paths = {
  'midnight-snack':'<path d="M20 49h60c-3 25-13 31-30 31S23 74 20 49Z"/><path d="M16 49h68M37 87h26M34 17c-12 12 12 13 0 25m16-30c-12 12 12 13 0 25m16-20c-12 12 12 13 0 25"/>',
  'working-animals':'<rect x="23" y="28" width="54" height="55" rx="8"/><path d="M40 28V17h20v11M23 45h54M40 62h20M45 70h10"/><circle cx="50" cy="43" r="3"/>',
  'weird-appliances':'<rect x="18" y="29" width="64" height="48" rx="9"/><rect x="27" y="38" width="36" height="29" rx="6"/><path d="m36 13 14 16 14-16M28 77v9m44-9v9M70 45h4m-4 11h4"/>',
  'vintage-toys':'<circle cx="50" cy="57" r="24"/><circle cx="38" cy="25" r="10"/><circle cx="62" cy="25" r="10"/><path d="M50 35V15M50 57l11-7M29 84h42"/>'
 };
 return `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id]||paths['midnight-snack']}</svg>`;
}
export function boxMarkup(series,number=1) {
 return `<span class="paper-box"><span class="box-top"><span>奇物百货</span></span><span class="box-side"><span>好好收藏</span></span><span class="box-face"><span class="box-brand">奇物百货 <i>珍奇小物 · 认真陈列</i></span><span class="box-motif">${motif(series.id)}</span><strong>${esc(series.name)}</strong><span class="box-edition">系列藏品 / ${String(number).padStart(2,'0')}</span><span class="box-footer">内有奇物　请拆封 ↓</span></span><span class="box-seal">奇 物 百 货</span></span>`;
}

// 两端状态对比：版本、插件、bundles、预设。只输出差异与建议，不改任何配置。
export function diffStates(local, peer) {
  if (!local || !peer) {
    return { ok: false, reason: '缺少一端的 heartbeat', local: Boolean(local), peer: Boolean(peer), items: [] };
  }
  const items = [];
  const push = (area, name, a, b, note) => items.push({ area, name, local: a, peer: b, note });

  if (local.host?.dsh !== peer.host?.dsh) push('kernel', 'dsh', local.host?.dsh, peer.host?.dsh, '内核版本不同，插件兼容区间可能对不上');
  if (local.host?.node !== peer.host?.node) push('kernel', 'node', local.host?.node, peer.host?.node, 'Node 大版本不同时，装包行为可能不同');

  const lp = local.profile?.plugins ?? {};
  const pp = peer.profile?.plugins ?? {};
  for (const name of new Set([...Object.keys(lp), ...Object.keys(pp)])) {
    if (!(name in pp)) push('plugin', name, lp[name], null, '对端没装');
    else if (!(name in lp)) push('plugin', name, null, pp[name], '本机没装');
    else if (lp[name] !== pp[name]) push('plugin', name, lp[name], pp[name], '版本不同');
  }

  const lb = local.profile?.bundles ?? [];
  const pb = peer.profile?.bundles ?? [];
  const lSet = new Set(lb);
  const pSet = new Set(pb);
  const sameSet = lb.length === pb.length && lb.every((b) => pSet.has(b)) && pb.every((b) => lSet.has(b));
  const sameOrder = JSON.stringify(lb) === JSON.stringify(pb);
  if (!sameSet) {
    push('bundles', 'profile.bundles', lb, pb, 'bundles 条目不同：多一个或少一个都会让插件不加载');
  } else if (!sameOrder) {
    push('bundles', 'profile.bundles', lb, pb, '条目相同、顺序不同：只影响 patch 层叠加次序，通常无害');
  }

  if (local.preset?.permission !== peer.preset?.permission) push('preset', 'permission', local.preset?.permission, peer.preset?.permission, '权限档位不同');
  if (local.preset?.preset !== peer.preset?.preset) push('preset', 'agent preset', local.preset?.preset, peer.preset?.preset, '默认预设不同');

  return {
    ok: true,
    items,
    summary: {
      total: items.length,
      byArea: items.reduce((acc, it) => ({ ...acc, [it.area]: (acc[it.area] ?? 0) + 1 }), {}),
    },
  };
}

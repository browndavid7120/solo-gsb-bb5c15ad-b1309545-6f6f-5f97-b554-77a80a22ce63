'use strict';

/**
 * 通道临时封闭影响评估（按需评估，纯函数，**不写库、不删除任何通道**）。
 *
 * 舞台监督选择一条**现有通道**做临时封闭试算，回答「这条通道若临时封闭，
 * 哪些生效提示的换景线路会被堵死」：
 *  1. 先按现状（全部通道）取得最新全量重放中**全部生效提示**的逐组线路
 *     （复用 routing.js 的整组联合寻路：简单路径枚举 + MRV 回溯，端点
 *     不连通 / 通道争用 / 路径规模上限语义与常规通道规划完全一致）；
 *  2. 再**只在内存中**把该通道从通道列表移除（不改动传入数组），对全部
 *     生效提示重新做同样的整组联合寻路；
 *  3. 逐提示对比封闭前后状态：
 *     - still_ok：原本可行、封闭后仍可行（展示封闭后完整线路）；
 *     - newly_blocked：**原本可行、封闭后不可行**（封闭后端点不连通或
 *       通道争用）——只有这类提示计为**新增阻断**；
 *     - already_broken：原本就无解（端点不连通 / 通道争用），与本次封闭
 *       无关，**单独标明**、不计入封闭影响。封闭只会减少通道，原本无解
 *       的提示封闭后必然仍无解（可能由争用退化为不连通），封闭后状态
 *       一并展示；
 *     - baseline_limited / closure_limited：封闭前或封闭后的简单路径
 *       枚举超过规模上限，按现有路由语义标记**未计算**——不计入新增
 *       阻断，也不据此宣称可行或不可行。
 *
 * 失败（未生效）提示不参与评估（整组不执行，谈不上通道占用），仅回显条数。
 *
 * @module closure
 */

const { computeRouting, edgeKey } = require('./routing');

/**
 * 通道临时封闭影响评估主入口（纯函数）。
 *
 * @param {Array<{name:string}>} locations 全部区位（含无通道的孤立区位）
 * @param {Array<{loc_a:string, loc_b:string}>} passages 现有无向通道
 * @param {Array<{number:number, note:string, transfers:Array}>} cues 已按提示号升序
 * @param {Array<{number:number, ok:boolean}>} results 全量重放结果（replay().results）
 * @param {{a:string, b:string}} closed 要临时封闭的通道（端点顺序不限，内部规范化）
 * @returns {Object} 评估结果：
 *   - closed：规范化后的被封闭通道 {a, b}；
 *   - status：'empty'（无生效提示）/ 'ok'（无新增阻断）/ 'impact'（存在新增阻断）；
 *   - groups[]：逐提示对比，change 为 still_ok / newly_blocked / already_broken /
 *     baseline_limited / closure_limited，before / after 为封闭前后两侧的规划组
 *     （结构同 computeRouting 的组，可行侧含完整线路 routes）；
 *   - summary：{total, stillOk, newlyBlocked, alreadyBroken, limited} 计数；
 *   - effectiveCueCount / skippedCueCount：生效 / 失败提示数。
 */
function computeClosureImpact(locations, passages, cues, results, closed) {
  const [a, b] = closed.a < closed.b ? [closed.a, closed.b] : [closed.b, closed.a];
  const key = edgeKey(a, b);

  // 1) 现状：全部通道下的逐组线路
  const before = computeRouting(locations, passages, cues, results);
  // 2) 封闭后：仅在内存中移除该通道（filter 产生新数组，不改动入参）
  const reduced = passages.filter((p) => edgeKey(p.loc_a, p.loc_b) !== key);
  const after = computeRouting(locations, reduced, cues, results);

  // 3) 逐提示对比（两次 computeRouting 遍历同一 cues/results，组按提示号一一对应）
  const beforeBy = new Map(before.groups.map((g) => [g.number, g]));
  const groups = [];
  const summary = { total: 0, stillOk: 0, newlyBlocked: 0, alreadyBroken: 0, limited: 0 };

  for (const g2 of after.groups) {
    const g1 = beforeBy.get(g2.number);
    let change;
    if (g1.status === 'ok') {
      if (g2.status === 'ok') {
        change = 'still_ok';
        summary.stillOk += 1;
      } else if (g2.status === 'limited') {
        // 防御分支：删边只会减少简单路径，理论上不会发生；仍按未计算处理
        change = 'closure_limited';
        summary.limited += 1;
      } else {
        change = 'newly_blocked';
        summary.newlyBlocked += 1;
      }
    } else if (g1.status === 'limited') {
      change = 'baseline_limited';
      summary.limited += 1;
    } else {
      change = 'already_broken';
      summary.alreadyBroken += 1;
    }
    summary.total += 1;
    groups.push({ number: g2.number, note: g2.note, change, before: g1, after: g2 });
  }

  return {
    closed: { a, b },
    status: groups.length === 0 ? 'empty' : summary.newlyBlocked > 0 ? 'impact' : 'ok',
    groups,
    summary,
    effectiveCueCount: before.effectiveCueCount,
    skippedCueCount: before.skippedCueCount,
  };
}

module.exports = { computeClosureImpact };

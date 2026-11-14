// simulate.cpp —— 通关模拟
//
// 模拟的玩家策略（尽量像一个正常玩家）：
//   · 开出新款 → 放进展柜；开出展柜里已有的 → 直接卖掉
//   · 目标盲盒：
//       策略 A「先便宜后贵」：先集齐最便宜的那种，再集下一种
//       策略 B「先贵后便宜」：买得起就开最贵的、还没集齐的那种
//   · 目标盲盒买不起、但买得起别的盲盒 → 开最便宜的盲盒"攒钱"（开出来的重复款卖掉）
//   · 什么都买不起 → 领破产补助
//   · 每局最多 20000 盒，超过算"没通关"
#include "simulate.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <string>
#include <vector>

#include "economy.h"

namespace blindbox {

namespace {

struct RunResult {
    bool won = false;
    int boxes = 0;
    int coinsSpent = 0;
    int bailouts = 0;
};

// 策略 A / B 选目标盲盒；返回 nullptr = 全部集齐
const Series* pickTarget(const GameConfig& cfg, const Economy& eco, const PlayerState& s,
                         bool expensiveFirst) {
    std::vector<const Series*> todo;
    for (const auto& ser : cfg.series)
        if (!eco.isSeriesComplete(s, ser.id)) todo.push_back(&ser);
    if (todo.empty()) return nullptr;
    std::sort(todo.begin(), todo.end(),
              [](const Series* a, const Series* b) { return a->boxPrice < b->boxPrice; });
    if (!expensiveFirst) return todo.front();
    for (auto it = todo.rbegin(); it != todo.rend(); ++it)
        if (s.coins >= (*it)->boxPrice) return *it;
    return todo.front(); // 都买不起：目标定成最便宜的未集齐的
}

RunResult playOnce(const GameConfig& cfg, uint64_t seed, bool expensiveFirst) {
    Economy eco(cfg, seed);
    PlayerState s = eco.newPlayer();
    const Series* cheapest = &cfg.series.front();
    for (const auto& ser : cfg.series)
        if (ser.boxPrice < cheapest->boxPrice) cheapest = &ser;

    for (int guard = 0; guard < 100000 && s.boxesOpened < 20000; ++guard) {
        if (s.won) break;
        // 仓库里有东西（模拟里不会有，保险起见）就先卖
        while (!s.storage.empty()) eco.sellFromStorage(s, s.storage.front().uid);

        const Series* target = pickTarget(cfg, eco, s, expensiveFirst);
        if (!target) break;
        const Series* toOpen = nullptr;
        if (s.coins >= target->boxPrice) toOpen = target;
        else if (s.coins >= cheapest->boxPrice) toOpen = cheapest; // 攒钱
        else {
            eco.bailout(s);
            continue;
        }

        ActionResult r = eco.open(s, toOpen->id);
        if (!r.ok) {  // 理论上不会发生
            eco.bailout(s);
            continue;
        }
        if (s.showcase[s.pending->seriesId].count(s.pending->itemId)) eco.sellPending(s);
        else eco.pendingToShowcase(s);
    }
    return {s.won, s.boxesOpened, s.coinsSpent, s.bailoutCount};
}

int percentile(std::vector<int> v, double p) {
    if (v.empty()) return 0;
    std::sort(v.begin(), v.end());
    size_t idx = (size_t)std::max(0.0, std::ceil(p / 100.0 * v.size()) - 1);
    return v[std::min(idx, v.size() - 1)];
}

double mean(const std::vector<int>& v) {
    if (v.empty()) return 0;
    double t = 0;
    for (int x : v) t += x;
    return t / v.size();
}

std::string minutes(double boxes, double secondsPerBox) {
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.0f 分钟", boxes * secondsPerBox / 60.0);
    return buf;
}

void report(const char* title, const std::vector<RunResult>& rs, double spb) {
    std::vector<int> boxes, spent, bail;
    int won = 0;
    for (const auto& r : rs) {
        if (!r.won) continue;
        ++won;
        boxes.push_back(r.boxes);
        spent.push_back(r.coinsSpent);
        bail.push_back(r.bailouts);
    }
    std::cout << "\n【" << title << "】通关 " << won << "/" << rs.size() << " 局\n";
    if (!won) return;
    auto line = [&](const char* name, const std::vector<int>& v) {
        std::printf("  %-10s 中位数 %6d   P90 %6d   平均 %8.1f   最少 %6d   最多 %6d\n", name,
                    percentile(v, 50), percentile(v, 90), mean(v),
                    *std::min_element(v.begin(), v.end()), *std::max_element(v.begin(), v.end()));
    };
    line("开盒数", boxes);
    line("花费金币", spent);
    line("破产补助", bail);
    std::cout << "  预计用时   中位数 " << minutes(percentile(boxes, 50), spb) << "   P90 "
              << minutes(percentile(boxes, 90), spb) << "（按每盒 " << spb << " 秒）\n";
}

} // namespace

int runSimulation(const GameConfig& cfg, int runs, uint64_t seed, double secondsPerBox) {
    if (runs <= 0) runs = 1000;
    if (!seed) seed = 20261110;
    std::cout << "通关模拟：" << runs << " 局 × 2 种策略，种子 " << seed << "\n";
    for (const auto& s : cfg.series)
        std::printf("  %s：盒价 %d，单盒平均卖价 %.1f（回本率 %.0f%%）\n", s.name.c_str(), s.boxPrice,
                    cfg.expectedSellPerBox(s), 100.0 * cfg.expectedSellPerBox(s) / s.boxPrice);
    std::printf("  开局 %d 金币，破产补助 %d，每抽独立，无保底\n", cfg.economy.startCoins,
                cfg.economy.bailoutCoins);

    std::vector<RunResult> a, b;
    for (int i = 0; i < runs; ++i) {
        a.push_back(playOnce(cfg, seed + (uint64_t)i * 7919, false));
        b.push_back(playOnce(cfg, seed + (uint64_t)i * 7919, true));
    }
    report("策略 A：先便宜后贵", a, secondsPerBox);
    report("策略 B：先贵后便宜", b, secondsPerBox);
    return 0;
}

} // namespace blindbox

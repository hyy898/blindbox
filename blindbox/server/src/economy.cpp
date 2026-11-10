// economy.cpp —— 游戏规则实现（对应前端 src/game.js + src/draw.js）
#include "economy.h"

#include <algorithm>

namespace blindbox {

using nlohmann::json;

// =====================================================================
// JSON <-> PlayerState
//   存档以 JSON 形式放进 SQLite，同时也直接返回给前端。
// =====================================================================

json entryToJson(const Entry& e) {
    return {{"uid", e.uid},           {"itemId", e.itemId},
            {"seriesId", e.seriesId}, {"rarity", e.rarity},
            {"forcedByPity", e.forcedByPity}, {"preferredNew", e.preferredNew}};
}

static Entry entryFromJson(const json& j) {
    Entry e;
    e.uid = j.value("uid", "");
    e.itemId = j.value("itemId", "");
    e.seriesId = j.value("seriesId", "");
    e.rarity = j.value("rarity", "");
    e.forcedByPity = j.value("forcedByPity", false);
    e.preferredNew = j.value("preferredNew", false);
    return e;
}

// set<string> -> {"a":true,"b":true}（前端习惯的写法）
static json setToObj(const std::set<std::string>& s) {
    json o = json::object();
    for (const auto& k : s) o[k] = true;
    return o;
}
static std::set<std::string> objToSet(const json& o) {
    std::set<std::string> s;
    if (o.is_object())
        for (auto it = o.begin(); it != o.end(); ++it)
            if (it.value().is_boolean() && it.value().get<bool>()) s.insert(it.key());
    return s;
}

json stateToJson(const PlayerState& s) {
    json showcase = json::object();
    for (const auto& [sid, ids] : s.showcase) showcase[sid] = setToObj(ids);
    json storage = json::array();
    for (const auto& e : s.storage) storage.push_back(entryToJson(e));

    return {
        {"coins", s.coins},
        {"unlocked", s.unlocked},
        {"pity", s.pity},
        {"showcase", showcase},
        {"storage", storage},
        {"everOwned", setToObj(s.everOwned)},
        {"rewarded", setToObj(s.rewarded)},
        {"completedOnce", setToObj(s.rewarded)}, // 前端兼容字段，含义同 rewarded
        {"boxesOpened", s.boxesOpened},
        {"bailoutCount", s.bailoutCount},
        {"pending", s.pending ? entryToJson(*s.pending) : json(nullptr)},
        {"won", s.won},
        {"uidSeq", s.uidSeq},
        {"records",
         {{"bestShowcaseValue", s.bestShowcaseValue},
          {"fastestWinBoxes", s.fastestWinBoxes ? json(*s.fastestWinBoxes) : json(nullptr)}}},
    };
}

PlayerState stateFromJson(const json& j) {
    PlayerState s;
    s.coins = j.value("coins", 0);
    if (j.contains("unlocked")) s.unlocked = j["unlocked"].get<std::map<std::string, bool>>();
    if (j.contains("pity")) s.pity = j["pity"].get<std::map<std::string, int>>();
    if (j.contains("showcase") && j["showcase"].is_object())
        for (auto it = j["showcase"].begin(); it != j["showcase"].end(); ++it)
            s.showcase[it.key()] = objToSet(it.value());
    if (j.contains("storage"))
        for (const auto& e : j["storage"]) s.storage.push_back(entryFromJson(e));
    if (j.contains("everOwned")) s.everOwned = objToSet(j["everOwned"]);
    if (j.contains("rewarded")) s.rewarded = objToSet(j["rewarded"]);
    s.boxesOpened = j.value("boxesOpened", 0);
    s.bailoutCount = j.value("bailoutCount", 0);
    if (j.contains("pending") && j["pending"].is_object()) s.pending = entryFromJson(j["pending"]);
    s.won = j.value("won", false);
    s.uidSeq = j.value("uidSeq", 1);
    if (j.contains("records")) {
        const json& r = j["records"];
        s.bestShowcaseValue = r.value("bestShowcaseValue", 0);
        if (r.contains("fastestWinBoxes") && r["fastestWinBoxes"].is_number_integer())
            s.fastestWinBoxes = r["fastestWinBoxes"].get<int>();
    }
    return s;
}

// =====================================================================
// Economy
// =====================================================================

Economy::Economy(const GameConfig& cfg, uint64_t seed)
    : cfg_(cfg), rng_(seed ? seed : std::random_device{}()) {}

double Economy::rand01() {
    return std::uniform_real_distribution<double>(0.0, 1.0)(rng_);
}
size_t Economy::randIndex(size_t n) {
    return std::uniform_int_distribution<size_t>(0, n - 1)(rng_);
}

// 按 weight 加权随机选一个。权重全是 1 时等价于"等概率随机选"
const Item* Economy::pickWeighted(const std::vector<const Item*>& pool) {
    bool allEqual = true;
    for (const Item* it : pool)
        if (it->weight != pool.front()->weight) allEqual = false;
    if (allEqual) return pool[randIndex(pool.size())];

    double total = 0;
    for (const Item* it : pool) total += it->weight;
    double r = rand01() * total;
    for (const Item* it : pool) {
        r -= it->weight;
        if (r < 0) return it;
    }
    return pool.back();
}

PlayerState Economy::newPlayer() const {
    PlayerState s;
    s.coins = cfg_.economy.startCoins;
    for (const auto& ser : cfg_.series) {
        s.unlocked[ser.id] = ser.unlockedAtStart;
        s.pity[ser.id] = 0;
    }
    return s;
}

// 按 dropRate 抽稀有度：随机数依次减去每个稀有度的概率，减到 <=0 就是它
std::string Economy::rollRarity(bool forceSecret) {
    if (forceSecret) return cfg_.economy.pityRarity;
    double r = rand01();
    for (const auto& rar : cfg_.rarities) {
        r -= rar.dropRate;
        if (r <= 0) return rar.key;
    }
    return cfg_.rarities.back().key;
}

bool Economy::isSeriesComplete(const PlayerState& s, const std::string& seriesId) const {
    const Series* ser = cfg_.findSeries(seriesId);
    if (!ser) return false;
    auto it = s.showcase.find(seriesId);
    if (it == s.showcase.end()) return false;
    for (const auto& item : ser->items)
        if (!it->second.count(item.id)) return false;
    return true;
}

// 仓库或展柜里还有东西能卖吗？（正在展示的那个不算，和前端一致）
bool Economy::hasSellable(const PlayerState& s) const {
    if (!s.storage.empty()) return true;
    for (const auto& [sid, ids] : s.showcase)
        if (!ids.empty()) return true;
    return false;
}

// 破产补助条件：任何已解锁的盒子都买不起 + 没有可卖的东西 + 至少有一种盒子已解锁
bool Economy::bailoutEligible(const PlayerState& s) const {
    if (hasSellable(s)) return false;
    if (s.pending) return false; // 手上还有一个没处理的，可以先卖它
    bool anyUnlocked = false;
    for (const auto& ser : cfg_.series) {
        auto it = s.unlocked.find(ser.id);
        if (it == s.unlocked.end() || !it->second) continue;
        anyUnlocked = true;
        if (s.coins >= cfg_.boxPriceOf(ser.id)) return false; // 还买得起
    }
    return anyUnlocked;
}

int Economy::applyBailoutIfEligible(PlayerState& s) {
    if (!bailoutEligible(s)) return 0;
    s.coins += cfg_.economy.bailoutCoins;
    s.bailoutCount++;
    return cfg_.economy.bailoutCoins;
}

int Economy::showcaseValue(const PlayerState& s) const {
    int v = 0;
    for (const auto& [sid, ids] : s.showcase)
        for (const auto& id : ids) v += cfg_.sellPriceOf(id);
    return v;
}

void Economy::updateRecords(PlayerState& s) const {
    s.bestShowcaseValue = std::max(s.bestShowcaseValue, showcaseValue(s));
}

// ---------------------------------------------------------------------
// 开盒：扣钱 -> 抽稀有度（保底）-> 同稀有度里抽具体手办（防重复）
// ---------------------------------------------------------------------
ActionResult Economy::open(PlayerState& s, const std::string& seriesId) {
    const Series* ser = cfg_.findSeries(seriesId);
    if (!ser) return ActionResult::fail(404, "unknown_series", "没有这个系列");
    const int price = cfg_.boxPriceOf(seriesId);
    if (!s.unlocked[seriesId]) return ActionResult::fail(409, "locked", "系列未解锁");
    if (s.pending) return ActionResult::fail(409, "pending", "先处理展示中的手办");

    // 钱不够：能领破产补助就先发补助（和前端行为一致），否则拒绝。
    int bailout = 0;
    if (s.coins < price) {
        bailout = applyBailoutIfEligible(s);
        if (s.coins < price)
            return ActionResult::fail(409, "broke", "金币不足，去卖掉一些手办吧");
    }

    s.coins -= price; // 上面已保证 coins >= price，所以不会变负数

    // 1) 稀有度。pity 是"之前连续多少个没出隐藏款"，这一抽是第 pity+1 个
    int pity = s.pity[seriesId];
    bool forceSecret = pity + 1 >= cfg_.economy.pityAfter;
    std::string rarity = rollRarity(forceSecret);

    // 2) 该系列这个稀有度的候选池
    std::vector<const Item*> pool;
    for (const auto& it : ser->items)
        if (it.rarity == rarity) pool.push_back(&it);

    // 3) 防重复：池子里还有"从没拥有过"的，就只在这些里抽
    bool preferredNew = false;
    if (cfg_.economy.noDupeUntilOwned && !pool.empty()) {
        std::vector<const Item*> unowned;
        for (const Item* it : pool)
            if (!s.everOwned.count(it->id)) unowned.push_back(it);
        if (!unowned.empty()) {
            pool.swap(unowned);
            preferredNew = true;
        }
    }
    // 兜底：某稀有度在该系列没有手办（配置错误），就在整个系列里抽
    if (pool.empty())
        for (const auto& it : ser->items) pool.push_back(&it);

    const Item* chosen = pickWeighted(pool);

    // 4) 更新状态（抽到保底稀有度就把保底计数清零）
    bool gotSecret = chosen->rarity == cfg_.economy.pityRarity;
    s.pity[seriesId] = gotSecret ? 0 : pity + 1;
    s.boxesOpened++;
    s.everOwned.insert(chosen->id);

    Entry e;
    e.uid = "u" + std::to_string(s.uidSeq++);
    e.itemId = chosen->id;
    e.seriesId = seriesId;
    e.rarity = chosen->rarity;
    e.forcedByPity = forceSecret;
    e.preferredNew = preferredNew;
    s.pending = e;

    return ActionResult::success({{"entry", entryToJson(e)},
                                  {"price", price},
                                  {"bailout", bailout}});
}

// 集齐检查：第一次集齐发奖励、解锁下一个系列、判断通关
json Economy::checkComplete(PlayerState& s, const std::string& seriesId) {
    if (!isSeriesComplete(s, seriesId)) return nullptr;
    const Series* ser = cfg_.findSeries(seriesId);
    bool firstTime = !s.rewarded.count(seriesId);
    int reward = 0;
    if (firstTime) {
        reward = ser->completeReward;
        s.coins += reward;
        s.rewarded.insert(seriesId);
        // 按 items.json 中的顺序解锁下一个系列
        for (size_t i = 0; i + 1 < cfg_.series.size(); ++i)
            if (cfg_.series[i].id == seriesId) s.unlocked[cfg_.series[i + 1].id] = true;
        // 全部系列都领过奖励 = 通关
        bool all = true;
        for (const auto& x : cfg_.series)
            if (!s.rewarded.count(x.id)) all = false;
        if (all && !s.won) {
            s.won = true;
            if (!s.fastestWinBoxes || s.boxesOpened < *s.fastestWinBoxes)
                s.fastestWinBoxes = s.boxesOpened;
        }
    }
    return {{"seriesId", seriesId}, {"reward", reward}, {"firstTime", firstTime},
            {"name", ser->name}};
}

ActionResult Economy::pendingToShowcase(PlayerState& s) {
    if (!s.pending) return ActionResult::fail(409, "no_pending", "没有展示中的手办");
    Entry p = *s.pending;
    s.pending.reset();
    auto& slot = s.showcase[p.seriesId];
    if (slot.count(p.itemId)) {
        // 展柜每格只放一个：同款进仓库
        s.storage.push_back(p);
        return ActionResult::success({{"where", "storage"}, {"entry", entryToJson(p)}});
    }
    slot.insert(p.itemId);
    json completed = checkComplete(s, p.seriesId);
    updateRecords(s);
    return ActionResult::success(
        {{"where", "showcase"}, {"entry", entryToJson(p)}, {"completed", completed}});
}

ActionResult Economy::pendingToStorage(PlayerState& s) {
    if (!s.pending) return ActionResult::fail(409, "no_pending", "没有展示中的手办");
    s.storage.push_back(*s.pending);
    json e = entryToJson(*s.pending);
    s.pending.reset();
    return ActionResult::success({{"entry", e}});
}

ActionResult Economy::reopenFromStorage(PlayerState& s, const std::string& uid) {
    if (s.pending) return ActionResult::fail(409, "pending", "先处理展示中的手办");
    auto it = std::find_if(s.storage.begin(), s.storage.end(),
                           [&](const Entry& e) { return e.uid == uid; });
    if (it == s.storage.end()) return ActionResult::fail(404, "missing", "仓库里没有这个手办");
    s.pending = *it;
    s.storage.erase(it);
    return ActionResult::success({{"entry", entryToJson(*s.pending)}});
}

ActionResult Economy::sellPending(PlayerState& s) {
    if (!s.pending) return ActionResult::fail(409, "no_pending", "没有展示中的手办");
    int price = cfg_.sellPriceOf(s.pending->itemId);
    json e = entryToJson(*s.pending);
    s.coins += price;
    s.pending.reset();
    return ActionResult::success({{"price", price}, {"entry", e}});
}

ActionResult Economy::sellFromStorage(PlayerState& s, const std::string& uid) {
    auto it = std::find_if(s.storage.begin(), s.storage.end(),
                           [&](const Entry& e) { return e.uid == uid; });
    if (it == s.storage.end()) return ActionResult::fail(404, "missing", "仓库里没有这个手办");
    int price = cfg_.sellPriceOf(it->itemId);
    json e = entryToJson(*it);
    s.coins += price;
    s.storage.erase(it);
    return ActionResult::success({{"price", price}, {"entry", e}});
}

// 从展柜卖：该系列会变回"未集齐"，但已领的奖励不收回、以后也不重复发
ActionResult Economy::sellFromShowcase(PlayerState& s, const std::string& seriesId,
                                       const std::string& itemId) {
    auto sit = s.showcase.find(seriesId);
    if (sit == s.showcase.end() || !sit->second.count(itemId))
        return ActionResult::fail(404, "not_in_showcase", "展柜里没有这个手办");
    sit->second.erase(itemId);
    int price = cfg_.sellPriceOf(itemId);
    s.coins += price;
    return ActionResult::success({{"price", price}, {"itemId", itemId}, {"seriesId", seriesId}});
}

ActionResult Economy::bailout(PlayerState& s) {
    int coins = applyBailoutIfEligible(s);
    if (!coins)
        return ActionResult::fail(409, "not_eligible",
                                  "还买得起盲盒，或者还有手办可以卖，暂时不能领补助");
    return ActionResult::success({{"coins", coins}});
}

} // namespace blindbox

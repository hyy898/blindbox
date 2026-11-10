// economy.cpp —— 游戏规则实现
#include "economy.h"

#include <algorithm>

namespace blindbox {

using nlohmann::json;

// =====================================================================
// JSON <-> PlayerState
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

// set<string> -> {"a":true,"b":true}（网页里好查）
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
        {"pity", s.pity},
        {"showcase", showcase},
        {"storage", storage},
        {"everOwned", setToObj(s.everOwned)},
        {"boxesOpened", s.boxesOpened},
        {"coinsSpent", s.coinsSpent},
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
    if (j.contains("pity")) s.pity = j["pity"].get<std::map<std::string, int>>();
    if (j.contains("showcase") && j["showcase"].is_object())
        for (auto it = j["showcase"].begin(); it != j["showcase"].end(); ++it)
            s.showcase[it.key()] = objToSet(it.value());
    if (j.contains("storage"))
        for (const auto& e : j["storage"]) s.storage.push_back(entryFromJson(e));
    if (j.contains("everOwned")) s.everOwned = objToSet(j["everOwned"]);
    s.boxesOpened = j.value("boxesOpened", 0);
    s.coinsSpent = j.value("coinsSpent", 0);
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

PlayerState Economy::newPlayer() const {
    PlayerState s;
    s.coins = cfg_.economy.startCoins;
    for (const auto& ser : cfg_.series) s.pity[ser.id] = 0;
    return s;
}

// 按掉率抽稀有度：随机数依次减去每个稀有度的概率，减到 <=0 就是它
std::string Economy::rollRarity(bool forceSecret) {
    if (forceSecret) return cfg_.economy.pityRarity;
    double r = rand01();
    for (const auto& rar : cfg_.rarities) {
        r -= rar.dropRate;
        if (r <= 0) return rar.key;
    }
    return cfg_.rarities.back().key;
}

// 按 weight 加权随机选一个。权重全一样时就是等概率
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

bool Economy::isSeriesComplete(const PlayerState& s, const std::string& seriesId) const {
    const Series* ser = cfg_.findSeries(seriesId);
    if (!ser) return false;
    auto it = s.showcase.find(seriesId);
    if (it == s.showcase.end()) return false;
    for (const auto& item : ser->items)
        if (!it->second.count(item.id)) return false;
    return true;
}

bool Economy::isAllComplete(const PlayerState& s) const {
    for (const auto& ser : cfg_.series)
        if (!isSeriesComplete(s, ser.id)) return false;
    return true;
}

// 破产补助条件：买不起最便宜的盲盒 + 仓库空 + 没有展示中的手办
// （展柜里的手办不能卖，所以不影响领补助）
bool Economy::bailoutEligible(const PlayerState& s) const {
    if (s.coins >= cfg_.cheapestBoxPrice()) return false;
    if (!s.storage.empty()) return false;
    if (s.pending) return false;
    return true;
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

json Economy::progressJson(const PlayerState& s) const {
    json by = json::object();
    int owned = 0, total = 0;
    for (const auto& ser : cfg_.series) {
        auto it = s.showcase.find(ser.id);
        int n = it == s.showcase.end() ? 0 : (int)it->second.size();
        by[ser.id] = {{"owned", n}, {"total", ser.items.size()}};
        owned += n;
        total += (int)ser.items.size();
    }
    return {{"owned", owned}, {"total", total}, {"bySeries", by}};
}

Entry Economy::makeEntry(PlayerState& s, const std::string& itemId) const {
    const Item* item = cfg_.findItem(itemId);
    Entry e;
    e.uid = "u" + std::to_string(s.uidSeq++);
    e.itemId = itemId;
    e.seriesId = cfg_.seriesOfItem.at(itemId);
    e.rarity = item ? item->rarity : "";
    return e;
}

// ---------------------------------------------------------------------
// 开盒：扣钱 -> 抽稀有度（保底）-> 同稀有度里抽具体手办（防重复）
// ---------------------------------------------------------------------
ActionResult Economy::open(PlayerState& s, const std::string& seriesId) {
    const Series* ser = cfg_.findSeries(seriesId);
    if (!ser) return ActionResult::fail(404, "unknown_series", "没有这种盲盒");
    if (s.pending) return ActionResult::fail(409, "pending", "先处理展示中的手办");
    const int price = ser->boxPrice;

    // 钱不够：能领破产补助就先发补助，否则拒绝（金币永远不会变成负数）
    int bailout = 0;
    if (s.coins < price) {
        bailout = applyBailoutIfEligible(s);
        if (s.coins < price)
            return ActionResult::fail(409, "broke", "金币不足，去仓库卖掉一些手办吧");
    }
    s.coins -= price;
    s.coinsSpent += price;

    // 1) 稀有度。pity 是这种盲盒"之前连续多少个没出隐藏款"，这一抽是第 pity+1 个
    int pity = s.pity[seriesId];
    bool forceSecret = pity + 1 >= cfg_.economy.pityAfter;
    std::string rarity = rollRarity(forceSecret);

    // 2) 这种盲盒里这个稀有度的候选池
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
    // 兜底：某稀有度在这种盲盒里没有手办（配置校验已经防住了，这里只是保险）
    if (pool.empty())
        for (const auto& it : ser->items) pool.push_back(&it);

    const Item* chosen = pickWeighted(pool);

    // 4) 更新状态（抽到保底稀有度就把这种盲盒的保底计数清零）
    s.pity[seriesId] = chosen->rarity == cfg_.economy.pityRarity ? 0 : pity + 1;
    s.boxesOpened++;
    s.everOwned.insert(chosen->id);

    Entry e = makeEntry(s, chosen->id);
    e.forcedByPity = forceSecret;
    e.preferredNew = preferredNew;
    s.pending = e;

    return ActionResult::success({{"entry", entryToJson(e)},
                                  {"price", price},
                                  {"bailout", bailout},
                                  {"alreadyInShowcase", (bool)s.showcase[seriesId].count(e.itemId)}});
}

ActionResult Economy::pendingToShowcase(PlayerState& s) {
    if (!s.pending) return ActionResult::fail(409, "no_pending", "没有展示中的手办");
    Entry p = *s.pending;
    auto& slot = s.showcase[p.seriesId];
    if (slot.count(p.itemId))
        return ActionResult::fail(409, "already_in_showcase", "展柜里已经有这一款了，放进仓库或卖掉吧");
    s.pending.reset();
    slot.insert(p.itemId);
    s.bestShowcaseValue = std::max(s.bestShowcaseValue, showcaseValue(s));

    bool seriesComplete = isSeriesComplete(s, p.seriesId);
    bool justWon = false;
    if (isAllComplete(s) && !s.won) {
        // 通关：所有手办都在展柜里。只记第一次
        s.won = true;
        justWon = true;
        if (!s.fastestWinBoxes || s.boxesOpened < *s.fastestWinBoxes)
            s.fastestWinBoxes = s.boxesOpened;
    }
    return ActionResult::success({{"entry", entryToJson(p)},
                                  {"seriesComplete", seriesComplete},
                                  {"won", justWon}});
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
    const Entry& p = *s.pending;
    return ActionResult::success({{"entry", entryToJson(p)},
                                  {"alreadyInShowcase", (bool)s.showcase[p.seriesId].count(p.itemId)}});
}

// 展柜 -> 仓库（展柜里的不能直接卖，想卖得先取回仓库）
ActionResult Economy::showcaseToStorage(PlayerState& s, const std::string& seriesId,
                                        const std::string& itemId) {
    auto sit = s.showcase.find(seriesId);
    if (sit == s.showcase.end() || !sit->second.count(itemId))
        return ActionResult::fail(404, "not_in_showcase", "展柜里没有这个手办");
    sit->second.erase(itemId);
    Entry e = makeEntry(s, itemId);
    s.storage.push_back(e);
    return ActionResult::success({{"entry", entryToJson(e)}});
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

ActionResult Economy::bailout(PlayerState& s) {
    int coins = applyBailoutIfEligible(s);
    if (!coins)
        return ActionResult::fail(409, "not_eligible",
                                  "还买得起盲盒，或者仓库里还有手办可以卖，暂时不能领补助");
    return ActionResult::success({{"coins", coins}});
}

} // namespace blindbox

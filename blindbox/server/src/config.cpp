// config.cpp —— 配置的查询、校验、导出 JSON（具体数值在 game_config.cpp）
#include "config.h"

#include <algorithm>
#include <cmath>
#include <set>

namespace blindbox {

const Rarity* GameConfig::rarity(const std::string& key) const {
    for (const auto& r : rarities)
        if (r.key == key) return &r;
    return nullptr;
}

const Series* GameConfig::findSeries(const std::string& id) const {
    for (const auto& s : series)
        if (s.id == id) return &s;
    return nullptr;
}

const Item* GameConfig::findItem(const std::string& id) const {
    auto it = itemsById.find(id);
    return it == itemsById.end() ? nullptr : &it->second;
}

// 卖价 = 稀有度基础卖价 × 所属盲盒的倍率（四舍五入成整数）
int GameConfig::sellPriceOf(const std::string& itemId) const {
    const Item* item = findItem(itemId);
    if (!item) return 0;
    const Rarity* r = rarity(item->rarity);
    auto sit = seriesOfItem.find(itemId);
    const Series* s = sit == seriesOfItem.end() ? nullptr : findSeries(sit->second);
    if (!r || !s) return 0;
    return (int)std::lround(r->sellPrice * s->sellMultiplier);
}

int GameConfig::boxPriceOf(const std::string& seriesId) const {
    const Series* s = findSeries(seriesId);
    return s ? s->boxPrice : 0;
}

int GameConfig::cheapestBoxPrice() const {
    int m = 0;
    for (const auto& s : series)
        if (m == 0 || s.boxPrice < m) m = s.boxPrice;
    return m;
}

double GameConfig::dropRateOf(const Series& series, const std::string& rarityKey) const {
    if (!series.dropRates.empty()) {
        auto found = series.dropRates.find(rarityKey);
        return found == series.dropRates.end() ? 0 : found->second;
    }
    const Rarity* r = rarity(rarityKey);
    return r ? r->dropRate : 0;
}

double GameConfig::itemChanceOf(const Series& series, const Item& item) const {
    double totalWeight = 0;
    for (const auto& candidate : series.items)
        if (candidate.rarity == item.rarity) totalWeight += candidate.weight;
    return totalWeight > 0 ? dropRateOf(series, item.rarity) * item.weight / totalWeight : 0;
}

// 单盒平均卖价 = Σ 稀有度掉率 × 该稀有度卖价（同稀有度手办卖价相同）
double GameConfig::expectedSellPerBox(const Series& s) const {
    double v = 0;
    for (const auto& r : rarities) v += dropRateOf(s, r.key) * r.sellPrice * s.sellMultiplier;
    return v;
}

std::string GameConfig::modelFileOf(const Item& item) const {
    return item.model.empty() ? item.id + ".glb" : item.model;
}

void finalizeConfig(GameConfig& cfg) {
    cfg.itemsById.clear();
    cfg.seriesOfItem.clear();
    for (const auto& s : cfg.series)
        for (const auto& it : s.items) {
            cfg.itemsById[it.id] = it;
            cfg.seriesOfItem[it.id] = s.id;
        }
}

// ---------------------------------------------------------------------
// 校验：把能想到的配置错误都查一遍，一次性全部列出来
// ---------------------------------------------------------------------
std::vector<std::string> validateConfig(const GameConfig& cfg) {
    std::vector<std::string> errs;
    const auto& e = cfg.economy;

    if (e.startCoins < 0) errs.push_back("开局金币 startCoins 不能是负数");
    if (e.bailoutCoins <= 0) errs.push_back("破产补助 bailoutCoins 必须大于 0");

    // ---- 稀有度 ----
    if (cfg.rarities.empty()) errs.push_back("至少要有一个稀有度");
    std::set<std::string> rarityKeys;
    double sum = 0;
    for (const auto& r : cfg.rarities) {
        if (r.key.empty()) errs.push_back("有个稀有度的 key 是空的");
        if (!rarityKeys.insert(r.key).second) errs.push_back("稀有度 key 重复: " + r.key);
        if (!std::isfinite(r.dropRate) || r.dropRate < 0 || r.dropRate > 1)
            errs.push_back("稀有度 " + r.key + " 的掉率必须在 0~1 之间");
        if (r.sellPrice <= 0) errs.push_back("稀有度 " + r.key + " 的卖价必须大于 0");
        sum += r.dropRate;
    }
    if (!std::isfinite(sum) || std::fabs(sum - 1.0) > 1e-6)
        errs.push_back("所有稀有度的掉率加起来必须等于 1（现在是 " + std::to_string(sum) + "）");
    // ---- 盒子和手办 ----
    if (cfg.series.empty()) errs.push_back("至少要有一种盲盒");
    std::set<std::string> seriesIds, itemIds, modelFiles;
    for (const auto& s : cfg.series) {
        const std::string where = "盲盒「" + s.name + "」(" + s.id + ")";
        if (s.id.empty()) errs.push_back("有个盲盒的 id 是空的");
        if (!seriesIds.insert(s.id).second) errs.push_back("盲盒 id 重复: " + s.id);
        if (s.boxPrice <= 0) errs.push_back(where + " 的价格 boxPrice 必须大于 0");
        if (s.sellMultiplier <= 0) errs.push_back(where + " 的卖价倍率 sellMultiplier 必须大于 0");
        if (s.items.empty()) errs.push_back(where + " 里没有手办");
        double seriesSum = 0;
        for (const auto& [key, rate] : s.dropRates)
            if (!rarityKeys.count(key) || !std::isfinite(rate) || rate < 0 || rate > 1)
                errs.push_back(where + " 的独立掉率无效: " + key);
        for (const auto& r : cfg.rarities) seriesSum += cfg.dropRateOf(s, r.key);
        if (!std::isfinite(seriesSum) || std::fabs(seriesSum - 1.0) > 1e-6)
            errs.push_back(where + " 的独立掉率合计必须等于 1");

        std::set<std::string> raritiesInBox;
        for (const auto& it : s.items) {
            const std::string iw = where + " 的手办 " + it.id;
            if (it.id.empty()) errs.push_back(where + " 有个手办 id 是空的");
            if (!itemIds.insert(it.id).second) errs.push_back("手办 id 重复: " + it.id);
            if (it.name.empty()) errs.push_back(iw + " 没有名字");
            if (!rarityKeys.count(it.rarity))
                errs.push_back(iw + " 的稀有度 \"" + it.rarity + "\" 没有定义");
            if (!std::isfinite(it.weight) || it.weight <= 0) errs.push_back(iw + " 的权重 weight 必须是大于 0 的有限数");
            std::string file = cfg.modelFileOf(it);
            if (file.find("..") != std::string::npos || file.find('/') != std::string::npos ||
                file.find('\\') != std::string::npos)
                errs.push_back(iw + " 的模型文件名只能是文件名，不能带路径: " + file);
            if (!modelFiles.insert(file).second)
                errs.push_back(iw + " 的模型文件名和别的手办重复: " + file);
            raritiesInBox.insert(it.rarity);
        }
        // 按实际单款概率比较，避免同档有多款时隐藏款反而更常见。
        double maxSecret = 0, minOther = 1;
        bool hasOther = false;
        for (const auto& item : s.items) {
            const double chance = cfg.itemChanceOf(s, item);
            if (!(chance > 0)) continue;
            if (item.rarity == "secret") maxSecret = std::max(maxSecret, chance);
            else { minOther = std::min(minOther, chance); hasOther = true; }
        }
        if (hasOther && maxSecret > minOther + 1e-12)
            errs.push_back(where + "的隐藏款单款概率不能高于其他可抽款式，请调整独立掉率或款式权重");
        // 每个掉率 > 0 的稀有度，盒子里都得有对应手办，否则抽到了没东西给
        for (const auto& r : cfg.rarities)
            if (cfg.dropRateOf(s, r.key) > 0 && !raritiesInBox.count(r.key))
                errs.push_back(where + " 里没有「" + r.label + "」手办，但这个稀有度掉率不为 0");
    }
    return errs;
}

// ---------------------------------------------------------------------
// 导出给前端的 JSON（GET /api/config 和 --dump-config 都用它）
// ---------------------------------------------------------------------
nlohmann::ordered_json configToJson(const GameConfig& cfg) {
    using oj = nlohmann::ordered_json;
    const auto& e = cfg.economy;

    oj rar = oj::object();
    for (const auto& r : cfg.rarities)
        rar[r.key] = {{"label", r.label}, {"dropRate", r.dropRate},
                      {"sellPrice", r.sellPrice}, {"color", r.color}};

    oj series = oj::array();
    size_t total = 0;
    for (const auto& s : cfg.series) {
        oj items = oj::array();
        for (const auto& it : s.items)
            items.push_back({{"id", it.id},
                             {"name", it.name},
                             {"rarity", it.rarity},
                             {"desc", it.desc},
                             {"sellPrice", cfg.sellPriceOf(it.id)}, // 已乘倍率
                             {"weight", it.weight},
                             {"drawChance", cfg.itemChanceOf(s, it)},
                             {"model", "models/" + cfg.modelFileOf(it)}});
        total += s.items.size();
        oj rates = oj::object();
        for (const auto& r : cfg.rarities) rates[r.key] = cfg.dropRateOf(s, r.key);
        series.push_back({{"id", s.id},
                          {"name", s.name},
                          {"boxPrice", s.boxPrice},
                          {"dropRates", rates},
                          {"sellMultiplier", s.sellMultiplier},
                          {"expectedSellPerBox", cfg.expectedSellPerBox(s)},
                          {"items", items}});
    }

    return {
        {"version", cfg.version},
        {"economy",
         {{"startCoins", e.startCoins},
          {"bailout", {{"coins", e.bailoutCoins}}},
          {"noDuplicateWithinRarityUntilOwned", e.noDupeUntilOwned},
          {"totalItems", total}}},
        {"rarities", rar},
        {"series", series},
    };
}

} // namespace blindbox

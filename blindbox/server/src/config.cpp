// config.cpp —— 配置的查询、校验、导出 JSON（具体数值在 game_config.cpp）
#include "config.h"

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

int GameConfig::sellPriceOf(const std::string& itemId) const {
    const Item* item = findItem(itemId);
    if (!item) return 0;
    if (item->sellPrice > 0) return item->sellPrice; // 单独定价优先
    const Rarity* r = rarity(item->rarity);
    return r ? r->sellPrice : 0;
}

int GameConfig::boxPriceOf(const std::string& seriesId) const {
    const Series* s = findSeries(seriesId);
    if (s && s->boxPrice > 0) return s->boxPrice;
    return economy.defaultBoxPrice;
}

std::string GameConfig::modelFileOf(const Item& item) const {
    return item.model.empty() ? item.id + ".glb" : item.model;
}

void finalizeConfig(GameConfig& cfg) {
    cfg.itemsById.clear();
    for (const auto& s : cfg.series)
        for (const auto& it : s.items) cfg.itemsById[it.id] = it;
}

// ---------------------------------------------------------------------
// 校验：把能想到的配置错误都查一遍，一次性全部列出来
// ---------------------------------------------------------------------
std::vector<std::string> validateConfig(const GameConfig& cfg) {
    std::vector<std::string> errs;
    const auto& e = cfg.economy;

    if (e.startCoins < 0) errs.push_back("开局金币 startCoins 不能是负数");
    if (e.defaultBoxPrice <= 0) errs.push_back("默认盒子价格 defaultBoxPrice 必须大于 0");
    if (e.pityAfter <= 0) errs.push_back("保底次数 pityAfter 必须大于 0");
    if (e.bailoutCoins <= 0) errs.push_back("破产补助 bailoutCoins 必须大于 0");

    // ---- 稀有度 ----
    if (cfg.rarities.empty()) errs.push_back("至少要有一个稀有度");
    std::set<std::string> rarityKeys;
    double sum = 0;
    for (const auto& r : cfg.rarities) {
        if (r.key.empty()) errs.push_back("有个稀有度的 key 是空的");
        if (!rarityKeys.insert(r.key).second) errs.push_back("稀有度 key 重复: " + r.key);
        if (r.dropRate < 0 || r.dropRate > 1)
            errs.push_back("稀有度 " + r.key + " 的掉率必须在 0~1 之间");
        if (r.sellPrice <= 0) errs.push_back("稀有度 " + r.key + " 的卖价必须大于 0");
        sum += r.dropRate;
    }
    if (std::fabs(sum - 1.0) > 1e-6)
        errs.push_back("所有稀有度的掉率加起来必须等于 1（现在是 " + std::to_string(sum) + "）");
    if (!rarityKeys.count(e.pityRarity))
        errs.push_back("保底稀有度 pityRarity = \"" + e.pityRarity + "\" 没有定义");

    // ---- 盒子和手办 ----
    if (cfg.series.empty()) errs.push_back("至少要有一种盲盒");
    std::set<std::string> seriesIds, itemIds, modelFiles;
    bool anyUnlocked = false;
    for (const auto& s : cfg.series) {
        const std::string where = "盲盒「" + s.name + "」(" + s.id + ")";
        if (s.id.empty()) errs.push_back("有个盲盒的 id 是空的");
        if (!seriesIds.insert(s.id).second) errs.push_back("盲盒 id 重复: " + s.id);
        if (s.boxPrice < 0) errs.push_back(where + " 的价格不能是负数");
        if (s.completeReward < 0) errs.push_back(where + " 的集齐奖励不能是负数");
        if (s.unlockedAtStart) anyUnlocked = true;
        if (s.items.empty()) errs.push_back(where + " 里没有手办");

        std::set<std::string> raritiesInBox;
        for (const auto& it : s.items) {
            const std::string iw = where + " 的手办 " + it.id;
            if (it.id.empty()) errs.push_back(where + " 有个手办 id 是空的");
            if (!itemIds.insert(it.id).second) errs.push_back("手办 id 重复: " + it.id);
            if (it.name.empty()) errs.push_back(iw + " 没有名字");
            if (!rarityKeys.count(it.rarity))
                errs.push_back(iw + " 的稀有度 \"" + it.rarity + "\" 没有定义");
            if (it.sellPrice < 0) errs.push_back(iw + " 的卖价不能是负数");
            if (it.weight <= 0) errs.push_back(iw + " 的权重 weight 必须大于 0");
            std::string file = cfg.modelFileOf(it);
            if (file.find("..") != std::string::npos || file.find('/') != std::string::npos ||
                file.find('\\') != std::string::npos)
                errs.push_back(iw + " 的模型文件名只能是文件名，不能带路径: " + file);
            if (!modelFiles.insert(file).second)
                errs.push_back(iw + " 的模型文件名和别的手办重复: " + file);
            raritiesInBox.insert(it.rarity);
        }
        // 每个掉率 > 0 的稀有度，盒子里都得有对应手办，否则抽到了没东西给
        for (const auto& r : cfg.rarities)
            if (r.dropRate > 0 && !raritiesInBox.count(r.key))
                errs.push_back(where + " 里没有「" + r.label + "」手办，但这个稀有度掉率不为 0");
    }
    if (!cfg.series.empty() && !anyUnlocked)
        errs.push_back("至少要有一种盲盒 unlockedAtStart = true，否则开局什么都买不了");
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
    for (const auto& s : cfg.series) {
        oj items = oj::array();
        for (const auto& it : s.items)
            items.push_back({{"id", it.id},
                             {"name", it.name},
                             {"rarity", it.rarity},
                             {"desc", it.desc},
                             {"sellPrice", cfg.sellPriceOf(it.id)},
                             {"weight", it.weight},
                             {"model", "models/" + cfg.modelFileOf(it)}});
        oj so = {{"id", s.id},
                 {"name", s.name},
                 {"boxPrice", cfg.boxPriceOf(s.id)},
                 {"unlockedAtStart", s.unlockedAtStart}};
        if (!s.unlockCondition.empty()) so["unlockCondition"] = s.unlockCondition;
        so["completeReward"] = s.completeReward;
        so["items"] = items;
        series.push_back(so);
    }

    return {
        {"version", cfg.version},
        {"generatedBy", "server/src/game_config.cpp（请改 C++ 配置后用 --dump-config 重新生成，不要手改本文件）"},
        {"economy",
         {{"startCoins", e.startCoins},
          {"boxPrice", e.defaultBoxPrice},
          {"pity", {{"secretGuaranteeAfter", e.pityAfter}, {"rarity", e.pityRarity}}},
          {"bailout", {{"coins", e.bailoutCoins}}},
          {"noDuplicateWithinRarityUntilOwned", e.noDupeUntilOwned}}},
        {"rarities", rar},
        {"series", series},
        {"modelConvention", {{"pathPattern", "models/<id>.glb"},
                             {"note", "每个手办的 model 字段就是实际路径；缺文件自动用占位体"}}},
    };
}

} // namespace blindbox
